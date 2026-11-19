# AARIZO — ISSUE-05 Remediation Plan: Seeded User Password Hashes & Auth Hardening

**Document ID:** `AARIZO_ISSUE05_REMEDIATION_PLAN`  
**Execution Phase:** Phase A, Step 5.1 (Planning for Step 5.2 Implementation)  
**Target:** Safe, Idempotent, High-Assurance Remediation of ISSUE-05  
**Priority:** P1  
**Date:** November 14, 2026  
**Auditor:** Antigravity Autonomous Security Engineer  

---

## 1. Remediation Objectives & Scope

The objective of Step 5.2 is to resolve the defects confirmed in `AARIZO_ISSUE05_SEED_AUTH_AUDIT.md`:
1. **Enable Email/Password Authentication for All Seeded Users**: Ensure all 8 canonical database roles can immediately log in via `POST /api/auth/login`.
2. **Deterministic & Environment-Driven Seed Credentials**: Use a secure, documented default password (`dwellora@2026`) aligned with frontend defaults, with support for `SEED_DEFAULT_PASSWORD` environment overrides.
3. **Idempotent Database Seeding**: Transform `server/src/seed.ts` from destructive table purges (`deleteMany`) into safe upsert operations that preserve modified credentials.
4. **Synchronize Containerized SQL Definitions**: Update `01_schema.sql` and `03_seed.sql` to include `password_hash` and `salt` columns and values.
5. **Close Account Enumeration (CWE-204)**: Unify `POST /api/auth/login` error messages to prevent attackers from discovering valid email accounts.
6. **Enforce Account Status Check (CWE-285)**: Block inactive or suspended users from authenticating in `POST /api/auth/login`.

---

## 2. Step 5.2 Phased Implementation Plan

### Phase 1: Environment & Password Configuration Strategy
- Define canonical default seed password: `dwellora@2026` (matching [src/components/auth/login/LoginScreen.tsx:40](file:///d:/AAZIRA/AARIZO/src/components/auth/login/LoginScreen.tsx#L40)).
- Support runtime override via `process.env.SEED_DEFAULT_PASSWORD || 'dwellora@2026'`.
- Store per-user unique salts (`crypto.randomBytes(16).toString('hex')`) and compute hashes via `UniversalProvisioningService.hashPassword(password, salt)`.

---

### Phase 2: Schema & Container DDL Alignment
1. **Update `scripts/postgres/01_schema.sql`**:
   - Add columns to `CREATE TABLE IF NOT EXISTS users`:
     ```sql
     password_hash VARCHAR(255),
     salt VARCHAR(64),
     ```
2. **Update `scripts/postgres/03_seed.sql`**:
   - Add `password_hash` and `salt` to the column list of `INSERT INTO users`.
   - Provide pre-computed HMAC-SHA256 test hashes for all 7 canonical demo users.
   - Update `ON CONFLICT (id) DO UPDATE SET` to avoid overwriting updated credentials.

---

### Phase 3: Prisma Seed Script Hardening (`server/src/seed.ts`)
1. **Import `crypto` and `UniversalProvisioningService`**:
   ```typescript
   import crypto from 'crypto';
   import { UniversalProvisioningService } from './provisioning.js';
   ```
2. **Helper Function for Seed User Credentials**:
   ```typescript
   const defaultSeedPassword = process.env.SEED_DEFAULT_PASSWORD || 'dwellora@2026';

   function createSeedCredentials(password: string = defaultSeedPassword) {
     const salt = crypto.randomBytes(16).toString('hex');
     const passwordHash = UniversalProvisioningService.hashPassword(password, salt);
     return { salt, passwordHash };
   }
   ```
3. **Populate Credentials on All 8 Seeded Users**:
   - `user-res-1` (Vikram Joshi, Resident)
   - `user-res-2` (Ananya Roy, Resident)
   - `user-sec-1` (Mayuri Udar, Secretary)
   - `user-guard-1` (Officer Ramesh Shinde, Guard)
   - `user-com-1` (Dr. Ashok Mehta, Committee Member)
   - `user-fac-1` (Rajesh Patil, Facility Manager)
   - `user-ven-1` (Ramesh Gupta, Vendor)
   - `user-adm-1` (Super Administrator, Admin)

4. **Idempotency Safeguard**:
   - Implement `prisma.user.upsert` with `create` and `update` logic, ensuring existing modified credentials are preserved unless an explicit `--force-reset-passwords` flag is provided.

---

### Phase 4: API Endpoint Security Hardening (`server/src/index.ts`)
1. **Close Account Enumeration (CWE-204)**:
   Change line 1760 from:
   ```typescript
   if (!user.passwordHash || !user.salt) {
     return res.status(401).json({ error: 'Password authentication is not configured for this user. Please contact administrator.' });
   }
   ```
   To:
   ```typescript
   if (!user.passwordHash || !user.salt) {
     return res.status(401).json({ error: 'Invalid email or password' });
   }
   ```
   *(Log an internal warning server-side with sanitization, while presenting a unified response to the client).*

2. **Enforce User Account Status**:
   Add before token generation:
   ```typescript
   if (user.status !== 'ACTIVE') {
     return res.status(403).json({ error: 'Account is inactive or suspended. Please contact administrator.' });
   }
   ```

---

### Phase 5: Comprehensive Test Suite (`tests/issue05_seed_password_hash.test.ts`)
Author an end-to-end unit and integration test suite covering:
1. **Hash Generation Verification**: Assert `hashPassword` produces a 64-char hex string matching HMAC-SHA256 with a 16-byte salt.
2. **Seed User Credential Integrity**: Verify every user generated by `seed.ts` has non-null, valid `passwordHash` and `salt`.
3. **Role Authentication Coverage**: Test `POST /api/auth/login` succeeds for all 8 seeded roles (`admin`, `secretary`, `guard`, `resident`, `committee`, `facility_manager`, `vendor`).
4. **Invalid Password Rejection**: Verify invalid password returns `401: Invalid email or password`.
5. **Account Enumeration Defense**: Verify that a non-existent email and a user without credentials return identical `401` status codes and identical error messages.
6. **Inactive Account Defense**: Verify that an inactive account with valid credentials is rejected with `403`.
7. **Full Test Suite Execution**: Run `npm test` to verify all 14 existing suites and new tests pass cleanly.

---

## 3. Rollback & Contingency Plan

- All edits in Step 5.2 will be isolated to `server/src/seed.ts`, `server/src/index.ts`, `scripts/postgres/01_schema.sql`, `scripts/postgres/03_seed.sql`, and a new test file.
- Changes are fully backwards-compatible with mock authentication and Firebase phone authentication.
- If any test regression occurs, changes can be rolled back via git without impacting database stability.

