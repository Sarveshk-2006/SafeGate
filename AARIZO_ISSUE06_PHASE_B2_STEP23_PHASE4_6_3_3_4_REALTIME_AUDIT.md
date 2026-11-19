# AARIZO — ISSUE-06 — PHASE B.2 — STEP 2.3 — PHASE 4.6.3.3.4
# SECURITY COMMAND HUB — AUTHENTICATED REALTIME INTEGRATION AUDIT

**Repository:** `D:\AAZIRA\AARIZO`  
**Phase:** Phase B.2 / Step 2.3 / Subphase 4.6.3.3.4  
**Audit Mode:** STRICTLY READ-ONLY AUDIT & ARCHITECTURAL INVESTIGATION  
**Target File:** `src/domains/safety/components/SafetyCommandHub.tsx`  
**Date:** November 19, 2026  

---

## 1. Executive Summary

Phase 4.6.3.3.3 established canonical backend controllers and modal workflows in `SafetyCommandHub.tsx` for Child Safety SOS triggering, alert listing, acknowledgment, and resolution. However, the component's realtime data synchronization currently relies on a temporary, legacy adapter pattern (`realTimeSync.subscribe`) that uses a non-existent topic name (`CHILD_SAFETY_UPDATED`) and lacks the strict security controls, event deduplication, society-scoping, and connection lifecycle management established in earlier phases.

This audit evaluates the current realtime implementation in `SafetyCommandHub.tsx` against the canonical architecture established in:
1. `src/hooks/useSecurityChildSafetyRealtime.ts` (Phase 4.6.3.1: Security Child Safety Realtime Hook)
2. `src/services/realtimeService.ts` (Phase 2: Authenticated Fetch-based SSE Transport)
3. `src/context/AuthContext.tsx` (SSE Connection Lifecycle Owner)
4. `server/src/childSafety/router.ts` & `server/src/realtimeEngine.ts` (Backend Post-Commit Event Emitter & Audience Filter)

The audit confirms that the canonical hook `useSecurityChildSafetyRealtime` is already implemented, fully unit-tested, and successfully operating in `ChildGateScannerPage.tsx`. Modernizing `SafetyCommandHub.tsx` requires wiring this existing hook, replacing the legacy `realTimeSync` adapter, and adding general emergency event listeners directly onto `realtimeService`.

---

## 2. Realtime Architecture Inspection

### 2.1 Authenticated SSE Connection Ownership & Lifecycle

The SSE connection lifecycle is owned strictly by `src/context/AuthContext.tsx` (lines 100–123):
- **Connection Trigger:** When `status === 'AUTHENTICATED'`, `currentUser` is present, and `isSessionValid()` returns true, `AuthContext` calls:
  ```typescript
  realtimeService.connect({
    token: getAuthToken()!,
    userId: currentUser.id,
    societyId: currentUser.societyId,
    role: currentUser.role,
  });
  ```
- **Connection Disconnect:** When `status` transitions away from `AUTHENTICATED`, when user switches, or when `AuthProvider` unmounts, `realtimeService.disconnect()` is invoked.
- **Transport Mechanism:** `realtimeService` uses `authenticatedFetch` with a streaming body reader and `SseFrameParser`.
  - Zero `EventSource` browser API usage (which cannot send `Authorization: Bearer <token>` headers without URL tokens).
  - Zero JWT or credentials in URL query strings.
  - Zero `BroadcastChannel` or `postMessage` relay (permanently removed under F-P2-01B).
- **Invariance:** UI components (including `SafetyCommandHub.tsx` and `ChildGateScannerPage.tsx`) **must never call** `realtimeService.connect()` or `realtimeService.disconnect()`. They register topic listeners via `realtimeService.subscribe` or through shared hooks (`useSecurityChildSafetyRealtime`).

### 2.2 Comparison of Existing Realtime Hooks

The repository currently contains two specialized Child Safety realtime hooks:

| Feature / Property | `useChildSafetyRealtime.ts` (Phase 4.6.2) | `useSecurityChildSafetyRealtime.ts` (Phase 4.6.3.1) |
| :--- | :--- | :--- |
| **Intended Consumer** | Resident Portal (`ResidentChildSafetyPanel`) | Security Guard & Staff Command (`ChildGateScannerPage`, `SafetyCommandHub`) |
| **Subscribed Topics** | All 14 Child Safety topics (Profiles, Pickups, Passes, Exits, Alerts) | Strictly the **8 Security Topics** (Passes, Exits, Alerts/SOS) |
| **Privacy Safeguard** | Resident sees only owned child data | Explicitly blocks guard access to household profile & pickup topics |
| **Allowed Roles** | `resident`, `secretary`, `committee`, `admin` | `guard`, `secretary`, `committee`, `admin` |
| **Coalescing Debounce** | 50ms coalescing debounce | 50ms coalescing debounce with in-flight tracking |
| **Deduplication** | Bounded FIFO window (250 IDs) | Bounded FIFO window (250 IDs) |
| **Nonces Provided** | `profilesRefreshNonce`, `pickupsRefreshNonce`, `passesRefreshNonce`, `alertsRefreshNonce` | `passesRefreshNonce`, `logsRefreshNonce`, `alertsRefreshNonce`, `refreshNonce` |
| **Connection State** | `connectionStatus` | `connectionStatus`, `isConnected`, `isReconnecting`, `isOffline` |

