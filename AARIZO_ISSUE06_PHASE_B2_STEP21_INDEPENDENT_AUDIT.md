# AARIZO — ISSUE-06 / Phase B.2.1: Independent Schema Audit

**Project:** `D:\AAZIRA\AARIZO`  
**Phase:** ISSUE-06 — B.2.1 Child Safety Relational Database Foundation  
**Mode:** STRICT READ-ONLY INDEPENDENT AUDIT  
**Audit Date:** November 18, 2026  
**Overall Verdict:** **FAIL — TARGETED CORRECTIONS REQUIRED BEFORE B.2.2**  

---

## 1. Audit Scope & Verification Methodology

This audit independently inspected the actual implemented source files without relying on claims in the B.2.1 implementation reports:

- [server/prisma/schema.prisma](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma) (lines 1–75, 76–125, 142–235, 493–510, 961–1119)
- [server/prisma/migrations/20261118000000_add_child_safety_models/migration.sql](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118000000_add_child_safety_models/migration.sql) (lines 1–214)
- [scripts/postgres/01_schema.sql](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql) (lines 326–467, 768–808)
- [tests/issue06_child_safety_schema.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_schema.test.ts) (lines 1–170)
- All five Step 2.1 reports (`IMPLEMENTATION_REPORT`, `SCHEMA_RELATIONSHIP_MATRIX`, `MIGRATION_STRATEGY`, `TEST_REPORT`, `REMAINING_RISKS`).

### Execution & Live Database Transparency
- **Read-only test check executed:** `npm test -- tests/issue06_child_safety_schema.test.ts` → **11/11 passed** (0.545s).
- **Live PostgreSQL integration:** **NOT PERFORMED.** Host port `5432` is occupied by an unrelated external container (`nexus-postgres`), and no migrations were executed against any live PostgreSQL instance. All schema checks remain static (Prisma CLI validation, generated client DMMF inspection, and Jest text/DMMF assertions).

---

## 2. Executive Summary of Findings

While Phase B.2.1 successfully introduced five structured Prisma models (`ChildProfile`, `ChildAuthorizedPickup`, `ChildGatePass`, `ChildExitLog`, `ChildSafetyAlert`) that pass `prisma validate` and generate a valid Prisma Client, independent audit uncovered **1 Critical**, **6 High**, and **2 Medium** defects that make proceeding to B.2.2 premature.

| ID | Severity | Domain | Summary |
| :--- | :--- | :--- | :--- |
| **F-B21-01** | **CRITICAL** | Gate-Pass Crypto & Offline Policy | Schema and docs embed **offline pass approval** (`OFFLINE_VERIFIED`, `OFFLINE_HMAC`, `signature`) violating fail-closed policy and exposing symmetric HMAC secrets to gate clients. |
| **F-B21-02** | **HIGH** | Multi-Tenant Integrity | All foreign keys are single-column; database allows cross-society links across `ChildProfile`, `ChildAuthorizedPickup`, `ChildGatePass`, `ChildExitLog`, and `ChildSafetyAlert`. |
| **F-B21-03** | **HIGH** | Pass Authorization & Enumeration | `passCode` (`CGP-xxxxxx`) is globally `@unique` (not society-scoped), has a redundant index, and poses a brute-force bypass vector if used as a gate lookup credential. |
| **F-B21-04** | **HIGH** | Privacy / PII Minimization | `ChildAuthorizedPickup.idProofNumber` is `NOT NULL` plaintext, forcing storage of raw government IDs (Aadhaar/Passport/DL) in violation of data minimization requirements. |
| **F-B21-05** | **HIGH** | Audit Retention & Ownership | `onDelete: Cascade` on `ChildProfile -> ChildGatePass/ChildAuthorizedPickup` and `Society -> ChildExitLog/ChildSafetyAlert` contradicts claimed immutable audit retention; `ChildProfile` allows both `residentId` and `flatId` to be `NULL`. |
| **F-B21-06** | **HIGH** | Migration & SQL Parity | Significant structural drift between `migration.sql` and `01_schema.sql`: `TIMESTAMP(3)` vs `TIMESTAMPTZ`, `TEXT` vs `VARCHAR(n)`, nullable vs `NOT NULL` timestamps, missing `ON UPDATE CASCADE`, and namespace-blind `pg_constraint` checks. |
| **F-B21-07** | **HIGH** | Legacy Data Migration | Migration strategy hardcodes `gender = 'MALE'`, fabricates DOB from integer age, collapses `exit_permission_status` to `'SAFE'`, drops secondary guardians/embedded pickups, and completely omits `EntityRecord` collection `'children'`. |
| **F-B21-08** | **MEDIUM** | Status Constraints & Actor FKs | All 9 status/type/severity fields are unconstrained `String` (ignoring existing `IncidentSeverity` enum); missing `CHECK` bounds (`current_uses <= max_uses`, `valid_until > valid_from`) and missing actor FKs (`createdById`, `revokedById`, `guardId`, `acknowledgedById`, `resolvedById`). |
| **F-B21-09** | **MEDIUM** | Test Quality | 9 of 11 tests are fragile raw-text `.toContain()` assertions; zero tests validate DMMF `onDelete` actions, column-level SQL parity, tenant constraints, or live PostgreSQL behavior. |

