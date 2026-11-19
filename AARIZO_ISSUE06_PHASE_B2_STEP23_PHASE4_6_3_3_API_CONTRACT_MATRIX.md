# AARIZO — ISSUE-06 / B.2.3 / PHASE 4.6.3.3
# SAFETY COMMAND HUB — API CONTRACT & WORKFLOW MATRIX

**Repository:** `D:\AAZIRA\AARIZO`  
**Phase:** Issue-06 / Phase B.2.3 — Subphase 4.6.3.3  
**Audit Mode:** STRICTLY READ-ONLY Contract Verification  
**Date:** 2026-11-19  

---

## 1. Complete Workflow & Backend Contract Matrix

| # | Workflow Name | Current Frontend Implementation in `SafetyCommandHub.tsx` | Actual Backend Endpoint & HTTP Method | Request DTO & Key Fields | Response DTO & Status | Authorized Roles | Tenant / Society Scoping | Backend Supports? | UI Fake Success? | Realtime Invalidation Event |
|:---:|:---|:---|:---|:---|:---|:---|:---|:---:|:---:|:---|
| **1** | **Staff Add Child Profile** | Calls `safetyCommandEngine.addChildProfile()`. Throws `ApiError: LEGACY_SYNC_API_DEPRECATED`. | `POST /api/children` | `CreateChildProfileRequest`:<br>• `fullName` (string)<br>• `guardianName` (string)<br>• `guardianPhone` (string)<br>• `residentId` (required for staff)<br>• `flatId` (required for staff)<br>• `dateOfBirth?` (ISO string)<br>• `gender?` (enum)<br>• `exitPermissionMode?` (enum) | `ChildProfileDto`<br>`201 Created` | `secretary`, `admin`<br>*(Guards strictly denied)* | Enforces `actor.societyId`. Resident & flat must belong to same society. | ✅ Yes | ❌ (Crashes with `ApiError`) | `CHILD_PROFILE_CREATED` |
| **2** | **Staff List Children** | Reads `safetyCommandEngine.getChildren()`, which queries memory cache of `childSafetyService`. | `GET /api/children` | `ListChildrenParams`:<br>• `includeArchived?` (boolean)<br>• `societyId?` (platform admin only) | `ChildProfileDto[]`<br>`200 OK` | `secretary`, `committee`, `admin`<br>*(Guards strictly denied)* | Filtered by `where.societyId = actor.societyId`. Residents see household only. | ✅ Yes | ⚠️ Stale in-memory cache | `CHILD_PROFILE_CREATED`,<br>`CHILD_PROFILE_UPDATED`,<br>`CHILD_PROFILE_ARCHIVED` |
| **3** | **Staff Add Authorized Pickup** | Calls `safetyCommandEngine.addAuthorizedPickup(children[0].id, pickupForm)`. Throws `ApiError`. Submits forbidden `idProofNumber`. | `POST /api/children/:childId/pickups` | `CreateAuthorizedPickupRequest`:<br>• `name` (string)<br>• `phone` (string)<br>• `relationship` (string)<br>• `idDocumentType?` (string)<br>• `idDocumentLast4?` (1–4 digits)<br>• *(Forbidden: raw `idProofNumber`)* | `AuthorizedPickupDto`<br>`201 Created` | `secretary`, `admin`<br>*(Guards strictly denied)* | Child must belong to `actor.societyId`. | ✅ Yes | ❌ (Crashes with `ApiError`) | `CHILD_PICKUP_AUTHORIZED` |
| **4** | **Staff Revoke Authorized Pickup** | Directly mutates `child.authorizedPickups = child.authorizedPickups.filter(...)` in component state. | `POST /api/children/:childId/pickups/:pickupId/revoke`<br>or `DELETE` | `RevokeAuthorizedPickupRequest`:<br>• `reason?` (string) | `AuthorizedPickupDto`<br>`200 OK` | `secretary`, `admin`<br>*(Guards strictly denied)* | Both child and pickup must belong to `actor.societyId`. | ✅ Yes | ⚠️ **YES** (Mutates local memory array with zero API call) | `CHILD_PICKUP_REVOKED` |
| **5** | **Staff Generate Gate Pass ("Confirm Pass")** | `onClick`: Sets local timeout `setAlertSuccess('Child Gate Exit Pass generated...')`. Zero API calls. | `POST /api/children/passes` | `CreateChildGatePassRequest`:<br>• `childId` (string)<br>• `pickupPersonId?` (string)<br>• `validUntil` (ISO string)<br>• `notes?` (string) | `ChildGatePassCreatedDto`<br>`201 Created`<br>*(returns one-time `bearerToken` and `qrPayload`)* | `secretary`, `admin`, `resident`<br>*(Guards strictly denied from creating)* | Child and pickup must belong to `actor.societyId`. | ✅ Yes | ⚠️ **YES** (100% fake success, no pass ever created) | `CHILD_GATE_PASS_GENERATED` |
| **6** | **Gate Pass Verification (Gate Verifier Tab)** | Calls `safetyCommandEngine.verifyChildPickupAtGate(scanChildInput, scanPickupInput)`. | `POST /api/children/passes/verify` | `VerifyChildGatePassRequest`:<br>• `qrPayload?` or `bearerToken` (required)<br>• `gateId?` (string)<br>• `notes?` (string) | `VerifyChildGatePassSuccessDto`<br>`200 OK`<br>`{ authorized: true, outcome: 'ALLOWED', pass, exitLog }` | `guard`, `admin` | Cryptographic SHA-256 constant-time token verification inside PostgreSQL tx. | ✅ Yes | ❌ (Always displays "Authorization Failed") | `CHILD_GATE_PASS_VERIFIED`,<br>`CHILD_EXIT_TRIGGERED`,<br>`CHILD_EXIT_DENIED` |
| **7** | **DISPATCH ALARM NOW (Child Safety SOS)** | If resident: opens `ResidentChildSosModal`.<br>If staff: calls `safetyCommandEngine.triggerOneTapSOS('CHILD_SAFETY')` (local mock). | `POST /api/children/sos` | `TriggerChildSosRequest`:<br>• `location` (string)<br>• `childId?` (string)<br>• `childName?` (string)<br>• `flatNumber?` (string)<br>• `alertType` (`'MISSING_CHILD'` or `'UNAUTHORIZED_EXIT_ATTEMPT'`)<br>• `severity?` (CRITICAL)<br>• `description?` (string) | `ChildSosCreatedDto`<br>`201 Created`<br>`{ alert, emergencyIncident }` | `resident`, `guard`, `secretary`, `committee`, `admin`<br>*(All 5 roles authorized)* | Strictly scoped to `actor.societyId`. Locks child profile row `FOR UPDATE`. | ✅ Yes | ⚠️ **YES for staff** (Staff SOS only creates local incident) | `CHILD_SAFETY_SOS_TRIGGERED`,<br>`EMERGENCY_INCIDENT_CREATED` |
| **8** | **Missing-Child Active Alerts List** | Reads only `safetyCommandEngine.getIncidents()` (`aarizo_emergency_incidents_v3`). Backend child alerts never fetched. | `GET /api/children/alerts` (or `/api/children/sos`) | `ListChildAlertsParams`:<br>• `status?` (`'ACTIVE'`, `'ACKNOWLEDGED'`, `'RESOLVED'`)<br>• `limit?` (number)<br>• `offset?` (number) | `ChildSafetyAlertDto[]`<br>`200 OK` | `guard`, `secretary`, `committee`, `admin`, `resident` | Scoped to `actor.societyId`. Residents scoped to own flat/children. | ✅ Yes | ⚠️ **YES** (Real backend alerts absent from UI) | `CHILD_SAFETY_SOS_TRIGGERED`,<br>`CHILD_SAFETY_ALERT_ACKNOWLEDGED`,<br>`CHILD_SAFETY_ALERT_RESOLVED` |
| **9** | **Acknowledge Child Safety Alert** | Calls `safetyCommandEngine.acknowledgeIncident(id)`. Modifies local mock array. | `POST /api/children/alerts/:id/acknowledge` | None (URL parameter `:id`) | `ChildSafetyAlertDto`<br>`200 OK`<br>`{ status: 'ACKNOWLEDGED', acknowledgedAt, acknowledgedByName }` | `guard`, `secretary`, `committee`, `admin`<br>*(Residents cannot acknowledge)* | Must belong to `actor.societyId`. Alert must be in `ACTIVE` state. | ✅ Yes | ⚠️ **YES** (Only updates local state) | `CHILD_SAFETY_ALERT_ACKNOWLEDGED` |
| **10** | **Resolve Child Safety Alert** | Calls `safetyCommandEngine.resolveIncident(id)`. Modifies local mock array. | `POST /api/children/alerts/:id/resolve` | `ResolveChildAlertRequest`:<br>• `resolutionNotes` (string, max 1000)<br>• `status?` (`'RESOLVED'` or `'FALSE_ALARM'`) | `ChildSafetyAlertDto`<br>`200 OK`<br>`{ status: 'RESOLVED', resolvedAt, resolvedByName }` | `guard`, `secretary`, `committee`, `admin`<br>*(Residents cannot resolve)* | Must belong to `actor.societyId`. Must be in `ACTIVE` or `ACKNOWLEDGED`. | ✅ Yes | ⚠️ **YES** (Only updates local state) | `CHILD_SAFETY_ALERT_RESOLVED` |
| **11** | **Assign Responder (Child Safety SOS)** | Opens `ASSIGN_RESPONDER` modal, calls `safetyCommandEngine.assignResponder()`. | ❌ **NONE** (No backend endpoint exists for Child Safety responder assignment) | N/A | N/A | N/A | N/A | ❌ **NO** (Backend `ChildSafetyAlert` schema does not store responders) | ⚠️ **YES** (Local UI state only; no DB persistence) | N/A |
| **12** | **General Emergency SOS (`MEDICAL`, `FIRE`, `SECURITY`, `LIFT`, `ELECTRICAL`)** | Calls `safetyCommandEngine.triggerOneTapSOS()`. Writes to `aarizo_emergency_incidents_v3`. | `POST /api/emergency-incidents` | `EmergencyIncidentCreateInput`:<br>• `incidentType` (string)<br>• `location` (string)<br>• `description?` (string)<br>• `severity` (enum) | `EmergencyIncident`<br>`201 Created` | `resident`, `guard`, `secretary`, `admin` | Scoped to `tenant.societyId`. | ✅ Yes (on general emergency API) | ⚠️ Mixed (Works locally, backed by `/api/emergency-incidents`) | `EMERGENCY_ALERTS` |
| **13** | **General Emergency Acknowledge / Resolve** | Handled by `safetyCommandEngine.acknowledgeIncident()` / `resolveIncident()`. | `PATCH /api/emergency-incidents/:id/resolve` | `{ resolutionNotes?: string }` | `EmergencyIncident`<br>`200 OK` | `guard`, `secretary`, `admin` | Scoped to `tenant.societyId`. | ✅ Yes (on general emergency API) | ⚠️ Mixed (Works via `safetyCommandEngine`) | `EMERGENCY_INCIDENT_RESOLVED` |

