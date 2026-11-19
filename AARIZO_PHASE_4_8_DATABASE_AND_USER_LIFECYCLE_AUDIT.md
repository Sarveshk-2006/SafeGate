# AARIZO / Dwellora — Phase 4.8
# Database Schema & User Lifecycle Forensic Audit

**Document Date:** November 19, 2026  
**Auditor:** Principal Database Architect & Data Governance Lead  
**Scope:** PostgreSQL DDL, Prisma Schema, Resident-to-User Association & Lifecycle State Machine  

---

## 1. Executive Summary

This audit establishes the database foundation required to support real residential invitations, account activation, and password recovery.
In the current PostgreSQL schema:
- Physical society entities (`residents`, `flats`, `towers`) exist independently of authentication identities (`users`).
- A `Resident` record possesses an optional `userId` foreign key referencing `users(id)`.
- However, there are no tables to store invitation tokens or password reset requests.

This report specifies the additive DDL and Prisma models for:
1. `invitations` (`Invitation` model)
2. `password_reset_tokens` (`PasswordResetToken` model)
3. Lifecycle state transitions connecting residents, invitations, and active users.

---

## 2. Existing Schema Topology & Foreign Key Relationships

```
┌─────────────────┐           ┌─────────────────┐           ┌─────────────────┐
│    societies    │◄──────────┤      flats      │◄──────────┤    residents    │
│  (id, name, ...)│           │ (id, society_id)│           │ (id, flat_id,   │
└────────┬────────┘           └─────────────────┘           │  user_id NULL)  │
         │                                                  └────────┬────────┘
         │                                                           │
         ▼                                                           │
┌─────────────────┐                                                  │
│      users      │◄─────────────────────────────────────────────────┘
│ (id, email,     │  Optional link populated upon account activation
│  role, status,  │
│  password_hash) │
└─────────────────┘
```

### 2.1 The Resident vs. User Distinction
- **`Resident` is a physical tenancy record**: Reflects that a person resides in a specific flat within a society. Can be created by society management before the resident has digital access.
- **`User` is an authenticated digital account**: Contains credentials, password hash, salt, session preferences, and system-wide RBAC role.
- **The Activation Bridge**: When an invitation is accepted, the system provisions/activates the `User` record and assigns its ID to `Resident.userId`, setting `Resident.isVerified = true`.

---

## 3. Additive Schema Specification

### 3.1 `invitations` Table DDL
```sql
CREATE TABLE IF NOT EXISTS invitations (
    id VARCHAR(64) PRIMARY KEY,
    society_id VARCHAR(64) NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'resident',
    resident_id VARCHAR(64) REFERENCES residents(id) ON DELETE SET NULL,
    flat_id VARCHAR(64) REFERENCES flats(id) ON DELETE SET NULL,
    token_hash VARCHAR(128) NOT NULL UNIQUE,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- PENDING, ACCEPTED, EXPIRED, REVOKED
    delivery_status VARCHAR(32) DEFAULT 'QUEUED',  -- QUEUED, SENT, FAILED
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
```

### 3.2 `password_reset_tokens` Table DDL
```sql
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
```

### 3.3 Additive Prisma Schema Models
```prisma
model Invitation {
  id             String    @id @default(uuid())
  societyId      String    @map("society_id")
  email          String
  role           UserRole  @default(resident)
  residentId     String?   @map("resident_id")
  flatId         String?   @map("flat_id")
  tokenHash      String    @unique @map("token_hash")
  status         String    @default("PENDING")
  deliveryStatus String    @default("QUEUED") @map("delivery_status")
  deliveryError  String?   @map("delivery_error")
  expiresAt      DateTime  @map("expires_at")
  createdBy      String    @map("created_by")
  sentAt         DateTime? @map("sent_at")
  acceptedAt     DateTime? @map("accepted_at")
  revokedAt      DateTime? @map("revoked_at")
  resendCount    Int       @default(0) @map("resend_count")
  lastResentAt   DateTime? @map("last_resent_at")
  metadata       Json?     @default("{}")
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")

  society        Society   @relation(fields: [societyId], references: [id], onDelete: Cascade)
  resident       Resident? @relation(fields: [residentId], references: [id], onDelete: SetNull)
  flat           Flat?     @relation(fields: [flatId], references: [id], onDelete: SetNull)

  @@index([societyId, email], map: "idx_invitations_society_email")
  @@index([residentId], map: "idx_invitations_resident_id")
  @@map("invitations")
}

model PasswordResetToken {
  id        String    @id @default(uuid())
  userId    String    @map("user_id")
  email     String
  tokenHash String    @unique @map("token_hash")
  expiresAt DateTime  @map("expires_at")
  usedAt    DateTime? @map("used_at")
  createdAt DateTime  @default(now()) @map("created_at")

  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId], map: "idx_password_reset_tokens_user_id")
  @@map("password_reset_tokens")
}
```

---

## 4. User Lifecycle State Machine

```
   ┌─────────────────────────────────────────────────────────────┐
   │ 1. CREATION: Secretary registers resident in society        │
   │    - Resident record created (status: ACTIVE)               │
   │    - Invitation generated (status: PENDING)                 │
   │    - Email sent with unique high-entropy token link         │
   └──────────────────────────────┬──────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ 2. RECIPIENT ACTION: Resident opens /activate?token=...     │
   │    - Token hash verified against database                   │
   │    - Status confirmed PENDING and expiresAt > NOW           │
   │    - Display society name, resident name, and flat number   │
   └──────────────────────────────┬──────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ 3. ACTIVATION: Resident sets secure password                │
   │    - Atomic Transaction:                                    │
   │      a. Invitation status -> 'ACCEPTED'                     │
   │      b. User created with Scrypt hash & salt                │
   │      c. Resident.userId linked to User.id                   │
   │      d. Resident.isVerified = TRUE                          │
   │      e. societyMembership record created                    │
   └──────────────────────────────┬──────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ 4. SUBSEQUENT ACCESS: Standard Email/Password Login         │
   │    - Validates against authoritative Scrypt hash            │
   │    - Issues HMAC-SHA256 Bearer Token                        │
   │    - Connects to Resident Portal & Realtime Engine          │
   └─────────────────────────────────────────────────────────────┘
```

---

## 5. Migration Safety & Non-Destructive Deployment

1. **Non-Destructive Guarantee**: No existing tables, columns, indexes, or records are modified or dropped.
2. **Backward Compatibility**: Existing seeded users (e.g., demo secretaries, guards) continue functioning without interruption.
3. **Execution Safety**: Wrapped in `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` blocks.

