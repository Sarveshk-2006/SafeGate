# AARIZO — ISSUE-06 / Phase B.2.1 Final Security Verification

**Project:** `D:\AAZIRA\AARIZO`  
**Phase:** ISSUE-06 — B.2.1 Child Safety Relational Database Foundation  
**Mode:** STRICT READ-ONLY FINAL INDEPENDENT RE-AUDIT  
**Audit Date:** November 18, 2026  

---

## 1. F-B21-01 — Offline Authorization & Cryptographic Hygiene (**PASS**)

### Repository-Wide Search Verification
A full-repository search for `OFFLINE_VERIFIED`, `OFFLINE_HMAC`, and `HMAC` across `server/src/`, `server/prisma/`, `scripts/postgres/`, and `src/` established:
- **Zero active offline approval pathways:** Neither `OFFLINE_VERIFIED` nor `OFFLINE_HMAC` appears anywhere in `schema.prisma`, `01_schema.sql`, `backfill_child_safety_b21.sql`, or application source code. (Only two SQL header comments in [20261118010000_remediate_child_safety_constraints/migration.sql#L4](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118010000_remediate_child_safety_constraints/migration.sql#L4), [#L315](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118010000_remediate_child_safety_constraints/migration.sql#L315) document their removal.)
- **Unrelated legitimate HMAC usage distinguished:**
  - `server/src/auth.ts` (`#L133-L234`): Server-issued session Bearer tokens (strictly server-side secret).
  - `server/src/crypto.ts` (`#L62-L280`), `server/src/provisioning.ts` (`#L64-L66`), `server/src/index.ts` (`#L2289, #L3330-L3344, #L3676-L3679`): Legacy password-hash migration compatibility and Razorpay checkout/webhook signature verification.
  - `server/prisma/schema.prisma#L1159`: Documentation comment specifying server-side keyed HMAC-SHA256 digest stored in `token_hash` (zero gate-device secret distribution).
- **Fail-closed database invariant:** `chk_child_exit_logs_unavailable_channel` ([migration.sql#L1016](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118010000_remediate_child_safety_constraints/migration.sql#L1016), [01_schema.sql#L574](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L574)) guarantees `verification_channel <> 'BACKEND_UNAVAILABLE' OR outcome = 'VERIFICATION_UNAVAILABLE'`. Verified live in PostgreSQL 16 ([issue06_child_safety_db_constraints.test.ts#L268-L279](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_db_constraints.test.ts#L268-L279)).

---

## 2. F-B21-02 — Multi-Tenant Relational & Trigger Integrity (**PASS**)

### Composite Foreign Key Audit
Verified every cross-table tenant boundary in both `schema.prisma` (DMMF) and PostgreSQL DDL:
- `ChildProfile -> Resident`: `(society_id, resident_id) -> residents(society_id, id)` (`ON DELETE RESTRICT`)
- `ChildProfile -> Flat`: `(society_id, flat_id) -> flats(society_id, id)` (`ON DELETE RESTRICT`)
- `ChildAuthorizedPickup -> ChildProfile`: `(society_id, child_id) -> child_profiles(society_id, id)` (`ON DELETE RESTRICT`)
- `ChildGatePass -> ChildProfile`: `(society_id, child_id) -> child_profiles(society_id, id)` (`ON DELETE RESTRICT`)
- `ChildGatePass -> ChildAuthorizedPickup`: **3-column** `(society_id, child_id, pickup_person_id) -> child_authorized_pickups(society_id, child_id, id)` (`ON DELETE RESTRICT`) — blocks BOTH cross-society AND cross-child pickup reuse!
- `ChildExitLog -> ChildProfile / ChildGatePass / ChildAuthorizedPickup`: All three composite `(society_id, ...)` FKs (`ON DELETE RESTRICT`).
- `ChildSafetyAlert -> ChildProfile / EmergencyIncident`: Both composite `(society_id, ...)` FKs (`ON DELETE RESTRICT`).

### Trigger Behavior Audit (`INSERT` vs `UPDATE`)
Inspected [migration.sql#L1074-L1121](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118010000_remediate_child_safety_constraints/migration.sql#L1074-L1121) and [01_schema.sql#L990-L1034](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L990-L1034):
- All 5 triggers are registered as **`BEFORE INSERT OR UPDATE`**, validating every actor column against `NEW.society_id`.
- Updating `society_id` OR reassigning an actor column on any of the 5 child tables re-runs `enforce_child_safety_actor_tenant()` and rejects cross-society actors with SQLSTATE `23514`.
- Nullable actor columns (`v_actor_id IS NOT NULL`) and platform admins (`users.society_id IS NULL`) are handled cleanly.
- **Documented non-blocking nuances:**
  1. Updating `users.society_id` directly in the `users` table does not fire the child-table trigger (historical audit logs should not break if a user later transfers societies; active `guardian_user_id` should be reconciled in admin user-transfer workflows).
  2. Live Jest tests exercised the trigger on `INSERT` but not on `UPDATE` (tracked under `F-B21-09`).

---

## 3. F-B21-03 — Pass-Code vs Bearer-Token Security (**PASS**)

- `ChildGatePass.passCode`: Tenant-scoped `@@unique([societyId, passCode], map: "uq_child_passes_society_code")`; global unique index and redundant `idx_child_passes_code` dropped.
- `ChildGatePass.tokenHash`: Globally `@unique` with `CHECK (token_hash ~ '^[0-9a-f]{64}$')`, rejecting short codes at the database layer.
- Clear schema & handoff contract established for B.2.2: `passCode` is strictly a display reference label; gate verification requires >= 256-bit CSPRNG bearer token hashed server-side with `CHILD_PASS_TOKEN_PEPPER`, rate-limited, society-scoped, and `tokenHash` must never be returned in ordinary list endpoints.

---

## 4. F-B21-04 — Identity-Document Data Minimization (**PASS**)

- Mandatory plaintext `id_proof_number` completely dropped (`migration.sql#L230`) without copying sensitive raw values into any other column.
- Identity document collection is fully optional (`id_verification_status` defaults to `NOT_COLLECTED`; `id_document_type`, `id_document_last4 VARCHAR(4)`, and `id_document_hash` are all nullable).
- `chk_child_pickups_last4_len` (`char_length BETWEEN 1 AND 4`) and `chk_child_pickups_hash_format` (`^[0-9a-f]{64}$`) block raw government ID strings at the database layer.
- `backfill_child_safety_b21.sql` strips `idProofNumber` from both migrated pickup rows (`#L444`) and `child_safety_migration_quarantine.sanitized_payload` (`#L294-L307`).
- No ordinary unsalted hash of government IDs was introduced; any future `id_document_hash` usage is strictly contracted to server-keyed HMAC with key material outside DB and client devices.

---

## 5. F-B21-05 — Child Ownership & Audit Retention (**PASS**)

- **Ownership:** `chk_child_profiles_active_owner` enforces `(resident_id IS NOT NULL AND flat_id IS NOT NULL)` on every non-archived child profile; composite FKs guarantee both belong to the same society.
- **No silent audit destruction:** All 15 domain/tenant FKs across the 5 child tables use `ON DELETE RESTRICT` (zero `Cascade`), preventing deletion of a child, pickup person, pass, resident, flat, emergency incident, or society from wiping exit logs or SOS alerts.
- **Safe actor `ON DELETE SET NULL` auditability:** Inspected all 10 `User` actor FKs:
  - In `ChildExitLog`, `guardId` is `SetNull` while `guardName` (`NOT NULL`), `childName`, `flatNumber`, `pickupPersonName`, `pickupPersonPhone`, `gateId`, `outcome`, `verificationChannel`, and `timestamp` are preserved inline.
  - In `ChildSafetyAlert`, `reportedById`, `acknowledgedById`, and `resolvedById` are `SetNull` while `reportedByName`, `acknowledgedByName`, `resolvedByName`, `childName`, `flatNumber`, `location`, `description`, `lastSeenDetails`, and `resolutionNotes` are preserved inline.
  - In `ChildProfile` / `ChildAuthorizedPickup` / `ChildGatePass`, administrative actor FKs (`guardianUserId`, `archivedById`, `createdById`, `verifiedById`, `revokedById`) are nullable `SetNull` metadata while `guardianName`/`guardianPhone` and `archivedAt` preserve full lifecycle context.

---

## 6. F-B21-08 — Database Integrity Constraints (**PASS**)

All 10 new enums + reused `IncidentSeverity` and all 16 named `CHECK` constraints were inspected line-by-line in [migration.sql#L860-L1041](file:///D:/AAZIRA/AARIZO/server/prisma/migrations/20261118010000_remediate_child_safety_constraints/migration.sql#L860-L1041) and [01_schema.sql#L471-L607](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L471-L607):
- Date & numeric bounds verified: `valid_until > valid_from`, `max_uses >= 1`, `current_uses >= 0 AND current_uses <= max_uses`, `reported_age BETWEEN 0 AND 25`, `date_of_birth <= CURRENT_TIMESTAMP`.
- Lifecycle consistency verified without blocking valid states: `ARCHIVED <-> archived_at IS NOT NULL`, `REVOKED -> revoked_at IS NOT NULL`, `ACKNOWLEDGED -> acknowledged_at IS NOT NULL`, `RESOLVED/FALSE_ALARM -> resolved_at IS NOT NULL`.
- Minor non-blocking note for B.2.2: `ChildProfile.allowedSoloExit` and `ChildProfile.exitPermissionMode` should be kept synchronized in B.2.2 service logic.

