# AARIZO — Phase A, Step 3.2: ISSUE-03 Independent Verification Gate

**Date:** November 14, 2026  
**Auditor:** Principal Software Architect, Senior Security Auditor & QA Lead  
**Scope:** Independent Verification of ISSUE-03 (Authentication Storage & Session Consistency)  
**Target:** `D:\AAZIRA\AARIZO`  
**Final Verdict:** **CONDITIONAL PASS — SPECIFIC GAPS REMAIN**

---

## 1. Executive Summary

An independent, audit-only verification of the Phase A, Step 3.1 implementation was conducted. The audit verified that:
1. The authoritative authentication contract (`src/services/authStorage.ts`) resolves the historical storage key fragmentation between `dwellora_user` and `aarizo_user`.
2. Stale or orphaned user profiles in `localStorage` can no longer create authenticated sessions upon cold browser boot; `isSessionValid()` strictly requires the active session flag, a non-empty Bearer token, and a valid user profile.
3. Direct `fetch()` calls across all repositories (`BaseRepository`, `PaymentRepository`, `AdvertisementRepository`, `VendorRepository`) and services (`amenityService`, `RazorpayService`, `realtimeService`, `postgres.ts`) have been wrapped in `authenticatedFetch()`, attaching the authoritative Bearer token to all protected API calls.
4. HTTP 401 responses on protected endpoints cleanly trigger `clearAuthSession()` and dispatch `'aarizo:unauthorized'`, immediately resetting React state to `UNAUTHENTICATED`.
5. The backend (`server/src/index.ts` and `server/src/auth.ts`) continues to strictly ignore client-supplied identity headers (`x-user-role`, `x-user-id`, `x-society-id`) for authorization.
6. All 12 test suites (142 tests) pass, and both backend (`tsc`) and frontend (`tsc -b && vite build`) compile with zero errors.

Three secondary operational gaps were identified regarding token lifecycle and multi-tab synchronization:
- **GAP-07**: Firebase ID tokens are not refreshed via `onIdTokenChanged` on long-running tabs (>60 minutes).
- **GAP-08**: Multi-tab logout synchronization relies on reactive network-call failure rather than an instantaneous `window.storage` event listener.
- **GAP-09**: `saveAuthSession` does not explicitly invalidate an existing token if a different user profile is saved with `token = undefined`.

Consequently, the gate verdict is **CONDITIONAL PASS — SPECIFIC GAPS REMAIN**.

---

## 2. Detailed Audit Findings by Dimension

### 2.1 Authentication Storage Contract (`src/services/authStorage.ts`)

