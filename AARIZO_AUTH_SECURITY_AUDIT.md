# AARIZO — AUTHENTICATION, AUTHORIZATION & SECURITY AUDIT
**Document Version:** 1.0.0  
**Audit Date:** November 14, 2026  
**Auditor Roles:** Senior Security Auditor, Principal Software Architect  

---

## 1. Executive Summary & Threat Model

This audit rigorously inspects the authentication lifecycle, session persistence, role-based access control (RBAC), multi-tenant isolation, cryptographic primitives, and data exposure vulnerabilities in the AARIZO codebase.

### Critical Security Findings Summary
1. **P0 — Unprotected Developer Database Studio (`/dev/database` & `/dev/db`)**:
   - The developer studio route is mounted outside `ProtectedRoute` and requires zero authentication.
   - Any unauthenticated public actor can browse, inspect, and export sensitive resident names, phone numbers, parking slots, license plates, visitor passes, security audit logs, and full browser `localStorage` contents.
2. **P0 — Client-Supplied Header Privilege Escalation on Express REST API**:
   - In `server/src/index.ts`, the multi-tenant context middleware blindly trusts client headers: `req.userRole = (req.headers['x-user-role'] as string)?.toLowerCase()`.
   - The majority of Express CRUD endpoints use `requireRole(['secretary', 'admin'])` without invoking `authenticateFirebaseToken`.
   - An attacker can forge `x-user-role: admin` or `x-user-role: secretary` via curl, Postman, or script to bypass role authorization on all unprotected endpoints.
3. **P1 — Storage Key Desynchronization Between AuthContext & API Client**:
   - `AuthContext.tsx` saves logged-in profiles to `localStorage.setItem('dwellora_user', ...)`.
   - `apiClient.ts` and `BaseRepository.ts` look for `localStorage.getItem('aarizo_user') || localStorage.getItem('communityos_auth_user')`.
   - Because `aarizo_user` is not set upon login, `apiClient` fails to attach `x-user-id`, `x-user-role`, or `x-society-id` headers for legitimate authenticated requests.
4. **P1 — Seeded Accounts Lack Password Hashes**:
   - Seeded user records in `server/src/seed.ts` do not populate `passwordHash` and `salt`.
   - Logging in via `/api/auth/login` fails for all seeded users with `"Password authentication is not configured for this user"`.
5. **P2 — In-Memory Sliding Window Rate Limiting**:
   - The rate limiter in `server/src/auth.ts` uses an in-memory `Map` keyed by IP address. It does not scale across clustered instances, does not survive server restarts, and is vulnerable to distributed denial-of-service or IP spoofing behind reverse proxies without `trust proxy` enabled.

---

## 2. Authentication Lifecycle & Session Architecture

### 2.1 Dual Authentication Modes
The application supports two distinct authentication pathways:
1. **Firebase Phone OTP Authentication**:
   - Invokes `signInWithPhoneNumber(auth, fullNumber, appVerifier)` with RecaptchaVerifier.
   - On OTP confirmation, retrieves Firebase ID token.
   - Verifies cryptographically signed Custom User Claims: `idTokenResult.claims.role` and `idTokenResult.claims.societyId`.
   - Verifies profile synchronization with Firestore document (`users/{uid}`).
2. **Authoritative PostgreSQL Password Authentication**:
   - Implemented via `POST /api/auth/login`.
   - Looks up normalized lowercase email in `prisma.user`.
   - Generates test hash using per-user stored 16-byte cryptographic salt:
     $$\text{computedHash} = \text{HMAC-SHA256}(\text{password}, \text{salt})$$
   - Uses `timingSafeCompare(computedHash, user.passwordHash)` via `crypto.timingSafeEqual` with zero-padding to prevent timing attacks.

### 2.2 Session Storage & Persistence
- **Storage Keys**:
  - `sessionStorage.getItem('dwellora_active_session')`: Ephemeral session gate.
  - `sessionStorage.getItem('dwellora_last_route')`: Route restoration tracker.
  - `sessionStorage.getItem('dwellora_last_role')`: Last active role cache.
  - `localStorage.getItem('dwellora_user')`: Serialized `UserProfile` JSON.
- **Cold App Launch Behavior**:
  - If `dwellora_active_session !== 'true'`, `AuthContext` forces a cold session reset: clears `localStorage.removeItem('dwellora_user')` and sets status to `UNAUTHENTICATED`.
- **Native Mobile Background / Resume Lifecycle**:
  - Uses `@capacitor/app` listener `App.addListener('appStateChange', ({ isActive }) => ...)`.
  - When resumed from background, verifies that `sessionActive` and `savedUser` are still intact. If session expired or was killed by OS, triggers clean `logout()`.

---

## 3. Route Guard & Frontend Authorization Audit

