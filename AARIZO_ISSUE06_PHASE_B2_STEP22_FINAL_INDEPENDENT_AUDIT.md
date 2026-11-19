# AARIZO — ISSUE-06 PHASE B.2.2 FINAL INDEPENDENT RE-AUDIT

**Project:** `D:\AAZIRA\AARIZO`  
**Audit Mode:** STRICT READ-ONLY INDEPENDENT SECURITY RE-AUDIT  
**Date:** 2026-11-18  
**Final Verdict:** **`FAIL — TARGETED REMEDIATION STILL REQUIRED`**

---

## 1. Executive Audit Verdict

While the Phase B.2.2 targeted remediation genuinely resolved four of the seven original findings (**`F-B22-03`**, **`F-B22-04`**, **`F-B22-05`**, and **`F-B22-06`**) and passed all existing offline and live isolated PostgreSQL 16 test suites (`83/83` focused, `9/9` live PG 16, `348/348` full offline), **independent adversarial code inspection and live HTTP + PostgreSQL 16 reproduction proved that two of the four original blocking findings (`F-B22-01` and `F-B22-02`) still have exploitable residual bypasses.**

Phase B.2.2 **cannot** be conditionally closed until these specific, narrowly scoped residual bypasses are closed and re-verified.

---

## 2. Independent Verification of Original Findings (`F-B22-01` – `F-B22-07`)

