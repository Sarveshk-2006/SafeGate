# AARIZO — ISSUE-06 — PHASE B.2 — STEP 2.3 — SUBPHASE 4.6.3.3.3
# Child SOS & Unified Incident Console API Contract Matrix

**Repository:** `D:\AAZIRA\AARIZO`  
**Phase:** Issue-06 / Phase B.2 / Step 2.3 / Subphase 4.6.3.3.3  
**Document:** API Contract & DTO Specification  
**Mode:** STRICTLY READ-ONLY  
**Date:** 2026-11-19  

---

## 1. Child Safety Alert Endpoints

### 1.1 Trigger Child Safety SOS (`POST /api/children/sos`)
- **Backend Handler:** `server/src/childSafety/router.ts:1097-1342`
- **Rate Limit:** `childSosRateLimiter()` (5 requests / 60 seconds per IP/User)
- **Authorized Roles:** `SOS_TRIGGER_ROLES = ['resident', 'guard', 'secretary', 'committee', 'admin']`
- **Frontend Service Method:** `childSafetyService.triggerSos(payload)` (`src/services/childSafetyService.ts:916`)
- **Underlying Client Call:** `apiClient.triggerChildSosStrict(payload)` (`src/services/apiClient.ts:1230`)

#### Request Specification (`TriggerChildSosRequest`):
```typescript
export interface TriggerChildSosRequest {
  childId?: string; // Required for residents; optional for staff (unidentified child)
  alertType?: 'MISSING_CHILD' | 'UNATTENDED_CHILD' | 'UNAUTHORIZED_EXIT_ATTEMPT' | 'EMERGENCY_SOS'; // Default: MISSING_CHILD
  severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; // Default: CRITICAL
  location: string; // Required, non-empty, max 255 chars
  description?: string; // Optional, max 1000 chars
  lastSeenDetails?: string; // Optional, max 500 chars
  childName?: string; // Optional fallback for staff when childId is omitted (max 200 chars)
  flatNumber?: string; // Optional fallback for staff when childId is omitted (max 64 chars)
}
```

#### Response Specification (HTTP 201 Created):
```typescript
export interface ChildSosCreatedDto {
  alert: ChildSafetyAlertDto;
  emergencyIncident: {
    id: string;
    societyId: string;
    incidentType: string;
    severity: string;
    location: string;
    dispatchStatus: string;
    createdAt: string;
  };
}
```

#### ChildSafetyAlertDto Shape:
```typescript
export interface ChildSafetyAlertDto {
  id: string;
  societyId: string;
  childId: string | null;
  reportedById: string | null;
  reportedByName: string | null;
  childName: string;
  flatNumber: string;
  alertType: 'MISSING_CHILD' | 'UNATTENDED_CHILD' | 'UNAUTHORIZED_EXIT_ATTEMPT' | 'EMERGENCY_SOS';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_ALARM';
  location: string;
  description: string | null;
  lastSeenDetails: string | null;
  acknowledgedAt: string | null;
  acknowledgedById: string | null;
  acknowledgedByName: string | null;
  resolvedAt: string | null;
  resolvedById: string | null;
  resolvedByName: string | null;
  resolutionNotes: string | null;
  emergencyIncidentId: string | null;
  createdAt: string;
  updatedAt: string;
}
```

#### Error Codes & Statuses:
- `400 INVALID_LOCATION`: Location is missing or exceeds 255 chars.
- `400 CHILD_ID_REQUIRED`: Resident triggered SOS without supplying an owned `childId`.
- `400 TARGET_SOCIETY_REQUIRED`: Staff triggered SOS without a concrete tenant society.
- `403 UNAUTHORIZED_SOS_TRIGGER`: Resident attempted to trigger SOS for a child profile they do not own.
- `404 CHILD_NOT_FOUND`: Specified `childId` does not exist in caller's society.
- `409 CHILD_ARCHIVED`: Child profile is archived and ineligible for emergency alerts.
- `409 DUPLICATE_ACTIVE_SOS_ALERT`: Child already has an active or acknowledged `MISSING_CHILD` alert (returns `activeAlert`).
- `429 RATE_LIMITED`: SOS rate limit exceeded.

#### Server-Side Invariants:
1. Locks the child profile row via `lockChildProfileRow(tx, childId, societyId)` (`SELECT ... FOR UPDATE`).
2. If `alertType === 'MISSING_CHILD'`, atomically updates `childProfile.status = 'MISSING'` in the same transaction.
3. Automatically generates linked row in `emergency_incidents` (`incidentType = 'CHILD_SAFETY'`).
4. Emits server SSE events `CHILD_SAFETY_SOS_TRIGGERED` and `EMERGENCY_INCIDENT_CREATED` strictly post-commit.

---

### 1.2 List Child Safety Alerts (`GET /api/children/alerts`)
- **Backend Handler:** `server/src/childSafety/router.ts:1344-1391`
- **Authorized Roles:** `SOS_TRIGGER_ROLES = ['resident', 'guard', 'secretary', 'committee', 'admin']`
- **Frontend Service Method:** `childSafetyService.listAlerts(params)` (`src/services/childSafetyService.ts:937`)
- **Underlying Client Call:** `apiClient.getChildAlertsStrict(params)` (`src/services/apiClient.ts:1253`)

