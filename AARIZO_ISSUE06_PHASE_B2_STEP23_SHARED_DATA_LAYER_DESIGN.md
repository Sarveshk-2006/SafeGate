# AARIZO — ISSUE-06 Phase B.2.3: Shared Data Layer Consolidation Design

**Objective:** Resolve the three competing `localStorage`-backed safety stores (`childSafetyService.ts`, `safetyCommandEngine.ts`, `safetyCommandService.ts`) plus deprecated `ChildRepository.ts` into a single, authoritative, backend-backed Child Safety service layer without breaking any existing consumer during stepwise migration.

---

## 1. Complete Inventory of Competing Stores, Public Methods & Consumers

### Store A: `src/services/childSafetyService.ts` (626 lines)
*Current Backing:* 4 `localStorage` keys (`communityos_children_profiles`, `communityos_child_pickup_qrs`, `communityos_child_pickup_logs`, `communityos_child_safety_alerts`), hardcoded `SEED_CHILDREN` (with raw fake IDs), `societyService.getFamilyMembers()`, `db.ts`, broken `childRepository.create()` (`403`), broken fire-and-forget `apiClient.*`, and blocked `realtimeService.publish()`.

| Existing Public Method | Verified Consumers | Target Disposition | Migration Path |
| :--- | :--- | :--- | :--- |
| `getChildren(societyId)` | `AdminChildSafetyPage.tsx#L36`, `safetyCommandEngine.ts#L313` | **Replace with async `listChildren(opts?)`** -> `GET /api/children` | Phase 3 adds async method; Phase 4 & 6 migrate callers; Phase 7 deletes sync method. |
| `saveChildProfile(profile)` | Internal only (called by `createChildProfile`, `add/revokeAuthorizedPickupPerson`, `verifyAndScanChildPickup`, `trigger/resolveSafetyAlert`) | **Obsolete — Delete in Phase 7** | Replaced by granular `createChild`, `updateChild`, `archiveChild`, and dedicated pickup endpoints. |
| `createChildProfile(...)` | Zero external callers (legacy API) | **Replace with async `createChild(payload)`** -> `POST /api/children` | Phase 3 adds async method; Phase 4 & 6 wire modals; Phase 7 deletes sync method. |
| `addAuthorizedPickupPerson(...)` | Zero external callers | **Replace with async `addAuthorizedPickup(childId, payload)`** -> `POST /api/children/:childId/pickups` | Phase 3 adds async method (strictly `idDocumentType` + optional `idDocumentLast4`); Phase 7 deletes sync method. |
| `revokeAuthorizedPickupPerson(...)` | Zero external callers | **Replace with async `revokeAuthorizedPickup(childId, pickupId, reason?)`** -> `POST /api/children/:childId/pickups/:pickupId/revoke` | Phase 3 adds async method; Phase 7 deletes sync method. |
| `getPickupQRs(societyId)` | `ChildGateScannerPage.tsx#L54` | **Replace with async `listGatePasses(filters?)`** -> `GET /api/children/passes` | Phase 3 adds async method; Phase 5 migrates `ChildGateScannerPage`; Phase 7 deletes sync method. |
| `generatePickupQR(...)` | Zero external callers | **Replace with async `createGatePass(payload)`** -> `POST /api/children/passes` (returns one-time `bearerToken` + `qrPayload`) | Phase 3 adds async method; Phase 4 wires Resident modal; Phase 7 deletes sync method & client `CP-QR-` generator. |
| `verifyAndScanChildPickup(...)` | `ChildGateScannerPage.tsx#L61` | **Replace with async `verifyGatePass(payload)`** -> `POST /api/children/passes/verify` | Phase 3 adds async method; Phase 5 migrates `ChildGateScannerPage`; Phase 7 deletes local verification logic completely. |
| `getPickupLogs(societyId)` | `AdminChildSafetyPage.tsx#L37`, `ChildGateScannerPage.tsx#L55` | **Replace with async `listExitLogs(filters?)`** -> `GET /api/children/exit-logs` | Phase 3 adds async method; Phase 5 & 6 migrate pages; Phase 7 deletes sync method. |
| `getSafetyAlerts(societyId)` | `AdminChildSafetyPage.tsx#L38`, `ChildGateScannerPage.tsx#L53` | **Replace with async `listSafetyAlerts(filters?)`** -> `GET /api/children/alerts` | Phase 3 adds async method; Phase 4, 5 & 6 migrate pages; Phase 7 deletes sync method. |
| `triggerMissingChildAlert(...)` | Zero external callers | **Replace with async `triggerChildSos(payload)`** -> `POST /api/children/sos` | Phase 3 adds async method; Phase 4 & 5 wire SOS modals; Phase 7 deletes sync method. |
| `resolveSafetyAlert(...)` | `AdminChildSafetyPage.tsx#L42`, `ChildGateScannerPage.tsx#L80` | **Replace with async `acknowledgeSafetyAlert(id, notes?)` + `resolveSafetyAlert(id, { resolutionNotes, status })`** | Phase 3 adds both async methods; Phase 5 & 6 add Acknowledge + Resolve-with-notes modal; Phase 7 deletes sync method. |

