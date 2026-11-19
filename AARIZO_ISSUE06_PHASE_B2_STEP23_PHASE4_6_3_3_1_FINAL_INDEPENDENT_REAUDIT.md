# AARIZO — ISSUE-06 / B.2.3 / PHASE 4.6.3.3.1
# STAFF CHILD & AUTHORIZED PICKUP MANAGEMENT MODERNIZATION
## FINAL INDEPENDENT SECURITY & RELIABILITY RE-AUDIT

**Repository:** `D:\AAZIRA\AARIZO`  
**Phase:** Issue-06 / B.2.3 / Subphase 4.6.3.3.1  
**Audit Mode:** STRICTLY READ-ONLY  
**Audit Date:** 2026-11-19  
**Auditor:** Independent Principal Security & Reliability Auditor  
**Final Verdict:** **CONDITIONAL PASS — TARGETED REMEDIATION REQUIRED**  

---

## 1. Executive Summary

This independent audit conducted a strictly read-only inspection of the Staff Child and Authorized Pickup Management modernization in `src/domains/safety/components/SafetyCommandHub.tsx`, its controller functions, its associated test suite `tests/issue06_b23_safety_command_hub.test.ts`, and backend enforcement contracts in `server/src/childSafety/router.ts` and `server/src/childSafety/authz.ts`.

### Key Audit Findings Summary
1. **Tenant & Society Isolation (Highest Priority):** **PASS**. Backend code strictly validates that both `residentId` and `flatId` belong to the authenticated society and that `resident.flatId === flat.id` before allowing child creation. Cross-society child/pickup association and revocation are impossible.
2. **Role Authorization:** **PASS**. All roles (`guard`, `resident`, `secretary`, `committee`, `admin`, unsupported `security` alias, and unauthenticated/vendor) are correctly categorized and fail closed. The frontend does not substitute for backend authorization; all backend endpoints enforce strict role allowlists via verified JWT auth context.
3. **Data & Mutation Integrity:** **PASS**. Synchronous adapters (`safetyCommandEngine.addChildProfile`, `addAuthorizedPickup`, `getChildren`) are completely eliminated from staff child/escort workflows. Raw government IDs are stripped and prohibited. Real async backend calls with concurrency locking are in place.
4. **Regression Preservation:** **PASS with 1 Finding**. Resident workflows, visitor management, and general emergency functionality remain untouched.
5. **Guard Privacy CTA Route Mismatch:** **FINDING (MEDIUM - F-P46331-01)**. The Guard Privacy Notice CTA button in `SafetyCommandHub.tsx` links to `/security/scanner`, but the router in `src/routes/index.tsx:245` mounts `ChildGateScannerPage` at `/security/child-safety`. Consequently, clicking the CTA resolves to the wildcard `/security/*` route (`SecurityTerminalPage`) rather than the scanner terminal.

---

## 2. Actual Code Diff Inspection

### Inspected Files
- `src/domains/safety/components/SafetyCommandHub.tsx`
- `tests/issue06_b23_safety_command_hub.test.ts`
- `src/services/childSafetyService.ts`
- `src/services/apiClient.ts`
- `server/src/childSafety/router.ts`
- `server/src/childSafety/authz.ts`
- `server/src/childSafety/validation.ts`
- `src/routes/index.tsx`

### Verification of Deprecated Adapter Elimination
A search for `safetyCommandEngine` in `SafetyCommandHub.tsx` confirmed:
- `safetyCommandEngine.addChildProfile`: **0 occurrences** (Eliminated).
- `safetyCommandEngine.addAuthorizedPickup`: **0 occurrences** (Eliminated).
- `safetyCommandEngine.getChildren`: **0 occurrences** (Eliminated).
- Hardcoded mock escorts (`Radha Bai`, `Santosh Yadav` in component state): **0 occurrences** (Eliminated).

The only remaining `safetyCommandEngine` references in `SafetyCommandHub.tsx` are for Emergency Incidents (Console / One-Tap SOS, scheduled for Subphase 4.6.3.3.3) and gate verify tab (outside Subphase 4.6.3.3.1).

---

## 3. Independent Role Authorization Verification

