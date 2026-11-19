# AARIZO — Phase A, Step 5.7: ISSUE-05 Final Independent Security Audit

**Project:** `D:\AAZIRA\AARIZO`  
**Document Version:** 1.0.0  
**Audit Date:** 2026-11-17  
**Auditor Mode:** STRICT AUDIT ONLY — NO MODIFICATIONS  
**Target:** ISSUE-05 — Seeded Database Users Missing Password Hashes (Step 5.6 Verification)  
**Overall Verdict:** **READY FOR CONDITIONAL CLOSURE**

---

## 1. Executive Summary

This independent security audit evaluates the Step 5.6 targeted security corrections for ISSUE-05 against the authoritative source code, configuration files, database migration scripts, Docker definitions, and test logs.

The audit verified all five findings identified during Step 5.5:
- **F-23**: Fail-closed SQL seed PL/pgSQL guard, Docker Compose default volume mount removal, and explicit dev override configuration.
- **F-24**: Concurrency-safe optimistic conditional rehash (`prisma.user.updateMany`) preventing credential clobbering.
- **F-25**: Asynchronous scrypt execution offloading to the libuv threadpool, bounded concurrency limiter (`AuthConcurrencyLimiter`), and dedicated login rate limiter (`loginRateLimiter`).
- **F-26**: Fail-closed whitelist environment resolution in `scripts/postgres/migrate.ts` rejecting demo seeding outside authorized local development.
- **F-27**: Production deployment documentation hardened against demo seed execution.

### Verification Summary Table

| Finding ID | Title | Severity | Status | Scope |
|---|---|---|---|---|
| **F-23** | SQL Seed & Docker Initialization Isolation | High | **PASS** | `scripts/postgres/03_seed.sql`, `docker-compose.yml`, `docker-compose.dev.yml` |
| **F-24** | Optimistic Conditional Password Rehash | Medium | **PASS** | `server/src/index.ts`, `server/src/crypto.ts` |
| **F-25** | Asynchronous Scrypt & Resource Bounding | Medium | **PASS** | `server/src/crypto.ts`, `server/src/auth.ts`, `server/src/index.ts` |
| **F-26** | Migration Environment Whitelist Isolation | Low | **PASS** | `scripts/postgres/migrate.ts` |
| **F-27** | Production Deployment Documentation | Low | **PASS** | `docs/HOST_DEPLOYMENT_GUIDE.md`, `docs/POSTGRES_MIGRATION_GUIDE.md` |

---

## 2. Detailed Audit Findings

### 2.1. F-23: SQL Seed & Docker Initialization Isolation

