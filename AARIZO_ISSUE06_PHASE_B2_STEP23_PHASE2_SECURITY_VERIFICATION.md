# AARIZO — ISSUE-06 Phase B.2.3 — Phase 2 Security Verification

**Audited Files:** `src/services/realtimeService.ts`, `src/services/sseFrameParser.ts`, `src/context/AuthContext.tsx`, `src/services/authStorage.ts`, `server/src/auth.ts`, `server/src/realtimeEngine.ts`

---

## 1. Security Finding Details

### F-P2-01 (HIGH — BLOCKS PHASE 3): BroadcastChannel Cross-Tab Confidentiality, Integrity & Audience-Policy Bypass
- **Locations:** `src/services/realtimeService.ts#L221-L246` and `#L820-L825`
- **Observed Code:**
  ```ts
  // Line 224-240:
  this.channel = new BroadcastChannel('communityos_realtime_hub');
  this.channel.onmessage = (event) => {
    const incoming = event?.data;
    if (!incoming || !incoming.topic) return;

    if (this.activeSession) {
      ...
      if (!isPlatformAdmin && activeSoc && incoming.societyId && incoming.societyId !== activeSoc) {
        return;
      }
    }

    this.handleIncomingMessage(incoming, this.sessionEpoch);
  };

  // Line 820-825 (inside publish()):
  if (this.channel) {
    this.channel.postMessage(msg); // Posts PROTECTED topics too!
  }
  ```
- **Four Concrete Security Weaknesses Verified:**
  1. **Logged-out tab receives messages:** When `this.activeSession === null`, `if (this.activeSession)` is skipped and `handleIncomingMessage()` dispatches events/alerts/sirens to an unauthenticated tab.
  2. **Protected topics bypass server audience policy:** `publish()` posts `CHILD_*`, `EMERGENCY_*`, `SOS_*`, `GATE_PASS_*`, and `SECURITY_ALERT_*` onto the global `BroadcastChannel`, and `onmessage` accepts them on receiving tabs without server-side audience verification. A `vendor`, `facility_manager`, or non-owning resident tab sharing the browser origin can receive or forge sensitive Child Safety / Emergency telemetry.
  3. **Empty `incoming.societyId` bypasses tenant check:** `incoming.societyId && incoming.societyId !== activeSoc` evaluates to `false` when `incoming.societyId` is `''` or omitted, failing open instead of failing closed.
  4. **Missing sender user/session validation:** Channel messages carry no verified sender `userId` binding, so stale messages from a previous user or concurrent different-role tab are accepted.
- **Actual Impact:** Cross-tab leakage or forgery of sensitive Child Safety and Emergency events across logged-out tabs, different users, or unauthorized roles on shared kiosks/devices (e.g., security desk / admin terminals).
- **Required Correction:**
  1. **Never** post or accept protected topics (`isProtectedBroadcastTopic(topic)`) over `BroadcastChannel`. Protected events must originate strictly from the server-authenticated Fetch SSE stream.
  2. In `channel.onmessage`, **require `this.activeSession !== null`** (fail closed when logged out).
  3. Require non-empty `incoming.societyId` matching `this.activeSession.societyId` (unless verified platform admin), AND require `incoming._senderUserId === this.activeSession.userId` (same-user tab coordination only — never cross-user relay).
  4. Treat `BroadcastChannel` strictly as non-authoritative same-user UI coordination for non-protected topics, never as an authorization source.

---

### F-P2-03 (MEDIUM-HIGH — BLOCKS PHASE 3): Permanent 4xx Reconnect Loops & Unvalidated 204 / Non-SSE Content-Type
- **Location:** `src/services/realtimeService.ts#L541-L588`
- **Evidence:**
  - `400`, `404`, and other permanent `4xx` responses (everything except `401`, `403`, `408`, `429`) fall into `if (!response.ok)` (`#L570`) and call `scheduleReconnect()` infinitely.
  - `204 No Content` or `200 OK` returning `text/html` / `application/json` (e.g., captive portal or SPA fallback HTML) skips `Content-Type` validation and sets `isConnected = true; connectionState = 'CONNECTED'` at `#L586-L587`.
- **Actual Impact:** Reconnect storms against misconfigured/404 endpoints and false green `CONNECTED` indicator when a proxy/captive portal returns HTML `200 OK`.
- **Required Correction:**
  - Stop without retrying (`OFFLINE`) on permanent client errors (`status >= 400 && status < 500 && status !== 408 && status !== 429`).
  - On `2xx`, require `response.status === 200` AND if `Content-Type` header is present require it to include `text/event-stream` (case-insensitive); reject `204` or non-SSE `Content-Type` by cancelling the body and treating it as a transient transport failure (never `'CONNECTED'`).

---

### F-P2-05 (MEDIUM — BLOCKS PHASE 3): Synchronous SSE Disconnect Missing on Firebase Sign-Out Path
- **Location:** `src/context/AuthContext.tsx#L209-L223`
- **Evidence:** When Firebase `onIdTokenChanged` fires with `!firebaseUser`, lines `#L213-L220` call `clearAuthSession()` + `setStatus('UNAUTHENTICATED')` without immediately calling `realtimeService.disconnect()` synchronously (unlike `logout()` at `#L371` and `handleUnauthorized()` at `#L155`).
- **Actual Impact:** Brief race window before React flushes `useEffect` where an in-flight SSE frame or reconnect could execute after session storage was cleared.
- **Required Correction:** Call `realtimeService.disconnect()` synchronously before `clearAuthSession()` in both `!firebaseUser` invalidation branches (`#L212-L221`).

---

## 2. Verified Passing Security Controls

| Control | Evidence | Result |
| :--- | :--- | :---: |
| **Zero native `EventSource` in `src/`** | Full recursive grep returned 0 matches. | **PASS** |
| **Zero JWTs or tokens in query strings** | Full recursive grep for `?token=`/`&token=` returned 0 matches; `buildStreamUrl()` (`#L473-L484`) appends only optional concrete `societyId`. | **PASS** |
| **Zero token/header logging in Phase 2 files** | Full scan confirmed 0 token/Authorization log lines in `sseFrameParser.ts`, `realtimeService.ts`, and `AuthContext.tsx`. | **PASS** |
| **Race-safe `401` handling** | `realtimeService.ts#L542-L552` checks `getAuthToken() === session.token` synchronously before `clearAuthSession()` and `aarizo:unauthorized`. | **PASS** |
| **HTTP `403` non-retrying stop** | `realtimeService.ts#L554-L562` stops permanently (`OFFLINE`) without wiping valid session. | **PASS** |
| **Protected network broadcast guard** | `realtimeService.ts#L828-L833` skips `POST /api/realtime/broadcast` for `CHILD_*`, `EMERGENCY_*`, `SOS_*`, `GATE_PASS_*`, `SECURITY_ALERT_*`. | **PASS** |
| **Backend `REQ-BE-02` status** | Verified `server/src/auth.ts#L215-L218` still contains legacy `req.query.token` fallback. Correctly left untouched in Phase 2 and remains **OPEN** under separate backend task `REQ-BE-02`. | **OPEN (Separate Backend Task)** |

