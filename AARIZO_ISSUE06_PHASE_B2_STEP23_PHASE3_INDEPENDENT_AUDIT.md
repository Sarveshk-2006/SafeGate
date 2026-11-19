# AARIZO ISSUE-06 — Phase B.2.3 — Phase 3 Independent Verification Audit

**Audit Date:** 2026-11-18  
**Repository:** `D:\AAZIRA\AARIZO`  
**Audit Mode:** Strictly Read-Only Independent Verification (zero edits to application source, tests, backend, schema, migrations, env, or config; zero commits/pushes; Phase 4 NOT started)  
**Final Verdict:** **`PHASE 3 INDEPENDENT AUDIT — CONDITIONAL PASS, TARGETED FIXES REQUIRED`**

---

## 1. Executive Summary

Independent line-by-line inspection of the Phase 3 implementation confirmed that the core architecture is sound:
- All **20 canonical asynchronous operations** in `src/services/childSafetyService.ts` accurately delegate to Phase 1 `apiClient.*Strict` methods, match backend routes/DTOs in `server/src/childSafety/router.ts`, preserve `ApiError`, strip untrusted non-admin `societyId`, and never write Child Safety records, raw government IDs, `bearerToken`, or `qrPayload` to `localStorage`/`sessionStorage`.
- All competing localStorage Child Safety stores (`communityos_children_profiles`, `communityos_child_pickup_qrs`, `communityos_child_pickup_logs`, `communityos_child_safety_alerts`, `aarizo_child_profiles_v3`, `aarizo_pickup_records_v3`), `SEED_CHILDREN`, `INITIAL_CHILDREN`, hardcoded `'soc-gvs'`/`'soc-1'` fallbacks, and Firestore `childRepository.create` writes have been eliminated.
- General `EmergencyIncident` workflows (`src/services/safetyCommandService.ts` and `safetyCommandEngine.ts` incident methods) remain cleanly separated and intact.
- TypeScript checks (`npx tsc --noEmit`), production build (`npm run build`), static scans (`0` `EventSource`, `0` active `BroadcastChannel`/`postMessage`, `0` query-string tokens), and all executed automated Jest tests (`456/456` executed offline; `11` live PG tests skipped) pass.

However, forensic read-only review uncovered **three bounded defects blocking Phase 4** — including **one HIGH session-isolation race (`F-P3-01`)**, **one MEDIUM-HIGH realtime cascade/tenant/replay defect (`F-P3-02`)**, and **one MEDIUM test coverage gap (`F-P3-03`)** — plus one non-blocking transitional observation (`F-P3-04`).

---

## 2. Master Finding Register

### `F-P3-01` — HIGH — **BLOCKS PHASE 4**
- **Title:** Cross-Session In-Flight Snapshot Pollution, Filtered Snapshot Overwrite & Stale Post-Mutation Snapshot Retention in `ChildSafetyService`
- **Exact File & Line References:** `src/services/childSafetyService.ts#L455-L472` (`listChildren`), `#L570-L589` (`listGatePasses`), `#L652-L670` (`listExitLogs`), `#L696-L714` (`listAlerts`), `#L429-L448` (`notifyInvalidation`).
- **Reproduction / Evidence:**
  ```ts
  // childSafetyService.ts#L456-L470
  this.syncSnapshotSession();
  ...
  const children = await apiClient.getChildrenStrict(requestParams);
  this.syncSnapshotSession();
  if (this.snapshotSessionFingerprint) {
    this.childrenSnapshot = children; // <-- Does NOT compare pre-await vs post-await fingerprint!
  }
  ```
  1. **Cross-session race:** User A initiates `listChildren()`. While the HTTP request is in flight, User A logs out and User B logs in. When User A's response resolves, `this.syncSnapshotSession()` updates `this.snapshotSessionFingerprint` to User B's fingerprint, `if (this.snapshotSessionFingerprint)` evaluates truthy, and **User A's child/pass/exit-log/alert records are written into User B's `childrenSnapshot` / `passesSnapshot` / `exitLogsSnapshot` / `alertsSnapshot`**.
  2. **Filtered / alternate-society overwrite:** Calling `listGatePasses({ childId: 'chd-1', status: 'REVOKED' })`, `listAlerts({ status: 'RESOLVED' })`, `listChildren({ includeArchived: true })`, or a platform admin calling `listChildren({ societyId: 'soc-beta' })` overwrites the unfiltered snapshot with partial or other-society rows.
  3. **Post-mutation stale snapshot:** `notifyInvalidation()` notifies listeners without clearing stale entries in `childrenSnapshot`/`passesSnapshot`/`exitLogsSnapshot`/`alertsSnapshot`.
