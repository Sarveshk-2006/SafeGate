# AARIZO ISSUE-06 — Phase B.2.3 — Phase 4 Resident Feature Preservation Matrix

**Date:** 2026-11-18  
**Repository:** `D:\AAZIRA\AARIZO`

---

## 1. Resident Routes, Navigation & Unrelated Features (100% Preserved)

| Feature / Surface | File Path(s) | Phase 4 Change? | Preservation Guarantee |
| --- | --- | :---: | --- |
| **Route Registry & Role Guards** | `src/routes/index.tsx#L160-L183` | **NONE** | `/resident/child-safety`, `/resident/emergency`, `/resident/visitors`, `/resident/my-flat`, and all role guards unchanged |
| **Resident Drawer & Bottom Nav** | `src/components/layouts/ResidentLayout.tsx#L19-L39` | **NONE** | `Child Safety Pass` & `Emergency SOS` nav items unchanged |
| **Resident Home Dashboard** | `src/components/resident/ResidentHome.tsx` | **NONE** | Quick actions, announcements, vendors, parcel widget unchanged |
| **Resident Services & Profile Links** | `src/pages/dashboard/resident/ResidentServicesPage.tsx`, `ResidentProfilePage.tsx`, `src/components/ui/QuickActionSheet.tsx` | **NONE** | Existing `/resident/child-safety` and `/resident/emergency` entry points unchanged |
| **Visitor Pass Hub** | `src/pages/dashboard/resident/VisitorPassHubPage.tsx` | **NONE** | Strictly Visitor Management (`visitorService`) — untouched in Phase 4 |
| **My Flat / Household Page** | `src/pages/dashboard/resident/MyFlatPage.tsx` | **NONE** | Family members, vehicles, domestic workers, flat docs unchanged |
| **Page Hero Headers** | `src/pages/dashboard/resident/ResidentChildSafetyPage.tsx`, `ResidentEmergencyPage.tsx` | **NONE** | Navy/Gold & Crimson hero headers and container layouts preserved |
| **General Emergency SOS (Non-Child)** | `src/domains/safety/components/SafetyCommandHub.tsx` (`MEDICAL`, `FIRE`, `SECURITY`, `LIFT`, `ELECTRICAL` cards + timeline) | **PRESERVED** | Continues calling `safetyCommandEngine.triggerOneTapSOS()` and `realTimeSync.subscribe('EMERGENCY_ALERTS')` cleanly separated from Child Safety |
| **Admin Safety Command Console & Gate Verifier** | `src/pages/dashboard/admin/AdminSafetyCommandPage.tsx`, `SafetyCommandHub.tsx` (`COMMAND_CONSOLE`, `GATE_VERIFIER` tabs) | **PRESERVED** | Admin/Security tabs remain visible only to `['admin', 'secretary', 'guard']` and untouched until Phases 5–6 |
| **Security & Admin Child Safety Pages** | `ChildGateScannerPage.tsx`, `AdminChildSafetyPage.tsx` | **NONE** | Explicitly reserved for Phases 5 & 6 |

---

## 2. Fake / Demo / Local-Only Resident Interactions Mapped to Real Backend Operations

| # | Existing Fake / Local-Only Interaction | Location | Phase 4 Authoritative Replacement |
| :---: | --- | --- | --- |
| 1 | `safetyCommandEngine.getChildren()` empty/stale sync read + hardcoded `'SAFE ON PREMISES'` & `'DOB 14 May 2018'` | `SafetyCommandHub.tsx#L40, #L77, #L684, #L714` | `await childSafetyService.listChildren()` rendering real `ChildProfileDto` fields (`status`, `dateOfBirth`/`reportedAge`, `flatNumber`, `exitPermissionMode`, `guardianName`, `guardianPhone`) |
| 2 | `safetyCommandEngine.addChildProfile(...)` throwing `LEGACY_SYNC_API_DEPRECATED` + fake `'B-1204'`/`'Siddharth Malhotra'` defaults | `SafetyCommandHub.tsx#L61-L68, #L129-L152` | `await childSafetyService.createChildProfileAsync(...)` (plus `updateChildProfile` & `archiveChildProfile`), read-only flat, real error/loading feedback |
| 3 | Hardcoded fallback escorts (`Radha Bai`, `Santosh Yadav`, `DL-MH02-2018-9182`) when `children[0]?.authorizedPickups` is absent | `SafetyCommandHub.tsx#L826-L845` | Render real `selectedChild.pickups` (from `listChildren()` / `listAuthorizedPickups(childId)`) with empty state when 0 escorts exist |
| 4 | `safetyCommandEngine.addAuthorizedPickup(children[0].id, pickupForm)` with prohibited raw `idProofNumber` | `SafetyCommandHub.tsx#L53-L59, #L154-L162` | `await childSafetyService.addAuthorizedPickup(selectedChildId, ...)` with optional `idDocumentType` + `idDocumentLast4` (≤4 chars) and zero `idProofNumber` |
| 5 | `handleRemoveEscort()` mutating in-memory array + fake `'Escort authorization removed.'` | `SafetyCommandHub.tsx#L164-L171` | `await childSafetyService.revokeAuthorizedPickup()` / `archiveAuthorizedPickup()` + refresh children & passes |
| 6 | `GENERATE_PASS` modal `Confirm Pass` showing fake `'Child Gate Exit Pass generated and active for 4 hours!'` with zero API call and zero QR | `SafetyCommandHub.tsx#L1368-L1373` | `await childSafetyService.createGatePass(...)` → render one-time `qrPayload` via `QRCodeSVG` (`qrcode.react`) + authoritative `listGatePasses()` section with `revokeGatePass()` |
| 7 | `MISSING_ALERT` modal `DISPATCH ALARM NOW` showing fake `'HIGH PRIORITY CHILD MISSING ALERT DISPATCHED...'` with zero API call | `SafetyCommandHub.tsx#L1662-L1667` | `await childSafetyService.triggerSos(...)` (`POST /api/children/sos`) + live `listAlerts()` status tracker (`ACTIVE`/`ACKNOWLEDGED`/`RESOLVED`/`FALSE_ALARM`) |
| 8 | One-Tap `Child Safety SOS` card writing localStorage general incident via `safetyCommandEngine.triggerOneTapSOS('CHILD_SAFETY', ...)` | `SafetyCommandHub.tsx#L90-L102, #L386` | Open Child Safety SOS modal backed by `childSafetyService.triggerSos()` (requires owned `childId` + `location`), keeping the 5 non-child SOS cards on `safetyCommandEngine` |
| 9 | `realTimeSync.subscribe('CHILD_SAFETY_UPDATED', ...)` (invented topic) | `SafetyCommandHub.tsx#L83` | `useChildSafetyRealtime()` (exact 14 backend Fetch SSE topics) with scoped debounced backend refresh & reconnect resync |
| 10 | Hardcoded `children[0]` everywhere (`currentChild`) | `SafetyCommandHub.tsx#L156, #L165, #L185, #L826` | Explicit `selectedChildId` state across child cards, escorts, gate passes, exit logs, and SOS modal |

