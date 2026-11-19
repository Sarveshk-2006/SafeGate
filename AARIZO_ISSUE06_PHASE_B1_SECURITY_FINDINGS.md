# AARIZO — ISSUE-06, Phase B.1: Security & Quality Findings Register

**Document Version:** 1.0.0  
**Audit Date:** 2026-11-17  
**Scope:** ISSUE-06 Phase B.1 (Visitor Pass Authoritative API & State Synchronization)  
**Parent Issue:** ISSUE-06 — Tri-Tier State Desynchronization (Master Issue Register P1)  

---

## Findings Summary

| Finding ID | Severity | Category | Target File(s) & Lines | Title | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **F-B1-01** | **Medium** | Security / Authorization | `server/src/index.ts#L719, L849, L935, L977, L1015` | Tenant isolation check fails open if `req.societyId` is undefined | Open |
| **F-B1-02** | **Low** | Architecture / Middleware | `server/src/index.ts#L659-1080` | Route-level tenant checks implemented inline rather than composing `requireSocietyMembership` | Open |
| **F-B1-03** | **Low** | Performance / Scalability | `server/src/index.ts#L1094-1108` | Pass verification performs in-memory linear search instead of indexed database query | Open |
| **F-B1-04** | **Medium** | Security / Operational State | `src/services/visitorService.ts#L358-377` | Offline gate validation fallback lacks `isOffline` indicator, masking provisional validation | Open |
| **F-B1-05** | **High** | Quality / Test Rigor | `tests/issue06_visitor_pass_routes.test.ts#L59-349` | Route unit test suite tests duplicated local logic blocks instead of Express router / supertest | Open |
| **F-B1-06** | **Low** | Concurrency / Frontend | `src/pages/dashboard/resident/VisitorPassHubPage.tsx#L85-93`, `SecurityTerminalPage.tsx#L145-153` | Realtime SSE subscriber triggers un-debounced concurrent fetch requests on rapid event bursts | Open |
| **F-B1-07** | **Operational** | Test Environment | Host Port 5432 / `nexus-postgres` | Live PostgreSQL integration testing deferred due to host port 5432 conflict | Documented Limitation |

---

## Detailed Finding Analysis

### Finding F-B1-01: Tenant Isolation Check Fails Open When Society ID Is Undefined

- **Finding ID:** `F-B1-01`
- **Severity:** **Medium**
- **CWE:** CWE-285 (Improper Authorization) / CWE-636 (Not Failing Securely)
- **File & Line Numbers:** `server/src/index.ts` lines 719, 849, 935, 977, 1015
- **Description:**
  In all visitor pass mutation and retrieval routes, the tenant boundary is checked using the following pattern:
  ```typescript
  // server/src/index.ts line 719, 849, 935, 977, 1015
  if (req.userRole !== 'admin' && req.societyId && pass.societyId !== req.societyId) {
    return res.status(403).json({
      error: 'Access denied: Resource belongs to another society',
      code: 'TENANT_ISOLATION_VIOLATION'
    });
  }
  ```
  Notice the second condition: `req.societyId`.
  If a JWT is parsed or a session exists where `req.societyId` is `undefined`, `null`, or an empty string, the expression `req.societyId && ...` evaluates to falsy (`undefined`). Consequently, the entire `if` statement evaluates to `false`, and execution proceeds without enforcing society ownership!
- **Reproduction Scenario:**
  1. An authenticated non-admin user presents a valid JWT token that lacks an explicit `societyId` claim (e.g. legacy token, system user token, or external federated identity without society linkage).
  2. The user sends a request to `GET /api/visitor-passes/:id` or `POST /api/visitor-passes/:id/check-in` targeting a pass belonging to `soc-other`.
  3. Because `req.societyId` is `undefined`, the tenant guard is skipped, allowing cross-society inspection or mutation.
- **Actual Impact:**
  Non-admin users with incompletely provisioned tokens could bypass multi-tenant isolation and access or modify visitor passes belonging to foreign housing societies.
- **Defect vs. Operational Limitation:** **Defect**.
- **Recommended Minimal Correction:**
  Harden the tenant guard to fail closed:
  ```typescript
  if (req.userRole !== 'admin' && (!req.societyId || pass.societyId !== req.societyId)) {
    return res.status(403).json({
      error: 'Access denied: Tenant isolation enforced',
      code: 'TENANT_ISOLATION_VIOLATION'
    });
  }
  ```

---

### Finding F-B1-02: Route-Level Tenant Checks Implemented Inline Rather Than via Middleware

- **Finding ID:** `F-B1-02`
- **Severity:** **Low**
- **CWE:** CWE-1061 (Insufficient Encapsulation)
- **File & Line Numbers:** `server/src/index.ts` lines 659–1080
- **Description:**
  `server/src/auth.ts` already provides a centralized `requireSocietyMembership` middleware:
  ```typescript
  // server/src/auth.ts L360-377
  export const requireSocietyMembership = (req: Request, res: Response, next: NextFunction) => {
    ...
  };
  ```
  However, in Phase B.1, the visitor pass endpoints in `server/src/index.ts` do not mount this middleware. Instead, each individual route handler re-implements tenant checking logic inline. While inline checks are functional, having redundant inline checks across 6 endpoints increases the probability of subtle divergence (as seen in F-B1-01).
