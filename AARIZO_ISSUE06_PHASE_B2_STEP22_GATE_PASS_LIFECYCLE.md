# AARIZO — ISSUE-06 / Phase B.2.2 Gate Pass Lifecycle & Concurrency Specification

**Project:** `D:\AAZIRA\AARIZO`  
**Phase:** ISSUE-06 — B.2.2 Secure Child Safety Backend APIs  
**Source Modules:** [server/src/childSafety/crypto.ts](file:///D:/AAZIRA/AARIZO/server/src/childSafety/crypto.ts), [server/src/childSafety/router.ts](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts)  
**Date:** November 18, 2026  

---

## 1. Cryptographic Separation: Display Code vs Bearer Credential

| Property | `passCode` (Display Reference) | `bearerToken` / `tokenHash` (Authorization Credential) |
| :--- | :--- | :--- |
| **Generation** | `generateDisplayPassCode()`: 8 Crockford Base32 chars (`CGP-XXXX-XXXX`, 40 bits CSPRNG), retried up to 5 times on per-society collision. | `generateChildPassBearerToken()`: `crypto.randomBytes(32).toString('base64url')` (**256 bits** CSPRNG entropy, 43+ chars). |
| **Storage** | Stored plaintext in `child_gate_passes.pass_code`, scoped `UNIQUE (society_id, pass_code)`. | **Raw token NEVER stored or logged.** Only SHA-256 64-char hex digest stored in `child_gate_passes.token_hash` (`UNIQUE`, enforced by `chk_child_passes_token_hash_format`). |
| **QR Payload** | Never used as authorization payload. | `AARIZO_CHILD_PASS:<rawBearerToken>` — encodes ONLY opaque 256-bit bearer token (zero child PII, zero predictable record ID). |
| **API Exposure** | Returned in pass list/detail DTOs for human reference. | `bearerToken` + `qrPayload` returned **ONCE** in `201` creation response. `tokenHash` is **NEVER** returned in any API response or realtime event. |
| **Gate Verification** | Explicitly rejected by `extractBearerToken()` (`400 BEARER_TOKEN_REQUIRED`) if submitted without bearer token. | Verified via indexed SHA-256 lookup + constant-time `timingSafeCompare(computedHash, storedHash)`. |
| **Offline Policy** | **No offline approval.** Zero client-side secrets. | **Strictly online fail-closed.** DB unavailability returns HTTP `503 VERIFICATION_UNAVAILABLE` with `authorized: false`. |

---

## 2. Ten-Point Gate Verification Sequence (`POST /api/children/passes/verify`)

Executed inside `prisma.$transaction` ([router.ts#L402-L645](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L402-L645)):

1. **Bearer token extraction & format gate:** Rejects missing token, `CGP-*` display codes, and tokens `< 32` chars (`400 BEARER_TOKEN_REQUIRED`).
2. **Digest lookup & constant-time comparison:** Computes `SHA-256(rawToken)`, fetches `childGatePass` by `tokenHash`, verifies via `verifyChildPassTokenConstantTime()`.
3. **Pass existence & society boundary (non-disclosure):** Verifies `pass.societyId === actor.societyId` AND `pass.child.societyId === actor.societyId` (and `pass.id === req.params.id` on `/:id/verify`). Failure logs `DENIED` (`INVALID_OR_UNRECOGNIZED_TOKEN`) under `actor.societyId` and returns `404` without disclosing cross-society existence.
4. **Missing-child override (highest safety priority):** Checks both `child.status === 'MISSING'` and any `ACTIVE`/`ACKNOWLEDGED` `MISSING_CHILD` `ChildSafetyAlert`. If present -> logs `MISSING_ALERT_BLOCKED` and returns `409 CHILD_MISSING_ALERT_BLOCKED`.
5. **Active child eligibility:** Rejects `ARCHIVED` children (`409 CHILD_ARCHIVED`).
6. **Revocation / archival check:** Rejects `REVOKED` (`409 PASS_REVOKED`) and `ARCHIVED` (`409 PASS_ARCHIVED`).
7. **Consumption check:** Rejects `USED` or `currentUses >= maxUses` (`409 PASS_ALREADY_CONSUMED`).
8. **Validity window check:** Rejects `now < validFrom` (`422 PASS_NOT_YET_VALID`) and `EXPIRED` or `now >= validUntil` (`409 PASS_EXPIRED`).
9. **Authorized pickup & exit-policy check:** If `pickupPersonId` is linked, verifies pickup is in same `(societyId, childId)`, `status === 'ACTIVE'`, not archived, and unexpired (`409 PICKUP_PERSON_UNAUTHORIZED`). If `pickupPersonId` is null, verifies `exitPermissionMode === 'SOLO_ALLOWED' && allowedSoloExit === true` (`422 ESCORT_REQUIRED`).
10. **Atomic conditional consumption:** Executes conditional `updateMany` matching `{ id, societyId, tokenHash, status: 'ACTIVE', archivedAt: null, revokedAt: null, validFrom: { lte: now }, validUntil: { gt: now }, currentUses: pass.currentUses }`:
    - If `count === 1`: inserts the single `ALLOWED` `ChildExitLog`, transitions `ChildProfile.status` from `SAFE` -> `OUT_OF_SOCIETY`, commits, then emits `CHILD_EXIT_TRIGGERED` & `CHILD_GATE_PASS_VERIFIED`.
    - If `count !== 1`: inserts `DENIED` (`PASS_CONCURRENT_OR_ALREADY_CONSUMED`) log, commits, emits `CHILD_EXIT_DENIED`, and returns `409 PASS_ALREADY_CONSUMED`.

---

## 3. Live PostgreSQL 16 Concurrency Verification Proof

In [tests/issue06_child_safety_api_pg_integration.test.ts#L140-L169](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_api_pg_integration.test.ts#L140-L169):
- Two simultaneous `POST /api/children/passes/verify` requests were dispatched via `Promise.all` against a real PostgreSQL 16 instance for the same `maxUses = 1` pass.
- **Verified outcome:** Statuses sorted `[200, 409]`; winner received `{ authorized: true, outcome: 'ALLOWED' }`; loser received `{ authorized: false, code: 'PASS_ALREADY_CONSUMED' }`; PostgreSQL state confirmed `currentUses === 1`, `status === 'USED'`, and `COUNT(*) FROM child_exit_logs WHERE pass_id = ... AND outcome = 'ALLOWED'` equaled **1**.

