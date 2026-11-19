# AARIZO — ISSUE-06 PHASE B.2.2 TARGETED REMEDIATION REPORT (POST RE-AUDIT)

**Project:** `D:\AAZIRA\AARIZO`  
**Phase:** ISSUE-06 — Phase B.2.2 (Targeted Remediation After Independent Re-Audit)  
**Date:** 2026-11-18  
**Remediation Status:** **`REMEDIATION COMPLETE — READY FOR FINAL INDEPENDENT RE-AUDIT`**  
*(Phase B.2.2 is **NOT** declared closed; ISSUE-06 remains open; Phase B.2.3 has **NOT** begun.)*

---

## 1. Executive Summary

Every confirmed residual finding from the Phase B.2.2 Independent Re-Audit (**`F-B22-01A`**, **`F-B22-01B`**, **`F-B22-01C`**, **`F-B22-02A`**, **`F-B22-02B`**, **`F-B22-02C`**) — plus an additional unscoped direct-ID `EntityRecord` route discovered during backend-wide enumeration (`POST /api/housekeeping/garbage-logs/confirm`) and the unprotected `GET /api/emergency-incidents` endpoint — has been remediated and verified with focused offline tests and live isolated PostgreSQL 16 exploit-closure + concurrency tests (`F-B22-07`).

---

## 2. Finding-by-Finding Evidence Summary

