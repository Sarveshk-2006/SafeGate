# AARIZO ISSUE-06 — Phase B.2.3 — Phase 4.2 Findings Register

**Date:** 2026-11-18  
**Repository:** `D:\AAZIRA\AARIZO`  
**Audit Mode:** Strictly Read-Only Independent Audit  
**Totals:** `0` Critical | `0` High | `0` Blocking Medium | `1` Low-Medium (Non-Blocking) | `4` Low (Non-Blocking)

---

## Finding `F-P42-01` — Unconditional `mutationInFlightRef` Reset in `finally` Blocks Across Session Switch

- **Severity:** LOW-MEDIUM (Non-Blocking)
- **Category:** Concurrency / Double-Submit Lock Integrity
- **Exact File & Lines:**
  - `src/domains/safety/components/ResidentChildSafetyPanel.tsx#L220`
  - `src/domains/safety/components/ResidentChildSafetyPanel.tsx#L393-L398` (`submitCreateChild`)
  - `src/domains/safety/components/ResidentChildSafetyPanel.tsx#L454-L459` (`submitEditChild`)
  - `src/domains/safety/components/ResidentChildSafetyPanel.tsx#L497-L502` (`confirmArchiveChild`)
- **Evidence:**
  ```ts
  } finally {
    mutationInFlightRef.current = false;
    if (mountedRef.current && activeSessionKeyRef.current === reqSession) {
      setIsSubmitting(false);
    }
  }
  ```
- **Impact:** All React state mutations (`setModalMode`, `setSuccessMessage`, `setFormError`, `setActionError`, `setIsSubmitting`) are properly guarded by `activeSessionKeyRef.current === reqSession`, so cross-session state pollution **cannot** occur. However, if User A initiates a mutation, switches to User B (which resets `mutationInFlightRef.current = false` at `#L220`), User B immediately starts their own mutation (`mutationInFlightRef.current = true`), and User A's delayed HTTP request then settles, User A's `finally` block unconditionally sets `mutationInFlightRef.current = false` while User B's mutation is still in flight — temporarily disarming User B's duplicate-submit guard within that narrow timing window.
- **Recommended Remediation (Phase 4.3+):** Introduce a monotonic `mutationSeqRef` (incremented on every mutation start and in the `sessionKey` effect) and guard cleanup with `if (mutationSeqRef.current === reqMutationSeq)` (or guard `mutationInFlightRef.current = false` with `if (activeSessionKeyRef.current === reqSession)`).

---

## Finding `F-P42-02` — `notes` Field Tracked in `ChildFormState` Without Rendered Form Input

- **Severity:** LOW (Non-Blocking)
- **Category:** Form / UI Completeness
- **Exact File & Lines:**
  - `src/domains/safety/components/ResidentChildSafetyPanel.tsx#L57` (`ChildFormState.notes`)
  - `src/domains/safety/components/ResidentChildSafetyPanel.tsx#L91` (`createEditFormFromDto`)
  - `src/domains/safety/components/ResidentChildSafetyPanel.tsx#L360` (`submitCreateChild`)
  - `src/domains/safety/components/ResidentChildSafetyPanel.tsx#L421` (`submitEditChild`)
  - `src/domains/safety/components/ResidentChildSafetyPanel.tsx#L1360-L1377` (Create/Edit modal form fields — only `medicalNotes` is rendered)
- **Evidence:** `ChildFormState` maintains `notes`, populates it from `child.notes` when editing, and forwards it to `buildResidentCreateChildPayload` / `buildResidentUpdateChildPayload`, but the modal JSX renders only `medicalNotes` (`#child-medical-notes`) and has no input for `notes`.
- **Impact:** Zero data loss or contract violation (`notes` is omitted as `null`/undefined on create, and any backend-existing `child.notes` is round-tripped intact on edit), but residents cannot view or modify general `notes` in the modal.
- **Recommended Remediation (Optional):** Either render an optional "Additional Notes" textarea bound to `formState.notes` or remove `notes` from `ChildFormState` / edit payload if intentionally admin-only or deferred.

---

## Finding `F-P42-03` — Stale Child Cards Remain Rendered Below Banner on Refresh `401` Error