| Role | Frontend Roster Visibility | Frontend Create Child | Frontend Add/Revoke Escort | Backend Enforcement (`router.ts`) | Alignment Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`guard`** | Denied (Guard Privacy Notice shown) | Denied (Thrown / No UI) | Denied (Thrown / No UI) | 403 `INSUFFICIENT_PERMISSIONS` (not in `PROFILE_READ_ROLES` or `PROFILE_WRITE_ROLES`) | **PASS** |
| **`resident`** | Own children only (delegates to `ResidentChildSafetyPanel`) | Existing resident workflow | Existing resident workflow | `where.OR = [{ residentId }, { guardianUserId }]`; non-matching flat/resident 403 | **PASS** |
| **`secretary`** | Society-scoped | Allowed | Allowed | Allowed (`PROFILE_READ_ROLES`, `PROFILE_WRITE_ROLES`) | **PASS** |
| **`committee`** | Society-scoped read-only | Denied (Hidden in UI & Thrown) | Denied (Hidden in UI & Thrown) | Read allowed (`PROFILE_READ_ROLES`); Write returns 403 (not in `PROFILE_WRITE_ROLES`) | **PASS** |
| **`admin`** | Society-scoped | Allowed | Allowed | Allowed (`PROFILE_READ_ROLES`, `PROFILE_WRITE_ROLES`) | **PASS** |
| **`security` alias** | Denied (Access Denied banner) | Denied | Denied | 403 `INSUFFICIENT_PERMISSIONS` (unrecognized role fails closed) | **PASS** |
| **`vendor` / unknown** | Denied (Access Denied banner) | Denied | Denied | 403 `INSUFFICIENT_PERMISSIONS` | **PASS** |
| **Unauthenticated** | Denied (Access Denied banner) | Denied | Denied | 401 `AUTH_CONTEXT_MISSING` | **PASS** |

### Key Authorization Findings
- **Frontend Classifier:** `getChildSafetyHubPermissions(role)` strictly maps permissions without granting implicit escalation.
- **Backend Independence:** Frontend checks NEVER substitute for backend checks. If a malicious client bypasses the frontend and directly issues `POST /api/children` or `POST /api/children/:id/pickups`, the backend independently validates `actor.role` against `PROFILE_WRITE_ROLES = ['resident', 'secretary', 'admin']`. Committee members and guards receive HTTP 403 `INSUFFICIENT_PERMISSIONS`.

---

## 4. Tenant and Ownership Boundaries Verification (Highest Priority)

A rigorous audit of the backend data model and router queries was conducted:

### 4.1. Staff-Created Child Profile Tenant Boundaries
Location: `server/src/childSafety/router.ts:1792-1827`
1. **Mandatory Ownership Identification:**
   For staff callers (`secretary`, `admin`), `body.residentId` and `body.flatId` are strictly required (`isNonEmptyString(..., 128)`). Missing either yields HTTP 400 `OWNER_AND_FLAT_REQUIRED`.
2. **Society Scoping of Resident:**
   ```typescript
   prisma.resident.findFirst({
     where: { id: body.residentId.trim(), societyId: actor.societyId, status: 'ACTIVE' },
   })
   ```
   A resident belonging to another society is never matched.
3. **Society Scoping of Flat:**
   ```typescript
   prisma.flat.findFirst({
     where: { id: body.flatId.trim(), societyId: actor.societyId },
   })
   ```
   A flat belonging to another society is never matched.
4. **Cross-Society Rejection:**
   If either the resident or flat does not exist within `actor.societyId`, the request is rejected with HTTP 400 `CROSS_SOCIETY_OR_MISSING_OWNER`.
5. **Resident-to-Flat Association Check:**
   ```typescript
   if (resident.flatId !== flat.id) {
     return res.status(422).json({
       error: 'Specified resident does not belong to the specified flat.',
       code: 'RESIDENT_FLAT_MISMATCH',
     });
   }
   ```
   The backend ensures a secretary cannot associate a resident with a flat they do not occupy.
6. **Persistence Tenant Enforcement:**
   When the child profile is inserted (`prisma.childProfile.create`), `societyId: actor.societyId` is forced from the verified authentication context. Attackers cannot inject a foreign `societyId`.

### 4.2. Authorized Pickup Tenant Boundaries
Location: `server/src/childSafety/router.ts:2210-2287`, `2513-2594`
1. **Child Access Authorization:**
   Every pickup operation (`GET /:childId/pickups`, `POST /:childId/pickups`, `DELETE /:childId/pickups/:pickupId`) first invokes `authorizeChildAccess(actor, childId, res)`.
2. **Zero-Existence Oracle:**
   `authorizeChildAccess` queries `childProfile` with `where: { id: childId, societyId: actor.societyId }`. If the child belongs to another society, HTTP 404 `CHILD_NOT_FOUND` is returned, preventing tenant probing.
3. **Revocation Ownership Validation:**
   When revoking an escort, the backend verifies:
   ```typescript
   where: {
     id: String(req.params.pickupId),
     societyId: child.societyId,
     childId: child.id,
   }
   ```
   And updates inside a transaction with `where: { societyId: child.societyId, childId: child.id, status: { not: 'REVOKED' } }`. Cross-society or cross-child pickup revocation is impossible.

