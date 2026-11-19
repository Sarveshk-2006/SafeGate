# AARIZO — ISSUE-06 / Phase B.2.1: Security & Data Integrity Findings

**Project:** `D:\AAZIRA\AARIZO`  
**Phase:** ISSUE-06 — B.2.1 Child Safety Relational Database Foundation  
**Mode:** STRICT READ-ONLY INDEPENDENT AUDIT  
**Audit Date:** November 18, 2026  

---

## Finding Severity Distribution

| Severity | Count | Finding IDs |
| :--- | :---: | :--- |
| **CRITICAL** | 1 | `F-B21-01` |
| **HIGH** | 6 | `F-B21-02`, `F-B21-03`, `F-B21-04`, `F-B21-05`, `F-B21-06`, `F-B21-07` |
| **MEDIUM** | 2 | `F-B21-08`, `F-B21-09` |

---

## F-B21-01 (CRITICAL) — Offline Pass Approval Policy Violation & Symmetric HMAC Secret Exposure

### Evidence
- [server/prisma/schema.prisma#L1032](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1032): `signature String? // Optional HMAC-SHA256 for offline fallback`
- [server/prisma/schema.prisma#L1073-L1074](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1073-L1074):
  ```prisma
  status String // ALLOWED, DENIED, OFFLINE_VERIFIED, MISSING_ALERT_BLOCKED
  verificationMode String @default("ONLINE") @map("verification_mode") // ONLINE, OFFLINE_HMAC
  ```
- [server/prisma/migrations/20261118000000_add_child_safety_models/migration.sql#L53](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118000000_add_child_safety_models/migration.sql#L53) and [#L87](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118000000_add_child_safety_models/migration.sql#L87)
- [scripts/postgres/01_schema.sql#L396](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L396) and [#L432](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L432)
- [AARIZO_ISSUE06_PHASE_B2_STEP21_IMPLEMENTATION_REPORT.md](file:///D:/AAZIRA/AARIZO/AARIZO_ISSUE06_PHASE_B2_STEP21_IMPLEMENTATION_REPORT.md) and [AARIZO_ISSUE06_PHASE_B2_STEP21_MIGRATION_STRATEGY.md#L62](file:///D:/AAZIRA/AARIZO/AARIZO_ISSUE06_PHASE_B2_STEP21_MIGRATION_STRATEGY.md#L62) explicitly encode offline gate-terminal HMAC verification as a first-class approval mode.

### Security & Policy Impact
1. **Violation of Fail-Closed Gate Policy:** Child exit authorization is safety-critical. Allowing a gate scanner to mark an exit `OFFLINE_VERIFIED` when the backend is unreachable defeats three core controls simultaneously:
   - **Revocation bypass:** A parent revoking a pass cannot stop an offline gate from honoring it.
   - **Missing-child override bypass:** An active `MISSING` alert on `ChildProfile` / `ChildSafetyAlert` cannot block the exit offline.
   - **Replay / multi-gate reuse:** A single-use pass (`maxUses = 1`) can be presented at multiple gates or reused while offline.
2. **Symmetric Secret Compromise:** `HMAC-SHA256` uses the same secret key to sign and verify. If a gate browser, PWA, or tablet verifies `signature` offline, the HMAC secret must reside on the client device. Any attacker who extracts that key from a single guard tablet can forge valid child gate passes for any child in the society (or platform-wide if a global secret is used).

### Required Remediation
- Remove offline pass approval semantics (`OFFLINE_VERIFIED`, `OFFLINE_HMAC`) and remove `ChildGatePass.signature` from the schema, migration, `01_schema.sql`, and design documents.
- Require online authoritative backend verification for every child exit pass; if the backend is unavailable, the gate scanner must **fail closed** (block exit and require documented manual guardian/admin override logged online upon recovery, or explicit phone-verified protocol—never cryptographic offline auto-approval).
- Use server-side keyed token hashing (`HMAC-SHA256(server_pepper, raw_token)` or `SHA-256(raw_token)` over >= 256-bit CSPRNG secret) stored exclusively in `token_hash`, verified exclusively on the backend.

---

## F-B21-02 (HIGH) — Cross-Society Relational Integrity Not Enforced by Database

### Evidence
- [server/prisma/schema.prisma#L985-L987](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L985-L987): `ChildProfile` references `Resident(id)` and `Flat(id)` via single-column FKs.
- [server/prisma/schema.prisma#L1016](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1016): `ChildAuthorizedPickup.childId` references `ChildProfile(id)` without `societyId`.
- [server/prisma/schema.prisma#L1050-L1051](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1050-L1051): `ChildGatePass.childId` and `pickupPersonId` reference `ChildProfile(id)` and `ChildAuthorizedPickup(id)` without `societyId`.
- [server/prisma/schema.prisma#L1079-L1080](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1079-L1080) and [#L1111-L1113](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1111-L1113): `ChildExitLog` and `ChildSafetyAlert` reference child, pass, user, and `EmergencyIncident` without `societyId`.
- [server/prisma/migrations/20261118000000_add_child_safety_models/migration.sql#L151-L213](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118000000_add_child_safety_models/migration.sql#L151-L213): Confirms every FK is single-column.

### Security & Integrity Impact
- PostgreSQL permits a `ChildGatePass` belonging to `society-A` to link a `ChildProfile` in `society-B` and a `ChildAuthorizedPickup` in `society-C`.
- PostgreSQL permits a `ChildProfile` in `society-A` to link a `Resident` in `society-B` and a `Flat` in `society-C`.
- A single missing tenant filter in a B.2.2 query or migration script can create silent cross-tenant data corruption or unauthorized pickup authorization.
- Directly contradicts the B.2.1 `SCHEMA_RELATIONSHIP_MATRIX.md` claim that cross-society relationships are "impossible".

### Required Remediation
- Add composite unique constraints `@@unique([societyId, id])` on `ChildProfile`, `ChildAuthorizedPickup`, and `ChildGatePass` (and on `Resident`, `Flat`, `EmergencyIncident` if safe for existing migrations).
- Enforce composite foreign keys `(societyId, childId) -> ChildProfile(societyId, id)`, `(societyId, pickupPersonId) -> ChildAuthorizedPickup(societyId, id)`, and `(societyId, passId) -> ChildGatePass(societyId, id)`.
- Where optional composite FKs with `ON DELETE SET NULL` are nuanced in PostgreSQL (setting `society_id` to `NULL` is undesirable when `society_id NOT NULL`), either use `ON DELETE RESTRICT` + soft-delete (recommended per F-B21-05) or PostgreSQL 15+ `ON DELETE SET NULL (child_id)` / explicit database triggers + documented B.2.2 transactional tenant checks.

---

## F-B21-03 (HIGH) — Unscoped Global `passCode`, Duplicate Index, & Brute-Force Bypass Risk

### Evidence
- [server/prisma/schema.prisma#L1030](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1030): `passCode String @unique @map("pass_code") // e.g., CGP-839201`
- [server/prisma/schema.prisma#L1056](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1056): `@@index([passCode], map: "idx_child_passes_code")`
- [server/prisma/migrations/20261118000000_add_child_safety_models/migration.sql#L121](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118000000_add_child_safety_models/migration.sql#L121) and [#L137](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118000000_add_child_safety_models/migration.sql#L137)
- [scripts/postgres/01_schema.sql#L394](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L394) and [#L416](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L416)

### Security & Operational Impact
1. **Authorization Bypass / Enumeration:** A 6-digit code (`CGP-xxxxxx`, only 900,000–1,000,000 possibilities) has ~20 bits of entropy. If B.2.2 gate verification allows looking up and consuming a pass solely by `passCode`, an attacker can brute-force active passes and bypass the high-entropy `tokenHash`.
2. **Cross-Tenant Collision & Oracle:** `@unique` is global rather than `@@unique([societyId, passCode])`, causing unnecessary cross-tenant uniqueness collisions and potential existence leakage across societies.
3. **Redundant Index:** `idx_child_passes_code` creates a duplicate non-unique B-tree index on a column that already has a unique index (`child_gate_passes_pass_code_key`).

### Required Remediation
- Drop the redundant `idx_child_passes_code` index.
- Change uniqueness from global `@unique` to tenant-scoped `@@unique([societyId, passCode])`.
- Define `passCode` strictly as a human-readable display/reference identifier (never a standalone authorization token), or require high-entropy codes combined with strict server-side rate limiting, society scoping, and short TTL. Require `tokenHash` (derived from >= 256-bit CSPRNG bearer secret) for QR gate verification.

---

## F-B21-04 (HIGH) — Mandatory Plaintext Government ID Storage (`id_proof_number NOT NULL`)

### Evidence
- [server/prisma/schema.prisma#L1006-L1007](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1006-L1007):
  ```prisma
  idProofType   String @map("id_proof_type") // Aadhaar, Passport, DL, PAN
  idProofNumber String @map("id_proof_number")
  ```
- [server/prisma/migrations/20261118000000_add_child_safety_models/migration.sql#L33-L34](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118000000_add_child_safety_models/migration.sql#L33-L34)
- [scripts/postgres/01_schema.sql#L375-L376](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L375-L376)

### Privacy & Compliance Impact
- Requiring `id_proof_number NOT NULL` forces residents and admins to enter full plaintext Aadhaar, Passport, Driver's License, or PAN numbers for every authorized pickup person.
- Storing raw Aadhaar numbers in an application database violates data-minimization standards and poses serious legal/regulatory risk under India's Aadhaar Act and DPDP Act, as well as high breach blast radius if database backups or read replicas are exposed.

### Required Remediation
- Replace `idProofNumber` (`NOT NULL`) with optional masked storage:
  - `idProofType String? @map("id_proof_type")`
  - `idProofLast4 String? @map("id_proof_last4")` (bounded to max 4 characters, e.g. `VARCHAR(4)`)
  - Optionally `idProofHash String? @map("id_proof_hash")` (keyed HMAC-SHA256) only if backend duplicate detection is genuinely needed.
- Never store raw government ID numbers in plaintext.

---

## F-B21-05 (HIGH) — Destructive Cascade Deletions & Orphanable Child Ownership

### Evidence
- [server/prisma/schema.prisma#L968-L969](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L968-L969): `residentId String?` and `flatId String?` are both nullable with no `CHECK` constraint.
- [server/prisma/schema.prisma#L986](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L986): `resident Resident? @relation(..., onDelete: SetNull)`
- [server/prisma/schema.prisma#L1016](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1016): `ChildAuthorizedPickup.child` uses `onDelete: Cascade`
- [server/prisma/schema.prisma#L1050](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1050): `ChildGatePass.child` uses `onDelete: Cascade`
- [server/prisma/schema.prisma#L1078](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1078): `ChildExitLog.society` uses `onDelete: Cascade`
- [server/prisma/schema.prisma#L1110](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1110): `ChildSafetyAlert.society` uses `onDelete: Cascade`

### Integrity & Audit Impact
1. **Unowned Active Children:** An active `ChildProfile` (`status = 'SAFE'`) can be inserted with both `residentId = NULL` and `flatId = NULL`, or silently become unowned when a `Resident` record is deleted (`SetNull`). Ownership checks in B.2.2 (`residentId === req.authContext.residentId`) would leave orphaned children unmanageable by any guardian.
2. **Destroyed Authorization Trail:** Hard-deleting a `ChildProfile` cascade-deletes every `ChildAuthorizedPickup` and `ChildGatePass` ever issued for that child, destroying forensic linkage from `ChildExitLog` (whose `childId` and `passId` both collapse to `NULL`).
3. **Contradictory Audit Retention Claim:** Hard-deleting a `Society` cascades and wipes every `ChildExitLog` and `ChildSafetyAlert`, contradicting the B.2.1 report's claim that exit logs are "permanently preserved".

### Required Remediation
- Add soft-delete support (`archivedAt DateTime? @map("archived_at")`) on `ChildProfile`, `ChildAuthorizedPickup`, and `ChildGatePass`.
- Change `ChildAuthorizedPickup.child` and `ChildGatePass.child` from `onDelete: Cascade` to `onDelete: Restrict`.
- Change `ChildProfile.resident` from `onDelete: SetNull` to `onDelete: Restrict`, and add a database `CHECK` constraint ensuring active profiles always have valid ownership (e.g., `CHECK (resident_id IS NOT NULL OR flat_id IS NOT NULL)` — or `resident_id NOT NULL` for all active rows).
- Change `ChildExitLog.society` and `ChildSafetyAlert.society` to `onDelete: Restrict` (or explicitly document tenant offboarding/retention export requirements rather than claiming permanent preservation).

---

## F-B21-06 (HIGH) — Structural Drift Between `schema.prisma`, `migration.sql`, and `01_schema.sql`

### Evidence
Full table-by-table diff is documented in [AARIZO_ISSUE06_PHASE_B2_STEP21_SCHEMA_SQL_PARITY.md](file:///D:/AAZIRA/AARIZO/AARIZO_ISSUE06_PHASE_B2_STEP21_SCHEMA_SQL_PARITY.md). Six verified drift defects:
1. **Timestamp timezone mismatch:** All 18 datetime columns are `TIMESTAMP(3)` (no timezone) in `migration.sql` vs `TIMESTAMPTZ` in `01_schema.sql`.
2. **String type mismatch:** All string columns are unbounded `TEXT` in `migration.sql` vs bounded `VARCHAR(16/32/64/128/255)` in `01_schema.sql`.
3. **Nullability & default mismatch:** `created_at`, `updated_at`, and `timestamp` are `NOT NULL` in `migration.sql` (and `updated_at` has **no** SQL default in `migration.sql`) vs **nullable** with `DEFAULT CURRENT_TIMESTAMP` in `01_schema.sql`.
4. **FK update action mismatch:** `migration.sql` uses `ON UPDATE CASCADE` on all 15 FKs; `01_schema.sql` omits `ON UPDATE` (PostgreSQL defaults to `ON UPDATE NO ACTION`).
5. **Redundant index:** `idx_child_passes_code` duplicated in both files alongside the unique index on `pass_code`.
6. **Namespace-blind idempotency guard:** [migration.sql#L152-L211](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118000000_add_child_safety_models/migration.sql#L152-L211) queries `SELECT 1 FROM pg_constraint WHERE conname = ...` without filtering `connamespace = current_schema()::regnamespace`, risking skipped FKs in multi-schema PostgreSQL databases.

### Required Remediation
- Use `@db.Timestamptz(3)` in `schema.prisma` (or align both files identically), add `NOT NULL DEFAULT CURRENT_TIMESTAMP` on `created_at`, `updated_at`, and `timestamp` in both `migration.sql` and `01_schema.sql`, align `ON UPDATE CASCADE`, drop `idx_child_passes_code`, and add `AND connamespace = current_schema()::regnamespace` to every `pg_constraint` guard.

---

## F-B21-07 (HIGH) — Legacy Data Migration Strategy Corrupts/Drops Fields & Omits `collection = 'children'`

### Evidence
- [AARIZO_ISSUE06_PHASE_B2_STEP21_MIGRATION_STRATEGY.md#L10-L24](file:///D:/AAZIRA/AARIZO/AARIZO_ISSUE06_PHASE_B2_STEP21_MIGRATION_STRATEGY.md#L10-L24), [#L86](file:///D:/AAZIRA/AARIZO/AARIZO_ISSUE06_PHASE_B2_STEP21_MIGRATION_STRATEGY.md#L86), [#L109-L112](file:///D:/AAZIRA/AARIZO/AARIZO_ISSUE06_PHASE_B2_STEP21_MIGRATION_STRATEGY.md#L109-L112)
- [scripts/postgres/01_schema.sql#L326-L340](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L326-L340) (legacy `child_safety` table)
- [src/repositories/childSafety/ChildRepository.ts](file:///D:/AAZIRA/AARIZO/src/repositories/childSafety/ChildRepository.ts) (writes `EntityRecord` under `collection = 'children'`)

### Integrity & Data-Loss Impact
1. **Fabricated gender:** Line 110 hardcodes `'MALE' AS gender` for every legacy `child_safety` row.
2. **Fabricated exact DOB:** Line 109 computes `CURRENT_DATE - (cs.age * INTERVAL '1 year')` without flagging the date as estimated (making `date_of_birth` silently inaccurate).
3. **Lost exit-permission semantics:** Line 86 maps `ALLOWED`, `DISALLOWED`, and `TIMED_PASS` all to `'SAFE'`, losing the legacy `exit_permission_status` policy distinction.
4. **Dropped nested data:** `ChildProfile` drops secondary `guardians[]` (and guardian `email`/`relationship`), `emergencyContacts[]` (`name`/`relationship`), and embedded `authorizedPickups[]` / `gatePassCode` from `EntityRecord` `child_profiles`.
5. **Omitted collection:** `EntityRecord` rows stored under `collection = 'children'` (used by `ChildRepository.ts`) are completely omitted from the migration inventory and backfill plan.
6. **Weak/unmappable legacy passes & guards:** Legacy `child_gate_passes` only contain 6-digit `passCode` (hashing 6 digits into `token_hash` is trivially reversible) and guard display name `verifiedByGuard` (cannot populate `ChildExitLog.guard_id NOT NULL`).

### Required Remediation
- Make `gender` nullable or default `'UNSPECIFIED'` (never force `'MALE'`).
- Make `dateOfBirth` nullable (or add `dobIsEstimated Boolean @default(false)` / `legacyAge Int?`) so legacy rows do not fabricate fake birthdates.
- Document explicit migration handling for `collection = 'children'`, embedded `authorizedPickups[]`, multiple guardians/emergency contacts, and `exit_permission_status`.
- Invalidate/reissue legacy 6-digit active passes during cutover instead of hashing weak codes into `token_hash`, and make `ChildExitLog.guardId` nullable (with `guardName` preserved) for historical backfill rows where only a guard name existed.

---

## F-B21-08 (MEDIUM) — Unconstrained String Statuses, Missing `CHECK` Bounds, & Missing Actor FKs

### Evidence
- **9 unconstrained `String` status/enum columns:**
  - `ChildProfile.gender` ([#L973](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L973)), `ChildProfile.status` ([#L976](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L976))
  - `ChildAuthorizedPickup.status` ([#L1009](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1009))
  - `ChildGatePass.status` ([#L1037](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1037))
  - `ChildExitLog.status` ([#L1073](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1073)), `ChildExitLog.verificationMode` ([#L1074](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1074))
  - `ChildSafetyAlert.alertType` ([#L1095](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1095)), `severity` ([#L1096](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1096) — fails to reuse existing `enum IncidentSeverity` at [#L69-L74](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L69-L74)), `status` ([#L1097](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1097))
- **Missing `CHECK` constraints** in `migration.sql` and `01_schema.sql`:
  - `current_uses >= 0 AND current_uses <= max_uses`
  - `max_uses >= 1`
  - `valid_until > valid_from`
- **Missing Actor / Entity Foreign Keys:**
  - `ChildGatePass.createdById` ([#L1044](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1044)): plain `String?`, no FK to `User(id)`.
  - `ChildGatePass.revokedById`: missing entirely.
  - `ChildExitLog.guardId` ([#L1071](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1071)): plain `String`, no FK to `User(id)`.
  - `ChildExitLog.pickupPersonId`: missing entirely (only free-text `pickupPersonName`/`pickupPersonPhone`).
  - `ChildSafetyAlert.acknowledgedById` / `resolvedById`: missing entirely (only unverified name strings `acknowledgedBy`/`resolvedBy` at [#L1102](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1102), [#L1104](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1104)).

### Required Remediation
- Define explicit Prisma enums (`ChildStatus`, `PickupStatus`, `ChildGatePassStatus`, `ChildExitStatus`, `ChildAlertType`, `ChildAlertStatus`) and reuse `IncidentSeverity`.
- Add SQL `CHECK` constraints for `max_uses`, `current_uses`, and `valid_until > valid_from`.
- Add nullable `User` foreign keys (`onDelete: SetNull`) for `createdById`, `revokedById`, `guardId`, `acknowledgedById`, `resolvedById`, and optional `ChildAuthorizedPickup` FK for `ChildExitLog.pickupPersonId`.

---

## F-B21-09 (MEDIUM) — Shallow Substring-Only Tests & Unverified Live PostgreSQL Behavior

### Evidence
- [tests/issue06_child_safety_schema.test.ts#L1-L170](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_schema.test.ts#L1-L170)
  - 9 of 11 tests only call `expect(fileContent).toContain(...)` against raw text.
  - Only 2 tests inspect generated Prisma client/DMMF, and only check delegate presence + 5 fields on `ChildGatePass`.
  - 0 tests inspect DMMF `onDelete` actions, composite unique keys, enum definitions, column-by-column parity between `migration.sql` and `01_schema.sql`, or fail-closed constraints (in fact, tests at lines 48 and 107 implicitly tolerate `signature` and `OFFLINE_VERIFIED` without flagging them).
  - Live PostgreSQL migration execution was **NOT** performed.

### Required Remediation
- Upgrade [tests/issue06_child_safety_schema.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_schema.test.ts) to use `Prisma.dmmf.datamodel` to assert:
  - Every model's fields, enums, nullability, composite `@@unique`, composite FKs, and exact `onDelete` actions (`Restrict` vs `SetNull`).
  - Explicit negative assertions confirming `signature`, `OFFLINE_VERIFIED`, `OFFLINE_HMAC`, and plaintext `id_proof_number` do **not** exist.
  - Structured SQL parity comparison across `schema.prisma`, `migration.sql`, and `01_schema.sql` (table names, column names, types, nullability, defaults, indexes, FKs, and `CHECK` constraints).
- Execute real migration + constraint-violation tests against an isolated PostgreSQL test container when available (never touching host port `5432` / `nexus-postgres`).

