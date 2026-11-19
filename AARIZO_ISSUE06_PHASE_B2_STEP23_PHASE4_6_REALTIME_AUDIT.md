# AARIZO ISSUE-06 — PHASE B.2.3 — PHASE 4.6 REALTIME SSE AUDIT
## Comprehensive Architectural Audit of Child Safety Realtime Synchronization

**Audit Date:** November 19, 2026  
**Auditor:** Independent Realtime Systems & Security Reviewer  
**Repository:** `D:\AAZIRA\AARIZO`  
**Target Scope:** Phase 4.6 — Production-Grade Authenticated Realtime SSE Integration  
**Audit Classification:** STRICTLY READ-ONLY ARCHITECTURAL & GAP AUDIT  

---

## 1. Executive Summary

Phase 4.5 established real backend-authoritative resident Child Safety SOS dispatching and live read-only alert tracking. However, across the resident, security, and administrative portals, synchronization between backend state changes and UI views currently depends heavily on:
1. Manual page refreshes by the user (clicking "Refresh" buttons).
2. Ephemeral parent-to-child component refresh nonces (`alertsRefreshNonce`, `pickupsRefreshNonce`) triggered only by local, in-tab mutations.
3. Subscriptions to legacy, fictitious event topics (such as `CHILD_SAFETY_UPDATED` in `SafetyCommandHub.tsx` and `ChildGateScannerPage.tsx`).
4. Complete disconnection between the accepted Phase 3 `useChildSafetyRealtime` hook and the production `ResidentChildSafetyPanel.tsx`.

The backend already has a high-performance PostgreSQL Outbox-backed Server-Sent Events (SSE) engine (`server/src/realtimeEngine.ts`), and the frontend has a production-grade, WHATWG-compliant Fetch-based SSE client (`src/services/realtimeService.ts` and `src/services/sseFrameParser.ts`).

This audit establishes the exact current state, identifies critical gaps, defines the complete event-to-UI contract matrix, evaluates security and reliability invariants, and provides an actionable, gated implementation roadmap for Phase 4.6.

---

## 2. Detailed Inspection of Existing Realtime Architecture

### 2.1 Transport Layer: `src/services/realtimeService.ts` & `src/services/sseFrameParser.ts`
- **Transport Mechanism:** Uses authenticated `fetch()` with HTTP `Accept: text/event-stream` and `Authorization: Bearer <token>`. Never places JWT tokens in URL query strings (F-P2-01A).
- **Frame Parsing:** Pure WHATWG SSE parsing in `sseFrameParser.ts`. Supports multi-byte UTF-8 split chunks, leading UTF-8 BOM stripping, CRLF/LF normalization, bounded frame memory (default 256 KiB max frame, 128 KiB max line), and strict discarding of unterminated frames at stream EOF.
- **Replay & Reconnection:** Stores `Last-Event-ID` from valid SSE frame `id:` lines. Reconnects with bounded exponential backoff (1s base, 30s max, 500ms jitter) and honors server `retry:` and HTTP `Retry-After` headers (up to 60s max).
- **Session Epoch & Connection Key:** Guarded by `sessionEpoch` and `connectionGeneration`. Any user logout or account switch immediately aborts active streams and drops pending messages from prior sessions.
- **BroadcastChannel Elimination:** Domain events are strictly NEVER relayed over browser `BroadcastChannel` (F-P2-01B). Authenticated Fetch SSE is the sole authoritative transport.

### 2.2 Shared Realtime Hook: `src/hooks/useChildSafetyRealtime.ts`
- **Topic Allowlist:** Explicitly recognizes the 14 canonical backend Child Safety SSE topics:
  - Profiles: `CHILD_PROFILE_CREATED`, `CHILD_PROFILE_UPDATED`, `CHILD_PROFILE_ARCHIVED`
  - Pickups: `CHILD_PICKUP_AUTHORIZED`, `CHILD_PICKUP_UPDATED`, `CHILD_PICKUP_REVOKED`
  - Passes: `CHILD_GATE_PASS_GENERATED`, `CHILD_GATE_PASS_VERIFIED`, `CHILD_GATE_PASS_REVOKED`
  - Exit Logs: `CHILD_EXIT_TRIGGERED`, `CHILD_EXIT_DENIED`
  - Alerts: `CHILD_SAFETY_SOS_TRIGGERED`, `CHILD_SAFETY_ALERT_ACKNOWLEDGED`, `CHILD_SAFETY_ALERT_RESOLVED`
