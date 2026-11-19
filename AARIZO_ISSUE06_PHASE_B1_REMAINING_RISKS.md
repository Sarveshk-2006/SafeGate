# AARIZO — ISSUE-06, Phase B.1: Post-Remediation Remaining Risks & Operational Evaluation

**Target:** `ISSUE-06` — Phase B.1: Visitor Pass Authoritative API  
**Mode:** POST-REMEDIATION AUDIT  
**Date:** 2026-11-17  
**Workspace:** `D:\AAZIRA\AARIZO`  

---

## 1. Executive Summary

Phase B.1 remediated all five findings (`F-B1-01`, `F-B1-03`, `F-B1-04`, `F-B1-05`, `F-B1-06`) identified during the independent audit. The Visitor Pass lifecycle is now backed by authoritative PostgreSQL endpoints with fail-closed tenant isolation, indexed database lookups, safe offline handling, and realtime burst deduplication.

This document details:
1. Operational environment constraints (host port conflict and live database validation).
2. Domain boundaries strictly deferred to Phase B.2 and B.3.
3. Edge cases and mitigation strategies.
4. Concrete recommendations and architectural patterns for Phase B.2.

---

## 2. Operational & Environmental Risks

### R-01: Live Database Infrastructure Host Port Conflict
- **Status:** **ACTIVE / REQUIRES ISOLATED TEST HARNESS**
- **Description:** Port 5432 on the host system is occupied by an unrelated Docker container (`nexus-postgres`). As mandated by operating instructions, this external container must not be stopped, removed, restarted, or modified.
- **Current Mitigation:**
  - Automated Jest and Supertest test suites (296 tests) run with hermetic Prisma in-memory mocks.
  - Zero assumptions made about live database availability during test execution.
- **Live Database Validation Requirement:**
  - Similar to Step 5.8 for ISSUE-05, before ISSUE-06 can be formally closed in the Master Issue Register, live database validation must be executed against a verified isolated test database (e.g. running on an alternate port such as 5433 or an isolated Docker compose network) to validate:
    1. Foreign key constraints on `societyId` and `residentId`.
    2. Compound index performance on `[societyId, passCode]`, `[societyId, qrCodeHash]`, and `[societyId, phone]`.
    3. ACID transaction locking under simultaneous gate check-in attempts.

---

## 3. Scope Boundaries & Deferred Work

### R-02: Child Safety & Pickup QR State Desynchronization (Deferred to Phase B.2)
- **Status:** **STRICTLY DEFERRED TO PHASE B.2**
- **Description:** In strict adherence to prompt rules ("Do not begin B.2"), `childSafetyService.ts` and `ChildSafetyRepository.ts` were left completely untouched in Phase B.1. They continue to persist pickup passes to `localStorage` and fire unawaited background syncs.
- **Risk:** Parents creating child pickup passes on mobile devices may still experience state desynchronization until Phase B.2 establishes authoritative `/api/children` endpoints.
- **Remediation Plan:** Phase B.2 will replicate the authoritative REST API architecture established in B.1.

### R-03: Society, Flat & Resident Provisioning Synchronization (Deferred to Phase B.3)
- **Status:** **STRICTLY DEFERRED TO PHASE B.3**
- **Description:** `societyService.ts`, `FlatRepository.ts`, and `db.ts` were left untouched. Society, tower, and flat mutations still operate with dual-write divergence between IndexedDB/localStorage and backend SQL.
- **Remediation Plan:** Phase B.3 will migrate administrative setup and flat management to authoritative `/api/societies`, `/api/towers`, and `/api/flats` endpoints.

### R-04: Offline Outbox & Background Sync (Future Enhancement)
- **Status:** **DOCUMENTED ARCHITECTURAL ENHANCEMENT**
- **Description:** Under the remediation of `F-B1-04`, gate check-in strictly fails closed when the server is unreachable, and offline cached passes cannot authorize gate entry (`canAuthorizeEntry: false`).
- **Future Enhancement:** For remote gates with intermittent connectivity, an encrypted IndexedDB offline mutation outbox with cryptographic gate signatures and automated background replay (`navigator.onLine` / ServiceWorker sync) can be introduced in Phase C.

---

## 4. Edge Cases & Concurrency Analysis

| Scenario | Potential Risk | Mitigation Applied in Phase B.1 | Residual Risk Level |
| :--- | :--- | :--- | :--- |
| **Client / Server Clock Skew** | Pass appears valid on client but expired on server (or vice versa). | Verification strictly evaluates `validFrom` and `validTo` against server clock. Offline validation explicitly returns `canAuthorizeEntry: false`. | **LOW (Mitigated)** |
| **Network Drop During Mutation** | Check-in succeeds on server but network drops before response reaches terminal. | Re-attempt returns 409 `ALREADY_CHECKED_IN`. UI handles 409 by refreshing current pass state from server. | **LOW (Handled)** |
| **Rapid SSE Burst from Guard Gates** | Multiple guards scanning at different gates triggers rapid SSE storm. | 300ms debounce window collapses rapid events; monotonic request counter discards stale responses. | **LOW (Handled)** |
| **Cross-Tenant Society ID Tampering** | Malicious actor injects `x-society-id` header or body `societyId`. | Server completely ignores client headers/body and binds `req.societyId` exclusively to authenticated token claims. Non-admins cannot operate cross-society. | **NONE (Fail-Closed)** |

---

## 5. Architectural Recommendations for Phase B.2 (Child Safety)

Based on the lessons learned from the Phase B.1 implementation and audit cycle, the following practices must be applied directly from day one of Phase B.2:

1. **Immediate Supertest Integration Coverage:**
   - Author route-level Supertest tests alongside the endpoint handlers, ensuring request validation, tenant isolation, and error status codes are verified before initiating audits.
2. **Fail-Closed Tenant Scoping from the Start:**
   - Apply `if (!isPlatformAdmin(req) && !req.societyId) return res.status(403).json({ error: 'Tenant context required', code: 'TENANT_CONTEXT_REQUIRED' });` to every single Child Safety endpoint (`/api/children`, `/api/pickup-passes`).
3. **Compound Database Indexing:**
   - Ensure child pickup verification queries (`/api/pickup-passes/verify`) query by indexed keys (`societyId`, `pickupCode`, `qrCodeHash`) via `prisma.childPickupPass.findFirst`, avoiding any unbounded `findMany` memory scanning.
4. **Monotonic Request Ordering & Debounce on UI:**
   - Incorporate `latestRequestIdRef` and debounced SSE refresh hooks directly into parent and guard child-safety views.

---

## 6. Closure Status & Readiness Verdict

Phase B.1 remediation is complete, with all 5 targeted findings resolved, 0 regressions, and 296/296 tests passing.

**Verdict:** **READY FOR INDEPENDENT RE-AUDIT**
