-- ==============================================================================
-- AARIZO ISSUE-06 Phase B.2.1 Remediation Migration
-- Addresses Independent Audit Findings F-B21-01 through F-B21-08:
--   - Removes offline pass authorization (signature, OFFLINE_VERIFIED, OFFLINE_HMAC)
--   - Enforces cross-society relational integrity via composite unique & composite FKs
--   - Enforces actor-tenant isolation via BEFORE INSERT/UPDATE trigger
--   - Scopes pass_code uniqueness per society and drops redundant index
--   - Removes mandatory plaintext government ID storage (id_proof_number)
--   - Enforces active child ownership, archival consistency, and ON DELETE RESTRICT
--   - Aligns TIMESTAMPTZ(3), enums, CHECK constraints, defaults, and updated_at triggers
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Create Child Safety Enum Types (Schema-Aware & Idempotent)
-- ------------------------------------------------------------------------------
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'child_gender' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE "child_gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'UNSPECIFIED');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'child_status' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE "child_status" AS ENUM ('SAFE', 'OUT_OF_SOCIETY', 'MISSING', 'ARCHIVED');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'child_exit_permission_mode' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE "child_exit_permission_mode" AS ENUM ('ESCORT_REQUIRED', 'SOLO_ALLOWED', 'TIMED_PASS_ONLY', 'UNKNOWN');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'pickup_authorization_status' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE "pickup_authorization_status" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED', 'ARCHIVED');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'pickup_id_verification_status' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE "pickup_id_verification_status" AS ENUM ('NOT_COLLECTED', 'UNVERIFIED', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'child_gate_pass_status' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE "child_gate_pass_status" AS ENUM ('ACTIVE', 'USED', 'EXPIRED', 'REVOKED', 'ARCHIVED');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'child_exit_outcome' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE "child_exit_outcome" AS ENUM ('ALLOWED', 'DENIED', 'MISSING_ALERT_BLOCKED', 'VERIFICATION_UNAVAILABLE');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'child_verification_channel' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE "child_verification_channel" AS ENUM (
            'ONLINE_QR_TOKEN',
            'ONLINE_PASS_CODE_ASSISTED',
            'MANUAL_OVERRIDE_DENIED',
            'BACKEND_UNAVAILABLE'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'child_alert_type' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE "child_alert_type" AS ENUM (
            'MISSING_CHILD',
            'UNATTENDED_CHILD',
            'UNAUTHORIZED_EXIT_ATTEMPT',
            'EMERGENCY_SOS'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'child_alert_status' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE "child_alert_status" AS ENUM ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_ALARM');
    END IF;

    -- Ensure Prisma's canonical IncidentSeverity enum exists if migrating a non-Prisma bootstrap
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'IncidentSeverity' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE "IncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2. Add Composite Tenant Unique Constraints on Existing Parent Tables
-- ------------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "uq_flats_society_id" ON "flats"("society_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_residents_society_id" ON "residents"("society_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_emergency_incidents_society_id" ON "emergency_incidents"("society_id", "id");

-- ------------------------------------------------------------------------------
-- 3. Drop Old Single-Column FKs and Redundant/Unscoped Indexes
-- ------------------------------------------------------------------------------
ALTER TABLE "child_profiles"
    DROP CONSTRAINT IF EXISTS "child_profiles_society_id_fkey",
    DROP CONSTRAINT IF EXISTS "child_profiles_resident_id_fkey",
    DROP CONSTRAINT IF EXISTS "child_profiles_flat_id_fkey";

ALTER TABLE "child_authorized_pickups"
    DROP CONSTRAINT IF EXISTS "child_authorized_pickups_society_id_fkey",
    DROP CONSTRAINT IF EXISTS "child_authorized_pickups_child_id_fkey";

ALTER TABLE "child_gate_passes"
    DROP CONSTRAINT IF EXISTS "child_gate_passes_society_id_fkey",
    DROP CONSTRAINT IF EXISTS "child_gate_passes_child_id_fkey",
    DROP CONSTRAINT IF EXISTS "child_gate_passes_pickup_person_id_fkey";

ALTER TABLE "child_exit_logs"
    DROP CONSTRAINT IF EXISTS "child_exit_logs_society_id_fkey",
    DROP CONSTRAINT IF EXISTS "child_exit_logs_child_id_fkey",
    DROP CONSTRAINT IF EXISTS "child_exit_logs_pass_id_fkey";

ALTER TABLE "child_safety_alerts"
    DROP CONSTRAINT IF EXISTS "child_safety_alerts_society_id_fkey",
    DROP CONSTRAINT IF EXISTS "child_safety_alerts_child_id_fkey",
    DROP CONSTRAINT IF EXISTS "child_safety_alerts_reported_by_id_fkey",
    DROP CONSTRAINT IF EXISTS "child_safety_alerts_emergency_incident_id_fkey";

DROP INDEX IF EXISTS "child_gate_passes_pass_code_key";
DROP INDEX IF EXISTS "idx_child_passes_code";

-- ------------------------------------------------------------------------------
-- 4. Remediate child_profiles
-- ------------------------------------------------------------------------------
ALTER TABLE "child_profiles"
    ADD COLUMN IF NOT EXISTS "guardian_user_id" TEXT,
    ADD COLUMN IF NOT EXISTS "reported_age" INTEGER,
    ADD COLUMN IF NOT EXISTS "exit_permission_mode" "child_exit_permission_mode" NOT NULL DEFAULT 'ESCORT_REQUIRED',
    ADD COLUMN IF NOT EXISTS "secondary_guardians" JSONB,
    ADD COLUMN IF NOT EXISTS "emergency_contacts" JSONB,
    ADD COLUMN IF NOT EXISTS "legacy_source" TEXT,
    ADD COLUMN IF NOT EXISTS "legacy_source_id" TEXT,
    ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ(3),
    ADD COLUMN IF NOT EXISTS "archived_by_id" TEXT;

ALTER TABLE "child_profiles"
    ALTER COLUMN "date_of_birth" DROP NOT NULL,
    ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "created_at" SET NOT NULL,
    ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "updated_at" SET NOT NULL;

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'child_profiles'
          AND column_name = 'gender'
          AND udt_name <> 'child_gender'
    ) THEN
        ALTER TABLE "child_profiles" ALTER COLUMN "gender" DROP DEFAULT;
        ALTER TABLE "child_profiles" ALTER COLUMN "gender" TYPE "child_gender" USING (
            CASE UPPER(COALESCE("gender"::text, ''))
                WHEN 'MALE' THEN 'MALE'::"child_gender"
                WHEN 'FEMALE' THEN 'FEMALE'::"child_gender"
                WHEN 'OTHER' THEN 'OTHER'::"child_gender"
                ELSE 'UNSPECIFIED'::"child_gender"
            END
        );
        ALTER TABLE "child_profiles" ALTER COLUMN "gender" SET DEFAULT 'UNSPECIFIED'::"child_gender";
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'child_profiles'
          AND column_name = 'status'
          AND udt_name <> 'child_status'
    ) THEN
        ALTER TABLE "child_profiles" ALTER COLUMN "status" DROP DEFAULT;
        ALTER TABLE "child_profiles" ALTER COLUMN "status" TYPE "child_status" USING (
            CASE UPPER(COALESCE("status"::text, ''))
                WHEN 'SAFE' THEN 'SAFE'::"child_status"
                WHEN 'OUT_OF_SOCIETY' THEN 'OUT_OF_SOCIETY'::"child_status"
                WHEN 'MISSING' THEN 'MISSING'::"child_status"
                WHEN 'ARCHIVED' THEN 'ARCHIVED'::"child_status"
                ELSE 'SAFE'::"child_status"
            END
        );
        ALTER TABLE "child_profiles" ALTER COLUMN "status" SET DEFAULT 'SAFE'::"child_status";
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 5. Remediate child_authorized_pickups (F-B21-04: Remove plaintext ID storage)
-- ------------------------------------------------------------------------------
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'child_authorized_pickups'
          AND column_name = 'id_proof_type'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'child_authorized_pickups'
          AND column_name = 'id_document_type'
    ) THEN
        ALTER TABLE "child_authorized_pickups" RENAME COLUMN "id_proof_type" TO "id_document_type";
    END IF;