**Section Verdict:** **PASS (Zero Vulnerabilities / Blockers).**

---

## 5. Data & Mutation Integrity Verification

### 5.1. Asynchronous API Execution
- Staff profile creation calls `executeStaffCreateChildProfile` -> `childSafetyService.createChildProfileAsync` -> `apiClient.createChildStrict` -> HTTP `POST /api/children`.
- Escort creation calls `executeStaffAddAuthorizedPickup` -> `childSafetyService.addAuthorizedPickup` -> `apiClient.addChildPickupStrict` -> HTTP `POST /api/children/:id/pickups`.
- Escort revocation calls `executeStaffRevokeAuthorizedPickup` -> `childSafetyService.revokeAuthorizedPickup` -> `apiClient.revokeChildPickupStrict` -> HTTP `POST /api/children/:id/pickups/:pickupId/revoke`.
- All methods return real DTOs from PostgreSQL and await database transaction completion before UI updates.

### 5.2. Concurrency & Duplicate Submission Protection
- `isSubmittingChild`: Disables modal buttons and displays loading indicator while child creation is in flight.
- `isSubmittingPickup`: Disables modal buttons and displays loading indicator while pickup creation is in flight.
- `isRevokingPickupId`: Guard clause `if (isRevokingPickupId) return` prevents multiple concurrent revocation requests.

### 5.3. Government ID & PII Protection
- Form input for government ID in `SafetyCommandHub.tsx:2025-2039`:
  - Field label: `ID Last 4 Digits (Optional)`.
  - Max length: `4`.
  - Input sanitization: `e.target.value.replace(/\D/g, '').slice(0, 4)`.
- Controller sanitization in `executeStaffAddAuthorizedPickup`:
  - Strips non-digits and slices last 4 characters: `pickupForm.idDocumentLast4.trim().replace(/\D/g, '').slice(-4)`.
  - Does NOT submit `idProofNumber` or any raw ID fields.
- Client validation in `apiClient.ts:1049-1050`:
  - `assertNoForbiddenRawIdFields(data, endpoint)`.
  - `assertValidIdDocumentLast4(data.idDocumentLast4, endpoint)`.
- Backend enforcement in `server/src/childSafety/router.ts:2218-2224`:
  - `hasForbiddenRawIdField(body)` returns HTTP 400 `RAW_ID_DOCUMENT_FORBIDDEN` if any raw ID field is present.

### 5.4. Error Handling
- Errors during child creation or escort addition are captured in `formError` state and rendered directly inside the modal with `<AlertTriangle />`.
- Society child roster fetch errors set `childrenError` and display an alert banner in the main view.
- Success messages (`alertSuccess`) are rendered ONLY after the async API call and authoritative reload succeed.

**Section Verdict:** **PASS.**

---

## 6. Regression & Feature Preservation Verification

1. **Resident Portal Preservation:**
   - In `SafetyCommandHub.tsx:804`: `{activeTab === 'CHILD_SAFETY' && isResidentRole && <ResidentChildSafetyPanel />}`.
   - Resident users accessing `SafetyCommandHub` are immediately delegated to `<ResidentChildSafetyPanel />`.
   - Verified by SSR test: resident sees `data-testid="resident-child-safety-panel"` and does not see the command console.
2. **Visitor Management:**
   - Untouched. No changes to `src/domains/guard/` or `src/services/visitorService.ts`.
3. **General Emergency Functionality:**
   - One-Tap SOS, Acknowledge, Assign Responder, and Resolve remain fully functional in `SafetyCommandHub.tsx`.
4. **Gate Pass, Child SOS, and Realtime SSE Subphases:**
   - Unmodified in this subphase; deferred to Subphases 4.6.3.3.2, 4.6.3.3.3, and 4.6.3.3.4 as planned.

**Section Verdict:** **PASS.**

---

## 7. Test Suite Independent Inspection

### 7.1. Test Execution Evidence
- **Targeted Suite:** `npx jest tests/issue06_b23_safety_command_hub.test.ts`
  - Result: **24 passed, 0 failed, 1 total suite**.
- **Combined Security Suites:** `npx jest --runInBand "tests/issue06_b23_safety_command_hub|tests/issue06_b23_child_gate_scanner|tests/issue06_b23_security_realtime_hook|tests/issue06_b23_child_safety_data_layer"`
  - Result: **74 passed, 0 failed, 4 total suites**.
- **Full Offline Jest Suite:** `npx jest --runInBand`
  - Result: **39 passed suites, 2 skipped; 596 passed tests, 11 skipped, 0 failed** (Time: 48.47s).