- **Reproduction Scenario:** N/A (Code hygiene / architectural consistency).
- **Actual Impact:** Maintenance overhead and risk of future developer error when adding new routes.
- **Defect vs. Operational Limitation:** **Architectural Gap**.
- **Recommended Minimal Correction:**
  Standardize tenant checking via centralized middleware or a shared tenant assertion helper function: `assertTenantAccess(req, resourceSocietyId)`.

---

### Finding F-B1-03: Pass Verification Endpoint Uses In-Memory Linear Search

- **Finding ID:** `F-B1-03`
- **Severity:** **Low**
- **CWE:** CWE-400 (Uncontrolled Resource Consumption) / CWE-770 (Allocation of Resources Without Limits)
- **File & Line Numbers:** `server/src/index.ts` lines 1094–1116
- **Description:**
  In `POST /api/visitor-passes/verify`, the endpoint executes:
  ```typescript
  const passes = await prisma.visitorPass.findMany({
    where,
    include: {
      resident: true,
      flat: true,
    },
  });

  const matched = passes.find(p =>
    p.id.toUpperCase() === clean ||
    p.id.toUpperCase() === `PASS-${clean}` ||
    (p.qrCodeHash && p.qrCodeHash.toUpperCase().includes(clean)) ||
    p.id.toUpperCase().endsWith(clean) ||
    p.phone.includes(clean)
  );
  ```
  Instead of utilizing PostgreSQL database indexes via an indexed query (`findFirst` or parameterized `WHERE` clause), the backend loads **all visitor passes in the entire society** into Node.js heap memory and iterates over them with `Array.prototype.find`.
- **Reproduction Scenario:**
  1. A large housing society accumulates 50,000 visitor pass records over time.
  2. A security guard scans a QR code at the main gate.
  3. The backend executes `SELECT * FROM visitor_passes WHERE society_id = '...'` pulling 50,000 records, deserializing them into JavaScript objects, and performing string matching in Node.js.
  4. Response latency spikes to hundreds of milliseconds, and Node.js process memory increases dramatically.
- **Actual Impact:** High latency and potential denial of service under high gate traffic in large societies.
- **Defect vs. Operational Limitation:** **Performance Defect**.
- **Recommended Minimal Correction:**
  Refactor query to leverage Prisma `findFirst`:
  ```typescript
  const matched = await prisma.visitorPass.findFirst({
    where: {
      societyId: where.societyId,
      OR: [
        { id: { equals: clean, mode: 'insensitive' } },
        { id: { equals: `PASS-${clean}`, mode: 'insensitive' } },
        { qrCodeHash: { contains: clean, mode: 'insensitive' } },
        { phone: { contains: clean } },
      ],
    },
    include: { resident: true, flat: true },
  });
  ```

---

### Finding F-B1-04: Offline Gate Pass Validation Lacks `isOffline` Indicator

- **Finding ID:** `F-B1-04`
- **Severity:** **Medium**
- **CWE:** CWE-345 (Insufficient Verification of Data Authenticity)
- **File & Line Numbers:** `src/services/visitorService.ts` lines 358–377
- **Description:**
  In `src/services/visitorService.ts`, `validatePassCode` attempts authoritative server verification first. If network connectivity fails, it catches the error and executes `validatePassCodeSync(societyId, codeOrQr)` against local storage:
  ```typescript
  try {
    const serverResult = await apiClient.verifyVisitorPass(cleanCode, societyId);
    if (serverResult) { ... }
  } catch (err) {
    console.warn('[visitorService] Server verification failed, falling back to local cache:', err);
  }

  // 3. Local Cache Fallback (if server is offline)
  return visitorService.validatePassCodeSync(societyId, codeOrQr);
  ```
  `validatePassCodeSync` checks local storage and returns `{ isValid: true, pass }`.
  However, `PassValidationResult` (`src/types/visitor.ts`) does not include an `isOffline` or `isProvisional` field. The returned result object is indistinguishable from an authoritative server confirmation.
- **Reproduction Scenario:**
  1. Resident Vikram revokes pass `GVS-9912` from his mobile phone via `revokePass()` while connected to mobile cellular data. The PostgreSQL database updates status to `CANCELLED`.
  2. The gate security terminal experiences an intermittent Wi-Fi outage.
  3. The visitor presents pass `GVS-9912` at the security gate.
  4. `apiClient.verifyVisitorPass()` throws a network error.
  5. `validatePassCode()` silently falls back to local storage cache (where the pass still appears valid as `APPROVED` before revocation was downloaded).
  6. The terminal displays a green "Valid Pass" confirmation. The guard admits the revoked visitor without any warning that the check was performed offline against stale cache.
