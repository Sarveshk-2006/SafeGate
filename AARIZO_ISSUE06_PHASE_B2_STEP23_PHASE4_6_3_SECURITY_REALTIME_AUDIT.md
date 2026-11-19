# AARIZO — ISSUE-06 / B.2.3 / PHASE 4.6.3
# SECURITY COMMAND HUB REALTIME INTEGRATION — DEEP AUDIT REPORT

**Repository:** `D:\AAZIRA\AARIZO`  
**Phase:** Issue-06 / Phase B.2.3 — Subphase 4.6.3 (Security Command Hub Realtime Integration)  
**Audit Mode:** STRICTLY READ-ONLY Architectural & Gap Audit  
**Audit Date:** 2026-11-19  

---

## 1. EXECUTIVE AUDIT SUMMARY

An exhaustive, strictly read-only audit of the Security Command Hub, Guard Terminal, Child Gate Scanner, and supporting realtime services was conducted to map all existing realtime gaps, legacy subscriptions, localStorage dependencies, and client-broadcast antipatterns before implementing Subphase 4.6.3.

While Phase 4.6.2 successfully established server-authoritative realtime synchronization for the **Resident Portal**, the **Security and Guard portals** currently suffer from architectural split-brain:

1. **Client-Side Event Broadcast Antipattern:** `ChildGateScannerPage.tsx` invokes `realtimeService.publish()` directly from client code (`CHILD_EXIT_SCANNED`, `CHILD_SAFETY_UPDATED`), bypassing server-authoritative event generation.
2. **Deprecated Synchronous LocalStorage Reads & Writes:** `ChildGateScannerPage.tsx` and `SafetyCommandHub.tsx` (staff tabs) consume deprecated synchronous localStorage methods (`getSafetyAlerts()`, `getPickupQRs()`, `getPickupLogs()`, `verifyAndScanChildPickup()`, `addChildProfile()`, `addAuthorizedPickup()`).
3. **Broken Write Adapters:** In Phase 3, legacy write adapters in `safetyCommandEngine.ts` were disabled to fail closed (`LEGACY_SYNC_API_DEPRECATED`). In `SafetyCommandHub.tsx`, staff clicking "Add Child Profile" or "Add Pickup Person" triggers runtime exceptions.
4. **Wildcard & Polling Subscriptions:** `SecurityEmergencyTerminalPage.tsx` executes an aggressive 5000ms polling loop (`setInterval(loadData, 5000)`), and both `SecurityTerminalPage.tsx` and `ChildGateScannerPage.tsx` subscribe to wildcard `'*'` topics with brittle string matching instead of canonical topic filters.
5. **Role-Audience Asymmetry:** Guard roles are strictly unauthorized for child profile roster reads (`canListChildren: false`), but the backend `server/src/childSafety/router.ts` permits guards to receive gate events and SOS emergency alerts (`GATE_AND_SOS_EVENT_ROLES`). The frontend currently lacks a dedicated guard-scoped realtime subscriber.

---

## 2. COMPONENT INVENTORY & DEFECT CLASSIFICATION

### 2.1 `SafetyCommandHub.tsx` (Host Component)
- **Routes:** Rendered in `AdminSafetyCommandPage.tsx` (`/admin/safety-command`) and available to guards/admins.
- **Tabs:** `ONE_TAP_SOS`, `CHILD_SAFETY`, `COMMAND_CONSOLE`, `GATE_VERIFIER`.
- **Current State:**
  - When `isResidentRole`: Renders `<ResidentChildSafetyPanel />` (fully modernized and connected to SSE in Phase 4.6.2).
  - When `!isResidentRole` (Guard, Admin, Secretary):
    - Renders mock `children` from `safetyCommandEngine.getChildren()`.
    - Clicking "Add Child Profile" invokes `safetyCommandEngine.addChildProfile()`, which throws `LEGACY_SYNC_API_DEPRECATED`.
    - Clicking "Add Pickup Person" invokes `safetyCommandEngine.addAuthorizedPickup()`, which throws `LEGACY_SYNC_API_DEPRECATED`.
    - Clicking "Gate Verifier" invokes `safetyCommandEngine.verifyChildPickupAtGate()`, which returns hardcoded `{ isValid: false }`.
  - Subscriptions: Subscribes to mock `realTimeSync.subscribe('EMERGENCY_ALERTS')` and `CHILD_SAFETY_UPDATED`.
  - General Emergency SOS: Correctly delegates non-child emergencies to `safetyCommandEngine.triggerOneTapSOS()`, which must be preserved.

