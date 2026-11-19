# AARIZO — ISSUE-06 — PHASE B.2 — STEP 2.3 — SUBPHASE 4.6.3.3.3
# Child SOS & Unified Incident Console Role Permission Matrix

**Repository:** `D:\AAZIRA\AARIZO`  
**Phase:** Issue-06 / Phase B.2 / Step 2.3 / Subphase 4.6.3.3.3  
**Document:** Role & Permission Authorization Matrix  
**Mode:** STRICTLY READ-ONLY  
**Date:** 2026-11-19  

---

## 1. Executive Summary

This role permission matrix documents the exact server-side authorization boundaries enforced across Child Safety alerts, general emergencies, and the staff incident command console. All role rules are derived directly from the verified backend implementations in [`server/src/childSafety/router.ts`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts), [`server/src/childSafety/authz.ts`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/authz.ts), and [`server/src/index.ts`](file:///d:/AAZIRA/AARIZO/server/src/index.ts).

### Core Role Principles:
1. **Deny by Default:** Any role not explicitly in an allowlist is denied immediately with HTTP 403 `INSUFFICIENT_PERMISSIONS`.
2. **Zero Role Aliases:** The unsupported `'security'` alias is rejected at all levels; canonical security operators run as `'guard'`.
3. **Resident Guardian Isolation:** Residents can only trigger SOS and read alerts for their own verified children.
4. **Guard Privacy Boundary:** Guards never receive child roster access; they can only observe active alert telemetry required for perimeter response.

---

## 2. Comprehensive Role Permission Matrix

| Capability / Endpoint | resident | guard | secretary | committee | admin | platform_admin | vendor / facility / delivery | security (alias) |
|---|---|---|---|---|---|---|---|---|
| **Child SOS Trigger** (`POST /api/children/sos`) | **Allowed** *(Own children only)* | **Allowed** *(Society child or unidentified)* | **Allowed** *(Society child or unidentified)* | **Allowed** *(Society child or unidentified)* | **Allowed** *(Society child or unidentified)* | **Allowed** *(Concrete society required)* | **Denied** (403) | **Denied** (403) |
| **Child Alerts List** (`GET /api/children/alerts`) | **Allowed** *(Self & owned children only)* | **Allowed** *(Society-wide)* | **Allowed** *(Society-wide)* | **Allowed** *(Society-wide)* | **Allowed** *(Society-wide)* | **Allowed** *(All/filtered societies)* | **Denied** (403) | **Denied** (403) |
| **Child Alert Acknowledge** (`POST /api/children/alerts/:id/ack`) | **Denied** (403) | **Allowed** *(ACTIVE only)* | **Allowed** *(ACTIVE only)* | **Allowed** *(ACTIVE only)* | **Allowed** *(ACTIVE only)* | **Allowed** | **Denied** (403) | **Denied** (403) |
| **Child Alert Resolve** (`POST /api/children/alerts/:id/resolve`) | **Denied** (403) | **Allowed** *(With notes)* | **Allowed** *(With notes)* | **Allowed** *(With notes)* | **Allowed** *(With notes)* | **Allowed** | **Denied** (403) | **Denied** (403) |
| **General Emergency List** (`GET /api/emergency-incidents`) | **Allowed** *(Non-child only)* | **Allowed** *(Society-wide)* | **Allowed** *(Society-wide)* | **Allowed** *(Society-wide)* | **Allowed** *(Society-wide)* | **Allowed** | **Denied** (403) | **Denied** (403) |
| **General Emergency Trigger** (`POST /api/emergency-incidents`) | **Allowed** | **Allowed** | **Allowed** | **Denied** (403)* | **Allowed** | **Allowed** | **Denied** (403) | **Denied** (403) |
| **General Emergency Resolve** (`PATCH /api/emergency-incidents/:id/resolve`) | **Denied** (403) | **Allowed** | **Allowed** | **Denied** (403)* | **Allowed** | **Allowed** | **Denied** (403) | **Denied** (403) |
| **Child Roster Access** (`GET /api/children`) | **Allowed** *(Own children only)* | **Denied** (403)* | **Allowed** *(Society-wide)* | **Allowed** *(Society-wide)* | **Allowed** *(Society-wide)* | **Allowed** | **Denied** (403) | **Denied** (403) |
| **Staff Child Pass Creation** (`POST /api/children/passes`) | Handled via resident panel | **Denied** (403) | **Allowed** | **Denied** (403) | **Allowed** | **Allowed** | **Denied** (403) | **Denied** (403) |
| **Realtime Security SSE** (`useSecurityChildSafetyRealtime`) | **Denied** (Fails closed) | **Allowed** | **Allowed** | **Allowed** | **Allowed** | **Allowed** | **Denied** (Fails closed) | **Denied** (Fails closed) |

*\*Note on Committee for General Emergencies: In `server/src/index.ts:2312, 2332`, committee members are excluded from general emergency triggering and resolution, but are explicitly included in Child Safety SOS management (`SOS_MANAGE_ROLES`).*  
*\*Note on Guards for Child Roster: In `server/src/childSafety/router.ts:50, 1621`, `PROFILE_READ_ROLES` permits `resident, secretary, committee, admin`. Guards receive 403 when requesting the full child roster, enforcing tenant privacy.*

---

## 3. Role-by-Role Specification in `SafetyCommandHub`

### 3.1 Resident Role (`role === 'resident'`)
- **Experience:** Delegated entirely to `<ResidentChildSafetyPanel />` (`SafetyCommandHub.tsx:684-688`).
- **Child SOS:** May only trigger SOS via `<ResidentChildSosModal />` for their own verified children.
- **Alert History:** Views self-reported and owned child alerts in `<ResidentChildAlertsSection />`.
- **Acknowledge / Resolve:** Strictly hidden and blocked; residents cannot manage or resolve alerts.
- **Command Console:** Console tab button and console feed are completely hidden for residents.

### 3.2 Security Guard Role (`role === 'guard'`)
- **Privacy Boundary Notice:** If visiting the `CHILD_SAFETY` tab, sees the Guard Privacy Boundary Notice with CTA to `/security/child-safety`. Roster cards, guardian phone numbers, and child pass generation buttons are hidden.
- **Command Console Access:** Has full access to the Live Incident Feed (`COMMAND_CONSOLE`).
- **Child Alerts:** Can view active Child Safety alerts across the society (child name, flat, location, alert type).
- **Acknowledge:** Can click "Acknowledge Alert" on active alerts.
- **Resolve:** Can click "Mark Resolved" on acknowledged/active alerts, submitting resolution notes.
- **General Emergencies:** Can trigger general emergencies (e.g. at gate/premises) and resolve them.
- **Realtime SSE:** Connected via `useSecurityChildSafetyRealtime`, receiving instant SSE alert updates.

### 3.3 Secretary & Administrator Roles (`role === 'secretary' | 'admin'`)
- **Full Operational Scope:**
  - Can view the complete society child roster, active passes, and escorts.
  - Can register children, manage escorts, and generate child gate passes (`canGeneratePasses: true`).
  - Can trigger Child Safety SOS for society children or unidentified children on premises.
  - Can monitor the unified incident console with live counts.
  - Can acknowledge and resolve all Child Safety alerts and general emergency incidents.
  - Connected via `useSecurityChildSafetyRealtime`.

### 3.4 Managing Committee Role (`role === 'committee'`)
- **Supervisory / Oversight Scope:**
  - Can view the child roster (read-only; child creation and pass generation buttons are hidden).
  - Can view Child Safety alerts and general emergencies in the command console.
  - Can acknowledge and resolve Child Safety alerts (`SOS_MANAGE_ROLES` includes committee).
  - Cannot trigger or resolve general emergencies (`server/src/index.ts:2312, 2332` excludes committee).
  - Connected via `useSecurityChildSafetyRealtime`.

### 3.5 Unsupported Roles & Aliases (Fail-Closed)
- **`'security'` (Alias):** Fails closed. Denied access to the hub (`Access Denied`), denied by backend APIs, and denied by realtime SSE hooks.
- **`'vendor'`, `'facility_manager'`, `'delivery'`:** Fail closed. Cannot view child rosters or trigger Child Safety alerts.
- **Unauthenticated Sessions:** Render Access Denied; all mutation controllers throw `Forbidden`.

---

## 4. Frontend Permission Classifier Extension

The pure classifier `getChildSafetyHubPermissions` in `SafetyCommandHub.tsx` will be extended to include console permissions:

```typescript
export interface ChildSafetyHubPermissions {
  canReadRoster: boolean;
  canManageProfiles: boolean;
  canManagePickups: boolean;
  canGeneratePasses: boolean;
  canViewConsole: boolean;
  canManageAlerts: boolean;
  isGuardRole: boolean;
  isResidentRole: boolean;
  isStaffRole: boolean;
}

export function getChildSafetyHubPermissions(role?: string | null): ChildSafetyHubPermissions {
  const normalized = (role || '').trim().toLowerCase();
  return {
    canReadRoster: ['resident', 'secretary', 'committee', 'admin'].includes(normalized),
    canManageProfiles: ['secretary', 'admin'].includes(normalized),
    canManagePickups: ['secretary', 'admin'].includes(normalized),
    canGeneratePasses: ['secretary', 'admin'].includes(normalized),
    canViewConsole: ['guard', 'secretary', 'committee', 'admin'].includes(normalized),
    canManageAlerts: ['guard', 'secretary', 'committee', 'admin'].includes(normalized),
    isGuardRole: normalized === 'guard',
    isResidentRole: normalized === 'resident',
    isStaffRole: ['admin', 'secretary', 'committee', 'guard'].includes(normalized),
  };
}
```

