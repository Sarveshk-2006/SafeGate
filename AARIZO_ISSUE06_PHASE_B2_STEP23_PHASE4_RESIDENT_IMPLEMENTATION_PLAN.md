# AARIZO ISSUE-06 — Phase B.2.3 — Phase 4 Resident Implementation Plan

**Date:** 2026-11-18  
**Repository:** `D:\AAZIRA\AARIZO`  
**Architectural Strategy:** Keep `ResidentChildSafetyPage.tsx`, `ResidentEmergencyPage.tsx`, `AdminSafetyCommandPage.tsx`, `VisitorPassHubPage.tsx`, and `SafetyCommandHub.tsx`'s general emergency / admin tabs intact by introducing a clean, modular resident Child Safety controller & UI module under `src/domains/safety/` wired into `SafetyCommandHub.tsx`'s `CHILD_SAFETY` tab (and the `Child Safety SOS` trigger on `ONE_TAP_SOS`). Each subphase is implemented, tested, and verified before starting the next.

---

## Subphase 4.1 — Resident Child Safety UI/API Contract Mapping & Pure View-Model Helpers

- **Goal:** Establish pure, 100% unit-testable DTO mappers, validation helpers, effective-status calculators (`EXPIRED` pass/pickup detection), and form-to-request builders before touching JSX.
- **Exact Files to Create / Modify:**
  - Create `src/domains/safety/utils/childSafetyResidentHelpers.ts` (pure TypeScript helpers: `buildCreateChildPayload`, `buildUpdateChildPayload`, `buildCreatePickupPayload`, `buildCreateGatePassPayload`, `buildTriggerSosPayload`, `getEffectivePassStatus`, `getEffectivePickupStatus`, `canIssuePassForChild`, `canRevokePass`, `formatMaskedPickupId`, `mapGenderInputToDto`).
- **Existing Components Preserved:** All existing pages & components untouched in 4.1.
- **Canonical Service Methods / Types Used:** `src/types/childSafety.ts` canonical DTOs & request types, `formatChildSafetyError` from `src/services/childSafetyService.ts`.
- **Backend Endpoints Modeled:** All 17 resident-authorized endpoints in `server/src/childSafety/router.ts`.
- **Required Tests:** `tests/issue06_b23_phase4_resident_helpers.test.ts` verifying payload sanitization (strips `residentId`/`flatId`/`societyId` for resident child creation; blocks raw `idProofNumber`; validates `idDocumentLast4` 1–4 chars; enforces `validUntil` ≤ 7 days & `maxUses` 1–10; computes effective `EXPIRED` pass/pickup states; enforces `childId` + `location` for resident SOS).
- **Security Considerations:** Zero raw government ID fields accepted; zero hardcoded `'B-1204'`/`'soc-gvs'`/`'Siddharth Malhotra'` fallbacks; strict role check for resident-only auto-ownership.
- **Dependencies / Blockers:** None — **recommended first implementation subphase**.

---

## Subphase 4.2 — Child Registration, Listing, Editing & Archival

- **Goal:** Replace deprecated `safetyCommandEngine.getChildren()` and `addChildProfile()` in `SafetyCommandHub.tsx` with authoritative async `childSafetyService` operations, multi-child selection (`selectedChildId`), loading/empty/error states, and real profile edit/archive workflows.
- **Exact Files to Create / Modify:**
  - Create `src/domains/safety/components/ResidentChildSafetyPanel.tsx` (owns resident Child Safety async state, session-reset effect on `currentUser?.id`/`societyId`, `selectedChildId`, child cards grid, Add/Edit Child modal, Archive confirmation).
  - Modify `src/domains/safety/components/SafetyCommandHub.tsx` (mount `<ResidentChildSafetyPanel />` inside `activeTab === 'CHILD_SAFETY'`; remove legacy `children` state & `handleAddChildSubmit` from `SafetyCommandHub.tsx`).
