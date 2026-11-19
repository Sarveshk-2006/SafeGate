# AARIZO — ISSUE-06 Phase B.2.3: Child Safety Frontend Integration Audit

**Audit Date:** 2026-11-18  
**Phase:** ISSUE-06 — Phase B.2.3 (Read-Only Frontend Integration Audit & Implementation Planning)  
**Prerequisite Status:** Phase B.2.1 (`CONDITIONAL PASS`), Phase B.2.2 (`PASS — READY FOR CONDITIONAL B.2.2 CLOSURE`, 98/98 focused offline tests, 11/11 live PostgreSQL 16 tests, 363/363 full offline suite)  
**Audit Mode:** Strictly Read-Only (zero changes to source files, tests, Prisma schema, migrations, or environment configuration)  
**Audit Verdict:** `B.2.3 AUDIT COMPLETE — READY FOR IMPLEMENTATION PLANNING REVIEW`

---

## 1. Executive Summary

The existing AARIZO Child Safety frontend is **fundamentally disconnected** from the authoritative Phase B.2.2 relational backend APIs (`/api/children/*`). Instead of acting as an authenticated, fail-closed client over PostgreSQL-backed APIs, the frontend currently operates across **three fragmented `localStorage`-backed service layers** with duplicated UI flows, hardcoded mock seeds, raw government ID fields that are now rejected by the backend (`400 RAW_ID_DOCUMENT_FORBIDDEN`), fake UI-only modals that display false success banners without executing any API call, and a broken unauthenticated SSE client (`realtimeService.ts`) that sends zero Bearer tokens on `EventSource` connection and attempts blocked client-side `POST /api/realtime/broadcast` publishes (`403 PROTECTED_EVENT_TYPE_FORBIDDEN`).

### Headline Findings (Severity-Ranked)

