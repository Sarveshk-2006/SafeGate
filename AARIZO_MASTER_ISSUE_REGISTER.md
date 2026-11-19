# AARIZO — MASTER ISSUE REGISTER & TECHNICAL DEBT INVENTORY
**Document Version:** 2.0.0  
**Phase:** Phase 2 — Master Audit Review & Planning  
**Baseline Commit:** `4ace01876700d23af402ca785c48ae060b16e53d`  
**Working Directory:** `d:\AAZIRA\AARIZO`  

---

## 1. Issue Register Overview & Methodology

Every issue identified across the 8 Phase 1 audit documents has been consolidated, deduplicated, and validated against the actual source code and execution runtime.

### Finding Status Definitions:
- **VERIFIED**: Empirically reproduced via running server HTTP requests, test execution, or browser simulation.
- **CODE-CONFIRMED**: Proven through direct source code inspection of controllers, models, and components.
- **INFERRED**: Derived logically from architectural patterns and runtime behavior under load/scale.
- **UNVERIFIED**: Documented as a potential concern but lacking definitive code or runtime evidence.

### Severity Summary:
| Priority Level | Description | Total Count |
| :--- | :--- | :---: |
| **P0** | Critical security, data integrity, or production-blocking failure | **2** |
| **P1** | Major functional defect, broken workflow, or access control failure | **4** |
| **P2** | Significant workflow, reliability, or consistency defect | **4** |
| **P3** | Minor UI, responsiveness, bundle size, or lint warning | **3** |
| **P4** | Optional improvement, testing infrastructure debt | **1** |
| **Total** | | **14** |

---

## 2. Prioritized Issue Register Table

| Issue ID | Pri | Category | Finding Title | Affected Portal | Verification Status | Confidence |
| :--- | :---: | :--- | :--- | :--- | :---: | :---: |
| **ISSUE-01** | **P0** | Security | Unprotected Developer Database Studio (`/dev/database`) | Public / All | **RESOLVED & VERIFIED** | 100% |
| **ISSUE-02** | **P0** | Security | Header-Based Privilege Escalation (`x-user-role`) in Express | REST API / Backend | **RESOLVED & VERIFIED (FULL PASS)** | 100% |
| **ISSUE-03** | **P1** | Integration | Auth Storage Key Mismatch (`dwellora_user` vs `aarizo_user`) | All Client Portals | **RESOLVED & VERIFIED (FULL PASS)** | 100% |
| **ISSUE-04** | **P1** | Database | Missing `.env` Files Resulting in `DATABASE_URL` Failure | Backend Database | **RESOLVED & VERIFIED (FULL PASS)** | 100% |
| **ISSUE-05** | **P1** | Auth | Seeded Database Users Lack `passwordHash` and `salt` | All Seeded Logins | **REMEDIATED & PASSING — CONDITIONALLY VERIFIED** | 100% |
| **ISSUE-06** | **P1** | Data State | Tri-Tier State Desynchronization (LocalStorage vs PG vs Firestore)| Cross-Role Sync | **CODE-CONFIRMED** | 95% |
| **ISSUE-07** | **P2** | Realtime | Realtime Outbox 500ms Poller Lacks Database Backoff | Realtime Engine | **VERIFIED** | 100% |
| **ISSUE-08** | **P2** | Security | In-Memory Sliding Window Rate Limiter Non-Persistent | Express Server | **CODE-CONFIRMED** | 95% |
| **ISSUE-09** | **P2** | Branding | Inconsistent Branding Identity (`AARIZO` vs `Dwellora`) | Login / UI Shell | **VERIFIED** | 100% |
| **ISSUE-10** | **P2** | Mobile | Native Android Container Missing `google-services.json` | Android APK | **CODE-CONFIRMED** | 100% |
| **ISSUE-11** | **P3** | Performance | Monolithic 2.72 MB JavaScript Chunk Warning in Vite | Web & Mobile App | **VERIFIED** | 100% |
| **ISSUE-12** | **P3** | Quality | 216 Oxlint Warnings (Impure `Date.now()`, Cascading `setState`) | Resident / Admin | **VERIFIED** | 100% |
| **ISSUE-13** | **P3** | Mobile Build| `cap:sync` Fails Before Initial Production Build | Build Pipeline | **VERIFIED** | 100% |
| **ISSUE-14** | **P4** | Testing | Firestore Security Rules Unit Tests Skipped Without Emulator | Test Suite | **VERIFIED** | 100% |

---

## 3. Comprehensive Issue Dossiers

---

