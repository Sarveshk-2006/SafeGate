# AARIZO — Dual-Mode Authentication & Protected API Implementation Report

**Document ID**: AARIZO-REP-AUTH-002  
**Implementation Phase**: Phase A, Step 2.2  
**Target Issue**: ISSUE-02 (Eliminate Client-Header Privilege Escalation & Secure All 143 REST API Endpoints)  
**Status**: COMPLETED & VERIFIED  
**Author**: Principal Security Architect & Senior Full-Stack Lead  
**Working Directory**: `d:\AAZIRA\AARIZO`  
**Date**: November 14, 2026  

---

## 1. Executive Summary

In Phase A, Step 2.1, an architectural audit uncovered that while client-header privilege escalation had been disabled in `server/src/auth.ts`, the Express API lacked a functioning token authentication mechanism. 85 role-guarded endpoints rejected all legitimate callers with HTTP 403 `ROLE_MISSING`, 54 endpoints were completely unprotected from anonymous access, and `POST /api/auth/login` returned no access tokens.

In Phase A, Step 2.2, we implemented the approved **Dual-Mode Token Authentication Architecture (Option 3)** across the entire stack. This implementation:
1. **Eliminated Anonymous & Unauthenticated Access**: Secured all 139 protected API endpoints with the unified `authenticateToken` middleware.
2. **Eliminated Identity Spoofing**: Enforced that user role (`req.authContext.role`), society membership (`req.authContext.societyId`), and user ID (`req.authContext.dbUserId`) are strictly resolved from authoritative PostgreSQL records (`prisma.user`), never from client-supplied headers.
3. **Implemented Zero-Dependency Cryptographic Bearer Tokens**: Built a native Node.js `crypto` HMAC-SHA256 token issuance and constant-time verification engine with tamper-proof signatures, issuer/audience validation, and expiration enforcement.
4. **Unified Multi-Modal Authentication**: Supports PostgreSQL email/password Bearer tokens, Firebase Admin ID tokens (phone OTP), and scoped non-production development tokens (`mock_token_<uid>`).
5. **Seamless Frontend Integration**: Integrated token storage in `localStorage` (`'aarizo_token'`) and automatic transmission via `Authorization: Bearer <token>` in `src/services/apiClient.ts`, `src/context/AuthContext.tsx`, and `src/components/auth/login/LoginScreen.tsx`.
6. **Preserved Realtime SSE Streaming**: Enabled query parameter token fallback (`GET /api/realtime/stream?token=...`) to accommodate browser `EventSource` limitations without compromising token verification.
7. **Verified via 20 Integration Tests**: Authored comprehensive security and functional tests in `tests/issue02_unified_auth_integration.test.ts`. All 20 tests passed, bringing the project total to **8 test suites and 93 tests passing (100% pass rate)**.

---

## 2. Architecture Overview & Request Lifecycle

```
[ Frontend Client ]
        │
        ├── Email / Password  ───>  POST /api/auth/login (Public) ───> Issues HMAC-SHA256 Bearer Token
        ├── Phone OTP         ───>  Firebase Auth (Client SDK)   ───> Issues Firebase ID Token
        └── Dev Quick-Login   ───>  Local Role Selector          ───> Scoped `mock_token_<uid>` (DEV only)
        │
        ▼
Stores token in `localStorage['aarizo_token']`
Attaches `Authorization: Bearer <token>` (or `?token=` for SSE)
        │
        ▼
[ Express API Gateway (`server/src/index.ts`) ]
        │
        ├── Is Route Allowlisted? (GET /api/health, GET /api/realtime/health,
        │                          POST /api/auth/login, POST /api/payments/razorpay/webhook)
        │      ├── YES ──> Bypass Token Check ──> Route Handler Executes
        │      └── NO  ──> Proceed to `authenticateToken`
        │
        ▼
[ Unified Authenticator (`server/src/auth.ts`) ]
        │
        ├── Extract Token: Bearer header OR `req.query.token`
        ├── Detect Token Type:
        │      ├── Server Token (`payload.sig`) ──> Verify HMAC-SHA256 + iss/aud/exp
        │      ├── Firebase ID Token (JWT)      ──> Verify via `admin.auth().verifyIdToken()`
        │      └── Dev Mock Token (`mock_token_`)──> Verify non-production environment
        │
        ├── Query PostgreSQL (`prisma.user.findUnique`):
        │      ├── User exists? ─────────> NO  ──> Reject HTTP 403 `USER_NOT_FOUND`
        │      └── User active? ─────────> NO  ──> Reject HTTP 403 `USER_SUSPENDED`
        │
        ├── Populate Authoritative Request Context:
        │      req.authContext = { uid, email, role, societyId, authProvider, dbUserId }
        │      req.userRole = req.authContext.role
        │      req.societyId = req.authContext.societyId
        │      req.userId = req.authContext.dbUserId
        │
        ▼
[ Route-Level Authorization Middleware ]
        │
        ├── `requireRole(['admin', 'secretary'])` ──> Check req.authContext.role
        └── `requireSocietyMembership`             ──> Check req.authContext.societyId
        │
        ▼
[ Authoritative Endpoint Controller Execution ]
```

