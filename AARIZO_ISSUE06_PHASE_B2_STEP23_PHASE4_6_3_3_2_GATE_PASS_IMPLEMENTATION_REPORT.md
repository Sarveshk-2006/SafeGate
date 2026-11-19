# AARIZO — ISSUE-06 — PHASE B.2 — STEP 2.3 — SUBPHASE 4.6.3.3.2
# Backend-Authoritative Gate Pass Generation & Gate Verifier Redirection Implementation Report

**Repository:** `D:\AAZIRA\AARIZO`  
**Phase:** Issue-06 / Phase B.2 / Step 2.3 / Subphase 4.6.3.3.2  
**Target:** Safety Command Hub (`SafetyCommandHub.tsx`)  
**Status:** Completed & Fully Verified  
**Date:** 2026-11-19  

---

## 1. Executive Summary

Subphase 4.6.3.3.2 replaces obsolete, simulated child gate verification and local mock gate-pass generation in the staff-facing `SafetyCommandHub.tsx` with canonical backend-authoritative services and architectural boundaries:

1. **Gate Verifier Redirection:** Obsolete local input forms and simulated verification (`safetyCommandEngine.verifyChildPickupAtGate(...)`) in the `GATE_VERIFIER` tab have been entirely decommissioned. In their place is a dedicated cryptographic redirection panel explaining that perimeter verification is performed exclusively via the dedicated Child Gate Scanner at `/security/child-safety`.
2. **Backend-Authoritative Gate Pass Generation:** Replaced fake pass creation with an asynchronous controller `executeStaffGenerateGatePass` invoking `childSafetyService.createGatePass(...)` which posts to `POST /api/children/passes`.
3. **Role Authorization Enforcement:** Gate pass generation is strictly restricted to staff governance roles (`secretary` and `admin`). Non-authoritative roles (`committee`, `guard`, `resident`, unsupported `security` alias, vendor/unknown) fail closed and cannot view pass creation buttons or invoke the generator controller.
4. **Ephemeral Secret Lifecycle:** One-time cryptographic QR material (`qrPayload`, `bearerToken`) is rendered ephemerally via SVG (`<QRCodeSVG />` from `qrcode.react`) and purged immediately upon modal dismissal. Sensitive credentials are never written to `localStorage` or `sessionStorage`.

---

## 2. Architectural Contracts & Reused Infrastructure

### 2.1 Backend Pass Issuance Contract
- **Endpoint:** `POST /api/children/passes`
- **Controller/Router:** `server/src/childSafety/router.ts` (lines 210–405)
- **Role Enforcement:** `PASS_WRITE_ROLES = ['resident', 'secretary', 'admin'] as const;`
- **Request DTO (`CreateChildGatePassRequest`):**
  ```typescript
  export interface CreateChildGatePassRequest {
    childId: string;
    pickupPersonId?: string | null;
    validFrom: string;
    validUntil: string;
    maxUses?: number;
    notes?: string | null;
  }
  ```
- **Response DTO (`ChildGatePassCreatedDto`):**
  ```typescript
  export interface ChildGatePassCreatedDto extends ChildGatePassDto {
    bearerToken: string;
    qrPayload: string;
  }
  ```
- **Cryptographic Invariants:**
  - Token is generated with 256 bits of cryptographically secure entropy (`generateSecureToken(32)`).
  - Backend stores only `sha256(rawBearerToken)` as `tokenHash` in the PostgreSQL database.
  - Plaintext `bearerToken` is returned exactly once in the HTTP response body alongside formatted `qrPayload`.

### 2.2 Gate Verifier Perimeter Separation
- **Canonical Scanner Destination:** `/security/child-safety` (`ChildGateScannerPage.tsx`)
- Physical perimeter gate verification involves hardware camera scanning, 256-bit single-use token consumption, lock-out anti-replay checks, and audit logging (`POST /api/children/passes/verify`).
- `SafetyCommandHub` is an administrative command console, not a gate scanner. Rerouting perimeter verification to `/security/child-safety` enforces architectural separation of duties and prevents tenant privacy leakage.

