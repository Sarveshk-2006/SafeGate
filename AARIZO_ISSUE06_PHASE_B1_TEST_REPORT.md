# AARIZO — ISSUE-06 Phase B.1 Test Report

**Target**: `ISSUE-06` — Phase B.1: Visitor Pass Authoritative API Test Results  
**Priority**: P1 (Data Integrity & Cross-Device State Consistency)  
**Date**: 2026-11-17  
**Workspace**: `D:\AAZIRA\AARIZO`  

---

## 1. Test Execution Summary

| Test Category | Suite File | Total Tests | Passed | Failed | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Visitor Pass Service & API Integration** | `tests/issue06_visitor_pass_api.test.ts` | 16 | 16 | 0 | **PASS** |
| **Visitor Pass Routes, Security & Concurrency** | `tests/issue06_visitor_pass_routes.test.ts` | 17 | 17 | 0 | **PASS** |
| **Previous Phase A Baseline Suites (15 suites)** | Multiple (Auth, Crypto, Seed, Storage, Differentiators) | 242 | 242 | 0 | **PASS** |
| **TOTAL REPOSITORY TEST SUITE** | **17 Test Suites** | **275** | **275** | **0** | **100% PASS** |

---

## 2. Focused Visitor Pass Test Breakdown

### 2.1 Suite 1: `tests/issue06_visitor_pass_api.test.ts` (16 Tests)

* **1. Field Normalization & Compatibility Mapping**:
  - `PASS`: Maps backend relational fields (`phone`, `passType`, `validTo`) to frontend `SmartVisitorPass` contract.
  - `PASS`: Maps specialized pass categories (`FREQUENT` -> `DOMESTIC_WORKER`, `SERVICE` -> `SERVICE_PROVIDER`).
  - `PASS`: Identifies overdue / overstayed visits when current time exceeds `validTo`.
  - `PASS`: Throws meaningful error if null or undefined pass is passed to normalizer.
* **2. Authoritative visitorService Operations & Error Propagation**:
  - `PASS`: `createVisitorPass`: Awaits server confirmation and updates local storage cache.
  - `PASS`: `createVisitorPass`: Rejects immediately and does NOT produce false UI success when backend call fails.
  - `PASS`: `checkInVisitor`: Awaits server confirmation, updates status to `CHECKED_IN`, and syncs local cache.
  - `PASS`: `checkInVisitor`: Rejects and does not alter local state when server check-in fails (e.g. duplicate check-in 409).
  - `PASS`: `checkOutVisitor`: Awaits server checkout confirmation and updates local cache.
  - `PASS`: `fetchPasses`: Replaces local storage with authoritative server data.
  - `PASS`: `fetchPasses`: Falls back gracefully to local cache when server is unreachable.
* **3. Gate Code Validation & Security Guard Integration**:
  - `PASS`: `validatePassCode`: Authoritatively validates pass with backend API.
  - `PASS`: `validatePassCode`: Immediate rejection when security lockdown is active.
  - `PASS`: `validatePassCode`: Immediate rejection when visitor is on blacklist.
  - `PASS`: `validatePassCode`: Falls back to local cache when backend verification fails.
* **4. Pass Revocation & Deletion Controls**:
  - `PASS`: `revokePass`: Updates status to `CANCELLED` on backend and synchronizes cache.

---

### 2.2 Suite 2: `tests/issue06_visitor_pass_routes.test.ts` (17 Tests)

* **1. POST /api/visitor-passes Validation & Field Filtering**:
  - `PASS`: Rejects request with missing `visitorName` with HTTP 400 (`INVALID_VISITOR_NAME`).
  - `PASS`: Rejects request with missing or short phone number with HTTP 400 (`INVALID_PHONE`).
  - `PASS`: Rejects request where `validUntil` is before `validFrom` with HTTP 400 (`INVALID_VALIDITY_WINDOW`).
  - `PASS`: Derives `societyId` from authenticated `authContext` and ignores spoofed `body.societyId` for non-admins.
* **2. Multi-Tenant Scoping & Resident Ownership Isolation**:
  - `PASS`: Resident role query is scoped strictly to their own `residentId` / `userId`.
  - `PASS`: Rejects cross-society access attempt with HTTP 403 (`TENANT_ISOLATION_VIOLATION`).
  - `PASS`: Rejects resident attempting to view or modify another resident pass with HTTP 403 (`UNAUTHORIZED_PASS_ACCESS`).
