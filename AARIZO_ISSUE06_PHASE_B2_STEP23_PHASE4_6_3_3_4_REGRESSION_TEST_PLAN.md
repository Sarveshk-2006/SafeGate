# AARIZO — ISSUE-06 — PHASE B.2 — STEP 2.3 — PHASE 4.6.3.3.4
# SECURITY COMMAND HUB — REGRESSION TEST PLAN

**Repository:** `D:\AAZIRA\AARIZO`  
**Phase:** Phase B.2 / Step 2.3 / Subphase 4.6.3.3.4  
**Date:** November 19, 2026  
**Status:** TEST SPECIFICATION & REGRESSION SUITE DESIGN  

---

## 1. Test Architecture Overview

This test plan defines the automated test suite required to verify Phase 4.6.3.3.4 (*Security Command Hub Realtime Integration*). Tests will be placed in `tests/issue06_b23_safety_command_hub.test.ts` (adding a dedicated suite 11) or a companion test file `tests/issue06_b23_safety_hub_realtime.test.ts`.

Testing covers:
1. Pure subscription controller tests.
2. Direct React Hook integration tests (`renderHook`).
3. SSR & Component Mount tests with simulated SSE events.
4. Negative security & isolation tests.

---

## 2. Test Suite Specifications

### Suite 11: Security Command Hub Realtime Integration

#### Test 11.1: Exact Topic Allowlist Verification
- **Objective:** Verify that `SafetyCommandHub` subscribes only to authorized topics.
- **Assertion:**
  - Mock `realtimeService.subscribe`.
  - Mount `SafetyCommandHub` as a guard user.
  - Assert that `realtimeService.subscribe` was called for all 8 security Child Safety topics and the 3 general emergency topics (`EMERGENCY_ALERTS`, `EMERGENCY_INCIDENT_RESOLVED`, `EMERGENCY_INCIDENT_CREATED`).
  - Assert that `realtimeService.subscribe` was **NEVER** called for `CHILD_PROFILE_*` or `CHILD_PICKUP_*` topics.

#### Test 11.2: Single Authenticated SSE Connection Invariant
- **Objective:** Ensure mounting `SafetyCommandHub` does not create a new or secondary SSE connection.
- **Assertion:**
  - Verify `realtimeService.connect` is NOT called by `SafetyCommandHub` (it is owned exclusively by `AuthContext`).
  - Verify zero calls to `new EventSource`.

#### Test 11.3: Reactive Alert Invalidation on SOS Trigger
- **Objective:** Ensure incoming `CHILD_SAFETY_SOS_TRIGGERED` triggers `childSafetyService.listAlerts`.
- **Assertion:**
  - Trigger mock message for `CHILD_SAFETY_SOS_TRIGGERED`.
  - Advance timers (50ms debouncer).
  - Verify `childSafetyService.listAlerts` is invoked and the new alert is fetched.

#### Test 11.4: Reactive Alert Invalidation on Alert Acknowledgment & Resolution
- **Objective:** Ensure incoming `CHILD_SAFETY_ALERT_ACKNOWLEDGED` and `CHILD_SAFETY_ALERT_RESOLVED` trigger alert refresh.
- **Assertion:**
  - Emit mock `CHILD_SAFETY_ALERT_ACKNOWLEDGED` -> verify `listAlerts` called.
  - Emit mock `CHILD_SAFETY_ALERT_RESOLVED` -> verify `listAlerts` and `listChildren` called.

#### Test 11.5: Reactive General Emergency Invalidation
- **Objective:** Ensure incoming `EMERGENCY_ALERTS` and `EMERGENCY_INCIDENT_RESOLVED` refresh general incidents.
- **Assertion:**
  - Emit mock `EMERGENCY_ALERTS` -> verify `apiClient.getEmergencyIncidents` called.
  - Emit mock `EMERGENCY_INCIDENT_RESOLVED` -> verify `apiClient.getEmergencyIncidents` called.

#### Test 11.6: Society Scoping & Cross-Society Isolation
- **Objective:** Ensure events belonging to another society are dropped silently.
- **Assertion:**
  - Guard session belongs to `soc-gvs`.
  - Emit `CHILD_SAFETY_SOS_TRIGGERED` with `societyId: 'soc-other-evil'`.
  - Advance timers.
  - Assert `childSafetyService.listAlerts` was NOT called.

#### Test 11.7: Reconnect Recovery & Resynchronization
- **Objective:** Ensure recovering from network disconnect triggers authoritative resync.
- **Assertion:**
  - Emit status transition `CONNECTED` -> `RECONNECTING` -> `CONNECTED`.
  - Verify `loadData` is invoked to refresh both Child Safety alerts and general emergency feeds.

#### Test 11.8: Strict Mode Double-Mount & Unmount Cleanup
- **Objective:** Verify zero subscription leaks on component remount.
- **Assertion:**
  - Mount component, unmount, remount.
  - Verify every subscription returned an unsubscribe function that was cleanly called.
  - Zero lingering listeners on `realtimeService`.

#### Test 11.9: Realtime Connection Status Pill Rendering
- **Objective:** Verify UI shows LIVE, RECONNECTING, or OFFLINE based on connection status.
- **Assertion:**
  - With `status: { state: 'CONNECTED' }`, expect `data-testid="realtime-status-pill"` to display `LIVE`.
  - With `status: { state: 'RECONNECTING' }`, expect `RECONNECTING`.
  - With `status: { state: 'OFFLINE' }`, expect `OFFLINE`.

---

## 3. Structural Synthesis

- **BLOCKERS:** None.
- **SECURITY RISKS:** Event spoofing and cross-society data leakage are mitigated by validating `societyId` and restricting topics.
- **REQUIRED IMPLEMENTATION:** Implement the integration steps outlined in the implementation plan.
- **REQUIRED TESTS:** Implement Suite 11 (9 tests) in `tests/issue06_b23_safety_command_hub.test.ts`.
- **OUT-OF-SCOPE ITEMS:** Modifying backend SSE streams or core authentication storage.

