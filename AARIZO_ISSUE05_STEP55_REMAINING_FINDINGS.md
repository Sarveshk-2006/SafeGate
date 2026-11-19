# AARIZO — Phase A, Step 5.5: ISSUE-05 Remaining Security Findings Ledger

**Date:** November 14, 2026  
**Project:** `D:\AAZIRA\AARIZO`  
**Mode:** STRICT AUDIT ONLY — NO MODIFICATIONS  
**Target:** ISSUE-05 Remaining Security Findings  
**Auditor:** Antigravity Engineering (Independent Security Audit)  
**Overall Verdict:** **NOT READY — TARGETED CORRECTIONS REQUIRED**

---

## 1. Findings Summary Table

| Finding ID | Severity | Category | Affected File(s) & Lines | Status |
| :--- | :---: | :--- | :--- | :---: |
| **F-23** | **P1** | Database Security / Credential Exposure | [scripts/postgres/03_seed.sql#L7-L13](file:///d:/AAZIRA/AARIZO/scripts/postgres/03_seed.sql#L7-L13), [docker-compose.yml#L19-L21](file:///d:/AAZIRA/AARIZO/docker-compose.yml#L19-L21) | **FAIL** |
| **F-24** | **P2** | Concurrency / Data Integrity | [server/src/index.ts#L1773-L1777](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L1773-L1777) | **FAIL** |
| **F-25** | **P2** | Denial of Service / Availability | [server/src/crypto.ts#L67](file:///d:/AAZIRA/AARIZO/server/src/crypto.ts#L67), [server/src/index.ts#L77](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L77) | **PARTIAL** |
| **F-26** | **P2** | Environment Isolation | [scripts/postgres/migrate.ts#L28-L52](file:///d:/AAZIRA/AARIZO/scripts/postgres/migrate.ts#L28-L52) | **FAIL** |
| **F-27** | **P3** | Documentation / Deployment Hygiene | [docs/HOST_DEPLOYMENT_GUIDE.md#L43-L46](file:///d:/AAZIRA/AARIZO/docs/HOST_DEPLOYMENT_GUIDE.md#L43-L46) | **FAIL** |
| **ENV-01** | **P1** | Environment Infrastructure | PostgreSQL Local Port 5432 Offline | **NOT VERIFIED (PENDING)** |

---

## 2. Detailed Findings

### Finding F-23: Fail-Open PL/pgSQL Environment Guard in `03_seed.sql` & Unconditional Docker Compose Mount
- **Severity:** **P1 (High)**
- **Category:** Database Security / Credential Exposure
- **Affected Files & Lines:**
  - [scripts/postgres/03_seed.sql#L7-L13](file:///d:/AAZIRA/AARIZO/scripts/postgres/03_seed.sql#L7-L13)
  - [docker-compose.yml#L19-L21](file:///d:/AAZIRA/AARIZO/docker-compose.yml#L19-L21)
- **Exact Implementation:**
  ```sql
  DO $$
  BEGIN
    -- Strict Production Safeguard: Refuse execution if environment is set to production
    IF current_setting('aarizo.environment', true) IN ('production', 'prod', 'staging') THEN
      RAISE EXCEPTION '[SECURITY] Execution of 03_seed.sql rejected: Demo seed data cannot be applied to a production or staging database.';
    END IF;
  END $$;
  ```
- **Evidence & Reproduction Conditions:**
  1. `current_setting('aarizo.environment', true)` uses `missing_ok = true`. When the custom GUC `aarizo.environment` is unset, PostgreSQL returns `NULL`.
  2. In SQL logic, `NULL IN ('production', 'prod', 'staging')` yields `NULL`, which evaluates as falsy in an `IF` statement.
  3. If `03_seed.sql` is executed directly via `psql -f scripts/postgres/03_seed.sql` on a production PostgreSQL database, the safeguard does NOT fire, and all demo personas are inserted.
  4. In `docker-compose.yml`, line 21 unconditionally mounts `./scripts/postgres/03_seed.sql:/docker-entrypoint-initdb.d/03_seed.sql`. Because `docker-compose.yml` does not set `aarizo.environment`, any host running `docker compose up -d` executes `03_seed.sql` during initial container provisioning, completely bypassing the comment warning banner.
- **Audit Verdict:** **FAIL**
- **Minimal Recommended Remediation:**
  1. In `03_seed.sql`, implement a fail-closed guard that **requires** an explicit development setting:
     ```sql
     DO $$
     DECLARE
       current_env TEXT := lower(trim(coalesce(current_setting('aarizo.environment', true), '')));
     BEGIN
       IF current_env NOT IN ('development', 'dev', 'test', 'local') THEN
         RAISE EXCEPTION '[SECURITY] Execution of 03_seed.sql rejected: Demo seed data is forbidden unless aarizo.environment is explicitly set to development or test (current: "%")', current_env;
       END IF;
     END $$;
     ```
  2. In `docker-compose.yml`, configure `aarizo.environment: 'development'` in the postgres service environment so that local containers continue to seed seamlessly, while production compose profiles omit `03_seed.sql`.

---

### Finding F-24: Non-Atomic Rehash Database Update (Stale Password Overwrite Race Hazard)
- **Severity:** **P2 (Medium-High)**
- **Category:** Concurrency / Data Integrity
- **Affected Files & Lines:**
  - [server/src/index.ts#L1773-L1780](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L1773-L1780)
- **Exact Implementation:**
  ```ts
  prisma.user
    .update({
      where: { id: user.id },
      data: { passwordHash: upgradedHash, salt: upgradedSalt },
    })
    .catch((err) => {
      console.warn('[AuthUpgrade] Transparent password rehash deferred:', err?.message || err);
    });
  ```
- **Evidence & Reproduction Conditions:**
  1. The Prisma query filters solely on `where: { id: user.id }`.
  2. If a user logs in with their old password $P_{old}$, the server verifies the old hash $H_{old}$ and schedules an asynchronous background update.
  3. If the user immediately changes their password to $P_{new}$ via an account profile endpoint, the database updates `user.passwordHash` to $H_{new}$.
  4. When the delayed background promise from the login completes, it overwrites the user's record with `upgradedHash` (derived from $P_{old}$), silently destroying the user's newly set password $P_{new}$.
- **Audit Verdict:** **FAIL**
- **Minimal Recommended Remediation:**
  Make the update conditional on the verified hash still being present in the database using Prisma `updateMany`:
  ```ts
  prisma.user
    .updateMany({
      where: { id: user.id, passwordHash: user.passwordHash },
      data: { passwordHash: upgradedHash, salt: upgradedSalt },
    })
    .catch((err) => {
      console.warn('[AuthUpgrade] Transparent password rehash deferred:', err?.message || err);
    });
  ```
  If the password has changed, `updateMany` modifies 0 records, preventing the stale overwrite.

---

### Finding F-25: Main-Thread Event-Loop Starvation via `scryptSync` & High Rate-Limit Ceiling
- **Severity:** **P2 (Medium)**
- **Category:** Denial of Service / Availability
- **Affected Files & Lines:**
  - [server/src/crypto.ts#L67](file:///d:/AAZIRA/AARIZO/server/src/crypto.ts#L67)
  - [server/src/crypto.ts#L142](file:///d:/AAZIRA/AARIZO/server/src/crypto.ts#L142)
  - [server/src/index.ts#L77](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L77)
  - [server/src/index.ts#L1746](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L1746)
- **Exact Implementation:**
  ```ts
  // In crypto.ts:
  const key = crypto.scryptSync(password, salt, keylen, { N, r, p, maxmem });

  // In index.ts:
  app.use(rateLimiter(200, 60000));
  app.post('/api/auth/login', async (req: Request, res: Response) => { ... });
  ```
- **Evidence & Reproduction Conditions:**
  1. $N=131072, r=8, p=1$ takes approximately 343 ms of CPU time.
  2. Because `crypto.scryptSync` is synchronous, each execution completely blocks the Node.js event-loop thread.
  3. The global rate limiter permits 200 requests per minute per IP. There is no route-specific rate limiter on `POST /api/auth/login`.
  4. An attacker sending 20 sequential login requests from a single IP freezes the entire server event loop for $\sim 6.8$ seconds. During this window, all other incoming HTTP requests, health probes, and background pollers are blocked.
- **Audit Verdict:** **PARTIAL** (Format bounds and early parameter rejection are enforced, but event-loop thread blocking and permissive rate limits remain unaddressed).
- **Minimal Recommended Remediation:**
  1. Add a dedicated, restrictive rate limiter on `POST /api/auth/login` (e.g. `rateLimiter(10, 60000)` — 10 login attempts per minute per IP).
  2. Migrate `verifyPassword` and `hashPasswordScrypt` from `crypto.scryptSync` to asynchronous `crypto.scrypt` (wrapped in a Promise), offloading the memory-hard computation to Node's libuv worker threadpool and preventing main-thread event-loop starvation.

---

### Finding F-26: Fail-Open Migration File Selection for Unset or Unknown `NODE_ENV` in `migrate.ts`
- **Severity:** **P2 (Medium)**
- **Category:** Environment Isolation / Fail-Closed Architecture
- **Affected Files & Lines:**
  - [scripts/postgres/migrate.ts#L28-L52](file:///d:/AAZIRA/AARIZO/scripts/postgres/migrate.ts#L28-L52)
- **Exact Implementation:**
  ```ts
  const isNonDev = ['production', 'prod', 'staging', 'preview', 'qa'].includes(nodeEnv) || isCi || hasCloudMarker;
  if (isNonDev) {
    if (applyDemoSeed) return [...baseFiles, '03_seed.sql'];
    return baseFiles;
  }
  return [...baseFiles, '03_seed.sql'];
  ```
- **Evidence & Reproduction Conditions:**
  1. `determineMigrationFiles()` uses an incomplete blacklist: it only excludes `03_seed.sql` if `nodeEnv` matches one of 5 specific strings or has cloud markers.
  2. If `NODE_ENV` is unset, empty, or set to an unlisted tier (e.g. `uat`, `preprod`, `demo`, `sandbox`, `unknown`), `isNonDev` evaluates to `false`.
  3. Consequently, the runner defaults to including `03_seed.sql`, violating the project's strict fail-closed security requirement.
- **Audit Verdict:** **FAIL**
- **Minimal Recommended Remediation:**
  Invert the logic to use a strict whitelist (identical to `server/src/seed.ts`):
  ```ts
  const isLocalDevOrTest = ['development', 'dev', 'test', 'local'].includes(nodeEnv) && !isCi && !hasCloudMarker;
  if (!isLocalDevOrTest && !applyDemoSeed) {
    console.log('🔒 Non-development environment detected. Excluding demo 03_seed.sql from migration.');
    return baseFiles;
  }
  return [...baseFiles, '03_seed.sql'];
  ```

---

### Finding F-27: Deployment Guide Directs Direct Execution of `03_seed.sql` on Production Hosts
- **Severity:** **P3 (Low-Medium)**
- **Category:** Documentation / Deployment Hygiene
- **Affected Files & Lines:**
  - [docs/HOST_DEPLOYMENT_GUIDE.md#L43-L46](file:///d:/AAZIRA/AARIZO/docs/HOST_DEPLOYMENT_GUIDE.md#L43-L46)
- **Exact Implementation:**
  ```bash
  ### Step 2: Initialize Database
  psql -U aarizo_admin -d aarizo_community -f scripts/postgres/01_schema.sql
  psql -U aarizo_admin -d aarizo_community -f scripts/postgres/02_rls_policies.sql
  psql -U aarizo_admin -d aarizo_community -f scripts/postgres/03_seed.sql
  ```
- **Evidence & Reproduction Conditions:**
  The guide instructs operations staff to execute `03_seed.sql` during production manual database initialization. Because `03_seed.sql` contains pre-populated development personas, following the official deployment documentation directly pollutes the production database with demo accounts.
- **Audit Verdict:** **FAIL**
- **Minimal Recommended Remediation:**
  Update `HOST_DEPLOYMENT_GUIDE.md` Step 2 to explicitly state that `03_seed.sql` is for local development and testing only, and provide separate instructions for initializing production without demo records.

---

### Finding ENV-01: Live PostgreSQL Database & End-to-End Authentication Validation Pending
- **Severity:** **P1 (Operational Block / Verification Boundary)**
- **Category:** Environment Infrastructure
- **Affected Environment:** Local PostgreSQL Port 5432
- **Evidence & Reproduction Conditions:**
  - Port 5432 probe confirms PostgreSQL is offline.
  - All automated test verifications in `tests/issue05_secure_seed_auth.test.ts` rely on mocked Prisma client instances or isolated script execution.
  - Live execution of `psql`, `01_schema.sql`, `02_rls_policies.sql`, and Prisma migrations against a real PostgreSQL engine cannot be confirmed in the current offline environment.
- **Audit Verdict:** **NOT VERIFIED (PENDING LIVE DATABASE ENVIRONMENT)**
- **Remediation:**
  Retain live PostgreSQL validation as a mandatory requirement prior to final Phase A gate closure.

---

## 3. Explicit Final Audit Verdict

```
════════════════════════════════════════════════════════════════════════════════
                  FINAL AUDIT VERDICT: ISSUE-05
       NOT READY — TARGETED CORRECTIONS REQUIRED (F-23, F-24, F-25, F-26)
════════════════════════════════════════════════════════════════════════════════
```

ISSUE-05 has made major progress in Step 5.4 with high-assurance scrypt hashing and fail-closed Node.js seed logic, but remains **NOT READY** for final closure due to fail-open SQL guards, Docker Compose execution exposure, non-atomic rehash race conditions, and synchronous scrypt event-loop starvation risks.

