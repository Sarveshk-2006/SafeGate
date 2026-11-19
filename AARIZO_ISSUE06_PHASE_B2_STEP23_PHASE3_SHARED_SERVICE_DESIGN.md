# AARIZO — ISSUE-06 | B.2.3 | Phase 3 Shared Service Design Specification

**Date:** 2026-11-18  
**Primary Module:** `src/services/childSafetyService.ts`  
**Supporting Modules:** `src/domains/safety/services/safetyCommandEngine.ts`, `src/repositories/childSafety/ChildRepository.ts`, `src/hooks/useChildSafetyRealtime.ts`

---

## 1. Canonical Asynchronous Service Contract (`childSafetyService`)

All 20 canonical async operations strictly delegate to Phase 1 `apiClient.*Strict` methods (`src/services/apiClient.ts`) using Phase 1 DTOs (`src/types/childSafety.ts`) and preserve `ApiError` intact:

| # | Facade Method | Phase 1 Strict API Method | Backend Route | Post-Confirm Invalidation Scopes |
| :---: | --- | --- | --- | --- |
| 1 | `listChildren(params?)` | `apiClient.getChildrenStrict` | `GET /api/children` | Refreshes ephemeral snapshot |
| 2 | `getChildById(id)` | `apiClient.getChildByIdStrict` | `GET /api/children/:id` | Read-only |
| 3 | `createChildProfileAsync(data)` | `apiClient.createChildStrict` | `POST /api/children` | `['children']` |
| 4 | `updateChildProfile(id, data)` | `apiClient.updateChildStrict` | `PATCH /api/children/:id` | `['children']` |
| 5 | `archiveChildProfile(id)` | `apiClient.archiveChildStrict` | `POST /api/children/:id/archive` | `['children', 'pickups', 'passes']` |
| 6 | `listAuthorizedPickups(childId)` | `apiClient.getChildPickupsStrict` | `GET /api/children/:childId/pickups` | Read-only |
| 7 | `addAuthorizedPickup(childId, data)` | `apiClient.addChildPickupStrict` | `POST /api/children/:childId/pickups` | `['pickups', 'children']` |
| 8 | `updateAuthorizedPickup(childId, pickupId, data)` | `apiClient.updateChildPickupStrict` | `PATCH /api/children/:childId/pickups/:pickupId` | `['pickups', 'children']` |
| 9 | `revokeAuthorizedPickup(childId, pickupId)` | `apiClient.revokeChildPickupStrict` | `POST /api/children/:childId/pickups/:pickupId/revoke` | `['pickups', 'passes', 'children']` |
| 10 | `archiveAuthorizedPickup(childId, pickupId)` | `apiClient.archiveChildPickupStrict` | `DELETE /api/children/:childId/pickups/:pickupId` | `['pickups', 'passes', 'children']` |
| 11 | `listGatePasses(params?)` | `apiClient.getChildPassesStrict` | `GET /api/children/passes` | Refreshes ephemeral snapshot |
| 12 | `getGatePassById(id)` | `apiClient.getChildPassByIdStrict` | `GET /api/children/passes/:id` | Read-only |
| 13 | `createGatePass(data, options?)` | `apiClient.createChildPassStrict` | `POST /api/children/passes` | `['passes']` *(one-time `bearerToken`/`qrPayload` NEVER cached/persisted)* |
| 14 | `revokeGatePass(id, data?)` | `apiClient.revokeChildPassStrict` | `POST /api/children/passes/:id/revoke` | `['passes']` |
| 15 | `verifyGatePass(data)` | `apiClient.verifyChildPassStrict` | `POST /api/children/passes/verify` | `['passes', 'exitLogs', 'children']` |
| 16 | `listExitLogs(params?)` | `apiClient.getChildExitLogsStrict` | `GET /api/children/exit-logs` | Refreshes ephemeral snapshot |
| 17 | `triggerSos(data)` | `apiClient.triggerChildSosStrict` | `POST /api/children/sos` | `['alerts', 'children']` |
| 18 | `listAlerts(params?)` | `apiClient.getChildAlertsStrict` | `GET /api/children/alerts` | Refreshes ephemeral snapshot |
| 19 | `acknowledgeAlert(id)` | `apiClient.acknowledgeChildAlertStrict` | `POST /api/children/alerts/:id/acknowledge` | `['alerts']` |
| 20 | `resolveAlert(id, data)` | `apiClient.resolveChildAlertStrict` | `POST /api/children/alerts/:id/resolve` | `['alerts', 'children']` |

