# AARIZO — ISSUE-06 Phase B.2.3: Comprehensive Regression & Integration Test Plan

This test plan defines the exact verification suite required during Phase B.2.3 implementation to prove end-to-end functional correctness, fail-closed security, cross-role isolation, realtime synchronization, and zero regression across the existing 363 offline + 11 live PostgreSQL 16 tests.

---

## 1. Test Layers & Suites to Add in B.2.3

| Suite File (Planned) | Layer | Focus |
| :--- | :--- | :--- |
| `tests/issue06_b23_api_client.test.ts` | Unit (Mocked `fetch`) | `apiRequestStrict`, `ApiError` parsing, all 19 Child Safety API methods, Bearer header attachment, `401` session clear, `503` / network fail-closed error propagation |
| `tests/issue06_b23_realtime_sse.test.ts` | Unit (Mocked `EventSource` & `AuthContext`) | Authenticated `?token=` SSE URL, no unauthenticated auto-connect, `disconnect()` & `lastEventId` reset on logout/`401`, exponential backoff, 15-event topic routing, siren triggers, deduplication, blocked broadcast prevention |
| `tests/issue06_b23_service_hygiene.test.ts` | Static + Unit | Zero `localStorage` reads/writes for Child Safety data, zero `ChildRepository` / `/api/collections/children` calls, zero `idProofNumber` submission, zero `bearerToken`/`qrPayload` storage persistence |
| `tests/issue06_b23_resident_workflow.test.ts` | Integration (Mocked API / Service) | Resident child CRUD, pickup CRUD (`idDocumentLast4`), one-time pass creation & ephemeral QR display, pass revocation, SOS trigger, `409 DUPLICATE_ACTIVE_SOS_ALERT` handling, SSE refresh |
| `tests/issue06_b23_security_scanner.test.ts` | Integration (Mocked API / Service) | Guard verification `200 GRANTED`, `409 CHILD_MISSING_ALERT_BLOCKED`, `409 PASS_ALREADY_CONSUMED`, `422 PASS_EXPIRED`/`REVOKED`/`PICKUP_REVOKED`, `429 RATE_LIMIT_EXCEEDED`, **`503` & network offline fail-closed**, Acknowledge, Resolve with mandatory `resolutionNotes`, `secretary` read-only guard |
| `tests/issue06_b23_admin_workflow.test.ts` | Integration (Mocked API / Service) | Admin child listing (`includeArchived`), child creation with same-society `residentId` + `flatId`, pickup authorize/revoke, alert acknowledge/resolve/false-alarm, SSE live refresh, `committee` read-only controls |
| `tests/issue06_b23_live_e2e_pg.test.ts` | Live Isolated PostgreSQL 16 + Express HTTP + Real SSE | Full cross-role Resident -> Guard -> Admin flow using the exact frontend `apiClient` + `childSafetyService` against real B.2.2 Express server + PostgreSQL 16 + authenticated SSE stream |

---

## 2. Detailed Verification Matrix

### 2.1 Fail-Closed & Security Regression Cases (Mandatory Blockers)

| Case ID | Scenario | Expected Result |
| :--- | :--- | :--- |
| **SEC-01** | Guard scans valid QR while backend returns `503 VERIFICATION_UNAVAILABLE` | Throws `ApiError(503, 'VERIFICATION_UNAVAILABLE')`; UI displays critical fail-closed hold banner (*"DO NOT RELEASE CHILD"*); zero fallback to `localStorage` or cached pass list. |
| **SEC-02** | Guard scans valid QR while device is offline (`fetch` rejects with `TypeError`) | Throws `ApiError(0, 'NETWORK_UNAVAILABLE')`; UI displays fail-closed offline hold banner; never authorizes exit. |
| **SEC-03** | Guard attempts to verify using display `passCode` (`CGP-XXXX-XXXX`) instead of `qrPayload`/`bearerToken` | Backend returns `400 BEARER_TOKEN_REQUIRED`; UI shows clear guidance to scan caretaker's QR code / bearer token. |
| **SEC-04** | Guard scans valid pass for a child with an active `MISSING_CHILD` SOS alert | Backend returns `409 CHILD_MISSING_ALERT_BLOCKED`; UI displays flashing critical lockdown alert + siren and refuses release. |
| **SEC-05** | Guard re-scans an already consumed single-use pass | Backend returns `409 PASS_ALREADY_CONSUMED`; UI shows red denied verdict with replay warning. |
| **SEC-06** | Resident generates a gate pass (`POST /api/children/passes`) and closes the QR modal | `bearerToken` and `qrPayload` are shown once in modal, cleared from React state on close, and verified absent from `localStorage` and `sessionStorage`. |
| **SEC-07** | Resident/Admin submits pickup form | Form has no `idProofNumber` field; payload sends only `idDocumentType` + optional `idDocumentLast4` (<= 4 chars); raw ID keys are never transmitted. |
| **SEC-08** | Guard/Resident/Admin triggers Child Safety mutation | Zero calls to `/api/collections/children` and zero calls to `POST /api/realtime/broadcast` for `CHILD_*`, `EMERGENCY_*`, `SOS_*`, or `GATE_PASS_*`. |
| **SEC-09** | Unauthenticated user or expired JWT opens app / triggers `401` | `realtimeService` does NOT open an `EventSource` without a token; on `401` or `logout()`, active `EventSource` is closed, reconnect loop stops, and `lastEventId` is cleared. |
| **SEC-10** | Cross-tenant isolation check (Society A vs Society B) | Society B resident/guard/admin cannot view Society A children, passes, exit logs, alerts, or receive Society A SSE events. |