- **Existing Components Preserved:** `ResidentChildSafetyPage.tsx`, `ResidentEmergencyPage.tsx`, `AdminSafetyCommandPage.tsx`, `SafetyCommandHub.tsx` `ONE_TAP_SOS` / `COMMAND_CONSOLE` / `GATE_VERIFIER` tabs, `VisitorPassHubPage.tsx`, `MyFlatPage.tsx`, `Modal.tsx`.
- **Canonical Service Methods Used:** `listChildren()`, `createChildProfileAsync()`, `updateChildProfile()`, `archiveChildProfile()`, `formatChildSafetyError()`.
- **Backend Endpoints Involved:** `GET /api/children`, `POST /api/children`, `PATCH /api/children/:id`, `POST /api/children/:id/archive`.
- **Required Tests:** Unit/controller tests verifying authoritative list load, real status badge rendering (`SAFE`/`OUT_OF_SOCIETY`/`MISSING`), resident registration omitting `residentId`/`flatId`/`societyId`, `403 RESIDENT_OWNERSHIP_REQUIRED` error display, duplicate-submit prevention, edit & archive flows, session-switch state reset, and zero localStorage writes.
- **Security Considerations:** Omit `residentId`/`flatId`/`societyId` for `resident` role; direct `secretary`/`admin` visitors on `/resident/child-safety` to Phase 6 Admin Desk for creation; clear local state on user/society change.
- **Dependencies / Blockers:** Subphase 4.1.

---

## Subphase 4.3 — Authorized Pickup Management (Add / Edit / Revoke / Archive)

- **Goal:** Eliminate hardcoded demo escorts (`Radha Bai`, `Santosh Yadav`), remove prohibited `idProofNumber` state, remove fake local-only `handleRemoveEscort`, and integrate full per-child authorized pickup management with cascade pass refresh.
- **Exact Files to Create / Modify:**
  - Create `src/domains/safety/components/ResidentAuthorizedPickupsSection.tsx` (per-child escort list, masked ID badge, `idVerificationStatus` pill, effective `EXPIRED` indicator, Add/Edit modal with optional `idDocumentType` + `idDocumentLast4` (max 4 chars) + `validUntil`, Revoke & Archive actions with confirmation).
  - Modify `src/domains/safety/components/ResidentChildSafetyPanel.tsx` (mount `ResidentAuthorizedPickupsSection` bound to `selectedChild`, refreshing both children/pickups and passes on revoke/archive/status update).
  - Modify `src/domains/safety/components/SafetyCommandHub.tsx` (remove dead `pickupForm`, `handleAddPickupSubmit`, `handleRemoveEscort`, `selectedEscortForDetail`, and legacy `ADD_PICKUP` modal).
- **Existing Components Preserved:** `SafetyCommandHub` non-child tabs, `Modal.tsx`, all other resident pages.
- **Canonical Service Methods Used:** `listAuthorizedPickups()`, `addAuthorizedPickup()`, `updateAuthorizedPickup()`, `revokeAuthorizedPickup()`, `archiveAuthorizedPickup()`, `listGatePasses()`.
- **Backend Endpoints Involved:** `GET/POST /api/children/:childId/pickups`, `PATCH/DELETE /api/children/:childId/pickups/:pickupId`, `POST /api/children/:childId/pickups/:pickupId/revoke`.
- **Required Tests:** Tests verifying zero demo fallback escorts, `idDocumentLast4` validation (rejecting raw IDs), awaited add/edit/revoke/archive with duplicate-submit lock, visible `422 REVOKED_PICKUP_CANNOT_BE_REACTIVATED` & `400 RAW_ID_DOCUMENT_FORBIDDEN` errors, and post-revoke pass list refresh.
- **Security Considerations:** Never collect or persist raw government ID numbers; never show fake success before server response; disable pass generation for `REVOKED`/`EXPIRED`/`ARCHIVED` escorts.
- **Dependencies / Blockers:** Subphase 4.2.

---

## Subphase 4.4 — One-Time Secure Gate Pass Creation, QR Display & Revocation

