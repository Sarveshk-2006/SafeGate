# AARIZO ISSUE-06 — PHASE B.2.3 — PHASE 4.6
## Realtime SSE Integration Regression Test Plan

**Date:** November 19, 2026  
**Repository:** `D:\AAZIRA\AARIZO`  
**Classification:** Quality Assurance & Regression Test Specification  

---

## 1. Overview & Quality Objectives

The Phase 4.6 Regression Test Plan specifies the automated test suites, test cases, and verification gates required to guarantee that realtime SSE integration:
1. Reliably updates all resident, security, and administrative Child Safety screens without manual user intervention.
2. Accurately applies scope-specific cache invalidations matching backend transaction cascades.
3. Preserves all security invariants: tenant isolation, resident family privacy filtering, fail-closed topic handling, and ephemeral in-memory storage.
4. Introduces zero regressions to Phase 4.1–4.5 deliverables (pure helpers, child profiles, authorized pickups, gate passes, one-time QR secrets, and SOS modals) or non-child emergency workflows.

---

## 2. Test Suite Inventory for Phase 4.6

| Test Suite File | Type | Target Scope | New / Existing | Key Assertions |
| :--- | :---: | :--- | :---: | :--- |
| `tests/issue06_b23_realtime_sse.test.ts` | Unit / Controller | Topic classification & SSE stream parser | Existing (Expanded) | Add classification checks for `CHILD_PICKUP_AUTHORIZED`, `CHILD_PICKUP_UPDATED`, `CHILD_PICKUP_REVOKED` (`category === 'CHILD_SAFETY'`, `isProtected === true`). |
| `tests/issue06_b23_phase4_6_resident_realtime.test.ts` | Integration / Controller | `ResidentChildSafetyPanel` realtime auto-refresh & status | **NEW** | Verifies debounced scoped refreshes on all 14 Child Safety SSE topics, `requestIdRef` race protection, reconnect full resync, offline status badge display, and unmount cleanup. |
| `tests/issue06_b23_phase4_6_panel_realtime_render.test.ts` | React SSR Render | Component mounting & connection status badges | **NEW** | Verifies SSR rendering of `ResidentChildSafetyPanel` with realtime connection badge (`LIVE_SYNCED`, `RECONNECTING`, `OFFLINE`) and zero leaked staff controls. |
| `tests/issue06_b23_child_safety_realtime_hook.test.ts` | Unit / Hook | `useChildSafetyRealtime` lifecycle | Existing | Verifies Strict Mode double-mount, callback ref stability, deduplication FIFO, and session switch purge. |
| `tests/issue06_b23_child_safety_data_layer.test.ts` | Integration | Data layer & cascade scopes | Existing | Verifies `getInvalidatedChildSafetyScopes` mappings for all 14 topics. |
| `tests/issue06_b23_phase4_5_resident_child_sos.test.ts` | Behavioral | Resident SOS & alerts | Existing | Verifies SOS dispatch and alert tracking controller. |
| `tests/issue06_b23_phase4_5_resident_sos_render.test.ts` | React SSR Render | SOS modal & alerts section render | Existing | Verifies SSR render with test-local `Modal` mock. |
| `tests/issue06_b23_phase4_4_resident_gate_passes.test.ts` | Behavioral | Gate pass lifecycle | Existing | Verifies pass creation, one-time QR cleanup, and confirmed revocation. |
| `tests/issue06_b23_phase4_3_resident_authorized_pickups.test.ts` | Behavioral | Authorized pickups lifecycle | Existing | Verifies pickup CRUD, validation, and `REVOKED` immutability. |
| `tests/issue06_b23_phase4_2_resident_child_profiles.test.ts` | Behavioral | Child profiles lifecycle | Existing | Verifies child profile listing, registration, editing, and archival. |

---

## 3. Dedicated Phase 4.6 Test Cases (`tests/issue06_b23_phase4_6_resident_realtime.test.ts`)

### Test Case 1: Child Profile Lifecycle Realtime Refresh
- **Scenario:** An authorized child profile is updated (e.g. status changes from `SAFE` to `OUT_OF_SOCIETY` following gate exit).
- **Incoming Event:** `CHILD_PROFILE_UPDATED` with payload `{ id: 'chd-1', status: 'OUT_OF_SOCIETY' }`.
- **Expected Action:**
  - `onProfilesChange` fires.
  - After 250ms debounce, `ctrl.loadChildren({ silent: true })` executes over `fetch`.
  - Child profile display model updates status badge to "Out of Society" without full page reload.

### Test Case 2: Authorized Pickup Realtime Refresh & Escort Invalidation
- **Scenario:** Another household guardian adds or revokes an authorized pickup person in another tab or device.
- **Incoming Event:** `CHILD_PICKUP_AUTHORIZED` or `CHILD_PICKUP_REVOKED`.
- **Expected Action:**
  - `onPickupsChange` fires.
  - After 250ms debounce, increments `pickupsRefreshNonce`.
  - `ResidentAuthorizedPickupsSection` re-queries `GET /api/children/:id/pickups`.
  - `ResidentGatePassesSection` re-evaluates eligible escorts list.