#### Query Parameters:
```typescript
export interface ListChildAlertsParams {
  status?: 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_ALARM';
  limit?: number; // Clamped to 1..200, default 100
  offset?: number; // Default 0
}
```

#### Response Specification (HTTP 200 OK):
`ChildSafetyAlertDto[]` sorted by `createdAt DESC`.

#### Role-Based Query Boundaries:
- **Staff (`guard`, `secretary`, `committee`, `admin`):** Returns all society-scoped alerts matching query parameters.
- **Resident:** Filtered strictly to alerts where `reportedById === actor.userId` OR `child.residentId === actor.residentId` OR `child.guardianUserId === actor.userId`.

---

### 1.3 Acknowledge Child Safety Alert (`POST /api/children/alerts/:id/acknowledge`)
- **Backend Handler:** `server/src/childSafety/router.ts:1397-1468`
- **Authorized Roles:** `SOS_MANAGE_ROLES = ['guard', 'secretary', 'committee', 'admin']` (Residents denied: HTTP 403)
- **Frontend Service Method:** `childSafetyService.acknowledgeAlert(alertId)` (`src/services/childSafetyService.ts:971`)
- **Underlying Client Call:** `apiClient.acknowledgeChildAlertStrict(alertId)` (`src/services/apiClient.ts:1267`)

#### Request Parameters:
- Path parameter: `:id` (UUID of the safety alert)
- Request body: Empty `{}`

#### Response Specification (HTTP 200 OK):
Returns updated `ChildSafetyAlertDto` with:
- `status: 'ACKNOWLEDGED'`
- `acknowledgedAt: <ISO-8601 timestamp>`
- `acknowledgedById: actor.userId`
- `acknowledgedByName: actor.name`

#### Error Codes & Statuses:
- `403 INSUFFICIENT_PERMISSIONS`: Resident or unauthorized caller attempted acknowledgment.
- `404 ALERT_NOT_FOUND`: Alert ID does not exist in caller's society.
- `409 ALERT_STATE_CONFLICT`: Alert state changed concurrently during transaction.
- `422 INVALID_ALERT_TRANSITION`: Alert status is not `ACTIVE` (cannot acknowledge already acknowledged or resolved alerts).

#### Server-Side Invariants:
1. Atomic conditional update: `where: { id, societyId: actor.societyId, status: 'ACTIVE' }`.
2. Emits server SSE event `CHILD_SAFETY_ALERT_ACKNOWLEDGED`.

---

### 1.4 Resolve Child Safety Alert (`POST /api/children/alerts/:id/resolve`)
- **Backend Handler:** `server/src/childSafety/router.ts:1474-1619`
- **Authorized Roles:** `SOS_MANAGE_ROLES = ['guard', 'secretary', 'committee', 'admin']` (Residents denied: HTTP 403)
- **Frontend Service Method:** `childSafetyService.resolveAlert(alertId, payload)` (`src/services/childSafetyService.ts:983`)
- **Underlying Client Call:** `apiClient.resolveChildAlertStrict(alertId, payload)` (`src/services/apiClient.ts:1276`)

#### Request Specification (`ResolveChildAlertRequest`):
```typescript
export interface ResolveChildAlertRequest {
  status?: 'RESOLVED' | 'FALSE_ALARM'; // Default: RESOLVED
  resolutionNotes: string; // Required, non-empty, max 1000 chars
}
```

#### Response Specification (HTTP 200 OK):
Returns updated `ChildSafetyAlertDto` with:
- `status: 'RESOLVED'` or `'FALSE_ALARM'`
- `resolvedAt: <ISO-8601 timestamp>`
- `resolvedById: actor.userId`
- `resolvedByName: actor.name`
- `resolutionNotes: <string>`

#### Error Codes & Statuses:
- `400 RESOLUTION_NOTES_REQUIRED`: `resolutionNotes` missing or empty.
- `400 INVALID_RESOLUTION_STATUS`: Status is not `RESOLVED` or `FALSE_ALARM`.
- `403 INSUFFICIENT_PERMISSIONS`: Resident attempted resolution.
- `404 ALERT_NOT_FOUND`: Alert does not exist in caller's society.
- `409 ALERT_STATE_CONFLICT`: Alert was already resolved or modified concurrently.
- `422 INVALID_ALERT_TRANSITION`: Alert is already in terminal status (`RESOLVED` or `FALSE_ALARM`).

#### Server-Side Invariants:
1. Transactionally serializes child profile row via `lockChildProfileRow`.
2. Updates `child_safety_alerts` status to target resolution status.
3. If linked to an `emergencyIncident`, updates `dispatchStatus = 'RESOLVED'`, `resolvedAt = now`.
4. If `alertType === 'MISSING_CHILD'`, checks whether any other active or acknowledged missing-child alert remains for this child. If count is 0, restores `childProfile.status = 'SAFE'`.
5. Emits server SSE event `CHILD_SAFETY_ALERT_RESOLVED`.

