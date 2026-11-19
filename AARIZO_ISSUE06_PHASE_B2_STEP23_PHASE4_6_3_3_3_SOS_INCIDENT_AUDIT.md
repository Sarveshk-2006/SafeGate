# AARIZO — ISSUE-06 — PHASE B.2 — STEP 2.3 — SUBPHASE 4.6.3.3.3
# Canonical Child SOS & Unified Incident Console Deep Audit Report

**Repository:** `D:\AAZIRA\AARIZO`  
**Phase:** Issue-06 / Phase B.2 / Step 2.3 / Subphase 4.6.3.3.3  
**Audit Scope:** Child Safety SOS & Staff Incident Command Console Modernization  
**Audit Mode:** STRICTLY READ-ONLY Source-Level Audit  
**Date:** 2026-11-19  

---

## 1. Executive Summary

Subphase 4.6.3.3.3 addresses the final staff-facing workflows within `SafetyCommandHub.tsx`: Child Safety emergency SOS alerting, staff alert monitoring, acknowledgment, resolution, and the live incident command console.

Currently, `SafetyCommandHub.tsx` relies heavily on the legacy, client-side simulated `safetyCommandEngine.ts`, which persists mock emergency incidents to `localStorage` key `'aarizo_emergency_incidents_v3'`, fabricates responder assignments, and publishes client-side synthetic realtime events via `realtimeService.publish(...)`. Meanwhile, a fully functional, production-grade, PostgreSQL-backed Child Safety alert system exists on the backend (`POST /api/children/sos`, `GET /api/children/alerts`, `POST /api/children/alerts/:id/acknowledge`, `POST /api/children/alerts/:id/resolve`) and is already integrated into the resident portal (`ResidentChildSosModal.tsx`, `ResidentChildAlertsSection.tsx`) and security realtime hook (`useSecurityChildSafetyRealtime.ts`).

This audit inspects every current source of Child SOS, missing child reports, incident tracking, alert actions, responder workflows, and general emergencies, establishing the exact technical gap between current simulated behavior and canonical backend contracts.

---

## 2. Frontend Source Audit: Current Implementations

### 2.1 Child Safety SOS & One-Tap SOS Triggers
- **Location:** `src/domains/safety/components/SafetyCommandHub.tsx` (lines 372–389, 750–820, 1179)
- **Current Behavior:**
  ```typescript
  const handleTriggerSOS = (category: EmergencyCategory) => {
    if (category === 'CHILD_SAFETY' && isResidentRole) {
      setIsResidentSosModalOpen(true);
      return;
    }

    safetyCommandEngine.triggerOneTapSOS(
      category,
      currentUser?.id || 'res-1',
      currentUser?.name || 'Siddharth Malhotra',
      flatNumber,
      currentUser?.phone || '+91 98765 00000',
      `Tower B, Flat ${flatNumber}`
    );
    loadData();
    setAlertSuccess(`ONE-TAP ${category} SOS DISPATCHED! Security Command Console & Guard Terminal notified.`);
    setTimeout(() => setAlertSuccess(null), 5000);
  };
  ```
- **Audit Findings:**
  1. If `isResidentRole` is true and `category === 'CHILD_SAFETY'`, it delegates to `<ResidentChildSosModal />`. This path is canonical.
  2. However, for all staff roles (`guard`, `secretary`, `committee`, `admin`), triggering `CHILD_SAFETY` SOS (either from the One-Tap SOS button grid or from Section A child cards at line 1179) invokes `safetyCommandEngine.triggerOneTapSOS`.
  3. `safetyCommandEngine.triggerOneTapSOS` saves a synthetic item directly to browser `localStorage` (`aarizo_emergency_incidents_v3`) with a client-generated ID (`inc-${Date.now()}`).
  4. It calls `realtimeService.publish('EMERGENCY_ALERTS', newIncident, ...)`, forging a client-side broadcast that bypasses backend SSE authorization.
  5. It displays a fake success banner (`ONE-TAP CHILD_SAFETY SOS DISPATCHED!`) without contacting the backend server.
  6. **Zero records are written to PostgreSQL table `child_safety_alerts` or `emergency_incidents`.**

