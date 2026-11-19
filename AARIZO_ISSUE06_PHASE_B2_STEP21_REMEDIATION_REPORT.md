# AARIZO — ISSUE-06 / Phase B.2.1 Remediation Report

**Project:** `D:\AAZIRA\AARIZO`  
**Phase:** ISSUE-06 — B.2.1 Child Safety Relational Database Foundation (Remediation)  
**Date:** November 18, 2026  
**Result:** **`REMEDIATION COMPLETE — READY FOR INDEPENDENT RE-AUDIT`**  

> **Note:** Phase B.2.1 is **NOT** declared closed here. Independent re-audit is mandatory before starting Phase B.2.2.

---

## 1. Scope Compliance Summary

Modified / created files strictly within Phase B.2.1 remediation scope:
- [server/prisma/schema.prisma](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma)
- [server/prisma/migrations/20261118010000_remediate_child_safety_constraints/migration.sql](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118010000_remediate_child_safety_constraints/migration.sql) *(new corrective migration; preserves `20261118000000_add_child_safety_models` untouched)*
- [scripts/postgres/01_schema.sql](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql) *(aligned child-safety enums, tables, constraints, and triggers; also fixed forward-reference bug to `emergency_incidents`; preserved `visitor_passes` and `users.password_hash`/`salt`)*
- [scripts/postgres/backfill_child_safety_b21.sql](file:///D:/AAZIRA/AARIZO/scripts/postgres/backfill_child_safety_b21.sql) *(idempotent legacy backfill & quarantine script — NOT executed against any external DB)*
- [tests/issue06_child_safety_schema.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_schema.test.ts) *(upgraded to DMMF + structured SQL parity + negative security assertions)*
- [tests/issue06_child_safety_db_constraints.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_db_constraints.test.ts) *(isolated live PostgreSQL 16 constraint, trigger, parity, and backfill suite gated by `AARIZO_ISOLATED_TEST_DATABASE_URL`)*
- Five B.2.1 remediation documentation deliverables.

**Untouched:** Child API routes, frontend services, gate scanner UI, realtime implementation, Phase B.1 Visitor Pass implementation, and unrelated external container `nexus-postgres` (port `5432`). No commits or pushes created.

---

## 2. Finding-by-Finding Remediation Matrix (F-B21-01 through F-B21-09)

### F-B21-01 (CRITICAL) — Complete Removal of Offline Pass Authorization & Symmetric HMAC Secrets
- **Original Finding:** `ChildGatePass.signature`, `OFFLINE_VERIFIED`, and `OFFLINE_HMAC` embedded offline gate approval into the database foundation, violating fail-closed child safety policy and exposing symmetric HMAC secrets to gate client devices.
- **Exact Remediation:**
  - Dropped `ChildGatePass.signature` completely from `schema.prisma`, `migration.sql` (`DROP COLUMN IF EXISTS "signature"`), and `01_schema.sql`.
  - Replaced `ChildExitLog.status` with enum `ChildExitOutcome` (`ALLOWED`, `DENIED`, `MISSING_ALERT_BLOCKED`, `VERIFICATION_UNAVAILABLE`) and `verificationMode` with enum `ChildVerificationChannel` (`ONLINE_QR_TOKEN`, `ONLINE_PASS_CODE_ASSISTED`, `MANUAL_OVERRIDE_DENIED`, `BACKEND_UNAVAILABLE`). Zero `OFFLINE_VERIFIED` or `OFFLINE_HMAC` values remain anywhere.
  - Added database-level fail-closed `CHECK` constraint `chk_child_exit_logs_unavailable_channel`: `CHECK (verification_channel <> 'BACKEND_UNAVAILABLE' OR outcome = 'VERIFICATION_UNAVAILABLE')`, making it impossible for PostgreSQL to record `ALLOWED` when the backend was unavailable.
  - Any legacy `OFFLINE_VERIFIED`/`OFFLINE_HMAC` rows encountered during migration are downgraded to `VERIFICATION_UNAVAILABLE` / `BACKEND_UNAVAILABLE` (never `ALLOWED`).
- **Changed Files & Line References:**
  - [schema.prisma#L132-L148](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L132-L148), [#L1153-L1223](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1153-L1223)
  - [migration.sql#L69-L83](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118010000_remediate_child_safety_constraints/migration.sql#L69-L83), [#L281-L397](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118010000_remediate_child_safety_constraints/migration.sql#L281-L397), [#L849-L858](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118010000_remediate_child_safety_constraints/migration.sql#L849-L858)
  - [01_schema.sql#L142-L157](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L142-L157), [#L514-L579](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L514-L579)
- **Tests Proving Correction:**
  - Static DMMF/SQL tests in [issue06_child_safety_schema.test.ts#L147-L169](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_schema.test.ts#L147-L169)
  - Live PostgreSQL 16 rejection of `(BACKEND_UNAVAILABLE, ALLOWED)` in [issue06_child_safety_db_constraints.test.ts#L267-L280](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_db_constraints.test.ts#L267-L280)
- **Unresolved Limitations:** Gate terminal UI & B.2.2 API enforcement of backend-unavailable indeterminate UX remains a B.2.2/B.2.3 deliverable.

---

### F-B21-02 (HIGH) — Cross-Society Relational Integrity
- **Original Finding:** All 15 foreign keys across the 5 child tables were single-column, allowing PostgreSQL to link children, residents, flats, pickups, passes, exit logs, and emergency incidents across different societies.
- **Exact Remediation:**
  - Added composite `@@unique([societyId, id])` on `Flat`, `Resident`, `EmergencyIncident`, `ChildProfile`, `ChildAuthorizedPickup`, and `ChildGatePass`, plus 3-column `@@unique([societyId, childId, id])` on `ChildAuthorizedPickup`.
  - Replaced all single-column domain FKs with composite tenant-scoped FKs:
    - `ChildProfile`: `(society_id, resident_id) -> residents(society_id, id)` and `(society_id, flat_id) -> flats(society_id, id)`.
    - `ChildAuthorizedPickup`: `(society_id, child_id) -> child_profiles(society_id, id)`.
    - `ChildGatePass`: `(society_id, child_id) -> child_profiles(society_id, id)` and 3-column `(society_id, child_id, pickup_person_id) -> child_authorized_pickups(society_id, child_id, id)` (prevents BOTH cross-society AND cross-child pickup assignment!).
    - `ChildExitLog`: `(society_id, child_id)`, `(society_id, pass_id)`, and `(society_id, pickup_person_id)`.
    - `ChildSafetyAlert`: `(society_id, child_id)` and `(society_id, emergency_incident_id) -> emergency_incidents(society_id, id)`.
  - **Architectural deviation explained (User actor FKs):** Because platform administrators legitimately have `users.society_id IS NULL` ([schema.prisma#L264](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L264)), a composite `(society_id, user_id)` FK to `users` would wrongly block platform admin actions. Instead, we kept nullable `User` FKs (`ON DELETE SET NULL`) AND enforced cross-society actor isolation in PostgreSQL via `BEFORE INSERT OR UPDATE` trigger function `enforce_child_safety_actor_tenant()` on all 5 child tables, which rejects any actor whose `users.society_id IS NOT NULL AND users.society_id <> NEW.society_id` (`ERRCODE 23514`) while permitting platform admins (`users.society_id IS NULL`).
- **Changed Files & Line References:**
  - [schema.prisma#L259](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L259), [#L335](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L335), [#L612](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L612), [#L1098-L1256](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1098-L1256)
  - [migration.sql#L118-L120](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118010000_remediate_child_safety_constraints/migration.sql#L118-L120), [#L527-L716](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118010000_remediate_child_safety_constraints/migration.sql#L527-L716), [#L900-L944](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118010000_remediate_child_safety_constraints/migration.sql#L900-L944)
  - [01_schema.sql#L237](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L237), [#L280](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L280), [#L437-L611](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L437-L611), [#L901-L917](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L901-L917), [#L990-L1034](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L990-L1034)
- **Tests Proving Correction:**
  - Static DMMF composite unique & FK tests: [issue06_child_safety_schema.test.ts#L171-L246](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_schema.test.ts#L171-L246)
  - Live PostgreSQL 16 rejections of cross-society resident, flat, pickup, emergency incident, wrong-child pickup, and cross-society actor user (plus platform-admin acceptance): [issue06_child_safety_db_constraints.test.ts#L163-L295](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_db_constraints.test.ts#L163-L295)
- **Unresolved Limitations:** B.2.2 routes must still scope all queries by authenticated `req.authContext.societyId` and verify `resident.flatId === flatId` inside transactions where business rules require flat-resident matching.

---

### F-B21-03 (HIGH) — Pass Code Scope, Redundant Index Removal & Authorization Separation
- **Original Finding:** `passCode` had global `@unique` plus duplicate index `idx_child_passes_code` and risked acting as a low-entropy brute-force bypass for `tokenHash`.
- **Exact Remediation:**
  - Changed `passCode` uniqueness to tenant-scoped `@@unique([societyId, passCode], map: "uq_child_passes_society_code")`.
  - Dropped old `child_gate_passes_pass_code_key` and redundant `idx_child_passes_code` in `migration.sql` and removed them from `schema.prisma` and `01_schema.sql`.
  - Retained unique `token_hash` with `CHECK (token_hash ~ '^[0-9a-f]{64}$')` (`chk_child_passes_token_hash_format`), enforcing 256-bit hex digests and preventing weak short codes from ever being written into `token_hash`.
  - **Display Code vs Authorization Credential Contract (for B.2.2):**
    - `pass_code`: Human-readable reference label ONLY (recommended >= 8 Crockford Base32 chars e.g. `CGP-XXXX-XXXX` with collision retry on `23505` within `(society_id, pass_code)`). NEVER sufficient standalone authorization at a gate.
    - `token_hash`: Authoritative gate credential derived exclusively server-side as `HMAC-SHA256(CHILD_PASS_TOKEN_PEPPER, rawToken)` over a >= 256-bit CSPRNG bearer token (`crypto.randomBytes(32)`). Raw bearer token is returned once at issuance; `tokenHash` is omitted from all ordinary list/detail API responses; gate verification requires authenticated guard role, society scoping, and rate limiting.
- **Changed Files & Line References:**
  - [schema.prisma#L1158-L1159](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1158-L1159), [#L1185-L1190](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1185-L1190)
  - [migration.sql#L149-L150](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118010000_remediate_child_safety_constraints/migration.sql#L149-L150), [#L520-L522](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118010000_remediate_child_safety_constraints/migration.sql#L520-L522), [#L819-L828](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118010000_remediate_child_safety_constraints/migration.sql#L819-L828)
  - [01_schema.sql#L514-L553](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L514-L553)
- **Tests Proving Correction:**
  - Static DMMF/SQL tests: [issue06_child_safety_schema.test.ts#L248-L267](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_schema.test.ts#L248-L267)
  - Live PostgreSQL 16 tests proving cross-society identical display codes succeed, same-society duplicates fail (`23505`), and non-64-hex `token_hash` is rejected: [issue06_child_safety_db_constraints.test.ts#L238-L266](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_db_constraints.test.ts#L238-L266)
- **Unresolved Limitations:** Rate limiting, constant-time token comparison, and DTO redaction of `tokenHash` are enforced in B.2.2 backend routes.

---

### F-B21-04 (HIGH) — Identity-Document Data Minimization
- **Original Finding:** `ChildAuthorizedPickup.idProofNumber` (`NOT NULL`) mandated storing full plaintext Aadhaar/Passport/DL/PAN numbers.
- **Exact Remediation:**
  - Dropped `id_proof_number` directly (`DROP COLUMN IF EXISTS "id_proof_number"`) without copying raw numbers into any other column.
  - Replaced with completely optional minimal verification metadata:
    - `id_document_type TEXT` (nullable)
    - `id_document_last4 VARCHAR(4)` (nullable; `CHECK (id_document_last4 IS NULL OR char_length(id_document_last4) BETWEEN 1 AND 4)`)
    - `id_document_hash TEXT` (nullable; `CHECK (id_document_hash IS NULL OR id_document_hash ~ '^[0-9a-f]{64}$')` — reserved strictly for server-keyed HMAC-SHA256 with key outside DB/clients if deduplication is ever required; ordinary unsalted hashing is prohibited)
    - `id_verification_status pickup_id_verification_status NOT NULL DEFAULT 'NOT_COLLECTED'`
    - `id_verified_at TIMESTAMPTZ(3)` and `verified_by_id` (`User` FK `ON DELETE SET NULL`).
- **Changed Files & Line References:**
  - [schema.prisma#L112-L120](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L112-L120), [#L1123-L1128](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1123-L1128)
  - [migration.sql#L216-L250](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118010000_remediate_child_safety_constraints/migration.sql#L216-L250), [#L770-L788](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118010000_remediate_child_safety_constraints/migration.sql#L770-L788)
  - [01_schema.sql#L126-L132](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L126-L132), [#L480-L512](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L480-L512)
  - [backfill_child_safety_b21.sql#L367-L407](file:///D:/AAZIRA/AARIZO/scripts/postgres/backfill_child_safety_b21.sql#L367-L407)
- **Tests Proving Correction:**
  - Static DMMF/SQL tests: [issue06_child_safety_schema.test.ts#L269-L298](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_schema.test.ts#L269-L298)
  - Live PostgreSQL 16 tests confirming pickups without ID succeed, plaintext hash is rejected (`chk_child_pickups_hash_format`), and legacy backfill strips raw Aadhaar: [issue06_child_safety_db_constraints.test.ts#L194-L208](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_db_constraints.test.ts#L194-L208), [#L380-L386](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_db_constraints.test.ts#L380-L386)
- **Unresolved Limitations:** Legacy `entity_records` JSON rows retain historical raw values until post-cutover cleanup phase (explicitly not deleted during B.2.1).

---

### F-B21-05 (HIGH) — Audit History Preservation & Child Ownership Enforcement
- **Original Finding:** `ChildProfile` permitted active rows with both `residentId` and `flatId` `NULL`, and `onDelete: Cascade` on `ChildProfile -> Pickups/Passes` and `Society -> ExitLogs/Alerts` contradicted immutable audit retention.
- **Exact Remediation:**
  - Enforced `chk_child_profiles_active_owner`: `CHECK (status = 'ARCHIVED' OR archived_at IS NOT NULL OR (resident_id IS NOT NULL AND flat_id IS NOT NULL))` (grounded in `Resident` always having required `flatId` in [schema.prisma#L304](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L304)) plus `chk_child_profiles_archive_consistency`.
  - Added soft-delete archival fields (`archivedAt` + `ARCHIVED` status enum) on `ChildProfile`, `ChildAuthorizedPickup`, and `ChildGatePass`, plus `archivedById` on `ChildProfile`.
  - Switched all 15 domain/tenant FKs across the 5 child tables from `Cascade`/`SetNull` to **`ON DELETE RESTRICT`** so hard-deleting a child, resident, flat, pickup person, pass, emergency incident, or society can NEVER silently destroy security audit history.
  - Kept all 10 `User` actor FKs as nullable **`ON DELETE SET NULL`** paired with immutable point-in-time name snapshots (`guardName`, `reportedByName`, `acknowledgedByName`, `resolvedByName`) so deactivating or removing a user account never breaks or erases historical exit logs or alerts.
- **Changed Files & Line References:**
  - [schema.prisma#L1093-L1256](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1093-L1256)
  - [migration.sql#L527-L760](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118010000_remediate_child_safety_constraints/migration.sql#L527-L760)
  - [01_schema.sql#L437-L611](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L437-L611)
- **Tests Proving Correction:**
  - Static DMMF `relationOnDelete` verification: [issue06_child_safety_schema.test.ts#L300-L355](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_schema.test.ts#L300-L355)
  - Live PostgreSQL 16 tests confirming NULL-owner rejection, `RESTRICT` blocking hard delete of child/pass/society, and `SET NULL` preserving `child_exit_logs` + `guard_name` upon user deletion: [issue06_child_safety_db_constraints.test.ts#L156-L162](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_db_constraints.test.ts#L156-L162), [#L298-L315](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_db_constraints.test.ts#L298-L315)
- **Unresolved Limitations:** Society offboarding / legal purge tooling (exporting logs before archival/purge) is outside B.2.1 scope.

---

### F-B21-06 (HIGH) — Migration & SQL Schema Parity
- **Original Finding:** Six drift defects existed between `schema.prisma`, `migration.sql`, and `01_schema.sql` (timestamps, string types, nullability/defaults, `ON UPDATE`, duplicate index, namespace-blind `pg_constraint`), plus a newly discovered forward-reference error in `01_schema.sql` (`child_safety_alerts` referencing `emergency_incidents` before it was created).
- **Exact Remediation:**
  - Standardized all 5 child tables to `TEXT` (with `id_document_last4 VARCHAR(4)`), `TIMESTAMPTZ(3)` (`@db.Timestamptz(3)`), `NOT NULL DEFAULT CURRENT_TIMESTAMP` on `created_at`/`updated_at`/`timestamp`, `ON UPDATE CASCADE`, and `set_updated_at()` triggers in BOTH the corrective migration and `01_schema.sql`.
  - Made every `pg_constraint` guard both schema-aware (`connamespace = current_schema()::regnamespace`) AND table-aware (`conrelid = to_regclass(...)`), and made `TIMESTAMPTZ(3)` conversion idempotent without local-timezone drift.
  - Fixed the `01_schema.sql` forward-reference defect by attaching `child_safety_alerts_society_id_emergency_incident_id_fkey` immediately after `emergency_incidents` is created.
  - Verified live PostgreSQL 16 parity across `aarizo_b21_prisma` (`prisma migrate deploy`) and `aarizo_b21_bootstrap` (`01_schema.sql`). Full proof in [AARIZO_ISSUE06_PHASE_B2_STEP21_UPDATED_SCHEMA_SQL_PARITY.md](file:///D:/AAZIRA/AARIZO/AARIZO_ISSUE06_PHASE_B2_STEP21_UPDATED_SCHEMA_SQL_PARITY.md).
- **Tests Proving Correction:**
  - Static DMMF-vs-SQL parser parity tests: [issue06_child_safety_schema.test.ts#L357-L420](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_schema.test.ts#L357-L420)
  - Live PostgreSQL 16 `information_schema.columns`, `pg_constraint`, `pg_indexes` diff + migration re-run idempotency test: [issue06_child_safety_db_constraints.test.ts#L414-L422](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_db_constraints.test.ts#L414-L422)
- **Unresolved Limitations:** Pre-existing repository convention where `IncidentSeverity` is PascalCase in `init_dwellora` vs `incident_severity` in `01_schema.sql` is preserved intentionally to avoid breaking existing `emergency_incidents` migrations.

---

### F-B21-07 (HIGH) — Legacy Data Migration & Quarantine Strategy
- **Original Finding:** Previous migration strategy fabricated `gender = 'MALE'`, synthesized exact DOB from integer age, collapsed `exit_permission_status` into `'SAFE'`, dropped secondary guardians and embedded pickups, omitted `EntityRecord` collection `'children'`, and proposed hashing weak 6-digit pass codes.
- **Exact Remediation:**
  - Added honest schema fields: nullable `dateOfBirth`, `reportedAge`, `ChildGender.UNSPECIFIED` default, `ChildExitPermissionMode` enum (`ESCORT_REQUIRED`, `SOLO_ALLOWED`, `TIMED_PASS_ONLY`, `UNKNOWN`), `secondaryGuardians`, `emergencyContacts`, and `legacySource`/`legacySourceId` idempotency key.
  - Authored [scripts/postgres/backfill_child_safety_b21.sql](file:///D:/AAZIRA/AARIZO/scripts/postgres/backfill_child_safety_b21.sql) with `child_safety_migration_quarantine`, covering `child_safety`, `entity_records` (`'child_profiles'`, `'children'`, `'child_gate_passes'`), and embedded `authorizedPickups[]` without fabricating values, without copying raw IDs, without overwriting authoritative edits, and without deleting legacy records.
  - Full operational runbook documented in [AARIZO_ISSUE06_PHASE_B2_STEP21_LEGACY_DATA_RECONCILIATION.md](file:///D:/AAZIRA/AARIZO/AARIZO_ISSUE06_PHASE_B2_STEP21_LEGACY_DATA_RECONCILIATION.md).
- **Tests Proving Correction:**
  - Static script invariant checks: [issue06_child_safety_schema.test.ts#L422-L436](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_schema.test.ts#L422-L436)
  - Live PostgreSQL 16 double-run idempotency + quarantine + non-overwrite verification on BOTH `entity_records` (`aarizo_b21_fresh`) and `child_safety` (`aarizo_b21_bootstrap`): [issue06_child_safety_db_constraints.test.ts#L317-L412](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_db_constraints.test.ts#L317-L412)
- **Unresolved Limitations:** Browser `localStorage` caches cannot be migrated server-side and must be reconciled/retired during B.2.3 frontend cutover.

---

### F-B21-08 (MEDIUM) — Database-Level Enums, CHECK Constraints & Actor FKs
- **Original Finding:** 9 unconstrained string status/type/severity columns, missing `CHECK` bounds, and missing actor FKs.
- **Exact Remediation:**
  - Introduced 10 focused Prisma enums + reused existing `IncidentSeverity` on `ChildSafetyAlert.severity`.
  - Added 16 named PostgreSQL `CHECK` constraints (date ranges, non-negative/bounded use counts, age bounds, DOB not in future, archive/revoke/ack/resolve timestamp consistency, token/ID hash format, fail-closed unavailable channel).
  - Added 10 nullable `User` actor FKs (`guardianUserId`, `archivedById`, `createdById` x2, `verifiedById`, `revokedById`, `guardId`, `reportedById`, `acknowledgedById`, `resolvedById`) and `ChildExitLog.pickupPersonId` composite FK.
- **Tests Proving Correction:** Verified both statically via DMMF ([issue06_child_safety_schema.test.ts#L74-L145](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_schema.test.ts#L74-L145), [#L377-L407](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_schema.test.ts#L377-L407)) and live on PostgreSQL 16 ([issue06_child_safety_db_constraints.test.ts#L220-L296](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_db_constraints.test.ts#L220-L296)).
- **Unresolved Limitations:** None at the database layer.

---

### F-B21-09 (MEDIUM) — Comprehensive Static & Isolated Live PostgreSQL Test Coverage
- **Original Finding:** Previous 11 tests relied mostly on brittle substring checks with no live PostgreSQL constraint verification.
- **Exact Remediation:**
  - Upgraded [tests/issue06_child_safety_schema.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_schema.test.ts) to 15 structural DMMF + SQL-parser parity + negative security tests.
  - Added [tests/issue06_child_safety_db_constraints.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_db_constraints.test.ts) and executed it against an ephemeral isolated `postgres:16-alpine` test container (`127.0.0.1:5439`, cleanly removed afterward, leaving `nexus-postgres` untouched).
- **Unresolved Limitations:** Default offline `npm test` skips the live DB integration file unless `AARIZO_ISOLATED_TEST_DATABASE_URL` is supplied (by design so CI/local runs never collide with external databases).

---

## 3. Final Remediation Status

**`REMEDIATION COMPLETE — READY FOR INDEPENDENT RE-AUDIT`**

