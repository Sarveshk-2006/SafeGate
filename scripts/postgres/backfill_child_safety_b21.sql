-- ==============================================================================
-- AARIZO ISSUE-06 Phase B.2.1 — Idempotent Child Safety Legacy Backfill & Quarantine
--
-- Scope:
--   Safely migrates valid legacy child-safety rows into normalized relational tables
--   while routing incomplete, cross-tenant, or unmappable records into
--   child_safety_migration_quarantine for controlled manual reconciliation.
--
-- Safety Guarantees (F-B21-04, F-B21-05, F-B21-07):
--   1. NEVER deletes or modifies legacy source rows (child_safety, entity_records).
--   2. NEVER fabricates gender, exact DOB from age, guardian info, or exit policy.
--   3. NEVER hashes low-entropy 6-digit legacy passCode into token_hash.
--   4. NEVER copies raw plaintext government ID numbers (idProofNumber) into
--      child_authorized_pickups or into quarantine payloads.
--   5. 100% idempotent: rerunning creates zero duplicates and never overwrites
--      newer authoritative records.
--   6. DO NOT run against unrelated external databases. Execute only during
--      controlled staging/production cutover windows.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Quarantine Table for Manual Reconciliation
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS child_safety_migration_quarantine (
    id TEXT PRIMARY KEY,
    legacy_source TEXT NOT NULL,
    legacy_source_id TEXT NOT NULL,
    society_id TEXT,
    quarantine_reason TEXT NOT NULL,
    sanitized_payload JSONB NOT NULL,
    reconciled_at TIMESTAMPTZ(3),
    reconciled_by_id TEXT,
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_child_quarantine_source UNIQUE (legacy_source, legacy_source_id)
);

