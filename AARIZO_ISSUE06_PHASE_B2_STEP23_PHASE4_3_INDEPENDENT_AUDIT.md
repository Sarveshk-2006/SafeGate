# AARIZO ISSUE-06 — Phase B.2.3 — Phase 4.3 Independent Security & Implementation Audit

**Date:** 2026-11-18  
**Repository:** `D:\AAZIRA\AARIZO`  
**Audit Mode:** Strictly Read-Only Independent Audit (zero edits to application source, tests, configuration, schemas, or migrations; Phase 4.4 NOT started)  
**Scope Audited:** Phase 4.3 — Resident Authorized Pickup Management (`ResidentAuthorizedPickupsSection.tsx`, `ResidentChildSafetyPanel.tsx` integration, Phase 4.3 tests, Phase 4.2 regression expansion, and backing routes in `server/src/childSafety/router.ts`)  
**Final Decision:** **`CONDITIONAL PASS — SPECIFIC FIXES REQUIRED BEFORE PHASE 4.4`**

---

## 1. Executive Summary

Phase 4.3 establishes a clean, modular, backend-authoritative Resident Authorized Pickup UI (`src/domains/safety/components/ResidentAuthorizedPickupsSection.tsx`) and integrates it into `ResidentChildSafetyPanel.tsx` without breaking Phase 4.2, Admin/Security tabs, General Emergency SOS, or Phase 1–3 foundations. All 5 backend pickup routes enforce JWT authentication (`server/src/index.ts#L139`), explicit role allowlists, society isolation, resident ownership via PostgreSQL (`authorizeChildAccess`), joint `(societyId, childId, pickupId)` scoping, and sanitized DTO output (`sanitizePickupDto` omits `idDocumentHash`).

However, independent line-by-line forensic inspection uncovered **two blocking Medium defects** that directly affect Phase 4.4 (Gate Pass issuance, which relies on pickup expiry integrity and date parsing) and must be fixed before advancing:

1. **`F-P43-01` (MEDIUM — Blocking):** Expired pickup expiry-removal bypass (`Remove Expiry Limit` → `PATCH { validUntil: null }` without `status`). On a time-expired `ACTIVE` pickup (`status: 'ACTIVE'`, `validUntil <= now`), both the UI (`ResidentAuthorizedPickupsSection.tsx#L632-L640, #L1783-L1799`) and backend (`server/src/childSafety/router.ts#L2380-L2430`) allow clearing `validUntil` to `null` without supplying a future expiry, silently reactivating an expired pickup into an indefinitely `ACTIVE` pickup (bypassing `F-B22-06C` / `EXPIRED_PICKUP_REQUIRES_FUTURE_VALID_UNTIL`). On a persisted `EXPIRED` pickup, clearing `validUntil` produces a contradictory `status: 'EXPIRED'` record with `validUntil: null`.
2. **`F-P43-02` (MEDIUM — Blocking):** Silent calendar-date overflow in timestamp parsing (`src/domains/safety/utils/childSafetyResidentHelpers.ts#L328-L339` `parseTimestampMs` and `server/src/childSafety/validation.ts#L46-L53` `parseIsoDate`). Reproducibly verified via Node: `Date.parse('2027-02-30T12:00:00Z')` silently overflows to `2027-03-02T12:00:00.000Z` and `Date.parse('2027-04-31T12:00')` overflows to `2027-05-01T06:30:00.000Z` instead of failing closed.

Three additional **Low (non-blocking)** findings (`F-P43-03` callback error wrapping, `F-P43-04` permissive phone validation, `F-P43-05` test coverage gaps) and one **Informational / Open Deferred** item (`F-P42-04`) are also documented in `AARIZO_ISSUE06_PHASE_B2_STEP23_PHASE4_3_SECURITY_FINDINGS.md`.

---

## 2. Backend Contract & Lifecycle Route Verification (Route-by-Route)

**Route Path Note:** The audit prompt referred informally to `/api/children/:childId/authorized-pickups`. The actual canonical mount in `server/src/index.ts#L2863` (`app.use('/api/children', childSafetyRouter)`) and `server/src/childSafety/router.ts#L2182-L2577` uses `/api/children/:childId/pickups...`, which matches `src/services/apiClient.ts#L1036-L1094` 100%. All `/api/*` routes pass through `authenticateToken` at `server/src/index.ts#L139`, and generic `/api/collections/:collection` bypasses are explicitly blocked at `server/src/index.ts#L4081-L4178` (`CHILD_SAFETY_COLLECTION_FORBIDDEN`).

