# AARIZO — ISSUE-06 Phase B.2.3 — Phase 2 Remediation Security Verification

**Audit Date:** 2026-11-18  
**Audited Files:** `src/services/realtimeService.ts`, `src/services/sseFrameParser.ts`, `src/context/AuthContext.tsx`, `src/services/authStorage.ts`, `server/src/auth.ts`, `server/src/realtimeEngine.ts`, `server/src/index.ts`

---

## 1. Critical Deep-Dive: `F-P2-01` — BroadcastChannel Security (`PARTIALLY CLOSED — HIGH — BLOCKS PHASE 3`)

### 1.1 Controls Verified as Properly Fixed
1. **Unauthenticated Channel Suppression:** Constructor (`src/services/realtimeService.ts#L209-L227`) no longer creates a `BroadcastChannel`; `initBroadcastChannel()` (`#L248-L253`) requires `this.broadcastChannelEnabled && this.activeSession && getAuthToken()`.
2. **Synchronous Teardown on Logout & Identity Switch:** `closeBroadcastChannel()` (`#L233-L241`) sets `onmessage = null`, calls `close()`, and nullifies `this.channel` synchronously inside `disconnect()` (`#L390`), `destroy()` (`#L411`), `connect()` identity switch (`#L356`), and `forceReconnect()` identity switch (`#L507`).
3. **Async Stale-Callback Guard:** `channel.onmessage` (`#L259`) checks `if (!this.activeSession || !getAuthToken() || this.sessionEpoch !== boundEpoch) return;`, preventing pending asynchronous callbacks from dispatching after logout or session replacement.
4. **Replay Cursor Isolation:** `channel.onmessage` invokes only `this.handleIncomingMessage(safeMsg, boundEpoch)` (`#L308`) and has zero write path to `this.lastEventId`.
5. **Missing / Empty / Mismatched `societyId` Fail-Closed (for non-platform-admins):** `#L276-L290` rejects missing or whitespace-only `incoming.societyId` and rejects mismatched `incomingSocietyId !== activeSoc`.

### 1.2 Residual Security Defects Discovered During Independent Audit

#### Residual Defect `F-P2-01A` (HIGH): Emergency Alert Substring Filter Bypass
- **Exact Locations:**
  - `src/services/realtimeService.ts#L56-L75`:
    ```ts
    const PROTECTED_CLIENT_BROADCAST_PREFIXES = [
      'CHILD_',
      'EMERGENCY_',
      'SOS_',
      'GATE_PASS_',
      'SECURITY_ALERT_',
      'RESIDENT_PRIVATE_',
    ] as const;

    function isProtectedBroadcastTopic(topic: string): boolean {
      const upper = String(topic || '').trim().toUpperCase();
      if (!upper) return true;
      return PROTECTED_CLIENT_BROADCAST_PREFIXES.some((prefix) => upper.startsWith(prefix));
    }
    ```
  - `src/services/realtimeService.ts#L1044-L1065`:
    ```ts
    if (topicUpper === 'CHILD_SAFETY_SOS_TRIGGERED' || topicUpper.includes('EMERGENCY')) {
      ...
      playAudioChime('emergency');
      triggerHaptic('heavy');
      this.dispatchAlert({ urgency: 'emergency', actionPath: '/emergency', ... });
    }
    ```
- **Reproducible Exploit Path:** Any same-origin tab or script posts `{ id: 'x', topic: 'FIRE_EMERGENCY', societyId: 'soc-alpha', payload: { message: 'Evacuate building' } }` onto `BroadcastChannel('communityos_realtime_hub')`.
  1. `isProtectedBroadcastTopic('FIRE_EMERGENCY')` checks `startsWith('EMERGENCY_')` → returns **`false`**.
  2. `channel.onmessage` accepts the message and calls `handleIncomingMessage()`.
  3. `handleIncomingMessage()` evaluates `topicUpper.includes('EMERGENCY')` → returns **`true`**, firing an emergency audio siren, heavy haptic alert, and red emergency alert toast routing to `/emergency`.
- **Same Pattern on Gate/Security Topics:** Topics such as `PARKING_GATE_TRIGGERED` or `MAIN_GATE_PASS` bypass `startsWith('GATE_PASS_')` while matching `topicUpper.includes('GATE')` at `#L1101`, triggering gate activity alerts.