### 2.2 Live Incident Feed & Counts
- **Location:** `SafetyCommandHub.tsx` (lines 255, 362–370, 550, 620, 1370–1502)
- **Current Behavior:**
  - Initial state: `const [incidents, setIncidents] = useState<EmergencyIncidentItem[]>(() => safetyCommandEngine.getIncidents());`
  - Tab button displays count: `Console ({activeIncidents.length})`, where `activeIncidents = incidents.filter(i => i.status !== 'RESOLVED' && i.status !== 'CLOSED')`.
  - Feed rendering: Maps over `incidents` read from `safetyCommandEngine.getIncidents()`.
- **Audit Findings:**
  1. The incident feed in `SafetyCommandHub.tsx` displays **only local mock incidents** seeded in `safetyCommandEngine.ts` (e.g. `inc-101` Medical Emergency for Siddharth Malhotra) and locally triggered mock items.
  2. Real backend Child Safety alerts created by residents via `POST /api/children/sos` (such as active `MISSING_CHILD` alerts) **never appear in this feed**.
  3. Real general emergencies stored in PostgreSQL table `emergency_incidents` **never appear in this feed**.
  4. Security guards, secretaries, and admins monitoring this console are completely blind to actual tenant emergencies occurring in the database.

### 2.3 Alert Acknowledgment Workflow
- **Location:** `SafetyCommandHub.tsx` (lines 391–394, 1440–1456)
- **Current Behavior:**
  ```typescript
  const handleAcknowledge = (id: string) => {
    safetyCommandEngine.acknowledgeIncident(id, currentUser?.name || 'Security Post');
    loadData();
  };
  ```
- **Audit Findings:**
  1. Invokes `safetyCommandEngine.acknowledgeIncident`, which updates the item's status to `'ACKNOWLEDGED'` in `localStorage`.
  2. Synthesizes a client-side broadcast: `realtimeService.publish('EMERGENCY_ALERTS', { type: 'INCIDENT_ACKNOWLEDGED', ... })`.
  3. Never invokes canonical `childSafetyService.acknowledgeAlert(alertId)` (`POST /api/children/alerts/:id/acknowledge`).
  4. Never records server-side audit timestamps (`acknowledgedAt`, `acknowledgedById`, `acknowledgedByName`) in the database.

### 2.4 Responder Assignment Workflow
- **Location:** `SafetyCommandHub.tsx` (lines 396–409, 1458–1477, 1610–1660)
- **Current Behavior:**
  - Button "Assign Responder" opens modal `ASSIGN_RESPONDER`.
  - Submitting the form calls `safetyCommandEngine.assignResponder(id, responderName, responderRole, performedBy)`.
  - Sets `status = 'RESPONDING'` in `localStorage` and publishes a client-side realtime event.
- **Audit Findings:**
  1. **The backend `ChildSafetyAlert` model has no responder assignment endpoint or database columns.** The authoritative lifecycle for Child Safety alerts is strictly `ACTIVE -> ACKNOWLEDGED -> RESOLVED / FALSE_ALARM`.
  2. The backend `EmergencyIncident` model in PostgreSQL (`emergency_incidents`) has no responder columns (`id, society_id, incident_type, severity, location, description, dispatch_status, resolved_at, created_at, updated_at`).
  3. Responder assignment in the current hub is a 100% UI simulation disconnected from the database schema.

### 2.5 Incident Resolution Workflow
- **Location:** `SafetyCommandHub.tsx` (lines 411–414, 1479–1496)
- **Current Behavior:**
  ```typescript
  const handleResolve = (id: string) => {
    safetyCommandEngine.resolveIncident(id, 'RESOLVED', 'Incident resolved cleanly on site.', currentUser?.name || 'Security Post');
    loadData();
  };
  ```
- **Audit Findings:**
  1. Invokes `safetyCommandEngine.resolveIncident`, updating `status = 'RESOLVED'` in `localStorage` and publishing client-side events.
  2. Does not prompt for resolution notes (`resolutionNotes` is required by backend Child Safety resolution API).
  3. Never calls `childSafetyService.resolveAlert(id, { status, resolutionNotes })` (`POST /api/children/alerts/:id/resolve`).
  4. Never updates the child's profile status in the database (e.g. restoring `MISSING` -> `SAFE`).
  5. Never calls backend `PATCH /api/emergency-incidents/:id/resolve` for general emergencies.

