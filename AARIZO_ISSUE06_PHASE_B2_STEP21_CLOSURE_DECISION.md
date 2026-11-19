# AARIZO — ISSUE-06 / Phase B.2.1: Closure Decision

**Project:** `D:\AAZIRA\AARIZO`  
**Phase:** ISSUE-06 — B.2.1 Child Safety Relational Database Foundation  
**Mode:** STRICT READ-ONLY INDEPENDENT AUDIT  
**Audit Date:** November 18, 2026  

---

## 1. Explicit Closure Verdict

> ### **VERDICT: FAIL — TARGETED CORRECTIONS REQUIRED BEFORE B.2.2**

Phase B.2.1 **MUST NOT** close and Phase B.2.2 (backend API routes, auth, and gate verification) **MUST NOT** begin until the blocking findings below are remediated and independently re-verified.

---

## 2. Verification & Execution Evidence

| Check | Result | Scope & Limitations |
| :--- | :---: | :--- |
| Static Prisma schema inspection ([schema.prisma](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma)) | **Inspected** | Found 1 Critical, 6 High, 2 Medium defects |
| Static SQL migration & bootstrap inspection ([migration.sql](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118000000_add_child_safety_models/migration.sql), [01_schema.sql](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql)) | **Inspected** | Confirmed 6 schema/SQL parity drifts and missing constraints |
| Focused schema test suite (`npm test -- tests/issue06_child_safety_schema.test.ts`) | **11/11 PASS** (0.545s) | Read-only static/DMMF assertions only; shallow coverage (`F-B21-09`) |
| Full unit/route test suite (reported in B.2.1 prior run) | **307/307 PASS** (18/18 suites) | No source files modified during this audit |
| **Live PostgreSQL migration & constraint execution** | **NOT PERFORMED** | Host port `5432` is occupied by unrelated external container `nexus-postgres` (untouched per strict audit rules). Real PostgreSQL DDL execution, constraint enforcement, and backfill testing remain unverified. |

---

## 3. Mandatory Blocking Corrections Before B.2.2

All **7 blocking findings** (`F-B21-01` through `F-B21-07`) must be resolved in a targeted B.2.1 remediation pass before closing B.2.1:

1. **`F-B21-01` (CRITICAL — Fail-Closed Policy):**
   - Remove `ChildGatePass.signature`, `OFFLINE_VERIFIED`, and `OFFLINE_HMAC` from `schema.prisma`, `migration.sql`, `01_schema.sql`, tests, and docs.
   - Mandate strictly online server-side verification of high-entropy `tokenHash` with fail-closed behavior when the backend is unavailable.
2. **`F-B21-02` (HIGH — Multi-Tenant Relational Integrity):**
   - Add composite unique constraints `@@unique([societyId, id])` and composite tenant-scoped foreign keys across the child-safety tables so PostgreSQL structurally prevents cross-society linkage.
3. **`F-B21-03` (HIGH — Pass Code Scope & Entropy):**
   - Scope `passCode` uniqueness to `@@unique([societyId, passCode])`, drop the redundant `idx_child_passes_code` index, and enforce that `passCode` is never a standalone low-entropy gate authorization bypass for `tokenHash`.
4. **`F-B21-04` (HIGH — Government ID Minimization):**
   - Replace mandatory plaintext `idProofNumber` (`NOT NULL`) with optional masked `idProofLast4` (max 4 chars) and/or server-keyed `idProofHash`, and make `idProofType` optional.
5. **`F-B21-05` (HIGH — Audit Retention & Ownership Integrity):**
   - Add soft-delete (`archivedAt`) on `ChildProfile`, `ChildAuthorizedPickup`, and `ChildGatePass`.
   - Switch `ChildProfile -> ChildAuthorizedPickup/ChildGatePass`, `Resident -> ChildProfile`, and `Society -> ChildExitLog/ChildSafetyAlert` from destructive `Cascade`/`SetNull` to `Restrict` (or formally document tenant-purge rules if society deletion is ever permitted).
   - Add a `CHECK` constraint ensuring active `ChildProfile` rows cannot have both `resident_id IS NULL` and `flat_id IS NULL`.
