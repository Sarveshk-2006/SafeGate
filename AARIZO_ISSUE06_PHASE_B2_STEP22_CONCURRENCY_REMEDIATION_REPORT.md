# AARIZO — ISSUE-06 PHASE B.2.2 CONCURRENCY & TRANSACTION REMEDIATION REPORT

**Project:** `D:\AAZIRA\AARIZO`  
**Findings Addressed:** `F-B22-05` (SOS vs Gate Pass Verification Race), `F-B22-06A` (Concurrent Duplicate `MISSING_CHILD` SOS), `F-B22-07` (Live PG SOS Rollback Proof)  
**Date:** 2026-11-18  
**Status:** **`REMEDIATION COMPLETE — READY FOR INDEPENDENT RE-AUDIT`**

---

## 1. Concurrency Hazards Previously Identified

1. **`F-B22-05` — Interleaved `POST /api/children/sos` (`MISSING_CHILD`) and `POST /api/children/passes/verify`:**
   - Gate verification previously read `pass.child.status` *before* acquiring any lock on `child_profiles`, while `POST /sos` mutated `child_profiles.status = 'MISSING'` concurrently.
   - Under `READ COMMITTED`, two simultaneous requests could allow a gate exit based on a stale `SAFE` snapshot and then overwrite `child_profiles.status` from `MISSING` to `OUT_OF_SOCIETY` — silently masking an active missing-child emergency.
2. **`F-B22-06A` — Concurrent Duplicate `MISSING_CHILD` SOS Submissions:**
   - Two rapid/concurrent SOS triggers for the same child created duplicate `ACTIVE` `child_safety_alerts` and duplicate `emergency_incidents` rows.
3. **`F-B22-07` — Unproven Live PostgreSQL Rollback on Partial SOS Write Failure:**
   - Previous rollback coverage only ran against mocked Prisma, without proving true PostgreSQL multi-statement transaction rollback when `child_safety_alerts` fails after `emergency_incidents` has been inserted.

---

## 2. Implemented Row-Level Serialization Strategy

Added `lockChildProfileRow(tx, childId, societyId)` in [server/src/childSafety/router.ts](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L75-L96):

```sql
SELECT status::text AS status, archived_at
FROM child_profiles
WHERE id = $1 AND society_id = $2
FOR UPDATE
```

### 2.1 Lock Ordering & Deadlock Avoidance
All three transactional mutators acquire the `child_profiles` row lock **first** inside `prisma.$transaction(...)` before mutating child status, alerts, or gate passes:

| Endpoint | Lock Acquired First | Subsequent Transactional Checks & Writes | Conflict / Failure Behavior |
| --- | --- | --- | --- |
| `POST /api/children/passes/verify` & `/:id/verify` | `child_profiles` (`FOR UPDATE`) | Re-reads locked `effectiveChildStatus` & `effectiveChildArchivedAt` BEFORE `MISSING` / `ARCHIVED` checks; atomically increments `child_gate_passes.current_uses` with `WHERE status = 'ACTIVE' AND current_uses < max_uses`; updates `child_profiles.status = 'OUT_OF_SOCIETY'` strictly with `WHERE status = 'SAFE' AND archived_at IS NULL` (asserting `count === 1` when `effectiveChildStatus === 'SAFE'`). | If `effectiveChildStatus === 'MISSING'`: logs `BLOCKED_MISSING_ALERT` exit log, leaves pass unused, returns `409 CHILD_MISSING_ALERT_BLOCKED`. If status drifted concurrently: throws `CONCURRENT_CHILD_STATE_CONFLICT` -> transaction rolls back -> `409 CHILD_STATE_CONFLICT`. |
| `POST /api/children/sos` | `child_profiles` (`FOR UPDATE`) when `childId` present | Re-checks locked `archivedAt` / `ARCHIVED`; for `alertType === 'MISSING_CHILD'`, checks for any `ACTIVE` or `ACKNOWLEDGED` `MISSING_CHILD` alert on `(societyId, childId)`; atomically creates `EmergencyIncident`, `ChildSafetyAlert`, and sets `child_profiles.status = 'MISSING'`. | If archived: `409 CHILD_ARCHIVED`. If active `MISSING_CHILD` alert exists: `409 DUPLICATE_ACTIVE_SOS_ALERT` returning `activeAlert` with zero incident creation & zero realtime events. On any DB write error: entire transaction rolls back cleanly. |
| `POST /api/children/alerts/:id/resolve` | `child_profiles` (`FOR UPDATE`) when `alert.childId` present | Atomically transitions alert (`ACTIVE`/`ACKNOWLEDGED` -> `RESOLVED`/`FALSE_ALARM`), resolves linked `EmergencyIncident`, recounts remaining active `MISSING_CHILD` alerts, and restores `child_profiles.status = 'SAFE'` only if `remainingMissing === 0`. | If already resolved concurrently: `409 ALERT_STATE_CONFLICT`. |

Because every path locks `child_profiles` first (single consistent lock hierarchy) before touching `child_gate_passes` or `child_safety_alerts`, lock-order inversion deadlocks between `verify`, `sos`, and `resolve` are structurally prevented.

---

## 3. Live Isolated PostgreSQL 16 Verification Results

Executed against a virgin `postgres:16-alpine` container (`127.0.0.1:5442`) with all 6 Prisma migrations applied ([tests/issue06_child_safety_api_pg_integration.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_api_pg_integration.test.ts)):

| Live PG 16 Concurrency / Atomicity Test | Execution Pattern | Verified PostgreSQL Outcome | Result |
| --- | --- | --- | --- |
| **Test 1:** Concurrent one-time gate pass consumption | `Promise.all([verify, verify])` (`maxUses = 1`) | Statuses strictly `[200, 409]`, `current_uses === 1`, `status === 'USED'`, exactly `1` `ALLOWED` `child_exit_logs` row | **PASS** (353 ms) |
| **Test 3 (`F-B22-05`):** Concurrent `MISSING_CHILD` SOS vs `POST /passes/verify` | `Promise.all([sos, verify])` on same `childId` | Final `child_profiles.status === 'MISSING'` in ALL serializable orderings (never overwritten to `OUT_OF_SOCIETY`); if SOS wins, verify returns `409 CHILD_MISSING_ALERT_BLOCKED` with `current_uses === 0`; if verify wins, verify returns `200 ALLOWED` (`current_uses === 1`) and SOS then sets `MISSING` | **PASS** (162 ms) |
| **Test 4 (`F-B22-06A`):** Concurrent duplicate `MISSING_CHILD` SOS | `Promise.all([sos, sos])` on same `childId` | Statuses strictly `[201, 409]` (`DUPLICATE_ACTIVE_SOS_ALERT`), exactly `1` active `child_safety_alerts` row; after `POST /alerts/:id/resolve`, subsequent `MISSING_CHILD` SOS returns `201` | **PASS** (224 ms) |
| **Test 5 (`F-B22-07`):** Real PostgreSQL transaction `ROLLBACK` on partial SOS failure | Temporary PG `BEFORE INSERT` trigger aborts `child_safety_alerts` insert after `emergency_incidents` insert | HTTP `500` sanitized response; PostgreSQL verification confirms `0` orphaned `emergency_incidents`, `0` `child_safety_alerts`, and `child_profiles.status === 'SAFE'` | **PASS** (212 ms) |

