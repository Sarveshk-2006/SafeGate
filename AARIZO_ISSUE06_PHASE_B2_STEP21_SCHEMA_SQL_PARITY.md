# AARIZO — ISSUE-06 / Phase B.2.1: Schema, Migration & SQL Parity Analysis

**Project:** `D:\AAZIRA\AARIZO`  
**Phase:** ISSUE-06 — B.2.1 Child Safety Relational Database Foundation  
**Mode:** STRICT READ-ONLY INDEPENDENT AUDIT  
**Audit Date:** November 18, 2026  

---

## 1. Tri-Artifact Comparison Matrix

Comparison across:
- **Prisma Schema:** [server/prisma/schema.prisma#L961-L1119](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma#L961-L1119)
- **Prisma Migration:** [server/prisma/migrations/20261118000000_add_child_safety_models/migration.sql#L1-L214](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118000000_add_child_safety_models/migration.sql#L1-L214)
- **Raw SQL Bootstrap:** [scripts/postgres/01_schema.sql#L342-L467](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L342-L467)

### 1.1 Global Structural Drift Summary

| Dimension | `schema.prisma` | `migration.sql` | `01_schema.sql` | Parity Status |
| :--- | :--- | :--- | :--- | :---: |
| **Table Names (5)** | `child_profiles`, `child_authorized_pickups`, `child_gate_passes`, `child_exit_logs`, `child_safety_alerts` | Identical (5 tables) | Identical (5 tables) | **MATCH** |
| **Column Names (90 total)** | All snake_case `@map(...)` | Identical | Identical | **MATCH** |
| **Datetime Types (18 cols)** | `DateTime` (no `@db.Timestamptz`) | `TIMESTAMP(3)` (no timezone) | `TIMESTAMPTZ` (with timezone) | **DRIFT (F-B21-06)** |
| **String Types (59 cols)** | `String` (no `@db.VarChar`) | `TEXT` (unbounded) | `VARCHAR(16/32/64/128/255)` + `TEXT` | **DRIFT (F-B21-06)** |
| **`created_at` / `timestamp` Nullability** | Non-null (`@default(now())`) | `NOT NULL DEFAULT CURRENT_TIMESTAMP` | **Nullable** `DEFAULT CURRENT_TIMESTAMP` (missing `NOT NULL`) | **DRIFT (F-B21-06)** |
| **`updated_at` Nullability & Default** | Non-null (`@updatedAt`) | `NOT NULL` (**no SQL default**) | **Nullable** `DEFAULT CURRENT_TIMESTAMP` (plus `trg_set_updated_at` trigger) | **DRIFT (F-B21-06)** |
| **FK `ON UPDATE` Action (15 FKs)** | Prisma default (`Cascade`) | `ON UPDATE CASCADE` | Omitted (PostgreSQL default `ON UPDATE NO ACTION`) | **DRIFT (F-B21-06)** |
| **FK `ON DELETE` Actions (15 FKs)** | 7 `Cascade`, 8 `SetNull` | Matches Prisma | Matches Prisma | **MATCH (Policy Defect F-B21-05)** |
| **Unique Indexes (2)** | `passCode @unique`, `tokenHash @unique` | `CREATE UNIQUE INDEX IF NOT EXISTS ...` | Inline `UNIQUE NOT NULL` column constraints | **FUNCTIONAL MATCH (Scope Defect F-B21-03)** |
| **Secondary Indexes (16)** | 16 `@@index(...)` | 16 `CREATE INDEX IF NOT EXISTS ...` | 16 `CREATE INDEX IF NOT EXISTS ...` | **MATCH (1 Redundant: `idx_child_passes_code`)** |
| **SQL `CHECK` Constraints** | None | None | None | **MISSING (F-B21-05, F-B21-08)** |
| **Composite Tenant FKs** | None | None | None | **MISSING (F-B21-02)** |
| **`pg_constraint` Idempotency Scope** | N/A | Checks `conname` globally across all schemas | Uses inline table creation (`CREATE TABLE IF NOT EXISTS`) | **DEFECT (F-B21-06)** |

---

## 2. Table-by-Table Column & Constraint Parity Audit

### 2.1 `child_profiles`
- **Sources:** `schema.prisma#L961-L992`, `migration.sql#L2-L23, #L125-L127, #L152-L161`, `01_schema.sql#L343-L366`
- **Verified Drift:**
  - `date_of_birth`: `TIMESTAMP(3) NOT NULL` (`migration.sql#L9`) vs `TIMESTAMPTZ NOT NULL` (`01_schema.sql#L350`).
  - `created_at`: `TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP` (`migration.sql#L19`) vs `TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP` — **nullable** (`01_schema.sql#L360`).
  - `updated_at`: `TIMESTAMP(3) NOT NULL` with **no default** (`migration.sql#L20`) vs `TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP` — **nullable** (`01_schema.sql#L361`). Raw SQL inserts that omit `updated_at` fail on Prisma-migrated DBs (`NOT NULL` violation) but succeed on `01_schema.sql` DBs.
  - String lengths: `flat_number` (`VARCHAR(32)`), `gender` (`VARCHAR(16)`), `status` (`VARCHAR(32)`), `guardian_phone` (`VARCHAR(32)`), `emergency_phone` (`VARCHAR(32)`) are bounded in `01_schema.sql` but unbounded `TEXT` in `migration.sql`.
  - FKs (`society_id`, `resident_id`, `flat_id`): `ON UPDATE CASCADE` in `migration.sql#L153-L159` vs `ON UPDATE NO ACTION` in `01_schema.sql#L345-L347`.
  - Missing `CHECK` constraint preventing both `resident_id` and `flat_id` from being `NULL` simultaneously.

### 2.2 `child_authorized_pickups`
- **Sources:** `schema.prisma#L994-L1021`, `migration.sql#L26-L43, #L130-L132, #L165-L171`, `01_schema.sql#L368-L387`
- **Verified Drift:**
  - `valid_until`: `TIMESTAMP(3)` vs `TIMESTAMPTZ`.
  - `created_at` / `updated_at`: same nullability and missing `updated_at` default drift as `child_profiles`.
  - `id_proof_type` / `id_proof_number`: both `NOT NULL` in all three artifacts (privacy defect `F-B21-04`); `TEXT` vs `VARCHAR(64)`.
  - FKs (`society_id`, `child_id`): `ON UPDATE CASCADE` vs `ON UPDATE NO ACTION`; both `ON DELETE CASCADE` (audit defect `F-B21-05`); single-column (tenant defect `F-B21-02`).

### 2.3 `child_gate_passes`
- **Sources:** `schema.prisma#L1023-L1059`, `migration.sql#L46-L71, #L121-L122, #L135-L138, #L175-L184`, `01_schema.sql#L389-L417`
- **Verified Drift:**
  - Datetime columns (`valid_from`, `valid_until`, `first_used_at`, `last_used_at`, `revoked_at`, `created_at`, `updated_at`): `TIMESTAMP(3)` vs `TIMESTAMPTZ`; `created_at` & `updated_at` nullable in `01_schema.sql`; `updated_at` lacks SQL default in `migration.sql`.
  - `pass_code`: `UNIQUE` (`child_gate_passes_pass_code_key`) **plus** redundant secondary index `idx_child_passes_code` in both `migration.sql#L121,#L137` and `01_schema.sql#L394,#L416`.
  - `signature`: present in all three artifacts (`migration.sql#L53`, `01_schema.sql#L396`) — **Critical fail-closed policy violation (`F-B21-01`)**.
  - `created_by_id`: present without a `users(id)` FK in all three artifacts (`F-B21-08`).
  - Missing `CHECK` constraints (`max_uses >= 1`, `current_uses >= 0 AND current_uses <= max_uses`, `valid_until > valid_from`).

### 2.4 `child_exit_logs`
- **Sources:** `schema.prisma#L1061-L1085`, `migration.sql#L74-L92, #L141-L143, #L188-L197`, `01_schema.sql#L419-L439`
- **Verified Drift:**
  - `timestamp`: `TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP` (`migration.sql#L89`) vs `TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP` — **nullable** (`01_schema.sql#L434`).
  - `verification_mode`: `TEXT` vs `VARCHAR(32)`; schema comment embeds `OFFLINE_HMAC` (`F-B21-01`).
  - `guard_id`: `NOT NULL` with no FK to `users(id)`.
  - `society_id` FK: `ON DELETE CASCADE` contradicts claimed immutable retention (`F-B21-05`); `ON UPDATE CASCADE` vs `NO ACTION`.

### 2.5 `child_safety_alerts`
- **Sources:** `schema.prisma#L1087-L1119`, `migration.sql#L95-L118, #L146-L148, #L201-L213`, `01_schema.sql#L441-L466`
- **Verified Drift:**
  - `acknowledged_at`, `resolved_at`, `created_at`, `updated_at`: `TIMESTAMP(3)` vs `TIMESTAMPTZ`; `created_at` & `updated_at` nullable in `01_schema.sql`; `updated_at` lacks SQL default in `migration.sql`.
  - `severity`: `TEXT` / `VARCHAR(32)` instead of reusing `IncidentSeverity` enum (`schema.prisma#L69-L74`).
  - `acknowledged_by` / `resolved_by`: free-text display names without `User` FKs (`F-B21-08`).
  - `society_id` FK: `ON DELETE CASCADE` (`F-B21-05`); `ON UPDATE CASCADE` vs `NO ACTION`.

---

## 3. Idempotency & Re-Runnability Assessment

1. **Table & Index DDL (`migration.sql#L2-L148`):** Uses `CREATE TABLE IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`, and `CREATE INDEX IF NOT EXISTS` — idempotent on fresh or partially initialized databases in the default `public` schema.
2. **Foreign Key Guards (`migration.sql#L151-L213`):** Uses `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '...') THEN ALTER TABLE ... END IF; END $$;`.
   - **Defect:** `pg_constraint` is catalog-wide across all PostgreSQL schemas. Without `AND connamespace = current_schema()::regnamespace`, a constraint with the same name in a staging/backup/shadow schema causes `migration.sql` to silently skip creating the FK in the target schema.
3. **Trigger Discrepancy (`01_schema.sql#L789-L810`):** `01_schema.sql` installs a `BEFORE UPDATE` trigger (`trg_set_updated_at`) on all tables with an `updated_at` column, whereas `migration.sql` does not install any trigger (relying solely on Prisma client `@updatedAt`). Direct SQL updates will refresh `updated_at` on `01_schema.sql`-bootstrapped databases but leave `updated_at` stale on Prisma-migrated databases.

---

## 4. Legacy Data Migration Strategy Audit

Audit of [AARIZO_ISSUE06_PHASE_B2_STEP21_MIGRATION_STRATEGY.md](file:///D:/AAZIRA/AARIZO/AARIZO_ISSUE06_PHASE_B2_STEP21_MIGRATION_STRATEGY.md) against actual legacy schemas and repositories:

| Legacy Source | Verified Migration Defect | Severity |
| :--- | :--- | :---: |
| **`child_safety` SQL table** ([01_schema.sql#L326-L340](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L326-L340)) | Backfill SQL ([line 110](file:///D:/AAZIRA/AARIZO/AARIZO_ISSUE06_PHASE_B2_STEP21_MIGRATION_STRATEGY.md#L110)) hardcodes `'MALE' AS gender` for every child. | **HIGH** |
| **`child_safety` SQL table** | Backfill SQL ([line 109](file:///D:/AAZIRA/AARIZO/AARIZO_ISSUE06_PHASE_B2_STEP21_MIGRATION_STRATEGY.md#L109)) synthesizes exact `date_of_birth` from integer `age` with no `estimated` flag, silently fabricating false birthdates. | **HIGH** |
| **`child_safety` SQL table** | Mapping ([line 86](file:///D:/AAZIRA/AARIZO/AARIZO_ISSUE06_PHASE_B2_STEP21_MIGRATION_STRATEGY.md#L86)) collapses `exit_permission_status` (`ALLOWED`, `DISALLOWED`, `TIMED_PASS`) all to `'SAFE'`, destroying legacy exit-policy state. | **HIGH** |
| **`EntityRecord` (`collection = 'children'`)** ([ChildRepository.ts](file:///D:/AAZIRA/AARIZO/src/repositories/childSafety/ChildRepository.ts)) | Completely omitted from Section 1 inventory and Section 2 mapping — rows created via `ChildRepository` would be stranded. | **HIGH** |
| **`EntityRecord` (`collection = 'child_profiles'`)** ([index.ts#L2686](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2686)) | Drops secondary `guardians[]` (plus guardian `email`/`relationship`), `emergencyContacts[]` (`name`/`relationship`), and omits migration of embedded `authorizedPickups[]` and `gatePassCode`. | **HIGH** |
| **`EntityRecord` (`collection = 'child_gate_passes'`)** ([index.ts#L2728](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2728)) | Hashing legacy 6-digit `passCode` into `token_hash` produces a trivially reversible hash (20-bit keyspace); `verifiedByGuard` name string cannot satisfy `ChildExitLog.guard_id NOT NULL`; strategy line 62 prescribes computing offline `signature` (violates `F-B21-01`). | **HIGH** |

### Safe Migration Path Required
Before any production or staging backfill runs:
1. Inventory **all** legacy sources including `EntityRecord` `collection = 'children'`, `'child_profiles'`, `'child_gate_passes'`, and legacy `child_safety`.
2. Preserve unknown fields honestly (`gender` nullable or `'UNSPECIFIED'`, `dateOfBirth` nullable or flagged `dobIsEstimated`, `exit_permission_status` reconciled to `allowedSoloExit` + audit note) — **never fabricate demographic values**.
3. Extract embedded `authorizedPickups[]` into `child_authorized_pickups` (masking any legacy ID numbers to last 4 digits only).
4. Expire/reissue legacy 6-digit active passes on cutover instead of hashing weak codes into `token_hash`.
5. Make `ChildExitLog.guardId` nullable so legacy verified passes with only a guard display name migrate cleanly without fake user IDs.

