# AARIZO / Dwellora — Phase 4.8
# Authentication Architecture Forensic Audit

**Document Date:** November 19, 2026  
**Auditor:** Principal Authentication & AppSec Architect  
**Scope:** Canonical Identity Provider, Backend Session Issuance, Password Hashing, Firebase Integration & Production Hardening  

---

## 1. Executive Summary

This audit evaluates the authentication architecture of Dwellora across the frontend React client, backend Express API, Firebase services, and PostgreSQL persistence layer.

### Key Audit Finding
The system possesses a mature, high-assurance backend password authentication engine in `server/src/auth.ts` and `server/src/crypto.ts` utilizing:
- **OWASP-recommended Scrypt key derivation** ($N=131072, r=8, p=1$, 32-byte derived key).
- **HMAC-SHA256 signed Bearer session tokens** with constant-time verification (`timingSafeEqual`).
- **Bounded concurrency semaphore** (`AuthConcurrencyLimiter`) to prevent denial-of-service from heavy scrypt allocations.
- **Dedicated sliding-window rate limiters** (`loginRateLimiter`).

However, the frontend `LoginScreen.tsx` was configured as a hybrid prototype containing:
1. An interactive role selector card allowing unauthenticated persona switching.
2. Hardcoded fallback passwords (`dwellora@2026`).
3. Client-side mock login shortcuts (`loginAsRole`) using `MOCK_USERS`.
4. Bypasses when a mobile number is entered without an email address.

To transition Dwellora into a genuine production platform, the authoritative backend email/password authentication must become the exclusive authentication path in production, and demo role-switching controls must be removed.

---

## 2. Full-Stack Identity Architecture Comparison

```
┌────────────────────────────────────────────────────────────────────────┐
│                   AUTHORITATIVE AUTHENTICATION MODEL                   │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
       ┌─────────────────────────────────────────────────────────┐
       │             Client: LoginScreen.tsx                     │
       │   - Accepts Normalized Email & User Password            │
       │   - Disallows arbitrary role selection                  │
       └────────────────────────────┬────────────────────────────┘
                                    │
                                    ▼  POST /api/auth/login
       ┌─────────────────────────────────────────────────────────┐
       │             Server: server/src/index.ts                 │
       │   1. loginRateLimiter (10 req/min/IP)                   │
       │   2. Bounded Concurrency (authConcurrencyLimiter)       │
       │   3. Database Lookup: prisma.user.findFirst(email)      │
       │   4. Scrypt Verification: verifyPasswordAsync           │
       │   5. Account Status Check (status === 'ACTIVE')         │
       │   6. HMAC Token Issuance: generateAuthToken             │
       └────────────────────────────┬────────────────────────────┘
                                    │
                                    ▼  Bearer Token (HMAC-SHA256)
       ┌─────────────────────────────────────────────────────────┐
       │             Session Storage: authStorage.ts             │
       │   - Stores token in `aarizo_token`                      │
       │   - Stores verified profile in `aarizo_user`            │
       │   - AuthContext marks status: 'AUTHENTICATED'           │
       │   - Realtime SSE stream initialized with Bearer token   │
       └─────────────────────────────────────────────────────────┘
```

### 2.1 Backend vs. Firebase Identity Authority
- **PostgreSQL (`prisma.user`) is the Canonical Identity Authority**:
  - The PostgreSQL database manages the user's authoritative `role`, `societyId`, `flatId`, and account `status`.
  - In `server/src/auth.ts`, `authenticateToken` resolves the user profile from PostgreSQL for every authenticated request. Even when a Firebase ID token is supplied, the backend queries `prisma.user` to establish `req.authContext`.
  - Tokens issued by `POST /api/auth/login` are self-contained HMAC-SHA256 tokens verifiable in sub-millisecond constant time without third-party network roundtrips.
- **Firebase Authentication Role**:
  - Firebase is configured in `src/services/firebase/config.ts` primarily for Phone OTP capabilities.
  - For email/password authentication, using the backend's native Scrypt + PostgreSQL architecture is safer, faster, avoids dual-identity desynchronization, and guarantees strict tenant isolation.

