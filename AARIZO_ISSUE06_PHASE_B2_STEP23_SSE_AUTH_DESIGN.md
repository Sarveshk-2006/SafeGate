# AARIZO — ISSUE-06 Phase B.2.3: Secure SSE Authentication & Lifecycle Design

**Critical Security Rule:** **NEVER place long-lived JWTs or Firebase ID tokens in SSE query strings (`?token=...`).**  
**Authoritative Backend Verified:** `server/src/auth.ts#L206-L317`, `server/src/realtimeEngine.ts#L215-L259` & `#L565-L609`, `server/src/index.ts#L77` & `#L214`

---

## 1. Security Trade-Off Analysis: Two Sanctioned SSE Authentication Architectures

Native browser `EventSource` cannot attach custom `Authorization: Bearer` headers. There are only two secure ways to authenticate SSE without putting long-lived JWTs in URLs:

| Evaluation Criterion | Option 1: Fetch-Based Authenticated SSE Streaming (`Authorization: Bearer` + `ReadableStream`) | Option 2: Short-Lived Single-Use Server-Issued SSE Ticket (`POST /api/realtime/ticket` + `EventSource(?ticket=...)`) |
| :--- | :--- | :--- |
| **Long-lived JWT in URL / access logs / browser history / proxies?** | **NO — ZERO tokens in URL.** Token stays strictly in `Authorization: Bearer` request header. | **NO long-lived JWT in URL** (only a 15–30s single-use opaque ticket in URL, though opaque ticket still appears in access logs). |
| **Works with existing verified B.2.2 backend right now?** | **YES — ZERO backend changes required!** Verified directly:<br>1. `server/src/auth.ts#L212-L214` extracts `req.headers.authorization` (`Bearer <token>`) FIRST.<br>2. `server/src/realtimeEngine.ts#L605` reads `req.headers['last-event-id']` FIRST.<br>3. `server/src/index.ts#L77` runs `app.use(cors())`, allowing `Authorization` & `Last-Event-ID` headers across origins. | **NO — Requires backend changes** (new `POST /api/realtime/ticket` endpoint, server-side single-use TTL store or Redis/DB table, and ticket verification in `authenticateToken`/`handleSseSubscription`). |
| **HTTP status code visibility (`401` vs `403` vs `429` vs `503`)?** | **FULL visibility** (`response.status` inspected before reading body). Immediately distinguishes expired session (`401` -> logout), tenant/role denial (`403` -> stop), and transient outage (`503` -> exponential backoff). | **NONE** — native `EventSource.onerror` hides HTTP status codes, making `401`/`403` indistinguishable from network drops. |
| **Clean `Last-Event-ID` header replay on reconnect?** | **YES** — sent cleanly in `Last-Event-ID` request header (not URL) and reset atomically on logout/user switch. | Native `EventSource` sends `Last-Event-ID` on automatic reconnects, but cannot supply a fresh single-use ticket on auto-reconnect without manual teardown and re-ticket round-trip! |
| **Capacitor Android / Modern Browsers / Vite compatibility?** | **YES** — `fetch()` + `ReadableStream` (`TextDecoder` + `AbortController`) is universally supported across Chrome, Safari, Firefox, Edge, and Capacitor Android WebView. | Supported, but adds an extra HTTP round-trip on every reconnect. |
| **Implementation Complexity** | Low (~120 lines well-tested SSE frame parser in `src/services/realtimeService.ts`, zero new npm packages). | Higher (backend ticket endpoint + state cleanup + client two-step connect + manual reconnect loop anyway). |

### Final Architectural Decision for Phase B.2.3

**SELECT Option 1: Fetch-Based Authenticated SSE Streaming (`Authorization: Bearer` + `Last-Event-ID` headers) as the canonical B.2.3 architecture.**

