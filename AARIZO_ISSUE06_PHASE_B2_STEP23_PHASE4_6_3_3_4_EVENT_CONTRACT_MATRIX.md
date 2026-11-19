# AARIZO — ISSUE-06 — PHASE B.2 — STEP 2.3 — PHASE 4.6.3.3.4
# SECURITY COMMAND HUB — EVENT CONTRACT MATRIX

**Repository:** `D:\AAZIRA\AARIZO`  
**Phase:** Phase B.2 / Step 2.3 / Subphase 4.6.3.3.4  
**Date:** November 19, 2026  
**Status:** CANONICAL CONTRACT SPECIFICATION  

---

## 1. Overview

This document specifies the exact event contracts connecting backend emission points in `server/src/childSafety/router.ts`, `server/src/index.ts`, and `server/src/realtimeEngine.ts` to the staff-facing frontend subscriptions in `SafetyCommandHub.tsx`.

Zero fictitious or simulated event topics are permitted.

---

## 2. Canonical Backend Topic Definitions & Role Authorization Matrix

### 2.1 Child Safety Events (8 Security Topics)

Emitted by `server/src/childSafety/router.ts` using `emitChildSafetyEvent`:

| Event Topic | Backend Trigger Endpoint | Emitted Payload Fields | Backend Authorized Roles (`GATE_AND_SOS_EVENT_ROLES`) | Guard Authorized? | Command Hub Invalidation Target |
| :--- | :--- | :--- | :--- | :---: | :--- |
| **`CHILD_GATE_PASS_GENERATED`** | `POST /api/children/passes` (router.ts:742) | `passId`, `childId`, `passCode`, `validUntil`, `status` | `guard`, `secretary`, `committee`, `admin` (+ guardian) | ✅ YES | Active Gate Passes |
| **`CHILD_GATE_PASS_VERIFIED`** | `POST /api/children/passes/verify` (router.ts:984) | `passId`, `childId`, `exitLogId`, `status`, `exitOutcome` | `guard`, `secretary`, `committee`, `admin` (+ guardian) | ✅ YES | Active Gate Passes, Exit History |
| **`CHILD_GATE_PASS_REVOKED`** | `POST /api/children/passes/:id/revoke` (router.ts:1072) | `passId`, `childId`, `status`, `revokedAt`, `reason` | `guard`, `secretary`, `committee`, `admin` (+ guardian) | ✅ YES | Active Gate Passes |
| **`CHILD_EXIT_TRIGGERED`** | `POST /api/children/passes/verify` (router.ts:995) | `exitLogId`, `childId`, `passId`, `outcome`, `channel` | `guard`, `secretary`, `committee`, `admin` (+ guardian) | ✅ YES | Exit History |
| **`CHILD_EXIT_DENIED`** | `POST /api/children/passes/verify` (router.ts:907, 953) | `exitLogId`, `childId`, `reason`, `outcome` | `guard`, `secretary`, `committee`, `admin` (+ guardian) | ✅ YES | Exit History, Active Alerts |
| **`CHILD_SAFETY_SOS_TRIGGERED`** | `POST /api/children/sos` (router.ts:1295) | `alertId`, `emergencyIncidentId`, `childId`, `alertType`, `severity`, `status`, `location` | `guard`, `secretary`, `committee`, `admin` (+ guardian) | ✅ YES | Active Child Alerts, Child Roster |
| **`CHILD_SAFETY_ALERT_ACKNOWLEDGED`** | `POST /api/children/alerts/:id/acknowledge` (router.ts:1450) | `alertId`, `childId`, `status`, `acknowledgedAt` | `guard`, `secretary`, `committee`, `admin` (+ guardian) | ✅ YES | Active Child Alerts |
| **`CHILD_SAFETY_ALERT_RESOLVED`** | `POST /api/children/alerts/:id/resolve` (router.ts:1592) | `alertId`, `childId`, `status`, `resolvedAt` | `guard`, `secretary`, `committee`, `admin` (+ guardian) | ✅ YES | Active Child Alerts, Child Roster |

### 2.2 Prohibited Household Topics for Guards (Resident Privacy Barrier)

Emitted by `server/src/childSafety/router.ts` using `PROFILE_EVENT_ROLES`:

