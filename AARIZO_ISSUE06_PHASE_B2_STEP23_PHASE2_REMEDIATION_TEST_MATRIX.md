# AARIZO — ISSUE-06 Phase B.2.3 (Phase 2) Remediation Test Matrix

**Date:** 2026-11-18  
**Repository:** `D:\AAZIRA\AARIZO`  
**Execution Mode:** Automated Offline Jest + TypeScript/Vite Production Build + Static Security Scans

---

## 1. Execution Summary

| Command / Suite | Executed Suites | Passed Tests | Failed Tests | Skipped Tests | Result |
| --- | :---: | :---: | :---: | :---: | :---: |
| `npx jest tests/issue06_b23_realtime_sse.test.ts --verbose` | 1 | 36 | 0 | 0 | **PASS** |
| `npx jest tests/issue06_b23_auth_realtime_lifecycle.test.ts --verbose` | 1 | 3 | 0 | 0 | **PASS** |
| Focused 6-suite pack (`issue06_b23_realtime_sse`, `issue06_b23_auth_realtime_lifecycle`, `issue06_b23_api_client`, `issue02_gap03_sse_authorization`, `issue03_auth_storage_consistency`, `issue06_visitor_pass_api`) | 6 | 135 | 0 | 0 | **PASS** |
| Full offline Jest suite (`npm test`) | 24 of 26 | 444 | 0 | 11 (2 live PG suites) | **PASS** |
| Production build (`npm run build` -> `tsc -b && vite build`) | N/A | N/A | 0 | N/A | **PASS** (1.12s) |

> **Honest Scope Disclosure:** Live PostgreSQL tests (`11` tests across `2` suites) were skipped because `AARIZO_ISOLATED_TEST_DATABASE_URL` is not configured. Live browser multi-tab and live running server end-to-end tests were not executed in this turn.

---

## 2. Mandatory 20-Case Coverage Matrix (`F-P2-06`)

