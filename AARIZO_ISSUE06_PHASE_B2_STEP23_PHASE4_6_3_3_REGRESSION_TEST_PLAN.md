# AARIZO — ISSUE-06 / B.2.3 / PHASE 4.6.3.3
# SAFETY COMMAND HUB — REGRESSION TEST PLAN

**Repository:** `D:\AAZIRA\AARIZO`  
**Phase:** Issue-06 / Phase B.2.3 — Subphase 4.6.3.3  
**Plan Status:** AUDIT APPROVED — TEST SUITE READY TO IMPLEMENT  
**Test File Target:** `tests/issue06_b23_safety_command_hub.test.ts`  
**Baseline Verification:** 572 passed tests, 11 skipped, 0 failed  
**Date:** 2026-11-19  

---

## 1. Test Architecture & Environment Guidelines

1. **Jest Environment:** `testEnvironment: 'node'` as configured in `jest.config.cjs`.
2. **Component Testing Strategy:**
   - React component tests will use `react-dom/server` (`renderToStaticMarkup`) for SSR markup verification, permission boundaries, and initial hydration testing.
   - Dynamic user actions (form submissions, button clicks, async flows, and realtime callbacks) will be tested directly against component controller handlers, service spies, and mocked contexts.
3. **Mocks Required:**
   - `../src/services/childSafetyService` (spy on `listChildren`, `createChildProfileAsync`, `addAuthorizedPickup`, `revokeAuthorizedPickup`, `createGatePass`, `verifyGatePass`, `triggerSos`, `listAlerts`, `acknowledgeAlert`, `resolveAlert`).
   - `../src/hooks/useSecurityChildSafetyRealtime` (control connection states, trigger `onRefresh`, simulate SSE events).
   - `../src/domains/safety/services/safetyCommandEngine` (verify general emergency calls).
   - `../src/utils/backendConfig` and `../src/utils/nativeMobile` (resolve ESM import compatibility in Node test runner).

---

## 2. Test Suite Specification (`tests/issue06_b23_safety_command_hub.test.ts`)

### Section 1: Role Authorization & Tab Visibility Boundaries
| Test ID | Test Description | Assertion / Expected Outcome |
|:---|:---|:---|
| **T-HUB-01** | `guard` user views SafetyCommandHub | `CHILD_SAFETY` tab displays privacy notice redirecting to Gate Scanner; `COMMAND_CONSOLE` and `ONE_TAP_SOS` are visible. |
| **T-HUB-02** | `secretary` user views SafetyCommandHub | All tabs (`ONE_TAP_SOS`, `CHILD_SAFETY`, `COMMAND_CONSOLE`) accessible; child roster viewing enabled. |
| **T-HUB-03** | `committee` user views SafetyCommandHub | `COMMAND_CONSOLE` accessible; child roster viewing enabled; profile write actions hidden/disabled. |
| **T-HUB-04** | `admin` user views SafetyCommandHub | Full access to all staff tabs and write capabilities. |
| **T-HUB-05** | `resident` user views SafetyCommandHub | `COMMAND_CONSOLE` hidden; `CHILD_SAFETY` renders `<ResidentChildSafetyPanel />`. |
| **T-HUB-06** | Unauthorized / unsupported role (`security` alias, `vendor`) | Fails closed; staff tabs hidden; zero API or realtime subscriptions opened. |

---

### Section 2: Staff Child & Escort Management Workflows
| Test ID | Test Description | Assertion / Expected Outcome |
|:---|:---|:---|
| **T-HUB-07** | List children in staff `CHILD_SAFETY` tab | Calls `childSafetyService.listChildren()`; renders child profile names and flat numbers. |
| **T-HUB-08** | Add child profile submission | Calls `childSafetyService.createChildProfileAsync(...)` with required fields; handles success and clears form. |
| **T-HUB-09** | Add child profile API error handling | Captures `ApiError` and renders inline error banner without throwing unhandled exception. |
| **T-HUB-10** | Add authorized escort submission | Validates ID format; calls `childSafetyService.addAuthorizedPickup(childId, payload)`; rejects raw government ID numbers. |
| **T-HUB-11** | Remove authorized escort | Calls `childSafetyService.revokeAuthorizedPickup(childId, escortId)`; proves zero in-memory silent array mutation. |

---

