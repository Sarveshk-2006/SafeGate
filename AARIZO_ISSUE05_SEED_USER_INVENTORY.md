# AARIZO — Comprehensive Seed User & Credential Inventory

**Document ID:** `AARIZO_ISSUE05_SEED_USER_INVENTORY`  
**Execution Phase:** Phase A, Step 5.1  
**Target:** Complete inventory of all seeded database and mock accounts across AARIZO  
**Date:** November 14, 2026  
**Auditor:** Antigravity Autonomous Security Engineer  

---

## 1. Master Seed User Inventory Matrix

| ID | Full Name | Primary Email | Primary Phone | Canonical Role | Society | Status | In `seed.ts` | In `03_seed.sql` | In `mockUsers.ts` | Password Hash Status | Email/PW Login |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :---: | :---: | :---: | :--- | :---: |
| `user-adm-1` | Super Administrator | `admin@aarizo.com` | `9999988888` | `admin` | `soc-gvs` | `ACTIVE` | YES | NO | NO | **MISSING (NULL)** | ❌ BLOCKED |
| `user-admin-01` | Platform Super Admin | `admin@aarizo.com` / `admin@dwellora.com` | `+919800000001` / `9000000001` | `admin` | `soc-gvs` / `ALL` | `ACTIVE` | NO | YES | YES | **MISSING (NULL)** | ❌ BLOCKED |
| `user-sec-1` | Mayuri Udar | `mayuri.udar@aarizo.com` | `9876543210` | `secretary` | `soc-gvs` | `ACTIVE` | YES | NO | NO | **MISSING (NULL)** | ❌ BLOCKED |
| `user-secretary-01`| Mayuri Udar | `secretary@greenvalley.com` | `+919820012345` | `secretary` | `soc-gvs` | `ACTIVE` | NO | YES | YES | **MISSING (NULL)** | ❌ BLOCKED |
| `user-guard-1` | Officer Ramesh Shinde | `guard.ramesh@aarizo.com` | `9892011223` | `guard` | `soc-gvs` | `ACTIVE` | YES | NO | NO | **MISSING (NULL)** | ❌ BLOCKED |
| `user-guard-01` | Officer R. Singh | `guard1@greenvalley.com` | `+919123456789` | `guard` | `soc-gvs` | `ACTIVE` | NO | YES | YES | **MISSING (NULL)** | ❌ BLOCKED |
| `user-res-1` | Vikram Joshi | `vikram.joshi@aarizo.com` | `9820098200` | `resident` | `soc-gvs` | `ACTIVE` | YES | NO | NO | **MISSING (NULL)** | ❌ BLOCKED |
| `user-res-2` | Ananya Roy | `ananya.roy@aarizo.com` | `9819998199` | `resident` | `soc-gvs` | `ACTIVE` | YES | NO | NO | **MISSING (NULL)** | ❌ BLOCKED |
| `user-resident-01` | Sarvesh Kulkarni | `sarvesh@greenvalley.com` | `+919876543210` | `resident` | `soc-gvs` | `ACTIVE` | NO | YES | YES | **MISSING (NULL)** | ❌ BLOCKED |
| `user-com-1` | Dr. Ashok Mehta | `ashok.mehta@aarizo.com` | `9833445566` | `committee` | `soc-gvs` | `ACTIVE` | YES | NO | NO | **MISSING (NULL)** | ❌ BLOCKED |
| `user-committee-01`| Rajesh Mehta | `rajesh.committee@greenvalley.com`| `+919900112233` | `committee` | `soc-gvs` | `ACTIVE` | NO | YES | YES | **MISSING (NULL)** | ❌ BLOCKED |
| `user-fac-1` | Rajesh Patil | `rajesh.patil@aarizo.com` | `9811223344` | `facility_manager`| `soc-gvs`| `ACTIVE` | YES | NO | NO | **MISSING (NULL)** | ❌ BLOCKED |
| `user-fm-01` | Suresh Patil | `facility@greenvalley.com` | `+919811223344` | `facility_manager`| `soc-gvs`| `ACTIVE` | NO | YES | YES | **MISSING (NULL)** | ❌ BLOCKED |
| `user-ven-1` | Ramesh Gupta | `ramesh.gupta@aquapure.com` | `9822100445` | `vendor` | `soc-gvs` | `ACTIVE` | YES | NO | NO | **MISSING (NULL)** | ❌ BLOCKED |
| `user-vendor-01` | Priya Facility Care / Services | `priya.vendor@service.com` | `+919844556677` | `vendor` | `soc-gvs` | `ACTIVE` | NO | YES | YES | **MISSING (NULL)** | ❌ BLOCKED |

---

## 2. Detailed Profile Analysis by Canonical Role

### Role 1: Super Administrator (`admin`)
- **Prisma Seed Record (`server/src/seed.ts:278`)**:
  - ID: `user-adm-1`
  - Name: `Super Administrator`
  - Email: `admin@aarizo.com`
  - Phone: `9999988888`
  - Designation: `Enterprise Platform Administrator`
  - Password Hash: `NULL`
  - Salt: `NULL`
