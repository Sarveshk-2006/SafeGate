# AARIZO — ISSUE-06, Phase B.1: Independent Security & Architecture Verification Audit

**Audit Date:** 2026-11-17  
**Auditor Mode:** STRICT READ-ONLY INDEPENDENT AUDIT  
**Scope:** ISSUE-06 Phase B.1 (Visitor Pass Authoritative API & State Synchronization)  
**Target Codebase:** `D:\AAZIRA\AARIZO`  
**Git Commit / Working Tree:** Working Directory (Phase B.1 changes applied, uncommitted)  
**Parent Issue:** ISSUE-06 — Tri-Tier State Desynchronization (Master Issue Register P1)  

---

## Executive Summary

An independent security, architectural, and quality audit was conducted on the Phase B.1 implementation of **ISSUE-06 (Visitor Pass Authoritative API & Tri-Tier Synchronization)**. Phase B.1 aims to eliminate tri-tier state desynchronization (PostgreSQL backend vs. Firebase Firestore vs. browser `localStorage`) by establishing PostgreSQL-backed backend APIs as the single authoritative source of truth for the complete Visitor Pass lifecycle.

All 8 visitor pass endpoints in `server/src/index.ts`, backend data models in `server/prisma/schema.prisma`, client API client in `src/services/apiClient.ts`, frontend service in `src/services/visitorService.ts`, UI consumer pages, and corresponding test suites were rigorously audited line by line.

### Audit Summary Table

| Category | Metric / Status | Notes |
| :--- | :--- | :--- |
| **Overall Verdict** | **CONDITIONAL PASS — SPECIFIC CORRECTIONS REQUIRED** | Core authoritative workflows established; 5 findings require remediation before final sign-off |
| **Total Test Suites Passing** | **17 / 17 passed (100%)** | All repository test suites pass without regression |
| **Total Tests Passing** | **275 / 275 passed (100%)** | Includes 33 focused Phase B.1 tests |
| **Backend TypeScript Build** | **Clean (`tsc` passed)** | Zero compiler errors or type mismatches |
| **Frontend Production Build** | **Clean (`tsc -b && vite build` passed)** | Zero type errors; production bundle built in 1.01s |
| **Authentication Enforcement** | **100% Enforced** | All `/api/visitor-passes` routes require valid Bearer token |
| **Role-Based Access Control** | **Enforced** | Strict `requireRole` middleware applied to all 8 endpoints |
| **Prisma Mass Assignment Protection** | **100% Enforced** | Zero `req.body` spreads; explicit allowlisted extraction |
| **Primary Risk Finding** | **F-B1-05 (Test Rigor)** | Route test suite tests mock logic blocks instead of Express router via `supertest` |
| **Secondary Risk Finding** | **F-B1-01 (Tenant Logic)** | Inline tenant isolation check skips validation if `req.societyId` is undefined |
| **Tertiary Risk Finding** | **F-B1-04 (Offline Gate UI)** | Offline validation fallback does not flag `isOffline: true` on pass validation result |

---

## 1. Authentication and Authorization Audit

### 1.1 Endpoint-by-Endpoint Authentication Inspection

All API requests under `/api/*` are guarded by Express middleware in `server/src/index.ts` lines 112–117:
```typescript
// server/src/index.ts L112-117
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  if (isPublicApiRoute(req)) {
    return next();
  }
  return authenticateToken(req, res, next);
});
```

The public route allowlist (`isPublicApiRoute`) in lines 88–109 explicitly enumerates:
- `GET /api/health`, `/api/health/live`, `/api/health/ready`, `/api/realtime/health`
- `POST /api/auth/login`
- `POST /api/payments/razorpay/webhook`

**Verification:** None of the `/api/visitor-passes*` routes are included in `isPublicApiRoute`. Therefore, **unauthenticated requests to any Visitor Pass endpoint are rejected with HTTP 401 Unauthorized** by `authenticateToken`.

### 1.2 Role-Based Access Control (RBAC) Matrix

Every Visitor Pass endpoint mounts `requireRole` middleware with an explicit role allowlist:

