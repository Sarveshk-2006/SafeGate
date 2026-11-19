# AARIZO ISSUE-06 — Phase B.2.3 — Phase 4 Resident API Contract Matrix

**Date:** 2026-11-18  
**Canonical Frontend Facade:** `src/services/childSafetyService.ts`  
**Canonical Types:** `src/types/childSafety.ts`  
**Authoritative Backend Router:** `server/src/childSafety/router.ts` & `server/src/childSafety/authz.ts`

---

## 1. Resident-Authorized Endpoint & Service Method Matrix

| Workflow | Canonical Service Method | HTTP Method & Endpoint | Resident Authorized? | Request DTO / Required Fields | Response DTO & Key Invariants | Expected Error Codes Handled in UI |
| --- | --- | --- | :---: | --- | --- | --- |
| **List Children** | `childSafetyService.listChildren()` | `GET /api/children` | **YES** *(owned children only)* | Optional `{ includeArchived }` (omit `societyId`) | `ChildProfileDto[]` (includes non-archived `pickups?: AuthorizedPickupDto[]`; never contains raw IDs) | `401`, `403`, `503`, `NETWORK` |
| **Get Child Detail** | `childSafetyService.getChildById(id)` | `GET /api/children/:id` | **YES** *(owned child only)* | `id: string` | `ChildProfileDto` | `401`, `403`, `404`, `503` |
| **Register Child** | `childSafetyService.createChildProfileAsync(data)` | `POST /api/children` | **YES** *(ownership derived from DB)* | `fullName`, `guardianName`, `guardianPhone`; optional `dateOfBirth`, `reportedAge` (0–25), `gender` (`MALE`/`FEMALE`/`OTHER`/`UNSPECIFIED`), `medicalNotes`, `emergencyPhone`, `exitPermissionMode`, `allowedSoloExit`, `notes`. **Omit `residentId`, `flatId`, `societyId` for residents.** | `201 ChildProfileDto` | `400 INVALID_*`, `403 RESIDENT_OWNERSHIP_REQUIRED`, `403 UNAUTHORIZED_FLAT_ASSIGNMENT`, `503` |
| **Update Child** | `childSafetyService.updateChildProfile(id, data)` | `PATCH /api/children/:id` | **YES** *(owned child only)* | Mutable fields (`fullName`, `dateOfBirth`, `reportedAge`, `gender`, `medicalNotes`, `guardianName`, `guardianPhone`, `emergencyPhone`, `exitPermissionMode`, `allowedSoloExit`, `notes`) | `200 ChildProfileDto` | `400`, `403`, `404`, `409 CHILD_ARCHIVED`, `422` |
| **Archive Child** | `childSafetyService.archiveChildProfile(id)` | `POST /api/children/:id/archive` | **YES** *(owned child only)* | `id: string` *(cascades active passes → `REVOKED`)* | `200 ChildProfileDto` (`status: 'ARCHIVED'`) | `403`, `404`, `409 ALREADY_ARCHIVED`, `503` |
| **List Pickups** | `childSafetyService.listAuthorizedPickups(childId)` | `GET /api/children/:childId/pickups` | **YES** *(owned child only)* | `childId: string` | `AuthorizedPickupDto[]` (masked `idDocumentLast4` only; never `idDocumentHash` or raw ID) | `403`, `404`, `503` |
| **Add Pickup** | `childSafetyService.addAuthorizedPickup(childId, data)` | `POST /api/children/:childId/pickups` | **YES** *(owned child only)* | `name`, `phone`, `relationship`; optional `idDocumentType` (≤64), `idDocumentLast4` (1–4 chars), `validUntil` (future ISO), `notes`. **Forbidden: `idProofNumber` / raw ID fields.** | `201 AuthorizedPickupDto` | `400 RAW_ID_DOCUMENT_FORBIDDEN`, `400 INVALID_*`, `403`, `409 CHILD_ARCHIVED` |
| **Update Pickup** | `childSafetyService.updateAuthorizedPickup(childId, pickupId, data)` | `PATCH /api/children/:childId/pickups/:pickupId` | **YES** *(owned child only)* | Optional `name`, `phone`, `relationship`, `validUntil`, `status` (`ACTIVE`/`REVOKED`/`EXPIRED` — revoked cannot reactivate; expired requires future `validUntil`) | `200 AuthorizedPickupDto` *(cascades active passes if status → `REVOKED`/`EXPIRED`)* | `400`, `403`, `404`, `409 PICKUP_ARCHIVED`, `422 REVOKED_PICKUP_CANNOT_BE_REACTIVATED` |
| **Revoke Pickup** | `childSafetyService.revokeAuthorizedPickup(childId, pickupId)` | `POST /api/children/:childId/pickups/:pickupId/revoke` | **YES** *(owned child only)* | `childId`, `pickupId` *(cascades active passes → `REVOKED`)* | `200 AuthorizedPickupDto` (`status: 'REVOKED'`) | `403`, `404`, `409 ALREADY_REVOKED` |
| **Archive Pickup** | `childSafetyService.archiveAuthorizedPickup(childId, pickupId)` | `DELETE /api/children/:childId/pickups/:pickupId` | **YES** *(owned child only)* | `childId`, `pickupId` *(cascades active passes → `REVOKED`)* | `200 AuthorizedPickupDto` (`status: 'ARCHIVED'`) | `403`, `404`, `409 ALREADY_ARCHIVED` |
| **List Gate Passes** | `childSafetyService.listGatePasses(params?)` | `GET /api/children/passes` | **YES** *(owned children only)* | Optional `{ childId, status, limit, offset }` (omit `societyId`) | `ChildGatePassDto[]` (**NEVER** contains `tokenHash`, `bearerToken`, or `qrPayload`) | `400`, `401`, `403`, `503` |
| **Get Gate Pass** | `childSafetyService.getGatePassById(id)` | `GET /api/children/passes/:id` | **YES** *(owned child only)* | `id: string` | `ChildGatePassDto` (no `bearerToken` / `qrPayload`) | `403`, `404` |
| **Create Gate Pass** | `childSafetyService.createGatePass(data, { idempotencyKey })` | `POST /api/children/passes` | **YES** *(owned child only)* | `childId`, `validUntil` (future ISO, ≤7 days from `validFrom`), optional `pickupPersonId` (required unless `SOLO_ALLOWED`), `validFrom`, `maxUses` (1–10, default 1), `notes` | `201 ChildGatePassCreatedDto` (**ONE-TIME** `bearerToken` + `qrPayload`; omit `tokenHash`) | `400 INVALID_VALIDITY_WINDOW`, `409 CHILD_MISSING_ALERT_ACTIVE`, `409 CHILD_ARCHIVED`, `422 PICKUP_AUTHORIZATION_INACTIVE`, `422 PICKUP_AUTHORIZATION_EXPIRED`, `422 AUTHORIZED_PICKUP_REQUIRED`, `429 RATE_LIMIT_EXCEEDED` |
| **Revoke Gate Pass** | `childSafetyService.revokeGatePass(id, data?)` | `POST /api/children/passes/:id/revoke` | **YES** *(owned child only)* | `id`, optional `{ reason }` (≤300 chars) | `200 ChildGatePassDto` (`status: 'REVOKED'`) | `403`, `404`, `409 PASS_NOT_REVOCABLE` |
| **List Exit Logs** | `childSafetyService.listExitLogs(params?)` | `GET /api/children/exit-logs` | **YES** *(owned children only)* | Optional `{ childId, limit, offset }` | `ChildExitLogDto[]` (immutable audit history) | `401`, `403`, `503` |
| **Trigger Child SOS** | `childSafetyService.triggerSos(data)` | `POST /api/children/sos` | **YES** *(owned `childId` REQUIRED)* | `childId` (required for resident!), `location` (required, ≤255), `alertType` (`MISSING_CHILD` / `UNATTENDED_CHILD` / `EMERGENCY_SOS`), optional `severity`, `description`, `lastSeenDetails` | `201 ChildSosCreatedDto` (`{ alert, emergencyIncident }`) | `400 CHILD_ID_REQUIRED`, `400 INVALID_LOCATION`, `403 UNAUTHORIZED_SOS_TRIGGER`, `409 DUPLICATE_ACTIVE_SOS_ALERT`, `409 CHILD_ARCHIVED`, `429` |
| **List Safety Alerts** | `childSafetyService.listAlerts(params?)` | `GET /api/children/alerts` | **YES** *(reported by resident or owned children)* | Optional `{ status, limit, offset }` | `ChildSafetyAlertDto[]` | `401`, `403`, `503` |