END $$;

-- Drop raw government ID column directly without copying sensitive values anywhere
ALTER TABLE "child_authorized_pickups"
    DROP COLUMN IF EXISTS "id_proof_number",
    ADD COLUMN IF NOT EXISTS "id_document_type" TEXT,
    ADD COLUMN IF NOT EXISTS "id_document_last4" VARCHAR(4),
    ADD COLUMN IF NOT EXISTS "id_document_hash" TEXT,
    ADD COLUMN IF NOT EXISTS "id_verification_status" "pickup_id_verification_status" NOT NULL DEFAULT 'NOT_COLLECTED',
    ADD COLUMN IF NOT EXISTS "id_verified_at" TIMESTAMPTZ(3),
    ADD COLUMN IF NOT EXISTS "verified_by_id" TEXT,
    ADD COLUMN IF NOT EXISTS "created_by_id" TEXT,
    ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ(3);

ALTER TABLE "child_authorized_pickups"
    ALTER COLUMN "id_document_type" DROP NOT NULL,
    ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "created_at" SET NOT NULL,
    ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "updated_at" SET NOT NULL;

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'child_authorized_pickups'
          AND column_name = 'status'
          AND udt_name <> 'pickup_authorization_status'
    ) THEN
        ALTER TABLE "child_authorized_pickups" ALTER COLUMN "status" DROP DEFAULT;
        ALTER TABLE "child_authorized_pickups" ALTER COLUMN "status" TYPE "pickup_authorization_status" USING (
            CASE UPPER(COALESCE("status"::text, ''))
                WHEN 'ACTIVE' THEN 'ACTIVE'::"pickup_authorization_status"
                WHEN 'REVOKED' THEN 'REVOKED'::"pickup_authorization_status"
                WHEN 'EXPIRED' THEN 'EXPIRED'::"pickup_authorization_status"
                WHEN 'ARCHIVED' THEN 'ARCHIVED'::"pickup_authorization_status"
                ELSE 'REVOKED'::"pickup_authorization_status"
            END
        );
        ALTER TABLE "child_authorized_pickups" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'::"pickup_authorization_status";
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 6. Remediate child_gate_passes (F-B21-01: Remove offline signature; F-B21-03)
-- ------------------------------------------------------------------------------
ALTER TABLE "child_gate_passes"
    DROP COLUMN IF EXISTS "signature",
    ADD COLUMN IF NOT EXISTS "revoked_by_id" TEXT,
    ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ(3);

