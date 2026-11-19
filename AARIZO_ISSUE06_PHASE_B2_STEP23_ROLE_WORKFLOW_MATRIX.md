# AARIZO — ISSUE-06 Phase B.2.3: Role & Cross-Portal Workflow Matrix

This document defines the end-to-end, cross-role Child Safety workflows across AARIZO's portals and verifies strict alignment between frontend route guards (`src/routes/index.tsx`), UI controls, and Phase B.2.2 backend RBAC (`server/src/childSafety/router.ts`).

---

## 1. Role Permission & Route Alignment Matrix

| Capability | `resident` (own flat/children only) | `guard` (assigned society) | `committee` (assigned society) | `secretary` (assigned society) | `admin` (platform/society) | `vendor` / `facility_manager` |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **List / View Child Profiles** (`GET /api/children`, `/:id`) | Own only | **DENIED (403)** | Read society | Read society | Read | **DENIED (403)** |
| **Create / Edit / Archive Child Profile** (`POST/PATCH/archive`) | Own only | **DENIED (403)** | **DENIED (403)** | Society (with `residentId`+`flatId`) | Allowed | **DENIED (403)** |
| **List Authorized Pickups** (`GET /:childId/pickups`) | Own only | **DENIED (403)** | Read society | Read society | Read | **DENIED (403)** |
| **Add / Edit / Revoke Pickup** (`POST/PATCH/revoke`) | Own only | **DENIED (403)** | **DENIED (403)** | Society | Allowed | **DENIED (403)** |
| **List Gate Passes** (`GET /api/children/passes`) | Own (all statuses) | **ACTIVE unexpired only** | Society (all statuses) | Society (all statuses) | All | **DENIED (403)** |
| **Generate / Revoke Gate Pass** (`POST /passes`, `/revoke`) | Own only | **DENIED (403)** | **DENIED (403)** | Society | Allowed | **DENIED (403)** |
| **Verify Gate Pass at Gate** (`POST /passes/verify`) | **DENIED (403)** | **ALLOWED** | **DENIED (403)** | **DENIED (403)** | **ALLOWED** | **DENIED (403)** |
| **View Gate Exit Logs** (`GET /api/children/exit-logs`) | Own only | Society | Society | Society | All | **DENIED (403)** |
| **Trigger Child Safety SOS** (`POST /api/children/sos`) | Own `childId` req. | Society | Society | Society | Allowed | **DENIED (403)** |
| **View Child Safety Alerts** (`GET /api/children/alerts`) | Own / reported | Society | Society | Society | All | **DENIED (403)** |
| **Acknowledge / Resolve Alert** (`POST /alerts/:id/...`) | **DENIED (403)** | **ALLOWED** | **ALLOWED** | **ALLOWED** | **ALLOWED** | **DENIED (403)** |

### Identified Route-vs-API RBAC Mismatches to Fix in B.2.3

1. **`/security/child-safety` (`src/routes/index.tsx#L232`):** Currently grants access to `['guard', 'secretary', 'admin']`. Because backend `POST /api/children/passes/verify` permits **only `guard` and `admin`**, a `secretary` opening `/security/child-safety` must see the Gate Pass Verification form disabled/hidden with a clear read-only monitoring banner ("Gate exit clearance is restricted to on-duty Security Guards and Admins"), while still being allowed to view active passes, exit logs, and manage alerts.
2. **`/admin/child-safety` (`src/routes/index.tsx#L195`):** Currently allows `['secretary', 'admin']`. If `committee` members are granted dashboard access in future or via `ResidentChildSafetyPage`, UI write buttons (Create Child, Add Pickup, Generate Pass, Revoke Pass) must be **hidden for `committee`** because backend enforces `PROFILE_WRITE_ROLES = ['resident', 'secretary', 'admin']` and `PASS_WRITE_ROLES = ['resident', 'secretary', 'admin']` (committee is read-only for profiles/pickups/passes, and read+manage for alerts).
3. **`SafetyCommandHub` `GATE_VERIFIER` tab:** Currently rendered inside `ResidentChildSafetyPage`, `ResidentEmergencyPage`, and `AdminSafetyCommandPage` for ALL roles (including `resident`!). Must be **hidden for roles other than `guard` and `admin`**, preventing residents from seeing a broken gate-verifier tab that always returns `403`.
4. **Platform `admin` without concrete `societyId`:** Backend write endpoints (`POST /api/children`, `POST /api/children/passes`, `POST /api/children/sos`) require a concrete target `societyId` (`requireConcreteSociety: true`). When an `admin` has `societyId === '*'` or empty, UI must require selecting an active society context before submitting writes.

