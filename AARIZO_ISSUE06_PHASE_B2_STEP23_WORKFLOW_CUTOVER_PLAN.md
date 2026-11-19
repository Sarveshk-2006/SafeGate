# AARIZO — ISSUE-06 Phase B.2.3: Workflow Cutover & Feature Preservation Plan

This document finalizes the exact end-to-end cutover design for **Child Gate Pass QR**, **SOS & Emergency**, **Child Status / Re-Entry Semantics**, and the **12-Area Feature Preservation Checklist**.

---

## 1. Child Gate Pass QR Lifecycle Cutover (Section 6)

### 1.1 Pass Generation (`POST /api/children/passes`)
- **Authoritative Backend Contract (`server/src/childSafety/router.ts#L209-L410`):**
  - Roles: `resident` (own child), `secretary`, `admin`.
  - Required fields: `childId`, `validUntil` (ISO timestamp, strictly after `validFrom` and in the future, <= 7 days).
  - Conditional required field: **`pickupPersonId` is REQUIRED (`422 AUTHORIZED_PICKUP_REQUIRED`) unless `child.exitPermissionMode === 'SOLO_ALLOWED' && child.allowedSoloExit === true`!**
  - Optional fields: `validFrom` (defaults to `now`), `maxUses` (int `1–10`, default `1`), `notes` (<= 500 chars), and for solo-allowed passes optional `pickupPersonName`/`pickupPersonPhone`.
  - Rate limit: `20 requests / 10 minutes`.
  - Response `201`: `{ ...ChildGatePassDto, bearerToken: string (64-hex), qrPayload: "AARIZO_CHILD_PASS:<64-hex>" }`.
- **Frontend Cutover Behavior (`OneTimeGatePassModal.tsx`):**
  1. When opening the modal for a child, inspect `child.exitPermissionMode` and active `child.pickups` (`status === 'ACTIVE'`).
  2. If `exitPermissionMode !== 'SOLO_ALLOWED'` and the child has **zero active pickups**, display an inline guidance banner with a quick button to open **Add Authorized Pickup** first (preventing guaranteed `422 AUTHORIZED_PICKUP_REQUIRED` frustration).
  3. On submit, call `childSafetyService.createGatePass(payload)` (`POST /api/children/passes`). Show loading state; **never** display success before `201` resolves.
  4. On `201`, store `{ pass, bearerToken, qrPayload }` **strictly in ephemeral React component state** (`useState`) — **NEVER** write `bearerToken` or `qrPayload` to `localStorage`, `sessionStorage`, IndexedDB, URL query params, or `console.log`.
  5. Immediately render the **One-Time Gate Pass QR Sheet**:
     - Render `<QRCodeSVG value={createdPass.qrPayload} size={220} level="M" includeMargin />` using the **existing `qrcode.react` (`^4.2.0`) dependency**.
     - Display `passCode` (`CGP-XXXX-XXXX`), child name, pickup person name, `validFrom` -> `validUntil` countdown/expiry, and `maxUses` (`0 / maxUses used`).
     - Provide **Copy Pass Payload**, **Share** (Web Share API fallback to clipboard), and **Download QR PNG** (off-screen canvas export) buttons so the parent can send the QR to the escort.
     - Display a prominent security callout: *"One-Time Secret QR: Save or share this pass now. For your child's safety, AARIZO does not store the raw token and cannot display this QR again once closed. If lost, revoke this pass and generate a new one."*
  6. On modal close or component unmount (`useEffect` cleanup), overwrite `bearerToken` / `qrPayload` state to `null`.
  7. In the pass list (`GET /api/children/passes`), display metadata (`passCode`, escort name, `validUntil`, `status`, `currentUses / maxUses`) and a **Revoke Pass** action (`POST /api/children/passes/:id/revoke` with optional reason) for `ACTIVE` passes.