ALTER TABLE "child_gate_passes"
    ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "created_at" SET NOT NULL,
    ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "updated_at" SET NOT NULL;

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'child_gate_passes'
          AND column_name = 'status'
          AND udt_name <> 'child_gate_pass_status'
    ) THEN
        ALTER TABLE "child_gate_passes" ALTER COLUMN "status" DROP DEFAULT;
        ALTER TABLE "child_gate_passes" ALTER COLUMN "status" TYPE "child_gate_pass_status" USING (
            CASE UPPER(COALESCE("status"::text, ''))
                WHEN 'ACTIVE' THEN 'ACTIVE'::"child_gate_pass_status"
                WHEN 'USED' THEN 'USED'::"child_gate_pass_status"
                WHEN 'EXPIRED' THEN 'EXPIRED'::"child_gate_pass_status"
                WHEN 'REVOKED' THEN 'REVOKED'::"child_gate_pass_status"
                WHEN 'ARCHIVED' THEN 'ARCHIVED'::"child_gate_pass_status"
                ELSE 'REVOKED'::"child_gate_pass_status"
            END
        );
        ALTER TABLE "child_gate_passes" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'::"child_gate_pass_status";
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 7. Remediate child_exit_logs (F-B21-01: Remove OFFLINE_VERIFIED/OFFLINE_HMAC)
-- ------------------------------------------------------------------------------
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'child_exit_logs'
          AND column_name = 'status'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'child_exit_logs'
          AND column_name = 'outcome'
    ) THEN
        ALTER TABLE "child_exit_logs" RENAME COLUMN "status" TO "outcome";
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'child_exit_logs'
          AND column_name = 'verification_mode'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'child_exit_logs'
          AND column_name = 'verification_channel'
    ) THEN
        ALTER TABLE "child_exit_logs" RENAME COLUMN "verification_mode" TO "verification_channel";
    END IF;
END $$;

