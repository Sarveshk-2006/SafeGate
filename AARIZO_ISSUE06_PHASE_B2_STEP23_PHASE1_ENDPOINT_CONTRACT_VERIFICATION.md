# AARIZO — ISSUE-06 Phase B.2.3 — Phase 1 Endpoint Contract Verification

**Sources Cross-Checked:**
- Frontend: `src/services/apiClient.ts#L793-L1126`, `src/types/childSafety.ts#L103-L484`
- Backend: `server/src/childSafety/router.ts#L1-L2577`, `server/src/childSafety/validation.ts#L1-L365`, `server/prisma/schema.prisma`

---

## 1. Scope Note: 19 Logical Endpoints + 1 Explicit Alias = 20 Methods

The approved API Client Design (`AARIZO_ISSUE06_PHASE_B2_STEP23_API_CLIENT_DESIGN.md` Section 4) specified 20 Child Safety methods representing **19 distinct logical operations** plus the explicit `DELETE /api/children/:childId/pickups/:pickupId` pickup-archive route (which is functionally distinct from `POST .../revoke` in `server/src/childSafety/router.ts#L2572-L2577`: `POST .../revoke` sets `status = 'REVOKED'` while `DELETE` sets `status = 'ARCHIVED'` and `archivedAt = now`). All 20 methods are audited individually below.

---

## 2. Method-by-Method Backend Parity Matrix

| # | Frontend Method (`src/services/apiClient.ts`) | Method & Exact URL | Backend Route (`server/src/childSafety/router.ts`) | Backend Roles | Response Shape Parity | Validator & Contract Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `getChildrenStrict` (`#L794`) | `GET /api/children` (`?includeArchived=true`, `?societyId=`) | `GET /` (`#L1620`) | `resident`, `secretary`, `committee`, `admin` | `200 ChildProfileDto[]` | **PASS** (minor: enum membership check optional — see `F-P1-05`) |
| 2 | `getChildByIdStrict` (`#L806`) | `GET /api/children/:id` | `GET /:id` (`#L1878`) | `resident` (own), `secretary`, `committee`, `admin` | `200 ChildProfileDto` | **PASS** |
| 3 | `createChildStrict` (`#L815`) | `POST /api/children` | `POST /` (`#L1662`) | `resident`, `secretary`, `admin` | `201 ChildProfileDto` | **PASS** (recursive raw-ID guard; minor case-sensitivity note `F-P1-04`) |
| 4 | `updateChildStrict` (`#L825`) | `PATCH /api/children/:id` | `PATCH /:id` (`#L1897`) | `resident` (own), `secretary`, `admin` | `200 ChildProfileDto` | **PASS** |
| 5 | `archiveChildStrict` (`#L836`) | `POST /api/children/:id/archive` | `POST /:id/archive` (`#L2172`) | `resident` (own), `secretary`, `admin` | `200 ChildProfileDto` (`#L2166`) | **PASS with Note (`F-P1-05`):** Backend ignores `req.body.reason`; response DTO matches verbatim. |
| 6 | `getChildPickupsStrict` (`#L846`) | `GET /api/children/:childId/pickups` | `GET /:childId/pickups` (`#L2182`) | `resident` (own), `secretary`, `committee`, `admin` | `200 AuthorizedPickupDto[]` (`#L2199`) | **PASS with Note (`F-P1-05`):** Backend returns all pickups for the child and ignores `?includeArchived=true` (`#L2191-L2197`). Callers must filter archived pickups client-side if hiding archived rows. |
| 7 | `addChildPickupStrict` (`#L858`) | `POST /api/children/:childId/pickups` | `POST /:childId/pickups` (`#L2209`) | `resident` (own), `secretary`, `admin` | `201 AuthorizedPickupDto` (`#L2303`) | **PASS** (enforces no raw ID fields + `idDocumentLast4` <= 4 chars) |
| 8 | `updateChildPickupStrict` (`#L871`) | `PATCH /api/children/:childId/pickups/:pickupId` | `PATCH /:childId/pickups/:pickupId` (`#L2312`) | `resident` (own), `secretary`, `admin` | `200 AuthorizedPickupDto` | **PASS** |
| 9 | `revokeChildPickupStrict` (`#L889`) | `POST /api/children/:childId/pickups/:pickupId/revoke` | `POST /:childId/pickups/:pickupId/revoke` (`#L2572`) | `resident` (own), `secretary`, `admin` | `200 AuthorizedPickupDto` (`#L2566`) | **PASS with Note (`F-P1-05`):** Backend sets `status = 'REVOKED'` and ignores `req.body.reason`. |
| 10 | `archiveChildPickupStrict` (`#L904`) | `DELETE /api/children/:childId/pickups/:pickupId` | `DELETE /:childId/pickups/:pickupId` (`#L2575`) | `resident` (own), `secretary`, `admin` | `200 AuthorizedPickupDto` (`#L2566`, `status = 'ARCHIVED'`) | **PASS** |
| 11 | `getChildPassesStrict` (`#L914`) | `GET /api/children/passes` (`?childId=&status=&limit=&offset=&societyId=`) | `GET /passes` (`#L148`) | `resident` (own), `guard` (ACTIVE unexpired only), `secretary`, `committee`, `admin` | `200 ChildGatePassDto[]` (`#L198`) | **DEFECT (`F-P1-01`):** `isChildGatePassDto` fails to reject responses unexpectedly containing `bearerToken` or `qrPayload`. |
| 12 | `getChildPassByIdStrict` (`#L929`) | `GET /api/children/passes/:id` | `GET /passes/:id` (`#L890`) | `resident` (own), `guard` (ACTIVE unexpired only), `secretary`, `committee`, `admin` | `200 ChildGatePassDto` (`#L930`) | **DEFECT (`F-P1-01`):** Same `isChildGatePassDto` gap (`bearerToken`/`qrPayload` not rejected). |
| 13 | `createChildPassStrict` (`#L938`) | `POST /api/children/passes` | `POST /passes` (`#L209`) | `resident` (own), `secretary`, `admin` | `201 ChildGatePassCreatedDto` (`#L398-L402`, includes one-time `bearerToken` & `qrPayload`) | **PASS** (enforces `pickupPersonId` when `childExitPermissionMode !== 'SOLO_ALLOWED'`, requires `bearerToken` & `qrPayload` in response, rejects `tokenHash`). |
| 14 | `revokeChildPassStrict` (`#L983`) | `POST /api/children/passes/:id/revoke` | `POST /passes/:id/revoke` (`#L1040`) | `resident` (own), `secretary`, `admin` | `200 ChildGatePassDto` (`#L1034`) | **DEFECT (`F-P1-01`):** Same `isChildGatePassDto` gap; backend DOES persist `req.body.reason` (`#L988`). |
| 15 | `verifyChildPassStrict` (`#L993`) | `POST /api/children/passes/verify` | `POST /passes/verify` (`#L882`) | `guard`, `admin` ONLY | `200 { authorized: true, outcome: 'ALLOWED', pass, exitLog }` (`#L824-L829`); `409`/`422`/`503 BACKEND_UNAVAILABLE` | **DEFECT (`F-P1-01`):** Nested `pass` validated by `isChildGatePassDto` (should reject unexpected `bearerToken`/`qrPayload`). All status codes, `outcome`, `400 BEARER_TOKEN_REQUIRED` passCode-only guard, and `503` fail-closed semantics are **PASS**. |
| 16 | `getChildExitLogsStrict` (`#L1036`) | `GET /api/children/exit-logs` (`?childId=&limit=&offset=&societyId=`) | `GET /exit-logs` (`#L1047`) | `resident` (own), `guard`, `secretary`, `committee`, `admin` | `200 ChildExitLogDto[]` (`#L1081`) | **PASS** |
| 17 | `triggerChildSosStrict` (`#L1050`) | `POST /api/children/sos` | `POST /sos` (`#L1096`) | `resident` (own `childId`), `guard`, `secretary`, `committee`, `admin` | `201 { alert, emergencyIncident }` (`#L1323-L1337`) | **PASS** (enforces non-empty `location` and raw-ID block) |
| 18 | `getChildAlertsStrict` (`#L1070`) | `GET /api/children/alerts` (`?status=&limit=&offset=&societyId=`) | `GET /alerts` (`#L1389`) | `resident` (own/reported), `guard`, `secretary`, `committee`, `admin` | `200 ChildSafetyAlertDto[]` (`#L1383`) | **PASS** |
| 19 | `acknowledgeChildAlertStrict` (`#L1084`) | `POST /api/children/alerts/:id/acknowledge` | `POST /alerts/:id/acknowledge` (`#L1396`) | `guard`, `secretary`, `committee`, `admin` | `200 ChildSafetyAlertDto` (`#L1463`) | **PASS with Note (`F-P1-05`):** Backend does NOT read or persist `req.body.notes` (`#L1429-L1434`). |
| 20 | `resolveChildAlertStrict` (`#L1097`) | `POST /api/children/alerts/:id/resolve` | `POST /alerts/:id/resolve` (`#L1473`) | `guard`, `secretary`, `committee`, `admin` | `200 ChildSafetyAlertDto` (`#L1606`) | **PASS** (enforces non-empty `resolutionNotes` and `RESOLVED \| FALSE_ALARM`) |