### 2.6 Realtime Synchronization Deficiencies
- **Location:** `SafetyCommandHub.tsx` (lines 362–370)
- **Current Behavior:**
  ```typescript
  useEffect(() => {
    loadData();
    const unsubscribeEmergency = realTimeSync.subscribe('EMERGENCY_ALERTS', () => loadData());
    const unsubscribeChild = realTimeSync.subscribe('CHILD_SAFETY_UPDATED', () => loadData());
    return () => {
      unsubscribeEmergency();
      unsubscribeChild();
    };
  }, [loadData]);
  ```
- **Audit Findings:**
  1. Listens to `realTimeSync`, an in-memory event emitter driven by client-side `realtimeService.publish` calls.
  2. Does NOT connect to the authenticated server SSE feed via `useSecurityChildSafetyRealtime` (created in Phase 4.6.3.1).
  3. Consequently, when a resident triggers an SOS via `POST /api/children/sos`, or another guard verifies a gate exit, the backend emits server SSE events (`CHILD_SAFETY_SOS_TRIGGERED`, `CHILD_SAFETY_ALERT_ACKNOWLEDGED`, `CHILD_SAFETY_ALERT_RESOLVED`), but `SafetyCommandHub` never receives them.

---

## 3. Backend Contracts & Infrastructure Review

### 3.1 Child Safety Backend Alert Architecture
The backend router [`server/src/childSafety/router.ts`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts) provides four hardened endpoints:

1. **`POST /api/children/sos`** (lines 1097–1342):
   - Protected by `childSosRateLimiter()` and `enforceAllowedRoles(actor, SOS_TRIGGER_ROLES)`.
   - Concurrency & serialization: Locks the child profile row via `lockChildProfileRow(tx, childId, societyId)` (`SELECT ... FOR UPDATE`).
   - Anti-replay / duplicate protection: Rejects duplicate active alerts for the same child with HTTP 409 `DUPLICATE_ACTIVE_SOS_ALERT`.
   - Atomic multi-table transaction: Creates `childSafetyAlert`, creates linked `emergencyIncident`, transitions child profile `status = 'MISSING'`.
   - SSE notification: Emits `CHILD_SAFETY_SOS_TRIGGERED` and `EMERGENCY_INCIDENT_CREATED` strictly after commit.
2. **`GET /api/children/alerts`** (lines 1344–1391):
   - Returns sanitized `ChildSafetyAlertDto[]`.
   - Automatically scopes queries: Staff roles receive society-wide alerts; residents receive only self-reported alerts or alerts concerning their owned children.
   - Supports status filter: `?status=ACTIVE|ACKNOWLEDGED|RESOLVED|FALSE_ALARM`.
3. **`POST /api/children/alerts/:id/acknowledge`** (lines 1397–1468):
   - Restricted to `SOS_MANAGE_ROLES = ['guard', 'secretary', 'committee', 'admin']`.
   - Enforces atomic conditional state transition: `ACTIVE -> ACKNOWLEDGED`.
   - Records `acknowledgedAt`, `acknowledgedById`, `acknowledgedByName`.
   - Emits SSE `CHILD_SAFETY_ALERT_ACKNOWLEDGED`.
4. **`POST /api/children/alerts/:id/resolve`** (lines 1474–1619):
   - Restricted to `SOS_MANAGE_ROLES = ['guard', 'secretary', 'committee', 'admin']`.
   - Requires `resolutionNotes` (max 1000 chars) and `status` (`RESOLVED` or `FALSE_ALARM`).
   - Validates state transition from `ACTIVE` or `ACKNOWLEDGED`.
   - Updates linked `emergencyIncident.dispatchStatus = 'RESOLVED'`.
   - Restores child profile status to `SAFE` if no other active missing alert exists.
   - Emits SSE `CHILD_SAFETY_ALERT_RESOLVED`.

