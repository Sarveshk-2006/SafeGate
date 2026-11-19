-- CreateTable
CREATE TABLE IF NOT EXISTS "child_profiles" (
    "id" TEXT NOT NULL,
    "society_id" TEXT NOT NULL,
    "resident_id" TEXT,
    "flat_id" TEXT,
    "flat_number" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "date_of_birth" TIMESTAMP(3) NOT NULL,
    "gender" TEXT NOT NULL DEFAULT 'MALE',
    "photo_url" TEXT,
    "medical_notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SAFE',
    "allowed_solo_exit" BOOLEAN NOT NULL DEFAULT false,
    "guardian_name" TEXT NOT NULL,
    "guardian_phone" TEXT NOT NULL,
    "emergency_phone" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "child_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "child_authorized_pickups" (
    "id" TEXT NOT NULL,
    "society_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "id_proof_type" TEXT NOT NULL,
    "id_proof_number" TEXT NOT NULL,
    "photo_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "valid_until" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "child_authorized_pickups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "child_gate_passes" (
    "id" TEXT NOT NULL,
    "society_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "pickup_person_id" TEXT,
    "pass_code" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "signature" TEXT,
    "pickup_person_name" TEXT NOT NULL,
    "pickup_person_phone" TEXT,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_until" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "max_uses" INTEGER NOT NULL DEFAULT 1,
    "current_uses" INTEGER NOT NULL DEFAULT 0,
    "first_used_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revocation_reason" TEXT,
    "created_by_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "child_gate_passes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "child_exit_logs" (
    "id" TEXT NOT NULL,
    "society_id" TEXT NOT NULL,
    "child_id" TEXT,
    "pass_id" TEXT,
    "child_name" TEXT NOT NULL,
    "flat_number" TEXT NOT NULL,
    "pickup_person_name" TEXT NOT NULL,
    "pickup_person_phone" TEXT,
    "gate_id" TEXT NOT NULL,
    "guard_id" TEXT NOT NULL,
    "guard_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "verification_mode" TEXT NOT NULL DEFAULT 'ONLINE',
    "notes" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "child_exit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "child_safety_alerts" (
    "id" TEXT NOT NULL,
    "society_id" TEXT NOT NULL,
    "child_id" TEXT,
    "reported_by_id" TEXT,
    "child_name" TEXT NOT NULL,
    "flat_number" TEXT NOT NULL,
    "alert_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'CRITICAL',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "location" TEXT NOT NULL,
    "description" TEXT,
    "last_seen_details" TEXT,
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "resolution_notes" TEXT,
    "emergency_incident_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "child_safety_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "child_gate_passes_pass_code_key" ON "child_gate_passes"("pass_code");
CREATE UNIQUE INDEX IF NOT EXISTS "child_gate_passes_token_hash_key" ON "child_gate_passes"("token_hash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_child_profiles_society_status" ON "child_profiles"("society_id", "status");
CREATE INDEX IF NOT EXISTS "idx_child_profiles_society_flat" ON "child_profiles"("society_id", "flat_number");
CREATE INDEX IF NOT EXISTS "idx_child_profiles_resident" ON "child_profiles"("resident_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_child_pickups_child_status" ON "child_authorized_pickups"("child_id", "status");
CREATE INDEX IF NOT EXISTS "idx_child_pickups_society" ON "child_authorized_pickups"("society_id");
CREATE INDEX IF NOT EXISTS "idx_child_pickups_society_phone" ON "child_authorized_pickups"("society_id", "phone");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_child_passes_society_status" ON "child_gate_passes"("society_id", "status");
CREATE INDEX IF NOT EXISTS "idx_child_passes_child" ON "child_gate_passes"("child_id");
CREATE INDEX IF NOT EXISTS "idx_child_passes_code" ON "child_gate_passes"("pass_code");
CREATE INDEX IF NOT EXISTS "idx_child_passes_validity" ON "child_gate_passes"("society_id", "valid_from", "valid_until");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_child_exit_logs_society_time" ON "child_exit_logs"("society_id", "timestamp");
CREATE INDEX IF NOT EXISTS "idx_child_exit_logs_child" ON "child_exit_logs"("child_id");
CREATE INDEX IF NOT EXISTS "idx_child_exit_logs_pass" ON "child_exit_logs"("pass_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_child_alerts_society_status" ON "child_safety_alerts"("society_id", "status");
CREATE INDEX IF NOT EXISTS "idx_child_alerts_child" ON "child_safety_alerts"("child_id");
CREATE INDEX IF NOT EXISTS "idx_child_alerts_society_time" ON "child_safety_alerts"("society_id", "created_at");

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'child_profiles_society_id_fkey') THEN
        ALTER TABLE "child_profiles" ADD CONSTRAINT "child_profiles_society_id_fkey" FOREIGN KEY ("society_id") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'child_profiles_resident_id_fkey') THEN
        ALTER TABLE "child_profiles" ADD CONSTRAINT "child_profiles_resident_id_fkey" FOREIGN KEY ("resident_id") REFERENCES "residents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'child_profiles_flat_id_fkey') THEN
        ALTER TABLE "child_profiles" ADD CONSTRAINT "child_profiles_flat_id_fkey" FOREIGN KEY ("flat_id") REFERENCES "flats"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'child_authorized_pickups_society_id_fkey') THEN
        ALTER TABLE "child_authorized_pickups" ADD CONSTRAINT "child_authorized_pickups_society_id_fkey" FOREIGN KEY ("society_id") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'child_authorized_pickups_child_id_fkey') THEN
        ALTER TABLE "child_authorized_pickups" ADD CONSTRAINT "child_authorized_pickups_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "child_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'child_gate_passes_society_id_fkey') THEN
        ALTER TABLE "child_gate_passes" ADD CONSTRAINT "child_gate_passes_society_id_fkey" FOREIGN KEY ("society_id") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'child_gate_passes_child_id_fkey') THEN
        ALTER TABLE "child_gate_passes" ADD CONSTRAINT "child_gate_passes_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "child_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'child_gate_passes_pickup_person_id_fkey') THEN
        ALTER TABLE "child_gate_passes" ADD CONSTRAINT "child_gate_passes_pickup_person_id_fkey" FOREIGN KEY ("pickup_person_id") REFERENCES "child_authorized_pickups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'child_exit_logs_society_id_fkey') THEN
        ALTER TABLE "child_exit_logs" ADD CONSTRAINT "child_exit_logs_society_id_fkey" FOREIGN KEY ("society_id") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'child_exit_logs_child_id_fkey') THEN
        ALTER TABLE "child_exit_logs" ADD CONSTRAINT "child_exit_logs_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "child_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'child_exit_logs_pass_id_fkey') THEN
        ALTER TABLE "child_exit_logs" ADD CONSTRAINT "child_exit_logs_pass_id_fkey" FOREIGN KEY ("pass_id") REFERENCES "child_gate_passes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'child_safety_alerts_society_id_fkey') THEN
        ALTER TABLE "child_safety_alerts" ADD CONSTRAINT "child_safety_alerts_society_id_fkey" FOREIGN KEY ("society_id") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'child_safety_alerts_child_id_fkey') THEN
        ALTER TABLE "child_safety_alerts" ADD CONSTRAINT "child_safety_alerts_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "child_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'child_safety_alerts_reported_by_id_fkey') THEN
        ALTER TABLE "child_safety_alerts" ADD CONSTRAINT "child_safety_alerts_reported_by_id_fkey" FOREIGN KEY ("reported_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'child_safety_alerts_emergency_incident_id_fkey') THEN
        ALTER TABLE "child_safety_alerts" ADD CONSTRAINT "child_safety_alerts_emergency_incident_id_fkey" FOREIGN KEY ("emergency_incident_id") REFERENCES "emergency_incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

