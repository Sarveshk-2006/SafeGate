# AARIZO ISSUE-06 — Phase B.2.3 — Phase 4.1 Independent Audit Findings Register

**Audit Date:** 2026-11-18  
**Repository:** `D:\AAZIRA\AARIZO`  
**Blocking Findings (Critical / High / Medium):** `0`  
**Non-Blocking Findings (Low-Medium / Low):** `5`

---

## Findings Table

| ID | Severity | File & Line | Summary | Blocks Phase 4.2? |
| :---: | :---: | --- | --- | :---: |
| **`F-P41-01`** | LOW-MEDIUM | `src/domains/safety/utils/childSafetyResidentHelpers.ts#L224-L264`, `#L418-L427`, `#L1341-L1417` | `GatePassDisplayModel` and `AuthorizedPickupDisplayModel` omit a separate `persistedStatus` field alongside `effectiveStatus`; corrupted `maxUses <= 0` does not fail closed in `getEffectiveGatePassStatus()` | **NO** |
| **`F-P41-02`** | LOW-MEDIUM | `src/domains/safety/utils/childSafetyResidentHelpers.ts#L328-L339` | `parseTimestampMs()` delegates to `Date.parse()`, permitting V8 calendar rollover (e.g., `'2026-02-30'`) and non-ISO numeric strings (`'12345'`) | **NO** |
| **`F-P41-03`** | LOW | `src/domains/safety/utils/childSafetyResidentHelpers.ts#L341-L365`, `#L940-L1079` | `buildResidentCreateGatePassPayload()` and `buildResidentTriggerSosPayload()` do not call `findForbiddenRawIdKey()`; `findForbiddenRawIdKey()` lacks a `WeakSet` cycle guard | **NO** |
| **`F-P41-04`** | LOW / INFO | `src/domains/safety/utils/childSafetyResidentHelpers.ts#L596-L791`, `#L940-L1030` | `secondaryGuardians`/`emergencyContacts` (child create/update) and `pickupPersonName`/`pickupPersonPhone` (solo pass) are not yet mapped by resident helpers | **NO** |
| **`F-P41-05`** | LOW | `tests/issue06_b23_phase4_resident_helpers.test.ts#L156-L707` | Minor missing unit-test edge cases (solo-allowed pass happy path, `maxUses` bounds, update ownership stripping, `activePickupCount` filtering, pickup action flags, acknowledged/resolved alert happy path) | **NO** |

---

## Detailed Findings

### `F-P41-01` — LOW-MEDIUM — Missing `persistedStatus` Field on Pass/Pickup Display Models & `maxUses <= 0` Guard
- **Exact Location:** `src/domains/safety/utils/childSafetyResidentHelpers.ts#L224-L264`, `#L418-L427`, `#L1341-L1417`.
- **Reproducibility:** Call `formatGatePassDisplay({ ...activePass, validUntil: pastIso }, now)` → returns `{ effectiveStatus: 'EXPIRED' }` with no `persistedStatus: 'ACTIVE'` property. Call `getEffectiveGatePassStatus({ ...activePass, maxUses: 0, currentUses: 0 }, now)` → skips `maxUses > 0` check and returns `'ACTIVE'`.
- **Impact:** Input DTOs are never mutated, and backend enforces `maxUses >= 1`. However, UI code consuming only `GatePassDisplayModel` cannot distinguish a locally projected expiry from a backend-persisted `'EXPIRED'` status if audit/debug tooltips need both.
- **Recommended Remediation:** Add optional/readonly `persistedStatus` to `GatePassDisplayModel` and `AuthorizedPickupDisplayModel`, and fail closed to `'UNKNOWN'` when `maxUses <= 0 || currentUses < 0` on an `ACTIVE` pass.

### `F-P41-02` — LOW-MEDIUM — `parseTimestampMs()` Accepts Non-Strict Calendar Rollover Dates
- **Exact Location:** `src/domains/safety/utils/childSafetyResidentHelpers.ts#L328-L339`.
- **Reproducibility:** `parseTimestampMs('2026-02-30')` returns epoch ms for `2026-03-02T00:00:00.000Z` instead of `null`; `parseTimestampMs('12345')` returns a finite timestamp instead of `null`.
- **Impact:** Matches backend `new Date(val)` behavior (`server/src/childSafety/validation.ts#L46-L53`), so no client/server divergence occurs on valid ISO strings; however, stricter ISO-8601 + calendar-rollover validation prevents malformed user-typed dates from silently shifting.
- **Recommended Remediation:** Validate ISO-8601 structure (or `YYYY-MM-DD`) and verify parsed year/month/day match input components before accepting.

### `F-P41-03` — LOW — `findForbiddenRawIdKey()` Coverage & Cycle Guard
- **Exact Location:** `src/domains/safety/utils/childSafetyResidentHelpers.ts#L341-L365`, `#L940-L1079`.
- **Reproducibility:** Passing `{ ...validSosInput, idProofNumber: '1234-5678-9012' } as any` to `buildResidentTriggerSosPayload()` strips `idProofNumber` and returns `{ ok: true }` instead of `{ ok: false }`. Passing a self-referential object to `findForbiddenRawIdKey()` can cause stack overflow.
- **Impact:** Zero secret leakage because allowlisted payload builders never forward unknown properties and Phase 1 `apiClient` also validates.
- **Recommended Remediation:** Call `findForbiddenRawIdKey(input)` in gate-pass and SOS builders for consistency, and track visited objects in a `WeakSet<object>`.

### `F-P41-04` — LOW / INFO — Optional Schema Fields Deferred Beyond Minimal Resident Form
- **Exact Location:** `src/domains/safety/utils/childSafetyResidentHelpers.ts#L117-L143`, `#L168-L174`.
- **Impact:** None for core Phase 4.2–4.5 resident workflows; if Phase 4.2 adds secondary guardians or emergency contacts to the resident form, add a contact-list validator mirroring `server/src/childSafety/validation.ts#L78-L142`.

### `F-P41-05` — LOW — Minor Missing Unit-Test Edge Cases
- **Exact Location:** `tests/issue06_b23_phase4_resident_helpers.test.ts`.
- **Missing Edge Cases Identified:**
  1. `buildResidentCreateGatePassPayload`: `SOLO_ALLOWED` child without `pickupPersonId` succeeding; `maxUses: 0`, `11`, `1.5` rejected; exact `validUntil === validFrom` / `validUntil === now` rejected.
  2. `buildResidentUpdateChildPayload`: untyped `residentId`/`flatId`/`societyId`/`status` stripped on update.
  3. `buildUpdateAuthorizedPickupPayload`: clearing `validUntil: null`, rejecting past `validUntil`, ignoring/stripping `idDocumentLast4`.
  4. `formatChildProfileDisplay`: happy-path `activePickupCount` excluding expired/revoked pickups and `DOB` fallback when `reportedAge` is `null`.
  5. `formatAuthorizedPickupDisplay`: `canEdit`/`canRevoke`/`canArchive` flags across `ACTIVE`, `EXPIRED`, `REVOKED`, `ARCHIVED`.
  6. `formatSafetyAlertDisplay`: `ACKNOWLEDGED` (`isOpen: true`) and `RESOLVED` (`isOpen: false`) happy paths with responder attribution.
- **Recommended Remediation:** Add these targeted cases when expanding the Phase 4 test suite in Phase 4.2+.

