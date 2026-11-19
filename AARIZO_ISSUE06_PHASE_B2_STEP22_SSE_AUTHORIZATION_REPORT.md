# AARIZO — ISSUE-06 PHASE B.2.2 SSE AUTHORIZATION & REALTIME AUDIENCE REPORT

**Project:** `D:\AAZIRA\AARIZO`  
**Finding Addressed:** `F-B22-02` (HIGH — Blocking)  
**Date:** 2026-11-18  
**Status:** **`REMEDIATION COMPLETE — READY FOR INDEPENDENT RE-AUDIT`**

---

## 1. Root Causes Identified by Independent Audit

1. **Over-broad SSE `?societyId` override:** `handleSseSubscription` permitted any user with `role === 'admin'` (including society-bound tenant admins) to subscribe to any other society's SSE stream.
2. **Legacy default-tenant fallback:** Missing `societyId` defaulted to `'soc-gvs'` instead of failing closed.
3. **Unfiltered society-wide broadcast of Child Safety events:** `broadcastToSociety()` delivered Child Safety events (`CHILD_PROFILE_*`, `CHILD_PICKUP_*`, `CHILD_GATE_PASS_*`, `CHILD_EXIT_*`, `CHILD_SAFETY_SOS_*`, `EMERGENCY_INCIDENT_CREATED`) to every SSE client in the society, including `vendor`, `facility_manager`, and unrelated `resident` connections.
4. **Unfiltered `Last-Event-ID` replay:** `replayEventsSince()` replayed stored `outbox_events` strictly by `societyId`, bypassing any role or ownership restrictions.

---

## 2. Implemented Authorization Architecture

All realtime authorization enforcement is centralized in [server/src/realtimeEngine.ts](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts):

### 2.1 Fail-Closed SSE Subscription Scope (`handleSseSubscription`)
- **Platform Admin Discrimination (`isVerifiedPlatformAdminContext`):** Returns `true` strictly when `role === 'admin'` AND `authSocietyId` is empty/null or an explicit platform sentinel (`soc-platform`, `all`, `*`).
- **Society-Bound Admin Lockout:** An `admin` with a concrete `authContext.societyId` (e.g., `soc-a`) requesting `?societyId=soc-b` is rejected with `403 TENANT_ISOLATION_VIOLATION` before client registration.
- **Zero Default Tenant Fallback:** Any non-platform-admin user missing a concrete `societyId` is rejected with `403 TENANT_CONTEXT_REQUIRED` (`'soc-gvs'` fallback removed).
- **Platform Admin Monitoring Preserved:** Verified platform admins (`role: 'admin', societyId: 'soc-platform'` or `null`) retain audited ability to pass `?societyId=<target>` (preserving `GAP-03` test compatibility).

### 2.2 Centralized Event Audience Policy (`EventAudiencePolicy` & `isClientAuthorizedForEvent`)
Every sensitive domain event carries an explicit `EventAudiencePolicy`:
```ts
export interface EventAudiencePolicy {
  allowedRoles?: string[];
  targetUserIds?: string[];
}
```
Authorization rules enforced identically across **live broadcast** (`broadcastToSociety`), **background outbox worker** (`startOutboxWorker`), and **`Last-Event-ID` replay** (`replayEventsSince`):
1. **Tenant boundary:** `client.societyId === eventSocietyId` (unless `eventSocietyId === '*'`).
2. **Deny-by-default for Child Safety events:** Any event with `CHILD_SAFETY_EVENT_PREFIXES` (`CHILD_`) or `EMERGENCY_INCIDENT_` without an explicit `_audience` policy is restricted to `['guard', 'secretary', 'committee', 'admin']` (never delivered to `vendor`, `facility_manager`, or arbitrary `resident`).
3. **Explicit Audience Matching:** A client receives the event if and only if:
   - `client.role` is in `effectiveAudience.allowedRoles` (case-insensitive), **OR**
   - `client.userId` is in `effectiveAudience.targetUserIds` (exact owning guardian/resident/reporter match).
4. **Wire Metadata Sanitization (`sendToClient`):** Internal `_audience` metadata persisted inside `outbox_events.payload` for replay/worker enforcement is stripped via destructuring (`const { _audience: _strippedAudience, ...publicData } = data || {}`) before `JSON.stringify` so internal recipient lists are never exposed over the wire.

---

## 3. Complete Child Safety Realtime Event Audience Matrix

All 13 `emitChildSafetyEvent(...)` emissions in [server/src/childSafety/router.ts](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts) enforce strict post-commit emission and least-privilege audiences:

| Event Type | Trigger Endpoint | Allowed Roles (`allowedRoles`) | Allowed Target Users (`targetUserIds`) | Excluded Roles / Users |
| --- | --- | --- | --- | --- |
| `CHILD_PROFILE_CREATED` | `POST /api/children` | `secretary`, `committee`, `admin` | Child `guardianUserId` / creating resident | `vendor`, `facility_manager`, `guard`, other residents, other societies |
| `CHILD_PROFILE_UPDATED` | `PATCH /api/children/:id` | `secretary`, `committee`, `admin` | Child `guardianUserId` / acting resident | `vendor`, `facility_manager`, `guard`, other residents, other societies |
| `CHILD_PROFILE_ARCHIVED` | `POST /:id/archive`, `DELETE /:id` | `secretary`, `committee`, `admin` | Child `guardianUserId` / acting resident | `vendor`, `facility_manager`, `guard`, other residents, other societies |
| `CHILD_PICKUP_AUTHORIZED` | `POST /:childId/pickups` | `secretary`, `committee`, `admin` | Child `guardianUserId` / acting resident | `vendor`, `facility_manager`, `guard`, other residents, other societies |
| `CHILD_PICKUP_UPDATED` | `PATCH /:childId/pickups/:pickupId` | `secretary`, `committee`, `admin` | Child `guardianUserId` / acting resident | `vendor`, `facility_manager`, `guard`, other residents, other societies |
| `CHILD_PICKUP_REVOKED` | `POST /:childId/pickups/:pickupId/revoke`, `DELETE` | `secretary`, `committee`, `admin` | Child `guardianUserId` / acting resident | `vendor`, `facility_manager`, `guard`, other residents, other societies |
| `CHILD_GATE_PASS_ISSUED` | `POST /api/children/passes` | `guard`, `secretary`, `committee`, `admin` | Child `guardianUserId` / issuing resident | `vendor`, `facility_manager`, other residents, other societies |
| `CHILD_GATE_PASS_REVOKED` | `POST /passes/:id/revoke`, `DELETE /passes/:id` | `guard`, `secretary`, `committee`, `admin` | Child `guardianUserId` / revoking resident | `vendor`, `facility_manager`, other residents, other societies |
| `CHILD_EXIT_AUTHORIZED` | `POST /passes/verify` (allowed) | `guard`, `secretary`, `committee`, `admin` | Child `guardianUserId` | `vendor`, `facility_manager`, other residents, other societies |
| `CHILD_EXIT_DENIED` | `POST /passes/verify` (denied/blocked) | `guard`, `secretary`, `committee`, `admin` | Child `guardianUserId` | `vendor`, `facility_manager`, other residents, other societies |
| `CHILD_SAFETY_SOS_TRIGGERED` | `POST /api/children/sos` | `guard`, `secretary`, `committee`, `admin` | Child `guardianUserId` / reporting resident | `vendor`, `facility_manager`, other residents, other societies |
| `EMERGENCY_INCIDENT_CREATED` | `POST /api/children/sos` | `guard`, `secretary`, `committee`, `admin` | Child `guardianUserId` / reporting resident | `vendor`, `facility_manager`, other residents, other societies |
| `CHILD_SAFETY_ALERT_ACKNOWLEDGED` / `RESOLVED` | `POST /alerts/:id/acknowledge`, `/resolve` | `guard`, `secretary`, `committee`, `admin` | Child `guardianUserId` / `alert.reportedById` | `vendor`, `facility_manager`, other residents, other societies |

---

## 4. Verification Evidence

- [tests/issue02_gap03_sse_authorization.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue02_gap03_sse_authorization.test.ts): **8/8 PASS** (confirms zero regressions to existing SSE identity/tenant protections and platform admin monitoring).
- [tests/issue06_child_safety_remediation.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_remediation.test.ts): **3/3 dedicated SSE tests PASS**:
  1. Society-bound admin (`soc-a`) requesting `?societyId=soc-b` -> `403 TENANT_ISOLATION_VIOLATION`; missing `societyId` -> `403 TENANT_CONTEXT_REQUIRED`; verified platform admin -> `200`.
  2. Live multi-client broadcast across 8 connected SSE clients (`vendorA`, `fmA`, `ownerResA1`, `otherResA2`, `guardA`, `secA`, `adminA`, `adminB`) verifies `CHILD_PROFILE_CREATED` reaches strictly `['adminA', 'ownerResA1', 'secA']`, `CHILD_SAFETY_SOS_TRIGGERED` reaches strictly `['adminA', 'guardA', 'ownerResA1', 'secA']`, and `_audience` is never present in wire payloads.
  3. `Last-Event-ID` replay (`replayEventsSince`) blocks `vendor` from replaying `CHILD_SAFETY_SOS_TRIGGERED`, delivers to owning resident `usr-res-a1`, and strips `_audience` from wire frames.

