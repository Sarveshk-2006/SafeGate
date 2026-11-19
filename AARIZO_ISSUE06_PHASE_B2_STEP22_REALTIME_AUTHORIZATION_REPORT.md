# AARIZO — ISSUE-06 PHASE B.2.2 REALTIME & SSE AUTHORIZATION REPORT

**Project:** `D:\AAZIRA\AARIZO`  
**Findings Addressed:** `F-B22-02A`, `F-B22-02B`, `F-B22-02C`  
**Date:** 2026-11-18  
**Status:** **`REMEDIATION COMPLETE — READY FOR FINAL INDEPENDENT RE-AUDIT`**

---

## 1. `F-B22-02A` — `POST /api/realtime/broadcast` Lockdown

Modified [server/src/index.ts#L213-L360](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L213-L360):

- **Role Allowlist (Deny-by-Default):** Only `admin`, `secretary`, `committee`, `facility_manager`, and `guard` may publish operational events via `POST /api/realtime/broadcast`. `vendor`, `resident`, `delivery`, and unknown roles are rejected with `403 INSUFFICIENT_PERMISSIONS`.
- **Protected Event Blocklist:** Any event matching `isSensitiveEventType()` (`CHILD_*`, `EMERGENCY_INCIDENT_*`, `EMERGENCY_ALERTS`, `SECURITY_ALERT_*`, `SOS_*`, `RESIDENT_PRIVATE_*`) or `GATE_PASS_*` is unconditionally rejected with `403 PROTECTED_EVENT_TYPE_FORBIDDEN` — even for administrators. Protected safety events must originate exclusively from verified server-side domain transactions.
- **Per-Role Event Prefix Allowlist:**
  - `admin` / `secretary`: `GENERAL`, `ANNOUNCEMENT_*`, `COMMUNITY_*`, `NOTICE_*`, `POLL_*`, `MAINTENANCE_*`, `FACILITY_*`, `HOUSEKEEPING_*`, `SYNC_PING`.
  - `committee`: `GENERAL`, `ANNOUNCEMENT_*`, `COMMUNITY_*`, `NOTICE_*`, `POLL_*`, `SYNC_PING`.
  - `facility_manager`: `MAINTENANCE_*`, `FACILITY_*`, `HOUSEKEEPING_*`, `UTILITY_*`, `SYNC_PING`.
  - `guard`: `GATE_OPERATIONAL_PING`, `SHIFT_HANDOVER_NOTE`, `PATROL_CHECKPOINT`, `SYNC_PING`.
- **Strict Tenant Derivation:** Uses `resolveGenericCollectionSociety(req, res)` — zero `'soc-gvs'` fallback; society-bound actors passing a foreign `societyId` receive `403 TENANT_ISOLATION_VIOLATION`; missing society context receives `403 TENANT_CONTEXT_REQUIRED`; verified platform admins must supply a concrete target `societyId` (`400 TARGET_SOCIETY_REQUIRED`).
- **Zero Client Metadata Forgery:** Client payloads containing `_audience`, `audience`, `allowedRoles`, `targetUserIds`, `actorId`, `senderRole`, `senderName`, or `societyId` are rejected with `400 FORBIDDEN_EVENT_METADATA`. `actorId`, `senderRole`, and `senderName` are derived strictly from verified `req.authContext`.
- **Internal Helper Hardening:** `broadcastEvent()` strips any accidental `_audience` property from `payload` and accepts an explicit server-side `audience?: EventAudiencePolicy` parameter.

---

## 2. `F-B22-02B` — Fail-Closed SSE Event Audience Policy

Modified [server/src/realtimeEngine.ts#L29-L170](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L29-L170):

- **Centralized Sensitive Event Family Registry (`isSensitiveEventType`):** Protects `CHILD_*`, `EMERGENCY_INCIDENT_*`, `EMERGENCY_ALERTS`, `SECURITY_ALERT_*`, `SOS_*`, and `RESIDENT_PRIVATE_*` (empty/malformed event types also fail closed).
- **Structural & Semantic Validation (`isValidAudiencePolicy`):**
  - Rejects non-objects, arrays, empty `{}` objects, unknown keys outside `['allowedRoles', 'targetUserIds']`, unknown role names outside `KNOWN_ROLES`, and invalid/empty user IDs.
  - Requires at least one non-empty rule (`allowedRoles.length > 0` or `targetUserIds.length > 0`).
- **Strict Fail-Closed Delivery Decision (`isClientAuthorizedForEvent`):**
  1. Missing/empty/mismatched `client.societyId` or `eventSocietyId` -> `false`.
  2. Non-sensitive event with NO `_audience` -> `true` (preserves legitimate public society announcements/pings).
  3. Sensitive event with NO `_audience` -> **`false`** (NEVER defaults to public delivery!).
  4. Any event with invalid/malformed/empty `{}` `_audience` or unknown role -> **`false`**.
  5. Sensitive events ALWAYS deny `vendor`, `facility_manager`, and `delivery` roles.
  6. `resident` receives sensitive events **only** when explicitly matched in `targetUserIds`.
  7. Other roles receive restricted events **only** when matched in `allowedRoles` or `targetUserIds`; default return is **`false`**.
- **Applied Identically to Live Broadcast, Outbox Worker, and `Last-Event-ID` Replay.**

---

## 3. `F-B22-02C` — Tenant-Scoped Replay Cursor Lookup

Modified [server/src/realtimeEngine.ts#L382-L426](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L382-L426):

- Validates `client.societyId` (rejects empty or platform sentinels) and cursor length (`<= 128`).
- Replaced `prisma.outboxEvent.findUnique({ where: { eventId: lastEventId } })` with:
  ```ts
  prisma.outboxEvent.findFirst({
    where: { eventId: normalizedCursor, societyId: clientSoc },
  });
  ```
- A `Last-Event-ID` belonging to another society returns `null` (indistinguishable from a nonexistent cursor — eliminating any cross-tenant existence or timestamp oracle) while preserving legitimate reconnect replay within the caller's society.

---

## 4. Verification Evidence

- `tests/issue06_child_safety_reaudit_fixes.test.ts`: **5/5 realtime/SSE tests PASS** (vendor/resident/FM/admin/platform-admin broadcast matrix, cross-society injection, forged `_audience`, missing society, invalid/protected event types, `EMERGENCY_INCIDENT_CREATED` without `_audience` & with `_audience: {}`, unknown roles, malformed society IDs, and cross-society replay cursor scoping).
- `tests/issue06_child_safety_remediation.test.ts`: **3/3 SSE tests PASS** (8-client live broadcast filtering, `_audience` wire stripping, replay filtering).
- `tests/issue02_gap03_sse_authorization.test.ts`: **8/8 GAP-03 SSE tests PASS**.
- `tests/issue06_child_safety_api_pg_integration.test.ts` Test 8: **PASS on live PostgreSQL 16** — `vendor` attempting cross-society `CHILD_SAFETY_SOS_TRIGGERED` broadcast with forged `_audience` rejected (`403`) with `0` forged rows in `outbox_events`.