| ID | Severity | Finding | Primary Source |
| :--- | :--- | :--- | :--- |
| **F-B23-01** | **CRITICAL** | **Client-Side Gate Verification & Weak QR Forgery:** `childSafetyService.verifyAndScanChildPickup()` and `SafetyCommandHub.tsx` (`GATE_VERIFIER`) authorize child exits exclusively via `localStorage` (`CP-QR-...` / `QR-CHILD-<NAME>-<FLAT>`) and never call `POST /api/children/passes/verify`. This completely bypasses B.2.2 256-bit CSPRNG tokens, atomic consumption, fail-closed `503` enforcement, and active `MISSING_CHILD` SOS exit blocks. | `src/services/childSafetyService.ts#L422-L508`, `src/domains/safety/components/SafetyCommandHub.tsx#L173-L195`, `src/pages/dashboard/security/ChildGateScannerPage.tsx#L101-L143` |
| **F-B23-02** | **CRITICAL** | **Fake UI-Only Modals in Resident Portal (`SafetyCommandHub`):** Both the **"Generate Child Gate Pass"** (`GENERATE_PASS`) and **"Dispatch Missing Child Alarm"** (`MISSING_ALERT`) modals in `ResidentChildSafetyPage` (`SafetyCommandHub.tsx`) only close the modal and display a green success toast — **zero backend call and zero state mutation occur**. | `src/domains/safety/components/SafetyCommandHub.tsx#L1369-L1373`, `#L1663-L1667` |
| **F-B23-03** | **CRITICAL** | **Broken Unauthenticated SSE Stream & Blocked Client Broadcasts:** `realtimeService.ts` opens `EventSource('/api/realtime/stream?societyId=soc-gvs')` in its constructor with **no Bearer `?token=`**, causing continuous `401 AUTH_TOKEN_MISSING` failures. `AuthContext.tsx` never initializes or disconnects SSE on login/logout. Pages still invoke `realtimeService.publish('EMERGENCY_ALERTS' | 'CHILD_SAFETY_UPDATED' | 'CHILD_EXIT_SCANNED')`, which B.2.2 blocks with `403`. | `src/services/realtimeService.ts#L97`, `#L122-L145`, `#L277`; `src/context/AuthContext.tsx#L1-L371`; `src/services/childSafetyService.ts#L583`, `#L615` |
| **F-B23-04** | **HIGH** | **Split-Brain Dual/Triple `localStorage` Architecture & Read/Write Divergence:** Three independent `localStorage` engines exist (`childSafetyService.ts`, `safetyCommandEngine.ts`, and `safetyCommandService.ts`). Inside `safetyCommandEngine.ts`, `getChildren()` reads from `childSafetyService.getChildren('soc-gvs')`, while `addChildProfile()` / `addAuthorizedPickup()` write to `aarizo_child_profiles_v3` — newly created children/pickups are silently lost on reload. | `src/domains/safety/services/safetyCommandEngine.ts#L101-L117`, `#L311-L348`; `src/services/childSafetyService.ts#L199-L285`; `src/services/safetyCommandService.ts#L110-L160` |
| **F-B23-05** | **HIGH** | **Silent Error Swallowing in `apiClient.ts` & Missing B.2.2 Endpoints:** `apiRequest<T>()` returns `null` on every HTTP `4xx`/`5xx` and network error, discarding structured backend error codes (`CHILD_MISSING_ALERT_BLOCKED`, `PASS_ALREADY_CONSUMED`, `DUPLICATE_ACTIVE_SOS_ALERT`, `RAW_ID_DOCUMENT_FORBIDDEN`, `DATABASE_UNAVAILABLE`, `503`). Furthermore, `apiClient.ts` lacks 13 of 19 B.2.2 endpoints, and `verifyChildPass()` sends `{ societyId }` with no `bearerToken`. | `src/services/apiClient.ts#L18-L55`, `#L325-L348` |
| **F-B23-06** | **HIGH** | **Deprecated Legacy Collection & Raw Government ID Violations:** `childSafetyService.saveChildProfile()` calls `childRepository.create()` (`POST /api/collections/children` -> `403 CHILD_SAFETY_COLLECTION_FORBIDDEN`). Frontend forms (`SafetyCommandHub`, `AdminChildSafetyPage`) collect and display raw `idProofNumber` (`Aadhaar`, `DL-MH02-2018-9182`), which B.2.2 rejects with `400 RAW_ID_DOCUMENT_FORBIDDEN`. | `src/repositories/childSafety/ChildRepository.ts#L1-L39`, `src/services/childSafetyService.ts#L31-L169`, `#L283`, `src/domains/safety/components/SafetyCommandHub.tsx#L826-L845`, `#L1531-L1546` |
| **F-B23-07** | **MEDIUM** | **One-Time Pass Token & Resolution Notes Contract Mismatches:** (a) Backend returns raw `bearerToken` / `qrPayload` **once** on `POST /api/children/passes` and never exposes it again, breaking `ChildGateScannerPage`'s "Quick Demo Passes" click-to-scan buttons and requiring an immediate QR display/share/download modal for guardians. (b) `POST /api/children/alerts/:id/resolve` requires non-empty `resolutionNotes`, which both `ChildGateScannerPage` and `AdminChildSafetyPage` omit. | `src/pages/dashboard/security/ChildGateScannerPage.tsx#L145-L153`, `#L235-L248`; `src/pages/dashboard/admin/AdminChildSafetyPage.tsx#L118-L125` |
| **F-B23-08** | **MEDIUM** | **Route Guard vs Backend RBAC Mismatches & Hardcoded `soc-gvs` Fallbacks:** `/security/child-safety` allows `secretary` in `src/routes/index.tsx#L232`, but backend `POST /api/children/passes/verify` permits only `guard` and `admin`. `/admin/child-safety` excludes `committee`, even though backend permits `committee` read & alert management. Multiple pages hardcode `'soc-gvs'` / `'soc-1'` fallbacks instead of relying on authenticated backend tenant derivation. | `src/routes/index.tsx#L195-L250`, `src/pages/dashboard/security/ChildGateScannerPage.tsx#L28`, `src/pages/dashboard/admin/AdminChildSafetyPage.tsx#L30`, `src/domains/safety/services/safetyCommandEngine.ts#L43` |

