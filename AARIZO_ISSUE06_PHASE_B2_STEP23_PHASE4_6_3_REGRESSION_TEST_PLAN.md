# AARIZO — ISSUE-06 / B.2.3 / PHASE 4.6.3
# SECURITY REALTIME REGRESSION TEST PLAN

**Repository:** `D:\AAZIRA\AARIZO`  
**Phase:** Issue-06 / Phase B.2.3 — Subphase 4.6.3 (Security Command Hub Realtime Integration)  
**Document:** Authoritative Regression Testing & Verification Specification  
**Date:** 2026-11-19  

---

## 1. OBJECTIVE & REGRESSION BASELINE

This test plan defines the testing matrix required to verify the Security Command Hub, Guard Terminal, and Child Gate Scanner realtime integrations without causing regressions in:
- The completed Phase 4.6.2 Resident Child Safety Portal.
- The Visitor Management system (`visitorService`).
- General Emergency SOS incident dispatching (`safetyCommandEngine`).

### Approved Test Baseline:
- Test Suites: 36 passed, 2 skipped (PostgreSQL integration requiring live DB).
- Total Tests: 542 passed, 11 skipped, 0 failed.
- TypeScript Compilation: `npx tsc -b` exits with code 0.
- Production Client Build: `npm run build` exits with code 0.

---

## 2. NEW TEST SUITE: `tests/issue06_b23_phase4_6_security_realtime.test.ts`

A dedicated, comprehensive test suite must be authored to validate all security realtime behaviors:

### Test Case Group 1: Subscription Lifecycle & Topic Authorization
- **Test 1.1:** Guard realtime controller subscribes to all 8 authorized gate and SOS topics + status exactly once.
- **Test 1.2:** Unmount drops all active topic and status listeners to exactly 0 (no memory or listener leaks).
- **Test 1.3:** Guard controller strictly drops or ignores unauthorized child profile roster events (`CHILD_PROFILE_CREATED`, `CHILD_PICKUP_AUTHORIZED`).
- **Test 1.4:** Connection status badge accurately reflects `CONNECTED`, `RECONNECTING`, and `OFFLINE` with accessible screen-reader labels.

### Test Case Group 2: Gate Scanner Event-Driven Invalidation
- **Test 2.1:** Incoming `CHILD_GATE_PASS_GENERATED` invalidates available pass cache and displays pass in scanner quick-list.
- **Test 2.2:** Incoming `CHILD_GATE_PASS_REVOKED` immediately removes revoked pass from active scanner choices.
- **Test 2.3:** Incoming `CHILD_GATE_PASS_VERIFIED` updates pass status to `USED` and prevents subsequent presentation.
- **Test 2.4:** Rapid successive gate scans employ monotonic request sequencing (`reqSeq`) to discard stale network responses.

### Test Case Group 3: Gate Verification & Exit Audit Feed
- **Test 3.1:** Valid bearer token verification via `verifyGatePass` returns `ALLOWED`, appends record to exit logs, and updates guard UI.
- **Test 3.2:** Replayed or expired pass verification returns `DENIED` with appropriate reason banner.
- **Test 3.3:** Incoming `CHILD_EXIT_TRIGGERED` and `CHILD_EXIT_DENIED` events coalesce within 50ms into a single recent-logs query.

### Test Case Group 4: Missing Child Emergency & Lockdown Lifecycle
- **Test 4.1:** Incoming `CHILD_SAFETY_SOS_TRIGGERED` mounts flashing emergency lockdown banner across `ChildGateScannerPage` and `SecurityTerminalPage`.
- **Test 4.2:** Active missing-child alert triggers audio alert chime without looping.
- **Test 4.3:** Gate verification during active `MISSING_CHILD` alert strictly blocks exit clearance with `CHILD_MISSING_ALERT_BLOCKED`.
- **Test 4.4:** Incoming `CHILD_SAFETY_ALERT_ACKNOWLEDGED` updates banner to `RESPONDING` with officer's name.
- **Test 4.5:** Incoming `CHILD_SAFETY_ALERT_RESOLVED` clears emergency banner and restores normal gate operations.

### Test Case Group 5: Multi-Guard Concurrency & Session Switching
- **Test 5.1:** Guard A verifying a pass at Gate 1 instantly invalidates Guard B's scanner at Gate 2 via SSE event propagation.
- **Test 5.2:** Guard session switch (e.g., Guard Officer Singh -> Officer Ramesh) purges in-flight state and rebinds session keys.
- **Test 5.3:** Society switch rejects cross-society gate events and clears active society passes.
- **Test 5.4:** Network drop to `OFFLINE` and subsequent recovery to `CONNECTED` triggers authoritative `onReconnect` resynchronization across active passes, alerts, and logs.

### Test Case Group 6: General Emergency SOS Preservation
- **Test 6.1:** Non-child emergencies (`MEDICAL`, `FIRE`, `SECURITY`, `LIFT`, `ELECTRICAL`) in `SafetyCommandHub` trigger `safetyCommandEngine.triggerOneTapSOS` with zero Child Safety API calls.
- **Test 6.2:** Incident acknowledgement and responder assignment in Command Console update general emergency state without touching Child Safety tables.

---

## 3. REGRESSION EXECUTION MATRIX

During each subphase implementation, the following test suites must be executed sequentially:

| Suite / Command | Focus Area | Expected Outcome |
| :--- | :--- | :---: |
| `npx jest tests/issue06_b23_phase4_6_security_realtime.test.ts` | New Guard Realtime Suite | All tests pass |
| `npx jest tests/issue06_b23_phase4_6_resident_realtime.test.ts` | Phase 4.6.2 Resident Realtime | 13/13 passed |
| `npx jest --runInBand "tests/issue06_b23_phase4_"` | All Phase 4 Resident Suites | 10/10 suites, 66/66 passed |
| `npx jest tests/issue06_b23_child_safety_data_layer.test.ts` | Shared Child Safety Data Layer | 45/45 passed |
| `npx jest tests/issue06_visitor_pass_api.test.ts` | Visitor Management API | All passed |
| `npx jest --runInBand` | Full Offline Test Suite | 36 passed, 2 skipped, 542+ passed, 0 failed |
| `npx tsc -b` | TypeScript Project Build | Exit code 0 |
| `npm run build` | Production Vite Bundle | Exit code 0 |

---

## 4. SIGN-OFF CRITERIA

Subphase 4.6.3 can be officially closed only when:
1. `ChildGateScannerPage.tsx` has zero `realtimeService.publish()` calls and zero deprecated synchronous `childSafetyService.get*` calls.
2. `SafetyCommandHub.tsx` staff view has zero broken write adapters and verified pass verification.
3. All new security realtime tests pass.
4. Full offline Jest suite passes with 0 failures.
5. `npx tsc -b` and `npm run build` exit with code 0.

