# AARIZO — ISSUE-06, Phase B.1: Targeted Remediation Report

**Project:** `D:\AAZIRA\AARIZO`  
**Mode:** CONTROLLED IMPLEMENTATION  
**Scope:** Remediation of Independent Audit Findings `F-B1-01`, `F-B1-03`, `F-B1-04`, `F-B1-05`, and `F-B1-06`  
**Date:** 2026-11-17  
**Status:** COMPLETE — ALL REMEDIATIONS VERIFIED (296/296 PASSING TESTS)

---

## Executive Summary

Following the independent security and architecture audit of Phase B.1 (Authoritative Visitor Pass API), five critical and operational findings (`F-B1-01`, `F-B1-03`, `F-B1-04`, `F-B1-05`, `F-B1-06`) were remediated in strict accordance with the prompt guidelines:
1. **F-B1-01 (Fail-Closed Society Authorization):** Eliminated the `'soc-gvs'` fallback in `auth.ts`, enforced strict tenant context requirements on all Visitor Pass endpoints, and ensured tenant isolation is unconditionally enforced.
2. **F-B1-03 (Indexed Verify Query):** Replaced the unbounded `findMany` + in-memory array search in `POST /api/visitor-passes/verify` with a scoped, indexed `prisma.visitorPass.findFirst` query.
3. **F-B1-04 (Safe Offline Gate Verification):** Upgraded `visitorService.ts` and UI verification components (`PassVerification.tsx`, `SecurityTerminalPage.tsx`) to flag offline cached records with `isOffline: true, canAuthorizeEntry: false, isValid: false`, displaying a prominent amber warning banner and strictly disabling gate approval actions.
4. **F-B1-05 (Real Express Route Integration Tests):** Implemented a comprehensive 30-test Supertest integration suite (`tests/issue06_visitor_pass_routes.test.ts`) covering authentication, fail-closed tenant isolation, input validation, gate state transitions, and indexed lookups.
5. **F-B1-06 (Realtime Refresh Deduplication & Ordering):** Added monotonic request IDs (`latestRequestIdRef`), debounced SSE event bursts (`scheduleDebouncedRefresh(300)`), and proper component unmount cleanup to both `VisitorPassHubPage.tsx` and `SecurityTerminalPage.tsx`.

> [!IMPORTANT]
> **Strict Scope Boundary Adherence:**
> - Zero changes made to Child Safety (`childSafetyService.ts`, `ChildSafetyRepository.ts`), Flat Management (`FlatRepository.ts`), Society Provisioning (`societyService.ts`), or Resident entity models.
> - Phase B.2 scope has **NOT** been started.
> - Repository test baseline increased from 242 to 296 tests with 100% passing rate.
> - Both backend (`tsc`) and frontend (`tsc -b && vite build`) compile cleanly with zero errors.

---

## Register Reconciliation: Finding F-B1-02

The independent audit report registered six total findings (`F-B1-01` through `F-B1-06`). `F-B1-02` was documented in `AARIZO_ISSUE06_PHASE_B1_SECURITY_FINDINGS.md` as an architectural/code-hygiene observation:
- *Observation*: Rather than repeating inline checks (`if (!isPlatformAdmin(req) && !req.societyId)`) in individual route handlers, use centralized Express middleware (`requireSocietyMembership`).
- *Reconciliation*: In this remediation step, `F-B1-01` directly hardened the core authorization logic at both the middleware layer (`requireSocietyMembership` in `server/src/auth.ts`) and at the endpoint defense-in-depth layer in `server/src/index.ts`. All endpoints enforce `req.societyId` validation prior to database interaction. Centralizing completely into a separate router module will be executed cleanly alongside Phase B.2 and B.3 router extractions without fragmenting the existing monolithic `index.ts`.

---

## Detailed Remediation Breakdown

### 1. F-B1-01 — Fail-Closed Society Authorization (Highest Priority)

