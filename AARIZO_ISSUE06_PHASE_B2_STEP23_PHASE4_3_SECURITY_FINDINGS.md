# AARIZO ISSUE-06 — Phase B.2.3 — Phase 4.3 Security & Implementation Findings Register

**Date:** 2026-11-18  
**Repository:** `D:\AAZIRA\AARIZO`  
**Audit Mode:** Strictly Read-Only Independent Audit  
**Totals:** `0` Critical | `0` High | **`2` Medium (Blocking before Phase 4.4)** | `3` Low (Non-Blocking) | `1` Informational / Open Deferred (`F-P42-04`)

---

## `F-P43-01` — Expired Pickup Renewal Bypass via `Remove Expiry Limit` (`validUntil: null`)

- **Severity:** **MEDIUM (BLOCKING BEFORE PHASE 4.4)**
- **Category:** Lifecycle Integrity / Authorization Policy Bypass (`F-B22-06C`)
- **Exact Files & Lines:**
  - Frontend UI: `src/domains/safety/components/ResidentAuthorizedPickupsSection.tsx#L1783-L1799`
  - Frontend Controller: `src/domains/safety/components/ResidentAuthorizedPickupsSection.tsx#L632-L640`
  - Backend Router: `server/src/childSafety/router.ts#L2380-L2430`
- **Reproducible Evidence:**
  1. Take a pickup row with `status: 'ACTIVE'` and `validUntil: '2025-01-10T08:00:00.000Z'` (expired by time — `getEffectivePickupStatus()` returns `'EXPIRED'` and `POST /api/children/passes` rejects it with `422 PICKUP_AUTHORIZATION_EXPIRED`).
  2. Open Edit modal on that pickup. Line `#L1783` renders the **"Remove Expiry Limit"** button because `!ctrl.editForm.clearValidUntil && (ctrl.editForm.validUntil || ctrl.editForm.initialValidUntil)` is true regardless of `editingDisplay?.effectiveStatus === 'EXPIRED'`.
  3. Click **"Remove Expiry Limit"** and submit. `submitEditPickup()` (`#L632-L633`) sends `PATCH /api/children/:childId/pickups/:pickupId` with `{ name, phone, relationship, validUntil: null }` and **no `status` field**.
  4. On the backend (`router.ts#L2381-L2384`), `body.validUntil === null` sets `updateData.validUntil = null`. Because `body.status === undefined`, the expired-renewal guard at `#L2393-L2423` (`EXPIRED_PICKUP_REQUIRES_FUTURE_VALID_UNTIL`) is **skipped completely**! The database row is updated to `{ status: 'ACTIVE', validUntil: null }`, silently reactivating an expired escort into an **indefinitely valid `ACTIVE` escort** without providing a new future expiry timestamp.
  5. Additionally, for a persisted `status: 'EXPIRED'` pickup, clicking **"Remove Expiry Limit"** clears `validUntil` to `null` while leaving `status: 'EXPIRED'` in PostgreSQL — yielding a contradictory UI state (`Expired` + `Valid Until: No Expiry Set`).
- **Impact:** Directly violates lifecycle policy (`F-B22-06C` and Phase 4.3 audit requirement: *"Renewal from expired status is valid only with a future `validUntil`; invalid transitions fail closed"*) and directly affects Phase 4.4 Gate Pass issuance eligibility (`isPickupSelectableForPass`).
- **Smallest Safe Remediation:**
  1. In `ResidentAuthorizedPickupsSection.tsx#L1783`: hide the **"Remove Expiry Limit"** button whenever `editingDisplay?.effectiveStatus === 'EXPIRED'`.
  2. In `ResidentAuthorizedPickupsSection.tsx#L632`: reject `form.clearValidUntil` when `targetDisplay.effectiveStatus === 'EXPIRED'` with a clear `formError` requiring a new future expiry timestamp.
  3. In `server/src/childSafety/router.ts#L2381-L2392`: compute `wasExpiredByTime = Boolean(pickup.validUntil && new Date(pickup.validUntil) <= now)` before the `validUntil` branch; if `(pickup.status === 'EXPIRED' || wasExpiredByTime)` and `body.validUntil === null || body.validUntil === ''`, fail closed with HTTP `422 EXPIRED_PICKUP_REQUIRES_FUTURE_VALID_UNTIL`.

---

## `F-P43-02` — Silent Calendar-Date Overflow in Timestamp Parsing (`2027-02-30` → `2027-03-02`)

- **Severity:** **MEDIUM (BLOCKING BEFORE PHASE 4.4)**
- **Category:** Input Validation / Date & Timezone Correctness
- **Exact Files & Lines:**
  - Frontend Helper: `src/domains/safety/utils/childSafetyResidentHelpers.ts#L328-L339` (`parseTimestampMs`)
  - Backend Helper: `server/src/childSafety/validation.ts#L46-L53` (`parseIsoDate`)
- **Reproducible Evidence:**
  Executed directly in Node (`node -e`):
  - `new Date(Date.parse('2027-02-30T12:00:00Z')).toISOString()` → `'2027-03-02T12:00:00.000Z'` (silently rolled over 2 days into March instead of returning `NaN` / `null`!).
  - `new Date(Date.parse('2027-04-31T12:00')).toISOString()` → `'2027-05-01T06:30:00.000Z'` (silently rolled over into May!).