- **SQL Seed Record (`scripts/postgres/03_seed.sql:43`)**:
  - ID: `user-admin-01`
  - Name: `Antigravity Super Admin`
  - Email: `admin@aarizo.com`
  - Phone: `+919800000001`
  - Designation: `Platform Master Administrator`
  - Password Hash: `NULL`
  - Salt: `NULL`
- **Mock User Profile (`src/mockData/auth/mockUsers.ts:101`)**:
  - ID: `user-admin-01`
  - Email: `admin@dwellora.com`
  - Phone: `9000000001`
- **Login Status**:
  - Mock quick login: Works (dev only).
  - API Email/Password login (`admin@aarizo.com`): Fails with `401: Password authentication is not configured for this user`.

---

### Role 2: Society Secretary (`secretary`)
- **Prisma Seed Record (`server/src/seed.ts:207`)**:
  - ID: `user-sec-1`
  - Name: `Mayuri Udar`
  - Email: `mayuri.udar@aarizo.com`
  - Phone: `9876543210`
  - Flat: `C-301`
  - Designation: `General Secretary`
  - Password Hash: `NULL`
  - Salt: `NULL`
- **SQL Seed Record (`scripts/postgres/03_seed.sql:39`)**:
  - ID: `user-secretary-01`
  - Name: `Mayuri Udar`
  - Email: `secretary@greenvalley.com`
  - Phone: `+919820012345`
  - Flat: `A-101`
  - Designation: `Management Committee Secretary`
  - Password Hash: `NULL`
  - Salt: `NULL`
- **Mock User Profile (`src/mockData/auth/mockUsers.ts:21`)**:
  - ID: `user-secretary-01`
  - Email: `secretary@greenvalley.com`
  - Phone: `9820012345`
- **Login Status**:
  - Mock quick login: Works (dev only).
  - API Email/Password login (`mayuri.udar@aarizo.com` or `secretary@greenvalley.com`): Fails with `401: Password authentication is not configured for this user`.

---

### Role 3: Gate Guard / Security Officer (`guard`)
- **Prisma Seed Record (`server/src/seed.ts:223`)**:
  - ID: `user-guard-1`
  - Name: `Officer Ramesh Shinde`
  - Email: `guard.ramesh@aarizo.com`
  - Phone: `9892011223`
  - Designation: `Chief Security Officer`
  - Password Hash: `NULL`
  - Salt: `NULL`
- **SQL Seed Record (`scripts/postgres/03_seed.sql:38`)**:
  - ID: `user-guard-01`
  - Name: `Officer R. Singh`
  - Email: `guard1@greenvalley.com`
  - Phone: `+919123456789`
  - Designation: `Senior Gate Security Officer`
  - Password Hash: `NULL`
  - Salt: `NULL`
- **Mock User Profile (`src/mockData/auth/mockUsers.ts:38`)**:
  - ID: `user-guard-01`
  - Email: `guard1@greenvalley.com`
  - Phone: `9123456789`
- **Login Status**:
  - Mock quick login: Works (dev only).
  - API Email/Password login: Fails with `401: Password authentication is not configured for this user`.

---

### Role 4: Resident (`resident`)
- **Prisma Seed Records (`server/src/seed.ts:177, 192`)**:
  - User 1: `user-res-1` (Vikram Joshi), `vikram.joshi@aarizo.com`, `9820098200`, Flat `B-1204`
  - User 2: `user-res-2` (Ananya Roy), `ananya.roy@aarizo.com`, `9819998199`, Flat `A-402`
  - Password Hash: `NULL`
  - Salt: `NULL`
- **SQL Seed Record (`scripts/postgres/03_seed.sql:37`)**:
  - ID: `user-resident-01`
  - Name: `Sarvesh Kulkarni`
  - Email: `sarvesh@greenvalley.com`
  - Phone: `+919876543210`
  - Flat: `B-1204`
  - Password Hash: `NULL`
  - Salt: `NULL`
- **Mock User Profile (`src/mockData/auth/mockUsers.ts:3`)**:
  - ID: `user-resident-01`
  - Email: `sarvesh@greenvalley.com`
  - Phone: `9876543210`
- **Login Status**:
  - Mock quick login: Works (dev only).
  - API Email/Password login: Fails with `401: Password authentication is not configured for this user`.

---

### Role 5: Committee Member (`committee`)
- **Prisma Seed Record (`server/src/seed.ts:236`)**:
  - ID: `user-com-1`
  - Name: `Dr. Ashok Mehta`
  - Email: `ashok.mehta@aarizo.com`
  - Phone: `9833445566`
  - Flat: `B-402`
  - Designation: `Treasurer & Committee Board Member`
  - Password Hash: `NULL`
  - Salt: `NULL`
