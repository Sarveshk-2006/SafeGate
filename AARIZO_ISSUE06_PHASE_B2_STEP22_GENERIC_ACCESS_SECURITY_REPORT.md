# AARIZO — ISSUE-06 PHASE B.2.2 GENERIC ACCESS & ENTITYRECORD SECURITY REPORT

**Project:** `D:\AAZIRA\AARIZO`  
**Findings Addressed:** `F-B22-01A`, `F-B22-01B`, `F-B22-01C`  
**Date:** 2026-11-18  
**Status:** **`REMEDIATION COMPLETE — READY FOR FINAL INDEPENDENT RE-AUDIT`**

---

## 1. Complete Backend `EntityRecord` Surface Audit

Every `prisma.entityRecord.*` reference across `server/src/**` was enumerated and inspected. Five direct-ID lookup sites and all generic collection/query endpoints were remediated:

| Route / Endpoint | File & Lines | Pre-Fix Vulnerability | Post-Fix Enforcement |
| --- | --- | --- | --- |
| `GET /api/collections/:collection` | [server/src/index.ts#L4221-L4276](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L4221-L4276) | `entityRecord`/`entityRecords` matched `ALLOWED_QUERY_TABLES` native dispatch and dumped all rows (including `child_profiles`); native dispatch skipped `ALLOWED_QUERY_TABLES[nativeKey]` role checks (`vendor` read `emergencyIncident`). | Normalized `resolveNativeCollectionModel()` + mandatory `enforceNativeModelRolePolicy()` (`403` default-deny); `entityRecord` enforces `collection: { notIn: BLOCKED_CHILD_SAFETY_RAW_NAMES }` + normalized post-filter; `emergencyIncident` excludes `CHILD_SAFETY` for `resident` role. |
| `GET /api/collections/:collection/:id` | [server/src/index.ts#L4278-L4330](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L4278-L4330) | `entityRecord/:id` dumped `child_profiles` by ID; native dispatch skipped role checks. | Enforces `enforceNativeModelRolePolicy()`, tenant-scoped `findFirst({ where: { id, societyId } })` (`404` for foreign tenant — zero existence oracle), `403 CHILD_SAFETY_COLLECTION_FORBIDDEN` for same-society child rows, and `incidentType: { not: 'CHILD_SAFETY' }` for `resident`. |
| `POST / PUT / PATCH / DELETE /api/collections/:collection(/:id)` | [server/src/index.ts#L4332-L4455](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L4332-L4455) | Allowed synthetic writes under `entityRecord`/`emergencyIncident`/`auditLog`; `PUT`/`DELETE` checked blocked child collection before tenant isolation (cross-tenant oracle) and did not check `existing.collection === colName`. | Rejects writes to `GENERIC_WRITE_PROTECTED_MODELS` (`entityRecord`, `emergencyIncident`, `auditLog`, `societyMembership`) with `403 RESTRICTED_COLLECTION_WRITE`; checks `existing.societyId !== societyId` (`404`) BEFORE blocked child check (`403`); enforces `existing.collection === colName`; strips `_audience` before `broadcastEvent`. |
| `POST /api/:table/query` | [server/src/index.ts#L4458-L4506](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L4458-L4506) | `resident` querying `emergencyIncident` could view `CHILD_SAFETY` SOS rows. | Retains `entityRecord` child-collection exclusion + adds `incidentType: { not: 'CHILD_SAFETY' }` for `resident` queries on `emergencyIncident`. |
| `GET /api/emergency-incidents` & `POST`/`PATCH` | [server/src/index.ts#L2288-L2345](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2288-L2345) | `GET` had no role check (`vendor`/`facility_manager` could read `CHILD_SAFETY` SOS incidents); broadcasts lacked `_audience`. | `requireRole(['resident', 'guard', 'secretary', 'committee', 'admin'])`, `resolveGenericCollectionSociety()`, `incidentType: { not: 'CHILD_SAFETY' }` for `resident`, and explicit `EventAudiencePolicy` on `EMERGENCY_ALERTS` & `EMERGENCY_INCIDENT_RESOLVED`. |
| `PATCH /api/housekeeping/tasks/:id` | [server/src/index.ts#L3099-L3125](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L3099-L3125) | Unscoped `entityRecord.findUnique({ where: { id } })` mutated `child_profiles` by ID. | Scoped `findFirst({ where: { id, collection: 'housekeeping_tasks', societyId } })` + scoped `updateMany`; strips `id`, `societyId`, `collection`, `_audience` from body. |
| `POST /api/amenities/bookings/:id/cancel` | [server/src/index.ts#L2131-L2172](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2131-L2172) | Unscoped `entityRecord.findUnique({ where: { id } })` + `'soc-gvs'` fallback mutated arbitrary `EntityRecord` rows. | `resolveGenericCollectionSociety()`, scoped `findFirst({ where: { id, collection: 'amenityBookings', societyId } })`, resident ownership check (`403 UNAUTHORIZED_BOOKING_ACCESS`), scoped `updateMany`. |
| `POST /api/housekeeping/garbage-logs/confirm` *(newly discovered)* | [server/src/index.ts#L3044-L3076](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L3044-L3076) | No role check + unscoped `entityRecord.findUnique({ where: { id } })` allowed `vendor` to overwrite `child_profiles`. | Added `requireRole(['resident', 'facility_manager', 'secretary', 'admin'])`, `resolveGenericCollectionSociety()`, scoped `findFirst({ where: { id, collection: 'garbage_pickup_logs', societyId } })`, scoped `updateMany`. |
| `GET /api/amenities/:id/availability` & `POST /api/amenities/:id/book` | [server/src/index.ts#L1888-L2025](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L1888-L2025) | Unscoped `entityRecord.findUnique({ where: { id: amenityId } })` fallback + `'soc-gvs'` fallback. | `resolveGenericCollectionSociety()` + scoped `findFirst({ where: { id: amenityId, collection: { in: ['amenities', 'amenity'] }, societyId } })`. |

---

## 2. Live PostgreSQL 16 Exploit-Closure Evidence

In `tests/issue06_child_safety_api_pg_integration.test.ts` Test 8 (executed against virgin migrated `postgres:16-alpine` on `127.0.0.1:5444`), a real `entity_records` row (`id = 'live-legacy-child-exploit', collection = 'child_profiles', society_id = 'soc-a'`) was seeded and probed:
- `GET /api/collections/entityRecord` (`vendor`): `200`, `live-legacy-child-exploit` **excluded** (`false`).
- `GET /api/collections/entityRecord/live-legacy-child-exploit` (`vendor`): **`403 CHILD_SAFETY_COLLECTION_FORBIDDEN`**.
- `GET /api/collections/emergencyIncident` (`vendor`): **`403 INSUFFICIENT_PERMISSIONS`**.
- `GET /api/emergency-incidents` (`vendor`): **`403`**.
- `PATCH /api/housekeeping/tasks/live-legacy-child-exploit` (`facility_manager`): **`404`**.
- `POST /api/amenities/bookings/live-legacy-child-exploit/cancel` (`resident`): **`404`**.
- `POST /api/housekeeping/garbage-logs/confirm` (`resident`, `id = 'live-legacy-child-exploit'`): **`404`**.
- Direct PostgreSQL read confirmed `live-legacy-child-exploit` remained **100% unmodified**.