- **Scope Mapping:** `getInvalidatedChildSafetyScopes` deterministically maps each topic to affected cache/data scopes (`children`, `pickups`, `passes`, `exitLogs`, `alerts`), matching backend Prisma transaction cascades.
- **Defense-in-Depth Checks:** Validates active session token, user ID, and society ID before dispatching to consumer callbacks. Rejects malformed or cross-society payloads.
- **Deduplication:** Bounded FIFO deduplication window (250 event IDs). Crucially, an event ID is recorded in `seenEventIds` **only after** all consumer callbacks complete without error.
- **React Strict Mode & Ref Stability:** Uses `optionsRef` to ensure callback references remain stable across re-renders, preventing subscription churn during React 18+ double-mounts.
- **Integration Status:** Currently **100% UNUSED** by any UI component in the codebase.

### 2.3 Authentication Lifecycle: `src/context/AuthContext.tsx`
- **Mount/Unmount Lifecycle:** When `status === 'AUTHENTICATED'`, `AuthContext` calls `realtimeService.connect()` with `token`, `userId`, `societyId`, and `role`.
- **Session Invalidation:** On logout, session expiration, or unmount, `realtimeService.disconnect()` is immediately called, clearing active streams, timers, and recent message buffers.
- **App Foreground Resume:** Listens for native Capacitor app resume / window focus events and calls `realtimeService.handleNetworkResume()`.