### 1.2 Gate Pass Verification (`POST /api/children/passes/verify`)
- **Authoritative Backend Contract (`server/src/childSafety/router.ts#L470-L885`):**
  - Roles: **`guard`, `admin` ONLY**.
  - Request body: `{ qrPayload?: string, bearerToken?: string, gateId?: string, notes?: string }`.
  - Rate limit: `30 requests / 1 minute`.
  - **NEVER** replicate token hashing, expiry, or pass validation in the browser.
- **Frontend Cutover Behavior (`ChildGateScannerPage.tsx`):**
  1. Guard scans caretaker's QR code via keyboard-wedge scanner (or pastes `AARIZO_CHILD_PASS:<hex>` / raw 64-hex token) into the existing scanner input, selects `gateId` (e.g., `MAIN_GATE`, `NORTH_GATE`), and submits.
  2. Call `childSafetyService.verifyGatePass({ qrPayload, gateId, notes })`.
  3. Render exact, unambiguous verdict banners matched to verified B.2.2 responses:
     - **`200` (`authorized: true, outcome: 'ALLOWED'`):** Bold green **GATE CLEARED — AUTHORIZED EXIT** card showing child name, flat number, pickup escort, `passCode`, remaining uses (`currentUses/maxUses`), and exit log timestamp; immediately refresh `/passes` and `/exit-logs`.
     - **`409` (`CHILD_MISSING_ALERT_BLOCKED`, `outcome: 'MISSING_ALERT_BLOCKED'`):** Flashing crimson **CRITICAL GATE LOCKDOWN — MISSING CHILD ALERT ACTIVE! HOLD CHILD & ESCORT AT GATE AND CONTACT SECURITY COMMAND!** + trigger emergency siren.
     - **`409` (`PASS_ALREADY_CONSUMED`, `PASS_EXPIRED`, `PASS_REVOKED`, `PASS_ARCHIVED`, `CHILD_ARCHIVED`, `PICKUP_PERSON_UNAUTHORIZED`, `CHILD_STATE_CONFLICT`):** Bold red **EXIT DENIED** card showing exact backend reason (`error`) and denial code.
     - **`422` (`PASS_NOT_YET_VALID`, `ESCORT_REQUIRED`):** Red/amber **EXIT DENIED — POLICY / WINDOW** card showing exact reason.
     - **`400` (`BEARER_TOKEN_REQUIRED`):** Instructional warning: *"Display pass codes (`CGP-...`) cannot authorize exit. Please scan the caretaker's full QR pass or bearer token."*
     - **`404` (`INVALID_OR_UNKNOWN_PASS`):** Red **EXIT DENIED — INVALID OR UNRECOGNIZED GATE PASS** card.
     - **`429` (`RATE_LIMIT_EXCEEDED`):** Amber cooldown warning with retry wait.
     - **`503` (`BACKEND_UNAVAILABLE`, `outcome: 'VERIFICATION_UNAVAILABLE'`) or Network Error (`NETWORK_UNAVAILABLE`):** Critical fail-closed amber/crimson banner: **"VERIFICATION SERVICE UNAVAILABLE (FAIL-CLOSED) — DO NOT RELEASE CHILD. Hold at gate and retry when connection restores or escalate to Society Management."** Zero offline approve button.
  4. **Replacement of Legacy "Quick Demo Passes" Buttons:** Remove click-to-verify demo buttons ONLY in Phase 5 simultaneously with replacing them with the read-only **"Active Expected Passes"** roster (`GET /api/children/passes` showing `passCode`, child, flat, escort, expiry) so guards retain full situational visibility without violating one-time bearer security.

---

## 2. SOS & Emergency Workflows Cutover (Section 7)