| # | Required Scenario | Test File | Test Case Title | Finding(s) Verified | Status |
| :---: | --- | --- | --- | --- | :---: |
| 1 | Leading BOM + mid-stream BOM preservation + CR-only (`\r`) line endings | `tests/issue06_b23_realtime_sse.test.ts` | `strips ONE leading UTF-8 BOM at stream start only, preserves mid-stream BOM, and supports CR-only line endings` | `F-P2-02`, `F-P2-06` | **PASS** |
| 2 | Incomplete EOF frame discard (plus complete terminated frame flush) | `tests/issue06_b23_realtime_sse.test.ts` | `discards incomplete unterminated frames at premature EOF while flushing valid complete frames` | `F-P2-02`, `F-P2-06` | **PASS** |
| 3 | Empty `id:` cursor reset & NUL-containing ID ignored | `tests/issue06_b23_realtime_sse.test.ts` | `handles empty id: cursor reset and ignores NUL-containing event IDs per WHATWG SSE` | `F-P2-02`, `F-P2-06` | **PASS** |
| 4 | BroadcastChannel logged-out rejection | `tests/issue06_b23_realtime_sse.test.ts` | `never opens BroadcastChannel while logged out, closes it on disconnect, and rejects logged-out cross-tab messages` | `F-P2-01`, `F-P2-06` | **PASS** |
| 5 | Forged BroadcastChannel message rejection (no cursor overwrite / no protected spoof) | `tests/issue06_b23_realtime_sse.test.ts` | `rejects forged BroadcastChannel messages and never allows BroadcastChannel to advance Last-Event-ID` | `F-P2-01`, `F-P2-06` | **PASS** |
| 6 | Protected event forwarding prevention (`CHILD_*`, `EMERGENCY_*`, `SOS_*`, `GATE_PASS_*`, `SECURITY_ALERT_*`, `RESIDENT_PRIVATE_*`) | `tests/issue06_b23_realtime_sse.test.ts` | `prevents publish() from forwarding protected topics to BroadcastChannel or /api/realtime/broadcast` | `F-P2-01`, `F-P2-06` | **PASS** |
| 7 | Missing and mismatched `societyId` BroadcastChannel rejection (plus valid same-society sync) | `tests/issue06_b23_realtime_sse.test.ts` | `rejects BroadcastChannel messages with missing, empty, or mismatched societyId while allowing same-society non-protected sync` | `F-P2-01`, `F-P2-06` | **PASS** |
| 8 | HTTP `400` permanent failure (`OFFLINE`, zero retry) | `tests/issue06_b23_realtime_sse.test.ts` | `HTTP 400 and HTTP 404 stop permanently in OFFLINE state with zero retries and preserve auth session` | `F-P2-03`, `F-P2-06` | **PASS** |
| 9 | HTTP `404` permanent failure (`OFFLINE`, zero retry) | `tests/issue06_b23_realtime_sse.test.ts` | `HTTP 400 and HTTP 404 stop permanently in OFFLINE state with zero retries and preserve auth session` | `F-P2-03`, `F-P2-06` | **PASS** |
| 10 | HTTP `204` rejection as active stream (never `CONNECTED`) | `tests/issue06_b23_realtime_sse.test.ts` | `HTTP 204 No Content is rejected as an active stream, never enters CONNECTED, cancels body, and schedules reconnect` | `F-P2-03`, `F-P2-06` | **PASS** |
| 11 | Incorrect / missing `Content-Type` rejection (`text/html`, `application/json`, missing) + valid `text/event-stream; charset=utf-8` | `tests/issue06_b23_realtime_sse.test.ts` | `rejects HTTP 200 with missing, text/html, or application/json Content-Type (never CONNECTED) and accepts text/event-stream; charset=utf-8` | `F-P2-03`, `F-P2-06` | **PASS** |
| 12 | `Retry-After` HTTP-date parsing (future, past, negative/malformed) + HTTP `408` retry | `tests/issue06_b23_realtime_sse.test.ts` | `parses HTTP-date Retry-After, ignores past/negative/malformed Retry-After safely, and retries transient HTTP 408` | `F-P2-03`, `F-P2-06` | **PASS** |
| 13 | Same-token society switch (resets `lastEventId`, aborts old stream, rejects stale events) | `tests/issue06_b23_realtime_sse.test.ts` | `same-token society switch resets Last-Event-ID and rejects stale events from old society stream` | `F-P2-01`, `F-P2-06` | **PASS** |
| 14 | Same-token role switch (resets `lastEventId`, aborts old stream, rejects stale events) | `tests/issue06_b23_realtime_sse.test.ts` | `same-token role switch resets Last-Event-ID and rejects stale events from old role stream` | `F-P2-01`, `F-P2-06` | **PASS** |
| 15 | Post-logout late event rejection | `tests/issue06_b23_realtime_sse.test.ts` | `post-logout late events arriving from a previously open stream are rejected and never mutate state or cursor` | `F-P2-04`, `F-P2-06` | **PASS** |
| 16 | Subscriber exception isolation & cursor preservation + replay recovery | `tests/issue06_b23_realtime_sse.test.ts` | `does not advance lastEventId when a subscriber throws, isolates other subscribers, and allows replay recovery` | `F-P2-04`, `F-P2-06` | **PASS** |
| 17 | Reconnect cancellation during backoff (logout & replacement user) | `tests/issue06_b23_realtime_sse.test.ts` | `cancels pending backoff reconnect cleanly on disconnect() or replacement user connect()` + `HTTP 503 and network errors...` | `F-P2-03`, `F-P2-06` | **PASS** |
| 18 | `realTimeSync` consumer compatibility (`subscribe`, `publish`, `unsubscribe`) | `tests/issue06_b23_realtime_sse.test.ts` | `preserves realTimeSync consumer compatibility (subscribe, publish, unsubscribe)` | `F-P2-06` | **PASS** |
| 19 | React Strict Mode connect -> unmount disconnect -> remount connect | `tests/issue06_b23_realtime_sse.test.ts` & `tests/issue06_b23_auth_realtime_lifecycle.test.ts` | `React Strict Mode connect -> cleanup disconnect -> remount connect...` & `AuthProvider Strict Mode mount -> unmount cleanup -> remount...` | `F-P2-05`, `F-P2-06` | **PASS** |
| 20 | Firebase `!firebaseUser` sign-out synchronous `realtimeService.disconnect()` BEFORE `clearAuthSession()` + late event rejection | `tests/issue06_b23_auth_realtime_lifecycle.test.ts` | `Firebase !firebaseUser sign-out synchronously disconnects SSE BEFORE clearAuthSession() and rejects late events from old stream` (+ invalid non-firebase session test) | `F-P2-05`, `F-P2-06` | **PASS** |

---

## 3. Existing Phase 2 & Regression Coverage Retained (Unweakened)

- All 18 original Phase 2 tests in `tests/issue06_b23_realtime_sse.test.ts` remain intact and passing (100% behavioral assertions; `MockSseStreamController.toResponse` now defaults HTTP `200` to `Content-Type: text/event-stream` unless explicitly overridden by negative tests).
- All 42 Phase 1 API client tests (`tests/issue06_b23_api_client.test.ts`) pass with zero modifications.
- All backend SSE authorization, auth storage consistency, and visitor pass API suites pass without regression.