---

## 3. Section-by-Section Independent Assessment

### A. Child Ownership & Tenant Integrity
1. **Verified existing models:** `Society` ([schema.prisma#L76](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L76)), `Flat` ([schema.prisma#L142](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L142)), `User` ([schema.prisma#L170](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L170)), and `Resident` ([schema.prisma#L204](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L204)) all exist in Prisma. Referencing `Resident` and `Flat` matches existing `VisitorPass`, `Parcel`, and `FamilyMember` conventions.
2. **Orphan ownership defect:** In `ChildProfile` ([schema.prisma#L968-L969](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L968-L969)), both `residentId` and `flatId` are nullable (`String?`) with no database `CHECK` constraint (`resident_id IS NOT NULL OR flat_id IS NOT NULL` or mandatory `resident_id` for active children). Deleting a `Resident` triggers `onDelete: SetNull`, silently leaving an active child (`status = 'SAFE'`) with no linked guardian account.
3. **Cross-society relational gap:** None of the five new tables use composite unique constraints (`@@unique([societyId, id])`) or composite foreign keys (`(societyId, childId)`). Consequently, PostgreSQL will accept a `ChildGatePass` with `societyId = 'soc-A'` referencing a `ChildProfile` in `'soc-B'` and a `ChildAuthorizedPickup` in `'soc-C'`. The B.2.1 relationship matrix report overstated tenant isolation by claiming cross-society relationships are "impossible".

### B. Gate-Pass Cryptographic Design & Fail-Closed Policy
1. **Raw token storage:** `ChildGatePass.tokenHash` ([schema.prisma#L1031](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1031)) avoids storing raw QR bearer tokens. However, the schema alone cannot enforce token entropy (must be >= 256-bit CSPRNG in B.2.2) and stores plaintext `passCode` ([schema.prisma#L1030](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1030)) with a global unique constraint and redundant index (`idx_child_passes_code`, line 1056).
2. **CRITICAL — Offline approval & HMAC secret exposure:** `ChildGatePass.signature` ([schema.prisma#L1032](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1032)), `ChildExitLog.status` comment `OFFLINE_VERIFIED` ([schema.prisma#L1073](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1073)), and `ChildExitLog.verificationMode` comment `OFFLINE_HMAC` ([schema.prisma#L1074](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1074)) explicitly bake offline gate approval into the database foundation.
   - **Policy violation:** Offline approval violates the mandatory **fail-closed** policy. When the backend is unreachable, a gate device cannot check pass revocation, active `MISSING` child alerts, or single-use consumption at another gate.
   - **Cryptographic flaw:** HMAC-SHA256 is symmetric. Distributing the verification key to gate browsers/tablets gives any compromised gate device the signing key needed to forge arbitrary child exit passes.
3. **Atomic one-time consumption readiness:** `currentUses`, `maxUses`, `status`, `validFrom`, `validUntil`, `firstUsedAt`, `lastUsedAt`, and `revokedAt` provide the basic columns for a conditional atomic `UPDATE ... WHERE status = 'ACTIVE' AND current_uses < max_uses` transaction, **but** lack DB-level `CHECK` constraints (`current_uses >= 0 AND current_uses <= max_uses`, `max_uses >= 1`, `valid_until > valid_from`), lack Prisma enums for `status`, and omit `revokedById`.

### C. Audit History & Deletion Behavior
1. **Contradictory cascades:**
   - `ChildProfile -> ChildGatePass` ([schema.prisma#L1050](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1050)) and `ChildProfile -> ChildAuthorizedPickup` ([schema.prisma#L1016](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1016)) both use `onDelete: Cascade`. Deleting a `ChildProfile` destroys all historical passes and authorized escort records.
   - `Society -> ChildExitLog` ([schema.prisma#L1078](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1078)) and `Society -> ChildSafetyAlert` ([schema.prisma#L1110](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1110)) use `onDelete: Cascade`, contradicting the B.2.1 report's claim that exit logs are "permanently preserved".
2. **Soft-deletion absence:** None of `ChildProfile`, `ChildAuthorizedPickup`, or `ChildGatePass` include `archivedAt` / `deletedAt` soft-delete columns or `onDelete: Restrict` protections.
3. **Audit completeness gaps in `ChildExitLog`:** `guardId` ([schema.prisma#L1071](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1071)) has no foreign key to `users(id)`, and `pickupPersonId` is omitted entirely (only `pickupPersonName` and `pickupPersonPhone` strings are saved).

### D. SOS & Emergency Incident Relationships
1. **Optional `EmergencyIncident` link:** `ChildSafetyAlert.emergencyIncidentId` ([schema.prisma#L1106](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1106)) is optional (`onDelete: SetNull`), which is architecturally appropriate so non-dispatch alerts or pre-escalation child alerts can exist independently while critical SOS alerts link to `emergency_incidents`.
2. **Auditability gaps:**
   - `severity` ([schema.prisma#L1096](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1096)) is plain `String` instead of reusing the existing `IncidentSeverity` enum ([schema.prisma#L69-L74](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L69-L74)).
   - `acknowledgedBy` and `resolvedBy` ([schema.prisma#L1102](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1102), [#L1104](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1104)) are unverified display-name strings with no `acknowledgedById` / `resolvedById` foreign keys referencing `users(id)`.
   - Original event columns (`childName`, `flatNumber`, `alertType`, `location`, `description`, `lastSeenDetails`, `createdAt`) are preserved separately from resolution columns.

### E. Migration & SQL Parity
Detailed column-by-column analysis is provided in [AARIZO_ISSUE06_PHASE_B2_STEP21_SCHEMA_SQL_PARITY.md](file:///D:/AAZIRA/AARIZO/AARIZO_ISSUE06_PHASE_B2_STEP21_SCHEMA_SQL_PARITY.md). Six concrete drift items were verified between `schema.prisma`, `migration.sql`, and `01_schema.sql`, plus multiple silent data-loss/corruption defects in the legacy migration strategy.

### F. Test Quality
In [tests/issue06_child_safety_schema.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_schema.test.ts):
- **9 of 11 tests** perform raw substring matching (`expect(content).toContain(...)`) on source files.
- **2 of 11 tests** inspect `prisma.<delegate>` existence and 5 field names on `ChildGatePass` via `Prisma.dmmf`.
- **0 tests** check DMMF relation `onDelete` actions, unique constraints across all models, enum usage, column-level parity between `migration.sql` and `01_schema.sql`, cross-society constraint enforcement, or live PostgreSQL migration execution.

