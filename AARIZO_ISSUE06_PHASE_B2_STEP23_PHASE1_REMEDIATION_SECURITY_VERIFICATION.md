# AARIZO — ISSUE-06 Phase B.2.3 — Phase 1 Remediation Security Verification

**Audited Code:** `src/services/apiClient.ts` (lines 1–1306), `src/types/childSafety.ts`, `src/services/authStorage.ts`, `tests/issue06_b23_api_client.test.ts`

---

## 1. Security Verification Checklist

| Security Property | Inspection Evidence (`src/services/apiClient.ts`) | Verified Result |
| :--- | :--- | :---: |
| **One-time `bearerToken` & `qrPayload` isolation** | `isChildGatePassDto` (`#L568-L572`) explicitly returns `false` if `'bearerToken' in val \|\| 'qrPayload' in val`. `isChildGatePassCreatedDto` (`#L578-L581`) requires both fields and is bound exclusively to `createChildPassStrict` (`#L1161`). | **PASS** |
| **`tokenHash` & `idDocumentHash` rejection** | `isChildGatePassBase` (`#L543`) rejects `'tokenHash' in val`; `isAuthorizedPickupDto` (`#L493`) rejects `'idDocumentHash' in val`. Tested on list, detail, create, and pickup reads. | **PASS** |
| **Zero error-sanitizer interference on `2xx` pass creation** | `sanitizeErrorPayload` is called ONLY inside `if (!response.ok)` (`#L770`). Successful `201` responses from `createChildPassStrict` return raw one-time `bearerToken` and `qrPayload` directly to caller memory with zero persistence or console logging. | **PASS** |
| **Recursive error payload sanitization** | `sanitizeErrorValue` (`#L270-L330`) recursively sanitizes nested objects and arrays, strips 30 lowercase-normalized sensitive keys (`token`, `bearerToken`, `qrPayload`, `tokenHash`, `idDocumentHash`, `password`, `passwordHash`, `stack`, `sql`, `query`, `authorization`, `secret`, `jwt`, `apiKey`, `accessToken`, `refreshToken`, and all 13 raw-ID keys), enforces `WeakSet` cycle protection + depth cap `6` + key/array cap `50`, preserves actual HTTP `(status, kind)` fallback, and redacts unsafe nested strings matching SQL/Prisma/stack/`Bearer`/pass-token patterns. | **PASS** |
| **Atomic, race-safe HTTP `401` handling** | `requestToken` captured at `#L656`; `401` invalidation at `#L757-L762` executes `getAuthToken() === requestToken` -> `clearAuthSession()` -> `dispatchEvent('aarizo:unauthorized')` synchronously within a single JS microtask turn (zero `await` between check and clear). Stale-token `401`s cannot corrupt fresh logins; concurrent `401`s emit exactly one logout event; fresh-token `401`s still expire cleanly. | **PASS** |
| **HTTP `403` preserves active session** | Only `status === 401` enters session clearing (`#L757`); `403` throws `ApiError(403, ..., 'FORBIDDEN')` without clearing storage. | **PASS** |
| **Caller header normalization & anti-spoofing** | `normalizeCallerHeaders` (`#L345-L377`) normalizes plain objects, `Headers` instances, and tuple arrays; `#L680-L687` drops `authorization`, `x-society-id`, `x-user-id`, and `x-user-role` across all casing variants while preserving legitimate custom headers. | **PASS** |
| **Case-insensitive recursive raw-ID blocking** | `assertNoForbiddenRawIdFields` (`#L407-L434`) checks `FORBIDDEN_RAW_ID_FIELDS_LOWER.has(key.toLowerCase())` across nested objects/arrays prior to `fetch`; `assertValidIdDocumentLast4` (`#L436-L458`) permits valid 1–4 char `idDocumentLast4`. | **PASS** |
| **Path traversal & query injection resistance** | Every path parameter passes through `encodeSegment` (`encodeURIComponent(value.trim())`, `#L470-L481`); query parameters use `URLSearchParams` (`#L460-L468`). Verified by traversal test (`../passes?societyId=soc-other`). | **PASS** |
| **Fail-closed gate verification & no mutation retries** | `verifyChildPassStrict` (`#L1176-L1216`) rejects empty and `CGP-*` display-code-only inputs (`400 BEARER_TOKEN_REQUIRED`), uses 10s `AbortController` timeout with zero automatic retries, preserves exact `200 ALLOWED`, `409`/`404`/`422` denials, and marks both `503 BACKEND_UNAVAILABLE` and `NETWORK_UNAVAILABLE`/`REQUEST_TIMEOUT` as `isFailClosedUnavailable === true`. | **PASS** |

---

## 2. Backend Contract Parity Re-Confirmation (All 20 Strict Methods)

All 20 strict methods (`#L986-L1305`) were re-verified against `server/src/childSafety/router.ts`:
- **Zero remaining backend-ignored parameters** sent by any strict Child Safety method (`archiveChildStrict`, `getChildPickupsStrict`, `revokeChildPickupStrict`, and `acknowledgeChildAlertStrict` cleaned cleanly; `revokeChildPassStrict` retains `reason`, which backend persists at `router.ts#L988`).
- **All 11 Prisma enum sets** (`#L100-L136`) match `server/prisma/schema.prisma#L85-L166` verbatim.
- **Optional `pass.child` summary** validated via `isChildGatePassChildSummaryDto` (`#L531-L539`).
- **Backend remains authoritative** for authentication, RBAC, and tenant isolation (`societyId` query/body params cannot bypass backend `resolveChildSafetyActor` for society-bound roles).

