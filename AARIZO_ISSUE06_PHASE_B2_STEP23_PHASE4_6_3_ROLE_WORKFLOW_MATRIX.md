# AARIZO — ISSUE-06 / B.2.3 / PHASE 4.6.3
# SECURITY ROLE & WORKFLOW SPECIFICATION MATRIX

**Repository:** `D:\AAZIRA\AARIZO`  
**Phase:** Issue-06 / Phase B.2.3 — Subphase 4.6.3 (Security Command Hub Realtime Integration)  
**Document:** Cross-Role Security Workflow & UI Invariant Specification  
**Date:** 2026-11-19  

---

## 1. CROSS-ROLE CAPABILITY & ACCESS MATRIX

| Role | Gate Pass Scanning & Verification | Active Pass Roster Visibility | Exit Audit Log Visibility | Trigger Child SOS | Acknowledge & Resolve SOS | View Full Family Child Roster | General Emergency SOS Console |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Resident** | NO (Holder of Pass) | Own Children Only | Own Children Only | YES (Own Child) | NO | YES (Own Flat) | YES (Trigger Only) |
| **Security Guard** | **YES** (`POST /passes/verify`) | **YES** (Active Only) | **YES** (Society Scope) | **YES** (Any Child) | **YES** (`/alerts/:id/*`) | **NO** (Privacy Protected) | **YES** (Manage & Respond) |
| **Secretary / Admin**| **YES** (Admin Verification) | **YES** (All Passes) | **YES** (Society Scope) | **YES** (Society Scope) | **YES** (Society Scope) | **YES** (Desk Registration) | **YES** (Full Dispatch) |
| **Committee** | NO | NO | YES (Audit Only) | YES | YES | YES (Audit Only) | YES (View Only) |

---

## 2. DETAILED SECURITY WORKFLOW SPECIFICATIONS

### Workflow 1: Realtime Gate Verification (Online QR Token / Bearer Token)
1. **Pass Presentation:** Caretaker or permitted solo child presents mobile QR code at Gate #1.
2. **Scanner Intake:** Guard scans QR code with camera or inputs alphanumeric bearer payload in `ChildGateScannerPage`.
3. **Cryptographic Validation:** Guard terminal calls canonical `childSafetyService.verifyGatePass({ qrPayload })`.
4. **Backend Authorization:** Server hashes bearer token with SHA-256, locks child profile (`FOR UPDATE`), checks active missing-child alerts, checks pass expiry and usage count.
5. **Atomic Clearance:** If valid, server marks pass `USED`, transitions child to `OUT_OF_SOCIETY`, writes `ChildExitLog (ALLOWED)`, and broadcasts `CHILD_GATE_PASS_VERIFIED` + `CHILD_EXIT_TRIGGERED`.
6. **Guard UI Feedback:** Guard terminal shows large green banner: `PICKUP AUTHORIZED & PERMITTED`, display caretaker name, child name, flat number, and guardian phone.
7. **Cross-Terminal Sync:** Guard #2 at Gate #2 immediately sees the pass marked `USED` and the exit log added to the feed.

### Workflow 2: Realtime Gate Exit Denial & Lockdown Enforcement
1. **Scenario A (Expired / Revoked Pass):** Caretaker presents expired or revoked pass.
   - Backend returns `409 Conflict (PASS_EXPIRED / PASS_REVOKED)`, writes `ChildExitLog (DENIED)`, and broadcasts `CHILD_EXIT_DENIED`.
   - Guard terminal shows red denial banner: `PICKUP DENIED / BLOCKED: Gate pass has expired`.
2. **Scenario B (Missing-Child Lockdown Active):** Resident triggers emergency SOS for missing child.
   - Caretaker attempts exit with a previously valid pass.
   - Server checks active `MISSING_CHILD` alert, immediately denies gate clearance (`409 CHILD_MISSING_ALERT_BLOCKED`), writes denial log, and alerts security command.
   - Guard terminal sounds urgent chime and displays: `🚨 EXIT BLOCKED: ACTIVE MISSING CHILD ALERT. HOLD PERSON AT GATE`.

### Workflow 3: Emergency SOS & Missing Child Alert Lifecycle
1. **Trigger:** Resident or Guard triggers child SOS via `ResidentChildSosModal` or `SafetyCommandHub`.
2. **Realtime Broadcast:** Backend emits `CHILD_SAFETY_SOS_TRIGGERED` to `GATE_AND_SOS_EVENT_ROLES`.
3. **Guard Terminal Reaction:**
   - `ChildGateScannerPage` and `SecurityTerminalPage` mount pulsing red emergency banner.
   - Audible single alert chime plays.
   - Displays child name, flat number, last seen location, and emergency contact details.
4. **Acknowledgement:** Officer Ramesh clicks "Acknowledge Incident".
   - Client sends `POST /api/children/alerts/:id/acknowledge`.
   - Server emits `CHILD_SAFETY_ALERT_ACKNOWLEDGED`.
   - All terminals update banner: `RESPONDING — Officer Ramesh Shinde attending on site`.
5. **Resolution:** Child is located safe. Officer or Secretary enters resolution notes and clicks "Resolve Alert".
   - Client sends `POST /api/children/alerts/:id/resolve`.
   - Server restores child status to `SAFE` and emits `CHILD_SAFETY_ALERT_RESOLVED`.
   - Emergency banner automatically clears across all guard screens.

### Workflow 4: General Emergency Incident Preservation (Non-Child SOS)
1. Resident triggers Medical, Fire, Security, Lift, or Electrical SOS.
2. `safetyCommandEngine.triggerOneTapSOS` dispatches `EMERGENCY_ALERTS` without touching Child Safety tables or endpoints.
3. Security officers view and manage the incident in `SafetyCommandHub` (Console tab) and `SecurityEmergencyTerminalPage`.
4. Zero regression to non-child emergency workflows.

### Workflow 5: Multi-Guard Concurrency & Race Condition Safety
1. **Double-Spend Prevention:** If two caretakers present the same one-time pass at different gates simultaneously, PostgreSQL conditional consumption (`updateMany ... WHERE currentUses = pass.currentUses`) ensures exactly ONE gate succeeds (200 OK) and the second receives `409 PASS_ALREADY_CONSUMED`.
2. **Out-of-Order Network Guarding:** Rapid successive scans use monotonic sequence IDs (`reqSeq === listRequestSeqRef.current`) so older slow responses cannot overwrite fresh scan results.
3. **50ms Refresh Coalescing:** If multiple passes are verified across multiple gates within 50ms, the recent gate logs feed coalesces into a single batched query.

### Workflow 6: Offline & Reconnection Handling at the Gate
1. **Network Drop:** Guard device loses Wi-Fi / cellular signal.
   - Badge changes to `Sync Offline` (`data-connection-state="OFFLINE"`).
   - In accordance with safety rules: **Gate clearance is fail-closed.** Cached passes cannot authorize gate exit without server confirmation.
2. **Reconnection Recovery:** Network reconnects.
   - SSE connection transitions `RECONNECTING` -> `CONNECTED`.
   - Badge updates to `Live Sync Connected`.
   - Terminal automatically executes `onReconnect`: re-fetches active society gate passes, active emergency alerts, and recent gate logs.

