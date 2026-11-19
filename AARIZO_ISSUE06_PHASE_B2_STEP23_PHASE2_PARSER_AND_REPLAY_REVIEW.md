# AARIZO — ISSUE-06 Phase B.2.3 — Phase 2 Parser & Replay Review

**Audited Files:** `src/services/sseFrameParser.ts` (267 lines), `src/services/realtimeService.ts#L585-L770`, `server/src/realtimeEngine.ts#L240-L455` & `#L565-L609`

---

## 1. WHATWG SSE Parser Audit (`src/services/sseFrameParser.ts`)

| Check | Status | Verified Code Analysis |
| :--- | :---: | :--- |
| 1. UTF-8 decoding across arbitrary chunk boundaries | **PASS** | Uses `TextDecoder('utf-8')` with `{ stream: true }` (`#L78`); verified with 1-byte split test on 4-byte emoji + 3-byte Devanagari/Rupee. |
| 2. CRLF, LF, CR line endings & split CRLF | **PASS** | `trailingCarriageReturn` flag (`#L154-L164`) handles `\r\n` split across chunks as well as bare `\r` and `\n`. |
| 3. Multiline `data:` & empty `data:` fields | **PASS** | `currentDataLines.push(value)` joined with `'\n'` (`#L220`, `#L258`); empty `data:` pushes `''` and dispatches `{ data: '' }`. |
| 4. Comments (`:`) and `PING` heartbeats | **PASS** | Lines starting with `:` are ignored (`#L195-L197`); server `{"type":"PING"}` frames handled at `realtimeService.ts#L673-L678`. |
| 5. `event:` & `retry:` parsing | **PASS** | `event:` capped at 128 chars; `retry:` strictly matches `/^\d+$/` and caps at `300_000ms` (`#L230-L235`). |
| 6. **End-of-stream incomplete frame handling (`F-P2-02`)** | **DEFECT (HIGH)** | `SseFrameParser.flush()` (`#L86-L103`) called at `realtimeService.ts#L611` on `done === true` forces `processLine(this.lineBuffer)` + `finalizeFrame()`, **dispatching incomplete unterminated frames** on premature TCP/stream EOF. Violates WHATWG SSE Section 9.2.6 (*"Once the end of the file is reached, any pending data must be discarded"*). |
| 7. **Leading UTF-8 BOM handling (`F-P2-02`)** | **DEFECT (MEDIUM)** | `#L141-L148` checks `lineBuffer.length === 0 && currentFrameBytes === 0 && currentDataLines.length === 0 && text.charCodeAt(0) === 0xfeff`. Because `resetFrameState()` resets all three after EVERY completed frame, a mid-stream `\uFEFF` at the start of a subsequent chunk is erroneously stripped instead of stripping BOM ONLY once at the start of the stream (`atStreamStart` boolean). |
| 8. **`id:` empty-reset semantics (`F-P2-02`)** | **MINOR GAP** | `#L223-L228` ignores `id:` when empty instead of distinguishing empty `id:` (reset) vs invalid `id:` containing `\0`/newlines/>128 chars. |
| 9. Oversized lines/frames & memory bounds | **PASS** | Enforces `maxLineBytes` (`#L170-L172`) and `maxFrameBytes` (`#L207-L210`), drops accumulated frame bytes immediately, skips until next blank line, and cleanly resumes on subsequent valid frames. |

### Required Correction for `F-P2-02`
1. On stream EOF (`done === true` in `realtimeService.ts#L610-L616`), call `parser.reset()` and **discard** any incomplete unterminated frame rather than calling `parser.flush()` to dispatch it. (Keep `flush()` strictly for explicit test/utility use OR make `flush()` finalize decoder only without dispatching unterminated frames.)
2. Add `private atStreamStart = true;` to `SseFrameParser` (set `false` on first non-empty decoded text; reset to `true` in `reset()`) so leading `\uFEFF` is stripped at most once at the start of the stream.

---

## 2. `Last-Event-ID`, Replay & Cursor Integrity Audit (`F-P2-04`)

### Verified Backend Replay Contract (`server/src/realtimeEngine.ts#L386-L435`, `#L605`)
- Backend emits `id: evt_<uuid>` on outbox events and reads `(req.headers['last-event-id'] as string)` on reconnect.
- Backend scopes `outboxEvent.findFirst({ where: { eventId: normalizedCursor, societyId: clientSoc } })` strictly to the authenticated client's society (tenant-safe) and replays up to 50 missed events with `isClientAuthorizedForEvent()` filtering.
- Note on delivery guarantee: Because replay is capped at 50 events / 1-hour fallback window and client memory deduplicates the last 500 IDs, the end-to-end guarantee is **best-effort bounded at-least-once replay with session-scoped deduplication** (NOT unbounded exactly-once delivery).

### Confirmed Cursor Ordering Defect (`F-P2-04` — MEDIUM — BLOCKS PHASE 3)
- **Location:** `src/services/realtimeService.ts#L695-L715`
- **Observed Code:**
  ```ts
  const candidateEventId = frame.id || data.eventId || data.id;
  const validCursorId = isValidSseEventId(candidateEventId) ? candidateEventId.trim() : undefined;
  if (validCursorId) {
    this.lastEventId = validCursorId; // <-- Advanced BEFORE dispatch!
  }
  this.handleIncomingMessage({ ... }, epoch);
  ```
- **Defect & Impact:** `this.lastEventId` is updated BEFORE `handleIncomingMessage()` runs and before verifying whether dispatch actually occurred cleanly in the active epoch. If a subscriber throws an unhandled exception during processing (or if the session epoch changed mid-dispatch), `lastEventId` has already advanced and `seenMessageIds` already suppressed the event.
- **Required Correction:**
  - Make `handleIncomingMessage()` return a boolean (`dispatchedWithoutSubscriberError: boolean`).
  - Advance `this.lastEventId = validCursorId` **ONLY AFTER** `handleIncomingMessage()` completes cleanly while `this.isCurrentStream(epoch, generation)` still holds and no subscriber threw an error (so failed subscriber delivery does not silently advance the replay cursor).