| HTTP Method | Route | `requireRole` Allowed Roles | Resident Access | Guard Access | Admin Access |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/visitor-passes` | `resident`, `guard`, `secretary`, `admin`, `facility_manager` | Scoped to own | Scoped to society | Full / Scoped |
| `GET` | `/api/visitor-passes/:id` | `resident`, `guard`, `secretary`, `admin`, `facility_manager` | Scoped to own | Scoped to society | Full |
| `POST` | `/api/visitor-passes` | `resident`, `guard`, `secretary`, `admin` | Allowed (forced residentId) | Allowed (walk-in) | Full |
| `PATCH` | `/api/visitor-passes/:id` | `resident`, `guard`, `secretary`, `admin` | Allowed (own pass, no gate ops) | Allowed (gate ops, status) | Full |
| `POST` | `/api/visitor-passes/:id/check-in` | `guard`, `secretary`, `admin` | **BLOCKED (403)** | Allowed | Allowed |
| `POST` | `/api/visitor-passes/:id/check-out`| `guard`, `secretary`, `admin` | **BLOCKED (403)** | Allowed | Allowed |
| `DELETE` | `/api/visitor-passes/:id` | `resident`, `secretary`, `admin` | Allowed (own pass, not inside) | **BLOCKED (403)** | Allowed |
| `POST` | `/api/visitor-passes/verify` | `guard`, `secretary`, `admin`, `resident` | Scoped to society | Scoped to society | Full |
| `POST` | `/api/visitor-passes/check-overstay` | `guard`, `secretary`, `admin` | **BLOCKED (403)** | Allowed | Allowed |

**Verification Details:**
- **Gate Check-In/Check-Out Isolation:** Residents are strictly blocked from calling `/api/visitor-passes/:id/check-in` and `/api/visitor-passes/:id/check-out` via `requireRole(['guard', 'secretary', 'admin'])`. Additionally, if a resident attempts a `PATCH` request with `status: 'CHECKED_IN'` or `status: 'CHECKED_OUT'`, lines 863–865 explicitly reject with HTTP 403 `OPERATION_NOT_PERMITTED`.
- **Guard Deletion Protection:** Guards are excluded from `DELETE /api/visitor-passes/:id` via `requireRole(['resident', 'secretary', 'admin'])`. Guards cannot delete visitor pass records.

### 1.3 Multi-Tenant Isolation & Resident Scoping

- **Identity Resolution (`server/src/index.ts#L122-127`):**
  ```typescript
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.societyId = req.authContext?.societyId;
    req.userId = req.authContext?.userId;
    req.userRole = req.authContext?.role;
    next();
  });
  ```
  Client-supplied headers (`x-society-id`, `x-user-id`, `x-user-role`) are **never trusted**. Identity and tenant context are derived strictly from the verified JWT claims.
- **Resident Query Scoping (`GET /api/visitor-passes`, lines 671–689):**
  When `req.userRole === 'resident'`, the endpoint queries the database for linked resident identities (`prisma.resident.findFirst({ where: { OR: [{ userId: req.userId }, { id: req.userId }] } })`) and restricts results using Prisma `where.AND = [{ societyId }, { OR: [{ residentId: { in: residentIdMatches } }, { resident: { userId: req.userId } }] }]`. Residents can never view passes belonging to other residents.
- **Single-Pass Ownership Check (`GET /api/visitor-passes/:id`, lines 724–729):**
  ```typescript
  if (req.userRole === 'resident') {
    const isOwner = pass.residentId === req.userId || pass.resident?.userId === req.userId;
    if (!isOwner) {
      return res.status(403).json({ error: 'Access denied: You can only view your own visitor passes', code: 'UNAUTHORIZED_PASS_ACCESS' });
    }
  }
  ```
- **Audit Finding F-B1-01 (Tenant Validation Fail-Open on Missing Society ID):**
  In lines 719, 849, 935, 977, 1015:
  ```typescript
  if (req.userRole !== 'admin' && req.societyId && pass.societyId !== req.societyId) {
    return res.status(403).json({ ... });
  }
  ```
  If `req.societyId` is undefined or empty for a non-admin user (e.g. malformed JWT or unexpected token payload), the second condition `req.societyId` evaluates to `false`, causing the check to be bypassed. This fails open. The condition must be hardened to fail closed:
  `if (req.userRole !== 'admin' && (!req.societyId || pass.societyId !== req.societyId))`.

