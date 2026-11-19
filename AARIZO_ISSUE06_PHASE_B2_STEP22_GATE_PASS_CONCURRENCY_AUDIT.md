# AARIZO — ISSUE-06 / Phase B.2.2 Gate-Pass Cryptography & Concurrency Audit

**Project:** `D:\AAZIRA\AARIZO`  
**Phase:** ISSUE-06 — B.2.2 Secure Child Safety Backend APIs  
**Mode:** STRICT READ-ONLY INDEPENDENT AUDIT  
**Audit Date:** November 18, 2026  

---

## 1. Cryptographic Verification (Independently Audited)

Inspected [server/src/childSafety/crypto.ts](file:///D:/AAZIRA/AARIZO/server/src/childSafety/crypto.ts), [server/src/crypto.ts#L20-L26](file:///D:/AAZIRA/AARIZO/server/src/crypto.ts#L20-L26), and [server/src/childSafety/router.ts#L155-L751](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L155-L751):

| Cryptographic Requirement | Verified Result | Exact Code Evidence |
| :--- | :---: | :--- |
| **>= 256-bit CSPRNG bearer token** | **PASS** | `crypto.randomBytes(32).toString('base64url')` ([crypto.ts#L12-L14](file:///D:/AAZIRA/AARIZO/server/src/childSafety/crypto.ts#L12-L14)) — exactly 256 bits entropy (43 base64url chars). |
| **Hash-only DB persistence** | **PASS** | Only `SHA-256(rawToken)` (64 lowercase hex chars) is passed to `prisma.childGatePass.create` ([router.ts#L289-L303](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L289-L303)). Raw token never persisted or logged. |
| **One-time return of raw token** | **PASS** | `bearerToken` and `qrPayload` returned ONLY in `201` response of `POST /api/children/passes` ([router.ts#L334-L338](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L334-L338)). `sanitizeGatePassDto` ([validation.ts#L200-L234](file:///D:/AAZIRA/AARIZO/server/src/childSafety/validation.ts#L200-L234)) explicitly excludes `tokenHash`. |
| **Real constant-time comparison** | **PASS** | Independently inspected `timingSafeCompare` in [server/src/crypto.ts#L20-L26](file:///D:/AAZIRA/AARIZO/server/src/crypto.ts#L20-L26): validates types, converts to UTF-8 `Buffer`, checks equal byte length (both are fixed 64-byte SHA-256 hex strings), and calls native `crypto.timingSafeEqual(bufA, bufB)`. |
| **Opaque QR payload (no PII/IDs)** | **PASS** | `AARIZO_CHILD_PASS:<rawBearerToken>` ([crypto.ts#L51-L53](file:///D:/AAZIRA/AARIZO/server/src/childSafety/crypto.ts#L51-L53)). |
| **Display `passCode` blocked as auth** | **PASS** | `extractBearerToken` ([crypto.ts#L59-L77](file:///D:/AAZIRA/AARIZO/server/src/childSafety/crypto.ts#L59-L77)) explicitly rejects `/^CGP-/i` and strings `< 32` chars; `router.ts#L364-L370` returns `400 BEARER_TOKEN_REQUIRED`. |
| **Zero offline approval / secrets** | **PASS** | No signing secret sent to clients; DB connectivity errors return `503 VERIFICATION_UNAVAILABLE` with `authorized: false` ([router.ts#L740-L748](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L740-L748)). |
| **Error & log token leakage** | **PASS** | `handleChildSafetyError` passes errors through `sanitizeErrorMessage` ([validation.ts#L136-L139](file:///D:/AAZIRA/AARIZO/server/src/childSafety/validation.ts#L136-L139)); `rawToken` is never interpolated into error strings or `console.error`. |

---

## 2. Atomic One-Time Consumption & Concurrency Audit

### Transaction Trace (`handleGatePassVerification`, [router.ts#L402-L694](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L402-L694))
1. **Two simultaneous `/passes/verify` requests on the same one-time pass (`maxUses = 1`):**
   - Both execute inside `prisma.$transaction` (PostgreSQL `READ COMMITTED`).
   - Both read the pass (`currentUses = 0, status = 'ACTIVE'`), validate all 10 conditions, and reach `tx.childGatePass.updateMany` (`#L616-L634`) with:
     ```ts
     where: {
       id: pass.id,
       societyId: actor.societyId,
       tokenHash: pass.tokenHash,
       status: 'ACTIVE',
       archivedAt: null,
       revokedAt: null,
       validFrom: { lte: now },
       validUntil: { gt: now },
       currentUses: pass.currentUses,
     }
     ```
   - PostgreSQL acquires a row-level exclusive lock on the `child_gate_passes` tuple during the `UPDATE`. Transaction 1 updates `current_uses = 1, status = 'USED'` (`consumed.count === 1`), inserts the single `ALLOWED` `ChildExitLog`, and commits.
   - Transaction 2 blocks on the row lock until Transaction 1 commits, re-evaluates the `WHERE` predicate against the newly committed tuple (`status = 'USED', current_uses = 1`), matches **0 rows** (`consumed.count === 0`), inserts a `DENIED` (`PASS_CONCURRENT_OR_ALREADY_CONSUMED`) log, and returns **`409 PASS_ALREADY_CONSUMED`**.
   - **Independent Live PostgreSQL 16 Reproduction:** Executed `tests/issue06_child_safety_api_pg_integration.test.ts` on a fresh disposable container (`aarizo-b22-audit-pg`, `postgres:16-alpine`, `127.0.0.1:5441`, removed immediately afterward). Verified:
     - Uses real `PrismaClient`, real Express `app`, real `Promise.all` launching two concurrent HTTP requests on the same `maxUses = 1` pass.
     - Passed: statuses `[200, 409]`, `currentUses === 1`, `status === 'USED'`, and `COUNT(child_exit_logs WHERE outcome = 'ALLOWED') === 1`.
2. **Failure / Rollback behavior:**
   - Because `ChildExitLog` (`ALLOWED`) is created inside the same `prisma.$transaction` as `childGatePass.updateMany`, any failure after consumption rolls back BOTH the usage increment AND the exit log — leaving zero orphaned logs or half-consumed passes.
3. **Identified Secondary Race Condition (`F-B22-05` — MEDIUM):**
   - A concurrent `POST /api/children/sos` (`MISSING_CHILD`) updates `child_profiles.status = 'MISSING'` without locking `child_profiles` in `verify` and without checking the `count` of line 670 (`tx.childProfile.updateMany({ where: { id, societyId, status: 'SAFE' } })`). Locking `child_profiles` (`FOR UPDATE`) inside `verify` (or revoking/re-checking child status atomically) closes this secondary window.

---

## 3. Gate-Pass Concurrency Conclusion

**One-time pass consumption concurrency protection is GENUINE, ATOMIC, and INDEPENDENTLY PROVEN LIVE ON POSTGRESQL 16.** The single narrow secondary race (`SOS` vs `verify` on `child_profiles`, `F-B22-05`) is documented for hardening alongside the blocking findings.