---

## 2. Key Architectural Discrepancies & Resolutions

### 2.1 Responder Assignment Scoping
- **Finding:** In `SafetyCommandHub.tsx`, the "Assign Responder" action is presented generically across all incident categories.
- **Backend Reality:**
  - Table `child_safety_alerts` has **no** responder columns (`responderName`, `responderRole`). It tracks only `acknowledgedBy` and `resolvedBy`.
  - Table `emergency_incidents` (general emergencies) has `assignedResponderId` and `assignedResponderName`.
- **Resolution for Implementation:** For Child Safety alerts, disable or remove the "Assign Responder" button (or mark it as "Dispatch Security Patrol" affecting the general incident record if linked via `emergencyIncidentId`). The canonical Child Safety alert actions are **Acknowledge Alert** and **Mark Resolved**.

### 2.2 Gate Verifier Tab Redundancy
- **Finding:** The `GATE_VERIFIER` tab in `SafetyCommandHub.tsx` accepts only plaintext child name and caretaker name, executing a deprecated client-side function that always fails.
- **Backend Reality:** Gate exit verification requires a cryptographic QR bearer token (`AARIZO_CHILD_PASS:<token>`) and is already fully implemented and verified in `ChildGateScannerPage.tsx` (`/security/scanner`).
- **Resolution for Implementation:** In `SafetyCommandHub.tsx`, the `GATE_VERIFIER` tab should either:
  1. Provide a direct navigation shortcut (`<Link to="/security/scanner">`) for guards and security personnel.
  2. Or embed the canonical `childSafetyService.verifyGatePass()` controller with bearer token input.

### 2.3 Staff Child Creation Permissions
- **Finding:** `SafetyCommandHub.tsx` presents an "Add Child Profile" form to all staff roles.
- **Backend Reality:**
  - `guard`: **Forbidden** from `POST /api/children` (`PROFILE_WRITE_ROLES = ['resident', 'secretary', 'admin']`).
  - `secretary` / `admin`: Must supply valid `residentId` and `flatId` belonging to the active society.
- **Resolution for Implementation:**
  - Guard role must not see or be able to submit "Add Child Profile".
  - For `secretary` and `admin`, the form must select or supply valid `residentId` and `flatId` from society rosters.

