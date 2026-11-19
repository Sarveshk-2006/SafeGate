# AARIZO — Phase A, Step 5.4: ISSUE-05 Independent Security Verification

**Date:** November 14, 2026  
**Auditor:** Antigravity Engineering (Independent Security Audit)  
**Target:** ISSUE-05 — Seeded Database Users Missing Password Hashes  
**Audit Scope:** Verification of Step 5.4 Remediation (F-19, F-20, F-21, F-22, Scrypt Target Upgrade, Rehash-on-Login)  
**Final Status:** **CONDITIONALLY VERIFIED & REMEDIATED — READY FOR LIVE DATABASE VALIDATION**

---

## 1. Security Verification Matrix

| Finding ID | Security Domain | Prior Status (Step 5.3) | Step 5.4 Remediation | Verification Result |
| :--- | :--- | :--- | :--- | :--- |
| **F-19** | Environment Detection & Credentials | **FAIL** (Incomplete `NODE_ENV` checks, staging/CI risk) | Implemented `isExplicitLocalDevOrTestEnv()` with normalization, CI rejection, and cloud marker rejection | **PASS** |
| **F-20** | Destructive Clean Operations | **FAIL** (Unchecked `deleteMany` in non-dev environments) | Implemented `isDestructiveCleanAuthorized()` with fail-closed rejection in non-dev and dual confirmation in local dev | **PASS** |
| **F-21** | Demo SQL Credential Isolation | **FAIL** (Demo seed executed in migrations & mounted in compose) | Added PL/pgSQL guard in `03_seed.sql`, migration filtering in `migrate.ts`, and Compose security warnings | **PASS** |
| **F-22** | Scrypt Parameter Validation | **FAIL** (Unchecked parameters from hash string, DoS risk) | Implemented parameter allowlist `ALLOWED_SCRYPT_CONFIG_KEYS`, envelope regex, salt hex validation, and memory bounding | **PASS** |
| **SEC-01** | Scrypt Parameter Strength | **CONCERN** ($N=16384$ below OWASP target recommendations) | Upgraded target to $N=131072, r=8, p=1$, `maxmem: 256MB`, with non-blocking transparent rehash-on-login | **PASS** |

---

## 2. Cryptographic Architecture Audit

### 2.1 OWASP Password Storage Guidelines Compliance
- **Selected Function:** Node.js native `crypto.scryptSync`.
- **Target Parameters:**
  - $N = 131072$ ($2^{17}$)
  - $r = 8$
  - $p = 1$
  - Derived Key Length: 32 bytes (256 bits)
  - Salt Length: 16 bytes (32 hex characters) from `crypto.randomBytes(16)` (CSPRNG)
- **Memory Footprint:** $128 \times r \times N = 128 \times 8 \times 131072 = 134,217,728$ bytes = **128 MiB**.
- **CPU Latency:** ~343 ms per hash (measured on Node 22 x64).
- **OWASP Alignment:** Fully conforms to OWASP Password Storage Cheat Sheet recommendations for memory-hard key derivation functions ($N=2^{17}, r=8, p=1$ when 128 MiB RAM is available).

### 2.2 DoS and Resource Exhaustion Defense (F-22)
Prior to Step 5.4, an attacker capable of modifying database values could set $N=2^{24}$ or $r=1024$, forcing the server into gigabyte memory allocations or multi-minute CPU thread locks.
- **Control Applied:** `ALLOWED_SCRYPT_CONFIG_KEYS` strictly allows only:
  - `'131072:8:1'` (Target default)
  - `'65536:8:1'` (Intermediate option)
  - `'16384:8:1'` (Legacy backwards compatible)
- Any hash envelope specifying an $(N, r, p)$ tuple outside this allowlist is rejected immediately in constant time without executing any cryptographic computation.
- **Envelope Validation:** `SCRYPT_ENVELOPE_REGEX` requires exact numeric capture groups and exactly 64 hex characters for the derived key.
- **Salt Validation:** `HEX_SALT_REGEX` requires $\ge 32$ hex characters, rejecting truncated or non-hex salts before computation.