ALTER TABLE "child_exit_logs"
    ADD COLUMN IF NOT EXISTS "pickup_person_id" TEXT,
    ADD COLUMN IF NOT EXISTS "denial_reason" TEXT,
    ALTER COLUMN "guard_id" DROP NOT NULL,
    ALTER COLUMN "timestamp" SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "timestamp" SET NOT NULL;

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'child_exit_logs'
          AND column_name = 'outcome'
          AND udt_name <> 'child_exit_outcome'
    ) THEN
        ALTER TABLE "child_exit_logs" ALTER COLUMN "outcome" DROP DEFAULT;
        ALTER TABLE "child_exit_logs" ALTER COLUMN "outcome" TYPE "child_exit_outcome" USING (
            CASE UPPER(COALESCE("outcome"::text, ''))
                WHEN 'ALLOWED' THEN 'ALLOWED'::"child_exit_outcome"
                WHEN 'DENIED' THEN 'DENIED'::"child_exit_outcome"
                WHEN 'MISSING_ALERT_BLOCKED' THEN 'MISSING_ALERT_BLOCKED'::"child_exit_outcome"
                WHEN 'VERIFICATION_UNAVAILABLE' THEN 'VERIFICATION_UNAVAILABLE'::"child_exit_outcome"
                ELSE 'VERIFICATION_UNAVAILABLE'::"child_exit_outcome"
            END
        );
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'child_exit_logs'
          AND column_name = 'verification_channel'
          AND udt_name <> 'child_verification_channel'
    ) THEN
        ALTER TABLE "child_exit_logs" ALTER COLUMN "verification_channel" DROP DEFAULT;
        ALTER TABLE "child_exit_logs" ALTER COLUMN "verification_channel" TYPE "child_verification_channel" USING (
            CASE UPPER(COALESCE("verification_channel"::text, ''))
                WHEN 'ONLINE' THEN 'ONLINE_QR_TOKEN'::"child_verification_channel"
                WHEN 'ONLINE_QR_TOKEN' THEN 'ONLINE_QR_TOKEN'::"child_verification_channel"
                WHEN 'ONLINE_PASS_CODE_ASSISTED' THEN 'ONLINE_PASS_CODE_ASSISTED'::"child_verification_channel"
                WHEN 'MANUAL_OVERRIDE_DENIED' THEN 'MANUAL_OVERRIDE_DENIED'::"child_verification_channel"
                ELSE 'BACKEND_UNAVAILABLE'::"child_verification_channel"
            END
        );
        ALTER TABLE "child_exit_logs" ALTER COLUMN "verification_channel" SET DEFAULT 'ONLINE_QR_TOKEN'::"child_verification_channel";
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 8. Remediate child_safety_alerts (F-B21-08: Enums & Actor FKs)
-- ------------------------------------------------------------------------------
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'child_safety_alerts'
          AND column_name = 'acknowledged_by'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'child_safety_alerts'
          AND column_name = 'acknowledged_by_name'
    ) THEN
        ALTER TABLE "child_safety_alerts" RENAME COLUMN "acknowledged_by" TO "acknowledged_by_name";
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'child_safety_alerts'
          AND column_name = 'resolved_by'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'child_safety_alerts'
          AND column_name = 'resolved_by_name'
    ) THEN
        ALTER TABLE "child_safety_alerts" RENAME COLUMN "resolved_by" TO "resolved_by_name";
    END IF;
END $$;

ALTER TABLE "child_safety_alerts"
    ADD COLUMN IF NOT EXISTS "reported_by_name" TEXT,
    ADD COLUMN IF NOT EXISTS "acknowledged_by_id" TEXT,
    ADD COLUMN IF NOT EXISTS "acknowledged_by_name" TEXT,
    ADD COLUMN IF NOT EXISTS "resolved_by_id" TEXT,
    ADD COLUMN IF NOT EXISTS "resolved_by_name" TEXT,
    ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "created_at" SET NOT NULL,
    ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "updated_at" SET NOT NULL;

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'child_safety_alerts'
          AND column_name = 'alert_type'
          AND udt_name <> 'child_alert_type'
    ) THEN
        ALTER TABLE "child_safety_alerts" ALTER COLUMN "alert_type" TYPE "child_alert_type" USING (
            CASE UPPER(COALESCE("alert_type"::text, ''))
                WHEN 'MISSING_CHILD' THEN 'MISSING_CHILD'::"child_alert_type"
                WHEN 'UNATTENDED_CHILD' THEN 'UNATTENDED_CHILD'::"child_alert_type"
                WHEN 'UNAUTHORIZED_EXIT_ATTEMPT' THEN 'UNAUTHORIZED_EXIT_ATTEMPT'::"child_alert_type"
                ELSE 'EMERGENCY_SOS'::"child_alert_type"
            END
        );
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'child_safety_alerts'
          AND column_name = 'severity'
          AND udt_name NOT IN ('IncidentSeverity', 'incident_severity')
    ) THEN
        ALTER TABLE "child_safety_alerts" ALTER COLUMN "severity" DROP DEFAULT;
        ALTER TABLE "child_safety_alerts" ALTER COLUMN "severity" TYPE "IncidentSeverity" USING (
            CASE UPPER(COALESCE("severity"::text, ''))
                WHEN 'LOW' THEN 'LOW'::"IncidentSeverity"
                WHEN 'MEDIUM' THEN 'MEDIUM'::"IncidentSeverity"
                WHEN 'HIGH' THEN 'HIGH'::"IncidentSeverity"
                ELSE 'CRITICAL'::"IncidentSeverity"
            END
        );
        ALTER TABLE "child_safety_alerts" ALTER COLUMN "severity" SET DEFAULT 'CRITICAL'::"IncidentSeverity";
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'child_safety_alerts'
          AND column_name = 'status'
          AND udt_name <> 'child_alert_status'
    ) THEN
        ALTER TABLE "child_safety_alerts" ALTER COLUMN "status" DROP DEFAULT;
        ALTER TABLE "child_safety_alerts" ALTER COLUMN "status" TYPE "child_alert_status" USING (
            CASE UPPER(COALESCE("status"::text, ''))
                WHEN 'ACTIVE' THEN 'ACTIVE'::"child_alert_status"
                WHEN 'ACKNOWLEDGED' THEN 'ACKNOWLEDGED'::"child_alert_status"
                WHEN 'RESOLVED' THEN 'RESOLVED'::"child_alert_status"
                WHEN 'FALSE_ALARM' THEN 'FALSE_ALARM'::"child_alert_status"
                ELSE 'ACTIVE'::"child_alert_status"
            END
        );
        ALTER TABLE "child_safety_alerts" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'::"child_alert_status";
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 8b. Idempotent Timezone-Safe TIMESTAMPTZ(3) Alignment (All 5 Child Tables)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN
        SELECT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name IN (
              'child_profiles',
              'child_authorized_pickups',
              'child_gate_passes',
              'child_exit_logs',
              'child_safety_alerts'
          )
          AND data_type IN ('timestamp without time zone', 'timestamp with time zone')
    LOOP
        IF rec.data_type = 'timestamp without time zone' THEN
            EXECUTE format(
                'ALTER TABLE %I.%I ALTER COLUMN %I TYPE TIMESTAMPTZ(3) USING %I AT TIME ZONE ''UTC'';',
                current_schema(), rec.table_name, rec.column_name, rec.column_name
            );
        ELSE
            EXECUTE format(
                'ALTER TABLE %I.%I ALTER COLUMN %I TYPE TIMESTAMPTZ(3);',
                current_schema(), rec.table_name, rec.column_name
            );
        END IF;
    END LOOP;
