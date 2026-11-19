# AARIZO — Authentication Integration Gap Audit (ISSUE-02 Sub-Phase)

**Audit Date**: November 14, 2026  
**Auditor**: Principal Security Architect & Full-Stack Systems Auditor  
**Scope**: Complete investigation of frontend authentication flows, backend authorization enforcement, token lifecycles, and request interception across the AARIZO smart community platform.  
**Constraint**: Audit & architecture investigation only — no application source code modifications.

---

## 1. Executive Summary

During Step 2 of Phase A, the direct vulnerability where `server/src/index.ts` mapped unverified client headers (`x-user-role`, `x-user-id`, `x-society-id`) directly to `req.userRole`, `req.userId`, and `req.societyId` was successfully eliminated. The authorization middlewares `requireRole` and `requireSocietyMembership` in `server/src/auth.ts` were hardened to read exclusively from a verified `req.authContext`.

However, a deeper forensic investigation of the end-to-end request lifecycle has uncovered a **fundamental architectural disconnect** between how users authenticate on the frontend and how the Express REST API authorizes requests:

1. **No Token Issued on Password Login**: `POST /api/auth/login` verifies user passwords against PostgreSQL using PBKDF2/SHA-256 HMAC, but returns `{ success: true, user }` with **no access token, JWT, session cookie, or bearer credential**.
2. **REST Client Sends Unverified Headers Only**: `src/services/apiClient.ts` reads `localStorage` and transmits identity exclusively through `x-user-role`, `x-user-id`, and `x-society-id`. It **never attaches an `Authorization: Bearer <token>` header**.
3. **Authentication Middleware is Nowhere Mounted**: `authenticateFirebaseToken` is declared in `server/src/auth.ts`, but is **not mounted on a single route** among the 143 endpoints in `server/src/index.ts`.
4. **Protected CRUD Endpoints Completely Blocked**: Because `requireRole` now strictly evaluates `req.authContext.role`, and `req.authContext` is never populated by an authentication middleware, **all 85 protected routes in `server/src/index.ts` currently return HTTP 403 `ROLE_MISSING` for every legitimate user**.
5. **54 Endpoints are Completely Unprotected**: 54 routes (including sensitive data queries like `GET /api/children`, `GET /api/flats`, `GET /api/towers`, `GET /api/wallet/balance/:id`, `GET /api/work-orders`) have **zero middleware mounted**, exposing sensitive society records to anonymous callers.

---

## 2. Complete Trace of All Application Login Flows

The application exhibits three distinct, fragmented authentication flows that operate in complete isolation from one another:

```mermaid
flowchart TD
    subgraph Flow1 ["Flow 1: Email / Password Login"]
        F1_UI["LoginScreen.tsx (Email + Pass)"] -->|POST /api/auth/login| F1_API["Express /api/auth/login"]
        F1_API -->|PBKDF2 SHA256| F1_PG[(PostgreSQL User Table)]
        F1_PG -->|User Record| F1_API
        F1_API -->|Returns { user } - NO TOKEN| F1_UI
        F1_UI -->|Store dwellora_user| F1_LS[(localStorage)]
    end

    subgraph Flow2 ["Flow 2: Firebase Phone OTP"]
        F2_UI["LoginScreen.tsx (Phone + OTP)"] -->|signInWithPhoneNumber| F2_FB["Google Firebase Auth SDK"]
        F2_FB -->|ID Token (RS256 JWT)| F2_SDK["IndexedDB / Memory"]
        F2_SDK -->|onAuthStateChanged| F2_CTX["AuthContext.tsx"]
        F2_CTX -->|Store dwellora_user| F2_LS[(localStorage)]
    end

    subgraph Flow3 ["Flow 3: Dev Role Switcher"]
        F3_UI["Role Buttons (Resident, Admin, etc.)"] -->|loginAsRole(role)| F3_CTX["AuthContext.tsx"]
        F3_CTX -->|MOCK_USERS[role]| F3_LS[(localStorage)]
    end

    subgraph API_Client ["API Request Lifecycle"]
        F1_LS -.->|Read aarizo_user (MISMATCH)| CLIENT["apiClient.ts"]
        CLIENT -->|x-user-role, x-society-id (NO BEARER)| BACKEND["server/src/index.ts"]
        BACKEND -->|requireRole (authContext=undefined)| REJECT["HTTP 403 ROLE_MISSING"]
    end
```