- **Zero backend changes required for B.2.3.**
- **Zero credentials in any URL query string.**
- **Full `401`/`403`/`503` control and clean `AbortController` teardown.**
- **Separate Optional Backend Hardening Task (`REQ-BE-02`):** After B.2.3 completes, a dedicated backend task can remove the legacy `req.query.token` fallback in `server/src/auth.ts#L215-L218` so no client can ever pass a long-lived JWT in a query string (and optionally add short-lived single-use SSE tickets ONLY if a non-Fetch native `EventSource` client is ever introduced).

---

## 2. Fetch-Based SSE Protocol & Frame Parser Specification

The Fetch SSE client (`src/services/realtimeService.ts`) must conform strictly to the WHATWG Server-Sent Events specification:

1. **Request Construction:**
   ```ts
   const params = new URLSearchParams();
   // Platform admin only: optional concrete target societyId; society-bound users omit or send their verified societyId
   if (targetSocietyId && targetSocietyId !== '*' && targetSocietyId !== 'soc-platform') {
     params.set('societyId', targetSocietyId);
   }
   const url = `${API_BASE_URL}/api/realtime/stream${params.toString() ? `?${params.toString()}` : ''}`;

   const headers: Record<string, string> = {
     Accept: 'text/event-stream',
     Authorization: `Bearer ${token}`,
     'Cache-Control': 'no-cache',
   };
   if (this.lastEventId) {
     headers['Last-Event-ID'] = this.lastEventId;
   }

   const response = await fetch(url, {
     method: 'GET',
     headers,
     signal: controller.signal,
   });
   ```
   - **Never** appends `?token=...` or `?lastEventId=...` to the URL.
   - **Never** sends spoofed `x-society-id` / `x-user-id` / `x-user-role` headers.

2. **Incremental UTF-8 Frame Parsing:**
   - Read chunks via `response.body.getReader()` + `new TextDecoder('utf-8')` with `{ stream: true }`.
   - Split normalized lines (`\r\n`, `\r`, `\n`), accumulating `event:`, `id:`, `data:` (multi-line joined with `\n`), and ignoring comment heartbeats (`: keep-alive`).
   - Dispatch frame on blank line (`''`):
     - If `id` is non-empty and does not contain `\0`, store `this.lastEventId = id`.
     - Parse JSON `data` safely (ignore malformed frames without crashing the stream).
     - Ignore `event === 'connected'` handshake for user toasts (use it to transition status to `'CONNECTED'` and reset backoff attempt counter to `0`).
     - Deduplicate by `eventId` (`id || parsed.eventId`) via bounded `Set` (FIFO cap 500 entries) so paired replay + live frames never double-fire.

---

## 3. Complete Connection Lifecycle Specification