### Section 3: Gate Pass Generation & Gate Verifier Redirection
| Test ID | Test Description | Assertion / Expected Outcome |
|:---|:---|:---|
| **T-HUB-12** | Confirm gate pass generation | Calls `childSafetyService.createGatePass(...)`; displays issued `passCode` and one-time QR payload. |
| **T-HUB-13** | Elimination of fake timeout pass | Proves `setAlertSuccess` is not invoked without a successful 201 backend response from `childSafetyService.createGatePass`. |
| **T-HUB-14** | Gate verifier tab modernization | Proves deprecated `safetyCommandEngine.verifyChildPickupAtGate` is eliminated; links to `/security/scanner`. |

---

### Section 4: Child Safety SOS & Live Incident Console
| Test ID | Test Description | Assertion / Expected Outcome |
|:---|:---|:---|
| **T-HUB-15** | Staff One-Tap Child Safety SOS dispatch | Calls `childSafetyService.triggerSos(...)` with `'MISSING_CHILD'`; proves local mock `triggerOneTapSOS` is bypassed for child safety. |
| **T-HUB-16** | Report Missing button on child card | Calls `childSafetyService.triggerSos(...)` populated with target child ID and flat details. |
| **T-HUB-17** | Command Console unified incident feed | Fetches both `childSafetyService.listAlerts({ status: 'ACTIVE' })` and `safetyCommandEngine.getIncidents()`; displays both types. |
| **T-HUB-18** | Acknowledge Child Safety alert | Calls `childSafetyService.acknowledgeAlert(alertId)`; updates alert status to `ACKNOWLEDGED`. |
| **T-HUB-19** | Mark Resolved on Child Safety alert | Calls `childSafetyService.resolveAlert(alertId, { status: 'RESOLVED', resolutionNotes })`; requires resolution notes. |
| **T-HUB-20** | Responder assignment behavior on Child Safety alerts | Proves responder assignment is not submitted to backend Child Safety API (reserved for general emergencies). |

---

### Section 5: Realtime SSE Integration & Invalidation Lifecycle
| Test ID | Test Description | Assertion / Expected Outcome |
|:---|:---|:---|
| **T-HUB-21** | SSE Subscription establishment | Proves `useSecurityChildSafetyRealtime` is enabled with `topics: SECURITY_CHILD_SAFETY_TOPICS` for staff sessions. |
| **T-HUB-22** | Reactive refresh on `CHILD_SAFETY_SOS_TRIGGERED` | Simulating SSE event invokes `onRefresh` and triggers authoritative `loadData()` resync. |
| **T-HUB-23** | Reactive refresh on `CHILD_SAFETY_ALERT_ACKNOWLEDGED` and `_RESOLVED` | Triggers scoped refresh of `activeAlerts`. |
| **T-HUB-24** | React Strict Mode double-mount safety | Unmount cleanly releases SSE subscription without duplicate listener registration. |

---

### Section 6: Preservation of General Emergency Workflows
| Test ID | Test Description | Assertion / Expected Outcome |
|:---|:---|:---|
| **T-HUB-25** | One-Tap SOS for `MEDICAL`, `FIRE`, `SECURITY`, `LIFT`, `ELECTRICAL` | Calls `safetyCommandEngine.triggerOneTapSOS(...)`; records general emergency incident with correct category. |
| **T-HUB-26** | Acknowledge & Assign Responder for general emergencies | Calls `safetyCommandEngine.acknowledgeIncident()` and `assignResponder()`; updates timeline. |
| **T-HUB-27** | Mark Resolved for general emergencies | Calls `safetyCommandEngine.resolveIncident(...)` with notes and status. |

---

## 3. Regression Execution & Exit Criteria

```powershell
# 1. Run targeted Safety Command Hub test suite
npx jest tests/issue06_b23_safety_command_hub.test.ts

# 2. Run all Security and Child Safety suites together
npx jest --runInBand "tests/issue06_b23_safety_command_hub|tests/issue06_b23_child_gate_scanner|tests/issue06_b23_security_realtime_hook|tests/issue06_b23_child_safety_data_layer"

# 3. Full offline Jest test suite
npx jest --runInBand
# Expected: >= 595 passed tests, 11 skipped, 0 failed

# 4. TypeScript compilation check
npx tsc -b
# Expected: Exit code 0

# 5. Production Vite build check
npm run build
# Expected: Exit code 0
```

