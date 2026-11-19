# AARIZO — ISSUE-06 Phase B.2.3: Final Acceptance Matrix & Risk Register

This matrix governs step-by-step approval of Phase B.2.3 execution, separates frontend deliverables from unresolved backend requirements and database pre-cutover risks, and defines the exact verification gates required before Phase B.2.3 can be submitted for independent audit.

---

## 1. Phase-by-Phase Acceptance Criteria Matrix

| Phase | Core Deliverable | Mandatory Automated Verification Gate | Hard Security Gate |
| :--- | :--- | :--- | :--- |
| **Phase 1** | Canonical B.2.2 DTOs + `ApiError` + `apiRequestStrict` (all 19 Child Safety APIs) | `tests/issue06_b23_api_client.test.ts` (100% pass) + `issue03_auth_storage_consistency` + `issue06_visitor_pass_api` + `npm run build` | Zero error-to-`null` swallowing; `401` triggers `aarizo:unauthorized`; `503`/network distinguished cleanly; raw ID keys rejected defensively; no spoofed identity headers. |
| **Phase 2** | Fetch-based authenticated SSE (`Authorization: Bearer` + `Last-Event-ID`) + `AuthContext` lifecycle | `tests/issue06_b23_realtime_sse.test.ts` (100% pass) + `issue02_gap03_sse_authorization` + `npm run build` | **ZERO long-lived JWT in URL query strings**; zero unauthenticated connect; `401`/`403` stops reconnect; logout/switch clears `lastEventId`; client `publish()` blocks `CHILD_*`/`EMERGENCY_*`/`SOS_*`/`GATE_PASS_*`. |
| **Phase 3** | Unified async `childSafetyService` facade + `useChildSafetyRealtime` debounced hook | `tests/issue06_b23_service_layer.test.ts` (100% pass) + Phase 1–2 suites + `npm run build` | Async facade uses zero `localStorage`; never falls back to stale cache on failure; paired SSE events debounced cleanly. |
| **Phase 4** | Resident Child Safety Portal (`ResidentChildSafetyPage` & `SafetyCommandHub` Child Tab) | `tests/issue06_b23_resident_workflow.test.ts` (100% pass) + `route_protection` + `npm run build` | One-time `bearerToken`/`qrPayload` rendered via `qrcode.react` & cleared on close (zero storage/logs); `pickupPersonId` enforced for non-solo children; `idDocumentLast4` only; SOS succeeds only on `201`; `GATE_VERIFIER` hidden for non-guard/admin; no simulated gate re-entry. |
| **Phase 5** | Security `ChildGateScannerPage` + `SecurityEmergencyTerminalPage` SSE coordination | `tests/issue06_b23_security_scanner.test.ts` (100% pass) + `issue06_visitor_pass_routes` + `npm run build` | Fail-closed hold banner on `503 BACKEND_UNAVAILABLE` & offline; flashing lockdown on `409 CHILD_MISSING_ALERT_BLOCKED`; no self-scan demo buttons; mandatory `resolutionNotes` on alert resolve; `secretary` verify disabled. |
| **Phase 6** | Admin `AdminChildSafetyPage` live cutover | `tests/issue06_b23_admin_workflow.test.ts` (100% pass) + Phase 1–5 suites + `npm run build` | Live PostgreSQL reads + Fetch SSE updates; admin child creation bound to verified society `residentId` + `flatId`; `committee` write controls hidden; mandatory `resolutionNotes`. |
| **Phase 7** | Retirement of Child Safety `localStorage`, `SEED_CHILDREN`, `ChildRepository`, `safetyCommandEngine` child keys + `SafetyHome` SOS hardening | `tests/issue06_b23_hygiene_retirement.test.ts` (100% pass) + full offline Jest suite + `npm run build` | Static hygiene scan proves zero Child Safety `localStorage` keys, zero `/api/collections/children`, zero `idProofNumber`, zero `CP-QR-`, zero blocked `realtimeService.publish` for protected events; `SafetyHome` confirms `201` before showing active SOS. |
| **Phase 8** | Cross-role live isolated PostgreSQL 16 E2E suite (Resident -> Guard -> Admin + Fetch SSE) | `tests/issue06_b23_live_e2e_pg.test.ts` + existing 11 live PG 16 tests + full 363+ offline suite + `npm run build` + `npm run server:build` + `npx prisma validate` | Proven end-to-end against real PostgreSQL 16 (`nexus-postgres` untouched): cross-tenant isolation, `MISSING_CHILD` lockdown, replay block, fail-closed `503`, authenticated Fetch SSE delivery, audience isolation (`vendor`/`facility_manager` receive zero Child Safety events). |

---

## 2. Explicit Separation: Frontend B.2.3 Scope vs Backend Requirements vs Database Pre-Cutover Risks