### Flow 1: Email & Password Database Authentication
- **Entry Point**: `src/components/auth/login/LoginScreen.tsx` (lines 95–140).
- **Credential Verification**:
  - Client calls `apiClient.loginWithPassword({ email, password })`.
  - Dispatches HTTP `POST /api/auth/login`.
  - Handler in `server/src/index.ts` (lines 1659–1695) queries `prisma.user.findFirst({ where: { email: email.toLowerCase().trim() } })`.
  - Evaluates password hash via `UniversalProvisioningService.hashPassword(password, user.salt)`.
  - Constant-time verification via `timingSafeCompare(computedHash, user.passwordHash)`.
- **Payload Returned by Backend**:
  ```json
  {
    "success": true,
    "user": {
      "id": "usr_cly12345",
      "name": "Mayuri Udar",
      "email": "secretary@greenvalley.com",
      "phone": "9820012345",
      "role": "secretary",
      "societyId": "soc-gvs",
      "flatNumber": "A-101",
      "societyName": "Green Valley Society"
    }
  }
  ```
- **Authenticated Session / Token**: **NONE**. The backend does not issue a JWT, session token, or cookie.
- **Storage Location**: `AuthContext.loginWithProfile` stores the user object in `localStorage` under key `'dwellora_user'` and sets `sessionStorage.setItem('dwellora_active_session', 'true')`.
- **Session Restoration & Logout**:
  - *Restoration*: On reload, `AuthContext` checks `sessionStorage.getItem('dwellora_active_session') === 'true'`. If true, reads `localStorage.getItem('dwellora_user')`.
  - *Logout*: `AuthContext.logout()` deletes `localStorage.getItem('dwellora_user')` and session keys.
- **Token Refresh / Revocation**: **Non-existent**. There is no server-side token to refresh, expire, or revoke.

---

### Flow 2: Firebase Phone Number OTP Authentication
- **Entry Point**: `src/components/auth/login/LoginScreen.tsx` (lines 75–89, 145–160).
- **Credential Verification**:
  - Client calls `submitLogin(appVerifier)` -> `signInWithPhoneNumber(auth, fullNumber, appVerifier)`.
  - Client calls `verifyOtp(code)` -> `confirmationResult.confirm(code)`.
  - Handled entirely on Google's Firebase Authentication cloud servers.
  - Client listener `onAuthStateChanged` triggers in `AuthContext.tsx` (lines 120–193).
  - Listener checks `await firebaseUser.getIdTokenResult(true)`.
  - Validates custom claims `role` and `societyId` against Firestore `doc(db, 'users', uid)`.
- **Payload Returned by Backend**:
  - The Express backend is **not contacted**.
- **Authenticated Session / Token**:
  - Firebase SDK issues an RS256-signed Firebase ID Token (1-hour lifespan).
  - The token is held in Firebase client memory / IndexedDB.
  - **CRITICAL GAP**: The token is **never exported or provided to `apiClient.ts`**.
- **Storage Location**: IndexedDB (`firebase:authUser:...`) and `localStorage` (`'dwellora_user'`).
- **Session Restoration & Logout**:
  - *Restoration*: Firebase SDK automatically restores `auth.currentUser` from IndexedDB on startup.
  - *Logout*: `signOut(auth)` destroys Firebase session; `AuthContext` clears local keys.
- **Token Refresh / Revocation**:
  - Firebase SDK transparently refreshes the ID token using its internal refresh token.
  - Disconnected from the Express REST API.

---

### Flow 3: Local Development Mock Role Switcher (`loginAsRole`)
- **Entry Point**: Quick-login role pills in `LoginScreen.tsx` (Resident, Secretary, Security Guard, Committee, FM, Vendor, Admin).
- **Credential Verification**: **None**. Pure client-side state manipulation.
- **Backend Return Payload**: None. No API call occurs.
- **Authenticated Session / Token**: None.
- **Storage Location**: Writes `MOCK_USERS[role]` to `localStorage.getItem('dwellora_user')`.
- **Session Restoration & Logout**: Restored from `localStorage`; cleared on `logout()`.
- **Token Refresh / Revocation**: Non-existent.

---

## 3. End-to-End API Integration Lifecycle & Gap Analysis

### Request Lifecycle Inspection

```
Client Action (e.g. Fetch Residents)
       │
       ▼
src/services/apiClient.ts
       │  getStoredAuthHeaders() reads localStorage('aarizo_user') ──> NULL (ISSUE-03)
       │  Sets: headers['x-society-id'] = undefined
       │  Sets: headers['x-user-role'] = undefined
       │  Sets: headers['Authorization'] = NONE
       ▼
HTTP Request to http://localhost:5000/api/residents
       │
       ▼
server/src/index.ts (Global Middleware)
       │  app.use(rateLimiter(200, 60000)) ──> PASS
       │  Security Middleware:
       │    req.societyId = req.authContext?.societyId (undefined)
       │    req.userId    = req.authContext?.userId    (undefined)
       │    req.userRole  = req.authContext?.role      (undefined)
       │  (authenticateFirebaseToken IS NOT MOUNTED HERE)
       ▼
Endpoint: app.get('/api/residents', requireRole([...]), ...)
       │
       ▼
server/src/auth.ts (requireRole Middleware)
       │  const role = (req.authContext?.role || '').toLowerCase();
       │  role === '' ──> TRIPPED!
       │
       ▼
Response: HTTP 403 Forbidden
       {
         "error": "Access denied: No authenticated role found",
         "code": "ROLE_MISSING"
       }
```

