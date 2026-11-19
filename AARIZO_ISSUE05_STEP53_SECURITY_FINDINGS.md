# AARIZO — Phase A, Step 5.3: ISSUE-05 Security Findings Dossier

**Document ID:** `AARIZO_ISSUE05_STEP53_SECURITY_FINDINGS`  
**Execution Phase:** Phase A, Step 5.3  
**Target:** Security Observations & Findings from Independent Verification of Step 5.2  
**Audit Date:** November 14, 2026  
**Auditor:** Antigravity Autonomous Security Engineer  

---

## 1. Overview of Verification Findings

| Finding ID | Severity | Category | Target File & Lines | Status | Impact Summary |
| :--- | :---: | :---: | :--- | :---: | :--- |
| **F-19** | **Medium** | Security / Configuration | `server/src/seed.ts:20` | **OPEN (Observation)** | Case-sensitive `NODE_ENV === 'production'` allows bypass via `Production` or `PROD` |
| **F-20** | **Medium** | Operational / Data Integrity | `server/src/seed.ts:57` | **OPEN (Observation)** | `--force-clean` / `SEED_FORCE_CLEAN` executes destructive `deleteMany` even in production |
| **F-21** | **Low** | Credential Exposure | `scripts/postgres/03_seed.sql:35-43` | **INFORMATIONAL** | Static Docker SQL seed contains shared precomputed test hashes for demo personas |
| **F-22** | **Low** | Defense-in-Depth / DoS | `server/src/crypto.ts:87-96` | **INFORMATIONAL** | Envelope parser does not enforce explicit upper bounds on $N, r, p$ parameters |

---

## 2. Detailed Finding Dossiers

