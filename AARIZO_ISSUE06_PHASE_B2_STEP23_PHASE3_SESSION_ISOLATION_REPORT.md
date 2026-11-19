# AARIZO ISSUE-06 — Phase B.2.3 — Phase 3 Session-Safe Snapshot Isolation Report (`F-P3-01`)

**Date:** 2026-11-18  
**Repository:** `D:\AAZIRA\AARIZO`  
**Target File:** `src/services/childSafetyService.ts`  
**Finding Addressed:** `F-P3-01` (HIGH) — Cross-session in-flight snapshot pollution, filtered-query overwrite, and stale post-mutation snapshot retention.

---

## 1. Root Causes Identified by Independent Audit

1. **In-flight session-switch race:** `listChildren()`, `listGatePasses()`, `listExitLogs()`, and `listAlerts()` did not capture the pre-`await` session fingerprint or session revision before awaiting HTTP responses. If User A started a fetch, logged out, and User B logged in before User A's response resolved, `syncSnapshotSession()` refreshed `snapshotSessionFingerprint` to User B and wrote User A's records into User B's snapshot.
2. **Filtered & cross-society overwrite:** Calling `listGatePasses({ status: 'REVOKED' })`, `listGatePasses({ childId })`, `listChildren({ includeArchived: true })`, `listAlerts({ status: 'RESOLVED' })`, or a platform admin calling `listChildren({ societyId: 'soc-beta' })` overwrote the single flat snapshot array used by deprecated read adapters (`getChildren`, `getPickupQRs`, `getPickupLogs`, `getSafetyAlerts`).
3. **Stale post-mutation snapshots:** `notifyInvalidation()` notified listeners without evicting stale entries from in-memory snapshots.

---

## 2. Implemented Corrections in `src/services/childSafetyService.ts`

### A. Session Fingerprint, Revision & Per-Resource Version Guards
- Replaced flat arrays (`childrenSnapshot`, `passesSnapshot`, `exitLogsSnapshot`, `alertsSnapshot`) with a bounded, session- and scope-keyed map (`scopedSnapshots: Map<string, ScopedSnapshotEntry>`, FIFO cap `MAX_SCOPED_SNAPSHOTS = 64`), `sessionRevision`, and per-resource `resourceVersions` (`children`, `passes`, `exitLogs`, `alerts`).
- Added `captureRequestSessionContext(resource?)` called **before `await`** in all 4 list reads (`listChildren`, `listGatePasses`, `listExitLogs`, `listAlerts`) and all 13 mutations (`createChildProfileAsync`, `updateChildProfile`, `archiveChildProfile`, `addAuthorizedPickup`, `updateAuthorizedPickup`, `revokeAuthorizedPickup`, `archiveAuthorizedPickup`, `createGatePass`, `revokeGatePass`, `verifyGatePass`, `triggerSos`, `acknowledgeAlert`, `resolveAlert`).
- Added `isSessionContextStillValid(ctx, resource?)` called **after `await`**:
  - Rejects and discards any snapshot write if the active `getCurrentSessionFingerprint()` changed, became `null` (logout), `sessionRevision` incremented (including same-user `clearInMemoryState()` mid-flight), or `resourceVersions[resource]` advanced due to an intervening invalidation/mutation.
  - Prevents in-flight mutations from User A from emitting `notifyInvalidation()` into User B's replacement session.
- Registered a `window.addEventListener('aarizo:unauthorized', ...)` handler in `ChildSafetyService` constructor so HTTP 401 unauthorized events eagerly invoke `clearInMemoryState()`.

### B. Structured Scoped Keys & Filtered-Query Isolation
- Every snapshot entry is keyed by `${sessionFingerprint}|${societyScope}|${resource}|${filterKey}` via `buildSnapshotFilterKey()`.
- Unfiltered queries for the active user's default society write under `filterKey = 'default'` with `isDefaultScope = true`.
- Filtered queries (`includeArchived`, `childId`, `status`, `limit`, `offset`, or platform-admin explicit `societyId`) write under their own distinct `filterKey` with `isDefaultScope = false`, **never overwriting** the `'default'` entry.
- Deprecated compatibility read adapters (`getChildren`, `getPickupQRs`, `getPickupLogs`, `getSafetyAlerts`) read **exclusively** via `getDefaultSnapshot(resource, societyId)`:
  - Returns `[]` when unauthenticated or when no valid default snapshot exists for the current session fingerprint.
  - Fails closed (`[]`) if a non-platform-admin supplies a `societyId` argument differing from the active session's society.
- `createGatePass()` never writes `bearerToken` or `qrPayload` to `scopedSnapshots` or any storage.

### C. Scoped Invalidation Eviction & Backend-Aligned Cascade
- `notifyInvalidation(scopes, reason, meta)` now calls `evictSnapshotsForScopes(scopes)` **before** invoking listeners:
  - `'all'` clears all entries and increments all `resourceVersions`.
  - Scoped invalidations (`'children'`, `'passes'`, `'exitLogs'`, `'alerts'`) delete **only** entries matching affected resources while preserving unrelated resource snapshots intact.
- `updateAuthorizedPickup()` now inspects `updated.status`: if `REVOKED` or `EXPIRED`, it invalidates `['pickups', 'passes', 'children']` (matching `server/src/childSafety/router.ts#L2447-L2462`), otherwise `['pickups', 'children']`.
- Failed mutations rethrow `ApiError` and never call `notifyInvalidation()`.

---

## 3. Verification Evidence

Verified in `tests/issue06_b23_child_safety_data_layer.test.ts` (Section 5 — 7 dedicated behavioral tests, all passing):
- Deferred-Promise User A → User B session switch across `listChildren`, `listGatePasses`, `listExitLogs`, and `listAlerts` leaves User B's projections strictly empty (`[]`).
- Mid-flight logout and same-user `clearInMemoryState()` discard stale responses.
- Mid-flight User A mutation across session switch emits `0` invalidations into User B.
- Filtered queries (`includeArchived`, `status`, `childId`, `limit`) and platform-admin `societyId: 'soc-beta'` queries do not overwrite default snapshots; non-admin `getChildren('soc-beta')` returns `[]`.
- Scoped invalidation (`revokeGatePass`, `acknowledgeAlert`, `updateAuthorizedPickup`) evicts only affected scopes and preserves unrelated snapshots.
- All 13 mutation endpoints failing with HTTP 400/403/404/409/429/500/503 preserve `ApiError` and emit `0` invalidations.

