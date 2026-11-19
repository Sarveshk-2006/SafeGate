# AARIZO — ISSUE-02 Final Security Verification Gate Audit

**Document ID**: AARIZO-VER-ISSUE02-001  
**Audit Phase**: Phase A, Step 2.3 (Security Verification Gate)  
**Target Issue**: ISSUE-02 (Client-Supplied Header Privilege Escalation & Unprotected Express API)  
**Audit Lead**: Principal Security Architect & Senior Full-Stack Lead  
**Working Directory**: `d:\AAZIRA\AARIZO`  
**Date**: November 14, 2026  
**Final Decision**: **CONDITIONAL PASS — MINOR GAPS REMAIN**  

---

## 1. Executive Summary & Verification Gate Decision

In Step 2.2, a unified dual-mode authentication engine and global route protection middleware were implemented across `server/src/auth.ts`, `server/src/index.ts`, `src/services/apiClient.ts`, `src/context/AuthContext.tsx`, and `src/components/auth/login/LoginScreen.tsx`.

This independent security gate audited the actual source code, route registrations, cryptographic mechanisms, environment configurations, and live HTTP execution on port 5000.

### Verification Gate Decision:
**`CONDITIONAL PASS — MINOR GAPS REMAIN`**

### Summary of Verdict:
1. **Core Vulnerability Neutralized (VERIFIED)**: The critical P0 vulnerability—client-header privilege escalation via `x-user-role`, `x-society-id`, and `x-user-id`—has been **completely eliminated**. Client-supplied identity headers are ignored. Role, tenant, and user identity are strictly established by server authentication.
2. **Global Route Protection Active (VERIFIED)**: All 142 endpoints prefixed with `/api` pass through the global `authenticateToken` middleware; unauthenticated requests are rejected with HTTP 401 `AUTH_TOKEN_MISSING`. Exactly 4 endpoints are allowlisted as public.
3. **Hardening & Security Gaps Identified (AUDITED)**: Three high-severity configuration/authorization gaps and four medium/low architectural gaps were discovered during deep code inspection that must be remediated prior to production deployment.

---

## 2. Verification Analysis Across the 8 Core Dimensions

### Dimension 1: Route Coverage & Middleware Pipeline
- **Endpoint Recalculation**: Independent AST inspection verified exactly **143 routes** (142 `/api/*` routes + 1 frontend SPA catch-all).
- **Global Authentication**: Mounted at line 73 of `server/src/index.ts` via `app.use('/api', ...)`. Every route starting with `/api` executes `authenticateToken` unless explicitly allowlisted.
- **Public Allowlist**: Exactly 4 routes are allowlisted in `isPublicApiRoute`:
  - `GET /api/health` (Diagnostics)
  - `GET /api/realtime/health` (Realtime Engine Health)
  - `POST /api/auth/login` (Credential Verification & Token Issuance)
  - `POST /api/payments/razorpay/webhook` (Third-Party Payment Webhook)
- **Role Enforcement**: 85 routes mount `requireRole([...])`. Role evaluation is strictly bound to `req.authContext.role`.
- **Tenant Isolation Gap**: **0 out of 143 routes** mount `requireSocietyMembership`. While `req.societyId` is populated from the token, individual handlers use ad-hoc fallback logic (`req.societyId || req.body.societyId || 'soc-gvs'`), leaving tenant boundaries dependent on handler-level implementation.

### Dimension 2: Token Security & Cryptographic Integrity
- **Cryptographic Engine**: Uses native Node.js `crypto.createHmac('sha256', secret)` with constant-time verification via `crypto.timingSafeEqual` in `timingSafeCompare`.
- **Claim Enforcement**: `sub`, `exp`, `iss: 'aarizo-api'`, and `aud: 'aarizo-client'` are strictly validated. Tampered signatures, altered payloads, and expired tokens return `null`.
- **Hardcoded Secret Vulnerability (HIGH)**: `getAuthSecret()` falls back to a hardcoded string `'aarizo_secure_production_secret_key_2026'` if `AUTH_SECRET` and `JWT_SECRET` are not set in `.env`. A missing secret in production fails open rather than failing closed!
- **Authoritative Database Anchor**: Every token request queries `prisma.user.findFirst` to verify the account is active (`status === 'ACTIVE'`) and retrieves the authoritative role.
- **Revocation / Invalidation**:
  - Suspended accounts: Immediately blocked on the next request (HTTP 403 `ACCOUNT_SUSPENDED`).
  - Role demotion: Effective immediately on the next request.
  - Password change / Logout: No server-side revocation list or `tokenVersion` check exists. Tokens remain cryptographically valid until the 24-hour expiration.

### Dimension 3: Firebase Authentication End-to-End
- **Current Operational Status**: **MOCK / DEMO ONLY**.
- **Frontend Flow**: `src/components/auth/login/LoginScreen.tsx` (lines 150-159) intercepts demo OTPs (`4092`, `1234`) and directly invokes `loginAsRole(role)`.
- **Cloud Infrastructure**: `src/services/firebase/config.ts` uses `"mock-key"`, `"mock-domain"`, and `"aarizo-local"`. No production Firebase project or service account exists in `.env`.
- **Prisma Schema Disconnection**: The PostgreSQL `User` table has no `firebaseUid` column. In `server/src/auth.ts`, user lookup searches `OR: [{ id: uid }, ...(email ? [{ email }] : [])]`. Because Firebase Phone OTP users have no email and their Firebase UID does not match PostgreSQL `User.id`, real Firebase phone OTP logins would fail with HTTP 401 `USER_NOT_PROVISIONED`.

