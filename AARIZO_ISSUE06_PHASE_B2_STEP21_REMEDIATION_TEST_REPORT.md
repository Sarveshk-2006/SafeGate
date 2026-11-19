# AARIZO — ISSUE-06 / Phase B.2.1 Remediation Test & Verification Report

**Project:** `D:\AAZIRA\AARIZO`  
**Phase:** ISSUE-06 — B.2.1 Child Safety Relational Database Foundation (Remediation)  
**Date:** November 18, 2026  
**Result:** **`REMEDIATION COMPLETE — READY FOR INDEPENDENT RE-AUDIT`**  

---

## 1. Execution Summary (All Verification Commands)

| # | Verification Step | Command / Environment | Result | Evidence |
| :-: | :--- | :--- | :---: | :--- |
| 1 | **Prisma Schema Validation** | `npx --prefix server prisma validate --schema=server/prisma/schema.prisma` (Prisma `6.19.3`, offline dummy `DATABASE_URL`) | **PASS** | `The schema at server\prisma\schema.prisma is valid 🚀` |
| 2 | **Prisma Client Generation** | `npx --prefix server prisma generate --schema=server/prisma/schema.prisma` (Prisma `6.19.3`) | **PASS** | Generated Prisma Client to `server/node_modules/@prisma/client` in 327ms |
| 3 | **Focused Static Schema/DMMF/Parity Tests** | `npm test -- tests/issue06_child_safety_schema.test.ts` | **PASS (15/15)** | 1 suite passed, 15 tests passed (5.99s) |
| 4 | **Isolated Live PostgreSQL 16 — Prisma Migrations** | `prisma migrate deploy` against ephemeral `postgres:16-alpine` container (`aarizo-b21-ephemeral-pg`, `127.0.0.1:5439`, removed after test) | **PASS (6/6 migrations)** | All 6 migrations including `20261118010000_remediate_child_safety_constraints` applied with 0 errors |
| 5 | **Isolated Live PostgreSQL 16 — `01_schema.sql` Bootstrap** | `psql -v ON_ERROR_STOP=1` on fresh DB `aarizo_b21_bootstrap` | **PASS (0 errors)** | Full bootstrap succeeded top-to-bottom including child-safety tables, FKs, CHECKs, and triggers |
| 6 | **Isolated Live PostgreSQL 16 — Constraint & Backfill Suite** | `AARIZO_ISOLATED_TEST_DATABASE_URL=.../aarizo_b21_fresh npm test -- tests/issue06_child_safety_db_constraints.test.ts` | **PASS (3/3)** | Verified live rejections for cross-society FKs, actor-tenant trigger, active-owner CHECK, fail-closed exit-log CHECK, `ON DELETE RESTRICT`, `ON DELETE SET NULL`, idempotent backfill + quarantine, and migration re-run |
| 7 | **Isolated Live PostgreSQL 16 — Legacy `child_safety` Backfill** | Executed `scripts/postgres/backfill_child_safety_b21.sql` twice on `aarizo_b21_bootstrap` | **PASS** | Valid row migrated with `DOB=NULL`, `reported_age=8`, `gender=UNSPECIFIED`, `exit_permission_mode=TIMED_PASS_ONLY`; cross-society row quarantined; rerun produced 0 duplicates |
| 8 | **Full Offline Jest Test Suite** | `npm test` (no DB env var — skips live PG integration suite cleanly) | **PASS (311/311 executed)** | `18 passed, 1 skipped (19 total)`, `311 passed, 3 skipped (314 total)` in 20.19s; zero regressions to Phase B.1 Visitor Pass or auth suites |
| 9 | **Backend TypeScript Build** | `npm --prefix server run build` (`tsc`) | **PASS** | Exit code 0, zero compilation errors |
| 10 | **Frontend Production Build** | `npm run build` (`tsc -b && vite build`) | **PASS** | Exit code 0, 2,179 modules transformed in 1.05s |

---

## 2. Clear Distinction: Static Tests vs Real Live PostgreSQL Tests

