# AARIZO ISSUE-06 — Phase B.2.3 — Phase 4 Resident Portal Child Safety Integration Audit

**Audit Date:** 2026-11-18  
**Repository:** `D:\AAZIRA\AARIZO`  
**Audit Mode:** Strictly Read-Only Audit & Implementation Planning (zero source/test/config/schema edits; zero commits/pushes; Phase 5/6 not started)  
**Final Verdict:** **`PHASE 4 RESIDENT AUDIT — PASS, READY FOR IMPLEMENTATION`**

---

## 1. Executive Summary & Resident Surface Discovery

Full-frontend discovery confirmed that **all Resident Child Safety UI workflows currently live inside a single shared component — `src/domains/safety/components/SafetyCommandHub.tsx` (1,773 lines)** — mounted by three routes:
1. `/resident/child-safety` → `src/pages/dashboard/resident/ResidentChildSafetyPage.tsx` (`<SafetyCommandHub initialTab="CHILD_SAFETY" />`)
2. `/resident/emergency` → `src/pages/dashboard/resident/ResidentEmergencyPage.tsx` (`<SafetyCommandHub />`, default `ONE_TAP_SOS` tab)
3. `/admin/safety-command` → `src/pages/dashboard/admin/AdminSafetyCommandPage.tsx` (`<SafetyCommandHub />` — Admin/Security consumer, preserved untouched for Phase 6)

Navigation entry points already wired to `/resident/child-safety` and `/resident/emergency` (all preserved untouched):
- `src/routes/index.tsx#L160-L173` (`ProtectedRoute allowedRoles={['resident', 'secretary', 'admin']}`)
- `src/components/layouts/ResidentLayout.tsx#L23, #L30`
- `src/pages/dashboard/resident/ResidentServicesPage.tsx#L23-L24`
- `src/pages/dashboard/resident/ResidentProfilePage.tsx#L101`
- `src/components/resident/ResidentHome.tsx#L40` (SOS quick action → `/resident/emergency`)
- `src/hooks/usePushNotifications.ts#L73` (`child_pickup: '/resident/child-safety'`)

**Verified non-Child-Safety Resident Pages (MUST remain untouched):**
- `src/pages/dashboard/resident/VisitorPassHubPage.tsx` — strictly Visitor Management (`visitorService`), zero Child Safety coupling.
- `src/pages/dashboard/resident/MyFlatPage.tsx` — local household/vehicle/document management (`societyService`), zero Child Safety API coupling.

---

## 2. Current Resident Workflow State: Functional vs Broken / Fake / Local-Only

