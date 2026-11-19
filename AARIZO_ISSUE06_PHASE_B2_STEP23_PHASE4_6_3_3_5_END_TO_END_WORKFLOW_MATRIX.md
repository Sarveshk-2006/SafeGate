# AARIZO — ISSUE-06 — PHASE B.2 — STEP 2.3 — PHASE 4.6.3.3.5
# END-TO-END WORKFLOW MATRIX

**Repository:** `D:\AAZIRA\AARIZO`  
**Phase:** Phase B.2 / Step 2.3 / Subphase 4.6.3.3.5  
**Date:** November 19, 2026  
**Status:** COMPLETE END-TO-END SPECIFICATION  

---

## 1. Overview

This matrix traces every Child Safety and Emergency workflow through its complete end-to-end lifecycle:
`User Action in UI -> Client Request -> Backend Authorization & Validation -> PostgreSQL Transaction -> Outbox / Realtime Emission -> Client Invalidation & UI Update`.

---

## 2. End-to-End Workflow Specifications

### Workflow A: Resident Registers, Edits, and Archives a Child
- **Actor & Role:** `resident` (verified resident of the flat).
- **UI Component:** `ResidentChildSafetyPanel.tsx` -> `ChildProfilesSection.tsx`.
- **API Endpoints:**
  - Create: `POST /api/children`
  - Update: `PATCH /api/children/:id`
  - Archive: `DELETE /api/children/:id`
- **Backend Authorization:** `PROFILE_WRITE_ROLES = ['resident', 'secretary', 'admin']`. If resident, resolves resident ownership via `resolveResidentOwnership(actor)` and enforces `targetChild.residentId === actor.residentId`.
- **Tenant / Society Isolation:** `societyId` extracted from JWT session; composite unique constraint `@@unique([societyId, id])`.
- **Database Transaction:**
  - Create: `prisma.childProfile.create({ data: { societyId, residentId, flatId, fullName, reportedAge, gender, status: 'SAFE' } })`.
  - Update: `prisma.childProfile.update({ where: { societyId_id }, data: ... })`.
  - Archive: `prisma.childProfile.update({ where: { societyId_id }, data: { status: 'ARCHIVED', archivedAt: NOW() } })`.
- **Realtime Event:** `CHILD_PROFILE_CREATED`, `CHILD_PROFILE_UPDATED`, `CHILD_PROFILE_ARCHIVED` emitted post-commit to `PROFILE_EVENT_ROLES` and guardian.
- **Resulting UI Update:** Emits invalidation on `childSafetyService`, causing resident profile list to re-fetch and render updated status.
- **Negative & Failure Cases:**
  - Resident attempting to register child for another flat: 403 Forbidden.
  - Missing name or guardian phone: 400 Validation Error.
  - Raw government ID in payload: 400 rejection (`assertNoForbiddenRawIdFields`).

---

### Workflow B: Resident Adds, Edits, and Revokes an Authorized Pickup Person
- **Actor & Role:** `resident`.
- **UI Component:** `ResidentAuthorizedPickupsSection.tsx`.
- **API Endpoints:**
  - Add: `POST /api/children/:id/pickups`
  - Update: `PATCH /api/children/:id/pickups/:pickupId`
  - Revoke: `DELETE /api/children/:id/pickups/:pickupId`
- **Backend Authorization:** Verifies child ownership.
- **Tenant / Society Isolation:** Composite unique key `@@unique([societyId, childId, id])`.
- **Database Transaction:**
  - Add: Inserts `ChildAuthorizedPickup` with sanitized last 4 digits of ID (`idDocumentLast4`).
  - Revoke: Soft-deletes row: `status = 'REVOKED', revokedAt = NOW()`.
- **Realtime Event:** `CHILD_PICKUP_AUTHORIZED`, `CHILD_PICKUP_UPDATED`, `CHILD_PICKUP_REVOKED` emitted post-commit.
- **Resulting UI Update:** Re-fetches pickups list. Any active gate passes tied to this revoked escort are cascade-invalidated.
- **Negative & Failure Cases:**
  - Plaintext ID numbers (e.g. 12-digit Aadhaar): blocked client-side and server-side.
  - Non-owner attempting to modify escort: 403 Forbidden.

---

### Workflow C: Resident Generates, Views, and Revokes a Gate Pass
- **Actor & Role:** `resident`.
- **UI Component:** `ResidentGatePassesSection.tsx`.
- **API Endpoints:**
  - Generate: `POST /api/children/passes`
  - List: `GET /api/children/passes`
  - Revoke: `POST /api/children/passes/:id/revoke`
