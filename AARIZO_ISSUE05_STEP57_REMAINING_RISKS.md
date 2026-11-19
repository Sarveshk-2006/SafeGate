# AARIZO — Phase A, Step 5.7: ISSUE-05 Remaining Risks & Architectural Observations

**Project:** `D:\AAZIRA\AARIZO`  
**Document Version:** 1.0.0  
**Audit Date:** 2026-11-17  
**Auditor Mode:** STRICT AUDIT ONLY — NO MODIFICATIONS  
**Target:** ISSUE-05 — Seeded Database Users Missing Password Hashes  
**Overall Verdict:** **READY FOR CONDITIONAL CLOSURE**

---

## 1. Executive Summary

This document captures architectural observations, residual operational risks, and future production deployment considerations following the remediation of ISSUE-05 (including Step 5.6 findings F-23 through F-27).

None of the items cataloged below represent blocking defects for Phase A or invalidate the conditional closure of ISSUE-05. They are documented here to provide transparent guidance for production operations, infrastructure scaling, and subsequent architectural phases.

---

## 2. Risk & Observation Registry

### Risk R-01: In-Memory Login Rate Limiting in Multi-Instance Deployments

- **Associated Finding:** F-25 (Login Rate Limiter)
- **Severity:** Low (Architectural / Operational)
- **File & Lines:** [server/src/auth.ts#L412-L439](file:///d:/AAZIRA/AARIZO/server/src/auth.ts#L412-L439)
- **Current Evidence:**
  ```typescript
  const loginAttemptCounts = new Map<string, { count: number; resetTime: number }>();

  export const loginRateLimiter = (maxRequests = 10, windowMs = 60000) => {
    return (req: Request, res: Response, next: NextFunction) => {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
  ```
- **Audit Assessment:** **PASS** (for single-node architecture; **PARTIAL** for horizontal multi-instance scaling)
- **Remaining Risk:**
  The `loginAttemptCounts` map is stored in Node.js process heap memory. In single-container deployments (current development, Docker Compose, and standalone host deployment), this functions effectively. However, if the service is horizontally autoscaled across multiple containers or cluster worker processes, each node maintains an isolated in-memory map. A malicious client could distribute requests across $N$ instances, effectively multiplying their allowed attempt budget by $N$ (e.g. 30 attempts per minute across 3 instances).
- **Minimal Recommended Correction (Future Operational Phase):**
  When horizontally scaling to a multi-instance cluster, back the rate limiter with a shared distributed store (such as Redis) using atomic `INCR` and `EXPIRE` operations, or enforce rate limiting at the reverse proxy / API gateway tier (e.g. Nginx `limit_req_zone`, AWS WAF, or Cloudflare).

---

### Risk R-02: Reverse Proxy IP Trust Configuration (`trust proxy`)

- **Associated Finding:** F-25 (IP Extraction Security)
- **Severity:** Low (Configuration / Deployment)
- **File & Lines:** [server/src/index.ts](file:///d:/AAZIRA/AARIZO/server/src/index.ts) & [server/src/auth.ts#L416](file:///d:/AAZIRA/AARIZO/server/src/auth.ts#L416)
- **Current Evidence:**
  ```typescript
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  ```
  `server/src/index.ts` does not invoke `app.set('trust proxy', ...)`.
- **Audit Assessment:** **PASS** (Secure default against spoofing)
- **Remaining Risk:**
  - *Direct Connections:* Clients cannot spoof `req.ip` by injecting arbitrary `X-Forwarded-For` headers because Express ignores forwarding headers when `trust proxy` is false.
  - *Reverse Proxy Deployment:* If the Node.js service is deployed behind an upstream reverse proxy (e.g. Nginx, Cloudflare, Traefik, or AWS ALB) without updating the configuration, `req.ip` will resolve to the IP address of the reverse proxy itself. Consequently, all external clients would share a single rate-limiting bucket.
- **Minimal Recommended Correction:**
  When deploying behind an upstream reverse proxy, configure `app.set('trust proxy', <proxy-hops-or-subnet>)` in `server/src/index.ts` according to the exact network topology, ensuring only trusted proxy headers are parsed.

---

### Risk R-03: Detached Background Rehash Concurrency Semaphore Accounting

- **Associated Finding:** F-24 / F-25 (Password Rehash Resource Bounding)
- **Severity:** Low (Performance / Resource Bounding)
- **File & Lines:** [server/src/index.ts#L1799-L1822](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L1799-L1822)
- **Current Evidence:**
  ```typescript
  if (needsRehash(user.passwordHash)) {
    const verifiedHash = user.passwordHash;
    (async () => {
      try {
        const upgradedSalt = generateSalt(16);
        const upgradedHash = await hashPasswordScryptAsync(password, upgradedSalt);
        const result = await prisma.user.updateMany({ ... });
  ```
- **Audit Assessment:** **PASS**
- **Remaining Risk:**
  While initial password verification (`verifyPasswordAsync`) strictly acquires and releases a permit from `authConcurrencyLimiter`, the subsequent background rehash operation (`hashPasswordScryptAsync`) runs detached from the semaphore. Because rehash only triggers after successful password verification (which is already rate-limited to 10 req/min per IP and gated by the initial semaphore permit), the probability of runaway background scrypt computations is low. However, during an initial migration wave of many distinct legacy users, background rehashes will consume libuv worker threads alongside normal verification requests.
- **Minimal Recommended Correction:**
  If a mass login of legacy users occurs during initial rollout, consider acquiring an `authConcurrencyLimiter` slot inside the background task, or configuring a dedicated queue for asynchronous credential upgrades.

---

### Risk R-04: Credential Tuple Matching (Salt Guard Defense-in-Depth)

- **Associated Finding:** F-24 (Optimistic Conditional Update)
- **Severity:** Low (Cryptographic Hygiene)
- **File & Lines:** [server/src/index.ts#L1805-L1814](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L1805-L1814)
- **Current Evidence:**
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
- **Audit Assessment:** **PASS**
- **Remaining Risk:**
  The `where` condition filters on `id` and `passwordHash`. Because `passwordHash` is a collision-resistant cryptographic digest incorporating the salt, any legitimate password or salt change invalidates `passwordHash: verifiedHash`, correctly preventing race condition clobbering. However, in the event of partial external data manipulation where `salt` was modified without updating `passwordHash`, the condition would still match.
- **Minimal Recommended Correction:**
  Add `salt: user.salt` to the `where` filter (`where: { id: user.id, passwordHash: verifiedHash, salt: user.salt }`) to bind the optimistic update to the complete credential tuple verified during login.

---

### Risk R-05: Client-Configurable PostgreSQL Custom GUC Boundary

- **Associated Finding:** F-23 (SQL Seed Isolation)
- **Severity:** Low (Operational Protocol)
- **File & Lines:** [scripts/postgres/03_seed.sql#L7-L15](file:///d:/AAZIRA/AARIZO/scripts/postgres/03_seed.sql#L7-L15)
- **Current Evidence:**
  ```sql
  current_env TEXT := lower(trim(coalesce(current_setting('aarizo.environment', true), '')));
  ...
  IF current_env NOT IN ('development', 'dev', 'test', 'local') THEN
    RAISE EXCEPTION ...
  ```
- **Audit Assessment:** **PASS**
- **Remaining Risk:**
  PostgreSQL custom GUC settings (`aarizo.environment`) are client-configurable via `SET aarizo.environment = '...';` or `PGOPTIONS`. A custom GUC provides a cooperative safeguard; it is not cryptographic proof that a database is non-production. If an operator with administrative access to a production database intentionally sets `aarizo.environment = 'development'`, the guard will pass.
- **Mitigating Controls Present:**
  1. Default `docker-compose.yml` does NOT mount `03_seed.sql`.
  2. `scripts/postgres/migrate.ts` automatically rejects `03_seed.sql` unless `NODE_ENV` is explicitly local and cloud indicators are absent.
  3. `HOST_DEPLOYMENT_GUIDE.md` explicitly omits `03_seed.sql` and includes caution warnings.
- **Minimal Recommended Correction:**
  Maintain strict operational role separation on production database servers; do not distribute `03_seed.sql` as part of production deployment container images or production deployment bundles.

---

### Risk R-06: Shared Libuv Threadpool Contention During High Hashing Bursts

- **Associated Finding:** F-25 (Asynchronous Scrypt)
- **Severity:** Low (Performance / Latency)
- **File & Lines:** [server/src/crypto.ts#L42-L48](file:///d:/AAZIRA/AARIZO/server/src/crypto.ts#L42-L48) & [server/src/auth.ts#L450-L455](file:///d:/AAZIRA/AARIZO/server/src/auth.ts#L450-L455)
- **Current Evidence:**
  Node.js defaults to `UV_THREADPOOL_SIZE = 4`. Target scrypt uses $N=131072, r=8, p=1$ (~350ms CPU execution time per hash).
- **Audit Assessment:** **PASS**
- **Remaining Risk:**
  When 4 concurrent login requests are processed simultaneously, all 4 libuv worker threads are saturated for ~350ms. During this window, other Node.js asynchronous tasks that rely on the libuv threadpool (such as asynchronous file I/O `fs.*`, DNS resolutions `dns.lookup`, and zlib compression) will experience a temporary latency delay until a worker thread is freed.
- **Minimal Recommended Correction:**
  In high-traffic production environments, configure `UV_THREADPOOL_SIZE=8` or `UV_THREADPOOL_SIZE=16` in the environment startup script (`process.env.UV_THREADPOOL_SIZE` must be set before Node starts, or via systemd/PM2 environment config) to ensure dedicated worker threads remain available for disk and DNS I/O.

---

### Risk R-07: Outstanding Operational Verification (PostgreSQL Offline)

- **Associated Finding:** General Operational Closure Requirement
- **Severity:** Informational (Operational Pending Step)
- **Evidence:**
  `docker ps` confirms that port 5432 on localhost is currently bound to container `nexus-postgres` (a separate project), while `aarizo_postgres` is not running.
- **Audit Assessment:** **NOT VERIFIED (OPERATIONAL ENVIRONMENT)**
- **Remaining Risk:**
  While all 49 focused unit tests, 242 full Jest tests, Prisma schema validations, and Docker Compose configurations pass, live execution against a dedicated PostgreSQL database container running `01_schema.sql`, `02_rls_policies.sql`, and Prisma migrations has not been executed in this audit turn because `aarizo_postgres` was not active.
- **Minimal Recommended Correction:**
  Retain ISSUE-05 status as **CONDITIONALLY VERIFIED & REMEDIATED**. Execute the live database container startup and schema smoke test once dedicated database infrastructure is booted.

---

## 3. Summary of Findings & Verdict

| Risk ID | Scope | Severity | Status | Action Required Before Production |
|---|---|---|---|---|
| **R-01** | In-Memory Rate Limiting | Low | PASS / Monitored | Migrate to Redis if horizontally autoscaling. |
| **R-02** | Express Reverse Proxy Trust | Low | PASS / Monitored | Configure `trust proxy` when behind ALB/Nginx. |
| **R-03** | Detached Rehash Accounting | Low | PASS | None required for current load. |
| **R-04** | Salt Guard in Conditional Update | Low | PASS | Minor tuple match enhancement in future refactor. |
| **R-05** | Custom GUC Boundary | Low | PASS | Do not distribute `03_seed.sql` to prod bundles. |
| **R-06** | Libuv Threadpool Contention | Low | PASS | Set `UV_THREADPOOL_SIZE=8` in production PM2/systemd. |
| **R-07** | Live PostgreSQL Smoke Test | Informational | PENDING | Run live smoke test upon database container boot. |

---

## 4. Overall Audit Verdict

**READY FOR CONDITIONAL CLOSURE**

No blocking defects or regressions exist in the codebase. All Step 5.6 security remediations (F-23, F-24, F-25, F-26, F-27) are independently verified in code, configurations, documentation, and automated tests. Full operational closure is conditional on live PostgreSQL startup and smoke testing.

