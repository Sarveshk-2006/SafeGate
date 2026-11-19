# AARIZO ISSUE-06 — PHASE B.2.3 — PHASE 4.6
## Realtime Security, Authorization & Reliability Audit

**Audit Date:** November 19, 2026  
**Repository:** `D:\AAZIRA\AARIZO`  
**Classification:** Deep Security Invariants & Reliability Verification  

---

## 1. Security Architecture & Invariant Verification

The realtime architecture across `server/src/realtimeEngine.ts`, `src/services/realtimeService.ts`, and `src/hooks/useChildSafetyRealtime.ts` was audited against 15 core security and reliability invariants:

### 1.1 Transport Security: Authenticated Fetch SSE
- **Requirement:** SSE streams must be authenticated; JWT tokens must never be passed in URL query parameters where they could be logged by proxies, browser history, or server access logs.
- **Verification Evidence:**
  - In `src/services/realtimeService.ts` (lines 537–562), connection uses `fetch(streamUrl, { headers: { 'Authorization': `Bearer ${session.token}`, 'Accept': 'text/event-stream' } })`.
  - Inspection of `server/src/index.ts` confirmed `/api/realtime/events` rejects query-parameter tokens and requires `Authorization: Bearer <token>`.
- **Verdict:** **PASS / CLEAN.**

### 1.2 Identity Verification: Server-Derived Context
- **Requirement:** Client-supplied tenant IDs (`societyId`), user IDs, or roles must never be trusted for event access.
- **Verification Evidence:**
  - `server/src/index.ts` validates the JWT using the HMAC SHA-256 secret.
  - The decoded token payload supplies `userId`, `role`, and `societyId` to `realtimeEngine.registerClient()`.
  - Client-side headers or request bodies attempting to spoof `societyId` or `role` are completely ignored.
- **Verdict:** **PASS / CLEAN.**

### 1.3 Cross-Society Event Isolation
- **Requirement:** Events emitted in Society A must never reach clients in Society B.
- **Verification Evidence:**
  - In `server/src/realtimeEngine.ts` (`isClientAuthorizedForEvent`, lines 120–127):
    ```ts
    const clientSoc = typeof client?.societyId === 'string' ? client.societyId.trim() : '';
    const targetSoc = typeof eventSocietyId === 'string' ? eventSocietyId.trim() : '';
    if (!clientSoc || !targetSoc) return false;
    if (targetSoc !== '*' && clientSoc !== targetSoc) return false;
    ```
  - In `src/hooks/useChildSafetyRealtime.ts` (lines 265–284), client-side defense-in-depth validates that `event.societyId === authCtx.societyId`.
- **Verdict:** **PASS / CLEAN.**

### 1.4 Resident Household Privacy & Child Ownership Filtering
- **Requirement:** Residents must never receive telemetry, gate exits, pickup authorizations, or alerts belonging to other residents' children.
- **Verification Evidence:**
  - In `server/src/realtimeEngine.ts` (lines 30–37), all topics matching `CHILD_*` are categorized as sensitive (`isSensitiveEventType`).
  - Lines 167–173 enforce:
    ```ts
    if (clientRole === 'resident') {
      if (client.userId && targetUserIds.has(client.userId)) {
        return true;
      }
      return !isSensitive && allowedRoles.has('resident');
    }
    ```
  - Because `CHILD_*` events are sensitive, they are delivered to a resident **ONLY** if their verified JWT `userId` is in `targetUserIds`.
  - In `server/src/childSafety/router.ts`, every `emitChildSafetyEvent` call constructs `targetUserIds` using `collectOwnerUserIds(child.guardianUserId, actor.userId)`.
  - Non-owner residents never receive child events over the wire.
- **Verdict:** **PASS / CLEAN.**