| Workflow | Current Location (`SafetyCommandHub.tsx`) | Current Runtime Behavior | Classification |
| --- | --- | --- | --- |
| **Child Listing** | `#L40`, `#L77`, `#L642-L776` | Calls deprecated sync `safetyCommandEngine.getChildren()`, returning `[]` on fresh load; hardcodes `'SAFE ON PREMISES'` (`#L684`) and `'DOB 14 May 2018'` (`#L714`); ignores real child status (`SAFE`/`OUT_OF_SOCIETY`/`MISSING`/`ARCHIVED`) | **BROKEN / HARDCODED** |
| **Child Registration** | `#L61-L68`, `#L129-L152`, `#L1413-L1525` | Calls deprecated `safetyCommandEngine.addChildProfile()` → **throws `ApiError('LEGACY_SYNC_API_DEPRECATED')` uncaught**; defaults to fake `'B-1204'`, `'Siddharth Malhotra'`, `'+91 98765 00000'`; ignores `age` & `gender` inputs; no loading/error state | **BROKEN (FAIL-CLOSED)** |
| **Child Edit / Archive** | Not present | No UI controls to edit child profile (`updateChildProfile`) or archive (`archiveChildProfile`) | **MISSING** |
| **Authorized Pickups List** | `#L826-L916` | Hardcodes `children[0]` only; when empty, renders **2 hardcoded demo escorts (`Radha Bai`, `Santosh Yadav` with fake `DL-MH02-2018-9182`)** (`#L826-L845`); ignores real `ACTIVE`/`REVOKED`/`EXPIRED` status | **FAKE / DEMO DATA** |
| **Add Authorized Pickup** | `#L53-L59`, `#L154-L162`, `#L1528-L1593` | Hardcoded to `children[0].id`; calls deprecated `safetyCommandEngine.addAuthorizedPickup()` → **throws uncaught `ApiError`**; pre-populates fake `'Radha Bai'` + prohibited raw `idProofNumber: 'XXXX-XXXX-9901'` in state; modal omits `idDocumentType`, `idDocumentLast4`, `validUntil` | **BROKEN + PII VIOLATION** |
| **Edit / Revoke / Archive Pickup** | `#L164-L171`, `#L1255-L1265` | `handleRemoveEscort()` mutates `child.authorizedPickups` in memory only and shows fake `'Escort authorization removed.'` — **zero backend call** | **FAKE / LOCAL-ONLY** |
| **Gate Pass Creation & One-Time QR** | `#L725-L750`, `#L890-L913`, `#L1340-L1410` | Clicking `Confirm Pass` (`#L1369-L1373`) closes modal and shows fake `'Child Gate Exit Pass generated and active for 4 hours!'` — **zero API call, zero QR rendered, zero pass list, zero pass revocation**; always uses `children[0]` | **100% FAKE** |
| **Child Missing / Safety SOS** | `#L386`, `#L752-L774`, `#L1596-L1770` | 1) `DISPATCH ALARM NOW` (`#L1663-L1667`) literally closes modal and shows fake `'HIGH PRIORITY CHILD MISSING ALERT DISPATCHED...'` — **zero backend call!** 2) One-Tap `Child Safety SOS` card (`#L386`) writes localStorage general incident via `safetyCommandEngine.triggerOneTapSOS('CHILD_SAFETY', ...)` — **never calls `POST /api/children/sos`!** | **100% FAKE / SPLIT-BRAIN** |
| **Child Safety Alerts & Exit Logs View** | Not present | Residents cannot see live backend `ChildSafetyAlertDto` status (`ACTIVE`/`ACKNOWLEDGED`/`RESOLVED`/`FALSE_ALARM`) or their children's gate exit logs (`GET /api/children/exit-logs`) | **MISSING** |
| **Realtime Updates** | `#L80-L88` | Subscribes to `realTimeSync.subscribe('CHILD_SAFETY_UPDATED', ...)` (invented legacy topic!) instead of Phase 3 `useChildSafetyRealtime()` (14 exact backend Fetch SSE topics) | **BROKEN / LEGACY TOPIC** |
| **General Emergency SOS (Non-Child)** | `#L90-L127`, `#L383-L388`, `#L464-L541`, `#L924-L1054` | `MEDICAL`, `FIRE`, `SECURITY`, `LIFT`, `ELECTRICAL` incidents via `safetyCommandEngine` + Admin/Security Command Console | **FUNCTIONAL (MUST PRESERVE)** |
| **Visitor Pass Hub & Household** | `VisitorPassHubPage.tsx`, `MyFlatPage.tsx` | Independent resident features | **FUNCTIONAL (MUST PRESERVE)** |

---

## 3. Detailed Domain Audits (A–F)

### Audit A — Child Registration (`createChildProfileAsync`, `listChildren`, `updateChildProfile`, `archiveChildProfile`)
- **Backend ownership (`server/src/childSafety/router.ts#L1763-L1790`, `authz.ts#L136-L160`):**
  - For `role === 'resident'`, the server derives `residentId`, `flatId`, `flatNumber`, and `guardianUserId` strictly from PostgreSQL `Resident` + `Flat` membership. Submitting a mismatched `flatId` or `residentId` returns HTTP `403`.
  - **Required UI change:** Display `currentUser.flatNumber` as read-only context (never editable `flatCode` input for residents, and zero `'B-1204'` fallback). Omit `residentId`, `flatId`, and `societyId` from the resident creation payload.
  - If an unlinked resident receives `403 RESIDENT_OWNERSHIP_REQUIRED`, render the formatted backend error visibly via `formatChildSafetyError(err)`.
  - If `secretary` or `admin` visits `/resident/child-safety`, display a notice that admin child creation requires selecting a resident & flat in Admin Child Safety Desk (Phase 6) rather than submitting an invalid resident-only payload (`400 OWNER_AND_FLAT_REQUIRED`).
