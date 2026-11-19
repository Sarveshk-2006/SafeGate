# AARIZO — ISSUE-06 Phase B.2.3 (Phase 2) Remediation Security Review

**Date:** 2026-11-18  
**Repository:** `D:\AAZIRA\AARIZO`  
**Scope:** Security verification of Phase 2 Remediation (`F-P2-01` through `F-P2-06`)

---

## 1. Static Security Scan Results (`src/`)

| Check | Target Scope | Pattern Checked | Result |
| --- | --- | --- | --- |
| Native `EventSource` usage | `src/**/*.{ts,tsx}` | `EventSource` | **0 matches** |
| Query-string token transmission | `src/**/*.{ts,tsx}` | `?token=`, `&token=`, `params.set('token')`, `searchParams.set('token')` | **0 matches** |
| Raw JWT / `Authorization` / `Bearer` logging | `src/services/realtimeService.ts`, `src/services/sseFrameParser.ts`, `src/context/AuthContext.tsx` | `console.*(token\|Authorization\|Bearer)` | **0 secret leaks** (2 pre-existing `AuthContext.tsx` error logs log missing claims / exception only, never raw JWT or header values) |
| Legacy `parser.flush()` references | `src/services/realtimeService.ts`, `src/services/sseFrameParser.ts` | `\bflush\s*\(` | **0 matches** |

---

## 2. Security Control Verification by Threat Vector

### 2.1 Cross-Tab & Unauthenticated Injection via `BroadcastChannel` (`F-P2-01`)
- **Logged-Out Isolation:** `BroadcastChannel` is no longer created in `RealtimeService` constructor (`src/services/realtimeService.ts#L209-L227`). It is opened exclusively inside `connect()` / `forceReconnect()` when `this.activeSession && getAuthToken()` hold, and synchronously detached (`onmessage = null`) and closed (`close()`) inside `disconnect()`, `destroy()`, and identity switches (`#L233-L241`).
- **Protected Event Boundary:** Outbound `publish()` (`#L958-L972`) and inbound `channel.onmessage` (`#L266-L273`) both enforce `isProtectedBroadcastTopic()`, blocking `CHILD_*`, `EMERGENCY_*`, `SOS_*`, `GATE_PASS_*`, `SECURITY_ALERT_*`, and `RESIDENT_PRIVATE_*` from ever traversing `BroadcastChannel` or `/api/realtime/broadcast`.
- **Tenant Fail-Closed Enforcement:** Inbound cross-tab messages without a non-empty string `societyId` or whose `societyId` does not match the active authenticated session's `societyId` (for non-platform-admin roles) are rejected (`#L276-L290`).
- **Replay Cursor Integrity:** `BroadcastChannel` handlers invoke `handleIncomingMessage()` only and have zero write path to `this.lastEventId`. Server SSE replay cursors can only be set by validated frames from the authenticated Fetch SSE stream (`processSseFrame()`).

### 2.2 Stream Protocol Spoofing & Premature EOF Integrity (`F-P2-02`, `F-P2-03`)
- **WHATWG SSE EOF Discard:** Premature stream termination or truncated TCP chunks never emit partial/corrupted domain events because `parser.finishStream()` (`src/services/sseFrameParser.ts#L96-L107`) flushes pending UTF-8 bytes without fabricating a blank-line terminator and discards incomplete buffers.
- **BOM & Event-ID Hygiene:** Only one optional leading UTF-8 BOM at stream byte 0 is stripped (`atStreamStart` flag, `#L146-L151`). NUL/CR/LF-containing or oversized (>128 char) `id:` values are rejected (`#L226-L240`); explicit empty `id:` resets `lastEventId` to `null` post-dispatch (`src/services/realtimeService.ts#L822-L853`).
- **Strict HTTP Streaming Validation:** Non-`200` `2xx` responses (`204 No Content`) and non-`text/event-stream` responses (e.g., captive-portal `text/html`, proxy `application/json`, missing `Content-Type`) are rejected before transitioning to `'CONNECTED'`, with their response bodies cancelled (`#L685-L710`).
- **Permanent Client Error Containment & Backoff Hardening:** `400`, `404`, `405`, `410`, `422` stop permanently in `'OFFLINE'` without hammering the backend or wiping valid sessions (`#L662-L670`). `Retry-After` rejects negative, malformed, or past-date tight-loop triggers (`#L78-L104`).

### 2.3 Replay Cursor Reliability & Subscriber Isolation (`F-P2-04`)
- `this.lastEventId` is committed strictly AFTER `handleIncomingMessage()` finishes AND `this.isCurrentStream(epoch, generation)` still holds AND `!dispatchResult.hadSubscriberError` (`src/services/realtimeService.ts#L846-L853`).
- If a subscriber throws, other subscribers still execute normally, `this.lastEventId` does not advance past the failed event, and `msg.id` is removed from `seenMessageIds` (`#L1173-L1176`) so server replay can recover without silent data loss.
- If a subscriber triggers `disconnect()` during dispatch, `isCurrentStream()` returns `false` and prevents resurrecting a cleared `lastEventId`.

### 2.4 Authentication Teardown Race Elimination (`F-P2-05`)
- In `src/context/AuthContext.tsx`, Firebase sign-out (`!firebaseUser`, lines `#L209-L225`) and every Firebase claim/profile/init failure branch (`#L254`, `#L264`, `#L295`, `#L317`) synchronously invoke `realtimeService.disconnect()` **before** `clearAuthSession()` or state transition.
- Verified via direct execution of `AuthProvider` (`tests/issue06_b23_auth_realtime_lifecycle.test.ts`): `AbortController.abort()` is already `true` before `clearAuthSession()` executes, and late events pushed on the old stream are dropped without invoking callbacks or mutating `lastEventId`.

### 2.5 Preserved Backend & Pre-Cutover Risk Posture
- `REQ-BE-02` (backend legacy `req.query.token` fallback in `server/src/auth.ts#L215-L218`) remains OPEN as a tracked backend follow-up item and was intentionally NOT modified in this frontend Phase 2 remediation.
- Frontend never emits query-string tokens (`0` matches across `src/`), transmitting JWTs exclusively in `Authorization: Bearer <token>`.
- All Phase 1 security boundaries (strict one-time `bearerToken`/`qrPayload` DTO validation, race-safe 401 handling, zero silent error swallowing) remain untouched and verified (42/42 Phase 1 tests passing).

---

**Security Assessment:** All six Phase 2 audit findings (`F-P2-01` through `F-P2-06`) are remediated with zero regressions and clean scope isolation. Ready for independent re-audit.

