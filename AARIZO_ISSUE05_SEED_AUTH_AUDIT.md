# AARIZO — ISSUE-05: Seeded Database Users Authentication & Password Hash Audit

**Document ID:** `AARIZO_ISSUE05_SEED_AUTH_AUDIT`  
**Execution Phase:** Phase A, Step 5.1  
**Target:** ISSUE-05 — Seeded Database Users Missing Password Hashes  
**Severity:** P1 (High) — Blocking Email/Password Authentication for all Seeded Accounts  
**Mode:** AUDIT ONLY (No Code Modifications Applied)  
**Date:** November 14, 2026  
**Auditor:** Antigravity Autonomous Security Engineer  

---

## 1. Executive Summary

During the Phase A security and authentication audit of the **AARIZO** smart society enterprise platform, an investigation was conducted into **ISSUE-05** (*Seeded Database Users Lack `passwordHash` and `salt`*).

The audit confirms that **100% of database users provisioned by both seed mechanisms (`server/src/seed.ts` and `scripts/postgres/03_seed.sql`) completely omit `passwordHash` and `salt`**. Consequently, all seeded user accounts (Super Admin, Society Secretary, Gate Guard, Resident, Committee Member, Facility Manager, and Vendor) are rendered permanently incapable of authenticating via the primary REST API endpoint (`POST /api/auth/login`).

Furthermore, the audit revealed **three secondary vulnerabilities** in the authentication and database architecture:
1. **Account Enumeration / Information Disclosure Hazard**: The endpoint `POST /api/auth/login` returns differential error messages (`Password authentication is not configured for this user. Please contact administrator.` vs `Invalid email or password`), allowing unauthenticated attackers to probe whether any email address is registered in the database.
2. **Inactive / Suspended User Authentication Bypass**: `POST /api/auth/login` completely fails to check `user.status === 'ACTIVE'`, which would allow suspended, terminated, or pending accounts to authenticate if credentials existed.
3. **Destructive Non-Idempotent Seeding**: `server/src/seed.ts` executes unconditional `deleteMany({})` across all tables, destroying all real password hashes, society configurations, and user state upon any environment re-seed.
4. **Schema & Migration Divergence**: `scripts/postgres/01_schema.sql` (used in containerized database initialization) does not define the `password_hash` and `salt` columns in the `users` table definition, while `server/prisma/schema.prisma` includes them as nullable strings without an associated Prisma migration SQL file.

---

## 2. Root Cause & Evolution Trace

A Git history analysis was performed to isolate the origin of this regression:

| Commit Hash | Commit Date | Author | Description | Impact on ISSUE-05 |
| :--- | :--- | :--- | :--- | :--- |
| `7c6fa7a` | 2026-11-12 | Engineering Lead | SafeGate 2.0 master upgrade (provisioning, outbox realtime) | Introduced initial `UniversalProvisioningService` |
| `8204a21` | 2026-11-13 20:41:11 | Lead Architect | `feat(auth): enforce explicit passwords for all role provisioning...` | Added `passwordHash` & `salt` to `schema.prisma`, added `POST /api/auth/login`, updated dashboard provisioning UI, but **failed to update seed scripts** |