#### Residual Defect `F-P2-01B` (HIGH): Resident PII, Gate-Security, and Financial Domain Events Still Forwarded & Accepted Over `BroadcastChannel`
- **Exact Locations:** `src/services/realtimeService.ts#L257-L309` (inbound) and `#L958-L972` (outbound `publish()`).
- **Evidence:** Because `BroadcastChannel` uses a 6-prefix blocklist instead of removing domain event forwarding (or restricting strictly to non-event UI coordination signals), the following domain events defined in `src/types/realtime.ts#L1-L26` and handled in `handleIncomingMessage()` (`#L1099-L1140`) are STILL sent across `BroadcastChannel` and accepted by any logged-in tab sharing the same `societyId` string:
  - **Visitor / Resident Identity Events:** `VISITOR_ARRIVAL`, `VISITOR_APPROVAL`, `VISITOR_ENTRY`, `VISITOR_EXIT` (exposes `visitorName` and `flatCode`; alters resident/guard visitor UI and fires alert toasts).
  - **Gate / Delivery / Worker Operational Events:** `DELIVERY_STATUS`, `WORKER_ENTRY_EXIT`, `QR_SCAN`, `PARKING_GATE_TRIGGERED` (alters gate/security UI and fires alert toasts).
  - **Financial Events:** `PAYMENT_COMPLETED`, `PAYMENT_STATUS`, `OFFLINE_PAYMENT_LOGGED` (exposes resident payment `amount`; triggers billing alert toast).
  - **Personal / Notification Events:** `GUEST_STAY_BOOKED`, `NOTIFICATIONS`, `FILE_UPLOADED`.
- **Trust & Authorization Failure:**
  - `channel.onmessage` trusts the sender-supplied `incoming.societyId` string with zero verification of sender identity, role, or server-side audience policy (compare with `server/src/index.ts#L227-L231` where `/api/realtime/broadcast` enforces strict role-scoped allowlists).
  - For platform `admin` sessions (`isPlatformAdmin` at `#L284-L289`), society filtering is bypassed completely, allowing any same-origin tab to inject arbitrary non-blocklisted domain events into a platform admin session.
  - Even within the same society, a `vendor` or `delivery` tab sharing a kiosk/browser origin can receive resident payment/visitor payloads or forge visitor/gate/emergency-substring UI alerts into a `resident` or `guard` tab.

### 1.3 Mandatory Remediation for `F-P2-01`
**Remove domain event payload forwarding over `BroadcastChannel` completely.**
1. `publish()` MUST NOT post `RealtimeMessage` domain event payloads onto `BroadcastChannel`.
2. `RealtimeService` MUST NOT accept synthetic `RealtimeMessage` domain events from `BroadcastChannel` into `handleIncomingMessage()` or `dispatchAlert()`.
3. All authoritative domain events (including `CHILD_*`, `EMERGENCY_*`, `VISITOR_*`, `PAYMENT_*`, `DELIVERY_*`, `ANNOUNCEMENT_*`) MUST arrive strictly from the server-authenticated, audience-enforced Fetch SSE stream (`/api/realtime/stream`) or explicit in-tab local `publish()` calls.
4. If cross-tab `BroadcastChannel` is retained at all, restrict it exclusively to explicit, allowlisted, zero-PII coordination signals (e.g., `{ kind: 'SYNC_HINT', scope: 'REFRESH' }`) that NEVER dispatch to `subscribers` or `alertSubscribers` and NEVER carry event payloads. (Note: cross-tab auth logout/token sync is already cleanly handled by `AuthContext.tsx`'s `window.addEventListener('storage', ...)`.)

---

## 2. Verification of Other Security Controls (`F-P2-03`, `F-P2-05`, Static Scans)

| Security Control | File & Line Evidence | Verified Result |
| :--- | :--- | :---: |
| **Zero native `EventSource` in `src/`** | Full recursive grep across `src/**/*.{ts,tsx}` → `0` matches | **PASS** |
| **Zero JWTs/tokens in SSE URL query string** | Full recursive grep across `src/**/*.{ts,tsx}` → `0` matches; `buildStreamUrl()` (`realtimeService.ts#L549-L561`) emits only optional non-sentinel `societyId` | **PASS** |
| **Bearer token sent strictly in `Authorization` header** | `realtimeService.ts#L586-L590` | **PASS** |
| **Zero raw JWT / `Authorization` header logging** | Scan of `realtimeService.ts`, `sseFrameParser.ts`, `AuthContext.tsx` → `0` secret leaks (`AuthContext.tsx#L253, #L304` log claim mismatch / error object only) | **PASS** |
| **Race-safe `401` invalidation** | `realtimeService.ts#L622-L633` checks `getAuthToken() === session.token` synchronously before `clearAuthSession()` + `aarizo:unauthorized` | **PASS** |
| **Permanent `4xx` stop (`400`/`403`/`404`/`405`/`410`/`422`)** | `realtimeService.ts#L635-L645`, `#L662-L670` stop permanently as `OFFLINE`, cancel body, zero retries, preserve valid auth session | **PASS** |
| **Strict `200` + `text/event-stream` validation** | `realtimeService.ts#L685-L710` rejects `204`, `text/html`, `application/json`, missing `Content-Type`, and missing `body.getReader()` before `CONNECTED` | **PASS** |
| **Synchronous Firebase & AuthContext SSE teardown (`F-P2-05`)** | `AuthContext.tsx#L115, #L121, #L155, #L168, #L177, #L213, #L219, #L254, #L264, #L295, #L317, #L377` all invoke `realtimeService.disconnect()` synchronously before clearing storage/state | **PASS** |
| **Backend `REQ-BE-02` untouched & tracked OPEN** | `server/src/auth.ts#L215-L218` still contains legacy `req.query.token` fallback (separate backend task; intentionally untouched in frontend Phase 2) | **OPEN (Tracked Separate Backend Task)** |

