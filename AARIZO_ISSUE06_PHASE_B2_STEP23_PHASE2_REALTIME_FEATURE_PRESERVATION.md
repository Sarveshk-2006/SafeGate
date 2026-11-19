# AARIZO — ISSUE-06 / B.2.3 / Phase 2 Real-Time Feature Preservation Audit

**Audit Date:** 2026-11-18  
**Consumers Audited:** Resident Portal (`VisitorHome`, `PaymentsHome`, `SafetyHome`, `SupportHome`, `CommunityHome`, `NotificationCenter`, `ResidentBillingPage`, `ResidentAmenityBookingPage`, `ResidentGuestStayPage`), Security Terminal (`SecurityTerminalPage`, `SecurityEmergencyTerminalPage`, `ChildGateScannerPage`, `GuestStayScannerPage`), Admin Portal (`RealtimeOperationsHubPage`, `DeliveryIntelligencePage`, `SecretaryShell`, `CommitteeDashboard`), Shared Infrastructure (`RealtimeLiveBar`, `useRealtime`, `realTimeSync`, `AuthContext`, `visitorService`, `amenityService`, `billingService`, `childSafetyService`, `notificationService`, `parkingService`, `safetyCommandService`, `societyService`, `staffService`) — **90 consumer imports across `src/`**.

---

## 1. Feature Preservation Verification Checklist

| # | Requirement | Verified Status | Evidence |
| :---: | --- | :---: | --- |
| 1 | Authenticated Fetch SSE is exclusive network source of domain-event payloads | **PASS** | `openFetchSseStream()` (`realtimeService.ts#L675-L880`) → `processSseFrame()` (`#L884-L971`) → `handleIncomingMessage(..., 'SSE', epoch)`; zero `EventSource`, zero `BroadcastChannel`. |
| 2 | Existing authorized subscribers still receive supported events | **PASS** | `subscribe(topic | '*', cb)` (`#L1422`), `subscribeToAlerts(cb)` (`#L1392`), `subscribeToStatus(cb)` (`#L1402`), `useRealtimeTopic`/`useRealtimeStream` (`src/hooks/useRealtime.ts`), `realTimeSync` (`src/services/realTimeSync.ts`) all preserved and compiling cleanly (`tsc --noEmit` exit `0`). |
| 3 | Society and role filtering still works | **PASS** | Backend `isClientAuthorizedForEvent()` (`server/src/realtimeEngine.ts#L113-L187`) + `handleSseSubscription()` (`#L565-L609`) enforce tenant/role/owner filtering server-side; client sends only verified Bearer JWT + optional non-sentinel `societyId` (`buildStreamUrl()`, `#L663-L673`), and resets cursors/caches on society/role switch. |
| 4 | `Last-Event-ID` replay still works | **PASS** | Valid cursor stored post-dispatch and transmitted via `Last-Event-ID` header (`#L700-L702`); preserved across same-identity token refresh; reset on logout, empty `id:`, and user/society/role switch. |
| 5 | Reconnect, retry, and bounded backoff remain functional | **PASS** | Exponential backoff (`1s → 2s → 4s → ... → 30s` + jitter), `429`/`503` `Retry-After` (delta-seconds + HTTP-date capped at `60s`), `408` retry, `400`/`403`/`404`/permanent `4xx` non-retrying `OFFLINE`, `handleNetworkResume()`, and `RealtimeLiveBar` `forceReconnect()` all verified passing. |
| 6 | Session refresh, logout, user switch, and invalidation remain correct | **PASS** | `AuthContext.tsx` synchronously disconnects SSE on logout, Firebase `!firebaseUser`, claims/profile mismatch, `aarizo:unauthorized`, and cross-tab `storage` logout; reconnects with refreshed token on `tokenRevision` increment. |
| 7 | No duplicate event delivery introduced | **PASS** | Bounded 500-ID FIFO `seenMessageIds` deduplication + `Set`-based subscriber registry prevents duplicate identical callback invocation. |
| 8 | Subscriber exceptions do not corrupt replay cursor state | **PASS** | Independent `try/catch` around topic, wildcard, and alert subscribers; failed `msg.id` evicted from `seenMessageIds` (`#L1364-L1368`) and `lastEventId` does not advance when `hadSubscriberError === true` (`#L964`). |
| 9 | Legitimate emergency and security events reach authorized UI consumers | **PASS** | Authenticated SSE delivery of `EMERGENCY_ALERT`, `EMERGENCY_ALERTS`, `EMERGENCY_INCIDENT_CREATED`, `CHILD_SAFETY_SOS_TRIGGERED`, and `SECURITY_ALERT_CREATED` delivers to subscribers AND triggers appropriate audio, haptics, and role-aware alert toasts (`RealtimeLiveBar` `RealtimeToastContainer`). |
| 10 | Existing public announcement and non-sensitive events work per backend audience policy | **PASS** | `ANNOUNCEMENT_CREATED` and backend-aligned public operational prefixes (`CANONICAL_PUBLIC_NETWORK_BROADCAST_PREFIXES`) remain supported on both SSE and authenticated `/api/realtime/broadcast` POSTs. |

---

## 2. Honest Assessment of `BroadcastChannel` Removal Impact on Legacy Consumers

- **Connected / Production Mode (Backend Running):** **Zero functional loss.** Every authenticated browser tab maintains its own authenticated Fetch SSE stream to `/api/realtime/stream` and receives all authorized updates from PostgreSQL outbox delivery (`server/src/realtimeEngine.ts`). Cross-tab logout and token sync continue working via `AuthContext.tsx` `storage` events.
- **Offline / Local-Mock-Only Two-Tab Mode (Honest Disclosure):** Legacy UI components that have not yet migrated off local mock services (e.g., `SafetyHome.tsx` / `SecurityEmergencyTerminalPage.tsx` calling `safetyCommandService` + `realtimeService.publish`, `RealtimeOperationsHubPage.tsx` manual test publisher, and `childSafetyService.ts` prior to Phase 3) still update **in-tab** subscribers via local `publish()`, but will no longer cross-tab broadcast mock payloads when no backend server is running. This is an intentional, security-necessary trade-off under `F-P2-01B`; `storage` events are explicitly **not** used as a domain-event substitute.
- **Cosmetic UI Copy Note (Out of Phase 2 Scope):** Static descriptive labels mentioning "BroadcastChannel" remain in `src/domains/notifications/components/NotificationEngineHub.tsx:348` and `src/pages/dashboard/admin/RealtimeOperationsHubPage.tsx:421` (pure UI text, zero runtime channel code; intentionally left untouched to respect Phase 2 scope).

