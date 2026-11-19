# AARIZO — ISSUE-06 Phase B.2.3 — Phase 1 Security Review

**Scope:** Authentication, Tenant Isolation, Sensitive Information Handling, Error Sanitization, and Strict Transport Security in `src/services/apiClient.ts` and `src/types/childSafety.ts`.

---

## 1. Confirmed Security Defects Requiring Targeted Remediation

### F-P1-01 (HIGH): Ordinary Pass Read Validator Accepts Unexpected `bearerToken` / `qrPayload`
- **Location:** `src/services/apiClient.ts#L367-L390`
- **Code Inspected:**
  ```ts
  export function isChildGatePassDto(val: unknown): val is ChildGatePassDto {
    if (!isPlainRecord(val)) return false;
    if ('tokenHash' in val) return false;
    // DOES NOT REJECT 'bearerToken' in val OR 'qrPayload' in val!
  ```
- **Risk:** One-time pass credentials (`bearerToken`, `qrPayload`) must ONLY be accepted on `POST /api/children/passes` (`isChildGatePassCreatedDto`). Because `isChildGatePassDto` is shared by `isChildGatePassCreatedDto`, ordinary read/revoke/verify responses (`getChildPassesStrict`, `getChildPassByIdStrict`, `revokeChildPassStrict`, `verifyChildPassStrict`) currently pass validation even if a misconfigured backend or proxy unexpectedly returns `bearerToken` or `qrPayload`.
- **Required Fix:** Introduce an internal `isChildGatePassBase(val)` helper checking `!('tokenHash' in val)`. Make `isChildGatePassDto(val)` enforce `isChildGatePassBase(val) && !('bearerToken' in val) && !('qrPayload' in val)`, and make `isChildGatePassCreatedDto(val)` enforce `isChildGatePassBase(val) && isNonEmptyStringValue(val.bearerToken) && isNonEmptyStringValue(val.qrPayload)`.

---

### F-P1-02 (MEDIUM-HIGH): Shallow, Case-Sensitive Error Payload Sanitization
- **Location:** `src/services/apiClient.ts#L56-L67`, `#L208-L224`, `#L578`
- **Code Inspected:**
  ```ts
  function sanitizeErrorPayload(raw: unknown): Record<string, unknown> | undefined {
    ...
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (SENSITIVE_ERROR_PAYLOAD_KEYS.has(key)) continue;
      if (key === 'error' && typeof value === 'string') {
        clean[key] = sanitizeUserErrorMessage(value, 500, 'SERVER_ERROR');
      } else {
        clean[key] = value; // shallow copy — nested objects/arrays NOT sanitized!
      }
    }
  }
  ```
- **Risks:**
  1. **Nested secret/internal leakage:** Nested objects/arrays inside a backend error JSON (e.g., `{ details: { tokenHash, sql, stack } }` or `{ exitLog: { notes: 'Bearer eyJ...' } }`) are copied verbatim onto `ApiError.payload`.
  2. **Case-sensitive key filter:** Misses variants such as `Authorization`, `TokenHash`, `BearerToken`, `secret`, `jwt`, `idProofNumber`, `aadhaarNumber`.
  3. **Unsanitized `message` & wrong fallback status:** `clean['message']` is not run through `sanitizeUserErrorMessage()`, and `clean['error']` hardcodes `(500, 'SERVER_ERROR')` instead of passing the actual HTTP `(status, kind)`.
- **Required Fix:** Make `sanitizeErrorPayload(raw, status, kind, depth = 0)` recursive (bounded depth <= 6), compare keys case-insensitively (`key.toLowerCase()`) against an expanded sensitive-key set (including `authorization`, `secret`, `jwt`, and all `FORBIDDEN_RAW_ID_FIELDS`), and sanitize string values matching `UNSAFE_MESSAGE_PATTERNS` at every depth while preserving safe fields (`authorized`, `outcome`, `verificationChannel`, `code`, sanitized `exitLog`).

---

### F-P1-03 (MEDIUM): Concurrent / Stale-Token HTTP 401 Race Condition
- **Location:** `src/services/apiClient.ts#L565-L570`
- **Code Inspected:**
  ```ts
  if (status === 401 && !normalizedEndpoint.includes('/auth/login')) {
    clearAuthSession();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('aarizo:unauthorized', { detail: { endpoint: normalizedEndpoint } }));
    }
  }
  ```
