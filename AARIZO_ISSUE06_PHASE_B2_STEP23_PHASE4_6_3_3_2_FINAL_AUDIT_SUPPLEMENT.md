# AARIZO — PHASE 4.6.3.3.2 — FINAL AUDIT EVIDENCE SUPPLEMENT
## Backend Pass Constraints & QR Bearer-Token Lifecycle Analysis

**Repository:** `D:\AAZIRA\AARIZO`  
**Phase:** Issue-06 / Phase B.2 / Step 2.3 / Subphase 4.6.3.3.2  
**Audit Document:** Evidence Supplement to `AARIZO_ISSUE06_PHASE_B2_STEP23_PHASE4_6_3_3_2_FINAL_INDEPENDENT_REAUDIT.md`  
**Audit Mode:** STRICTLY READ-ONLY Source-Level Audit  
**Audit Date:** 2026-11-19  
**Verdict:** **CONDITIONAL PASS — TARGETED REMEDIATION REQUIRED**  

---

## 1. Executive Summary

This audit supplement provides the definitive source-level investigation of the two remaining evidence areas for Phase 4.6.3.3.2:
1. **Area A — Backend Pass Constraints:** Exhaustive verification of server-side validation on `POST /api/children/passes`, downstream single-use consumption semantics, validity window enforcement, multi-tenant relationship validation, and atomic concurrency protection.
2. **Area B — QR Bearer-Token Lifecycle:** Exhaustive trace of all 8 lifecycle triggers across modal dismissal, child selection change, in-place session changes, logout, 401 handling, component unmount, failed requests, and concurrent/stale asynchronous generation responses.

### Summary of Verdict
- **Backend Pass Constraints (Area A):** **PASS**. Backend independently and strictly enforces single-use constraints, 7-day validity bounds, future timestamp rules, society isolation, child ownership, and atomic conditional verification under transaction row locks.
- **QR Bearer-Token Lifecycle (Area B):** **CONDITIONAL PASS**. An asynchronous race condition was identified: `SafetyCommandHub.tsx:handleGeneratePassSubmit` does not tie the in-flight promise to a request generation token or active child ID. If staff cancels an in-flight creation request for Child A and opens the modal for Child B during the network latency window, Child A's resolving response can place Child A's QR payload into the active modal for Child B.

---

## 2. Area A: Backend Pass Constraints Audit

### 2.1 `maxUses` Validation & Independent Single-Use Semantics
- **Client Parameter Acceptance & Bounding:**
  - In `server/src/childSafety/router.ts` (lines 276–282):
    ```typescript
    const maxUses = body.maxUses !== undefined ? Number(body.maxUses) : 1;
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 10) {
      return res.status(400).json({
        error: 'maxUses must be an integer between 1 and 10.',
        code: 'INVALID_MAX_USES',
      });
    }
    ```
  - The client value is strictly clamped between 1 and 10. Non-integers, negative numbers, zero, or values `> 10` are rejected immediately with HTTP 400 `INVALID_MAX_USES`.
- **Independent Single-Use Consumption:**
  - In `SafetyCommandHub.tsx` (line 224), `maxUses: 1` is explicitly specified by the staff controller.
  - In `server/src/childSafety/router.ts` (lines 616–628, 696–718), the verification handler independently enforces:
    ```typescript
    if (pass.status === 'USED' || pass.currentUses >= pass.maxUses) {
      const deniedLog = await logDenial('DENIED', 'PASS_ALREADY_CONSUMED');
      return { authorized: false, httpStatus: 409, code: 'PASS_ALREADY_CONSUMED', ... };
    }
    ```
  - Upon valid exit, the pass is consumed atomically:
    ```typescript
    const nextUses = pass.currentUses + 1;
    const nextStatus = nextUses >= pass.maxUses ? 'USED' : 'ACTIVE';
    ```
  - When `maxUses === 1`, `nextUses` becomes 1, and `nextStatus` immediately transitions to `'USED'`, permanently expiring the pass after a single exit.

