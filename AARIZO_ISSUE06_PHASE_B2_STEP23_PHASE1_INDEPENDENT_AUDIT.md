# AARIZO — ISSUE-06 Phase B.2.3 — Phase 1 Independent Verification Audit

**Audit Date:** 2026-11-18  
**Audit Scope:** Phase 1 — Canonical Child Safety API Client (`src/services/apiClient.ts`), DTO Contracts (`src/types/childSafety.ts`), Focused Tests (`tests/issue06_b23_api_client.test.ts`), and Backend Contract Parity (`server/src/childSafety/router.ts`, `server/src/childSafety/validation.ts`)  
**Audit Mode:** Strictly Read-Only (zero changes to source code, tests, schema, migrations, env, or config)  
**Final Verdict:** **`PHASE 1 INDEPENDENT AUDIT — CONDITIONAL PASS, TARGETED FIXES REQUIRED`**

---

## 1. Executive Summary

Independent line-by-line inspection of Phase 1 confirms a well-structured strict transport layer (`ApiError`, `apiRequestStrict<T>()`) and accurate URL/method alignment across all 20 implemented Child Safety strict methods (covering all 19 distinct logical routes plus the `DELETE` pickup archive alias), with **100% backward compatibility** for unrelated `apiClient` consumers and zero TypeScript/Vite build regressions.

However, independent security and contract verification identified **four confirmed targeted defects (`F-P1-01` through `F-P1-04`)**, **one low-severity contract/validator precision item (`F-P1-05`)**, and **targeted missing test coverage (`F-P1-06`)** that should be remediated before approving Phase 2.

---

## 2. Summary of Findings

| Finding ID | Severity | Category | File & Lines | Summary |
| :--- | :--- | :--- | :--- | :--- |
| **F-P1-01** | **HIGH** | Sensitive Data / Validator | `src/services/apiClient.ts#L367-L390` | `isChildGatePassDto` blocks `tokenHash` but **does NOT reject unexpected `bearerToken` or `qrPayload`** on ordinary pass reads (`getChildPassesStrict`, `getChildPassByIdStrict`, `revokeChildPassStrict`, `verifyChildPassStrict`). |
| **F-P1-02** | **MEDIUM-HIGH** | Error Payload Sanitization | `src/services/apiClient.ts#L56-L67`, `#L208-L224` | `sanitizeErrorPayload()` is **shallow-only** (nested objects are copied verbatim without stripping secret keys or sanitizing strings), **case-sensitive** on key names, does not sanitize `message`, and hardcodes `(500, 'SERVER_ERROR')` when sanitizing `clean.error`. |
| **F-P1-03** | **MEDIUM** | Concurrent Auth Race | `src/services/apiClient.ts#L565-L570` | `401` handler unconditionally calls `clearAuthSession()` and dispatches `aarizo:unauthorized` without checking `getAuthToken() === token`, allowing a delayed stale-token `401` to wipe a newly established login session and causing duplicate `aarizo:unauthorized` storms on parallel `401` responses. |
| **F-P1-04** | **MEDIUM** | Transport & Input Guard Hardening | `src/services/apiClient.ts#L254-L276`, `#L489-L498` | (a) `extraHeaders` processing ignores `Headers` instances and `string[][]` tuples (valid `HeadersInit` inputs). (b) `assertNoForbiddenRawIdFields` uses case-sensitive key lookup (`FORBIDDEN_RAW_ID_FIELDS.has(key)`), missing casing variants like `IdProofNumber` or `AADHAAR`. |
| **F-P1-05** | **LOW** | Backend Contract Precision & Enum Validation | `src/services/apiClient.ts#L329-L446`, `#L836-L901`, `#L1084-L1094` | (a) Three request fields (`GET /:childId/pickups?includeArchived`, `POST /alerts/:id/acknowledge { notes }`, `POST /:id/archive` & `revokePickup { reason }`) are accepted by the frontend client but ignored by the backend router — callers must not assume persistence. (b) DTO validators check enum fields with `isNonEmptyStringValue` rather than Prisma enum membership, and `isChildGatePassDto` does not validate nested `child` summary if present. |
| **F-P1-06** | **MEDIUM** | Test Coverage Gaps | `tests/issue06_b23_api_client.test.ts` | Missing focused tests for: ordinary pass read rejecting `bearerToken`/`qrPayload`, recursive nested error payload sanitization, concurrent/stale `401` race, timeout (`AbortError`), URL path-encoding injection, `Headers`/tuple header stripping, `Retry-After` HTTP-date parsing, and full request-body assertions across all 20 endpoints. |

