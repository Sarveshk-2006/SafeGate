# AARIZO — ISSUE-06 / B.2.3 / PHASE 4.6.3.3
# SAFETY COMMAND HUB — ROLE & PERMISSION AUTHORIZATION MATRIX

**Repository:** `D:\AAZIRA\AARIZO`  
**Phase:** Issue-06 / Phase B.2.3 — Subphase 4.6.3.3  
**Audit Mode:** STRICTLY READ-ONLY Role & Permission Verification  
**Date:** 2026-11-19  

---

## 1. Canonical Backend Role Definitions

From PostgreSQL enum `UserRole` (`server/prisma/schema.prisma:10-18`) and backend router constants (`server/src/childSafety/router.ts:50-59`):

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

## 2. Comprehensive Role Authorization & Workflow Permission Matrix

| Role | Tab: `ONE_TAP_SOS` | Tab: `CHILD_SAFETY` | Tab: `COMMAND_CONSOLE` | Tab: `GATE_VERIFIER` | Read Child Profiles (`GET /api/children`) | Create/Edit Child Profile (`POST/PATCH /api/children`) | Read Passes & Logs (`/passes`, `/exit-logs`) | Create Gate Pass (`POST /passes`) | Verify Gate Pass (`POST /passes/verify`) | Trigger Child SOS (`POST /sos`) | Acknowledge & Resolve SOS (`/alerts/:id/*`) | Authorized SSE Topics |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---|
| **`guard`** | ✅ Yes | ❌ **DENIED** *(Household Privacy)* | ✅ Yes | ✅ Yes *(Scanner)* | ❌ **403 Forbidden** (`PROFILE_READ_ROLES`) | ❌ **403 Forbidden** (`PROFILE_WRITE_ROLES`) | ✅ **PERMITTED** (`PASS_READ_ROLES`) | ❌ **403 Forbidden** (`PASS_WRITE_ROLES`) | ✅ **PERMITTED** (`GATE_VERIFY_ROLES`) | ✅ **PERMITTED** (`SOS_TRIGGER_ROLES`) | ✅ **PERMITTED** (`SOS_MANAGE_ROLES`) | 8 Security topics (`GATE_AND_SOS_EVENT_ROLES`). Roster topics strictly dropped. |
| **`secretary`** | ✅ Yes | ✅ Yes *(Society Roster)* | ✅ Yes | ✅ Yes | ✅ **PERMITTED** (Society Scope) | ✅ **PERMITTED** (Requires `residentId` + `flatId`) | ✅ **PERMITTED** (`PASS_READ_ROLES`) | ✅ **PERMITTED** (`PASS_WRITE_ROLES`) | ❌ **403 Forbidden** *(Guard/Admin only)* | ✅ **PERMITTED** (`SOS_TRIGGER_ROLES`) | ✅ **PERMITTED** (`SOS_MANAGE_ROLES`) | All 14 Child Safety topics (`PROFILE_EVENT_ROLES` + `GATE_AND_SOS_EVENT_ROLES`). |
| **`committee`** | ✅ Yes | ✅ Yes *(Society Roster)* | ✅ Yes | ✅ Yes | ✅ **PERMITTED** (Society Scope) | ❌ **403 Forbidden** (`PROFILE_WRITE_ROLES`) | ✅ **PERMITTED** (`PASS_READ_ROLES`) | ❌ **403 Forbidden** (`PASS_WRITE_ROLES`) | ❌ **403 Forbidden** *(Guard/Admin only)* | ✅ **PERMITTED** (`SOS_TRIGGER_ROLES`) | ✅ **PERMITTED** (`SOS_MANAGE_ROLES`) | All 14 Child Safety topics. |
| **`admin`** | ✅ Yes | ✅ Yes *(Society Roster)* | ✅ Yes | ✅ Yes | ✅ **PERMITTED** (Society Scope) | ✅ **PERMITTED** (Requires `residentId` + `flatId`) | ✅ **PERMITTED** (`PASS_READ_ROLES`) | ✅ **PERMITTED** (`PASS_WRITE_ROLES`) | ✅ **PERMITTED** (`GATE_VERIFY_ROLES`) | ✅ **PERMITTED** (`SOS_TRIGGER_ROLES`) | ✅ **PERMITTED** (`SOS_MANAGE_ROLES`) | All 14 Child Safety topics. |
| **`resident`** | ✅ Yes | ✅ Yes *(Own Household)* | ❌ **HIDDEN** | ❌ **HIDDEN** | ✅ **PERMITTED** (Own Flat/Children Only) | ✅ **PERMITTED** (Own Flat/Children Only) | ✅ **PERMITTED** (Own Passes/Logs Only) | ✅ **PERMITTED** (Own Children Only) | ❌ **403 Forbidden** (`GATE_VERIFY_ROLES`) | ✅ **PERMITTED** (Own Children or General) | ❌ **403 Forbidden** (`SOS_MANAGE_ROLES`) | All 14 Child Safety topics filtered by ownership. |
| **`security`** *(alias)* | ❌ **FAIL CLOSED** | ❌ **FAIL CLOSED** | ❌ **FAIL CLOSED** | ❌ **FAIL CLOSED** | ❌ **401/403** (Unknown DB Role) | ❌ **401/403** | ❌ **401/403** | ❌ **401/403** | ❌ **401/403** | ❌ **401/403** | ❌ **401/403** | ❌ SSE subscription rejected. |
| **`delivery` / `vendor`** | ❌ **DENIED** | ❌ **DENIED** | ❌ **DENIED** | ❌ **DENIED** | ❌ **403 Forbidden** | ❌ **403 Forbidden** | ❌ **403 Forbidden** | ❌ **403 Forbidden** | ❌ **403 Forbidden** | ❌ **403 Forbidden** | ❌ **403 Forbidden** | ❌ SSE subscription rejected. |
| **Unauthenticated** | ❌ **DENIED** | ❌ **DENIED** | ❌ **DENIED** | ❌ **DENIED** | ❌ **401 Unauthorized** | ❌ **401 Unauthorized** | ❌ **401 Unauthorized** | ❌ **401 Unauthorized** | ❌ **401 Unauthorized** | ❌ **401 Unauthorized** | ❌ **401 Unauthorized** | ❌ SSE subscription rejected. |

