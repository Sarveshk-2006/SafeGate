# AARIZO — ISSUE-06 — PHASE B.2 — STEP 2.3 — PHASE 4.6.4
# ADMIN & SCANNER REALTIME ALIGNMENT — COMPREHENSIVE READ-ONLY AUDIT

**Audit Date:** 2026-11-19  
**Execution Mode:** STRICTLY READ-ONLY (Zero code modifications, zero test modifications, zero commits)  
**Target Modules:**
- Admin Child Safety Desk: [`src/pages/dashboard/admin/AdminChildSafetyPage.tsx`](file:///d:/AAZIRA/AARIZO/src/pages/dashboard/admin/AdminChildSafetyPage.tsx)
- Perimeter Gate Scanner: [`src/pages/dashboard/security/ChildGateScannerPage.tsx`](file:///d:/AAZIRA/AARIZO/src/pages/dashboard/security/ChildGateScannerPage.tsx)
- Shared Realtime Hooks & Services:
  - [`src/hooks/useChildSafetyRealtime.ts`](file:///d:/AAZIRA/AARIZO/src/hooks/useChildSafetyRealtime.ts)
  - [`src/hooks/useSecurityChildSafetyRealtime.ts`](file:///d:/AAZIRA/AARIZO/src/hooks/useSecurityChildSafetyRealtime.ts)
  - [`src/services/realtimeService.ts`](file:///d:/AAZIRA/AARIZO/src/services/realtimeService.ts)
  - [`src/services/childSafetyService.ts`](file:///d:/AAZIRA/AARIZO/src/services/childSafetyService.ts)
  - [`src/services/apiClient.ts`](file:///d:/AAZIRA/AARIZO/src/services/apiClient.ts)
  - [`src/context/AuthContext.tsx`](file:///d:/AAZIRA/AARIZO/src/context/AuthContext.tsx)
- Backend Router & Authorization:
  - [`server/src/childSafety/router.ts`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts)
  - [`server/src/childSafety/authz.ts`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/authz.ts)

---

## 1. Executive Summary & Pre-Audit Verification

### 1.1 Pre-Audit Gate Status
Before commencing this audit, all preceding subphases were inspected:
1. **Phase 4.6.3.3.3 (Canonical Child SOS & Incident Console):** Implementation and independent security audit completed with verdict PASS.
2. **Phase 4.6.3.3.4 (Security Command Hub Realtime Integration):** Implementation and independent security audit completed with verdict PASS.
3. **Phase 4.6.3.3.5 (Final Integration & Regression Hardening):** Implementation and independent re-audit completed with verdict **CONDITIONAL PASS**:
   - Application runtime code verified at 100% test pass (649/649 tests passing, 40 test suites passing, clean TypeScript compilation, clean Vite production build).
   - Pre-cutover SQL migration script defect in [`scripts/postgres/backfill_child_safety_b21.sql#L532-L533`](file:///d:/AAZIRA/AARIZO/scripts/postgres/backfill_child_safety_b21.sql#L532-L533) (redundant `END LOOP; END IF;`) documented and isolated as a **DEFERRED CUTOVER BLOCKER** for database cutover, with zero impact on application runtime.

### 1.2 Audit Purpose
This Phase 4.6.4 audit assesses the realtime synchronization, backend API alignment, multi-tenant isolation, and role authorization posture of the **Society Admin Child Safety Desk** and the **Perimeter Gate Scanner**. The objective is to identify all architectural gaps, security vulnerabilities, and legacy mock dependencies prior to formulating an implementation and regression test baseline.

---

## 2. Deep Dive: Society Admin Child Safety Desk (`AdminChildSafetyPage.tsx`)

### 2.1 Component Overview
`AdminChildSafetyPage.tsx` serves as the primary administrative management console for society administrators (`admin`) and management secretaries (`secretary`) to monitor registered children, review gate pickup history, and manage active child safety alerts.

### 2.2 Critical Vulnerabilities & Gaps

#### Finding A-1: Hardcoded Tenant Isolation Bypass (`'soc-gvs'`)
- **Location:** [`src/pages/dashboard/admin/AdminChildSafetyPage.tsx#L22`](file:///d:/AAZIRA/AARIZO/src/pages/dashboard/admin/AdminChildSafetyPage.tsx#L22)
- **Code:**
  ```typescript
  const { currentUser } = useAuth();
  const societyId = (currentUser as any)?.societyId || 'soc-gvs';
  ```
- **Severity:** **CRITICAL**
- **Analysis:** If a user session lacks a `societyId` or is unauthenticated/corrupted, the application falls back to `'soc-gvs'`. This violates strict multi-tenant data isolation and risks leaking or mutating data belonging to the Green Valley Society (`soc-gvs`) tenant.

#### Finding A-2: Invocation of Deprecated Synchronous Mock APIs
- **Location:** [`src/pages/dashboard/admin/AdminChildSafetyPage.tsx#L35-L39`](file:///d:/AAZIRA/AARIZO/src/pages/dashboard/admin/AdminChildSafetyPage.tsx#L35-L39)
- **Code:**
  ```typescript
  const loadData = () => {
    setChildren(childSafetyService.getChildren(societyId));
    setPickupLogs(childSafetyService.getPickupLogs(societyId));
    setSafetyAlerts(childSafetyService.getSafetyAlerts(societyId));
  };
  ```
- **Severity:** **CRITICAL**
- **Analysis:** The component calls deprecated, synchronous mock helpers (`getChildren`, `getPickupLogs`, `getSafetyAlerts`). These helpers read from in-memory or localStorage fixture arrays rather than dispatching authenticated HTTP requests to the canonical backend endpoints:
  - `GET /api/children` (`childSafetyService.listChildren()`)
  - `GET /api/children/exit-logs` (`childSafetyService.listExitLogs()`)
  - `GET /api/children/alerts` (`childSafetyService.listAlerts()`)
  As a consequence, the Admin Desk displays static mock data and cannot reflect real child registrations, gate exits, or SOS emergencies.

#### Finding A-3: Zero Realtime SSE Integration
- **Location:** [`src/pages/dashboard/admin/AdminChildSafetyPage.tsx`](file:///d:/AAZIRA/AARIZO/src/pages/dashboard/admin/AdminChildSafetyPage.tsx)
- **Severity:** **HIGH**
- **Analysis:** Neither [`useChildSafetyRealtime`](file:///d:/AAZIRA/AARIZO/src/hooks/useChildSafetyRealtime.ts) nor [`useSecurityChildSafetyRealtime`](file:///d:/AAZIRA/AARIZO/src/hooks/useSecurityChildSafetyRealtime.ts) is imported or instantiated. The admin desk is completely deaf to all 14 Child Safety SSE topics. When a resident registers a child, a pass is verified at the gate, or an SOS is triggered, the admin desk remains stale until manual full-page reload.

#### Finding A-4: Absence of Connection Status Indicator
- **Location:** [`src/pages/dashboard/admin/AdminChildSafetyPage.tsx#L87-L143`](file:///d:/AAZIRA/AARIZO/src/pages/dashboard/admin/AdminChildSafetyPage.tsx#L87-L143)
- **Severity:** **MEDIUM**
- **Analysis:** Unlike `ChildGateScannerPage` and `ResidentChildSafetyPanel`, the Admin Child Safety desk lacks a realtime connection status indicator (such as `data-connection-state`). Administrators have zero visibility into whether they are viewing live data, reconnecting, or operating offline.

#### Finding A-5: Missing Component-Level Defense-in-Depth Role Gating
- **Location:** [`src/pages/dashboard/admin/AdminChildSafetyPage.tsx#L19-L30`](file:///d:/AAZIRA/AARIZO/src/pages/dashboard/admin/AdminChildSafetyPage.tsx#L19-L30)
- **Severity:** **HIGH**
- **Analysis:** While `src/routes/index.tsx` guards the route with `ProtectedRoute allowedRoles={['secretary', 'admin']}`, the component itself does not perform defense-in-depth role checks. If rendered directly or embedded elsewhere, unauthorized roles (guards, residents, vendors) would render the admin console.

#### Finding A-6: Data Model & Schema Mismatch (Legacy vs Canonical DTOs)
- **Location:** [`src/pages/dashboard/admin/AdminChildSafetyPage.tsx#L4`](file:///d:/AAZIRA/AARIZO/src/pages/dashboard/admin/AdminChildSafetyPage.tsx#L4), [`#L309-L314`](file:///d:/AAZIRA/AARIZO/src/pages/dashboard/admin/AdminChildSafetyPage.tsx#L309-L314)
- **Severity:** **HIGH**
- **Analysis:** The component imports deprecated types:
  ```typescript
  import type { ChildProfile, PickupLog, ChildSafetyAlert } from '../../../types/childSafety';
  ```
  It accesses legacy properties such as `c.guardians[0]?.name` and `c.authorizedPickups.length`. In the canonical backend schema (`ChildProfileDto`), primary guardian fields are top-level (`guardianName`, `guardianPhone`), secondary guardians are in `secondaryGuardians`, and emergency contacts are in `emergencyContacts`. The mock `PickupLog` also differs from `ChildExitLogDto`.

#### Finding A-7: Mock Incident Resolution Logic
- **Location:** [`src/pages/dashboard/admin/AdminChildSafetyPage.tsx#L41-L44`](file:///d:/AAZIRA/AARIZO/src/pages/dashboard/admin/AdminChildSafetyPage.tsx#L41-L44)
- **Code:**
  ```typescript
  const handleResolveAlert = (alertId: string) => {
    childSafetyService.resolveSafetyAlert(societyId, alertId, currentUser?.name || 'Society Admin');
    loadData();
  };
  ```
- **Severity:** **CRITICAL**
- **Analysis:** Resolving an alert invokes the synchronous mock `resolveSafetyAlert` rather than the canonical backend API `POST /api/children/alerts/:id/resolve` via `await childSafetyService.resolveAlert(alertId, { resolutionNotes, status: 'RESOLVED' })`. This falsely indicates to staff that an alert is resolved when backend incident state remains active.

#### Finding A-8: Hardcoded Society Branding
- **Location:** [`src/pages/dashboard/admin/AdminChildSafetyPage.tsx#L122`](file:///d:/AAZIRA/AARIZO/src/pages/dashboard/admin/AdminChildSafetyPage.tsx#L122)
- **Severity:** **LOW**
- **Analysis:** The header displays hardcoded text: `"Green Valley Society · {children.length} registered children & pickup passes"` rather than interpolating `currentUser?.societyName`.

#### Finding A-9: Missing Async Lifecycle States (Loading, Error, Empty)
- **Location:** [`src/pages/dashboard/admin/AdminChildSafetyPage.tsx#L264-L392`](file:///d:/AAZIRA/AARIZO/src/pages/dashboard/admin/AdminChildSafetyPage.tsx#L264-L392)
- **Severity:** **MEDIUM**
- **Analysis:** The component contains no loading spinner, skeleton, error alert banner with retry action, or empty state illustrations.

---

## 3. Deep Dive: Perimeter Gate Scanner (`ChildGateScannerPage.tsx`)

### 3.1 Component Overview
`ChildGateScannerPage.tsx` is the guard-facing security terminal used at physical society entrance gates to verify child exit QR passes, enforce missing child lockdowns, and inspect gate audit logs.

### 3.2 Security & Architecture Assessment
The component was modernized during Phase 4.6.3.2 and exhibits a strong security posture:
1. **Canonical Realtime Hook:** Integrates [`useSecurityChildSafetyRealtime`](file:///d:/AAZIRA/AARIZO/src/hooks/useSecurityChildSafetyRealtime.ts) targeting the 8 guard-authorized security topics.
2. **Canonical Async API Calls:** Calls `childSafetyService.verifyGatePass`, `listAlerts`, `listGatePasses`, and `listExitLogs`.
3. **Payload Sanitization:** Immediately clears sensitive QR payload state in a `finally` block (`setQrInput('')`).
4. **Authoritative Lockdown Enforcement:** Displays high-priority missing child lockdown banner with backend alert resolution (`childSafetyService.resolveAlert`).
5. **Connection State Pill:** Renders `data-connection-state` (`Terminal Online`, `Reconnecting...`, `Sync Offline`).

### 3.3 Identified Discrepancy & Alignment Need

#### Finding S-1: Verification Role Check Discrepancy
- **Location:** [`src/pages/dashboard/security/ChildGateScannerPage.tsx#L49`](file:///d:/AAZIRA/AARIZO/src/pages/dashboard/security/ChildGateScannerPage.tsx#L49), [`#L102`](file:///d:/AAZIRA/AARIZO/src/pages/dashboard/security/ChildGateScannerPage.tsx#L102)
- **Code:**
  ```typescript
  const isAuthorizedRole = ['guard', 'secretary', 'committee', 'admin'].includes(userRole);
  ```
- **Severity:** **MEDIUM**
- **Analysis:**
  - In `ChildGateScannerPage.tsx`, `isAuthorizedRole` permits `guard`, `secretary`, `committee`, and `admin` to access the terminal and submit QR pass verifications.
  - However, in backend [`server/src/childSafety/router.ts#L54`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L54):
    ```typescript
    const GATE_VERIFY_ROLES = ['guard', 'admin'] as const;
    ```
  - When `secretary` or `committee` clicks "Scan Pass", the backend responds with `403 Forbidden` (`INSUFFICIENT_ROLE_PERMISSIONS`).
  - **Remediation Requirement:** The scanner UI must distinguish terminal viewing rights from verification execution rights:
    - Terminal view & audit log inspection: `['guard', 'secretary', 'committee', 'admin']`.
    - Verification execution (`canVerifyPass`): `['guard', 'admin']`.
    - For `committee` or `secretary`, the "Scan Pass" button should be disabled with an explanatory badge: *"Gate clearance verification restricted to Guard / Admin"*.

---

## 4. Realtime Hooks & Data Layer Audit

### 4.1 Comparative Analysis: Realtime Hooks
| Property | `useChildSafetyRealtime.ts` | `useSecurityChildSafetyRealtime.ts` |
| :--- | :--- | :--- |
| **Target Audience** | Resident Portal, Admin Child Safety Desk | Guard Gate Scanner, Security Command Hub |
| **Topics Subscribed** | All 14 Child Safety Topics (Profiles, Pickups, Passes, Exits, Alerts) | Strictly 8 Security Topics (Passes, Exits, Alerts) |
| **Household Profile/Pickup Access** | Authorized (`PROFILE_EVENT_ROLES`) | Strictly Forbidden (Resident Privacy Defense-in-Depth) |
| **Return Signature** | `void` (Relies on callbacks and service invalidation) | Status object (`connectionStatus`, `isConnected`, `isReconnecting`, etc.) |
| **Coalescing & Debouncing** | Callback-driven | Built-in 50ms coalescing debounce with nonces |

### 4.2 Hook Selection for Admin Child Safety Desk
Society Administrators and Secretaries have full visibility into profiles, pickups, gate passes, and alerts (`PROFILE_READ_ROLES`, `PASS_READ_ROLES`, `SOS_MANAGE_ROLES`, `PROFILE_EVENT_ROLES`).
Therefore, `AdminChildSafetyPage.tsx` requires access to all 14 topics.
It must integrate [`useChildSafetyRealtime`](file:///d:/AAZIRA/AARIZO/src/hooks/useChildSafetyRealtime.ts) and subscribe to `realtimeService.subscribeToStatus` to display live connection state, with debounced coalescing for table and card updates.

---

## 5. Risk Severity Matrix

| ID | Module | Finding | Risk Level | Remediated in 4.6.4 Plan? |
| :--- | :--- | :--- | :--- | :--- |
| **A-1** | Admin Desk | Hardcoded `'soc-gvs'` fallback tenant | **CRITICAL** | Yes (Strict auth derivation) |
| **A-2** | Admin Desk | Synchronous mock API calls | **CRITICAL** | Yes (Canonical async REST APIs) |
| **A-3** | Admin Desk | Zero realtime SSE integration | **HIGH** | Yes (Hook into `useChildSafetyRealtime`) |
| **A-4** | Admin Desk | Missing connection status pill | **MEDIUM** | Yes (Add status indicator) |
| **A-5** | Admin Desk | Missing component-level role check | **HIGH** | Yes (Defense-in-depth gate) |
| **A-6** | Admin Desk | Legacy types and schema mismatch | **HIGH** | Yes (Migrate to canonical DTOs) |
| **A-7** | Admin Desk | Mock alert resolution logic | **CRITICAL** | Yes (Canonical backend resolution) |
| **A-8** | Admin Desk | Hardcoded society branding | **LOW** | Yes (Dynamic `currentUser.societyName`) |
| **A-9** | Admin Desk | Missing async lifecycle UI states | **MEDIUM** | Yes (Loading, error, empty states) |
| **S-1** | Gate Scanner| Verification role mismatch (403 for committee/secretary) | **MEDIUM** | Yes (Granular button disablement) |

---

## 6. Audit Verdict
**VERDICT: CONDITIONAL PASS — IMPLEMENTATION REQUIRED**
The perimeter gate scanner is architecturally sound with one minor role check refinement needed. The Admin Child Safety desk requires a full modernization to eliminate critical mock dependencies, resolve tenant isolation risks, and establish realtime synchronization.

