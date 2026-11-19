# AARIZO — ISSUE-06 / Phase B.2.1 Final Closure Decision

**Project:** `D:\AAZIRA\AARIZO`  
**Phase:** ISSUE-06 — B.2.1 Child Safety Relational Database Foundation  
**Mode:** STRICT READ-ONLY FINAL INDEPENDENT RE-AUDIT  
**Audit Date:** November 18, 2026  

---

## 1. Explicit Final Verdict

> ### **CONDITIONAL PASS — only documented non-blocking risks remain**

Phase B.2.1 is **approved to close conditionally** and **approved to proceed to Phase B.2.2 (Child Safety Authoritative Backend API Implementation)**.

---

## 2. Rationale for `CONDITIONAL PASS`

- **All 7 originally blocking schema, security, and parity defects (`F-B21-01` through `F-B21-06` and `F-B21-08`) passed independent re-audit**, backed by direct source inspection, 15/15 passing DMMF/SQL-parser static tests, 311/311 passing offline regression tests, clean backend/frontend builds, and real live PostgreSQL 16 verification on a disposable isolated container (cleanly removed; `nexus-postgres` untouched).
- **Two non-blocking `PARTIAL` items are explicitly tracked as conditions prior to staging/production cutover (they do NOT block B.2.2 API development):**
  1. **Condition C-1 (`F-B21-07` — Pre-Cutover Backfill Hardening):** Before running [scripts/postgres/backfill_child_safety_b21.sql](file:///D:/AAZIRA/AARIZO/scripts/postgres/backfill_child_safety_b21.sql) against staging or production legacy data, harden three edge cases: (a) quarantine cross-society/cross-collection primary-key `id` collisions instead of silent `DO NOTHING` skipping; (b) quarantine malformed embedded `authorizedPickups[]` missing `name`/`phone`; (c) quarantine rows whose explicit `residentId` belongs to another society instead of falling back to another resident in the flat.
  2. **Condition C-2 (`F-B21-09` — CI Live-DB & `UPDATE`-Trigger Coverage):** Expand [tests/issue06_child_safety_db_constraints.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_db_constraints.test.ts) to explicitly assert `UPDATE` rejection on `trg_*_actor_tenant` and wire `AARIZO_ISOLATED_TEST_DATABASE_URL` into CI using a disposable PostgreSQL 16 service container.

---

## 3. Mandatory B.2.2 Handoff Contracts (Application Layer Requirements)

Phase B.2.2 backend API implementation **must** uphold the following database and security contracts (none implemented during B.2.1):

| Contract Area | Mandatory B.2.2 Requirement |
| :--- | :--- |
| **1. Authenticated Guardian Ownership** | Derive `userId`, `role`, `societyId`, and `residentId` exclusively from verified `req.authContext` (never `req.body.societyId`, never `'soc-gvs'` fallback). Residents may only manage `ChildProfile` / `ChildAuthorizedPickup` / `ChildGatePass` rows owned by their verified `residentId` (admins/secretaries scoped to their verified `societyId`). |
| **2. Tenant-Scoped Access & Flat Alignment** | Scope every query by verified `societyId` (fail closed if missing/empty for non-platform-admin). Inside `POST/PATCH /api/children` transactions, verify `resident.flatId === flatId` (or authorized multi-flat linkage) and synchronize `allowedSoloExit` with `exitPermissionMode`. |
| **3. Secure Bearer-Token Issuance & DTO Redaction** | Generate >= 256-bit CSPRNG raw bearer tokens (`crypto.randomBytes(32)`) on pass creation; store only server-keyed `HMAC-SHA256(CHILD_PASS_TOKEN_PEPPER, rawToken)` (64 lowercase hex chars) in `token_hash`. Return the raw token once at creation; **never** expose `tokenHash` in ordinary list/get responses. Treat `passCode` strictly as a display label (never standalone gate authorization), with retry on `23505` within `(society_id, pass_code)`. |
| **4. Atomic One-Time Pass Consumption & Replay Prevention** | Gate verification must execute inside a PostgreSQL transaction using conditional atomic `UPDATE child_gate_passes SET current_uses = current_uses + 1, first_used_at = COALESCE(first_used_at, NOW()), last_used_at = NOW(), status = CASE WHEN current_uses + 1 >= max_uses THEN 'USED' ELSE status END WHERE society_id = $1 AND token_hash = $2 AND status = 'ACTIVE' AND current_uses < max_uses AND valid_from <= NOW() AND valid_until > NOW()`, checking that the child has NO active `MISSING` status or active `MISSING_CHILD` alert before allowing exit. |
| **5. Expiry, Revocation & Rate Limiting** | Enforce per-guard/per-gate rate limiting on pass verification endpoints. Revocation (`PATCH/DELETE`) must atomically set `status = 'REVOKED'`, `revoked_at = NOW()`, `revoked_by_id = req.authContext.userId`, and emit realtime invalidation. |
| **6. Fail-Closed Gate Verification** | Never allow offline approval or client-side signature checking. Any backend/DB error or unreachable verification state must return an explicit indeterminate/unavailable error and log `ChildExitOutcome.VERIFICATION_UNAVAILABLE` + `ChildVerificationChannel.BACKEND_UNAVAILABLE` once connectivity returns. |
| **7. SOS Authorization & Persistent Incident Linkage** | Lock down `POST /api/children/sos` with verified authentication, society scoping, and role/ownership validation; atomically persist both `ChildSafetyAlert` (with `reportedById` + `reportedByName`) and linked `EmergencyIncident` (same `societyId`) plus update `ChildProfile.status = 'MISSING'` when `alertType = 'MISSING_CHILD'`. |
| **8. Audit Event Creation & Actor Attribution** | Every gate verification attempt (allowed, denied, missing-alert-blocked, unavailable) must write an immutable `ChildExitLog` row capturing both actor FK (`guardId`) and point-in-time name snapshots (`guardName`, `childName`, `flatNumber`, `pickupPersonName`). Every alert acknowledgement/resolution must populate both `acknowledgedById`/`resolvedById` and `acknowledgedByName`/`resolvedByName` plus timestamps. |

---

## 4. Related Final Audit Reports

- [AARIZO_ISSUE06_PHASE_B2_STEP21_FINAL_INDEPENDENT_AUDIT.md](file:///D:/AAZIRA/AARIZO/AARIZO_ISSUE06_PHASE_B2_STEP21_FINAL_INDEPENDENT_AUDIT.md)
- [AARIZO_ISSUE06_PHASE_B2_STEP21_FINAL_SECURITY_VERIFICATION.md](file:///D:/AAZIRA/AARIZO/AARIZO_ISSUE06_PHASE_B2_STEP21_FINAL_SECURITY_VERIFICATION.md)
- [AARIZO_ISSUE06_PHASE_B2_STEP21_FINAL_MIGRATION_VERIFICATION.md](file:///D:/AAZIRA/AARIZO/AARIZO_ISSUE06_PHASE_B2_STEP21_FINAL_MIGRATION_VERIFICATION.md)

