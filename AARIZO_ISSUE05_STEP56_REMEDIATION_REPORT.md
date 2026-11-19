# AARIZO — Phase A, Step 5.6: ISSUE-05 Remediation Report
## Final Targeted Security Corrections (F-23, F-24, F-25, F-26, F-27)

**Document Version:** 1.0.0  
**Date:** 2026-11-14  
**Project:** `D:\AAZIRA\AARIZO`  
**Target:** ISSUE-05 — Seeded Database Users Missing Password Hashes  
**Mode:** Targeted Implementation & Regression Verification  
**Status:** **IMPLEMENTED & VERIFIED**

---

## 1. Executive Summary

During the Step 5.5 Independent Security Audit, five remaining security and operational gaps were identified and cataloged:
- **F-23 (High)**: Fails-open PL/pgSQL guard in `03_seed.sql` and unconditional `03_seed.sql` volume mount in default `docker-compose.yml`.
- **F-24 (Medium)**: Concurrency race condition during background password rehash in `POST /api/auth/login`.
- **F-25 (Medium)**: Synchronous execution of CPU/memory-intensive scrypt ($N=131072$) on the Node.js event loop without threadpool concurrency bounding or dedicated login rate limiting.
- **F-26 (Low)**: Incomplete environment blacklist in `scripts/postgres/migrate.ts` permitting `03_seed.sql` execution in unhandled non-production environments.
- **F-27 (Low)**: Official host deployment guide instructing direct execution of `03_seed.sql` during production database setup.

In Step 5.6, all five findings were remediated with minimal, high-precision code corrections. All existing authentication flows, user credentials, Firebase accounts, and legacy hash verification paths were preserved without breaking changes.

---

## 2. Detailed Remediation Actions

### 2.1. Finding F-23: Fail-Closed SQL Seed Guard & Docker Compose Isolation

#### Defect Summary
The previous PL/pgSQL guard in `scripts/postgres/03_seed.sql` checked whether `current_setting('aarizo.environment', true) IN ('production', 'prod', 'staging')`. Because PostgreSQL returns `NULL` when a custom setting is unset, and `NULL IN (...)` evaluates to `NULL` (falsy), the guard failed open when executed directly on an unconfigured database. Furthermore, `docker-compose.yml` unconditionally mounted `03_seed.sql` into `/docker-entrypoint-initdb.d/`, which initialized demo accounts in production container setups.