- **Backend Authorization:** `PASS_WRITE_ROLES = ['resident', 'secretary', 'admin']`. Verifies child ownership and authorized pickup status.
- **Tenant / Society Isolation:** Scoped to `societyId`.
- **Database Transaction:** Generates 256-bit CSPRNG bearer token (`crypto.randomBytes(32)`), computes SHA-256 hash (`tokenHash`), inserts `ChildGatePass` with `maxUses: 1, currentUses: 0, status: 'ACTIVE'`.
- **Realtime Event:** `CHILD_GATE_PASS_GENERATED`, `CHILD_GATE_PASS_REVOKED` emitted to `GATE_AND_SOS_EVENT_ROLES`.
- **Resulting UI Update:** Modal displays QR code and pass summary. `bearerToken` is held in memory and never written to `localStorage`.
- **Negative & Failure Cases:**
  - Child currently marked `MISSING`: pass creation blocked (409 Conflict).
  - Escort status is `REVOKED`: pass creation rejected (400 Invalid Escort).

---

### Workflow D: Guard Verifies a Valid Gate-Pass Bearer Token
- **Actor & Role:** `guard` (or `admin`).
- **UI Component:** `ChildGateScannerPage.tsx` (`/security/child-safety`).
- **API Endpoint:** `POST /api/children/passes/verify`
- **Backend Authorization:** `GATE_VERIFY_ROLES = ['guard', 'admin']`.
- **Tenant / Society Isolation:** Guard token defines `societyId`. Cross-society passes are rejected.
- **Database Transaction:**
  - Computes SHA-256 hash of scanned token.
  - Locks child row via `lockChildProfileRow(tx, childId, societyId)` (`FOR UPDATE`).
  - Checks child is not `MISSING` and has no active `MISSING_CHILD` alert.
  - Atomically updates pass: `currentUses = currentUses + 1, status = 'USED', lastUsedAt = NOW()`.
  - Inserts `ChildExitLog` with `outcome: 'ALLOWED', channel: 'ONLINE_QR_TOKEN'`.
- **Realtime Event:** `CHILD_GATE_PASS_VERIFIED` and `CHILD_EXIT_TRIGGERED` emitted to `GATE_AND_SOS_EVENT_ROLES`.
- **Resulting UI Update:** Scanner displays verified green card with child photo, flat code, guardian name, escort name, and timestamp.
- **Negative & Failure Cases:**
  - Token expired or already used: 409 Conflict / 422 Rejection.

---

### Workflow E: Guard Attempts Invalid, Expired, Revoked, Reused, or Display-Only Pass Codes
- **Actor & Role:** `guard`.
- **UI Component:** `ChildGateScannerPage.tsx`.
- **API Endpoint:** `POST /api/children/passes/verify`
- **Backend Authorization:** Verified security guard session.
- **Database Transaction:** Hash lookup fails or pass conditions fail (`status !== 'ACTIVE'` or `validUntil < NOW()`). Inserts `ChildExitLog` with `outcome: 'DENIED'` and exact denial reason.
- **Realtime Event:** `CHILD_EXIT_DENIED` emitted to `GATE_AND_SOS_EVENT_ROLES`.
- **Resulting UI Update:** Scanner shows high-visibility red denial banner with specific reason ("Pass already used", "Pass expired", "Child reported missing").
- **Negative & Failure Cases:**
  - 6-digit alphanumeric pass code entered as QR payload: rejected (does not match 64-char hex token hash).

---

### Workflow F: Guard Records Child Exit and Re-Entry
- **Actor & Role:** `guard`.
- **UI Component:** `ChildGateScannerPage.tsx`.
- **API Endpoint:** `POST /api/children/passes/verify`
- **Backend Contract:** Pass enforces single-use exit semantics (`maxUses: 1`). Re-entry is logged or verified via return escort authorization.
- **Database Transaction:** Audit record created in `child_exit_logs`.
- **Realtime Event:** `CHILD_EXIT_TRIGGERED` emitted to security terminals and guardians.
- **Resulting UI Update:** Exit history table updates in real time on both guard scanner and resident portal.

---

### Workflow G: Resident Reports a Missing Child Through Child SOS
- **Actor & Role:** `resident`.
- **UI Component:** `ResidentChildSosModal.tsx`.
- **API Endpoint:** `POST /api/children/sos`
- **Backend Authorization:** Enforces resident ownership (`targetChild.residentId === actor.residentId`).
- **Database Transaction:**
  - Locks child profile row (`FOR UPDATE`).
  - Verifies no active `MISSING_CHILD` alert exists.
  - Creates `EmergencyIncident` (`incidentType: 'CHILD_SAFETY', dispatchStatus: 'DISPATCHED'`).
  - Creates `ChildSafetyAlert` (`status: 'ACTIVE'`).
  - Updates `ChildProfile.status = 'MISSING'`.
- **Realtime Event:** `CHILD_SAFETY_SOS_TRIGGERED` and `EMERGENCY_INCIDENT_CREATED` emitted post-commit.
- **Resulting UI Update:** Broadcasts alarm to all perimeter guard stations and security consoles. Gate barrier freeze activated.
- **Negative & Failure Cases:**
  - Duplicate SOS: 409 Conflict (`DUPLICATE_ACTIVE_SOS_ALERT`).
  - Resident reporting another resident's child: 403 Forbidden.

---