END $$;

-- ------------------------------------------------------------------------------
-- 9. Composite Unique Constraints & Performance Indexes on Child Tables
-- ------------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "uq_child_profiles_society_id" ON "child_profiles"("society_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_child_profiles_legacy_source" ON "child_profiles"("society_id", "legacy_source", "legacy_source_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_child_pickups_society_id" ON "child_authorized_pickups"("society_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_child_pickups_society_child_id" ON "child_authorized_pickups"("society_id", "child_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_child_passes_society_id" ON "child_gate_passes"("society_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_child_passes_society_code" ON "child_gate_passes"("society_id", "pass_code");
CREATE UNIQUE INDEX IF NOT EXISTS "child_gate_passes_token_hash_key" ON "child_gate_passes"("token_hash");

CREATE INDEX IF NOT EXISTS "idx_child_exit_logs_pickup" ON "child_exit_logs"("pickup_person_id");

-- ------------------------------------------------------------------------------
-- 10. Composite Tenant-Scoped Foreign Keys & Actor Foreign Keys
--     (Schema-Aware & Table-Aware Constraint Guards)
-- ------------------------------------------------------------------------------
DO $$ BEGIN
    -- child_profiles FKs
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'child_profiles_society_id_fkey'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_profiles'))
    ) THEN
        ALTER TABLE "child_profiles"
            ADD CONSTRAINT "child_profiles_society_id_fkey"
            FOREIGN KEY ("society_id") REFERENCES "societies"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'child_profiles_society_id_resident_id_fkey'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_profiles'))
    ) THEN
        ALTER TABLE "child_profiles"
            ADD CONSTRAINT "child_profiles_society_id_resident_id_fkey"
            FOREIGN KEY ("society_id", "resident_id") REFERENCES "residents"("society_id", "id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'child_profiles_society_id_flat_id_fkey'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_profiles'))
    ) THEN
        ALTER TABLE "child_profiles"
            ADD CONSTRAINT "child_profiles_society_id_flat_id_fkey"
            FOREIGN KEY ("society_id", "flat_id") REFERENCES "flats"("society_id", "id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'child_profiles_guardian_user_id_fkey'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_profiles'))
    ) THEN
        ALTER TABLE "child_profiles"
            ADD CONSTRAINT "child_profiles_guardian_user_id_fkey"
            FOREIGN KEY ("guardian_user_id") REFERENCES "users"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'child_profiles_archived_by_id_fkey'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_profiles'))
    ) THEN
        ALTER TABLE "child_profiles"
            ADD CONSTRAINT "child_profiles_archived_by_id_fkey"
            FOREIGN KEY ("archived_by_id") REFERENCES "users"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    -- child_authorized_pickups FKs
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'child_authorized_pickups_society_id_fkey'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_authorized_pickups'))
    ) THEN
        ALTER TABLE "child_authorized_pickups"
            ADD CONSTRAINT "child_authorized_pickups_society_id_fkey"
            FOREIGN KEY ("society_id") REFERENCES "societies"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'child_authorized_pickups_society_id_child_id_fkey'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_authorized_pickups'))
    ) THEN
        ALTER TABLE "child_authorized_pickups"
            ADD CONSTRAINT "child_authorized_pickups_society_id_child_id_fkey"
            FOREIGN KEY ("society_id", "child_id") REFERENCES "child_profiles"("society_id", "id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'child_authorized_pickups_created_by_id_fkey'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_authorized_pickups'))
    ) THEN
        ALTER TABLE "child_authorized_pickups"
            ADD CONSTRAINT "child_authorized_pickups_created_by_id_fkey"
            FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'child_authorized_pickups_verified_by_id_fkey'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_authorized_pickups'))
    ) THEN
        ALTER TABLE "child_authorized_pickups"
            ADD CONSTRAINT "child_authorized_pickups_verified_by_id_fkey"
            FOREIGN KEY ("verified_by_id") REFERENCES "users"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    -- child_gate_passes FKs
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'child_gate_passes_society_id_fkey'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_gate_passes'))
    ) THEN
        ALTER TABLE "child_gate_passes"
            ADD CONSTRAINT "child_gate_passes_society_id_fkey"
            FOREIGN KEY ("society_id") REFERENCES "societies"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'child_gate_passes_society_id_child_id_fkey'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_gate_passes'))
    ) THEN
        ALTER TABLE "child_gate_passes"
            ADD CONSTRAINT "child_gate_passes_society_id_child_id_fkey"
            FOREIGN KEY ("society_id", "child_id") REFERENCES "child_profiles"("society_id", "id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'child_gate_passes_society_id_child_id_pickup_person_id_fkey'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_gate_passes'))
    ) THEN
        ALTER TABLE "child_gate_passes"
            ADD CONSTRAINT "child_gate_passes_society_id_child_id_pickup_person_id_fkey"
            FOREIGN KEY ("society_id", "child_id", "pickup_person_id")
            REFERENCES "child_authorized_pickups"("society_id", "child_id", "id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'child_gate_passes_created_by_id_fkey'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_gate_passes'))
    ) THEN
        ALTER TABLE "child_gate_passes"
            ADD CONSTRAINT "child_gate_passes_created_by_id_fkey"
            FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'child_gate_passes_revoked_by_id_fkey'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_gate_passes'))
    ) THEN
        ALTER TABLE "child_gate_passes"
            ADD CONSTRAINT "child_gate_passes_revoked_by_id_fkey"
            FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    -- child_exit_logs FKs
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'child_exit_logs_society_id_fkey'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_exit_logs'))
    ) THEN
        ALTER TABLE "child_exit_logs"
            ADD CONSTRAINT "child_exit_logs_society_id_fkey"
            FOREIGN KEY ("society_id") REFERENCES "societies"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'child_exit_logs_society_id_child_id_fkey'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_exit_logs'))
    ) THEN
        ALTER TABLE "child_exit_logs"
            ADD CONSTRAINT "child_exit_logs_society_id_child_id_fkey"
            FOREIGN KEY ("society_id", "child_id") REFERENCES "child_profiles"("society_id", "id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'child_exit_logs_society_id_pass_id_fkey'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_exit_logs'))
    ) THEN
        ALTER TABLE "child_exit_logs"
            ADD CONSTRAINT "child_exit_logs_society_id_pass_id_fkey"
            FOREIGN KEY ("society_id", "pass_id") REFERENCES "child_gate_passes"("society_id", "id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'child_exit_logs_society_id_pickup_person_id_fkey'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_exit_logs'))
    ) THEN
        ALTER TABLE "child_exit_logs"
            ADD CONSTRAINT "child_exit_logs_society_id_pickup_person_id_fkey"
            FOREIGN KEY ("society_id", "pickup_person_id") REFERENCES "child_authorized_pickups"("society_id", "id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'child_exit_logs_guard_id_fkey'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_exit_logs'))
    ) THEN
        ALTER TABLE "child_exit_logs"
            ADD CONSTRAINT "child_exit_logs_guard_id_fkey"
            FOREIGN KEY ("guard_id") REFERENCES "users"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    -- child_safety_alerts FKs
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'child_safety_alerts_society_id_fkey'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_safety_alerts'))
    ) THEN
        ALTER TABLE "child_safety_alerts"
            ADD CONSTRAINT "child_safety_alerts_society_id_fkey"
            FOREIGN KEY ("society_id") REFERENCES "societies"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'child_safety_alerts_society_id_child_id_fkey'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_safety_alerts'))
    ) THEN
        ALTER TABLE "child_safety_alerts"
            ADD CONSTRAINT "child_safety_alerts_society_id_child_id_fkey"
            FOREIGN KEY ("society_id", "child_id") REFERENCES "child_profiles"("society_id", "id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'child_safety_alerts_reported_by_id_fkey'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_safety_alerts'))
    ) THEN
        ALTER TABLE "child_safety_alerts"
            ADD CONSTRAINT "child_safety_alerts_reported_by_id_fkey"
            FOREIGN KEY ("reported_by_id") REFERENCES "users"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'child_safety_alerts_acknowledged_by_id_fkey'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_safety_alerts'))
    ) THEN
        ALTER TABLE "child_safety_alerts"
            ADD CONSTRAINT "child_safety_alerts_acknowledged_by_id_fkey"
            FOREIGN KEY ("acknowledged_by_id") REFERENCES "users"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'child_safety_alerts_resolved_by_id_fkey'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_safety_alerts'))
    ) THEN
        ALTER TABLE "child_safety_alerts"
            ADD CONSTRAINT "child_safety_alerts_resolved_by_id_fkey"
            FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'child_safety_alerts_society_id_emergency_incident_id_fkey'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_safety_alerts'))
    ) THEN
        ALTER TABLE "child_safety_alerts"
            ADD CONSTRAINT "child_safety_alerts_society_id_emergency_incident_id_fkey"
            FOREIGN KEY ("society_id", "emergency_incident_id")
            REFERENCES "emergency_incidents"("society_id", "id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 11. Database CHECK Constraints (F-B21-01, F-B21-04, F-B21-05, F-B21-08)
-- ------------------------------------------------------------------------------
DO $$ BEGIN
    -- child_profiles CHECKs
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'chk_child_profiles_active_owner'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_profiles'))
    ) THEN
        ALTER TABLE "child_profiles"
            ADD CONSTRAINT "chk_child_profiles_active_owner"
            CHECK ("status" = 'ARCHIVED' OR "archived_at" IS NOT NULL OR ("resident_id" IS NOT NULL AND "flat_id" IS NOT NULL));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'chk_child_profiles_archive_consistency'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_profiles'))
    ) THEN
        ALTER TABLE "child_profiles"
            ADD CONSTRAINT "chk_child_profiles_archive_consistency"
            CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'chk_child_profiles_reported_age'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_profiles'))
    ) THEN
        ALTER TABLE "child_profiles"
            ADD CONSTRAINT "chk_child_profiles_reported_age"
            CHECK ("reported_age" IS NULL OR ("reported_age" >= 0 AND "reported_age" <= 25));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'chk_child_profiles_dob_not_future'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_profiles'))
    ) THEN
        ALTER TABLE "child_profiles"
            ADD CONSTRAINT "chk_child_profiles_dob_not_future"
            CHECK ("date_of_birth" IS NULL OR "date_of_birth" <= CURRENT_TIMESTAMP);
    END IF;

    -- child_authorized_pickups CHECKs
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'chk_child_pickups_archive_consistency'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_authorized_pickups'))
    ) THEN
        ALTER TABLE "child_authorized_pickups"
            ADD CONSTRAINT "chk_child_pickups_archive_consistency"
            CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'chk_child_pickups_last4_len'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_authorized_pickups'))
    ) THEN
        ALTER TABLE "child_authorized_pickups"
            ADD CONSTRAINT "chk_child_pickups_last4_len"
            CHECK ("id_document_last4" IS NULL OR char_length("id_document_last4") BETWEEN 1 AND 4);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'chk_child_pickups_hash_format'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_authorized_pickups'))
    ) THEN
        ALTER TABLE "child_authorized_pickups"
            ADD CONSTRAINT "chk_child_pickups_hash_format"
            CHECK ("id_document_hash" IS NULL OR "id_document_hash" ~ '^[0-9a-f]{64}$');
    END IF;

    -- child_gate_passes CHECKs
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'chk_child_passes_validity_window'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_gate_passes'))
    ) THEN
        ALTER TABLE "child_gate_passes"
            ADD CONSTRAINT "chk_child_passes_validity_window"
            CHECK ("valid_until" > "valid_from");
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'chk_child_passes_max_uses_positive'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_gate_passes'))
    ) THEN
        ALTER TABLE "child_gate_passes"
            ADD CONSTRAINT "chk_child_passes_max_uses_positive"
            CHECK ("max_uses" >= 1);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'chk_child_passes_uses_bounds'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_gate_passes'))
    ) THEN
        ALTER TABLE "child_gate_passes"
            ADD CONSTRAINT "chk_child_passes_uses_bounds"
            CHECK ("current_uses" >= 0 AND "current_uses" <= "max_uses");
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'chk_child_passes_token_hash_format'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_gate_passes'))
    ) THEN
        ALTER TABLE "child_gate_passes"
            ADD CONSTRAINT "chk_child_passes_token_hash_format"
            CHECK ("token_hash" ~ '^[0-9a-f]{64}$');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'chk_child_passes_archive_consistency'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_gate_passes'))
    ) THEN
        ALTER TABLE "child_gate_passes"
            ADD CONSTRAINT "chk_child_passes_archive_consistency"
            CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'chk_child_passes_revoke_consistency'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_gate_passes'))
    ) THEN
        ALTER TABLE "child_gate_passes"
            ADD CONSTRAINT "chk_child_passes_revoke_consistency"
            CHECK ("status" <> 'REVOKED' OR "revoked_at" IS NOT NULL);
    END IF;

    -- child_exit_logs CHECKs (Fail-Closed Invariant)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'chk_child_exit_logs_unavailable_channel'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_exit_logs'))
    ) THEN
        ALTER TABLE "child_exit_logs"
            ADD CONSTRAINT "chk_child_exit_logs_unavailable_channel"
            CHECK ("verification_channel" <> 'BACKEND_UNAVAILABLE' OR "outcome" = 'VERIFICATION_UNAVAILABLE');
    END IF;

    -- child_safety_alerts CHECKs
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'chk_child_alerts_ack_consistency'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_safety_alerts'))
    ) THEN
        ALTER TABLE "child_safety_alerts"
            ADD CONSTRAINT "chk_child_alerts_ack_consistency"
            CHECK ("status" <> 'ACKNOWLEDGED' OR "acknowledged_at" IS NOT NULL);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'chk_child_alerts_resolved_consistency'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_safety_alerts'))
    ) THEN
        ALTER TABLE "child_safety_alerts"
            ADD CONSTRAINT "chk_child_alerts_resolved_consistency"
            CHECK (("status" NOT IN ('RESOLVED', 'FALSE_ALARM')) OR "resolved_at" IS NOT NULL);
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 12. Automated updated_at Trigger & Cross-Society Actor Validation Trigger
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_updated_at ON "child_profiles";
CREATE TRIGGER trg_set_updated_at
    BEFORE UPDATE ON "child_profiles"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_set_updated_at ON "child_authorized_pickups";