- **Risks:**
  1. **Stale-request session corruption:** If Request A was issued with `token_old`, the user re-authenticates (`token_new` stored in `authStorage`), and Request A's delayed `401` arrives afterward, line 566 unconditionally wipes `token_new`!
  2. **Duplicate unauthorized event storms:** When multiple parallel Child Safety calls (`children`, `passes`, `exit-logs`, `alerts`) fail simultaneously with `401` on an expired token, all N responses invoke `clearAuthSession()` and dispatch N `aarizo:unauthorized` events.
- **Required Fix:** Guard session invalidation with the exact token captured when the request started:
  ```ts
  if (status === 401 && !normalizedEndpoint.includes('/auth/login') && getAuthToken() === token) {
    clearAuthSession();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('aarizo:unauthorized', { detail: { endpoint: normalizedEndpoint } }));
    }
  }
  ```
  The first `401` clears `aarizo_token` (`getAuthToken()` becomes `null`), so concurrent sibling `401`s and stale-token `401`s after a fresh login are safely ignored without corrupting state!

---

### F-P1-04 (MEDIUM): `HeadersInit` Header-Stripping Gap & Case-Sensitive Raw-ID Guard
- **Locations:** `src/services/apiClient.ts#L489-L498` and `#L254-L276`
- **Defects:**
  1. **Header stripping only handles plain objects (`#L489`):** `if (extraHeaders && typeof extraHeaders === 'object' && !Array.isArray(extraHeaders))` silently drops headers when a caller passes a `Headers` instance or `Array<[string, string]>` (`HeadersInit` allows all three). Normalizing via `Headers` / `Array.isArray` / `Object.entries` ensures consistent stripping of `authorization`, `x-society-id`, `x-user-id`, `x-user-role` across all valid `HeadersInit` forms.
  2. **Case-sensitive raw-ID field block (`#L263`):** `FORBIDDEN_RAW_ID_FIELDS.has(key)` blocks `idProofNumber` and `aadhaarNumber`, but misses case variants (`IdProofNumber`, `AADHAAR_NUMBER`, `id_proof_number` vs `ID_PROOF_NUMBER`). Comparing `key.toLowerCase()` against lowercase normalized names closes casing bypasses cleanly.

---

## 2. Verified Security Controls (Confirmed Passing)

| Control | Evidence | Result |
| :--- | :--- | :---: |
| **Canonical auth storage only** | `apiRequestStrict` reads exclusively from `getAuthToken()` (`src/services/authStorage.ts#L465`). | **PASS** |
| **Missing token fails prior to `fetch`** | Returns `ApiError(401, 'AUTH_TOKEN_MISSING', 'UNAUTHORIZED')` before calling `fetch` (`#L467-L475`). | **PASS** |
| **HTTP 403 preserves valid session** | Only `status === 401` clears session (`#L565`); `403` leaves token and session intact. | **PASS** |
| **Path segment encoding / injection prevention** | Every path parameter (`childId`, `pickupId`, `passId`, `alertId`) passes through `encodeSegment()` (`encodeURIComponent(value.trim())`, `#L312-L323`), preventing `../` path traversal or query injection. | **PASS** |
| **Query parameter encoding** | `buildQueryString()` uses `URLSearchParams` (`#L302-L310`), preventing parameter smuggling. | **PASS** |
| **Optional `societyId` cannot bypass backend tenant isolation** | Verified in `server/src/childSafety/authz.ts` & `router.ts`: backend ignores/rejects mismatched `societyId` for all non-platform-admin roles and derives tenant strictly from verified DB `User.societyId`. | **PASS** |
| **Zero persistence or logging of `bearerToken`/`qrPayload`** | `apiRequestStrict` performs zero `console.log`, `localStorage`, or `sessionStorage` writes of success responses; `createChildPassStrict` returns one-time credentials directly to caller memory without stripping them. | **PASS** |
| **Zero silent retries on mutations** | No retry loop anywhere in `apiRequestStrict`; single `fetch()` per call. | **PASS** |
| **Fail-closed `503` & network classification** | Both `503` (`UNAVAILABLE`) and `fetch` rejection/timeout (`NETWORK`) set `ApiError.isFailClosedUnavailable === true` and never fall back to `null` or local state. | **PASS** |