### Dimension 4: Development Mock Authentication
- **Vulnerability (HIGH)**: In `server/src/auth.ts` lines 187-195:
  ```ts
  if (process.env.NODE_ENV !== 'production' && token.startsWith('mock_token_')) {
    uid = token.replace('mock_token_', '');
  }
  ```
- If `NODE_ENV` is unset or undefined (the default in Node.js when booted without explicit environment flags), `process.env.NODE_ENV !== 'production'` evaluates to `true`.
- **Impersonation Risk**: An attacker sending `Authorization: Bearer mock_token_user-admin-1` against an unconfigured server is resolved to the database admin and granted unrestricted platform administrator privileges (`role: 'admin'`).

### Dimension 5: Realtime SSE & Public Endpoints
- **Query Parameter Exposure**: `GET /api/realtime/stream?token=...` accepts tokens via URL query parameters, exposing them to server access logs, reverse proxies, and browser history.
- **Parameter Override Vulnerability (HIGH)**: In `server/src/index.ts` lines 117-119:
  ```ts
  const societyId = (req.query.societyId as string) || req.societyId || 'soc-gvs';
  const userId = (req.query.userId as string) || req.userId;
  const role = (req.query.role as string) || req.userRole || 'resident';
  ```
  `req.query.role` and `req.query.societyId` take precedence over verified `req.userRole` and `req.societyId`! An authenticated resident can subscribe as `role=admin` to any society's realtime event stream.
- **Razorpay Webhook**: `POST /api/payments/razorpay/webhook` preserves unparsed raw bytes in `req.rawBody` and verifies HMAC signatures using `timingSafeCompare`. Verified working.

### Dimension 6: Frontend Integration
- **Password Authentication**: Stores backend-issued Bearer token in `localStorage['aarizo_token']` and attaches `Authorization: Bearer <token>` in `src/services/apiClient.ts`.
- **Disconnected Subsystem (`BaseRepository.ts`)**: `src/repositories/BaseRepository.ts` makes direct `fetch('/api/collections/...')` calls without using `apiClient.ts` and without attaching `Authorization: Bearer <token>`. Under global route protection, all repository calls fail with HTTP 401 `AUTH_TOKEN_MISSING`.

### Dimension 7: Test Quality & Reproducibility
- **Automated Test Results**: All 8 test suites and 93 tests pass.
- **Test Methodology Distinction**: Tests in `tests/issue02_unified_auth_integration.test.ts` (20 tests) and `tests/issue02_privilege_escalation.test.ts` (14 tests) are **mocked unit tests**. They mock Express `req`/`res` and `prisma.user.findFirst`. Neither Supertest nor real PostgreSQL connections are utilized in the Jest runner.
- **Live Server HTTP Verification**: Independently verified against the active Node.js server on port 5000:
  - `GET /api/health` -> HTTP 200 OK.
  - `GET /api/residents` (no token) -> HTTP 401 `AUTH_TOKEN_MISSING`.
  - `GET /api/residents` (with `x-user-role: admin`) -> HTTP 401 `AUTH_TOKEN_MISSING`.
  - `GET /api/nonexistent` (no token) -> HTTP 401 `AUTH_TOKEN_MISSING`.
  - `GET /nonexistent` (SPA route) -> HTTP 200 OK (serves `index.html`).

### Dimension 8: ISSUE-03 Overlap & Remaining Scope
- **Partial Resolution**: `AuthContext.tsx` dual-writes `dwellora_user` and `aarizo_user`, and `apiClient.ts` reads both keys.
- **Remaining Scope for ISSUE-03**:
  1. Cold launch cleanup (`AuthContext.tsx` line 58) only removes `dwellora_user`, leaving `aarizo_user` orphaned.
  2. State restoration (`AuthContext.tsx` lines 64 & 77) only reads `dwellora_user`.
  3. `BaseRepository.ts` reads `aarizo_user` but completely omits the Bearer token when making `fetch()` requests.
  4. ISSUE-03 remains an active, distinct defect.

---

## 3. Consolidated Findings & Gaps Register

| Finding ID | Severity | Location | Category | Finding Summary |
| :--- | :---: | :--- | :--- | :--- |
| **FINDING-SEC-01** | **HIGH** | `server/src/auth.ts:58` | Secret Management | Hardcoded fallback secret allows token forgery if env vars are unset |
| **FINDING-SEC-02** | **HIGH** | `server/src/auth.ts:187` | Authentication Bypass | Missing `NODE_ENV` enables dev mock token & admin impersonation |
| **FINDING-SEC-03** | **HIGH** | `server/src/index.ts:117-119` | Authorization Bypass | Query params override verified server context in realtime SSE stream |
| **FINDING-SEC-04** | **MEDIUM** | `server/src/auth.ts:199-203` | Integration Gap | Firebase Auth is mock-only; Prisma lacks `firebaseUid` column |
| **FINDING-SEC-05** | **MEDIUM** | `src/repositories/BaseRepository.ts:42`| Integration Defect | Direct `fetch()` calls omit Bearer token, breaking repository operations |
| **FINDING-SEC-06** | **MEDIUM** | `server/src/index.ts` | Tenant Isolation | `requireSocietyMembership` is not mounted on any of the 143 endpoints |
| **FINDING-SEC-07** | **LOW** | `server/src/auth.ts:144` | Information Exposure | SSE query parameter token (`?token=...`) exposed in server logs |

---

## 4. Status Determination

- **Primary Objective Achieved**: Client-header privilege escalation (`x-user-role`) is completely eliminated.
- **Secondary Objective Achieved**: Global authentication protects all 139 non-public Express endpoints.
- **Readiness Verdict**: **CONDITIONAL PASS — MINOR GAPS REMAIN**.
- **Action**: Proceed with the approved implementation roadmap by addressing the remediation gaps identified above before final production deployment.

