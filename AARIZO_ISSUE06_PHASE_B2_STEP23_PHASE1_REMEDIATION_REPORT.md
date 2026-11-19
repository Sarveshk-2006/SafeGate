# AARIZO — ISSUE-06 Phase B.2.3 — Phase 1 Targeted Remediation Report

**Remediation Date:** 2026-11-18  
**Audit Remediated:** `AARIZO_ISSUE06_PHASE_B2_STEP23_PHASE1_INDEPENDENT_AUDIT.md` (`CONDITIONAL PASS, TARGETED FIXES REQUIRED`)  
**Findings Addressed:** `F-P1-01`, `F-P1-02`, `F-P1-03`, `F-P1-04`, `F-P1-05`, `F-P1-06`  
**Scope:** Strictly Phase 1 (`src/services/apiClient.ts`, `src/types/childSafety.ts`, `tests/issue06_b23_api_client.test.ts`). Zero Phase 2–8 changes, zero backend/Prisma/env changes, zero commits/pushes.  
**Verdict:** **`PHASE 1 REMEDIATION COMPLETE — READY FOR INDEPENDENT RE-AUDIT`**

---

## 1. Finding-by-Finding Remediation Details

### F-P1-01 — Strict Pass DTO Boundaries (HIGH)
- **Original Defect:** `isChildGatePassDto` blocked `tokenHash` but did not reject unexpected `bearerToken` or `qrPayload` fields on ordinary pass reads (`getChildPassesStrict`, `getChildPassByIdStrict`, `revokeChildPassStrict`, `verifyChildPassStrict`).
- **Root Cause:** `isChildGatePassCreatedDto` reused `isChildGatePassDto` directly, so `isChildGatePassDto` could not forbid `bearerToken`/`qrPayload` without breaking pass creation.
- **Exact Code Changes (`src/services/apiClient.ts`):**
  - Introduced internal `isChildGatePassBase(val)` validating core pass fields, exact `ALLOWED_GATE_PASS_STATUS_SET` enum, optional `child` summary (`isChildGatePassChildSummaryDto`), and strictly rejecting `'tokenHash' in val`.
  - Tightened `isChildGatePassDto(val)` to require `isChildGatePassBase(val) && !('bearerToken' in val) && !('qrPayload' in val)` for all ordinary pass read/revoke/verify paths.
  - Updated `isChildGatePassCreatedDto(val)` to require `isChildGatePassBase(val) && isNonEmptyStringValue(val.bearerToken) && isNonEmptyStringValue(val.qrPayload)` exclusively on `POST /api/children/passes`, never passing successful creation responses through error sanitization.
- **Tests Added (`tests/issue06_b23_api_client.test.ts`):** Positive pass-creation preservation test (`bearerToken` + `qrPayload` intact), negative missing-`bearerToken` and leaked-`tokenHash` creation tests, and negative ordinary-read rejection tests across `getChildPassesStrict`, `getChildPassByIdStrict`, `revokeChildPassStrict`, and `verifyChildPassStrict`.
- **Verification Results:** All pass boundary tests pass (`42/42` in `issue06_b23_api_client.test.ts`).
- **Residual Limitations:** None.

---

### F-P1-02 — Recursive Error Payload Sanitization (MEDIUM-HIGH)
- **Original Defect:** `sanitizeErrorPayload` was shallow-only (nested objects/arrays copied verbatim), used case-sensitive key matching, left `message` unsanitized, and hardcoded `(500, 'SERVER_ERROR')` when sanitizing `clean.error`.
- **Root Cause:** Initial sanitizer only iterated top-level `Object.entries(raw)` with a case-sensitive `Set` and did not accept the HTTP `status` and `kind`.
- **Exact Code Changes (`src/services/apiClient.ts`):**
  - Replaced `SENSITIVE_ERROR_PAYLOAD_KEYS` with lowercase `SENSITIVE_ERROR_PAYLOAD_KEYS_LOWER` covering credentials, tokens, hashes, authorization headers, secrets, JWTs, stack/SQL/query fields, and all `FORBIDDEN_RAW_ID_FIELDS_LOWER`.
  - Implemented recursive `sanitizeErrorValue(value, status, kind, seen, depth, keyLower)` and `sanitizeErrorPayload(raw, status, kind)`:
    - Recursively traverses nested objects and arrays with `WeakSet` circular-reference protection, bounded depth (`MAX_ERROR_PAYLOAD_DEPTH = 6`), bounded object keys (`50`), and bounded array items (`50`).
    - Normalizes every key via `key.toLowerCase()` before stripping sensitive fields.
    - Sanitizes `error` and `message` strings using the actual HTTP `(status, kind)` fallback, and redacts any other nested string matching `UNSAFE_MESSAGE_PATTERNS` (`SQL`, `prisma.`, stack traces, `Bearer ...`, `AARIZO_CHILD_PASS:...`, 64-hex tokens, `DATABASE_URL`) to `'[REDACTED]'`.
    - Preserves safe backend error codes (`code`, `outcome`, `verificationChannel`, safe `exitLog` metadata).
    - Never invoked on `2xx` responses.