### 3.2 General Emergency Incident Backend Architecture
In [`server/src/index.ts`](file:///d:/AAZIRA/AARIZO/server/src/index.ts) (lines 2288–2357):

1. **`GET /api/emergency-incidents`**:
   - Authorized roles: `['resident', 'guard', 'secretary', 'committee', 'admin']`.
   - Tenant isolation: Scoped to caller's `societyId`.
   - Privacy boundary: Filters out `incidentType: 'CHILD_SAFETY'` for resident callers (residents access Child Safety alerts through `/api/children/alerts`).
2. **`POST /api/emergency-incidents`**:
   - Authorized roles: `['resident', 'guard', 'secretary', 'admin']` (Committee denied).
   - Inserts record into `emergency_incidents`.
   - Broadcasts `EMERGENCY_ALERTS` SSE event.
3. **`PATCH /api/emergency-incidents/:id/resolve`**:
   - Authorized roles: `['guard', 'secretary', 'admin']`.
   - Updates `dispatchStatus = 'RESOLVED'`, `resolvedAt = new Date()`.
   - Broadcasts `EMERGENCY_INCIDENT_RESOLVED` SSE event.

---

## 4. Architectural Gap Analysis: Simulated vs Authoritative

| Feature / Action | Current Simulated Behavior | Canonical Backend Contract | Modernization Requirement |
|---|---|---|---|
| **Child Safety SOS Trigger** | Writes fake item to `localStorage`; emits forged client event | `POST /api/children/sos`; creates DB alert & incident; locks child; emits server SSE | Replace with `childSafetyService.triggerSos(payload)` |
| **Alert Feed Source** | Reads from `localStorage` (`safetyCommandEngine.getIncidents()`) | `GET /api/children/alerts` (Child Safety) & `GET /api/emergency-incidents` (General) | Load real alerts via `childSafetyService.listAlerts()` and incidents via `apiClient.getEmergencyIncidents()` |
| **Alert Acknowledgment** | Mutates `localStorage` status; emits forged event | `POST /api/children/alerts/:id/acknowledge`; atomic DB update; records staff ID | Invoke `childSafetyService.acknowledgeAlert(alertId)` |
| **Alert Resolution** | Mutates `localStorage`; hardcodes note | `POST /api/children/alerts/:id/resolve`; requires notes; restores child `SAFE` status | Add resolution modal with notes; call `childSafetyService.resolveAlert(id, payload)` |
| **Responder Assignment** | Mutates `localStorage`; fabricates `RESPONDING` state | Not supported in backend DB schema | Decommission fake responder assignment for Child Safety; acknowledge acts as responder claim |
| **General Emergency Resolution** | Mutates `localStorage` | `PATCH /api/emergency-incidents/:id/resolve` | Call canonical backend endpoint |
| **Realtime Updates** | In-memory `realTimeSync` (client-to-client) | Server-Sent Events (SSE) via `realtimeService` | Consume `useSecurityChildSafetyRealtime` for child alerts; listen to `EMERGENCY_ALERTS` |

---

## 5. Security & Privacy Audit Findings

1. **Synthetic Event Forgery:**
   `SafetyCommandHub.tsx` calls `realtimeService.publish(...)` directly. In a production hardened environment, client-published events on protected security topics are rejected or ignored by authentic listeners.
2. **Missing Child Status Incoherence:**
   When staff triggers a missing-child alert via `safetyCommandEngine`, the database never updates `childProfile.status = 'MISSING'`. Consequently, the perimeter gate scanner does not block exit passes for that child!
3. **Lack of Resolution Audit Trail:**
   Resolving an incident in `localStorage` leaves the actual database alert in `ACTIVE` state indefinitely, causing perpetual alert states on resident dashboards.
4. **Tenant Isolation Risk in Local Engine:**
   `safetyCommandEngine.ts` stores incidents in a shared `localStorage` key without strict per-user cryptographic boundaries, allowing potential bleed if browser sessions are shared.

---

## 6. Conclusion

Phase 4.6.3.3.3 requires retiring the simulated Child Safety actions in `SafetyCommandHub.tsx`, wiring all SOS, alert reading, acknowledgment, and resolution workflows directly to `childSafetyService`, integrating `useSecurityChildSafetyRealtime`, and preserving general emergency incidents via their authoritative backend APIs.

