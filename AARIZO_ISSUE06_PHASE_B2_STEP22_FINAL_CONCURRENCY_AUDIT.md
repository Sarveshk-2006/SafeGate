# AARIZO — ISSUE-06 PHASE B.2.2 FINAL CONCURRENCY & TRANSACTION AUDIT

**Project:** `D:\AAZIRA\AARIZO`  
**Findings Re-Audited:** `F-B22-05` & `F-B22-06A`  
**Date:** 2026-11-18  
**Status:** **`PASS`** *(Independently Verified by Code Inspection & Live PostgreSQL 16)*

---

## 1. SQL Row-Lock & Lock-Hierarchy Inspection

Inspected `lockChildProfileRow()` at [server/src/childSafety/router.ts#L75-L96](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L75-L96):

```sql
SELECT status::text AS status, archived_at
FROM child_profiles
WHERE id = $1 AND society_id = $2
FOR UPDATE
```

### Lock Acquisition Order Across Competing Transactions
| Operation | Transaction Scope | First Row Lock Acquired | Subsequent Writes | Deadlock Risk |
| --- | --- | --- | --- | --- |
| `POST /api/children/passes/verify` & `/:id/verify` ([router.ts#L468-L785](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L468-L785)) | `prisma.$transaction` | `child_profiles` (`FOR UPDATE`, line 519) | Reads `activeMissingAlert`, conditional `childGatePass.updateMany` (`status='ACTIVE'`, `currentUses=pass.currentUses`), `childProfile.updateMany` (`status='SAFE' -> 'OUT_OF_SOCIETY'`, asserts `count === 1`), `childExitLog.create` | **None** (`child_profiles` locked first) |
| `POST /api/children/sos` ([router.ts#L1199-L1264](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L1199-L1264)) | `prisma.$transaction` | `child_profiles` (`FOR UPDATE`, line 1202) | Re-checks archived status, checks existing `ACTIVE`/`ACKNOWLEDGED` `MISSING_CHILD` alert, `emergencyIncident.create`, `childSafetyAlert.create`, `childProfile.updateMany` (`status='MISSING'`) | **None** (`child_profiles` locked first) |
| `POST /api/children/alerts/:id/resolve` ([router.ts#L1518-L1579](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L1518-L1579)) | `prisma.$transaction` | `child_profiles` (`FOR UPDATE`, line 1520) | Conditional `childSafetyAlert.updateMany`, `emergencyIncident.updateMany`, recount remaining active `MISSING_CHILD` alerts, restore `childProfile` `MISSING -> SAFE` if `0` | **None** (`child_profiles` locked first) |

- **Update Count Assertions Verified:**
  - `verify`: `consumed.count !== 1` returns `409 PASS_ALREADY_CONSUMED` (line 719); `childUpdated.count !== 1` throws `CONCURRENT_CHILD_STATE_CONFLICT` rolling back the transaction and returning `409 CHILD_STATE_CONFLICT` (lines 744–746, 857–864).
  - `resolve`: `updated.count !== 1` returns `null` -> `409 ALERT_STATE_CONFLICT` (lines 1538–1540, 1581–1586).

---

## 2. Race Scenario Evaluation

| Scenario | Evidence & Verification Classification | Observed / Proven Outcome | Status |
| --- | --- | --- | --- |
| **A & B. Concurrent `MISSING_CHILD` SOS vs Gate Verification** | *Independently reproduced against live PostgreSQL* (`issue06_child_safety_api_pg_integration.test.ts` Test 3 on isolated PG 16 port `5443`, 124 ms) | Both serializable orderings produce consistent final DB state (`child_profiles.status === 'MISSING'`): if SOS acquires lock first, verify sees `MISSING` and returns `409 CHILD_MISSING_ALERT_BLOCKED` (`current_uses = 0`); if verify acquires lock first, verify succeeds (`200 ALLOWED`, `current_uses = 1`) and SOS then sets `MISSING`. `MISSING` is **never** overwritten to `OUT_OF_SOCIETY`. | **PASS** |
| **C. Two Concurrent `MISSING_CHILD` SOS Requests** | *Independently reproduced against live PostgreSQL* (Test 4 on isolated PG 16 port `5443`, 137 ms) | Statuses strictly `[201, 409]` (`DUPLICATE_ACTIVE_SOS_ALERT`), exactly `1` active `child_safety_alerts` row and `1` `emergency_incidents` row; after alert resolution, a fresh SOS succeeds (`201`). | **PASS** |
| **D. Two Concurrent Gate Verification Requests (`maxUses = 1`)** | *Independently reproduced against live PostgreSQL* (Test 1 on isolated PG 16 port `5443`, 306 ms) | Statuses strictly `[200, 409]` (`PASS_ALREADY_CONSUMED`), `current_uses === 1`, `status === 'USED'`, exactly `1` `ALLOWED` exit log. | **PASS** |
| **E. Concurrent SOS vs Alert Resolution** | *Independently verified by code inspection* (not yet covered by a dedicated live concurrency test) | Both transactions lock the exact same `child_profiles` row via `lockChildProfileRow()` first; if `resolve` commits first, `SOS` observes zero active alerts and creates a new incident; if `SOS` runs while alert is still `ACTIVE`, `SOS` sees existing active alert and returns `409`. | **PASS (Code Verified; Test Recommended)** |
| **F. Transaction Failure After Lock Acquisition (Partial SOS Failure)** | *Independently reproduced against live PostgreSQL* (Test 5 on isolated PG 16 port `5443`, 125 ms) | Real PostgreSQL `BEFORE INSERT` trigger aborts `child_safety_alerts` insert after `emergency_incidents` insert -> HTTP `500` sanitized response; `0` orphaned `emergency_incidents`, `0` `child_safety_alerts`, `child_profiles.status === 'SAFE'`, lock released cleanly, zero SSE events published. | **PASS** |

---

## 3. Non-Blocking Hardening Observations

1. **Database-Layer Uniqueness for Active `MISSING_CHILD` Alerts (`F-B22-06A`):** Application-layer `FOR UPDATE` locking on `child_profiles` prevents concurrent duplicate active `MISSING_CHILD` alerts through the API, but adding a PostgreSQL partial unique index `CREATE UNIQUE INDEX uq_active_missing_child_alert ON child_safety_alerts (society_id, child_id) WHERE alert_type = 'MISSING_CHILD' AND status IN ('ACTIVE', 'ACKNOWLEDGED') AND child_id IS NOT NULL` is recommended as future DB defense-in-depth.
2. **Pre-Lock Snapshot of `pickupPerson` & `exitPermissionMode` in `verify`:** `pass` (with `pickupPerson` and `child`) is fetched at line 469 before `lockChildProfileRow` at line 519. Concurrent pickup revocation or child archival still cascades `status = 'REVOKED'` to active passes, which `tx.childGatePass.updateMany({ where: { status: 'ACTIVE' } })` rejects atomically (`count = 0`). Re-reading `exitPermissionMode` inside `lockChildProfileRow` would close even the sub-millisecond policy-change window.
3. **Add Live `SOS vs Alert Resolve` Concurrency Test:** Recommend adding a live PG 16 `Promise.all([sos, resolve])` test in the next pass alongside the `F-B22-01` and `F-B22-02` fixes.

