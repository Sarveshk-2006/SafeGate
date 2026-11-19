# AARIZO — ISSUE-06 — PHASE B.2 — STEP 2.3 — PHASE 4.6.4
# ADMIN & SCANNER REALTIME ALIGNMENT — REGRESSION TEST PLAN

**Audit Date:** 2026-11-19  
**Execution Mode:** STRICTLY READ-ONLY (Test plan for subsequent implementation phase)  
**Target Test Suites:**
- New Suite: [`tests/issue06_b23_admin_child_safety.test.ts`](file:///d:/AAZIRA/AARIZO/tests/issue06_b23_admin_child_safety.test.ts)
- Updated Suite: [`tests/issue06_b23_child_gate_scanner.test.ts`](file:///d:/AAZIRA/AARIZO/tests/issue06_b23_child_gate_scanner.test.ts)

---

## 1. Test Objectives & Strategy
To guarantee zero regressions and verify the complete elimination of legacy mock behavior in the Admin Child Safety desk and Perimeter Gate Scanner:
1. Validate that the Admin Child Safety desk never executes deprecated synchronous mock APIs (`getChildren`, `getPickupLogs`, `getSafetyAlerts`, `resolveSafetyAlert`).
2. Validate that tenant isolation is strictly preserved without hardcoded fallbacks (`'soc-gvs'`).
3. Validate defense-in-depth role enforcement at the React component layer.
4. Validate realtime SSE hook integration, debounced coalescing, and reconnection authoritative resync.
5. Validate perimeter gate scanner role gating preventing non-guard roles (`committee`, `secretary`) from attempting pass verification.

---

## 2. Test Specifications: `issue06_b23_admin_child_safety.test.ts`

### Suite 1: Authentication & Society Isolation
- **Test 1.1: Unauthenticated Session Rejection**
  - Setup: `useAuth` returns `{ currentUser: null }`.
  - Expectation: Component renders `Access Denied` card; zero API calls are dispatched; zero SSE subscriptions are activated.
- **Test 1.2: Missing Society ID Rejection**
  - Setup: `currentUser` has `{ role: 'admin', societyId: '' }`.
  - Expectation: Component renders `Access Denied` card; strictly avoids falling back to `'soc-gvs'`.
- **Test 1.3: Concrete Society Isolation**
  - Setup: User belongs to `soc-cypress`.
  - Expectation: API queries specify `soc-cypress`; realtime hook registers with `soc-cypress`.

### Suite 2: Role-Based Defense-in-Depth
- **Test 2.1: Authorized Roles (`admin`, `secretary`, `platform_admin`)**
  - Setup: Render with `admin` or `secretary` profile.
  - Expectation: Page header, tabs, and children cards render successfully.
- **Test 2.2: Unauthorized Roles (`guard`, `resident`, `vendor`, `delivery`)**
  - Setup: Render with `guard` or `resident` profile.
  - Expectation: Component blocks rendering and presents access denied UI.

### Suite 3: Canonical REST API Invocation & Mock Elimination
- **Test 3.1: Canonical Asynchronous Data Fetching**
  - Expectation: Invokes `childSafetyService.listChildren()`, `listExitLogs({ limit: 50 })`, and `listAlerts({ status: 'ACTIVE' })`.
- **Test 3.2: Zero Deprecated Mock API Calls**
  - Verification: Spies on `getChildren`, `getPickupLogs`, `getSafetyAlerts`, `resolveSafetyAlert`.
  - Expectation: All deprecated synchronous mock methods have `toHaveBeenCalledTimes(0)`.

### Suite 4: Realtime Subscription & Coalescing
- **Test 4.1: Realtime Invalidation Coalescing**
  - Setup: Fire `onProfilesChange`, `onPickupsChange`, and `onAlertsChange` within a 10ms window.
  - Expectation: Timer coalesces refreshes into a single debounced `loadData` call.
- **Test 4.2: Authoritative Resync on SSE Reconnection**
  - Setup: Fire `onReconnect` callback.
  - Expectation: Triggers authoritative refetch of children, logs, and alerts.

### Suite 5: Canonical Alert Resolution
- **Test 5.1: Backend Alert Resolution Execution**
  - Setup: Render with active missing child alert. User clicks "Mark Child Safe / Resolve Incident".
  - Expectation: Calls `childSafetyService.resolveAlert(alertId, { resolutionNotes: expect.any(String), status: 'RESOLVED' })`.
  - Expectation: Refetches authoritative alerts upon resolution.

### Suite 6: UX & Connection Status Indicators
- **Test 6.1: Live Status Badge Rendering**
  - Expectation: Renders `data-connection-state="CONNECTED"` when realtime service reports connected; renders `RECONNECTING` and `DISCONNECTED` on status change.
- **Test 6.2: Dynamic Society Branding**
  - Expectation: Renders `currentUser.societyName` instead of "Green Valley Society".

---

## 3. Test Specifications: `issue06_b23_child_gate_scanner.test.ts` (Updates)

### Test 12: Granular Verification Role Check (`canVerifyPass`)
- **Test 12.1: Security Guard & Administrator (`canVerifyPass === true`)**
  - Setup: Render as `guard` or `admin`.
  - Expectation: "Scan Pass" submit button is enabled; submitting valid QR payload calls `childSafetyService.verifyGatePass`.
- **Test 12.2: Management Committee & Secretary (`canVerifyPass === false`)**
  - Setup: Render as `committee` or `secretary`.
  - Expectation: Terminal view and exit logs are viewable, but "Scan Pass" submit button is `disabled`.
  - Expectation: Displays informational banner: *"Gate clearance verification requires Guard or Admin role."*
  - Expectation: `childSafetyService.verifyGatePass` is NEVER invoked, preventing 403 API errors.

---

## 4. Regression & Build Validation Baseline

All test executions must adhere to the standard project test runner:
```bash
# 1. Typecheck validation
npm run build -- --noEmit

# 2. Run new Admin Child Safety test suite
npx jest tests/issue06_b23_admin_child_safety.test.ts --verbose

# 3. Run updated Child Gate Scanner test suite
npx jest tests/issue06_b23_child_gate_scanner.test.ts --verbose

# 4. Run entire Child Safety test suite
npx jest tests/issue06_b23_*.test.ts --verbose

# 5. Full project regression suite
npm test
```
Target: 100% test pass (minimum 660+ tests passing, 0 failing, 0 typecheck errors).