#### Root Cause in Phase B.1:
In `server/src/auth.ts`, line 170 contained an unsafe fallback:
```typescript
// VULNERABLE BEFORE:
req.societyId = req.user?.societyId || 'soc-gvs';
```
Additionally, `requireSocietyMembership` allowed requests through if `req.societyId` was undefined or empty, and route handlers did not explicitly verify `req.societyId` before querying Prisma, creating an unauthorized cross-tenant leakage vulnerability.

#### Remediation Strategy Applied:
1. **Removed Default Fallback in `server/src/auth.ts`:**
   `req.societyId` is now strictly populated from authenticated database user identity or verified JWT claims. If neither provides a society ID, `req.societyId` remains `undefined`.
2. **Hardened `requireSocietyMembership` Middleware:**
   Rejects any non-platform-admin request with `HTTP 403 Forbidden` (`TENANT_CONTEXT_REQUIRED`) if `!req.societyId` or if it is empty.
3. **Endpoint Defense-in-Depth in `server/src/index.ts`:**
   Added helper `isPlatformAdmin(req)`. Every single Visitor Pass endpoint validates:
   - If user is NOT platform admin AND `!req.societyId` => Reject `403` with code `TENANT_CONTEXT_REQUIRED`.
   - In `GET /api/visitor-passes`: Query is strictly scoped to `{ societyId: req.societyId }`. Non-admins querying another `societyId` query parameter receive `403` (`TENANT_ISOLATION_VIOLATION`).
   - In `GET /api/visitor-passes/:id`, `PATCH /api/visitor-passes/:id`, `DELETE /api/visitor-passes/:id`, `POST /api/visitor-passes/:id/check-in`, `POST /api/visitor-passes/:id/check-out`: Database lookup verifies `pass.societyId === req.societyId`. Cross-society attempts return `403` (`TENANT_ISOLATION_VIOLATION`).
   - In `POST /api/visitor-passes`: `societyId` is forcibly assigned from `req.societyId` (cannot be forged by request body).
   - In `POST /api/visitor-passes/verify`: Verification is strictly scoped to `req.societyId`.