| Lifecycle Transition | Exact Required Behavior |
| :--- | :--- |
| **1. App Startup (Unauthenticated)** | `RealtimeService` constructor does **NOT** open any SSE stream. Connection state starts `'DISCONNECTED'`. |
| **2. Login / Session Hydration (`AuthContext` -> `AUTHENTICATED`)** | `AuthContext` `useEffect` observes `(status, currentUser?.id, currentUser?.societyId, tokenVersion)` and calls `realtimeService.connect({ userId: currentUser.id, societyId: currentUser.societyId, role: currentUser.role, token: getAuthToken() })`. |
| **3. Duplicate Subscription Prevention** | `connect()` tracks an active `connectionKey = `${userId}:${societyId}:${tokenHashOrSuffix}`` and monotonic `generationId`. If already `'CONNECTING'` or `'CONNECTED'` with the identical `connectionKey`, `connect()` is a no-op! If `connectionKey` changed, `connect()` first aborts the prior `AbortController` and clears any pending reconnect timer before opening the new stream. |
| **4. Firebase Token Refresh (`onIdTokenChanged`)** | When `AuthContext.tsx#L199-L202` calls `updateAuthToken(refreshedToken, 'firebase')`, increment a `tokenRevision` state (or emit `aarizo:token-refreshed`) -> `realtimeService.connect(...)` cleanly aborts the old Fetch stream and immediately opens a fresh stream with the new `Authorization: Bearer <refreshedToken>` while **preserving `lastEventId`** so zero events are missed across the handover! |
| **5. Society or User Switching** | If `userId` or `societyId` changes (`newKey.userId !== prevUserId || newKey.societyId !== prevSocietyId`): **MUST reset `this.lastEventId = null` AND clear `this.seenEventIds.clear()`** before connecting, preventing any stale cursor from being sent across user/society boundaries (in addition to backend `F-B22-02C` enforcement). |
| **6. Logout (`AuthContext.logout()`) & Multi-Tab Token Removal** | Immediately calls `realtimeService.disconnect()`: aborts active `AbortController`, cancels reconnect timer, sets status `'DISCONNECTED'`, resets `lastEventId = null`, clears `seenEventIds`, and clears `activeSession` metadata. |
| **7. HTTP `401 Unauthorized` on SSE Connect** | Abort stream, **DO NOT RECONNECT**, call `clearAuthSession()`, dispatch `aarizo:unauthorized` -> `AuthContext` transitions to `UNAUTHENTICATED`. |
| **8. HTTP `403 Forbidden` on SSE Connect** | Abort stream, **DO NOT RECONNECT** (account suspended or missing tenant context), set status `'DISCONNECTED'`, surface non-retrying permission error state. |
| **9. Transient `5xx` / `503` / Network Drop / Stream EOF** | Transition status to `'RECONNECTING'`. Check `isSessionValid() && getAuthToken()` before scheduling reconnect. Use jittered exponential backoff: `min(30_000, 1_500 * 2^attempt) + random(0..750)ms`. Send preserved `Last-Event-ID` header on reconnect. |
| **10. Browser Online / Tab Foreground Resume** | On `window` `'online'` event (or Capacitor `appStateChange` active), if authenticated and currently `'RECONNECTING'`, cancel long backoff timer and trigger an immediate single reconnect attempt. |
| **11. Server Event Authorization (Defense-in-Depth)** | Backend `isClientAuthorizedForEvent()` enforces strict tenant, role, and owner `targetUserIds` filtering before writing bytes. On the frontend, `BroadcastChannel` multi-tab sync MUST verify incoming message `societyId === activeSocietyId` and `userId === activeUserId` before relaying locally. |
| **12. Client `publish()` Guard** | `realtimeService.publish()` MUST block any attempt to POST protected event families (`CHILD_*`, `EMERGENCY_*`, `SOS_*`, `GATE_PASS_*`, `SECURITY_ALERT_*`) to `/api/realtime/broadcast` (since B.2.2 rejects them with `403`). Child Safety & Emergency realtime events originate **strictly from verified backend database commits**. |

---

## 4. Event Routing, Deduplication & Notification Preservation

- **Preserved Existing Sound & Toast Notifications:**
  - `CHILD_SAFETY_SOS_TRIGGERED` & `EMERGENCY_INCIDENT_CREATED` -> triggers `playEmergencySiren()` + critical red toast (deduplicated via 250ms paired-event window so one SOS plays **one** siren).
  - `CHILD_EXIT_DENIED` -> triggers alert tone + high-priority warning toast.
  - `CHILD_GATE_PASS_GENERATED` / `CHILD_GATE_PASS_VERIFIED` / `CHILD_EXIT_TRIGGERED` -> triggers `playGateBeep()` + confirmation toast (deduplicated between `VERIFIED` & `EXIT_TRIGGERED`).
- **Fixed Deep-Link Routing (Checked BEFORE Generic `GATE` Topic):**
  - Any `CHILD_*` event routes by authenticated user role:
    - `resident` -> `/resident/child-safety`
    - `guard` -> `/security/child-safety`
    - `secretary` / `committee` / `admin` -> `/admin/child-safety`
  - Fixes existing bug (`realtimeService.ts#L332`) where `CHILD_GATE_PASS_*` matched `topicUpper.includes('GATE')` and misrouted users to `/resident/deliveries`.
- **Connection Health Badge:** Expose `realtimeService.onConnectionStateChange(cb)` so `ChildGateScannerPage` and `AdminChildSafetyPage` render an honest `Live` (green) vs `Reconnecting...` (amber) vs `Offline` (red) status indicator.