---

## 3. Role Permission Matrix

The pure exported classifier `getChildSafetyHubPermissions` enforces the following boundaries:

| Role | Read Roster (`canReadRoster`) | Manage Profiles (`canManageProfiles`) | Manage Pickups (`canManagePickups`) | Generate Passes (`canGeneratePasses`) | Guard Mode (`isGuardRole`) | Experience Rendered |
|---|---|---|---|---|---|---|
| **secretary** | **Allowed** (`true`) | **Allowed** (`true`) | **Allowed** (`true`) | **Allowed** (`true`) | `false` | Full Hub + Child/Escort Pass Generation Buttons |
| **admin** | **Allowed** (`true`) | **Allowed** (`true`) | **Allowed** (`true`) | **Allowed** (`true`) | `false` | Full Hub + Child/Escort Pass Generation Buttons |
| **committee** | **Allowed** (`true`) | **Denied** (`false`) | **Denied** (`false`) | **Denied** (`false`) | `false` | Read-only Hub (Pass buttons hidden; Controller rejected) |
| **guard** | **Denied** (`false`) | **Denied** (`false`) | **Denied** (`false`) | **Denied** (`false`) | `true` | Privacy Boundary Notice + Link to `/security/child-safety` |
| **resident** | Delegated (`true`) | Handled in resident panel | Handled in resident panel | Resident panel | `false` | `<ResidentChildSafetyPanel />` |
| **security** *(alias)* | **Denied** (`false`) | **Denied** (`false`) | **Denied** (`false`) | **Denied** (`false`) | `false` | Access Denied (Fail closed) |
| **unauthenticated / vendor** | **Denied** (`false`) | **Denied** (`false`) | **Denied** (`false`) | **Denied** (`false`) | `false` | Access Denied (Fail closed) |

---

## 4. Key Implementation Details

### 4.1 Changes in `src/domains/safety/components/SafetyCommandHub.tsx`
1. **Import Modern Dependencies:**
   - Imported `QRCodeSVG` from `qrcode.react`.
   - Imported `ChildGatePassCreatedDto` and `CreateChildGatePassRequest` from `../../../types/childSafety`.
2. **Permission Model Extension:**
   - Added `canGeneratePasses: boolean;` to `ChildSafetyHubPermissions`.
   - Defined `canGeneratePasses: ['secretary', 'admin'].includes(normalized)` in `getChildSafetyHubPermissions(role)`.
3. **Pure Controller Export:**
   - Implemented `executeStaffGenerateGatePass(passForm, activeRole, service = childSafetyService)`.
   - Validates `perms.canGeneratePasses` before processing.
   - Enforces presence of `passForm.childId`.
   - Calculates ISO strings for `validFrom` (now) and `validUntil` (custom or now + duration hours, default 4h).
   - Invokes canonical `service.createGatePass(payload)`.
4. **Decommissioned Deprecated Verifier State & Logic:**
   - Removed `scanChildInput`, `scanPickupInput`, `gateResult`, `handleGateVerifySubmit`, and `safetyCommandEngine.verifyChildPickupAtGate(...)`.
5. **Authoritative Pass State & UI Handlers:**
   - Added state: `passChild`, `passEscortId`, `passDurationHours`, `passNotes`, `passFormError`, `isSubmittingPass`, `generatedPass`.
   - Added `handleOpenGeneratePassModal(child, defaultEscortId?)`, `handleClosePassModal()`, and `handleGeneratePassSubmit(e)`.
