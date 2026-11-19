# AARIZO — ISSUE-06 Phase B.2: Child Safety Authoritative Data Audit

**Project:** `D:\AAZIRA\AARIZO`  
**Phase:** ISSUE-06 — B.2 Child Safety & Biometric Gate Radar  
**Audit Mode:** STRICT READ-ONLY AUDIT — NO IMPLEMENTATION  
**Audit Date:** November 2026  
**Status:** COMPLETED — CRITICAL DEFECTS & ARCHITECTURAL GAPS IDENTIFIED  

---

## Executive Summary

Phase B.1 (Visitor Pass Lifecycle) established a PostgreSQL-backed authoritative data model with fail-closed multi-tenant isolation, cryptographically signed offline verification, and 296 passing unit and integration tests.

In Phase B.2, an exhaustive independent investigation was conducted into the **Child Safety & Biometric Gate Radar** domain. The audit examined all layers: frontend pages, UI command hubs, client services, base repositories, backend Express API endpoints, Prisma schema models, legacy PostgreSQL initialization scripts, and realtime event synchronization.

### Critical Verdict: Complete Tri-Tier Desynchronization & False Sense of Security
The Child Safety subsystem suffers from extreme architectural fragmentation:
1. **Four Disjoint Universes**: The resident interface (`SafetyCommandHub`), admin interface (`AdminChildSafetyPage`), security gate scanner (`ChildGateScannerPage`), and backend PostgreSQL database operate on four completely disconnected data stores with conflicting localStorage keys and data schemas.
2. **Device-Bound Gate Scanner (Operational Failure)**: When a parent generates an exit or pickup pass on their mobile device, it is written exclusively to their browser's `localStorage`. When a security guard at the gate scans the QR code on the gate terminal, the gate scanner searches the gate terminal's own `localStorage`, finds nothing, and rejects the exit pass as `"Invalid or unknown Child Pickup QR Code"`. Gate verification in a multi-device production environment is 100% non-functional.
3. **Silent Unawaited Mutations**: Remote API calls in `childSafetyService.ts` are fired in unawaited fire-and-forget background promises with swallowed empty catch handlers (`.catch(() => {})`). If the backend is offline, rejects the payload, or returns HTTP 401/403/500, the user interface indicates total success while nothing was persisted.
4. **Severe Backend Security Vulnerabilities**: Backend routes in [server/src/index.ts](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2658-L2786) lack proper role checks, accept unauthenticated SOS alerts, allow cross-tenant data leaks via unvalidated `?societyId=` query overrides and hardcoded `'soc-gvs'` fallbacks, and lack tenant checks on pass verification.
5. **No Structured Database Models**: Prisma has zero models for Child Safety. All records are shoehorned into unstructured, unindexed `EntityRecord` JSON blobs.

---

## 1. Complete Architecture & File Inventory