### 2.1 Authoritative Backend Contracts Verified
1. **Child Safety SOS (`POST /api/children/sos`):**
   - Roles: `resident` (requires owned `childId`), `guard`, `secretary`, `committee`, `admin`.
   - Required: `location` (non-empty string); `childId` (required for `resident`; optional for `guard`/`secretary`/`committee`/`admin` if providing `childName` + `flatNumber`).
   - Optional: `alertType` (`MISSING_CHILD` default | `UNATTENDED_CHILD` | `UNAUTHORIZED_EXIT_ATTEMPT` | `EMERGENCY_SOS`), `severity` (`LOW|MEDIUM|HIGH|CRITICAL`, default `CRITICAL`), `description`, `lastSeenDetails`.
   - Rate limit: `10 / 5 minutes`.
   - Atomic backend effects: sets child `status = 'MISSING'` (when `MISSING_CHILD`), creates `ChildSafetyAlert` + linked `EmergencyIncident`, and emits **`CHILD_SAFETY_SOS_TRIGGERED`** + **`EMERGENCY_INCIDENT_CREATED`** (audience: `guard`, `secretary`, `committee`, `admin` + owner).
   - Duplicate protection: `409 DUPLICATE_ACTIVE_SOS_ALERT` if an active/acknowledged alert of the same type already exists for that child.
2. **Alert Listing (`GET /api/children/alerts`):**
   - Roles: `resident` (own/reported), `guard`, `secretary`, `committee`, `admin`. Optional `?status=ACTIVE|ACKNOWLEDGED|RESOLVED|FALSE_ALARM`.
3. **Alert Acknowledge (`POST /api/children/alerts/:id/acknowledge`):**
   - Roles: `guard`, `secretary`, `committee`, `admin`. Optional `{ notes }`. Transitions `ACTIVE -> ACKNOWLEDGED`, emits `CHILD_SAFETY_ALERT_ACKNOWLEDGED`.
4. **Alert Resolve (`POST /api/children/alerts/:id/resolve`):**
   - Roles: `guard`, `secretary`, `committee`, `admin`. **Required: non-empty `resolutionNotes`**. Optional `status: 'RESOLVED' | 'FALSE_ALARM'` (default `'RESOLVED'`). Restores `MISSING` child to `SAFE` if no other active `MISSING_CHILD` alert remains; marks linked `EmergencyIncident` `RESOLVED`; emits `CHILD_SAFETY_ALERT_RESOLVED`.
5. **General Non-Child `EmergencyIncident` (`server/src/index.ts#L2289-L2357`):**
   - `GET /api/emergency-incidents` (excludes `CHILD_SAFETY` for residents; residents read child SOS strictly via `/api/children/alerts`).
   - `POST /api/emergency-incidents` (`resident`, `guard`, `secretary`, `admin`; persists `EmergencyIncident` + broadcasts `EMERGENCY_ALERTS` server-side).
   - `PATCH /api/emergency-incidents/:id/resolve` (`guard`, `secretary`, `admin`; sets `dispatchStatus = 'RESOLVED'`, `resolvedAt = now`, broadcasts `EMERGENCY_INCIDENT_RESOLVED`).
   - **Verified Gap:** Neither `ChildSafetyAlert` nor `EmergencyIncident` has a `RESPONDING` status or `assignResponder` endpoint/columns.

### 2.2 Frontend SOS Cutover Rules
1. **No False Dispatch Success:** In `ChildSafetySosModal`, `SafetyCommandHub` (`ONE_TAP_SOS` `CHILD_SAFETY`), `ChildGateScannerPage`, and `SafetyHome.tsx`, NEVER set active/success banners before the `POST` returns `201`. Show a pending spinner; if the request fails, display the exact `ApiError` and keep the alert form open for retry.
2. **No Invented `RESPONDING` Workflow for Child Safety Alerts:** Child Safety Alerts strictly render their authoritative 3-stage lifecycle: `ACTIVE` -> `ACKNOWLEDGED` (with `acknowledgedByName`, `acknowledgedAt`) -> `RESOLVED` / `FALSE_ALARM` (with `resolvedByName`, `resolutionNotes`, `resolvedAt`). Security guards/admins record any responder dispatch note inside `acknowledge` `notes` or `resolve` `resolutionNotes`.
3. **Preservation of Non-Child Emergency UI:** Non-child categories (`MEDICAL`, `FIRE`, `SECURITY`, `LIFT`, `ELECTRICAL`) in `SafetyCommandHub` and `SecurityEmergencyTerminalPage` retain their existing UI without breaking, while stripping blocked `realtimeService.publish('EMERGENCY_ALERTS')` calls (`403`) and noting full general-emergency backend parity under separate requirement **`REQ-BE-03`**.

