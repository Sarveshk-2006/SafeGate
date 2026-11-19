# AARIZO — ISSUE-06 / Phase B.2.1 Updated Schema & SQL Parity Report

**Project:** `D:\AAZIRA\AARIZO`  
**Phase:** ISSUE-06 — B.2.1 Child Safety Relational Database Foundation (Remediation)  
**Date:** November 18, 2026  

---

## 1. Live PostgreSQL 16 Catalog Comparison Methodology

Parity was verified **both statically** (DMMF-vs-SQL parser in [tests/issue06_child_safety_schema.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_schema.test.ts)) **and dynamically** against an isolated ephemeral `postgres:16-alpine` instance comparing two freshly initialized databases:
- **Database A (`aarizo_b21_prisma`):** Initialized exclusively via `npx --prefix server prisma migrate deploy` (all 6 migrations including `20261118010000_remediate_child_safety_constraints`).
- **Database B (`aarizo_b21_bootstrap`):** Initialized exclusively via `psql -v ON_ERROR_STOP=1 < scripts/postgres/01_schema.sql`.

---

## 2. Catalog-Level Parity Results (All 5 Child Safety Tables)

| Catalog Dimension | Prisma Migrated DB (`aarizo_b21_prisma`) | Bootstrap SQL DB (`aarizo_b21_bootstrap`) | Parity Result |
| :--- | :--- | :--- | :---: |
| **Tables (5)** | `child_profiles`, `child_authorized_pickups`, `child_gate_passes`, `child_exit_logs`, `child_safety_alerts` | Identical | **100% MATCH** |
| **Total Columns (109)** | `child_profiles` (27) + `child_authorized_pickups` (20) + `child_gate_passes` (23) + `child_exit_logs` (17) + `child_safety_alerts` (22) = **109 columns** | Identical **109 columns** | **100% MATCH (name, nullability, defaults, precision)** |
| **String Types** | `TEXT` (and `VARCHAR(4)` on `id_document_last4`) | `TEXT` (and `VARCHAR(4)` on `id_document_last4`) | **100% MATCH** |
| **Timestamp Types & Precision** | `TIMESTAMPTZ(3)` (`datetime_precision = 3`) on all 22 datetime columns | `TIMESTAMPTZ(3)` (`datetime_precision = 3`) on all 22 datetime columns | **100% MATCH** |
| **`created_at` / `updated_at` / `timestamp`** | `NOT NULL DEFAULT CURRENT_TIMESTAMP` | `NOT NULL DEFAULT CURRENT_TIMESTAMP` | **100% MATCH** |
| **New Child Safety Enums (10)** | `child_gender`, `child_status`, `child_exit_permission_mode`, `pickup_authorization_status`, `pickup_id_verification_status`, `child_gate_pass_status`, `child_exit_outcome`, `child_verification_channel`, `child_alert_type`, `child_alert_status` | Identical names and values | **100% MATCH** |
| **Severity Enum (`child_safety_alerts.severity`)** | `"IncidentSeverity"` (`NOT NULL DEFAULT 'CRITICAL'`) — matches `init_dwellora` `emergency_incidents.severity` | `incident_severity` (`NOT NULL DEFAULT 'CRITICAL'`) — matches `01_schema.sql` `emergency_incidents.severity` | **INTENTIONAL REPO-LEVEL CONVENTION** *(documented below)* |
| **Foreign Keys (25 FKs)** | 15 composite/tenant `ON DELETE RESTRICT ON UPDATE CASCADE` + 10 actor `ON DELETE SET NULL ON UPDATE CASCADE` | Exact same 25 FK names, columns, targets, and actions | **100% BYTE-FOR-BYTE MATCH** |
| **`CHECK` Constraints (16)** | All 16 named CHECK constraints | Exact same 16 named CHECK constraints and definitions | **100% BYTE-FOR-BYTE MATCH** |
| **Indexes (`pg_indexes`, 28 total)** | All PKs, unique indexes, and secondary indexes (redundant `idx_child_passes_code` removed) | Exact same 28 index names and `indexdef` | **100% BYTE-FOR-BYTE MATCH** |
| **Triggers (9 triggers)** | `trg_set_updated_at` (4 mutable tables) + `trg_*_actor_tenant` (all 5 tables) | Identical 9 triggers and functions | **100% MATCH** |

---

## 3. Documented Intentional Differences (Zero Unintended Drift)

1. **`IncidentSeverity` vs `incident_severity` enum type name:**
   - **Why:** Pre-existing baseline migration [20261020000000_init_dwellora/migration.sql#L26](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261020000000_init_dwellora/migration.sql#L26) defined `"IncidentSeverity"` (PascalCase) for `emergency_incidents.severity`, while [scripts/postgres/01_schema.sql#L88](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L88) defined `incident_severity` (snake_case). Both enums contain identical labels (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`) and default `'CRITICAL'`. Altering `IncidentSeverity` in `schema.prisma` would risk breaking existing `emergency_incidents` migrations; therefore `child_safety_alerts.severity` intentionally matches each artifact's existing `emergency_incidents.severity` type.
2. **Unique Indexes vs Table-Level `UNIQUE` Constraints in `pg_constraint`:**
   - Prisma migrations emit `CREATE UNIQUE INDEX IF NOT EXISTS ...` (standard Prisma convention), whereas `01_schema.sql` emits inline `CONSTRAINT uq_... UNIQUE (...)`. In PostgreSQL both produce the exact same unique B-tree index in `pg_indexes` (`INDEXES 100% IDENTICAL!`) and support identical composite foreign key references.

---

## 4. Additional Bug Fixed During Parity Verification

- **Forward-reference failure in `scripts/postgres/01_schema.sql`:** Prior to remediation, `child_safety_alerts` (previously at line 441) declared an inline `REFERENCES emergency_incidents(id)` before `emergency_incidents` was created (at line 727), which broke fresh `01_schema.sql` execution. The FK `child_safety_alerts_society_id_emergency_incident_id_fkey` is now attached via a schema-aware, table-aware `DO $$` block immediately after `emergency_incidents` ([01_schema.sql#L904-L917](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L904-L917)), and fresh bootstrap execution passed with `ON_ERROR_STOP=1`.

---

## 5. Migration Safety & Idempotency Checklist

- **Schema-aware & table-aware constraint checks:** Every `pg_constraint` check in [20261118010000_remediate_child_safety_constraints/migration.sql](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118010000_remediate_child_safety_constraints/migration.sql) filters both `c.connamespace = current_schema()::regnamespace` AND `c.conrelid = to_regclass(format('%I.%I', current_schema(), '<table_name>'))`.
- **Timezone-safe idempotent `TIMESTAMPTZ(3)` conversion:** Section `8b` inspects `information_schema.columns.data_type` and only applies `AT TIME ZONE 'UTC'` when converting `timestamp without time zone` -> `TIMESTAMPTZ(3)`, preventing local-timezone shifts on reruns.
- **No destructive changes to unrelated tables:** Only additive composite unique indexes (`uq_flats_society_id`, `uq_residents_society_id`, `uq_emergency_incidents_society_id`) were added to parent tables.
- **Verified idempotent re-run:** Re-executing the entire corrective migration script against an already-migrated PostgreSQL 16 database succeeded with zero errors.