- **Tests Added (`tests/issue06_b23_api_client.test.ts`):** Comprehensive recursive sanitization test with mixed-case nested keys (`Authorization`, `TokenHash`, `BearerToken`, `IdProofNumber`, `AADHAAR`, `Secret`), nested unsafe SQL/Prisma/stack/Bearer strings, 409-accurate fallback message verification, safe code/outcome preservation, oversized 80-item array bounding, and 10-level deep nesting truncation.
- **Verification Results:** Pass.
- **Residual Limitations:** Circular JS objects cannot be produced by `JSON.parse()` on HTTP text bodies; the `WeakSet` guard provides defense-in-depth if `sanitizeErrorValue` is ever reused on in-memory objects.

---

### F-P1-03 — Race-Safe HTTP 401 Handling (MEDIUM)
- **Original Defect:** `apiRequestStrict` unconditionally cleared `authStorage` and dispatched `aarizo:unauthorized` on every `401`, risking a delayed stale-token `401` wiping a newly logged-in session and causing duplicate event storms on parallel `401` responses.
- **Root Cause:** The `401` handler did not compare the request's captured token against the current `getAuthToken()` stored in `authStorage`.
- **Exact Code Changes (`src/services/apiClient.ts`):**
  - Captured `const requestToken = getAuthToken()` at request start.
  - Guarded `401` session invalidation with `if (status === 401 && !normalizedEndpoint.includes('/auth/login') && getAuthToken() === requestToken)`.
  - First `401` for the active token clears `authStorage` (`getAuthToken()` becomes `null`) and emits `aarizo:unauthorized` once; concurrent sibling `401`s and delayed stale-token `401`s after a fresh login no longer clear the session or re-dispatch the event, while legitimate `401`s on the new token still expire the new session normally.
- **Tests Added (`tests/issue06_b23_api_client.test.ts`):** Current-token `401`, 4 simultaneous `401` responses emitting exactly 1 `aarizo:unauthorized` event, delayed stale-token `401` after fresh login preserving new session + fresh request succeeding + subsequent fresh-token `401` properly invalidating.
- **Verification Results:** Pass.
- **Residual Limitations:** None (uses canonical `authStorage` exclusively).

---

### F-P1-04 — Header & Raw-ID Normalization (MEDIUM)
- **Original Defect:** (a) Caller-supplied `extraHeaders` stripping only iterated plain objects and silently ignored `Headers` instances and `[string, string][]` tuple arrays. (b) `assertNoForbiddenRawIdFields` used case-sensitive key matching.
- **Root Cause:** Plain-object `Object.entries` assumption for `HeadersInit` and unnormalized `Set.has(key)` check.
- **Exact Code Changes (`src/services/apiClient.ts`):**
  - Added `normalizeCallerHeaders(extraHeaders?: HeadersInit)` supporting `Headers` instances (via `.forEach`), tuple arrays (`Array.isArray`), and plain objects, stripping `BLOCKED_CALLER_HEADERS_LOWER` (`authorization`, `x-society-id`, `x-user-id`, `x-user-role`) case-insensitively across all three while preserving legitimate custom headers.
  - Normalized `FORBIDDEN_RAW_ID_FIELDS_LOWER` and updated `assertNoForbiddenRawIdFields` to match `key.toLowerCase()` recursively across objects and nested arrays while preserving legitimate `idDocumentType` + `idDocumentLast4` (1–4 chars).
- **Tests Added (`tests/issue06_b23_api_client.test.ts`):** Plain object, `Headers` instance, and tuple-array stripping tests (verifying legitimate `X-Correlation-Id` / `X-Request-Id` preserved); mixed-case raw-ID tests (`IdProofNumber`, nested `AADHAAR`, `PAN_NUMBER`); valid `idDocumentLast4` acceptance.
- **Verification Results:** Pass.
- **Residual Limitations:** None.

---