---

## 2. Complete Inventory of Frontend Child Safety Modules & Callers

### 2.1 Core Pages & Routes (`src/routes/index.tsx`)

| Route | Component | Route Guard (`allowedRoles`) | Actual Child Safety Data Source |
| :--- | :--- | :--- | :--- |
| `/resident/child-safety` | `src/pages/dashboard/resident/ResidentChildSafetyPage.tsx` | `resident`, `committee`, `secretary`, `admin` | Thin wrapper mounting `<SafetyCommandHub initialTab="CHILD_SAFETY" />` -> `safetyCommandEngine` + `childSafetyService` (`localStorage`) |
| `/resident/emergency` | `src/pages/dashboard/resident/ResidentEmergencyPage.tsx` | `resident`, `committee`, `secretary`, `admin` | Thin wrapper mounting `<SafetyCommandHub />` (contains `CHILD_SAFETY` & `GATE_VERIFIER` tabs!) |
| `/security/child-safety` | `src/pages/dashboard/security/ChildGateScannerPage.tsx` | `guard`, `secretary`, `admin` | `childSafetyService` (`localStorage`) + `realtimeService` (legacy event names) |
| `/security/terminal` | `src/pages/dashboard/security/SecurityTerminalPage.tsx` | `guard`, `secretary`, `admin` | Visitor Pass terminal (`apiClient.getVisitorPasses` / `verifyVisitorPass`). No direct Child Safety imports; navigates to `/security/child-safety` via `SecurityLayout` & `QuickActionSheet`. |
| `/security/emergency` | `src/pages/dashboard/security/SecurityEmergencyTerminalPage.tsx` | `guard`, `secretary`, `admin` | `safetyCommandService` (`localStorage`) + `realtimeService.publish('EMERGENCY_ALERTS')` (blocked `403`). Listens for `CHILD_ALERT_TRIGGERED` but never reads `/api/children/alerts`. |
| `/admin/child-safety` | `src/pages/dashboard/admin/AdminChildSafetyPage.tsx` | `secretary`, `admin` | `childSafetyService` (`localStorage`), zero SSE subscriptions, zero backend calls. |
| `/admin/safety-command` | `src/pages/dashboard/admin/AdminSafetyCommandPage.tsx` | `secretary`, `admin` | Thin wrapper mounting `<SafetyCommandHub />` (exposes `CHILD_SAFETY` & `GATE_VERIFIER` tabs backed by `localStorage`!). |

### 2.2 Services, Repositories, Types & Navigation Entry Points

- **Services & Repositories:**
  - `src/services/childSafetyService.ts` (626 lines) — Primary legacy `localStorage` store (4 keys: `communityos_children_profiles`, `communityos_child_pickup_qrs`, `communityos_child_pickup_logs`, `communityos_child_safety_alerts`), hardcoded `SEED_CHILDREN` with raw PII IDs, merges `societyService.getFamilyMembers()` + `db.ts` (`localStorage`), fire-and-forget broken calls to `childRepository.create()` and `apiClient.*`.
  - `src/domains/safety/services/safetyCommandEngine.ts` (434 lines) — Second `localStorage` store (`aarizo_emergency_incidents_v3`, `aarizo_child_profiles_v3`, `aarizo_pickup_records_v3`) used by `SafetyCommandHub.tsx`.
  - `src/services/safetyCommandService.ts` (364 lines) — Third `localStorage` store (`communityos_emergency_incidents`, `communityos_emergency_contacts`) used by `SecurityEmergencyTerminalPage.tsx` and `societyIntelligenceService.ts#L106`.
  - `src/repositories/childSafety/ChildRepository.ts` (39 lines) — Extends `BaseRepository<ChildProfile>` targeting `/api/collections/children` (now permanently blocked with `403 CHILD_SAFETY_COLLECTION_FORBIDDEN`).
  - `src/services/apiClient.ts` (427 lines) — Canonical HTTP client, currently missing 13/19 Child Safety endpoints and swallowing all error responses as `null`.
  - `src/services/realtimeService.ts` (500 lines) & `src/services/realTimeSync.ts` (12 lines) — SSE client & legacy `BroadcastChannel` wrapper.
  - `src/services/authStorage.ts` (309 lines) & `src/context/AuthContext.tsx` (371 lines) — Session/token storage (`authenticatedFetch`, `getAuthHeaders`, `aarizo:unauthorized` event).
  - `src/services/db.ts` — Legacy `localStorage` database consulted by `childSafetyService.getChildren()` to discover flats/residents (`db.getResidents`, `db.getFlats`).