---

### Store B: `src/domains/safety/services/safetyCommandEngine.ts` (434 lines)
*Current Backing:* 3 `localStorage` keys (`aarizo_emergency_incidents_v3`, `aarizo_child_profiles_v3`, `aarizo_pickup_records_v3`), plus broken read-bridge `getChildren()` -> `childSafetyService.getChildren('soc-gvs')`.

| Existing Public Method | Verified Consumers | Domain | Target Disposition |
| :--- | :--- | :--- | :--- |
| `getChildren()` | `SafetyCommandHub.tsx#L40, #L77` | **Child Safety** | **Obsolete — Migrate caller in Phase 4 to `childSafetyService.listChildren()`, remove in Phase 7.** |
| `getPickupRecords()` | Zero external callers | **Child Safety** | **Obsolete — Remove in Phase 7** (replaced by `childSafetyService.listExitLogs()`). |
| `addChildProfile(...)` | `SafetyCommandHub.tsx#L133` | **Child Safety** | **Obsolete — Migrate caller in Phase 4 to `childSafetyService.createChild()`, remove in Phase 7.** |
| `addAuthorizedPickup(...)` | `SafetyCommandHub.tsx#L157` | **Child Safety** | **Obsolete — Migrate caller in Phase 4 to `childSafetyService.addAuthorizedPickup()`, remove in Phase 7.** |
| `verifyChildPickupAtGate(...)` | `SafetyCommandHub.tsx#L175` | **Child Safety (Security Conflict)** | **Obsolete — Migrate guard/admin caller in Phase 4/5 to `childSafetyService.verifyGatePass()`, hide for non-guard/admin, remove in Phase 7.** |
| `getIncidents()` | `SafetyCommandHub.tsx#L39, #L76` | Non-child Emergency Hub | **Retain temporarily for non-child incidents only** (separate from Child Safety; `CHILD_SAFETY` category routes exclusively to `/api/children/sos` & `/api/children/alerts`). |
| `triggerOneTapSOS(...)` | `SafetyCommandHub.tsx#L91` | Mixed (`CHILD_SAFETY` + 5 others) | **Split in Phase 4:** `CHILD_SAFETY` category -> `childSafetyService.triggerChildSos()`; non-child categories retained cleanly (documented in `REQ-BE-03`). |
| `acknowledgeIncident(...)` | `SafetyCommandHub.tsx#L105` | Non-child Emergency Hub | **Retain for non-child incidents only** (Child Safety alerts use `POST /api/children/alerts/:id/acknowledge`). |
| `assignResponder(...)` | `SafetyCommandHub.tsx#L113` | Non-child Emergency Hub | **Do NOT use for Child Safety Alerts** (no backend `RESPONDING` contract; documented in `REQ-BE-03`). |
| `resolveIncident(...)` | `SafetyCommandHub.tsx#L125` | Non-child Emergency Hub | **Retain for non-child incidents only** (Child Safety alerts use `POST /api/children/alerts/:id/resolve`). |