### 2.3 Current Realtime Implementation in `SafetyCommandHub.tsx`

Inspection of `SafetyCommandHub.tsx` lines 579–608 reveals:
```typescript
  useEffect(() => {
    loadData();

    const unsubscribeEmergency = realTimeSync.subscribe('EMERGENCY_ALERTS', () => {
      loadData();
      if (canViewConsole) {
        loadGeneralIncidents();
      }
    });

    const unsubscribeChild = realTimeSync.subscribe('CHILD_SAFETY_UPDATED', () => {
      loadData();
      if (canViewConsole) {
        loadAuthoritativeAlerts();
      }
    });

    const unsubscribeCache = childSafetyService.onCacheInvalidated(() => {
      loadAuthoritativeChildren();
      if (canViewConsole) {
        loadAuthoritativeAlerts();
      }
    });

    return () => {
      unsubscribeEmergency();
      unsubscribeChild();
      unsubscribeCache();
    };
  }, [loadData, canViewConsole, loadAuthoritativeAlerts, loadGeneralIncidents, loadAuthoritativeChildren]);
```

#### Identified Architecture & Security Gaps in Current Implementation:
1. **Fictitious Topic (`CHILD_SAFETY_UPDATED`):** The backend `server/src/childSafety/router.ts` never emits a topic named `CHILD_SAFETY_UPDATED`. As a result, this listener is completely dormant during real production SSE streaming.
2. **Missing Security Child Safety Topics:** The hub misses all 8 canonical Child Safety topics emitted by the backend:
   - `CHILD_GATE_PASS_GENERATED`, `CHILD_GATE_PASS_VERIFIED`, `CHILD_GATE_PASS_REVOKED`
   - `CHILD_EXIT_TRIGGERED`, `CHILD_EXIT_DENIED`
   - `CHILD_SAFETY_SOS_TRIGGERED`, `CHILD_SAFETY_ALERT_ACKNOWLEDGED`, `CHILD_SAFETY_ALERT_RESOLVED`
3. **Missing General Emergency Resolution Topic:** `server/src/index.ts:2350` emits `EMERGENCY_INCIDENT_RESOLVED` when general incidents are closed. The hub only listens to `EMERGENCY_ALERTS`, meaning incident resolutions made by other guards/staff do not dynamically refresh the console feed.
4. **Missing Reconnect Invalidation:** When a guard terminal temporarily drops Wi-Fi or cellular network and reconnects (`RECONNECTING` -> `CONNECTED`), the hub fails to perform an authoritative resync to catch events that occurred while offline.
5. **Lack of In-Flight Request Tracking:** If multiple SSE events arrive while `loadAuthoritativeAlerts` is awaiting HTTP response, the current implementation risks race conditions or dropping intermediate state changes.
6. **No Realtime Connection Visibility:** The console header gives staff no visual feedback as to whether the terminal is `CONNECTED`, `RECONNECTING`, or `OFFLINE`.
7. **Use of Deprecated Wrapper (`realTimeSync`):** `realTimeSync.ts` is an obsolete 12-line helper that exposes a dangerous `publish` method (`realtimeService.broadcast`). Modernizing to `useSecurityChildSafetyRealtime` and `realtimeService` bypasses this deprecated file.

---

## 3. Security & Privacy Invariants

1. **Guard Privacy Barrier:** Security guards must never receive `CHILD_PROFILE_*` or `CHILD_PICKUP_*` events. In `server/src/childSafety/router.ts:58`, profile and pickup events are restricted to `PROFILE_EVENT_ROLES = ['secretary', 'committee', 'admin']`. The hub must enforce this by subscribing guards strictly to the 8 security topics.
2. **Post-Commit Emission:** In `server/src/childSafety/router.ts:1293`, `emitChildSafetyEvent` is called strictly after `prisma.$transaction` completes. Frontend handlers must treat received SSE messages as notifications to refresh authoritative backend state, **never** storing raw event payloads as client truth.
3. **Tenant & Society Scoping:** Every incoming message must have its `societyId` compared against `currentUser.societyId`. Cross-society messages must be discarded immediately before triggering state invalidation.
4. **Bounded FIFO Deduplication:** Events must be checked against a bounded set of seen `id`s (default 250) to prevent replay loops or duplicate state mutations.

---

## 4. Audit Conclusions

- `SafetyCommandHub.tsx` already has the required data fetchers (`loadAuthoritativeAlerts`, `loadGeneralIncidents`, `loadAuthoritativeChildren`).
- The canonical hook `useSecurityChildSafetyRealtime` already contains all necessary security guards, society checking, deduplication, reconnect logic, and debouncing.
- Modernizing `SafetyCommandHub.tsx` to use `useSecurityChildSafetyRealtime` alongside direct `realtimeService.subscribe` for general emergency topics will bring the hub to full production readiness with zero regressions.