6. **UI Elements Modernized:**
   - Wrapped Section A child card "Exit Pass" buttons with `{canGeneratePasses && ...}`.
   - Wrapped Section B escort card "Pass" buttons with `{canGeneratePasses && ...}`.
   - Wrapped Escort Detail modal "Generate Exit Pass" button with `{canGeneratePasses && ...}`.
   - Replaced old `GATE_VERIFIER` panel with `Dedicated Gate Scanner Redirection` panel (`data-testid="gate-verifier-redirection-panel"`), featuring a cryptographic verification security note and direct link button (`data-testid="open-child-gate-scanner-btn"`) pointing to `/security/child-safety`.
   - Replaced old mock `GENERATE_PASS` modal with a dual-stage modal:
     - Stage 1: Pass configuration form (escort selector, validity duration, administrative notes).
     - Stage 2: Ephemeral QR code display (`data-testid="one-time-qr-svg-container"`) rendering `<QRCodeSVG value={generatedPass.qrPayload} size={200} level="M" />`, with one-time security warning and dismiss button (`data-testid="dismiss-one-time-qr-btn"`).
7. **Ephemeral Secret Hygiene:**
   - Closing the pass modal or clicking "Done & Close" immediately resets `generatedPass` to `null`.
   - Tokens and QR payloads are never stored in browser storage (`localStorage`/`sessionStorage`).

---

## 5. Test Suite & Verification Results

### 5.1 Focused Subphase Test Suite
- **File:** `tests/issue06_b23_safety_command_hub.test.ts`
- **Test Count:** 37 tests across 6 describe blocks:
  1. `1. Granular Role Authorization Classifier` (7 tests)
  2. `2. Staff Child Profile Creation Controller` (7 tests)
  3. `3. Staff Authorized Pickup Management Controller` (5 tests)
  4. `4. Component SSR Markup & Role Boundary Verification` (5 tests)
  5. `5. Staff Gate Pass Generation Controller (Phase 4.6.3.3.2)` (9 tests)
  6. `6. Gate Verifier Redirection & Pass Button Boundaries (Phase 4.6.3.3.2)` (4 tests)
- **Result:** **37 passed, 37 total (100% pass rate)**

### 5.2 Combined Phase 4.6.3 Suites
- Command: `npx jest --runInBand "tests/issue06_b23_safety_command_hub|tests/issue06_b23_child_gate_scanner|tests/issue06_b23_security_realtime_hook|tests/issue06_b23_child_safety_data_layer"`
- **Result:** **4 test suites passed, 87 tests passed, 0 failures**

### 5.3 TypeScript Build Check
- Command: `npx tsc -b`
- **Result:** Clean exit code 0 (zero compiler diagnostics or type errors).

### 5.4 Production Build Verification
- Command: `npm run build` (`tsc -b && vite build`)
- **Result:** Clean exit code 0; 2187 modules transformed, production bundles generated successfully.

### 5.5 Full Repository Test Suite
- Command: `npx jest --runInBand`
- **Result:**
  - **Test Suites:** 39 passed, 39 of 41 total (2 integration suites safely skipped for non-mocked DB environments)
  - **Tests:** 609 passed, 11 skipped, 620 total
  - **Failures:** 0

---

## 6. Guardrails & Compliance Audit

| Requirement | Status | Evidence |
|---|---|---|
| Zero Git Commits or Pushes | **COMPLIANT** | `git status` shows working directory modifications only; no commits or pushes made. |
| Zero Backend Route / DB Schema Changes | **COMPLIANT** | `server/` and `server/prisma/` remained completely untouched. |
| Zero Client-Side Event Forgery | **COMPLIANT** | No synthetic SSE or client-published events created. |
| Zero Insecure Token Storage | **COMPLIANT** | Bearer tokens and QR payloads are retained in transient React state only and purged upon modal close. |
| Strict Role Boundaries | **COMPLIANT** | `canGeneratePasses` strictly permits `secretary` and `admin`, denying all other roles. Unsupported `security` alias fails closed. |
| Redirection Destination Accuracy | **COMPLIANT** | Verified link destination points to canonical `/security/child-safety`. |

---

## 7. Conclusion & Next Steps

Subphase 4.6.3.3.2 is complete, fully tested, and verified.
Awaiting instruction before proceeding to Subphase 4.6.3.3.3 (*Admin Command Page Modernization & Realtime Incident Stream Alignment*).