### Workflow H: Authorized Staff View, Acknowledge, and Resolve Child Safety Alerts
- **Actor & Role:** `guard`, `secretary`, `committee`, `admin`.
- **UI Component:** `SafetyCommandHub.tsx` (`COMMAND_CONSOLE` tab).
- **API Endpoints:**
  - List: `GET /api/children/alerts`
  - Acknowledge: `POST /api/children/alerts/:id/acknowledge`
  - Resolve: `POST /api/children/alerts/:id/resolve`
- **Backend Authorization:** `SOS_MANAGE_ROLES = ['guard', 'secretary', 'committee', 'admin']`.
- **Database Transaction:**
  - Acknowledge: Atomic update `status = 'ACKNOWLEDGED', acknowledgedAt = NOW(), acknowledgedById = actor.id`.
  - Resolve: Checks mandatory resolution notes; in transaction updates alert to `RESOLVED` or `FALSE_ALARM`, resolves linked emergency incident, and restores child status from `MISSING` -> `SAFE` if no other active alerts remain.
- **Realtime Event:** `CHILD_SAFETY_ALERT_ACKNOWLEDGED`, `CHILD_SAFETY_ALERT_RESOLVED` emitted post-commit.
- **Resulting UI Update:** Alert card badge transitions to ACKNOWLEDGED (amber) or RESOLVED (green). Incident counter decreases.
- **Negative & Failure Cases:**
  - Empty resolution notes: 400 Validation Error.
  - Resident attempting staff resolution: 403 Forbidden.
  - Acknowledging non-active alert: 422 Invalid Transition.

---

### Workflow I: Staff Creates Child and Pickup Records Under Permitted Roles
- **Actor & Role:** `secretary`, `admin`. (`committee` and `guard` are forbidden).
- **UI Component:** `SafetyCommandHub.tsx` (`CHILD_SAFETY` tab).
- **API Endpoints:** `POST /api/children`, `POST /api/children/:id/pickups`.
- **Backend Authorization:** `PROFILE_WRITE_ROLES = ['resident', 'secretary', 'admin']`.
- **Database Transaction:** Standard normalized relational insert with tenant validation.
- **Realtime Event:** `CHILD_PROFILE_CREATED`, `CHILD_PICKUP_AUTHORIZED` emitted to `PROFILE_EVENT_ROLES`.
- **Resulting UI Update:** Roster list refreshes across all staff consoles.
- **Negative & Failure Cases:**
  - Guard or Committee trying to create: 403 Forbidden.
  - Missing Flat ID or Resident ID: 400 validation error.

---

### Workflow J: Staff Generates Gate Passes Under Permitted Roles
- **Actor & Role:** `secretary`, `admin`. (`committee` and `guard` are forbidden).
- **UI Component:** `SafetyCommandHub.tsx` (`Exit Pass` / `Pass` buttons).
- **API Endpoint:** `POST /api/children/passes`.
- **Backend Authorization:** `PASS_WRITE_ROLES = ['resident', 'secretary', 'admin']`.
- **Database Transaction:** Single-use gate pass created with hash-only persistence.
- **Realtime Event:** `CHILD_GATE_PASS_GENERATED` emitted to `GATE_AND_SOS_EVENT_ROLES`.
- **Resulting UI Update:** Pass dialog displays QR code for printing or physical gate pass issuance.
- **Negative & Failure Cases:**
  - Guard attempting pass generation: 403 Forbidden.
  - Child in MISSING state: 409 Conflict.

---

### Workflow K: General Emergency Workflows (MEDICAL, FIRE, SECURITY, LIFT, ELECTRICAL)
- **Actor & Role:** `guard`, `secretary`, `admin`, `committee`, `resident`.
- **UI Component:** `SafetyCommandHub.tsx` (`ONE_TAP_SOS`, `COMMAND_CONSOLE`).
- **API Endpoints:**
  - List: `GET /api/emergency-incidents`
  - Create: `POST /api/emergency-incidents`
  - Resolve: `PATCH /api/emergency-incidents/:id/resolve` (strict `requireRole(['guard', 'secretary', 'admin'])`).
- **Backend Authorization:** Creation allowed for resident/staff; resolution restricted to `guard`, `secretary`, `admin` (`server/src/index.ts:2332`).
- **Database Transaction:** `prisma.emergencyIncident` insert and update.
- **Realtime Event:** `EMERGENCY_ALERTS`, `EMERGENCY_INCIDENT_RESOLVED`.
- **Resulting UI Update:** Incident feed updates reactively. Responder assignment supported for general incidents.
- **Negative & Failure Cases:**
  - Committee role attempting general emergency resolution: 403 Forbidden.
  - Resident accessing Child Safety records via general emergency feed: filtered out on backend.

---

### Workflow L: Authorized Realtime Events Refresh the Correct Resources
- **Actor & Role:** All authorized staff and residents.
- **Mechanism:** `useSecurityChildSafetyRealtime` and `useChildSafetyRealtime` over the single `AuthContext` SSE stream.
- **Behavior:** Incoming SSE frames trigger debounced, coalesced calls to authoritative fetchers without polling.
- **Resulting UI Update:** Terminals across security posts and management offices stay in sync within 50ms of database commit.