- **Actual Impact:** Physical security vulnerability during gate network disruptions. Revoked passes may be accepted.
- **Defect vs. Operational Limitation:** **Security Defect**.
- **Recommended Minimal Correction:**
  1. Add `isOffline?: boolean` and `source?: 'authoritative' | 'offline_cache'` to `PassValidationResult`.
  2. In `validatePassCodeSync`, return `{ isValid: true, isOffline: true, source: 'offline_cache', pass }`.
  3. In `PassVerification.tsx` and `SecurityTerminalPage.tsx`, render an amber warning banner: `"⚠️ VERIFIED VIA OFFLINE CACHE — Server unreachable. Verify visitor identity manually."`

---

### Finding F-B1-05: Route Test Suite Tests Local Mock Blocks Instead of Express Router

- **Finding ID:** `F-B1-05`
- **Severity:** **High** (QA / Testing Rigor)
- **CWE:** CWE-1077 (Improper Testing)
- **File & Line Numbers:** `tests/issue06_visitor_pass_routes.test.ts` lines 59–349
- **Description:**
  The test suite `tests/issue06_visitor_pass_routes.test.ts` claims to verify the route handlers in `server/src/index.ts`.
  However, examining the test implementation reveals that it **never imports `app` or invokes any function from `server/src/index.ts`**.
  Instead, the author copied the validation if-statements into the Jest `test()` closures:
  ```typescript
  // tests/issue06_visitor_pass_routes.test.ts lines 59-71
  test('Rejects request with missing visitorName with HTTP 400 (INVALID_VISITOR_NAME)', async () => {
    mockReq.body = { visitorPhone: '+919876543210' };

    // Validation logic executed in test body:
    const visitorName = String(mockReq.body.visitorName || '').trim();
    if (!visitorName) {
      mockRes.status(400).json({ error: 'Visitor name is required', code: 'INVALID_VISITOR_NAME' });
    }

    expect(mockRes.statusCode).toBe(400);
    expect(mockRes.jsonPayload.code).toBe('INVALID_VISITOR_NAME');
  });
  ```
- **Reproduction Scenario:**
  If a developer mistakenly misspells a route parameter in `server/src/index.ts` (e.g. `app.post('/api/visitor-passess')`) or changes middleware parameters, `tests/issue06_visitor_pass_routes.test.ts` will still pass with 17/17 tests green, because the tests run independent mock code!
- **Actual Impact:** False confidence in route integration. Actual Express router registration, path matching, body parsing, and middleware chain ordering are not exercised by this suite.
- **Defect vs. Operational Limitation:** **Testing Rigor Defect**.
- **Recommended Minimal Correction:**
  Create an integration test using `supertest(app)` (or export route handler functions from a controller module) to execute HTTP requests through the actual Express route stack.

---

### Finding F-B1-06: Realtime SSE Subscriber Lacks Request Debouncing

- **Finding ID:** `F-B1-06`
- **Severity:** **Low**
- **CWE:** CWE-400 (Uncontrolled Resource Consumption)
- **File & Line Numbers:**
  - `src/pages/dashboard/resident/VisitorPassHubPage.tsx` lines 85–93
  - `src/pages/dashboard/security/SecurityTerminalPage.tsx` lines 145–153
- **Description:**
  The realtime SSE subscriber listens to all `VISITOR_*` events and calls `refreshData()` immediately:
  ```typescript
  const unsub = realtimeService.subscribe('*', (event) => {
    if (!isMounted) return;
    const topic = event?.topic || event?.type || '';
    if (!topic || topic.startsWith('VISITOR_') || topic === '*') {
      refreshData();
    }
  });
  ```
  If an overstay check flags 20 visitors, or multiple visitors check in simultaneously at multiple society gates, 20 SSE messages will arrive within milliseconds. This triggers 20 concurrent HTTP GET requests to `/api/visitor-passes`, causing network throttling and potential UI flicker.
- **Reproduction Scenario:** High-volume society gate during peak evening hours (5:00 PM – 7:00 PM).
- **Actual Impact:** Excessive client-server request load and out-of-order response race conditions.
- **Defect vs. Operational Limitation:** **Frontend Defect**.
- **Recommended Minimal Correction:**
  Wrap `refreshData` in a 300ms debounce function:
  ```typescript
  const debouncedRefresh = useMemo(() => debounce(refreshData, 300), [refreshData]);
  ```

---

### Finding F-B1-07: Live PostgreSQL Integration Validation Deferred Due to Host Port 5432 Conflict

- **Finding ID:** `F-B1-07`
- **Severity:** **Operational Limitation** (Zero Security Vulnerability in Code)
- **Target File(s):** Host environment / Docker configuration
- **Description:**
  Host port 5432 is occupied by an external, unrelated Docker container `nexus-postgres`. In accordance with safety rules, `nexus-postgres` cannot be stopped, restarted, or altered. As a result, end-to-end live database queries on port 5432 cannot be performed in this environment without provisioning an alternate port (e.g. port 5433 or an in-memory pg-mem mock).
- **Actual Impact:** While unit tests, mock integration tests, and type checking pass 100%, live SQL wire protocol execution against an active PostgreSQL daemon remains deferred.
- **Defect vs. Operational Limitation:** **Operational Limitation**.
- **Recommended Action:**
  Configure `docker-compose.dev.yml` to bind an isolated PostgreSQL test instance on port 5433 or 5434 for live end-to-end verification.

