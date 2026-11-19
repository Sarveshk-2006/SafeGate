# AARIZO — ISSUE-06 / B.2.3 / PHASE 4.6.3
# SECURITY REALTIME EVENT CONTRACT MATRIX

**Repository:** `D:\AAZIRA\AARIZO`  
**Phase:** Issue-06 / Phase B.2.3 — Subphase 4.6.3 (Security Command Hub Realtime Integration)  
**Document:** Authoritative Backend-to-Security Event Mapping & Permission Matrix  
**Date:** 2026-11-19  

---

## 1. CANONICAL TOPIC AUDIENCE & ROLE PERMISSION MAPPING

In `server/src/childSafety/router.ts`, events are authorized strictly by the server before SSE broadcast. Guards belong to `GATE_AND_SOS_EVENT_ROLES`, while full roster events belong to `PROFILE_EVENT_ROLES`.

| Canonical Backend Topic | Guard Role Permitted? | Backend Emission Trigger | Server Audience Policy | Security UI Action & Invalidation |
| :--- | :---: | :--- | :--- | :--- |
| `CHILD_GATE_PASS_GENERATED` | **YES** | `POST /api/children/passes` | `GATE_AND_SOS_EVENT_ROLES` + Parent Owners | Invalidate active society pass cache; ready for scanning |
| `CHILD_GATE_PASS_VERIFIED` | **YES** | `POST /api/children/passes/verify` | `GATE_AND_SOS_EVENT_ROLES` + Parent Owners | Update gate scanner pass status to `USED`; append gate log |
| `CHILD_GATE_PASS_REVOKED` | **YES** | `POST /api/children/passes/:id/revoke` | `GATE_AND_SOS_EVENT_ROLES` + Parent Owners | Remove from active passes list immediately; mark invalid |
| `CHILD_EXIT_TRIGGERED` | **YES** | Gate exit allowed in `handleGatePassVerification` | `GATE_AND_SOS_EVENT_ROLES` + Parent Owners | Append to Security Recent Exit Logs feed; update audit stats |
| `CHILD_EXIT_DENIED` | **YES** | Gate exit denied in `handleGatePassVerification` | `GATE_AND_SOS_EVENT_ROLES` + Parent Owners | Display security denial banner; log security attempt |
| `CHILD_SAFETY_SOS_TRIGGERED` | **YES** | `POST /api/children/sos` | `GATE_AND_SOS_EVENT_ROLES` + Parent Owners | **CRITICAL LOCKDOWN:** Sound alarm, display emergency banner |
| `CHILD_SAFETY_ALERT_ACKNOWLEDGED` | **YES** | `POST /api/children/alerts/:id/acknowledge` | `GATE_AND_SOS_EVENT_ROLES` + Parent Owners | Update alert state to `ACKNOWLEDGED` with responder name |
| `CHILD_SAFETY_ALERT_RESOLVED` | **YES** | `POST /api/children/alerts/:id/resolve` | `GATE_AND_SOS_EVENT_ROLES` + Parent Owners | Remove active lockdown banner; mark alert `RESOLVED` |
| `CHILD_PROFILE_CREATED` | **NO** | `POST /api/children` | `PROFILE_EVENT_ROLES` + Parent Owners | *Dropped server-side for Guards* (Guards do not manage rosters) |
| `CHILD_PROFILE_UPDATED` | **NO** | `PATCH /api/children/:id` | `PROFILE_EVENT_ROLES` + Parent Owners | *Dropped server-side for Guards* |
| `CHILD_PROFILE_ARCHIVED` | **NO** | `DELETE /api/children/:id` | `PROFILE_EVENT_ROLES` + Parent Owners | *Dropped server-side for Guards* |
| `CHILD_PICKUP_AUTHORIZED` | **NO** | `POST /api/children/:id/pickups` | `PROFILE_EVENT_ROLES` + Parent Owners | *Dropped server-side for Guards* (Household privacy) |
| `CHILD_PICKUP_UPDATED` | **NO** | `PATCH /api/children/:id/pickups/:id` | `PROFILE_EVENT_ROLES` + Parent Owners | *Dropped server-side for Guards* |
| `CHILD_PICKUP_REVOKED` | **NO** | `POST /api/children/:id/pickups/:id/revoke`| `PROFILE_EVENT_ROLES` + Parent Owners | *Dropped server-side for Guards* |

---

## 2. EVENT PAYLOAD DEFINITIONS & SECURITY PROJECTIONS

