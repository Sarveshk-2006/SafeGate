# AARIZO — ISSUE-06 — PHASE B.2 — STEP 2.3 — SUBPHASE 4.6.3.3.3
# Child SOS & Unified Incident Console Implementation Plan

**Repository:** `D:\AAZIRA\AARIZO`  
**Phase:** Issue-06 / Phase B.2 / Step 2.3 / Subphase 4.6.3.3.3  
**Document:** Technical Implementation Architecture & Plan  
**Mode:** STRICTLY READ-ONLY  
**Date:** 2026-11-19  

---

## 1. Executive Summary

This implementation plan details the architectural modernization of the staff incident console and Child Safety SOS workflows in `src/domains/safety/components/SafetyCommandHub.tsx`. 

### Key Architectural Decisions:
1. **Separation of Concerns (No Shared Fake Model):** Child Safety alerts (`ChildSafetyAlertDto`) and General Emergency Incidents (`EmergencyIncidentBackendDto`) represent two distinct database domains with differing lifecycles, permissions, and audit requirements. They will be fetched and managed through their respective canonical APIs and rendered with explicit domain badges, rather than merged into a single mock object.
2. **Backend-Authoritative Child SOS:** Replace `safetyCommandEngine.triggerOneTapSOS('CHILD_SAFETY')` with `childSafetyService.triggerSos(payload)`. Staff can trigger SOS for a specific child or for an unidentified child on premises.
3. **Canonical Alert Acknowledgment & Resolution:** Replace mock engine mutations with `childSafetyService.acknowledgeAlert(alertId)` and a resolution dialog backed by `childSafetyService.resolveAlert(alertId, { status, resolutionNotes })`.
4. **General Emergency Endpoint Integration:** Integrate real general emergencies via `apiClient.getEmergencyIncidents()` and `PATCH /api/emergency-incidents/:id/resolve`.
5. **Realtime Hook Integration:** Connect `SafetyCommandHub.tsx` to `useSecurityChildSafetyRealtime`, enabling automatic reactive updates for all staff roles without duplicate SSE connections or manual polling loops.
6. **Eliminate Client-Side Event Forgery & LocalStorage:** Remove all `realtimeService.publish` calls from `SafetyCommandHub.tsx`. Purge all writes to `aarizo_emergency_incidents_v3`.

---

## 2. Unified Incident Console Architecture

```
                                  ┌──────────────────────────────┐
                                  │      SafetyCommandHub.tsx    │
                                  │   (Unified Incident Console) │
                                  └───────────────┬──────────────┘
                                                  │
                 ┌────────────────────────────────┴────────────────────────────────┐
                 │                                                                 │
                 ▼                                                                 ▼
   ┌───────────────────────────┐                                     ┌───────────────────────────┐
   │    Child Safety Alerts    │                                     │     General Emergencies   │
   │       (Domain A)          │                                     │         (Domain B)        │
   ├───────────────────────────┤                                     ├───────────────────────────┤
   │ Model: ChildSafetyAlertDto│                                     │ Model: EmergencyIncident  │
   │ API: /api/children/alerts │                                     │ API: /emergency-incidents │
   │ Lifecycle:                │                                     │ Lifecycle:                │
   │  ACTIVE -> ACKNOWLEDGED   │                                     │  DISPATCHED -> RESOLVED   │
   │  -> RESOLVED / FALSE_ALARM│                                     │ Actions:                  │
   │ Actions:                  │                                     │  Resolve via PATCH        │
   │  Acknowledge (POST)       │                                     │ SSE: EMERGENCY_ALERTS     │
   │  Resolve + Notes (POST)   │                                     └───────────────────────────┘
   │ SSE: useSecurityRealtime  │
   └───────────────────────────┘
```