---

## 2. Security, Tenant Context & Data Consistency Invariants

1. **Zero Hardcoded Tenant Fallbacks:** `sanitizeSocietyFilter()` strips client-supplied `societyId` for all non-platform-admin callers so the backend derives tenant identity exclusively from the verified JWT. Verified platform admins (`role === 'admin'` with sentinel/empty `societyId`) may forward an explicit concrete `societyId` filter.
2. **Strict Error Preservation & Safe Formatting:**
   - Every async method rethrows `ApiError` unmodified (preserving `status`, `kind`, `code`, `endpoint`, `payload`, `retryAfterSeconds`).
   - `formatChildSafetyError(err)` maps every `ApiErrorKind` (`UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `UNAVAILABLE`, `NETWORK`, `INVALID_RESPONSE`, `SERVER_ERROR`) into safe UI-facing `{ title, message, kind, code, status, retryAfterSeconds, isRetryable }` without leaking backend stack traces or credentials.
3. **Ephemeral In-Memory Snapshot Only (Not a Second Source of Truth):**
   - Bound to `getCurrentSessionFingerprint()` (`userId:societyId:role` + active `getAuthToken()`). Automatically cleared on logout, user switch, society switch, role switch, or `clearInMemoryState()`.
   - Never persisted to `localStorage` or `sessionStorage`.
   - Never returned as a fallback when a backend `list*` or `get*` request fails.
   - Never stores `bearerToken`, `qrPayload`, or raw government ID numbers.
4. **Invalidation Bus (`onCacheInvalidated` / `notifyInvalidation`):**
   - Fired strictly **after** backend confirmation of canonical mutations, on authenticated SSE events (`useChildSafetyRealtime`), on SSE reconnect (`reason: 'reconnect'`), and on session reset (`reason: 'session_reset'`).

---

## 3. Split-Brain Store Consolidation Map

| Obsolete Store / Module | Previous Behavior | Phase 3 Disposition |
| --- | --- | --- |
| `childSafetyService.ts` (`communityos_children_profiles`, `communityos_child_pickup_qrs`, `communityos_child_pickup_logs`, `communityos_child_safety_alerts`, `SEED_CHILDREN`) | Read/wrote localStorage + demo seeds + fire-and-forget legacy API stubs + Firestore `childRepository.create` | **Eliminated.** Replaced with canonical async backend-authoritative facade + fail-closed deprecated sync adapters. |
| `safetyCommandEngine.ts` (`aarizo_child_profiles_v3`, `aarizo_pickup_records_v3`, `INITIAL_CHILDREN`, `childSafetyService.getChildren('soc-gvs')`) | Read from `'soc-gvs'` while writing mutations into competing `aarizo_child_profiles_v3` / `aarizo_pickup_records_v3` | **Eliminated.** Child Safety localStorage stores removed; deprecated sync reads project from `childSafetyService` memory snapshot; deprecated sync writes/verify fail closed. General `EmergencyIncident` methods preserved separately. |
| `ChildRepository.ts` (Firestore `children` collection) | Fire-and-forget `childRepository.create(updated)` containing raw `idProofNumber` | **Disconnected & `@deprecated`.** Zero runtime callers remain; scheduled for file deletion in Phase 7. |
| `safetyCommandService.ts` (`communityos_emergency_incidents`) | General `EmergencyIncident` workflows for `SecurityEmergencyTerminalPage` and `societyIntelligenceService` | **Preserved untouched** (distinct domain from Child Safety). |