-- ------------------------------------------------------------------------------
-- 2. Backfill from Legacy SQL Table: child_safety (if present)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass(format('%I.%I', current_schema(), 'child_safety')) IS NOT NULL THEN
        -- 2a-1. Quarantine incomplete or cross-society child_safety rows
        INSERT INTO child_safety_migration_quarantine (
            id, legacy_source, legacy_source_id, society_id, quarantine_reason, sanitized_payload
        )
        SELECT
            'quar-cs-' || cs.id,
            'child_safety',
            cs.id,
            cs.society_id,
            CASE
                WHEN s.id IS NULL THEN 'MISSING_SOCIETY'
                WHEN r.id IS NULL THEN 'MISSING_OR_CROSS_SOCIETY_RESIDENT'
                WHEN f.id IS NULL THEN 'MISSING_OR_CROSS_SOCIETY_FLAT'
                WHEN NULLIF(BTRIM(cs.child_name), '') IS NULL THEN 'MISSING_CHILD_NAME'
                WHEN NULLIF(BTRIM(cs.guardian_contact), '') IS NULL THEN 'MISSING_GUARDIAN_PHONE'
                WHEN cs.age IS NOT NULL AND (cs.age < 0 OR cs.age > 25) THEN 'INVALID_REPORTED_AGE'
                ELSE 'UNSPECIFIED_VALIDATION_FAILURE'
            END,
            jsonb_build_object(
                'id', cs.id,
                'society_id', cs.society_id,
                'resident_id', cs.resident_id,
                'flat_id', cs.flat_id,
                'child_name', cs.child_name,
                'age', cs.age,
                'allowed_solo_exit', cs.allowed_solo_exit,
                'exit_permission_status', cs.exit_permission_status
            )
        FROM child_safety cs
        LEFT JOIN societies s ON s.id = cs.society_id
        LEFT JOIN residents r ON r.id = cs.resident_id AND r.society_id = cs.society_id
        LEFT JOIN flats f ON f.id = cs.flat_id AND f.society_id = cs.society_id
        WHERE s.id IS NULL
           OR r.id IS NULL
           OR f.id IS NULL
           OR NULLIF(BTRIM(cs.child_name), '') IS NULL
           OR NULLIF(BTRIM(cs.guardian_contact), '') IS NULL
           OR (cs.age IS NOT NULL AND (cs.age < 0 OR cs.age > 25))
        ON CONFLICT (legacy_source, legacy_source_id) DO NOTHING;

        -- 2a-2. Quarantine child_safety rows with colliding primary key in child_profiles
        INSERT INTO child_safety_migration_quarantine (
            id, legacy_source, legacy_source_id, society_id, quarantine_reason, sanitized_payload
        )
        SELECT
            'quar-pk-cs-' || cs.id,
            'child_safety',
            cs.id,
            cs.society_id,
            'DUPLICATE_PRIMARY_KEY',
            jsonb_build_object(
                'id', cs.id,
                'society_id', cs.society_id,
                'resident_id', cs.resident_id,
                'flat_id', cs.flat_id,
                'child_name', cs.child_name,
                'collision_target', 'child_profiles.id'
            )
        FROM child_safety cs
        JOIN child_profiles cp ON cp.id = cs.id
        WHERE NOT (cp.society_id = cs.society_id AND cp.legacy_source = 'child_safety' AND cp.legacy_source_id = cs.id)
        ON CONFLICT (legacy_source, legacy_source_id) DO NOTHING;

        -- 2b. Migrate valid child_safety rows without fabricating DOB, gender, or permission mode
        INSERT INTO child_profiles (
            id,
            society_id,
            resident_id,
            flat_id,
            guardian_user_id,
            flat_number,
            full_name,
            date_of_birth,
            reported_age,
            gender,
            photo_url,
            status,
            exit_permission_mode,
            allowed_solo_exit,
            guardian_name,
            guardian_phone,
            notes,
            legacy_source,
            legacy_source_id,
            created_at,
            updated_at
        )
        SELECT
            cs.id,
            cs.society_id,
            r.id,
            f.id,
            r.user_id,
            f.flat_number,
            BTRIM(cs.child_name),
            NULL, -- Never synthesize exact DOB from integer age
            cs.age,
            'UNSPECIFIED'::child_gender, -- Never fabricate gender
            cs.photo_url,
            'SAFE'::child_status,
            CASE UPPER(COALESCE(cs.exit_permission_status, ''))
                WHEN 'ALLOWED' THEN 'SOLO_ALLOWED'::child_exit_permission_mode
                WHEN 'DISALLOWED' THEN 'ESCORT_REQUIRED'::child_exit_permission_mode
                WHEN 'TIMED_PASS' THEN 'TIMED_PASS_ONLY'::child_exit_permission_mode
                ELSE 'UNKNOWN'::child_exit_permission_mode
            END,
            COALESCE(cs.allowed_solo_exit, FALSE),
            r.name,
            BTRIM(cs.guardian_contact),
            cs.notes,
            'child_safety',
            cs.id,
            COALESCE(cs.created_at, CURRENT_TIMESTAMP),
            COALESCE(cs.updated_at, CURRENT_TIMESTAMP)
        FROM child_safety cs
        JOIN societies s ON s.id = cs.society_id
        JOIN residents r ON r.id = cs.resident_id AND r.society_id = cs.society_id
        JOIN flats f ON f.id = cs.flat_id AND f.society_id = cs.society_id
        WHERE NULLIF(BTRIM(cs.child_name), '') IS NOT NULL
          AND NULLIF(BTRIM(cs.guardian_contact), '') IS NOT NULL
          AND (cs.age IS NULL OR (cs.age >= 0 AND cs.age <= 25))
          AND NOT EXISTS (
              SELECT 1 FROM child_profiles cp
              WHERE cp.id = cs.id
                 OR (cp.society_id = cs.society_id AND cp.legacy_source = 'child_safety' AND cp.legacy_source_id = cs.id)
          );
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 3. Backfill from EntityRecord collections: 'child_profiles' and 'children'
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    rec RECORD;
    v_source TEXT;
    v_resident_id TEXT;
    v_flat_id TEXT;
    v_flat_number TEXT;
    v_guardian_user_id TEXT;
    v_full_name TEXT;
    v_guardian_name TEXT;
    v_guardian_phone TEXT;
    v_dob TIMESTAMPTZ(3);
    v_age INTEGER;
    v_gender child_gender;
    v_status child_status;
    v_perm_mode child_exit_permission_mode;
    v_reason TEXT;
    v_pickup JSONB;
    v_pickup_id TEXT;
    v_pickup_name TEXT;
    v_pickup_phone TEXT;
    v_pickup_rel TEXT;
    v_doc_type TEXT;
    v_verified_at TIMESTAMPTZ(3);
