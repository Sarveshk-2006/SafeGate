# AARIZO — ISSUE-06 Phase B.2: Child Safety Regression & Test Plan

**Project:** `D:\AAZIRA\AARIZO`  
**Phase:** ISSUE-06 — B.2 Child Safety & Biometric Gate Radar  
**Document:** Regression Test Strategy & Quality Gate  
**Status:** COMPLETED  

---

## 1. Regression Risk Assessment & Scope Boundaries

During Phase B.2, modifications will be introduced to:
1. `server/prisma/schema.prisma` (adding Child Safety relational models).
2. `server/src/index.ts` (hardening child safety routes, replacing `EntityRecord` with Prisma models, removing `'soc-gvs'` fallback).
3. `server/src/crypto.ts` (adding child pass payload HMAC signing and validation).
4. `src/services/childSafetyService.ts` and `src/domains/safety/services/safetyCommandEngine.ts` (unifying frontend APIs).
5. Frontend portals (`ChildGateScannerPage.tsx`, `SafetyCommandHub.tsx`, `AdminChildSafetyPage.tsx`).

### Strict Boundary Protections
- **Phase B.1 Visitor Pass Protection:** Under no circumstances should Visitor Pass routes (`/api/visitor-passes/*`), models (`VisitorPass`, `VisitorEntryLog`), tests (`tests/issue06_visitor_pass_routes.test.ts`, `tests/issue06_visitor_pass_api.test.ts`), or verification logic be modified or regressed.
- **Authentication & Multi-Tenant Middleware:** The shared `authenticateToken`, `requireRole`, and `validateTenantContext` middlewares in `server/src/auth.ts` must remain invariant.
- **Database Boundary:** Unrelated containers (`nexus-postgres` on port 5432) must never be touched. Migrations must be verified via Prisma CLI validation and non-destructive scripts.

---

## 2. Baseline Test Inventory (Pre-Implementation Baseline: 296/296 Passing)

The current working tree passes all 296 repository tests across 17 test suites:

| Test Suite | Tests | Domain / Coverage |
| :--- | :--- | :--- |
| `tests/issue06_visitor_pass_routes.test.ts` | 13 | Authoritative Visitor Pass Express routes, Supertest, RBAC, tenant isolation |
| `tests/issue06_visitor_pass_api.test.ts` | 18 | Visitor service, offline fallback, optimistic UI, state synchronization |
| `tests/issue05_secure_seed_auth.test.ts` | 49 | Password hashing, PBKDF2/argon2, seed isolation, SQL injection prevention |
| `tests/issue04_runtime_config.test.ts` | 27 | Centralized environment validation, fallback rejection |
| `tests/issue03_step33_hardening.test.ts` | 41 | Auth storage, session tracker, concurrent logins |
| `tests/issue03_auth_storage_consistency.test.ts` | 23 | Local/session storage consistency, token persistence |
| `tests/issue02_gap01_secret_hardening.test.ts` | 12 | Secret hygiene, JWT secret entropy |
| `tests/issue02_gap02_mock_auth_hardening.test.ts` | 14 | Removal of unauthenticated demo backdoors |
| `tests/issue02_gap03_sse_authorization.test.ts` | 15 | Realtime SSE channel authorization, token handshake |
| `tests/issue02_privilege_escalation.test.ts` | 16 | Vertical & horizontal RBAC defense |
| `tests/issue02_unified_auth_integration.test.ts` | 22 | End-to-end login, refresh, logout flows |
| `tests/route_protection.test.ts` | 18 | Frontend route guards, unauthorized redirects |
| `tests/provisioning.test.ts` | 8 | Society and initial admin bootstrapping |
| `tests/differentiators.test.ts` | 7 | Core business rules and workflows |
| `tests/razorpay.test.ts` | 7 | Payment webhook signature validation |
| `tests/security.test.ts` | 6 | Security headers and general defensive checks |
| **Total Baseline** | **296** | **17 Suites Passing (100%)** |

---

## 3. Phase B.2 Targeted Test Suite Blueprint

To validate Phase B.2 implementation, two dedicated test suites will be introduced:

### 3.1 Suite 1: `tests/issue06_child_safety_routes.test.ts` (Supertest Express Integration)
Target: 15+ focused test cases.
1. `GET /api/children`:
   - Returns HTTP 401 when unauthenticated.
   - Returns HTTP 403 when authenticated user has no society context.
   - Rejects cross-tenant access when caller tries `?societyId=other`.
   - Returns only the resident's children when caller role is `resident`.
   - Returns all society children when caller role is `guard` or `admin`.
2. `POST /api/children`:
   - Returns HTTP 401/403 for unauthorized roles.
   - Rejects missing required fields (`fullName`, `dateOfBirth`, `guardianPhone`).
   - Rejects attempts to create child in a different society via body override.
   - Successfully creates child in PostgreSQL and broadcasts `CHILD_PROFILE_CREATED`.
3. `GET /api/children/passes`:
   - Scopes passes to resident's children for resident role.
   - Leaks zero data across society boundaries.
4. `POST /api/children/passes`:
   - Rejects pass generation for child not belonging to resident's flat.
   - Generates unique pass code and HMAC signature.
   - Successfully persists to PostgreSQL and broadcasts `CHILD_GATE_PASS_GENERATED`.
5. `POST /api/children/passes/verify`:
   - Rejects non-guard/non-admin roles with HTTP 403.
   - Rejects cross-society verification attempt with HTTP 403 (Guard in Soc A verifying Soc B pass).
   - Rejects unknown or malformed pass code (404).
   - Rejects already used pass (replay attack prevention).
   - Rejects expired pass (timestamp validity window check).
   - Successfully authorizes valid pass, updates child status to `OUT_OF_SOCIETY`, records `ChildExitLog`, and broadcasts `CHILD_GATE_PASS_VERIFIED`.
6. `POST /api/children/sos`:
   - Rejects unauthenticated caller with HTTP 401.
   - Successfully logs emergency incident and broadcasts `CHILD_SAFETY_SOS_TRIGGERED`.

### 3.2 Suite 2: `tests/issue06_child_safety_service.test.ts` (Client Service & Offline Verifier)
Target: 10+ focused test cases.
1. `childSafetyService.getChildren`:
   - Fetches from authoritative backend API.
   - Updates local cache safely without overwriting with synthetic demo data.
2. `childSafetyService.createChildProfile`:
   - Awaits remote API call and returns persisted record.
   - Does not swallow network errors.
3. `childSafetyService.generateChildPickupQR`:
   - Dispatches authenticated request to server and receives signed QR payload.
4. Gate Verification:
   - Successfully verifies online pass with backend.
   - Validates cryptographic signature offline if server is unreachable, failing closed on signature mismatch or expiration.

---

## 4. Verification & Gate Criteria

Phase B.2 will only be marked complete when:
1. All 296 baseline tests continue to pass without modification or regression.
2. All new Child Safety route and service tests pass (reaching >= 320+ total passing tests).
3. Both backend TypeScript build (`npm --prefix server run build`) and frontend TypeScript build (`npm run build`) complete with zero errors.
4. An independent read-only security audit verifies that all 9 identified security threats (SEC-B2-01 through SEC-B2-09) are remediated.

