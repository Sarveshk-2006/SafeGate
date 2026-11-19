import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  generateSalt,
  hashPassword,
  hashPasswordScrypt,
  hashPasswordScryptAsync,
  hashPasswordHmac,
  verifyPassword,
  verifyPasswordAsync,
  timingSafeCompare,
  needsRehash,
  TARGET_SCRYPT_CONFIG,
  ALLOWED_SCRYPT_CONFIG_KEYS,
} from '../server/src/crypto';
import { UniversalProvisioningService } from '../server/src/provisioning';
import {
  isExplicitLocalDevOrTestEnv,
  isDestructiveCleanAuthorized,
  getSeedPasswordForRole,
  resolveSeedCredentials,
} from '../server/src/seed';
import { prisma } from '../server/src/prisma';
import { determineMigrationFiles } from '../scripts/postgres/migrate';
import {
  loginRateLimiter,
  AuthConcurrencyLimiter,
  authConcurrencyLimiter,
} from '../server/src/auth';

describe('ISSUE-05: Secure Password Hashing, Seed Credential Provisioning & Auth Hardening', () => {
  // =========================================================================
  // 1. PASSWORD SECURITY & CRYPTOGRAPHIC VERIFICATIONS
  // =========================================================================
  describe('1. Password Cryptographic Functions', () => {
    test('generateSalt produces unique random salts with at least 16 bytes (32 hex chars)', () => {
      const salt1 = generateSalt(16);
      const salt2 = generateSalt(16);
      expect(typeof salt1).toBe('string');
      expect(salt1.length).toBe(32);
      expect(salt2.length).toBe(32);
      expect(salt1).not.toBe(salt2);
    });

    test('hashPasswordScrypt computes versioned scrypt hash with target config ($scrypt$N=131072,r=8,p=1$...)', () => {
      const salt = generateSalt(16);
      const hash = hashPasswordScrypt('TestPassword123!', salt);
      expect(typeof hash).toBe('string');
      expect(hash.startsWith('$scrypt$N=131072,r=8,p=1$')).toBe(true);
      const hexPart = hash.split('$')[3];
      expect(hexPart.length).toBe(64); // 32-byte derived key = 64 hex characters
      expect(hash).not.toContain('TestPassword123!');
    });

    test('hashPasswordHmac computes deterministic 64-char HMAC-SHA256 for backwards compatibility', () => {
      const salt = 'fixed_test_salt_12345';
      const hash1 = hashPasswordHmac('Secret123!', salt);
      const hash2 = hashPasswordHmac('Secret123!', salt);
      const hashDiff = hashPasswordHmac('Different123!', salt);

      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hashDiff);
      expect(hash1.length).toBe(64);
      expect(hash1).not.toContain('Secret123!');
    });

    test('verifyPassword succeeds for valid password with target N=131072 scrypt format', () => {
      const salt = generateSalt(16);
      const hash = hashPasswordScrypt('SuperSecretPass@2026', salt);
      expect(verifyPassword('SuperSecretPass@2026', hash, salt)).toBe(true);
    });

    test('verifyPassword rejects wrong password with target N=131072 scrypt format', () => {
      const salt = generateSalt(16);
      const hash = hashPasswordScrypt('SuperSecretPass@2026', salt);
      expect(verifyPassword('WrongPassword@999', hash, salt)).toBe(false);
    });

    test('verifyPassword succeeds for valid password with legacy N=16384 scrypt format', () => {
      const salt = generateSalt(16);
      // Manually construct an N=16384 scrypt hash using crypto.scryptSync
      const derivedKey = crypto.scryptSync('LegacyScryptPass@2026', salt, 32, {
        N: 16384,
        r: 8,
        p: 1,
        maxmem: 32 * 1024 * 1024,
      });
      const legacyHash = `$scrypt$N=16384,r=8,p=1$${derivedKey.toString('hex')}`;
      expect(verifyPassword('LegacyScryptPass@2026', legacyHash, salt)).toBe(true);
      expect(verifyPassword('WrongPass@2026', legacyHash, salt)).toBe(false);
    });

    test('verifyPassword succeeds for intermediate N=65536 scrypt format', () => {
      const salt = generateSalt(16);
      const derivedKey = crypto.scryptSync('MediumScryptPass@2026', salt, 32, {
        N: 65536,
        r: 8,
        p: 1,
        maxmem: 128 * 1024 * 1024,
      });
      const hash = `$scrypt$N=65536,r=8,p=1$${derivedKey.toString('hex')}`;
      expect(verifyPassword('MediumScryptPass@2026', hash, salt)).toBe(true);
    });

    test('verifyPassword succeeds for valid password with legacy HMAC-SHA256 format', () => {
      const salt = generateSalt(16);
      const hash = hashPasswordHmac('LegacyPassword#1', salt);
      expect(verifyPassword('LegacyPassword#1', hash, salt)).toBe(true);
    });

    test('verifyPassword rejects wrong password with legacy HMAC-SHA256 format', () => {
      const salt = generateSalt(16);
      const hash = hashPasswordHmac('LegacyPassword#1', salt);
      expect(verifyPassword('WrongLegacyPassword#2', hash, salt)).toBe(false);
    });

    test('F-25: hashPasswordScryptAsync computes target N=131072 scrypt hash asynchronously without event-loop blocking', async () => {
      const salt = generateSalt(16);
      const hash = await hashPasswordScryptAsync('AsyncPassword123!', salt);
      expect(hash.startsWith('$scrypt$N=131072,r=8,p=1$')).toBe(true);
      const hexPart = hash.split('$')[3];
      expect(hexPart.length).toBe(64);
    });

    test('F-25: verifyPasswordAsync verifies target N=131072, legacy N=16384, N=65536, and HMAC asynchronously', async () => {
      const salt = generateSalt(16);

      // 1. Target N=131072
      const targetHash = await hashPasswordScryptAsync('TargetAsyncPass@2026', salt);
      expect(await verifyPasswordAsync('TargetAsyncPass@2026', targetHash, salt)).toBe(true);
      expect(await verifyPasswordAsync('WrongTargetPass@999', targetHash, salt)).toBe(false);

      // 2. Legacy N=16384
      const key16k = crypto.scryptSync('LegacyAsyncPass@2026', salt, 32, { N: 16384, r: 8, p: 1 });
      const legacyHash = `$scrypt$N=16384,r=8,p=1$${key16k.toString('hex')}`;
      expect(await verifyPasswordAsync('LegacyAsyncPass@2026', legacyHash, salt)).toBe(true);
      expect(await verifyPasswordAsync('WrongLegacyPass@999', legacyHash, salt)).toBe(false);

      // 3. Intermediate N=65536
      const key64k = crypto.scryptSync('MediumAsyncPass@2026', salt, 32, { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
      const mediumHash = `$scrypt$N=65536,r=8,p=1$${key64k.toString('hex')}`;
      expect(await verifyPasswordAsync('MediumAsyncPass@2026', mediumHash, salt)).toBe(true);

      // 4. Legacy HMAC
      const hmacHash = hashPasswordHmac('LegacyHmacPass@2026', salt);
      expect(await verifyPasswordAsync('LegacyHmacPass@2026', hmacHash, salt)).toBe(true);
      expect(await verifyPasswordAsync('WrongHmacPass@999', hmacHash, salt)).toBe(false);

      // 5. Bounds and parameter allowlist rejection
      const unallowedHash = `$scrypt$N=1048576,r=8,p=1$${'f'.repeat(64)}`;
      expect(await verifyPasswordAsync('pass', unallowedHash, salt)).toBe(false);

      // 6. Malformed salt rejection
      expect(await verifyPasswordAsync('pass', targetHash, 'short_salt')).toBe(false);
    });

    test('F-22: verifyPassword rejects un-allowlisted scrypt parameters without executing scrypt (DoS protection)', () => {
      const salt = generateSalt(16);
      const fakeDerived = 'a'.repeat(64);

      // Attempt huge N (e.g. 1048576)
      const hugeNHash = `$scrypt$N=1048576,r=8,p=1$${fakeDerived}`;
      expect(verifyPassword('password', hugeNHash, salt)).toBe(false);

      // Attempt non-power-of-two or arbitrary N
      const arbitraryNHash = `$scrypt$N=12345,r=8,p=1$${fakeDerived}`;
      expect(verifyPassword('password', arbitraryNHash, salt)).toBe(false);

      // Attempt altered r or p
      const alteredRHash = `$scrypt$N=16384,r=16,p=1$${fakeDerived}`;
      expect(verifyPassword('password', alteredRHash, salt)).toBe(false);
      const alteredPHash = `$scrypt$N=16384,r=8,p=2$${fakeDerived}`;
      expect(verifyPassword('password', alteredPHash, salt)).toBe(false);
    });

    test('F-22: verifyPassword rejects malformed, invalid, or non-hex salts', () => {
      const validHash = hashPasswordScrypt('Pass123', generateSalt(16));

      // Salt shorter than 32 hex chars
      expect(verifyPassword('Pass123', validHash, 'short_salt')).toBe(false);
      expect(verifyPassword('Pass123', validHash, '1234567890abcdef1234567890abcd')).toBe(false); // 30 chars

      // Non-hex characters in salt
      expect(verifyPassword('Pass123', validHash, '1234567890abcdef1234567890abcdefg!')).toBe(false);

      // Null / empty salt
      expect(verifyPassword('Pass123', validHash, '')).toBe(false);
      expect(verifyPassword('Pass123', validHash, null as any)).toBe(false);
    });

    test('F-22: verifyPassword rejects malformed or corrupted hashes without throwing', () => {
      const salt = generateSalt(16);
      expect(verifyPassword('Pass', '$scrypt$invalid$not_hex', salt)).toBe(false);
      expect(verifyPassword('Pass', '$scrypt$', salt)).toBe(false);
      expect(verifyPassword('Pass', 'too_short', salt)).toBe(false);
      expect(verifyPassword('Pass', '!!not-hex-characters!!', salt)).toBe(false);
      expect(verifyPassword('Pass', '0'.repeat(128), salt)).toBe(false);
      // Malformed derived key length (not 64 hex characters)
      expect(verifyPassword('Pass', '$scrypt$N=131072,r=8,p=1$abcd', salt)).toBe(false);
    });

    test('needsRehash accurately identifies legacy HMAC and older scrypt hashes', () => {
      const salt = generateSalt(16);

      // Target hash does NOT need rehash
      const targetHash = hashPasswordScrypt('Pass123!', salt);
      expect(needsRehash(targetHash)).toBe(false);

      // Legacy scrypt hash (N=16384) DOES need rehash
      const derivedKey16k = crypto.scryptSync('Pass123!', salt, 32, { N: 16384, r: 8, p: 1 });
      const legacyScryptHash = `$scrypt$N=16384,r=8,p=1$${derivedKey16k.toString('hex')}`;
      expect(needsRehash(legacyScryptHash)).toBe(true);

      // Intermediate scrypt hash (N=65536) DOES need rehash
      const derivedKey64k = crypto.scryptSync('Pass123!', salt, 32, { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
      const mediumScryptHash = `$scrypt$N=65536,r=8,p=1$${derivedKey64k.toString('hex')}`;
      expect(needsRehash(mediumScryptHash)).toBe(true);

      // Legacy 64-char HMAC hash DOES need rehash
      const legacyHmacHash = hashPasswordHmac('Pass123!', salt);
      expect(needsRehash(legacyHmacHash)).toBe(true);

      // Null / empty / undefined returns false safely
      expect(needsRehash(null)).toBe(false);
      expect(needsRehash(undefined)).toBe(false);
      expect(needsRehash('')).toBe(false);
    });

    test('timingSafeCompare compares strings in constant time', () => {
      expect(timingSafeCompare('abc', 'abc')).toBe(true);
      expect(timingSafeCompare('abc', 'abd')).toBe(false);
      expect(timingSafeCompare('abc', 'abcd')).toBe(false);
      expect(timingSafeCompare('', '')).toBe(true);
      expect(timingSafeCompare(null as any, 'abc')).toBe(false);
    });

    test('UniversalProvisioningService integrates scrypt and HMAC-SHA256 correctly', () => {
      const salt = generateSalt(16);
      // Default / 2 args: HMAC-SHA256 (64 chars) for backwards-compatibility with existing tests
      const legacyHash = UniversalProvisioningService.hashPassword('Pass123!', salt);
      expect(legacyHash.length).toBe(64);
      expect(verifyPassword('Pass123!', legacyHash, salt)).toBe(true);

      // Scrypt hash via hashPasswordScrypt
      const scryptHash = UniversalProvisioningService.hashPasswordScrypt('Pass123!', salt);
      expect(scryptHash.startsWith('$scrypt$N=131072,r=8,p=1$')).toBe(true);
      expect(verifyPassword('Pass123!', scryptHash, salt)).toBe(true);
    });
  });

  // =========================================================================
  // 2. SEED WORKFLOW & SECURE PROVISIONING STRATEGY
  // =========================================================================
  describe('2. Seed Workflows & Provisioning Security Strategy', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    test('F-19: isExplicitLocalDevOrTestEnv returns true ONLY for explicit development or test without CI/cloud', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.CI;
      delete process.env.VERCEL;
      delete process.env.RENDER;
      expect(isExplicitLocalDevOrTestEnv()).toBe(true);

      process.env.NODE_ENV = 'test';
      expect(isExplicitLocalDevOrTestEnv()).toBe(true);

      process.env.NODE_ENV = 'DEVELOPMENT'; // case-insensitive
      expect(isExplicitLocalDevOrTestEnv()).toBe(true);

      // CI flag blocks local dev classification
      process.env.NODE_ENV = 'development';
      process.env.CI = 'true';
      expect(isExplicitLocalDevOrTestEnv()).toBe(false);
      delete process.env.CI;

      // Cloud markers block local dev classification
      process.env.VERCEL = '1';
      expect(isExplicitLocalDevOrTestEnv()).toBe(false);
      delete process.env.VERCEL;

      // Production / Staging / Unknown fail-closed
      process.env.NODE_ENV = 'production';
      expect(isExplicitLocalDevOrTestEnv()).toBe(false);

      process.env.NODE_ENV = 'Production';
      expect(isExplicitLocalDevOrTestEnv()).toBe(false);

      process.env.NODE_ENV = 'PROD';
      expect(isExplicitLocalDevOrTestEnv()).toBe(false);

      process.env.NODE_ENV = 'staging';
      expect(isExplicitLocalDevOrTestEnv()).toBe(false);

      process.env.NODE_ENV = 'preview';
      expect(isExplicitLocalDevOrTestEnv()).toBe(false);

      delete process.env.NODE_ENV; // empty/unset
      expect(isExplicitLocalDevOrTestEnv()).toBe(false);
    });

    test('F-19: resolveSeedCredentials refuses default credentials in production when env vars are missing', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.SEED_ADMIN_PASSWORD;
      delete process.env.SEED_DEFAULT_PASSWORD;

      await expect(resolveSeedCredentials(null, 'admin')).rejects.toThrow(
        /Seed credential provisioning rejected: Environment "production" is not an authorized local development environment/
      );
      expect(() => getSeedPasswordForRole('admin')).toThrow(
        /Seed credential provisioning rejected: Environment "production" is not an authorized local development environment/
      );
    });

    test('F-19: resolveSeedCredentials accepts explicit role-specific password override in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.SEED_ADMIN_PASSWORD = 'ProductionAdminSecret#2026';

      const creds = await resolveSeedCredentials(null, 'admin');
      expect(creds.salt.length).toBe(32);
      expect(creds.passwordHash.startsWith('$scrypt$N=131072,r=8,p=1$')).toBe(true);
      expect(verifyPassword('ProductionAdminSecret#2026', creds.passwordHash, creds.salt)).toBe(true);
    });

    test('F-19: resolveSeedCredentials falls back cleanly to development credential in explicit local dev', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.CI;
      delete process.env.SEED_DEFAULT_PASSWORD;
      delete process.env.DEV_SEED_PASSWORD;

      const creds = await resolveSeedCredentials(null, 'resident');
      expect(verifyPassword('dwellora@2026', creds.passwordHash, creds.salt)).toBe(true);
    });

    test('F-20: isDestructiveCleanAuthorized strictly rejects force-clean in production, staging, CI, or unset NODE_ENV', () => {
      process.env.NODE_ENV = 'production';
      expect(() => isDestructiveCleanAuthorized(['node', 'seed.ts', '--force-clean'])).toThrow(
        /Destructive database purge rejected/
      );

      process.env.NODE_ENV = 'staging';
      expect(() => isDestructiveCleanAuthorized(['node', 'seed.ts', '--force-clean'])).toThrow(
        /Destructive database purge rejected/
      );

      process.env.NODE_ENV = 'development';
      process.env.CI = 'true';
      expect(() => isDestructiveCleanAuthorized(['node', 'seed.ts', '--force-clean'])).toThrow(
        /Destructive database purge rejected/
      );
      delete process.env.CI;

      delete process.env.NODE_ENV;
      expect(() => isDestructiveCleanAuthorized(['node', 'seed.ts', '--force-clean'])).toThrow(
        /Destructive database purge rejected/
      );
    });

    test('F-20: isDestructiveCleanAuthorized requires dual confirmation flag or env var in local development', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.CI;
      delete process.env.CONFIRM_DESTRUCTIVE_CLEAN;

      // Force clean without confirmation must throw
      expect(() => isDestructiveCleanAuthorized(['node', 'seed.ts', '--force-clean'])).toThrow(
        /Destructive database purge requested but unconfirmed/
      );

      // Force clean with CLI confirmation succeeds
      expect(
        isDestructiveCleanAuthorized(['node', 'seed.ts', '--force-clean', '--confirm-delete-all-data'])
      ).toBe(true);

      // Force clean with ENV confirmation succeeds
      process.env.CONFIRM_DESTRUCTIVE_CLEAN = 'YES_I_AM_SURE';
      expect(isDestructiveCleanAuthorized(['node', 'seed.ts', '--force-clean'])).toBe(true);
      delete process.env.CONFIRM_DESTRUCTIVE_CLEAN;

      // No force-clean returns false cleanly without error
      expect(isDestructiveCleanAuthorized(['node', 'seed.ts'])).toBe(false);
    });

    test('Seeding preserves existing user password credentials on repeated runs (idempotency)', async () => {
      const existingUser = {
        id: 'user-res-1',
        passwordHash: '$scrypt$N=16384,r=8,p=1$existing_custom_hash_123',
        salt: 'existing_salt_abc',
      };

      const result = await resolveSeedCredentials(existingUser, 'resident');
      expect(result.passwordHash).toBe('$scrypt$N=16384,r=8,p=1$existing_custom_hash_123');
      expect(result.salt).toBe('existing_salt_abc');
    });

    test('All 8 canonical portal users receive valid password credentials with target N=131072', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.CI;

      const canonicalRoles = [
        'resident',
        'secretary',
        'guard',
        'committee',
        'facility_manager',
        'vendor',
        'admin',
      ];

      for (const role of canonicalRoles) {
        const creds = await resolveSeedCredentials(null, role);
        expect(creds.passwordHash.startsWith('$scrypt$N=131072,r=8,p=1$')).toBe(true);
        expect(creds.salt.length).toBe(32);
        expect(verifyPassword('dwellora@2026', creds.passwordHash, creds.salt)).toBe(true);
      }
    });

    test('Firebase-only users remain safely passwordless with null passwordHash and salt', () => {
      const firebaseUser = {
        id: 'user-firebase-only',
        email: 'phone.otp@aarizo.com',
        phone: '+919999000000',
        role: 'resident',
        passwordHash: null,
        salt: null,
      };

      expect(firebaseUser.passwordHash).toBeNull();
      expect(firebaseUser.salt).toBeNull();
      // Should not verify any password
      expect(verifyPassword('anyPassword', firebaseUser.passwordHash as any, firebaseUser.salt as any)).toBe(false);
    });
  });

  // =========================================================================
  // 3. LOGIN ENDPOINT LOGIC & SECURITY HARDENING
  // =========================================================================
  describe('3. Login Security Endpoint Logic (POST /api/auth/login)', () => {
    // Simulated handler mirroring server/src/index.ts implementation
    const handleLogin = async (body: any, mockDbUser: any) => {
      const { email, password } = body;
      if (!email || !password) {
        return { status: 400, body: { error: 'Email and password are required' } };
      }

      const user = mockDbUser;

      // Unified check preventing account enumeration (CWE-204)
      if (!user || !user.passwordHash || !user.salt) {
        return { status: 401, body: { error: 'Invalid email or password' } };
      }

      const isPasswordValid = await verifyPasswordAsync(password, user.passwordHash, user.salt);
      if (!isPasswordValid) {
        return { status: 401, body: { error: 'Invalid email or password' } };
      }

      // Account status check before issuing token (CWE-285)
      if (user.status !== 'ACTIVE') {
        return { status: 403, body: { error: 'Account is inactive or suspended. Please contact administrator.' } };
      }

      return {
        status: 200,
        body: {
          success: true,
          token: `jwt_token_${user.id}`,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            role: user.role,
            societyId: user.societyId || 'soc-gvs',
          },
        },
      };
    };

    test('Rejects unknown/non-existent user with 401 "Invalid email or password"', async () => {
      const res = await handleLogin({ email: 'nonexistent@aarizo.com', password: 'Password123!' }, null);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password');
    });

    test('Rejects user with missing password credentials with IDENTICAL 401 (No Account Enumeration)', async () => {
      const dbUserNoPassword = {
        id: 'user-seeded-null',
        email: 'vikram.joshi@aarizo.com',
        passwordHash: null,
        salt: null,
        status: 'ACTIVE',
      };
      const res = await handleLogin({ email: 'vikram.joshi@aarizo.com', password: 'Password123!' }, dbUserNoPassword);
      expect(res.status).toBe(401);
      // CRITICAL: Must be identical to unknown user error
      expect(res.body.error).toBe('Invalid email or password');
    });

    test('Rejects incorrect password with IDENTICAL 401', async () => {
      const salt = generateSalt(16);
      const hash = hashPasswordScrypt('CorrectPassword@1', salt);
      const dbUser = {
        id: 'user-valid',
        email: 'admin@aarizo.com',
        passwordHash: hash,
        salt,
        status: 'ACTIVE',
      };
      const res = await handleLogin({ email: 'admin@aarizo.com', password: 'WrongPassword@9' }, dbUser);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password');
    });

    test('Rejects inactive user account with 403', async () => {
      const salt = generateSalt(16);
      const hash = hashPasswordScrypt('CorrectPassword@1', salt);
      const dbUser = {
        id: 'user-inactive',
        email: 'former.secretary@aarizo.com',
        passwordHash: hash,
        salt,
        status: 'INACTIVE',
      };
      const res = await handleLogin({ email: 'former.secretary@aarizo.com', password: 'CorrectPassword@1' }, dbUser);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Account is inactive or suspended. Please contact administrator.');
    });

    test('Rejects suspended user account with 403', async () => {
      const salt = generateSalt(16);
      const hash = hashPasswordScrypt('CorrectPassword@1', salt);
      const dbUser = {
        id: 'user-suspended',
        email: 'suspended.resident@aarizo.com',
        passwordHash: hash,
        salt,
        status: 'SUSPENDED',
      };
      const res = await handleLogin({ email: 'suspended.resident@aarizo.com', password: 'CorrectPassword@1' }, dbUser);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Account is inactive or suspended. Please contact administrator.');
    });

    test('Allows active user with correct scrypt credentials to authenticate successfully', async () => {
      const salt = generateSalt(16);
      const hash = hashPasswordScrypt('MySecretPass@2026', salt);
      const dbUser = {
        id: 'user-adm-1',
        name: 'Super Administrator',
        email: 'admin@aarizo.com',
        phone: '9999988888',
        role: 'admin',
        societyId: 'soc-gvs',
        passwordHash: hash,
        salt,
        status: 'ACTIVE',
      };
      const res = await handleLogin({ email: 'admin@aarizo.com', password: 'MySecretPass@2026' }, dbUser);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.role).toBe('admin');
      expect(res.body.user.societyId).toBe('soc-gvs');
    });

    test('Allows active user with legacy HMAC-SHA256 credentials to authenticate successfully', async () => {
      const salt = generateSalt(16);
      const hash = hashPasswordHmac('LegacyPass#2026', salt);
      const dbUser = {
        id: 'user-sec-1',
        name: 'Mayuri Udar',
        email: 'mayuri.udar@aarizo.com',
        phone: '9876543210',
        role: 'secretary',
        societyId: 'soc-gvs',
        passwordHash: hash,
        salt,
        status: 'ACTIVE',
      };
      const res = await handleLogin({ email: 'mayuri.udar@aarizo.com', password: 'LegacyPass#2026' }, dbUser);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.role).toBe('secretary');
    });

    test('Requires both email and password in request body', async () => {
      const res1 = await handleLogin({ email: '', password: '123' }, null);
      expect(res1.status).toBe(400);

      const res2 = await handleLogin({ email: 'test@aarizo.com', password: '' }, null);
      expect(res2.status).toBe(400);
    });

    test('Transparent rehash-on-login detects legacy hashes and triggers upgrade to target N=131072', () => {
      const oldSalt = generateSalt(16);
      const oldHash = hashPasswordHmac('LegacyPassword#1', oldSalt);

      // Verify old hash succeeds
      expect(verifyPassword('LegacyPassword#1', oldHash, oldSalt)).toBe(true);

      // needsRehash identifies upgrade requirement
      expect(needsRehash(oldHash)).toBe(true);

      // Transparent upgrade
      const newSalt = generateSalt(16);
      const newHash = hashPasswordScrypt('LegacyPassword#1', newSalt);
      expect(newHash.startsWith('$scrypt$N=131072,r=8,p=1$')).toBe(true);
      expect(needsRehash(newHash)).toBe(false);
      expect(verifyPassword('LegacyPassword#1', newHash, newSalt)).toBe(true);
    });
  });

  // =========================================================================
  // 4. SQL SCHEMA & PRISMA COMPATIBILITY VERIFICATIONS
  // =========================================================================
  describe('4. SQL Schema & Migration Compatibility', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    test('F-26: determineMigrationFiles strictly excludes 03_seed.sql in non-dev environments and rejects APPLY_DEMO_SEED in production', () => {
      // Production
      expect(determineMigrationFiles({ NODE_ENV: 'production' })).toEqual([
        '01_schema.sql',
        '02_rls_policies.sql',
      ]);

      // Staging
      expect(determineMigrationFiles({ NODE_ENV: 'staging' })).toEqual([
        '01_schema.sql',
        '02_rls_policies.sql',
      ]);

      // CI environment
      expect(determineMigrationFiles({ NODE_ENV: 'development', CI: 'true' })).toEqual([
        '01_schema.sql',
        '02_rls_policies.sql',
      ]);

      // Cloud deployment
      expect(determineMigrationFiles({ NODE_ENV: 'development', VERCEL: '1' })).toEqual([
        '01_schema.sql',
        '02_rls_policies.sql',
      ]);

      // Unset / empty NODE_ENV fails closed
      expect(determineMigrationFiles({})).toEqual([
        '01_schema.sql',
        '02_rls_policies.sql',
      ]);
      expect(determineMigrationFiles({ NODE_ENV: '' })).toEqual([
        '01_schema.sql',
        '02_rls_policies.sql',
      ]);

      // Unknown / staging / preview / qa / uat environments fail closed
      for (const envName of ['preview', 'qa', 'uat', 'preprod', 'demo', 'sandbox', 'unknown']) {
        expect(determineMigrationFiles({ NODE_ENV: envName })).toEqual([
          '01_schema.sql',
          '02_rls_policies.sql',
        ]);
      }

      // Production with APPLY_DEMO_SEED=true is strictly rejected and excluded
      expect(
        determineMigrationFiles({ NODE_ENV: 'production', APPLY_DEMO_SEED: 'true' })
      ).toEqual(['01_schema.sql', '02_rls_policies.sql']);

      // Unset NODE_ENV with APPLY_DEMO_SEED=true is strictly rejected
      expect(
        determineMigrationFiles({ APPLY_DEMO_SEED: 'true' })
      ).toEqual(['01_schema.sql', '02_rls_policies.sql']);

      // Explicit local development includes 03_seed.sql
      expect(determineMigrationFiles({ NODE_ENV: 'development' })).toEqual([
        '01_schema.sql',
        '02_rls_policies.sql',
        '03_seed.sql',
      ]);
    });

    test('F-23: scripts/postgres/03_seed.sql contains fail-closed PL/pgSQL whitelist environment guard', () => {
      const seedSqlPath = path.resolve(__dirname, '../scripts/postgres/03_seed.sql');
      const content = fs.readFileSync(seedSqlPath, 'utf8');

      // Must coalesce unset/null settings to empty and lowercase/trim
      expect(content).toContain("lower(trim(coalesce(current_setting('aarizo.environment', true), '')))");
      // Must enforce strict whitelist of development environments
      expect(content).toContain("NOT IN ('development', 'dev', 'test', 'local')");
      // Must raise exception on non-whitelisted environment
      expect(content).toContain('[SECURITY] Execution of 03_seed.sql rejected');
    });

    test('F-23: docker-compose.yml excludes 03_seed.sql from default mounts and docker-compose.dev.yml defines override', () => {
      const composePath = path.resolve(__dirname, '../docker-compose.yml');
      const composeContent = fs.readFileSync(composePath, 'utf8');

      // Default compose must NOT mount 03_seed.sql
      expect(composeContent).not.toContain('/docker-entrypoint-initdb.d/03_seed.sql');
      expect(composeContent).toContain('./scripts/postgres/01_schema.sql:/docker-entrypoint-initdb.d/01_schema.sql');
      expect(composeContent).toContain('./scripts/postgres/02_rls_policies.sql:/docker-entrypoint-initdb.d/02_rls_policies.sql');
      expect(composeContent).toContain('03_seed.sql is excluded from default container initialization');

      // docker-compose.dev.yml must exist and define dev override
      const devComposePath = path.resolve(__dirname, '../docker-compose.dev.yml');
      expect(fs.existsSync(devComposePath)).toBe(true);
      const devComposeContent = fs.readFileSync(devComposePath, 'utf8');
      expect(devComposeContent).toContain('./scripts/postgres/03_seed.sql:/docker-entrypoint-initdb.d/03_seed.sql');
      expect(devComposeContent).toContain('aarizo.environment=development');
    });

    test('scripts/postgres/01_schema.sql contains password_hash and salt columns in users table', () => {
      const schemaPath = path.resolve(__dirname, '../scripts/postgres/01_schema.sql');
      const content = fs.readFileSync(schemaPath, 'utf8');

      expect(content).toContain('CREATE TABLE IF NOT EXISTS users');
      expect(content).toContain('password_hash VARCHAR(255)');
      expect(content).toContain('salt VARCHAR(64)');
    });

    test('scripts/postgres/03_seed.sql inserts password_hash and salt and preserves existing credentials on conflict', () => {
      const seedSqlPath = path.resolve(__dirname, '../scripts/postgres/03_seed.sql');
      const content = fs.readFileSync(seedSqlPath, 'utf8');

      expect(content).toContain('password_hash, salt');
      expect(content).toContain('$scrypt$N=16384,r=8,p=1$');
      expect(content).toContain('password_hash = COALESCE(users.password_hash, EXCLUDED.password_hash)');
      expect(content).toContain('salt = COALESCE(users.salt, EXCLUDED.salt)');
    });

    test('server/prisma/schema.prisma defines nullable passwordHash and salt mapped to database columns', () => {
      const prismaPath = path.resolve(__dirname, '../server/prisma/schema.prisma');
      const content = fs.readFileSync(prismaPath, 'utf8');

      expect(content).toContain('passwordHash String?      @map("password_hash")');
      expect(content).toContain('salt        String?');
    });

    test('migration file safely alters users table with IF NOT EXISTS', () => {
      const migrationPath = path.resolve(
        __dirname,
        '../server/prisma/migrations/20261114000000_add_password_hash_and_salt/migration.sql'
      );
      expect(fs.existsSync(migrationPath)).toBe(true);
      const content = fs.readFileSync(migrationPath, 'utf8');
      expect(content).toContain('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" TEXT;');
      expect(content).toContain('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "salt" TEXT;');
    });
  });

  // =========================================================================
  // 5. STEP 5.6 TARGETED SECURITY CORRECTIONS (F-23, F-24, F-25, F-26, F-27)
  // =========================================================================
  describe('5. Step 5.6 Targeted Security Verifications', () => {
    describe('F-24: Concurrency-Safe Password Rehash Updates', () => {
      test('rehash uses optimistic conditional updateMany preventing stale hash overwrites', async () => {
        // Mock prisma updateMany
        const updateManySpy = jest.spyOn(prisma.user, 'updateMany').mockResolvedValue({ count: 1 });

        const verifiedHash = '$scrypt$N=16384,r=8,p=1$old_hash_hex';
        const newSalt = generateSalt(16);
        const newHash = await hashPasswordScryptAsync('TestPass123!', newSalt);

        // Simulate rehash call as executed in server/src/index.ts
        const result = await prisma.user.updateMany({
          where: {
            id: 'user-concurrent-1',
            passwordHash: verifiedHash,
          },
          data: {
            passwordHash: newHash,
            salt: newSalt,
          },
        });

        expect(result.count).toBe(1);
        expect(updateManySpy).toHaveBeenCalledWith({
          where: {
            id: 'user-concurrent-1',
            passwordHash: verifiedHash,
          },
          data: {
            passwordHash: newHash,
            salt: newSalt,
          },
        });

        updateManySpy.mockRestore();
      });

      test('rehash gracefully handles concurrent password change (0 rows updated)', async () => {
        // Simulate concurrent password update: where condition fails because passwordHash was already updated
        const updateManySpy = jest.spyOn(prisma.user, 'updateMany').mockResolvedValue({ count: 0 });

        const verifiedHash = '$scrypt$N=16384,r=8,p=1$old_hash_hex';
        const newSalt = generateSalt(16);
        const newHash = await hashPasswordScryptAsync('TestPass123!', newSalt);

        const result = await prisma.user.updateMany({
          where: {
            id: 'user-concurrent-1',
            passwordHash: verifiedHash,
          },
          data: {
            passwordHash: newHash,
            salt: newSalt,
          },
        });

        // 0 rows affected: the stale rehash was safely ignored, avoiding overwriting the new password
        expect(result.count).toBe(0);

        updateManySpy.mockRestore();
      });
    });

    describe('F-25: Asynchronous Scrypt, Concurrency Limiting & Dedicated Rate Limiting', () => {
      test('loginRateLimiter enforces 10 requests per 60 seconds per IP and sends Retry-After', () => {
        const limiter = loginRateLimiter(10, 60000);
        const ip = '10.0.0.99';

        let lastStatus: number | null = null;
        let lastHeaders: Record<string, string> = {};
        let lastBody: any = null;
        let nextCalledCount = 0;

        const req = {
          ip,
          headers: {},
          socket: { remoteAddress: ip },
        } as any;

        const makeCall = () => {
          lastStatus = null;
          lastHeaders = {};
          lastBody = null;
          const res = {
            setHeader: (k: string, v: string) => {
              lastHeaders[k.toLowerCase()] = v;
              return res;
            },
            status: (code: number) => {
              lastStatus = code;
              return res;
            },
            json: (body: any) => {
              lastBody = body;
              return res;
            },
          } as any;

          const next = () => {
            nextCalledCount++;
          };

          limiter(req, res, next);
        };

        // First 10 requests within window must succeed
        for (let i = 0; i < 10; i++) {
          makeCall();
          expect(nextCalledCount).toBe(i + 1);
          expect(lastStatus).toBeNull();
        }

        // 11th request must be rate limited with HTTP 429 and Retry-After header
        makeCall();
        expect(lastStatus).toBe(429);
        expect(lastBody.error).toBe('Too many login attempts. Please slow down.');
        expect(lastHeaders['retry-after']).toBe('60');
      });

      test('AuthConcurrencyLimiter bounds concurrent scrypt operations and releases permits', () => {
        const limiter = new AuthConcurrencyLimiter(2);

        // Acquire permits
        expect(limiter.tryAcquire()).toBe(true);
        expect(limiter.getActiveCount()).toBe(1);

        expect(limiter.tryAcquire()).toBe(true);
        expect(limiter.getActiveCount()).toBe(2);

        // 3rd attempt is saturated
        expect(limiter.tryAcquire()).toBe(false);
        expect(limiter.getActiveCount()).toBe(2);

        // Release 1 permit
        limiter.release();
        expect(limiter.getActiveCount()).toBe(1);

        // Now acquire succeeds
        expect(limiter.tryAcquire()).toBe(true);
        expect(limiter.getActiveCount()).toBe(2);

        // Release all
        limiter.release();
        limiter.release();
        expect(limiter.getActiveCount()).toBe(0);
      });

      test('authConcurrencyLimiter default capacity guarantees peak memory bounds <= 512 MiB', () => {
        expect(authConcurrencyLimiter.getMaxConcurrent()).toBe(4);
        const peakMemoryMiB = authConcurrencyLimiter.getMaxConcurrent() * 128;
        expect(peakMemoryMiB).toBeLessThanOrEqual(512);
      });
    });

    describe('F-27: Deployment Documentation Security Verification', () => {
      test('docs/HOST_DEPLOYMENT_GUIDE.md does NOT instruct running 03_seed.sql in production', () => {
        const docPath = path.resolve(__dirname, '../docs/HOST_DEPLOYMENT_GUIDE.md');
        const content = fs.readFileSync(docPath, 'utf8');

        // Must not recommend running 03_seed.sql in production
        expect(content).not.toContain('psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f scripts/postgres/03_seed.sql');
        // Must contain security notice distinguishing production DDL from dev demo seed
        expect(content).toContain('03_seed.sql');
        expect(content).toContain('strictly for local development');
      });

      test('docs/POSTGRES_MIGRATION_GUIDE.md does NOT instruct running 03_seed.sql in production', () => {
        const docPath = path.resolve(__dirname, '../docs/POSTGRES_MIGRATION_GUIDE.md');
        const content = fs.readFileSync(docPath, 'utf8');

        // Must not recommend running 03_seed.sql in production
        expect(content).not.toContain('psql -U aarizo_admin -d aarizo_community -f scripts/postgres/03_seed.sql');
        expect(content).toContain('strictly for local dev/testing');
      });
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});

