# AARIZO — ISSUE-06 PHASE B.2.2 FINAL GENERIC ACCESS & ENTITYRECORD AUDIT (`FINAL2`)

**Project:** `D:\AAZIRA\AARIZO`  
**Findings Verified:** `F-B22-01A`, `F-B22-01B`, `F-B22-01C`  
**Date:** 2026-11-18  
**Result:** **`PASS`** *(All Three Residual Generic/EntityRecord Findings Independently Verified Closed in Code & Live PostgreSQL 16)*

---

## 1. `F-B22-01A` — `EntityRecord` Generic Collection Alias Isolation

- **Source Inspected:** [server/src/index.ts#L4181-L4455](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L4181-L4455).
- **Database Query Conditions Verified:**
  - `GET /api/collections/:collection`: When `resolveNativeCollectionModel(colName) === 'entityRecord'`, enforces `where.societyId = societyId` (for non-platform callers) AND `where.collection = { notIn: BLOCKED_CHILD_SAFETY_RAW_NAMES }` at the Prisma query boundary, plus post-filters `!isBlockedChildSafetyCollection(String(r?.collection || ''))`.
  - `GET /api/collections/:collection/:id`: Executes `prisma.entityRecord.findFirst({ where: { id, societyId } })` first (guaranteeing foreign-society records return `404` with zero existence oracle), then returns `403 CHILD_SAFETY_COLLECTION_FORBIDDEN` if `isBlockedChildSafetyCollection(record.collection)` is true.
  - `POST`, `PUT`, `PATCH`, `DELETE /api/collections/:collection(/:id)`: Rejects `GENERIC_WRITE_PROTECTED_MODELS` (`entityRecord`, `emergencyIncident`, `auditLog`, `societyMembership`) with `403 RESTRICTED_COLLECTION_WRITE`.
- **Live PostgreSQL 16 Probe Evidence (`127.0.0.1:5445`):**
  - `GET /api/collections/entityRecord`, `/entityRecord/`, `/entityRecords`, `/entity%5Frecord`, `/entity%255Frecord`, `/ENTITY_RECORDS` as `vendor`: ALL returned `200`, `leakedChild: false`, `hasAnnouncement: true` (`f2-ann-a` preserved, `f2-child-a`/`f2-child-b` excluded).
  - `GET /api/collections/entityRecord/f2-child-a` (same-society child): **`403`**.
  - `GET /api/collections/entityRecord/f2-child-b` (cross-society child): **`404`** (zero oracle).
  - `GET /api/collections/entityRecord/f2-ann-a` (unrelated announcement): **`200`**.
  - `GET /api/collections/child_profiles/` (trailing slash): **`403`**.
  - `POST /api/collections/entityRecord` (`admin`): **`403`**; `POST /api/collections/announcements` (`admin`): **`201`**.

---

## 2. `F-B22-01B` — Native Prisma Model Role-Policy Enforcement

- **Source Inspected:** `enforceNativeModelRolePolicy()` ([server/src/index.ts#L4204-L4220](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L4204-L4220)), `GET /api/collections/:collection(/:id)`, `GET /api/emergency-incidents` ([index.ts#L2288-L2310](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2288-L2310)), and `POST /api/:table/query` ([index.ts#L4510-L4556](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L4510-L4556)).
- **Live PostgreSQL 16 Six-Role Verification Matrix (`emergencyIncident`):**

| Role | `GET /api/collections/emergencyIncident` | `GET /api/emergency-incidents` | `POST /api/emergencyIncident/query` | `CHILD_SAFETY` Exposed? |
| --- | --- | --- | --- | --- |
| `vendor` | `403` | `403` | `403` | **No (`false`)** |
| `facility_manager` | `403` | `403` | `403` | **No (`false`)** |
| `resident` | `200` (`incidentType: { not: 'CHILD_SAFETY' }`) | `200` (`incidentType: { not: 'CHILD_SAFETY' }`) | `200` (`incidentType: { not: 'CHILD_SAFETY' }`) | **No (`false`)** |
| `guard` | `200` (`societyId: 'soc-a'`) | `200` (`societyId: 'soc-a'`) | `200` (`societyId: 'soc-a'`) | Authorized own-society (`true`) |
| `secretary` | `200` (`societyId: 'soc-a'`) | `200` (`societyId: 'soc-a'`) | `200` (`societyId: 'soc-a'`) | Authorized own-society (`true`) |
| `admin` | `200` (`societyId: 'soc-a'`) | `200` (`societyId: 'soc-a'`) | `200` (`societyId: 'soc-a'`) | Authorized own-society (`true`) |

- Additionally verified `GET /api/collections/auditLog` denies `vendor` (`403`) while allowing `secretary` (`200`). Unknown tables on `POST /api/:table/query` fail closed (`403`).

---

## 3. `F-B22-01C` — Backend-Wide Direct `EntityRecord` ID Audit

Repeated complete search of `server/src/**` for `entityRecord` confirmed **zero** remaining unscoped `prisma.entityRecord.findUnique` business-feature routes. All five direct-ID feature routes now scope by both `collection` and `societyId` (and ownership/role where applicable):

| Direct-ID Route | Collection Scope | Society Scope | Live PG 16 Probe Targeting `f2-child-a` (`child_profiles`) |
| --- | --- | --- | --- |
| `PATCH /api/housekeeping/tasks/:id` ([index.ts#L3108-L3133](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L3108-L3133)) | `housekeeping_tasks` | `resolveGenericCollectionSociety` + `updateMany` | **`404`**, row untouched |
| `POST /api/amenities/bookings/:id/cancel` ([index.ts#L2131-L2172](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2131-L2172)) | `amenityBookings` | `resolveGenericCollectionSociety` + resident ownership (`403`) + `updateMany` | **`404`**, row untouched |
| `POST /api/housekeeping/garbage-logs/confirm` ([index.ts#L3044-L3076](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L3044-L3076)) | `garbage_pickup_logs` | `requireRole` + `resolveGenericCollectionSociety` + `updateMany` | **`404`** (and `403` for `vendor`), row untouched |
| `GET /api/amenities/:id/availability` ([index.ts#L1888-L1925](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L1888-L1925)) | `['amenities', 'amenity']` | `resolveGenericCollectionSociety` | Did **not** read `f2-child-a` (`capacityPerSlot !== 99`) |
| `POST /api/amenities/:id/book` ([index.ts#L1994-L2035](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L1994-L2035)) | `['amenities', 'amenity']` | `resolveGenericCollectionSociety` | Did **not** read or mutate `f2-child-a` |

Direct PostgreSQL query after all five probes confirmed `f2-child-a` remained **100% intact** (`f01c_childIntact: true`).

