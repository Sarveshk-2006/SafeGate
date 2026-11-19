# AARIZO — ISSUE-06 Phase B.2.3 — Phase 2 Independent Security, Reliability & Feature Preservation Audit

**Audit Date:** 2026-11-18  
**Audit Scope:** Phase 2 — `src/services/sseFrameParser.ts`, `src/services/realtimeService.ts`, `src/context/AuthContext.tsx`, `tests/issue06_b23_realtime_sse.test.ts`, plus backend SSE contracts (`server/src/realtimeEngine.ts`, `server/src/auth.ts`, `server/src/index.ts`) and all realtime consumers  
**Audit Mode:** Strictly Read-Only (zero edits to application source, tests, schema, migrations, env, or config)  
**Final Verdict:** **`PHASE 2 FINAL ACCEPTANCE — CONDITIONAL PASS, TARGETED FIXES REQUIRED`**

---

## 1. Executive Summary

Independent line-by-line review confirms that Phase 2 successfully eliminated all native `EventSource` usage (`0` occurrences in `src/`), sends Bearer authentication strictly via `Authorization: Bearer <token>` with **zero query-string JWTs**, integrates cleanly with `AuthContext` without circular imports, and preserves all existing realtime consumers and the frontend production build.

However, independent security, WHATWG SSE specification, HTTP error-handling, and cursor-replay inspection identified **six bounded findings (`F-P2-01` through `F-P2-06`)**, including **two HIGH-severity blockers (`F-P2-01`, `F-P2-02`)** and **two MEDIUM-HIGH/MEDIUM blockers (`F-P2-03`, `F-P2-04`)** that must be remediated and independently re-audited before Phase 3 may begin.

---

## 2. Master Finding Register