| Route (Actual Verified Path) | Exact Implementation | Auth & Roles | Tenant & Joint ID Scoping | Contract & Lifecycle Verdict |
| --- | --- | --- | --- | --- |
| **`GET /api/children/:childId/pickups`** | `server/src/childSafety/router.ts#L2182-L2203` | `authenticateToken` + `resolveChildSafetyActor` + `PROFILE_READ_ROLES` (`resident`, `secretary`, `committee`, `admin`) | `authorizeChildAccess(actor, childId, res)` (`authz.ts#L167-L207`) enforces `societyId` (cross-society → `404`) and resident ownership (non-owner → `403`); query scopes `where: { societyId: child.societyId, childId: child.id }` | **PASS** — Returns `sanitizePickupDto` array (`idDocumentHash` omitted). |
| **`POST /api/children/:childId/pickups`** | `server/src/childSafety/router.ts#L2209-L2307` | `authenticateToken` + `resolveChildSafetyActor` + `PROFILE_WRITE_ROLES` (`resident`, `secretary`, `admin`) | `authorizeChildAccess` enforces tenant + resident ownership; rejects `ARCHIVED` child (`409 CHILD_ARCHIVED`); rejects raw ID fields (`400 RAW_ID_DOCUMENT_FORBIDDEN`); derives `societyId`, `childId`, `createdById` strictly server-side | **PASS (with `F-P43-02`, `F-P43-04`)** — `idDocumentLast4` bounded `1–4` chars; `validUntil` must be future (subject to `F-P43-02` calendar overflow). |
| **`PATCH /api/children/:childId/pickups/:pickupId`** | `server/src/childSafety/router.ts#L2312-L2487` | `authenticateToken` + `resolveChildSafetyActor` + `PROFILE_WRITE_ROLES` | Rejects raw ID fields (`#L2320`) and immutable fields (`societyId`, `childId`, `archivedAt`, `createdById`, `#L2328`); `authorizeChildAccess` + `findFirst({ id: pickupId, societyId: child.societyId, childId: child.id })` (`#L2341-L2347`) prevents cross-child/cross-tenant access; rejects `ARCHIVED` (`409`) and `REVOKED` (`422`) | **FAILS ON `F-P43-01` (MEDIUM)** — Processes ONLY `name`, `phone`, `relationship`, `validUntil`, `status` (never mutates `idDocumentType`, `idDocumentLast4`, `photoUrl`, `notes`) and cascades active gate passes on `REVOKED`/`EXPIRED`, **BUT** `#L2381-L2430` permits `validUntil: null` with omitted `status` on time-expired `ACTIVE` pickups, bypassing `EXPIRED_PICKUP_REQUIRES_FUTURE_VALID_UNTIL`. |
| **`POST /api/children/:childId/pickups/:pickupId/revoke`** | `server/src/childSafety/router.ts#L2489-L2574` (`archiveMode = false`) | `authenticateToken` + `resolveChildSafetyActor` + `PROFILE_WRITE_ROLES` | `authorizeChildAccess` + joint `{ id, societyId, childId }` lookup (`#L2498-L2504`); rejects `ALREADY_ARCHIVED` (`409`) and `ALREADY_REVOKED` (`409`); transaction revokes all `ACTIVE` gate passes (`revocationReason: 'PICKUP_AUTHORIZATION_REVOKED'`) and sets `status: 'REVOKED'` | **PASS** — Distinct lifecycle transition; emits `CHILD_PICKUP_REVOKED`; returns `sanitizePickupDto`. |
| **`DELETE /api/children/:childId/pickups/:pickupId`** | `server/src/childSafety/router.ts#L2489-L2577` (`archiveMode = true`) | `authenticateToken` + `resolveChildSafetyActor` + `PROFILE_WRITE_ROLES` | `authorizeChildAccess` + joint `{ id, societyId, childId }` lookup; rejects `ALREADY_ARCHIVED` (`409`); **soft-archives** via `prisma.$transaction`: revokes all `ACTIVE` gate passes (`revocationReason: 'PICKUP_AUTHORIZATION_ARCHIVED'`) and sets `{ status: 'ARCHIVED', archivedAt: now }` | **PASS** — Verified soft-archive (not hard delete); preserves PostgreSQL audit row; UI label ("Archive") and confirmation copy match backend semantics accurately. |

---

## 3. Frontend Concurrency, State & Privacy Verification

Inspected the complete `src/domains/safety/components/ResidentAuthorizedPickupsSection.tsx` (`2,014` lines) and `src/domains/safety/components/ResidentChildSafetyPanel.tsx`:

- **Loading / Empty / Error / Retry:** Verified real backend fetch on mount and child change (`#L285-L374`), explicit loading (`#L1127-L1145`), retryable load error (`#L1148-L1190`), and empty states (`#L1193-L1239`). Zero hardcoded/demo pickup records and zero `localStorage`/`sessionStorage` usage (only comment at `#L9`).
- **Concurrency, Child Switch, Session Switch & React Strict Mode:**
  - Monotonic `listRequestSeqRef` + `(activeSessionKeyRef, activeChildIdRef)` + `mountedRef` (`#L249-L338`) correctly discard late responses across rapid child switching, session switching, logout, and React 18 Strict Mode mount/cleanup/remount.
  - Monotonic `mutationSeqRef` + `mutationInFlightRef` (`#L253-L254`, `#L343-L344`, `#L553-L604`, `#L648-L699`, `#L714-L767`, `#L782-L835`) properly prevent an older session's or older child's settling mutation from releasing a newer mutation's duplicate-submit lock (`F-P42-01` verified resolved in both `ResidentChildSafetyPanel.tsx` and `ResidentAuthorizedPickupsSection.tsx`).