### 2.2 Timestamp Validation & Duration Limits
In `server/src/childSafety/router.ts` (lines 49, 254–274):
```typescript
const MAX_PASS_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days upper bound

const now = new Date();
const validFrom = body.validFrom !== undefined ? parseIsoDate(body.validFrom) : now;
const validUntil = parseIsoDate(body.validUntil);
if (!validFrom || !validUntil) {
  return res.status(400).json({
    error: 'validUntil must be a valid ISO-8601 timestamp (and validFrom if supplied).',
    code: 'INVALID_VALIDITY_WINDOW',
  });
}
if (validUntil <= validFrom || validUntil <= now) {
  return res.status(400).json({
    error: 'validUntil must be strictly after validFrom and in the future.',
    code: 'INVALID_VALIDITY_WINDOW',
  });
}
if (validUntil.getTime() - validFrom.getTime() > MAX_PASS_DURATION_MS) {
  return res.status(400).json({
    error: 'Gate pass validity window cannot exceed 7 days.',
    code: 'VALIDITY_WINDOW_TOO_LONG',
  });
}
```
- **Expired timestamps** (`validUntil <= now`) are rejected with HTTP 400 `INVALID_VALIDITY_WINDOW`.
- **Reversed or zero-duration windows** (`validUntil <= validFrom`) are rejected with HTTP 400 `INVALID_VALIDITY_WINDOW`.
- **Excessively long windows** (`> 7 days`) are rejected with HTTP 400 `VALIDITY_WINDOW_TOO_LONG`.
- **Malformed timestamps** are rejected with HTTP 400 `INVALID_VALIDITY_WINDOW`.

### 2.3 Society Membership, Child Ownership, & Pickup Authorization
1. **Society Membership:**
   - Evaluated strictly from verified JWT `req.authContext` in `resolveChildSafetyActor(req, res)` (`authz.ts:34-109`).
   - If the caller supplies a different `societyId` in body, params, or query, backend rejects with HTTP 403 `TENANT_ISOLATION_VIOLATION` (`authz.ts:71-77`).
2. **Child Ownership & Society Isolation:**
   - In `authz.ts:167-207`, `authorizeChildAccess` queries `prisma.childProfile.findFirst({ where: { id: childId, societyId: actor.societyId } })`.
   - Foreign-society child IDs return HTTP 404 `CHILD_NOT_FOUND` (preventing tenant existence leakage).
   - If a resident attempts to create a pass for a child they do not own, backend rejects with HTTP 403 `UNAUTHORIZED_CHILD_ACCESS` (`authz.ts:198`).
3. **Pickup Authorization:**
   - In `router.ts:297-324`, pickup lookup is strictly scoped to:
     ```typescript
     where: { id: pickupPersonId, societyId: child.societyId, childId: child.id }
     ```
   - An escort belonging to a different child or society returns HTTP 404 `PICKUP_PERSON_NOT_FOUND`.
   - Inactive escorts return HTTP 422 `PICKUP_AUTHORIZATION_INACTIVE`.
   - Expired escorts (`pickup.validUntil <= now`) return HTTP 422 `PICKUP_AUTHORIZATION_EXPIRED`.
   - If no escort is provided, `router.ts:325-330` enforces that the child must have `exitPermissionMode === 'SOLO_ALLOWED'` and `allowedSoloExit === true`; otherwise returns HTTP 422 `AUTHORIZED_PICKUP_REQUIRED`.