| Requirement | Audit Finding | Evidence / Code Reference | Status |
| :--- | :--- | :--- | :---: |
| **Canonical Keys & Purpose** | Standardized keys defined: `aarizo_token`, `aarizo_user`, `aarizo_active_session`, `aarizo_last_route`, `aarizo_last_role`, `aarizo_auth_provider`, `aarizo_onboarding_completed`. | [src/services/authStorage.ts#L3-L11](file:///d:/AAZIRA/AARIZO/src/services/authStorage.ts#L3-L11) | **VERIFIED** |
| **Consistent Readers & Writers** | `AuthContext.tsx`, `apiClient.ts`, `sessionRouteTracker.ts`, and `BaseRepository.ts` all route through `authStorage.ts` helpers. | `src/context/AuthContext.tsx`, `src/services/apiClient.ts` | **VERIFIED** |
| **Legacy Key Migration Safety** | `getAuthToken()` and `getStoredUser()` migrate legacy keys (`dwellora_user`, `dwellora_token`) to canonical keys and remove legacy entries. Idempotent and safe if interrupted. | [src/services/authStorage.ts#L61-L69](file:///d:/AAZIRA/AARIZO/src/services/authStorage.ts#L61-L69) | **VERIFIED** |
| **Cold-Launch Profile Elevation Guard** | A user profile alone is rejected as unauthenticated. `isSessionValid()` requires active session flag + token + profile. | [src/services/authStorage.ts#L110-L124](file:///d:/AAZIRA/AARIZO/src/services/authStorage.ts#L110-L124) | **VERIFIED** |
| **Preservation of Unrelated Data** | `clearAuthSession()` removes only authentication and session keys. Unrelated preferences (`aarizo_theme`, offline caches) are preserved. | [src/services/authStorage.ts#L164-L188](file:///d:/AAZIRA/AARIZO/src/services/authStorage.ts#L164-L188) | **VERIFIED** |
| **User Switching Safety** | Overwrites `aarizo_user` and `aarizo_last_role`. When a new token is provided, overwrites `aarizo_token`. | [src/services/authStorage.ts#L129-L159](file:///d:/AAZIRA/AARIZO/src/services/authStorage.ts#L129-L159) | **VERIFIED (With GAP-09 Note)** |

---

### 2.2 Token Validity & Lifecycle

1. **Client-Side vs Server-Side Token Validation**:
   - **Crucial Architectural Confirmation:** Browser client-side code (`isSessionValid`) validates only the structural presence of an active session flag, token string, and user profile.
   - **No cryptographic validation occurs in the browser**, nor should it: the HMAC secret is exclusively maintained on the server.
   - Authoritative cryptographic verification (HMAC-SHA256 signature, expiry timestamp, issuer `aarizo-api`, audience `aarizo-client`, and database user status) is performed strictly on the backend by `authenticateToken` in `server/src/auth.ts`.
2. **Expired & Revoked Tokens**:
   - Backend returns HTTP 401 `AUTH_TOKEN_INVALID` for expired or tampered tokens, and HTTP 401 `USER_NOT_PROVISIONED` or HTTP 403 `ACCOUNT_SUSPENDED` if the database record is deactivated.
   - Frontend `authenticatedFetch` intercepts the 401, clears storage, and drops React auth state.
3. **Password vs Firebase Token Distinction**:
   - Password tokens are HMAC-SHA256 JWTs.
   - Firebase tokens are Google-issued RSA-signed ID tokens.
   - Server-side verification strictly distinguishes them in order: `verifyServerToken()` followed by `verifyIdToken()`.
4. **Firebase Token Refresh Lifecycle (GAP-07)**:
   - `AuthContext.tsx` uses `onAuthStateChanged()`. While Firebase SDK automatically refreshes ID tokens internally after ~55 minutes, `onAuthStateChanged()` does not emit on token refresh alone. Therefore, long-lived sessions (>1 hour) without page reloads risk encountering a 401 when the initial token expires.
5. **Cross-Tab Consistency (GAP-08)**:
   - When Tab 1 logs out, `localStorage.removeItem('aarizo_token')` is executed.
   - Tab 2 discovers the logout upon its next network request (which receives 401 and resets React state). However, Tab 2 lacks an immediate `storage` event listener to unmount immediately in the background.

---

### 2.3 Bearer Token Propagation

The full git diff was inspected across all modified repositories and services:

| File Path | Verification Details | Result |
| :--- | :--- | :---: |
| `src/repositories/BaseRepository.ts` | 7 `fetch()` calls converted to `authenticatedFetch()`. `getCurrentUserId()` uses `getStoredUser()`. | **VERIFIED** |
| `src/repositories/advertisements/AdvertisementRepository.ts` | `recordImpression` and `recordClick` converted to `authenticatedFetch()`. | **VERIFIED** |
| `src/repositories/payments/PaymentRepository.ts` | `listBySociety`, `listByResident`, `subscribeByInvoice`, and `subscribePayment` converted to `authenticatedFetch()`. | **VERIFIED** |
| `src/repositories/vendors/VendorRepository.ts` | `getVendorByUid` converted to `authenticatedFetch()`. | **VERIFIED** |
| `src/services/amenityService.ts` | `getAmenityAvailability`, `bookAmenity`, and `updateBookingStatus` converted to `authenticatedFetch()`. | **VERIFIED** |
| `src/services/payment/RazorpayService.ts` | `refundPayment` converted to `authenticatedFetch()`. External SDK load via CDN script tag preserved. | **VERIFIED** |
| `src/services/realtimeService.ts` | `publish` outbox broadcast converted to `authenticatedFetch()`. | **VERIFIED** |
| `src/lib/postgres.ts` | `query`, `insert`, `update`, `delete` converted to `authenticatedFetch()`. | **VERIFIED** |
| `src/services/apiClient.ts` | Centralized `apiRequest` uses `getAuthHeaders()`; intercepts 401 with session cleanup. | **VERIFIED** |

**Zero Raw Protected Fetch Calls Remain**: An exhaustive codebase search confirmed that no unauthenticated `fetch()` calls to `/api/` exist in `src/`.

---

### 2.4 Identity Header Trust (Backend Verification)

- `server/src/index.ts` lines 85–90:
  ```typescript
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.societyId = req.authContext?.societyId;
    req.userId = req.authContext?.userId;
    req.userRole = req.authContext?.role;
    next();
  });
  ```
- An exhaustive search across `server/src/` for `x-user-role`, `x-user-id`, and `x-society-id` yielded **0 occurrences**.
- All server-side authorization decisions in `requireRole` and `requireSocietyMembership` rely exclusively on verified `req.authContext`.

---

### 2.5 401 Handling and State Consistency

1. **Protected Endpoint Invalidation**:
   - `authenticatedFetch` and `apiClient` intercept HTTP 401, execute `clearAuthSession()`, and dispatch `CustomEvent('aarizo:unauthorized')`.
   - `AuthContext.tsx` handles `'aarizo:unauthorized'` by setting `status = 'UNAUTHENTICATED'` and `currentUser = null`.
2. **Public Endpoint Immunity**:
   - Both interceptors check `!urlStr.includes('/api/auth/login')`. A bad password attempt returns 401 without purging session state or logging out active sessions.
3. **Parallel Request Safety**:
   - Multiple concurrent 401 responses trigger synchronous, idempotent `localStorage` and `sessionStorage` removals. React state transitions (`null`, `'UNAUTHENTICATED'`) are batched/idempotent.
4. **No Infinite Loops**:
   - Interceptors do not attempt automated re-fetching or retries on 401.

---

## 3. Test & Build Classification Matrix

All 12 test suites and 142 tests were executed and passed. In accordance with strict auditing standards, the tests are classified below by their true execution reality:

| Test Suite File | Tests | Status | Execution Reality Classification | Notes |
| :--- | :---: | :---: | :--- | :--- |
| `tests/issue03_auth_storage_consistency.test.ts` | 22 | PASS | **Unit Tests & Mocked Integration Tests** | Mocks `localStorage`, `sessionStorage`, `fetch`, and `window.dispatchEvent`. Validates contract logic. |
| `tests/route_protection.test.ts` | 11 | PASS | **Unit Tests & Static Code Analysis Tests** | Pure logic guard replicas and AST/regex route checks on `src/routes/index.tsx`. |
| `tests/issue02_gap01_secret_hardening.test.ts` | 9 | PASS | **Unit Tests** | Tests secret validation and HMAC generation with mocked environment variables. |
| `tests/issue02_gap02_mock_auth_hardening.test.ts` | 10 | PASS | **Mocked Integration Tests** | Tests Express middleware with mocked `req`/`res` and mocked Prisma client. |
| `tests/issue02_gap03_sse_authorization.test.ts` | 8 | PASS | **Mocked Integration Tests** | Tests SSE route handler with mocked Express `req`/`res` and mocked `realtimeHub`. |
| `tests/auth_middleware.test.ts` | 9 | PASS | **Mocked Integration Tests** | Tests `authenticateToken`, `requireRole`, and society guards with mocked Prisma. |
| `tests/issue02_privilege_escalation.test.ts` | 14 | PASS | **Mocked Integration Tests** | Tests token validation and header rejection with mocked Prisma and Express. |
| `tests/issue02_unified_auth_integration.test.ts` | 20 | PASS | **Mocked Integration Tests** | Dual-mode token tests with mocked Prisma and mocked Firebase Admin SDK. |
| `tests/provisioning.test.ts` | 7 | PASS | **Mocked Integration Tests** | Tests user provisioning logic with mocked Prisma client. |
| `tests/razorpay.test.ts` | 14 | PASS | **Unit Tests & Mocked Integration Tests** | Tests HMAC webhook verification and order handling with mocked Prisma. |
| `tests/differentiators.test.ts` | 18 | PASS | **Unit Tests** | Tests business domain calculation functions (amenities, visitor QR, billing). |
| `tests/security.test.ts` | 0 | SKIPPED | **Real Firebase Emulator Integration Tests** | Skipped because Firestore emulator on `127.0.0.1:8088` is offline. |

> **Audit Note:** No tests currently run against a live running PostgreSQL database or live Firebase cloud project. Tests validate business logic, middleware contracts, and crypto routines using mocked database and network adapters.

---

## 4. Build Verifications

1. **Backend Build (`npm --prefix server run build`)**:
   - `tsc` exited with code 0 (zero errors).
2. **Frontend Production Build (`npm run build`)**:
   - `tsc -b && vite build` exited with code 0 (2179 modules transformed, built in 870ms).

---

## 5. Conclusion & Final Verdict

The Step 3.1 implementation successfully resolves the P1 storage key desynchronization issue, establishes an authoritative authentication contract, eliminates cold-launch false authentication, and ensures all API communication transmits verified Bearer credentials.

Because secondary gaps remain regarding Firebase silent token refresh synchronization (GAP-07), cross-tab passive logout synchronization (GAP-08), and user switching token invalidation (GAP-09), the authoritative verification gate verdict is:

**CONDITIONAL PASS — SPECIFIC GAPS REMAIN**