### 2.2 Role Boundary & Authorization Matrix Cases

| Case ID | Actor Role | Action | Expected Frontend + Backend Behavior |
| :--- | :--- | :--- | :--- |
| **RBAC-01** | `resident` | Opens `/resident/child-safety` | Sees ONLY own children, passes, exit logs, alerts. `GATE_VERIFIER` tab is hidden. Cannot see Acknowledge/Resolve buttons. |
| **RBAC-02** | `guard` | Opens `/security/child-safety` | Sees ONLY `ACTIVE` unexpired passes (`passCode` reference only, no `bearerToken`), exit logs, alerts, and Gate Pass Verifier. Cannot call `GET /api/children` (`403`). |
| **RBAC-03** | `secretary` | Opens `/security/child-safety` | Gate Pass Verification action is disabled/hidden with read-only notice (backend restricts verify to `guard`/`admin`). Can view active passes, exit logs, and Acknowledge/Resolve alerts. |
| **RBAC-04** | `secretary` | Opens `/admin/child-safety` | Can view society children, register child (with verified same-society `residentId` + `flatId`), manage pickups/passes, and Acknowledge/Resolve alerts. |
| **RBAC-05** | `committee` | Views Child Safety data | Write controls (Create/Edit/Archive Child, Add/Revoke Pickup, Generate/Revoke Pass) hidden; read + Alert Acknowledge/Resolve enabled. |
| **RBAC-06** | `admin` (platform `*`) | Attempts write without selecting society | UI prompts for target society selection before calling `POST /api/children`, `/passes`, or `/sos`. |

### 2.3 Realtime & UX Resilience Cases

| Case ID | Scenario | Expected Result |
| :--- | :--- | :--- |
| **RT-01** | Resident logs in -> `AuthContext` becomes `AUTHENTICATED` | `realtimeService.connect()` opens `EventSource` with `?token=<jwt>` and concrete `societyId`. |
| **RT-02** | Firebase `onIdTokenChanged` refreshes token | `realtimeService` seamlessly reconnects `EventSource` with refreshed token. |
| **RT-03** | Resident generates pass -> backend emits `CHILD_GATE_PASS_GENERATED` | Guard's `/security/child-safety` Active Passes panel updates automatically without page reload. |
| **RT-04** | Guard verifies pass -> backend emits `CHILD_GATE_PASS_VERIFIED` + `CHILD_EXIT_TRIGGERED` | Resident & Admin portals debounce paired events into a single refresh; child status updates to `OUT_OF_SOCIETY` and exit log appears. |
| **RT-05** | Resident triggers Missing Child SOS -> backend emits `CHILD_SAFETY_SOS_TRIGGERED` + `EMERGENCY_INCIDENT_CREATED` | Guard (`/security/child-safety` & `/security/emergency`) and Admin (`/admin/child-safety`) immediately receive siren + critical alert banner (deduped to 1 siren) + live alert card. |
| **RT-06** | Guard acknowledges then resolves alert with `resolutionNotes` | Resident & Admin see status transition `ACTIVE -> ACKNOWLEDGED -> RESOLVED` and child status restore to `SAFE` via SSE. |
| **RT-07** | Clicking a `CHILD_GATE_PASS_*` or `CHILD_SAFETY_SOS_TRIGGERED` notification toast | Navigates to `/resident/child-safety` (resident), `/security/child-safety` (guard), or `/admin/child-safety` (admin/secretary) — NEVER `/resident/deliveries`. |
| **RT-08** | Duplicate SOS submission while alert is active | Backend returns `409 DUPLICATE_ACTIVE_SOS_ALERT`; UI displays calm non-crashing banner pointing to the existing active alert. |
| **RT-09** | Rate limit exceeded (`429 RATE_LIMIT_EXCEEDED`) on pass creation, verify, or SOS | UI displays actionable cooldown message instead of silent failure or empty state. |

### 2.4 Build & Regression Baseline Verification Gates

Before closing Phase B.2.3 implementation (and prior to any independent B.2.3 audit), all of the following MUST pass cleanly:
1. `npm run build` (TypeScript + Vite frontend production build — zero errors)
2. `npm run server:build` (Backend TypeScript build — zero errors)
3. `npm test` (Existing 363+ offline tests + all new B.2.3 unit/integration suites — 100% pass)
4. Live isolated PostgreSQL 16 test run (`AARIZO_ISOLATED_TEST_DATABASE_URL` against disposable PG 16 container, keeping `nexus-postgres` untouched): existing 11/11 live PG tests + new `issue06_b23_live_e2e_pg.test.ts` — 100% pass.
5. Note: Preserved Phase B.2.1 pre-cutover risks (items 1–6) remain tracked separately and must not be marked resolved by B.2.3 frontend work.