### 2.1 Unified Presentation Model
To present both domains cleanly in the feed without corrupting either backend model, the console will maintain two typed state collections:
```typescript
const [childAlerts, setChildAlerts] = useState<ChildSafetyAlertDto[]>([]);
const [generalIncidents, setGeneralIncidents] = useState<EmergencyIncidentBackendDto[]>([]);
const [isLoadingIncidents, setIsLoadingIncidents] = useState<boolean>(false);
const [incidentsError, setIncidentsError] = useState<string | null>(null);
const [incidentFilter, setIncidentFilter] = useState<'ALL' | 'CHILD_SAFETY' | 'GENERAL'>('ALL');
```

The unified active count displayed on the console tab header:
```typescript
const activeChildAlertsCount = childAlerts.filter(a => a.status === 'ACTIVE' || a.status === 'ACKNOWLEDGED').length;
const activeGeneralIncidentsCount = generalIncidents.filter(i => i.dispatchStatus !== 'RESOLVED' && i.dispatchStatus !== 'CLOSED').length;
const totalActiveIncidentCount = activeChildAlertsCount + activeGeneralIncidentsCount;
```

---

## 3. Step-by-Step Implementation Sequence

### Step 1: Add Helper Method in `src/services/apiClient.ts`
Add a typed wrapper for the existing backend endpoint `PATCH /api/emergency-incidents/:id/resolve`:
```typescript
resolveEmergencyIncidentStrict: async (id: string): Promise<any> => {
  const safeId = encodeSegment(id, 'incidentId', '/emergency-incidents/:id/resolve');
  return apiRequestStrict<any>(`/emergency-incidents/${safeId}/resolve`, {
    method: 'PATCH',
  });
},
```

### Step 2: Extend Pure Controllers in `SafetyCommandHub.tsx`
Export pure controller functions that encapsulate permission validation, input sanitation, and service calls:

1. **`executeStaffTriggerChildSos`**:
   - Validates that caller is an authorized staff role (`['guard', 'secretary', 'committee', 'admin']`).
   - Requires non-empty `location`.
   - Normalizes `alertType` (default `MISSING_CHILD`), `severity` (default `CRITICAL`).
   - Invokes `childSafetyService.triggerSos(payload)`.
   - Propagates backend errors without fake success.
2. **`executeStaffAcknowledgeChildAlert`**:
   - Validates role in `['guard', 'secretary', 'committee', 'admin']`.
   - Invokes `childSafetyService.acknowledgeAlert(alertId)`.
3. **`executeStaffResolveChildAlert`**:
   - Validates role in `['guard', 'secretary', 'committee', 'admin']`.
   - Validates `resolutionNotes.trim().length > 0`.
   - Invokes `childSafetyService.resolveAlert(alertId, { status, resolutionNotes })`.
4. **`executeStaffResolveGeneralIncident`**:
   - Validates role in `['guard', 'secretary', 'admin']` (Committee denied).
   - Invokes `apiClient.resolveEmergencyIncidentStrict(id)`.

### Step 3: Integrate `useSecurityChildSafetyRealtime` Hook
In `SafetyCommandHub.tsx`:
```typescript
useSecurityChildSafetyRealtime({
  enabled: isStaffRole,
  onAlertsChange: useCallback(() => {
    loadAuthoritativeAlerts();
  }, [loadAuthoritativeAlerts]),
  onRefresh: useCallback(() => {
    loadAuthoritativeAlerts();
  }, [loadAuthoritativeAlerts]),
});
```
This hook automatically subscribes to:
- `CHILD_SAFETY_SOS_TRIGGERED`
- `CHILD_SAFETY_ALERT_ACKNOWLEDGED`
- `CHILD_SAFETY_ALERT_RESOLVED`
When any event fires, the hook invokes `loadAuthoritativeAlerts()`, providing instant reactive updates across all security desks.

### Step 4: Decommission Local Engine SOS & Incident Methods
- Remove all calls to:
  - `safetyCommandEngine.triggerOneTapSOS`
  - `safetyCommandEngine.acknowledgeIncident`
  - `safetyCommandEngine.assignResponder`
  - `safetyCommandEngine.resolveIncident`
  - `safetyCommandEngine.getIncidents`
