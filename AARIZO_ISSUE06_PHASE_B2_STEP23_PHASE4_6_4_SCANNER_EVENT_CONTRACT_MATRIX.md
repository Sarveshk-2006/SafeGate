# AARIZO — ISSUE-06 — PHASE B.2 — STEP 2.3 — PHASE 4.6.4
# SCANNER REALTIME EVENT CONTRACT MATRIX

**Audit Date:** 2026-11-19  
**Execution Mode:** STRICTLY READ-ONLY  
**Source of Truth:** [`server/src/childSafety/router.ts`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts), [`server/src/realtimeEngine.ts`](file:///d:/AAZIRA/AARIZO/server/src/realtimeEngine.ts), [`src/hooks/useSecurityChildSafetyRealtime.ts`](file:///d:/AAZIRA/AARIZO/src/hooks/useSecurityChildSafetyRealtime.ts)

---

## 1. Overview
The perimeter gate scanner operates in a zero-trust security perimeter at physical society gates.
To enforce resident privacy defense-in-depth, security guards are strictly segregated from household roster data.
Guards and gate terminals are authorized to receive **EXCLUSIVELY** the 8 backend Child Safety topics governing gate passes, exit clearances, and active SOS emergencies (`GATE_AND_SOS_EVENT_ROLES`).
Guards are strictly forbidden from receiving household child profile and caretaker authorization events (`PROFILE_EVENT_ROLES`).

---

## 2. Guard-Authorized Scanner Event Contract Matrix

| # | Event Topic | Backend Emitter Line | Transaction Boundary | Allowed Roles (`audience.allowedRoles`) | Guard Eligible? | Scanner Invalidation Target | Sensitive Field Protection Verified |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | `CHILD_GATE_PASS_GENERATED` | [`router.ts#L379`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L379) | Post-DB Transaction Commit | `GATE_AND_SOS_EVENT_ROLES` (`guard`, `secretary`, `committee`, `admin`) | **YES** | `activePasses` | Emits `id`, `childId`, `passCode`, `validFrom`, `validUntil`. **NEVER** emits `bearerToken`, `qrPayload`, or `tokenHash`. |
| **2** | `CHILD_GATE_PASS_VERIFIED` | [`router.ts#L810`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L810) | Post-DB Transaction Commit | `GATE_AND_SOS_EVENT_ROLES` (`guard`, `secretary`, `committee`, `admin`) | **YES** | `activePasses`, `exitLogs` | Emits `passId`, `childId`, `status`, `currentUses`, `maxUses`. Zero cryptographic token leakage. |
| **3** | `CHILD_GATE_PASS_REVOKED` | [`router.ts#L1018`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L1018) | Post-DB Update Commit | `GATE_AND_SOS_EVENT_ROLES` (`guard`, `secretary`, `committee`, `admin`) | **YES** | `activePasses` | Emits `passId`, `childId`, `status: REVOKED`. Immediately removes revoked pass from active file. |
| **4** | `CHILD_EXIT_TRIGGERED` | [`router.ts#L795`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L795) | Post-DB Transaction Commit | `GATE_AND_SOS_EVENT_ROLES` (`guard`, `secretary`, `committee`, `admin`) | **YES** | `exitLogs` | Emits sanitized exit audit log metadata: `exitLogId`, `passId`, `childId`, `passCode`, `gateId`, `outcome`. |
| **5** | `CHILD_EXIT_DENIED` | [`router.ts#L834`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L834) | Post-DB Transaction Commit | `GATE_AND_SOS_EVENT_ROLES` (`guard`, `secretary`, `committee`, `admin`) | **YES** | `exitLogs` | Emits `exitLogId`, `childId`, `gateId`, `outcome: DENIED`, `reasonCode`. |
| **6** | `CHILD_SAFETY_SOS_TRIGGERED` | [`router.ts#L1293`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L1293) | Post-DB Transaction Commit | `GATE_AND_SOS_EVENT_ROLES` (`guard`, `secretary`, `committee`, `admin`) | **YES** | `activeAlerts` | Critical alert payload. Activates red lockdown banner and blocks subsequent gate exits for the missing child. |
| **7** | `CHILD_SAFETY_ALERT_ACKNOWLEDGED` | [`router.ts#L1447`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L1447) | Post-DB Update Commit | `GATE_AND_SOS_EVENT_ROLES` (`guard`, `secretary`, `committee`, `admin`) | **YES** | `activeAlerts` | Emits `alertId`, `acknowledgedBy`, `acknowledgedAt`. |
| **8** | `CHILD_SAFETY_ALERT_RESOLVED` | [`router.ts#L1590`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L1590) | Post-DB Update Commit | `GATE_AND_SOS_EVENT_ROLES` (`guard`, `secretary`, `committee`, `admin`) | **YES** | `activeAlerts` | Emits `alertId`, `status: RESOLVED`. Clears missing child lockdown banner. |

---

## 3. Forbidden Household Topics (Guard Role Segmented)

The following 6 backend Child Safety topics are restricted to `PROFILE_EVENT_ROLES = ['secretary', 'committee', 'admin']` + guardian. Security guards are strictly excluded by the backend broadcaster and the frontend hook `useSecurityChildSafetyRealtime`:

| Topic | Backend Role Policy | Guard Status | Privacy Justification |
| :--- | :--- | :--- | :--- |
| `CHILD_PROFILE_CREATED` | `PROFILE_EVENT_ROLES` | **BLOCKED** | Guards do not require notification when a family registers a child. |
| `CHILD_PROFILE_UPDATED` | `PROFILE_EVENT_ROLES` | **BLOCKED** | Guards do not receive profile modifications. |
| `CHILD_PROFILE_ARCHIVED`| `PROFILE_EVENT_ROLES` | **BLOCKED** | Household management only. |
| `CHILD_PICKUP_AUTHORIZED`| `PROFILE_EVENT_ROLES`| **BLOCKED** | Caretaker rosters are private to the household until a gate pass is generated. |
| `CHILD_PICKUP_UPDATED`  | `PROFILE_EVENT_ROLES` | **BLOCKED** | Private caretaker updates. |
| `CHILD_PICKUP_REVOKED`  | `PROFILE_EVENT_ROLES` | **BLOCKED** | Private caretaker updates. |

---

## 4. Invalidation Scopes & Coalescing Rules

In [`src/hooks/useSecurityChildSafetyRealtime.ts`](file:///d:/AAZIRA/AARIZO/src/hooks/useSecurityChildSafetyRealtime.ts), topics map directly to 3 granular cache invalidation scopes:
1. **`activePasses`**: Invalidated by `CHILD_GATE_PASS_GENERATED`, `CHILD_GATE_PASS_VERIFIED`, `CHILD_GATE_PASS_REVOKED`.
   - Triggers `childSafetyService.listGatePasses({ status: 'ACTIVE' })`.
2. **`exitLogs`**: Invalidated by `CHILD_GATE_PASS_VERIFIED`, `CHILD_EXIT_TRIGGERED`, `CHILD_EXIT_DENIED`.
   - Triggers `childSafetyService.listExitLogs({ limit: 50 })`.
3. **`activeAlerts`**: Invalidated by `CHILD_SAFETY_SOS_TRIGGERED`, `CHILD_SAFETY_ALERT_ACKNOWLEDGED`, `CHILD_SAFETY_ALERT_RESOLVED`.
   - Triggers `childSafetyService.listAlerts({ status: 'ACTIVE' })`.

### Coalescing Engine
When a verification occurs, the backend emits both `CHILD_EXIT_TRIGGERED` and `CHILD_GATE_PASS_VERIFIED` in rapid succession (within milliseconds).
`useSecurityChildSafetyRealtime` absorbs these events into a 50ms debounced coalescing buffer:
- The events are combined into scopes: `['activePasses', 'exitLogs']`.
- Only ONE batched fetch cycle is executed.
- In-flight request tracking (`inFlightRefreshRef`) ensures concurrent backend responses never race or overwrite newer state.