### 2.2 `ChildGateScannerPage.tsx` (Security Guard Route `/security/child-safety`)
- **Purpose:** Primary gate scanner interface for security officers verifying caretaker QR passes and enforcing missing-child gate lockdowns.
- **Current State:**
  - `loadData()` calls:
    - `childSafetyService.getSafetyAlerts(societyId)` (localStorage read)
    - `childSafetyService.getPickupQRs(societyId)` (localStorage read)
    - `childSafetyService.getPickupLogs(societyId)` (localStorage read)
  - `handleScanQR()`:
    - Calls `childSafetyService.verifyAndScanChildPickup()` (local validation, zero cryptographic bearer-token check, zero server transaction).
    - Dispatches client-side `realtimeService.publish({ type: 'CHILD_EXIT_SCANNED', ... })`.
  - `handleResolveAlert()`:
    - Calls `childSafetyService.resolveSafetyAlert()` (localStorage).
    - Dispatches client-side `realtimeService.publish({ type: 'CHILD_SAFETY_UPDATED', ... })`.
  - Realtime: Subscribes to `'*'` for `CHILD_SAFETY_UPDATED`, `CHILD_ALERT_TRIGGERED`, `CHILD_EXIT_SCANNED`, `EMERGENCY_ALERTS`.

### 2.3 `SecurityTerminalPage.tsx` (Security Portal Home `/security`, `/security/terminal`)
- **Purpose:** Main security terminal for visitor management and gate access.
- **Current State:**
  - Subscribes to `realtimeService.subscribe('*', ...)` filtering for `topic.startsWith('VISITOR_')`.
  - Completely detached from Child Safety gate passes, missing-child lockdowns, and SOS events.
  - Does not reflect emergency child alerts on the main guard dashboard.

### 2.4 `SecurityEmergencyTerminalPage.tsx` (Emergency Console `/security/emergency-command`)
- **Purpose:** Security officer incident dispatch terminal.
- **Current State:**
  - Executes 5-second polling loop (`setInterval(loadData, 5000)`).
  - Subscribes to `'*'` with regex/string inclusion (`event.type.includes('EMERGENCY') || event.type.includes('INCIDENT')`).
  - Reads exclusively from `safetyCommandService.getIncidents(societyId)`.

---

## 3. SECURITY & PRIVACY FINDINGS

| Finding ID | Severity | Component | Description |
| :--- | :---: | :--- | :--- |
| **SEC-463-01** | **CRITICAL** | `ChildGateScannerPage.tsx` | **Client-Side Event Spoofing:** Client directly calls `realtimeService.publish()` with fake gate exit events. Malicious clients can forge exit confirmations. |
| **SEC-463-02** | **CRITICAL** | `ChildGateScannerPage.tsx` | **Bypassed Cryptographic Token Verification:** Scanner uses deprecated `verifyAndScanChildPickup` without sending `bearerToken` to `POST /api/children/passes/verify`. Bypasses SHA-256 token verification and atomic database locks. |
| **SEC-463-03** | **HIGH** | `ChildGateScannerPage.tsx` | **Broken Missing-Child Lockdown:** Missing child alert checks are evaluated against local storage arrays rather than server-locked rows (`FOR UPDATE`), allowing gate passes to be consumed during an active emergency. |
| **SEC-463-04** | **HIGH** | `SafetyCommandHub.tsx` | **Runtime Crashes in Staff View:** Clicking "Add Child" or "Add Escort" throws uncaught `LEGACY_SYNC_API_DEPRECATED` ApiError exceptions in staff UI. |
| **SEC-463-05** | **MEDIUM** | `SecurityEmergencyTerminalPage.tsx` | **Aggressive Polling & Resource Churn:** Unconditional 5000ms `setInterval` polling drains mobile guard device batteries and degrades server performance. |
| **SEC-463-06** | **MEDIUM** | `ChildGateScannerPage.tsx` | **Wildcard SSE Subscription:** Subscribes to `'*'` and performs full re-fetch on unrelated events across the platform. |
| **SEC-463-07** | **LOW** | `SecurityTerminalPage.tsx` | **Missing Emergency Awareness:** Main guard gate terminal does not display active Child Safety SOS or Missing Child alerts. |