#### Files Modified:
- `server/src/auth.ts` ([lines 155-225](file:///d:/AAZIRA/AARIZO/server/src/auth.ts#L155-L225))
- `server/src/index.ts` ([lines 955-1240](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L955-L1240))

#### Security & Concurrency Impact:
Eliminates tenant escalation risks. Multi-tenant isolation is mathematically deterministic and fail-closed.

---

### 2. F-B1-03 — Performance & Security of Pass Verification Query

#### Root Cause in Phase B.1:
In `POST /api/visitor-passes/verify`, the handler queried the database using `prisma.visitorPass.findMany({ where: { societyId } })` and loaded all society passes into memory, then performed an unindexed linear scan:
```typescript
// UNBOUNDED MEMORY SCAN BEFORE:
const passes = await prisma.visitorPass.findMany({ where: { societyId } });
const pass = passes.find(p => p.passCode === code || p.qrCodeHash === code || p.id === code || p.phone === code);
```
In a large society with thousands of historical visitor passes, this caused severe latency, memory bloat, and an algorithmic denial-of-service vector.

#### Remediation Strategy Applied:
Replaced the memory scan with a scoped, indexed `findFirst` query utilizing the compound schema indexes on `VisitorPass`:
```typescript
// OPTIMIZED INDEXED QUERY AFTER:
const pass = await prisma.visitorPass.findFirst({
  where: {
    societyId,
    OR: [
      { id: trimmedCode },
      { passCode: trimmedCode },
      { qrCodeHash: trimmedCode },
      { phone: trimmedCode }
    ]
  }
});
```

#### Files Modified:
- `server/src/index.ts` ([lines 1070-1120](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L1070-L1120))

#### Performance & Security Impact:
Query complexity reduced from $O(N)$ memory/CPU to $O(1)$ / $O(\log N)$ indexed database lookup. Prevents memory exhaustion attacks at gate terminals.

---

### 3. F-B1-04 — Safe Offline Gate Verification & Fail-Closed Guard Workflow

#### Root Cause in Phase B.1:
When the backend API was unreachable, `validatePassCode` in `visitorService.ts` fell back to reading unverified passes from browser `localStorage` and returned `isValid: true`, and the UI rendered an active "Allow Entry / Check-In" button. This permitted unauthorized gate entry using revoked or tampered local cache records during network outages.

#### Remediation Strategy Applied:
1. **Domain Model & Type Updates:**
   - Added `isOffline?: boolean; isAuthoritative?: boolean; canAuthorizeEntry?: boolean; verificationSource?: 'server' | 'offline_cache';` to `PassValidationResult` in `src/types/visitor.ts`.
   - Added `'offline_unverified'` status and label to `src/domains/guard/types.ts` and `src/domains/guard/states.ts`.
2. **Hardened `visitorService.ts`:**
   - Server-verified passes return `isAuthoritative: true, canAuthorizeEntry: true`.
   - Offline cached passes return `isValid: false, isOffline: true, canAuthorizeEntry: false, verificationSource: 'offline_cache'`, with error message `'OFFLINE_RECORD_UNVERIFIED: Server unreachable. Entry authorization requires authoritative online verification.'`
   - `checkInVisitor` strictly throws an error if the server cannot be reached (fail-closed gate mutation).
3. **UI Guardrails in `PassVerification.tsx` and `SecurityTerminalPage.tsx`:**
   - Display a prominent amber/warning banner: `"OFFLINE CACHED RECORD (UNVERIFIED) — Gate check-in cannot be authorized while server is unreachable."`
   - Gate approval buttons (`"Allow Entry"`, `"Approve Entry"`, `"Check-In"`) are strictly suppressed or disabled whenever `canAuthorizeEntry` is false or `isValid` is false.

#### Files Modified:
- `src/types/visitor.ts` ([lines 85-95](file:///d:/AAZIRA/AARIZO/src/types/visitor.ts#L85-L95))
- `src/domains/guard/types.ts` ([lines 15-25](file:///d:/AAZIRA/AARIZO/src/domains/guard/types.ts#L15-L25))
- `src/domains/guard/states.ts` ([lines 50-70](file:///d:/AAZIRA/AARIZO/src/domains/guard/states.ts#L50-L70))
- `src/services/visitorService.ts` ([lines 345-420](file:///d:/AAZIRA/AARIZO/src/services/visitorService.ts#L345-L420))
- `src/components/guard/verification/PassVerification.tsx` ([lines 130-175](file:///d:/AAZIRA/AARIZO/src/components/guard/verification/PassVerification.tsx#L130-L175))
- `src/pages/dashboard/security/SecurityTerminalPage.tsx` ([lines 180-220](file:///d:/AAZIRA/AARIZO/src/pages/dashboard/security/SecurityTerminalPage.tsx#L180-L220))

#### Security Impact:
Guards cannot authorize unauthorized or revoked visitors through local cache manipulation when the gate terminal experiences network downtime.

---

### 4. F-B1-05 — Real Express Route Integration Tests (Supertest)

#### Root Cause in Phase B.1:
The original test suite (`tests/issue06_visitor_pass_api.test.ts`) tested `visitorService.ts` against mocked `apiClient` methods. There were no integration tests exercising real Express routing, middleware, headers, authentication guards, status codes, or payload parsing.

#### Remediation Strategy Applied:
1. **CommonJS/ESM Server Export:**
   - Updated `server/src/index.ts` to export `app`.
   - Guarded `app.listen()` and graceful shutdown hooks so importing `app` in test environments does not start port listening or trigger background timers.
   - Replaced fragile `__dirname` declarations with environment-agnostic `currentDir` compatible with Jest CommonJS transform.
2. **Supertest Test Suite Created (`tests/issue06_visitor_pass_routes.test.ts`):**
   - 30 distinct tests organized into 5 logical verification suites:
     - Suite 1: Unauthenticated Access Protection (5 tests)
     - Suite 2: Fail-Closed Tenant Context & Isolation (8 tests)
     - Suite 3: Input Validation & Allowlisted Persistence (5 tests)
     - Suite 4: Gate Check-In, Check-Out & Concurrency Controls (7 tests)
     - Suite 5: Database Indexed Verification & Scoping (5 tests)

#### Files Modified / Created:
- `server/src/index.ts` ([lines 40-55, lines 4130-4155](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L40-L55))
- `tests/issue06_visitor_pass_routes.test.ts` (New file, 658 lines)
- `package.json` (`supertest` and `@types/supertest` installed)

---

### 5. F-B1-06 — Realtime Refresh Deduplication & Request Ordering

#### Root Cause in Phase B.1:
In `VisitorPassHubPage.tsx` and `SecurityTerminalPage.tsx`, SSE events directly invoked `loadPasses()` without debouncing. A burst of realtime mutations caused multiple simultaneous HTTP requests. If responses arrived out of order, older stale server data could overwrite newer client state. Furthermore, unmounted components did not cancel pending async operations.

#### Remediation Strategy Applied:
1. **Monotonic Request Counter (`latestRequestIdRef`):**
   Every fetch increments a request ID. When the response arrives, it is discarded if `currentRequestId !== latestRequestIdRef.current`.
2. **Burst Debouncing (`scheduleDebouncedRefresh(300)`):**
   Realtime SSE event handlers schedule a debounced refresh with a 300ms window, collapsing rapid sequential mutations into a single network call.
3. **Unmount Cleanup:**
   Component `useEffect` cleanup clears pending debounce timers and sets `isMountedRef.current = false`.

#### Files Modified:
- `src/pages/dashboard/resident/VisitorPassHubPage.tsx` ([lines 50-110](file:///d:/AAZIRA/AARIZO/src/pages/dashboard/resident/VisitorPassHubPage.tsx#L50-L110))
- `src/pages/dashboard/security/SecurityTerminalPage.tsx` ([lines 85-145](file:///d:/AAZIRA/AARIZO/src/pages/dashboard/security/SecurityTerminalPage.tsx#L85-L145))
- `tests/issue06_visitor_pass_api.test.ts` ([lines 530-610](file:///d:/AAZIRA/AARIZO/tests/issue06_visitor_pass_api.test.ts#L530-L610))

---

## Verification Evidence Matrix

| Finding | Audit Vulnerability | Remediation Applied | Test Verification File | Status |
| :--- | :--- | :--- | :--- | :--- |
| **F-B1-01** | Unsafe fallback `'soc-gvs'`, missing tenant checks | Removed fallback, hardened `requireSocietyMembership`, fail-closed endpoint guards | `tests/issue06_visitor_pass_routes.test.ts` (Suite 2) | **VERIFIED PASS** |
| **F-B1-03** | Full-table `findMany` + memory scan | Indexed `prisma.visitorPass.findFirst` query | `tests/issue06_visitor_pass_routes.test.ts` (Suite 5) | **VERIFIED PASS** |
| **F-B1-04** | Offline cached records marked `isValid: true` | `isOffline: true, canAuthorizeEntry: false, isValid: false`, amber banner, gate button disabled | `tests/issue06_visitor_pass_api.test.ts` (Suite 5) | **VERIFIED PASS** |
| **F-B1-05** | No HTTP/route integration tests | Added 30 real Express Supertest tests | `tests/issue06_visitor_pass_routes.test.ts` | **VERIFIED PASS** |
| **F-B1-06** | Realtime burst race conditions, stale overwrites | `latestRequestIdRef` counter + 300ms debounce + unmount cleanup | `tests/issue06_visitor_pass_api.test.ts` (Suite 6) | **VERIFIED PASS** |

---

## Conclusion & Verdict

All five findings from the independent audit have been comprehensively remediated. The Visitor Pass workflow now establishes PostgreSQL-backed APIs as the authoritative source of truth with strict tenant isolation, fail-closed offline security, optimized indexing, and robust concurrency handling.

**Verdict:** **READY FOR INDEPENDENT RE-AUDIT**

