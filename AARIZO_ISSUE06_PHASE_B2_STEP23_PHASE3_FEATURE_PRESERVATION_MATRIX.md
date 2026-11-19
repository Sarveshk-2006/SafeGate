# AARIZO — ISSUE-06 | B.2.3 | Phase 3 Feature Preservation & Consumer Migration Matrix

**Date:** 2026-11-18  
**Scope:** Complete inventory of all consumers of `childSafetyService`, `safetyCommandEngine`, `safetyCommandService`, and `ChildRepository` across `src/`.

---

## 1. Consumer Inventory & Phase 3 Preservation Status

| Consumer File | Imported Service | Methods Invoked | Phase 3 Impact & Preservation | Target Migration Phase |
| --- | --- | --- | --- | :---: |
| `src/domains/safety/components/SafetyCommandHub.tsx` *(mounted by `ResidentChildSafetyPage.tsx`)* | `safetyCommandEngine` | General incidents: `getIncidents`, `triggerOneTapSOS`, `acknowledgeIncident`, `assignResponder`, `resolveIncident`. Child Safety: `getChildren`, `addChildProfile`, `addAuthorizedPickup`, `verifyChildPickupAtGate`. | **Compiles cleanly; general incidents 100% preserved.** Deprecated Child Safety sync reads project from `childSafetyService` memory snapshot (zero `'soc-gvs'`, zero localStorage); deprecated sync writes/verify fail closed instead of silently writing to obsolete `aarizo_child_profiles_v3` / `aarizo_pickup_records_v3`. | **Phase 4** (Resident UI Cutover) |
| `src/pages/dashboard/security/ChildGateScannerPage.tsx` | `childSafetyService` | `getSafetyAlerts`, `getPickupQRs`, `getPickupLogs`, `verifyAndScanChildPickup`, `resolveSafetyAlert` | **Compiles cleanly.** Deprecated sync reads project from ephemeral backend snapshot; `verifyAndScanChildPickup` fails closed (`allowed: false`); `resolveSafetyAlert` throws `LEGACY_SYNC_API_DEPRECATED` (zero fake localStorage mutations). | **Phase 5** (Security Gate Cutover) |
| `src/pages/dashboard/admin/AdminChildSafetyPage.tsx` | `childSafetyService` | `getChildren`, `getPickupLogs`, `getSafetyAlerts`, `resolveSafetyAlert` | **Compiles cleanly.** Deprecated sync reads project from ephemeral backend snapshot; `resolveSafetyAlert` throws `LEGACY_SYNC_API_DEPRECATED` (zero fake localStorage mutations). | **Phase 6** (Admin Desk Cutover) |
| `src/pages/dashboard/security/SecurityEmergencyTerminalPage.tsx` | `safetyCommandService` | `getIncidents`, `acknowledgeIncident`, `respondIncident`, `resolveIncident` | **100% UNCHANGED & PRESERVED.** General `EmergencyIncident` workflow remains cleanly separated from Child Safety. | Out of Child Safety Phase 3 scope (`REQ-BE-03` tracked separately) |
| `src/services/societyIntelligenceService.ts` | `safetyCommandService` | `getIncidents(socId)` | **100% UNCHANGED & PRESERVED.** Analytics continues reading general `EmergencyIncident` records cleanly. | Out of Phase 3 scope |
| `src/pages/dashboard/security/SecurityTerminalPage.tsx` | None of the 4 Child Safety services | Visitor passes & gate lockdown | **100% UNCHANGED & PRESERVED.** | N/A |
| `src/repositories/childSafety/ChildRepository.ts` | Exported singleton `childRepository` | Zero remaining callers in `src/` | **Disconnected from `childSafetyService` and marked `@deprecated`.** Zero Firestore Child Safety writes remain. | **Phase 7** (Legacy Retirement) |

---

## 2. Domain Boundary Separation Confirmed

| Domain Concept | Authoritative Service / Module | Strictly Separate From |
| --- | --- | --- |
| Child Profiles & Authorized Pickups | `childSafetyService` (`listChildren`, `createChildProfileAsync`, `addAuthorizedPickup`, etc.) | General `EmergencyIncident`, `localStorage`, Firestore `ChildRepository` |
| Child Gate Passes & Exit Logs | `childSafetyService` (`listGatePasses`, `createGatePass`, `verifyGatePass`, `listExitLogs`) | Visitor Passes (`visitorService`), offline verification |
| Child Safety Alerts & SOS | `childSafetyService` (`triggerSos`, `listAlerts`, `acknowledgeAlert`, `resolveAlert`) | General `safetyCommandService` incidents (backend atomically links `EmergencyIncident` on `POST /api/children/sos`) |
| General Emergency Incidents | `safetyCommandService` & `safetyCommandEngine` incident methods | Child Safety APIs (`REQ-BE-03` remains separate) |