### 2.3 Transparent Rehash-on-Login (Non-Blocking)
- When users authenticate with valid credentials under older hash schemes ($N=16384$, $N=65536$, or legacy 64-character HMAC-SHA256), `verifyPassword()` validates the credential.
- `needsRehash(storedHash)` detects that the hash does not match the target `$scrypt$N=131072,r=8,p=1$` envelope.
- A fresh 16-byte CSPRNG salt is generated, and a target $N=131072$ hash is computed and persisted asynchronously via `prisma.user.update().catch(...)`.
- The user's login response is issued without waiting for rehash database persistence, ensuring zero latency impact for the client.

---

## 3. Environment & Credential Provisioning Audit

### 3.1 Fail-Closed Environment Detection (F-19)
The function `isExplicitLocalDevOrTestEnv()` in `server/src/seed.ts` operates under a strict default-deny policy:
- Input normalization: `(process.env.NODE_ENV || '').toLowerCase().trim()` prevents casing bypasses (`Production`, `PROD`).
- Rejection conditions:
  - Any value in `['production', 'prod', 'staging', 'preview', 'qa']` returns `false`.
  - Empty or unset `NODE_ENV` returns `false`.
  - `CI === 'true'` or `CI === '1'` returns `false`.
  - Presence of any of `['VERCEL', 'RENDER', 'RAILWAY_ENVIRONMENT', 'FLY_APP_NAME', 'HEROKU_APP_NAME', 'AWS_EXECUTION_ENV']` returns `false`.
- Only explicitly unencumbered `'development'`, `'dev'`, or `'test'` environments return `true`.

### 3.2 Dual Confirmation for Destructive Clean (F-20)
In `isDestructiveCleanAuthorized()`:
- Non-development environments: An immediate exception is thrown if `--force-clean` or `SEED_FORCE_CLEAN` is requested.
- Local development environments: The clean is blocked unless accompanied by either:
  - CLI flag: `--confirm-delete-all-data`, OR
  - Environment variable: `CONFIRM_DESTRUCTIVE_CLEAN=YES_I_AM_SURE`.

### 3.3 Demo SQL Isolation (F-21)
- `scripts/postgres/03_seed.sql` contains a top-level PL/pgSQL block verifying that `current_setting('aarizo.environment', true)` is not production or staging.
- `scripts/postgres/migrate.ts` automatically filters out `03_seed.sql` whenever running in production, staging, CI, or cloud environments, requiring explicit `APPLY_DEMO_SEED=true` to include demo data.
- `docker-compose.yml` explicitly warns against mounting `03_seed.sql` into `/docker-entrypoint-initdb.d/` in production deployments.

---

## 4. Test Verification & Empirical Results