### 2.4 Backend Event Publishing: `server/src/realtimeEngine.ts` & `server/src/childSafety/router.ts`
- **Outbox Pattern:** Backend persists events to the PostgreSQL `outbox_events` table within database transactions or publishes via `realtimeEngine.recordOutboxEvent` / `broadcastToSociety`.
- **Post-Commit Emission:** In `router.ts`, `emitChildSafetyEvent` is called strictly **AFTER** database transactions commit (`prisma.$transaction`). Zero optimistic events are published before database persistence.
- **Audience & Tenant Filtering (`isClientAuthorizedForEvent`):**
  - All `CHILD_*` events are flagged as sensitive (`SENSITIVE_EVENT_PREFIXES`).
  - Sensitive events without an explicit `EventAudiencePolicy` fail closed.
  - Prohibits delivery to `vendor`, `facility_manager`, and `delivery` roles.
  - **Resident Privacy Enforcement (`realtimeEngine.ts:167-173`):** Residents receive sensitive `CHILD_*` events **ONLY** if their verified `client.userId` is present in `targetUserIds` (the child's guardian or incident reporter). Residents NEVER receive events for other families' children over SSE.
  - Staff (`admin`, `security`, `guard`) receive events matching their society if their role is in `allowedRoles` (`GATE_AND_SOS_EVENT_ROLES`).

---

## 3. Realtime Implementation Gaps Identified

### Gap 1: `ResidentChildSafetyPanel.tsx` Lacks Realtime Subscriptions
- **Current Behavior:** `ResidentChildSafetyPanel` manages children profiles via `ctrl.loadChildren()`, pickups via `pickupsRefreshNonce`, passes via `pickupsRefreshNonce`, and alerts via `alertsRefreshNonce`. All updates rely exclusively on local form submission callbacks or manual user clicking of the "Refresh" buttons.
- **Impact:** If a security guard verifies a child's exit at the main gate, the pass becomes `USED`, the exit log is created, and the child's status becomes `OUT_OF_SOCIETY` in PostgreSQL. However, the resident's screen remains unchanged until they manually click Refresh or reload the page.
- **Impact:** If a security guard acknowledges an SOS alert or an administrator resolves it, the resident's `ResidentChildAlertsSection` continues showing the old state until manually refreshed.

### Gap 2: Topic Discrepancy in `realtimeService.ts` Topic Classification
- **Current Behavior:** In `src/services/realtimeService.ts` (lines 110–121), `CANONICAL_CHILD_SAFETY_TOPICS` lists 10 topics:
  `CHILD_PROFILE_CREATED`, `CHILD_PROFILE_UPDATED`, `CHILD_PROFILE_ARCHIVED`, `CHILD_GATE_PASS_GENERATED`, `CHILD_GATE_PASS_VERIFIED`, `CHILD_GATE_PASS_REVOKED`, `CHILD_EXIT_TRIGGERED`, `CHILD_EXIT_DENIED`, `CHILD_SAFETY_ALERT_ACKNOWLEDGED`, `CHILD_SAFETY_ALERT_RESOLVED`.
- **Missing Topics:** The 3 authorized pickup topics emitted by backend `router.ts` (`CHILD_PICKUP_AUTHORIZED`, `CHILD_PICKUP_UPDATED`, `CHILD_PICKUP_REVOKED`) are **omitted** from `CANONICAL_CHILD_SAFETY_TOPICS`.
- **Consequence:** `classifyRealtimeTopic()` treats pickup events as `category: 'UNKNOWN'`, preventing audio chime synthesis and floating alert toast notifications.

### Gap 3: `SafetyCommandHub.tsx` Subscribes to Obsolete Fictitious Topics
- **Current Behavior:** In `src/domains/safety/components/SafetyCommandHub.tsx` (lines 86–87):
  ```ts
  const unsubscribeEmergency = realTimeSync.subscribe('EMERGENCY_ALERTS', () => loadData());
  const unsubscribeChild = realTimeSync.subscribe('CHILD_SAFETY_UPDATED', () => loadData());
  ```
- **Deficiency:** The backend never emits `CHILD_SAFETY_UPDATED`. The backend emits `CHILD_SAFETY_SOS_TRIGGERED`, `CHILD_SAFETY_ALERT_ACKNOWLEDGED`, `CHILD_SAFETY_ALERT_RESOLVED`, and `EMERGENCY_INCIDENT_CREATED`.
- **Consequence:** The security staff's Command Console and Gate Verifier tabs in `SafetyCommandHub.tsx` are completely deaf to real Child Safety emergencies dispatched by residents.

### Gap 4: `ChildGateScannerPage.tsx` and `AdminChildSafetyPage.tsx` Depend on Deprecated Synchronous Mocks
- **Current Behavior:** `ChildGateScannerPage.tsx` and `AdminChildSafetyPage.tsx` call deprecated synchronous in-memory methods (`childSafetyService.getChildren()`, `getPickupLogs()`, `getSafetyAlerts()`).
- **Deficiency:** `ChildGateScannerPage.tsx` listens for `CHILD_SAFETY_UPDATED`, `CHILD_ALERT_TRIGGERED`, and `CHILD_EXIT_SCANNED` (none of which are emitted by the backend router) and attempts client-side `realtimeService.publish()` which fails-closed on network broadcast.
- **Architectural Boundary:** Phase 4 is specifically the Resident Portal. Full scanner migration to `verifyChildExitStrict` belongs to Phase 5. However, Phase 4.6 must ensure topics, contracts, and shared hooks cleanly accommodate Phase 5 scanner integration without rework.

### Gap 5: Absence of Realtime Connection & Sync Status Indicator in Resident UI
- **Current Behavior:** Residents have no visual indication whether their portal is actively connected to the realtime event stream, reconnecting during network drops, or completely offline.
- **Safety Risk:** In emergency scenarios (e.g., active missing child alert), a resident must know whether they are viewing live synchronized perimeter data or if their network connection is degraded.

---

## 4. Architecture Audit Summary & Verdict

| Architectural Area | Audit Finding | Severity | Phase 4.6 Remediation |
| :--- | :--- | :---: | :--- |
| **Transport Layer** | WHATWG Fetch SSE conforms to all security and replay specifications. No token in URL. Bounded frame memory. | Clean | Preserve untouched. |
| **Topic Allowlist** | `realtimeService.ts` omits 3 pickup topics from `CANONICAL_CHILD_SAFETY_TOPICS`. | Low | Add 3 pickup topics to canonical classification sets. |
| **Shared Hook** | `useChildSafetyRealtime.ts` is fully implemented and tested with cascade invalidation, but unintegrated. | High | Wire into `ResidentChildSafetyPanel.tsx`. |
| **Resident UI** | `ResidentChildSafetyPanel` lacks realtime listeners; data remains stale without manual refresh. | High | Integrate `useChildSafetyRealtime` with debounced, scoped refreshes. |
| **Staff Command Hub** | `SafetyCommandHub` listens to obsolete fictitious topic `CHILD_SAFETY_UPDATED`. | Medium | Replace with canonical Child Safety SSE topics. |
| **Emergency Audio/Toast** | Emergency SOS audio chimes and floating toasts operate correctly for `CHILD_SAFETY_SOS_TRIGGERED`. | Clean | Preserve untouched. |
| **Tenant & Privacy** | Backend enforces strict tenant isolation and resident user ID ownership filtering for sensitive events. | Clean | Preserve untouched. |

**Audit Verdict:**  
`CONDITIONAL READY — ARCHITECTURE IS SOUND; 4 TARGETED INTEGRATION GAPS IDENTIFIED FOR EXECUTION IN PHASE 4.6.`

