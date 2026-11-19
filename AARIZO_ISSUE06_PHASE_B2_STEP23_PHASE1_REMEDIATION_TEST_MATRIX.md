# AARIZO — ISSUE-06 Phase B.2.3 — Phase 1 Remediation Test Matrix

**Test Suite:** `tests/issue06_b23_api_client.test.ts` (**42/42 passing**)  
**Regression Suites Executed:** `tests/issue03_auth_storage_consistency.test.ts` (**22/22**), `tests/issue06_visitor_pass_api.test.ts` (**24/24**), full offline `npm test` (**405/405 executed passed**; **11 live PG 16 tests skipped** in offline run)  
**Build:** `npm run build` (**PASS**, 0 errors)

---

## 1. Finding-to-Test Traceability Matrix

| Finding | Requirement Verified | Test(s) in `tests/issue06_b23_api_client.test.ts` | Result |
| :--- | :--- | :--- | :---: |
| **F-P1-01** | Ordinary pass list, getById, revoke, and verify reject `bearerToken` and `qrPayload` | `F-P1-01: ordinary pass list, getById, revoke, and verify reject unexpected bearerToken or qrPayload` | **PASS** |
| **F-P1-01** | Pass creation requires & preserves `bearerToken` + `qrPayload` untouched, rejects `tokenHash` | `F-P1-01: pass creation requires one-time bearerToken & qrPayload, preserves them untouched, and still rejects tokenHash` | **PASS** |
| **F-P1-02** | Recursive nested object/array sanitization, mixed-case sensitive key stripping, actual HTTP status fallback, safe code preservation, bounded depth & array size | `F-P1-02: recursively strips mixed-case sensitive keys, sanitizes nested unsafe strings, preserves actual status fallback & safe codes, and bounds deep/large payloads` | **PASS** |
| **F-P1-03** | Current-token `401` clears session and dispatches `aarizo:unauthorized` once | `F-P1-03: current-token 401 clears session and dispatches aarizo:unauthorized once` | **PASS** |
| **F-P1-03** | Multiple simultaneous `401`s emit only ONE `aarizo:unauthorized` event | `F-P1-03: multiple simultaneous 401 responses for the same token emit only ONE aarizo:unauthorized event` | **PASS** |
| **F-P1-03** | Delayed stale-token `401` after fresh login preserves new session; fresh request succeeds; new-token `401` still expires session | `F-P1-03: delayed stale-token 401 after a fresh login does NOT wipe the new session, and subsequent fresh request succeeds (and fresh 401 still works)` | **PASS** |
| **F-P1-04** | Plain-object, `Headers` instance, and `[string, string][]` tuple header normalization stripping `Authorization` & `x-society-id`/`x-user-id`/`x-user-role` while keeping custom headers | 3 dedicated header tests in `describe('1. Authentication, Header Normalization & Race-Safe 401 Handling')` | **PASS** |
| **F-P1-04** | Case-insensitive raw-ID blocking (`IdProofNumber`, nested `AADHAAR`, `PAN_NUMBER`) + `idDocumentLast4` <= 4 validation | `F-P1-04: blocks raw government ID fields case-insensitively (including nested) and oversized idDocumentLast4 before hitting network` | **PASS** |
| **F-P1-05** | Exact Prisma enum validation across child, pickup, pass, exit log, and alert DTOs + optional `pass.child` summary validation | `F-P1-05: rejects invalid Prisma enum values and malformed optional pass.child summary` | **PASS** |
| **F-P1-05** | Backend-ignored fields (`includeArchived` on pickups, `reason` on child archive / pickup revoke, `notes` on alert acknowledge) NOT transmitted | Verified in `1-5`, `6-10`, and `17-20` endpoint tests (`init.body === undefined` and clean pickup URL) | **PASS** |
| **F-P1-06** | Request timeout (`AbortError`) -> `REQUEST_TIMEOUT` (`isFailClosedUnavailable: true`, zero retries) | `distinguishes network failure and request timeout (AbortError) as fail-closed NETWORK without retries` | **PASS** |
| **F-P1-06** | `Retry-After` integer seconds AND HTTP-date parsing on `429` | `parses Retry-After integer seconds and HTTP-date format on 429 and never retries non-idempotent POST` | **PASS** |
| **F-P1-06** | URL path encoding & traversal protection (`../passes?societyId=soc-other`, `child/1`, `pickup 2&admin=true`) | `percent-encodes path segments to prevent path traversal and query injection` | **PASS** |
| **F-P1-06** | Exact request payload assertions across all 20 strict API methods | `1-5`, `6-10`, `11-16`, `17-20` tests in `describe('4. All 20 Child Safety Strict Endpoints ...')` | **PASS** |
| **F-P1-06** | All 8 documented gate verification denial codes (`409`/`404`/`422`) + `503 BACKEND_UNAVAILABLE` + `400 BEARER_TOKEN_REQUIRED` | Parameterized 8-case `test.each` + dedicated `503` & `400` tests in `describe('5. Security-Critical Pre-Flight & Gate Verification Outcome Contracts')` | **PASS** |
| **F-P1-06** | Legacy `apiRequest` & deprecated Child Safety stub backward compatibility | `describe('6. Backward Compatibility for Unrelated & Legacy API Consumers')` | **PASS** |

---

## 2. Executed vs Skipped Test Accounting

| Suite | Executed | Passed | Failed | Skipped | Notes |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `tests/issue06_b23_api_client.test.ts` | 42 | 42 | 0 | 0 | New Phase 1 + remediation suite |
| `tests/issue03_auth_storage_consistency.test.ts` | 22 | 22 | 0 | 0 | Canonical auth storage regression |
| `tests/issue06_visitor_pass_api.test.ts` | 24 | 24 | 0 | 0 | Visitor pass API regression |
| Remaining 19 offline suites (`npm test`) | 317 | 317 | 0 | 0 | All existing offline backend/frontend tests |
| 2 live PostgreSQL 16 suites (`issue06_child_safety_api_pg_integration.test.ts`, `issue06_child_safety_db_constraints.test.ts`) | 0 | 0 | 0 | 11 | Skipped offline (requires `AARIZO_ISOLATED_TEST_DATABASE_URL`); backend/DB untouched in Phase 1 |
| **Totals** | **405** | **405** | **0** | **11** | **100% pass rate on all executed tests** |