| Finding ID | Original Reproduction | Root Cause | Files & Functions Changed | Security Behavior Before vs After | Regression Tests Added | Execution Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| **`F-B22-01A`** | `vendor` called `GET /api/collections/entityRecord` & `/entityRecord/:id` -> HTTP `200`, leaking seeded `child_profiles` row. | `ALLOWED_QUERY_TABLES` native dispatch matched `entityRecord` and queried `prisma.entityRecord` without excluding Child Safety collections. | [server/src/index.ts](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L4181-L4445) (`resolveNativeCollectionModel`, `GET/POST/PUT/PATCH/DELETE /api/collections/:collection(/:id)`) | **Before:** Dumped all `entity_records` including `child_profiles`. **After:** List queries enforce `collection: { notIn: BLOCKED_CHILD_SAFETY_RAW_NAMES }` + normalized post-filter; detail returns `403 CHILD_SAFETY_COLLECTION_FORBIDDEN` for same-society child rows and `404` for cross-society rows (zero oracle); generic writes to `entityRecord` blocked `403 RESTRICTED_COLLECTION_WRITE`; unrelated `announcements` preserved. | `issue06_child_safety_reaudit_fixes.test.ts` (3 tests) + Live PG 16 Test 8 | Offline PASS + Live PG 16 PASS |
| **`F-B22-01B`** | `vendor` called `GET /api/collections/emergencyIncident` -> HTTP `200`, leaking `CHILD_SAFETY` SOS incidents. | Generic native Prisma dispatch omitted `ALLOWED_QUERY_TABLES[nativeKey]` role checks; `GET /api/emergency-incidents` also lacked role/resident filtering. | [server/src/index.ts](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2288-L2345), [index.ts#L4198-L4455](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L4198-L4455) (`enforceNativeModelRolePolicy`, `GET /api/emergency-incidents`, `POST /api/:table/query`) | **Before:** Any role read any `ALLOWED_QUERY_TABLES` model via `/api/collections/:model`. **After:** Role policy strictly enforced before every native query (`403 INSUFFICIENT_PERMISSIONS` for `vendor`/`facility_manager` on `emergencyIncident` & `auditLog`); `resident` queries exclude `incidentType: 'CHILD_SAFETY'`; authorized `guard`/`secretary`/`admin` preserved. | `issue06_child_safety_reaudit_fixes.test.ts` (4 tests) + Live PG 16 Test 8 | Offline PASS + Live PG 16 PASS |
| **`F-B22-01C`** | `facility_manager` called `PATCH /api/housekeeping/tasks/<childId>` -> HTTP `200`, mutating a `child_profiles` `EntityRecord`. | Five direct-ID routes called `prisma.entityRecord.findUnique({ where: { id } })` without `collection` or `societyId` scoping (`housekeeping/tasks/:id`, `amenities/bookings/:id/cancel`, `housekeeping/garbage-logs/confirm`, `amenities/:id/availability`, `amenities/:id/book`). | [server/src/index.ts](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L1888-L2165), [index.ts#L3044-L3125](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L3044-L3125) | **Before:** Any matching `EntityRecord` ID (including `child_profiles` or cross-society records) could be read/mutated. **After:** All 5 routes use scoped `findFirst({ where: { id, collection, societyId } })` + scoped `updateMany`, resident ownership checks on booking cancellation, and role checks on garbage confirmation (`404`/`403` on non-matching records; legitimate workflows preserved). | `issue06_child_safety_reaudit_fixes.test.ts` (3 tests) + Live PG 16 Test 8 | Offline PASS + Live PG 16 PASS |
| **`F-B22-02A`** | `vendor` in `soc-a` called `POST /api/realtime/broadcast` with `societyId: 'soc-b'`, `eventType: 'CHILD_SAFETY_SOS_TRIGGERED'`, forged `_audience` -> HTTP `200`, persisted forged outbox row. | Route lacked role allowlist, trusted `req.body.societyId` + `'soc-gvs'` fallback, and spread raw `req.body.payload` verbatim. | [server/src/index.ts](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L213-L360) (`POST /api/realtime/broadcast`, `isBroadcastEventAllowedForRole`, `broadcastEvent`) | **Before:** Any user could broadcast any event into any society with forged `_audience`. **After:** Deny-by-default role + event-prefix allowlist (`vendor`/`resident` `403`); protected `CHILD_*`/`EMERGENCY_INCIDENT_*`/`SOS_*`/`GATE_PASS_*` forbidden (`403`); `_audience` metadata rejected (`400`); society derived strictly from `req.authContext` (no `'soc-gvs'`). | `issue06_child_safety_reaudit_fixes.test.ts` (3 tests) + Live PG 16 Test 8 | Offline PASS + Live PG 16 PASS |
| **`F-B22-02B`** | `isClientAuthorizedForEvent` returned `true` for `vendor` on `EMERGENCY_INCIDENT_CREATED` (no `_audience`) and `delivery` on malformed `_audience: {}`. | Function only flagged `CHILD_` prefix and fell through to `return true` on missing/malformed `_audience`. | [server/src/realtimeEngine.ts](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L29-L170) (`isSensitiveEventType`, `isValidAudiencePolicy`, `isClientAuthorizedForEvent`) | **Before:** Sensitive non-`CHILD_` events and empty `{}` audiences failed open. **After:** Sensitive prefixes (`CHILD_`, `EMERGENCY_INCIDENT_`, `EMERGENCY_ALERTS`, `SECURITY_ALERT_`, `SOS_`, `RESIDENT_PRIVATE_`) and all audience-tagged events strictly validate structure/roles and fail closed (`return false`). Public non-sensitive society events preserved. | `issue06_child_safety_reaudit_fixes.test.ts` (2 tests) + `issue06_child_safety_remediation.test.ts` | Offline PASS |
| **`F-B22-02C`** | `replayEventsSince` ran `outboxEvent.findUnique({ where: { eventId: lastEventId } })` globally across societies. | Cursor lookup omitted `societyId: clientSoc`. | [server/src/realtimeEngine.ts](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L382-L426) (`replayEventsSince`) | **Before:** Cross-tenant `Last-Event-ID` resolved foreign timestamp cursor. **After:** Uses `findFirst({ where: { eventId: normalizedCursor, societyId: clientSoc } })` — foreign cursors resolve identically to unknown cursors. | `issue06_child_safety_reaudit_fixes.test.ts` + `issue06_child_safety_remediation.test.ts` | Offline PASS |
| **`F-B22-07`** | Missing live PG `SOS vs Alert Resolution` race test and missing tests for `F-B22-01A/B/C` & `F-B22-02A/B/C`. | Coverage gap from initial remediation. | [tests/issue06_child_safety_reaudit_fixes.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_reaudit_fixes.test.ts), [tests/issue06_child_safety_api_pg_integration.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_api_pg_integration.test.ts#L502-L670) | Added 15 focused offline tests + 2 new live PG 16 tests (11/11 live PG 16 tests passing). | 17 new tests total | Offline `98/98` + Live PG 16 `11/11` + Full offline `363/363` |

---

## 3. Exact Files Modified / Added

### Backend Source Files
1. [server/src/index.ts](file:///D:/AAZIRA/AARIZO/server/src/index.ts) — `F-B22-01A`, `F-B22-01B`, `F-B22-01C`, `F-B22-02A`, and `GET /api/emergency-incidents` hardening.
2. [server/src/realtimeEngine.ts](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts) — `F-B22-02B` (`isSensitiveEventType`, `isValidAudiencePolicy`, fail-closed `isClientAuthorizedForEvent`) and `F-B22-02C` (tenant-scoped `replayEventsSince`).

### Test Files
1. [tests/issue06_child_safety_reaudit_fixes.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_reaudit_fixes.test.ts) — New 15-test regression suite covering every `F-B22-01A/B/C` and `F-B22-02A/B/C` path.
2. [tests/issue06_child_safety_api_pg_integration.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_api_pg_integration.test.ts) — Extended from 6 to 8 live PG 16 tests (concurrent `SOS vs Alert Resolution` race + live re-audit exploit-closure proof).
3. [tests/issue06_child_safety_remediation.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_remediation.test.ts) — Added `findFirst` mock method on `outboxEvent` to match tenant-scoped `replayEventsSince` (zero assertions weakened).

---

## 4. Final Status

**`REMEDIATION COMPLETE — READY FOR FINAL INDEPENDENT RE-AUDIT`**