### 1.5 Fail-Closed Handling of Malformed or Unknown Topics
- **Requirement:** Unregistered, malformed, or hostile topic strings must fail closed without side effects.
- **Verification Evidence:**
  - In `src/services/realtimeService.ts` (lines 180–199), `classifyRealtimeTopic()` checks `CANONICAL_TOPIC_FORMAT_REGEX`. Empty, malformed, or unlisted topics fail closed: `normalizedTopic: ''`, `category: 'UNKNOWN'`, `isProtected: true`.
  - In `src/hooks/useChildSafetyRealtime.ts` (lines 213–224), topics not in `VALID_CHILD_SAFETY_TOPIC_SET` are discarded before subscription.
- **Verdict:** **PASS / CLEAN.**

### 1.6 Replay Cursor & Reconnection Reliability
- **Requirement:** On temporary network interruption, clients must resume from their last seen event without duplicate data loss.
- **Verification Evidence:**
  - `sseFrameParser.ts` captures the `id:` line from each frame.
  - In `realtimeService.ts` (line 970), `lastEventId` is updated **only after** message dispatch completes without subscriber error.
  - On reconnect, `Last-Event-ID` header is passed in the Fetch request (`realtimeService.ts#L544`).
  - Server outbox replays unacknowledged events from `outbox_events` matching the cursor.
- **Verdict:** **PASS / CLEAN.**

### 1.7 Bounded FIFO Event Deduplication
- **Requirement:** Duplicate network frames or replay deliveries must not trigger duplicate UI side effects.
- **Verification Evidence:**
  - Transport level: `realtimeService.ts` maintains `seenMessageIds` (max 500 entries, FIFO eviction).
  - Hook level: `useChildSafetyRealtime.ts` maintains `seenEventIds` (max 250 entries, FIFO eviction).
  - Crucial invariant: Event ID is recorded in `seenEventIds` **only after** all consumer callbacks complete without error (lines 351–359). If a callback throws, the event ID is not recorded, preserving replay recovery.
- **Verdict:** **PASS / CLEAN.**

### 1.8 Stale Session, Logout & Account-Switch Protection
- **Requirement:** Switching users or logging out must immediately kill active SSE connections and purge in-memory caches.
- **Verification Evidence:**
  - In `realtimeService.ts`, `sessionEpoch` increments on every connect/disconnect. Active streams check `isCurrentStream(epoch, generation)`. Stale responses from prior sessions are dropped immediately.
  - In `useChildSafetyRealtime.ts` (lines 242–257), `boundSessionFingerprint` checks for user ID, society, or role changes. Any mismatch eagerly calls `seenEventIds.clear()` and `childSafetyService.clearInMemoryState()`.
- **Verdict:** **PASS / CLEAN.**

### 1.9 Offline / Online Network Transitions
- **Requirement:** Recover cleanly from sleep/wake and cellular-to-Wi-Fi network transitions.
- **Verification Evidence:**
  - `realtimeService.ts` (lines 435–438) binds to `window.addEventListener('online')` and calls `handleNetworkResume()`.
  - When connection transitions to `CONNECTED` following a reconnect gap (`hadReconnectGap === true`), `useChildSafetyRealtime.ts` (lines 380–392) invokes `onReconnect()` and triggers `childSafetyService.notifyInvalidation(['all'], 'reconnect')`.
- **Verdict:** **PASS / CLEAN.**

### 1.10 React Strict Mode Mount / Unmount Resilience
- **Requirement:** In React 18+, Strict Mode mounts, unmounts, and remounts components in development. Subscriptions must not leak or churn.
- **Verification Evidence:**
  - `useChildSafetyRealtime.ts` uses `optionsRef` to store callbacks. Re-renders with new inline arrow functions do NOT recreate subscriptions or cause subscription churn.
  - Cleanup function returned by `subscribeToChildSafetyRealtime()` (lines 398–408) safely clears all 15 listeners and empties dedupe sets.
- **Verdict:** **PASS / CLEAN.**

### 1.11 Multi-Tab Isolation & BroadcastChannel Elimination
- **Requirement:** Sensitive domain events must never leak across tabs via insecure shared BroadcastChannels.
- **Verification Evidence:**
  - Audit confirmed BroadcastChannel domain-event relay was permanently removed (F-P2-01B).
  - Each browser tab maintains its own authenticated Fetch SSE connection.
- **Verdict:** **PASS / CLEAN.**

