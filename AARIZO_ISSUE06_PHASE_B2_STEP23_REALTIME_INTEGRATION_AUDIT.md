# AARIZO — ISSUE-06 Phase B.2.3: Realtime / SSE Integration Audit

**Audited Files:**
- Frontend: `src/services/realtimeService.ts` (500 lines), `src/services/realTimeSync.ts` (12 lines), `src/context/AuthContext.tsx` (371 lines), `src/services/authStorage.ts` (309 lines), `src/pages/dashboard/security/ChildGateScannerPage.tsx`, `src/pages/dashboard/admin/AdminChildSafetyPage.tsx`, `src/pages/dashboard/security/SecurityEmergencyTerminalPage.tsx`, `src/services/childSafetyService.ts`
- Backend: `server/src/realtimeEngine.ts`, `server/src/index.ts#L213-L320`, `server/src/childSafety/router.ts#L102-L137`

---

## 1. Verified Defects in Current Frontend Realtime Implementation

### Defect RT-01 (CRITICAL): Unauthenticated `EventSource` Connection (`401` Infinite Reconnect Loop)
- **Source:** `src/services/realtimeService.ts#L97`, `#L122-L145`
- **What happens today:**
  1. `RealtimeService`'s constructor immediately invokes `this.initSseStream()` at module import time — **before** authentication completes — with `this.activeSocietyId = 'soc-gvs'`.
  2. `initSseStream()` opens `new EventSource(\`${API_BASE_URL}/api/realtime/stream?societyId=...\`)` with **NO `?token=<jwt>` query parameter**.
  3. Backend `GET /api/realtime/stream` (`authenticateToken` + `handleSseSubscription`) strictly requires a valid Bearer JWT via `Authorization` header or `?token=` query parameter (standard browser `EventSource` cannot set custom `Authorization` headers, so `?token=` is the sanctioned SSE path).
  4. Result: Every SSE connection fails immediately with `401 AUTH_TOKEN_MISSING`, triggers `eventSource.onerror`, and loops forever (`scheduleReconnect()`).
- **Also missing in `AuthContext.tsx`:** `AuthContext.tsx` NEVER calls `realtimeService.initSseStream()` on login/session restore/Firebase token refresh, and NEVER calls `realtimeService.disconnect()` on `logout()` or `aarizo:unauthorized`.

### Defect RT-02 (CRITICAL): Client-Side Broadcasts Blocked by Backend B.2.2 (`403 PROTECTED_EVENT_TYPE_FORBIDDEN`)
- **Source:** `src/services/realtimeService.ts#L277`, `src/services/childSafetyService.ts#L583` & `#L615`, `src/pages/dashboard/security/SecurityEmergencyTerminalPage.tsx#L82` & `#L100`
- **What happens today:**
  - `realtimeService.publish()` sends `POST /api/realtime/broadcast` for `EMERGENCY_ALERTS`, `CHILD_SAFETY_UPDATED`, `CHILD_EXIT_SCANNED`, `CHILD_ALERT_TRIGGERED`.
  - Under B.2.2 (`F-B22-02A`, `server/src/index.ts#L217-L290`), `POST /api/realtime/broadcast` enforces a strict deny-by-default role allowlist AND explicitly blocks ALL `CHILD_*`, `EMERGENCY_*`, `SOS_*`, and `GATE_PASS_*` events (`403 PROTECTED_EVENT_TYPE_FORBIDDEN`), plus blocks `resident` role completely (`403 INSUFFICIENT_PERMISSIONS`).
- **Required Fix:** Remove ALL frontend `realtimeService.publish()` calls for Child Safety and Emergency events. Server-side Child Safety routes already emit verified, society-scoped, audience-filtered SSE events after PostgreSQL commit via `emitChildSafetyEvent()`.

### Defect RT-03 (HIGH): Complete Event Name Mismatch Between Backend & Frontend
- **Current frontend listeners listen for nonexistent legacy names:**
  - `ChildGateScannerPage.tsx#L39`: `CHILD_ALERT_TRIGGERED`, `CHILD_EXIT_SCANNED`, `CHILD_SAFETY_UPDATED`, `EMERGENCY_ALERTS`
  - `SecurityEmergencyTerminalPage.tsx#L44`: `EMERGENCY_ALERTS`, `CHILD_ALERT_TRIGGERED`, `event.type.includes('EMERGENCY')`
  - `AdminChildSafetyPage.tsx`: **ZERO realtime listeners**
  - `SafetyCommandHub.tsx`: **ZERO realtime listeners** (relies on manual `loadData()` only!)