- **Types:**
  - `src/types/childSafety.ts` (98 lines) — Legacy Child Safety types (`ChildProfile`, `AuthorizedPickupPerson` with `idProofNumber`, `ChildPickupQR`, `ChildPickupLog`, `ChildSafetyAlert`).
  - `src/domains/safety/types/index.ts` (78 lines) — Duplicate Child Safety & Emergency types (`ChildProfileItem`, `AuthorizedPickupPerson` with `idProofNumber`, `PickupRecord`, `EmergencyIncidentItem`).
- **UI & Navigation Entry Points:**
  - `src/domains/safety/components/SafetyCommandHub.tsx` (1,773 lines) — Shared tabbed hub (`ONE_TAP_SOS`, `INCIDENT_FEED`, `CHILD_SAFETY`, `GATE_VERIFIER`, `CONTACTS`).
  - Navigation links: `ResidentLayout.tsx#L23`, `SecurityLayout.tsx#L19`, `SocietyAdminLayout.tsx#L31`, `QuickActionSheet.tsx#L88-L127`, `ResidentProfilePage.tsx#L101`, `ResidentServicesPage.tsx#L23`, `usePushNotifications.ts#L73`, `sessionRouteTracker.ts#L22`.
- **Installed Libraries (`package.json`):**
  - `qrcode.react` (`^4.2.0`) is **already installed** and ready for rendering real one-time `AARIZO_CHILD_PASS:<token>` QR codes without adding new dependencies.
  - No camera barcode scanner library (e.g., `html5-qrcode`) is installed; `ChildGateScannerPage` currently relies on text input (supports USB/Bluetooth scanner keyboard-wedge or paste) plus simulated quick buttons.

---

## 3. Operation-by-Operation Audit Across All 6 Child Safety Domains

### Domain 1: Child Profiles (Create, List, View, Update, Archive)
- **Current Frontend Behavior:**
  - `childSafetyService.getChildren(societyId)` reads `localStorage` (`communityos_children_profiles`), seeds 2 hardcoded children (`Aarav Sharma`, `Diya Verma`) if empty, and dynamically synthesizes extra child records from `societyService.getFamilyMembers()` + `db.getResidents()`/`db.getFlats()` (`src/services/childSafetyService.ts#L201-L268`).
  - `saveChildProfile()` writes `localStorage`, fires `childRepository.create(updated).catch(() => {})` (`403`), and fires `apiClient.createChild(updated).catch(() => {})` (mismatched field names `name`/`age`/`parentName`/`parentPhone` instead of `fullName`/`reportedAge`/`guardianName`/`guardianPhone` -> `400` silently ignored).
  - `SafetyCommandHub.tsx#L130-L152` calls `safetyCommandEngine.addChildProfile()` which writes to `aarizo_child_profiles_v3`, while `getChildren()` reads from `childSafetyService.getChildren('soc-gvs')` — **write and read targets do not match**.
  - `SafetyCommandHub.tsx#L714` hardcodes `DOB 14 May 2018` and `SAFE ON PREMISES` on every child card regardless of actual profile data.
  - Neither `SafetyCommandHub` nor `AdminChildSafetyPage` provides real `PATCH /api/children/:id` (edit) or `POST /api/children/:id/archive` (archive) workflows.