BEGIN
    IF to_regclass(format('%I.%I', current_schema(), 'entity_records')) IS NULL THEN
        RETURN;
    END IF;

    FOR rec IN
        SELECT er.id, er.collection, er.society_id, er.data, er.created_at, er.updated_at
        FROM entity_records er
        WHERE er.collection IN ('child_profiles', 'children')
        ORDER BY er.created_at ASC
    LOOP
        v_source := 'entity_records:' || rec.collection;
        v_reason := NULL;
        v_resident_id := NULL;
        v_flat_id := NULL;
        v_flat_number := NULLIF(BTRIM(COALESCE(rec.data ->> 'flatNumber', rec.data ->> 'flatCode', '')), '');
        v_guardian_user_id := NULL;
        v_dob := NULL;
        v_age := NULL;

        -- Validate society existence
        IF NOT EXISTS (SELECT 1 FROM societies WHERE id = rec.society_id) THEN
            v_reason := 'MISSING_SOCIETY';
        END IF;

        -- Resolve resident within the exact same society (never cross-society)
        IF v_reason IS NULL AND NULLIF(BTRIM(COALESCE(rec.data ->> 'residentId', '')), '') IS NOT NULL THEN
            SELECT r.id, r.flat_id, r.user_id
              INTO v_resident_id, v_flat_id, v_guardian_user_id
            FROM residents r
            WHERE r.id = BTRIM(rec.data ->> 'residentId')
              AND r.society_id = rec.society_id;
        END IF;

        -- Fallback: resolve flat by explicit flatId or exact society + flat_number
        IF v_reason IS NULL AND v_flat_id IS NULL THEN
            IF NULLIF(BTRIM(COALESCE(rec.data ->> 'flatId', '')), '') IS NOT NULL THEN
                SELECT f.id, f.flat_number INTO v_flat_id, v_flat_number
                FROM flats f
                WHERE f.id = BTRIM(rec.data ->> 'flatId')
                  AND f.society_id = rec.society_id;
            ELSIF v_flat_number IS NOT NULL THEN
                SELECT f.id INTO v_flat_id
                FROM flats f
                WHERE f.society_id = rec.society_id
                  AND UPPER(f.flat_number) = UPPER(v_flat_number)
                LIMIT 1;
            END IF;
        END IF;

        -- Fallback: resolve unique resident in same society & flat if not explicitly set
        IF v_reason IS NULL AND v_resident_id IS NULL AND v_flat_id IS NOT NULL THEN
            SELECT r.id, r.user_id INTO v_resident_id, v_guardian_user_id
            FROM residents r
            WHERE r.society_id = rec.society_id
              AND r.flat_id = v_flat_id
              AND r.status = 'ACTIVE'
            ORDER BY r.created_at ASC
            LIMIT 1;
        END IF;

        IF v_reason IS NULL AND (v_resident_id IS NULL OR v_flat_id IS NULL) THEN
            v_reason := 'UNRESOLVED_RESIDENT_OR_FLAT_OWNERSHIP';
        END IF;

        v_full_name := NULLIF(BTRIM(COALESCE(rec.data ->> 'fullName', rec.data ->> 'childName', '')), '');
        v_guardian_name := NULLIF(BTRIM(COALESCE(
            rec.data ->> 'guardianName',
            rec.data -> 'guardians' -> 0 ->> 'name',
            ''
        )), '');
        v_guardian_phone := NULLIF(BTRIM(COALESCE(
            rec.data ->> 'guardianPhone',
            rec.data -> 'guardians' -> 0 ->> 'phone',
            ''
        )), '');

        IF v_reason IS NULL AND v_full_name IS NULL THEN
            v_reason := 'MISSING_CHILD_NAME';
        ELSIF v_reason IS NULL AND (v_guardian_name IS NULL OR v_guardian_phone IS NULL) THEN
            v_reason := 'MISSING_GUARDIAN_CONTACT';
        END IF;

        -- Parse explicit dateOfBirth only (never synthesize from age)
        IF v_reason IS NULL AND NULLIF(BTRIM(COALESCE(rec.data ->> 'dateOfBirth', '')), '') IS NOT NULL THEN
            BEGIN
                v_dob := (rec.data ->> 'dateOfBirth')::TIMESTAMPTZ(3);
                IF v_dob > CURRENT_TIMESTAMP THEN
                    v_reason := 'FUTURE_DATE_OF_BIRTH';
                END IF;
            EXCEPTION WHEN OTHERS THEN
                v_reason := 'INVALID_DATE_OF_BIRTH_FORMAT';
            END;
        END IF;

        IF v_reason IS NULL AND NULLIF(BTRIM(COALESCE(rec.data ->> 'age', '')), '') IS NOT NULL THEN
            BEGIN
                v_age := (rec.data ->> 'age')::INTEGER;
                IF v_age < 0 OR v_age > 25 THEN
                    v_reason := 'INVALID_REPORTED_AGE';
                END IF;
            EXCEPTION WHEN OTHERS THEN
                v_reason := 'INVALID_AGE_FORMAT';
            END;
        END IF;

        IF v_reason IS NOT NULL THEN
            -- Quarantine with sanitized payload (strip authorizedPickups raw idProofNumber)
            INSERT INTO child_safety_migration_quarantine (
                id, legacy_source, legacy_source_id, society_id, quarantine_reason, sanitized_payload
            ) VALUES (
                'quar-' || rec.collection || '-' || rec.id,
                v_source,
                rec.id,
                rec.society_id,
                v_reason,
                jsonb_build_object(
                    'id', rec.id,
                    'collection', rec.collection,
                    'societyId', rec.society_id,
                    'fullName', v_full_name,
                    'flatNumber', v_flat_number,
                    'hasDateOfBirth', (rec.data ? 'dateOfBirth'),
                    'hasGuardians', (jsonb_typeof(rec.data -> 'guardians') = 'array'),
                    'authorizedPickupsCount', CASE
                        WHEN jsonb_typeof(rec.data -> 'authorizedPickups') = 'array'
                        THEN jsonb_array_length(rec.data -> 'authorizedPickups')
                        ELSE 0
                    END
                )
            )
            ON CONFLICT (legacy_source, legacy_source_id) DO NOTHING;
            CONTINUE;
        END IF;

        -- Honest enum mapping without fabricating values
        v_gender := CASE UPPER(COALESCE(rec.data ->> 'gender', ''))
            WHEN 'MALE' THEN 'MALE'::child_gender
            WHEN 'FEMALE' THEN 'FEMALE'::child_gender
            WHEN 'OTHER' THEN 'OTHER'::child_gender
            ELSE 'UNSPECIFIED'::child_gender
        END;

        v_status := CASE UPPER(COALESCE(rec.data ->> 'status', ''))
            WHEN 'SAFE' THEN 'SAFE'::child_status
            WHEN 'OUT_OF_SOCIETY' THEN 'OUT_OF_SOCIETY'::child_status
            WHEN 'MISSING' THEN 'MISSING'::child_status
            ELSE 'SAFE'::child_status
        END;

        v_perm_mode := CASE UPPER(COALESCE(rec.data ->> 'exitPermissionStatus', ''))
            WHEN 'ALLOWED' THEN 'SOLO_ALLOWED'::child_exit_permission_mode
            WHEN 'DISALLOWED' THEN 'ESCORT_REQUIRED'::child_exit_permission_mode
            WHEN 'TIMED_PASS' THEN 'TIMED_PASS_ONLY'::child_exit_permission_mode
            ELSE CASE
                WHEN COALESCE((rec.data ->> 'allowedSoloExit')::BOOLEAN, FALSE) THEN 'SOLO_ALLOWED'::child_exit_permission_mode
                ELSE 'UNKNOWN'::child_exit_permission_mode
            END
        END;

        IF v_flat_number IS NULL THEN
            SELECT flat_number INTO v_flat_number FROM flats WHERE id = v_flat_id;
        END IF;

        -- Idempotent insert: never overwrite newer authoritative records
        IF NOT EXISTS (
            SELECT 1 FROM child_profiles cp
            WHERE cp.id = rec.id
               OR (cp.society_id = rec.society_id AND cp.legacy_source = v_source AND cp.legacy_source_id = rec.id)
        ) THEN
            INSERT INTO child_profiles (
                id,
                society_id,
                resident_id,
                flat_id,
                guardian_user_id,
                flat_number,
                full_name,
                date_of_birth,
                reported_age,
                gender,
                photo_url,
                medical_notes,
                status,
                exit_permission_mode,
                allowed_solo_exit,
                guardian_name,
                guardian_phone,
                emergency_phone,
                secondary_guardians,
                emergency_contacts,
                notes,
                legacy_source,
                legacy_source_id,
                created_at,
                updated_at
            ) VALUES (
                rec.id,
                rec.society_id,
                v_resident_id,
                v_flat_id,
                v_guardian_user_id,
                COALESCE(v_flat_number, 'UNASSIGNED'),
                v_full_name,
                v_dob,
                v_age,
                v_gender,
                NULLIF(BTRIM(COALESCE(rec.data ->> 'photoUrl', '')), ''),
                NULLIF(BTRIM(COALESCE(rec.data ->> 'medicalNotes', '')), ''),
                v_status,
                v_perm_mode,
                COALESCE((rec.data ->> 'allowedSoloExit')::BOOLEAN, FALSE),
                v_guardian_name,
                v_guardian_phone,
                NULLIF(BTRIM(COALESCE(rec.data ->> 'emergencyPhone', rec.data -> 'emergencyContacts' -> 0 ->> 'phone', '')), ''),
                CASE
                    WHEN jsonb_typeof(rec.data -> 'guardians') = 'array' AND jsonb_array_length(rec.data -> 'guardians') > 1
                    THEN (SELECT jsonb_agg(elem) FROM jsonb_array_elements(rec.data -> 'guardians') WITH ORDINALITY AS t(elem, ord) WHERE ord > 1)
                    ELSE NULL
                END,
                CASE
                    WHEN jsonb_typeof(rec.data -> 'emergencyContacts') = 'array'
                    THEN rec.data -> 'emergencyContacts'
                    ELSE NULL
                END,
                NULLIF(BTRIM(COALESCE(rec.data ->> 'notes', '')), ''),
                v_source,
                rec.id,
                COALESCE(rec.created_at, CURRENT_TIMESTAMP),
                COALESCE(rec.updated_at, CURRENT_TIMESTAMP)
            );
        ELSIF EXISTS (
            SELECT 1 FROM child_profiles cp
            WHERE cp.id = rec.id
              AND NOT (cp.society_id = rec.society_id AND cp.legacy_source = v_source AND cp.legacy_source_id = rec.id)
        ) THEN
            -- F-B21-07: Quarantine entity record with colliding primary key already claimed in child_profiles
            INSERT INTO child_safety_migration_quarantine (
                id, legacy_source, legacy_source_id, society_id, quarantine_reason, sanitized_payload
            ) VALUES (
                'quar-pk-' || rec.collection || '-' || rec.id,
                v_source,
                rec.id,
                rec.society_id,
                'DUPLICATE_PRIMARY_KEY',
                jsonb_build_object(
                    'id', rec.id,
                    'collection', rec.collection,
                    'societyId', rec.society_id,
                    'fullName', v_full_name,
                    'flatNumber', v_flat_number,
                    'collision_target', 'child_profiles.id'
                )
            )
            ON CONFLICT (legacy_source, legacy_source_id) DO NOTHING;
            CONTINUE;
        END IF;

        -- Migrate embedded authorizedPickups[] safely without copying raw idProofNumber
        IF jsonb_typeof(rec.data -> 'authorizedPickups') = 'array' THEN
            FOR v_pickup IN SELECT elem FROM jsonb_array_elements(rec.data -> 'authorizedPickups') AS elem
            LOOP
                v_pickup_id := COALESCE(NULLIF(BTRIM(v_pickup ->> 'id'), ''), rec.id || '-pickup-' || md5(v_pickup::text));
                v_pickup_name := NULLIF(BTRIM(COALESCE(v_pickup ->> 'name', '')), '');
                v_pickup_phone := NULLIF(BTRIM(COALESCE(v_pickup ->> 'phone', '')), '');
                v_pickup_rel := COALESCE(NULLIF(BTRIM(v_pickup ->> 'relationship'), ''), 'Authorized Escort');
                v_doc_type := NULLIF(BTRIM(COALESCE(v_pickup ->> 'idProofType', '')), '');

                IF v_pickup_name IS NOT NULL AND v_pickup_phone IS NOT NULL THEN
                    INSERT INTO child_authorized_pickups (
                        id,
                        society_id,
                        child_id,
                        name,
                        phone,
                        relationship,
                        id_document_type,
                        id_document_last4,
                        id_verification_status,
                        photo_url,
                        status,
                        created_at,
                        updated_at
                    ) VALUES (
                        v_pickup_id,
                        rec.society_id,
                        rec.id,
                        v_pickup_name,
                        v_pickup_phone,
                        v_pickup_rel,
                        v_doc_type,
                        NULL, -- Never copy raw idProofNumber from legacy JSON
                        CASE WHEN v_doc_type IS NOT NULL THEN 'UNVERIFIED'::pickup_id_verification_status ELSE 'NOT_COLLECTED'::pickup_id_verification_status END,
                        NULLIF(BTRIM(COALESCE(v_pickup ->> 'photoUrl', '')), ''),
                        CASE UPPER(COALESCE(v_pickup ->> 'status', 'ACTIVE'))
                            WHEN 'ACTIVE' THEN 'ACTIVE'::pickup_authorization_status
                            WHEN 'REVOKED' THEN 'REVOKED'::pickup_authorization_status
                            WHEN 'EXPIRED' THEN 'EXPIRED'::pickup_authorization_status
                            ELSE 'REVOKED'::pickup_authorization_status
                        END,
                        COALESCE(rec.created_at, CURRENT_TIMESTAMP),
                        COALESCE(rec.updated_at, CURRENT_TIMESTAMP)
                    )
                    ON CONFLICT (id) DO NOTHING;
                ELSE
                    -- F-B21-04: Quarantine malformed pickup records missing name or phone
                    INSERT INTO child_safety_migration_quarantine (
                        id, legacy_source, legacy_source_id, society_id, quarantine_reason, sanitized_payload
                    ) VALUES (
                        'quar-pickup-' || md5(v_source || '-' || rec.id || '-' || v_pickup::text),
                        v_source || ':authorizedPickups',
                        rec.id || ':' || COALESCE(v_pickup ->> 'id', md5(v_pickup::text)),
                        rec.society_id,
                        'MALFORMED_PICKUP_JSON',
                        jsonb_build_object(
                            'childLegacyId', rec.id,
                            'societyId', rec.society_id,
                            'pickupName', v_pickup_name,
                            'hasPhone', (v_pickup_phone IS NOT NULL),
                            'relationship', v_pickup_rel,
                            'missingFields', CASE
                                WHEN v_pickup_name IS NULL AND v_pickup_phone IS NULL THEN 'NAME_AND_PHONE'
                                WHEN v_pickup_name IS NULL THEN 'NAME'
                                ELSE 'PHONE'
                            END
                        )
                    )
                    ON CONFLICT (legacy_source, legacy_source_id) DO NOTHING;
                END IF;
            END LOOP;
        END IF;
    END LOOP;

    -- --------------------------------------------------------------------------
    -- 4. Reconcile Legacy EntityRecord 'child_gate_passes'
    --    - Historical VERIFIED_EXITED passes -> audit row in child_exit_logs
    --    - Active weak 6-digit legacy passes -> quarantined for forced reissue
    --      (NEVER hash 6-digit passCode into token_hash!)
    -- --------------------------------------------------------------------------
    FOR rec IN
        SELECT er.id, er.society_id, er.data, er.created_at, er.updated_at
        FROM entity_records er
        WHERE er.collection = 'child_gate_passes'
        ORDER BY er.created_at ASC
    LOOP
        IF UPPER(COALESCE(rec.data ->> 'status', '')) IN ('VERIFIED_EXITED', 'USED')
           AND EXISTS (SELECT 1 FROM societies WHERE id = rec.society_id)
        THEN
            v_verified_at := NULL;
            IF NULLIF(BTRIM(COALESCE(rec.data ->> 'verifiedAt', '')), '') IS NOT NULL THEN
                BEGIN
                    v_verified_at := (rec.data ->> 'verifiedAt')::TIMESTAMPTZ(3);
                EXCEPTION WHEN OTHERS THEN
                    v_verified_at := NULL;
                END;
            END IF;

            INSERT INTO child_exit_logs (
                id,
                society_id,
                child_id,
                pass_id,
                child_name,
                flat_number,
                pickup_person_name,
                pickup_person_phone,
                gate_id,
                guard_id,
                guard_name,
                outcome,
                verification_channel,
                notes,
                timestamp
            )
            SELECT
                'legacy-exit-' || rec.id,
                rec.society_id,
                cp.id, -- NULL if child was not yet migrated; never violates FK
                NULL,  -- Legacy weak pass is not imported as an active cryptographic pass
                COALESCE(NULLIF(BTRIM(rec.data ->> 'childName'), ''), cp.full_name, 'Legacy Child Record'),
                COALESCE(NULLIF(BTRIM(rec.data ->> 'flatNumber'), ''), cp.flat_number, 'UNKNOWN'),
                COALESCE(NULLIF(BTRIM(rec.data ->> 'pickupPersonName'), ''), 'Legacy Escort'),
                NULLIF(BTRIM(COALESCE(rec.data ->> 'pickupPersonPhone', '')), ''),
                COALESCE(NULLIF(BTRIM(rec.data ->> 'exitGate'), ''), 'Legacy Gate'),
                NULL, -- Historical legacy record only stored guard display name
                COALESCE(NULLIF(BTRIM(rec.data ->> 'verifiedByGuard'), ''), 'Legacy Guard'),
                'ALLOWED'::child_exit_outcome,
                'ONLINE_PASS_CODE_ASSISTED'::child_verification_channel,
                'Migrated historical exit from legacy entity_records:child_gate_passes id=' || rec.id,
                COALESCE(
                    v_verified_at,
                    rec.updated_at,
                    rec.created_at,
                    CURRENT_TIMESTAMP
                )
            FROM (SELECT 1) AS dummy
            LEFT JOIN child_profiles cp
              ON cp.id = rec.data ->> 'childId'
             AND cp.society_id = rec.society_id
            ON CONFLICT (id) DO NOTHING;
        ELSE
            INSERT INTO child_safety_migration_quarantine (
                id, legacy_source, legacy_source_id, society_id, quarantine_reason, sanitized_payload
            ) VALUES (
                'quar-cpass-' || rec.id,
                'entity_records:child_gate_passes',
                rec.id,
                rec.society_id,
                'LEGACY_LOW_ENTROPY_PASS_REQUIRES_REISSUE',
                jsonb_build_object(
                    'id', rec.id,
                    'societyId', rec.society_id,
                    'childId', rec.data ->> 'childId',
                    'status', rec.data ->> 'status',
                    'validUntil', rec.data ->> 'validUntil'
                )
            )
            ON CONFLICT (legacy_source, legacy_source_id) DO NOTHING;
        END IF;
    END LOOP;
END $$;

COMMIT;