- **Actual B.2.2 backend events (15 total):**
  1. `CHILD_PROFILE_CREATED`
  2. `CHILD_PROFILE_UPDATED`
  3. `CHILD_PROFILE_ARCHIVED`
  4. `CHILD_PICKUP_AUTHORIZED`
  5. `CHILD_PICKUP_UPDATED`
  6. `CHILD_PICKUP_REVOKED`
  7. `CHILD_GATE_PASS_GENERATED`
  8. `CHILD_GATE_PASS_REVOKED`
  9. `CHILD_GATE_PASS_VERIFIED`
  10. `CHILD_EXIT_TRIGGERED`
  11. `CHILD_EXIT_DENIED`
  12. `CHILD_SAFETY_SOS_TRIGGERED`
  13. `EMERGENCY_INCIDENT_CREATED`
  14. `CHILD_SAFETY_ALERT_ACKNOWLEDGED`
  15. `CHILD_SAFETY_ALERT_RESOLVED`

### Defect RT-04 (MEDIUM): Broken Audio Siren & Notification Deep-Link Routing in `realtimeService.ts`
- **Source:** `src/services/realtimeService.ts#L325-L343`
- **Issues:**
  1. Emergency siren only triggers when `topicUpper.includes('EMERGENCY')` (`#L326`) — misses `CHILD_SAFETY_SOS_TRIGGERED` and `CHILD_EXIT_DENIED`!
  2. Deep-link router checks `topicUpper.includes('GATE')` (`#L332`) BEFORE child-safety checks, misrouting `CHILD_GATE_PASS_GENERATED` / `CHILD_GATE_PASS_VERIFIED` / `CHILD_GATE_PASS_REVOKED` to `/resident/deliveries` instead of role-appropriate `/resident/child-safety`, `/security/child-safety`, or `/admin/child-safety`!
  3. `lastEventId` is stored in memory across sessions (`#L72`); if a user logs out and another user logs in on the same browser tab, stale `lastEventId` must be cleared so no cross-user cursor is ever sent (even though backend `F-B22-02C` already ignores cross-tenant cursors).

### Defect RT-05 (MEDIUM): `BroadcastChannel` Multi-Tab Leaks & Duplicate Notifications
- `realtimeService.ts#L103-L115` relays `BroadcastChannel` messages without checking whether the active authenticated `societyId` matches, and `ChildGateScannerPage` + `SecurityEmergencyTerminalPage` also run 5-second `setInterval` polls that hammer localStorage (if naively converted to API calls, 5s polling would cause unnecessary load and risk rate limits).

---

## 2. Authoritative Backend-to-Frontend Event Subscription Map

| Backend Event Type | Server Audience Policy (`server/src/childSafety/router.ts`) | Resident Portal (`ResidentChildSafetyPage` / `SafetyCommandHub`) | Security Portal (`ChildGateScannerPage` / `SecurityEmergencyTerminalPage`) | Admin Portal (`AdminChildSafetyPage`) | Audio / Toast UX |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `CHILD_PROFILE_CREATED` | `secretary`, `committee`, `admin` + owner | Refresh `GET /api/children` | *(Not delivered to guard)* | Refresh `GET /api/children` | Info toast |
| `CHILD_PROFILE_UPDATED` | `secretary`, `committee`, `admin` + owner | Refresh `GET /api/children` | *(Not delivered to guard)* | Refresh `GET /api/children` | Subtle toast (highlight status change) |
| `CHILD_PROFILE_ARCHIVED` | `secretary`, `committee`, `admin` + owner | Refresh `GET /api/children` & `/passes` | *(Not delivered to guard)* | Refresh `GET /api/children` | Info toast |
| `CHILD_PICKUP_AUTHORIZED` | `secretary`, `committee`, `admin` + owner | Refresh `GET /api/children` (or child pickups) | *(Not delivered to guard)* | Refresh `GET /api/children` | Info toast |
| `CHILD_PICKUP_UPDATED` | `secretary`, `committee`, `admin` + owner | Refresh pickups | *(Not delivered to guard)* | Refresh pickups | Info toast |
| `CHILD_PICKUP_REVOKED` | `secretary`, `committee`, `admin` + owner | Refresh pickups & `/passes` | *(Not delivered to guard)* | Refresh pickups | Warning toast |
| `CHILD_GATE_PASS_GENERATED` | `guard`, `secretary`, `committee`, `admin` + owner | Refresh `GET /api/children/passes` | Refresh active passes list (`GET /api/children/passes`) | Refresh passes summary | Standard chime (`playGateBeep`) |
| `CHILD_GATE_PASS_REVOKED` | `guard`, `secretary`, `committee`, `admin` + owner | Refresh `GET /api/children/passes` | Remove from active passes (`GET /api/children/passes`) | Refresh passes summary | Warning toast |
| `CHILD_GATE_PASS_VERIFIED` | `guard`, `secretary`, `committee`, `admin` + owner | Refresh `GET /api/children`, `/passes`, `/exit-logs` | Refresh `/passes` & `/exit-logs` | Refresh `/children` & `/exit-logs` | Success toast ("Child exit verified") |
| `CHILD_EXIT_TRIGGERED` | `guard`, `secretary`, `committee`, `admin` + owner | Refresh `GET /api/children` & `/exit-logs` (deduped with `VERIFIED`) | Refresh `/exit-logs` (deduped) | Refresh `/children` & `/exit-logs` (deduped) | Guard/Parent chime |
| `CHILD_EXIT_DENIED` | `guard`, `secretary`, `committee`, `admin` + owner | Refresh `/exit-logs` + show red alert toast | Refresh `/exit-logs` + show denial alert | Refresh `/exit-logs` + alert toast | High-priority alert chime |
| `CHILD_SAFETY_SOS_TRIGGERED` | `guard`, `secretary`, `committee`, `admin` + owner | Refresh `/children` & `/alerts` + critical banner | Refresh `/alerts` + critical flashing banner + siren | Refresh `/children` & `/alerts` + critical banner + siren | **Emergency Siren (`playEmergencySiren`)** |
| `EMERGENCY_INCIDENT_CREATED` | `guard`, `secretary`, `committee`, `admin` + owner | Refresh alerts (deduped with SOS) | Refresh `SecurityEmergencyTerminalPage` & `/alerts` | Refresh `/alerts` | **Emergency Siren** (deduped) |
| `CHILD_SAFETY_ALERT_ACKNOWLEDGED` | `guard`, `secretary`, `committee`, `admin` + owner | Refresh `/alerts` ("Security acknowledged alarm") | Refresh `/alerts` | Refresh `/alerts` | Confirmation chime |
| `CHILD_SAFETY_ALERT_RESOLVED` | `guard`, `secretary`, `committee`, `admin` + owner | Refresh `/children` & `/alerts` | Refresh `/alerts` | Refresh `/children` & `/alerts` | Resolution confirmation toast |

