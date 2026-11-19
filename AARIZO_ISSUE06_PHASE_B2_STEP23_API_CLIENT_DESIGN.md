# AARIZO — ISSUE-06 Phase B.2.3: Canonical API Client & Error Semantics Design

**Target File:** `src/services/apiClient.ts` (coexisting safely with `src/services/authStorage.ts`)  
**Authoritative Backend Source:** `server/src/childSafety/router.ts`, `server/src/childSafety/validation.ts`, `server/src/auth.ts`, `server/src/index.ts`

---

## 1. Core Architectural Rule: Strict Typed Errors Without Breaking Unrelated Consumers

Currently `apiRequest<T>()` (`src/services/apiClient.ts#L18-L55`) catches all non-2xx HTTP responses and network failures and returns `null`. That design is unsafe for Child Safety because it erases `503` fail-closed status, `409` missing-child lockdown / pass-consumed / duplicate-SOS conflicts, `422` policy/validation errors, `429` rate-limit cooldowns, and `403` authorization denials.

**Design Decision:**
- **Preserve** existing `apiRequest<T>()` untouched for unrelated legacy modules (`billing`, `maintenance`, `parcels`, `announcements`, `advertisements`, etc.) so zero unrelated regressions occur.
- **Introduce** a canonical `ApiError` class and `apiRequestStrict<T>()` transport helper used by **all 19 Child Safety endpoints** (and strict Emergency Incident calls in `SafetyHome.tsx`).

---

## 2. Typed `ApiError` Contract

```ts
export type ApiErrorKind =
  | 'NETWORK'          // fetch threw (offline, DNS, connection refused, timeout)
  | 'UNAUTHORIZED'     // 401
  | 'FORBIDDEN'        // 403
  | 'NOT_FOUND'        // 404
  | 'CONFLICT'         // 409 (e.g., CHILD_MISSING_ALERT_BLOCKED, PASS_ALREADY_CONSUMED, DUPLICATE_ACTIVE_SOS_ALERT)
  | 'VALIDATION'       // 400 / 422 (e.g., RAW_ID_DOCUMENT_FORBIDDEN, AUTHORIZED_PICKUP_REQUIRED, RESOLUTION_NOTES_REQUIRED)
  | 'RATE_LIMITED'     // 429 (RATE_LIMIT_EXCEEDED)
  | 'UNAVAILABLE'      // 503 (BACKEND_UNAVAILABLE / DATABASE_UNAVAILABLE — fail-closed!)
  | 'SERVER_ERROR'     // 500 / 502 / 504
  | 'INVALID_RESPONSE';// 2xx returned malformed/unexpected JSON body

export class ApiError extends Error {
  public readonly status: number;         // 0 for NETWORK or INVALID_RESPONSE
  public readonly code: string;           // Backend `code` field or canonical client code
  public readonly kind: ApiErrorKind;
  public readonly endpoint: string;
  public readonly payload?: Record<string, unknown>; // Full sanitized backend JSON body (e.g., { authorized: false, outcome, exitLog })
  public readonly retryAfterSeconds?: number;        // Parsed from Retry-After header on 429/503

  constructor(params: {
    message: string;
    status: number;
    code: string;
    kind: ApiErrorKind;
    endpoint: string;
    payload?: Record<string, unknown>;
    retryAfterSeconds?: number;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.status = params.status;
    this.code = params.code;
    this.kind = params.kind;
    this.endpoint = params.endpoint;
    this.payload = params.payload;
    this.retryAfterSeconds = params.retryAfterSeconds;
  }

  public get isFailClosedUnavailable(): boolean {
    return this.kind === 'UNAVAILABLE' || this.kind === 'NETWORK';
  }
}
```

---

## 3. Complete HTTP Status, Header & Error Semantics Matrix

