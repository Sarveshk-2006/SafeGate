# AARIZO — ISSUE-06 Phase B.2.3 — Phase 2 Remediation Parser & Replay Review

**Audit Date:** 2026-11-18  
**Audited Files:** `src/services/sseFrameParser.ts` (278 lines), `src/services/realtimeService.ts#L563-L910` & `#L1017-L1192`, `server/src/realtimeEngine.ts#L215-L455` & `#L565-L609`

---

## 1. `F-P2-02` — WHATWG SSE Parser Re-Audit (`CLOSED — DOES NOT BLOCK PHASE 3`)

Every protocol requirement from WHATWG HTML Living Standard Section 9.2.6 (*Interpreting an event stream*) was verified directly against `src/services/sseFrameParser.ts`:

| Requirement | Status | Verified Code Location & Analysis |
| :--- | :---: | :--- |
| UTF-8 decoding across arbitrary chunk boundaries | **PASS** | `new TextDecoder('utf-8')` (`#L73`) with `decode(chunk, { stream: true })` (`#L86`) and final `decode()` in `finishStream()` (`#L98`). Verified with 1-byte chunk splits on 4-byte emoji + 3-byte Devanagari/Rupee. |
| Leading UTF-8 BOM stripped strictly once at stream start | **PASS** | `private atStreamStart = true` (`#L57`, reset in `reset()` at `#L114`). `#L146-L151` flips `atStreamStart = false` on the first non-empty decoded text and strips at most one leading `0xFEFF`. Mid-stream `\uFEFF` in later chunks/fields is preserved. |
| CR (`\r`), LF (`\n`), CRLF (`\r\n`) & split CRLF across chunks | **PASS** | `trailingCarriageReturn` (`#L59`, `#L157-L170`) cleanly skips `\n` immediately following `\r` even when split across chunks, while dispatching bare `\r` and bare `\n` line terminators properly. |
| Multiline `data:` fields | **PASS** | `currentDataLines.push(value)` (`#L223`), joined with `'\n'` at `#L270`. |
| Comments (`:`) and server heartbeat frames | **PASS** | `if (line[0] === ':') return;` (`#L198-L200`). JSON `{ type: 'PING', timestamp }` frames handled at `realtimeService.ts#L798-L803`. |
| Empty `data:` behavior | **PASS** | `data:` / `data: ` pushes `''` into `currentDataLines` so `finalizeFrame()` returns `{ data: '' }`. `realtimeService.ts#L783` safely skips empty/whitespace JSON frames. |
| Event names (`event:`) | **PASS** | `event:` capped at 128 chars (`#L217-L219`); empty `event:` omits `event` key on emitted frame (`#L269`). |
| Event IDs (`id:`), empty `id:` reset & NUL rejection | **PASS** | `#L226-L240`: rejects `\0`, `\r`, `\n` without modifying `this.currentId`; sets `this.currentId = ''` when `value === ''`; sets trimmed valid ID when `isValidSseEventId(value)` passes (<=128 chars). `finalizeFrame()` (`#L271`) includes `id` whenever `this.currentId !== undefined` (preserving `id: ""`). |
| `retry:` numeric validation | **PASS** | Strictly matches `/^\d+$/` (`#L242`), validates `Number.isFinite(parsed) && parsed >= 0`, caps at `300_000ms` (`#L245`). |
| Incomplete unterminated frame discarded at EOF | **PASS** | `finishStream()` (`#L96-L107`) flushes pending UTF-8 bytes through `processText()` (emitting ONLY frames terminated by an actual blank line), then clears `lineBuffer`, `trailingCarriageReturn`, and `resetFrameState()`. `realtimeService.ts#L738` calls `parser.finishStream()` on `done === true`; `0` `parser.flush()` calls remain. |
| Properly terminated final frame dispatched at EOF | **PASS** | Frames ending with `\n\n`, `\r\r`, or `\r\n\r\n` emit cleanly from `processText()` before EOF discard runs. |
| Oversized lines/frames, recovery & bounded memory | **PASS** | Enforces `maxLineBytes` (`#L173-L175`, default 128 KiB) and `maxFrameBytes` (`#L209-L213`, default 256 KiB). `markOversized()` (`#L129-L139`) immediately frees buffers, ignores remaining lines until next blank line, and cleanly parses subsequent valid frames. |

### Minor Non-Blocking WHATWG Observation
- Per WHATWG SSE §9.2.6, a block containing `id:` or `retry:` with **zero `data:` lines** still updates the stream's last-event-ID / reconnection-time even though no `MessageEvent` is dispatched. In `SseFrameParser.finalizeFrame()` (`#L262-L266`), `currentDataLines.length === 0` resets `currentId` and `currentRetryMs` and returns `null`.
- **Practical Impact:** None for AARIZO — verified `server/src/realtimeEngine.ts#L362-L376` and `#L445` always emit `data:` alongside every `id:` frame and never send standalone data-less `id:` or `retry:` directives. Documented for completeness; does NOT block Phase 3.

---

## 2. `F-P2-04` — Replay Cursor & Event Dispatch Re-Audit (`CLOSED — DOES NOT BLOCK PHASE 3`)

