-- ==============================================================================
-- AARIZO CommunityOS - Complete PostgreSQL Schema & DDL
-- Multi-Tenant Gated Community & Society Management Architecture
-- Supports: Strict Tenant Isolation (RLS), RBAC, Real-time Triggers, JSONB Payloads
-- ==============================================================================

-- 1. EXTENSIONS & PREREQUISITES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 2. ENUM TYPES
-- ==============================================================================
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM (
        'resident',
        'guard',
        'secretary',
        'committee',
        'facility_manager',
        'vendor',
        'admin'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE entity_status AS ENUM (
        'ACTIVE',
        'INACTIVE',
        'SUSPENDED',
        'PENDING',
        'ARCHIVED'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE pass_type AS ENUM (
        'GUEST',
        'DELIVERY',
        'CAB',
        'SERVICE',
        'FREQUENT'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE pass_status AS ENUM (
        'PENDING',
        'APPROVED',
        'CHECKED_IN',
        'CHECKED_OUT',
        'EXPIRED',
        'CANCELLED',
        'REJECTED'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE invoice_status AS ENUM (
        'PENDING',
        'PAID',
        'PARTIALLY_PAID',
        'OVERDUE',
        'CANCELLED'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE ticket_priority AS ENUM (
        'LOW',
        'MEDIUM',
        'HIGH',
        'EMERGENCY'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE ticket_status AS ENUM (
        'OPEN',
        'IN_PROGRESS',
        'RESOLVED',
        'CLOSED',
        'REOPENED'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE incident_severity AS ENUM (
        'LOW',
        'MEDIUM',
        'HIGH',
        'CRITICAL'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'child_gender' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE child_gender AS ENUM ('MALE', 'FEMALE', 'OTHER', 'UNSPECIFIED');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'child_status' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE child_status AS ENUM ('SAFE', 'OUT_OF_SOCIETY', 'MISSING', 'ARCHIVED');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'child_exit_permission_mode' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE child_exit_permission_mode AS ENUM ('ESCORT_REQUIRED', 'SOLO_ALLOWED', 'TIMED_PASS_ONLY', 'UNKNOWN');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'pickup_authorization_status' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE pickup_authorization_status AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED', 'ARCHIVED');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'pickup_id_verification_status' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE pickup_id_verification_status AS ENUM ('NOT_COLLECTED', 'UNVERIFIED', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'child_gate_pass_status' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE child_gate_pass_status AS ENUM ('ACTIVE', 'USED', 'EXPIRED', 'REVOKED', 'ARCHIVED');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'child_exit_outcome' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE child_exit_outcome AS ENUM ('ALLOWED', 'DENIED', 'MISSING_ALERT_BLOCKED', 'VERIFICATION_UNAVAILABLE');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'child_verification_channel' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE child_verification_channel AS ENUM (
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
        CREATE TYPE child_alert_type AS ENUM (
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
        CREATE TYPE child_alert_status AS ENUM ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_ALARM');
    END IF;
END $$;

-- ==============================================================================
-- 3. CORE TENANT & SOCIETY MANAGEMENT
-- ==============================================================================

CREATE TABLE IF NOT EXISTS societies (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(32) NOT NULL UNIQUE,
    city VARCHAR(100) NOT NULL,
    address TEXT NOT NULL,
    pincode VARCHAR(20),
    total_towers INTEGER DEFAULT 0,
    total_flats INTEGER DEFAULT 0,
    established_year INTEGER,
    gate_count INTEGER DEFAULT 1,
    amenities_count INTEGER DEFAULT 0,
    status entity_status DEFAULT 'ACTIVE',
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS towers (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    block_code VARCHAR(32),
    total_floors INTEGER DEFAULT 1,
    total_units INTEGER DEFAULT 0,
    has_elevator BOOLEAN DEFAULT TRUE,
    status entity_status DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS flats (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    tower_id VARCHAR(64) NOT NULL REFERENCES towers(id) ON DELETE CASCADE,
    flat_number VARCHAR(32) NOT NULL,
    floor_number INTEGER DEFAULT 0,
    intercom_extension VARCHAR(32),
    bhk_type VARCHAR(20),
    carpet_area_sqft NUMERIC(10, 2),
    occupancy_status VARCHAR(32) DEFAULT 'VACANT', -- VACANT, OWNER_OCCUPIED, TENANT_OCCUPIED
    status entity_status DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_flat_tower_number UNIQUE (tower_id, flat_number),
    CONSTRAINT uq_flats_society_id UNIQUE (society_id, id)
);

-- ==============================================================================
-- 4. USERS, IDENTITIES & RESIDENTS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY, -- maps to auth provider uid (e.g. user-resident-01)
    society_id VARCHAR(64) REFERENCES societies(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE,
    phone VARCHAR(32) NOT NULL,
    role user_role NOT NULL DEFAULT 'resident',
    flat_id VARCHAR(64) REFERENCES flats(id) ON DELETE SET NULL,
    flat_number VARCHAR(64),
    flat_details TEXT,
    designation VARCHAR(150),
    avatar_url TEXT,
    fcm_token TEXT,
    status entity_status DEFAULT 'ACTIVE',
    preferences JSONB DEFAULT '{"theme": "dark", "notifications": true}'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    password_hash VARCHAR(255),
    salt VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS residents (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    flat_id VARCHAR(64) NOT NULL REFERENCES flats(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(32) NOT NULL,
    email VARCHAR(255),
    resident_type VARCHAR(32) DEFAULT 'OWNER', -- OWNER, TENANT
    move_in_date DATE,
    emergency_contact_name VARCHAR(255),
    emergency_contact_phone VARCHAR(32),
    is_verified BOOLEAN DEFAULT FALSE,
    status entity_status DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_residents_society_id UNIQUE (society_id, id)
);

CREATE TABLE IF NOT EXISTS family_members (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    resident_id VARCHAR(64) NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    relationship VARCHAR(50) NOT NULL,
    phone VARCHAR(32),
    age INTEGER,
    has_app_access BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vehicles (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    resident_id VARCHAR(64) REFERENCES residents(id) ON DELETE CASCADE,
    vehicle_number VARCHAR(32) NOT NULL,
    vehicle_type VARCHAR(32) NOT NULL, -- 2_WHEELER, 4_WHEELER, EV
    make_model VARCHAR(100),
    color VARCHAR(50),
    parking_slot_id VARCHAR(64),
    rfid_tag VARCHAR(100),
    is_verified BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_vehicle_society_number UNIQUE (society_id, vehicle_number)
);

-- ==============================================================================
-- 5. STAFF, DOMESTIC WORKERS & VENDORS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS staff (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    role_category VARCHAR(100) NOT NULL, -- SECURITY, HOUSEKEEPING, ELECTRICIAN, PLUMBER
    phone VARCHAR(32) NOT NULL,
    shift_timings VARCHAR(100),
    id_proof_type VARCHAR(50),
    id_proof_number VARCHAR(100),
    is_police_verified BOOLEAN DEFAULT FALSE,
    status entity_status DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS domestic_workers (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    profession VARCHAR(100) NOT NULL, -- MAID, COOK, DRIVER, NANNY
    phone VARCHAR(32) NOT NULL,
    passcode VARCHAR(32),
    rating NUMERIC(2, 1) DEFAULT 5.0,
    associated_flats TEXT[] DEFAULT '{}',
    current_status VARCHAR(32) DEFAULT 'OUTSIDE', -- INSIDE, OUTSIDE
    is_police_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vendors (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    business_name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255) NOT NULL,
    service_type VARCHAR(100) NOT NULL,
    phone VARCHAR(32) NOT NULL,
    email VARCHAR(255),
    gst_number VARCHAR(50),
    rating NUMERIC(2, 1) DEFAULT 4.8,
    status entity_status DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attendance (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    worker_id VARCHAR(64) NOT NULL,
    worker_type VARCHAR(50) NOT NULL, -- STAFF, DOMESTIC_WORKER
    check_in_time TIMESTAMPTZ NOT NULL,
    check_out_time TIMESTAMPTZ,
    gate_name VARCHAR(100),
    verified_by VARCHAR(64) REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- 6. SECURITY, VISITOR PASSES & GATE CHECKPOINTS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS visitor_passes (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    resident_id VARCHAR(64) REFERENCES residents(id) ON DELETE SET NULL,
    flat_id VARCHAR(64) REFERENCES flats(id) ON DELETE SET NULL,
    visitor_name VARCHAR(255) NOT NULL,
    phone VARCHAR(32) NOT NULL,
    pass_type pass_type DEFAULT 'GUEST',
    vehicle_number VARCHAR(32),
    purpose VARCHAR(255),
    status pass_status DEFAULT 'PENDING',
    qr_code_hash TEXT,
    valid_from TIMESTAMPTZ NOT NULL,
    valid_to TIMESTAMPTZ NOT NULL,
    check_in_time TIMESTAMPTZ,
    check_out_time TIMESTAMPTZ,
    gate_checked_by VARCHAR(64) REFERENCES users(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS parcels (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    resident_id VARCHAR(64) NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    flat_id VARCHAR(64) NOT NULL REFERENCES flats(id) ON DELETE CASCADE,
    courier_company VARCHAR(100) NOT NULL,
    delivery_partner_name VARCHAR(100),
    tracking_number VARCHAR(100),
    arrival_time TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    picked_up_at TIMESTAMPTZ,
    pickup_code VARCHAR(16) NOT NULL,
    status VARCHAR(32) DEFAULT 'AT_GATE', -- AT_GATE, COLLECTED, DELIVERED_TO_DOOR
    gate_officer_id VARCHAR(64) REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS child_safety (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    resident_id VARCHAR(64) NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    flat_id VARCHAR(64) NOT NULL REFERENCES flats(id) ON DELETE CASCADE,
    child_name VARCHAR(255) NOT NULL,
    age INTEGER NOT NULL,
    photo_url TEXT,
    allowed_solo_exit BOOLEAN DEFAULT FALSE,
    guardian_contact VARCHAR(32) NOT NULL,
    exit_permission_status VARCHAR(32) DEFAULT 'DISALLOWED', -- ALLOWED, DISALLOWED, TIMED_PASS
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Normalized Child Safety Relational Architecture (Phase B.2.1 Remediated)
CREATE TABLE IF NOT EXISTS child_profiles (
    id TEXT PRIMARY KEY,
    society_id TEXT NOT NULL,
    resident_id TEXT,
    flat_id TEXT,
    guardian_user_id TEXT,
    flat_number TEXT NOT NULL,
    full_name TEXT NOT NULL,
    date_of_birth TIMESTAMPTZ(3),
    reported_age INTEGER,
    gender child_gender NOT NULL DEFAULT 'UNSPECIFIED',
    photo_url TEXT,
    medical_notes TEXT,
    status child_status NOT NULL DEFAULT 'SAFE',
    exit_permission_mode child_exit_permission_mode NOT NULL DEFAULT 'ESCORT_REQUIRED',
    allowed_solo_exit BOOLEAN NOT NULL DEFAULT FALSE,
    guardian_name TEXT NOT NULL,
    guardian_phone TEXT NOT NULL,
    emergency_phone TEXT,
    secondary_guardians JSONB,
    emergency_contacts JSONB,
    notes TEXT,
    legacy_source TEXT,
    legacy_source_id TEXT,
    archived_at TIMESTAMPTZ(3),
    archived_by_id TEXT,
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_child_profiles_society_id UNIQUE (society_id, id),
    CONSTRAINT uq_child_profiles_legacy_source UNIQUE (society_id, legacy_source, legacy_source_id),
    CONSTRAINT child_profiles_society_id_fkey FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT child_profiles_society_id_resident_id_fkey FOREIGN KEY (society_id, resident_id) REFERENCES residents(society_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT child_profiles_society_id_flat_id_fkey FOREIGN KEY (society_id, flat_id) REFERENCES flats(society_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT child_profiles_guardian_user_id_fkey FOREIGN KEY (guardian_user_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT child_profiles_archived_by_id_fkey FOREIGN KEY (archived_by_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_child_profiles_active_owner CHECK (status = 'ARCHIVED' OR archived_at IS NOT NULL OR (resident_id IS NOT NULL AND flat_id IS NOT NULL)),
    CONSTRAINT chk_child_profiles_archive_consistency CHECK ((status = 'ARCHIVED') = (archived_at IS NOT NULL)),
    CONSTRAINT chk_child_profiles_reported_age CHECK (reported_age IS NULL OR (reported_age >= 0 AND reported_age <= 25)),
    CONSTRAINT chk_child_profiles_dob_not_future CHECK (date_of_birth IS NULL OR date_of_birth <= CURRENT_TIMESTAMP)
);

CREATE INDEX IF NOT EXISTS idx_child_profiles_society_status ON child_profiles(society_id, status);
CREATE INDEX IF NOT EXISTS idx_child_profiles_society_flat ON child_profiles(society_id, flat_number);
CREATE INDEX IF NOT EXISTS idx_child_profiles_resident ON child_profiles(resident_id);

CREATE TABLE IF NOT EXISTS child_authorized_pickups (
    id TEXT PRIMARY KEY,
    society_id TEXT NOT NULL,
    child_id TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    relationship TEXT NOT NULL,
    id_document_type TEXT,
    id_document_last4 VARCHAR(4),
    id_document_hash TEXT,
    id_verification_status pickup_id_verification_status NOT NULL DEFAULT 'NOT_COLLECTED',
    id_verified_at TIMESTAMPTZ(3),
    verified_by_id TEXT,
    created_by_id TEXT,
    photo_url TEXT,
    status pickup_authorization_status NOT NULL DEFAULT 'ACTIVE',
    valid_until TIMESTAMPTZ(3),
    notes TEXT,
    archived_at TIMESTAMPTZ(3),
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_child_pickups_society_id UNIQUE (society_id, id),
    CONSTRAINT uq_child_pickups_society_child_id UNIQUE (society_id, child_id, id),
    CONSTRAINT child_authorized_pickups_society_id_fkey FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT child_authorized_pickups_society_id_child_id_fkey FOREIGN KEY (society_id, child_id) REFERENCES child_profiles(society_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT child_authorized_pickups_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT child_authorized_pickups_verified_by_id_fkey FOREIGN KEY (verified_by_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_child_pickups_archive_consistency CHECK ((status = 'ARCHIVED') = (archived_at IS NOT NULL)),
    CONSTRAINT chk_child_pickups_last4_len CHECK (id_document_last4 IS NULL OR char_length(id_document_last4) BETWEEN 1 AND 4),
    CONSTRAINT chk_child_pickups_hash_format CHECK (id_document_hash IS NULL OR id_document_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_child_pickups_child_status ON child_authorized_pickups(child_id, status);
CREATE INDEX IF NOT EXISTS idx_child_pickups_society ON child_authorized_pickups(society_id);
CREATE INDEX IF NOT EXISTS idx_child_pickups_society_phone ON child_authorized_pickups(society_id, phone);

CREATE TABLE IF NOT EXISTS child_gate_passes (
    id TEXT PRIMARY KEY,
    society_id TEXT NOT NULL,
    child_id TEXT NOT NULL,
    pickup_person_id TEXT,
    pass_code TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    pickup_person_name TEXT NOT NULL,
    pickup_person_phone TEXT,
    valid_from TIMESTAMPTZ(3) NOT NULL,
    valid_until TIMESTAMPTZ(3) NOT NULL,
    status child_gate_pass_status NOT NULL DEFAULT 'ACTIVE',
    max_uses INTEGER NOT NULL DEFAULT 1,
    current_uses INTEGER NOT NULL DEFAULT 0,
    first_used_at TIMESTAMPTZ(3),
    last_used_at TIMESTAMPTZ(3),
    revoked_at TIMESTAMPTZ(3),
    revoked_by_id TEXT,
    revocation_reason TEXT,
    created_by_id TEXT,
    notes TEXT,
    archived_at TIMESTAMPTZ(3),
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_child_passes_society_id UNIQUE (society_id, id),
    CONSTRAINT uq_child_passes_society_code UNIQUE (society_id, pass_code),
    CONSTRAINT child_gate_passes_token_hash_key UNIQUE (token_hash),
    CONSTRAINT child_gate_passes_society_id_fkey FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT child_gate_passes_society_id_child_id_fkey FOREIGN KEY (society_id, child_id) REFERENCES child_profiles(society_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT child_gate_passes_society_id_child_id_pickup_person_id_fkey FOREIGN KEY (society_id, child_id, pickup_person_id) REFERENCES child_authorized_pickups(society_id, child_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT child_gate_passes_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT child_gate_passes_revoked_by_id_fkey FOREIGN KEY (revoked_by_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_child_passes_validity_window CHECK (valid_until > valid_from),
    CONSTRAINT chk_child_passes_max_uses_positive CHECK (max_uses >= 1),
    CONSTRAINT chk_child_passes_uses_bounds CHECK (current_uses >= 0 AND current_uses <= max_uses),
    CONSTRAINT chk_child_passes_token_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT chk_child_passes_archive_consistency CHECK ((status = 'ARCHIVED') = (archived_at IS NOT NULL)),
    CONSTRAINT chk_child_passes_revoke_consistency CHECK (status <> 'REVOKED' OR revoked_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_child_passes_society_status ON child_gate_passes(society_id, status);
CREATE INDEX IF NOT EXISTS idx_child_passes_child ON child_gate_passes(child_id);
CREATE INDEX IF NOT EXISTS idx_child_passes_validity ON child_gate_passes(society_id, valid_from, valid_until);

CREATE TABLE IF NOT EXISTS child_exit_logs (
    id TEXT PRIMARY KEY,
    society_id TEXT NOT NULL,
    child_id TEXT,
    pass_id TEXT,
    pickup_person_id TEXT,
    child_name TEXT NOT NULL,
    flat_number TEXT NOT NULL,
    pickup_person_name TEXT NOT NULL,
    pickup_person_phone TEXT,
    gate_id TEXT NOT NULL,
    guard_id TEXT,
    guard_name TEXT NOT NULL,
    outcome child_exit_outcome NOT NULL,
    verification_channel child_verification_channel NOT NULL DEFAULT 'ONLINE_QR_TOKEN',
    denial_reason TEXT,
    notes TEXT,
    timestamp TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT child_exit_logs_society_id_fkey FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT child_exit_logs_society_id_child_id_fkey FOREIGN KEY (society_id, child_id) REFERENCES child_profiles(society_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT child_exit_logs_society_id_pass_id_fkey FOREIGN KEY (society_id, pass_id) REFERENCES child_gate_passes(society_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT child_exit_logs_society_id_pickup_person_id_fkey FOREIGN KEY (society_id, pickup_person_id) REFERENCES child_authorized_pickups(society_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT child_exit_logs_guard_id_fkey FOREIGN KEY (guard_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_child_exit_logs_unavailable_channel CHECK (verification_channel <> 'BACKEND_UNAVAILABLE' OR outcome = 'VERIFICATION_UNAVAILABLE')
);

CREATE INDEX IF NOT EXISTS idx_child_exit_logs_society_time ON child_exit_logs(society_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_child_exit_logs_child ON child_exit_logs(child_id);
CREATE INDEX IF NOT EXISTS idx_child_exit_logs_pass ON child_exit_logs(pass_id);
CREATE INDEX IF NOT EXISTS idx_child_exit_logs_pickup ON child_exit_logs(pickup_person_id);

CREATE TABLE IF NOT EXISTS child_safety_alerts (
    id TEXT PRIMARY KEY,
    society_id TEXT NOT NULL,
    child_id TEXT,
    reported_by_id TEXT,
    reported_by_name TEXT,
    child_name TEXT NOT NULL,
    flat_number TEXT NOT NULL,
    alert_type child_alert_type NOT NULL,
    severity incident_severity NOT NULL DEFAULT 'CRITICAL',
    status child_alert_status NOT NULL DEFAULT 'ACTIVE',
    location TEXT NOT NULL,
    description TEXT,
    last_seen_details TEXT,
    acknowledged_at TIMESTAMPTZ(3),
    acknowledged_by_id TEXT,
    acknowledged_by_name TEXT,
    resolved_at TIMESTAMPTZ(3),
    resolved_by_id TEXT,
    resolved_by_name TEXT,
    resolution_notes TEXT,
    emergency_incident_id TEXT,
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT child_safety_alerts_society_id_fkey FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT child_safety_alerts_society_id_child_id_fkey FOREIGN KEY (society_id, child_id) REFERENCES child_profiles(society_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT child_safety_alerts_reported_by_id_fkey FOREIGN KEY (reported_by_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT child_safety_alerts_acknowledged_by_id_fkey FOREIGN KEY (acknowledged_by_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT child_safety_alerts_resolved_by_id_fkey FOREIGN KEY (resolved_by_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_child_alerts_ack_consistency CHECK (status <> 'ACKNOWLEDGED' OR acknowledged_at IS NOT NULL),
    CONSTRAINT chk_child_alerts_resolved_consistency CHECK ((status NOT IN ('RESOLVED', 'FALSE_ALARM')) OR resolved_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_child_alerts_society_status ON child_safety_alerts(society_id, status);
CREATE INDEX IF NOT EXISTS idx_child_alerts_child ON child_safety_alerts(child_id);
CREATE INDEX IF NOT EXISTS idx_child_alerts_society_time ON child_safety_alerts(society_id, created_at);

-- ==============================================================================
-- 7. BILLING, INVOICES & PAYMENTS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS billing_cycles (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    cycle_name VARCHAR(100) NOT NULL,
    month_year VARCHAR(20) NOT NULL, -- e.g. 'October 2026'
    billing_date DATE NOT NULL,
    due_date DATE NOT NULL,
    grace_period_days INTEGER DEFAULT 5,
    late_fee_amount NUMERIC(10, 2) DEFAULT 0.00,
    total_billed_amount NUMERIC(12, 2) DEFAULT 0.00,
    total_collected_amount NUMERIC(12, 2) DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS billing_invoices (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    cycle_id VARCHAR(64) REFERENCES billing_cycles(id) ON DELETE SET NULL,
    resident_id VARCHAR(64) NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    flat_id VARCHAR(64) NOT NULL REFERENCES flats(id) ON DELETE CASCADE,
    invoice_number VARCHAR(100) NOT NULL UNIQUE,
    maintenance_amount NUMERIC(10, 2) NOT NULL,
    utility_amount NUMERIC(10, 2) DEFAULT 0.00,
    sinking_fund NUMERIC(10, 2) DEFAULT 0.00,
    late_fee NUMERIC(10, 2) DEFAULT 0.00,
    total_amount NUMERIC(10, 2) NOT NULL,
    paid_amount NUMERIC(10, 2) DEFAULT 0.00,
    due_date DATE NOT NULL,
    status invoice_status DEFAULT 'PENDING',
    payment_mode VARCHAR(50),
    paid_at TIMESTAMPTZ,
    breakdown JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS billing_transactions (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    invoice_id VARCHAR(64) NOT NULL REFERENCES billing_invoices(id) ON DELETE CASCADE,
    resident_id VARCHAR(64) NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    amount NUMERIC(10, 2) NOT NULL,
    gateway VARCHAR(50) DEFAULT 'RAZORPAY',
    transaction_reference VARCHAR(150) UNIQUE,
    payment_method VARCHAR(50), -- UPI, CARD, NETBANKING
    status VARCHAR(50) DEFAULT 'SUCCESS',
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- 8. AMENITIES & BOOKINGS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS amenities (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100), -- CLUBHOUSE, SWIMMING_POOL, TENNIS_COURT, GYM
    capacity_per_slot INTEGER DEFAULT 10,
    slot_duration_minutes INTEGER DEFAULT 60,
    hourly_charge NUMERIC(10, 2) DEFAULT 0.00,
    opening_time TIME DEFAULT '06:00:00',
    closing_time TIME DEFAULT '22:00:00',
    requires_approval BOOLEAN DEFAULT FALSE,
    status entity_status DEFAULT 'ACTIVE',
    rules_text TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS amenity_bookings (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    amenity_id VARCHAR(64) NOT NULL REFERENCES amenities(id) ON DELETE CASCADE,
    resident_id VARCHAR(64) NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    flat_id VARCHAR(64) NOT NULL REFERENCES flats(id) ON DELETE CASCADE,
    booking_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    attendees_count INTEGER DEFAULT 1,
    charge_amount NUMERIC(10, 2) DEFAULT 0.00,
    status VARCHAR(32) DEFAULT 'CONFIRMED', -- CONFIRMED, PENDING_APPROVAL, CANCELLED
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- 9. MAINTENANCE, COMPLAINTS & HOUSEKEEPING
-- ==============================================================================

CREATE TABLE IF NOT EXISTS maintenance_tickets (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    resident_id VARCHAR(64) REFERENCES residents(id) ON DELETE SET NULL,
    flat_id VARCHAR(64) REFERENCES flats(id) ON DELETE SET NULL,
    category VARCHAR(100) NOT NULL, -- PLUMBING, ELECTRICAL, CARPENTRY, ELEVATOR
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    priority ticket_priority DEFAULT 'MEDIUM',
    status ticket_status DEFAULT 'OPEN',
    assigned_to VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    assigned_staff_name VARCHAR(150),
    preferred_slot VARCHAR(100),
    feedback_notes TEXT,
    rating INTEGER,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS complaints (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    resident_id VARCHAR(64) REFERENCES residents(id) ON DELETE SET NULL,
    flat_id VARCHAR(64) REFERENCES flats(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL, -- NOISE, PARKING, COMMON_AREA, PETS
    description TEXT NOT NULL,
    priority ticket_priority DEFAULT 'MEDIUM',
    status ticket_status DEFAULT 'OPEN',
    is_anonymous BOOLEAN DEFAULT FALSE,
    assigned_to VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    resolution_notes TEXT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS housekeeping_tasks (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    area_name VARCHAR(150) NOT NULL,
    task_type VARCHAR(100) NOT NULL, -- SWEEPING, MOPPING, SANITIZATION, GARBAGE_COLLECTION
    assigned_to VARCHAR(64) REFERENCES staff(id) ON DELETE SET NULL,
    scheduled_time TIMESTAMPTZ NOT NULL,
    completed_time TIMESTAMPTZ,
    status VARCHAR(32) DEFAULT 'PENDING', -- PENDING, IN_PROGRESS, COMPLETED, MISSED
    supervisor_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- 10. PARKING, GUEST STAY & COMMUNITY
-- ==============================================================================

CREATE TABLE IF NOT EXISTS parking_slots (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    slot_number VARCHAR(32) NOT NULL,
    tower_block VARCHAR(32),
    slot_type VARCHAR(32) DEFAULT 'RESIDENT', -- RESIDENT, VISITOR, EV_CHARGING
    allocated_flat_id VARCHAR(64) REFERENCES flats(id) ON DELETE SET NULL,
    is_occupied BOOLEAN DEFAULT FALSE,
    status entity_status DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_slot_society_number UNIQUE (society_id, slot_number)
);

CREATE TABLE IF NOT EXISTS parking_requests (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    resident_id VARCHAR(64) NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    vehicle_number VARCHAR(32) NOT NULL,
    vehicle_type VARCHAR(32) NOT NULL,
    request_type VARCHAR(32) DEFAULT 'EXTRA_SLOT', -- EXTRA_SLOT, VISITOR_RESERVATION
    from_date DATE,
    to_date DATE,
    status VARCHAR(32) DEFAULT 'PENDING',
    assigned_slot_id VARCHAR(64) REFERENCES parking_slots(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS guest_rooms (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    room_number VARCHAR(32) NOT NULL,
    block_name VARCHAR(50),
    capacity INTEGER DEFAULT 2,
    per_night_rate NUMERIC(10, 2) DEFAULT 0.00,
    status entity_status DEFAULT 'ACTIVE',
    amenities TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS guest_reservations (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    room_id VARCHAR(64) NOT NULL REFERENCES guest_rooms(id) ON DELETE CASCADE,
    resident_id VARCHAR(64) NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    guest_name VARCHAR(255) NOT NULL,
    check_in_date DATE NOT NULL,
    check_out_date DATE NOT NULL,
    total_nights INTEGER NOT NULL,
    total_amount NUMERIC(10, 2) NOT NULL,
    status VARCHAR(32) DEFAULT 'CONFIRMED',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS move_requests (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    resident_id VARCHAR(64) NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    flat_id VARCHAR(64) NOT NULL REFERENCES flats(id) ON DELETE CASCADE,
    move_type VARCHAR(32) NOT NULL, -- MOVE_IN, MOVE_OUT
    scheduled_date DATE NOT NULL,
    elevator_reserved BOOLEAN DEFAULT TRUE,
    deposit_amount NUMERIC(10, 2) DEFAULT 0.00,
    status VARCHAR(32) DEFAULT 'PENDING_APPROVAL',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS renovations (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    resident_id VARCHAR(64) NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    flat_id VARCHAR(64) NOT NULL REFERENCES flats(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    contractor_name VARCHAR(255),
    contractor_phone VARCHAR(32),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    working_hours VARCHAR(100) DEFAULT '09:00 AM - 06:00 PM',
    status VARCHAR(32) DEFAULT 'PENDING_APPROVAL',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS amc_contracts (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    vendor_id VARCHAR(64) REFERENCES vendors(id) ON DELETE SET NULL,
    equipment_name VARCHAR(150) NOT NULL, -- ELEVATOR, DG_SET, WATER_TREATMENT, CCTV
    contract_title VARCHAR(255) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    annual_cost NUMERIC(12, 2) NOT NULL,
    service_frequency VARCHAR(50), -- MONTHLY, QUARTERLY
    next_service_date DATE,
    is_public_to_residents BOOLEAN DEFAULT TRUE,
    status entity_status DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- 11. EMERGENCY, NOTIFICATIONS & AUDIT TRAIL
-- ==============================================================================

CREATE TABLE IF NOT EXISTS emergency_incidents (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    reporter_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    incident_type VARCHAR(100) NOT NULL, -- FIRE, MEDICAL, SECURITY_BREACH, LIFT_TRAP
    severity incident_severity DEFAULT 'HIGH',
    location VARCHAR(255) NOT NULL,
    description TEXT,
    dispatch_status VARCHAR(50) DEFAULT 'DISPATCHED',
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_emergency_incidents_society_id UNIQUE (society_id, id)
);

-- Link child_safety_alerts -> emergency_incidents after emergency_incidents is defined
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = 'child_safety_alerts_society_id_emergency_incident_id_fkey'
          AND c.connamespace = current_schema()::regnamespace
          AND c.conrelid = to_regclass(format('%I.%I', current_schema(), 'child_safety_alerts'))
    ) THEN
        ALTER TABLE child_safety_alerts
            ADD CONSTRAINT child_safety_alerts_society_id_emergency_incident_id_fkey
            FOREIGN KEY (society_id, emergency_incident_id)
            REFERENCES emergency_incidents(society_id, id)
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS notifications (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    recipient_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    category VARCHAR(50) DEFAULT 'GENERAL', -- VISITOR, BILLING, MAINTENANCE, EMERGENCY, AMENITY
    data JSONB DEFAULT '{}'::jsonb,
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    actor_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    actor_name VARCHAR(255),
    role user_role,
    action VARCHAR(100) NOT NULL,
    entity_name VARCHAR(100) NOT NULL,
    entity_id VARCHAR(100),
    metadata JSONB DEFAULT '{}'::jsonb,
    ip_address VARCHAR(50),
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- 12. PERFORMANCE INDEXES
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_users_society_role ON users(society_id, role);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_residents_society_flat ON residents(society_id, flat_id);
CREATE INDEX IF NOT EXISTS idx_flats_society_tower ON flats(society_id, tower_id);
CREATE INDEX IF NOT EXISTS idx_passes_society_validity ON visitor_passes(society_id, valid_from, valid_to);
CREATE INDEX IF NOT EXISTS idx_passes_phone ON visitor_passes(phone);
CREATE INDEX IF NOT EXISTS idx_passes_society_qr ON visitor_passes(society_id, qr_code_hash);
CREATE INDEX IF NOT EXISTS idx_passes_society_phone ON visitor_passes(society_id, phone);
CREATE INDEX IF NOT EXISTS idx_parcels_society_resident ON parcels(society_id, resident_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_society_resident ON billing_invoices(society_id, resident_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_society_status ON maintenance_tickets(society_id, status, priority);
CREATE INDEX IF NOT EXISTS idx_attendance_worker_time ON attendance(worker_id, check_in_time DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_society_time ON audit_logs(society_id, timestamp DESC);

-- ==============================================================================
-- 13. AUTOMATED TIMESTAMP TRIGGER
-- ==============================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ 
DECLARE 
    t text;
BEGIN
    FOR t IN 
        SELECT table_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND column_name = 'updated_at'
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON %I;', t);
        EXECUTE format('CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE PROCEDURE set_updated_at();', t);
    END LOOP;
END $$;

-- ==============================================================================
-- 14. CHILD SAFETY CROSS-SOCIETY ACTOR VALIDATION TRIGGER (PHASE B.2.1)
-- ==============================================================================
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

DROP TRIGGER IF EXISTS trg_child_profiles_actor_tenant ON child_profiles;
CREATE TRIGGER trg_child_profiles_actor_tenant
    BEFORE INSERT OR UPDATE ON child_profiles
    FOR EACH ROW EXECUTE FUNCTION enforce_child_safety_actor_tenant('guardian_user_id', 'archived_by_id');

DROP TRIGGER IF EXISTS trg_child_pickups_actor_tenant ON child_authorized_pickups;
CREATE TRIGGER trg_child_pickups_actor_tenant
    BEFORE INSERT OR UPDATE ON child_authorized_pickups
    FOR EACH ROW EXECUTE FUNCTION enforce_child_safety_actor_tenant('created_by_id', 'verified_by_id');

DROP TRIGGER IF EXISTS trg_child_passes_actor_tenant ON child_gate_passes;
CREATE TRIGGER trg_child_passes_actor_tenant
    BEFORE INSERT OR UPDATE ON child_gate_passes
    FOR EACH ROW EXECUTE FUNCTION enforce_child_safety_actor_tenant('created_by_id', 'revoked_by_id');

DROP TRIGGER IF EXISTS trg_child_exit_logs_actor_tenant ON child_exit_logs;
CREATE TRIGGER trg_child_exit_logs_actor_tenant
    BEFORE INSERT OR UPDATE ON child_exit_logs
    FOR EACH ROW EXECUTE FUNCTION enforce_child_safety_actor_tenant('guard_id');

DROP TRIGGER IF EXISTS trg_child_alerts_actor_tenant ON child_safety_alerts;
CREATE TRIGGER trg_child_alerts_actor_tenant
    BEFORE INSERT OR UPDATE ON child_safety_alerts
    FOR EACH ROW EXECUTE FUNCTION enforce_child_safety_actor_tenant('reported_by_id', 'acknowledged_by_id', 'resolved_by_id');

-- ==============================================================================
-- 15. INVITATIONS & ACCOUNT ACTIVATION (PHASE 4.8)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS invitations (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'resident',
    resident_id VARCHAR(64) REFERENCES residents(id) ON DELETE SET NULL,
    flat_id VARCHAR(64) REFERENCES flats(id) ON DELETE SET NULL,
    token_hash VARCHAR(128) NOT NULL UNIQUE,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    delivery_status VARCHAR(32) DEFAULT 'QUEUED',
    delivery_error TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_by VARCHAR(64) NOT NULL,
    sent_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    resend_count INT DEFAULT 0,
    last_resent_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invitations_token_hash ON invitations(token_hash);
CREATE INDEX IF NOT EXISTS idx_invitations_society_email ON invitations(society_id, email);
CREATE INDEX IF NOT EXISTS idx_invitations_resident_id ON invitations(resident_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    token_hash VARCHAR(128) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);