### The Three Structural Integration Gaps

| Gap ID | Description | Impact | Severity |
| :---: | :--- | :--- | :---: |
| **GAP-01** | `POST /api/auth/login` does not generate or return a Bearer access token upon successful password validation. | Legitimate users who log in with email/password possess no credential to present to protected API endpoints. | **P0 (Blocker)** |
| **GAP-02** | `apiClient.ts` does not attach `Authorization: Bearer <token>` to outbound requests; reads wrong storage key (`aarizo_user` vs `dwellora_user`). | Even if a token existed, the REST client sends only unverified `x-*` headers that are now rightfully rejected by the backend. | **P0 (Blocker)** |
| **GAP-03** | `authenticateFirebaseToken` is not mounted on the Express server routes. 54 routes have zero protection; 85 routes have `requireRole` without an authentication middleware. | Protected routes reject all legitimate users (`ROLE_MISSING`), while unprotected routes expose sensitive data to unauthenticated visitors. | **P0 (Security & Functional)** |

---

## 4. Empirical Compatibility Verification Results

| User Authentication Scenario | Target Endpoint | Authorization Required | Actual Server Response | Functional Status |
| :--- | :--- | :--- | :--- | :---: |
| **Email/Password Logged-in Resident** | `GET /api/residents` | `resident`, `guard`, `secretary`, `admin` | **HTTP 403 `ROLE_MISSING`** | ❌ **BROKEN / BLOCKED** |
| **Email/Password Logged-in Secretary** | `POST /api/flats` | `secretary`, `admin` | **HTTP 403 `ROLE_MISSING`** | ❌ **BROKEN / BLOCKED** |
| **Email/Password Logged-in Admin** | `POST /api/societies` | `admin` | **HTTP 403 `ROLE_MISSING`** | ❌ **BROKEN / BLOCKED** |
| **Firebase OTP Logged-in Guard** | `GET /api/visitor-passes` | `guard`, `secretary`, `admin`, `resident` | **HTTP 403 `ROLE_MISSING`** | ❌ **BROKEN / BLOCKED** |
| **Mock Role Switcher User** | Any protected endpoint | Any role | **HTTP 403 `ROLE_MISSING`** | ❌ **BROKEN / BLOCKED** |
| **Unauthenticated Anonymous Visitor** | `GET /api/children` | Should be Resident/Guard/Admin | **HTTP 200 OK (Data Exposed)** | ⚠️ **SECURITY VULNERABILITY** |
| **Unauthenticated Anonymous Visitor** | `GET /api/wallet/balance/res-01`| Should be Resident/Admin | **HTTP 200 OK (Data Exposed)** | ⚠️ **SECURITY VULNERABILITY** |
| **Unauthenticated Anonymous Visitor** | `GET /api/health` | Public Health Check | **HTTP 200 OK** | ✅ **WORKING AS INTENDED** |
| **Razorpay Payment Gateway** | `POST /api/payments/razorpay/webhook` | HMAC Signature Verified | **HTTP 200 / 401 on bad HMAC** | ✅ **WORKING AS INTENDED** |

---

## 5. Architectural Root Cause

The root cause of this system-wide integration gap is a **transition state left incomplete during rebranding**:
1. The project was originally prototyped as a Firebase-first mobile application ("CommunityOS"), relying on Firebase Auth and Firestore security rules.
2. An authoritative PostgreSQL backend ("Dwellora / AARIZO 2.0") was subsequently added with Express and Prisma, including custom password hashing (`UniversalProvisioningService`) and SQL models.
3. The developer created `authenticateFirebaseToken` in `server/src/auth.ts` to bridge Firebase ID tokens into PostgreSQL users.
4. However, to bypass token requirements during local frontend development, the developer added lines 53–58 in `server/src/index.ts` to read unverified `x-user-role` headers, and wrote `apiClient.ts` to transmit these headers instead of Bearer tokens.
5. As a result, the backend was never wired with a complete, server-authoritative token issuance and verification pipeline.

Now that the header-trust vulnerability has been eliminated in ISSUE-02, the missing token issuance and middleware mount must be resolved through a unified, secure architecture.