- **Finding ID:** F-23
- **Severity:** High
- **Files Inspected:**
  - [scripts/postgres/03_seed.sql#L7-L15](file:///d:/AAZIRA/AARIZO/scripts/postgres/03_seed.sql#L7-L15)
  - [docker-compose.yml#L15-L25](file:///d:/AAZIRA/AARIZO/docker-compose.yml#L15-L25)
  - [docker-compose.dev.yml#L9-L17](file:///d:/AAZIRA/AARIZO/docker-compose.dev.yml#L9-L17)
- **Detailed Verification:**
  1. *Unset or Empty Setting Behavior:*
     In `03_seed.sql` line 9, `current_setting('aarizo.environment', true)` is protected by `coalesce(..., '')`, trimmed, and lowercased:
     ```sql
     current_env TEXT := lower(trim(coalesce(current_setting('aarizo.environment', true), '')));
     ```
     When unset in PostgreSQL, `current_setting(..., true)` returns `NULL`. Coalescing yields `''`. At line 12:
     ```sql
     IF current_env NOT IN ('development', 'dev', 'test', 'local') THEN
       RAISE EXCEPTION '[SECURITY] Execution of 03_seed.sql rejected: Demo seed data is strictly forbidden unless aarizo.environment is explicitly set to an authorized local development environment (current: "%").', current_env;
     END IF;
     ```
     Because `''` is not in the whitelist, execution fails closed and aborts immediately.
  2. *Non-Whitelisted Environments:*
     Values such as `'production'`, `'prod'`, `'staging'`, `'preview'`, `'ci'`, `'uat'`, `'unknown'`, or mixed casing/whitespace are rejected.
  3. *Default Compose Isolation:*
     Inspected `docker-compose.yml`. Lines 15–25 mount only:
     - `pgdata:/var/lib/postgresql/data`
     - `./scripts/postgres/01_schema.sql:/docker-entrypoint-initdb.d/01_schema.sql`
     - `./scripts/postgres/02_rls_policies.sql:/docker-entrypoint-initdb.d/02_rls_policies.sql`
     `03_seed.sql` is completely omitted from the default volume list. Verified using `docker compose config`.
  4. *Development Override Isolation:*
     Inspected `docker-compose.dev.yml`. Lines 9–17 specify:
     ```yaml
     services:
       postgres:
         environment:
           PGOPTIONS: "-c aarizo.environment=development"
         volumes:
           - ./scripts/postgres/03_seed.sql:/docker-entrypoint-initdb.d/03_seed.sql
     ```
     Merging with `docker compose -f docker-compose.yml -f docker-compose.dev.yml config` confirmed that `PGOPTIONS` and the volume mount are only injected when the operator explicitly includes the development override file.
  5. *`PGOPTIONS` Delivery to Initialization:*
     In PostgreSQL's official Docker entrypoint, `initdb` scripts are run by invoking `psql`. `psql` utilizes `libpq`, which automatically parses the `PGOPTIONS` environment variable and issues `-c aarizo.environment=development` on connection, fulfilling the PL/pgSQL guard check.
  6. *Deployment Boundary Reality:*
     A PostgreSQL custom GUC is set by the client and is not cryptographic proof of a non-production host. The true defense-in-depth isolation is provided by the exclusion of `03_seed.sql` from the default container volumes, migration runner, and production instructions.
- **Status:** **PASS**
- **Remaining Risk:** Low. If a developer manually runs `psql -c "SET aarizo.environment = 'development';" -f 03_seed.sql` against a production host, the guard will pass. This is documented and mitigated by operational host access controls.

---

### 2.2. F-24: Conditional Password Rehash Correctness

- **Finding ID:** F-24
- **Severity:** Medium
- **Files Inspected:**
  - [server/src/index.ts#L1780-L1822](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L1780-L1822)
  - [server/src/crypto.ts#L136-L139](file:///d:/AAZIRA/AARIZO/server/src/crypto.ts#L136-L139)
- **Detailed Verification:**
  1. *Execution Preconditions:*
     Rehash evaluation occurs strictly after password validation (`isValidPassword === true`, line 1788) and account status validation (`user.status === 'ACTIVE'`, line 1793).
  2. *Optimistic Concurrency Check:*
     Lines 1800–1814 capture `const verifiedHash = user.passwordHash;` and issue:
     ```typescript
     const result = await prisma.user.updateMany({
       where: {
         id: user.id,
         passwordHash: verifiedHash,
       },
       data: {
         passwordHash: upgradedHash,
         salt: upgradedSalt,
       },
     });
     ```
     If the user updated their password concurrently or another worker completed a rehash, the database row will no longer match `passwordHash: verifiedHash`. The query matches 0 rows (`result.count === 0`), and the stale hash write is safely discarded without corrupting credentials.
  3. *Error Containment:*
     The background task is wrapped in an immediately-invoked async function with a top-level `try...catch` block (lines 1801–1821). Rejection or database errors are logged via `console.warn` and do not produce unhandled promise rejections.
  4. *Login Non-Disruption:*
     The response is issued at line 1831 outside the detached rehash promise. Login succeeds whether the rehash succeeds, fails, or is skipped.
  5. *Unnecessary Rehash Prevention:*
     `needsRehash(storedHash)` in `server/src/crypto.ts:138` checks `!storedHash.startsWith('$scrypt$N=131072,r=8,p=1$')`. Users already on the target OWASP configuration return `false` and bypass the rehash block entirely.
  6. *Salt Filtering Consideration:*
     Because `passwordHash` is a collision-resistant cryptographic digest derived from the salt, any change to the salt or password produces a new hash value that breaks `passwordHash === verifiedHash`. However, adding `salt: user.salt` into the `where` clause would establish an even stricter tuple match (`where: { id, passwordHash, salt }`).
- **Status:** **PASS**
- **Remaining Risk:** None. Stale overwrites are prevented atomically by the database engine.

---

### 2.3. F-25: Asynchronous Scrypt & Resource Bounding

- **Finding ID:** F-25
- **Severity:** Medium
- **Files Inspected:**
  - [server/src/crypto.ts#L3-L15](file:///d:/AAZIRA/AARIZO/server/src/crypto.ts#L3-L15)
  - [server/src/crypto.ts#L204-L263](file:///d:/AAZIRA/AARIZO/server/src/crypto.ts#L204-L263)
  - [server/src/auth.ts#L412-L484](file:///d:/AAZIRA/AARIZO/server/src/auth.ts#L412-L484)
  - [server/src/index.ts#L1754](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L1754), [L1770-L1786](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L1770-L1786)
- **Detailed Verification:**

#### A. Async Execution
- `verifyPasswordAsync` uses Promise-wrapped `crypto.scrypt` (lines 3–15).
- No synchronous `scryptSync` calls are reachable from `POST /api/auth/login`. Static code search confirmed that `scryptSync` exists only within synchronous offline helpers (`hashPasswordScrypt`, `verifyPassword`) in `crypto.ts`.
- Pre-computation parameter validation:
  - Envelope regex check (`SCRYPT_ENVELOPE_REGEX`, line 222).
  - Explicit allowlist check (`ALLOWED_SCRYPT_CONFIG_KEYS.has(configKey)`, lines 233–236).
  - Salt format check (`HEX_SALT_REGEX`, line 216).
  Malformed or tampered hashes are rejected in constant time without executing scrypt.
- Legacy HMAC-SHA256 compatibility is preserved in lines 251–259.

#### B. Concurrency Limiter
- Gated before `verifyPasswordAsync` at line 1770 (`authConcurrencyLimiter.tryAcquire()`).
- Saturated requests immediately receive `HTTP 429` with `Retry-After: 1` and code `AUTH_CONCURRENCY_EXCEEDED`.
- Non-blocking: no requests wait in an unbounded in-memory promise queue.
- Permit release is guaranteed via `finally` block at line 1785.
- Limit is configurable via `AUTH_MAX_CONCURRENT_HASHES`, clamped between 1 and 16, defaulting to 4.
- Detached rehash calls `hashPasswordScryptAsync` in the background without acquiring a permit from `authConcurrencyLimiter`. Because rehash only triggers after successful rate-limited login, the probability of unbound background hashing is low, but separate semaphore accounting is noted as an observation.

#### C. Memory & Runtime Requirements
- **Working Memory Formula:**
  $$\text{Working Memory} = 128 \times N \times r = 128 \times 131,072 \times 8 = 134,217,728 \text{ bytes} = 128 \text{ MiB}$$
- **Node `maxmem` Guard:** Configured as `256 * 1024 * 1024` (256 MiB). This is Node's safety threshold, not the working memory per call.
- **Theoretical Peak Concurrency Memory:**
  With default `maxConcurrent = 4`, peak theoretical RAM allocated by simultaneous scrypt operations is:
  $$4 \times 128 \text{ MiB} = 512 \text{ MiB}$$
  If configured to the maximum upper clamp of 16:
  $$16 \times 128 \text{ MiB} = 2,048 \text{ MiB} = 2 \text{ GiB}$$
- **Process RSS vs Working Memory:**
  The 512 MiB figure is theoretical C++ buffer memory allocated during active derivation (~350ms duration) and must not be confused with steady-state Node.js RSS.
- **Libuv Threadpool Queueing:**
  Node.js defaults to `UV_THREADPOOL_SIZE = 4`. When 4 scrypt operations run simultaneously, all 4 libuv threads are occupied for ~350ms. Asynchronous file system calls (`fs.*`) and `dns.lookup` calls queue during this burst.

#### D. Login Rate Limiter
- Mounted at line 1754 as the first handler middleware: `loginRateLimiter(10, 60000)`.
- Enforces 10 attempts per minute per IP address; responds with HTTP 429 and `Retry-After` header.
- In-memory `Map` architecture: maintains counters in local process memory. In a multi-instance deployment (e.g. multi-pod Kubernetes or PM2 cluster), limits apply per process rather than cluster-wide.
- Express `trust proxy` is NOT configured; `req.ip` resolves directly from the socket remote address, preventing trivial `X-Forwarded-For` spoofing in direct connections.
- Account enumeration prevention (CWE-204): non-existent users, passwordless users, and incorrect passwords all receive identical `HTTP 401: Invalid email or password`.
- **Status:** **PASS**
- **Remaining Risk:** In-memory rate limiting requires migration to Redis if the application scales to a multi-instance cluster.

---

### 2.4. F-26: Migration Environment Whitelist Isolation

- **Finding ID:** F-26
- **Severity:** Low
- **Files Inspected:**
  - [scripts/postgres/migrate.ts#L13-L52](file:///d:/AAZIRA/AARIZO/scripts/postgres/migrate.ts#L13-L52)
  - [server/src/seed.ts#L9-L41](file:///d:/AAZIRA/AARIZO/server/src/seed.ts#L9-L41)
- **Detailed Verification:**
  1. *Strict Whitelist Logic:*
     Lines 13–30 evaluate `isExplicitLocalDevOrTestEnv(env)`:
     - Rejects any environment with CI markers (`CI === 'true' || CI === '1'`).
     - Rejects cloud hosting indicators (`VERCEL`, `RENDER`, `RAILWAY_ENVIRONMENT`, `FLY_APP_NAME`, `HEROKU_APP_NAME`, `KUBERNETES_SERVICE_HOST`, `AWS_EXECUTION_ENV`).
     - Strictly requires `NODE_ENV` to match `'development'`, `'dev'`, `'test'`, or `'local'`.
     - Missing, empty, or unknown `NODE_ENV` evaluates to `false`.
  2. *`APPLY_DEMO_SEED` Enforcement:*
     Lines 43–49 enforce:
     ```typescript
     if (!isLocalDev) {
       if (applyDemoSeed) {
         console.warn('⚠️ [SECURITY] APPLY_DEMO_SEED rejected: Demo credentials and personas cannot be applied outside authorized local development.');
       }
       console.log('🔒 Production or non-development environment detected. Excluding demo 03_seed.sql from migration.');
       return baseFiles;
     }
     ```
     `APPLY_DEMO_SEED=true` is rejected outside authorized local development.
  3. *PostgreSQL Session Authorization:*
     Line 75 issues `SET aarizo.environment = 'development';` only after `files.includes('03_seed.sql')` is confirmed by the whitelist.
  4. *Consistency with `server/src/seed.ts`:*
     Both modules share identical cloud marker definitions and fail-closed resolution.
- **Status:** **PASS**
- **Remaining Risk:** None.

---

### 2.5. F-27: Production Deployment Documentation

- **Finding ID:** F-27
- **Severity:** Low
- **Files Inspected:**
  - [docs/HOST_DEPLOYMENT_GUIDE.md#L23-L28](file:///d:/AAZIRA/AARIZO/docs/HOST_DEPLOYMENT_GUIDE.md#L23-L28), [L47-L57](file:///d:/AAZIRA/AARIZO/docs/HOST_DEPLOYMENT_GUIDE.md#L47-L57)
  - [docs/POSTGRES_MIGRATION_GUIDE.md#L9-L13](file:///d:/AAZIRA/AARIZO/docs/POSTGRES_MIGRATION_GUIDE.md#L9-L13), [L22-L27](file:///d:/AAZIRA/AARIZO/docs/POSTGRES_MIGRATION_GUIDE.md#L22-L27), [L39-L47](file:///d:/AAZIRA/AARIZO/docs/POSTGRES_MIGRATION_GUIDE.md#L39-L47)
- **Detailed Verification:**
  1. *Host Deployment Guide:*
     Step 2 (lines 47–52) instructs executing only:
     - `psql -f scripts/postgres/01_schema.sql`
     - `psql -f scripts/postgres/02_rls_policies.sql`
     `03_seed.sql` is accompanied by a `[!CAUTION]` notice stating it must NOT be executed against production or staging databases.
  2. *Migration Guide:*
     Lines 22–27 distinguish production Docker initialization (`docker compose up -d`) from local development (`docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`).
  3. *Validation of Commands:*
     Both documented Docker Compose commands were parsed and validated via `docker compose config`.
- **Status:** **PASS**
- **Remaining Risk:** None.

---

## 3. Independent Regression & Build Audit Results

All commands were executed and verified independently in the workspace:

### 3.1. Automated Test Suite Results
1. **Dedicated ISSUE-05 Test Suite (`tests/issue05_secure_seed_auth.test.ts`):**
   - **Command:** `npx jest tests/issue05_secure_seed_auth.test.ts`
   - **Result:** **PASS** (49/49 tests passed, 0 failed, duration: 31.457s)
2. **Full Repository Test Suite (`npm test`):**
   - **Command:** `npm test`
   - **Result:** **PASS** (15/15 test suites passed, 242/242 tests passed, duration: 21.162s)

### 3.2. Build & Schema Verification Results
1. **Backend TypeScript Compilation:**
   - **Command:** `npm --prefix server run build` (`tsc`)
   - **Exit Code:** 0 (Clean build, 0 errors)
2. **Frontend Production Build:**
   - **Command:** `npm run build` (`tsc -b && vite build`)
   - **Exit Code:** 0 (2,179 modules transformed, built in 1.03s)
3. **Prisma Schema Validation:**
   - **Command:** `npx --prefix server prisma validate --schema server/prisma/schema.prisma`
   - **Exit Code:** 0 (`The schema at server/prisma/schema.prisma is valid 🚀`)
4. **Prisma Client Generation:**
   - **Command:** `npm --prefix server run prisma:generate` (`prisma generate`)
   - **Exit Code:** 0 (Generated Prisma Client v6.19.3 in 209ms)
5. **Docker Compose Validation:**
   - **Default Config:** `docker compose config` confirmed exclusion of `03_seed.sql`.
   - **Dev Override:** `docker compose -f docker-compose.yml -f docker-compose.dev.yml config` confirmed inclusion of `03_seed.sql` and `PGOPTIONS: -c aarizo.environment=development`.

---

## 4. Operational Environment & Infrastructure Notice

During infrastructure inspection, port 5432 on `localhost` was found to be active (`TcpTestSucceeded: True`). However, Docker container inspection (`docker ps`) revealed that port 5432 is occupied by an unrelated foreign container (`nexus-postgres`), while the AARIZO database container (`aarizo_postgres`) is offline.

In accordance with strict audit instructions:
- No real PostgreSQL database operations or destructive seed scripts were executed.
- Live database seeding and live deployment smoke tests are retained as outstanding operational verifications.
- ISSUE-05 is conditionally closed pending live database validation upon service startup.

---

## 5. Audit Classification of Verification Levels

| Verification Level | Status | Notes |
|---|---|---|
| **Unit Test Verification** | **COMPLETE & VERIFIED** | 49 focused tests and 242 global Jest tests passing. |
| **Static Code / Config Verification** | **COMPLETE & VERIFIED** | All code, SQL, Compose, and documentation verified with line numbers. |
| **Build Verification** | **COMPLETE & VERIFIED** | Backend `tsc`, frontend Vite, and Prisma CLI all compile cleanly. |
| **Live PostgreSQL Verification** | **PENDING** | Port 5432 occupied by unrelated container; `aarizo_postgres` offline. |
| **Actual Deployment Verification** | **PENDING** | Host deployment execution reserved for live environment boot. |

---

## 6. Overall Audit Verdict

**READY FOR CONDITIONAL CLOSURE**

All identified vulnerabilities and design defects in ISSUE-05 (including findings F-23, F-24, F-25, F-26, and F-27) have been remediated in source code, verified with regression tests, and confirmed across builds. Conditional closure is granted; full operational closure will occur upon live PostgreSQL database startup.