CREATE TRIGGER trg_set_updated_at
    BEFORE UPDATE ON "child_authorized_pickups"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_set_updated_at ON "child_gate_passes";
CREATE TRIGGER trg_set_updated_at
    BEFORE UPDATE ON "child_gate_passes"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_set_updated_at ON "child_safety_alerts";
CREATE TRIGGER trg_set_updated_at
    BEFORE UPDATE ON "child_safety_alerts"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION enforce_child_safety_actor_tenant()
RETURNS TRIGGER AS $$
DECLARE
    v_col TEXT;
    v_actor_id TEXT;
    v_actor_society TEXT;
    v_row JSONB := to_jsonb(NEW);
BEGIN
    FOREACH v_col IN ARRAY TG_ARGV LOOP
        v_actor_id := v_row ->> v_col;
        IF v_actor_id IS NOT NULL THEN
            SELECT society_id INTO v_actor_society FROM users WHERE id = v_actor_id;
            -- Platform admins may have users.society_id IS NULL; society-bound users must match NEW.society_id
            IF FOUND AND v_actor_society IS NOT NULL AND v_actor_society <> NEW.society_id THEN
                RAISE EXCEPTION 'Cross-society actor reference rejected on %.%: user % belongs to society %, target row belongs to society %',
                    TG_TABLE_NAME, v_col, v_actor_id, v_actor_society, NEW.society_id
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_child_profiles_actor_tenant ON "child_profiles";
CREATE TRIGGER trg_child_profiles_actor_tenant
    BEFORE INSERT OR UPDATE ON "child_profiles"
    FOR EACH ROW EXECUTE FUNCTION enforce_child_safety_actor_tenant('guardian_user_id', 'archived_by_id');