- **Impact:** Both pickup expiry (`validUntil`) and Phase 4.4 gate pass validity windows (`validFrom`, `validUntil`, child `dateOfBirth`) rely on `parseTimestampMs` and `parseIsoDate`. Non-existent calendar dates silently shift into unintended future dates instead of failing closed.
- **Smallest Safe Remediation:**
  - In `parseTimestampMs()` (`childSafetyResidentHelpers.ts`) and `parseIsoDate()` (`server/src/childSafety/validation.ts`), match ISO-like `^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$` prefixes and verify calendar validity (`y/m/d` via `new Date(Date.UTC(y, m - 1, d))` check that `getUTCFullYear() === y && getUTCMonth() === m - 1 && getUTCDate() === d`, and valid hour/minute/second bounds `0..23`, `0..59`, `0..59`) before accepting `Date.parse(...)`.

---

## `F-P43-03` — `onPickupsMutated` Callback Inside Outer Mutation `try` Block

- **Severity:** LOW (Non-Blocking)
- **Category:** Post-Mutation Error Isolation
- **Exact Files & Lines:**
  - `src/domains/safety/components/ResidentAuthorizedPickupsSection.tsx#L573-L576` (`submitAddPickup`)
  - `src/domains/safety/components/ResidentAuthorizedPickupsSection.tsx#L668-L671` (`submitEditPickup`)
  - `src/domains/safety/components/ResidentAuthorizedPickupsSection.tsx#L736-L739` (`confirmRevokePickup`)
  - `src/domains/safety/components/ResidentAuthorizedPickupsSection.tsx#L804-L807` (`confirmArchivePickup`)
- **Evidence:** `await onPickupsMutatedRef.current?.(reqChildId)` runs inside the same `try / catch` block as the primary backend mutation. While `ResidentChildSafetyPanel.tsx` passes `() => ctrl.loadChildren({ silent: true })` (which catches errors internally and does not throw), any caller passing a rejecting async `onPickupsMutated` callback would cause the outer `catch` block to return `false` and display `actionError` even though the backend mutation succeeded.
- **Smallest Safe Remediation:** Wrap `await onPickupsMutatedRef.current?.(reqChildId)` in its own `try { ... } catch (err) { setActionError(formatChildSafetyError(err)); }` while still returning `true` for the committed mutation.

---

## `F-P43-04` — Permissive Phone Number Validation Accepts Non-Phone Text

- **Severity:** LOW (Non-Blocking)
- **Category:** Input Validation
- **Exact Files & Lines:**
  - `src/domains/safety/utils/childSafetyResidentHelpers.ts#L815-L818`, `#L888-L894`
  - `server/src/childSafety/router.ts#L2238-L2240`, `#L2368-L2372`
- **Evidence:** Phone validation checks only `trimmed.length >= 1 && trimmed.length <= 32`, accepting strings with no digits (e.g., `"abc"`, `"---"`) or trivially short inputs (`"1"`).
- **Smallest Safe Remediation:** Enforce a realistic phone character allowlist (`+`, digits, spaces, `-`, `(`, `)`) and minimum digit count (`>= 7` digits) in frontend pickup validation helpers (confirming compatibility with existing test phone fixtures).

---

## `F-P43-05` — Remaining Automated Test Coverage Gaps

- **Severity:** LOW (Non-Blocking)
- **Category:** Automated Regression Coverage
- **Exact Files & Lines:**
  - `tests/issue06_b23_phase4_3_resident_authorized_pickups.test.ts`
  - `tests/issue06_b23_phase4_2_resident_child_profiles.test.ts`
- **Missing Scenarios Identified:**
  1. Failed `GET` pickup refresh (`loadPickups()`) immediately after a successful `POST`/`PATCH`/`revoke`/`archive` mutation (asserting `successMessage` remains intact and retryable `loadError` appears).
  2. Attempting `clearValidUntil: true` on an `EXPIRED` pickup (regression test for `F-P43-01` — frontend & backend).
  3. Invalid calendar dates (`2027-02-30T12:00:00Z`, `2027-04-31T12:00`) and invalid phone strings (regression tests for `F-P43-02` & `F-P43-04`).
  4. Child switching during an in-flight **mutation** (`submitAddPickup` / `submitEditPickup` / `confirmRevokePickup`) verifying Child 1's settling mutation neither pollutes Child 2 nor releases Child 2's mutation lock.
  5. Archive modal cancellation (`0` network calls), `409 ALREADY_ARCHIVED` on pickup archive, and `ARCHIVED` child blocking `openAddModal()` / hiding Add button.
  6. Stale `openEditModal` detail-request race (`detailRequestSeqRef`) in `tests/issue06_b23_phase4_2_resident_child_profiles.test.ts`.

---

## `F-P42-04` (Carried Forward) — `SafetyCommandHub.tsx#L552` Legacy Non-Resident Branch Guard

- **Severity:** INFORMATIONAL / OPEN DEFERRED (Verified Untouched as Intended)
- **Exact File & Line:** `src/domains/safety/components/SafetyCommandHub.tsx#L552`
- **Status:** Confirmed untouched in Phase 4.3 (`SafetyCommandHub.tsx` retains its exact `+5/-1` Phase 4.2 diff). Production routes enforce `RoleGuard` (`['resident']` vs `['admin', 'secretary', 'guard']`); scheduled for narrowing from `!isResidentRole` to `isAdminOrSecurity` during Phases 5–6 Admin/Security cutover.