| Condition / Status | `apiRequestStrict` Behavior | Auth / Session Side Effect | UI Handling Standard |
| :--- | :--- | :--- | :--- |
| **Bearer Token Attachment** | Reads authoritative token via `getAuthToken()` (`src/services/authStorage.ts`) and attaches `Authorization: Bearer <token>` + `Content-Type: application/json` + `Accept: application/json`. **Does NOT attach legacy `x-society-id`, `x-user-id`, or `x-user-role` headers** on strict Child Safety calls. | If token is missing before request, throws `ApiError(401, 'AUTH_TOKEN_MISSING', 'UNAUTHORIZED')` immediately without leaking an unauthenticated call (and triggers unauthorized flow if session claims active). | Redirects to login via `AuthContext`. |
| **200 / 201 Success** | Parses JSON, runs lightweight runtime response validator (verifying expected root shape — array vs object with required ID/flags), and resolves typed `T`. If 2xx body is unparseable or fails validator, throws `ApiError(0, 'INVALID_RESPONSE', 'INVALID_RESPONSE')` — **never returns `null`**. | None. | Mutation is considered successful **ONLY** after `200`/`201` validated response resolves. |
| **400 Bad Request** | Parses `{ error, code }`; throws `ApiError(400, code \|\| 'BAD_REQUEST', 'VALIDATION', payload)`. | None. | Inline form error banner (e.g., `RAW_ID_DOCUMENT_FORBIDDEN`, `BEARER_TOKEN_REQUIRED`, `LOCATION_REQUIRED`, `RESOLUTION_NOTES_REQUIRED`, `INVALID_VALIDITY_WINDOW`). |
| **401 Unauthorized** | Parses `{ error, code }`; throws `ApiError(401, code \|\| 'UNAUTHORIZED', 'UNAUTHORIZED', payload)`. | Calls `clearAuthSession()` and dispatches `window.dispatchEvent(new CustomEvent('aarizo:unauthorized', { detail: { endpoint } }))` -> `AuthContext` logs user out & `realtimeService.disconnect()` aborts SSE. | Immediate clean redirect to login screen; no retry loop. |
| **403 Forbidden** | Parses `{ error, code }`; throws `ApiError(403, code \|\| 'FORBIDDEN', 'FORBIDDEN', payload)`. | **Does NOT clear session** (user is authenticated but lacks role/tenant permission). | Display clear authorization message (e.g., `INSUFFICIENT_PERMISSIONS`, `ACCOUNT_SUSPENDED`, `TENANT_ISOLATION_VIOLATION`). |
| **404 Not Found** | Parses `{ error, code, exitLog? }`; throws `ApiError(404, code \|\| 'NOT_FOUND', 'NOT_FOUND', payload)`. | None. | On Gate Verify (`INVALID_OR_UNKNOWN_PASS`): renders red **DENIED — Invalid or Unrecognized Gate Pass** verdict card (with `exitLog` if returned). Elsewhere: "Record not found" notice + refresh list. |
| **409 Conflict** | Parses `{ error, code, outcome?, exitLog? }`; throws `ApiError(409, code \|\| 'CONFLICT', 'CONFLICT', payload)`. | None. | Distinct high-signal UI per backend `code`:<br>- `CHILD_MISSING_ALERT_BLOCKED` -> Flashing crimson **GATE LOCKDOWN** + siren<br>- `PASS_ALREADY_CONSUMED` / `PASS_EXPIRED` / `PASS_REVOKED` / `PICKUP_PERSON_UNAUTHORIZED` -> Red **DENIED** verdict with exact reason<br>- `DUPLICATE_ACTIVE_SOS_ALERT` -> Calm alert banner linking to active SOS<br>- `ACTIVE_MISSING_ALERT_MUST_BE_RESOLVED` -> Instruct user to resolve active missing-child alert first |
| **422 Unprocessable Entity** | Parses `{ error, code, outcome?, exitLog? }`; throws `ApiError(422, code \|\| 'UNPROCESSABLE_ENTITY', 'VALIDATION', payload)`. | None. | Actionable policy guidance:<br>- `AUTHORIZED_PICKUP_REQUIRED` -> Prompt parent to authorize an escort first<br>- `PICKUP_AUTHORIZATION_INACTIVE` / `EXPIRED` -> Highlight revoked/expired pickup<br>- `PASS_NOT_YET_VALID` -> Show pass `validFrom` start time<br>- `ESCORT_REQUIRED` -> Explain escort-required child policy |
| **429 Too Many Requests** | Parses `{ error, code }` + `Retry-After` header; throws `ApiError(429, code \|\| 'RATE_LIMIT_EXCEEDED', 'RATE_LIMITED', retryAfterSeconds)`. | None. | Disable submit button briefly with countdown / cooldown banner (*"Too many requests. Please wait before retrying."*). Never auto-retry in a tight loop. |
| **503 Service Unavailable** | Parses `{ error, code, outcome?, verificationChannel? }`; throws `ApiError(503, code \|\| 'BACKEND_UNAVAILABLE', 'UNAVAILABLE', payload)`. | None. | **FAIL-CLOSED:** On Gate Verify -> Critical banner *"VERIFICATION SERVICE UNAVAILABLE — DO NOT RELEASE CHILD. Hold at gate and retry or escalate to society office."* On reads -> Retryable service-unavailable state (zero `localStorage` fallback). |
| **500 / 502 / 504 Server Error** | Parses sanitized `{ error, code }`; throws `ApiError(status, code \|\| 'INTERNAL_SERVER_ERROR', 'SERVER_ERROR')`. | None. | Non-leaky error toast/banner with manual Retry button. On Gate Verify -> Fail closed (do not authorize exit). |
| **Network Error / Abort / Timeout** | `fetch` throws `TypeError` or `AbortError`; wraps into `ApiError(0, 'NETWORK_UNAVAILABLE', 'NETWORK')` (with 15s default `AbortSignal.timeout` on normal calls, 10s on gate verify). | None. | **Explicitly distinguished from HTTP application errors.** On Gate Verify -> Critical offline fail-closed hold banner (*"OFFLINE / NETWORK UNAVAILABLE — DO NOT RELEASE CHILD"*). |