- **DTO field mapping (`CreateChildProfileRequest`):**
  - `childName` → `fullName` (required, 1–200 chars)
  - `guardianName` → `guardianName` (required, prefilled from `currentUser?.name || ''`, never `'Siddharth Malhotra'`)
  - `guardianPhone` → `guardianPhone` (required, prefilled from `currentUser?.phone || ''`, never `'+91 98765 00000'`)
  - `age` → `reportedAge` (optional integer `0..25`, parsed safely)
  - `gender` → `gender` enum (`'Boy'` → `'MALE'`, `'Girl'` → `'FEMALE'`, `'Other'` → `'OTHER'`, `'Prefer not to say'` → `'UNSPECIFIED'`)
  - Optional backend-supported fields to expose cleanly: `dateOfBirth` (non-future ISO date), `medicalNotes` (max 1000), `emergencyPhone` (max 32), `exitPermissionMode` (`ESCORT_REQUIRED` default; `TIMED_PASS_ONLY`; `SOLO_ALLOWED` paired with `allowedSoloExit: true`), `notes` (max 1000).
- **Privacy:** Zero raw government ID fields on child profiles; zero `localStorage` persistence.

### Audit B — Authorized Pickups (`listAuthorizedPickups`, `addAuthorizedPickup`, `updateAuthorizedPickup`, `revokeAuthorizedPickup`, `archiveAuthorizedPickup`)
- **Multi-child targeting:** Replace hardcoded `children[0]` with explicit `selectedChildId` state (synced with active children list) so residents with multiple children manage pickups per child cleanly.
- **Government ID privacy (`router.ts#L2217-L2223`, `apiClient.ts`):**
  - Remove `idProofNumber` entirely from React form state and UI inputs!
  - Expose optional `idDocumentType` (e.g., `'Aadhaar Card'`, `'Driving License'`, `'Passport'`, `'Voter ID'`, max 64 chars) and optional **`idDocumentLast4`** (strictly 1–4 characters, e.g., `9901`), plus optional future `validUntil` ISO date and `notes`.
  - Render masked backend metadata (`idDocumentType` + `XXXX-${idDocumentLast4}`) and `idVerificationStatus` (`NOT_COLLECTED` / `UNVERIFIED` / `PENDING_REVIEW` / `VERIFIED` / `REJECTED`).
- **Mutation integrity:**
  - Remove hardcoded demo fallback array (`Radha Bai`, `Santosh Yadav` at `#L826-L845`). Render a clean empty state when a child has 0 escorts.
  - Wire Add → `addAuthorizedPickup()`, Edit → `updateAuthorizedPickup()`, Revoke → `revokeAuthorizedPickup()`, Archive → `archiveAuthorizedPickup()` (all awaited, with `inFlightRef` double-submit lock and visible `formatChildSafetyError` feedback).
  - Compute effective expired indicator when `pickup.status === 'ACTIVE' && pickup.validUntil && new Date(pickup.validUntil) <= now` (since backend `POST /passes` rejects expired escorts with `422 PICKUP_AUTHORIZATION_EXPIRED`).
  - After revoke/archive/status-update-to-REVOKED/EXPIRED, refresh **both** children/pickups AND gate passes (`listGatePasses()`) so cascade-revoked passes appear immediately!

### Audit C — Secure Gate Passes & One-Time QR (`listGatePasses`, `getGatePassById`, `createGatePass`, `revokeGatePass`)
- **Existing QR library check:** `qrcode.react` (`^4.2.0`) is **already installed** in `package.json#L30`. No new dependencies required!
  - **Security constraint:** Do **NOT** use `src/domains/qr/components/QRGenerator.tsx` (fabricates client-side tokens via `qrService`). Do **NOT** pass raw `qrPayload` into `src/components/ui/QRGenerator.tsx` without an explicit safe `label` (its fallback `{label || value}` would print the secret `qrPayload` in plaintext, and its `value || 'DWELLORA-QR-PASS'` fallback would fabricate a fake QR!).
  - Render `<QRCodeSVG value={oneTimeCreatedPass.qrPayload} size={200} level="M" />` **strictly and ONLY** while `oneTimeCreatedPass?.qrPayload` is present in ephemeral React modal state immediately following HTTP 201 from `createGatePass()`, displaying only safe metadata (`passCode`, child name, escort name, `validUntil`, `maxUses`, and a one-time security notice).
  - Clear `oneTimeCreatedPass` from React state immediately on modal close, unmount, logout, or session switch. Never store `bearerToken` or `qrPayload` in `localStorage`, `sessionStorage`, URL query params, or console logs.
