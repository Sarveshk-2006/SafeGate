# AARIZO — ISSUE-06 / Phase B.2.2 Detailed Security Findings

**Project:** `D:\AAZIRA\AARIZO`  
**Phase:** ISSUE-06 — B.2.2 Secure Child Safety Backend APIs  
**Mode:** STRICT READ-ONLY INDEPENDENT AUDIT  
**Audit Date:** November 18, 2026  

---

## F-B22-01 — Parallel Unprotected Generic Collection Routes Allow Arbitrary Child Safety `EntityRecord` Manipulation

- **Severity:** **HIGH**
- **Blocks B.2.2 Closure:** **YES**
- **File & Line References:**
  - [server/src/index.ts#L3843](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L3843) (`ALLOWED_QUERY_TABLES.entityRecord` allows `vendor`, `facility_manager`, all roles)
  - [server/src/index.ts#L3847-L3970](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L3847-L3970) (`GET/POST/PUT/DELETE /api/collections/:collection`)
- **Technical Explanation:** While the legacy `/api/children*` `EntityRecord` routes were removed, generic `/api/collections/:collection` endpoints remain active with zero role enforcement, `'soc-gvs'` default fallback, and ID-only `GET`/`PUT`/`DELETE` lookups lacking tenant checks. Any authenticated user can read, create, overwrite, or delete `EntityRecord` documents in `child_profiles`, `children`, `child_gate_passes`, or `child_safety`.
- **Reproduction Scenario:**
  1. Authenticate as `vendor` in `soc-a`.
  2. Call `POST /api/collections/child_profiles` with `{ societyId: "soc-b", fullName: "Injected" }` → returns `201`, writes into `entity_records`, and broadcasts `CHILD_PROFILES_CREATED` to `soc-b`.
  3. Call `DELETE /api/collections/child_profiles/<any-legacy-id>` → deletes the record across societies without tenant check.
- **Security / Operational Impact:** Leaves a parallel, completely unguarded Child Safety `EntityRecord` write/read/delete backdoor active alongside the authoritative relational `/api/children` router, violating Section 9 ("No generic collection endpoint is still being used as a parallel authoritative Child Safety write path").
- **Required Correction:** Block all Child Safety collection names (`child_profiles`, `children`, `child_gate_passes`, `child_authorized_pickups`, `child_exit_logs`, `child_safety_alerts`, `child_safety` — case-insensitive & normalized) in `/api/collections/:collection*` (returning `403/410` directing clients to `/api/children`), and prevent `/api/entityRecord/query` from querying those collections.

---

## F-B22-02 — Cross-Tenant SSE Subscription Bypass for Society Admins & Unfiltered Broadcast of Child Safety Events to Unauthorized Roles

- **Severity:** **HIGH**
- **Blocks B.2.2 Closure:** **YES**
- **File & Line References:**
  - [server/src/realtimeEngine.ts#L373-L386](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L373-L386) (`handleSseSubscription`)
  - [server/src/realtimeEngine.ts#L136-L141](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L136-L141), [#L162-L175](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L162-L175), [#L202-L229](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L202-L229)
  - [server/src/childSafety/router.ts#L56-L83](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L56-L83) (`emitChildSafetyEvent`)
- **Technical Explanation:**
  1. `handleSseSubscription` checks `userRole !== 'admin'` (`#L374`) and `userRole === 'admin' && requestedSocietyId` (`#L383`) without distinguishing a verified **platform admin** (`user.societyId === null` / `'soc-platform'`) from a **society-bound admin** (`user.societyId === 'soc-a'`). Furthermore, line 385 falls back to `'soc-gvs'` when `authContext.societyId` is empty.
  2. `emitChildSafetyEvent` publishes all Child Safety events (`CHILD_PROFILE_*`, `CHILD_PICKUP_*`, `CHILD_GATE_PASS_*`, `CHILD_EXIT_*`, `CHILD_SAFETY_*`) to `realtimeEngine.recordOutboxEvent` / `broadcastToSociety` without any role or recipient scoping. `broadcastToSociety` delivers those frames to **every** SSE subscriber in `societyId`, including `vendor`, `facility_manager`, and unrelated `resident` users — and `replayEventsSince` (`#L208-L225`) replays them to all roles as well!
- **Reproduction Scenario:**
  1. Society-bound admin (`role: 'admin', societyId: 'soc-a'`) opens `GET /api/realtime/stream?societyId=soc-b` → `handleSseSubscription` accepts the subscription and streams Society B's Child Safety & SOS events.
  2. A `vendor` or unrelated `resident` in `soc-a` opens `GET /api/realtime/stream` → receives live `CHILD_PROFILE_CREATED` (`flatNumber`), `CHILD_GATE_PASS_GENERATED` (`childId`, `passCode`, validity window), `CHILD_EXIT_TRIGGERED` (`gateId`, `childId`, timestamp), and `CHILD_SAFETY_SOS_TRIGGERED` (`location`, `childId`) frames for other families' children.
- **Security / Operational Impact:** Cross-society admin eavesdropping plus intra-society leakage of child movement schedules, flat numbers, pass codes, and SOS locations to vendors and unrelated residents.
- **Required Correction:**
  1. Fix `handleSseSubscription` to require verified `isPlatformAdmin` (not bare `userRole === 'admin'`) for `?societyId` overrides, and fail closed (`403 TENANT_CONTEXT_REQUIRED`) instead of falling back to `'soc-gvs'`.
  2. Enforce audience filtering (`allowedRoles` and optional `targetUserIds` — e.g., `['guard', 'secretary', 'committee', 'admin']` + owning resident's `userId`) inside `RealtimeEngine.broadcastToSociety`, `recordOutboxEvent`, outbox poller dispatch, and `replayEventsSince` so `vendor`, `facility_manager`, and non-owner `resident` subscribers NEVER receive Child Safety events.

---

## F-B22-03 — Stale JWT `claimsSocietyId` Fallback in `authenticateToken` & Missing Guard Filter on `GET /api/children/passes/:id`

- **Severity:** **HIGH**
- **Blocks B.2.2 Closure:** **YES**
- **File & Line References:**
  - [server/src/auth.ts#L292](file:///D:/AAZIRA/AARIZO/server/src/auth.ts#L292)
  - [server/src/childSafety/authz.ts#L52-L86](file:///D:/AAZIRA/AARIZO/server/src/childSafety/authz.ts#L52-L86)
  - [server/src/childSafety/router.ts#L129-L134](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L129-L134) vs [#L765-L802](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L765-L802)
- **Technical Explanation:**
  1. `server/src/auth.ts#L292` computes `effectiveSocietyId = user.societyId || claimsSocietyId || (effectiveRole === 'admin' ? 'soc-platform' : undefined)`. If a guard or secretary is removed from a society in PostgreSQL (`users.society_id = NULL`) while their user account remains `ACTIVE`, a previously issued 24-hour JWT containing `claimsSocietyId: 'soc-a'` continues to populate `req.authContext.societyId = 'soc-a'`. Because `resolveChildSafetyActor` trusts `req.authContext.societyId` without verifying DB `user.societyId`, the removed guard can still verify child gate passes and acknowledge/resolve SOS alerts in `soc-a` until token expiration.
  2. `GET /api/children/passes` (`#L129-L134`) explicitly restricts `guard` to `status: 'ACTIVE', archivedAt: null, validUntil: { gt: new Date() }`, but `GET /api/children/passes/:id` (`#L765-L802`) has no `actor.role === 'guard'` filter — allowing a guard to fetch `REVOKED`, `USED`, `EXPIRED`, and `ARCHIVED` passes including `revocationReason` and guardian `notes`.
- **Required Correction:**
  1. In `authenticateToken` (and/or `resolveChildSafetyActor`), derive `societyId` strictly from the authoritative PostgreSQL `user.societyId` column (never fall back to `claimsSocietyId` when `user.societyId` is `null` for non-platform-admins).
  2. In `GET /api/children/passes/:id`, apply the identical `actor.role === 'guard'` constraint (`status: 'ACTIVE', archivedAt: null, validUntil: { gt: new Date() }`), returning `404` otherwise.

---

## F-B22-04 — Unbounded In-Memory Rate-Limiter Maps & Missing Pass-Creation Rate Limit

- **Severity:** **MEDIUM**
- **Blocks B.2.2 Closure:** **YES**
- **File & Line References:**
  - [server/src/childSafety/rateLimit.ts#L17-L54](file:///D:/AAZIRA/AARIZO/server/src/childSafety/rateLimit.ts#L17-L54)
  - [server/src/childSafety/router.ts#L155](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L155) (`POST /passes`)
- **Technical Explanation:** `verifyBuckets` and `sosBuckets` insert keys on every unique `(actorKey, societyKey)` but never sweep expired buckets and enforce no maximum entry bound. Under prolonged uptime or rotated accounts/IPs, memory grows without bound. Additionally, `POST /api/children/passes` (which generates CSPRNG tokens, writes to PostgreSQL, and publishes outbox events) has no dedicated per-actor rate limit beyond the global 200/min IP limiter.
- **Note on Positives Verified:** Because all Child Safety routes sit behind `authenticateToken`, `req.authContext?.userId` takes precedence over `req.ip`, preventing trivial `X-Forwarded-For` spoofing bypasses; `Retry-After` headers and `429` payloads are properly formatted; `/passes/verify` and `/passes/:id/verify` share `verifyBuckets` so callers cannot double their quota by alternating routes.
- **Required Correction:** Add deterministic expired-entry pruning + bounded max map capacity (e.g., evict expired entries when `buckets.size >= 1000` and cap at `10_000` entries), and attach a sensible dedicated rate limiter to `POST /api/children/passes`.

---

## F-B22-05 — Narrow Concurrency Race Window Between `POST /sos` (`MISSING_CHILD`) and `POST /passes/verify`

- **Severity:** **MEDIUM**
- **Blocks B.2.2 Closure:** **No** *(Strongly recommended in the remediation pass)*
- **File & Line References:**
  - [server/src/childSafety/router.ts#L475-L495](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L475-L495), [#L616-L677](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L616-L677), [#L1088-L1097](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L1088-L1097)
- **Technical Explanation:** While two concurrent `/passes/verify` requests are strictly serialized by PostgreSQL's row lock on `child_gate_passes` (`consumed.count === 1`), a concurrent `POST /api/children/sos` (`MISSING_CHILD`) updates `child_profiles.status = 'MISSING'` WITHOUT updating `child_gate_passes` and WITHOUT `verify` locking `child_profiles` (`FOR UPDATE`). If `verify` reads `child.status === 'SAFE'` before `SOS` commits and executes `childGatePass.updateMany` after `SOS` commits, line 670 (`tx.childProfile.updateMany({ where: { id, societyId, status: 'SAFE' } })`) silently affects 0 rows (unchecked) while `verify` still returns `200 ALLOWED`.
- **Required Correction:** Inside `POST /passes/verify` transaction, lock the `child_profiles` row (`SELECT status, archived_at FROM child_profiles WHERE id = $1 AND society_id = $2 FOR UPDATE`) OR revoke/re-verify `child_profiles.status !== 'MISSING'` after locking, AND check `status` before committing `ALLOWED`.

---

## F-B22-06 — Duplicate Active `MISSING_CHILD` SOS Alerts, Unvalidated Nested JSON Arrays, & Expired Pickup Reactivation

- **Severity:** **MEDIUM**
- **Blocks B.2.2 Closure:** **No** *(Recommended in the remediation pass)*
- **File & Line References:**
  - [server/src/childSafety/router.ts#L1058-L1100](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L1058-L1100) (`POST /sos`)
  - [server/src/childSafety/router.ts#L1594-L1595](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L1594-L1595) (`POST /`)
  - [server/src/childSafety/router.ts#L2063-L2069](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L2063-L2069) (`PATCH /:childId/pickups/:pickupId`)
- **Technical Explanation:**
  1. Repeated `POST /api/children/sos` requests for the same child create duplicate active `ChildSafetyAlert` and duplicate `EmergencyIncident` rows instead of detecting an already-active `MISSING_CHILD` alert for `(societyId, childId)`.
  2. `POST /api/children` stores caller-supplied `secondaryGuardians` and `emergencyContacts` arrays directly without length limits or element schema validation (allowing oversized payloads or raw ID fields nested inside JSON).
  3. `PATCH /:childId/pickups/:pickupId` permits setting `status: 'ACTIVE'` on an expired pickup (`pickup.validUntil <= now`) when `body.validUntil` is omitted.
- **Required Correction:** Deduplicate active `MISSING_CHILD` alerts (return existing active alert or `409`), bound and schema-validate `secondaryGuardians`/`emergencyContacts` (max 5 items, whitelisted keys `name`, `relationship`, `phone`, `email`), and reject `status: 'ACTIVE'` in pickup `PATCH` if effective `validUntil <= now`.

---

## F-B22-07 — Missing Targeted Security & Edge-Case Tests

- **Severity:** **LOW**
- **Blocks B.2.2 Closure:** **No** *(Add alongside remediation of F-B22-01..F-B22-04)*
- **File & Line References:**
  - [tests/issue06_child_safety_api_routes.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_api_routes.test.ts)
  - [tests/issue06_child_safety_api_pg_integration.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_api_pg_integration.test.ts)
- **Technical Explanation:** Specific gaps identified: no test for `/passes/verify` `429` rate limit, no test for `POST /passes/:id/verify` rejecting mismatched `pass.id`, no test for `PATCH /api/children/:id` blocking `MISSING -> SAFE` with active alert, no live PG test for SOS transaction rollback, and no tests covering `F-B22-01` (`/api/collections` block), `F-B22-02` (SSE role/tenant filtering), `F-B22-03` (DB-cleared `user.societyId` & guard `GET /passes/:id`), or `F-B22-04` (rate-limiter eviction).
- **Required Correction:** Add explicit regression tests for each remediated finding and missing edge case.

---

## F-B22-08 — Frontend `apiClient.verifyChildPass` Contract Compatibility Note

- **Severity:** **INFORMATIONAL**
- **Blocks B.2.2 Closure:** **No** *(Expected — Phase B.2.3 scope)*
- **File & Line Reference:** [src/services/apiClient.ts#L176-L180](file:///D:/AAZIRA/AARIZO/src/services/apiClient.ts#L176-L180)
- **Technical Explanation:** Existing frontend `apiClient.verifyChildPass(id, societyId)` sends `POST /children/passes/${id}/verify` with `{ societyId }` and no `bearerToken`. The hardened B.2.2 endpoint will rightly reject this with `400 BEARER_TOKEN_REQUIRED` until Phase B.2.3 updates `apiClient.ts` and the gate scanner UI to submit `{ bearerToken }` or `{ qrPayload }`.

