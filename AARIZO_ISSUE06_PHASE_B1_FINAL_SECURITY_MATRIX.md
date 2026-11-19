# AARIZO — ISSUE-06, Phase B.1: Final Security & Architecture Matrix

**Project:** `D:\AAZIRA\AARIZO`  
**Mode:** STRICT READ-ONLY SECURITY AND REGRESSION AUDIT  
**Date:** 2026-11-17  
**Scope:** Final Security Audit of Visitor Pass Authoritative Architecture (`ISSUE-06` Phase B.1)

---

## 1. Security & Architecture Verification Matrix

| Finding ID | Security Domain | Target Behavior | Audited Implementation & Evidence | Line References | Verified Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **F-B1-01** | **Tenant Authorization & Fail-Closed Guard** | Society context must originate exclusively from verified auth. Missing society context must fail closed with 403 `TENANT_CONTEXT_REQUIRED`. | Fallback `'soc-gvs'` removed. `effectiveSocietyId` resolved strictly from DB/claims. If missing, `req.societyId` is undefined. All 9 endpoints reject non-admins with 403. | `server/src/auth.ts:292`<br>`server/src/index.ts:675, 731, 771, 882, 979, 1026, 1069, 1114, 1163` | **PASS** |
| **F-B1-01** | **Multi-Tenant Isolation** | Non-admin users cannot query, mutate, check in, check out, or delete records from another society. | All endpoints compare `pass.societyId === req.societyId`. Mismatches reject with 403 `TENANT_ISOLATION_VIOLATION`. `POST` forces `societyId = req.societyId`. | `server/src/index.ts:679, 746, 776, 897, 992, 1039, 1082, 1118, 1167` | **PASS** |
| **F-B1-01** | **Resident Isolation** | Residents cannot access, modify, or delete passes belonging to other residents in the same society. | `where` clause in `GET` filters by `residentId`. `PATCH` and `DELETE` verify ownership and reject with 403 `UNAUTHORIZED_PASS_ACCESS`. | `server/src/index.ts:693-711, 751-760, 905-918, 1087-1096` | **PASS** |
| **F-B1-01** | **Role Separation** | Guards cannot delete passes. Residents cannot perform gate check-in or check-out operations. | `DELETE` endpoint restricts roles to `['resident', 'secretary', 'admin']` (guards get 403 `INSUFFICIENT_PERMISSIONS`). Gate operations reject residents with 403 `INSUFFICIENT_PERMISSIONS` or `OPERATION_NOT_PERMITTED`. | `server/src/index.ts:914-917, 976, 1023, 1066` | **PASS** |
| **F-B1-01** | **Header Spoofing Resistance** | Injected client headers (`x-society-id`, `x-user-id`, `x-user-role`) cannot alter identity or permissions. | Authenticated context is established exclusively from signed JWT/Firebase tokens. Headers are never used for authorization decisions. | `server/src/auth.ts:211-226`<br>`tests/issue06_visitor_pass_routes.test.ts:216-231` | **PASS** |
| **F-B1-02** | **Centralized Middleware Hygiene** | Multi-tenant isolation verified by centralized middleware alongside endpoint defense-in-depth. | `requireSocietyMembership` hardened in `auth.ts` to reject non-admins with missing society context. Endpoints implement explicit inline verification. | `server/src/auth.ts:355-384`<br>`server/src/index.ts:674-681` | **PASS** |
| **F-B1-03** | **Bounded Database Verification Query** | Verification endpoint must query single record using indexed lookups, scoped to society. | Replaced unbounded `findMany` with `prisma.visitorPass.findFirst` scoped to `societyId`. Query returns single normalized pass. | `server/src/index.ts:1181-1204` | **PASS (Scoping)** |
| **F-B1-04** | **Safe Offline Gate Verification** | Offline cached records must NEVER be marked valid or authorize gate entry. | `validatePassCode` and `validatePassCodeSync` return `isValid: false, isOffline: true, canAuthorizeEntry: false, verificationSource: 'offline_cache'`. `checkInVisitor` throws fail-closed error if offline. | `src/services/visitorService.ts:386-430, 497-507, 524-542` | **PASS** |
| **F-B1-04** | **Guard UI Button Suppression** | Amber warning banner rendered; entry approval buttons strictly suppressed for offline cached passes. | `PassVerification.tsx` displays `⚠️ OFFLINE CACHE ONLY` and completely omits "Allow Entry" button. `SecurityTerminalPage.tsx` displays warning and omits "Approve Entry" button. | `src/components/guard/verification/PassVerification.tsx:484, 553`<br>`src/pages/dashboard/security/SecurityTerminalPage.tsx:681-730` | **PASS** |
| **F-B1-05** | **Supertest Route Integration Tests** | Real HTTP requests dispatched to Express application testing middleware and route handlers. | Test suite `tests/issue06_visitor_pass_routes.test.ts` authored with 30 tests covering 5 verification groups. Blocked from execution in Jest runner by F-B1-08. | `tests/issue06_visitor_pass_routes.test.ts:1-658` | **BLOCKED (F-B1-08)** |
| **F-B1-06** | **Realtime Race & Burst Protection** | SSE bursts must not flood network; stale out-of-order responses must not overwrite newer state. | `latestRequestIdRef` counter discards stale responses; `scheduleDebouncedRefresh(300)` collapses bursts; unmount hooks clear timers and unsubscribe. | `src/pages/dashboard/resident/VisitorPassHubPage.tsx:75-129`<br>`src/pages/dashboard/security/SecurityTerminalPage.tsx:68-117` | **PASS** |
| **F-B1-07** | **Schema Indexing Gaps (New Finding)** | Verification queries must be supported by PostgreSQL B-tree or Trigram indexes. | `VisitorPass` model in `schema.prisma` lacks `@@index` annotations. `01_schema.sql` lacks index on `qr_code_hash`. Substring matching (`contains`) requires Trigram index. | `server/prisma/schema.prisma:324-348`<br>`scripts/postgres/01_schema.sql:649-650` | **DEFECT** |
| **F-B1-08** | **CommonJS Syntax Collision (New Finding)** | Express app export must be importable in CommonJS test runner without lexical collisions. | `const __dirname = (() => { ... })();` in `server/src/index.ts:48` causes `SyntaxError: Identifier '__dirname' has already been declared` in Jest runner. | `server/src/index.ts:48-55` | **DEFECT** |