- **Goal:** Replace the 100% fake `GENERATE_PASS` modal with real backend pass issuance, secure one-time `QRCodeSVG` (`qrcode.react`) rendering, real pass list (`ACTIVE`/`USED`/`EXPIRED`/`REVOKED`), pass revocation, and read-only exit log history.
- **Exact Files to Create / Modify:**
  - Create `src/domains/safety/components/ResidentGatePassesSection.tsx` (Generate Pass modal with active escort selector, validity duration ≤7d, `maxUses` 1–10; One-Time QR Presentation Modal using `QRCodeSVG` directly from `qrcode.react` strictly while `oneTimeCreatedPass?.qrPayload` exists in ephemeral React state; Pass List with effective `EXPIRED` badge, `passCode`, usage counter, Revoke button; collapsible Exit History from `listExitLogs()`).
  - Modify `src/domains/safety/components/ResidentChildSafetyPanel.tsx` (integrate `ResidentGatePassesSection` and pass `onPassCreated`/`onPassRevoked` refresh hooks; clear `oneTimeCreatedPass` on session switch/unmount).
  - Modify `src/domains/safety/components/SafetyCommandHub.tsx` (remove dead legacy `GENERATE_PASS` modal).
- **Existing Components Preserved:** `VisitorPassHubPage.tsx` (completely untouched!), `src/components/ui/QRGenerator.tsx` (untouched; Child Safety renders `QRCodeSVG` directly so raw `qrPayload` is never echoed as plaintext fallback label or replaced with `'DWELLORA-QR-PASS'`).
- **Canonical Service Methods Used:** `listGatePasses()`, `getGatePassById()`, `createGatePass(data, { idempotencyKey })`, `revokeGatePass()`, `listExitLogs()`.
- **Backend Endpoints Involved:** `GET/POST /api/children/passes`, `GET /api/children/passes/:id`, `POST /api/children/passes/:id/revoke`, `GET /api/children/exit-logs`.
- **Required Tests:** Tests verifying one-time `qrPayload` rendered ONLY from HTTP 201 creation response, cleared on modal close/unmount/logout, never written to storage/logs, never fabricated on list revisit; double-click `inFlightRef` lock prevents duplicate `POST /passes`; `409 CHILD_MISSING_ALERT_ACTIVE`, `422 PICKUP_AUTHORIZATION_EXPIRED`, and `429 RATE_LIMIT_EXCEEDED` (`retryAfterSeconds`) display visibly; effective `EXPIRED` display & active-only revocation.
- **Security Considerations:** Zero persistence of `bearerToken`/`qrPayload`; zero exposure of `tokenHash`; double-submit lock mitigates backend `GAP-P4-BE-01`.
- **Dependencies / Blockers:** Subphase 4.3.

---

## Subphase 4.5 — Resident Child Safety SOS & Live Alert Status Integration

