# AARIZO — ISSUE-06 — PHASE B.2 — STEP 2.3 — SUBPHASE 4.6.3.3.3
# Child SOS & Unified Incident Console Regression & Test Plan

**Repository:** `D:\AAZIRA\AARIZO`  
**Phase:** Issue-06 / Phase B.2 / Step 2.3 / Subphase 4.6.3.3.3  
**Document:** Regression Safeguards, Test Plan, & Risk Analysis  
**Mode:** STRICTLY READ-ONLY  
**Date:** 2026-11-19  

---

## 1. Executive Summary

Subphase 4.6.3.3.3 transforms the simulated emergency and Child Safety incident feeds in `SafetyCommandHub.tsx` into backend-authoritative, live telemetry consoles. Because this touches core emergency and alerting interfaces, strict regression boundaries must be maintained to safeguard existing resident workflows, gate pass operations, visitor access, and security scanner functionality.

This document establishes the required regression invariants, the targeted test suite specifications, and the high-risk failure modes that must be tested prior to phase sign-off.

---

## 2. Regression Constraints & Preserved Invariants

The following existing, closed, and verified subsystems must remain completely unmodified and functional:

1. **Resident Child SOS (Phase 4.5):**
   - `<ResidentChildSosModal />` and `<ResidentChildAlertsSection />` must continue operating with zero changes to their props, state, or services.
   - Resident child safety panel (`<ResidentChildSafetyPanel />`) rendering and guardianship boundaries must remain intact.
2. **Resident Realtime Integration (Phase 4.6.2):**
   - `useChildSafetyRealtime.ts` SSE listeners, tenant society filtering, and resident alert invalidation must remain undisturbed.
3. **Security Realtime Hook (Phase 4.6.3.1):**
   - `useSecurityChildSafetyRealtime.ts` core invariants (guard role allowlist, 8 security topics, deduplication window, 50ms coalescing) must be consumed as-is without breaking changes.
4. **Child Gate Scanner Modernization (Phase 4.6.3.2):**
   - `ChildGateScannerPage.tsx` must remain untouched; its consumption of `childSafetyService.verifyGatePass(...)` and lockdown on active missing alerts must continue operating cleanly.
5. **Staff Child Profile & Escort Management (Phase 4.6.3.3.1):**
   - `executeStaffCreateChildProfile`, `executeStaffAddAuthorizedPickup`, and `executeStaffRevokeAuthorizedPickup` must remain fully functional.
6. **Gate Pass Generation & Scanner Redirection (Phase 4.6.3.3.2):**
   - `executeStaffGenerateGatePass`, the one-time SVG QR modal, and the `data-testid="gate-verifier-redirection-panel"` linking to `/security/child-safety` must remain untouched.
7. **Visitor Management & General Emergency Workflows:**
   - Visitor passes, domestic worker passes, delivery intelligence, and general non-child emergencies (Medical, Fire, Lift, Security, Electrical) must continue operating cleanly.

---

## 3. Targeted Test Plan for Subphase 4.6.3.3.3

The test file `tests/issue06_b23_safety_command_hub.test.ts` will be extended with dedicated test suites covering all Subphase 4.6.3.3.3 controllers and UI elements:

### 3.1 Suite 1: Pure Controller Tests
- **Staff Child SOS Trigger (`executeStaffTriggerChildSos`):**
  - Secretary triggers Child Safety SOS with valid childId and location -> invokes `childSafetyService.triggerSos` with normalized payload.
  - Guard triggers Child Safety SOS for unidentified child on premises -> invokes `childSafetyService.triggerSos` without `childId`.
  - Committee role triggers Child Safety SOS -> allowed.
  - Admin role triggers Child Safety SOS -> allowed.
  - Resident role calling staff controller -> rejected with `Forbidden`.
  - Unsupported `security` alias or unauthenticated caller -> rejected with `Forbidden`.
  - Empty or missing `location` -> fails validation before calling API.
  - Duplicate active SOS (HTTP 409 `DUPLICATE_ACTIVE_SOS_ALERT`) -> cleanly surfaces error message without fake success.
- **Staff Alert Acknowledgment (`executeStaffAcknowledgeChildAlert`):**
  - Guard acknowledges active alert -> invokes `childSafetyService.acknowledgeAlert(alertId)`.
  - Secretary acknowledges active alert -> allowed.
  - Committee acknowledges active alert -> allowed.
  - Resident calling staff acknowledge -> rejected with `Forbidden`.
  - Unsupported `security` alias -> rejected with `Forbidden`.
  - Concurrent state change (HTTP 409) -> propagated without corrupted state.
- **Staff Alert Resolution (`executeStaffResolveChildAlert`):**
  - Secretary resolves alert with `resolutionNotes` -> invokes `childSafetyService.resolveAlert(alertId, { status: 'RESOLVED', resolutionNotes })`.
  - Guard resolves alert as `FALSE_ALARM` with notes -> invokes `childSafetyService.resolveAlert(alertId, { status: 'FALSE_ALARM', resolutionNotes })`.
  - Missing or empty `resolutionNotes` -> fails validation before calling API.
  - Resident calling staff resolve -> rejected with `Forbidden`.
  - Unsupported `security` alias -> rejected with `Forbidden`.
