# AARIZO ISSUE-06 — Phase B.2.3 — Phase 3 Realtime & Security Audit

**Audit Date:** 2026-11-18  
**Audited Files:** `src/hooks/useChildSafetyRealtime.ts`, `src/services/realtimeService.ts`, `src/context/AuthContext.tsx`, `server/src/childSafety/router.ts`, `server/src/realtimeEngine.ts`

---

## 1. Backend Event Enumeration vs `useChildSafetyRealtime.ts`

Independently enumerated every `emitChildSafetyEvent()` call in `server/src/childSafety/router.ts`:

| # | Exact Backend Topic | Backend Line | Subscribed in `useChildSafetyRealtime.ts`? | Current Invalidation Scopes | Backend Cascade Match? |
| :---: | --- | :---: | :---: | --- | :---: |
| 1 | `CHILD_PROFILE_CREATED` | `router.ts#L1855` | YES | `['children']` | **PASS** |
| 2 | `CHILD_PROFILE_UPDATED` | `router.ts#L2087` | YES | `['children']` | **PASS** |
| 3 | `CHILD_PROFILE_ARCHIVED` | `router.ts#L2153` | YES | `['children']` | **DEFECT (`F-P3-02`)** — Backend cascades active pickups & passes; missing `'pickups'`, `'passes'`! |
| 4 | `CHILD_PICKUP_AUTHORIZED` | `router.ts#L2289` | YES | `['pickups', 'children']` | **PASS** |
| 5 | `CHILD_PICKUP_UPDATED` | `router.ts#L2469` | YES | `['pickups', 'children']` | **PASS** |
| 6 | `CHILD_PICKUP_REVOKED` *(revoke + archive)* | `router.ts#L2552` | YES | `['pickups', 'children']` | **DEFECT (`F-P3-02`)** — Backend cascades active passes (`router.ts#L2520-L2533`); missing `'passes'`! |
| 7 | `CHILD_GATE_PASS_GENERATED` | `router.ts#L380` | YES | `['passes', 'children']` | **PASS** |
| 8 | `CHILD_GATE_PASS_VERIFIED` | `router.ts#L811` | YES | `['passes', 'children']` | **PASS** |
| 9 | `CHILD_GATE_PASS_REVOKED` | `router.ts#L1019` | YES | `['passes', 'children']` | **PASS** |
| 10 | `CHILD_EXIT_TRIGGERED` | `router.ts#L796` | YES | `['exitLogs', 'passes', 'children']` | **PASS** |
| 11 | `CHILD_EXIT_DENIED` | `router.ts#L835` | YES | `['exitLogs', 'passes', 'children']` | **PASS** |
| 12 | `CHILD_SAFETY_SOS_TRIGGERED` | `router.ts#L1294` | YES | `['alerts', 'children']` | **PASS** |
| 13 | `CHILD_SAFETY_ALERT_ACKNOWLEDGED` | `router.ts#L1448` | YES | `['alerts', 'children']` | **PASS** |
| 14 | `CHILD_SAFETY_ALERT_RESOLVED` | `router.ts#L1591` | YES | `['alerts', 'children']` | **PASS** |
| *(linked)* | `EMERGENCY_INCIDENT_CREATED` | `router.ts#L1310` | Intentionally excluded (paired with #12 `CHILD_SAFETY_SOS_TRIGGERED` to avoid double refresh and keep general emergencies separate) | N/A | **PASS (Verified Design)** |

- **Invented Topics:** `0` invented topics. `VALID_CHILD_SAFETY_TOPIC_SET` rejects any unrecognized topic string.
- **Missed Mutation Events:** `0` missed events (`DELETE /:childId/pickups/:pickupId` shares `handleRevokeOrArchivePickup` and emits `CHILD_PICKUP_REVOKED`).

---

## 2. Transport, Lifecycle & Security Findings

### Verified Passes
- Authenticated Fetch SSE ONLY (`realtimeService.ts`); **`0` native `EventSource`**, **`0` query-string JWTs**, **`0` active `BroadcastChannel` / `postMessage`**.
- `AbortController` lifecycle and Phase 2 protections (`F-P2-01`–`F-P2-06`) untouched and verified passing (`44/44` tests).
- Ref-stabilized callbacks in `useChildSafetyRealtime` (`#L266-L289`) prevent subscription churn on component re-renders; unmount cleanup removes all topic listeners + status listener cleanly.
- Bounded FIFO `seenEventIds` (`MAX_DEDUPE_IDS = 250`) prevents unbounded memory growth.

### Verified Defects (`F-P3-02` — MEDIUM-HIGH — BLOCKS PHASE 4)
1. **Incomplete Cascade Invalidation (`#L104-L109`):** `CHILD_PROFILE_ARCHIVED` omits `'pickups'` and `'passes'`; `CHILD_PICKUP_REVOKED` omits `'passes'`.
2. **Missing Client-Side Society & Auth Guard (`#L164-L208`, `#L231-L234`):** `handleMessage()` does not verify `getAuthToken() && getStoredUser()` or reject mismatched `msg.societyId !== activeUser.societyId` (for non-platform-admins) before calling `childSafetyService.notifyInvalidation()` and callbacks; `status.state === 'OFFLINE'` does not eagerly invoke `childSafetyService.clearInMemoryState()`.
3. **Callback Exception Suppresses Replay (`#L172`, `#L210-L216`):** `seenEventIds.add(eventId)` executes before consumer callbacks; if a callback throws, sibling callbacks are skipped and `eventId` remains permanently in `seenEventIds`, preventing replay recovery after reconnect.

### Consumer Refresh Verification (Audit C)
- **Honest Disclosure (`F-P3-04` — LOW / INFORMATIONAL):** `childSafetyService.onCacheInvalidated()` and `useChildSafetyRealtime()` provide the invalidation/subscription foundation in Phase 3, but **zero portal UI components currently subscribe to them** — portal data-refresh wiring is explicitly scheduled for Phases 4 (Resident), 5 (Security), and 6 (Admin).

