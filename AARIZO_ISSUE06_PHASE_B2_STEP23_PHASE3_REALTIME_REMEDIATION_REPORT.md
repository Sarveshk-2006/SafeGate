# AARIZO ISSUE-06 — Phase B.2.3 — Phase 3 Realtime Remediation Report (`F-P3-02`)

**Date:** 2026-11-18  
**Repository:** `D:\AAZIRA\AARIZO`  
**Target File:** `src/hooks/useChildSafetyRealtime.ts`  
**Backend Reference Verified:** `server/src/childSafety/router.ts` (lines 102–120, 380–840, 1019–1591, 1855–2555)  
**Finding Addressed:** `F-P3-02` (MEDIUM-HIGH) — Incomplete realtime cascade invalidation, missing client-side auth/society guard, missing eager offline snapshot cleanup, and callback-exception replay suppression.

---

## 1. Backend-Aligned Cascade Invalidation Matrix (`getInvalidatedChildSafetyScopes`)

Every emitted topic in `server/src/childSafety/router.ts` was verified against its Prisma transaction side effects and mapped accurately in `getInvalidatedChildSafetyScopes(topic, payload?)`:

| # | Exact Backend Topic | Backend Transaction Side Effects | Remediated Scopes |
| :---: | --- | --- | --- |
| 1 | `CHILD_PROFILE_CREATED` | Creates `childProfile` | `['children']` |
| 2 | `CHILD_PROFILE_UPDATED` | Updates `childProfile` | `['children']` |
| 3 | `CHILD_PROFILE_ARCHIVED` | Archives `childProfile` + atomically revokes all `ACTIVE` `childGatePass` rows (`router.ts#L2121-L2155`) | **`['children', 'pickups', 'passes']`** |
| 4 | `CHILD_PICKUP_AUTHORIZED` | Creates `childAuthorizedPickup` | `['pickups', 'children']` |
| 5 | `CHILD_PICKUP_UPDATED` | Updates `childAuthorizedPickup`; if `status` becomes `REVOKED` or `EXPIRED`, atomically revokes all `ACTIVE` `childGatePass` rows (`router.ts#L2447-L2462`) | **`['pickups', 'passes', 'children']`** when `payload.status` is `REVOKED`/`EXPIRED`; else `['pickups', 'children']` |
| 6 | `CHILD_PICKUP_REVOKED` | Revokes/archives pickup + atomically revokes all `ACTIVE` `childGatePass` rows (`router.ts#L2520-L2555`) | **`['pickups', 'passes', 'children']`** |
| 7 | `CHILD_GATE_PASS_GENERATED` | Creates `childGatePass` | `['passes', 'children']` |
| 8 | `CHILD_GATE_PASS_VERIFIED` | Updates `childGatePass` + updates `childProfile` (`OUT_OF_SOCIETY`) + creates `childExitLog` (`router.ts#L699-L749`) | **`['passes', 'exitLogs', 'children']`** |
| 9 | `CHILD_GATE_PASS_REVOKED` | Revokes `childGatePass` | `['passes', 'children']` |
| 10 | `CHILD_EXIT_TRIGGERED` | Creates `childExitLog` + updates pass + updates child status | `['exitLogs', 'passes', 'children']` |
| 11 | `CHILD_EXIT_DENIED` | Creates `childExitLog` only | **`['exitLogs']`** |
| 12 | `CHILD_SAFETY_SOS_TRIGGERED` | Creates `emergencyIncident` + `childSafetyAlert` + updates `childProfile` to `MISSING` | `['alerts', 'children']` |
| 13 | `CHILD_SAFETY_ALERT_ACKNOWLEDGED` | Updates `childSafetyAlert` only | **`['alerts']`** |
| 14 | `CHILD_SAFETY_ALERT_RESOLVED` | Updates `childSafetyAlert` + `emergencyIncident` + conditionally resets `childProfile` to `SAFE` | `['alerts', 'children']` |

- Invented/unlisted topics remain strictly rejected (`0` listeners attached).

---

## 2. Defense-in-Depth Auth, Session & Society-Scope Isolation

Implemented in `subscribeToChildSafetyRealtime.handleMessage()`:
1. **Fail-closed authentication check:** Requires both `getAuthToken()` and `getStoredUser()` with a non-empty user ID (`getActiveRealtimeAuthContext()`). Unauthenticated events emit `0` invalidations, `0` callbacks, and clear any lingering dedupe/snapshot state.
2. **Inline session-switch detection:** Tracks `boundSessionFingerprint` (`uid:societyId:role`). If the active session fingerprint changes even without an intervening `OFFLINE` status event, `seenEventIds.clear()` and `childSafetyService.clearInMemoryState()` execute before validating the event against the new session.
3. **Strict society validation:**
   - Rejects missing, empty, non-string, or sentinel (`*`, `soc-platform`, `platform`, `all`) `msg.societyId`.
   - Rejects events where `payload.societyId` is a sentinel or contradicts `msg.societyId`.
   - For society-bound (non-platform-admin) users: rejects any event where `eventSocietyId !== authCtx.societyId` (or if the user lacks a concrete `societyId`).
   - For verified platform admins: requires a concrete non-sentinel `eventSocietyId`, and enforces `options.societyId` when specified.

---

## 3. Eager Offline State Cleanup & Reconnect Resync

Implemented in `subscribeToStatus`:
- On `status.state === 'OFFLINE'`: immediately resets `seenEventIds.clear()`, `hadReconnectGap = false`, `boundSessionFingerprint = null`, and invokes `childSafetyService.clearInMemoryState()` so stale Child Safety snapshots are eagerly purged on disconnect/logout.
- On `RECONNECTING → CONNECTED`: verifies an active authenticated session, invokes `childSafetyService.notifyInvalidation(['all'], 'reconnect')` (evicting stale snapshots), and invokes `options.onReconnect?.(status)` inside a defensive `try/catch`.

---

## 4. Callback Exception Isolation & Replay-Safe Deduplication

Implemented in `handleMessage()`:
1. Checks `seenEventIds.has(eventId)` before dispatch, but **defers insertion** until after all consumer callbacks complete without throwing.
2. Executes every applicable callback (`onEvent`, `onProfilesChange`, `onPickupsChange`, `onPassesChange`, `onExitLogsChange`, `onAlertsChange`) in its own independent `try/catch` (`invokeSafely`), ensuring a throwing callback never blocks sibling callbacks.
3. If any callback threw (`hadCallbackError === true`), `eventId` is **not** added to `seenEventIds` and `firstError` is rethrown to `RealtimeService`. Phase 2's `RealtimeService` catches the error per subscriber (preserving all sibling/unrelated topic subscribers), deletes `msg.id` from `RealtimeService.seenMessageIds`, and withholds advancing `lastEventId` — enabling clean replay recovery on reconnect.
4. Once all callbacks succeed, `eventId` is inserted into the bounded FIFO `seenEventIds` set (`maxDedupeIds`, default `250`).

---

## 5. Transport & Phase 2 Preservation

- Zero modifications to Phase 2 `src/services/realtimeService.ts`, `src/services/sseFrameParser.ts`, or `src/context/AuthContext.tsx`.
- Static scans across `src/`: **`0` `EventSource`**, **`0` query-string SSE tokens**, **`0` active `BroadcastChannel` / `postMessage`**.