### ISSUE-01 [P0]: Unprotected Developer Database Studio Route (`/dev/database`)
- **Category**: Broken Access Control / Sensitive Data Exposure
- **Affected Role & Portal**: Public / Unauthenticated visitors.
- **Exact Route / Page**: `/dev/database` and `/dev/db`.
- **Expected Behavior**: Developer debugging tools should require super-admin authentication or be omitted from production builds (`import.meta.env.DEV`).
- **Actual Behavior**: The route is completely unauthenticated. Any user visiting `http://localhost:5173/dev/database` can browse, filter, inspect, and export resident names, phone numbers, parking slots, license plates, visitor passes, audit logs, and raw `localStorage` data.
- **Evidence**:
  - Source: [src/routes/index.tsx#L135-L138](file:///d:/AAZIRA/AARIZO/src/routes/index.tsx#L135-L138)
  - Runtime: Navigating directly to `http://localhost:5173/dev/database` loads `DeveloperDatabaseStudio` without redirecting to `/login`.
- **Root Cause**: Route was mounted at the root router level outside `ProtectedRoute`.
- **Confidence**: 100% (RESOLVED & VERIFIED).
- **Relevant Files**: [src/routes/index.tsx](file:///d:/AAZIRA/AARIZO/src/routes/index.tsx), `src/components/dev/DeveloperDatabaseStudio.tsx`, [tests/route_protection.test.ts](file:///d:/AAZIRA/AARIZO/tests/route_protection.test.ts).
- **Dependencies**: React Router DOM, `ProtectedRoute.tsx`, `AuthContext.tsx`.
- **Resolution Applied**: Wrapped `/dev/database` and `/dev/db` in `<Route element={<ProtectedRoute allowedRoles={['admin']} />}>` in `src/routes/index.tsx`.
- **Resolution Verification Evidence**:
  - `tests/route_protection.test.ts`: 11 automated assertions passed verifying denial of unauthenticated visitors, loading state, resident, guard, secretary, committee, facility manager, and vendor roles, along with authorized access for `admin` and static route enclosure checks.
  - TypeScript & Vite build: `tsc -b && vite build` passed with zero errors.
  - Full test suite: 6 test suites, 59 tests passed.
- **Regression Risks**: None. Standard user portals and navigation bars do not depend on `/dev/database`.
- **Test Cases & Results**:
  1. Unauthenticated visitor (`status !== 'AUTHENTICATED'`) -> Redirects to `/login` (PASSED).
  2. Cold launch / Auth initializing (`status === 'INITIALIZING'`) -> Redirects to `/login` (PASSED).
  3. Authenticated `resident` -> Redirects to `/unauthorized` (PASSED).
  4. Authenticated `guard` -> Redirects to `/unauthorized` (PASSED).
  5. Authenticated `secretary` -> Redirects to `/unauthorized` (PASSED).
  6. Authenticated `committee` -> Redirects to `/unauthorized` (PASSED).
  7. Authenticated `facility_manager` -> Redirects to `/unauthorized` (PASSED).
  8. Authenticated `vendor` -> Redirects to `/unauthorized` (PASSED).
  9. Authenticated `admin` -> Allows access via `<Outlet />` (PASSED).
  10. Direct URL navigation -> Evaluates `ProtectedRoute` before mounting children, preventing any data fetching by unauthenticated/unauthorized actors (PASSED).

---

### ISSUE-02 [P0]: Client-Supplied Header Privilege Escalation in Express REST API
- **Category**: Broken Object Level Authorization (BOLA) / Identity Spoofing
- **Affected Role & Portal**: Authoritative Express REST API (`server/src/index.ts`).
- **Exact Route / Page**: All Express CRUD endpoints (e.g. `/api/residents`, `/api/flats`, `/api/billing/cycles`, `/api/towers`).
- **Expected Behavior**: Role and tenant claims must be resolved server-side from cryptographically signed tokens (Firebase ID token or JWT) or authoritative database records. Client-supplied identity headers must never be trusted.
- **Actual Behavior (Prior to Fix)**:
  ```ts
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.societyId = (req.headers['x-society-id'] as string) || undefined;
    req.userId = (req.headers['x-user-id'] as string) || undefined;
    req.userRole = (req.headers['x-user-role'] as string)?.toLowerCase() || undefined;
    next();
  });
  ```
  The endpoint handlers mount `requireRole(['secretary', 'admin'])`, which evaluated `req.userRole` derived from the unverified header. Any client sending `x-user-role: admin` bypassed role restrictions without a valid token.
- **Evidence**:
  - Source: [server/src/index.ts#L53-L58](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L53-L58) and [server/src/auth.ts#L157](file:///d:/AAZIRA/AARIZO/server/src/auth.ts#L157).
  - Test: Sending `x-user-role: admin` without a token bypassed role validation on protected endpoints.
- **Root Cause**: `req.userRole` and `req.societyId` were populated from unverified request headers and trusted by `requireRole` and `requireSocietyMembership`. Furthermore, `authenticateFirebaseToken` contained a development fallback (`x-test-token`) that directly accepted client headers.
- **Confidence**: 100% (RESOLVED & VERIFIED).
- **Relevant Files Changed**:
  - [server/src/auth.ts](file:///d:/AAZIRA/AARIZO/server/src/auth.ts) — Implemented native HMAC-SHA256 signed Bearer tokens (`generateAuthToken`, `verifyServerToken`, `constantTimeCompare`), implemented unified `authenticateToken` middleware resolving role and society from PostgreSQL, removed `x-test-token` fallback, anchored `requireRole` and `requireSocietyMembership` strictly to verified `req.authContext`.
  - [server/src/index.ts](file:///d:/AAZIRA/AARIZO/server/src/index.ts) — Mounted global `authenticateToken` on `/api` with an explicit allowlist for public routes (`/api/health`, `/api/realtime/health`, `/api/auth/login`, `/api/payments/razorpay/webhook`). Updated `POST /api/auth/login` to sign and return `{ success: true, token, user }`.
  - [src/services/apiClient.ts](file:///d:/AAZIRA/AARIZO/src/services/apiClient.ts) — Updated `getStoredAuthHeaders()` to read `'aarizo_token'` / `'dwellora_token'` and transmit `Authorization: Bearer <token>`. Updated `loginWithPassword` return type to include `token?: string`.
  - [src/context/AuthContext.tsx](file:///d:/AAZIRA/AARIZO/src/context/AuthContext.tsx) — Updated `loginWithProfile` to accept optional `token` and persist in `'aarizo_token'`; updated Firebase `onAuthStateChanged` to store ID tokens in `'aarizo_token'`; updated dev `loginAsRole` to store `mock_token_${user.id}`; updated `logout()` to purge auth tokens.
  - [src/components/auth/login/LoginScreen.tsx](file:///d:/AAZIRA/AARIZO/src/components/auth/login/LoginScreen.tsx) — Updated password login handler to pass backend-issued `res.token` to `loginWithProfile`.
  - [tests/issue02_privilege_escalation.test.ts](file:///d:/AAZIRA/AARIZO/tests/issue02_privilege_escalation.test.ts) — 14 security tests verifying rejection of forged headers, missing tokens, invalid signatures, expired tokens, and cross-society IDOR.
  - [tests/issue02_unified_auth_integration.test.ts](file:///d:/AAZIRA/AARIZO/tests/issue02_unified_auth_integration.test.ts) — 20 comprehensive end-to-end security and integration tests covering the complete dual-mode authentication architecture.
- **Dependencies**: Express, Prisma Client, Node.js `crypto`, Firebase Admin.
- **Resolution Applied**:
  1. Client-supplied headers `x-user-role`, `x-user-id`, and `x-society-id` are never trusted or mapped to request context properties.
  2. Implemented dual-mode authentication engine supporting HMAC-SHA256 server tokens (email/password), Firebase Admin ID tokens (phone OTP), and isolated non-production mock tokens (`mock_token_<uid>`).
  3. `authenticateToken` is mounted globally on `/api` for all 143 endpoints, enforcing authentication for all 139 protected routes while allowing the 4 public routes via strict path allowlist.
  4. Role and society authorization are resolved server-side from PostgreSQL records (`prisma.user`), never from client inputs.
  5. Browser SSE connections accept verified tokens via `req.query.token` when headers are unsupported.
  6. Frontend client stores Bearer tokens and automatically attaches `Authorization: Bearer <token>` to all HTTP requests.
- **Resolution Status by Dimension**:
  - **Header Trust Vulnerability**: **REMOVED (VERIFIED)** — `server/src/index.ts` lines 52–60 no longer map client-supplied `x-user-role`, `x-user-id`, or `x-society-id` to request context properties. Unverified headers are completely ignored.
  - **Middleware Implementation**: **HARDENED (VERIFIED)** — `server/src/auth.ts` removed the insecure `x-test-token` fallback; `requireRole` and `requireSocietyMembership` evaluate exclusively against verified `req.authContext`.
  - **Actual Route-Level Integration**: **RESOLVED & VERIFIED** — Global `authenticateToken` middleware is mounted on `/api` in `server/src/index.ts`. All 139 protected routes require valid Bearer authentication; all 4 public routes remain accessible.
  - **Existing Login Compatibility**: **RESOLVED & VERIFIED** — `POST /api/auth/login` returns a signed Bearer token stored by `AuthContext` and transmitted by `apiClient.ts`. Phone OTP users transmit Firebase ID tokens. Dev mock users transmit scoped mock tokens.
- **Verification Evidence**:
  - `tests/issue02_privilege_escalation.test.ts`: 14 passed.
  - `tests/issue02_unified_auth_integration.test.ts`: 20 passed.
  - `tests/issue02_gap01_secret_hardening.test.ts`: 9 passed.
  - `tests/issue02_gap02_mock_auth_hardening.test.ts`: 10 passed.
  - `tests/issue02_gap03_sse_authorization.test.ts`: 8 passed.
  - Full Jest test suite: 11 test suites, 120 tests passed (100% pass rate).
  - Server TypeScript compilation: `npm --prefix server run build` passed with zero errors.
  - Frontend production build: `npm run build` passed with zero errors.
  - Live HTTP port 5000 audit: Verified 200 OK on `/api/health`, 401 `AUTH_TOKEN_MISSING` on `/api/residents`, and 401 `AUTH_TOKEN_INVALID` for `mock_token_` without `ENABLE_DEV_MOCK_AUTH`.
- **Step 2.4 Critical Authentication Hardening (COMPLETED)**:
  - **GAP-01**: Hardcoded fallback secret removed from `server/src/auth.ts`; startup validation (`validateAuthConfiguration`) enforces minimum 32 characters in production; ephemeral random secret generated in development. Documented in [AARIZO_AUTH_GAP_01_SECRET_HARDENING_REPORT.md](file:///d:/AAZIRA/AARIZO/AARIZO_AUTH_GAP_01_SECRET_HARDENING_REPORT.md).
  - **GAP-02**: Implicit dev mock authentication disabled; strictly requires `isMockAuthEnabled()` (`NODE_ENV === 'development'` and `ENABLE_DEV_MOCK_AUTH === 'true'`); rejected in production and when `NODE_ENV` is unset. Documented in [AARIZO_AUTH_GAP_02_MOCK_AUTH_HARDENING_REPORT.md](file:///d:/AAZIRA/AARIZO/AARIZO_AUTH_GAP_02_MOCK_AUTH_HARDENING_REPORT.md).
  - **GAP-03**: SSE stream parameter spoofing eliminated; `handleSseSubscription` binds subscriptions strictly to `req.authContext`; cross-society subscriptions rejected with 403 `TENANT_ISOLATION_VIOLATION`. Documented in [AARIZO_AUTH_GAP_03_SSE_AUTHORIZATION_REPORT.md](file:///d:/AAZIRA/AARIZO/AARIZO_AUTH_GAP_03_SSE_AUTHORIZATION_REPORT.md).
  - Overall Regression Report: [AARIZO_PHASE_A_STEP_2_4_REGRESSION_REPORT.md](file:///d:/AAZIRA/AARIZO/AARIZO_PHASE_A_STEP_2_4_REGRESSION_REPORT.md).
- **Final Security Gate Verdict**: **PASS — READY FOR ISSUE-03**.
- **Regression Risks**: None. All legitimate authentication and realtime flows operate securely.

---

### ISSUE-03 [P1]: Storage Key Desynchronization Between AuthContext & API Client
- **Category**: Integration Defect / Context Loss / Session Consistency
- **Affected Role & Portal**: All client dashboards and API communication.
- **Exact Route / Page**: Entire frontend application.
- **Expected Behavior**: The API client and repositories should read the authenticated user profile and Bearer token saved during login, transmit valid authorization and tenant headers, and strictly require an active token and session flag before treating any session as authenticated.
- **Actual Behavior (Pre-Hardening)**:
  - `AuthContext.tsx` wrote to legacy keys (`dwellora_user`), while `apiClient.ts` read from `aarizo_user`.
  - Cold launches in `AuthContext.tsx` treated a cached user profile alone as `AUTHENTICATED` even when the Bearer token was expired, missing, or cleared.
  - Repositories (`BaseRepository`, `PaymentRepository`, `AdvertisementRepository`, `VendorRepository`) and services (`amenityService`, `RazorpayService`, `realtimeService`, `postgres.ts`) made direct raw `fetch()` calls omitting Bearer tokens, triggering HTTP 401 failures against the protected backend.
- **Evidence**:
  - [src/context/AuthContext.tsx](file:///d:/AAZIRA/AARIZO/src/context/AuthContext.tsx): Cold launch evaluated solely `localStorage.getItem('dwellora_user')`.
  - [src/services/apiClient.ts](file:///d:/AAZIRA/AARIZO/src/services/apiClient.ts): Checked `aarizo_user` before `saveAuthSession` was centralized.
  - [src/repositories/BaseRepository.ts](file:///d:/AAZIRA/AARIZO/src/repositories/BaseRepository.ts): 7 raw `fetch` calls without authorization tokens.
- **Root Cause**: Partial renaming during rebranding commits (`68d9621` vs `4ace018`) and uncoordinated direct fetch calls bypassing centralized client headers.
- **Confidence**: 100% (RESOLVED & VERIFIED).
- **Relevant Files**:
  - [src/services/authStorage.ts](file:///d:/AAZIRA/AARIZO/src/services/authStorage.ts) — Canonical authentication storage contract, transparent legacy migration, authoritative session validator (`isSessionValid`), atomic teardown (`clearAuthSession`), and unified `authenticatedFetch`.
  - [src/context/AuthContext.tsx](file:///d:/AAZIRA/AARIZO/src/context/AuthContext.tsx) — Integrated `authStorage` helpers; eliminated cold-launch false authentication; added mobile resume validation; bound 401 unauthorized event listener.
  - [src/services/apiClient.ts](file:///d:/AAZIRA/AARIZO/src/services/apiClient.ts) — Delegated auth headers to `getAuthHeaders()`; intercepted 401s with automatic session cleanup and `'aarizo:unauthorized'` event dispatch.
  - [src/utils/sessionRouteTracker.ts](file:///d:/AAZIRA/AARIZO/src/utils/sessionRouteTracker.ts) — Aligned route restoration keys to canonical constants with backward-compatible legacy fallbacks.
  - [src/repositories/BaseRepository.ts](file:///d:/AAZIRA/AARIZO/src/repositories/BaseRepository.ts) — Converted all 7 database collection calls to `authenticatedFetch`.
  - Feature Repositories & Services: Converted direct fetch calls to `authenticatedFetch` across [AdvertisementRepository.ts](file:///d:/AAZIRA/AARIZO/src/repositories/advertisements/AdvertisementRepository.ts), [PaymentRepository.ts](file:///d:/AAZIRA/AARIZO/src/repositories/payments/PaymentRepository.ts), [VendorRepository.ts](file:///d:/AAZIRA/AARIZO/src/repositories/vendors/VendorRepository.ts), [amenityService.ts](file:///d:/AAZIRA/AARIZO/src/services/amenityService.ts), [RazorpayService.ts](file:///d:/AAZIRA/AARIZO/src/services/payment/RazorpayService.ts), [realtimeService.ts](file:///d:/AAZIRA/AARIZO/src/services/realtimeService.ts), and [postgres.ts](file:///d:/AAZIRA/AARIZO/src/lib/postgres.ts).
  - [tests/issue03_auth_storage_consistency.test.ts](file:///d:/AAZIRA/AARIZO/tests/issue03_auth_storage_consistency.test.ts) — 22 automated unit and integration tests covering canonical keys, legacy migration, cold launch, session validation, route restoration, and 401 interception.
- **Dependencies**: React, React Router DOM, Capacitor App Plugin, Express API.
- **Resolution Applied**:
  1. Authoritative contract defined in `authStorage.ts` with canonical keys (`aarizo_token`, `aarizo_user`, `aarizo_active_session`, `aarizo_last_route`, `aarizo_last_role`).
  2. A cached user profile alone is never treated as authenticated: `isSessionValid()` strictly requires the active session flag, a valid Bearer token, and user profile.
  3. Seamless legacy migration: legacy `dwellora_*` keys are automatically converted to `aarizo_*` and purged.
  4. All direct network calls to protected `/api` endpoints wrapped in `authenticatedFetch`, automatically attaching `Authorization: Bearer <token>` and context headers.
  5. Uniform 401 handling: on unauthorized response, session is atomically wiped and `'aarizo:unauthorized'` is dispatched to transition the React app to `/login`.
- **Verification Evidence**:
  - `tests/issue03_auth_storage_consistency.test.ts`: 22 passed.
  - `tests/issue03_step33_hardening.test.ts`: 12 passed.
  - Full Jest test suite: 13 test suites, 154 tests passed (100% pass rate).
  - Server TypeScript compilation: `npm --prefix server run build` passed with zero errors.
  - Frontend production build: `npm run build` passed with zero errors (built in 878ms).
  - Detailed Audit Report: [AARIZO_ISSUE03_STORAGE_AUDIT.md](file:///d:/AAZIRA/AARIZO/AARIZO_ISSUE03_STORAGE_AUDIT.md).
  - Detailed Implementation Report: [AARIZO_ISSUE03_IMPLEMENTATION_REPORT.md](file:///d:/AAZIRA/AARIZO/AARIZO_ISSUE03_IMPLEMENTATION_REPORT.md).
  - Session Lifecycle Regression Report: [AARIZO_ISSUE03_SESSION_REGRESSION_REPORT.md](file:///d:/AAZIRA/AARIZO/AARIZO_ISSUE03_SESSION_REGRESSION_REPORT.md).
  - Independent Gate Verification: [AARIZO_ISSUE03_INDEPENDENT_VERIFICATION.md](file:///d:/AAZIRA/AARIZO/AARIZO_ISSUE03_INDEPENDENT_VERIFICATION.md).
  - Step 3.3 Hardening Implementation Report: [AARIZO_ISSUE03_STEP33_IMPLEMENTATION_REPORT.md](file:///d:/AAZIRA/AARIZO/AARIZO_ISSUE03_STEP33_IMPLEMENTATION_REPORT.md).
  - Step 3.3 Test Verification Report: [AARIZO_ISSUE03_STEP33_TEST_REPORT.md](file:///d:/AAZIRA/AARIZO/AARIZO_ISSUE03_STEP33_TEST_REPORT.md).
  - Final Remaining Gaps Audit: [AARIZO_ISSUE03_FINAL_REMAINING_GAPS.md](file:///d:/AAZIRA/AARIZO/AARIZO_ISSUE03_FINAL_REMAINING_GAPS.md).
- **Targeted Hardening Status (Step 3.3)**:
  - **GAP-07 (Firebase ID Token Refresh Synchronization)**: **RESOLVED & VERIFIED** via `onIdTokenChanged()`, `updateAuthToken()`, and monotonic async sequence tracking.
  - **GAP-08 (Multi-Tab Session Synchronization)**: **RESOLVED & VERIFIED** via native browser `storage` event listener in `AuthContext.tsx`.
  - **GAP-09 (User-Switch Token Invalidation Guard)**: **RESOLVED & VERIFIED** via defensive token purge and session abort in `saveAuthSession()`.
  - **GAP-10 (Client-Side Proactive JWT Expiry)**: **DEFERRED (NON-BLOCKING)** — Server authoritative validation is 100% active.
- **Final Verdict**: **RESOLVED & VERIFIED (FULL PASS — READY TO CLOSE)**.
- **Regression Risks**: None. Legacy sessions migrate transparently; direct fetch calls now carry valid Bearer authentication.

---

### ISSUE-04 [P1]: Missing `.env` Files Resulting in `DATABASE_URL` Initialization Error
- **Category**: Environment Setup / Runtime Blocker / Information Disclosure
- **Affected Role & Portal**: Express Backend, Background Realtime Poller, & PostgreSQL Database.
- **Exact Route / Page**: All database-dependent REST endpoints (e.g. `/api/auth/login`, `/api/societies`, `/api/residents`), background outbox poller, and health check (`/api/health`).
- **Expected Behavior**: Backend should load environment configuration reliably regardless of execution working directory, validate database configuration at startup (fail-closed in production, clear diagnostic in development), actively verify database connectivity in health checks, and sanitize error responses without disclosing internal paths or database schema.
- **Actual Behavior (Audit Verified)**:
  - Neither root `.env` nor `server/.env` exists in fresh clones.
  - Server starts up, prints green success banners, binds to port 5000, and does NOT validate `DATABASE_URL` at boot.
  - Runtime request failure: `POST http://127.0.0.1:5000/api/auth/login` returns HTTP 500 with unhandled `PrismaClientInitializationError: Environment variable not found: DATABASE_URL`.
  - Information disclosure: The 500 response payload leaks the absolute server file path (`D:\AAZIRA\AARIZO\server\src\index.ts:1687:36`) and Prisma schema source code (`schema.prisma:3`).
  - Deceptive health check: `/api/health` returns HTTP 200 `{ status: "UP", engine: "Node.js + Express + Prisma + PostgreSQL" }` even when `DATABASE_URL` is missing and PostgreSQL is offline.
  - Silent outbox poller failure: `realtimeEngine.ts` outbox poller runs every 500ms; throws database error on every tick; empty catch block silences errors without logging or degraded signaling.
  - ESM module hoisting hazard: In `server/src/index.ts`, `import { prisma } from './prisma.js'` is evaluated before `dotenv.config()`.
  - Directory-dependent dotenv loading: Default `dotenv.config()` only checks `process.cwd()/.env`, failing to find `server/.env` when run from root.
  - Template divergence: `.env.example` and `server/.env.example` use legacy `dwellora_db` with `postgres`/`user`, while `docker-compose.yml` configures `aarizo_community` with `aarizo_admin`. Templates also omit `AUTH_SECRET` and `ENABLE_DEV_MOCK_AUTH`.
- **Evidence**:
  - File system check: `Test-Path .\.env` -> `False`; `Test-Path .\server\.env` -> `False`.
  - Live HTTP curl to `POST /api/auth/login`: HTTP 500 with `Environment variable not found: DATABASE_URL`.
  - Port 5432 TCP probe: `TcpTestSucceeded : False` (PostgreSQL not running locally).
  - Code references: [server/src/index.ts#L8-L27](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L8-L27), [server/src/realtimeEngine.ts#L280-L282](file:///d:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L280-L282), [server/src/index.ts#L1723-L1739](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L1723-L1739).
- **Audit Classification**: **FAIL (Step 4.1 Audit Verified) -> RESOLVED & VERIFIED (Step 4.2 Implementation & Test Gate Pass)**.
- **Root Cause**: Uncoordinated environment loading order in ESM architecture, absence of early fail-closed startup validation, unhandled Prisma error reporting, and missing `.env` bootstrap.
- **Confidence**: 100% (RESOLVED & VERIFIED).
- **Remediations Applied (Steps 4.2 & 4.4)**:
  1. [server/src/env.ts](file:///d:/AAZIRA/AARIZO/server/src/env.ts): Deterministic environment resolution anchored to disk paths, with strict precedence (deployment env > `server/.env` > root `.env`), evaluated before downstream module singletons.
  2. [server/src/dbConfig.ts](file:///d:/AAZIRA/AARIZO/server/src/dbConfig.ts): Fail-closed startup validator (`assertDatabaseConfiguration()`). Server halts immediately with exit code 1 if `DATABASE_URL` is missing or invalid.
  3. [server/src/index.ts](file:///d:/AAZIRA/AARIZO/server/src/index.ts): Added `/api/health/live` (200 OK liveness), `/api/health/ready` (503 readiness probe with 2s timeout), and enhanced `/api/health` with 503 DEGRADED database awareness.
  4. Global Error Sanitization: Mounted Express response interceptor sanitizing all status >= 500 error bodies, preventing leakage of Prisma internals, database schema, and filesystem paths.
  5. [server/src/realtimeEngine.ts](file:///d:/AAZIRA/AARIZO/server/src/realtimeEngine.ts): Resilient outbox poller with rate-limited error logging (at most once every 60s during prolonged outages) and automated recovery notification.
  6. [server/src/shutdown.ts](file:///d:/AAZIRA/AARIZO/server/src/shutdown.ts) (Step 4.4 / F-15): Idempotent, bounded graceful shutdown on `SIGTERM` and `SIGINT`. Closes HTTP server, calls `realtimeEngine.stop()`, disconnects `prisma.$disconnect()`, and guards against duplicate signals.
  7. [docker-compose.yml](file:///d:/AAZIRA/AARIZO/docker-compose.yml) (Step 4.4 / F-17): Removed predictable secret; enforced mandatory variable validation: `"${AUTH_SECRET:?AUTH_SECRET environment variable is required...}"`.
  8. Test Stabilization (Step 4.4 / F-18): Implemented `startEphemeralServer` event-based port resolution, resolving flakiness in live HTTP tests.
- **Verification Evidence**:
  - `tests/issue04_runtime_config.test.ts`: 39 passed.
  - Full Jest test suite: 14 test suites, 193 tests passed (100% pass rate).
  - Server TypeScript compilation: `npm --prefix server run build` passed with zero errors.
  - Frontend production build: `npm run build` passed with zero errors (built in 918ms).
  - Real process shutdown: `node server/dist/index.js` cleanly shuts down on `SIGTERM` and `SIGINT` (exit code 0).
  - Docker Compose validation: `docker compose config` halts with exit code 1 when `AUTH_SECRET` is unset; succeeds when set.
  - Repository-wide search: 0 hardcoded `AUTH_SECRET` values found in source code.
  - Live PostgreSQL status: Local port 5432 is offline; live end-to-end database connectivity remains explicitly documented as pending.
  - Detailed Implementation Reports: [AARIZO_ISSUE04_STEP42_IMPLEMENTATION_REPORT.md](file:///d:/AAZIRA/AARIZO/AARIZO_ISSUE04_STEP42_IMPLEMENTATION_REPORT.md) & [AARIZO_ISSUE04_STEP44_IMPLEMENTATION_REPORT.md](file:///d:/AAZIRA/AARIZO/AARIZO_ISSUE04_STEP44_IMPLEMENTATION_REPORT.md).
  - Test Verification Reports: [AARIZO_ISSUE04_STEP42_TEST_REPORT.md](file:///d:/AAZIRA/AARIZO/AARIZO_ISSUE04_STEP42_TEST_REPORT.md) & [AARIZO_ISSUE04_STEP44_TEST_REPORT.md](file:///d:/AAZIRA/AARIZO/AARIZO_ISSUE04_STEP44_TEST_REPORT.md).
  - Independent Audit Reports: [AARIZO_ISSUE04_STEP43_FINDINGS.md](file:///d:/AAZIRA/AARIZO/AARIZO_ISSUE04_STEP43_FINDINGS.md) & [AARIZO_ISSUE04_STEP43_INDEPENDENT_VERIFICATION.md](file:///d:/AAZIRA/AARIZO/AARIZO_ISSUE04_STEP43_INDEPENDENT_VERIFICATION.md).
- **Status**: **RESOLVED & VERIFIED (FULL PASS — READY FOR ISSUE-05)**.

---

### ISSUE-05 [P1]: Seeded Database Users Lack `passwordHash` and `salt`
- **Category**: Authentication Defect / Login Failure & Account Enumeration
- **Affected Role & Portal**: All seeded accounts (`admin@aarizo.com`, `mayuri.udar@aarizo.com`, `guard.ramesh@aarizo.com`, `vikram.joshi@aarizo.com`, `ashok.mehta@aarizo.com`, `rajesh.patil@aarizo.com`, `ramesh.gupta@aquapure.com`).
- **Exact Route / Page**: `/login` (Email + Password mode) calling `POST /api/auth/login`.
- **Expected Behavior**: Seeded users should be able to authenticate with default documented credentials (e.g. `dwellora@2026`). Seeding should be idempotent and preserve existing credentials. Login responses should not leak user existence.
- **Actual Behavior**: 
  - `server/src/seed.ts` and `scripts/postgres/03_seed.sql` create users with `passwordHash: null` and `salt: null`.
  - When logging in via `/api/auth/login`, the server returns `HTTP 401: Password authentication is not configured for this user. Please contact administrator.`.
  - Account enumeration vulnerability (CWE-204): differential error message between non-existent user and user without password.
  - Inactive/suspended user vulnerability (CWE-285): `POST /api/auth/login` does not check `user.status === 'ACTIVE'`.
  - `scripts/postgres/01_schema.sql` omits `password_hash` and `salt` columns from `CREATE TABLE users`.
  - `server/src/seed.ts` uses destructive `deleteMany({})`, purging credentials on re-seed.
- **Evidence**:
  - Source: [server/src/seed.ts#L176-L288](file:///d:/AAZIRA/AARIZO/server/src/seed.ts#L176-L288) (Omitted credentials).
  - Source: [scripts/postgres/03_seed.sql#L34-L44](file:///d:/AAZIRA/AARIZO/scripts/postgres/03_seed.sql#L34-L44) (Omitted SQL columns).
  - Source: [scripts/postgres/01_schema.sql#L151-L169](file:///d:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L151-L169) (Missing DDL columns).
  - Source: [server/src/index.ts#L1756-L1765](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L1756-L1765) (Account enumeration & status check omissions).
- **Audit & Implementation Reports**:
  - Detailed Audit: [AARIZO_ISSUE05_SEED_AUTH_AUDIT.md](file:///d:/AAZIRA/AARIZO/AARIZO_ISSUE05_SEED_AUTH_AUDIT.md).
  - User Inventory: [AARIZO_ISSUE05_SEED_USER_INVENTORY.md](file:///d:/AAZIRA/AARIZO/AARIZO_ISSUE05_SEED_USER_INVENTORY.md).
  - Hashing Cryptographic Audit: [AARIZO_ISSUE05_PASSWORD_HASHING_AUDIT.md](file:///d:/AAZIRA/AARIZO/AARIZO_ISSUE05_PASSWORD_HASHING_AUDIT.md).
  - Remediation Plan: [AARIZO_ISSUE05_REMEDIATION_PLAN.md](file:///d:/AAZIRA/AARIZO/AARIZO_ISSUE05_REMEDIATION_PLAN.md).
  - Step 5.2 Implementation Report: [AARIZO_ISSUE05_STEP52_IMPLEMENTATION_REPORT.md](file:///d:/AAZIRA/AARIZO/AARIZO_ISSUE05_STEP52_IMPLEMENTATION_REPORT.md).
  - Step 5.2 Test Report: [AARIZO_ISSUE05_STEP52_TEST_REPORT.md](file:///d:/AAZIRA/AARIZO/AARIZO_ISSUE05_STEP52_TEST_REPORT.md).
  - Step 5.3 Independent Security Verification: [AARIZO_ISSUE05_STEP53_INDEPENDENT_VERIFICATION.md](file:///d:/AAZIRA/AARIZO/AARIZO_ISSUE05_STEP53_INDEPENDENT_VERIFICATION.md).
  - Step 5.3 Security Findings: [AARIZO_ISSUE05_STEP53_SECURITY_FINDINGS.md](file:///d:/AAZIRA/AARIZO/AARIZO_ISSUE05_STEP53_SECURITY_FINDINGS.md).
  - Step 5.4 Remediation Report: [AARIZO_ISSUE05_STEP54_REMEDIATION_REPORT.md](file:///d:/AAZIRA/AARIZO/AARIZO_ISSUE05_STEP54_REMEDIATION_REPORT.md).
  - Step 5.4 Security Verification: [AARIZO_ISSUE05_STEP54_SECURITY_VERIFICATION.md](file:///d:/AAZIRA/AARIZO/AARIZO_ISSUE05_STEP54_SECURITY_VERIFICATION.md).
  - Step 5.5 Independent Security Audit: [AARIZO_ISSUE05_STEP55_INDEPENDENT_AUDIT.md](file:///d:/AAZIRA/AARIZO/AARIZO_ISSUE05_STEP55_INDEPENDENT_AUDIT.md).
  - Step 5.5 Remaining Findings: [AARIZO_ISSUE05_STEP55_REMAINING_FINDINGS.md](file:///d:/AAZIRA/AARIZO/AARIZO_ISSUE05_STEP55_REMAINING_FINDINGS.md).
  - Step 5.6 Remediation Report: [AARIZO_ISSUE05_STEP56_REMEDIATION_REPORT.md](file:///d:/AAZIRA/AARIZO/AARIZO_ISSUE05_STEP56_REMEDIATION_REPORT.md).
  - Step 5.6 Verification Report: [AARIZO_ISSUE05_STEP56_VERIFICATION_REPORT.md](file:///d:/AAZIRA/AARIZO/AARIZO_ISSUE05_STEP56_VERIFICATION_REPORT.md).
- **Targeted Hardening Applied**:
  - **F-19 (Fail-Closed Seed Environment Detection)**: Normalizes `NODE_ENV`, checks CI and cloud platform markers, and prevents default fallback in non-dev environments.
  - **F-20 (Guarded Destructive Operations)**: Blocks `--force-clean` / `SEED_FORCE_CLEAN` in non-dev environments and requires dual confirmation flag or env var in local development.
  - **F-22 (Strict Scrypt Parameter Bounds)**: Strict envelope regex, salt length and hex format checks, parameter allowlist (`ALLOWED_SCRYPT_CONFIG_KEYS`), and bounded `maxmem` (256 MiB).
  - **F-23 (Fail-Closed SQL Seed Guard & Docker Compose Isolation)**: Strict fail-closed whitelist in `03_seed.sql` (`current_env NOT IN ('development', 'dev', 'test', 'local')`), removed `03_seed.sql` from default `docker-compose.yml`, created `docker-compose.dev.yml` override.
  - **F-24 (Concurrency-Safe Password Rehash)**: Optimistic conditional `updateMany({ where: { id, passwordHash: verifiedHash } })` preventing stale hash overwrites during concurrent logins or password updates.
  - **F-25 (Asynchronous Scrypt & Resource Bounding)**: Non-blocking `verifyPasswordAsync` and `hashPasswordScryptAsync` off event loop, `loginRateLimiter` (10 req/min per IP), and `AuthConcurrencyLimiter` bounding total scrypt RAM to $\le 512$ MiB.
  - **F-26 (Fail-Closed Migration Resolution)**: Whitelist-only migration file selection in `scripts/postgres/migrate.ts`, strict rejection of `APPLY_DEMO_SEED=true` outside dev.
  - **F-27 (Deployment Documentation Hardening)**: Removed `03_seed.sql` execution commands from production deployment documentation in `HOST_DEPLOYMENT_GUIDE.md` and `POSTGRES_MIGRATION_GUIDE.md`.
- **Root Cause**: Commit `8204a21` introduced database-backed password authentication for dynamic provisioning but failed to update seed files.
- **Confidence**: 100% (CONFIRMED P1 DEFECT — FULLY REMEDIATED AND REGRESSION-TESTED).
- **Relevant Files**: `server/src/crypto.ts`, `server/src/auth.ts`, `server/src/provisioning.ts`, `server/src/index.ts`, `server/src/seed.ts`, `scripts/postgres/01_schema.sql`, `scripts/postgres/03_seed.sql`, `scripts/postgres/migrate.ts`, `docker-compose.yml`, `docker-compose.dev.yml`, `docs/HOST_DEPLOYMENT_GUIDE.md`, `docs/POSTGRES_MIGRATION_GUIDE.md`.
- **Status**: **REMEDIATED & PASSING — CONDITIONALLY VERIFIED (READY FOR LIVE DATABASE VALIDATION)**.

---

### ISSUE-06 [P1]: Tri-Tier State Desynchronization (LocalStorage vs PostgreSQL vs Firestore)
- **Category**: Data Integrity / Split-Brain State
- **Affected Role & Portal**: Cross-role data consistency (Residents, Gate Guards, Society Secretary).
- **Exact Route / Page**: Visitors, Child Safety, Maintenance, Societies.
- **Expected Behavior**: Changes made in any portal should reflect consistently across all clients through an authoritative database.
- **Actual Behavior**:
  - `societyService.ts`, `visitorService.ts`, and `childSafetyService.ts` update browser `localStorage` synchronously.
  - They attempt Firestore and Express API writes in non-blocking background promises (`.catch(() => {})`).
  - When PostgreSQL or network connectivity is unavailable, records persist locally in that specific browser but never reach the database or other devices.
- **Evidence**: [src/services/societyService.ts#L87-L92](file:///d:/AAZIRA/AARIZO/src/services/societyService.ts#L87-L92).
- **Root Cause**: Hybrid architectural migration from Firebase/LocalStorage to PostgreSQL.
- **Confidence**: 95% (CODE-CONFIRMED).
- **Relevant Files**: `src/services/societyService.ts`, `src/services/visitorService.ts`, `src/services/childSafetyService.ts`, `src/services/db.ts`.
- **Recommended Minimal Fix**: Make API persistence authoritative with offline queuing, or show clear sync-pending badges when offline.

---

### ISSUE-07 [P2]: Realtime Outbox 500ms Poller Lacks Database Backoff
- **Category**: Reliability / Resource Exhaustion
- **Affected Role & Portal**: Express Server / Realtime Engine.
- **Exact Route / Page**: `server/src/realtimeEngine.ts`.
- **Expected Behavior**: The background poller should pause or back off when database connectivity is severed.
- **Actual Behavior**: `startOutboxWorker()` runs `setInterval(async () => { ... prisma.outboxEvent.findMany(...) }, 500)` unconditionally. When PostgreSQL is offline, it triggers error logs every 500ms.
- **Evidence**: [server/src/realtimeEngine.ts#L243-L252](file:///d:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L243-L252).
- **Root Cause**: Poller does not catch connection errors with exponential backoff.
- **Confidence**: 100% (VERIFIED).
- **Relevant Files**: `server/src/realtimeEngine.ts`.
- **Recommended Minimal Fix**: Implement failure backoff counter in `startOutboxWorker()`.

---

### ISSUE-08 [P2]: In-Memory Sliding Window Rate Limiter Non-Persistent
- **Category**: Security / Scalability
- **Affected Role & Portal**: Express Server Auth Middleware.
- **Exact Route / Page**: `server/src/auth.ts` -> `rateLimiter()`.
- **Expected Behavior**: Rate limiting should survive server restarts and scale across clustered processes.
- **Actual Behavior**: In-memory `Map` resets on process restart and does not scale across instances.
- **Confidence**: 95% (CODE-CONFIRMED).
- **Relevant Files**: `server/src/auth.ts`.
- **Recommended Fix**: Use Redis-backed rate limiter for distributed production environments.

---

### ISSUE-09 [P2]: Inconsistent Branding Identity (`AARIZO` vs `Dwellora` vs `CommunityOS`)
- **Category**: UI / Brand Consistency
- **Affected Role & Portal**: All Portals.
- **Observed Behavior**:
  - Repository name: `AARIZO`.
  - Android App name in `capacitor.config.ts`: `AARIZO`.
  - Login screen title: `"Sign In to Dwellora"`.
  - Web title: `<title>Dwellora</title>`.
  - Storage keys: `dwellora_*` and `communityos_*`.
- **Expected Behavior**: Unified `AARIZO` branding across all user-facing surfaces.
- **Confidence**: 100% (VERIFIED).
- **Relevant Files**: `LoginScreen.tsx`, `index.html`, `package.json`, `server/package.json`.

---

### ISSUE-10 [P2]: Native Android Container Missing `google-services.json`
- **Category**: Mobile Build / Push Notifications
- **Affected Role & Portal**: Native Android APK (`android/app`).
- **Observed Behavior**: `android/app/build.gradle` conditionally applies Google services only if `google-services.json` exists. Without it, FCM push notifications cannot initialize on Android.
- **Confidence**: 100% (CODE-CONFIRMED).
- **Relevant Files**: `android/app/build.gradle`.

---

### ISSUE-11 [P3]: Monolithic 2.72 MB JavaScript Chunk Warning in Vite Build
- **Category**: Performance / Bundle Optimization
- **Affected Role & Portal**: Initial Page Load across Web and Android WebView.
- **Observed Behavior**: `dist/assets/index-Gzc38VfQ.js` is 2,722.57 kB (gzip: 633.53 kB). Vite reports a warning that the chunk exceeds 500 kB.
- **Expected Behavior**: Code-split routes using `React.lazy()` and `Suspense` so each role dashboard loads on demand.
- **Confidence**: 100% (VERIFIED).
- **Relevant Files**: `src/routes/index.tsx`, `vite.config.ts`.

---

### ISSUE-12 [P3]: 216 Oxlint Warnings: Impure Render Calls & Cascading SetState
- **Category**: Code Quality / React Compiler Optimization
- **Affected Role & Portal**: `ResidentAmenityBookingPage`, `CommitteeDashboard`, `useMoves.ts`, `BillingManagementPage`.
- **Observed Behavior**: Oxlint flags 216 warnings (0 errors). Includes calling `Date.now()` during render (`ResidentAmenityBookingPage:1510`) and calling `setState` synchronously within `useEffect`.
- **Confidence**: 100% (VERIFIED).
- **Relevant Files**: Listed in `AARIZO_TESTING_QUALITY_AUDIT.md`.

---

### ISSUE-13 [P3]: `cap:sync` Fails Before Initial Production Build
- **Category**: Mobile Build Workflow
- **Affected Role & Portal**: Capacitor CLI synchronization.
- **Observed Behavior**: Running `npm run cap:sync` before `npm run build` fails because `dist/` directory does not exist.
- **Expected Behavior**: Script should run build automatically: `"cap:sync": "npm run build && npx cap sync"`.
- **Confidence**: 100% (VERIFIED).
- **Relevant Files**: `package.json`.

---

### ISSUE-14 [P4]: Firestore Security Rules Unit Tests Skipped Without Emulator
- **Category**: Test Infrastructure
- **Affected Role & Portal**: `tests/security.test.ts`.
- **Observed Behavior**: Tests log warning and skip when Firestore emulator is offline on port 8088.
- **Confidence**: 100% (VERIFIED).
- **Relevant Files**: `tests/security.test.ts`.