6. **`F-B21-06` (HIGH — Migration & `01_schema.sql` Parity):**
   - Reconcile `TIMESTAMP(3)` vs `TIMESTAMPTZ`, `TEXT` vs `VARCHAR(n)` (or document exact intentional parity), `NOT NULL DEFAULT CURRENT_TIMESTAMP` on `created_at`/`updated_at`/`timestamp`, `ON UPDATE CASCADE`, and add `connamespace = current_schema()::regnamespace` to every `pg_constraint` guard in `migration.sql`.
7. **`F-B21-07` (HIGH — Legacy Data Migration Fidelity):**
   - Correct the migration strategy and schema defaults so legacy backfill never hardcodes `gender = 'MALE'`, never fabricates unflagged birthdates, preserves `exit_permission_status`, includes `EntityRecord` `collection = 'children'` and embedded `authorizedPickups[]`, makes `ChildExitLog.guardId` nullable for legacy rows, and invalidates/reissues weak 6-digit passes instead of hashing them.

---

## 4. Recommended Hardening (Strongly Advised in the Same Remediation Pass)

8. **`F-B21-08` (MEDIUM — Enums, `CHECK` Constraints, & Actor FKs):**
   - Replace unconstrained status/type/severity strings with Prisma enums (reusing `IncidentSeverity`).
   - Add SQL `CHECK` constraints (`max_uses >= 1`, `current_uses >= 0 AND current_uses <= max_uses`, `valid_until > valid_from`).
   - Add `User` foreign keys for `createdById`, `revokedById`, `guardId`, `acknowledgedById`, `resolvedById`, and `ChildAuthorizedPickup` FK for `ChildExitLog.pickupPersonId`.
9. **`F-B21-09` (MEDIUM — Stronger Schema & Parity Tests):**
   - Upgrade [tests/issue06_child_safety_schema.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_schema.test.ts) from substring checks to DMMF-driven relational assertions + structured SQL parity checks + negative security assertions (ensuring offline approval columns and plaintext ID columns cannot regress).

---

## 5. Gate Criteria for Passing Re-Audit

Phase B.2.1 will be eligible for **`CONDITIONAL PASS`** (pending live isolated PostgreSQL CI execution) or **`PASS`** (with isolated PostgreSQL execution) once:
1. Findings `F-B21-01` through `F-B21-07` are fully resolved in `schema.prisma`, the migration SQL, `scripts/postgres/01_schema.sql`, and the migration specification.
2. `F-B21-08` and `F-B21-09` are addressed so the schema enforces enums, `CHECK` bounds, actor FKs, and robust DMMF/SQL parity tests.
3. `prisma validate`, `prisma generate`, full Jest suite, backend TypeScript build, and frontend Vite build all pass cleanly with zero regressions to Phase B.1 Visitor Pass functionality.

---

## 6. Related Audit Deliverables

- [AARIZO_ISSUE06_PHASE_B2_STEP21_INDEPENDENT_AUDIT.md](file:///D:/AAZIRA/AARIZO/AARIZO_ISSUE06_PHASE_B2_STEP21_INDEPENDENT_AUDIT.md)
- [AARIZO_ISSUE06_PHASE_B2_STEP21_SECURITY_FINDINGS.md](file:///D:/AAZIRA/AARIZO/AARIZO_ISSUE06_PHASE_B2_STEP21_SECURITY_FINDINGS.md)
- [AARIZO_ISSUE06_PHASE_B2_STEP21_SCHEMA_SQL_PARITY.md](file:///D:/AAZIRA/AARIZO/AARIZO_ISSUE06_PHASE_B2_STEP21_SCHEMA_SQL_PARITY.md)