- **General Emergency Resolution (`executeStaffResolveGeneralIncident`):**
  - Guard resolves general incident -> invokes `apiClient.resolveEmergencyIncidentStrict(id)`.
  - Committee role attempting to resolve general emergency -> rejected with `Forbidden`.

### 3.2 Suite 2: UI Markup & Rendering Boundaries
- **Incident Console Feed Rendering:**
  - Staff user (guard/secretary/admin) rendering `COMMAND_CONSOLE` renders both Child Safety alerts and general emergency incidents.
  - Child Safety alerts render alert type badges (`MISSING_CHILD`, etc.) and live status badges (`ACTIVE`, `ACKNOWLEDGED`, `RESOLVED`).
  - Active alert displays "Acknowledge Alert" button.
  - Acknowledged alert displays "Resolve Alert" button.
  - General emergency incident displays "Mark Resolved" button for guard/admin, but hidden for committee.
- **Decommissioning Verification:**
  - Verify `safetyCommandEngine.triggerOneTapSOS`, `safetyCommandEngine.acknowledgeIncident`, `safetyCommandEngine.assignResponder`, and `safetyCommandEngine.resolveIncident` are never called by the hub.
  - Verify zero `realtimeService.publish` calls are made.
- **Realtime Reactive Invalidation:**
  - Verify `useSecurityChildSafetyRealtime` is active for staff sessions and reloads child alerts upon receiving `CHILD_SAFETY_SOS_TRIGGERED`, `CHILD_SAFETY_ALERT_ACKNOWLEDGED`, and `CHILD_SAFETY_ALERT_RESOLVED`.

---

## 4. Full Repository Regression Matrix

To guarantee repository-wide health upon implementation, the following test matrix must execute cleanly:

| Test Command | Scope | Target Pass Threshold |
|---|---|---|
| `npx jest tests/issue06_b23_safety_command_hub.test.ts` | Focused Safety Command Hub test suite | 100% Pass (all tests passing) |
| `npx jest --runInBand "tests/issue06_b23_safety_command_hub\|tests/issue06_b23_child_gate_scanner\|tests/issue06_b23_security_realtime_hook\|tests/issue06_b23_child_safety_data_layer"` | Combined Phase 4.6.3 Security suites | 100% Pass |
| `npx jest --runInBand "tests/issue06_b23_phase4_4_resident_gate_passes\|tests/issue06_b23_phase4_5_resident_child_sos"` | Resident Pass & SOS suites | 100% Pass |
| `npx tsc -b` | Project-wide TypeScript build check | Zero errors, exit code 0 |
| `npm run build` | Full Vite client production build | Clean build, exit code 0 |
| `npx jest --runInBand` | Full repository offline test suite | 39 test suites passed, 609+ tests passed |

---

## 5. Risk Assessment & Out-of-Scope Items

### 5.1 Blockers
- **None.** All necessary backend endpoints (`POST /api/children/sos`, `GET /api/children/alerts`, `POST /api/children/alerts/:id/acknowledge`, `POST /api/children/alerts/:id/resolve`, `GET /api/emergency-incidents`, `PATCH /api/emergency-incidents/:id/resolve`) exist, are fully tested, and are operational.

### 5.2 High-Risk Items
1. **Model Confusion (Domain Bleed):** Conflating `ChildSafetyAlert` with `EmergencyIncident` would risk trying to acknowledge a general incident through the child alert endpoint or vice-versa.  
   *Mitigation:* Keep state collections distinct (`childAlerts` vs `generalIncidents`) and dispatch to domain-specific pure controllers.
2. **Missing `resolutionNotes` UI Drop:** Submitting child alert resolution without `resolutionNotes` returns HTTP 400.  
   *Mitigation:* Mandatory modal with required validation before calling backend.
3. **Double-Submit / Concurrent Mutation:** Staff clicking Acknowledge or Resolve multiple times under network latency.  
   *Mitigation:* In-flight mutation locking on specific alert IDs.

### 5.3 Implementation Sequence
1. Step 1: Add typed wrapper `resolveEmergencyIncidentStrict` in `src/services/apiClient.ts`.
2. Step 2: Implement pure controllers in `SafetyCommandHub.tsx` (`executeStaffTriggerChildSos`, `executeStaffAcknowledgeChildAlert`, `executeStaffResolveChildAlert`, `executeStaffResolveGeneralIncident`).
3. Step 3: Integrate `useSecurityChildSafetyRealtime` in `SafetyCommandHub.tsx`.
4. Step 4: Add resolution modal dialog for Child Safety alerts with mandatory `resolutionNotes`.
5. Step 5: Modernize Staff SOS trigger flow for Child Safety to use canonical backend.
6. Step 6: Modernize `COMMAND_CONSOLE` incident feed to render real child alerts and general emergencies.
7. Step 7: Decommission all calls to `safetyCommandEngine` write methods and `realtimeService.publish`.
8. Step 8: Update and run test suites.

### 5.4 Out-of-Scope Items
- Adding new columns to PostgreSQL tables `child_safety_alerts` or `emergency_incidents` (backend schema is frozen).
- Altering the resident portal experience (`<ResidentChildSafetyPanel />`).
- Redesigning the Visitor Management or Gate Scanner terminal interfaces.
- Phase 4.6.3.3.4 or subsequent phases.

