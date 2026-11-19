# AARIZO — ISSUE-06 / Phase B.2.1 Legacy Data Reconciliation & Backfill Runbook

**Project:** `D:\AAZIRA\AARIZO`  
**Phase:** ISSUE-06 — B.2.1 Child Safety Relational Database Foundation (Remediation)  
**Backfill Script:** [scripts/postgres/backfill_child_safety_b21.sql](file:///D:/AAZIRA/AARIZO/scripts/postgres/backfill_child_safety_b21.sql)  
**Date:** November 18, 2026  

---

## 1. Complete Inventory of Legacy Child Safety Sources

| # | Legacy Source | Storage Location | Automated Backfill Action | Retention Policy |
| :-: | :--- | :--- | :--- | :--- |
| 1 | Legacy SQL table `child_safety` | [scripts/postgres/01_schema.sql#L326-L340](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L326-L340) | Migrated into `child_profiles` if valid same-society `(society_id, resident_id, flat_id)` exists; otherwise routed to `child_safety_migration_quarantine`. | **NOT deleted** in B.2.1 |
| 2 | `EntityRecord` (`collection = 'child_profiles'`) | Written by legacy [server/src/index.ts#L2686](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2686) | Migrated into `child_profiles` + embedded `authorizedPickups[]` into `child_authorized_pickups`; incomplete/unowned rows quarantined. | **NOT deleted** in B.2.1 |
| 3 | `EntityRecord` (`collection = 'children'`) | Written by [src/repositories/childSafety/ChildRepository.ts#L7](file:///D:/AAZIRA/AARIZO/src/repositories/childSafety/ChildRepository.ts#L7) | Migrated identically to `'child_profiles'` (with `legacy_source = 'entity_records:children'`); embedded `authorizedPickups[]` extracted. | **NOT deleted** in B.2.1 |
| 4 | `EntityRecord` (`collection = 'child_gate_passes'`) | Written by legacy [server/src/index.ts#L2728](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2728) | Historical `VERIFIED_EXITED`/`USED` rows migrated into `child_exit_logs` (`guard_id = NULL`, `guard_name` preserved). Active/unexpired 6-digit passes **quarantined for forced reissue** (NEVER hashed into `token_hash`). | **NOT deleted** in B.2.1 |
| 5 | Browser `localStorage` (`communityos_children_profiles`, `communityos_child_pickup_qrs`, `communityos_child_pickup_logs`, `communityos_child_safety_alerts`, `aarizo_child_profiles_v3`, `aarizo_pickup_records_v3`, `aarizo_emergency_incidents_v3`) | Client devices only ([childSafetyService.ts](file:///D:/AAZIRA/AARIZO/src/services/childSafetyService.ts), [safetyCommandEngine.ts](file:///D:/AAZIRA/AARIZO/src/domains/safety/services/safetyCommandEngine.ts)) | Cannot be migrated by server SQL. Treated as untrusted client cache; must be retired/cleared in Phase B.2.3 after backend API cutover. | Retired in B.2.3 |

---

## 2. Non-Fabrication & Data-Integrity Rules Enforced by `backfill_child_safety_b21.sql`

1. **Zero fabricated gender:** Never hardcodes `'MALE'`. Only explicit `'MALE'`, `'FEMALE'`, or `'OTHER'` values are mapped; missing or unrecognized values map to `ChildGender.UNSPECIFIED`.
2. **Zero fabricated exact DOB:** Never derives `date_of_birth` from integer `age`. Legacy `child_safety.age` and `EntityRecord.data.age` populate `child_profiles.reported_age` (validated `0..25`), leaving `date_of_birth = NULL` unless a real valid ISO date <= `CURRENT_TIMESTAMP` exists.
3. **Zero collapsed exit permissions:** `child_safety.exit_permission_status` and `EntityRecord.data.exitPermissionStatus` map faithfully to `child_exit_permission_mode`:
   - `'ALLOWED'` → `'SOLO_ALLOWED'`
   - `'DISALLOWED'` → `'ESCORT_REQUIRED'`
   - `'TIMED_PASS'` → `'TIMED_PASS_ONLY'`
   - Unknown/missing → `'UNKNOWN'` (never silently collapsed into `status = 'SAFE'`).
4. **Zero fabricated guardians:** Missing `guardianName` or `guardianPhone` routes the record to `child_safety_migration_quarantine` rather than inserting fake `'Guardian'` / `'0000000000'` placeholders.
5. **Secondary guardians & emergency contacts preserved:** `guardians[1..n]` are preserved in `child_profiles.secondary_guardians` (`JSONB`), and `emergencyContacts[]` (including `name`, `relationship`, `phone`) are preserved in `child_profiles.emergency_contacts` (`JSONB`).
6. **Zero raw government ID copying:** Embedded `authorizedPickups[].idProofNumber` is **never copied** into `child_authorized_pickups` or into `child_safety_migration_quarantine.sanitized_payload`. Only `idProofType` is preserved in `id_document_type`, with `id_document_last4 = NULL` and `id_verification_status = 'UNVERIFIED'` (or `'NOT_COLLECTED'`).
7. **Zero weak-pass hashing:** Active legacy 6-digit `child_gate_passes` (`CGP-xxxxxx`) are NOT imported into `child_gate_passes` and NEVER hashed into `token_hash`. They are recorded in `child_safety_migration_quarantine` (`LEGACY_LOW_ENTROPY_PASS_REQUIRES_REISSUE`) so guardians reissue cryptographically strong passes after B.2.2 cutover.
8. **Idempotency & non-overwrite guarantee:** Re-running `backfill_child_safety_b21.sql` checks both primary key `id` and `(society_id, legacy_source, legacy_source_id)` via `NOT EXISTS` / `ON CONFLICT ... DO NOTHING`, creating zero duplicates and never overwriting newer authoritative edits.

---

## 3. Quarantine & Manual Reconciliation Workflow

Records that fail strict ownership, tenant, date, or cryptographic rules are recorded in `child_safety_migration_quarantine`:

| Quarantine Reason | Cause | Required Manual Reconciliation Action |
| :--- | :--- | :--- |
| `MISSING_SOCIETY` | Legacy `society_id` does not exist in `societies`. | Verify if obsolete test/seed data; archive or remap to valid society ID before re-import. |
| `MISSING_OR_CROSS_SOCIETY_RESIDENT` | Legacy `resident_id` missing or belongs to another society. | Society admin confirms correct `residents.id` within the target society, then inserts via authoritative B.2.2 API. |
| `MISSING_OR_CROSS_SOCIETY_FLAT` | Legacy `flat_id` missing or belongs to another society. | Society admin confirms valid `flats.id` in target society. |
| `UNRESOLVED_RESIDENT_OR_FLAT_OWNERSHIP` | `EntityRecord` lacked resolvable `(residentId, flatId)` in same society. | Match flat number & guardian phone against active `residents`, then register cleanly via B.2.2 API. |
| `MISSING_CHILD_NAME` / `MISSING_GUARDIAN_CONTACT` | Required child or guardian contact missing. | Contact resident/admin to confirm child and guardian details before registration. |
| `INVALID_DATE_OF_BIRTH_FORMAT` / `FUTURE_DATE_OF_BIRTH` / `INVALID_REPORTED_AGE` | Corrupted date or out-of-range age (`< 0` or `> 25`). | Confirm true DOB with guardian; do not guess. |
| `LEGACY_LOW_ENTROPY_PASS_REQUIRES_REISSUE` | Legacy 6-digit `child_gate_passes` row was still `ACTIVE` or non-exited. | Notify guardian to generate a new >= 256-bit bearer-token pass once B.2.2 is live. |

---

## 4. Cutover Execution Guardrails

- **DO NOT** run `backfill_child_safety_b21.sql` against the external host PostgreSQL container (`nexus-postgres`).
- Run only after taking a verified database snapshot during the controlled B.2.2/B.2.3 deployment window, review `SELECT quarantine_reason, COUNT(*) FROM child_safety_migration_quarantine GROUP BY 1;`, and resolve all quarantined rows before deprecating legacy `entity_records` / `child_safety` read paths.