| Event Topic | Backend Trigger Endpoint | Backend Authorized Roles (`PROFILE_EVENT_ROLES`) | Guard Authorized? | Hub Guard Subscription |
| :--- | :--- | :--- | :---: | :--- |
| `CHILD_PROFILE_CREATED` | `POST /api/children` (router.ts:241) | `secretary`, `committee`, `admin` (+ guardian) | ❌ **DENIED** | **BLOCKED** from guard subscription |
| `CHILD_PROFILE_UPDATED` | `PATCH /api/children/:id` (router.ts:321) | `secretary`, `committee`, `admin` (+ guardian) | ❌ **DENIED** | **BLOCKED** from guard subscription |
| `CHILD_PROFILE_ARCHIVED` | `DELETE /api/children/:id` (router.ts:401) | `secretary`, `committee`, `admin` (+ guardian) | ❌ **DENIED** | **BLOCKED** from guard subscription |
| `CHILD_PICKUP_AUTHORIZED` | `POST /api/children/:id/pickups` (router.ts:511) | `secretary`, `committee`, `admin` (+ guardian) | ❌ **DENIED** | **BLOCKED** from guard subscription |
| `CHILD_PICKUP_UPDATED` | `PATCH /api/children/:id/pickups/:pId` (router.ts:581) | `secretary`, `committee`, `admin` (+ guardian) | ❌ **DENIED** | **BLOCKED** from guard subscription |
| `CHILD_PICKUP_REVOKED` | `DELETE /api/children/:id/pickups/:pId` (router.ts:651) | `secretary`, `committee`, `admin` (+ guardian) | ❌ **DENIED** | **BLOCKED** from guard subscription |

> [!IMPORTANT]
> Security guards must never receive profile or pickup events. When `SafetyCommandHub` is viewed by a guard (`isGuardRole === true`), the child roster is hidden and guarded by privacy notices.

---

### 2.3 General Emergency Topics

Emitted by `server/src/index.ts` and `server/src/realtimeEngine.ts`:

| Event Topic | Backend Trigger Endpoint | Emitted Payload Fields | Backend Authorized Roles | Guard Authorized? | Command Hub Invalidation Target |
| :--- | :--- | :--- | :--- | :---: | :--- |
| **`EMERGENCY_ALERTS`** | `POST /api/emergency-incidents` (index.ts:2322) | Full `EmergencyIncident` object | `guard`, `secretary`, `committee`, `admin` (+ resident caller) | ✅ YES | General Emergency Incidents Feed |
| **`EMERGENCY_INCIDENT_RESOLVED`** | `PATCH /api/emergency-incidents/:id/resolve` (index.ts:2350) | Full `EmergencyIncident` object with `dispatchStatus: 'RESOLVED'` | `guard`, `secretary`, `committee`, `admin` | ✅ YES | General Emergency Incidents Feed |
| **`EMERGENCY_INCIDENT_CREATED`** | `POST /api/children/sos` (router.ts:1311) | `id`, `incidentType`, `severity`, `location`, `dispatchStatus` | `guard`, `secretary`, `committee`, `admin` | ✅ YES | General Emergency Incidents Feed |

---

## 3. Invalidation Mapping Matrix (Event to Frontend Resource)

When an event arrives via SSE, the hub must trigger backend-authoritative reloads according to this mapping:

```
┌──────────────────────────────────────┐     ┌──────────────────────────────────────────────┐
│ Incoming SSE Topic                   │ ──> │ Target Invalidation Callback in Hub          │
├──────────────────────────────────────┤     ├──────────────────────────────────────────────┤
│ CHILD_SAFETY_SOS_TRIGGERED           │ ──> │ loadAuthoritativeAlerts()                    │
│ CHILD_SAFETY_ALERT_ACKNOWLEDGED      │ ──> │ loadAuthoritativeAlerts()                    │
│ CHILD_SAFETY_ALERT_RESOLVED          │ ──> │ loadAuthoritativeAlerts(), loadAuthoritativeChildren() │
│ CHILD_EXIT_DENIED                    │ ──> │ loadAuthoritativeAlerts()                    │
│ CHILD_GATE_PASS_GENERATED            │ ──> │ childSafetyService.onCacheInvalidated        │
│ CHILD_GATE_PASS_VERIFIED             │ ──> │ childSafetyService.onCacheInvalidated        │
│ CHILD_GATE_PASS_REVOKED              │ ──> │ childSafetyService.onCacheInvalidated        │
│ CHILD_EXIT_TRIGGERED                 │ ──> │ childSafetyService.onCacheInvalidated        │
│ EMERGENCY_ALERTS                     │ ──> │ loadGeneralIncidents()                       │
│ EMERGENCY_INCIDENT_RESOLVED          │ ──> │ loadGeneralIncidents()                       │
│ EMERGENCY_INCIDENT_CREATED           │ ──> │ loadGeneralIncidents()                       │
└──────────────────────────────────────┘     └──────────────────────────────────────────────┘
```

---

## 4. Synthesis & Section Closure

- **BLOCKERS:** None.
- **SECURITY RISKS:** Subscribing guards to household topics violates resident privacy. Guard role must remain pinned strictly to the 8 security topics.
- **REQUIRED IMPLEMENTATION:** Wire `useSecurityChildSafetyRealtime` for the 8 Child Safety topics and `realtimeService.subscribe` for the 3 General Emergency topics.
- **REQUIRED TESTS:** Topic validation, role denial, cross-society rejection, Strict Mode cleanup.
- **OUT-OF-SCOPE ITEMS:** Modifying backend event definitions or creating a secondary SSE transport.

