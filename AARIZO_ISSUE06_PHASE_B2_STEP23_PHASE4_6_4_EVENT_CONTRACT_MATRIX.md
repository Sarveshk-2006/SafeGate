# AARIZO — ISSUE-06 — PHASE B.2 — STEP 2.3 — PHASE 4.6.4
# CHILD SAFETY REALTIME EVENT CONTRACT MATRIX

**Audit Date:** 2026-11-19  
**Execution Mode:** STRICTLY READ-ONLY  
**Source of Truth:** [`server/src/childSafety/router.ts`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts), [`server/src/realtimeEngine.ts`](file:///d:/AAZIRA/AARIZO/server/src/realtimeEngine.ts)

---

## 1. Overview
The AARIZO backend publishes 14 canonical Child Safety SSE event topics via `emitChildSafetyEvent` in [`server/src/childSafety/router.ts`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts).
All events are strictly scoped by `societyId` and enforced by `EventAudiencePolicy` (`allowedRoles` and optional `targetUserIds`).
Events are recorded to the database transactional outbox (`realtimeEngine.recordOutboxEvent`) and dispatched across established SSE connections only AFTER database transactions commit.

---

## 2. Exhaustive Event Contract & Audience Matrix

| # | Event Topic | Backend Emitter Line | Transaction Boundary | Allowed Roles (`audience.allowedRoles`) | Admin Eligible? | Scanner Eligible? | Invalidation Scope | Sensitive Field Protection |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | `CHILD_PROFILE_CREATED` | [`router.ts#L1854`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L1854) | Post-DB Insert | `PROFILE_EVENT_ROLES` (`secretary`, `committee`, `admin`) + Guardian | **YES** | **NO** (Guard blocked) | `children` | Exposes only `id`, `flatNumber`, `status`. Zero ID proof or medical notes. |
| **2** | `CHILD_PROFILE_UPDATED` | [`router.ts#L2086`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L2086) | Post-DB Update | `PROFILE_EVENT_ROLES` (`secretary`, `committee`, `admin`) + Guardian | **YES** | **NO** (Guard blocked) | `children` | Exposes only `id`, `flatNumber`, `status`. Zero ID proof or medical notes. |
| **3** | `CHILD_PROFILE_ARCHIVED` | [`router.ts#L2152`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L2152) | Post-DB Update | `PROFILE_EVENT_ROLES` (`secretary`, `committee`, `admin`) + Guardian | **YES** | **NO** (Guard blocked) | `children` | Exposes only `id`, `flatNumber`, `status: ARCHIVED`. |
| **4** | `CHILD_PICKUP_AUTHORIZED` | [`router.ts#L2288`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L2288) | Post-DB Insert | `PROFILE_EVENT_ROLES` (`secretary`, `committee`, `admin`) + Guardian | **YES** | **NO** (Guard blocked) | `pickups`, `children` | Exposes `id`, `childId`, `name`, `status`. Never includes `idProofNumber` or doc hash. |
| **5** | `CHILD_PICKUP_UPDATED` | [`router.ts#L2491`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L2491) | Post-DB Update | `PROFILE_EVENT_ROLES` (`secretary`, `committee`, `admin`) + Guardian | **YES** | **NO** (Guard blocked) | `pickups`, `children` | Exposes `id`, `childId`, `name`, `status`. Never includes `idProofNumber` or doc hash. |
| **6** | `CHILD_PICKUP_REVOKED` | [`router.ts#L2574`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L2574) | Post-DB Update | `PROFILE_EVENT_ROLES` (`secretary`, `committee`, `admin`) + Guardian | **YES** | **NO** (Guard blocked) | `pickups`, `children` | Exposes `id`, `childId`, `status: REVOKED`. |
| **7** | `CHILD_GATE_PASS_GENERATED` | [`router.ts#L379`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L379) | Post-DB Insert | `GATE_AND_SOS_EVENT_ROLES` (`guard`, `secretary`, `committee`, `admin`) + Guardian | **YES** | **YES** | `passes`, `activePasses` | Exposes `id`, `childId`, `passCode`, `validFrom`, `validUntil`. **NEVER** includes `bearerToken`, `qrPayload`, or `tokenHash`. |
| **8** | `CHILD_GATE_PASS_VERIFIED` | [`router.ts#L810`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L810) | Post-DB Transaction | `GATE_AND_SOS_EVENT_ROLES` (`guard`, `secretary`, `committee`, `admin`) + Guardian | **YES** | **YES** | `passes`, `activePasses`, `exitLogs` | Exposes `passId`, `childId`, `status`. Zero raw tokens. |
| **9** | `CHILD_GATE_PASS_REVOKED` | [`router.ts#L1018`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L1018) | Post-DB Update | `GATE_AND_SOS_EVENT_ROLES` (`guard`, `secretary`, `committee`, `admin`) + Guardian | **YES** | **YES** | `passes`, `activePasses` | Exposes `passId`, `childId`, `status: REVOKED`. Zero raw tokens. |
| **10** | `CHILD_EXIT_TRIGGERED` | [`router.ts#L795`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L795) | Post-DB Transaction | `GATE_AND_SOS_EVENT_ROLES` (`guard`, `secretary`, `committee`, `admin`) + Guardian | **YES** | **YES** | `exitLogs` | Exposes sanitized exit audit log metadata. |
| **11** | `CHILD_EXIT_DENIED` | [`router.ts#L834`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L834) | Post-DB Transaction | `GATE_AND_SOS_EVENT_ROLES` (`guard`, `secretary`, `committee`, `admin`) + Guardian | **YES** | **YES** | `exitLogs` | Exposes denial reason and gate metadata. |
| **12** | `CHILD_SAFETY_SOS_TRIGGERED` | [`router.ts#L1293`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L1293) | Post-DB Transaction | `GATE_AND_SOS_EVENT_ROLES` (`guard`, `secretary`, `committee`, `admin`) + Guardian | **YES** | **YES** | `alerts`, `activeAlerts` | Critical lockdown payload; triggers immediate red broadcast banner. |
| **13** | `CHILD_SAFETY_ALERT_ACKNOWLEDGED` | [`router.ts#L1447`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L1447) | Post-DB Update | `GATE_AND_SOS_EVENT_ROLES` (`guard`, `secretary`, `committee`, `admin`) + Guardian | **YES** | **YES** | `alerts`, `activeAlerts` | Exposes `alertId`, `acknowledgedBy`, `acknowledgedAt`. |
| **14** | `CHILD_SAFETY_ALERT_RESOLVED` | [`router.ts#L1590`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L1590) | Post-DB Update | `GATE_AND_SOS_EVENT_ROLES` (`guard`, `secretary`, `committee`, `admin`) + Guardian | **YES** | **YES** | `alerts`, `activeAlerts` | Clears critical missing child lockdown banner. |

---

## 3. General Emergency Cross-Topic Contract

| Event Topic | Backend Emitter Line | Transaction Boundary | Allowed Roles | Invalidation Target | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `EMERGENCY_INCIDENT_CREATED` | [`router.ts#L1309`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L1309) | Post-DB Transaction | `GATE_AND_SOS_EVENT_ROLES` | Incident Consoles | Broadcast when a Child Safety SOS creates a synchronized general `EmergencyIncident`. |

---

## 4. Security & Sensitive Field Sanitization Verification
1. **Bearer Tokens and QR Payloads:**
   - Emitters for `CHILD_GATE_PASS_GENERATED` and `CHILD_GATE_PASS_VERIFIED` emit strictly `passCode` and `id`.
   - `bearerToken`, `qrPayload`, and `tokenHash` are strictly scrubbed from payloads.
2. **Identity Document Numbers:**
   - Emitters for `CHILD_PICKUP_AUTHORIZED` and `CHILD_PICKUP_UPDATED` never transmit `idProofNumber` or identity document hashes.
3. **Resident Privacy Separation:**
   - Security guards are omitted from `PROFILE_EVENT_ROLES`. Guards never receive household child roster creation or pickup updates.
   - Society Administrators and Secretaries are present in both `PROFILE_EVENT_ROLES` and `GATE_AND_SOS_EVENT_ROLES`, providing full authoritative visibility.

---

## 5. Invalidation & Coalescing Mapping

### 5.1 Admin Child Safety Desk Mapping
When the Admin Child Safety desk receives an event, it triggers coalesced refetches matching the affected tabs:
- **`CHILD_PROFILE_*` / `CHILD_PICKUP_*`:** Refetches `childSafetyService.listChildren()`.
- **`CHILD_GATE_PASS_*` / `CHILD_EXIT_*`:** Refetches `childSafetyService.listExitLogs({ limit: 50 })`.
- **`CHILD_SAFETY_ALERT_*`:** Refetches `childSafetyService.listAlerts({ status: 'ACTIVE' })`.

### 5.2 Gate Scanner Mapping
The Gate Scanner terminal maintains subscriptions to the 8 security topics via `useSecurityChildSafetyRealtime`:
- **Pass Topics (`CHILD_GATE_PASS_*`):** Coalesced refresh of `childSafetyService.listGatePasses({ status: 'ACTIVE' })`.
- **Exit Topics (`CHILD_EXIT_*`):** Coalesced refresh of `childSafetyService.listExitLogs({ limit: 50 })`.
- **Alert Topics (`CHILD_SAFETY_ALERT_*`):** Coalesced refresh of `childSafetyService.listAlerts({ status: 'ACTIVE' })`.