---

## 3. Detailed File Modifications

### 3.1. `server/src/auth.ts`
- **Native Cryptographic Token Engine**:
  - Implemented `generateAuthToken(payload, expiresInSeconds)` using Node.js `crypto.createHmac('sha256', secret)`.
  - Format: `<base64url(header.payload)>.<base64url(signature)>`.
  - Claims: `iss: 'aarizo-api'`, `aud: 'aarizo-client'`, `sub: payload.userId`, `role`, `societyId`, `iat`, `exp`.
  - Implemented `constantTimeCompare(a, b)` using `crypto.timingSafeEqual` to eliminate timing side-channel attacks.
  - Implemented `verifyServerToken(tokenString)` with strict claim validation, signature check, and expiration check (`exp < now`).
- **Unified `authenticateToken` Middleware**:
  - Supports Bearer header (`Authorization: Bearer <token>`) and query string parameter (`req.query.token`).
  - Evaluates token against three verification paths:
    1. **Server Token**: Verified with HMAC-SHA256 signature; loads active PostgreSQL user via `prisma.user.findUnique({ where: { id: payload.sub } })`.
    2. **Firebase ID Token**: Verified using Firebase Admin SDK; resolves PostgreSQL user via `firebaseUid` or normalized phone number.
    3. **Dev Mock Token**: When `NODE_ENV !== 'production'`, parses `mock_token_<uid>` and loads PostgreSQL user via `prisma.user.findUnique`.
  - Validates `user.status === 'active'`. Rejects suspended users with HTTP 403 `USER_SUSPENDED`.
  - Populates `req.authContext` with verified attributes.
  - Synchronizes legacy `req.userRole`, `req.societyId`, and `req.userId` directly from `req.authContext`.
- **Role & Tenant Enforcement**:
  - Anchored `requireRole` strictly to `req.authContext.role`.
  - Anchored `requireSocietyMembership` strictly to `req.authContext.societyId` and `req.authContext.role`.
  - Maintained `authenticateFirebaseToken` as an alias to `authenticateToken` for complete backward compatibility.

### 3.2. `server/src/index.ts`
- **Global API Protection**:
  - Defined explicit public route allowlist `isPublicApiRoute(req)`:
    - `GET /api/health`
    - `GET /api/realtime/health`
    - `POST /api/auth/login`
    - `POST /api/payments/razorpay/webhook`
  - Mounted global middleware on `/api`:
    ```ts
    app.use('/api', (req: Request, res: Response, next: NextFunction) => {
      if (isPublicApiRoute(req)) {
        return next();
      }
      return authenticateToken(req, res, next);
    });
    ```
- **Password Authentication Endpoint (`POST /api/auth/login`)**:
  - Validates credentials against PostgreSQL using PBKDF2 hash verification.
  - Generates and returns a signed Bearer token:
    ```ts
    const token = generateAuthToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      societyId: user.societyId || undefined,
    });
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        societyId: user.societyId,
        flatNumber: user.flatNumber,
        status: user.status,
      },
    });
    ```
  - Never returns password hashes or salt fields.

### 3.3. `src/services/apiClient.ts`
- **Token Attachment**:
  - Updated `getStoredAuthHeaders()` to retrieve the Bearer token from `localStorage`:
    ```ts
    const token = localStorage.getItem('aarizo_token') || localStorage.getItem('dwellora_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    ```
  - Updated `loginWithPassword` response signature to include `token?: string`.

### 3.4. `src/context/AuthContext.tsx`
- **Token Lifecycle Management**:
  - Updated `loginWithProfile(profile, token)` to persist `token` into `localStorage.setItem('aarizo_token', token)`.
  - Updated Firebase `onAuthStateChanged` to fetch `user.getIdToken()` and persist into `localStorage.setItem('aarizo_token', token)`.
  - Updated development `loginAsRole(role)` to persist `mock_token_${user.id}` into `localStorage.setItem('aarizo_token', ...)`.
  - Updated `logout()` to remove `'aarizo_token'`, `'dwellora_token'`, and all legacy session keys.

### 3.5. `src/components/auth/login/LoginScreen.tsx`
- **Login Flow Integration**:
  - Updated email/password submission handler at line 123:
    ```ts
    loginWithProfile(userProfile, res.token);
    ```
  - Passes the backend-issued token directly to `AuthContext`, ensuring immediate availability for subsequent API calls.

---

## 4. Protected API Route Coverage (143 Endpoints)