---

## 3. Verified Child Status & Gate Re-Entry Semantics (Section 8)

Direct inspection of `server/src/childSafety/router.ts#L733-L767`, `#L1986-L2011`, and `server/prisma/schema.prisma#L85-L148` establishes the following facts:

| Question | Source-Verified Answer |
| :--- | :--- |
| Does `POST /api/children/passes/verify` support check-in / re-entry? | **NO.** It only verifies exits, transitions `SAFE -> OUT_OF_SOCIETY`, and logs `ChildExitLog` with `outcome = 'ALLOWED'`. |
| Does `ChildExitLog` support a `RE_ENTRY` event direction? | **NO.** `ChildExitOutcome` is strictly `ALLOWED \| DENIED \| MISSING_ALERT_BLOCKED \| VERIFICATION_UNAVAILABLE`; there is no `direction` (`EXIT`/`RE_ENTRY`) column. |
| Can a `guard` call `PATCH /api/children/:id` `{ status: 'SAFE' }`? | **NO.** `PROFILE_WRITE_ROLES = ['resident', 'secretary', 'admin']`; `guard` receives `403 INSUFFICIENT_PERMISSIONS`. |
| Does `PATCH /api/children/:id` `{ status: 'SAFE' }` create a gate audit log or notify guards? | **NO.** It writes **zero** `ChildExitLog` rows and emits only `CHILD_PROFILE_UPDATED` (audience: `secretary`, `committee`, `admin` + owner — NOT `guard`). |
| Does `PATCH /api/children/:id` block clearing `MISSING` while an alert is active? | **YES** (`409 ACTIVE_MISSING_ALERT_MUST_BE_RESOLVED`). |

### Mandatory B.2.3 Decision on Re-Entry
- **DO NOT simulate a gate re-entry event by calling `PATCH /api/children/:id` with `{ status: 'SAFE' }`.**
- In B.2.3, `ChildGateScannerPage` strictly performs **Gate Exit Verification** (`POST /api/children/passes/verify`).
- If an admin/resident edits a child profile via `PATCH /api/children/:id`, profile status changes (only `SAFE` <-> `OUT_OF_SOCIETY`, never clearing `MISSING` with an active alert) must be explicitly presented as an **administrative profile status field**, NEVER labeled as a "Gate Check-In" or "Gate Re-Entry" event.
- Proper guard-verified child re-entry is recorded as a **separate backend contract requirement (`REQ-BE-01`)**: dedicated `POST /api/children/:id/re-entry` endpoint (`guard`, `admin`), atomic `OUT_OF_SOCIETY -> SAFE` update under `FOR UPDATE`, immutable gate audit record with `direction: 'RE_ENTRY'`, and `CHILD_REENTRY_RECORDED` SSE broadcast to guards, admins, and owning guardian.

---

## 4. 12-Area Feature Preservation Checklist (Section 9)