| Finding ID | Severity | Audit Area | File & Line References | Summary | Blocks Phase 3? |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **F-P2-01** | **HIGH** | Audit C / G (BroadcastChannel Isolation) | `src/services/realtimeService.ts#L221-L246`, `#L820-L825` | `BroadcastChannel('communityos_realtime_hub')` (1) delivers events to **logged-out tabs** (`this.activeSession === null`), (2) broadcasts and accepts **protected `CHILD_*`/`EMERGENCY_*`/`SOS_*`/`GATE_PASS_*` events** across tabs bypassing server-side audience authorization, (3) bypasses society filtering when `incoming.societyId` is empty/missing, and (4) does not bind/verify sender `userId` for session isolation. | **YES** |
| **F-P2-02** | **HIGH** | Audit A (WHATWG SSE Parser) | `src/services/sseFrameParser.ts#L86-L103`, `#L140-L148`, `#L223-L228`; `src/services/realtimeService.ts#L610-L616` | (1) On premature stream EOF (`done === true`), `realtimeService.ts#L611` invokes `parser.flush()`, which calls `finalizeFrame()` and **dispatches incomplete unterminated frames** (violating WHATWG SSE Section 9.2.6, which mandates discarding pending data without a terminating blank line). (2) Leading UTF-8 BOM stripping (`#L141-L148`) can misfire mid-stream after any completed frame instead of only at stream start. (3) Empty `id:` field does not explicitly clear frame ID per WHATWG spec. | **YES** |
| **F-P2-03** | **MEDIUM-HIGH** | Audit D (HTTP & Content-Type Handling) | `src/services/realtimeService.ts#L541-L588` | (1) Permanent `4xx` errors (`400`, `404`, etc., other than `408`/`429`) hit `if (!response.ok)` and enter **infinite reconnect loops** instead of stopping as `OFFLINE`. (2) `204 No Content` or `200 OK` with non-SSE `Content-Type` (e.g., `text/html` SPA fallback or `application/json` proxy error) is NOT validated and falsely marks `connectionState = 'CONNECTED'`. | **YES** |
| **F-P2-04** | **MEDIUM** | Audit E (Replay Cursor Advancement) | `src/services/realtimeService.ts#L695-L715`, `#L978-L1002` | `this.lastEventId` is advanced at `#L698` **before** `handleIncomingMessage()` dispatches to subscribers. If an event fails dispatch or is rejected by session epoch, the replay cursor has already moved forward. | **YES** |
| **F-P2-05** | **MEDIUM** | Audit B (`AuthContext` Lifecycle) | `src/context/AuthContext.tsx#L209-L223` | When Firebase `onIdTokenChanged` detects `!firebaseUser` and invalidates the session (`#L212-L221`), `clearAuthSession()` runs without immediately calling `realtimeService.disconnect()` synchronously (leaving a brief race window before React's `useEffect` flushes). | **YES** |
| **F-P2-06** | **MEDIUM** | Audit H (Test Coverage Gaps) | `tests/issue06_b23_realtime_sse.test.ts` | Missing 10 high-value tests: BOM/CR-only parsing, incomplete-EOF frame discard, BroadcastChannel forged/logged-out/protected-topic rejection, HTTP `400`/`404`/`204`/wrong-`Content-Type`, `Retry-After` HTTP-date parsing, same-token society/role switch, post-logout late event rejection, subscriber-exception cursor preservation, `realTimeSync` compat, and Strict Mode connect/unmount/remount lifecycle. | **YES** |

---

## 3. Confirmed Passes (Verified Directly in Source)

1. **Zero Native `EventSource` & Zero URL Tokens:** Verified across all `src/**/*.{ts,tsx}` — `0` `EventSource` occurrences and `0` `?token=`/`&token=` query tokens.
2. **Bearer Header Transport (`realtimeService.ts#L509-L517`):** Sends `Authorization: Bearer <token>`, `Accept: text/event-stream`, and `Last-Event-ID` header cleanly.
3. **Zero Token/Header Logging in Phase 2 Files:** Confirmed across `sseFrameParser.ts`, `realtimeService.ts`, and `AuthContext.tsx`.
4. **Core Session Epoch & Generation Isolation (`realtimeService.ts#L255-L328`, `#L469-L471`):** Duplicate `connect()` deduplication, token refresh preserving `lastEventId`, user/society switch clearing `lastEventId`, and aborting old streams without triggering retries all work cleanly.
5. **Race-Safe `401` & Non-Retrying `403` (`#L542-L562`):** Verified synchronous `getAuthToken() === session.token` check on `401` and permanent stop on `403`.
6. **Zero Circular Imports & Strict Scope Discipline:** `AuthContext -> realtimeService -> (authStorage, sseFrameParser)`. Phase 1 untouched; Phases 3–8 untouched; backend/Prisma/env untouched; zero commits/pushes.
7. **`REQ-BE-02` Status Accurately Tracked:** Legacy backend `req.query.token` fallback (`server/src/auth.ts#L215-L218`) remains OPEN as separate backend requirement `REQ-BE-02`.

---

## 4. Independent Verification Re-Run Counts

| Verification Check | Command | Exact Observed Result |
| :--- | :--- | :--- |
| **Focused Phase 2 + Phase 1 + SSE Auth + Auth Storage + Visitor API** | `npx jest tests/issue06_b23_realtime_sse.test.ts tests/issue06_b23_api_client.test.ts tests/issue02_gap03_sse_authorization.test.ts tests/issue03_auth_storage_consistency.test.ts tests/issue06_visitor_pass_api.test.ts --silent` | **5/5 suites passed, 114/114 tests passed** (`18` Phase 2 + `42` Phase 1 + `8` Backend SSE Auth + `22` Auth Storage + `24` Visitor Pass API), exit code `0` |
| **Full Offline Jest Suite** *(unchanged source since Phase 2 run)* | `npm test` | **23/23 executed suites passed, 423 passed, 0 failed** (`2` live PG 16 suites / `11` tests skipped offline without `AARIZO_ISOLATED_TEST_DATABASE_URL`), exit code `0` |
| **Frontend Production Build** | `npm run build` (`tsc -b && vite build`) | **PASS** (exit code `0`) |
| **Live Browser / Multi-Tab / Live Server E2E** | Not executed in Phase 2 | Explicitly distinguished from automated Node/Jest verification; live PG16 E2E scheduled for Phase 8. |