### Test Case 3: Child Gate Pass Verification & Exit Log Stream
- **Scenario:** Guard terminal verifies a child gate pass at Main Gate.
- **Incoming Event:** `CHILD_GATE_PASS_VERIFIED` followed by `CHILD_EXIT_TRIGGERED`.
- **Expected Action:**
  - `onPassesChange` and `onExitLogsChange` fire.
  - Increments `pickupsRefreshNonce` (which reloads passes).
  - Gate pass list shows pass transitioned to `USED`.
  - Collapsible exit history appends new exit record with timestamp and guard name.

### Test Case 4: Child Safety SOS Realtime Broadcast & Gate Pass Lock
- **Scenario:** A household member or security guard dispatches a `MISSING_CHILD` SOS alert.
- **Incoming Event:** `CHILD_SAFETY_SOS_TRIGGERED`.
- **Expected Action:**
  - `onAlertsChange` and `onProfilesChange` fire.
  - Synthesizes emergency audio tone and floating toast.
  - Increments `alertsRefreshNonce`, reloading active alerts in `ResidentChildAlertsSection`.
  - Silently reloads child profiles: child status becomes `MISSING`.
  - `ResidentGatePassesSection` immediately blocks new gate-pass generation and displays missing child warning notice.

### Test Case 5: SOS Alert Acknowledgment & Resolution Cycle
- **Scenario:** Guard acknowledges SOS alert, followed by admin resolving it.
- **Incoming Events:**
  1. `CHILD_SAFETY_ALERT_ACKNOWLEDGED` `{ alertId: 'alt-1', status: 'ACKNOWLEDGED' }`.
  2. `CHILD_SAFETY_ALERT_RESOLVED` `{ alertId: 'alt-1', status: 'RESOLVED' }`.
- **Expected Action:**
  - On acknowledge: Alert card updates badge to `ACKNOWLEDGED` and displays officer name.
  - On resolve: Alert moves to past resolved section. Child status is restored from `MISSING` to `SAFE`. Gate pass creation is re-enabled.

### Test Case 6: SSE Reconnect Authoritative Resync
- **Scenario:** Device temporarily loses connectivity (cellular tunnel drop) and reconnects.
- **Event Flow:** SSE status transitions from `CONNECTED` -> `RECONNECTING` -> `CONNECTED`.
- **Expected Action:**
  - `useChildSafetyRealtime` detects reconnect gap.
  - Calls `onReconnect`.
  - Panel executes full authoritative resync across all 4 scopes (`loadChildren`, `pickupsRefreshNonce + 1`, `alertsRefreshNonce + 1`).
  - Zero stale cached state remains.

### Test Case 7: Realtime Connection Status Badge Rendering
- **Scenario:** SSE status transitions between `CONNECTED`, `RECONNECTING`, and `OFFLINE`.
- **Expected Action:**
  - When `CONNECTED`: Renders green indicator (`data-testid="realtime-status-connected"`).
  - When `RECONNECTING`: Renders pulsing amber indicator (`data-testid="realtime-status-reconnecting"`).
  - When `OFFLINE`: Renders slate indicator (`data-testid="realtime-status-offline"`).

### Test Case 8: Strict Mode Double-Mount & Unmount Cleanup
- **Scenario:** Component mounts in React 18 Strict Mode (mount -> unmount -> remount).
- **Expected Action:**
  - Unsubscribes cleanly on unmount; registers exactly 1 set of subscriptions on final mount.
  - Zero duplicate event handling.
  - Final unmount removes all 15 topic listeners from `realtimeService`.

---

## 4. Full Regression Verification Matrix

Before approving Phase 4.6 closure, the following automated gates must pass:

| Gate | Execution Command | Success Criteria |
| :---: | :--- | :--- |
| **Gate 1** | `npx jest tests/issue06_b23_phase4_6_resident_realtime.test.ts` | 100% pass (all new realtime controller tests). |
| **Gate 2** | `npx jest tests/issue06_b23_phase4*` | 100% pass across all Phase 4 resident suites (helpers, profiles, pickups, passes, alerts, SOS, and realtime). |
| **Gate 3** | `npx jest tests/issue06_child_safety*` | 100% pass across all backend Child Safety unit and route suites (11 PostgreSQL tests skipped as expected). |
| **Gate 4** | `npx jest` | Full offline suite: 35+ suites / 530+ tests passed, 0 failed, 11 skipped. |
| **Gate 5** | `npx tsc -b` | 0 frontend TypeScript compiler errors. |
| **Gate 6** | `npm --prefix server run build` | 0 backend TypeScript compiler errors. |
| **Gate 7** | `npm run build` | Vite production build completes with exit code 0. |

---

## 5. Acceptance & Sign-Off Criteria

Phase 4.6 will be accepted and closed **ONLY** when:
1. All 14 backend Child Safety SSE topics reliably trigger the correct debounced, scoped UI updates in `ResidentChildSafetyPanel`.
2. `SafetyCommandHub` is cut over from legacy `CHILD_SAFETY_UPDATED` to canonical emergency topics.
3. Live connection status (`LIVE_SYNCED`, `RECONNECTING`, `OFFLINE`) is visible in the resident panel.
4. All 7 verification gates exit with code 0.
5. An independent read-only security re-audit approves the implementation without blocking defects.