### 4.1 Unit & Integration Test Results
```
PASS tests/issue05_secure_seed_auth.test.ts (15.834 s)
  ISSUE-05: Secure Password Hashing, Seed Credential Provisioning & Auth Hardening
    1. Password Cryptographic Functions
      √ generateSalt produces unique random salts with at least 16 bytes (32 hex chars) (3 ms)
      √ hashPasswordScrypt computes versioned scrypt hash with target config ($scrypt$N=131072,r=8,p=1$...) (347 ms)
      √ hashPasswordHmac computes deterministic 64-char HMAC-SHA256 for backwards compatibility (2 ms)
      √ verifyPassword succeeds for valid password with target N=131072 scrypt format (683 ms)
      √ verifyPassword rejects wrong password with target N=131072 scrypt format (753 ms)
      √ verifyPassword succeeds for valid password with legacy N=16384 scrypt format (126 ms)
      √ verifyPassword succeeds for intermediate N=65536 scrypt format (347 ms)
      √ verifyPassword succeeds for valid password with legacy HMAC-SHA256 format
      √ verifyPassword rejects wrong password with legacy HMAC-SHA256 format (1 ms)
      √ F-22: verifyPassword rejects un-allowlisted scrypt parameters without executing scrypt (DoS protection) (1 ms)
      √ F-22: verifyPassword rejects malformed, invalid, or non-hex salts (347 ms)
      √ F-22: verifyPassword rejects malformed or corrupted hashes without throwing (3 ms)
      √ needsRehash accurately identifies legacy HMAC and older scrypt hashes (560 ms)
      √ timingSafeCompare compares strings in constant time
      √ UniversalProvisioningService integrates scrypt and HMAC-SHA256 correctly (708 ms)
    2. Seed Workflows & Provisioning Security Strategy
      √ F-19: isExplicitLocalDevOrTestEnv returns true ONLY for explicit development or test without CI/cloud (2 ms)
      √ F-19: resolveSeedCredentials refuses default credentials in production when env vars are missing (28 ms)
      √ F-19: resolveSeedCredentials accepts explicit role-specific password override in production (679 ms)
      √ F-19: resolveSeedCredentials falls back cleanly to development credential in explicit local dev (743 ms)
      √ F-20: isDestructiveCleanAuthorized strictly rejects force-clean in production, staging, CI, or unset NODE_ENV (2 ms)
      √ F-20: isDestructiveCleanAuthorized requires dual confirmation flag or env var in local development (1 ms)
      √ Seeding preserves existing user password credentials on repeated runs (idempotency)
      √ All 8 canonical portal users receive valid password credentials with target N=131072 (4961 ms)
      √ Firebase-only users remain safely passwordless with null passwordHash and salt
    3. Login Security Endpoint Logic (POST /api/auth/login)
      √ Rejects unknown/non-existent user with 401 "Invalid email or password"
      √ Rejects user with missing password credentials with IDENTICAL 401 (No Account Enumeration)
      √ Rejects incorrect password with IDENTICAL 401 (696 ms)
      √ Rejects inactive user account with 403 (696 ms)
      √ Rejects suspended user account with 403 (699 ms)
      √ Allows active user with correct scrypt credentials to authenticate successfully (712 ms)
      √ Allows active user with legacy HMAC-SHA256 credentials to authenticate successfully (2 ms)
      √ Requires both email and password in request body (1 ms)
      √ Transparent rehash-on-login detects legacy hashes and triggers upgrade to target N=131072 (712 ms)
    4. SQL Schema & Migration Compatibility
      √ F-21: determineMigrationFiles excludes 03_seed.sql in production, staging, and CI (26 ms)
      √ F-21: scripts/postgres/03_seed.sql contains fail-closed PL/pgSQL environment guard
      √ F-21: docker-compose.yml contains security warning against mounting 03_seed.sql in production (1 ms)
      √ scripts/postgres/01_schema.sql contains password_hash and salt columns in users table (1 ms)
      √ scripts/postgres/03_seed.sql inserts password_hash and salt and preserves existing credentials on conflict
      √ server/prisma/schema.prisma defines nullable passwordHash and salt mapped to database columns (1 ms)
      √ migration file safely alters users table with IF NOT EXISTS

Test Suites: 1 passed, 1 total
Tests:       40 passed, 40 total
```

### 4.2 Full Regression Test Suite Results
```
Test Suites: 15 passed, 15 total
Tests:       233 passed, 233 total
Snapshots:   0 total
Time:        17.781 s
Ran all test suites.
```

---

## 5. Audit Conclusion & Recommendations

1. **ISSUE-05 Security Status:** **REMEDIATED & PASSING**.
   - All cryptographic vulnerabilities (HMAC-SHA256 reliance, un-allowlisted parameters, low memory cost) have been remediated.
   - All credential provisioning vulnerabilities (F-19 environment detection, F-20 destructive operations, F-21 demo SQL isolation) have been remediated.
   - All login vulnerabilities (CWE-204 account enumeration, CWE-285 inactive/suspended accounts) have been remediated.
2. **Database Offline Caveat:**
   - Local PostgreSQL on port 5432 remains offline during testing.
   - All database interactions in the test suite utilize Prisma mocked repositories and static schema validation.
   - ISSUE-05 should be held in `CONDITIONALLY VERIFIED / REMEDIATED — READY FOR LIVE DATABASE VALIDATION` until end-to-end database connectivity can be verified against an active PostgreSQL instance.