- **Pass list & lifecycle:**
  - Load real passes via `childSafetyService.listGatePasses()` (which returns `ChildGatePassDto[]` with zero `tokenHash`, `bearerToken`, or `qrPayload`).
  - Revisiting/refreshing the pass list displays metadata (`passCode`, escort name, child name, `validFrom`/`validUntil`, `currentUses`/`maxUses`, effective status `ACTIVE`/`USED`/`EXPIRED`/`REVOKED`) and **NEVER recreates or invents a QR code** (explicit notice: *"QR code is shown once at creation for security; revoke and issue a new pass if lost"*).
  - Display effective `EXPIRED` state when `pass.status === 'ACTIVE' && new Date(pass.validUntil).getTime() <= Date.now()`.
  - Allow revoking only active unexpired passes via `revokeGatePass(pass.id, { reason })` with confirmation and in-flight lock.
  - Disable pass creation when child is `ARCHIVED` or `MISSING` (or has an active `MISSING_CHILD` alert) or when `exitPermissionMode !== 'SOLO_ALLOWED'` and no active unexpired pickup person exists.
  - Prevent double-click duplicate pass creation via synchronous `passSubmitLockRef` + disabled button state (critical because backend `POST /passes` lacks server-side `Idempotency-Key` deduplication).

### Audit D — Resident SOS (`triggerSos`, `listAlerts`)
- **Mandatory separation from general emergencies:**
  - Keep `MEDICAL`, `FIRE`, `SECURITY`, `LIFT`, `ELECTRICAL` on `safetyCommandEngine.triggerOneTapSOS(...)` (completely untouched).
  - Route **both** the `Report Missing` button on each child card AND the `Child Safety SOS` card on the `ONE_TAP_SOS` tab to the authoritative Child Safety SOS modal backed by `childSafetyService.triggerSos()` (`POST /api/children/sos`).
- **Required fields & role authorization:**
  - Backend requires `childId` (owned child) and `location` (non-empty, max 255) for `role === 'resident'` (`router.ts#L1123-L1126, #L1172-L1177`). Modal exposes child selector (pre-selected to clicked child), `alertType` (`MISSING_CHILD` default, `UNATTENDED_CHILD`, `EMERGENCY_SOS`), `location` (prefilled with flat/premises input), optional `lastSeenDetails` (max 500) and `description` (max 1000).
  - **Zero fake green banner:** Only show confirmation AFTER HTTP 201 resolves.
  - **Duplicate handling:** If backend returns HTTP `409 DUPLICATE_ACTIVE_SOS_ALERT`, refresh alerts (`listAlerts()`) and display the existing active alert state cleanly rather than showing a confusing generic crash.
  - **Read-only alert tracker for residents:** Display the resident's live `ChildSafetyAlertDto[]` from `listAlerts()` showing status (`ACTIVE`, `ACKNOWLEDGED`, `RESOLVED`, `FALSE_ALARM`), `acknowledgedByName`, `resolvedByName`, `resolutionNotes`, and timestamps. **NEVER render Acknowledge or Resolve buttons for `resident` role** (`SOS_MANAGE_ROLES` excludes `resident`).

### Audit E — Resident Realtime (`useChildSafetyRealtime`)
- Replace `realTimeSync.subscribe('CHILD_SAFETY_UPDATED', ...)` in `SafetyCommandHub.tsx#L83` with Phase 3 `useChildSafetyRealtime()` (keeping `realTimeSync.subscribe('EMERGENCY_ALERTS', ...)` strictly for non-child general emergencies!).
- Scope-specific debounced authoritative refreshes (`250ms` coalescing + monotonic `requestIdRef` stale-response guard):
  - `onProfilesChange` / `onPickupsChange` → `listChildren()`
  - `onPassesChange` → `listGatePasses()`
  - `onExitLogsChange` → `listExitLogs()`
  - `onAlertsChange` → `listAlerts()`
  - `onReconnect` → full authoritative resync (`listChildren`, `listGatePasses`, `listAlerts`, `listExitLogs`)
