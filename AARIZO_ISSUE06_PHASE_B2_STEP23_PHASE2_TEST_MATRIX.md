# AARIZO — ISSUE-06 Phase B.2.3 — Phase 2 Test Matrix

**New Suite:** `tests/issue06_b23_realtime_sse.test.ts` (**18/18 passed**)  
**Focused Combined Run:** **4/4 suites, 90/90 tests passed**  
**Full Offline Suite (`npm test`):** **23/23 executed suites, 423 passed, 0 failed, 11 skipped** (2 live PG 16 suites skipped offline without `AARIZO_ISOLATED_TEST_DATABASE_URL`)  
**Build (`npm run build`):** **PASS** (0 errors)

---

## 1. Phase 2 Test Coverage Matrix (`tests/issue06_b23_realtime_sse.test.ts`)

| Category | Test Case | Behavior Verified | Result |
| :--- | :--- | :--- | :---: |
| **SSE Parsing** | Standard `id` + `data`, `event`, multiline `data`, `: comments`, `retry` | Exact WHATWG frame parsing & multiline `\n` join | **PASS** |
| **SSE Parsing** | Arbitrary 1-byte chunks, split `\r\n`, split multi-byte UTF-8 (`🚨`, `₹`, `आरव`) | Incremental `TextDecoder` stream mode & split CRLF fidelity | **PASS** |
| **SSE Parsing** | `isValidSseEventId`, empty/comment-only blocks, malformed/oversized IDs | Zero spurious frames; rejects empty, >128-char, NUL, newline IDs | **PASS** |
| **SSE Parsing** | Oversized line/frame (> `maxFrameBytes` / `maxLineBytes`) + subsequent valid frame | Drops oversized frame safely via callback without crashing and resumes clean parsing | **PASS** |
| **Auth Lifecycle** | Unauthenticated startup + missing token (`connect`/`initSseStream`/`forceReconnect`) + valid Bearer connect | Zero fetch without token; `Authorization: Bearer` header attached; **zero JWT/token/userId/role in URL** | **PASS** |
| **Auth Lifecycle** | Concurrent `connect()` calls for identical session + token | Prevents duplicate connections (`fetch` called once) | **PASS** |
| **Auth Lifecycle** | Logout (`disconnect()`) | Immediately aborts `AbortController`, sets `OFFLINE`, never retries | **PASS** |
| **Auth Lifecycle** | Token refresh (same user/society/role, new token) | Aborts old stream, connects with new Bearer token, preserves `Last-Event-ID`, suppresses replayed duplicate | **PASS** |
| **Auth Lifecycle** | User/society switch (Resident A -> Resident B) | Aborts old stream, clears `Last-Event-ID`, rejects late stale events from old stream via `sessionEpoch` | **PASS** |
| **Network & Recovery** | HTTP `401` | Clears `authStorage`, emits `aarizo:unauthorized` once, disconnects permanently (zero retry) | **PASS** |
| **Network & Recovery** | Delayed stale-token `401` after fresh login | Preserves new stored token and emits zero `aarizo:unauthorized` | **PASS** |
| **Network & Recovery** | HTTP `403` | Stops permanently (`OFFLINE`, zero retry) without clearing valid auth session | **PASS** |
| **Network & Recovery** | HTTP `429` with `Retry-After` header | Honors `Retry-After` delay before reconnecting cleanly | **PASS** |
| **Network & Recovery** | HTTP `503` + Network `TypeError` + `connected` handshake + `PING` + premature EOF + logout timer cancel | Bounded exponential backoff, backoff reset on `connected`, `Last-Event-ID` ignores `connected`/`PING`, logout cancels pending retry | **PASS** |
| **Network & Recovery** | `handleNetworkResume()` during `RECONNECTING` | Cancels long backoff and triggers immediate single reconnect | **PASS** |
| **Consumer Compat** | Topic & wildcard `*` subscriptions, duplicate callback prevention, explicit unsubscribe cleanup | Exact callback delivery, `Set` deduplication, `activeListenersCount` decremented on cleanup | **PASS** |
| **Consumer Compat** | `CHILD_*` role-aware alert routing & unrelated `VISITOR` alerts | `CHILD_SAFETY_SOS_TRIGGERED` -> `'emergency'` & `/security/child-safety`; `CHILD_GATE_PASS_*` -> `/security/child-safety` (not `/resident/deliveries`); `VISITOR` preserved | **PASS** |
| **Security Boundary** | `publish()` protected vs non-protected topics | Protected `CHILD_*`/`EMERGENCY_*` NOT posted to `/api/realtime/broadcast`; allowed `ANNOUNCEMENT_CREATED` preserved | **PASS** |

---

## 2. Executed vs Skipped Accounting

| Test Layer | Executed | Passed | Failed | Skipped | Verification Type |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `tests/issue06_b23_realtime_sse.test.ts` | 18 | 18 | 0 | 0 | Automated unit/lifecycle (mocked Fetch stream + fake timers) |
| `tests/issue06_b23_api_client.test.ts` | 42 | 42 | 0 | 0 | Automated Phase 1 regression |
| `tests/issue02_gap03_sse_authorization.test.ts` | 8 | 8 | 0 | 0 | Automated backend SSE auth regression |
| `tests/issue03_auth_storage_consistency.test.ts` | 22 | 22 | 0 | 0 | Automated auth storage regression |
| Remaining 19 offline Jest suites | 333 | 333 | 0 | 0 | Automated offline regression |
| 2 live PostgreSQL 16 suites | 0 | 0 | 0 | 11 | Skipped offline (requires `AARIZO_ISOLATED_TEST_DATABASE_URL`) |
| **Total** | **423** | **423** | **0** | **11** | **100% pass on all executed automated tests** |