### 1.12 Sensitive Payload Sanitization
- **Requirement:** Realtime payloads must never carry raw bearer tokens, QR secret hashes, or identity document images.
- **Verification Evidence:**
  - In `server/src/childSafety/router.ts`, every emitted payload is explicitly constructed with minimal public fields (e.g., `id`, `childId`, `status`, `passCode`).
  - Raw `bearerToken`, `tokenHash`, `qrCode`, and government ID photos are strictly omitted from all 14 event payloads.
- **Verdict:** **PASS / CLEAN.**

### 1.13 Database Commit Precedence
- **Requirement:** Realtime events must be emitted ONLY after the database commits.
- **Verification Evidence:**
  - In `server/src/childSafety/router.ts`, every `emitChildSafetyEvent` invocation is positioned outside and after `await prisma.$transaction(...)`.
  - If a transaction aborts or rolls back, zero realtime events are emitted.
- **Verdict:** **PASS / CLEAN.**

### 1.14 Zero Optimistic UI Dispatches Before Confirmation
- **Requirement:** Frontend must never render success confirmations based on local client optimism.
- **Verification Evidence:**
  - `ResidentChildSosModal.tsx` retains submitting lock until the server responds with HTTP 201.
  - `ResidentGatePassesSection.tsx` mounts the one-time QR modal only upon receipt of HTTP 201.
  - `ResidentAuthorizedPickupsSection.tsx` updates state only after server confirmation.
- **Verdict:** **PASS / CLEAN.**

### 1.15 Client Network Broadcast Restriction
- **Requirement:** Clients must not be permitted to publish arbitrary security or Child Safety events via `/api/realtime/broadcast`.
- **Verification Evidence:**
  - In `realtimeService.ts` (lines 1081–1100), `publish()` checks `classification.canClientNetworkBroadcast`.
  - Only non-sensitive public operational topics (`ANNOUNCEMENT_*`, `COMMUNITY_*`, `MAINTENANCE_*`, `SYNC_PING`, `GENERAL`) can trigger network broadcast.
  - All Child Safety and emergency topics have `canClientNetworkBroadcast: false` and are blocked from client network broadcast.
- **Verdict:** **PASS / CLEAN.**

---

## 2. Identified Reliability Risks & Mitigations

| Risk # | Description | Severity | Mitigation Required in Phase 4.6 |
| :---: | :--- | :---: | :--- |
| **R-1** | Multiple rapid SSE events could trigger concurrent overlapping backend fetches. | Medium | Enforce **250ms debouncing** and monotonic `requestIdRef` sequencing in `ResidentChildSafetyPanel`. |
| **R-2** | Pickup topics categorized as `UNKNOWN` in `realtimeService.ts`. | Low | Add `CHILD_PICKUP_AUTHORIZED`, `CHILD_PICKUP_UPDATED`, `CHILD_PICKUP_REVOKED` to `CANONICAL_CHILD_SAFETY_TOPICS`. |
| **R-3** | `SafetyCommandHub.tsx` listening to fictitious `CHILD_SAFETY_UPDATED`. | Medium | Replace with canonical `CHILD_SAFETY_SOS_TRIGGERED`, `CHILD_SAFETY_ALERT_ACKNOWLEDGED`, `CHILD_SAFETY_ALERT_RESOLVED`, `EMERGENCY_INCIDENT_CREATED`. |
| **R-4** | Reconnecting after an offline gap without re-syncing cached data could leave the UI stale. | High | Hook `onReconnect` in `ResidentChildSafetyPanel` to trigger full authoritative re-sync across all 4 scopes. |
| **R-5** | Resident lacks visual feedback on SSE connection status. | Low | Add subtle live indicator badge (`LIVE_SYNCED`, `RECONNECTING`, `OFFLINE`) to `ResidentChildSafetyPanel`. |

---

## 3. Conclusion

The security foundation for realtime synchronization in AARIZO is robust, strictly enforces tenant and household privacy boundaries, and conforms to production-grade security standards. The mitigations for risks R-1 through R-5 are straightforward and will be executed under the Phase 4.6 implementation plan.