---

## 4. Exact Runtime Response Validators & Typed Method Signatures (All 19 Child Safety Endpoints)

Each strict method validates response structure before returning (preventing silent `undefined` crashes):
- List endpoints (`GET /children`, `/:childId/pickups`, `/passes`, `/exit-logs`, `/alerts`): assert `Array.isArray(data)`.
- Create/Get/Patch profile (`ChildProfileDto`): assert `typeof data?.id === 'string' && typeof data?.fullName === 'string'`.
- Create pass (`ChildGatePassCreatedDto`): assert `typeof data?.id === 'string' && typeof data?.bearerToken === 'string' && typeof data?.qrPayload === 'string' && typeof data?.passCode === 'string'`.
- Verify pass (`VerifyChildGatePassSuccessDto`): assert `data?.authorized === true && data?.outcome === 'ALLOWED' && typeof data?.exitLog?.id === 'string'`.
- Trigger SOS (`ChildSosCreatedDto`): assert `typeof data?.alert?.id === 'string' && typeof data?.emergencyIncident?.id === 'string'`.

### Complete Strict Child Safety Method Catalog

| Method in `apiClient` | HTTP & Path | Query / Body Parameters | Return Type (`Promise<...>`) |
| :--- | :--- | :--- | :--- |
| `getChildrenStrict` | `GET /api/children` | `?includeArchived=true`, optional `?societyId=` (platform admin only) | `ChildProfileDto[]` |
| `getChildByIdStrict` | `GET /api/children/:id` | Path `:id` | `ChildProfileDto` |
| `createChildStrict` | `POST /api/children` | `CreateChildProfileRequest` | `ChildProfileDto` |
| `updateChildStrict` | `PATCH /api/children/:id` | `UpdateChildProfileRequest` | `ChildProfileDto` |
| `archiveChildStrict` | `POST /api/children/:id/archive` | `{ reason?: string }` | `{ archived: true; child: ChildProfileDto }` |
| `getChildPickupsStrict` | `GET /api/children/:childId/pickups` | `?includeArchived=true` | `AuthorizedPickupDto[]` |
| `addChildPickupStrict` | `POST /api/children/:childId/pickups` | `CreateAuthorizedPickupRequest` (rejects raw ID fields) | `AuthorizedPickupDto` |
| `updateChildPickupStrict` | `PATCH /api/children/:childId/pickups/:pickupId` | `UpdateAuthorizedPickupRequest` | `AuthorizedPickupDto` |
| `revokeChildPickupStrict` | `POST /api/children/:childId/pickups/:pickupId/revoke` | `{ reason?: string }` | `{ revoked: true; pickup: AuthorizedPickupDto }` |
| `archiveChildPickupStrict` | `DELETE /api/children/:childId/pickups/:pickupId` | Path `:childId`, `:pickupId` | `{ revoked: true; pickup: AuthorizedPickupDto }` |
| `getChildPassesStrict` | `GET /api/children/passes` | `?childId=&status=&limit=&offset=&societyId=` | `ChildGatePassDto[]` |
| `getChildPassByIdStrict` | `GET /api/children/passes/:id` | Path `:id` | `ChildGatePassDto` |
| `createChildPassStrict` | `POST /api/children/passes` | `CreateChildGatePassRequest` | `ChildGatePassCreatedDto` (one-time `bearerToken`, `qrPayload`) |
| `revokeChildPassStrict` | `POST /api/children/passes/:id/revoke` | `{ reason?: string }` | `{ revoked: true; pass: ChildGatePassDto }` |
| `verifyChildPassStrict` | `POST /api/children/passes/verify` | `{ qrPayload?: string; bearerToken?: string; gateId?: string; notes?: string }` | `VerifyChildGatePassSuccessDto` |
| `getChildExitLogsStrict` | `GET /api/children/exit-logs` | `?childId=&limit=&offset=&societyId=` | `ChildExitLogDto[]` |
| `triggerChildSosStrict` | `POST /api/children/sos` | `TriggerChildSosRequest` | `ChildSosCreatedDto` |
| `getChildAlertsStrict` | `GET /api/children/alerts` | `?status=&limit=&offset=&societyId=` | `ChildSafetyAlertDto[]` |
| `acknowledgeChildAlertStrict` | `POST /api/children/alerts/:id/acknowledge` | `{ notes?: string }` | `{ acknowledged: true; alert: ChildSafetyAlertDto }` |
| `resolveChildAlertStrict` | `POST /api/children/alerts/:id/resolve` | `{ resolutionNotes: string; status?: 'RESOLVED' \| 'FALSE_ALARM' }` | `{ resolved: true; alert: ChildSafetyAlertDto; childStatusRestored?: boolean }` |
| `createEmergencyIncidentStrict` | `POST /api/emergency-incidents` | `{ incidentType, severity, location, description? }` | `EmergencyIncidentDto` (for `SafetyHome.tsx` Phase 7 fix) |