---

## 3. Defense-in-Depth Guardrails

### 3.1 Guard Privacy Boundary
- **Core Invariant:** A security guard at a gate or patrol station must **not** have uninhibited browsing access to the society's full child roster, photos, birth dates, or home caretaker details.
- **Enforcement:**
  - `GET /api/children` strictly rejects `guard` with `403 FORBIDDEN` (`code: 'ROLE_UNAUTHORIZED'`).
  - `useSecurityChildSafetyRealtime.ts` explicitly drops `CHILD_PROFILE_*` and `CHILD_PICKUP_*` topics.
  - When `SafetyCommandHub` is rendered by a user with `role === 'guard'`:
    - The `CHILD_SAFETY` tab must display a clear guidance notice redirecting the guard to the **Gate Scanner** (`ChildGateScannerPage.tsx`), rather than attempting an unauthorized fetch of `/api/children`.

### 3.2 Committee Role Remediation
- **Core Invariant:** `committee` members are elected society officials authorized to monitor safety operations and review incident consoles.
- **Enforcement:**
  - Update `isAdminOrSecurity` in `SafetyCommandHub.tsx`:
    ```typescript
    // Canonical staff authorization: guard, secretary, committee, admin
    const isStaffRole = ['admin', 'secretary', 'committee', 'guard'].includes(activeRole);
    ```
  - This allows `committee` members to view the `COMMAND_CONSOLE` and review live incident feeds without encountering false UI lockouts.

### 3.3 Resident vs Staff SOS Dispatch Boundary
- **Core Invariant:**
  - When a resident clicks Child SOS, they must be presented with the verified `ResidentChildSosModal` (child selector, last seen details, guardian emergency notification).
  - When staff (`admin`, `secretary`, `guard`, `committee`) clicks Child SOS, the action must invoke the canonical `childSafetyService.triggerSos()` API (or a staff-scoped dispatch modal), recording a real `ChildSafetyAlert` in PostgreSQL and broadcasting `CHILD_SAFETY_SOS_TRIGGERED` across society terminals. Local mock generation is completely eliminated.