- **Actual Impact:** Cross-user/cross-tenant data leak into compatibility read projections (`getChildren()`, `getPickupQRs()`, `getPickupLogs()`, `getSafetyAlerts()`) during fast user switching on shared devices, plus stale/partial snapshot corruption.
- **Required Correction:**
  1. Capture `const requestFp = this.snapshotSessionFingerprint;` BEFORE `await` in `listChildren`, `listGatePasses`, `listExitLogs`, and `listAlerts`.
  2. Update the ephemeral snapshot ONLY when `requestFp !== null && this.snapshotSessionFingerprint === requestFp` AND the query is unfiltered (no `childId`, `status`, `includeArchived`, `offset`, or platform-admin cross-society filter).
  3. Clear affected ephemeral snapshot arrays inside `notifyInvalidation()` whenever `scopes` includes `'children'`, `'passes'`, `'exitLogs'`, `'alerts'`, or `'all'`.

### `F-P3-02` — MEDIUM-HIGH — **BLOCKS PHASE 4**
- **Title:** Incomplete Realtime Cascade Invalidation Scopes, Missing Client-Side Society/Auth Guard, and Callback-Exception Replay Suppression in `useChildSafetyRealtime.ts`
- **Exact File & Line References:** `src/hooks/useChildSafetyRealtime.ts#L101-L120` (`getInvalidatedChildSafetyScopes`), `#L164-L217` (`handleMessage`), `#L226-L245` (`subscribeToStatus`); compared against `server/src/childSafety/router.ts#L2115-L2155` & `#L2520-L2555`.
- **Reproduction / Evidence:**
  1. **Missing cascade scopes vs backend transactions:** `server/src/childSafety/router.ts#L2520-L2533` atomically revokes active `ChildGatePass` records when emitting `CHILD_PICKUP_REVOKED`, and `#L2115-L2155` atomically revokes/archives passes & pickups when emitting `CHILD_PROFILE_ARCHIVED`. Yet `getInvalidatedChildSafetyScopes()` returns only `['pickups', 'children']` for `CHILD_PICKUP_REVOKED` (missing `'passes'`) and only `['children']` for `CHILD_PROFILE_ARCHIVED` (missing `'pickups', 'passes'`). Other tabs listening via `useChildSafetyRealtime` will NOT refresh gate passes after a child archive or pickup revocation!
  2. **Missing defense-in-depth society & auth check:** `handleMessage()` does not check `getAuthToken() && getStoredUser()` or reject events whose non-empty `msg.societyId` mismatches the active non-platform-admin user's `societyId`, permitting cross-society cache invalidation if a mismatched event ever reaches the subscriber. In addition, `status.state === 'OFFLINE'` clears `seenEventIds` but does not eagerly invoke `childSafetyService.clearInMemoryState()`.
  3. **Callback exception suppresses replay:** `seenEventIds.add(eventId)` executes at `#L172` BEFORE `options.onEvent`/`onProfilesChange`/etc. (`#L210-L216`). If any consumer callback throws, subsequent sibling callbacks are skipped AND `eventId` remains permanently suppressed in `seenEventIds` across replay!
- **Actual Impact:** Stale active gate passes shown on guard/resident/admin tabs after remote pickup revocation or child archival; potential cross-society cache invalidation; broken replay recovery when a UI callback throws.
- **Required Correction:**
  1. Map `CHILD_PROFILE_ARCHIVED` → `['children', 'pickups', 'passes']` and `CHILD_PICKUP_REVOKED` → `['pickups', 'passes', 'children']` inside `getInvalidatedChildSafetyScopes()`.
  2. In `handleMessage()`, fail closed if `!getAuthToken() || !getStoredUser()`, and for non-platform-admin sessions ignore events whose non-empty `msg.societyId` !== active user's `societyId`. Call `childSafetyService.clearInMemoryState()` on `status.state === 'OFFLINE'`.
  3. Wrap each user callback (`onEvent`, `onProfilesChange`, etc.) in independent `try/catch`, track `hadError`, evict `eventId` from `seenEventIds` on error, and rethrow a single aggregated error so `RealtimeService` preserves `lastEventId` for replay recovery!