| Category | Endpoint Count | Mounted Security Layer | Behavior on Unauthenticated Request | Behavior on Authenticated Request |
| :--- | :---: | :--- | :--- | :--- |
| **Public Endpoints** | 4 | Explicit Allowlist (`isPublicApiRoute`) | HTTP 200 OK (Public Access) | HTTP 200 OK |
| **Role-Guarded Endpoints** | 85 | `authenticateToken` + `requireRole` | HTTP 401 `TOKEN_MISSING` | HTTP 200 (if role matches) / HTTP 403 (if role forbidden) |
| **General Protected Endpoints** | 54 | `authenticateToken` | HTTP 401 `TOKEN_MISSING` | HTTP 200 OK |
| **Total Server Endpoints** | **143** | **100% Covered** | **Zero Unprotected Endpoints** | **Authoritative Server Context** |

---

## 5. Security & Functional Verification

### 5.1. Integration Test Suite (`tests/issue02_unified_auth_integration.test.ts`)
We authored 20 end-to-end integration tests using Supertest and Express:

1. **Anonymous Access Rejection**: Unauthenticated request to `/api/residents` returns HTTP 401 `TOKEN_MISSING`.
2. **Malformed Bearer Rejection**: `Authorization: Bearer not_a_valid_token` returns HTTP 401 `TOKEN_MALFORMED`.
3. **Forged Signature Rejection**: Token signed with invalid secret key returns HTTP 401 `TOKEN_INVALID`.
4. **Tampered Payload Rejection**: Modifying token payload after signing returns HTTP 401 `TOKEN_INVALID`.
5. **Expired Token Rejection**: Token with `exp < now` returns HTTP 401 `TOKEN_EXPIRED`.
6. **Suspended User Rejection**: Valid token for user with `status: 'suspended'` returns HTTP 403 `USER_SUSPENDED`.
7. **Unknown User Rejection**: Valid token for non-existent database ID returns HTTP 403 `USER_NOT_FOUND`.
8. **Client Header Spoofing Neutralization**: Attacker sending `x-user-role: admin` with resident token receives HTTP 403 `ROLE_FORBIDDEN`.
9. **Tenant Isolation Enforcement**: User from society A attempting to access society B resource receives HTTP 403 `TENANT_ISOLATION_VIOLATION`.
10. **Legitimate Admin Access**: Valid admin server token accesses `/api/admin/system/overview` (HTTP 200 OK).
11. **Legitimate Secretary Access**: Valid secretary server token creates tower `/api/towers` (HTTP 201 Created).
12. **Legitimate Resident Access**: Valid resident server token reads `/api/residents` (HTTP 200 OK).
13. **Dev Mock Token Access**: Dev mock token (`mock_token_admin-1`) resolves to database user and grants access (HTTP 200 OK).
14. **Dev Mock Unknown ID Rejection**: Dev mock token with invalid UID returns HTTP 403 `USER_NOT_FOUND`.
15. **Public Route Verification (`/api/health`)**: Accessible without token (HTTP 200 OK).
16. **Public Route Verification (`/api/realtime/health`)**: Accessible without token (HTTP 200 OK).
17. **Public Route Verification (`POST /api/auth/login`)**: Verifies password, returns user object and HMAC Bearer token.
18. **Public Route Verification (`POST /api/payments/razorpay/webhook`)**: Validates HMAC signature without requiring Bearer token.
19. **SSE Query Token Verification**: `GET /api/realtime/stream?token=<valid_token>` successfully authenticates and establishes event stream.
20. **Protected CRUD Verification**: `POST /api/residents` accepts valid secretary token and processes request.

### 5.2. Test Execution Summary
```
PASS tests/issue02_unified_auth_integration.test.ts (20 tests passed)
PASS tests/issue02_privilege_escalation.test.ts (14 tests passed)
PASS tests/security.test.ts (10 tests passed)
PASS tests/auth_middleware.test.ts (6 tests passed)
PASS tests/provisioning.test.ts (6 tests passed)
PASS tests/razorpay.test.ts (8 tests passed)
PASS tests/differentiators.test.ts (18 tests passed)
PASS tests/route_protection.test.ts (11 tests passed)

Test Suites: 8 passed, 8 total
Tests:       93 passed, 93 total
Snapshots:   0 total
Time:        2.303 s
```

---

## 6. Build & Compilation Verification

1. **Server TypeScript Compilation**:
   ```powershell
   npm --prefix server run build
   # tsc completed with 0 errors
   ```
2. **Frontend Production Build**:
   ```powershell
   npm run build
   # tsc -b && vite build completed with 0 errors
   ```

---

## 7. Conclusion & Next Steps

ISSUE-02 is now **100% RESOLVED AND VERIFIED** across all four operational dimensions:
- Unverified client identity headers are completely stripped from trust decisions.
- All 143 Express REST endpoints are protected via global middleware with a strict public allowlist.
- Both email/password users and Firebase phone OTP users generate and transmit authoritative tokens.
- Realtime SSE and development quick-login flows operate reliably without compromising security.

We are ready to proceed to the next scheduled remediation step in Phase A.

