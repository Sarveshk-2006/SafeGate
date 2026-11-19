# AARIZO — ISSUE-06 | B.2.3 | Phase 3 Realtime Integration Report

**Date:** 2026-11-18  
**Module Added:** `src/hooks/useChildSafetyRealtime.ts`  
**Transport Dependency:** Accepted Phase 2 Authenticated Fetch SSE `realtimeService` (`src/services/realtimeService.ts`)

---

## 1. Exact Backend Child Safety SSE Event Inventory (Zero Invented Topics)

Every subscribed topic was verified directly against `emitChildSafetyEvent()` calls in `server/src/childSafety/router.ts`:

| Domain Family | Exact Backend Topic | Backend Source Line | Invalidated Service Scopes | Hook Callback(s) |
| --- | --- | :---: | --- | --- |
| **Child Profiles** | `CHILD_PROFILE_CREATED` | `router.ts#L1855` | `['children']` | `onEvent`, `onProfilesChange` |
| **Child Profiles** | `CHILD_PROFILE_UPDATED` | `router.ts#L2087` | `['children']` | `onEvent`, `onProfilesChange` |
| **Child Profiles** | `CHILD_PROFILE_ARCHIVED` | `router.ts#L2153` | `['children']` | `onEvent`, `onProfilesChange` |
| **Authorized Pickups** | `CHILD_PICKUP_AUTHORIZED` | `router.ts#L2289` | `['pickups', 'children']` | `onEvent`, `onPickupsChange`, `onProfilesChange` |
| **Authorized Pickups** | `CHILD_PICKUP_UPDATED` | `router.ts#L2469` | `['pickups', 'children']` | `onEvent`, `onPickupsChange`, `onProfilesChange` |
| **Authorized Pickups** | `CHILD_PICKUP_REVOKED` *(revoke + archive)* | `router.ts#L2552` | `['pickups', 'children']` | `onEvent`, `onPickupsChange`, `onProfilesChange` |
| **Gate Passes** | `CHILD_GATE_PASS_GENERATED` | `router.ts#L380` | `['passes', 'children']` | `onEvent`, `onPassesChange`, `onProfilesChange` |
| **Gate Passes** | `CHILD_GATE_PASS_VERIFIED` | `router.ts#L811` | `['passes', 'children']` | `onEvent`, `onPassesChange`, `onProfilesChange` |
| **Gate Passes** | `CHILD_GATE_PASS_REVOKED` | `router.ts#L1019` | `['passes', 'children']` | `onEvent`, `onPassesChange`, `onProfilesChange` |
| **Gate Exit Logs** | `CHILD_EXIT_TRIGGERED` | `router.ts#L796` | `['exitLogs', 'passes', 'children']` | `onEvent`, `onExitLogsChange`, `onPassesChange`, `onProfilesChange` |
| **Gate Exit Logs** | `CHILD_EXIT_DENIED` | `router.ts#L835` | `['exitLogs', 'passes', 'children']` | `onEvent`, `onExitLogsChange`, `onPassesChange`, `onProfilesChange` |
| **Alerts & SOS** | `CHILD_SAFETY_SOS_TRIGGERED` | `router.ts#L1294` | `['alerts', 'children']` | `onEvent`, `onAlertsChange`, `onProfilesChange` |
| **Alerts & SOS** | `CHILD_SAFETY_ALERT_ACKNOWLEDGED` | `router.ts#L1448` | `['alerts', 'children']` | `onEvent`, `onAlertsChange`, `onProfilesChange` |
| **Alerts & SOS** | `CHILD_SAFETY_ALERT_RESOLVED` | `router.ts#L1591` | `['alerts', 'children']` | `onEvent`, `onAlertsChange`, `onProfilesChange` |

---

## 2. Subscription Lifecycle, Deduplication & Reconnect Behavior

1. **Single Authenticated Transport:** Uses `realtimeService.subscribe()` and `realtimeService.subscribeToStatus()` strictly over Phase 2 Fetch SSE. Zero `BroadcastChannel`, zero native `EventSource`, zero polling loops, zero fake local events.
2. **Backend Audience Enforcement Respected:** Client never bypasses backend `isClientAuthorizedForEvent()` role/owner audience policies — residents receive only own-child events, guards receive gate/SOS events, and secretary/committee/admin receive society-scoped profile/gate/SOS events.
3. **Zero Duplicate Subscriptions & Strict-Mode-Safe Cleanup:**
   - `useChildSafetyRealtime()` stabilizes all callback refs via `optionsRef` so component re-renders never tear down or duplicate SSE subscriptions.
   - `subscribeToChildSafetyRealtime()` deduplicates requested topics, rejects unknown/invented topic strings, and returns an idempotent unsubscribe closure removing all 14 topic listeners + status listener cleanly.
4. **Event Deduplication (`MAX_DEDUPE_IDS = 250`):**
   - Tracks processed event IDs in a bounded FIFO `Set<string>` per subscription.
   - Retained across `'RECONNECTING' → 'CONNECTED'` so replayed `Last-Event-ID` events already handled before disconnect never fire duplicate UI updates.
   - Cleared on `'OFFLINE'` (explicit logout/session teardown) so replacement sessions start clean.
5. **Reconnect Resync:**
   - When connection status transitions from `'RECONNECTING'` back to `'CONNECTED'`, invokes `onReconnect(status)` and `childSafetyService.notifyInvalidation(['all'], 'reconnect')` so portals refetch authoritative state even if more than 50 events occurred offline.
6. **Zero Interference With Unrelated Subscribers:** Verified in automated tests that `VISITOR_ARRIVAL` and other non-Child-Safety subscribers continue receiving events uninterrupted before and after `useChildSafetyRealtime` unmounts.

