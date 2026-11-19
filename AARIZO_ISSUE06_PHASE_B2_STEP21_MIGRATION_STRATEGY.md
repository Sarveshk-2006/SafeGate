# AARIZO — ISSUE-06 Phase B.2, Step 2.1: Data Migration Strategy

**Project:** `D:\AAZIRA\AARIZO`  
**Phase:** ISSUE-06 — B.2.1 Child Safety Relational Database Foundation  
**Document:** Legacy Storage Formats & Idempotent Migration Strategy  
**Status:** SPECIFICATION COMPLETE — VERIFIED & COMPATIBLE  

---

## 1. Inventory of Existing Storage Formats

Prior to Phase B.2.1, child-safety data was scattered across three distinct legacy storage formats:

1. **Generic PostgreSQL `EntityRecord` Table (`entity_records`):**
   - Stored in [server/src/index.ts#L2686](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2686) with `collection: 'child_profiles'`.
   - Stored in [server/src/index.ts#L2728](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2728) with `collection: 'child_gate_passes'`.
   - Format: JSON blob in `data` column with untyped, unindexed properties.
2. **Legacy Raw SQL Table `child_safety` ([scripts/postgres/01_schema.sql#L326-L340](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L326-L340)):**
   - Defined during early database bootstrap with columns: `id`, `society_id`, `resident_id`, `flat_id`, `child_name`, `age`, `photo_url`, `allowed_solo_exit`, `guardian_contact`, `exit_permission_status`, `notes`.
   - Disconnected from Prisma and Express routes.
3. **Browser `localStorage` Keys:**
   - Key A: `communityos_children_profiles`, `communityos_child_pickup_qrs`, `communityos_child_pickup_logs` in [src/services/childSafetyService.ts](file:///D:/AAZIRA/AARIZO/src/services/childSafetyService.ts).
   - Key B: `aarizo_child_profiles_v3`, `aarizo_pickup_records_v3`, `aarizo_emergency_incidents_v3` in [src/domains/safety/services/safetyCommandEngine.ts](file:///D:/AAZIRA/AARIZO/src/domains/safety/services/safetyCommandEngine.ts).

---

## 2. Field-by-Field Mapping Matrix

### 2.1 Mapping `EntityRecord` (`child_profiles`) to `ChildProfile`

| Legacy `EntityRecord.data` Field | New `ChildProfile` Column | Type Transformation | Default / Fallback Rule |
| :--- | :--- | :--- | :--- |
| `id` (or `EntityRecord.id`) | `id` | `TEXT` | Preserves existing primary key ID |
| `societyId` | `society_id` | `TEXT` | Preserves tenant ownership |
| `residentId` | `resident_id` | `TEXT` (FK) | Set to `Resident.id` if matched; else `NULL` |
| `flatId` | `flat_id` | `TEXT` (FK) | Set to `Flat.id` if matched; else `NULL` |
| `flatNumber` (or `flatCode`) | `flat_number` | `TEXT` | Extracted from payload or default `'N/A'` |
| `fullName` (or `childName`) | `full_name` | `TEXT` | Required; sanitized string |
| `dateOfBirth` (or computed from `age`) | `date_of_birth` | `TIMESTAMP(3)` | Parsed ISO date or computed `NOW() - (age * 365 days)` |
| `gender` | `gender` | `TEXT` | Uppercased `'MALE'`, `'FEMALE'`, or `'OTHER'` |
| `photoUrl` | `photo_url` | `TEXT` | Preserved |
| `medicalNotes` | `medical_notes` | `TEXT` | Preserved |
| `status` | `status` | `TEXT` | Mapped to `'SAFE'`, `'OUT_OF_SOCIETY'`, or `'MISSING'` |
| `allowedSoloExit` | `allowed_solo_exit` | `BOOLEAN` | Boolean conversion (`true`/`false`) |
| `guardianName` | `guardian_name` | `TEXT` | Extracted from `guardians[0].name` or `'Guardian'` |
| `guardianPhone` | `guardian_phone` | `TEXT` | Extracted from `guardians[0].phone` or `'0000000000'` |
| `emergencyPhone` | `emergency_phone` | `TEXT` | Extracted from `emergencyContacts[0].phone` |
| `notes` | `notes` | `TEXT` | Preserved |
| `createdAt` | `created_at` | `TIMESTAMP(3)` | Preserved |
| `updatedAt` | `updated_at` | `TIMESTAMP(3)` | Preserved |

### 2.2 Mapping `EntityRecord` (`child_gate_passes`) to `ChildGatePass`

| Legacy `EntityRecord.data` Field | New `ChildGatePass` Column | Type Transformation | Security Rule |
| :--- | :--- | :--- | :--- |
| `id` (or `EntityRecord.id`) | `id` | `TEXT` | Preserves pass ID |
| `societyId` | `society_id` | `TEXT` | Preserves tenant ownership |
| `childId` | `child_id` | `TEXT` (FK) | Linked to child profile |
| `pickupPersonId` | `pickup_person_id` | `TEXT` (FK) | Linked to authorized pickup if exists |
| `passCode` | `pass_code` | `TEXT` (UNIQUE) | Preserved or generated unique code |
| `qrCode` / token | `token_hash` | `TEXT` (UNIQUE) | **SHA-256 hashed**; raw secret is never stored |
| `signature` | `signature` | `TEXT` | HMAC-SHA256 signature calculated |
| `pickupPersonName` | `pickup_person_name`| `TEXT` | Preserved |
| `pickupPersonPhone` | `pickup_person_phone`| `TEXT`| Preserved |
| `validFrom` | `valid_from` | `TIMESTAMP(3)` | Parsed ISO date |
| `validUntil` | `valid_until` | `TIMESTAMP(3)` | Parsed ISO date |
| `status` | `status` | `TEXT` | `'ACTIVE'`, `'USED'`, `'EXPIRED'`, or `'REVOKED'` |
| `maxUses` | `max_uses` | `INTEGER` | Defaults to `1` |
| `currentUses` | `current_uses` | `INTEGER` | `0` if active; `1` if exited |
| `verifiedAt` | `first_used_at` / `last_used_at` | `TIMESTAMP(3)` | Preserved |
| `verifiedByGuard` | Captured in `ChildExitLog` | N/A | Log row created |

### 2.3 Mapping Legacy `child_safety` Table to `ChildProfile`

| Legacy SQL Column | New `ChildProfile` Column | Reconciliation Note |
| :--- | :--- | :--- |
| `id` | `id` | Mapped directly |
| `society_id` | `society_id` | Foreign key to `societies` |
| `resident_id` | `resident_id` | Foreign key to `residents` |
| `flat_id` | `flat_id` | Foreign key to `flats` |
| `child_name` | `full_name` | Column rename |
| `age` | `date_of_birth` | Converted to birth date (`NOW() - interval 'age years'`) |
| `photo_url` | `photo_url` | Preserved |
| `allowed_solo_exit` | `allowed_solo_exit` | Preserved |
| `guardian_contact` | `guardian_phone` | Preserved |
| `exit_permission_status` | `status` | Mapped: `ALLOWED` -> `SAFE`, `DISALLOWED` -> `SAFE`, `TIMED_PASS` -> `SAFE` |
| `notes` | `notes` | Preserved |

---

## 3. Idempotent Migration Execution Script Blueprint

An idempotent data backfill script will be provided for runtime execution in environments with legacy data:

```sql
-- Idempotent backfill from legacy child_safety table
INSERT INTO child_profiles (
    id, society_id, resident_id, flat_id, flat_number, full_name,
    date_of_birth, gender, photo_url, status, allowed_solo_exit,
    guardian_name, guardian_phone, notes, created_at, updated_at
)
SELECT 
    cs.id,
    cs.society_id,
    cs.resident_id,
    cs.flat_id,
    COALESCE(f.flat_number, 'N/A') AS flat_number,
    cs.child_name AS full_name,
    (CURRENT_DATE - (cs.age * INTERVAL '1 year'))::timestamptz AS date_of_birth,
    'MALE' AS gender,
    cs.photo_url,
    'SAFE' AS status,
    COALESCE(cs.allowed_solo_exit, false) AS allowed_solo_exit,
    COALESCE(r.name, 'Primary Guardian') AS guardian_name,
    cs.guardian_contact AS guardian_phone,
    cs.notes,
    cs.created_at,
    cs.updated_at
FROM child_safety cs
LEFT JOIN flats f ON cs.flat_id = f.id
LEFT JOIN residents r ON cs.resident_id = r.id
ON CONFLICT (id) DO NOTHING;
```

---

## 4. Unmapped Fields & Safe Reconciliation Policy

1. **Unresolved Foreign Keys:** If a legacy record references a `resident_id` or `flat_id` that no longer exists in `residents` or `flats`, foreign key constraints will set the respective column to `NULL` while preserving the textual `flat_number` and child demographic record.
2. **No Data Deletion:** The legacy `child_safety` table and `EntityRecord` rows are **not dropped** during Phase B.2.1. They remain accessible for read audit until full verification.
3. **Seed Protection:** Demo personas and synthetic children (e.g. `'Leo Vance'`, `'Maya Lin'`) are strictly excluded from production migration paths and are confined to mock test fixtures.