---

## 2. End-to-End Cross-Portal Workflows

### Workflow 1: Child Profile & Authorized Pickup Setup (Resident -> Admin Visibility)
1. **Resident** opens `/resident/child-safety` (`ResidentChildSafetyPage` -> `SafetyCommandHub` `CHILD_SAFETY` tab).
2. Frontend loads `GET /api/children`, `GET /api/children/passes`, `GET /api/children/exit-logs`, and `GET /api/children/alerts` in parallel.
3. Resident registers child via `POST /api/children` -> PostgreSQL commits -> Backend emits `CHILD_PROFILE_CREATED` (audience: owner + `secretary`, `committee`, `admin`).
4. **Admin/Secretary** on `/admin/child-safety` receives `CHILD_PROFILE_CREATED` over authenticated SSE -> refreshes `GET /api/children` automatically; child appears in Society Child Registry.
5. Resident adds escort (e.g., grandparent/nanny) via `POST /api/children/:childId/pickups` using `name`, `phone`, `relationship`, `idDocumentType`, optional `idDocumentLast4` (never raw ID number) -> Backend emits `CHILD_PICKUP_AUTHORIZED` -> both Resident & Admin views update.
6. If Resident revokes an escort via `POST /api/children/:childId/pickups/:pickupId/revoke` -> status becomes `REVOKED` (permanently non-reactivatable per B.2.2) -> any existing active gate pass linked to that pickup will be denied at the gate (`422 PICKUP_REVOKED`).

### Workflow 2: One-Time Cryptographic Gate Pass Generation & Gate Exit Verification (Resident -> Guard -> Resident/Admin)
1. **Resident** selects child and authorized pickup (or enters ad-hoc escort), sets validity window (e.g., 2h/4h, <= 7 days) and `maxUses` (default `1`), and clicks **Generate Gate Pass**.
2. Frontend calls `POST /api/children/passes` -> Backend returns `201` with `{ ...pass, bearerToken, qrPayload: "AARIZO_CHILD_PASS:<64-hex>" }`.
3. Frontend immediately displays the **One-Time Gate Pass Modal** containing:
   - Scannable QR code (`QRCodeSVG` encoding `qrPayload`)
   - Human-readable `passCode` (`CGP-XXXX-XXXX`), child name, escort name, valid-until timestamp
   - **Share / Copy Token** and **Download QR PNG** actions
   - Prominent warning: *"Save or share this QR pass now. For your child's security, this secret QR code cannot be viewed again after closing this window."*
   - Zero persistence of `bearerToken`/`qrPayload` in `localStorage`/`sessionStorage`.
4. Backend emits `CHILD_GATE_PASS_GENERATED` -> **Guard** on `/security/child-safety` automatically sees the expected pass (`passCode`, child, flat, escort, expiry) appear in the **Active Expected Passes** panel.
5. Caretaker arrives at the gate and presents the QR code / token to the **Guard**.
6. Guard scans/pastes `qrPayload` (or `bearerToken`) into the scanner input and clicks **Verify & Authorize Exit** -> calls `POST /api/children/passes/verify` with `{ qrPayload, gateId, notes }`.
7. **On `200 GRANTED`:**
   - Guard sees bold green **GATE CLEARED — AUTHORIZED EXIT** verdict card with child name, flat, escort, and log timestamp.
   - Backend emits `CHILD_GATE_PASS_VERIFIED` + `CHILD_EXIT_TRIGGERED`.
   - **Resident** receives live SSE notification + toast and sees child status update to `OUT_OF_SOCIETY` and new exit log appear.
   - **Admin** on `/admin/child-safety` sees child status update to `OUT_OF_SOCIETY` and audit log update in real time.
