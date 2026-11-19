import {
  validateAuthConfiguration,
  getAuthSecret,
  generateAuthToken,
  verifyServerToken,
  resetDevEphemeralSecret,
} from '../server/src/auth';

describe('GAP-01: Authentication Secret Hardening & Validation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetDevEphemeralSecret();
    delete process.env.AUTH_SECRET;
    delete process.env.JWT_SECRET;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // 1. Missing production secret
  test('1. Production environment throws fatal error if AUTH_SECRET is missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.AUTH_SECRET;
    delete process.env.JWT_SECRET;

    expect(() => validateAuthConfiguration()).toThrow(
      /FATAL: Production authentication secret is missing/
    );
    expect(() => getAuthSecret()).toThrow(
      /FATAL: Production authentication secret is missing/
    );
  });

  // 2. Weak production secret (< 32 chars)
  test('2. Production environment throws fatal error if secret is fewer than 32 characters', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_SECRET = 'short_secret_only_24_bytes!'; // 27 chars

    expect(() => validateAuthConfiguration()).toThrow(
      /FATAL: Production authentication secret is insufficiently strong/
    );
    expect(() => getAuthSecret()).toThrow(
      /FATAL: Production authentication secret is insufficiently strong/
    );
  });

  // 3. Valid production secret (>= 32 chars)
  test('3. Production environment succeeds when strong secret (>= 32 chars) is provided', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_SECRET = 'c98df71a3e8b456291a27e408f6259cb712e34f890123456789abcdef0123456';

    expect(() => validateAuthConfiguration()).not.toThrow();
    expect(getAuthSecret()).toBe(process.env.AUTH_SECRET);
  });

  // 4. JWT_SECRET alias validation in production
  test('4. JWT_SECRET alias is accepted if strong in production, but fails if weak', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.AUTH_SECRET;
    process.env.JWT_SECRET = 'weak_jwt_secret';

    expect(() => validateAuthConfiguration()).toThrow(
      /FATAL: Production authentication secret is insufficiently strong/
    );

    process.env.JWT_SECRET = 'strong_jwt_secret_with_more_than_32_characters_for_production';
    expect(() => validateAuthConfiguration()).not.toThrow();
    expect(getAuthSecret()).toBe(process.env.JWT_SECRET);
  });

  // 5. Development configuration with configured secret
  test('5. Development environment uses configured secret if provided', () => {
    process.env.NODE_ENV = 'development';
    process.env.AUTH_SECRET = 'dev_custom_secret_key_testing_12345';

    expect(() => validateAuthConfiguration()).not.toThrow();
    expect(getAuthSecret()).toBe('dev_custom_secret_key_testing_12345');
  });

  // 6. Development configuration without secret generates safe ephemeral random secret
  test('6. Development environment generates ephemeral in-memory random secret when unconfigured', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.AUTH_SECRET;
    delete process.env.JWT_SECRET;

    expect(() => validateAuthConfiguration()).not.toThrow();
    const secret1 = getAuthSecret();
    expect(secret1).toBeDefined();
    expect(secret1.length).toBe(64); // 32 bytes hex encoded

    // Verify persistence within same process lifecycle
    const secret2 = getAuthSecret();
    expect(secret1).toBe(secret2);

    // Verify it is not the old hardcoded string
    expect(secret1).not.toBe('aarizo_secure_production_secret_key_2026');
  });

  // 7. Token generation and verification with configured secret
  test('7. Tokens generated with configured secret are successfully verified', () => {
    process.env.NODE_ENV = 'development';
    process.env.AUTH_SECRET = 'sample_secure_signing_secret_for_jwt_tokens_2026';

    const token = generateAuthToken({
      sub: 'usr-123',
      role: 'resident',
      societyId: 'soc-gvs',
      name: 'Test Resident',
    });

    const payload = verifyServerToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe('usr-123');
    expect(payload?.role).toBe('resident');
  });

  // 8. No fallback to a hardcoded value when secret changes
  test('8. Token signed with old secret fails verification when secret changes (no hardcoded fallback)', () => {
    process.env.NODE_ENV = 'development';
    process.env.AUTH_SECRET = 'original_secret_key_with_sufficient_entropy_for_tests';

    const token = generateAuthToken({
      sub: 'usr-456',
      role: 'secretary',
      societyId: 'soc-gvs',
      name: 'Secretary User',
    });

    // Change secret
    process.env.AUTH_SECRET = 'rotated_different_secret_key_for_testing_purposes_only';

    const payload = verifyServerToken(token);
    expect(payload).toBeNull(); // Fails verification immediately; does not fall back to any hardcoded secret
  });

  // 9. Error message does not leak secret material
  test('9. Error messages never print the actual secret value', () => {
    process.env.NODE_ENV = 'production';
    const sensitiveSecret = 'SUPER_SECRET_LEAK_TARGET_12345';
    process.env.AUTH_SECRET = sensitiveSecret;

    try {
      validateAuthConfiguration();
    } catch (err: any) {
      expect(err.message).not.toContain(sensitiveSecret);
    }
  });
});