### 3.1 `ProtectedRoute` Implementation
- **Path**: [src/routes/ProtectedRoute.tsx](file:///d:/AAZIRA/AARIZO/src/routes/ProtectedRoute.tsx)
- **Logic**:
  ```tsx
  if (status !== 'AUTHENTICATED') {
    return <Navigate to="/login" replace />;
  }
  if (allowedRoles && allowedRoles.length > 0) {
    const normalizedAllowed = allowedRoles.map((r) => r.toLowerCase());
    if (!normalizedAllowed.includes(activeRole.toLowerCase())) {
      return <Navigate to="/unauthorized" replace />;
    }
  }
  if (requiredPermission && !can(requiredPermission)) {
    return <Navigate to="/unauthorized" replace />;
  }
  return <Outlet />;
  ```
- **Strengths**:
  - Strictly denies unauthenticated users (redirects to `/login`).
  - Normalizes role strings to lowercase before checking.
  - Redirects unauthorized roles cleanly to `/unauthorized`.
- **Weakness**:
  - Does NOT protect `/dev/database` and `/dev/db`.

---

## 4. Multi-Tenant Isolation & Society Boundary Audit

### 4.1 Cross-Society IDOR Prevention
Multi-tenant isolation is enforced at three levels:
1. **Frontend Context**: `currentUser.societyId` (default: `'soc-gvs'`).
2. **Backend Middleware (`requireSocietyMembership`)**:
   - Compares request society (`req.params.societyId`, `req.body.societyId`, `req.query.societyId`) with `req.authContext.societyId`.
   - Rejects cross-society mismatches with HTTP 403 `TENANT_ISOLATION_VIOLATION`.
   - Bypassed only for universal platform admin (`role === 'admin'`).
3. **Database RLS Policies (`scripts/postgres/02_rls_policies.sql`)**:
   - Defines PostgreSQL Row Level Security policies scoped by `current_app_society_id()`.
   - Verified in unit tests: `tests/auth_middleware.test.ts` (test: *"Rejects cross-society IDOR access attempt"* PASSES).

---

## 5. Comprehensive Role-Permission Matrix (CRUD)

The following matrix documents the exact verified permissions across all 7 discovered roles and key system resources:

| Resource / Entity | Resident | Guard | Secretary | Committee | Facility Manager | Vendor | Super Admin |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Societies Master** | — | — | — | — | — | — | **CRUD** |
| **Towers & Blocks** | R | R | **CRUD** | R | R | — | **CRUD** |
| **Flats & Units** | R (Own) | R | **CRUD** | R | R | — | **CRUD** |
| **Resident Directory** | R (Public) | R (Public) | **CRUD** | R | R | — | **CRUD** |
| **Visitor Passes** | **CRU (Own)** | **RU (Verify)** | **CRUD** | R | R | — | **CRUD** |
| **Visitor Logs / Gate** | R (Own) | **CRU** | **CRUD** | R | R | — | **CRUD** |
| **Parcels & Deliveries** | **RU (Own)** | **CRU** | **CRUD** | — | — | — | **CRUD** |
| **Child Safety Passes** | **CRUD (Own)** | **RU (Verify)** | **CRUD** | — | — | — | **CRUD** |
| **Emergency SOS Incidents** | **C** | **RU** | **CRUD** | R | R | — | **CRUD** |
| **Billing Invoices** | **RU (Own Pay)** | — | **CRUD** | **R** | — | — | **CRUD** |
| **Billing Cycles** | — | — | **CRUD** | **R** | — | — | **CRUD** |
| **Payments & Refunds** | **CR (Own)** | — | **CRUD (Refund)** | **R** | — | — | **CRUD** |
| **Complaints / Requests** | **CRU (Own)** | R (Assigned) | **CRUD** | **RU (Approve)** | **RU (WorkOrder)** | RU (Assigned) | **CRUD** |
| **Maintenance Work Orders** | R (Own) | — | **CRUD** | R | **CRUD** | RU (Assigned) | **CRUD** |
| **Amenities** | R | — | **CRUD** | R | R | — | **CRUD** |
| **Amenity Bookings** | **CRU (Own)** | — | **CRUD** | R | R | — | **CRUD** |
| **Domestic Workers** | R (Linked) | **RU (Gate)** | **CRUD** | — | — | — | **CRUD** |
| **Staff & Guard Shifts** | — | R (Own Shift) | **CRUD** | R | **CRUD** | — | **CRUD** |
| **Vendor Directory** | R | R | **CRUD** | **R** | R | **CRU (Own Profile)**| **CRUD** |
| **Advertisements** | R (View/Click) | — | **CRUD** | R | — | **CR (Submit)** | **CRUD** |
| **Security Audit Logs** | — | — | **R** | **R** | — | — | **CRUD** |

*Legend: C = Create, R = Read, U = Update, D = Delete, — = Denied / Inaccessible.*

---

## 6. Guard Privacy & Data Minimization Audit

A specialized privacy constraint in the Security Guard portal is verified:
- In `SecurityTerminalPage.tsx` and `GuardDashboard.tsx`, resident phone numbers are masked or omitted in pass tables.
- Private resident profile notes, financial records, and maintenance billing history are strictly excluded from the guard interface.
- Guards are restricted to operational gate verification data: visitor name, expected arrival window, vehicle registration number, and destination flat code.