### 1.1 Frontend Pages & Components
| Path | Primary Role | Data Store / Service Used | Critical Flaw |
| :--- | :--- | :--- | :--- |
| [src/pages/dashboard/resident/ResidentChildSafetyPage.tsx](file:///D:/AAZIRA/AARIZO/src/pages/dashboard/resident/ResidentChildSafetyPage.tsx#L1-L29) | Resident Portal Route | Delegates to `SafetyCommandHub` | Renders isolated command hub; does not sync with admin or gate |
| [src/domains/safety/components/SafetyCommandHub.tsx](file:///D:/AAZIRA/AARIZO/src/domains/safety/components/SafetyCommandHub.tsx#L1-L1733) | Resident & Staff Safety Console | `safetyCommandEngine` | Hardcodes `children[0]`; reads from `childSafetyService` but writes to `aarizo_child_profiles_v3`, causing newly created children to disappear upon reload |
| [src/pages/dashboard/admin/AdminChildSafetyPage.tsx](file:///D:/AAZIRA/AARIZO/src/pages/dashboard/admin/AdminChildSafetyPage.tsx#L1-L100) | Admin Child Directory & Audit | `childSafetyService` (synchronous) | Hardcodes `soc-gvs` fallback; reads purely from `communityos_children_profiles` in browser localStorage |
| [src/pages/dashboard/security/ChildGateScannerPage.tsx](file:///D:/AAZIRA/AARIZO/src/pages/dashboard/security/ChildGateScannerPage.tsx#L1-L100) | Gate Security Guard Terminal | `childSafetyService.verifyAndScanChildPickup` | 100% offline; checks gate device localStorage; zero backend calls; listens to realtime events never broadcast by server |

### 1.2 Frontend Services & Data Access
| Path | Key Storage Keys / Methods | Target Persistence | Critical Flaw |
| :--- | :--- | :--- | :--- |
| [src/services/childSafetyService.ts](file:///D:/AAZIRA/AARIZO/src/services/childSafetyService.ts#L1-L626) | `communityos_children_profiles`<br>`communityos_child_pickup_qrs`<br>`communityos_child_pickup_logs` | LocalStorage + unawaited `apiClient` | Overwrites localStorage with mock data on every fetch; swallows all network errors with `.catch(() => {})`; verification never hits server |
| [src/domains/safety/services/safetyCommandEngine.ts](file:///D:/AAZIRA/AARIZO/src/domains/safety/services/safetyCommandEngine.ts#L1-L434) | `aarizo_child_profiles_v3`<br>`aarizo_pickup_records_v3`<br>`aarizo_emergency_incidents_v3` | LocalStorage only | Zero remote API calls; `getChildren()` reads from `childSafetyService`, but `addChildProfile()` writes to `aarizo_child_profiles_v3` |
| [src/repositories/childSafety/ChildRepository.ts](file:///D:/AAZIRA/AARIZO/src/repositories/childSafety/ChildRepository.ts#L1-L39) | Firestore/BaseRepository wrapper | `POST /api/collections/children` | Posts to `collection: 'children'`, creating orphaned records disconnected from `/api/children` (`collection: 'child_profiles'`) |
| [src/services/apiClient.ts](file:///D:/AAZIRA/AARIZO/src/services/apiClient.ts#L163-L186) | `getChildren`, `createChild`, `getChildPasses`, `createChildPass`, `verifyChildPass`, `triggerChildSOS` | Express Backend REST API | `verifyChildPass` sends `{ societyId }`, but backend expects `{ guardName, gate }`; accepts internal pass ID, not scanned QR string |

### 1.3 Backend Routes & Database
| Path | Lines | Target Collection / Model | Security & Multi-Tenant Findings |
| :--- | :--- | :--- | :--- |
| [server/src/index.ts](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2660-L2673) | `GET /api/children` | `prisma.entityRecord` (`child_profiles`) | Missing `requireRole`; unsafe `soc-gvs` fallback; accepts query `?societyId=`; leaks all children if caller is not resident |
| [server/src/index.ts](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2675-L2699) | `POST /api/children` | `prisma.entityRecord` (`child_profiles`) | Accepts arbitrary `societyId` in body; unvalidated child data; no flat or guardian ownership verification |
| [server/src/index.ts](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2701-L2713) | `GET /api/children/passes` | `prisma.entityRecord` (`child_gate_passes`) | Missing `requireRole`; leaks all passes across society; does not scope to resident or flat |
| [server/src/index.ts](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2715-L2741) | `POST /api/children/passes` | `prisma.entityRecord` (`child_gate_passes`) | Caller can generate passes for any child profile without parental ownership check |
| [server/src/index.ts](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2743-L2765) | `POST /api/children/passes/:id/verify` | `prisma.entityRecord` (`child_gate_passes`) | Zero tenant isolation check (`record.societyId === req.societyId` missing); no expiry check; no replay check; no pass status validation |
| [server/src/index.ts](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2767-L2786) | `POST /api/children/sos` | `prisma.emergencyIncident` | Completely unauthenticated; anyone can trigger critical emergency alerts for any society |
| [server/prisma/schema.prisma](file:///D:/AAZIRA/AARIZO/server/prisma/schema.prisma) | N/A | No Child Model | Child data is unindexed and stored as unstructured JSON in `EntityRecord` |
| [scripts/postgres/01_schema.sql](file:///D:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L326-L340) | `child_safety` table | Raw PostgreSQL Table | Disconnected legacy table; not referenced in Prisma or backend routes; lacks gate pass and exit log tables |

---

## 2. Exhaustive Audit Findings

### F-B2-01: Multi-Device Gate Verification Failure (CRITICAL)
- **Location:** [src/services/childSafetyService.ts#L417-L485](file:///D:/AAZIRA/AARIZO/src/services/childSafetyService.ts#L417-L485), [src/pages/dashboard/security/ChildGateScannerPage.tsx#L58-L77](file:///D:/AAZIRA/AARIZO/src/pages/dashboard/security/ChildGateScannerPage.tsx#L58-L77)
- **Mechanism:** When a parent creates a pickup QR pass on their mobile app, `generateChildPickupQR` writes the pass to the mobile device's `localStorage.getItem('communityos_child_pickup_qrs')`. When the authorized caretaker or escort arrives at the society security gate, the guard opens `ChildGateScannerPage.tsx` and scans the QR code. `ChildGateScannerPage` invokes `childSafetyService.verifyAndScanChildPickup(societyId, codeStr)`.
- **Defect:** `verifyAndScanChildPickup` performs:
  ```ts
  const qrs = this.getPickupQRs(societyId);
  const qrPass = qrs.find(q => q.qrCode === qrCodeStr);
  if (!qrPass) {
    return { allowed: false, message: 'Invalid or unknown Child Pickup QR Code' };
  }
  ```
  `getPickupQRs` reads exclusively from `localStorage.getItem('communityos_child_pickup_qrs')` on the gate terminal device. Because localStorage is isolated to the browser origin on a single machine, the guard's device has an empty array or stale local demo items.
- **Impact:** Every single legitimate child pickup pass generated by parents fails gate verification with `"Invalid or unknown Child Pickup QR Code"`. Gate security cannot function.

### F-B2-02: Silent Swallowed Mutations & False Success in UI (CRITICAL)
- **Location:** [src/services/childSafetyService.ts#L283-L284](file:///D:/AAZIRA/AARIZO/src/services/childSafetyService.ts#L283-L284), [L412](file:///D:/AAZIRA/AARIZO/src/services/childSafetyService.ts#L412), [L580](file:///D:/AAZIRA/AARIZO/src/services/childSafetyService.ts#L580)
- **Evidence:**
  ```ts
  // L283-L284
  childRepository.create(updated).catch(() => {});
  apiClient.createChild(updated).catch(() => {});

  // L412
  apiClient.createChildPass(newQR).catch(() => {});

  // L580
  apiClient.triggerChildSOS(newAlert).catch(() => {});
  ```
- **Defect:** Network mutations are dispatched asynchronously without `await`, and all promise rejections are silently discarded using empty arrow functions (`.catch(() => {})`).
- **Impact:** If the backend database is unreachable, the network is offline, the authentication token is expired, or the tenant validation fails, the UI returns immediately indicating successful creation or SOS dispatch. In an emergency (e.g. child missing SOS), parents are misled into believing society guards have been dispatched when the backend received nothing.

### F-B2-03: Architectural Schism Between Resident & Admin/Guard Portals (HIGH)
- **Location:** [src/domains/safety/services/safetyCommandEngine.ts#L19-L21](file:///D:/AAZIRA/AARIZO/src/domains/safety/services/safetyCommandEngine.ts#L19-L21), [L312-L355](file:///D:/AAZIRA/AARIZO/src/domains/safety/services/safetyCommandEngine.ts#L312-L355)
- **Mechanism:** Two parallel child safety engines exist in the frontend:
  1. `safetyCommandEngine.ts` (used by `SafetyCommandHub.tsx` on `/resident/child-safety`)
  2. `childSafetyService.ts` (used by `AdminChildSafetyPage.tsx` and `ChildGateScannerPage.tsx`)
- **Evidence:**
  - `safetyCommandEngine.ts` reads:
    ```ts
    public getChildren(): ChildProfileItem[] {
      const canonicalChildren = childSafetyService.getChildren('soc-gvs');
      ...
    }
    ```
    It hardcodes `'soc-gvs'` and reads from `childSafetyService`.
  - BUT when adding a child:
    ```ts
    public addChildProfile(childName, flatCode, guardianName, guardianPhone) {
      const children = this.getStoredChildren(); // reads 'aarizo_child_profiles_v3'
      ...
      this.saveChildren(children); // writes 'aarizo_child_profiles_v3'
    }
    ```
  - It writes to `aarizo_child_profiles_v3`, but does NOT write to `childSafetyService`!
  - When the component reloads its list via `loadData() -> safetyCommandEngine.getChildren()`, it reads from `childSafetyService.getChildren('soc-gvs')`. The child just added to `aarizo_child_profiles_v3` is omitted!
- **Impact:** Newly created children disappear immediately from the user interface upon state reload.

### F-B2-04: Dual Unsynchronized Backend Endpoints & Record Duplication (HIGH)
- **Location:** [src/services/childSafetyService.ts#L283-L284](file:///D:/AAZIRA/AARIZO/src/services/childSafetyService.ts#L283-L284), [src/repositories/BaseRepository.ts#L42](file:///D:/AAZIRA/AARIZO/src/repositories/BaseRepository.ts#L42), [server/src/index.ts#L2686](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2686), [L4041](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L4041)
- **Defect:** `saveChildProfile` calls:
  1. `childRepository.create(updated)` -> dispatches `POST /api/collections/children`, writing to `EntityRecord` with `collection = 'children'`.
  2. `apiClient.createChild(updated)` -> dispatches `POST /api/children`, writing to `EntityRecord` with `collection = 'child_profiles'`.
- **Impact:** Each write produces two divergent records in the database with different IDs and different collection tags. Queries to `/api/children` only read `child_profiles`, while repository queries only read `children`.

### F-B2-05: Missing Multi-Tenant Isolation & Insecure Society Overrides (CRITICAL)
- **Location:** [server/src/index.ts#L2662](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2662), [L2677](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2677), [L2703](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2703), [L2717](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2717), [L2743-L2760](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2743-L2760)
- **Evidence:**
  ```ts
  const societyId = req.societyId || (req.query.societyId as string) || 'soc-gvs';
  ```
- **Defect:**
  1. If `req.societyId` is null/undefined, it defaults to the hardcoded development string `'soc-gvs'` instead of failing closed with HTTP 401/403.
  2. Any tenant can specify `?societyId=other-society` in the query string or `req.body.societyId` to query or inject records into foreign societies.
  3. `POST /api/children/passes/:id/verify` (lines 2743-2760) fetches the pass by ID and immediately verifies it **WITHOUT checking that `record.societyId === req.societyId`**. A guard authenticated in Society A can verify and exit a child belonging to Society B.

### F-B2-06: Unauthenticated SOS Alert Endpoint (CRITICAL)
- **Location:** [server/src/index.ts#L2767-L2786](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2767-L2786)
- **Evidence:**
  ```ts
  app.post('/api/children/sos', async (req: Request, res: Response) => {
    try {
      const societyId = req.societyId || req.body.societyId || 'soc-gvs';
      const incident = await prisma.emergencyIncident.create({ ... });
      broadcastEvent('EMERGENCY_INCIDENT_CREATED', incident, societyId);
      broadcastEvent('CHILD_SAFETY_SOS_TRIGGERED', { ...req.body, incidentId: incident.id }, societyId);
      res.status(201).json(incident);
    }
    ...
  });
  ```
- **Defect:** `POST /api/children/sos` does not use `requireRole` or authentication middleware.
- **Impact:** Any unauthenticated caller on the public internet can trigger CRITICAL child missing alerts, create database emergency incident rows, and flood guards with false alarms across any society.

### F-B2-07: Pass Verification Security Flaws (Replay, Expiry, Revocation) (HIGH)
- **Location:** [server/src/index.ts#L2743-L2765](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2743-L2765)
- **Defect:** In `POST /api/children/passes/:id/verify`:
  1. **No Replay Protection**: It does not check if `record.data.status === 'VERIFIED_EXITED'`. It overwrites `verifiedAt` and returns 200 repeatedly.
  2. **No Expiry Verification**: It does not check whether `record.data.validUntil < now`. Expired passes can be used indefinitely.
  3. **No Revocation Verification**: It does not check whether the pass or authorized pickup person was revoked.
  4. **No Exit Log Audit Trail**: Verification updates the JSON field of the pass record but does not record an immutable child exit audit record (`ChildExitLog`).

### F-B2-08: Complete Realtime Event Name Mismatch (MEDIUM)
- **Location:** [server/src/index.ts#L2694-L2781](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2694-L2781) vs [src/pages/dashboard/security/ChildGateScannerPage.tsx#L39-L48](file:///D:/AAZIRA/AARIZO/src/pages/dashboard/security/ChildGateScannerPage.tsx#L39-L48)
- **Comparison:**
  | Backend Broadcast Event | Frontend Scanner Listened Event | Match? |
  | :--- | :--- | :--- |
  | `CHILD_PROFILE_CREATED` | `CHILD_SAFETY_UPDATED` | ❌ MISMATCH |
  | `CHILD_GATE_PASS_GENERATED` | `CHILD_SAFETY_UPDATED` | ❌ MISMATCH |
  | `CHILD_GATE_PASS_VERIFIED` | `CHILD_EXIT_SCANNED` | ❌ MISMATCH |
  | `CHILD_SAFETY_SOS_TRIGGERED` | `CHILD_ALERT_TRIGGERED` | ❌ MISMATCH |
  | `EMERGENCY_INCIDENT_CREATED` | `EMERGENCY_ALERTS` | ❌ MISMATCH |
- **Impact:** The gate scanner never refreshes automatically when a pass is created or modified by a resident because none of the server-emitted event names match frontend subscriber listeners.

---

## 3. Database Schema Analysis

### 3.1 Current PostgreSQL State
1. **Prisma Schema (`server/prisma/schema.prisma`)**:
   - Contains NO Child Safety models.
   - Child profiles and passes are serialized as JSON into `EntityRecord`:
     - `collection = 'child_profiles'`
     - `collection = 'child_gate_passes'`
   - Problem: JSON fields (`data->>'residentId'`, `data->>'status'`, `data->>'passCode'`, `data->>'childId'`) are completely unindexed. Queries require table scans over all entity records.
2. **Legacy SQL (`scripts/postgres/01_schema.sql`)**:
   - Contains a rudimentary `child_safety` table (lines 326–340):
     - Columns: `id`, `society_id`, `resident_id`, `flat_id`, `child_name`, `age`, `photo_url`, `allowed_solo_exit`, `guardian_contact`, `exit_permission_status`, `notes`.
   - Problem: Not modeled in Prisma, not used by backend Express routes, lacks tables for Caretakers/Escorts (`child_authorized_pickups`), Gate Passes (`child_gate_passes`), and Verification Logs (`child_exit_logs`).

---

## 4. Audit Conclusion & Phase Transition

The Child Safety subsystem currently cannot guarantee data integrity, multi-tenant isolation, or physical gate security. A child pickup pass generated by a parent cannot be verified at the gate terminal across devices, and backend APIs are vulnerable to cross-tenant data leakage and unauthenticated SOS flooding.

**Audit Status:** AUDIT COMPLETE — REMEDIATION PLAN REQUIRED BEFORE IMPLEMENTATION.
Proceed to review the accompanying Security Threat Matrix, Remediation Blueprint, and Regression Test Plan.

