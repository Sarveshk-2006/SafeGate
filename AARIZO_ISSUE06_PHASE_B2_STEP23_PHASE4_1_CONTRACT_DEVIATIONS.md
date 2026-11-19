# AARIZO ISSUE-06 — Phase B.2.3 — Phase 4.1 Contract Deviations & Discrepancies

**Date:** 2026-11-18  
**Repository:** `D:\AAZIRA\AARIZO`  
**Verified Against:** `src/types/childSafety.ts`, `src/services/apiClient.ts`, `src/services/childSafetyService.ts`, `server/src/childSafety/router.ts`, `server/src/childSafety/validation.ts`

Direct code inspection during Phase 4.1 uncovered **three real contract discrepancies** between earlier planning assumptions / TypeScript request interfaces and the actual backend router implementation. No backend routes or schemas were modified; Phase 4.1 helpers were aligned strictly to the real backend runtime behavior.

---

## 1. `PATCH /api/children/:childId/pickups/:pickupId` Ignores 4 Fields Present in `UpdateAuthorizedPickupRequest`

- **TypeScript Interface (`src/types/childSafety.ts#L429-L439`):** Declares optional `idDocumentType`, `idDocumentLast4`, `photoUrl`, and `notes` on `UpdateAuthorizedPickupRequest`.
- **Actual Backend Runtime (`server/src/childSafety/router.ts#L2361-L2434`):** Processes **only** `name`, `phone`, `relationship`, `validUntil`, and `status` (`ACTIVE`/`REVOKED`/`EXPIRED`). Sending only `idDocumentType`, `idDocumentLast4`, `photoUrl`, or `notes` causes backend HTTP `400 EMPTY_UPDATE`, and sending them alongside other fields silently drops them!
- **Phase 4.1 Alignment:** `ResidentUpdatePickupFormInput` and `buildUpdateAuthorizedPickupPayload()` in `src/domains/safety/utils/childSafetyResidentHelpers.ts` intentionally expose and validate **only** the 5 backend-supported fields (`name`, `phone`, `relationship`, `validUntil`, `status`), preventing silent data loss and `400 EMPTY_UPDATE` errors in Phase 4.3 UI.
- **Unresolved Concern for Phase 4.3:** In Phase 4.3 Edit Escort UI, `idDocumentType`, `idDocumentLast4`, `photoUrl`, and `notes` should be displayed read-only (editable only on Create, or via revoking & re-creating) unless a future backend task extends `PATCH /:childId/pickups/:pickupId`.

---

## 2. `CreateChildGatePassOptions` Does Not Include `idempotencyKey` (and Backend Does Not Deduplicate by `Idempotency-Key`)

- **Phase 4 Audit Plan Reference:** Mentioned calling `createGatePass(data, { idempotencyKey })`.
- **Actual Code Contract (`src/types/childSafety.ts#L464-L470`, `src/services/apiClient.ts#L1121-L1163`, `server/src/childSafety/router.ts#L209-L405`):**
  - `CreateChildGatePassOptions` accepts **only** `{ childExitPermissionMode?: ChildExitPermissionModeDto }`.
  - Backend `POST /api/children/passes` enforces `childPassCreateRateLimiter()` and `passCode` collision retries, but does not implement server-side `Idempotency-Key` deduplication.
- **Phase 4.1 Alignment:** `buildResidentCreateGatePassPayload()` returns `{ request: CreateChildGatePassRequest; options: CreateChildGatePassOptions }` matching the exact Phase 1/3 TypeScript signature (`childSafetyService.createGatePass(request, options)`).
- **Mitigation for Phase 4.4:** Phase 4.4 UI MUST enforce a strict synchronous `inFlightRef` lock + disabled submit button during `POST /api/children/passes` to prevent duplicate pass creation on double-click.

---

## 3. `idDocumentLast4` Character Strictness (Client Helper vs Backend Length Check)

- **Actual Backend Validation (`server/src/childSafety/router.ts#L2246`, `src/services/apiClient.ts#L436-L458`):** Backend checks `normalizeOptionalString(body.idDocumentLast4, 4)` (any trimmed string 1–4 characters); `apiClient` checks `trimmed.length <= 4`.
- **Phase 4.1 Helper (`validateIdDocumentLast4`):** Enforces `/^[A-Za-z0-9]{1,4}$/` (strictly 1–4 alphanumeric characters, uppercase-normalized, rejecting spaces/dashes/mask fragments like `'12-3'` or `'XX-1'`) so resident forms never accidentally accept partial formatted masks or stray punctuation. This is a strict subset of backend-accepted values (zero risk of sending backend-invalid payloads).

---

## 4. Known Non-Blocking Backend Presentation Behaviors Handled by Phase 4.1 Helpers

- **`GET /api/children/passes` & `GET /api/children/:childId/pickups` expiry projection:** Persisted rows remain `status: 'ACTIVE'` even after `validUntil <= now` until verified or mutated. `getEffectiveGatePassStatus()` and `getEffectivePickupStatus()` project `EXPIRED` at the exact boundary (`validUntil <= now`) and fail closed (`UNKNOWN`) on malformed/missing timestamps without treating local presentation state as backend-confirmed mutation state.
- **`POST /api/children` role-based ownership split:** Residents auto-derive `residentId`/`flatId`/`flatNumber` from PostgreSQL (`buildResidentCreateChildPayload` omits all ownership/tenant fields), whereas `secretary`/`admin` require explicit `residentId` + `flatId` (`getResidentChildSafetyPermissions` sets `canRegisterOwnChild: false` and `requiresAdminDeskForChildCreation: true` for `secretary`/`admin`).