### A. Static & DMMF Tests ([tests/issue06_child_safety_schema.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_schema.test.ts)) — Always Run in `npm test`
- **15 tests** verifying:
  - Generated Prisma Client delegates (`childProfile`, `childAuthorizedPickup`, `childGatePass`, `childExitLog`, `childSafetyAlert`).
  - DMMF registration of all 10 new enums + `IncidentSeverity` reuse.
  - Absence of `signature`, `OFFLINE_VERIFIED`, `OFFLINE_HMAC`, `idProofNumber`, and redundant `idx_child_passes_code`.
  - DMMF `uniqueFields` for composite `[societyId, id]`, `[societyId, childId, id]`, and `[societyId, passCode]`.
  - DMMF `relationFromFields` / `relationToFields` for all 10 composite tenant relations.
  - DMMF `relationOnDelete === 'Restrict'` on all 15 domain/tenant relations and `relationOnDelete === 'SetNull'` on all 10 `User` actor relations.
  - Structured SQL column-by-column parser matching every scalar column name and `NOT NULL` status between Prisma DMMF and `scripts/postgres/01_schema.sql`.
  - Presence of all 16 named `CHECK` constraints, schema-aware & table-aware `pg_constraint` guards, `TIMESTAMPTZ(3)` alignment, and actor-tenant trigger definitions across both SQL artifacts.
  - Legacy backfill script safety invariants (no fabricated `'MALE'` or DOB-from-age, no `DELETE FROM`, covers `'children'` collection and quarantine).

### B. Real Live PostgreSQL 16 Integration Tests ([tests/issue06_child_safety_db_constraints.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_db_constraints.test.ts))
- Executed against an **ephemeral, isolated** `postgres:16-alpine` container (`aarizo-b21-ephemeral-pg` on `127.0.0.1:5439`, created for verification and permanently removed via `docker rm -f` immediately after).
- **Zero contact with unrelated external container `nexus-postgres` (port `5432`)**, verified intact (`Up 8 hours (healthy)`).
- **Live PostgreSQL errors proved (not mocked):**
  - `chk_child_profiles_active_owner`: Rejected active `child_profiles` insert with `resident_id = NULL, flat_id = NULL`.
  - `child_profiles_society_id_resident_id_fkey`: Rejected `soc-a` child linked to `soc-b` resident.
  - `child_profiles_society_id_flat_id_fkey`: Rejected `soc-a` child linked to `soc-b` flat.
  - `trg_child_profiles_actor_tenant`: Rejected `soc-a` child with `guardian_user_id` from `soc-b` (`23514`), while allowing platform admin (`users.society_id IS NULL`).
  - `chk_child_pickups_hash_format`: Rejected plaintext `1234-5678-9012` in `id_document_hash`, while allowing pickup creation with zero ID fields (`NOT_COLLECTED`).
  - `child_authorized_pickups_society_id_child_id_fkey`: Rejected `soc-a` pickup linked to `soc-b` child.
  - `child_gate_passes_society_id_child_id_pickup_person_id_fkey`: Rejected assigning `child-a1`'s pickup person to `child-a2`'s gate pass.
  - `chk_child_passes_validity_window`, `chk_child_passes_uses_bounds`, `chk_child_passes_token_hash_format`: Rejected inverted validity dates, `current_uses > max_uses`, and 6-digit `token_hash`.
  - `uq_child_passes_society_code`: Allowed identical display `pass_code` across `soc-a` and `soc-b`, rejected duplicate `(soc-a, pass_code)` (`23505`).
  - `chk_child_exit_logs_unavailable_channel`: Rejected `(BACKEND_UNAVAILABLE, ALLOWED)`, accepted `(BACKEND_UNAVAILABLE, VERIFICATION_UNAVAILABLE)`.
  - `child_safety_alerts_society_id_emergency_incident_id_fkey` & `chk_child_alerts_resolved_consistency`: Rejected cross-society emergency incident and `RESOLVED` without `resolved_at`.
  - `ON DELETE RESTRICT`: Rejected `DELETE` on `child_profiles`, `child_gate_passes`, and `societies` when referenced by audit/domain rows.
  - `ON DELETE SET NULL`: Deleting guard `User` nulled `child_exit_logs.guard_id` while preserving `child_exit_logs` row and `guard_name`.
  - `backfill_child_safety_b21.sql`: Proved non-fabrication, raw ID stripping, quarantine of orphan/low-entropy records, idempotency on double execution, and preservation of newer authoritative edits.
  - `20261118010000_remediate_child_safety_constraints/migration.sql`: Proved full script re-run succeeds with 0 errors.

---

## 3. Environment Safety Verification

- Ephemeral test container `aarizo-b21-ephemeral-pg` was removed cleanly after verification.
- Default `npm test` skips `tests/issue06_child_safety_db_constraints.test.ts` cleanly unless `AARIZO_ISOLATED_TEST_DATABASE_URL` is explicitly provided, preventing accidental connections to any external PostgreSQL server.