- **Goal:** Replace the 100% fake `MISSING_ALERT` modal AND reroute the `ONE_TAP_SOS` `Child Safety SOS` card to `childSafetyService.triggerSos()`, while displaying live read-only `ChildSafetyAlertDto` status (`ACTIVE`/`ACKNOWLEDGED`/`RESOLVED`/`FALSE_ALARM`) and strictly preserving non-child general emergencies.
- **Exact Files to Create / Modify:**
  - Create `src/domains/safety/components/ResidentChildSosModal.tsx` (owned `childId` selector, `alertType` selector, required `location`, optional `lastSeenDetails` & `description`, awaited `triggerSos()`, `409 DUPLICATE_ACTIVE_SOS_ALERT` graceful handling, zero fake green banner before HTTP 201).
  - Create `src/domains/safety/components/ResidentChildAlertsSection.tsx` (displays resident's live `listAlerts()` with status badges, responder `acknowledgedByName`/`resolvedByName`, `resolutionNotes` — strictly read-only for `resident` role, zero Acknowledge/Resolve buttons!).
  - Modify `src/domains/safety/components/ResidentChildSafetyPanel.tsx` (mount `ResidentChildAlertsSection` + `ResidentChildSosModal`).
  - Modify `src/domains/safety/components/SafetyCommandHub.tsx` (route `ONE_TAP_SOS` card `category === 'CHILD_SAFETY'` to open `ResidentChildSosModal`; remove dead fake `MISSING_ALERT` modal; keep `MEDICAL`, `FIRE`, `SECURITY`, `LIFT`, `ELECTRICAL` on `safetyCommandEngine.triggerOneTapSOS()` untouched!).
- **Existing Components Preserved:** All 5 non-child emergency categories, `COMMAND_CONSOLE` (`handleAcknowledge`, `handleAssignSubmit`, `handleResolve`), `AdminSafetyCommandPage.tsx`, `ResidentEmergencyPage.tsx`.
- **Canonical Service Methods Used:** `triggerSos()`, `listAlerts()`.
- **Backend Endpoints Involved:** `POST /api/children/sos`, `GET /api/children/alerts`.
- **Required Tests:** Tests verifying `POST /api/children/sos` payload (`childId` + `location` required), no success banner before server HTTP 201, `409 DUPLICATE_ACTIVE_SOS_ALERT` refreshes and displays active alert, `429`/`503` retry-safe errors, zero Acknowledge/Resolve controls rendered for `resident`, and non-child `MEDICAL`/`FIRE` SOS still routes exclusively to `safetyCommandEngine` with `0` Child Safety API calls.
- **Security Considerations:** Do NOT add resident permissions to `acknowledgeAlert`/`resolveAlert`; require owned `childId`; never fabricate dispatch confirmation before HTTP 201.
- **Dependencies / Blockers:** Subphase 4.4.

---

## Subphase 4.6 — Resident Realtime Integration & Final Phase 4 UI Regression

- **Goal:** Wire Phase 3 `useChildSafetyRealtime()` into `ResidentChildSafetyPanel.tsx`, remove legacy `realTimeSync.subscribe('CHILD_SAFETY_UPDATED')` from `SafetyCommandHub.tsx`, display connection/offline/reconnecting status cleanly, and run full regression & security verification.
- **Exact Files to Create / Modify:**
  - Modify `src/domains/safety/components/ResidentChildSafetyPanel.tsx` (integrate `useChildSafetyRealtime()` with 250ms debounced scope-specific backend refreshes + monotonic `requestIdRef` stale-response guard + `onReconnect` full resync + `realtimeService.subscribeToStatus()` offline/reconnecting indicator).
  - Modify `src/domains/safety/components/SafetyCommandHub.tsx` (remove `realTimeSync.subscribe('CHILD_SAFETY_UPDATED', ...)` at `#L83`, keeping `realTimeSync.subscribe('EMERGENCY_ALERTS', ...)` for non-child emergencies).
- **Existing Components Preserved:** `useChildSafetyRealtime.ts`, `realtimeService.ts`, `VisitorPassHubPage.tsx` SSE listener, `ResidentServicesPage.tsx`, `MyFlatPage.tsx`.
- **Canonical Service / Hook Methods Used:** `useChildSafetyRealtime()`, `realtimeService.subscribeToStatus()`, `listChildren()`, `listGatePasses()`, `listAlerts()`, `listExitLogs()`.
- **Backend Endpoints / Topics Involved:** Authenticated Fetch SSE `/api/realtime/events` (all 14 exact Child Safety topics).
- **Required Tests:** End-to-end Phase 4 resident realtime controller tests (profile/pickup/pass/exit/alert events trigger exact backend refreshes; reconnect resyncs all scopes; offline banner displayed; unmount cleans up all 14 listeners; zero duplicate subscriptions; zero `EventSource`, `BroadcastChannel`, or polling) + full Jest suite + `npx tsc --noEmit` + `npm run build` + static scans.
- **Security Considerations:** Zero polling, zero native `EventSource`, zero `BroadcastChannel`; cross-society/unauthenticated events already fail closed in Phase 3 `useChildSafetyRealtime`; session switch clears `oneTimeCreatedPass` and all component arrays immediately.
- **Dependencies / Blockers:** Subphase 4.5.

