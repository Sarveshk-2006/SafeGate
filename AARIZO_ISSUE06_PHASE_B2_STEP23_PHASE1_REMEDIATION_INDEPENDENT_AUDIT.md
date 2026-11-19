# AARIZO — ISSUE-06 Phase B.2.3 — Phase 1 Remediation Independent Re-Audit

**Re-Audit Date:** 2026-11-18  
**Audit Mode:** Strictly Read-Only (zero source, test, schema, migration, env, or config edits)  
**Scope:** Independent verification of remediation for `F-P1-01` through `F-P1-06` in `src/services/apiClient.ts`, `src/types/childSafety.ts`, and `tests/issue06_b23_api_client.test.ts`  
**Final Verdict:** **`PHASE 1 FINAL ACCEPTANCE — PASS, READY FOR PHASE 2`**

---

## 1. Executive Verdict

All six findings (`F-P1-01` through `F-P1-06`) from the prior Phase 1 independent audit have been **independently verified directly against source code and backend contracts as CLOSED**, with zero new regressions introduced and strict Phase 1 scope maintained.

---

## 2. Independent Verification of Original Findings (`F-P1-01` – `F-P1-06`)

| Finding ID | Original Severity | Verification Status | Verified Source Evidence |
| :--- | :--- | :---: | :--- |
| **F-P1-01** | HIGH | **VERIFIED CLOSED** | `src/services/apiClient.ts#L541-L581`: `isChildGatePassBase` rejects `'tokenHash' in val`, enforces `ALLOWED_GATE_PASS_STATUS_SET`, and validates optional `pass.child` via `isChildGatePassChildSummaryDto`. `isChildGatePassDto` (`#L568-L572`) strictly rejects `'bearerToken' in val \|\| 'qrPayload' in val` across `getChildPassesStrict`, `getChildPassByIdStrict`, `revokeChildPassStrict`, and `verifyChildPassStrict`. `isChildGatePassCreatedDto` (`#L578-L581`) requires & preserves one-time `bearerToken` and `qrPayload` exclusively on `createChildPassStrict`. |
| **F-P1-02** | MEDIUM-HIGH | **VERIFIED CLOSED** | `src/services/apiClient.ts#L41-L43`, `#L61-L79`, `#L250-L343`, `#L770`: `sanitizeErrorValue` / `sanitizeErrorPayload(bodyObj, status, kind)` traverses nested objects & arrays recursively with `WeakSet` cycle guard, `MAX_ERROR_PAYLOAD_DEPTH = 6`, `MAX_ERROR_PAYLOAD_KEYS = 50`, `MAX_ERROR_ARRAY_ITEMS = 50`, case-insensitive sensitive key stripping (`SENSITIVE_ERROR_PAYLOAD_KEYS_LOWER`), actual HTTP `(status, kind)` fallback on `error`/`message`, and `[REDACTED]` on nested unsafe strings. Never executed on `2xx` responses. |
| **F-P1-03** | MEDIUM | **VERIFIED CLOSED** | `src/services/apiClient.ts#L656`, `#L757-L762`: Captures `requestToken = getAuthToken()` before `fetch`; `401` handler checks `getAuthToken() === requestToken` synchronously with zero intervening `await` before `clearAuthSession()` and `aarizo:unauthorized`. Guarantees stale-token `401`s cannot wipe fresh sessions, parallel `401`s emit only 1 event, and legitimate current/new-token `401`s expire normally. |
| **F-P1-04** | MEDIUM | **VERIFIED CLOSED** | `src/services/apiClient.ts#L45-L59`, `#L81-L86`, `#L345-L377`, `#L407-L458`, `#L680-L687`: `normalizeCallerHeaders` handles plain objects, `Headers` instances, and tuple arrays; strips `authorization`, `x-society-id`, `x-user-id`, `x-user-role` case-insensitively while preserving custom headers. `assertNoForbiddenRawIdFields` blocks all `FORBIDDEN_RAW_ID_FIELDS_LOWER` case-insensitively and recursively while preserving valid `idDocumentLast4` (1–4 chars). |
| **F-P1-05** | LOW | **VERIFIED CLOSED** | `src/types/childSafety.ts` & `src/services/apiClient.ts#L100-L136`, `#L487-L637`, `#L1028-L1084`, `#L1267-L1273`: Removed backend-ignored parameters (`includeArchived` on `getChildPickupsStrict`, `reason` on `archiveChildStrict` & `revokeChildPickupStrict`, `notes` on `acknowledgeChildAlertStrict`); kept `reason` on `revokeChildPassStrict` (persisted by backend `router.ts#L988`). All 11 Prisma enum sets match `server/prisma/schema.prisma#L85-L166` verbatim, and optional `pass.child` summary is validated. |
| **F-P1-06** | MEDIUM | **VERIFIED CLOSED** | `tests/issue06_b23_api_client.test.ts` (42 tests): Directly exercises real `apiClient.*Strict`, `apiRequestStrict`, `ApiError`, validators, pre-flight guards, and `authStorage` without mocking `apiClient` internals. Covers all 8 previously missing test areas. |

---

## 3. Regression & Diff Audit

- **TypeScript & Vite Build:** `npm run build` (`tsc -b && vite build`) passed cleanly (exit code `0`, 2,179 modules, built in 1.07s).
- **Legacy API Compatibility:** `apiRequest<T>()` (`src/services/apiClient.ts#L804-L841`), unrelated endpoints (`checkHealth`, `getFlats`, `getResidents`, `getVisitorPasses`, etc.), and deprecated Child Safety stubs remain 100% intact.
- **No Unintended Scope Drift:** Diff confirmed strictly confined to `src/services/apiClient.ts`, `src/types/childSafety.ts`, and `tests/issue06_b23_api_client.test.ts`. Zero changes to SSE, `AuthContext`, legacy Child Safety stores, portal pages, backend routes, Prisma schema, migrations, or env files. Zero commits or pushes.

---

## 4. Non-Blocking Informational Observations (Not Defects)

1. **Info-01 (LOW / Informational):** `SENSITIVE_ERROR_PAYLOAD_KEYS_LOWER` (`src/services/apiClient.ts#L61-L79`) strips 30 credential/token/hash/ID/SQL keys; optionally adding `'cookie'` and `'set-cookie'` in a future pass would add minor extra hygiene (Express JSON error responses in AARIZO do not emit cookie fields).
2. **Info-02 (LOW / Informational):** If a caller passes duplicate non-blocked custom headers with different casings in a plain object or tuple array (e.g., `['X-Req', '1']` and `['x-req', '2']`), `headers[k] = v` (`#L686`) keeps both object keys until `fetch` normalizes them. Blocked security headers (`authorization`, `x-society-id`, `x-user-id`, `x-user-role`) are unaffected because all casing variants are dropped via `k.toLowerCase()` at `#L681-L685`.

---

## 5. Independent Verification Re-Run Counts

| Verification Command | Result | Exact Counts |
| :--- | :---: | :--- |
| `npx jest tests/issue06_b23_api_client.test.ts tests/issue03_auth_storage_consistency.test.ts tests/issue06_visitor_pass_api.test.ts --silent` | **PASS** | **3/3 suites, 88/88 tests passed** (`42` Phase 1 + `22` Auth Storage + `24` Visitor Pass API) |
| `npm test` (full offline suite) | **PASS** | **22/22 executed suites, 405 passed, 0 failed** (`2` live PG 16 suites / `11` tests skipped — `AARIZO_ISOLATED_TEST_DATABASE_URL` not set in offline run) |
| `npm run build` | **PASS** | Exit code `0`, 0 errors, built in 1.07s |