8. **On Denied / Replay / Fail-Closed Error:**
   - `409 PASS_ALREADY_CONSUMED`: Red **DENIED — PASS ALREADY USED** card.
   - `409 CHILD_MISSING_ALERT_BLOCKED`: Flashing critical crimson **GATE LOCKDOWN — MISSING CHILD ALERT ACTIVE! DO NOT RELEASE CHILD!** card + siren.
   - `422 PASS_EXPIRED` / `PASS_REVOKED` / `PICKUP_REVOKED`: Red **DENIED** card with exact reason.
   - `503 VERIFICATION_UNAVAILABLE` or network offline: Amber/Red **VERIFICATION SERVICE UNAVAILABLE (FAIL-CLOSED) — DO NOT RELEASE CHILD. RETRY OR ESCALATE TO SOCIETY OFFICE.** card (strictly no offline approval button!).
   - Backend emits `CHILD_EXIT_DENIED` on logged denials -> Resident & Admin receive real-time denial alert.

### Workflow 3: Missing Child / Safety SOS Lifecycle & Gate Lockdown (Any Authorized Role -> Guard/Admin -> Resolution)
1. **Resident** (on `/resident/child-safety`), **Guard** (on `/security/child-safety`), or **Admin/Secretary** (on `/admin/child-safety`) triggers SOS via `POST /api/children/sos` with `childId`, `location`, `alertType` (`MISSING_CHILD` default), `severity` (`CRITICAL`), `lastSeenDetails`, `description`.
2. Backend atomically:
   - Acquires `FOR UPDATE` lock on `child_profiles`, sets child status to `MISSING` (for `MISSING_CHILD`), creates `ChildSafetyAlert` + linked `EmergencyIncident`.
   - Emits `CHILD_SAFETY_SOS_TRIGGERED` and `EMERGENCY_INCIDENT_CREATED` (audience: `guard`, `secretary`, `committee`, `admin` + owning resident).
3. **All Security & Admin terminals** (`/security/child-safety`, `/admin/child-safety`, `/security/emergency`) immediately receive SSE event -> siren audio + critical red alert banner + automatic list refresh.
4. **Automatic Gate Lockdown:** While the `MISSING_CHILD` alert is `ACTIVE` or `ACKNOWLEDGED`, any attempt to verify a gate pass for that child via `POST /api/children/passes/verify` is atomically blocked with `409 CHILD_MISSING_ALERT_BLOCKED`.
5. **Guard / Secretary / Committee / Admin** clicks **Acknowledge Alert** -> `POST /api/children/alerts/:id/acknowledge` -> status transitions `ACTIVE -> ACKNOWLEDGED` -> SSE emits `CHILD_SAFETY_ALERT_ACKNOWLEDGED` -> Resident sees reassurance that security has acknowledged the alarm (with `acknowledgedByName` & timestamp).
6. Once the child is safely located, **Guard / Secretary / Committee / Admin** clicks **Resolve Alert** -> modal requires non-empty `resolutionNotes` and outcome (`RESOLVED` or `FALSE_ALARM`) -> `POST /api/children/alerts/:id/resolve` -> child status restores to `SAFE` (when no other active `MISSING_CHILD` alert remains) -> SSE emits `CHILD_SAFETY_ALERT_RESOLVED` -> Resident, Guard, and Admin portals update immediately.

### Workflow 4: Child Return Home (`OUT_OF_SOCIETY -> SAFE`)
1. When a child who exited with a verified pass returns home safely, the **Resident** (or **Secretary/Admin**) clicks **Mark Returned Safe** on the child's card.
2. Frontend calls `PATCH /api/children/:id` with `{ status: 'SAFE' }` -> Backend emits `CHILD_PROFILE_UPDATED` -> status badge returns to `SAFE` across Resident and Admin portals.