---

## 3. Contract Precision Details (`F-P1-05`)

1. **Non-persisted optional request parameters:**
   - `ListChildPickupsParams.includeArchived` (`src/types/childSafety.ts#L349`): Backend `GET /:childId/pickups` (`server/src/childSafety/router.ts#L2191-L2197`) does not filter by `includeArchived` — it always returns all pickups for that child.
   - `AcknowledgeChildAlertRequest.notes` (`src/types/childSafety.ts#L425`): Backend `POST /alerts/:id/acknowledge` (`router.ts#L1423-L1435`) does not accept or persist a `notes` column.
   - `ArchiveChildProfileRequest.reason` & `RevokePickupRequest.reason`: Backend only persists `reason` on `POST /passes/:id/revoke` (`revocationReason`), not on child archive or pickup revoke.
   - **Recommendation:** Document clearly in JSDoc on those request types (or remove unused `notes`/`reason` fields where backend does not store them) so Phase 4–6 UI forms never promise persisted notes/reasons that the backend ignores.
2. **Enum & nested summary validation tightness:**
   - `isChildProfileDto`, `isAuthorizedPickupDto`, `isChildGatePassDto`, `isChildExitLogDto`, `isChildSafetyAlertDto` accept any non-empty string for enum fields (`status`, `exitPermissionMode`, `outcome`, `verificationChannel`, `alertType`, `severity`). Checking exact Prisma enum membership sets (matching `server/src/childSafety/validation.ts#L4-L20`) and validating optional `pass.child` summary when present will catch corrupted/unexpected backend values early.