### Finding F-19 [Medium]: Case-Sensitive Production Environment Check in Seed Script
- **Category:** Environment Configuration / Fail-Open Edge Case
- **Location:** [server/src/seed.ts#L20-L24](file:///d:/AAZIRA/AARIZO/server/src/seed.ts#L20-L24)
- **Current Code:**
  ```typescript
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    throw new Error(
      `[SECURITY] Production database seed rejected: Predictable credentials are forbidden in production. ` +
      `Provide ${roleEnvKey} or SEED_DEFAULT_PASSWORD via environment variables (minimum 8 characters).`
    );
  }
  ```
- **Vulnerability Analysis:**
  The check performs a strict lowercase equality check (`process.env.NODE_ENV === 'production'`). If an orchestration environment, Dockerfile, or deployment manifest sets:
  - `NODE_ENV=Production`
  - `NODE_ENV=PROD`
  - `NODE_ENV=staging`
  - `NODE_ENV=prod`
  The condition evaluates to `false`. Execution proceeds to line 33, falling back to the default development credential (`dwellora@2026`).
- **Reproduction Steps:**
  ```bash
  node -e "const isProd = process.env.NODE_ENV === 'production'; console.log('isProd:', isProd)"
  # With $env:NODE_ENV="Production" -> prints: isProd: false
  ```
- **Severity:** Medium (P2)
- **Minimal Recommended Remediation:**
  Normalize the environment variable before evaluation:
  ```typescript
  const normalizedEnv = (process.env.NODE_ENV || '').toLowerCase().trim();
  const isProductionLike = normalizedEnv === 'production' || normalizedEnv === 'prod' || normalizedEnv === 'staging';
  if (isProductionLike) {
    throw new Error(...);
  }
  ```

---

### Finding F-20 [Medium]: Unconditional `--force-clean` Permitted in Production
- **Category:** Data Loss / Destructive Operation Risk
- **Location:** [server/src/seed.ts#L57-L88](file:///d:/AAZIRA/AARIZO/server/src/seed.ts#L57-L88)
- **Current Code:**
  ```typescript
  const shouldClean = process.argv.includes('--force-clean') || process.env.SEED_FORCE_CLEAN === 'true';
  if (shouldClean) {
    console.log('🧹 Explicit --force-clean specified: Purging existing database tables...');
    await prisma.auditLog.deleteMany({});
    ...
    await prisma.user.deleteMany({});
    ...
  ```
- **Vulnerability Analysis:**
  While normal seeding is now safe and non-destructive, the `--force-clean` branch does not verify whether the database is a production instance. If a containerized deployment inherits `SEED_FORCE_CLEAN=true` from a developer compose file, or an operator accidentally passes `--force-clean` in production, all 21 database tables are unconditionally wiped.
- **Severity:** Medium (P2)
- **Minimal Recommended Remediation:**
  Require an explicit override token or forbid destructive wiping in production:
  ```typescript
  if (shouldClean) {
    const isProduction = (process.env.NODE_ENV || '').toLowerCase().trim() === 'production';
    if (isProduction && process.env.CONFIRM_PRODUCTION_PURGE !== 'YES_I_AM_SURE') {
      throw new Error('[CRITICAL] Destructive database purge rejected in production. Set CONFIRM_PRODUCTION_PURGE=YES_I_AM_SURE to override.');
    }
  }
  ```

---

### Finding F-21 [Low / Informational]: Static Docker SQL Seed Contains Shared Development Hashes
- **Category:** Credential Management / Docker Entrypoint
- **Location:** [scripts/postgres/03_seed.sql#L35-L48](file:///d:/AAZIRA/AARIZO/scripts/postgres/03_seed.sql#L35-L48)
- **Current Code:**
  ```sql
  INSERT INTO users (id, society_id, name, email, phone, role, flat_number, flat_details, designation, status, password_hash, salt)
  VALUES
  ('user-resident-01', 'soc-gvs', 'Sarvesh Kulkarni', 'sarvesh@greenvalley.com', '+919876543210', 'resident', 'B-1204', 'Tower B · Flat 1204', 'Flat Owner & Resident', 'ACTIVE', '$scrypt$N=16384,r=8,p=1$04172db7259306490d1266c3bee96ef34e1e1947035226e3a1c1015aaccd78d3', 'a76c947913cad8dcdeaedf7c1053ffa5'),
  ...
  ```
- **Vulnerability Analysis:**
  The SQL file does not embed plaintext passwords, but the precomputed scrypt hashes were generated from the shared development credential (`dwellora@2026`). If `03_seed.sql` is mounted into a production PostgreSQL container via `/docker-entrypoint-initdb.d/`, demo accounts with known credentials are created in the database.
- **Severity:** Low (P3) / Informational
- **Minimal Recommended Remediation:**
  In `docker-compose.yml`, mount `03_seed.sql` only in development compose overrides (`docker-compose.dev.yml`), and exclude it from production initialization scripts.

---

### Finding F-22 [Low / Defense-in-Depth]: Scrypt Parameter Bounds Validation
- **Category:** Cryptographic Robustness / Denial-of-Service Defense
- **Location:** [server/src/crypto.ts#L87-L101](file:///d:/AAZIRA/AARIZO/server/src/crypto.ts#L87-L101)
- **Current Code:**
  ```typescript
  paramsStr.split(',').forEach((param) => {
    const [k, v] = param.split('=');
    if (k === 'N') N = parseInt(v, 10) || 16384;
    if (k === 'r') r = parseInt(v, 10) || 8;
    if (k === 'p') p = parseInt(v, 10) || 1;
  });
  ```
- **Vulnerability Analysis:**
  The envelope parser extracts $N, r, p$ directly from the stored database string. While memory is bounded by `maxmem: 64MB`, an attacker who manages to write a tampered hash into the database (e.g. with $N=32768, r=16, p=4$) could cause the verification loop to consume ~500ms of CPU per login attempt.
- **Severity:** Low (P3) / Defense-in-Depth
- **Minimal Recommended Remediation:**
  Enforce explicit bounds on parsed parameters:
  ```typescript
  N = Math.min(65536, Math.max(1024, N));
  r = Math.min(16, Math.max(1, r));
  p = Math.min(4, Math.max(1, p));
  ```

---

## 3. Summary & Remediation Priority

None of the four findings above represent an immediate exploit in the standard application runtime. ISSUE-05 is functionally remediated and ready for closure. Findings F-19 and F-20 should be scheduled for inclusion in Phase A Step 5.4 or the Phase A wrap-up hardening pass.