DROP TRIGGER IF EXISTS trg_child_pickups_actor_tenant ON "child_authorized_pickups";
CREATE TRIGGER trg_child_pickups_actor_tenant
    BEFORE INSERT OR UPDATE ON "child_authorized_pickups"
    FOR EACH ROW EXECUTE FUNCTION enforce_child_safety_actor_tenant('created_by_id', 'verified_by_id');

DROP TRIGGER IF EXISTS trg_child_passes_actor_tenant ON "child_gate_passes";
CREATE TRIGGER trg_child_passes_actor_tenant
    BEFORE INSERT OR UPDATE ON "child_gate_passes"
    FOR EACH ROW EXECUTE FUNCTION enforce_child_safety_actor_tenant('created_by_id', 'revoked_by_id');

DROP TRIGGER IF EXISTS trg_child_exit_logs_actor_tenant ON "child_exit_logs";
CREATE TRIGGER trg_child_exit_logs_actor_tenant
    BEFORE INSERT OR UPDATE ON "child_exit_logs"
    FOR EACH ROW EXECUTE FUNCTION enforce_child_safety_actor_tenant('guard_id');

DROP TRIGGER IF EXISTS trg_child_alerts_actor_tenant ON "child_safety_alerts";
CREATE TRIGGER trg_child_alerts_actor_tenant
    BEFORE INSERT OR UPDATE ON "child_safety_alerts"
    FOR EACH ROW EXECUTE FUNCTION enforce_child_safety_actor_tenant('reported_by_id', 'acknowledged_by_id', 'resolved_by_id');