---

## 2. General Emergency Incident Endpoints

### 2.1 List Emergency Incidents (`GET /api/emergency-incidents`)
- **Backend Handler:** `server/src/index.ts:2289-2310`
- **Authorized Roles:** `['resident', 'guard', 'secretary', 'committee', 'admin']`
- **Client Method:** `apiClient.getEmergencyIncidents(societyId)` (`src/services/apiClient.ts:1431`)

#### Response Specification (HTTP 200 OK):
```typescript
export interface EmergencyIncidentBackendDto {
  id: string;
  societyId: string;
  incidentType: 'MEDICAL' | 'FIRE' | 'SECURITY' | 'LIFT' | 'ELECTRICAL' | 'CHILD_SAFETY' | string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  location: string;
  description: string | null;
  dispatchStatus: 'DISPATCHED' | 'RESOLVED' | string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

#### Boundary Invariants:
- Scoped to `tenant.societyId`.
- Residents automatically filter out `incidentType: 'CHILD_SAFETY'` (residents track child alerts via `/api/children/alerts`).

---

### 2.2 Trigger General Emergency Incident (`POST /api/emergency-incidents`)
- **Backend Handler:** `server/src/index.ts:2312-2329`
- **Authorized Roles:** `['resident', 'guard', 'secretary', 'admin']` (Committee denied)
- **Client Method:** `apiClient.createEmergencyIncident(data)` (`src/services/apiClient.ts:1432`)

#### Request Specification:
```typescript
export interface CreateEmergencyIncidentRequest {
  incidentType: 'MEDICAL' | 'FIRE' | 'SECURITY' | 'LIFT' | 'ELECTRICAL' | string;
  severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  location: string;
  description?: string;
}
```

#### Response Specification (HTTP 201 Created):
Returns created `EmergencyIncidentBackendDto`.

---

### 2.3 Resolve General Emergency Incident (`PATCH /api/emergency-incidents/:id/resolve`)
- **Backend Handler:** `server/src/index.ts:2332-2357`
- **Authorized Roles:** `['guard', 'secretary', 'admin']` (Resident and Committee denied)
- **Path Parameter:** `:id` (UUID of emergency incident)

#### Response Specification (HTTP 200 OK):
Returns updated `EmergencyIncidentBackendDto` with `dispatchStatus: 'RESOLVED'`, `resolvedAt: <timestamp>`.

---

## 3. Realtime Event Contract Mapping

| Authoritative Event Topic | Emitted By Endpoint | Payload Schema | Consuming Realtime Hook | UI Invalidation Triggered |
|---|---|---|---|---|
| `CHILD_SAFETY_SOS_TRIGGERED` | `POST /api/children/sos` | `{ alertId, emergencyIncidentId, childId, alertType, severity, status, location }` | `useSecurityChildSafetyRealtime` (`onAlertsChange`) | Reloads `childSafetyService.listAlerts()`, increments active SOS counter |
| `CHILD_SAFETY_ALERT_ACKNOWLEDGED` | `POST /api/children/alerts/:id/acknowledge` | `{ alertId, childId, status: 'ACKNOWLEDGED', acknowledgedAt }` | `useSecurityChildSafetyRealtime` (`onAlertsChange`) | Updates alert status to `ACKNOWLEDGED`, updates acknowledged timestamp/badge |
| `CHILD_SAFETY_ALERT_RESOLVED` | `POST /api/children/alerts/:id/resolve` | `{ alertId, childId, status: 'RESOLVED'\|'FALSE_ALARM', resolvedAt }` | `useSecurityChildSafetyRealtime` (`onAlertsChange`) | Removes alert from active badge count, updates status badge |
| `EMERGENCY_ALERTS` | `POST /api/emergency-incidents` | `EmergencyIncidentBackendDto` | `realtimeService.subscribe('EMERGENCY_ALERTS')` | Reloads `apiClient.getEmergencyIncidents()` |
| `EMERGENCY_INCIDENT_RESOLVED` | `PATCH /api/emergency-incidents/:id/resolve` | `EmergencyIncidentBackendDto` | `realtimeService.subscribe('EMERGENCY_INCIDENT_RESOLVED')` | Updates incident status in general emergency list |

---

## 4. Contract Gaps Identified During Audit

1. **Missing `apiClient.resolveEmergencyIncident` Wrapper:**
   `server/src/index.ts:2332` exposes `PATCH /api/emergency-incidents/:id/resolve`, but `src/services/apiClient.ts` does not have a typed helper method for it. A typed method `resolveEmergencyIncident(id: string)` should be provided.
2. **Prisma Responder Assignment Limitation:**
   The database has no responder fields on either `child_safety_alerts` or `emergency_incidents`. The frontend "Assign Responder" workflow in `SafetyCommandHub` cannot be backed by a database column without modifying schema. Therefore, the console will treat staff acknowledgment (`acknowledgedByName`) as the authoritative ownership/responder assignment marker.