---

## 2. Threat & Vulnerability Evaluation

### Threat 1: Cross-Tenant Visitor Pass Access
- **Attack Vector:** An attacker logged into Society A submits requests for Society B's passes (`/api/visitor-passes/pass-b-1`) or supplies `x-society-id: soc-b`.
- **Defense-in-Depth Mechanism:**
  1. `authenticateToken` strictly ignores client identity headers.
  2. `req.societyId` is bound exclusively to database/JWT claim `soc-a`.
  3. Route handler verifies `pass.societyId === req.societyId`.
- **Audit Assessment:** **EFFECTIVELY MITIGATED (Zero Bypass Detected).**

### Threat 2: Offline Gate Bypass Using Revoked Pass
- **Attack Vector:** A visitor presents a revoked or expired pass while the security terminal has lost network connectivity to the backend.
- **Defense-in-Depth Mechanism:**
  1. `validatePassCode` checks expiry and revocation even in cached fallback.
  2. Offline fallback strictly returns `isValid: false, canAuthorizeEntry: false`.
  3. Guard UI displays amber warning banner and suppresses entry approval buttons.
  4. Backend check-in mutation fails closed if network is disconnected.
- **Audit Assessment:** **EFFECTIVELY MITIGATED (Zero Bypass Detected).**

### Threat 3: Unbounded Denial-of-Service on Gate Lookups
- **Attack Vector:** An attacker floods `/api/visitor-passes/verify` with random passcodes, forcing the server to load all society passes into memory.
- **Defense-in-Depth Mechanism:**
  1. Scoped `findFirst` query limits database load to 1 record.
  2. Target society scoping limits search space.
- **Residual Risk:** Substring `contains` search on `qrCodeHash` causes a sequential scan across society records due to missing Trigram GIN index (see F-B1-07).
- **Audit Assessment:** **PARTIALLY MITIGATED — Schema index migration required.**

---

## 3. Security Audit Verdict

The architecture achieves full fail-closed tenant isolation and eliminates the critical offline gate entry vulnerability. Minor operational and indexing corrections (F-B1-07, F-B1-08) are required before formal closure.