---

## 2. Operations Strictly Forbidden for Resident Role (MUST NOT Expose in Resident UI)

| Operation | Endpoint | Backend Allowed Roles (`router.ts#L53-L55`) | Enforcement |
| --- | --- | --- | --- |
| **Verify Gate Pass** | `POST /api/children/passes/verify` | `['guard', 'admin']` | Phase 5 Security Terminal only (`403` for residents) |
| **Acknowledge Child Alert** | `POST /api/children/alerts/:id/acknowledge` | `['guard', 'secretary', 'committee', 'admin']` | Phase 5/6 Security & Admin only (`403` for residents) |
| **Resolve Child Alert** | `POST /api/children/alerts/:id/resolve` | `['guard', 'secretary', 'committee', 'admin']` | Phase 5/6 Security & Admin only (`403` for residents) |

---

## 3. UI Form Field Mapping & Transformations (`SafetyCommandHub.tsx` → Backend DTOs)

| Legacy UI Field | Action in Phase 4 | Target Backend Field & Rule |
| --- | --- | --- |
| `childForm.childName` | Rename / map | `fullName` (trimmed, 1–200 chars, required) |
| `childForm.flatCode` (editable, `'B-1204'` fallback) | **Remove from submit payload** for `resident`; display read-only from `currentUser?.flatNumber` | Backend derives `flatId`, `flatNumber`, `residentId` from DB |
| `childForm.age` (ignored!) | **Transform** | `reportedAge` (integer `0..25`, omitted if blank) |
| `childForm.gender` (`'Boy'`/`'Girl'` ignored!) | **Transform** | `gender`: `'MALE'` / `'FEMALE'` / `'OTHER'` / `'UNSPECIFIED'` |
| `childForm.guardianName` (`'Siddharth Malhotra'` fallback) | Remove fake fallback; prefill from `currentUser?.name || ''` | `guardianName` (required, 1–200 chars) |
| `childForm.guardianPhone` (`'+91 98765 00000'` fallback) | Remove fake fallback; prefill from `currentUser?.phone || ''` | `guardianPhone` (required, 1–32 chars) |
| `pickupForm.idProofType` | Rename / map | `idDocumentType` (optional, ≤64 chars) |
| `pickupForm.idProofNumber` (`'XXXX-XXXX-9901'`) | **REMOVE COMPLETELY** (prohibited raw ID!) | Replace with optional `idDocumentLast4` (1–4 chars max) |
| `MISSING_ALERT` (zero inputs, fake confirm) | Add `location` (required), `alertType`, optional `lastSeenDetails` & `description`, bound to clicked `childId` | `TriggerChildSosRequest` → `POST /api/children/sos` |
| `GENERATE_PASS` (fake confirm, hardcoded 4h text) | Add escort selector (active unexpired escorts), duration/validity window (default 4h, max 7d), `maxUses` (1–10), optional `notes` | `CreateChildGatePassRequest` → `POST /api/children/passes` → render one-time `qrPayload` via `QRCodeSVG` |