### 2.1 Unresolved Separate Backend Requirements (NOT Implemented or Assumed in B.2.3)

| ID | Requirement | Category | Status |
| :--- | :--- | :--- | :--- |
| **`REQ-BE-01`** | Dedicated Child Gate Re-Entry / Check-In API (`POST /api/children/:id/re-entry`, `guard`/`admin`, immutable `RE_ENTRY` gate audit log, `CHILD_REENTRY_RECORDED` SSE event) | Backend API & Schema Enhancement | **OPEN — Separate Task** (B.2.3 will NOT simulate gate re-entry via `PATCH /api/children/:id`) |
| **`REQ-BE-02`** | Remove legacy `req.query.token` fallback from `server/src/auth.ts#L215-L218` (and optionally add short-lived single-use SSE ticket endpoint ONLY if native `EventSource` is ever needed) | Backend Security Hardening | **OPEN — Separate Task** (B.2.3 frontend uses Fetch `Authorization: Bearer` header and sends zero query-string tokens) |
| **`REQ-BE-03`** | General non-child `EmergencyIncident` workflow endpoints (`acknowledge`, `assignResponder` / `RESPONDING`, timeline persistence) | Backend API Enhancement | **OPEN — Separate Task** (B.2.3 does NOT invent `RESPONDING` for Child Safety Alerts) |
| **`REQ-BE-04`** | Camera barcode/QR hardware scanner integration (`html5-qrcode` or Capacitor native scanner plugin) | Frontend Hardware Enhancement | **OPEN — Post-B.2.3 Enhancement** (B.2.3 exposes clean `onScan(qrPayload)` callback over scanner input) |

### 2.2 Preserved Phase B.2.1 Pre-Cutover Database & CI Risks (ALL SIX REMAIN OPEN)

Per ISSUE-06 governance, **NONE** of the six Phase B.2.1 pre-cutover risks are closed by B.2.3 frontend integration; all remain explicitly **OPEN** and tracked for database cutover / CI readiness:

| # | Preserved Phase B.2.1 Risk | Scope | Status | Interaction With Phase B.2.3 Frontend |
| :--- | :--- | :--- | :--- | :--- |
| **1** | Legacy backfill primary-key collision quarantine | Database Migration / Cutover | **OPEN** | Frontend uses server-assigned UUID/CUID IDs only; never relies on legacy synthetic IDs (`child-1`, `fam-...`). |
| **2** | Malformed embedded `authorizedPickups[]` quarantine | Database Migration / Cutover | **OPEN** | Frontend renders relational `pickups[]` returned by API and removes hardcoded fallback escorts (`Radha Bai`, `Santosh Yadav`). |
| **3** | Explicit cross-society `residentId` fallback handling | Database Migration / Cutover | **OPEN** | Admin Register Child UI selects `residentId` + `flatId` strictly from the authenticated society's resident/flat roster. |
| **4** | `UPDATE` actor-trigger test coverage | Database Integrity Testing | **OPEN** | B.2.3 live PG 16 E2E suite exercises `PATCH /api/children/:id` and `PATCH .../pickups/:pickupId`, while dedicated DB trigger assertions remain tracked under B.2.1 closure. |
| **5** | Remaining database `CHECK` assertions | Database Integrity Testing | **OPEN** | B.2.3 forms mirror validation (`idDocumentLast4` <= 4 chars, `validUntil > validFrom`, `maxUses` 1–10, non-empty `resolutionNotes`) while backend/DB constraints remain authoritative. |
| **6** | CI wiring for `AARIZO_ISOLATED_TEST_DATABASE_URL` | CI / DevOps Pipeline | **OPEN** | Required before final ISSUE-06 closure so all B.2.1, B.2.2, and B.2.3 live PG 16 suites run automatically on every PR. |

---

## 3. Non-Negotiable Execution Guardrails

1. **Stepwise Execution Only:** Execute Phases 1 through 8 sequentially; do NOT begin Phase N+1 until Phase N passes its automated tests and `npm run build`.
2. **Zero Security Regression:** Never weaken B.2.2 routes, RBAC, tenant isolation, rate limits, cryptographic bearer tokens, or fail-closed `503` enforcement.
3. **Zero Premature Deletion:** Never remove deprecated sync methods in `childSafetyService.ts` or `safetyCommandEngine.ts` until Phase 7 (after Phases 4, 5, and 6 are verified).
4. **Zero Unjustified Redesign:** Preserve existing page routes, component hierarchy, responsive tables/cards, and visual design language.
5. **Independent Audit Required Before Closure:** After Phase 8 completes, Phase B.2.3 requires a fresh independent verification audit before closing B.2.3 (and ISSUE-06 remains open until all B.2.1 pre-cutover items are also resolved).