- Remove all `realtimeService.publish` invocations from `SafetyCommandHub.tsx`.
- Remove `realTimeSync.subscribe('CHILD_SAFETY_UPDATED')`.

### Step 5: Implement Dedicated Resolution Dialog for Child Alerts
Replace the mock alert resolve action with a modal dialog:
- Title: "Resolve Child Safety Alert"
- Status choices: "Resolved (Child Found Safe)" (`RESOLVED`) vs "False Alarm" (`FALSE_ALARM`).
- Required textarea: "Resolution Notes / Recovery Details *" (max 1000 characters).
- Submit button disabled when notes are empty or submission is in-flight.
- Submitting calls `executeStaffResolveChildAlert`.

### Step 6: Modernize Staff SOS Modal / Flow for Child Safety
When staff clicks "Child Safety SOS":
- Opens a dedicated staff Child SOS modal:
  - Target child selection dropdown (listing society children or option for "Unidentified Child on Premises").
  - Alert type selector: `MISSING_CHILD` (default), `UNATTENDED_CHILD`, `UNAUTHORIZED_EXIT_ATTEMPT`, `EMERGENCY_SOS`.
  - Severity selector: `CRITICAL` (default), `HIGH`, `MEDIUM`, `LOW`.
  - Required location input (e.g. "Clubhouse Swimming Pool area", "Basement Parking B2").
  - Last seen details (clothing, time).
  - Submit button invoking `executeStaffTriggerChildSos`.

### Step 7: Modernize Unified Live Incident Feed
Render two distinct visual card sections or an integrated feed with clear domain badges:
- **Child Safety Alert Card:**
  - Badge: `CHILD SAFETY` + Alert Type badge (`MISSING_CHILD`, `UNATTENDED_CHILD`, etc.).
  - Child details: Child Name, Flat Number, Location, Last Seen Details.
  - Status Badge: `ACTIVE` (red pulsing), `ACKNOWLEDGED` (amber), `RESOLVED` (green), `FALSE_ALARM` (slate).
  - Staff Audit: Shows `Acknowledged by <Name> at <Time>` and `Resolved by <Name> (<Notes>)`.
  - Action Buttons:
    - If `ACTIVE`: "Acknowledge Alert" button.
    - If `ACTIVE` or `ACKNOWLEDGED`: "Resolve Alert" button (opens resolution dialog).
- **General Emergency Card:**
  - Badge: `GENERAL EMERGENCY` + Category badge (`MEDICAL`, `FIRE`, `SECURITY`, `LIFT`, `ELECTRICAL`).
  - Details: Location, Description, Triggered timestamp.
  - Status Badge: `DISPATCHED` (red), `RESOLVED` (green).
  - Action Buttons:
    - If `DISPATCHED` and role in `['guard', 'secretary', 'admin']`: "Mark Resolved" button.

---

## 4. Error Handling, Loading, & Concurrency Guards

1. **In-Flight Mutation Locking:**
   Use synchronous references (`isAcknowledgingAlertId`, `isResolvingAlertId`, `isSubmittingSos`) to prevent duplicate clicks while network promises are pending.
2. **Stale Request Guarding:**
   Incorporate request nonces so delayed responses cannot overwrite newly fetched data.
3. **Backend Conflict Handling:**
   - Handle HTTP 409 `DUPLICATE_ACTIVE_SOS_ALERT`: Display "An active alert already exists for this child."
   - Handle HTTP 409 `ALERT_STATE_CONFLICT`: Display "Alert was updated concurrently by another operator." and reload.
   - Handle HTTP 422 `INVALID_ALERT_TRANSITION`: Display informative error banner and refresh list.
4. **Empty State & Retry:**
   When no active incidents exist, render clean empty state: "All Clear — No active Child Safety alerts or emergency incidents in society." with a manual "Refresh" button.