### 2.1 Parser → `processSseFrame()` → `Last-Event-ID` Request Header Trace
1. **Wire Frame Receipt:** `realtimeService.ts#L738, #L746` feeds bytes into `SseFrameParser` and passes completed frames to `processSseFrame()`.
2. **Pre-Dispatch Validation (`#L776-L820`):**
   - Verifies `this.isCurrentStream(epoch, generation)` immediately.
   - Ignores empty/non-JSON frames, non-object JSON, and missing topics.
   - Handles `PING` (`#L798-L803`) and `connected` handshake (`#L807-L814`) BEFORE touching `this.lastEventId` — critically preventing the backend's random handshake UUID (`server/src/realtimeEngine.ts#L241, #L364`) from overwriting a valid outbox `evt_<uuid>` cursor on reconnect.
3. **Cursor Determination (`#L822-L829`):**
   - `explicitCursorReset = frame.id === ''` takes precedence over JSON payload IDs.
   - Otherwise prefers `frame.id` (when defined) before falling back to `data.eventId || data.id`, validated through `isValidSseEventId()`.
4. **Isolated Dispatch (`#L832-L844`, `#L1017-L1192`):**
   - `handleIncomingMessage()` verifies `expectedEpoch === this.sessionEpoch` at entry (`#L1021`) AND before every individual topic subscriber (`#L1149`) and wildcard `*` subscriber (`#L1163`).
   - Alert, topic, and wildcard subscribers each run in independent `try/catch` blocks; a throwing subscriber cannot block sibling subscribers or crash the SSE read loop.
   - If any subscriber throws (`hadSubscriberError === true`), `this.seenMessageIds.delete(msg.id)` (`#L1173-L1176`) removes the failed ID so subsequent server replay is not suppressed.
5. **Post-Dispatch Cursor Commit (`#L846-L853`):**
   ```ts
   if (this.isCurrentStream(epoch, generation) && !dispatchResult.hadSubscriberError) {
     if (explicitCursorReset) {
       this.lastEventId = null;
     } else if (validCursorId) {
       this.lastEventId = validCursorId;
     }
   }
   ```
   - Cursor advances/resets ONLY AFTER dispatch finishes without subscriber errors AND while the same `(epoch, generation)` stream is still active (a subscriber triggering `disconnect()` mid-dispatch cannot resurrect `lastEventId`).
6. **Reconnect Header Transmission (`#L592-L594`):**
   - Sends `headers['Last-Event-ID'] = this.lastEventId` only when non-empty and valid (`isValidSseEventId`), matched by backend `server/src/realtimeEngine.ts#L605` and tenant-scoped replay lookup at `#L398-L408`.
7. **Session Isolation (`#L355-L361`, `#L397-L399`, `#L506-L511`):**
   - `lastEventId` and `seenMessageIds` are preserved on same-identity token refresh and cleared on logout, user switch, society switch, and role switch.

### 2.2 Honest Delivery Guarantee Statement
End-to-end delivery is **best-effort bounded at-least-once replay with session-scoped deduplication** (backend replays up to 50 events / 1-hour fallback window; client deduplicates the last 500 IDs in memory; linear `lastEventId` advances if a later distinct event succeeds on the same open stream). Exactly-once delivery is **not** claimed.

---

## 3. `F-P2-03` — HTTP Response & Reconnect Policy Verification (`CLOSED — DOES NOT BLOCK PHASE 3`)

- **401 (`#L622-L633`):** Cancels body, clears auth session + dispatches `aarizo:unauthorized` ONLY if `getAuthToken() === session.token`, then disconnects with zero retries.
- **403 (`#L635-L645`):** Cancels body, stops permanently (`OFFLINE`), preserves valid auth session, zero retries.
- **408 (`#L647-L652`):** Cancels body, schedules bounded exponential backoff reconnect.
- **429 (`#L654-L659`):** Cancels body, parses delta-seconds (`/^\d+(\.\d+)?$/`) or RFC 7231 HTTP-date via `parseRetryAfterMs()` (`#L78-L104`, capped at `60_000ms`; past dates, negative numbers, `NaN`, `Infinity`, and malformed strings return `undefined` and fall back to bounded exponential backoff — zero tight loops or overflow).
- **Permanent 4xx (`#L662-L670`):** `400`, `404`, `405`, `410`, `422`, etc. cancel body, stop permanently (`OFFLINE`), preserve valid session, zero retries.
- **5xx & Network Failures (`#L604-L609`, `#L673-L681`):** Bounded exponential backoff (`1s → 2s → 4s → ... → 30s` + jitter), honoring `Retry-After` on `503`.
- **Strict 2xx Validation (`#L685-L710`):** Rejects `status !== 200` (e.g., `204`), rejects `Content-Type` media type `!== 'text/event-stream'` (e.g., `text/html`, `application/json`, missing), and rejects missing `body.getReader()` — cancelling body, never marking `CONNECTED`, and scheduling bounded reconnect.
- **Stable Connection Backoff Reset (`#L717-L721`, `#L807-L814`):** Resets `sseErrorCount = 0` on server `connected` handshake or after `stableConnectionMs`; timers cleared on abort, logout, and stream exit.