- **TypeScript Compilation:** `npx tsc -b` -> **Exit code 0**.
- **Production Build:** `npm run build` -> **Exit code 0**.

### 7.2. Test Quality Analysis
- The tests do NOT rely on source-code string matching. They invoke actual TypeScript functions (`getChildSafetyHubPermissions`, `executeStaffCreateChildProfile`, `executeStaffAddAuthorizedPickup`, `executeStaffRevokeAuthorizedPickup`) with real mock services, verify argument shapes, inspect DTO payloads, and assert SSR HTML elements generated by `renderToStaticMarkup(React.createElement(...))`.

### 7.3. Identified Test Coverage Gaps (Informational)
1. **Missing Backend Test for `RESIDENT_FLAT_MISMATCH`:**
   In `server/src/childSafety/router.ts:1816-1820`, the backend checks `if (resident.flatId !== flat.id) return res.status(422)...`. While `CROSS_SOCIETY_OR_MISSING_OWNER` is tested in `tests/issue06_child_safety_api_routes.test.ts:267`, an explicit test for `RESIDENT_FLAT_MISMATCH` (where both resident and flat are in the same society, but the resident is not assigned to that flat) is not present.
2. **Missing Zero-Children Guard Test in Component Pickup Submit:**
   In `SafetyCommandHub.tsx:384-388`, if `children.length === 0`, `handleAddPickupSubmit` sets `Please select a child profile first.`. This branch is not exercised in the unit test suite.

---

## 8. Findings Inventory

### Finding F-P46331-01: Guard Privacy Notice CTA Navigates to Unmounted Scanner Route
- **Classification:** **MEDIUM**
- **Location:** `src/domains/safety/components/SafetyCommandHub.tsx:821` & `tests/issue06_b23_safety_command_hub.test.ts:489`
- **Observed:**
  ```tsx
  <a
    href="/security/scanner"
    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#F06543] text-white text-xs font-extrabold shadow-md hover:bg-[#D95333] transition-all"
  >
    <QrCode size={16} />
    <span>Open Child Gate Scanner</span>
  </a>
  ```
- **Analysis:**
  In `src/routes/index.tsx:245`, the route for `ChildGateScannerPage` is `/security/child-safety`:
  ```tsx
  <Route path="/security/child-safety" element={<ChildGateScannerPage />} />
  <Route path="/security/*" element={<SecurityTerminalPage />} />
  ```
  Additionally, `src/services/realtimeService.ts:328` routes guards to `/security/child-safety`:
  ```typescript
  if (normalized === 'guard') return '/security/child-safety';
  ```
  Because `/security/scanner` is not registered as an exact route in `src/routes/index.tsx`, clicking the CTA causes React Router to fall through to `/security/*`, which renders `SecurityTerminalPage` instead of `ChildGateScannerPage`.
- **Reproduction:**
  1. Sign in as a user with role `guard`.
  2. Navigate to `SafetyCommandHub` on tab `CHILD_SAFETY`.
  3. View the Guard Privacy Boundary Notice.
  4. Click "Open Child Gate Scanner".
  5. The URL updates to `/security/scanner`, rendering `SecurityTerminalPage` rather than `ChildGateScannerPage`.
- **Required Remediation:**
  Update the link in `SafetyCommandHub.tsx:821` from `href="/security/scanner"` to `href="/security/child-safety"`, and update the expectation in `tests/issue06_b23_safety_command_hub.test.ts:489` to match.

---

## 9. Final Audit Verdict

### **CONDITIONAL PASS — TARGETED REMEDIATION REQUIRED**

**Reasoning:**
- All critical tenant boundaries, society isolation rules, database validation checks, and role restrictions are strictly enforced with **zero security blockers**.
- Data and mutation integrity is fully modernized with canonical asynchronous APIs and zero localStorage fallbacks.
- Exactly one narrowly scoped remediation is required: aligning the CTA route link in `SafetyCommandHub.tsx` from `/security/scanner` to `/security/child-safety` (Finding F-P46331-01).

---

## 10. Recommended Targeted Remediation Steps

1. In `src/domains/safety/components/SafetyCommandHub.tsx` around line 821:
   Change `href="/security/scanner"` to `href="/security/child-safety"`.
2. In `tests/issue06_b23_safety_command_hub.test.ts` around line 489:
   Change `expect(html).toContain('href="/security/scanner"');` to `expect(html).toContain('href="/security/child-safety"');`.
3. Verify with `npx jest tests/issue06_b23_safety_command_hub.test.ts` and `npx tsc -b`.

