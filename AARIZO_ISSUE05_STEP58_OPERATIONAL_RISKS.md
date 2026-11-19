# AARIZO — Phase A, Step 5.8: ISSUE-05 Operational Risks & Infrastructure Blocker Report

**Project:** `D:\AAZIRA\AARIZO`  
**Document Version:** 1.0.0  
**Audit Date:** 2026-11-17  
**Auditor Mode:** STRICT VALIDATION & AUDIT  
**Target:** ISSUE-05 — Seeded Database Users Missing Password Hashes (Live Validation Phase)  
**Final Verdict:** **CONDITIONALLY VERIFIED — LIVE DATABASE INFRASTRUCTURE UNAVAILABLE**

---

## 1. Executive Summary

During Step 5.8 Live Database Validation, an infrastructure blocker prevented the live execution of the PostgreSQL database container. Specifically, the host machine's port `5432` is occupied by an external project container (`nexus-postgres`).

This document catalogs the operational risks arising from this infrastructure contention and provides actionable recommendations for the infrastructure operator to enable live end-to-end database validation without compromising host safety or other co-located projects.

---

## 2. Detailed Operational Risks

### Risk OP-01: Host Port 5432 Contention with External Container (`nexus-postgres`)

- **Risk Level:** **High (Operational Blocker)**
- **Scope:** Local Docker Development & CI/CD Runners
- **Affected Files:** [docker-compose.yml#L14](file:///d:/AAZIRA/AARIZO/docker-compose.yml#L14)
- **Observed Behavior:**
  Running `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres` fails with:
  ```
  Error response from daemon: failed to set up container networking: driver failed programming external connectivity on endpoint aarizo_postgres: Bind for 0.0.0.0:5432 failed: port is already allocated
  ```
- **Root Cause:**
  1. `docker-compose.yml` hardcodes host port `5432:5432`.
  2. The local Docker host is shared with another active project running container `nexus-postgres` (`pgvector/pgvector:pg16`), which is actively listening on `0.0.0.0:5432`.
  3. Strict safety rules forbid stopping, removing, or modifying `nexus-postgres`.
- **Operational Impact:**
  Developers or automated runners cannot execute standard `docker compose up` commands out-of-the-box on developer workstations where another PostgreSQL instance already binds port `5432`.
- **Actionable Remediation Options:**
  - *Option A (Recommended for Multi-Project Workstations):* Parameterize the host port mapping in `docker-compose.yml`:
    ```yaml
    ports:
      - "${AARIZO_PG_PORT:-5432}:5432"
    ```
    This permits developers on shared machines to specify `AARIZO_PG_PORT=5435` in their `.env` file without modifying source code or colliding with default port 5432.
  - *Option B (Dedicated Environment):* Run AARIZO integration and staging workloads in an isolated container environment or VM where port 5432 is dedicated solely to AARIZO.

---

### Risk OP-02: Live Seeding & Network Authentication Smoke Test Deferred

- **Risk Level:** **Medium (Operational Validation Gap)**
- **Scope:** Deployment Verification
- **Audit Assessment:** **CONDITIONALLY VERIFIED VIA AUTOMATED TESTS (242/242 PASSING)**
- **Observed Behavior:**
  Because the database container could not be booted on port 5432, live TCP socket queries against an active PostgreSQL 16 engine (such as applying `01_schema.sql`, verifying the PL/pgSQL guard exception via `psql`, and authenticating live HTTP clients over TCP) could not be executed during this step.
- **Mitigating Factors:**
  1. Schema DDL syntax and column compatibility are verified via `prisma validate` and Prisma Client compilation.
  2. The PL/pgSQL guard logic and whitelist validation are verified via 49 dedicated Jest tests in `tests/issue05_secure_seed_auth.test.ts`.
  3. Authentication logic, rate limiting, concurrency semaphores, and generic 401 account enumeration defenses are verified across 242 global unit and integration tests.
- **Actionable Remediation:**
  Execute the final live smoke test script (connecting via `psql` and testing `/api/auth/login`) as the first step of staging environment deployment once an isolated database instance is allocated.

---

### Risk OP-03: In-Memory Rate Limiting Scaling Constraint

- **Risk Level:** **Low (Horizontal Scaling Consideration)**
- **Scope:** Multi-Instance Production Deployments
- **Affected File:** [server/src/auth.ts#L412-L439](file:///d:/AAZIRA/AARIZO/server/src/auth.ts#L412-L439)
- **Observed Behavior:**
  `loginRateLimiter` maintains rate limiting counters in a local JavaScript `Map` inside the Node.js process heap memory.
- **Operational Risk:**
  In a single-instance container, this enforces a strict 10 requests/minute per IP budget. If the backend is horizontally scaled across multiple pods or PM2 cluster workers without an external proxy rate limiter, the attempt budget is multiplied by the number of active worker processes.
- **Actionable Remediation:**
  When deploying a multi-replica production cluster, back rate-limiting buckets with Redis (using atomic `INCR` and `EXPIRE`) or enforce connection limits at the edge API gateway (e.g. Nginx, Cloudflare, AWS WAF).

---

### Risk OP-04: Upstream Reverse Proxy Configuration (`trust proxy`)

- **Risk Level:** **Low (Reverse Proxy Deployment Consideration)**
- **Scope:** Cloud & Production Host Deployment
- **Affected File:** [server/src/index.ts](file:///d:/AAZIRA/AARIZO/server/src/index.ts) & [server/src/auth.ts#L416](file:///d:/AAZIRA/AARIZO/server/src/auth.ts#L416)
- **Observed Behavior:**
  `server/src/index.ts` does not configure `app.set('trust proxy', ...)`.
- **Operational Risk:**
  - *Direct Connections:* Secure by default. `req.ip` resolves from the socket address; clients cannot spoof IP via `X-Forwarded-For`.
  - *Behind Reverse Proxy:* If deployed behind Nginx, Traefik, or AWS ALB without enabling `trust proxy`, all incoming requests will appear to originate from the proxy's IP, collapsing all external clients into a single shared rate-limiting bucket.
- **Actionable Remediation:**
  Document the required `trust proxy` setting in the production deployment runbook for teams deploying behind a reverse proxy.

---

### Risk OP-05: Libuv Threadpool Allocation Under High Authentication Loads

- **Risk Level:** **Low (Performance / Threadpool Contention)**
- **Scope:** Production Workload Sizing
- **Affected Files:** [server/src/crypto.ts#L42-L48](file:///d:/AAZIRA/AARIZO/server/src/crypto.ts#L42-L48) & [server/src/auth.ts#L450-L455](file:///d:/AAZIRA/AARIZO/server/src/auth.ts#L450-L455)
- **Observed Behavior:**
  Target scrypt ($N=131072, r=8, p=1$) consumes ~350ms of CPU per hash and runs on libuv worker threads.
- **Operational Risk:**
  With Node.js's default `UV_THREADPOOL_SIZE = 4`, 4 simultaneous login requests saturate all worker threads for ~350ms. Asynchronous file system calls (`fs.*`) and DNS lookups (`dns.lookup`) will queue until worker threads are released.
- **Actionable Remediation:**
  In production environment startup scripts (systemd service file, Dockerfile `CMD`, or PM2 `ecosystem.config.js`), set:
  ```bash
  export UV_THREADPOOL_SIZE=8
  ```
  This guarantees that 4 threads remain available for disk and network I/O even when the authentication concurrency limiter is fully saturated at 4 permits.

---

## 3. Summary of Operational Risks & Status

| Risk ID | Title | Risk Level | Status | Next Action |
|---|---|---|---|---|
| **OP-01** | Port 5432 Host Contention | **High** | **Active Blocker** | Parameterize port in Compose or use dedicated host. |
| **OP-02** | Live Database Smoke Test | **Medium** | **Deferred** | Execute live smoke test upon database boot. |
| **OP-03** | In-Memory Rate Limiter | Low | Monitored | Use Redis if horizontally autoscaling. |
| **OP-04** | Reverse Proxy IP Trust | Low | Monitored | Configure `trust proxy` behind ALB/Nginx. |
| **OP-05** | Libuv Threadpool Sizing | Low | Monitored | Set `UV_THREADPOOL_SIZE=8` in production config. |

---

## 4. Final Verdict

**CONDITIONALLY VERIFIED — LIVE DATABASE INFRASTRUCTURE UNAVAILABLE**

All application code, schema definitions, migration scripts, and authentication hardening are verified and passing 100% of automated tests. ISSUE-05 is conditionally verified and ready for live database validation as soon as an unconflicted database environment is provisioned.