- **Required B.2.3 Behavior:** Replace with async calls to `GET /api/children`, `POST /api/children`, `GET /api/children/:id`, `PATCH /api/children/:id`, `POST /api/children/:id/archive`. Remove `SEED_CHILDREN`, `db.ts` resident synthesis, and `ChildRepository`.

### Domain 2: Authorized Pickup Persons (Create, List, Update, Revoke, Archive)
- **Current Frontend Behavior:**
  - `childSafetyService.addAuthorizedPickupPerson()` and `revokeAuthorizedPickupPerson()` mutate an embedded `child.authorizedPickups[]` array inside `localStorage` (`src/services/childSafetyService.ts#L287-L362`). They never call `/api/children/:childId/pickups`.
  - `SafetyCommandHub.tsx#L154-L171`: `handleAddPickupSubmit()` always mutates `children[0].id` (ignoring whichever child the user clicked!), writes to `aarizo_child_profiles_v3` (never read back), and `handleRemoveEscort()` mutates React state in memory then immediately overwrites it by calling `loadData()`!
  - `SafetyCommandHub.tsx#L826-L845` renders hardcoded fallback escorts (`Radha Bai`, `Santosh Yadav`) with raw `idProofNumber: 'DL-MH02-2018-9182'` whenever a child has no pickups.
  - Forms collect `idProofNumber` (raw Aadhaar / Driving License) — **explicitly prohibited by B.2.1/B.2.2 (`400 RAW_ID_DOCUMENT_FORBIDDEN`)**.
- **Required B.2.3 Behavior:** Wire dedicated pickup CRUD to `GET/POST/PATCH /api/children/:childId/pickups` and `POST /api/children/:childId/pickups/:pickupId/revoke` / `DELETE`. Replace `idProofNumber` input with `idDocumentType` selector + optional `idDocumentLast4` (max 4 chars) + `validUntil` optional expiry. Bind actions to the selected `childId`, never `children[0]`.