- **SQL Seed Record (`scripts/postgres/03_seed.sql:40`)**:
  - ID: `user-committee-01`
  - Name: `Rajesh Mehta`
  - Email: `rajesh.committee@greenvalley.com`
  - Phone: `+919900112233`
  - Flat: `A-201`
  - Designation: `Management Committee Member`
  - Password Hash: `NULL`
  - Salt: `NULL`
- **Mock User Profile (`src/mockData/auth/mockUsers.ts:54`)**:
  - ID: `user-committee-01`
  - Email: `rajesh.committee@greenvalley.com`
  - Phone: `9900112233`
- **Login Status**:
  - Mock quick login: Works (dev only).
  - API Email/Password login: Fails with `401: Password authentication is not configured for this user`.

---

### Role 6: Facility Manager (`facility_manager`)
- **Prisma Seed Record (`server/src/seed.ts:251`)**:
  - ID: `user-fac-1`
  - Name: `Rajesh Patil`
  - Email: `rajesh.patil@aarizo.com`
  - Phone: `9811223344`
  - Designation: `Senior Facility Engineer`
  - Password Hash: `NULL`
  - Salt: `NULL`
- **SQL Seed Record (`scripts/postgres/03_seed.sql:41`)**:
  - ID: `user-fm-01`
  - Name: `Suresh Patil`
  - Email: `facility@greenvalley.com`
  - Phone: `+919811223344`
  - Designation: `Facility & Operations Manager`
  - Password Hash: `NULL`
  - Salt: `NULL`
- **Mock User Profile (`src/mockData/auth/mockUsers.ts:71`)**:
  - ID: `user-fm-01`
  - Email: `facility@greenvalley.com`
  - Phone: `9811223344`
- **Login Status**:
  - Mock quick login: Works (dev only).
  - API Email/Password login: Fails with `401: Password authentication is not configured for this user`.

---

### Role 7: Vendor (`vendor`)
- **Prisma Seed Record (`server/src/seed.ts:264`)**:
  - ID: `user-ven-1`
  - Name: `Ramesh Gupta`
  - Email: `ramesh.gupta@aquapure.com`
  - Phone: `9822100445`
  - Designation: `Managing Director, AquaPure Ltd`
  - Password Hash: `NULL`
  - Salt: `NULL`
- **SQL Seed Record (`scripts/postgres/03_seed.sql:42`)**:
  - ID: `user-vendor-01`
  - Name: `Priya Facility Care Ltd`
  - Email: `priya.vendor@service.com`
  - Phone: `+919844556677`
  - Designation: `Authorized Service Provider`
  - Password Hash: `NULL`
  - Salt: `NULL`
- **Mock User Profile (`src/mockData/auth/mockUsers.ts:87`)**:
  - ID: `user-vendor-01`
  - Email: `priya.vendor@greenvalley.com`
  - Phone: `9844556677`
- **Login Status**:
  - Mock quick login: Works (dev only).
  - API Email/Password login: Fails with `401: Password authentication is not configured for this user`.

---

## 3. Discrepancy & Fragmentation Matrix

| Dimension | `server/src/seed.ts` (Prisma) | `scripts/postgres/03_seed.sql` (Docker) | `src/mockData/auth/mockUsers.ts` (Client) | Impact & Risk |
| :--- | :--- | :--- | :--- | :--- |
| **ID Scheme** | Short IDs (`user-res-1`, `user-sec-1`, `user-adm-1`) | Hyphenated padded IDs (`user-resident-01`, `user-secretary-01`) | Hyphenated padded IDs (`user-resident-01`, `user-secretary-01`) | If backend runs `seed.ts` but client expects `mockUsers.ts` IDs, foreign keys and mock switching will fail |
| **Email Domains** | `@aarizo.com` / `@aquapure.com` | `@greenvalley.com` / `@aarizo.com` / `@service.com` | `@greenvalley.com` / `@dwellora.com` | User attempting to log in using mock screen credentials won't find corresponding user in Prisma-seeded database |
| **Resident Identity** | Vikram Joshi (`vikram.joshi@aarizo.com`) | Sarvesh Kulkarni (`sarvesh@greenvalley.com`) | Sarvesh Kulkarni (`sarvesh@greenvalley.com`) | Divergent demo persona profiles |
| **Password Hashes** | Completely omitted (NULL) | Completely omitted (NULL) | N/A (Not stored in mock) | 100% login failure across both seed systems |

---

## 4. Key Recommendations for Step 5.2

1. **Synchronize Demo User Identifiers**:
   Ensure `server/src/seed.ts` supports both the canonical `@aarizo.com` users and provides aliases or supports the exact personas tested in `mockUsers.ts` and `03_seed.sql`.
2. **Deterministic Seed Hashing**:
   Seed scripts must compute HMAC-SHA256 with unique 16-byte random salts during seeding, or use a documented default test credential (e.g. `dwellora@2026` or `aarizo@2026`) so all seeded roles can immediately authenticate in both dev and test environments.
3. **Dual Seed Alignment**:
   `scripts/postgres/03_seed.sql` must be updated with pre-computed test hashes and unique salts so containerized PostgreSQL starts in an authenticatable state.

