# AARIZO ISSUE-06 — Phase B.2.3 — Phase 3 API Contract Audit

**Audit Date:** 2026-11-18  
**Audited Files:** `src/services/childSafetyService.ts`, `src/services/apiClient.ts`, `src/types/childSafety.ts`, `server/src/childSafety/router.ts`

---

## 1. Operation-by-Operation Verification Matrix (All 20 Canonical Methods)

| # | `childSafetyService` Method | Line Ref | Phase 1 Strict Method Called | Backend Route Verified | Tenant Scope Safe? | `ApiError` Preserved? | Sensitive Data Persisted? | Contract Verdict |
| :---: | --- | :---: | --- | --- | :---: | :---: | :---: | :---: |
| 1 | `listChildren` | `#L455` | `apiClient.getChildrenStrict` | `GET /api/children` | YES (`sanitizeSocietyFilter`) | YES | NO *(note `F-P3-01` snapshot race)* | **PASS (with `F-P3-01` snapshot fix)** |
| 2 | `getChildById` | `#L475` | `apiClient.getChildByIdStrict` | `GET /api/children/:id` | YES (JWT derived) | YES | NO | **PASS** |
| 3 | `createChildProfileAsync` | `#L481` | `apiClient.createChildStrict` | `POST /api/children` | YES (`sanitizeSocietyFilter`) | YES | NO | **PASS** |
| 4 | `updateChildProfile` | `#L498` | `apiClient.updateChildStrict` | `PATCH /api/children/:id` | YES (JWT derived) | YES | NO | **PASS** |
| 5 | `archiveChildProfile` | `#L506` | `apiClient.archiveChildStrict` | `POST /api/children/:id/archive` | YES (JWT derived) | YES | NO | **PASS** |
| 6 | `listAuthorizedPickups` | `#L518` | `apiClient.getChildPickupsStrict` | `GET /api/children/:childId/pickups` | YES (JWT derived) | YES | NO | **PASS** |
| 7 | `addAuthorizedPickup` | `#L527` | `apiClient.addChildPickupStrict` | `POST /api/children/:childId/pickups` | YES (JWT derived) | YES | NO (blocks raw ID fields pre-network) | **PASS** |
| 8 | `updateAuthorizedPickup` | `#L538` | `apiClient.updateChildPickupStrict` | `PATCH /api/children/:childId/pickups/:pickupId` | YES (JWT derived) | YES | NO | **PASS** |
| 9 | `revokeAuthorizedPickup` | `#L550` | `apiClient.revokeChildPickupStrict` | `POST /api/children/:childId/pickups/:pickupId/revoke` | YES (JWT derived) | YES | NO | **PASS** |
| 10 | `archiveAuthorizedPickup` | `#L558` | `apiClient.archiveChildPickupStrict` | `DELETE /api/children/:childId/pickups/:pickupId` | YES (JWT derived) | YES | NO | **PASS** |
| 11 | `listGatePasses` | `#L570` | `apiClient.getChildPassesStrict` | `GET /api/children/passes` | YES (`sanitizeSocietyFilter`) | YES | NO *(note `F-P3-01` snapshot race)* | **PASS (with `F-P3-01` snapshot fix)** |
| 12 | `getGatePassById` | `#L592` | `apiClient.getChildPassByIdStrict` | `GET /api/children/passes/:id` | YES (JWT derived) | YES | NO | **PASS** |
| 13 | `createGatePass` | `#L602` | `apiClient.createChildPassStrict` | `POST /api/children/passes` | YES (`sanitizeSocietyFilter`) | YES | NO (one-time `bearerToken`/`qrPayload` returned in memory only) | **PASS** |
| 14 | `revokeGatePass` | `#L622` | `apiClient.revokeChildPassStrict` | `POST /api/children/passes/:id/revoke` | YES (JWT derived) | YES | NO | **PASS** |
| 15 | `verifyGatePass` | `#L633` | `apiClient.verifyChildPassStrict` | `POST /api/children/passes/verify` | YES (`sanitizeSocietyFilter`) | YES | NO (fail-closed, bearer/QR only) | **PASS** |
| 16 | `listExitLogs` | `#L652` | `apiClient.getChildExitLogsStrict` | `GET /api/children/exit-logs` | YES (`sanitizeSocietyFilter`) | YES | NO *(note `F-P3-01` snapshot race)* | **PASS (with `F-P3-01` snapshot fix)** |
| 17 | `triggerSos` | `#L677` | `apiClient.triggerChildSosStrict` | `POST /api/children/sos` | YES (`sanitizeSocietyFilter`) | YES | NO | **PASS** |
| 18 | `listAlerts` | `#L696` | `apiClient.getChildAlertsStrict` | `GET /api/children/alerts` | YES (`sanitizeSocietyFilter`) | YES | NO *(note `F-P3-01` snapshot race)* | **PASS (with `F-P3-01` snapshot fix)** |
| 19 | `acknowledgeAlert` | `#L717` | `apiClient.acknowledgeChildAlertStrict` | `POST /api/children/alerts/:id/acknowledge` | YES (JWT derived) | YES | NO | **PASS** |
| 20 | `resolveAlert` | `#L727` | `apiClient.resolveChildAlertStrict` | `POST /api/children/alerts/:id/resolve` | YES (JWT derived) | YES | NO | **PASS** |

---

## 2. Detailed Contract Checks (Pagination, Enums, Nullable Fields, Error Formatting)

- **Pagination & Filters:** `limit`, `offset`, `childId`, `status`, `includeArchived` are forwarded cleanly only when defined (handling `offset: 0` safely via `!== undefined`).
- **Enum Mapping (Legacy Projection):** `mapExitLogDtoToLegacy` (`#L321-L327`) accurately maps backend `'MISSING_ALERT_BLOCKED'` → legacy `'MISSING_ALERT_FLAGGED'`; `mapChildDtoToLegacy` (`#L253-L274`) filters `'ARCHIVED'` pickups, masks `idDocumentLast4` as `XXXX-<last4>`, and maps `UNSPECIFIED` → `'OTHER'`; `mapAlertDtoToLegacy` (`#L345-L366`) maps `'RESOLVED' | 'FALSE_ALARM'` → `'RESOLVED'`.
- **Error Formatting (`formatChildSafetyError`, `#L86-L181`):** Exhaustively covers all 10 `ApiErrorKind` values (`UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `UNAVAILABLE`, `NETWORK`, `INVALID_RESPONSE`, `SERVER_ERROR`), preserves `retryAfterSeconds`, and never leaks raw stack traces or credentials.
- **Blocking Contract / State Finding (`F-P3-01` — HIGH):** Ephemeral snapshot writes in `listChildren`, `listGatePasses`, `listExitLogs`, and `listAlerts` lack a pre-`await` session fingerprint check (`requestFp === this.snapshotSessionFingerprint`), lack an unfiltered-query guard, and are not evicted in `notifyInvalidation()`.