### Domain 3: Child Gate Passes (Generate, List, View, Revoke)
- **Current Frontend Behavior:**
  - `SafetyCommandHub.tsx#L1369-L1373` (`GENERATE_PASS` modal): clicking **"Confirm Pass"** does **nothing** except close the modal and display a fake success banner (`"Child Gate Exit Pass generated and active for 4 hours!"`). No pass is created and no QR is rendered.
  - `childSafetyService.generatePickupQR()` (`#L379-L419`) generates an insecure client-side string `CP-QR-${Date.now()}-${4-char-random}`, saves it to `localStorage`, and fires-and-forgets `apiClient.createChildPass(newQR).catch(() => {})` (which fails due to wrong payload shape and ignores the backend's one-time `bearerToken` and `qrPayload`).
  - No frontend page currently supports pass revocation (`POST /api/children/passes/:id/revoke`), nor does any page render a real QR code (`qrcode.react`) for the one-time `qrPayload` (`AARIZO_CHILD_PASS:<64-hex-token>`).
- **Required B.2.3 Behavior:** Call `POST /api/children/passes`, capture the one-time `bearerToken`, `qrPayload`, and `passCode` in ephemeral React state ONLY (never persist `bearerToken` or `qrPayload` in `localStorage`/`sessionStorage`), render a scannable `QRCodeSVG` (`qrcode.react`) + Share/Copy/Download sheet with a clear one-time display notice, list passes via `GET /api/children/passes`, and support revocation via `POST /api/children/passes/:id/revoke`.

### Domain 4: Gate Verification & Exit Logs (Scan/Verify Pass, Handle Denials & 503, View Audit Logs)
- **Current Frontend Behavior:**
  - `ChildGateScannerPage.tsx#L101-L143` calls `childSafetyService.verifyAndScanChildPickup()`, which inspects `localStorage` (`communityos_child_pickup_qrs`), rejects or accepts locally, marks the child `OUT_OF_SOCIETY` in `localStorage`, and appends a fake log to `communityos_child_pickup_logs`.
  - `ChildGateScannerPage.tsx#L235-L248` displays **"Quick Demo Passes (Click to test scan)"** buttons populated from `activeQRs` (`qr.qrCode`). Under B.2.2, `GET /api/children/passes` returns only `passCode` (display code) and **never** `bearerToken` or `qrPayload`, and `POST /api/children/passes/verify` rejects `passCode` (`400 BEARER_TOKEN_REQUIRED`). Thus guards cannot click a list item to self-authorize an exit — they must scan or paste the caretaker's presented QR/token!
  - `SafetyCommandHub.tsx#L173-L195` (`GATE_VERIFIER` tab) matches plain child name + pickup name against `localStorage` (`QR-CHILD-...`), completely bypassing cryptographic pass verification.
  - Neither page handles `503 VERIFICATION_UNAVAILABLE` (fail-closed gate hold), `409 CHILD_MISSING_ALERT_BLOCKED` (critical missing-child alarm stop), `409 PASS_ALREADY_CONSUMED`, `422 PASS_EXPIRED`, `422 PASS_REVOKED`, or `429 RATE_LIMIT_EXCEEDED`.
- **Required B.2.3 Behavior:** Wire `ChildGateScannerPage` strictly to `POST /api/children/passes/verify` (accepting `qrPayload` or `bearerToken`, `gateId`, optional `notes`) and `GET /api/children/exit-logs`. Remove client-side verification and local demo bypass buttons. Display distinct fail-closed visual verdicts: `GRANTED`, `DENIED` (with exact reason), `CRITICAL LOCKDOWN: CHILD MISSING ALERT ACTIVE`, and `503 VERIFICATION UNAVAILABLE — DO NOT RELEASE CHILD`. Replace or link `SafetyCommandHub`'s `GATE_VERIFIER` tab to the authoritative pass-verification flow (only visible to `guard`/`admin`).

### Domain 5: Child Safety SOS & Alerts (Trigger, List, Acknowledge, Resolve)
- **Current Frontend Behavior:**
  - `SafetyCommandHub.tsx#L1663-L1667` (`MISSING_ALERT` modal): **"DISPATCH ALARM NOW"** button is a complete no-op (only closes modal + shows fake banner).
  - `SafetyCommandHub.tsx#L91` (`ONE_TAP_SOS` with `CHILD_SAFETY` category): writes to `aarizo_emergency_incidents_v3` (`localStorage`), never calls `POST /api/children/sos`.
  - `childSafetyService.triggerMissingChildAlert()` (`#L560-L590`): writes `localStorage`, calls `apiClient.triggerChildSOS(newAlert)` without required `location` (fails `400`, silently swallowed), and calls `realtimeService.publish('EMERGENCY_ALERTS', ...)` (blocked `403`).
  - `ChildGateScannerPage.tsx#L145-L153` and `AdminChildSafetyPage.tsx#L118-L125`: resolve alerts with a single click (`childSafetyService.resolveSafetyAlert()`) in `localStorage` only — no `acknowledge` button (`POST /api/children/alerts/:id/acknowledge`), no `resolutionNotes` modal (`POST /api/children/alerts/:id/resolve` requires non-empty `resolutionNotes`), and no `FALSE_ALARM` option.
- **Required B.2.3 Behavior:** Wire Resident/Admin/Guard SOS triggers to `POST /api/children/sos` (collecting `childId`, `alertType`, `severity`, `location`, `description`, `lastSeenDetails`), handle `409 DUPLICATE_ACTIVE_SOS_ALERT` gracefully by surfacing the existing active alert, list alerts via `GET /api/children/alerts`, add **Acknowledge** (`POST /api/children/alerts/:id/acknowledge`), and require a **Resolve / Mark False Alarm** modal capturing `resolutionNotes` (`POST /api/children/alerts/:id/resolve`).

### Domain 6: Realtime Updates (SSE Consumption, Event Sync, Audio/Toasts)
- **Current Frontend Behavior:**
  - `realtimeService.ts` connects anonymously without `?token=` (`401`), subscribes to outdated event names (`CHILD_SAFETY_UPDATED`, `CHILD_ALERT_TRIGGERED`, `CHILD_EXIT_SCANNED`, `EMERGENCY_ALERTS`), and tries to broadcast sensitive events from the browser (`403`).
  - `AdminChildSafetyPage.tsx` has **zero** realtime subscriptions (stale state until manual refresh).
  - `realtimeService.ts#L326-L333` misroutes `CHILD_GATE_PASS_*` notifications to `/resident/deliveries` (because `topicUpper.includes('GATE')`) and does not trigger the emergency siren for `CHILD_SAFETY_SOS_TRIGGERED`.
- **Required B.2.3 Behavior:** Detailed in `AARIZO_ISSUE06_PHASE_B2_STEP23_REALTIME_INTEGRATION_AUDIT.md`.

---

## 4. Authentication, Session & Error Handling Audit

| Aspect | Current Implementation (`AuthContext.tsx`, `authStorage.ts`, `apiClient.ts`) | Risk / Required Change in B.2.3 |
| :--- | :--- | :--- |
| **Bearer Token Attachment** | `authStorage.authenticatedFetch()` attaches `Authorization: Bearer <token>` from `aarizo_auth_token` (`localStorage`). `apiClient.ts` delegates to `authenticatedFetch`. | Good foundation. Must verify `loginAsRole` mock tokens (`mock_token_*`) are rejected in non-dev/production and never mask real auth errors. |
| **Legacy Spoofable Headers** | `getAuthHeaders()` (`authStorage.ts#L268-L270`) and `apiClient.ts#L22-L24` still attach `x-society-id`, `x-user-id`, `x-user-role`. | B.2.2 ignores spoofed headers and derives identity strictly from JWT + DB membership. Frontend should stop relying on `currentUser.societyId || 'soc-gvs'` defaults for API payloads or display scoping. |
| **401 Unauthorized Handling** | `authenticatedFetch` clears session & dispatches `aarizo:unauthorized`; `AuthContext` resets user to `UNAUTHENTICATED`. | Good, but `realtimeService` MUST also close its `EventSource` on `aarizo:unauthorized` and `logout()`, and reconnect with the fresh token on login and Firebase `onIdTokenChanged` token refresh! |
| **Error Swallowing (`apiClient.ts`)** | `apiRequest<T>()` catches all errors and returns `null` for `400`, `403`, `404`, `409`, `422`, `429`, `500`, `503`, and network failures. | **Must fix for Child Safety:** Introduce a strict `apiRequestStrict<T>()` helper returning typed responses or throwing a structured `ApiError` (`{ status, code, message, details }`) so pages can fail closed on `503`/offline and display exact actionable messages for `409`/`422`/`429`. |
| **Tenant Derivation in UI** | `AdminChildSafetyPage` (`#L30`), `ChildGateScannerPage` (`#L28`), `SecurityEmergencyTerminalPage` (`#L26`), `safetyCommandEngine` (`#L43`, `#L313`) all fall back to `'soc-gvs'` or `'soc-1'`. | Remove hardcoded society IDs from Child Safety services/pages; let backend derive tenant from JWT (`societyId` sent only when platform `admin` explicitly selects a target society). |

---

## 5. Security Conflicts With Phase B.2.2 Guarantees

1. **Fail-Closed Gate Authorization Violation:** Any fallback from network/503 error to `localStorage` pass lookup would directly violate B.2.1 `F-B21-01` and B.2.2 fail-closed rules. B.2.3 MUST have **zero** offline pass approval fallback.
2. **Raw Government ID Collection Violation:** Collecting `idProofNumber` (Aadhaar/DL/PAN/Passport) violates B.2.1 `F-B21-04` and triggers `400 RAW_ID_DOCUMENT_FORBIDDEN`. All pickup forms and display cards must migrate to `idDocumentType` + optional `idDocumentLast4`.
3. **Predictable / Forged QR Payloads:** Generating `CP-QR-...` or `QR-CHILD-<name>-<flat>` in the browser violates B.2.1/B.2.2 cryptographic bearer pass security. Only server-generated `qrPayload` (`AARIZO_CHILD_PASS:<64-hex>`) from `POST /api/children/passes` is valid.
4. **One-Time Secret Exposure in Browser Storage:** Storing `bearerToken` or `qrPayload` in `localStorage`, `sessionStorage`, Redux persist, or URL query strings would expose active gate credentials to XSS/shared-device theft. Keep `bearerToken`/`qrPayload` strictly in ephemeral in-memory component state during the creation modal session only.
5. **Legacy Collection Route Usage (`F-B22-01`):** Calling `/api/collections/children` via `ChildRepository` is permanently forbidden (`403`). `ChildRepository` must be removed/deprecated from active write/read paths.
6. **Client Broadcast Forgery (`F-B22-02A`):** Calling `POST /api/realtime/broadcast` for `EMERGENCY_ALERTS`, `CHILD_*`, or `GATE_PASS_*` is permanently forbidden (`403`). All Child Safety realtime signals must originate exclusively from the server after DB commit.

---

## 6. Classification of Preserved Phase B.2.1 Pre-Cutover Risks

Per project governance, all six Phase B.2.1 pre-cutover risks remain **OPEN** and are explicitly tracked below (none are closed by this frontend audit):

| # | Preserved Phase B.2.1 Risk | Status | Relevance to Phase B.2.3 Frontend Integration |
| :--- | :--- | :--- | :--- |
| 1 | Legacy backfill primary-key collision quarantine | **OPEN** (Pre-cutover DB migration scope) | Out of B.2.3 frontend code scope; frontend must never rely on legacy synthetic IDs (`child-1`, `fam-...`) and must always use server-assigned UUID/CUID primary keys. |
| 2 | Malformed embedded `authorizedPickups[]` quarantine | **OPEN** (Pre-cutover DB migration scope) | Frontend must render relational `pickups[]` returned by `/api/children` & `/api/children/:childId/pickups` and gracefully handle empty `pickups[]` (no hardcoded fake fallback escorts!). |
| 3 | Explicit cross-society `residentId` fallback handling | **OPEN** (Pre-cutover DB migration scope) | Admin child creation UI (`POST /api/children`) must select `residentId` + `flatId` strictly from the active society's resident/flat roster so cross-society references cannot be submitted. |
| 4 | `UPDATE` actor-trigger test coverage | **OPEN** (DB trigger test scope) | Backend/DB verification item; frontend `PATCH /api/children/:id` and `PATCH .../pickups/:pickupId` should be tested end-to-end against live PG 16 so trigger enforcement is exercised. |
| 5 | Remaining database `CHECK` assertions | **OPEN** (DB constraint test scope) | Frontend form validation (e.g., `idDocumentLast4` <= 4 chars, `validUntil > validFrom`, positive `maxUses`, non-empty `resolutionNotes`) should mirror DB `CHECK` rules while relying on backend enforcement as authoritative. |
| 6 | CI wiring for `AARIZO_ISOLATED_TEST_DATABASE_URL` | **OPEN** (CI/DevOps scope) | Remains required before full ISSUE-06 closure so B.2.2 + B.2.3 live PG integration suites run automatically in CI. |