* **3. Gate Operations Concurrency & Duplicate Check-In/Check-Out Protection**:
  - `PASS`: Residents are strictly forbidden from checking in visitors (HTTP 403 `OPERATION_NOT_PERMITTED`).
  - `PASS`: Check-in on an already checked-in visitor returns HTTP 409 Conflict (`ALREADY_CHECKED_IN`).
  - `PASS`: Check-in on an expired pass returns HTTP 400 Bad Request (`PASS_EXPIRED`).
  - `PASS`: Check-in on a revoked or cancelled pass returns HTTP 400 Bad Request (`INVALID_PASS_STATUS`).
  - `PASS`: Check-out of a visitor who has not checked in returns HTTP 400 Bad Request (`NOT_CHECKED_IN`).
  - `PASS`: Check-out of an already checked-out visitor returns HTTP 409 Conflict (`ALREADY_CHECKED_OUT`).
  - `PASS`: Deleting or revoking a pass while visitor is inside is blocked with HTTP 400 (`VISITOR_CURRENTLY_INSIDE`).
* **4. Gate Pass Verification Endpoint Logic**:
  - `PASS`: Verification returns 400 if passcode or QR string is empty.
  - `PASS`: Verification returns 404 if code does not match any pass.
  - `PASS`: Verification identifies active valid pass and returns valid status.

---

## 3. Mocked vs Live Integration Distinction

> [!IMPORTANT]
> In accordance with Phase 5 requirements, mocked test environments must be clearly distinguished from live database integration tests:
>
> 1. **Mocked Unit & Integration Suites**: The 33 new tests in `tests/issue06_visitor_pass_api.test.ts` and `tests/issue06_visitor_pass_routes.test.ts` execute against hermetic, deterministic mocks of `PrismaClient` and `apiClient`. They verify business logic, contract validation, error propagation, role authorization, tenant isolation, and concurrency rules without requiring an external database process.
> 2. **Live Database Integration**: As documented in Step 5.8, port 5432 on this host is currently bound to an unrelated container (`nexus-postgres`). Live end-to-end socket testing against a live PostgreSQL database requires dedicated database infrastructure and is therefore documented as an environment dependency rather than claimed as fully live-verified.

---

## 4. Build & Compilation Verification

### 4.1 Backend Compilation (`server/`)
```powershell
npm --prefix server run build
```
* **Command Output**:
  ```
  > dwellora-backend@1.0.0 build
  > tsc
  ```
* **Exit Code**: 0 (Clean compilation, zero TypeScript errors).

### 4.2 Frontend Production Compilation (`root`)
```powershell
npm run build
```
* **Command Output**:
  ```
  > dwellora@1.0.0 build
  > tsc -b && vite build

  vite v8.2.2 building client environment for production...
  transforming...
  ✓ 2179 modules transformed.
  rendering chunks...
  computing gzip size...
  dist/index.html                     1.51 kB │ gzip:   0.66 kB
  dist/assets/index-vmcbyyPA.css    144.29 kB │ gzip:  23.83 kB
  dist/assets/web-gYwTJ_Bv.js         0.76 kB │ gzip:   0.35 kB
  dist/assets/web-CTWOYPaT.js         0.89 kB │ gzip:   0.45 kB
  dist/assets/index-BacLojLV.js   2,730.76 kB │ gzip: 636.07 kB
  ✓ built in 1.12s
  ```
* **Exit Code**: 0 (Clean compilation, zero TypeScript errors).

---

## 5. Full Repository Regression Results

```
PASS tests/issue02_gap03_sse_authorization.test.ts
PASS tests/auth_middleware.test.ts
PASS tests/issue06_visitor_pass_api.test.ts
PASS tests/issue06_visitor_pass_routes.test.ts
PASS tests/razorpay.test.ts
PASS tests/issue03_step33_hardening.test.ts
PASS tests/issue02_gap01_secret_hardening.test.ts
PASS tests/route_protection.test.ts
PASS tests/issue03_auth_storage_consistency.test.ts
PASS tests/differentiators.test.ts
PASS tests/provisioning.test.ts
PASS tests/issue02_unified_auth_integration.test.ts
PASS tests/issue02_gap02_mock_auth_hardening.test.ts
PASS tests/issue02_privilege_escalation.test.ts
PASS tests/security.test.ts
PASS tests/issue04_runtime_config.test.ts
PASS tests/issue05_secure_seed_auth.test.ts

Test Suites: 17 passed, 17 total
Tests:       275 passed, 275 total
Snapshots:   0 total
Time:        20.197 s
Ran all test suites.
```