- **Severity:** LOW (Non-Blocking)
- **Category:** Auth-Failure Defense-in-Depth
- **Exact File & Lines:**
  - `src/domains/safety/components/ResidentChildSafetyPanel.tsx#L204-L209` (`loadChildren` catch block)
  - `src/domains/safety/components/ResidentChildSafetyPanel.tsx#L825-L869` (error alert banner)
  - `src/domains/safety/components/ResidentChildSafetyPanel.tsx#L929` (`{ctrl.children.length > 0 && ...}`)
- **Evidence:** When `children` already contains loaded profiles and a subsequent manual refresh fails with HTTP `401 UNAUTHORIZED`, `loadChildren()` sets `loadError` (`kind: 'UNAUTHORIZED'`) without clearing `children`, so `{ctrl.children.length > 0 && ...}` continues rendering prior cards below the "Session Expired" alert.
- **Impact:** In full app runtime, `apiClient` dispatches `'aarizo:unauthorized'` on `401`, causing `AuthContext` to clear `currentUser` and triggering `ResidentChildSafetyPanel`'s `sessionKey` wipe (`#L217-L239`). Clearing `children` directly inside `loadChildren()` on `401` improves defense-in-depth if `AuthContext` logout is delayed or decoupled.
- **Recommended Remediation (Phase 4.3+):** In `loadChildren()` `catch` (`#L208`), check `const formatted = formatChildSafetyError(err); if (formatted.kind === 'UNAUTHORIZED') { setChildren([]); } setLoadError(formatted);`.

---

## Finding `F-P42-04` — Legacy Non-Resident Branch in `SafetyCommandHub.tsx` Uses `!isResidentRole` Instead of `isAdminOrSecurity`

- **Severity:** LOW (Non-Blocking)
- **Category:** Defense-in-Depth / Role Scoping
- **Exact File & Lines:**
  - `src/domains/safety/components/SafetyCommandHub.tsx#L37-L38`
  - `src/domains/safety/components/SafetyCommandHub.tsx#L550-L552`
- **Evidence:**
  ```tsx
  {activeTab === 'CHILD_SAFETY' && isResidentRole && <ResidentChildSafetyPanel />}

  {activeTab === 'CHILD_SAFETY' && !isResidentRole && (
  ```
- **Impact:** Production routes already enforce `RoleGuard` (`['resident']` on `/resident/child-safety`; `['admin', 'secretary', 'guard']` on `/admin/safety-command`), and `ResidentChildSafetyPanel` fails closed directly on unauthenticated or `vendor` users (`#L728-L751`). However, if `SafetyCommandHub` were mounted directly for an unauthenticated or `vendor` user, `!isResidentRole` would fall through to the legacy non-resident panel rather than failing closed.
- **Recommended Remediation (Phase 5/6):** Narrow `#L552` from `!isResidentRole` to `isAdminOrSecurity` when cutting over Admin and Security portals in Phases 5–6.

---

## Finding `F-P42-05` — Minor Phase 4.2 Behavioral Test Coverage Gaps & Test Title Precision

- **Severity:** LOW (Non-Blocking)
- **Category:** Automated Test Coverage
- **Exact File & Lines:**
  - `tests/issue06_b23_phase4_2_resident_child_profiles.test.ts#L519-L559` (test title references `401/409 errors`, while test body exercises `401` without a `409` mock response)
  - `tests/issue06_b23_phase4_2_resident_child_profiles.test.ts` (overall coverage)
- **Evidence:** The existing 9 Phase 4.2 tests provide genuine end-to-end behavioral and SSR render verification of core CRUD, RBAC, duplicate-submit protection, `401`/`403`/`404`/network error handling, and `listChildren` session-switch isolation. The following secondary edge cases do not yet have dedicated assertions:
  1. HTTP `409 CHILD_ARCHIVED` failure on archive/edit keeping modal open with visible formatted error.
  2. Archive confirmation cancellation via `closeModal()` confirming `0` network calls and state reset.
  3. `openEditModal()` stale detail-request race (`detailRequestSeqRef`) and rejection of an already-`ARCHIVED` child (`#L298-L303`).
  4. Client-side validation failure (e.g., blank `fullName` or out-of-range age) confirming `0` `fetch` calls and populated `formError`.
  5. Post-session-switch settlement of an in-flight mutation (`submitCreateChild` / `submitEditChild` / `confirmArchiveChild`) — which would also serve as a regression test for `F-P42-01`.
- **Recommended Remediation (Phase 4.3+):** Add focused regression cases for these 5 edge cases when expanding the resident behavioral suite in Phase 4.3.

