# AARIZO — ISSUE-06 — PHASE B.2 — STEP 2.3 — PHASE 4.6.4
# CHILD GATE SCANNER REALTIME ALIGNMENT — REGRESSION TEST PLAN

**Audit Date:** 2026-11-19  
**Execution Mode:** STRICTLY READ-ONLY (Test plan for subsequent implementation phase)  
**Target Test Suite:** [`tests/issue06_b23_child_gate_scanner.test.ts`](file:///d:/AAZIRA/AARIZO/tests/issue06_b23_child_gate_scanner.test.ts)

---

## 1. Test Objectives & Strategy
This test plan provides comprehensive integration test coverage for the perimeter gate scanner, validating verification role enforcement, camera modal lifecycle, realtime SSE synchronization, concurrency safety, and privacy boundaries.

---

## 2. Test Specifications: `tests/issue06_b23_child_gate_scanner.test.ts`

### Suite 1: Verification Role Gating (`canVerifyPass`)
- **Test 1.1: Guard & Administrator Verification Execution Allowed**
  - Setup: Render `ChildGateScannerPage` with `guard` and `admin` user profiles.
  - Assertion: "Scan Pass" submit button is `enabled`; "Use Camera" button is `enabled`; submitting a valid QR payload invokes `childSafetyService.verifyGatePass(...)`.
- **Test 1.2: Committee & Secretary View-Only Mode**
  - Setup: Render `ChildGateScannerPage` with `secretary` and `committee` user profiles.
  - Assertion: Terminal layout and exit logs are viewable; "Scan Pass" submit button is `disabled`; view-only banner is displayed (*"Gate clearance verification requires Guard or Admin role"*).
  - Assertion: Submitting a form or calling `handleScanQR` directly fails closed and NEVER calls `childSafetyService.verifyGatePass(...)`, preventing HTTP 403 errors.
- **Test 1.3: Unsupported Roles Fail Closed**
  - Setup: Render with `resident`, `vendor`, `delivery`, or unauthenticated session.
  - Assertion: Access is denied; `Access Restricted` view is rendered; zero API calls are made; realtime hooks are disabled.

### Suite 2: Exact Scanner Event Allowlist & Invalidation
- **Test 2.1: 8 Guard-Authorized Security Topics**
  - Setup: Simulate arrival of the 8 guard-authorized SSE events:
    - `CHILD_GATE_PASS_GENERATED`, `CHILD_GATE_PASS_VERIFIED`, `CHILD_GATE_PASS_REVOKED`
    - `CHILD_EXIT_TRIGGERED`, `CHILD_EXIT_DENIED`
    - `CHILD_SAFETY_SOS_TRIGGERED`, `CHILD_SAFETY_ALERT_ACKNOWLEDGED`, `CHILD_SAFETY_ALERT_RESOLVED`
  - Assertion: Realtime controller schedules coalesced refetches and updates `activePasses`, `pickupLogs`, or `activeAlerts` accordingly.
- **Test 2.2: Household Profile & Pickup Topics Blocked**
  - Setup: Simulate arrival of `CHILD_PROFILE_CREATED`, `CHILD_PROFILE_UPDATED`, `CHILD_PROFILE_ARCHIVED`, `CHILD_PICKUP_AUTHORIZED`, `CHILD_PICKUP_UPDATED`, `CHILD_PICKUP_REVOKED`.
  - Assertion: Hook rejects these events; zero refetches are triggered; resident privacy is preserved.

### Suite 3: Concurrency, In-Flight Locking & Double-Spend
- **Test 3.1: Concurrent Submission Blocked**
  - Setup: Trigger `handleScanQR` while `isVerifying === true`.
  - Assertion: Second invocation is immediately aborted; `childSafetyService.verifyGatePass` is invoked exactly once.
- **Test 3.2: Sensitive QR State Scrubbing**
  - Setup: Submit valid payload or malformed payload.
  - Assertion: Upon completion of verification (both fulfilled and rejected promises), `qrInput` state is strictly reset to `''`.

### Suite 4: Camera Scanner Modal Lifecycle
- **Test 4.1: Camera Modal Activation & Dismissal**
  - Setup: Click "Camera" trigger button.
  - Assertion: `MobileQRScanner` modal renders in DOM.
  - Setup: Click "Close" button.
  - Assertion: Modal unmounts cleanly; scanner state resets.
- **Test 4.2: Camera Scan Success Handling**
  - Setup: Simulate `onScan` callback from `MobileQRScanner` with valid QR payload.
  - Assertion: Modal closes automatically; `handleScanQR` is invoked with the scanned code; sensitive code is immediately purged from modal state.

### Suite 5: Lockdown Enforcement & Missing Child SOS
- **Test 5.1: Critical Missing Child Lockdown Banner**
  - Setup: An active `MISSING_CHILD` alert exists in initial state or arrives via SSE.
  - Assertion: Animated red lockdown banner renders prominently; shows child name and last seen location.
- **Test 5.2: Verification Blocked on Missing Child Profile**
  - Setup: Backend responds with `409 CHILD_MISSING_ALERT_BLOCKED`.
  - Assertion: UI displays prominent red denial card: *"EXIT BLOCKED: Active missing-child alert on this child profile"*; never displays success.

### Suite 6: Transport Invariants & Reconnection Resync
- **Test 6.1: Authoritative Resync on SSE Reconnect**
  - Setup: Realtime connection status transitions `RECONNECTING` -> `CONNECTED`.
  - Assertion: `loadData()` is invoked to resynchronize active passes, alerts, and exit logs.
- **Test 6.2: Single Connection Invariant**
  - Verification: Spies on `realtimeService.connect`.
  - Assertion: Scanner component never invokes `realtimeService.connect()`.

---

## 3. Regression Commands & Baseline Verification
```bash
# 1. Typecheck
npx tsc -b

# 2. Scanner test suite
npx jest tests/issue06_b23_child_gate_scanner.test.ts --verbose

# 3. Security hook & command hub suites
npx jest tests/issue06_b23_security_realtime_hook.test.ts tests/issue06_b23_safety_command_hub.test.ts --verbose

# 4. Full test suite
npm test -- --runInBand

# 5. Production build
npm run build
```
Target: 100% test pass (minimum 660+ tests passing, 0 failures, 0 type errors).

