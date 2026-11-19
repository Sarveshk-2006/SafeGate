# AARIZO — ISSUE-06 Phase B.2.3 — Phase 2 Feature Preservation Report

**Objective:** Confirm zero regressions across all existing realtime consumers, UI indicators, hooks, and unrelated workflows after migrating `realtimeService.ts` from unauthenticated `EventSource` to authenticated Fetch SSE.

---

## 1. Public API & Consumer Preservation Audit

| Consumer / Module | Methods / Properties Used | Phase 2 Preservation Status | Notes |
| :--- | :--- | :---: | :--- |
| `src/components/common/RealtimeLiveBar.tsx` | `getConnectionStatus()`, `subscribeToStatus()`, `subscribeToAlerts()`, `forceReconnect()` | **PRESERVED** | Status pill reflects truthful `OFFLINE` / `CONNECTING` / `CONNECTED` / `RECONNECTING`; `forceReconnect()` now reconnects with authenticated Bearer token; alert toasts now route `CHILD_*` to role-correct Child Safety pages. |
| `src/hooks/useRealtime.ts` | `subscribe()`, `subscribeToStatus()`, `getRecentMessages()`, `getConnectionStatus()` | **PRESERVED** | Identical signatures and return shapes (`RealtimeConnectionStatus`, `RealtimeMessage`). |
| `src/services/realTimeSync.ts` | `realtimeService.broadcast()`, `realtimeService.subscribe()` | **PRESERVED** | Untouched wrapper; continues working for `NotificationCenter.tsx` and all subscribers. |
| `src/components/dev/DeveloperDatabaseStudio.tsx` | `getRecentMessages()`, `subscribe('*')` | **PRESERVED** | Works identically once authenticated. |
| `src/components/guard/GuardShell.tsx`, `SecretaryShell.tsx`, `VisitorHome.tsx`, `CommunityHome.tsx`, `PaymentsHome.tsx`, `SupportHome.tsx` | `subscribe()`, `publish()` | **PRESERVED** | All topic & wildcard `*` subscriptions, unsubscribe cleanup, and non-protected `publish()` calls continue working without modification. |
| `src/services/visitorService.ts`, `billingService.ts`, `amenityService.ts`, `parkingService.ts`, `staffService.ts`, `societyService.ts`, `notificationService.ts` | `realtimeService.publish()` | **PRESERVED** | Unrelated services continue compiling and publishing non-protected events; protected `CHILD_*`/`EMERGENCY_*` topics no longer trigger `403` noise against `/api/realtime/broadcast`. |
| `src/pages/dashboard/security/ChildGateScannerPage.tsx`, `SecurityEmergencyTerminalPage.tsx` | `subscribe('*')` | **PRESERVED** | Existing subscriptions kept intact until their planned Phase 5 cutover. |
| `src/context/AuthContext.tsx` | All existing `AuthContextProps` (`status`, `currentUser`, `submitLogin`, `verifyOtp`, `loginAsRole`, `loginWithProfile`, `logout`, Firebase `onIdTokenChanged`, multi-tab storage sync, Capacitor `appStateChange`) | **PRESERVED** | Zero breaking changes to context shape; enhanced cleanly with SSE connect/disconnect/token-refresh/network-resume lifecycle hooks. |

---

## 2. Audio, Haptic & Toast Alert Preservation

- **Preserved existing behaviors:**
  - `EMERGENCY_*` -> `'emergency'` dual-tone siren + heavy haptic + `/emergency`
  - `VISITOR_*` -> `'alert'` chime + medium haptic + `/resident/visitors`
  - `PARCEL_*` / `DELIVERY_*` / non-child `GATE` -> `'alert'` chime + medium haptic + `/resident/deliveries`
  - `PAYMENT_*` -> `'info'` chime + success haptic + `/resident/billing`
- **Fixed Child Safety alert routing (zero UI redesign):**
  - `CHILD_SAFETY_SOS_TRIGGERED` -> `'emergency'` siren + heavy haptic + role-appropriate `/resident/child-safety`, `/security/child-safety`, or `/admin/child-safety`.
  - `CHILD_GATE_PASS_*` / `CHILD_EXIT_*` / `CHILD_*` checked **before** generic `GATE`, preventing misrouting to `/resident/deliveries`.

---

## 3. Strict Non-Scope Confirmation

- Phases 3–8 were **NOT** started.
- No portal UI redesign or business workflow changes were introduced.
- All 6 Phase B.2.1 pre-cutover database/CI risks remain explicitly **OPEN**.
- All 4 separate backend/hardware requirements (`REQ-BE-01`–`REQ-BE-04`) remain explicitly documented and untouched.