### F-P1-05 — Backend Contract Accuracy & Prisma Enum Validation (LOW)
- **Original Defect:** Four frontend request fields/parameters (`GET /:childId/pickups?includeArchived`, `POST /:id/archive { reason }`, `POST /:childId/pickups/:pickupId/revoke { reason }`, `POST /alerts/:id/acknowledge { notes }`) were accepted by the client despite being ignored by `server/src/childSafety/router.ts`, and DTO validators checked enum fields only as non-empty strings without validating optional `pass.child` summary.
- **Root Cause:** Earlier audit contracts assumed optional metadata parameters not implemented in the B.2.2 backend router, and initial validators used generic `isNonEmptyStringValue` checks.
- **Exact Code Changes (`src/types/childSafety.ts`, `src/services/apiClient.ts`):**
  - Removed backend-ignored request interfaces (`ArchiveChildProfileRequest`, `ListChildPickupsParams`, `RevokePickupRequest`, `AcknowledgeChildAlertRequest`) and updated `archiveChildStrict(id)`, `getChildPickupsStrict(childId)`, `revokeChildPickupStrict(childId, pickupId)`, and `acknowledgeChildAlertStrict(id)` to send no misleading query params or body payloads.
  - Preserved `RevokeChildGatePassRequest { reason?: string }` on `revokeChildPassStrict` because backend `server/src/childSafety/router.ts#L988` persists `revocationReason`.
  - Added exact Prisma enum membership sets (`ALLOWED_CHILD_GENDER_SET`, `ALLOWED_CHILD_STATUS_SET`, `ALLOWED_EXIT_PERMISSION_MODE_SET`, `ALLOWED_PICKUP_STATUS_SET`, `ALLOWED_PICKUP_ID_VERIFICATION_STATUS_SET`, `ALLOWED_GATE_PASS_STATUS_SET`, `ALLOWED_EXIT_OUTCOME_SET`, `ALLOWED_VERIFICATION_CHANNEL_SET`, `ALLOWED_ALERT_TYPE_SET`, `ALLOWED_ALERT_STATUS_SET`, `ALLOWED_INCIDENT_SEVERITY_SET`) to all DTO validators.
  - Added `isChildGatePassChildSummaryDto` validation for optional `pass.child`.
- **Tests Added (`tests/issue06_b23_api_client.test.ts`):** Exact Prisma enum rejection tests across child, pickup, pass, exit log, and alert DTOs; malformed `pass.child` rejection; assertions that `archiveChildStrict`, `getChildPickupsStrict`, `revokeChildPickupStrict`, and `acknowledgeChildAlertStrict` send zero ignored query/body fields.
- **Verification Results:** Pass.
- **Residual Limitations:** None (backend routes and Prisma schema remain untouched).

---

### F-P1-06 — Regression Test Completion (MEDIUM)
- **Original Defect:** 8 targeted test gaps identified in `AARIZO_ISSUE06_PHASE_B2_STEP23_PHASE1_TEST_COVERAGE_REVIEW.md`.
- **Exact Code Changes (`tests/issue06_b23_api_client.test.ts`):** Expanded from 27 to **42 real behavioral tests** covering all 8 previously missing areas (ordinary pass credential rejection, recursive nested error sanitization, concurrent/stale `401` handling, `AbortError` request timeout, URL path traversal encoding, `Headers`/tuple header stripping, `Retry-After` HTTP-date parsing, exact request body assertions across all mutating endpoints, all 8 documented gate verification denial codes + `503`, Prisma enum & `pass.child` validation, non-ignored backend fields, and legacy compatibility).
- **Verification Results:** **42/42 passed**; **88/88** across focused + auth + visitor suites; **405/405** executed offline tests passed (`11` live PG 16 tests skipped in offline run); `npm run build` passed cleanly.
- **Residual Limitations:** Live PostgreSQL 16 end-to-end tests remain scheduled for Phase 8 per approved plan (offline Jest skips the 2 live PG suites when `AARIZO_ISOLATED_TEST_DATABASE_URL` is unset).

---

## 2. Final Verification Summary

| Check | Result | Details |
| :--- | :---: | :--- |
| `npx jest tests/issue06_b23_api_client.test.ts tests/issue03_auth_storage_consistency.test.ts tests/issue06_visitor_pass_api.test.ts` | **PASS** | **3/3 suites, 88/88 tests passed** (`42` Phase 1 + `22` Auth Storage + `24` Visitor Pass API) |
| `npm test` (full offline Jest suite) | **PASS** | **22/22 executed suites, 405 passed, 0 failed** (`2` live PG 16 suites / `11` tests skipped — `AARIZO_ISOLATED_TEST_DATABASE_URL` not set in offline run) |
| `npm run build` (`tsc -b && vite build`) | **PASS** | Exit code `0`, 2,179 modules transformed, built in 2.06s |
| Scope & Git Hygiene | **PASS** | Only `src/types/childSafety.ts`, `src/services/apiClient.ts`, `tests/issue06_b23_api_client.test.ts`, and these 2 remediation reports touched; Phases 2–8 not started; zero commits/pushes |

---

**PHASE 1 REMEDIATION COMPLETE — READY FOR INDEPENDENT RE-AUDIT**