### Git Commit `8204a21` Root Cause
In commit `8204a21`, the backend authentication model transitioned from header-based/mock authentication to database-backed HMAC-SHA256 password authentication. The developer implemented:
- Added `passwordHash String? @map("password_hash")` and `salt String?` to [server/prisma/schema.prisma](file:///d:/AAZIRA/AARIZO/server/prisma/schema.prisma#L180-L181).
- Added `POST /api/auth/login` in [server/src/index.ts](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L1746-L1791) enforcing `user.passwordHash` and `user.salt`.
- Updated `UniversalProvisioningService.provisionSociety` and `provisionUser` in [server/src/provisioning.ts](file:///d:/AAZIRA/AARIZO/server/src/provisioning.ts#L107-L108) to require passwords and store computed hashes.

However, **the static seed scripts were completely overlooked**:
- Neither [server/src/seed.ts](file:///d:/AAZIRA/AARIZO/server/src/seed.ts) nor [scripts/postgres/03_seed.sql](file:///d:/AAZIRA/AARIZO/scripts/postgres/03_seed.sql) were updated to generate salts and password hashes.
- As a result, every fresh deployment or developer setup seeded users with `NULL` credentials.

---

## 3. Detailed Audit of Seed Mechanisms

### 3.1. Primary Prisma Seed: `server/src/seed.ts`
Inspected: [server/src/seed.ts](file:///d:/AAZIRA/AARIZO/server/src/seed.ts#L176-L289)

```typescript
// server/src/seed.ts lines 176-288 (excerpt)
console.log('👤 Seeding Portal Users...');
const userVikram = await prisma.user.create({
  data: {
    id: 'user-res-1',
    societyId: socGVS.id,
    flatId: flatB1204.id,
    name: 'Vikram Joshi',
    email: 'vikram.joshi@aarizo.com',
    phone: '9820098200',
    role: 'resident',
    flatNumber: 'B-1204',
    flatDetails: 'Tower B · B-1204',
    status: 'ACTIVE',
    // ⚠️ CRITICAL DEFECT: passwordHash and salt are NOT passed
  },
});
```

All 8 seeded users in `seed.ts` omit `passwordHash` and `salt`:
1. `user-res-1` (Vikram Joshi, Resident)
2. `user-res-2` (Ananya Roy, Resident)
3. `user-sec-1` (Mayuri Udar, Secretary)
4. `user-guard-1` (Officer Ramesh Shinde, Guard)
5. `user-com-1` (Dr. Ashok Mehta, Committee Member)
6. `user-fac-1` (Rajesh Patil, Facility Manager)
7. `user-ven-1` (Ramesh Gupta, Vendor)
8. `user-adm-1` (Super Administrator, Admin)

#### Destructive Seeding Behavior
Lines 8–30 of `server/src/seed.ts` execute:
```typescript
await prisma.auditLog.deleteMany({});
...
await prisma.user.deleteMany({});
await prisma.flat.deleteMany({});
await prisma.tower.deleteMany({});
await prisma.society.deleteMany({});
```
If an administrator or user sets a password post-deployment, running `npm run seed` or `npx prisma db seed` permanently destroys their user record and credentials rather than safely upserting them.

---

### 3.2. Docker PostgreSQL Entrypoint Seed: `scripts/postgres/03_seed.sql`
Inspected: [scripts/postgres/03_seed.sql](file:///d:/AAZIRA/AARIZO/scripts/postgres/03_seed.sql#L34-L45)

```sql
-- 4. Users (All 7 canonical roles)
INSERT INTO users (id, society_id, name, email, phone, role, flat_number, flat_details, designation, status)
VALUES
('user-resident-01', 'soc-gvs', 'Sarvesh Kulkarni', 'sarvesh@greenvalley.com', '+919876543210', 'resident', 'B-1204', 'Tower B · Flat 1204', 'Flat Owner & Resident', 'ACTIVE'),
('user-guard-01', 'soc-gvs', 'Officer R. Singh', 'guard1@greenvalley.com', '+919123456789', 'guard', NULL, 'Gate #1 North Terminal', 'Senior Gate Security Officer', 'ACTIVE'),
('user-secretary-01', 'soc-gvs', 'Mayuri Udar', 'secretary@greenvalley.com', '+919820012345', 'secretary', 'A-101', 'Block A · Flat 101', 'Management Committee Secretary', 'ACTIVE'),
('user-committee-01', 'soc-gvs', 'Rajesh Mehta', 'rajesh.committee@greenvalley.com', '+919900112233', 'committee', 'A-201', 'Tower A · Flat 201', 'Management Committee Member', 'ACTIVE'),
('user-fm-01', 'soc-gvs', 'Suresh Patil', 'facility@greenvalley.com', '+919811223344', 'facility_manager', NULL, 'Facility Office Block B', 'Facility & Operations Manager', 'ACTIVE'),
('user-vendor-01', 'soc-gvs', 'Priya Facility Care Ltd', 'priya.vendor@service.com', '+919844556677', 'vendor', NULL, 'Operations Desk Mumbai', 'Authorized Service Provider', 'ACTIVE'),
('user-admin-01', NULL, 'Antigravity Super Admin', 'admin@aarizo.com', '+919800000001', 'admin', NULL, 'Global Platform Ops', 'Platform Master Administrator', 'ACTIVE')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email;
```

**Defects identified in SQL seed:**
1. Column list `(id, society_id, name, email, phone, role, flat_number, flat_details, designation, status)` explicitly omits `password_hash` and `salt`.
2. PostgreSQL defaults these nullable columns to `NULL`.
3. `ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email;` does not touch `password_hash` or `salt`.

---

### 3.3. SQL DDL Schema Inconsistency: `scripts/postgres/01_schema.sql`
Inspected: [scripts/postgres/01_schema.sql](file:///d:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L151-L169)

```sql
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
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
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

**Critical Schema Defect**:
The table `users` in `01_schema.sql` does not include `password_hash VARCHAR(255)` or `salt VARCHAR(64)`. When Docker runs `/docker-entrypoint-initdb.d/01_schema.sql`, PostgreSQL creates a table without password columns. Any subsequent SQL INSERT attempting to write to `password_hash` would fail with `column "password_hash" of relation "users" does not exist` unless Prisma migrations or schema alter scripts have executed.

---

### 3.4. Firestore Demo Seed: `scripts/seed/seed.ts`
Inspected: [scripts/seed/seed.ts](file:///d:/AAZIRA/AARIZO/scripts/seed/seed.ts#L38-L117)

Seeds 7 canonical roles into Cloud Firestore:
- `user-resident-01`, `user-guard-01`, `user-secretary-01`, `user-committee-01`, `user-fm-01`, `user-vendor-01`, `user-admin-01`.
- Firestore is utilized solely for profile synchronization, client-side metadata, and offline caching. Passwords are never stored in Firestore (correct architecture adhering to least privilege).

---

## 4. Authentication Endpoint Breakdown (`POST /api/auth/login`)

Inspected: [server/src/index.ts](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L1746-L1791)

```typescript
app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase().trim() },
      include: { society: true, flat: true },
    });
    if (!user) {
      // ⚠️ Branch 1: User does not exist
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!user.passwordHash || !user.salt) {
      // ⚠️ Branch 2: Account Enumeration / Information Disclosure Hazard
      return res.status(401).json({ 
        error: 'Password authentication is not configured for this user. Please contact administrator.' 
      });
    }
    const computedHash = UniversalProvisioningService.hashPassword(password, user.salt);
    if (!timingSafeCompare(computedHash, user.passwordHash)) {
      // ⚠️ Branch 3: Password incorrect
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // ⚠️ Security Defect: No check for user.status === 'ACTIVE'!

    const token = generateAuthToken({
      sub: user.id,
      email: user.email || undefined,
      role: user.role.toLowerCase(),
      societyId: user.societyId || 'soc-gvs',
      name: user.name,
    });
    res.json({
      success: true,
      token,
      user: { ... },
    });
...
```

### Analysis of Failures and Vulnerabilities in Login Endpoint:

1. **Deterministic Login Failure for Seeded Accounts**:
   When any seeded user attempts to log in with their email (e.g. `admin@aarizo.com` or `vikram.joshi@aarizo.com` with password `dwellora@2026` or `aarizo@2026`), execution reaches line 1759:
   `!user.passwordHash || !user.salt` evaluates to `true`.
   The response is immediately:
   ```json
   HTTP 401 Unauthorized
   { "error": "Password authentication is not configured for this user. Please contact administrator." }
   ```
   Login is completely impossible for all seeded users.

2. **CWE-204 / OWASP A07:2021 Account Enumeration Vulnerability**:
   Notice the difference between Line 1757 and Line 1760:
   - Request with non-existent email (`nonexistent@aarizo.com`): returns `"Invalid email or password"`.
   - Request with existing seeded user (`admin@aarizo.com`): returns `"Password authentication is not configured for this user. Please contact administrator."`.
   An unauthenticated external attacker can run an automated script across an employee/resident wordlist and definitively identify valid user accounts within the organization.

3. **Missing Account Status Enforcement (`user.status`)**:
   Line 1766 proceeds directly to `generateAuthToken` without checking `user.status`. If an administrator deactivates or suspends a resident (`status: 'INACTIVE'` or `status: 'SUSPENDED'`), that user can continue logging in and receiving active JWT tokens.

---

## 5. Frontend Login Screen Coupling Analysis

Inspected: [src/components/auth/login/LoginScreen.tsx](file:///d:/AAZIRA/AARIZO/src/components/auth/login/LoginScreen.tsx#L40-L140)

```typescript
// Line 40
const [password, setPassword] = useState<string>('dwellora@2026');

// Lines 95-107
if (identifier.includes('@')) {
  if (!password.trim()) {
    setError('Please enter your account password.');
    return;
  }
  setLoading(true);
  setError(null);
  try {
    const res = await apiClient.loginWithPassword({
      email: identifier,
      password: password.trim(),
    });
    ...
```

**Key Frontend Observations:**
1. The frontend default password state is hardcoded to `'dwellora@2026'` (legacy product name).
2. The UI allows users to type either an email or mobile phone number into the primary input box.
3. If an email is provided (`identifier.includes('@')`), it routes through `apiClient.loginWithPassword()`, which sends a `POST /api/auth/login` request to the backend.
4. Because the seeded database contains no password hashes, this flow always triggers the error dialog for any user attempting to log in with a seeded email.

---

## 6. Audit Conclusion & Risk Rating

| Metric | Assessment |
| :--- | :--- |
| **Audit Outcome** | **FAIL (Defects Confirmed)** |
| **Direct Impact** | No seeded user can log in via email and password |
| **Security Risk 1** | Account enumeration via differential 401 response |
| **Security Risk 2** | Inactive/suspended user accounts bypass status checks |
| **Data Integrity Risk** | `server/src/seed.ts` destroys existing credentials on re-seed |
| **Schema Risk** | `scripts/postgres/01_schema.sql` missing column definitions |
| **Recommended Phase** | Proceed to Step 5.2 Remediation following verified plan |