### 2.4 Concurrency Protection & Atomic Verification
In `server/src/childSafety/router.ts` (lines 469–732):
- Verification runs inside `prisma.$transaction`.
- Serializes child profile row via PostgreSQL lock: `SELECT ... FOR UPDATE` (`lockChildProfileRow`, `router.ts:520`).
- Atomic consumption uses conditional update:
  ```typescript
  const consumed = await tx.childGatePass.updateMany({
    where: {
      id: pass.id,
      societyId: actor.societyId,
      tokenHash: pass.tokenHash,
      status: 'ACTIVE',
      archivedAt: null,
      revokedAt: null,
      validFrom: { lte: now },
      validUntil: { gt: now },
      currentUses: pass.currentUses, // Optimistic concurrency check
    },
    data: {
      currentUses: nextUses,
      firstUsedAt: pass.firstUsedAt ?? now,
      lastUsedAt: now,
      status: nextStatus,
    },
  });
  if (consumed.count !== 1) {
    const replayLog = await logDenial('DENIED', 'PASS_CONCURRENT_OR_ALREADY_CONSUMED');
    return { authorized: false, httpStatus: 409, code: 'PASS_ALREADY_CONSUMED', ... };
  }
  ```
- If two verification requests race for the same single-use pass, exactly one achieves `consumed.count === 1`. The conflicting transaction fails with HTTP 409 `PASS_ALREADY_CONSUMED` and logs `PASS_CONCURRENT_OR_ALREADY_CONSUMED`.

### 2.5 Test Evidence for Backend Pass Constraints
- `tests/issue06_child_safety_api_routes.test.ts`:
  - Line 468: Rejection of expired escort with HTTP 422 `PICKUP_AUTHORIZATION_EXPIRED`.
  - Line 519: Pass generation produces 256-bit bearer token and persists only `tokenHash`.
  - Line 523: `tokenHash` omitted from response DTO.
  - Line 530: Realtime event contains zero secret material.
  - Line 607–667: Verification rejects replay attacks, revoked passes, expired passes, and missing-child alerts.
- `tests/issue06_b23_child_gate_scanner.test.ts`:
  - Line 45: Concurrency protection prevents double-submission in flight.
  - Line 65: Backend denial outcomes (`PASS_EXPIRED`, `PASS_ALREADY_CONSUMED`) map to secure UI states.

---

## 3. Area B: QR Bearer-Token Lifecycle Audit

### 3.1 Lifecycle Trace Matrix

| Lifecycle Trigger | Source Reference in `SafetyCommandHub.tsx` | Mechanism / Behavior | Proven Status |
|---|---|---|---|
| **1. Explicit Close / Dismiss** | Lines 503–508, 1804–1806, 1826 | `handleClosePassModal` calls `setGeneratedPass(null)`, `setModalMode(null)`. Triggered by "Done — Clear One-Time QR", "Cancel", and overlay click. | **VERIFIED** |
| **2. Child Selection Change** | Lines 493–501 | `handleOpenGeneratePassModal(child)` synchronously executes `setGeneratedPass(null)` before switching active child. | **VERIFIED** |
| **3. Component Unmount** | Lines 273–282 | `generatedPass` is stored solely in React `useState`. Unmounting the component automatically frees memory. | **VERIFIED** |
| **4. Failed Creation Request** | Lines 519–547 | `try { ... } catch (err) { setPassFormError(...) }`. When `executeStaffGenerateGatePass` throws, `setGeneratedPass` is never reached. `generatedPass` remains `null`. | **VERIFIED** |
| **5. Authentication Invalidation / 401** | `apiClient.ts:757`, `AuthContext.tsx:193` | 401 response from any strict endpoint invokes `clearAuthSession()` and fires `aarizo:unauthorized`. `AuthContext` catches this, setting `status = 'UNAUTHENTICATED'`. `ProtectedRoute` redirects to `/login`, causing `SafetyCommandHub` to unmount. | **VERIFIED** |
| **6. User Logout** | `AuthContext.tsx:376-386` | `logout()` sets `status = 'UNAUTHENTICATED'`, forcing `ProtectedRoute` navigation to `/login` and unmounting the component. | **VERIFIED** |
| **7. User / Session Change (In-Place)** | `SafetyCommandHub.tsx:240-252` | `SafetyCommandHub` does not have an explicit `useEffect` listening to `currentUser?.id`. If a user switches without unmount, state is retained until modal close. | **OBSERVATION** (Low) |
| **8. In-Flight Stale Request Race** | Lines 510–548 | `handleGeneratePassSubmit` does not track a request ID or verify `passChild.id` upon promise resolution. Stale response can populate modal for a subsequent child. | **FINDING** (Medium) |