---

## 2. Backend Implementation and Prisma Data Integrity

### 2.1 Prisma Schema & Relational Model

The `VisitorPass` model in `server/prisma/schema.prisma` lines 324–348 is properly structured:
```prisma
model VisitorPass {
  id            String     @id @default(uuid())
  societyId     String     @map("society_id")
  residentId    String?    @map("resident_id")
  flatId        String?    @map("flat_id")
  visitorName   String     @map("visitor_name")
  phone         String
  passType      PassType   @default(GUEST) @map("pass_type")
  vehicleNumber String?    @map("vehicle_number")
  purpose       String?
  status        PassStatus @default(PENDING)
  qrCodeHash    String?    @map("qr_code_hash")
  validFrom     DateTime   @map("valid_from")
  validTo       DateTime   @map("valid_to")
  checkInTime   DateTime?  @map("check_in_time")
  checkOutTime  DateTime?  @map("check_out_time")
  createdAt     DateTime   @default(now()) @map("created_at")
  updatedAt     DateTime   @updatedAt @map("updated_at")

  society       Society    @relation(fields: [societyId], references: [id], onDelete: Cascade)
  resident      Resident?  @relation(fields: [residentId], references: [id], onDelete: SetNull)
  flat          Flat?      @relation(fields: [flatId], references: [id], onDelete: SetNull)

  @@map("visitor_passes")
}
```

### 2.2 Mass Assignment & Parameter Injection Protection

- **`POST /api/visitor-passes` (`server/src/index.ts#L737-833`):**
  The route handler does **NOT** use `prisma.visitorPass.create({ data: req.body })`. Instead, it explicitly extracts and sanitizes each field into allowlisted variables:
  - `visitorName`: `String(body.visitorName || '').trim()` (mandatory, validated non-empty)
  - `phone`: `String(body.phone || body.visitorPhone || '').trim()` (mandatory, length >= 4)
  - `passType`: Strictly mapped to Prisma enum values (`'GUEST' | 'DELIVERY' | 'CAB' | 'SERVICE' | 'FREQUENT'`)
  - `validFrom` / `validTo`: Validated via `isNaN(validFrom.getTime())` and `validTo.getTime() > validFrom.getTime()`
  - `vehicleNumber`, `purpose`: Trimmed strings or null
  - `status`: Mapped to valid enum values (`'PENDING' | 'APPROVED' | 'CHECKED_IN' | 'CANCELLED'`)
  - `societyId`: Forced to `req.societyId` (non-admin)
  - `residentId`: Forced to verified resident record (residents)
- **`PATCH /api/visitor-passes/:id` (`server/src/index.ts#L836-921`):**
  Only allowlisted fields can be updated: `status`, `checkInTime`, `checkOutTime`, `vehicleNumber`, `purpose`.
  Internal relational keys (`id`, `societyId`, `residentId`, `flatId`, `createdAt`) cannot be modified via `PATCH`.

### 2.3 State Machine Transition Enforcements & Concurrency Controls

The backend enforces strict state transitions on all gate operations:

```
[EXPECTED / APPROVED] ──(Gate Check-In)──> [CHECKED_IN] ──(Gate Check-Out)──> [CHECKED_OUT]
       │                                         │
  (Resident/Admin Revoke)                 (Block Revoke/Delete:
       │                                   VISITOR_CURRENTLY_INSIDE)
       v                                         │
  [CANCELLED]                             (Overstay Engine)
                                                 │
                                                 v
                                             [EXPIRED]
```

1. **Duplicate Check-In Protection:**
   In lines 873 & 939: If `existing.status === 'CHECKED_IN'`, returns HTTP 409 Conflict with code `ALREADY_CHECKED_IN`.
2. **Expired Pass Check-In Prevention:**
   In lines 879 & 945: If `new Date() > new Date(existing.validTo)`, returns HTTP 400 Bad Request with code `PASS_EXPIRED`.
3. **Cancelled / Rejected Pass Check-In Prevention:**
   In lines 875 & 942: If `status` is `CANCELLED`, `REJECTED`, or `EXPIRED`, returns HTTP 400 with code `INVALID_PASS_STATUS`.
