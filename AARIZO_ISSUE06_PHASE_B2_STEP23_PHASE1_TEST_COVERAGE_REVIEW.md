# AARIZO — ISSUE-06 Phase B.2.3 — Phase 1 Test Coverage Review

**Audited Test File:** `tests/issue06_b23_api_client.test.ts` (27 tests, 27/27 passing)  
**Regression Suites Re-Run:** `tests/issue03_auth_storage_consistency.test.ts` (22/22), `tests/issue06_visitor_pass_api.test.ts` (24/24)

---

## 1. Test Quality Assessment

Overall, `tests/issue06_b23_api_client.test.ts` tests **real `apiRequestStrict`, `ApiError`, runtime validators, pre-flight guards, and `authStorage` integration** directly (only mocking `backendConfig` for Jest CommonJS compatibility and global `fetch` for deterministic HTTP simulation). It does NOT mock `apiClient` itself, so it genuinely exercises the production code paths.

However, the audit identified **8 specific missing test scenarios (`F-P1-06`)** — several of which directly explain why `F-P1-01` through `F-P1-04` slipped past the initial Phase 1 test pass.

---

## 2. Missing Test Coverage Matrix (`F-P1-06`)

| # | Missing Scenario | Security / Correctness Value | Related Finding |
| :--- | :--- | :--- | :--- |
| 1 | **Ordinary pass reads (`getChildPassesStrict`, `getChildPassByIdStrict`, `revokeChildPassStrict`, `verifyChildPassStrict`) rejecting responses containing `bearerToken` or `qrPayload`** | Guarantees one-time credentials are NEVER silently accepted outside `createChildPassStrict`. | Directly catches **`F-P1-01`** |
| 2 | **Recursive nested error payload sanitization & case-insensitive key stripping** (e.g., `{ details: { tokenHash, sql, stack }, message: 'SELECT * FROM child_profiles', Authorization: 'Bearer ...' }`) | Prevents nested secret/SQL/stack leaks onto `ApiError.payload`. | Directly catches **`F-P1-02`** |
| 3 | **Concurrent `401` responses AND delayed stale-token `401` after fresh login** | Proves parallel `401`s emit only ONE `aarizo:unauthorized` event and a stale-token `401` NEVER wipes a newly stored session token. | Directly catches **`F-P1-03`** |
| 4 | **`Headers` instance & `[string, string][]` tuple header handling + case-insensitive raw-ID blocking** | Verifies `Authorization` / `x-society-id` stripping works across all `HeadersInit` shapes and `IdProofNumber` / `AADHAAR` casing variants are blocked. | Directly catches **`F-P1-04`** |
| 5 | **Request timeout (`AbortError` via `timeoutMs`)** | Verifies `ApiError` classifies timeout as `status: 0, code: 'REQUEST_TIMEOUT', kind: 'NETWORK', isFailClosedUnavailable: true` with zero retries. | Transport requirement (Section 5) |
| 6 | **URL path-encoding & traversal injection** (e.g., `childId = '../passes?x=1'`, `pickupId = 'id/with spaces'`) | Verifies `encodeURIComponent` prevents escaping path segments across all `:id` endpoints. | Security requirement (Section 3) |
| 7 | **Complete request-body assertions for all mutating endpoints & `Retry-After` HTTP-date parsing** | Ensures every POST/PATCH payload (`createChildStrict`, `updateChildStrict`, `archiveChildStrict`, `addChildPickupStrict`, `updateChildPickupStrict`, `revokeChildPickupStrict`, `createChildPassStrict`, `revokeChildPassStrict`, `verifyChildPassStrict`, `triggerChildSosStrict`, `acknowledgeChildAlertStrict`, `resolveChildAlertStrict`) serializes exact expected JSON fields, and `Retry-After` handles both integer seconds and RFC HTTP-date format. | Contract completeness (Section 6) |
| 8 | **All documented gate verification denial codes** (`409 PASS_ALREADY_CONSUMED`, `409 PASS_EXPIRED`, `409 PASS_REVOKED`, `409 PICKUP_PERSON_UNAUTHORIZED`, `404 INVALID_OR_UNKNOWN_PASS`, `422 ESCORT_REQUIRED`) | Explicitly exercises every documented gate denial code and verifies `ApiError.status`, `code`, `kind`, and `payload.exitLog` preservation. | Gate verification contract (Section 4) |

---

## 3. Existing Coverage Confirmed Strong

- Canonical Bearer token attachment & plain-object identity header stripping (`#L244-L266`)
- Missing token fast-fail `401 AUTH_TOKEN_MISSING` prior to `fetch` (`#L268-L278`)
- `401` session clear + `aarizo:unauthorized` vs `403` session preservation (`#L280-L307`)
- HTTP `400`, `404`, `409`, `422`, `429` (`Retry-After` seconds + single non-retried POST), `500`, `503` error propagation (`#L313-L370`)
- Network `TypeError` -> `NETWORK_UNAVAILABLE` (`isFailClosedUnavailable === true`) (`#L372-L388`)
- Non-JSON HTML 503 proxy error handling (`#L415-L424`)
- Malformed JSON, empty 200 body, wrong root type, leaked `tokenHash`/`idDocumentHash`, missing `bearerToken` on pass creation (`#L426-L473`)
- All 20 endpoint URLs & HTTP methods exercised (`#L479-L639`)
- Pass creation `pickupPersonId` policy (`ESCORT_REQUIRED` vs `SOLO_ALLOWED`), raw ID fields, `idDocumentLast4` length, `resolutionNotes` validation, and legacy `apiRequest` backward compatibility (`#L645-L790`)

