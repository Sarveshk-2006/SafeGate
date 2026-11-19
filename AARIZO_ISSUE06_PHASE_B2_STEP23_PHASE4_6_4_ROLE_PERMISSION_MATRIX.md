# AARIZO — ISSUE-06 — PHASE B.2 — STEP 2.3 — PHASE 4.6.4
# ROLE & PERMISSION MATRIX: ADMIN & SCANNER REALTIME ALIGNMENT

**Audit Date:** 2026-11-19  
**Execution Mode:** STRICTLY READ-ONLY  
**Source of Truth:** [`src/routes/index.tsx`](file:///d:/AAZIRA/AARIZO/src/routes/index.tsx), [`server/src/childSafety/router.ts`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts), [`server/src/childSafety/authz.ts`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/authz.ts)

---

## 1. Overview
This matrix provides an exhaustive, role-by-role security audit of route accessibility, component rendering, backend API endpoints, and SSE topic broadcasting across 11 distinct system roles.

The defined role constants in `server/src/childSafety/router.ts` are:
```typescript
const PROFILE_READ_ROLES = ['resident', 'secretary', 'committee', 'admin'] as const;
const PROFILE_WRITE_ROLES = ['resident', 'secretary', 'admin'] as const;
const PASS_READ_ROLES = ['resident', 'guard', 'secretary', 'committee', 'admin'] as const;
const PASS_WRITE_ROLES = ['resident', 'secretary', 'admin'] as const;
const GATE_VERIFY_ROLES = ['guard', 'admin'] as const;
const SOS_TRIGGER_ROLES = ['resident', 'guard', 'secretary', 'committee', 'admin'] as const;
const SOS_MANAGE_ROLES = ['guard', 'secretary', 'committee', 'admin'] as const;

const PROFILE_EVENT_ROLES = ['secretary', 'committee', 'admin'];
const GATE_AND_SOS_EVENT_ROLES = ['guard', 'secretary', 'committee', 'admin'];
```

---

## 2. Exhaustive 11-Role Permission Matrix

| Role | Route: Admin Desk (`/admin/child-safety`) | Route: Gate Scanner (`/security/child-safety`) | Backend: Roster List (`GET /api/children`) | Backend: Pickups List (`GET .../pickups`) | Backend: Pass List (`GET /api/children/passes`) | Backend: Gate Verify (`POST .../verify`) | Backend: Exit Logs (`GET .../exit-logs`) | Backend: Alerts List (`GET .../alerts`) | Backend: Alert Resolve (`POST .../resolve`) | SSE: Profile Topics | SSE: Gate & SOS Topics |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`admin`** | **ALLOW** | **ALLOW** | **ALLOW** (Society) | **ALLOW** (Society) | **ALLOW** (Society) | **ALLOW** | **ALLOW** (Society) | **ALLOW** (Society) | **ALLOW** | **ALLOW** | **ALLOW** |
| **`secretary`** | **ALLOW** | **ALLOW** | **ALLOW** (Society) | **ALLOW** (Society) | **ALLOW** (Society) | **DENY** (403) | **ALLOW** (Society) | **ALLOW** (Society) | **ALLOW** | **ALLOW** | **ALLOW** |
| **`committee`** | **DENY** (Route) | **DENY** (Route)* | **ALLOW** (Society) | **ALLOW** (Society) | **ALLOW** (Society) | **DENY** (403) | **ALLOW** (Society) | **ALLOW** (Society) | **ALLOW** | **ALLOW** | **ALLOW** |
| **`guard`** | **DENY** (403) | **ALLOW** | **DENY** (403) | **DENY** (403) | **ALLOW** (Active) | **ALLOW** | **ALLOW** (Society) | **ALLOW** (Society) | **ALLOW** | **DENY** (Block) | **ALLOW** |
| **`security`** *(alias)* | **DENY** (403) | **ALLOW** | **DENY** (403) | **DENY** (403) | **ALLOW** (Active) | **ALLOW** | **ALLOW** (Society) | **ALLOW** (Society) | **ALLOW** | **DENY** (Block) | **ALLOW** |
| **`resident`** | **DENY** (403) | **DENY** (403) | **ALLOW** (Owned) | **ALLOW** (Owned) | **ALLOW** (Owned) | **DENY** (403) | **ALLOW** (Owned) | **ALLOW** (Owned) | **DENY** (403) | **DENY** (Targeted) | **DENY** (Targeted) |
| **`vendor`** | **DENY** (403) | **DENY** (403) | **DENY** (403) | **DENY** (403) | **DENY** (403) | **DENY** (403) | **DENY** (403) | **DENY** (403) | **DENY** (403) | **DENY** (Block) | **DENY** (Block) |
| **`facility_manager`**| **DENY** (403) | **DENY** (403) | **DENY** (403) | **DENY** (403) | **DENY** (403) | **DENY** (403) | **DENY** (403) | **DENY** (403) | **DENY** (403) | **DENY** (Block) | **DENY** (Block) |
| **`delivery`** | **DENY** (403) | **DENY** (403) | **DENY** (403) | **DENY** (403) | **DENY** (403) | **DENY** (403) | **DENY** (403) | **DENY** (403) | **DENY** (403) | **DENY** (Block) | **DENY** (Block) |
| **`platform_admin`**| **ALLOW** | **ALLOW** | **ALLOW** (All) | **ALLOW** (All) | **ALLOW** (All) | **ALLOW** | **ALLOW** (All) | **ALLOW** (All) | **ALLOW** | **ALLOW** (Filter) | **ALLOW** (Filter) |
| **`unknown` / None** | **DENY** (401) | **DENY** (401) | **DENY** (401) | **DENY** (401) | **DENY** (401) | **DENY** (401) | **DENY** (401) | **DENY** (401) | **DENY** (401) | **DENY** (No SSE) | **DENY** (No SSE) |

*\* Note: In `src/routes/index.tsx`, the `/security/*` route wrapper enforces `allowedRoles={['guard', 'secretary', 'admin']}`. Thus `committee` is blocked at the route boundary for `/security/child-safety`, despite being listed in `ChildGateScannerPage.tsx`'s internal `isAuthorizedRole`.*

---

## 3. Critical Permission Gap Analysis

### 3.1 Gate Pass Verification Boundary (`GATE_VERIFY_ROLES`)
- **Backend Law:** [`server/src/childSafety/router.ts#L54`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L54) specifies:
  `const GATE_VERIFY_ROLES = ['guard', 'admin'] as const;`
- **Scanner Component Discrepancy:** In [`ChildGateScannerPage.tsx#L49`](file:///d:/AAZIRA/AARIZO/src/pages/dashboard/security/ChildGateScannerPage.tsx#L49), `isAuthorizedRole` includes `'secretary'` and `'committee'`.
  When a secretary views the terminal, they see the scan input and submit button enabled. Submitting a pass results in an unhandled HTTP 403 API failure (`INSUFFICIENT_ROLE_PERMISSIONS`).
- **Required Remediation:** 
  The scanner UI must enforce `canVerifyPass = ['guard', 'admin'].includes(userRole)`. If `canVerifyPass` is false, the submit button is disabled with an explanatory badge: *"Gate clearance verification requires Guard or Admin role."*

### 3.2 Admin Desk Defense-in-Depth (`AdminChildSafetyPage.tsx`)
- **Route Guard:** `src/routes/index.tsx` protects `/admin/child-safety` with `allowedRoles={['secretary', 'admin']}`.
- **Component Gap:** The page component performs no role check.
- **Required Remediation:** 
  Incorporate component-level defense-in-depth:
  ```typescript
  const isAuthorizedAdmin = ['admin', 'secretary'].includes(userRole) || isPlatformAdmin;
  if (!currentUser || !societyId || !isAuthorizedAdmin) {
    return <AccessDeniedCard />;
  }
  ```

---

## 4. Multi-Tenant Isolation Enforcement
1. **Concrete Society ID Requirement:**
   - Both Admin Desk and Gate Scanner MUST reject hardcoded fallbacks (e.g., `'soc-gvs'`).
   - If `societyId` is null, empty, or whitespace, the UI must fail closed and render an authentication error.
2. **Platform Admin Exception:**
   - Platform admins (`role === 'platform_admin'`) may explicitly supply a target `societyId` filter when inspecting a society's roster or gate logs.