---

## 3. Confirmed Passes

1. **Strict Error Propagation (`src/services/apiClient.ts#L459-L604`):** `apiRequestStrict<T>()` never converts HTTP `4xx`/`5xx`, network failures, timeouts, malformed JSON, empty 2xx bodies, or schema mismatches into `null`, `undefined`, or fake success objects.
2. **Canonical Bearer Token & No Spoofed Identity Headers (`#L465-L498`):** Token is read exclusively via `getAuthToken()` (`src/services/authStorage.ts`); missing token fails fast with `401 AUTH_TOKEN_MISSING` prior to `fetch`; plain-object caller-supplied `Authorization`, `x-society-id`, `x-user-id`, and `x-user-role` are stripped.
3. **403 Session Preservation (`#L565-L570`):** HTTP `403` does NOT clear the active session or fire `aarizo:unauthorized`.
4. **No Automatic Retries on Non-Idempotent Mutations:** Confirmed single `fetch()` invocation across all error/timeout/429/503 paths.
5. **Exact Gate Verification Contract (`#L993-L1033`, `#L408-L416`):** Matches `server/src/childSafety/router.ts#L824-L875` verbatim: `200` `{ authorized: true, outcome: 'ALLOWED', pass, exitLog }`, `409` denial codes (`CHILD_MISSING_ALERT_BLOCKED`, `PASS_ALREADY_CONSUMED`, `PASS_EXPIRED`, `PASS_REVOKED`, `PICKUP_PERSON_UNAUTHORIZED`), `422` policy codes (`PASS_NOT_YET_VALID`, `ESCORT_REQUIRED`), `400 BEARER_TOKEN_REQUIRED` (rejecting empty or `CGP-*` passCode-only inputs), and `503 BACKEND_UNAVAILABLE` (`outcome: 'VERIFICATION_UNAVAILABLE'`, `isFailClosedUnavailable === true`).
6. **Direct-DTO Backend Parity:** Correctly verified and implemented direct-DTO responses (rather than wrapped objects) for `archiveChildStrict`, `revokeChildPickupStrict`, `archiveChildPickupStrict`, `revokeChildPassStrict`, `acknowledgeChildAlertStrict`, and `resolveChildAlertStrict`.
7. **Zero Regressions to Legacy `apiClient`:** Legacy `apiRequest<T>()` and all unrelated methods (`checkHealth`, `getFlats`, `getResidents`, `getVisitorPasses`, etc.) plus deprecated Child Safety stubs remain 100% intact.
8. **Scope Discipline:** Zero Phase 2–8 changes (no SSE edits, no `AuthContext` edits, no store consolidation, no portal cutovers, no Prisma/backend/env changes, no commits/pushes).

---

## 4. Independent Re-Verification Results

| Verification Check | Command | Exact Observed Result |
| :--- | :--- | :--- |
| **Focused Phase 1 + Auth + Visitor API Suites** | `npx jest tests/issue06_b23_api_client.test.ts tests/issue03_auth_storage_consistency.test.ts tests/issue06_visitor_pass_api.test.ts --silent` | **3 passed, 0 failed** (`73/73` tests passed: `27` Phase 1 + `22` Auth Storage + `24` Visitor Pass API) |
| **Full Offline Jest Suite** *(from Phase 1 verification run; source unchanged since)* | `npm test` | **22 passed, 0 failed, 2 skipped** (`390` passed, `11` skipped live PG 16 tests requiring `AARIZO_ISOLATED_TEST_DATABASE_URL`, `401` total) |
| **Frontend Production Build** | `npm run build` (`tsc -b && vite build`) | **PASS** (exit code `0`, 0 TypeScript/Vite errors) |

---

## 5. Acceptance Criteria Assessment & Path to Full PASS

Phase 1 satisfies the core architecture, endpoint routing, backward-compatibility, and build gates, **but does not yet clear full Phase 1 closure** until targeted remediation fixes **`F-P1-01`, `F-P1-02`, `F-P1-03`, `F-P1-04`**, documents/tightens **`F-P1-05`**, and closes the missing test cases in **`F-P1-06`**.

**Verdict:** **`PHASE 1 INDEPENDENT AUDIT — CONDITIONAL PASS, TARGETED FIXES REQUIRED`**