4. **Premature Check-Out Prevention:**
   In lines 889 & 984: If `existing.status !== 'CHECKED_IN'`, returns HTTP 400 with code `NOT_CHECKED_IN`.
5. **Duplicate Check-Out Protection:**
   In lines 886 & 981: If `existing.status === 'CHECKED_OUT'`, returns HTTP 409 Conflict with code `ALREADY_CHECKED_OUT`.
6. **Active Inside Revocation & Deletion Protection:**
   In lines 895 & 1028: If visitor is inside (`status === 'CHECKED_IN'`), pass cannot be revoked or deleted. Returns HTTP 400 with code `VISITOR_CURRENTLY_INSIDE`.

---

## 3. Frontend Authoritative-State Behavior

### 3.1 Elimination of Optimistic Local Mutation Prior to Server Confirmation

In `src/services/visitorService.ts`:
- **`createVisitorPass` (lines 294–330):**
  ```typescript
  // 1. Authoritative API Call
  let savedPass: SmartVisitorPass;
  try {
    const serverRes = await apiClient.createVisitorPass(serverPayload);
    savedPass = normalizePass(serverRes);
  } catch (err: any) {
    console.error('[visitorService] Authoritative createVisitorPass API call failed:', err);
    throw new Error(`Failed to create visitor pass on server: ${err?.message || 'Network / Server Error'}`);
  }

  // 2. Update local cache ONLY AFTER server confirmation
  const passes = getItem<SmartVisitorPass[]>(STORAGE_KEYS.PASSES, SEED_PASSES);
  setItem(STORAGE_KEYS.PASSES, [savedPass, ...passes.filter(p => p.id !== savedPass.id)]);
  ```
  Local storage is **not written** before the server responds. If the server request fails or times out, an error is thrown, the UI catches it, and the modal remains open with an alert.
- **`checkInVisitor` (lines 440–485):**
  Awaits `apiClient.checkInVisitorPass(passId, gateDetails)`. Local storage cache is updated only after server responds with 200/201.
- **`checkOutVisitor` (lines 492–536):**
  Awaits `apiClient.checkOutVisitorPass(passId)`. Local storage cache is updated only after server responds.
- **`revokePass` (lines 587–609):**
  Awaits `apiClient.updateVisitorPass(passId, { status: 'CANCELLED' })`. Local cache updated only after server confirmation.
- **`fetchPasses` (lines 218–232):**
  Calls `apiClient.getVisitorPasses(societyId)`. Authoritative server passes **replace** local storage cache for the given society.

### 3.2 Audit Finding F-B1-04 (Offline Gate Pass Validation Ambiguity)

In `src/services/visitorService.ts#L334-377`:
```typescript
validatePassCode: async (societyId: string, codeOrQr: string): Promise<PassValidationResult> => {
  ...
  try {
    const serverResult = await apiClient.verifyVisitorPass(cleanCode, societyId);
    if (serverResult) {
      const pass = serverResult.pass ? normalizePass(serverResult.pass) : undefined;
      if (serverResult.isValid && pass) {
        return { isValid: true, pass };
      }
      return { isValid: false, reason: serverResult.message || 'Pass invalid or expired', pass };
    }
  } catch (err) {
    console.warn('[visitorService] Server verification failed, falling back to local cache:', err);
  }

  // Fallback to local cache
  return visitorService.validatePassCodeSync(societyId, codeOrQr);
}
```
**Impact:** If the server is offline or network fails, `validatePassCodeSync` validates against cached local passes. It returns `{ isValid: true, pass }` without setting any flag such as `isOffline: true` or `isProvisional: true`. The gate guard sees an identical green "Valid" badge with no indication that verification was offline. If a resident revoked the pass on the server while the security terminal had intermittent connectivity, the guard could inadvertently admit an unauthorized person.

---

## 4. Realtime Synchronization and Event Consistency

### 4.1 Server Broadcast Inspection

