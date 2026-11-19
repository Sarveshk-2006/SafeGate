# AARIZO — Phase A, Step 5.5: ISSUE-05 Independent Post-Remediation Audit

**Date:** November 14, 2026  
**Project:** `D:\AAZIRA\AARIZO`  
**Mode:** STRICT AUDIT ONLY — NO MODIFICATIONS  
**Objective:** Independent verification of Step 5.4 security corrections before closing ISSUE-05  
**Auditor:** Antigravity Engineering (Independent Security Audit)  
**Verdict:** **NOT READY — TARGETED CORRECTIONS REQUIRED**

---

## Executive Summary

This independent post-remediation audit evaluated the security implementation introduced in Step 5.4 for **ISSUE-05: Seeded Database Users Missing Password Hashes & Authentication Hardening**. The audit inspected the repository source code, Docker configuration, migration scripts, cryptographic primitives, concurrency behavior, and historical test logs.

While the primary cryptographic enhancements (upgrading scrypt to OWASP target $N=131072$, parameter allowlisting, timing-safe equality, and non-destructive seed upserts) were successfully verified and all 40 tests in `tests/issue05_secure_seed_auth.test.ts` pass, the audit identified **four critical gaps** that prevent unconditional closure:

1. **Fail-Open SQL Guard in `03_seed.sql` & Docker Mount Exposure**: The PL/pgSQL guard checks `IF current_setting('aarizo.environment', true) IN ('production', 'prod', 'staging')`. When the custom setting is unset (PostgreSQL default), it evaluates to `NULL` (falsy) and fails open. Direct execution (`psql -f 03_seed.sql`) or first-run Docker deployment via `docker-compose.yml` mounts and executes demo personas without obstruction.
2. **Fail-Open Migration Runner in `migrate.ts`**: `determineMigrationFiles()` uses a blacklist (`isNonDev = ['production', ...].includes(nodeEnv)`). If `NODE_ENV` is unset, empty, or set to an unrecognized tier (e.g. `uat`, `preprod`), it fails open and includes `03_seed.sql`.
3. **Non-Atomic Rehash Database Overwrite Race**: `prisma.user.update({ where: { id: user.id } })` in `POST /api/auth/login` is not conditional on the verified hash still matching. A concurrent password change occurring while an asynchronous rehash is in flight can be overwritten by the stale rehash.
4. **Synchronous Scrypt Event-Loop Starvation & High Rate-Limit Ceiling**: `crypto.scryptSync()` at $N=131072$ blocks the main Node.js event-loop thread for ~343 ms per request. The login endpoint relies solely on the global rate limiter (200 req/min per IP), allowing an unauthenticated attacker to freeze the server for up to 34–68 seconds.

---

## 1. SQL Seed Production Isolation (F-21)