### 2.1 `CHILD_GATE_PASS_GENERATED`
- **Backend Payload:**
  ```json
  {
    "passId": "pass-c1-9999",
    "childId": "chd-1",
    "passCode": "CGP-8841",
    "validFrom": "2026-11-19T03:00:00.000Z",
    "validUntil": "2026-11-19T05:00:00.000Z",
    "pickupPersonName": "Ramesh Kumar"
  }
  ```
  *(Note: `tokenHash` and raw `bearerToken` are NEVER broadcast over SSE).*
- **Security Action:** Invalidate active passes cache in `ChildGateScannerPage` so scanning the physical QR or token resolves cleanly.

### 2.2 `CHILD_GATE_PASS_VERIFIED`
- **Backend Payload:**
  ```json
  {
    "passId": "pass-c1-9999",
    "childId": "chd-1",
    "status": "USED",
    "currentUses": 1,
    "maxUses": 1
  }
  ```
- **Security Action:** Instantly mark pass as consumed across all active guard terminals. If Guard B attempts to scan the same pass 1 second later, Guard B's UI immediately rejects with `PASS_ALREADY_CONSUMED`.

### 2.3 `CHILD_GATE_PASS_REVOKED`
- **Backend Payload:**
  ```json
  {
    "passId": "pass-c1-9999",
    "childId": "chd-1",
    "revocationReason": "Caretaker pickup cancelled by parent",
    "revokedAt": "2026-11-19T03:15:00.000Z"
  }
  ```
- **Security Action:** Remove pass from available active passes. Reject any presented physical QR code with `PASS_REVOKED`.

### 2.4 `CHILD_EXIT_TRIGGERED`
- **Backend Payload:**
  ```json
  {
    "exitLogId": "log-exit-101",
    "passId": "pass-c1-9999",
    "childId": "chd-1",
    "passCode": "CGP-8841",
    "gateId": "MAIN_GATE_1",
    "outcome": "ALLOWED"
  }
  ```
- **Security Action:** Prepend new entry to `Recent Gate Verification Logs` in `ChildGateScannerPage`. Increment daily gate throughput metric.

### 2.5 `CHILD_EXIT_DENIED`
- **Backend Payload:**
  ```json
  {
    "exitLogId": "log-exit-102",
    "childId": "chd-1",
    "gateId": "MAIN_GATE_1",
    "outcome": "DENIED",
    "reasonCode": "PASS_EXPIRED"
  }
  ```
- **Security Action:** Display red warning banner on guard terminal. Prepend denial record to audit trail.

### 2.6 `CHILD_SAFETY_SOS_TRIGGERED`
- **Backend Payload:**
  ```json
  {
    "alertId": "alt-sos-501",
    "childId": "chd-1",
    "childName": "Aarav Sharma",
    "flatNumber": "A-402",
    "alertType": "MISSING_CHILD",
    "severity": "CRITICAL",
    "location": "Podium Garden / Gate 2",
    "description": "Child missing from play area",
    "createdAt": "2026-11-19T03:20:00.000Z"
  }
  ```
- **Security Action:**
  - **EMERGENCY LOCKDOWN ACTIVATED:** Flashing critical alert banner at the top of `ChildGateScannerPage`, `SecurityTerminalPage`, and `SafetyCommandHub`.
  - Auditory alert chime (single polite audio chime, zero repeating loop).
  - Automatically block any child gate clearance until alert is resolved.

### 2.7 `CHILD_SAFETY_ALERT_ACKNOWLEDGED`
- **Backend Payload:**
  ```json
  {
    "alertId": "alt-sos-501",
    "acknowledgedByName": "Guard Officer Ramesh",
    "acknowledgedAt": "2026-11-19T03:22:00.000Z"
  }
  ```
- **Security Action:** Change lockdown banner status from `ACTIVE (Unacknowledged)` to `RESPONDING (Officer Ramesh on site)`.

### 2.8 `CHILD_SAFETY_ALERT_RESOLVED`
- **Backend Payload:**
  ```json
  {
    "alertId": "alt-sos-501",
    "childId": "chd-1",
    "resolvedByName": "Secretary / Parent",
    "resolutionNotes": "Child found safe in Tower B clubhouse",
    "resolvedAt": "2026-11-19T03:30:00.000Z"
  }
  ```
- **Security Action:** Dismiss critical emergency banner. Restore regular gate pass verification flow.

---

## 3. NON-CHILD EMERGENCY INCIDENT EVENT ISOLATION

General non-child emergencies (`MEDICAL`, `FIRE`, `SECURITY`, `LIFT`, `ELECTRICAL`) operate on the separate topic `EMERGENCY_ALERTS`:
- Handled by `safetyCommandEngine` and `safetyCommandService`.
- Strictly isolated from Child Safety database models and event handlers.
- Guards continue to receive and acknowledge general incidents via `SafetyCommandHub` (Console tab) without polluting Child Safety audit streams.