Server routes broadcast events via `broadcastEvent(topic, payload, societyId)`:
- `POST /api/visitor-passes`: Broadcasts `VISITOR_ARRIVAL` with normalized pass payload (line 828).
- `PATCH /api/visitor-passes/:id`: Broadcasts `VISITOR_ENTRY` (on CHECKED_IN), `VISITOR_EXIT` (on CHECKED_OUT), or `VISITOR_STATUS_CHANGE` (line 916).
- `POST /api/visitor-passes/:id/check-in`: Broadcasts `VISITOR_ENTRY` (line 958).
- `POST /api/visitor-passes/:id/check-out`: Broadcasts `VISITOR_EXIT` (line 997).
- `DELETE /api/visitor-passes/:id`: Broadcasts `VISITOR_PASS_DELETED` (line 1032).
- `POST /api/visitor-passes/check-overstay`: Broadcasts `VISITOR_OVERSTAY_ALERT` (line 1061).

All broadcasts are scoped to `societyId`, preventing cross-society event leakage over SSE.

### 4.2 Client Realtime Listener Lifecycle

In `VisitorPassHubPage.tsx` and `SecurityTerminalPage.tsx`:
```typescript
useEffect(() => {
  let isMounted = true;
  refreshData();

  const unsub = realtimeService.subscribe('*', (event) => {
    if (!isMounted) return;
    const topic = event?.topic || event?.type || '';
    if (!topic || topic.startsWith('VISITOR_') || topic === '*') {
      refreshData();
    }
  });

  return () => {
    isMounted = false;
    unsub();
  };
}, [currentSocietyId]);
```
- **Unsubscription Safety:** Proper cleanup function returns `unsub()` and sets `isMounted = false` to prevent memory leaks and state updates on unmounted components.
- **Infinite Loop Freedom:** `refreshData()` executes `GET /api/visitor-passes`, which produces no broadcast events. No recursion or loop occurs.
- **Audit Finding F-B1-03 (SSE Event Storm & Lack of Debouncing):** If multiple events fire simultaneously (e.g. 10 passes flagged by overstay scan), `refreshData()` is called 10 times in rapid succession without client-side debouncing, risking redundant network requests and out-of-order state settlement.

---

## 5. Dual-Path and Legacy Compatibility

### 5.1 Dual-Contract Normalization Engine

The backend (`server/src/index.ts#normalizeVisitorPass`) and frontend (`src/services/visitorService.ts#normalizePass`) provide full bidirectional normalization between Prisma relational schemas and frontend `SmartVisitorPass` interfaces:

| Prisma Relational Field | Frontend `SmartVisitorPass` Field | Transformation / Mapping Rule |
| :--- | :--- | :--- |
| `phone` | `visitorPhone` | Exact string copy |
| `passType` (`GUEST`, `CAB`, `DELIVERY`) | `category` | Preserved |
| `passType` (`FREQUENT`) | `category` (`DOMESTIC_WORKER`) | Specialized domain mapping |
| `passType` (`SERVICE`) | `category` (`SERVICE_PROVIDER`) | Specialized domain mapping |
| `status` (`PENDING`) | `status` (`EXPECTED`) | Aliased for UI badge display |
| `status` (`CANCELLED`) | `status` (`REVOKED`) | Aliased for UI badge display |
| `validTo` (DateTime) | `validUntil` (ISO String) | Converted to ISO timestamp |
| `checkInTime` (DateTime) | `checkedInAt` (Time string) | Formatted string for UI display |
| `checkOutTime` (DateTime) | `checkedOutAt` (Time string) | Formatted string for UI display |
| `flat.flatNumber` | `flatCode` | Flattened from relational join |
| `flat.tower.name` | `towerName` | Flattened from relational join |
| `resident.name` | `residentName` | Flattened from relational join |
| `qrCodeHash` | `qrDataString` | Format: `COMMUNITYOS:<passCode>:<socId>:<flat>` |

### 5.2 Legacy Consumer UI Compilation Verification

All consuming components were audited and compiled:
- `src/pages/dashboard/resident/VisitorPassHubPage.tsx`
- `src/pages/dashboard/security/SecurityTerminalPage.tsx`
- `src/components/guard/verification/PassVerification.tsx`
- `src/components/dev/DeveloperDatabaseStudio.tsx`
- `src/pages/dashboard/admin/DeliveryIntelligencePage.tsx`

Executing `npm run build` (`tsc -b && vite build`) succeeded with 0 errors and 0 type warnings.

---

