# AARIZO — ISSUE-06 Phase B.2.3 — Phase 2 Final Acceptance Report (Post-Remediation Re-Audit)

**Audit Date:** 2026-11-18  
**Phase Evaluated:** ISSUE-06 Phase B.2.3 — Phase 2 (Authenticated Realtime SSE Remediation)  
**Final Verdict:** **`PHASE 2 FINAL ACCEPTANCE — CONDITIONAL PASS, ADDITIONAL FIXES REQUIRED`**

---

## 1. Acceptance Decision Rationale

Phase 2 remediation successfully closed **four of the six original findings** (`F-P2-02`, `F-P2-03`, `F-P2-04`, `F-P2-05`):
- **WHATWG SSE frame parser (`F-P2-02`):** Cleanly handles UTF-8 chunk boundaries, single stream-start BOM stripping, CR/LF/CRLF, strict EOF incomplete-frame discard (`finishStream()`), empty `id:` cursor reset, NUL ID rejection, and bounded memory.
- **HTTP & reconnect handling (`F-P2-03`):** Cleanly handles race-safe `401`, non-retrying `403` and permanent `4xx` (`400`/`404`/`405`/`410`/`422`), transient `408`, hardened `429`/`503` `Retry-After` (seconds & HTTP-date), bounded backoff, and strict `200` + `text/event-stream` + `body.getReader()` validation before `CONNECTED`.
- **Replay cursor ordering (`F-P2-04`):** `lastEventId` now advances/resets strictly post-dispatch on the current active stream when no subscriber threw, with failed message IDs evicted from `seenMessageIds` for replay recovery.
- **Firebase & `AuthContext` lifecycle (`F-P2-05`):** Synchronous `realtimeService.disconnect()` now executes before `clearAuthSession()` / state updates on Firebase `!firebaseUser` and all other auth invalidation branches, with zero circular imports.

**Why PASS Cannot Be Granted Yet:**
Independent security review of **`F-P2-01` (HIGH)** confirmed two residual vulnerabilities in `BroadcastChannel` handling in `src/services/realtimeService.ts`:
1. **Emergency Substring Bypass (`F-P2-01A`):** `isProtectedBroadcastTopic()` checks `upper.startsWith('EMERGENCY_')` (`#L56-L75`), while `handleIncomingMessage()` matches `topicUpper.includes('EMERGENCY')` (`#L1044`) — allowing a forged `BroadcastChannel` message like `FIRE_EMERGENCY` to bypass the filter and trigger emergency chimes, haptics, and red `/emergency` alert toasts.
2. **Resident PII, Gate-Security & Financial Event Relay Over `BroadcastChannel` (`F-P2-01B`):** Non-blocklisted domain events (`VISITOR_ARRIVAL`, `VISITOR_APPROVAL`, `VISITOR_ENTRY`, `VISITOR_EXIT`, `DELIVERY_STATUS`, `WORKER_ENTRY_EXIT`, `QR_SCAN`, `PARKING_GATE_TRIGGERED`, `PAYMENT_COMPLETED`, `PAYMENT_STATUS`, `OFFLINE_PAYMENT_LOGGED`, `GUEST_STAY_BOOKED`, `NOTIFICATIONS`) are still posted by `publish()` (`#L958-L972`) and accepted by `channel.onmessage` (`#L257-L309`) based only on an untrusted `incoming.societyId` string (skipped entirely for platform admins) without user/role authorization.

Under acceptance criteria, an unconditional PASS requires **all HIGH findings closed** and **no material session/tenant/audience isolation vulnerability**. Because `F-P2-01` (HIGH) and its companion negative test coverage in `F-P2-06` remain **PARTIALLY CLOSED**, one narrowly scoped follow-up fix is required before Phase 3 may begin.

---

## 2. Final Finding Status Table (`F-P2-01` – `F-P2-06`)

| Finding ID | Severity | Final Status | Blocks Phase 3? |
| :--- | :---: | :---: | :---: |
| **F-P2-01** | **HIGH** | **PARTIALLY CLOSED** | **YES** |
| **F-P2-02** | **HIGH** | **CLOSED** | **NO** |
| **F-P2-03** | **MEDIUM-HIGH** | **CLOSED** | **NO** |
| **F-P2-04** | **MEDIUM** | **CLOSED** | **NO** |
| **F-P2-05** | **MEDIUM** | **CLOSED** | **NO** |
| **F-P2-06** | **MEDIUM** | **PARTIALLY CLOSED** | **YES** *(for `F-P2-01` negative tests)* |

---

## 3. Exact Minimal Fix Required to Unlock Phase 3

1. **Close `F-P2-01` in `src/services/realtimeService.ts`:**
   - **Remove domain event payload forwarding over `BroadcastChannel` completely.**
   - Do NOT call `channel.postMessage(msg)` with domain event payloads in `publish()`, and do NOT pass `BroadcastChannel` messages into `handleIncomingMessage()` or `dispatchAlert()`.
   - Either remove `BroadcastChannel` domain relay entirely (cross-tab auth/logout sync is already handled via `storage` events in `AuthContext.tsx`, and cross-tab live updates are delivered authoritatively to each authenticated tab via its own Fetch SSE stream) OR restrict `BroadcastChannel` strictly to an explicit, zero-PII, non-event UI coordination signal type that cannot invoke `subscribers` or `alertSubscribers`.
   - Also align `isProtectedBroadcastTopic()` (used to gate `/api/realtime/broadcast` POSTs) to check substring/family safety (e.g., `EMERGENCY`, `SOS`, `CHILD_`, `GATE_PASS`, `SECURITY_ALERT`, `RESIDENT_PRIVATE`, `VISITOR_`, `PAYMENT_`, `DELIVERY_`, `WORKER_`, `QR_SCAN`, `PARKING_GATE`) or mirror the backend allowlist (`server/src/index.ts#L227-L231`) so client-side `publish()` never attempts to broadcast unauthorized event families.
2. **Close `F-P2-06` in `tests/issue06_b23_realtime_sse.test.ts`:**
   - Update Section 6 tests to verify that **zero** domain event payloads — explicitly testing `FIRE_EMERGENCY` (substring emergency), `VISITOR_ARRIVAL`, `PAYMENT_COMPLETED`, `DELIVERY_STATUS`, `PARKING_GATE_TRIGGERED`, `CHILD_SAFETY_SOS_TRIGGERED`, and `ANNOUNCEMENT_CREATED` — are posted to or accepted from `BroadcastChannel` into `subscribers` or `alertSubscribers`.
   - Add an explicit assertion capping far-future HTTP-date `Retry-After` (e.g., year 2099 → `60_000ms`).

---

## 4. Preserved Out-of-Scope Trackers & Phase 3 Hold

- **Phase 3 is NOT started and remains HOLD** pending closure and re-audit of `F-P2-01` & `F-P2-06`.
- **Skipped Live PostgreSQL Tests (11 tests / 2 suites)** and **Live Browser / Multi-Tab / Server E2E** remain unexecuted offline and explicitly tracked for Phase 8 / pre-cutover validation.
- **Backend & Pre-Cutover Open Trackers:** `REQ-BE-01`–`REQ-BE-04` (including `REQ-BE-02` removal of legacy `req.query.token` fallback in `server/src/auth.ts#L215-L218`) and all 6 Phase B.2.1 DB/CI pre-cutover risks remain OPEN and untouched.

---

**PHASE 2 FINAL ACCEPTANCE — CONDITIONAL PASS, ADDITIONAL FIXES REQUIRED**
