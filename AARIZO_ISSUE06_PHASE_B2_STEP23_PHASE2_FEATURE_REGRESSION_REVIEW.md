# AARIZO — ISSUE-06 Phase B.2.3 — Phase 2 Feature & Regression Review

**Audited Consumers:** `src/components/common/RealtimeLiveBar.tsx`, `src/hooks/useRealtime.ts`, `src/services/realTimeSync.ts`, `src/components/dev/DeveloperDatabaseStudio.tsx`, `src/components/guard/GuardShell.tsx`, `src/components/secretary/SecretaryShell.tsx`, `src/components/resident/{VisitorHome,CommunityHome,PaymentsHome,SupportHome,SafetyHome,NotificationCenter}.tsx`, `src/services/visitorService.ts`, and all 40+ callers of `realtimeService`.

---

## 1. Public API & Consumer Compatibility Verification

| Previous Public API (`src/services/realtimeService.ts`) | Current Phase 2 Signature & Behavior | Compatibility Verdict |
| :--- | :--- | :---: |
| `subscribe(topic, cb)` | Exact same signature; `Set` prevents duplicate identical callbacks; returns idempotent unsubscribe function; snapshots `Set` before iterating so unsubscribe-inside-callback is safe. | **PASS** |
| `subscribeToStatus(cb)` | Exact same signature; invokes immediately with current `RealtimeConnectionStatus`; returns unsubscribe function. | **PASS** |
| `subscribeToAlerts(cb)` | Exact same signature; returns unsubscribe function. | **PASS** |
| `publish(topicOrMsg, payload?, societyId?, senderRole?, senderName?)` | Exact same overloaded signature; fixes original bug where premature `seenMessageIds.add` prevented local subscribers from firing on `publish()`; skips blocked `/api/realtime/broadcast` POST for protected topics (`CHILD_*`/`EMERGENCY_*`/`SOS_*`/`GATE_PASS_*`). *(Note: BroadcastChannel posting of protected topics must be removed under `F-P2-01`.)* | **PASS (pending `F-P2-01` BroadcastChannel fix)** |
| `broadcast(topic, payload, societyId?, senderRole?, senderName?)` | Exact same signature delegating to `publish()`. | **PASS** |
| `getRecentMessages(topicFilter?)` | Exact same signature; resets cleanly on user/society switch and logout. | **PASS** |
| `getConnectionStatus()` | Exact same `RealtimeConnectionStatus` shape (`connected`, `state`, `transportType`, `latencyMs`, `activeListenersCount`, `messagesReceivedTotal`, `lastEventTime`). | **PASS** |
| `initSseStream(societyId?, userId?, userRole?)` | Preserved signature; now enforces valid auth token before connecting. | **PASS** |
| `forceReconnect(societyId?)` | Preserved signature used by `RealtimeLiveBar.tsx#L42, #L222`; now enforces valid auth token and resets backoff. | **PASS** |
| `realTimeSync` (`src/services/realTimeSync.ts`) | Untouched; delegates cleanly to `realtimeService.broadcast` and `realtimeService.subscribe`. | **PASS** |
| `useRealtimeTopic` / `useRealtimeStream` (`src/hooks/useRealtime.ts`) | Untouched; compiles and works identically. | **PASS** |
| `RealtimeStatusBadge` (`src/components/common/RealtimeLiveBar.tsx`) | Untouched; reflects truthful `OFFLINE`/`CONNECTING`/`CONNECTED`/`RECONNECTING` state. *(Note: `F-P2-03` fix required so `200 text/html` proxy pages cannot falsely show green `CONNECTED`.)* | **PASS (pending `F-P2-03`)** |

---

## 2. Role-Aware Child Safety Routing vs Backend Audience Policy

Verified `resolveChildSafetyPathForRole(role)` (`src/services/realtimeService.ts#L96-L103`) against `server/src/childSafety/router.ts#L57-L58` & `server/src/realtimeEngine.ts#L159-L186`:
- `resident` -> `/resident/child-safety` (receives own-child events via `targetUserIds`).
- `guard` -> `/security/child-safety` (receives gate & SOS events via `GATE_AND_SOS_EVENT_ROLES`).
- `secretary` / `committee` / `admin` -> `/admin/child-safety` (receives profile, gate & SOS events).
- `vendor` / `facility_manager` / `delivery` -> **denied all `CHILD_*` and `EMERGENCY_*` events server-side** (`SENSITIVE_DENIED_ROLES`).
- `CHILD_*` is checked BEFORE generic `GATE`, fixing the pre-existing bug that misrouted `CHILD_GATE_PASS_*` to `/resident/deliveries`.

---

## 3. Scope & Diff Integrity Review (Audit I)

- **Only 4 code/test files changed/created in Phase 2:**
  1. `src/services/sseFrameParser.ts` (new)
  2. `src/services/realtimeService.ts` (modified)
  3. `src/context/AuthContext.tsx` (modified)
  4. `tests/issue06_b23_realtime_sse.test.ts` (new)
- **Zero unexpected modifications:**
  - Phase 1 files (`src/services/apiClient.ts`, `src/types/childSafety.ts`, `tests/issue06_b23_api_client.test.ts`) untouched.
  - Backend routes, `server/src/realtimeEngine.ts`, `server/src/auth.ts`, Prisma schema, migrations, and env files untouched.
  - Phases 3–8 not started; zero UI redesign; zero commits or pushes.