---

### Store C: `src/services/safetyCommandService.ts` (364 lines)
*Current Backing:* 2 `localStorage` keys (`communityos_emergency_incidents`, `communityos_emergency_contacts`), `emergencyIncidentRepository`, and blocked `realtimeService.publish('EMERGENCY_ALERTS', ...)`.

| Existing Public Method | Verified Consumers | Domain | Target Disposition |
| :--- | :--- | :--- | :--- |
| `getIncidents(societyId)` | `SecurityEmergencyTerminalPage.tsx#L60`, `societyIntelligenceService.ts#L106` | Non-child Emergency Terminal & Analytics | **Preserve signature during B.2.3** so `societyIntelligenceService.ts` and non-child `SecurityEmergencyTerminalPage` flows do not break. Do NOT use for Child Safety alerts. |
| `saveIncident`, `triggerSOS`, `acknowledgeIncident`, `respondIncident`, `resolveIncident`, `closeIncident` | `SecurityEmergencyTerminalPage.tsx#L65, #L73, #L98` | Non-child Emergency Terminal | **Phase 7 cleanup:** Strip all blocked `realtimeService.publish('EMERGENCY_ALERTS', ...)` calls (`403`). Keep non-child interface stable until general emergency backend migration (`REQ-BE-03`). |
| `getEmergencyContacts()` | Static society/public helplines (`100`, `101`, `108`) | Non-child Reference Data | **Preserve as static helpline reference.** |

### Store D: `src/repositories/childSafety/ChildRepository.ts` (39 lines)
- **Consumer:** ONLY `src/services/childSafetyService.ts#L283` (`childRepository.create(updated).catch(() => {})`).
- **Disposition:** Targets `/api/collections/children`, permanently blocked (`403 CHILD_SAFETY_COLLECTION_FORBIDDEN`). Disconnect in Phase 3/7 and retire completely in Phase 7.

---

## 2. Unified Target Child Safety Service Contract (`src/services/childSafetyService.ts`)

After Phase 7, `childSafetyService` is a **100% stateless, strictly async** facade over `apiClient` (no `localStorage`, no `SEED_CHILDREN`, no `db.ts`, no `ChildRepository`, no `realtimeService.publish`):

```ts
export const childSafetyService = {
  // Profiles
  listChildren(params?: { includeArchived?: boolean; societyId?: string }): Promise<ChildProfileDto[]>,
  getChildById(childId: string): Promise<ChildProfileDto>,
  createChild(payload: CreateChildProfileRequest): Promise<ChildProfileDto>,
  updateChild(childId: string, payload: UpdateChildProfileRequest): Promise<ChildProfileDto>,
  archiveChild(childId: string, reason?: string): Promise<{ archived: true; child: ChildProfileDto }>,

  // Authorized Pickups
  listPickups(childId: string, params?: { includeArchived?: boolean }): Promise<AuthorizedPickupDto[]>,
  addPickup(childId: string, payload: CreateAuthorizedPickupRequest): Promise<AuthorizedPickupDto>,
  updatePickup(childId: string, pickupId: string, payload: UpdateAuthorizedPickupRequest): Promise<AuthorizedPickupDto>,
  revokePickup(childId: string, pickupId: string, reason?: string): Promise<{ revoked: true; pickup: AuthorizedPickupDto }>,
  archivePickup(childId: string, pickupId: string): Promise<{ revoked: true; pickup: AuthorizedPickupDto }>,

  // Gate Passes & Fail-Closed Gate Verification
  listGatePasses(params?: { childId?: string; status?: ChildGatePassStatus; limit?: number; offset?: number; societyId?: string }): Promise<ChildGatePassDto[]>,
  getGatePassById(passId: string): Promise<ChildGatePassDto>,
  createGatePass(payload: CreateChildGatePassRequest): Promise<ChildGatePassCreatedDto>, // one-time bearerToken & qrPayload
  revokeGatePass(passId: string, reason?: string): Promise<{ revoked: true; pass: ChildGatePassDto }>,
  verifyGatePass(payload: VerifyChildGatePassRequest): Promise<VerifyChildGatePassSuccessDto>, // throws ApiError on denial/409/422/503/offline

  // Audit Exit Logs
  listExitLogs(params?: { childId?: string; limit?: number; offset?: number; societyId?: string }): Promise<ChildExitLogDto[]>,

  // SOS & Safety Alerts
  listSafetyAlerts(params?: { status?: ChildAlertStatus; limit?: number; offset?: number; societyId?: string }): Promise<ChildSafetyAlertDto[]>,
  triggerChildSos(payload: TriggerChildSosRequest): Promise<ChildSosCreatedDto>,
  acknowledgeSafetyAlert(alertId: string, notes?: string): Promise<{ acknowledged: true; alert: ChildSafetyAlertDto }>,
  resolveSafetyAlert(alertId: string, payload: ResolveChildAlertRequest): Promise<{ resolved: true; alert: ChildSafetyAlertDto; childStatusRestored?: boolean }>,

  // Pure Presentation / Error Formatting Helpers (stateless)
  mapErrorToUserMessage(error: unknown): { title: string; message: string; severity: 'info' | 'warning' | 'error' | 'critical'; failClosed?: boolean },
};
```