| # | Existing Feature / Interface | Existing Visual & UX Elements Preserved | B.2.3 Authoritative Upgrade |
| :--- | :--- | :--- | :--- |
| 1 | **Resident Child Safety Dashboard** (`/resident/child-safety`) | Existing hero header, card layout, `SafetyCommandHub` tab bar, mobile bottom padding (`pb-24`) | Hydrated live from `GET /api/children`, `/passes`, `/exit-logs`, `/alerts` + Fetch SSE; real DOB/age & status badges (removes hardcoded `DOB 14 May 2018`). |
| 2 | **Child Profile Management** | Existing Add Child modal layout & fields | Wired to `POST /api/children`, plus Edit (`PATCH`) and Archive (`POST .../archive`) actions; zero localStorage/seed profiles. |
| 3 | **Authorized Pickup Management** | Existing escort cards & Add Pickup modal inside child section | Scoped strictly to selected `childId` (fixes `children[0]` bug); replaces raw `idProofNumber` with `idDocumentType` + optional `idDocumentLast4`; adds real Revoke (`POST .../revoke`); removes hardcoded fallback escorts (`Radha Bai`, `Santosh Yadav`). |
| 4 | **QR Pass Generation** | Existing "Generate Exit Pass" action on child card | Replaces fake no-op modal with real `POST /api/children/passes` + immediate `QRCodeSVG` (`qrcode.react`) one-time QR modal, expiry/uses display, Copy/Share/Download, and Pass Revocation list. |
| 5 | **SOS & Missing-Child Reporting** | Existing red "Missing Child Alert" modal & `ONE_TAP_SOS` `CHILD_SAFETY` tile | Replaces no-op modal with real `POST /api/children/sos` (mandatory `location` + `lastSeenDetails`), post-confirmation banner only, `409` duplicate handling, and live status tracking (`ACTIVE -> ACKNOWLEDGED -> RESOLVED`). |
| 6 | **Security Gate Scanner** (`/security/child-safety`) | Existing scanner input, Gate selector, verdict panel, Active Passes panel, Today's Logs table, Active Alert banner | Wired strictly to `POST /api/children/passes/verify` (fail-closed `503`/offline UX), read-only Active Passes reference (`GET /passes`), live Exit Logs (`GET /exit-logs`), Acknowledge + Resolve-with-notes modal, Guard SOS button, `secretary` read-only verify guard. |
| 7 | **Security Terminal** (`/security/terminal`) | Completely preserved Visitor Pass terminal (`SecurityTerminalPage.tsx`) & navigation links to `/security/child-safety` | Zero regressions; existing QuickActionSheet and SecurityLayout links continue routing directly to `/security/child-safety`. |
| 8 | **Admin Child Safety Dashboard** (`/admin/child-safety`) | Existing subheader, 4 tabs (`ALL`, `INSIDE`, `LOGS`, `ALERTS`), search input, `DataTable`, `MobileDataCard`, detail `<Modal>` | Wired to live `/api/children`, `/passes`, `/exit-logs`, `/alerts` + Fetch SSE; replaces hardcoded `"Green Valley Society"`; adds Acknowledge + Resolve-with-notes modal, optional Admin Register Child (using society `/api/residents` + `/api/flats` selector) and Pickup management. |
| 9 | **Notifications & Sound Alerts** | Existing Web Audio siren (`playEmergencySiren`), gate chime (`playGateBeep`), in-app toast banner, Capacitor push handlers | Fixed to fire over authenticated Fetch SSE for all 15 B.2.2 events, deduplicated for paired events, and routed to role-correct Child Safety paths (fixes `/resident/deliveries` misrouting). |
| 10 | **Child Activity History** | Existing gate logs table/cards on Admin & Security pages | Extended to Resident portal as well via `GET /api/children/exit-logs` showing both `ALLOWED` exits and `DENIED` / `MISSING_ALERT_BLOCKED` attempts with `denialReason`. |
| 11 | **Role-Based Navigation** | Existing routes (`/resident/child-safety`, `/resident/emergency`, `/security/child-safety`, `/security/emergency`, `/security/terminal`, `/admin/child-safety`, `/admin/safety-command`) and layout nav items | Preserved intact; UI action controls aligned strictly to backend RBAC (`secretary` read-only on gate verify, `committee` read+alert-manage only, `GATE_VERIFIER` tab hidden for non-guard/admin). |
| 12 | **Responsive Behavior** | Existing desktop `DataTable` + mobile `MobileDataCard`, responsive CSS grids, Capacitor Android layout & bottom safe-area padding | Preserved across every modified page and new modular modal; tested at mobile & desktop viewports. |