---

## 4. BACKEND REALTIME AUTHORIZATION & CONTRACT COMPLIANCE

Inspection of `server/src/childSafety/router.ts` confirms the backend event emission rules:

```ts
const PROFILE_EVENT_ROLES = ['secretary', 'committee', 'admin'];
const GATE_AND_SOS_EVENT_ROLES = ['guard', 'secretary', 'committee', 'admin'];
```

### Event Delivery Matrix to Guards:
1. **Delivered to Guards:**
   - `CHILD_GATE_PASS_GENERATED` (active pass available for verification)
   - `CHILD_GATE_PASS_VERIFIED` (pass consumed / gate opened)
   - `CHILD_GATE_PASS_REVOKED` (pass cancelled by parent / invalid for exit)
   - `CHILD_EXIT_TRIGGERED` (exit logged to audit trail)
   - `CHILD_EXIT_DENIED` (exit attempt blocked at gate)
   - `CHILD_SAFETY_SOS_TRIGGERED` (critical emergency / missing child lockdown)
   - `CHILD_SAFETY_ALERT_ACKNOWLEDGED` (responder assigned)
   - `CHILD_SAFETY_ALERT_RESOLVED` (child safe / lockdown lifted)
2. **Filtered Away from Guards (Server-Side Privacy):**
   - `CHILD_PROFILE_CREATED`, `CHILD_PROFILE_UPDATED`, `CHILD_PROFILE_ARCHIVED`
   - `CHILD_PICKUP_AUTHORIZED`, `CHILD_PICKUP_UPDATED`, `CHILD_PICKUP_REVOKED`

**Invariant:** Guard clients MUST NOT attempt to subscribe to or parse household child profile roster events. Security guard interfaces must consume ONLY the 8 authorized gate and SOS events.

---

## 5. RECONNECTION & SESSION SAFETY REQUIREMENTS

1. **Single Shared Security Subscription:**
   - A security session must maintain exactly one shared SSE listener on the active society.
   - Child components (`ChildGateScannerPage`, `SafetyCommandHub`) must receive invalidation nonces or shared context, avoiding duplicate SSE streams.
2. **Monotonic Sequencing:**
   - Sequential request IDs (`latestRequestIdRef`) must discard out-of-order network responses during gate verification or alert loading.
3. **50ms Invalidation Coalescing:**
   - Bursts of simultaneous events (e.g. `CHILD_GATE_PASS_VERIFIED` + `CHILD_EXIT_TRIGGERED`) must coalesce into a single refresh of the active gate logs.
4. **Clean Session Teardown:**
   - Switching accounts or logging out must immediately terminate active SSE streams, drop pending timers, and clear cached gate passes and alerts.

---

## 6. AUDIT CONCLUSION

The Security Command Hub and Child Gate Scanner currently operate on legacy, insecure, and disconnected client-side mechanisms. A structured, multi-step modernization is required to cut over security operations to canonical backend APIs and authenticated SSE streams while preserving general emergency SOS functionality.

