# AARIZO ISSUE-06 — Phase B.2.3 — Phase 4 Resident Regression Test Plan

**Date:** 2026-11-18  
**Repository:** `D:\AAZIRA\AARIZO`  
**Test Environment Note:** Offline Jest (`testEnvironment: 'node'`, `ts-jest`) with real Phase 1 `apiClient.*Strict`, real Phase 2 `RealtimeService` + `SseFrameParser`, real Phase 3 `childSafetyService` + `useChildSafetyRealtime`, and deterministic React hook/controller harnesses. Live PostgreSQL, live Firebase, and live browser tests will be tracked separately and never misrepresented as executed unless actually run.

---

## 1. Per-Subphase Automated Test Matrix

| Subphase | Planned Test Suite | Behavioral Scenarios Verified |
| :---: | --- | --- |
| **4.1** | `tests/issue06_b23_phase4_resident_helpers.test.ts` | - Resident `buildCreateChildPayload` strips `residentId`, `flatId`, `societyId`, maps gender (`Boy`→`MALE`, etc.), parses integer `reportedAge` (0–25), validates `exitPermissionMode`/`allowedSoloExit` parity.<br>- `buildCreatePickupPayload` rejects raw `idProofNumber`, enforces `idDocumentLast4` 1–4 chars, validates future `validUntil`.<br>- `buildCreateGatePassPayload` enforces `validUntil > validFrom`, `validUntil <= 7 days`, `maxUses` 1–10, requires active pickup unless `SOLO_ALLOWED`.<br>- `getEffectivePassStatus` & `getEffectivePickupStatus` project `EXPIRED` when `status === 'ACTIVE' && validUntil <= now`.<br>- `buildTriggerSosPayload` requires `childId` and non-empty `location` for residents. |
| **4.2** | `tests/issue06_b23_phase4_resident_children.test.ts` | - Initial mount fetches `GET /api/children` and renders real `ChildProfileDto` status (`SAFE`, `OUT_OF_SOCIETY`, `MISSING`) without hardcoded `'SAFE ON PREMISES'` or `'DOB 14 May 2018'`.<br>- `POST /api/children` awaits server 201 before updating list/showing confirmation; duplicate click while in flight is blocked.<br>- HTTP `403 RESIDENT_OWNERSHIP_REQUIRED` and `503` display formatted `ApiError` visibly with zero fake success and zero `localStorage` writes.<br>- `PATCH /api/children/:id` and `POST /api/children/:id/archive` update state authoritatively; switching `currentUser` clears all local UI state immediately. |
| **4.3** | `tests/issue06_b23_phase4_resident_pickups.test.ts` | - Zero hardcoded fallback escorts (`Radha Bai`, `Santosh Yadav`) when a child has 0 escorts.<br>- Multi-child selection targets `selectedChildId` (never hardcoded `children[0]`).<br>- Add/edit/revoke/archive pickup await backend responses, lock against duplicate submit, render masked `XXXX-${last4}` only, and refresh passes after revoke/archive/status-to-REVOKED.<br>- `400 RAW_ID_DOCUMENT_FORBIDDEN` and `422 REVOKED_PICKUP_CANNOT_BE_REACTIVATED` display visibly without local state mutation. |
| **4.4** | `tests/issue06_b23_phase4_resident_passes.test.ts` | - `POST /api/children/passes` returns one-time `qrPayload` rendered ONLY in ephemeral modal state; closing modal, unmounting, or logging out immediately clears `qrPayload`/`bearerToken`.<br>- `GET /api/children/passes` list refresh NEVER recreates or fabricates a QR token; zero `bearerToken`/`qrPayload`/`tokenHash` in `localStorage`/`sessionStorage`.<br>- Double-click submit lock (`inFlightRef`) guarantees at most 1 `POST /passes` request per user gesture.<br>- `409 CHILD_MISSING_ALERT_ACTIVE`, `422 PICKUP_AUTHORIZATION_EXPIRED`, `429` (`retryAfterSeconds`) surface visibly.<br>- Effective `EXPIRED` pass renders expired state and blocks revocation; active pass revocation calls `POST /api/children/passes/:id/revoke` and refreshes pass list. |
| **4.5** | `tests/issue06_b23_phase4_resident_sos.test.ts` | - Both `Report Missing` and `ONE_TAP_SOS` `Child Safety SOS` invoke `POST /api/children/sos` with `childId` + `location`; zero green banner before HTTP 201.<br>- `409 DUPLICATE_ACTIVE_SOS_ALERT` refreshes `GET /api/children/alerts` and displays existing active alert cleanly.<br>- Resident alert view displays live `ACTIVE`/`ACKNOWLEDGED`/`RESOLVED`/`FALSE_ALARM` status and responder notes, with **zero** Acknowledge/Resolve buttons for `resident` role.<br>- Non-child emergencies (`MEDICAL`, `FIRE`, `SECURITY`, `LIFT`, `ELECTRICAL`) still invoke `safetyCommandEngine.triggerOneTapSOS()` with `0` Child Safety API calls. |
| **4.6** | `tests/issue06_b23_phase4_resident_realtime.test.ts` | - Real `RealtimeService` SSE events (`CHILD_PROFILE_UPDATED`, `CHILD_PICKUP_REVOKED`, `CHILD_GATE_PASS_VERIFIED`, `CHILD_EXIT_TRIGGERED`, `CHILD_SAFETY_ALERT_ACKNOWLEDGED`, `CHILD_SAFETY_ALERT_RESOLVED`) trigger debounced authoritative backend refreshes for their exact scopes.<br>- `RECONNECTING → CONNECTED` triggers full resync; `OFFLINE` shows offline indicator and clears stale snapshots.<br>- Unmount & Strict Mode double-mount leave `0` leaked listeners; legacy `CHILD_SAFETY_UPDATED` topic is no longer subscribed. |

---

## 2. Mandatory Regression Gates After Every Subphase

1. New subphase test suite (`npx jest tests/issue06_b23_phase4_*.test.ts --no-cache`)
2. Phase 1, Phase 2, and Phase 3 suites (`issue06_b23_api_client`, `issue06_b23_realtime_sse`, `issue06_b23_auth_realtime_lifecycle`, `issue06_b23_child_safety_data_layer`, `issue06_b23_child_safety_realtime_hook`)
3. Full offline Jest suite (`npm test -- --silent`) — run sequentially on its own
4. `npx tsc --noEmit` (exit `0`)
5. `npm run build` (`tsc -b && vite build`, exit `0`)
6. Static security scans across `src/`:
   - `0` `EventSource`
   - `0` query-string SSE tokens
   - `0` active `BroadcastChannel` / `postMessage`
   - `0` obsolete Child Safety `localStorage` keys in runtime code
   - `0` `idProofNumber` / `Radha Bai` / `Santosh Yadav` / `Siddharth Malhotra` / `DOB 14 May 2018` / `'B-1204'` in resident Child Safety modules
   - `0` persistence of `bearerToken` or `qrPayload`
   - `0` `setInterval` polling in Child Safety UI/hooks