### 1.1 `scripts/postgres/03_seed.sql` Guard Analysis
- **Inspected File:** [scripts/postgres/03_seed.sql](file:///d:/AAZIRA/AARIZO/scripts/postgres/03_seed.sql#L7-L13)
- **Code:**
  ```sql
  DO $$
  BEGIN
    -- Strict Production Safeguard: Refuse execution if environment is set to production
    IF current_setting('aarizo.environment', true) IN ('production', 'prod', 'staging') THEN
      RAISE EXCEPTION '[SECURITY] Execution of 03_seed.sql rejected: Demo seed data cannot be applied to a production or staging database.';
    END IF;
  END $$;
  ```
- **Behavior under Unset / Empty / Unexpected Settings:**
  - `current_setting('aarizo.environment', true)` uses the `missing_ok = true` flag. If `aarizo.environment` was never set on the PostgreSQL connection or in `postgresql.conf`, PostgreSQL returns `NULL`.
  - In SQL: `NULL IN ('production', 'prod', 'staging')` evaluates to `NULL` (which is falsy in an `IF` condition).
  - If `aarizo.environment` is empty string (`''`), `' '`, or uppercase (`'Production'`, `'PROD'`), the check evaluates to `FALSE` because SQL string literals are case-sensitive.
  - **Result:** The `RAISE EXCEPTION` is bypassed completely whenever the custom setting is unset, empty, or formatted in uppercase.
- **Direct Execution Risk:** If a system administrator executes `psql -U aarizo_admin -d aarizo_community -f scripts/postgres/03_seed.sql` against an AWS RDS, Supabase, Neon, or on-premise production database where `aarizo.environment` is not explicitly set, **all demo personas with precomputed scrypt hashes are immediately inserted into production**.

### 1.2 `scripts/postgres/migrate.ts` Isolation Analysis
- **Inspected File:** [scripts/postgres/migrate.ts](file:///d:/AAZIRA/AARIZO/scripts/postgres/migrate.ts#L27-L52)
- **Code:**
  ```ts
  export function determineMigrationFiles(env: NodeJS.ProcessEnv = process.env): string[] {
    const baseFiles = ['01_schema.sql', '02_rls_policies.sql'];
    const nodeEnv = (env.NODE_ENV || '').toLowerCase().trim();
    const isCi = env.CI === 'true' || env.CI === '1';
    const hasCloudMarker = !!(
      env.VERCEL ||
      env.RENDER ||
      env.RAILWAY_ENVIRONMENT ||
      env.FLY_APP_NAME ||
      env.HEROKU_APP_NAME ||
      env.AWS_EXECUTION_ENV
    );
    const isNonDev = ['production', 'prod', 'staging', 'preview', 'qa'].includes(nodeEnv) || isCi || hasCloudMarker;
    const applyDemoSeed = (env.APPLY_DEMO_SEED || '').toLowerCase().trim() === 'true';

    if (isNonDev) {
      if (applyDemoSeed) {
        console.warn('⚠️ WARNING: APPLY_DEMO_SEED is set to true in a non-dev/production environment! Including 03_seed.sql.');
        return [...baseFiles, '03_seed.sql'];
      }
      console.log('🔒 Production or non-development environment detected. Excluding demo 03_seed.sql from migration.');
      return baseFiles;
    }

    return [...baseFiles, '03_seed.sql'];
  }
  ```
- **Fail-Open Defect:**
  - If `NODE_ENV` is unset or empty (`nodeEnv === ''`), `isNonDev` evaluates to `false` (assuming no CI/cloud flag).
  - If `NODE_ENV` is set to an unlisted tier (e.g. `uat`, `preprod`, `demo`, `sandbox`), `isNonDev` evaluates to `false`.
  - In either case, `determineMigrationFiles()` returns `['01_schema.sql', '02_rls_policies.sql', '03_seed.sql']`, executing demo seed data in unclassified environments.
  - Unlike `server/src/seed.ts` (which uses a whitelist `isExplicitLocalDevOrTestEnv()`), `migrate.ts` uses an incomplete blacklist.
- **`APPLY_DEMO_SEED=true` Bypass:**
  - Lines 43–46 explicitly allow bypassing production isolation when `APPLY_DEMO_SEED=true`.
  - Furthermore, `migrate.ts` executes `client.query(sql)` without setting `SET aarizo.environment = ...`. Therefore, when `03_seed.sql` executes via `migrate.ts`, the SQL guard in `03_seed.sql` sees `aarizo.environment` as `NULL` and does not prevent execution.

---

## 2. Docker Compose & Deployment Isolation

### 2.1 Compose File Inspection
- **Inspected File:** [docker-compose.yml](file:///d:/AAZIRA/AARIZO/docker-compose.yml#L15-L21)
- **Mount Configuration:**
  ```yaml
      volumes:
        - pgdata:/var/lib/postgresql/data
        - ./scripts/postgres/01_schema.sql:/docker-entrypoint-initdb.d/01_schema.sql
        - ./scripts/postgres/02_rls_policies.sql:/docker-entrypoint-initdb.d/02_rls_policies.sql
        # ⚠️ SECURITY NOTICE: 03_seed.sql contains development/test demo credentials and data.
        # DO NOT mount 03_seed.sql into /docker-entrypoint-initdb.d/ in production or staging environments!
        - ./scripts/postgres/03_seed.sql:/docker-entrypoint-initdb.d/03_seed.sql
  ```
- **Enforcement Status:** **MERELY DOCUMENTED, NOT TECHNICALLY ENFORCED**.
  - In `docker-compose.yml`, line 21 mounts `./scripts/postgres/03_seed.sql` into `/docker-entrypoint-initdb.d/03_seed.sql` unconditionally.
  - The PostgreSQL official container entrypoint (`/usr/local/bin/docker-entrypoint.sh`) executes every `.sql` file in `/docker-entrypoint-initdb.d/` on first database initialization.
  - There is no variable substitution (e.g. `${SEED_MOUNT:-...}`) or separate compose file (`docker-compose.prod.yml`).
  - Lines 9–12 do not set `aarizo.environment` in PostgreSQL.
  - Consequently, whenever `docker compose up -d` is executed on a clean host, PostgreSQL boots, executes `01_schema.sql`, `02_rls_policies.sql`, and `03_seed.sql`, inserting all demo users into the container volume.

### 2.2 Production Deployment Documentation
- **Inspected File:** [docs/HOST_DEPLOYMENT_GUIDE.md](file:///d:/AAZIRA/AARIZO/docs/HOST_DEPLOYMENT_GUIDE.md#L15-L46)
- **Discrepancy:**
  - Section 2 ("One-Command Host Deployment (Docker)") tells operators to run:
    ```bash
    docker compose up -d --build
    ```
    This triggers the automatic initialization executing `03_seed.sql`.
  - Section 3 ("Direct Host Deployment on Linux Host"), Step 2 explicitly instructs operators to run:
    ```bash
    psql -U aarizo_admin -d aarizo_community -f scripts/postgres/01_schema.sql
    psql -U aarizo_admin -d aarizo_community -f scripts/postgres/02_rls_policies.sql
    psql -U aarizo_admin -d aarizo_community -f scripts/postgres/03_seed.sql
    ```
- **Execution Path Table:**

| Environment | Invocation Method | `03_seed.sql` Executed? | Isolation Enforced? |
| :--- | :--- | :---: | :--- |
| **Local Dev (Docker)** | `docker compose up` | **Yes** | Intended behavior |
| **Local Dev (Script)** | `tsx server/src/seed.ts` | **Yes** (via Prisma) | Verified fail-closed logic |
| **Host Deploy (Docker)** | `docker compose up -d` per guide | **Yes** | **UNENFORCED** (Comment only) |
| **Direct Host (Linux)** | `psql -f .../03_seed.sql` per guide | **Yes** | **UNENFORCED** (`current_setting` is NULL) |
| **Production (migrate.ts)** | `node migrate.js` with `NODE_ENV=production` | **No** (unless `APPLY_DEMO_SEED=true`) | Enforced by `migrate.ts` |
| **Production (migrate.ts)** | `node migrate.js` with unset `NODE_ENV` | **Yes** | **UNENFORCED** (Blacklist fails open) |

---

## 3. Rehash-on-Login Concurrency & Correctness

### 3.1 Code Inspection
- **Inspected File:** [server/src/index.ts](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L1760-L1784)
- **Implementation:**
  ```ts
  if (!verifyPassword(password, user.passwordHash, user.salt)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (user.status !== 'ACTIVE') {
    return res.status(403).json({ error: 'Account is inactive or suspended. Please contact administrator.' });
  }

  // Transparent Rehash-on-Login: Automatically upgrade legacy HMAC or older scrypt hashes to target N=131072
  if (needsRehash(user.passwordHash)) {
    try {
      const upgradedSalt = generateSalt(16);
      const upgradedHash = hashPasswordScrypt(password, upgradedSalt);
      prisma.user
        .update({
          where: { id: user.id },
          data: { passwordHash: upgradedHash, salt: upgradedSalt },
        })
        .catch((err) => {
          console.warn('[AuthUpgrade] Transparent password rehash deferred:', err?.message || err);
        });
    } catch {
      // Non-blocking: background upgrade failure never blocks or corrupts authenticated login
    }
  }
  ```

### 3.2 Concurrency & Correctness Criteria Verification

1. **Rehash only happens after successful password verification:**
   - **PASS.** `verifyPassword()` is called on line 1760. Rehash logic begins on line 1769. Unauthenticated or invalid requests exit early with 401.
2. **The update is conditional on the stored old hash still matching:**
   - **FAIL.** Line 1775 uses `where: { id: user.id }`. It does NOT include `passwordHash: user.passwordHash`.
3. **Concurrent logins cannot overwrite a newer password change:**
   - **FAIL (Race Condition Identified):**
     - Step 1: User logs in with old password $P_{old}$. Request A reads `user.passwordHash = H_{old}`.
     - Step 2: Line 1769 detects `needsRehash(H_{old}) == true`.
     - Step 3: Concurrently or immediately after, the user changes their password to $P_{new}$ via account settings, updating the database record to $H_{new}$.
     - Step 4: Request A's asynchronous `prisma.user.update` resolves and writes `H_{upgraded}(P_{old})` matching on `id: user.id`.
     - Step 5: **The newly changed password $P_{new}$ is overwritten with the rehashed old password $P_{old}$**.
   - **Minimal Remediation:** Use optimistic locking via Prisma `updateMany`:
     ```ts
     prisma.user.updateMany({
       where: { id: user.id, passwordHash: user.passwordHash },
       data: { passwordHash: upgradedHash, salt: upgradedSalt },
     })
     ```
4. **Failed background update handled without unhandled rejections:**
   - **PASS.** Handled via `.catch((err) => console.warn(...))` and wrapped in a `try/catch` block.
5. **Failed rehash does not invalidate an otherwise successful login:**
   - **PASS.** Token creation and response dispatch occur independently of the background update promise.
6. **New salt is unique and cryptographically secure:**
   - **PASS.** Calls `generateSalt(16)`, generating 16 CSPRNG bytes (32 hex characters) from `crypto.randomBytes()`.
7. **Update does not modify unrelated fields:**
   - **PASS.** `data` payload contains only `passwordHash` and `salt`.
8. **Repeated logins do not continually rehash an upgraded hash:**
   - **PASS.** Once upgraded to `$scrypt$N=131072,r=8,p=1$...`, `needsRehash()` returns `false`, bypassing lines 1770–1783.

---

## 4. Scrypt Resource Exhaustion & Login Protection

### 4.1 Resource Consumption Characteristics
- **Cost Factor:** $N=131072$ ($2^{17}$), $r=8, p=1$.
- **Memory Footprint:** $128 \times 8 \times 131072 = 134,217,728$ bytes = **128 MiB per operation**.
- **CPU Time:** **~343 ms per operation** (measured on Node 22 x64).

### 4.2 Synchronous Blocking & Event-Loop Starvation
- [server/src/crypto.ts#L67](file:///d:/AAZIRA/AARIZO/server/src/crypto.ts#L67) and [server/src/crypto.ts#L142](file:///d:/AAZIRA/AARIZO/server/src/crypto.ts#L142) call **`crypto.scryptSync()`**.
- Because `scryptSync` is synchronous and executes on Node's main V8 JavaScript thread:
  - Memory does not accumulate concurrently across simultaneous requests on a single Node thread (each 128 MiB allocation is made, verified, and freed sequentially).
  - **However, each call completely halts the Node.js event loop for ~343 ms.**
  - An attacker sending 10 sequential login requests freezes the event loop for $\sim 3.4$ seconds.
  - An attacker sending 100 requests freezes the event loop for $\sim 34.3$ seconds.
  - While frozen, the server cannot respond to `/api/health`, process real-time events in `realtimeEngine.ts`, or handle legitimate user traffic.

### 4.3 Rate Limiting Analysis
- **Inspected File:** [server/src/index.ts#L77](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L77)
- **Active Control:** `app.use(rateLimiter(200, 60000));`
- **Finding:**
  - The global rate limiter permits **200 requests per 60 seconds per IP address**.
  - There is **no dedicated, tighter rate limiter** applied to `/api/auth/login` (e.g. 5–10 requests per minute).
  - An attacker from a single IP can trigger $200 \times 343\text{ ms} = 68.6\text{ seconds}$ of main-thread execution every minute, effectively maintaining a sustained 100% CPU lock on single-process instances.

### 4.4 Early Bounds Checking & Malformed Input Defense
- **Inspected File:** [server/src/crypto.ts#L111-L140](file:///d:/AAZIRA/AARIZO/server/src/crypto.ts#L111-L140)
- **Finding:** **PASS.**
  - Empty or non-string passwords, hashes, and salts are rejected before scrypt.
  - Non-hex or short salts (< 32 hex chars) are rejected before scrypt.
  - Malformed envelope syntax is rejected before scrypt.
  - Any $(N, r, p)$ tuple not present in `ALLOWED_SCRYPT_CONFIG_KEYS` is rejected before scrypt.
  - Non-existent users or passwordless users are rejected in `index.ts` lines 1757–1758 before `verifyPassword()` is called.

---

## 5. Scrypt & Legacy Compatibility

### 5.1 Parameter & Allowlist Verification
- **Inspected File:** [server/src/crypto.ts](file:///d:/AAZIRA/AARIZO/server/src/crypto.ts)
- **Target Hash Generation:**
  - Line 28: `TARGET_SCRYPT_CONFIG = { N: 131072, r: 8, p: 1, keylen: 32, maxmem: 256 * 1024 * 1024 }`.
  - Line 68: Outputs `$scrypt$N=131072,r=8,p=1$<64-hex>`.
  - **Verdict:** **PASS.**
- **Backwards Compatibility:**
  - Line 40: `ALLOWED_SCRYPT_CONFIG_KEYS` allowlists `'131072:8:1'`, `'65536:8:1'`, and `'16384:8:1'`.
  - Line 155: `LEGACY_HMAC_REGEX.test(storedHash)` validates 64-character hex strings for legacy HMAC-SHA256 hashes.
  - **Verdict:** **PASS.**
- **Constant-Time Verification:**
  - Line 6: `timingSafeCompare(a, b)` converts strings to UTF-8 buffers, asserts length equality, and uses `crypto.timingSafeEqual(bufA, bufB)`.
  - Line 148 (scrypt): `timingSafeCompare(computedKey.toString('hex'), expectedHex)`.
  - Line 158 (HMAC): `timingSafeCompare(computedHmac, storedHash.toLowerCase())`.
  - **Verdict:** **PASS.**
- **`needsRehash()` Accuracy:**
  - Line 101: Returns `false` for `null`, `undefined`, and empty strings.
  - Returns `false` for `$scrypt$N=131072,r=8,p=1$...`.
  - Returns `true` for $N=16384$, $N=65536$, and legacy HMAC.
  - **Verdict:** **PASS.**

---

## 6. Seed Environment & Destructive-Operation Guards

### 6.1 `server/src/seed.ts` Verification
- **Inspected File:** [server/src/seed.ts](file:///d:/AAZIRA/AARIZO/server/src/seed.ts)
- **Environment Fail-Closed:**
  - Lines 9–41: Missing, empty, or unknown `NODE_ENV` returns `false`.
  - Presence of CI (`CI=true`) or cloud platform flags (`VERCEL`, `RENDER`, `RAILWAY_ENVIRONMENT`, etc.) returns `false`.
  - Only `'development'`, `'dev'`, or `'test'` without CI flags returns `true`.
  - **Verdict:** **PASS.**
- **Credential Provisioning Protection:**
  - Lines 98–104: In non-dev environments, missing `SEED_<ROLE>_PASSWORD` or `SEED_DEFAULT_PASSWORD` throws `[SECURITY] Seed credential provisioning rejected`. Default password fallback (`dwellora@2026`) is strictly blocked in production.
  - **Verdict:** **PASS.**
- **Destructive Purge Protection:**
  - Lines 48–77: In non-dev environments, `--force-clean` throws `[CRITICAL] Destructive database purge rejected`.
  - In local dev, requires `--confirm-delete-all-data` or `CONFIRM_DESTRUCTIVE_CLEAN=YES_I_AM_SURE`.
  - Lines 150–176: All 22 model `deleteMany({})` operations are gated behind `shouldClean`.
  - **Verdict:** **PASS.**

---

## 7. Investigation of Failed Validation & Test Runs

### 7.1 Root Cause of `prisma validate` Failure in Step 5.4
- **Prior Error Log:**
  ```
  Command: $env:DATABASE_URL="postgresql://user:pass@localhost:5432/db"; npx prisma validate --schema server/prisma/schema.prisma
  Output: ✘ [CLI.UNKNOWN_COMMAND] No command registered for `validate`
  Exit Code: 1
  ```
- **Investigation Finding:**
  - The repository root `package.json` does NOT include `prisma` in its dependencies.
  - When running `npx prisma` from root, `npx` invoked a globally cached or npx-resolved **Prisma Platform CLI** (which manages cloud projects/services and has commands like `deploy`, `dev`, `contract`, but no `validate` command).
  - The actual project's Prisma ORM dependency is located in `server/package.json` (`"prisma": "^6.4.1"`).
  - When invoked using the correct prefix:
    ```powershell
    $env:DATABASE_URL="postgresql://user:pass@localhost:5432/db"; npx --prefix server prisma validate --schema server/prisma/schema.prisma
    ```
    Output:
    ```
    Prisma schema loaded from server\prisma\schema.prisma
    The schema at server\prisma\schema.prisma is valid 🚀
    ```
    **Exit Code: 0**.
- **Audit Conclusion:** The schema has been independently verified as valid using the project's installed Prisma ORM CLI. The Step 5.4 failure was strictly an invocation targeting error (`npx prisma` vs `npx --prefix server prisma`).

### 7.2 Final Test Counts & Build Verification

| Test / Build Step | Initial Step 5.4 Attempt | Final Verified Run | Status |
| :--- | :---: | :---: | :---: |
| `tests/issue05_secure_seed_auth.test.ts` | 9 failed / 31 passed | **40 passed, 0 failed** (16.11 s) | **PASS** |
| Complete Jest Test Suite (`npm test`) | 1 failed / 14 passed | **15 passed, 0 failed; 233 tests passed** (17.78 s) | **PASS** |
| Backend TypeScript Build (`server build`) | Clean (0 errors) | **Clean exit 0 (`tsc`)** | **PASS** |
| Frontend Vite Build (`npm run build`) | Clean (0 errors) | **Clean exit 0 (`vite build` in 1.03 s)** | **PASS** |
| Prisma Schema Validation (`prisma validate`)| Exit code 1 (CLI targeting) | **Clean exit 0 (`The schema is valid 🚀`)** | **PASS** |
| Prisma Client Generation (`prisma:generate`)| Clean exit 0 | **Clean exit 0 (Prisma Client v6.19.3)** | **PASS** |

---

## 8. Final Audit Verdict

```
════════════════════════════════════════════════════════════════════════════════
                  FINAL AUDIT VERDICT: ISSUE-05
       NOT READY — TARGETED CORRECTIONS REQUIRED (F-23, F-24, F-25, F-26)
════════════════════════════════════════════════════════════════════════════════
```

ISSUE-05 cannot be closed until the targeted findings documented in `AARIZO_ISSUE05_STEP55_REMAINING_FINDINGS.md` are remediated. Live database seeding and end-to-end authentication validation remain explicitly retained as pending due to PostgreSQL being offline.