### `F-P3-03` — MEDIUM — **BLOCKS PHASE 4**
- **Title:** Phase 3 Test Suite Coverage Gaps (Mutation Failure Invalidation, Session-Switch Race, Cross-Society Realtime, Cascade Scopes, Hook Lifecycle & `societyIntelligenceService`)
- **Exact File & Line References:** `tests/issue06_b23_child_safety_data_layer.test.ts#L343-L796`.
- **Reproduction / Evidence:**
  - Only 5 of 20 operations have failure tests; **0** mutation failure tests verify that failed mutations (`createChildProfileAsync`, `addAuthorizedPickup`, `createGatePass`, `revokeGatePass`, `triggerSos`, `resolveAlert`) do NOT emit `notifyInvalidation()`.
  - No test exercises the `F-P3-01` in-flight session-switch snapshot race or filtered-query overwrite.
  - No test verifies cross-society realtime rejection, `CHILD_PROFILE_ARCHIVED`/`CHILD_PICKUP_REVOKED` cascade pass invalidation, invented-topic filtering, or callback-exception replay recovery (`F-P3-02`).
  - No test exercises the React hook `useChildSafetyRealtime()` directly (Strict Mode mount/unmount/remount + re-render ref stability).
  - No test exercises `societyIntelligenceService.getAnalytics()` consuming `safetyCommandService.getIncidents()`.
- **Actual Impact:** Allowed `F-P3-01` and `F-P3-02` to ship undetected despite 7/7 passing tests.
- **Required Correction:** Expand `tests/issue06_b23_child_safety_data_layer.test.ts` with targeted behavioral tests for every gap listed above.

### `F-P3-04` — LOW / INFORMATIONAL — **DOES NOT BLOCK PHASE 4**
- **Title:** Transitional Unmigrated Portal Pages (Phases 4–6) Do Not Catch Deprecated Sync Mutation Errors Yet & Do Not Subscribe to `useChildSafetyRealtime` Yet
- **Exact File & Line References:** `src/domains/safety/components/SafetyCommandHub.tsx#L133, #L157`, `src/pages/dashboard/security/ChildGateScannerPage.tsx#L80`, `src/pages/dashboard/admin/AdminChildSafetyPage.tsx#L42`.
- **Evidence:** Clicking legacy sync write buttons in unmigrated Phase 4/5/6 UI pages throws `ApiError('LEGACY_SYNC_API_DEPRECATED')` uncaught in the click handler (fail-closed, zero fake localStorage writes). Likewise, no UI page currently wires `useChildSafetyRealtime` or `childSafetyService.onCacheInvalidated` to trigger live backend refetches — that wiring is explicitly designated for Phases 4, 5, and 6.
- **Required Correction:** Complete consumer migrations in Phases 4 (Resident), 5 (Security), and 6 (Admin), then retire legacy sync adapters in Phase 7.

---

## 3. Prioritized Remediation Plan Before Phase 4

1. **P0 (`F-P3-01`):** Guard ephemeral snapshot writes with pre-`await` `requestFp` equality + unfiltered-query check, and clear affected snapshots in `notifyInvalidation()`.
2. **P1 (`F-P3-02`):** Add cascade scopes for `CHILD_PROFILE_ARCHIVED` & `CHILD_PICKUP_REVOKED`, add client-side auth/society guard + `OFFLINE` state purge, and isolate/evict `seenEventIds` + propagate error on callback failure.
3. **P2 (`F-P3-03`):** Add focused behavioral tests covering mutation failure non-invalidation, session-switch snapshot race, cross-society realtime rejection, cascade scopes, invented topic filtering, callback exception replay recovery, `useChildSafetyRealtime` hook lifecycle, and `societyIntelligenceService` preservation.

---

**PHASE 3 INDEPENDENT AUDIT — CONDITIONAL PASS, TARGETED FIXES REQUIRED**