- Display live realtime connection state banner (`CONNECTED` / `RECONNECTING` / `OFFLINE`) from `realtimeService.subscribeToStatus()` so residents know when live updates are offline, without adding polling, native `EventSource`, or `BroadcastChannel`.
- Unmount/logout automatically cleans up all 14 topic subscriptions (already verified in Phase 3) and clears `oneTimeCreatedPass` + local UI state.

### Audit F — UX & Feature Preservation
- Preserve `ResidentChildSafetyPage.tsx` and `ResidentEmergencyPage.tsx` hero headers, `SafetyCommandHub` segmented tab bar, visual palette (`--aarizo-navy`, `--aarizo-coral`, `--aarizo-gold`), `Modal` component, responsive mobile-first layouts, `AdminSafetyCommandPage.tsx` (`COMMAND_CONSOLE` & `GATE_VERIFIER`), `VisitorPassHubPage.tsx`, `MyFlatPage.tsx`, `ResidentHome.tsx`, and `ResidentLayout.tsx`.
- Update the inaccurate callout at `SafetyCommandHub.tsx#L608` (which falsely claims children auto-load from `My Flat`) to accurately state that Child Safety profiles, escorts, and passes are synced with the society's live Security Gate & Backend system.

---

## 4. Backend Contract Gaps Documented Separately (No Backend Changes in Phase 4)

| Gap ID | Endpoint / Area | Observed Backend Behavior | Phase 4 Frontend Mitigation | Tracked Follow-up |
| :---: | --- | --- | --- | --- |
| **GAP-P4-BE-01** | `POST /api/children/passes` (`router.ts#L209-L405`) | Does not implement server-side `Idempotency-Key` deduplication (only rate-limiting + display code collision retry) | Strict synchronous `inFlightRef` lock + disabled button while pending; still passes `idempotencyKey` via Phase 1 client | Backend idempotency persistence in follow-up hardening |
| **GAP-P4-BE-02** | `GET /api/children/passes` & `GET /api/children/:id/pickups` (`router.ts#L190-L198`, `#L2191-L2199`) | Returns persisted `status: 'ACTIVE'` even after `validUntil <= now` (expiry enforced at `POST /passes` and `POST /passes/verify`) | Compute effective UI badge (`EXPIRED` when `status === 'ACTIVE' && validUntil <= now`) and disable actions on expired rows | Optional backend projection / scheduled expiry job |
| **GAP-P4-BE-03** | `POST /api/children` (`router.ts#L1791-L1826`) when `secretary`/`admin` visits `/resident/child-safety` | Requires explicit `residentId` + `flatId` for `secretary`/`admin` (`400 OWNER_AND_FLAT_REQUIRED`), whereas `resident` auto-derives ownership | Detect non-resident role on `/resident/child-safety` registration modal and direct admins/secretaries to Admin Child Safety Desk (Phase 6) | Resolved natively in Phase 6 Admin Desk |
| **GAP-P4-BE-04** | `DELETE /api/children/passes/:id` vs `POST /api/children/passes/:id/revoke` | Both map to `handleRevokePass`; Phase 1 uses canonical `POST /api/children/passes/:id/revoke` | Use `childSafetyService.revokeGatePass()` exclusively | None (aligned) |

---

## 5. Security Risks & Controls for Phase 4 Implementation

1. **One-time QR / Bearer Token Leakage:** Never persist `qrPayload` or `bearerToken` to storage/snapshots/URL/logs; clear from component state on modal close/unmount/logout; never pass `qrPayload` as visible text label.
2. **Raw Government ID Collection:** Remove `idProofNumber` input/state completely; accept only optional `idDocumentType` + `idDocumentLast4` (max 4 chars); display only masked `XXXX-${last4}`.
3. **Cross-Session UI State Leakage:** Reset all local React component states (`children`, `passes`, `alerts`, `exitLogs`, `oneTimeCreatedPass`, `selectedChildId`) whenever `currentUser?.id` or `currentUser?.societyId` changes or becomes `null`.
4. **Privilege Escalation Prevention:** Never expose Acknowledge/Resolve Child Alert buttons or Gate Verifier actions to `resident` role; never forward client `societyId` for non-platform-admins.
5. **Fake Success Elimination:** Remove every `setAlertSuccess(...)` that runs before an awaited backend response resolves.

---

## 6. Final Verdict

**PHASE 4 RESIDENT AUDIT — PASS, READY FOR IMPLEMENTATION**