---

## 5. Audit of Existing Callers Depending on Legacy Null-Returning Child/Emergency Methods

Exhaustive grep across all `src/**/*.ts(x)` verified **ONLY 4 callers** of the old null-returning Child Safety / Emergency methods in `apiClient.ts`:

| Current Caller | Line | Legacy Call | Migration Phase |
| :--- | :--- | :--- | :--- |
| `src/services/childSafetyService.ts` | `#L284` | `apiClient.createChild(updated).catch(() => {})` | Replaced in Phase 3/4/6; deleted in Phase 7. |
| `src/services/childSafetyService.ts` | `#L412` | `apiClient.createChildPass(newQR).catch(() => {})` | Replaced in Phase 3/4; deleted in Phase 7. |
| `src/services/childSafetyService.ts` | `#L580` | `apiClient.triggerChildSOS(newAlert).catch(() => {})` | Replaced in Phase 3/4/5; deleted in Phase 7. |
| `src/components/resident/safety/SafetyHome.tsx` | `#L27` | `await apiClient.createEmergencyIncident({ societyId: 'soc-gvs', ... })` | Migrated in Phase 7 to `apiClient.createEmergencyIncidentStrict(...)` with real error handling and post-confirmation UI state. |

*(Zero callers invoke `apiClient.getChildren`, `apiClient.getChildPasses`, `apiClient.verifyChildPass`, or `apiClient.getEmergencyIncidents` anywhere in `src/`.)* Once Phase 7 removes the 3 legacy calls in `childSafetyService.ts`, the old broken null-returning Child Safety stubs (`getChildren`, `createChild`, `getChildPasses`, `createChildPass`, `verifyChildPass`, `triggerChildSOS`) can be cleanly replaced by or aliased to the strict typed implementations.