---

## 3. Strict Boundary: Allowed Local State vs Forbidden Local State

| State Category | Permitted in Browser? | Storage Mechanism | Authority |
| :--- | :---: | :--- | :--- |
| Child profiles, status (`SAFE`/`OUT_OF_SOCIETY`/`MISSING`), flat/guardian links | **Read-only UI mirror in React state only** | React `useState` (refetched on mount & SSE) | **Backend PostgreSQL ONLY** — never `localStorage` |
| Authorized pickups & `idDocumentLast4` | **React state only** | React `useState` | **Backend PostgreSQL ONLY** — never `localStorage` |
| Gate pass metadata (`passCode`, `status`, `validUntil`, `currentUses`) | **React state only** | React `useState` | **Backend PostgreSQL ONLY** — never `localStorage` |
| One-time `bearerToken` & `qrPayload` | **Ephemeral modal state ONLY** | Modal `useState`, cleared immediately on close/unmount | **Never persisted to `localStorage`, `sessionStorage`, IndexedDB, URL, or logs** |
| Gate verification verdict & exit logs | **React state only** | React `useState` | **Backend PostgreSQL ONLY** — never offline-evaluated |
| Child Safety Alerts & SOS status | **React state only** | React `useState` | **Backend PostgreSQL ONLY** — never `localStorage` |
| UI presentation preferences (active tab, search filter text, selected `gateId` dropdown, audio mute toggle) | **Yes** | React `useState` (or optional `sessionStorage` for gate selector preference only) | Pure UI convenience — zero security authority |

---

## 4. Failure & Reload Consistency Guarantees

1. **Zero Stale Fallback on API Failure:** When any read (`GET`) fails, the page renders an explicit error/retry state (preserving any already-visible warning banners if an active SOS is onscreen, while marking data as stale/unverified — never substituting `localStorage` or mock seeds). When any mutation (`POST`/`PATCH`/`DELETE`) fails, the UI surfaces the exact `ApiError` message and keeps form state intact for correction.
2. **Reload & Cross-Portal Truth:** Every page reload fetches fresh PostgreSQL state from `/api/children/*`. Every mutation updates backend PostgreSQL first and triggers server-emitted SSE events so Resident, Security, and Admin portals converge immediately on the same persisted truth.
3. **Coexistence Rule During Migration:** Phases 3–6 keep deprecated sync methods intact on `childSafetyService` only for unmigrated pages; Phase 7 deletes them strictly after all consumers pass verification.

