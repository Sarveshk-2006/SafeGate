# AARIZO — ISSUE-06 PHASE B.2.2 FINAL SSE & REALTIME AUTHORIZATION AUDIT

**Project:** `D:\AAZIRA\AARIZO`  
**Finding Re-Audited:** `F-B22-02`  
**Date:** 2026-11-18  
**Status:** **`FAIL`** *(Closure-Blocking Defects `F-B22-02A` & `F-B22-02B` Independently Reproduced)*

---

## 1. End-to-End Realtime Architecture Inspection

Inspected:
- Subscription route: `app.get('/api/realtime/stream', handleSseSubscription)` ([server/src/index.ts#L209](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L209)) — protected by global `/api` `authenticateToken`.
- Broadcast route: `app.post('/api/realtime/broadcast', ...)` ([server/src/index.ts#L212-L231](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L212-L231)) — **NO role check, NO society isolation, NO `_audience` sanitization!**
- Engine & filtering: [server/src/realtimeEngine.ts#L1-L487](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L1-L487).
- Child Safety event producers: 13 `emitChildSafetyEvent()` calls in [server/src/childSafety/router.ts](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts).

---

## 2. Subscription Isolation Verification (`handleSseSubscription`)

| Check | Result | Verification Classification | Source Anchor |
| --- | --- | --- | --- |
| 1. Society-bound `admin` blocked from `?societyId=<other>` (`403 TENANT_ISOLATION_VIOLATION`) | **PASS** | Independently verified by code inspection; Independently reproduced through an HTTP test | [realtimeEngine.ts#L33-L38](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L33-L38), [#L458-L476](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L458-L476) |
| 2. Resident / Guard / Secretary blocked from `?societyId=<other>` (`403`) | **PASS** | Independently reproduced through an HTTP test (`issue02_gap03_sse_authorization.test.ts`) | [realtimeEngine.ts#L470-L476](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L470-L476) |
| 3. Missing `societyId` fails closed (`403 TENANT_CONTEXT_REQUIRED`), zero `'soc-gvs'` fallback | **PASS** | Independently verified by code inspection; Independently reproduced through an HTTP test | [realtimeEngine.ts#L461-L467](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L461-L467) |
| 4. Query `?role=admin` and `?userId=...` ignored; authenticated `req.authContext` enforced | **PASS** | Independently reproduced through an HTTP test (`issue02_gap03_sse_authorization.test.ts`) | [realtimeEngine.ts#L453-L455](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L453-L455) |
| 5. Verified platform admin (`role === 'admin'` + DB `societyId` null/sentinel) allowed explicit `?societyId` | **PASS** | Independently verified by code inspection; Independently reproduced through an HTTP test | [realtimeEngine.ts#L33-L38](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L33-L38), [#L479-L481](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L479-L481) |
| 6. Reconnect re-runs full `authenticateToken` + `handleSseSubscription` | **PASS** | Independently verified by code inspection | [server/src/index.ts#L130-L135](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L130-L135), [#L209](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L209) |
| 7. Client disconnect cleans up `this.clients` map | **PASS** | Independently reproduced through an HTTP test (`issue02_gap03_sse_authorization.test.ts` Test 8) | [realtimeEngine.ts#L153-L155](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L153-L155) |

---

## 3. Event Audience Policy Matrix (`isClientAuthorizedForEvent`)

| Client Context | Event Type & Audience | Actual Code Behavior | Expected | Status |
| --- | --- | --- | --- | --- |
| Child's resident/guardian (`usr-res-a1`, `soc-a`) | `CHILD_PROFILE_CREATED` / `CHILD_SAFETY_SOS_TRIGGERED` (`targetUserIds: ['usr-res-a1']`) | **Allowed** | Allowed | **PASS** |
| Unrelated resident (`usr-res-a2`, `soc-a`) | `CHILD_PROFILE_CREATED` / `CHILD_SAFETY_SOS_TRIGGERED` (`targetUserIds: ['usr-res-a1']`) | **Denied** | Denied | **PASS** |
| Society guard (`soc-a`) | `CHILD_GATE_PASS_GENERATED` / `CHILD_SAFETY_SOS_TRIGGERED` | **Allowed** | Allowed | **PASS** |
| Society guard (`soc-a`) | `CHILD_PROFILE_CREATED` (`allowedRoles: ['secretary','committee','admin']`) | **Denied** | Denied | **PASS** |
| Society admin (`soc-a`) | Any `soc-a` Child Safety event | **Allowed** | Allowed | **PASS** |
| Vendor (`soc-a`) | `CHILD_*` event (with or without `_audience`) | **Denied** | Denied | **PASS** |
| Facility manager (`soc-a`) | `CHILD_*` event (with or without `_audience`) | **Denied** | Denied | **PASS** |
| Delivery role (`soc-a`) | `CHILD_*` event (with or without `_audience`) | **Denied** (`probe2b_deliveryChildNoAudience: false`) | Denied | **PASS** |
| Other society's guard/admin (`soc-b`) | Any `soc-a` event | **Denied** (`client.societyId !== eventSocietyId`) | Denied | **PASS** |
| **Vendor (`soc-a`)** | **`EMERGENCY_INCIDENT_CREATED` (missing `_audience`)** | **`ALLOWED` (`probe2b_vendorEmergencyNoAudience: true`)** | **Denied** | **`FAIL` (`F-B22-02B`)** |
| **Delivery role (`soc-a`)** | **`EMERGENCY_INCIDENT_CREATED` (malformed `_audience: {}`)** | **`ALLOWED` (`probe2b_deliveryEmptyAudience: true`)** | **Denied** | **`FAIL` (`F-B22-02B`)** |

---

## 4. Blocking Defects Independently Reproduced

### 4.1 `F-B22-02A` — `POST /api/realtime/broadcast` Cross-Society Event & `_audience` Forgery (HIGH — Blocking)
- **Source:** [server/src/index.ts#L212-L231](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L212-L231)
- **Classification:** *Independently verified by code inspection; Independently reproduced against live PostgreSQL.*
- **Reproduction:** Authenticated as `vendor` (`usr-vnd-probe`, `soc-a`), submitted `POST /api/realtime/broadcast` with:
  ```json
  {
    "societyId": "soc-b",
    "eventType": "CHILD_SAFETY_SOS_TRIGGERED",
    "payload": { "alertId": "forged-sos-1", "_audience": { "allowedRoles": ["vendor", "resident"] } }
  }
  ```
- **Observed Result:** HTTP `200`; `outbox_events` row persisted in PostgreSQL with `societyId = 'soc-b'`, `eventType = 'CHILD_SAFETY_SOS_TRIGGERED'`, and attacker-controlled `payload._audience = { allowedRoles: ["vendor", "resident"] }`. Additionally, line 217 retains `|| 'soc-gvs'` fallback.
- **Required Fix:** Restrict `POST /api/realtime/broadcast` strictly to authorized roles (e.g., `admin`/`secretary` within their own society; verified platform admin for cross-society), reject `CHILD_*` and `EMERGENCY_INCIDENT_*` event types from client-originated broadcasts, strip any client-supplied `_audience` property from `req.body.payload`, and remove the `'soc-gvs'` fallback.

### 4.2 `F-B22-02B` — `isClientAuthorizedForEvent` Fail-Open & Report Discrepancy (HIGH — Blocking)
- **Source:** [server/src/realtimeEngine.ts#L55-L84](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L55-L84)
- **Classification:** *Independently verified by code inspection; Independently reproduced through an HTTP/runtime test.*
- **Defect:**
  1. Line 57 checks only `eventType.startsWith('CHILD_')` — omitting `EMERGENCY_INCIDENT_` (despite `AARIZO_ISSUE06_PHASE_B2_STEP22_SSE_AUTHORIZATION_REPORT.md` §2.2 asserting otherwise). Missing `_audience` on `EMERGENCY_INCIDENT_CREATED` returns `true` for `vendor`, `delivery`, `facility_manager`, and all residents.
  2. When `audience` is present as a malformed/empty object `{}` (or contains only `targetUserIds` without `allowedRoles`) on a non-`CHILD_` event, lines 74–83 fall through to `return true` (fail-open).
- **Required Fix:** Treat both `CHILD_` and `EMERGENCY_INCIDENT_` (plus any event with an explicit `audience` object) as fail-closed: if `audience` is provided (even `{}`), return `true` **only** if `clientRole` matches `audience.allowedRoles` OR `client.userId` matches `audience.targetUserIds`, otherwise `return false`.

### 4.3 `F-B22-02C` — `replayEventsSince` Unscoped `Last-Event-ID` Lookup (LOW — Recommended Hardening)
- **Source:** [server/src/realtimeEngine.ts#L284-L297](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L284-L297)
- **Classification:** *Independently verified by code inspection.*
- **Detail:** `prisma.outboxEvent.findUnique({ where: { eventId: lastEventId } })` does not scope by `societyId: client.societyId`. While `missedEvents` IS filtered by `societyId: client.societyId` (preventing foreign event disclosure), change to `findFirst({ where: { eventId: lastEventId, societyId: client.societyId } })` to eliminate the cross-tenant cursor timestamp oracle.

---

## 5. Payload & Rollback Safety Verification

- *Independently verified by code inspection:* All 13 `emitChildSafetyEvent()` payloads in `server/src/childSafety/router.ts` contain only minimal operational IDs/status fields — zero raw bearer tokens, zero `tokenHash`, zero `idDocumentHash`, zero government IDs, zero unnecessary guardian contact details.
- *Independently verified by code inspection & live PostgreSQL test:* `sendToClient` strips `_audience` before `JSON.stringify`; failed/rolled-back SOS and verify transactions never reach `emitChildSafetyEvent()`.

