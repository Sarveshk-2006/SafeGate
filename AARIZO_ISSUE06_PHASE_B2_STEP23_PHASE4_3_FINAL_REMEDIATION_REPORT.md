# AARIZO ISSUE-06 — Phase B.2.3 — Phase 4.3 Final Lifecycle Remediation Report

**Date:** 2026-11-18  
**Repository:** `D:\AAZIRA\AARIZO`  
**Scope:** Strictly targeted final lifecycle remediation closing blocking finding `F-P43-R1`, plus low-priority hardening `F-P43-R2` and `F-P43-R3`. Phase 4.4 NOT started; no commits or pushes; no database schema or migration changes.  
**Final Verdict:** **`FINAL REMEDIATION PASS — READY FOR FINAL INDEPENDENT SIGN-OFF`**

---

## 1. Exact Files Modified

**Production Code (3 files):**
1. `server/src/childSafety/router.ts` (`#L2354-L2492`) —
   - **`F-P43-R1` (Blocking):** Immediately after verifying tenant + resident ownership (`authorizeChildAccess`), joint `(id, societyId, childId)` lookup, and `ARCHIVED` (`409`), unconditionally rejects **every** `PATCH` request whenever `pickup.status === 'REVOKED'` (`#L2361-L2370`) with HTTP `422` and `code: 'REVOKED_PICKUP_CANNOT_BE_REACTIVATED'`, regardless of payload (empty PATCH, `{ status: 'EXPIRED' }`, `{ status: 'ACTIVE', validUntil: future }`, `{ status: 'REVOKED', name: '...' }`, contact-only, or expiry-only). Removed unreachable duplicate check.
   - **`F-P43-R3` (Low — Concurrency Hardening):** Added `status: { not: 'REVOKED' }` alongside `archivedAt: null` inside `tx.childAuthorizedPickup.updateMany` (`#L2444-L2457`) and fails closed with HTTP `422 REVOKED_PICKUP_CANNOT_BE_REACTIVATED` if `updateRes.count === 0`, closing the TOCTOU window if a concurrent `POST /:id/revoke` commits between initial `findFirst` and `updateMany`.
2. `server/src/childSafety/validation.ts` (`#L49-L93`) —
   - **`F-P43-R2` (Low — Phone Punctuation Hardening):** Added `hasBalancedPhoneParentheses()` and updated `ALLOWED_PHONE_CHARS_RE` (`/^\+?[\d(][\d\s\-().]{5,30}[\d)]$/`) in `isValidPhoneNumber()` to reject unbalanced, nested, or empty parentheses (`(1234567`, `123)4567`, `((123))4567`, `()1234567`) and trailing separators (`1234567----`) while preserving all valid international formats.
3. `src/domains/safety/utils/childSafetyResidentHelpers.ts` (`#L327-L372`) —
   - **`F-P43-R2` (Low — Frontend/Backend Parity):** Applied identical `hasBalancedPhoneParentheses()` and `ALLOWED_PHONE_CHARS_RE` in `isValidPhoneNumber()`.

**Regression Tests (2 files):**
4. `tests/issue06_child_safety_remediation.test.ts` (`#L1079-L1175`) — Added backend route tests covering all 6 `REVOKED` `PATCH` payload variants (`0` DB writes), `validUntil: ''` on expired pickup (`422`), `F-P43-R3` concurrent revocation TOCTOU (`count: 0` → `422` + verified `where.status: { not: 'REVOKED' }`), and `F-P43-R2` malformed phone punctuation (`400 INVALID_PHONE`).
5. `tests/issue06_b23_phase4_resident_helpers.test.ts` (`#L728-L760`) — Added `2000-02-29` valid century leap day assertion and `F-P43-R2` malformed phone punctuation negative assertions.

---

## 2. Before / After Lifecycle & Validation Behavior

| Finding | Before | After |
| --- | --- | --- |
| **`F-P43-R1`** (Blocking Medium — `REVOKED` pickup `PATCH` bypass) | `PATCH` on `REVOKED` only rejected `status === undefined` or `status === 'ACTIVE'`, permitting `REVOKED → EXPIRED → ACTIVE` reactivation in 2 `PATCH` calls and permitting `{ status: 'REVOKED', name: 'Tampered' }` audit mutation. | `if (pickup.status === 'REVOKED')` unconditionally returns HTTP `422 REVOKED_PICKUP_CANNOT_BE_REACTIVATED` immediately after `404`/`409` checks before any field parsing or DB update. Revoke (`POST /:id/revoke`) and soft-archive (`DELETE /:id`) remain unaffected. |
| **`F-P43-R3`** (Low — Concurrent revoke TOCTOU) | `updateMany` guarded `archivedAt: null` but not `status: { not: 'REVOKED' }`, nor checked `count === 0`. | `updateMany` atomically guards `{ id, societyId, childId, archivedAt: null, status: { not: 'REVOKED' } }`; `count === 0` aborts gate-pass side effects and returns HTTP `422 REVOKED_PICKUP_CANNOT_BE_REACTIVATED`. |
| **`F-P43-R2`** (Low — Malformed phone punctuation) | `isValidPhoneNumber()` accepted `(1234567`, `123)4567`, `((123))4567`, `()1234567`, and `1234567----`. | Identical frontend & backend `isValidPhoneNumber()` rejects unbalanced/nested/empty parentheses and trailing separators while preserving valid international formats (`+91 98199 88776`, `+1 (415) 555-0199`, `(415) 555-0199`, `+44-20-7946-0958`, `555-0199`). |

---

## 3. Preserved Behaviors & Unresolved Limitations

- **Preserved:** Active pickup edits & expiry clearing, expired pickup renewal with future `validUntil`, non-expiry contact edits on expired pickups, explicit revocation (`POST /:id/revoke`), soft archival (`DELETE /:id`, including archiving a revoked pickup), gate-pass cascading revocation, cross-child & cross-society `404`/`403` isolation, Phase 4.1–4.3 frontend workflows, Visitor Management, General Emergency SOS, Admin Command Console, Gate Verifier, and Phase 1–3 foundations. `F-P42-04` (`SafetyCommandHub.tsx#L552`) remains intentionally deferred to Phases 5–6.
- **Unresolved / Unverified Boundaries (Explicitly Disclosed):** Live PostgreSQL integration (`11` skipped tests in `2` suites because `AARIZO_ISOLATED_TEST_DATABASE_URL` is unavailable), live Firebase Authentication, live browser E2E, and deployment verification were NOT executed in this offline run.

---

## 4. Final Verdict

**`FINAL REMEDIATION PASS — READY FOR FINAL INDEPENDENT SIGN-OFF`**