---

### 3.2 Deep Trace of Finding F-P46332-01: In-Flight Stale Request Race

#### The Vulnerability Scenario:
1. Staff member opens the pass generation modal for **Child A** (`passChild.id = 'child-A'`).
2. Staff clicks "Confirm & Issue Pass" (`handleGeneratePassSubmit`).
3. An asynchronous request `childSafetyService.createGatePass(...)` is dispatched. `isSubmittingPass` is set to `true`.
4. While the HTTP request is in flight (e.g. 300ms network latency), the staff member clicks "Cancel" (`handleClosePassModal`), which is enabled (`SafetyCommandHub.tsx:1826`).
5. `handleClosePassModal` resets `modalMode = null`, `setGeneratedPass(null)`, and `setIsSubmittingPass(false)`.
6. Staff immediately clicks "Exit Pass" on **Child B** (`handleOpenGeneratePassModal(childB)`). `modalMode` is set back to `'GENERATE_PASS'`, and `passChild` is now `Child B`.
7. **Now Child A's network request resolves:**
   ```typescript
   // SafetyCommandHub.tsx:520-540
   const created = await executeStaffGenerateGatePass(...);

   setGeneratedPass({
     id: created.id,
     passCode: created.passCode,
     childName: passChild.childName, // passChild in closure is Child A!
     flatNumber: passChild.flatCode,
     pickupPersonName: created.pickupPersonName,
     validFrom: created.validFrom,
     validUntil: created.validUntil,
     qrPayload: created.qrPayload, // QR payload belongs to Child A!
   });
   ```
8. **Outcome:**
   Because `modalMode === 'GENERATE_PASS'` is currently active (intended for Child B), the modal displays **Child A's generated QR pass** (`created.qrPayload`). If staff presents this QR code to the gate guard, Child A's record will be verified instead of Child B.

#### Root Cause:
`handleGeneratePassSubmit` lacks:
1. An active request identifier or cancellation token (`AbortController`).
2. A post-await check verifying that the modal is still open and that `passChild.id` matches the request target.

---

## 4. Remediation Plan for Finding F-P46332-01

To ensure zero stale request leakage, `SafetyCommandHub.tsx` should be updated with a request-tracking reference:

```typescript
// Add ref tracking current active submission target
const passSubmissionTargetRef = useRef<string | null>(null);

const handleOpenGeneratePassModal = (child: ChildProfileItem, defaultEscortId?: string) => {
  passSubmissionTargetRef.current = null; // Invalidate any prior in-flight request
  setPassChild(child);
  ...
};

const handleClosePassModal = () => {
  passSubmissionTargetRef.current = null; // Invalidate in-flight request on close
  setModalMode(null);
  setGeneratedPass(null);
  ...
};

const handleGeneratePassSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!passChild || isSubmittingPass) return;

  const targetChildId = passChild.id;
  passSubmissionTargetRef.current = targetChildId;
  ...
  try {
    const created = await executeStaffGenerateGatePass(...);
    // Ignore stale response if modal was closed or switched to a different child
    if (passSubmissionTargetRef.current !== targetChildId) {
      return;
    }
    setGeneratedPass({ ... });
  } ...
};
```

---

## 5. Audit Verdict

### **VERDICT: CONDITIONAL PASS**

- **Area A (Backend Pass Constraints):** **FULL PASS** (Cryptographically authoritative, strictly validated, atomic single-use semantics).
- **Area B (QR Bearer-Token Lifecycle):** **CONDITIONAL PASS** (Finding **F-P46332-01** requires targeted remediation to eliminate in-flight asynchronous race conditions across modal cancellation/re-selection).

Phase 4.6.3.3.2 will be eligible for final formal closure immediately following the targeted remediation of Finding F-P46332-01.