#### Remediations Applied
1. **Hardened PL/pgSQL Guard in [scripts/postgres/03_seed.sql](file:///d:/AAZIRA/AARIZO/scripts/postgres/03_seed.sql#L7-L17)**:
   Replaced the blacklist check with a strict fail-closed whitelist:
   ```sql
   DO $$
   DECLARE
       current_env TEXT := lower(trim(coalesce(current_setting('aarizo.environment', true), '')));
   BEGIN
       -- Fail-closed guard: strictly require an explicit authorized development/test setting.
       -- Unset, NULL, empty string, production, staging, preview, uat, etc., all trigger an immediate exception.
       IF current_env NOT IN ('development', 'dev', 'test', 'local') THEN
           RAISE EXCEPTION '[SECURITY] Execution of 03_seed.sql rejected: Demo seed data is forbidden unless aarizo.environment is explicitly set to development or test (current setting: "%"). To bypass for local dev: SET aarizo.environment = ''development'';', current_env;
       END IF;
   END $$;
   ```
2. **Removed Default Mount from [docker-compose.yml](file:///d:/AAZIRA/AARIZO/docker-compose.yml#L18-L27)**:
   Removed `./scripts/postgres/03_seed.sql:/docker-entrypoint-initdb.d/03_seed.sql` from the default `postgres` service definition. Added an explicit security notice explaining that default container startup is schema-only (`01_schema.sql` and `02_rls_policies.sql`).
3. **Created [docker-compose.dev.yml](file:///d:/AAZIRA/AARIZO/docker-compose.dev.yml)**:
   Added an explicit Docker Compose override file for local development:
   ```yaml
   version: '3.8'

   # Local Development Docker Compose Override
   # Usage: docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
   services:
     postgres:
       environment:
         PGOPTIONS: "-c aarizo.environment=development"
       volumes:
         - ./scripts/postgres/03_seed.sql:/docker-entrypoint-initdb.d/03_seed.sql
   ```

---

### 2.2. Finding F-24: Concurrency-Safe Password Rehash Updates

#### Defect Summary
In `server/src/index.ts`, when a user authenticated with an older hash format (legacy HMAC or $N=16384$ scrypt), the server initiated a background rehash upgrade to target $N=131072$ via `prisma.user.update({ where: { id: user.id }, data: { passwordHash, salt } })`. If the user concurrently changed their password or two logins occurred simultaneously, the second rehash could overwrite the newly changed password with a hash of the previous password.

#### Remediations Applied
Updated [server/src/index.ts](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L1804-L1825) to use an optimistic conditional update with `prisma.user.updateMany`:
```typescript
if (needsRehash(user.passwordHash)) {
  const verifiedHash = user.passwordHash;
  // Trigger non-blocking asynchronous rehash to target OWASP config
  (async () => {
    try {
      const upgradedSalt = generateSalt(16);
      const upgradedHash = await hashPasswordScryptAsync(password, upgradedSalt);
      // Concurrency-safe optimistic check: only update if the stored passwordHash has NOT changed
      const updateResult = await prisma.user.updateMany({
        where: {
          id: user.id,
          passwordHash: verifiedHash, // Atomic guard against stale overwrites
        },
        data: {
          passwordHash: upgradedHash,
          salt: upgradedSalt,
        },
      });
      if (updateResult.count > 0) {
        logger.info(`[Auth] Transparently upgraded password hash for user ${user.id} to target scrypt config`);
      } else {
        logger.info(`[Auth] Skipped rehash upgrade for user ${user.id}: password was concurrently updated`);
      }
    } catch (rehashErr: any) {
      logger.warn(`[Auth] Non-fatal error during transparent hash upgrade for user ${user.id}:`, rehashErr?.message);
    }
  })();
}
```
If the password was changed while the rehash was computing, `updateMany` affects 0 rows, preventing stale hash overwrites.

---

### 2.3. Finding F-25: Asynchronous Scrypt, Concurrency Limiting & Rate Limiting

#### Defect Summary
Target $N=131072, r=8, p=1$ scrypt operations require ~350ms of CPU time and 128 MiB RAM. Executing `verifyPassword` synchronously on the Node.js main thread blocked the event loop. Without rate limiting or concurrency bounding, concurrent login requests could exhaust system memory or starve the HTTP server.

#### Remediations Applied
1. **Asynchronous Scrypt in [server/src/crypto.ts](file:///d:/AAZIRA/AARIZO/server/src/crypto.ts#L3-L93)**:
   Implemented `hashPasswordScryptAsync` and `verifyPasswordAsync` utilizing Node's asynchronous `crypto.scrypt` (which runs on the libuv worker threadpool without blocking the main event loop):
   ```typescript
   const scryptAsync = (
     password: crypto.BinaryLike,
     salt: crypto.BinaryLike,
     keylen: number,
     options: crypto.ScryptOptions
   ): Promise<Buffer> => {
     return new Promise((resolve, reject) => {
       crypto.scrypt(password, salt, keylen, options, (err, derivedKey) => {
         if (err) reject(err);
         else resolve(derivedKey);
       });
     });
   };
   ```
2. **Dedicated Login Rate Limiter in [server/src/auth.ts](file:///d:/AAZIRA/AARIZO/server/src/auth.ts#L412-L439)**:
   Implemented `loginRateLimiter(maxRequests = 10, windowMs = 60000)`:
   - Limits login attempts to 10 requests per 60-second window per IP address.
   - Responds with `HTTP 429 Too Many Requests`, a `Retry-After: <seconds>` response header, and JSON error response.
   - Mounted directly on `POST /api/auth/login` in `server/src/index.ts`.
3. **Bounded Concurrency Semaphore (`AuthConcurrencyLimiter`) in [server/src/auth.ts](file:///d:/AAZIRA/AARIZO/server/src/auth.ts#L446-L484)**:
   Created an atomic permit-based concurrency limiter:
   - Configurable via `process.env.AUTH_MAX_CONCURRENT_HASHES` (default: 4, matching Node's default libuv worker threads `UV_THREADPOOL_SIZE=4`).
   - Limits simultaneous scrypt operations so total memory allocated for hashing is bounded to $\le 4 \times 128 \text{ MiB} = 512 \text{ MiB}$.
   - If the limiter is saturated, `POST /api/auth/login` returns `HTTP 429` with `Retry-After: 1` and `code: 'AUTH_CONCURRENCY_EXCEEDED'`.
   - Permits are guaranteed to be released in a `try...finally` block upon completion or failure.

---

### 2.4. Finding F-26: Fail-Closed Migration Environment Whitelist

#### Defect Summary
`scripts/postgres/migrate.ts` previously checked a partial blacklist of non-dev environments (`['production', 'staging', 'prod', 'ci', 'test']`). Any unlisted environment (e.g. `preview`, `qa`, `uat`, `preprod`, `demo`, `sandbox`, `unknown`, or unset `NODE_ENV`) defaulted to executing `03_seed.sql`.

#### Remediations Applied
Updated [scripts/postgres/migrate.ts](file:///d:/AAZIRA/AARIZO/scripts/postgres/migrate.ts#L10-L60):
- Replaced blacklist logic with `isExplicitLocalDevOrTestEnv(env)`.
- `03_seed.sql` is strictly excluded unless `NODE_ENV` is explicitly `'development'`, `'dev'`, `'test'`, or `'local'`, and no CI or cloud provider environment variables (`CI`, `VERCEL`, `RENDER`, `FLY_APP_NAME`, `RAILWAY_STATIC_URL`, etc.) are detected.
- Rejected `APPLY_DEMO_SEED=true` in non-development environments with an explicit security warning.
- Configured automatic session variable `SET aarizo.environment = 'development';` on local connections prior to executing `03_seed.sql`.

---

### 2.5. Finding F-27: Deployment Documentation Corrections

#### Defect Summary
`docs/HOST_DEPLOYMENT_GUIDE.md` and `docs/POSTGRES_MIGRATION_GUIDE.md` instructed operators to run `psql -f scripts/postgres/03_seed.sql` during manual production host deployment, polluting production databases with demo accounts.

#### Remediations Applied
1. **Updated [docs/HOST_DEPLOYMENT_GUIDE.md](file:///d:/AAZIRA/AARIZO/docs/HOST_DEPLOYMENT_GUIDE.md#L45-L60)**:
   - Removed `psql -f scripts/postgres/03_seed.sql` from Step 2 manual database initialization commands.
   - Added a clear security notice explaining that `03_seed.sql` is strictly for local development and unit testing, and is rejected by the PL/pgSQL guard in production.
2. **Updated [docs/POSTGRES_MIGRATION_GUIDE.md](file:///d:/AAZIRA/AARIZO/docs/POSTGRES_MIGRATION_GUIDE.md#L35-L48)**:
   - Separated production DDL execution (`01_schema.sql` and `02_rls_policies.sql`) from local development seeding.
   - Clarified that `docker compose up -d` is schema-only by default, and `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d` is required for demo accounts.

---

## 3. Inventory of Modified Files

| File | Status | Description |
|---|---|---|
| [scripts/postgres/03_seed.sql](file:///d:/AAZIRA/AARIZO/scripts/postgres/03_seed.sql) | **Modified** | Replaced blacklist with strict fail-closed whitelist PL/pgSQL guard (`current_env NOT IN ('development', 'dev', 'test', 'local')`). |
| [docker-compose.yml](file:///d:/AAZIRA/AARIZO/docker-compose.yml) | **Modified** | Removed default `03_seed.sql` volume mount; added security documentation banner. |
| [docker-compose.dev.yml](file:///d:/AAZIRA/AARIZO/docker-compose.dev.yml) | **Created** | Local dev override with `PGOPTIONS: "-c aarizo.environment=development"` and `03_seed.sql` mount. |
| [scripts/postgres/migrate.ts](file:///d:/AAZIRA/AARIZO/scripts/postgres/migrate.ts) | **Modified** | Implemented fail-closed environment resolution; rejected `APPLY_DEMO_SEED` outside dev; set `aarizo.environment`. |
| [server/src/crypto.ts](file:///d:/AAZIRA/AARIZO/server/src/crypto.ts) | **Modified** | Added `hashPasswordScryptAsync` and `verifyPasswordAsync` utilizing Promise-wrapped `crypto.scrypt`. |
| [server/src/auth.ts](file:///d:/AAZIRA/AARIZO/server/src/auth.ts) | **Modified** | Implemented `loginRateLimiter` (10 req/min) and `AuthConcurrencyLimiter` (default 4 permits, $\le 512$ MiB RAM). |
| [server/src/index.ts](file:///d:/AAZIRA/AARIZO/server/src/index.ts) | **Modified** | Applied `loginRateLimiter`, bounded concurrency permit acquisition, async scrypt verification, and optimistic `updateMany` rehash. |
| [docs/HOST_DEPLOYMENT_GUIDE.md](file:///d:/AAZIRA/AARIZO/docs/HOST_DEPLOYMENT_GUIDE.md) | **Modified** | Removed `03_seed.sql` from production manual commands; added security warnings. |
| [docs/POSTGRES_MIGRATION_GUIDE.md](file:///d:/AAZIRA/AARIZO/docs/POSTGRES_MIGRATION_GUIDE.md) | **Modified** | Clarified schema-only production setup vs. local dev override commands. |
| [tests/issue05_secure_seed_auth.test.ts](file:///d:/AAZIRA/AARIZO/tests/issue05_secure_seed_auth.test.ts) | **Modified** | Expanded test suite with 49 tests verifying F-23, F-24, F-25, F-26, and F-27. |

---

## 4. Security Principles Upheld

1. **Fail-Closed by Default**: If `aarizo.environment` or `NODE_ENV` is missing, unconfigured, misspelled, or unrecognized, demo seed execution is rejected immediately.
2. **Defense in Depth**: Isolation is enforced at four distinct architectural layers:
   - PL/pgSQL database engine level (`03_seed.sql`).
   - Container orchestration level (`docker-compose.yml` vs `docker-compose.dev.yml`).
   - Automated migration runner level (`migrate.ts`).
   - Operational documentation level (`HOST_DEPLOYMENT_GUIDE.md`).
3. **Event Loop Non-Blocking**: High-cost cryptographic derivations run asynchronously off the Node.js event loop on the libuv threadpool.
4. **Denial of Service (DoS) Resistance**: Strict IP-based login rate limiting (10 req/min) combined with bounded concurrency (4 slots) prevents memory exhaustion and server saturation.
5. **Zero Secrets in Logs**: All credential verification, rehashing, and rate limiting log only non-sensitive identifiers and counts; no passwords, hashes, salts, or tokens are logged.
6. **Optimistic Concurrency Protection**: Atomic `updateMany({ where: { id, passwordHash: verifiedHash } })` prevents race conditions from overwriting user password changes.