## 6. Test Suite Coverage and Rigor

### 6.1 Test Execution Results

All 17 test suites and 275 tests passed:
- `tests/issue06_visitor_pass_api.test.ts`: **16 passed**
- `tests/issue06_visitor_pass_routes.test.ts`: **17 passed**
- Regression suites (ISSUE-02, 03, 04, 05, routes): **242 passed**
- **Total: 275 / 275 tests passed.**

### 6.2 Audit Finding F-B1-05 (Route Handlers Tested via In-Test Mock Blocks Rather Than Express Router)

Inspection of `tests/issue06_visitor_pass_routes.test.ts` reveals a critical testing architecture defect:
```typescript
// tests/issue06_visitor_pass_routes.test.ts lines 59-72
test('Rejects request with missing visitorName with HTTP 400 (INVALID_VISITOR_NAME)', async () => {
  mockReq.body = { visitorPhone: '+919876543210' };

  // Validation logic directly in test body:
  const visitorName = String(mockReq.body.visitorName || '').trim();
  if (!visitorName) {
    mockRes.status(400).json({ error: 'Visitor name is required', code: 'INVALID_VISITOR_NAME' });
  }

  expect(mockRes.statusCode).toBe(400);
  expect(mockRes.jsonPayload.code).toBe('INVALID_VISITOR_NAME');
});
```
The test suite **does not import `app` from `server/src/index.ts`** and does not use `supertest(app)`. Instead, it duplicates the validation and business logic blocks inside the test methods.
While this confirms that the algorithmic logic is mathematically sound, **it does not test Express router mounting, URL parameter resolution, or actual middleware execution (`authenticateToken`, `requireRole`) on the server**.
This is a high-priority QA finding that must be addressed before closing Phase B.1.

---

## 7. Scope Boundary Enforcement

A complete Git status and diff audit was performed across the repository:
1. **Visitor Pass Scope:** Only visitor pass services, apiClient endpoints, server visitor pass routes, consumer pages, and visitor pass tests were modified.
2. **Untouched Workflows:** No changes were made to Parcel / Delivery workflows (`src/services/parcelService.ts`), Amenity bookings (`src/services/amenityService.ts`), Maintenance tickets, or Vehicle RFID tracking.
3. **No Phase B.2 / B.3 Premature Work:** Phase B.2 (Delivery & Parcel Authoritative API) and Phase B.3 (Amenity & Facility Authoritative API) remain untouched.

---

## 8. Final Verdict and Required Remediation Steps

### Final Verdict: CONDITIONAL PASS — SPECIFIC CORRECTIONS REQUIRED

The implementation successfully establishes PostgreSQL backend APIs as the primary authoritative source for Visitor Pass creation, retrieval, updates, revocation, check-in, check-out, and verification. Mutating frontend actions strictly await server responses, preventing optimistic cache drift.

However, full sign-off cannot be granted until the following 5 findings are addressed:

1. **Remediate F-B1-01 (Fail-Closed Tenant Isolation):** Update `server/src/index.ts` lines 719, 849, 935, 977, 1015 to reject if `req.societyId` is missing for non-admins (`!req.societyId || pass.societyId !== req.societyId`).
2. **Remediate F-B1-04 (Offline Gate Validation Indicator):** Add `isOffline?: boolean` and `source: 'authoritative' | 'cached'` to `PassValidationResult` in `src/types/visitor.ts` and set `isOffline: true` in `validatePassCodeSync`, updating the UI to warn guards when operating in offline fallback mode.
3. **Remediate F-B1-05 (Express Router Supertest Integration):** Refactor `tests/issue06_visitor_pass_routes.test.ts` or add an integration suite that invokes the actual Express `app` via `supertest` to test actual HTTP requests, status codes, and middleware chains.
4. **Remediate F-B1-03 (Client-side Realtime Debouncing):** Add a 300ms debounce to `refreshData()` in `VisitorPassHubPage.tsx` and `SecurityTerminalPage.tsx` to handle rapid burst SSE events gracefully.
5. **Acknowledge Host Port 5432 Conflict:** Formal live PostgreSQL validation remains deferred until an isolated test PostgreSQL port or container is provisioned without disturbing `nexus-postgres`.