---

## 3. Forensic Review of Demo Authentication Elements

| File | Component / Function | Current Behavior | Production Defect | Required Remediation |
| :--- | :--- | :--- | :--- | :--- |
| `src/components/auth/login/LoginScreen.tsx` | `Role Selection Card` | Renders buttons for 7 roles with default phone numbers | Allows unauthenticated role impersonation in UI | Remove role selection card in production. Render standard email + password form. |
| `src/components/auth/login/LoginScreen.tsx` | `executeLogin(activeRole)` | Invokes `loginAsRole` on form submit when phone is provided | Skips server-side credential verification | Route all form submissions to `apiClient.loginWithPassword`. |
| `src/components/auth/login/LoginScreen.tsx` | `password` state | Initialized with `'dwellora@2026'` | Insecure default password | Initialize `password` with empty string `''`. |
| `src/context/AuthContext.tsx` | `loginAsRole` | Loads `MOCK_USERS[role]` and creates `mock_token_` | Mock bypass of backend RBAC | Strictly disable `loginAsRole` in production or isolate behind `import.meta.env.DEV`. |
| `server/src/auth.ts` | `isMockAuthEnabled` | Checks `ENABLE_DEV_MOCK_AUTH === 'true'` | Verified safe; already rejects mock tokens in production (`process.env.NODE_ENV === 'production'`) | Retain fail-closed guard in backend. |

---

## 4. Password Security & Cryptographic Standards

The password hashing implementation in `server/src/crypto.ts` is verified to adhere to OWASP 2026 High-Assurance specifications:

```typescript
export const TARGET_SCRYPT_CONFIG = {
  N: 131072, // 2^17 CPU/Memory cost factor
  r: 8,      // Block size (1024 bytes)
  p: 1,      // Parallelization parameter
  keylen: 32,// 256-bit derived key
  maxmem: 256 * 1024 * 1024, // 256 MB bound
} as const;
```

- **Salt Generation:** `crypto.randomBytes(16).toString('hex')` (128-bit cryptographic salt).
- **Asynchronous Execution:** Scrypt derivation is executed on libuv worker threads via `crypto.scrypt` wrapped in a Promise, avoiding blocking the Node.js event loop.
- **Concurrency Protection:** `authConcurrencyLimiter` limits simultaneous scrypt derivations to 4 concurrent slots, bounding total memory consumption to 512 MiB under load.
- **Timing Defense:** Verification compares derived hashes using `crypto.timingSafeEqual` to neutralize timing side-channel attacks.

---

## 5. Session Management & Token Revocation

1. **Token Structure:**
   - Header: `{"alg": "HS256", "typ": "JWT"}`
   - Claims: `sub` (User ID), `email`, `role`, `societyId`, `name`, `iat`, `exp` (24h default), `iss` (`aarizo-api`), `aud` (`aarizo-client`), `jti` (UUID v4).
   - Signature: HMAC-SHA256 using `AUTH_SECRET` (minimum 32 characters in production).
2. **Session Storage (`src/services/authStorage.ts`):**
   - Stored in browser `localStorage` under `aarizo_token` and `aarizo_user`.
   - Verified on route navigation and native mobile app resume (`isSessionValid()`).
3. **Session Invalidation:**
   - Multi-tab logout listener broadcasts `aarizo:unauthorized` and storage events.
   - Calling `logout()` disconnects realtime SSE, clears `localStorage`, and sets `status = 'UNAUTHENTICATED'`.

---

## 6. Action Items for Implementation Phase

1. **LoginScreen Refactor:** Strip out demo role pills, default passwords, and mock login fallbacks. Convert to clean, production-grade Email & Password form.
2. **Error Neutralization:** Ensure generic error messages (`Invalid email or password`) to prevent account enumeration (CWE-204).
3. **Password Recovery Entry Point:** Add "Forgot Password?" link on login page navigating to `/forgot-password`.
4. **Account Activation Entry Point:** Add "Have an invite code? Activate Account" link navigating to `/activate`.