- **Post-Mutation Refresh Handling:**
  - `loadPickups()` catches its own errors (`#L314-L328`), so a failed `GET` refresh after a succeeded mutation displays `loadError` with Retry while keeping `successMessage` intact (not misrepresented as a failed mutation).
  - *Low finding (`F-P43-03`):* `await onPickupsMutatedRef.current?.(reqChildId)` (`#L574, #L669, #L737, #L805`) runs inside the outer mutation `try` block; while `ResidentChildSafetyPanel` passes a non-throwing `ctrl.loadChildren({ silent: true })`, isolating `onPickupsMutated` in its own `try/catch` prevents any custom caller callback failure from misreporting a committed mutation as failed.
- **Privacy & PATCH Field Scope:**
  - Zero raw government ID inputs or transmissions (`PickupRawIdFieldRefs=0`); `idDocumentLast4` is max 4 alphanumeric characters (`#L1580-L1598`, validated via `validateIdDocumentLast4`).
  - Edit modal (`#L1668-L1855`) renders preserved masked ID and notes strictly read-only (`#L1702-L1726`) and submits ONLY `name`, `phone`, `relationship`, and conditional `validUntil`/`status` via `buildUpdateAuthorizedPickupPayload()`.
  - *Blocking defect (`F-P43-01`):* Edit modal renders **"Remove Expiry Limit"** (`#L1783-L1799`) even for `EXPIRED` pickups, allowing `clearValidUntil: true` (`validUntil: null`) to bypass expired-renewal rules.

---

## 4. Verification Results & Boundaries

Inspected `jest.config.cjs` (`ts-jest` with `diagnostics: false`), `tsconfig.test.json`, `package.json`, and verified the current unchanged command outputs from this workspace (zero application/test edits occurred after execution):

| Check | Exact Result |
| --- | --- |
| **Focused Phase 1–4.3 Suites (`10` suites)** | **PASS** — `10/10` suites, **`140/140`** tests passed, `0` failed, `0` skipped (`25.773 s`, exit `0`) |
| **Full Offline Jest Suite (`npm test -- --silent --maxWorkers=2`)** | **PASS** — **`31/31`** executed suites (**`503/503`** executed tests, `0` failed); **`2`** live PostgreSQL suites (**`11`** tests) skipped (`33` total suites / `514` total tests; `36.485 s`, exit `0`) |
| **TypeScript (`npx tsc --noEmit`)** | **PASS** — `0` errors (exit `0`) |
| **Production Build (`npm run build`)** | **PASS** — `2182` modules transformed in `1.35 s` (exit `0`) |
| **Static Security & Scope Scans** | **PASS** — `0` runtime storage writes, `0` demo identities, `0` raw ID field refs, `0` Phase 4.4–4.6 out-of-scope calls, `0` `EventSource`, `0` `BroadcastChannel` |

### Code-Level Pass vs. Production Readiness Boundary (Explicitly Disclosed)
- **Offline / Static / Unit-Behavioral Verified:** Backend route/authz inspection, frontend concurrency/state review, offline Jest suites (`503/503` executed), TypeScript, and Vite production bundle.
- **NOT Verified (Required Before Production Deployment):** Live PostgreSQL integration (`11` skipped tests requiring `AARIZO_ISOLATED_TEST_DATABASE_URL`), live Firebase Authentication, live browser DOM/E2E testing, and staging/production runtime deployment.

---

## 5. Final Decision & Smallest Safe Remediation Scope

**Decision:** **`CONDITIONAL PASS — SPECIFIC FIXES REQUIRED BEFORE PHASE 4.4`**

Before beginning Phase 4.4, apply a small, targeted Phase 4.3 remediation patch covering:
1. **`F-P43-01` (Required):** Hide/block `Remove Expiry Limit` (`clearValidUntil`) for `EXPIRED` pickups in `ResidentAuthorizedPickupsSection.tsx` (`#L632-L640`, `#L1783-L1799`) AND reject `validUntil: null` on already-expired pickups (`pickup.status === 'EXPIRED' || wasExpiredByTime`) in `server/src/childSafety/router.ts#L2380-L2430` with `422 EXPIRED_PICKUP_REQUIRES_FUTURE_VALID_UNTIL`.
2. **`F-P43-02` (Required):** Reject impossible calendar dates (e.g., `2027-02-30`, `2027-04-31`) in `parseTimestampMs()` (`src/domains/safety/utils/childSafetyResidentHelpers.ts#L328-L339`) and `parseIsoDate()` (`server/src/childSafety/validation.ts#L46-L53`).
3. **Recommended Low Hardening Alongside Remediation (`F-P43-03`, `F-P43-04`, `F-P43-05`):** Wrap `onPickupsMutated` in its own `try/catch`, tighten pickup phone validation, and add regression tests for `F-P43-01`–`F-P43-05` (expired clear-expiry rejection, invalid calendar date rejection, post-mutation refresh failure, mid-flight child switch during mutation, and archive cancel/`409`).