---

## 3. Target SSE Lifecycle, Deduplication & Reconnect Strategy for B.2.3

1. **Authenticated Connection Lifecycle (`AuthContext.tsx` <-> `realtimeService.ts`):**
   - Do **NOT** auto-connect `EventSource` in `RealtimeService` constructor when unauthenticated.
   - Export `realtimeService.connect({ societyId, token })` and `realtimeService.disconnect()` (closing `EventSource`, clearing pending reconnect timers, and resetting `lastEventId = null`).
   - In `AuthContext.tsx`:
     - When `status === 'AUTHENTICATED'` and a valid `getAuthToken()` exists -> call `realtimeService.connect({ societyId: currentUser.societyId, token })`.
     - When Firebase `onIdTokenChanged` silently refreshes the token -> reconnect SSE cleanly with the refreshed token.
     - On `logout()`, `aarizo:unauthorized`, or multi-tab token removal -> call `realtimeService.disconnect()`.
   - Build SSE URL as:
     ```ts
     const params = new URLSearchParams();
     params.set('token', token);
     if (societyId && societyId !== '*') params.set('societyId', societyId);
     if (this.lastEventId) params.set('lastEventId', this.lastEventId);
     // EventSource(`${API_BASE_URL}/api/realtime/stream?${params.toString()}`)
     ```
2. **Exponential Backoff & Auth-Failure Stop:**
   - Reconnect with jittered exponential backoff (`2s -> 4s -> 8s -> 16s -> max 30s`) while `isSessionValid()` and `getAuthToken()` are present.
   - If session is invalid/cleared, stop reconnecting immediately instead of looping on `401`.
   - Expose connection status (`CONNECTED` | `RECONNECTING` | `DISCONNECTED`) via a lightweight listener so `ChildGateScannerPage` and `AdminChildSafetyPage` can show an honest **"Live Stream Connected"** vs **"Reconnecting..."** badge (never faking green "Live" when offline!).
3. **Debounced / Deduplicated Refetching:**
   - Because `POST /api/children/passes/verify` emits BOTH `CHILD_GATE_PASS_VERIFIED` and `CHILD_EXIT_TRIGGERED` in sequence (and `POST /api/children/sos` emits BOTH `CHILD_SAFETY_SOS_TRIGGERED` and `EMERGENCY_INCIDENT_CREATED`), wrap page-level API refreshes in a **250ms trailing debounce** keyed by resource (`children`, `passes`, `exitLogs`, `alerts`) and track seen `event.id` values in a bounded `Set` (max 500 entries) so double-emitted paired events trigger **one** refresh and **one** siren/toast.
4. **Polling Reduction (Safety Net Only):**
   - Replace aggressive 5-second `localStorage` polling with event-driven SSE refreshes, plus a conservative **60-second fallback sync** only when SSE state is `RECONNECTING`/`DISCONNECTED` (or on browser `visibilitychange` -> `visible` / `online` event).
5. **Fix Topic Routing & Siren Triggers (`realtimeService.ts`):**
   - Route `CHILD_*` topics BEFORE generic `GATE` checks:
     - `resident` -> `/resident/child-safety`
     - `guard` -> `/security/child-safety`
     - `secretary`/`admin`/`committee` -> `/admin/child-safety`
   - Trigger emergency siren on `CHILD_SAFETY_SOS_TRIGGERED`, `EMERGENCY_INCIDENT_CREATED`, and `CHILD_EXIT_DENIED` (short alert chime).
   - Never log or display raw tokens; backend SSE payloads already omit `bearerToken`, `tokenHash`, and `idDocumentHash`.

