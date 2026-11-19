# AARIZO — ISSUE-06 Phase B.2.3 — Phase 2 Realtime Security Review

**Reviewed Implementation:** `src/services/sseFrameParser.ts`, `src/services/realtimeService.ts`, `src/context/AuthContext.tsx`

---

## 1. Security Controls Implemented & Verified

| Security Control | Implementation Evidence | Status |
| :--- | :--- | :---: |
| **Bearer Header Auth (Zero JWTs in URLs)** | `realtimeService.ts#L387-L407`: Sends `Authorization: Bearer ${session.token}` via `fetch()`. `buildStreamUrl()` (`#L367-L377`) NEVER appends `token`, `userId`, or `role` to query parameters. Repo scan confirmed `0` `?token=`/`&token=` and `0` native `EventSource` occurrences across `src/`. | **VERIFIED** |
| **No Unauthenticated SSE Connections** | `RealtimeService` constructor (`#L194-L214`) does NOT open any SSE stream (`connectionState = 'OFFLINE'`). `connect()`, `initSseStream()`, and `forceReconnect()` all refuse to connect without a valid token and userId. `AuthContext.tsx#L99-L115` calls `disconnect()` whenever unauthenticated. | **VERIFIED** |
| **Zero Token / Credential Logging** | Neither `realtimeService.ts` nor `sseFrameParser.ts` logs `session.token`, `Authorization` headers, or raw bearer tokens to console or storage. | **VERIFIED** |
| **Stale-Session & Cross-User Isolation** | Monotonic `sessionEpoch` + `connectionGeneration` (`realtimeService.ts#L179-L183`, `#L363-L365`) gate every async fetch resolution, stream chunk read, frame handler, and reconnect timer. Switching users/societies increments `sessionEpoch`, aborts the prior `AbortController`, resets `lastEventId = null`, and clears `seenMessageIds` and `recentMessages`. | **VERIFIED** |
| **Race-Safe HTTP `401` & Non-Retrying `403`** | On `401` (`#L429-L438`), checks `getAuthToken() === session.token` synchronously before `clearAuthSession()` and `aarizo:unauthorized`, preventing delayed stale `401`s from wiping fresh logins, then disconnects permanently. On `403` (`#L441-L448`), stops permanently without wiping a valid session. | **VERIFIED** |
| **Server-Authoritative Event Authorization Preserved** | Frontend never trusts client-supplied role/society for event delivery authorization; backend `isClientAuthorizedForEvent` (`server/src/realtimeEngine.ts`) remains the sole authority. `BroadcastChannel` multi-tab sync (`#L225-L239`) additionally enforces active society match to prevent cross-society tab leakage. | **VERIFIED** |
| **Protected Client Broadcast Boundary (`F-B22-02A`)** | `realtimeService.publish()` (`#L603-L622`) never POSTs `CHILD_*`, `EMERGENCY_*`, `SOS_*`, `GATE_PASS_*`, or `SECURITY_ALERT_*` topics to `/api/realtime/broadcast`. | **VERIFIED** |
| **Parser DoS / Memory Bound Protection** | `SseFrameParser` enforces `maxFrameBytes = 256 KiB` and `maxLineBytes = 128 KiB`, dropping oversized lines/frames safely and recovering at the next frame boundary. `seenMessageIds` is bounded FIFO at `500` entries; `recentMessages` at `50`. | **VERIFIED** |
| **Acyclic Dependency Graph** | `AuthContext.tsx` -> `realtimeService.ts` -> (`authStorage.ts`, `sseFrameParser.ts`). Zero circular imports. | **VERIFIED** |

---

## 2. Tracked Open Backend Requirement (Out of Phase 2 Scope)

- **`REQ-BE-02` (OPEN — Separate Backend Hardening Task):** `server/src/auth.ts#L215-L218` still accepts a legacy `req.query.token` fallback. Phase 2 frontend never sends query-string tokens; removing that backend fallback remains tracked separately as `REQ-BE-02` so Phase 2 stays strictly within frontend scope.