### 2.1 `F-B22-01` — Generic `EntityRecord` Child Safety Backdoor
- **Original Finding:** Generic `/api/collections/:collection` and `POST /api/entityRecord/query` endpoints allowed arbitrary roles to read/write/delete legacy Child Safety `EntityRecord` rows and defaulted missing `societyId` to `'soc-gvs'`.
- **Current Status:** **`FAIL`** *(Blocks B.2.2 Closure)*
- **Exact Source References:**
  - Partially fixed: [server/src/index.ts#L3846-L3945](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L3846-L3945), [index.ts#L4151-L4195](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L4151-L4195)
  - **Residual Bypass 1 (`GET /api/collections/entityRecord` & `entityRecords`):** [server/src/index.ts#L3843](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L3843), [index.ts#L3956-L3976](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L3956-L3976)
  - **Residual Bypass 2 (`GET /api/collections/entityRecord/:id`):** [server/src/index.ts#L4003-L4010](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L4003-L4010)
  - **Residual Bypass 3 (`GET /api/collections/emergencyIncident` — unauthenticated role dispatch on `ALLOWED_QUERY_TABLES`):** [server/src/index.ts#L3825](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L3825), [index.ts#L3956-L3976](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L3956-L3976)
  - **Residual Bypass 4 (`PATCH /api/housekeeping/tasks/:id` & `POST /api/amenities/bookings/:id/cancel` unscoped `entityRecord.findUnique`):** [server/src/index.ts#L2887-L2902](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2887-L2902), [index.ts#L1974-L2000](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L1974-L2000)
- **Independent Evidence & Classification:**
  - *Independently verified by code inspection:* Direct `/api/collections/child_profiles`, `/children`, `/child_gate_passes`, mixed-case/encoded variants (`ChIlD_PrOfIlEs`, `child%5Fprofiles`, `child%255Fprofiles`, `child-gate-passes`), and `POST /api/entityRecord/query` ARE properly blocked/filtered, and unrelated collections (`announcements`) continue to work.
  - *Independently reproduced against live PostgreSQL:* Against isolated PostgreSQL 16 (`127.0.0.1:5443`) with a seeded `entity_records` row (`id = 'probe-child-legacy-1', collection = 'child_profiles', society_id = 'soc-a'`):
    1. **`GET /api/collections/entityRecord`** as `vendor` (`soc-a`) returned **HTTP 200** with `probe-child-legacy-1` (`collection: 'child_profiles'`) in the JSON array (`probe1a_leakedChildList: true`), because `nativeKey` matched `entityRecord` in `ALLOWED_QUERY_TABLES` and bypassed `isBlockedChildSafetyCollection` completely.
    2. **`GET /api/collections/entityRecord/probe-child-legacy-1`** as `vendor` (`soc-a`) returned **HTTP 200** with the full legacy child record (`probe1b_leakedChildById: true`).
    3. **`GET /api/collections/emergencyIncident`** as `vendor` (`soc-a`) returned **HTTP 200** leaking real PostgreSQL `CHILD_SAFETY` SOS `EmergencyIncident` rows (`probe1c_leakedSosIncident: true`), because `GET /api/collections/:collection` dispatches to `ALLOWED_QUERY_TABLES` Prisma delegates **without checking `ALLOWED_QUERY_TABLES[nativeKey]` roles**!
    4. **`PATCH /api/housekeeping/tasks/probe-child-legacy-1`** as `facility_manager` (`soc-a`) returned **HTTP 200** and mutated the `child_profiles` `EntityRecord` row in PostgreSQL (`probe1d_mutatedChildByFm: true`), because `findUnique({ where: { id } })` checks neither `record.collection === 'housekeeping_tasks'` nor `record.societyId`. (`POST /api/amenities/bookings/:id/cancel` at lines 1974–2000 has the identical unscoped `entityRecord.findUnique` flaw.)
- **Security Impact:** **HIGH / CRITICAL** — Any authenticated `vendor` can read every legacy Child Safety `EntityRecord` and every live `CHILD_SAFETY` SOS `EmergencyIncident` in their society; a `facility_manager` or `resident` can mutate legacy Child Safety `EntityRecord` rows by ID.
- **Blocks B.2.2 Closure:** **YES.**

---

### 2.2 `F-B22-02` — SSE Cross-Society Subscription & Unauthorized Event Broadcasts
- **Original Finding:** Any `admin` (including society-bound) could override `?societyId`, missing `societyId` fell back to `'soc-gvs'`, and Child Safety SSE events broadcast to all connected clients in the society (including `vendor`, `facility_manager`, and non-owner residents) across both live and replay paths.
- **Current Status:** **`FAIL`** *(Blocks B.2.2 Closure)*
- **Exact Source References:**
  - Fixed portion: [server/src/realtimeEngine.ts#L33-L38](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L33-L38), [realtimeEngine.ts#L259-L277](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L259-L277), [realtimeEngine.ts#L443-L487](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L443-L487)
  - **Residual Defect 1 (`POST /api/realtime/broadcast` unprivileged cross-society & `_audience` forgery):** [server/src/index.ts#L212-L231](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L212-L231)
  - **Residual Defect 2 (`isClientAuthorizedForEvent` fail-open on `EMERGENCY_INCIDENT_CREATED` without `_audience` & malformed/empty `_audience: {}`):** [server/src/realtimeEngine.ts#L55-L84](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L55-L84)
  - **Residual Defect 3 (`replayEventsSince` unscoped cross-tenant `Last-Event-ID` cursor lookup):** [server/src/realtimeEngine.ts#L284-L297](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L284-L297)
- **Independent Evidence & Classification:**
  - *Independently verified by code inspection & HTTP test:* `handleSseSubscription` properly blocks society-bound admin `?societyId` override (`403`), removes `'soc-gvs'` fallback (`403 TENANT_CONTEXT_REQUIRED`), and preserves verified platform-admin monitoring. Live & replay delivery for `CHILD_*` events carrying valid `_audience` enforces role/owner filtering and strips `_audience` from wire JSON.
  - *Independently reproduced against live PostgreSQL:*
    1. A `vendor` authenticated in `soc-a` called **`POST /api/realtime/broadcast`** with `{ societyId: 'soc-b', eventType: 'CHILD_SAFETY_SOS_TRIGGERED', payload: { alertId: 'forged-sos-1', _audience: { allowedRoles: ['vendor', 'resident'] } } }`. The server returned **HTTP 200** and persisted an authoritative `outbox_events` row in PostgreSQL with `societyId = 'soc-b'`, `eventType = 'CHILD_SAFETY_SOS_TRIGGERED'`, and the attacker-forged `_audience` (`probe2a_post_broadcast_status: 200`). Furthermore, line 217 still falls back to `'soc-gvs'`.
    2. Direct invocation of `isClientAuthorizedForEvent` confirmed:
       - `EMERGENCY_INCIDENT_CREATED` without `_audience` returned **`true`** for `vendor` (`probe2b_vendorEmergencyNoAudience: true`) — directly contradicting the inaccurate claim in `AARIZO_ISSUE06_PHASE_B2_STEP22_SSE_AUTHORIZATION_REPORT.md` §2.2 that `EMERGENCY_INCIDENT_` defaults closed.
       - `EMERGENCY_INCIDENT_CREATED` with malformed empty `_audience: {}` returned **`true`** for `delivery` (`probe2b_deliveryEmptyAudience: true`) because line 83 defaults to `return true` whenever `allowedRoles` is absent/empty on non-`CHILD_` events.
    3. `replayEventsSince` queries `prisma.outboxEvent.findUnique({ where: { eventId: lastEventId } })` without constraining `societyId: client.societyId` (minor cross-tenant cursor timestamp oracle; `missedEvents` itself is safely filtered by `client.societyId`).
- **Security Impact:** **HIGH** — Any authenticated low-privilege user (`vendor`, cross-society `resident`) can inject spoofed `CHILD_SAFETY_SOS_TRIGGERED` / `EMERGENCY_INCIDENT_CREATED` events into *any* society's outbox/SSE stream and forge `_audience` metadata; missing/malformed `_audience` on `EMERGENCY_INCIDENT_CREATED` fails open.
- **Blocks B.2.2 Closure:** **YES.**

---

### 2.3 `F-B22-03` — Database-Authoritative Society Identity & Guard Pass Retrieval
- **Original Finding:** `authenticateToken` fell back to stale JWT `claimsSocietyId` when DB `user.societyId` became `null`, and `GET /api/children/passes/:id` lacked the active-pass filter for guards.
- **Current Status:** **`PASS`** *(Does NOT block closure)*
- **Exact Source References:** [server/src/auth.ts#L269-L309](file:///D:/AAZIRA/AARIZO/server/src/auth.ts#L269-L309), [server/src/childSafety/router.ts#L148-L202](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L148-L202), [router.ts#L882-L926](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L882-L926)
- **Independent Evidence & Classification:**
  - *Independently verified by code inspection:* Both HMAC and Firebase paths resolve strictly from PostgreSQL `prisma.user.findFirst`, reject missing (`401`) and inactive (`403`) users, ignore `claimsRole`/`claimsSocietyId` (dead local vars), and only assign `'soc-platform'` when DB `user.role.toLowerCase() === 'admin'` and `user.societyId` is null. `GET /api/children/passes/:id` matches `GET /api/children/passes` (`status: 'ACTIVE', archivedAt: null, validUntil: { gt: new Date() }` for `guard`).
  - *Independently reproduced through an HTTP test:* `issue06_child_safety_remediation.test.ts` (3/3 tests PASS).
  - *Independently reproduced against live PostgreSQL:* `issue06_child_safety_api_pg_integration.test.ts` Test 6 proves `UPDATE users SET society_id = NULL` immediately invalidates a still-valid JWT (`403 TENANT_CONTEXT_REQUIRED`).
- **Remaining Risk (Non-blocking):** Non-Child-Safety legacy middleware `requireSocietyMembership` (`server/src/auth.ts#L368`) still permits any `userRole === 'admin'`; Child Safety uses `resolveChildSafetyActor` (`server/src/childSafety/authz.ts#L53-L77`), which properly restricts society-bound admins.

---

### 2.4 `F-B22-04` — Rate-Limiter Safety & Pass-Creation Throttling
- **Original Finding:** Unbounded in-memory `Map` without eviction, no capacity bound, and missing limiter on `POST /api/children/passes`.
- **Current Status:** **`PASS`** *(Does NOT block closure)*
- **Exact Source References:** [server/src/childSafety/rateLimit.ts#L1-L175](file:///D:/AAZIRA/AARIZO/server/src/childSafety/rateLimit.ts#L1-L175), [server/src/childSafety/router.ts#L209](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L209), [router.ts#L874](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L874), [router.ts#L934](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L934), [router.ts#L1095](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L1095)
- **Independent Evidence & Classification:**
  - *Independently verified by code inspection:* Strict `DEFAULT_MAX_BUCKETS = 5_000`, periodic expired-bucket sweeps (`SWEEP_INTERVAL_WRITES = 100`), fail-closed `429 RATE_LIMIT_CAPACITY_EXCEEDED` + `Retry-After` on capacity exhaustion, zero background timers, primary identity key from verified `req.authContext.userId` (immune to `X-Forwarded-For` spoofing), and mounted on `POST /passes` (`20/10m`), `POST /passes/verify` & `/:id/verify` (`30/1m`), and `POST /sos` (`10/5m`).
  - *Independently reproduced through an HTTP test:* `issue06_child_safety_remediation.test.ts` (3/3 tests PASS) + `issue06_child_safety_api_routes.test.ts` SOS rate-limit test PASS.
- **Remaining Risk (Non-blocking):** Process-local in-memory store (documented single-instance boundary; requires Redis for multi-replica deployments) and fixed-window counter semantics per key rather than timestamp-array sliding window.

---

### 2.5 `F-B22-05` — SOS vs Gate-Verification Concurrency Race
- **Original Finding:** Concurrent `POST /sos` (`MISSING_CHILD`) and `POST /passes/verify` could race on `child_profiles`, allowing stale reads or overwriting `MISSING` back to `OUT_OF_SOCIETY`.
- **Current Status:** **`PASS`** *(Does NOT block closure)*
- **Exact Source References:** [server/src/childSafety/router.ts#L75-L96](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L75-L96), [router.ts#L518-L570](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L518-L570), [router.ts#L733-L747](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L733-L747), [router.ts#L1199-L1264](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L1199-L1264), [router.ts#L1518-L1579](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L1518-L1579)
- **Independent Evidence & Classification:**
  - *Independently verified by code inspection:* `lockChildProfileRow()` executes `SELECT status::text AS status, archived_at FROM child_profiles WHERE id = $1 AND society_id = $2 FOR UPDATE` consistently first in `verify`, `sos`, and `resolve` transactions, preventing lock-order deadlocks and asserting `childUpdated.count === 1` (`409 CHILD_STATE_CONFLICT`).
  - *Independently reproduced against live PostgreSQL:* `issue06_child_safety_api_pg_integration.test.ts` Test 1 (concurrent double-verify `[200, 409]`), Test 3 (concurrent `SOS` vs `verify`, preserving `MISSING`), and Test 5 (PostgreSQL trigger-induced rollback leaving `0` orphaned `emergency_incidents`) all **PASSED** on isolated PostgreSQL 16 (`127.0.0.1:5443`).
- **Remaining Risk (Non-blocking):** `pass.pickupPerson` and `pass.child.exitPermissionMode` are loaded before `lockChildProfileRow` in `verify` (concurrent pickup revocation/child archive still fails safely via `childGatePass.updateMany({ where: { status: 'ACTIVE' } })`), and concurrent `SOS vs Alert Resolve` has code-level lock serialization but no dedicated live test yet.

---

### 2.6 `F-B22-06` — Duplicate SOS, Contact-List Validation, and Pickup Lifecycle
- **Original Finding:** Duplicate active `MISSING_CHILD` SOS alerts allowed; `secondaryGuardians`/`emergencyContacts` unvalidated; `REVOKED`/`EXPIRED` pickups silently reactivatable via `PATCH`.
- **Current Status:** **`PASS`** *(Does NOT block closure; minor DB defense-in-depth note)*
- **Exact Source References:** [server/src/childSafety/validation.ts#L78-L142](file:///D:/AAZIRA/AARIZO/server/src/childSafety/validation.ts#L78-L142), [server/src/childSafety/router.ts#L1200-L1279](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L1200-L1279), [router.ts#L1737-L1755](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L1737-L1755), [router.ts#L2024-L2044](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L2024-L2044), [router.ts#L2325-L2426](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L2325-L2426)
- **Independent Evidence & Classification:**
  - *Independently verified by code inspection & HTTP test:* Strict `validateContactList()` enforced on both `POST /` and `PATCH /:id`; `REVOKED` pickup reactivation/mutation blocked (`422`), `EXPIRED` renewal requires explicit server-checked future `validUntil` (`422`), immutable pickup fields blocked (`400`), and pickup validity rechecked at gate verification (`router.ts#L658-L680`).
  - *Independently reproduced against live PostgreSQL:* `issue06_child_safety_api_pg_integration.test.ts` Test 4 confirms concurrent duplicate `MISSING_CHILD` SOS returns `[201, 409]` with exactly 1 active alert and permits recreation after resolution.
- **Remaining Risk (Non-blocking):** Uniqueness of active `MISSING_CHILD` alerts is currently enforced via application-layer `FOR UPDATE` locking rather than a PostgreSQL partial unique index on `child_safety_alerts`.

---

### 2.7 `F-B22-07` — Test Quality & Regression Coverage
- **Original Finding:** Missing regression tests for rollback, rate limits, mismatched verify IDs, and remediation edge cases.
- **Current Status:** **`PARTIAL`** *(Non-blocking independently, but new regression tests MUST be added alongside the `F-B22-01` and `F-B22-02` fixes)*
- **Exact Source References:** [tests/issue06_child_safety_remediation.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_remediation.test.ts), [tests/issue06_child_safety_api_pg_integration.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_api_pg_integration.test.ts)
- **Independent Evidence & Classification:**
  - *Independently reproduced through HTTP & live PostgreSQL tests:* All reported test counts were independently reproduced cleanly (`83/83` focused, `9/9` live PG 16, `348/348` full offline). Zero assertions were weakened; test isolation from `nexus-postgres` is verified.
  - *Gaps identified:* Missing tests for the exact residual bypasses reproduced in this audit (`GET /api/collections/entityRecord(/:id)`, `GET /api/collections/emergencyIncident`, `PATCH /api/housekeeping/tasks/:id`, `POST /api/amenities/bookings/:id/cancel`, `POST /api/realtime/broadcast` forgery, `isClientAuthorizedForEvent` on `EMERGENCY_INCIDENT_CREATED` / `{}` / `delivery` role, and live concurrent `SOS vs Alert Resolve`).

---

## 3. New & Residual Findings Summary

| Finding ID | Origin | Severity | Blocks Closure? | Summary |
| --- | --- | --- | --- | --- |
| **`F-B22-01A`** | Residual `F-B22-01` | **CRITICAL** | **YES** | `GET /api/collections/entityRecord` & `/entityRecord/:id` match `ALLOWED_QUERY_TABLES` native dispatch and dump legacy `child_profiles` / `child_gate_passes` `EntityRecord` rows to any role (incl. `vendor`). |
| **`F-B22-01B`** | Residual `F-B22-01` | **HIGH** | **YES** | `GET /api/collections/:collection` dispatches to any `ALLOWED_QUERY_TABLES` Prisma model **without checking role permissions**, allowing `vendor` to read `emergencyIncident` (including `CHILD_SAFETY` SOS incidents). |
| **`F-B22-01C`** | Residual `F-B22-01` | **HIGH** | **YES** | `PATCH /api/housekeeping/tasks/:id` and `POST /api/amenities/bookings/:id/cancel` mutate `prisma.entityRecord.findUnique({ where: { id } })` without verifying `collection` or `societyId`, allowing mutation of legacy Child Safety `EntityRecord` rows by ID. |
| **`F-B22-02A`** | Residual `F-B22-02` | **HIGH** | **YES** | `POST /api/realtime/broadcast` allows any authenticated user (e.g., `vendor`) to broadcast any `eventType` (including `CHILD_SAFETY_SOS_TRIGGERED`) to any `societyId` (including `'soc-gvs'` fallback) and forge `payload._audience`. |
| **`F-B22-02B`** | Residual `F-B22-02` | **HIGH** | **YES** | `isClientAuthorizedForEvent` fails OPEN on `EMERGENCY_INCIDENT_CREATED` without `_audience` (contradicting remediation report) and on malformed/empty `_audience: {}` for non-`CHILD_` events. |
| **`F-B22-02C`** | Residual `F-B22-02` | **LOW** | No (Recommended) | `replayEventsSince` looks up `Last-Event-ID` globally without `societyId` filter (timestamp cursor oracle; does not leak cross-tenant event rows). |

---

## 4. Preservation of Phase B.2.1 Pre-Cutover Risks

None of the six outstanding Phase B.2.1 pre-cutover risks were altered by B.2.2; all six remain open pre-cutover requirements:
1. Legacy backfill primary-key collision quarantine.
2. Malformed embedded `authorizedPickups[]` quarantine.
3. Explicit cross-society `residentId` fallback handling in legacy backfill.
4. `UPDATE` actor-trigger test coverage.
5. Remaining database `CHECK` constraint assertions.
6. CI wiring for `AARIZO_ISOLATED_TEST_DATABASE_URL`.

