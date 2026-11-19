# AARIZO — ISSUE-06 — PHASE B.2 — STEP 2.3 — PHASE 4.6.3.3.5
# SECURITY REGRESSION MATRIX

**Repository:** `D:\AAZIRA\AARIZO`  
**Phase:** Phase B.2 / Step 2.3 / Subphase 4.6.3.3.5  
**Date:** November 19, 2026  
**Auditor Mode:** STRICTLY READ-ONLY FINAL SECURITY & REGRESSION VERIFICATION  
**Security Status:** ALL CRITICAL INVARIANTS ENFORCED & VERIFIED  

---

## 1. Overview & Threat Model

This Security Regression Matrix documents the comprehensive security posture, defense-in-depth controls, role permission boundaries, and regression protections established across the AARIZO Child Safety and Security Command Hub ecosystem.

### Target Threat Surface
1. **Unauthorized Profile Access & Exfiltration:** Malicious actors or unauthorized residents viewing child identities, photos, medical conditions, or escort lists.
2. **Cross-Tenant Breach:** Multi-tenant leakage where residents or staff of Society A access, manipulate, or trigger alerts for Society B.
3. **Escort / Kidnapping Vulnerabilities:** Unauthorized pickup creation, forged gate passes, replay attacks, or bypassing missing child alerts at the perimeter.
4. **Denial of Service & Alarm Spoofing:** Malicious flooding of Child SOS alarms or general emergency incidents to overwhelm security staff.
5. **Privilege Escalation:** Guards or committee members issuing gate passes, altering child rosters, or acknowledging/resolving security alerts without proper authorization.
6. **Bearer Token & PII Leakage:** Plaintext storage of gate pass tokens, Aadhaar/government IDs in browser storage or logs, or leaking bearer secrets over realtime SSE.

---

## 2. Invariant 1: Backend-Derived Identity & Strict Tenant Isolation

### Contract Enforcement
- **Backend Implementation:** `server/src/childSafety/authz.ts:resolveChildSafetyActor()`
- **Mechanism:**
  - Caller identity, role, and tenant ID are derived strictly from cryptographically verified JWT tokens (`req.authContext`).
  - Caller-supplied identity headers (`x-user-id`, `x-user-role`, `x-society-id`) and body properties (`userId`, `role`, `societyId`) are ignored.
  - If a non-platform-admin client submits a `societyId` in body/query/params differing from their authenticated tenant, the request is immediately rejected with HTTP `403 Forbidden` (`code: 'TENANT_ISOLATION_VIOLATION'`).
  - Platform sentinels (`'soc-platform'`, `'platform'`, `'*'`, `'all'`) are rejected for tenant-specific actions (`code: 'TENANT_CONTEXT_REQUIRED'`).
  - Platform admins (`role === 'admin'` with platform sentinel) targeting a concrete society must provide a valid target `societyId` and are validated against live PostgreSQL records.

### Zero-Existence Oracle (Cross-Tenant Lookups)
- In `server/src/childSafety/authz.ts:authorizeChildAccess()` and all route queries:
  - If a request targets a `childId` or `passId` belonging to another society, the query includes `WHERE society_id = actor.societyId`.
  - The record is reported as nonexistent with HTTP `404 Not Found` (`code: 'CHILD_NOT_FOUND'`).
  - Cross-society record existence is never disclosed to unauthorized callers.

---

## 3. Invariant 2: Deny-by-Default Role Authorization Matrix

Every Child Safety and Emergency Incident endpoint enforces explicit role allowlists (`enforceAllowedRoles` or Express route middleware). Roles outside the explicit allowlist are rejected with HTTP `403 Forbidden` (`code: 'INSUFFICIENT_PERMISSIONS'`).

| Capability / Action | HTTP Method & Route | Permitted Roles | Explicitly Forbidden Roles | Enforcing Code Reference |
| :--- | :--- | :--- | :--- | :--- |
| **List Child Roster** | `GET /api/children` | `resident`, `secretary`, `committee`, `admin` | `guard`, `security`, `vendor`, unauthenticated | `server/src/childSafety/router.ts:PROFILE_READ_ROLES` |
| **Create Child Profile** | `POST /api/children` | `resident`, `secretary`, `admin` | `guard`, `committee`, `security`, `vendor` | `server/src/childSafety/router.ts:PROFILE_WRITE_ROLES` |
| **Update Child Profile** | `PATCH /api/children/:id` | `resident`, `secretary`, `admin` | `guard`, `committee`, `security`, `vendor` | `server/src/childSafety/router.ts:PROFILE_WRITE_ROLES` |
| **Archive Child Profile** | `DELETE /api/children/:id` | `resident`, `secretary`, `admin` | `guard`, `committee`, `security`, `vendor` | `server/src/childSafety/router.ts:PROFILE_WRITE_ROLES` |
| **Add Escort Pickup** | `POST /api/children/:id/pickups` | `resident`, `secretary`, `admin` | `guard`, `committee`, `security`, `vendor` | `server/src/childSafety/router.ts:PROFILE_WRITE_ROLES` |
| **Update Escort Pickup** | `PATCH /api/children/:id/pickups/:pId` | `resident`, `secretary`, `admin` | `guard`, `committee`, `security`, `vendor` | `server/src/childSafety/router.ts:PROFILE_WRITE_ROLES` |
| **Revoke Escort Pickup** | `DELETE /api/children/:id/pickups/:pId` | `resident`, `secretary`, `admin` | `guard`, `committee`, `security`, `vendor` | `server/src/childSafety/router.ts:PROFILE_WRITE_ROLES` |
| **List Gate Passes** | `GET /api/children/passes` | `resident`, `guard`, `secretary`, `committee`, `admin` | `security`, `vendor`, unauthenticated | `server/src/childSafety/router.ts:PASS_READ_ROLES` |
| **Generate Gate Pass** | `POST /api/children/passes` | `resident`, `secretary`, `admin` | `guard`, `committee`, `security`, `vendor` | `server/src/childSafety/router.ts:PASS_WRITE_ROLES` |
| **Revoke Gate Pass** | `POST /api/children/passes/:id/revoke`| `resident`, `secretary`, `admin` | `guard`, `committee`, `security`, `vendor` | `server/src/childSafety/router.ts:PASS_WRITE_ROLES` |
| **Verify Gate Pass** | `POST /api/children/passes/verify` | `guard`, `admin` | `resident`, `secretary`, `committee`, `vendor` | `server/src/childSafety/router.ts:GATE_VERIFY_ROLES` |
| **Trigger Child SOS** | `POST /api/children/sos` | `resident`, `guard`, `secretary`, `committee`, `admin` | `security`, `vendor`, unauthenticated | `server/src/childSafety/router.ts:SOS_TRIGGER_ROLES` |
| **List Child Alerts** | `GET /api/children/alerts` | `guard`, `secretary`, `committee`, `admin` | `resident`, `security`, `vendor` | `server/src/childSafety/router.ts:SOS_MANAGE_ROLES` |
| **Acknowledge Alert** | `POST /api/children/alerts/:id/ack` | `guard`, `secretary`, `committee`, `admin` | `resident`, `security`, `vendor` | `server/src/childSafety/router.ts:SOS_MANAGE_ROLES` |
| **Resolve Child Alert**| `POST /api/children/alerts/:id/resolve`| `guard`, `secretary`, `committee`, `admin` | `resident`, `security`, `vendor` | `server/src/childSafety/router.ts:SOS_MANAGE_ROLES` |
| **Resolve General SOS**| `PATCH /api/emergency-incidents/:id/res`| `guard`, `secretary`, `admin` | `committee`, `resident`, `security`, `vendor` | `server/src/index.ts:2332 (requireRole)` |

### Role Boundary & Fallback Analysis
- **`guard` Role Boundary:** Guards have ZERO write access to child rosters or escort lists and cannot generate gate passes. Guards can only verify passes at the perimeter gate (`/security/child-safety`), view active security alerts, acknowledge alerts, and resolve alerts with required audit notes.
- **`committee` Role Boundary:** Committee members have read-only audit visibility over child rosters and passes. They cannot create or edit profiles, cannot add or revoke escorts, cannot generate gate passes, and cannot resolve general emergency incidents.
- **`security` Pseudo-Role Alias:** The legacy `'security'` string alias is strictly rejected by both backend `enforceAllowedRoles` and frontend `classifySafetyHubRole`. All security operations require the canonical `'guard'` or `'admin'` role.
- **`resident` Role Boundary:** Residents have write access exclusively to their own children and escorts. They are forbidden from viewing other residents' profiles, viewing staff alert queues, or resolving security alerts.

---

## 4. Invariant 3: Resident Child Ownership Defense-in-Depth

### Server-Side Ownership Resolution
- In `server/src/childSafety/authz.ts:resolveResidentOwnership()`:
  - Resolves `prisma.resident` matching `actor.societyId` and `status: 'ACTIVE'`.
  - Verifies `resident.flat.societyId === actor.societyId`.
  - Maps verified `residentId`, `flatId`, and `flatNumber`.
- In `server/src/childSafety/authz.ts:authorizeChildAccess()`:
  - If `actor.role === 'resident'`, enforces:
    `child.residentId === ownership.residentId || child.guardianUserId === actor.userId`.
  - Unauthorized residents are rejected with HTTP `403 Forbidden` (`code: 'UNAUTHORIZED_CHILD_ACCESS'`).
- In `server/src/childSafety/router.ts` SOS Trigger (`POST /api/children/sos`):
  - For resident callers, verifies child ownership before acquiring lock or creating alert records.
  - Cross-flat SOS attempts are rejected with HTTP `403 Forbidden` (`code: 'UNAUTHORIZED_SOS_TRIGGER'`).

---

## 5. Invariant 4: Guard Roster Restrictions & Privacy Protection

### Roster Isolation & Notice
- Guards calling `GET /api/children` receive HTTP `403 Forbidden`.
- In `src/domains/safety/components/SafetyCommandHub.tsx`:
  - When a guard navigates to the `CHILD_SAFETY` tab, the UI renders the dedicated Guard Privacy Banner (`data-testid="guard-privacy-notice"`).
  - The banner explicitly states that child rosters and escort PII are restricted from guard view.
  - An explicit CTA link directs the guard to the canonical Child Gate Scanner (`/security/child-safety`).
  - Guards are never presented with empty tables or deceptive mock data.

### Realtime Audience Filtering
- Outbox events for profile lifecycle (`CHILD_PROFILE_CREATED`, `CHILD_PROFILE_UPDATED`, `CHILD_PROFILE_ARCHIVED`, `CHILD_PICKUP_AUTHORIZED`, `CHILD_PICKUP_REVOKED`) target `PROFILE_EVENT_ROLES = ['secretary', 'committee', 'admin']` and the specific child guardian.
- Guards are strictly excluded from these event topics, preventing background telemetry leakage of resident household data.

---

## 6. Invariant 5: Gate Pass Cryptography & Single-Use Semantics

### Token Generation & Storage
- **Bearer Token Entropy:** Generated via `crypto.randomBytes(32).toString('hex')` (256 bits of CSPRNG entropy).
- **Zero Raw Secret Persistence:**
  - The raw bearer token is NEVER written to PostgreSQL.
  - The database stores only `token_hash = sha256(bearerToken)` in `child_gate_passes`.
- **Constant-Time Verification:** Verification compares the SHA-256 hash of the presented token against the database record using `crypto.timingSafeEqual` (`verifyChildPassTokenConstantTime`).

### Single-Use Semantics (`maxUses: 1`)
- **Backend-Enforced Invariant:**
  - `maxUses` is hardcoded to `1` on the backend (`server/src/childSafety/router.ts:POST /api/children/passes`). Any client-supplied `maxUses` values are ignored.
  - Gate pass verification checks `pass.currentUses >= pass.maxUses` and `pass.status !== 'ACTIVE'`.
  - Upon successful verification, an atomic SQL transaction increments `currentUses = currentUses + 1`, sets `status = 'USED'`, and records `lastUsedAt = NOW()`.
  - Replay attempts immediately fail with HTTP `409 Conflict` / `422 Unprocessable Entity` (`code: 'PASS_ALREADY_USED'`).

### Validity Window Constraints
- `validFrom` defaults to current timestamp if not supplied.
- `validUntil` must be strictly greater than `validFrom`.
- Upper bound enforced: `validUntil - validFrom <= 7 days` (`MAX_PASS_DURATION_MS`).
- Reversed, negative, zero-duration, or excessively long validity windows are rejected with HTTP `400 Bad Request`.
- Expired passes presented at the gate are rejected with `outcome: 'DENIED'` and logged to `child_exit_logs`.

### Display-Only Code Isolation
- A 6-character alphanumeric code (e.g. `CP-8921`) is generated for human display and verbal reference only.
- The gate scanner at `POST /api/children/passes/verify` strictly requires the 64-character hexadecimal SHA-256 bearer token. Submitting the 6-character display code results in verification rejection.

### QR Secret Memory Lifecycle
- The raw bearer token and QR payload are delivered to the frontend exactly once upon pass creation.
- Frontend components (`ResidentGatePassesSection.tsx`, `SafetyCommandHub.tsx`) hold the secret strictly in component memory state.
- Zero persistence in `localStorage`, `sessionStorage`, or cookies.
- Secret is wiped immediately upon modal dismissal or component unmount.

---

## 7. Invariant 6: Atomic Verification & Missing Child Freeze

### PostgreSQL Row-Level Locking (`FOR UPDATE`)
- In `server/src/childSafety/router.ts:lockChildProfileRow()`:
  - Both Child SOS creation (`POST /api/children/sos`) and Gate Pass verification (`POST /api/children/passes/verify`) execute inside a Prisma interactive transaction.
  - Executes `SELECT status::text AS status, archived_at FROM child_profiles WHERE id = $1 AND society_id = $2 FOR UPDATE`.
  - Serializes concurrent gate scans and SOS alerts on the same child row, eliminating race conditions.

### Immediate Perimeter Gate Freeze
- During pass verification, if the locked child row has `status === 'MISSING'` or if an active `MISSING_CHILD` alert exists:
  - Gate exit is immediately denied.
  - The transaction inserts an audit record in `child_exit_logs` with `outcome: 'DENIED'` and `reason: 'CHILD_REPORTED_MISSING'`.
  - Pass usage is NOT incremented.
  - Scanner displays a full-screen red warning banner to the guard.

### SOS Duplicate Prevention
- When a Child SOS is triggered, the transaction checks for existing `ACTIVE` or `ACKNOWLEDGED` alerts for that child in that society.
- Duplicate alerts are rejected with HTTP `409 Conflict` (`code: 'DUPLICATE_ACTIVE_SOS_ALERT'`), preventing alarm storms.

---

## 8. Invariant 7: Sensitive Child Data Minimization & PII Hygiene

### Prohibited Raw ID Document Enforcement
- `server/src/childSafety/validation.ts:assertNoForbiddenRawIdFields()`:
  - Inspects incoming JSON bodies for forbidden raw identity keys: `idProofNumber`, `aadhaar`, `aadhaarNumber`, `ssn`, `pan`, `passportNumber`, `driverLicense`.
  - Any matching keys trigger an immediate HTTP `400 Bad Request` (`code: 'FORBIDDEN_RAW_PII'`).
  - Escort records store only `idDocumentType` (e.g. `AADHAAR_LAST4`, `VOTER_ID_LAST4`) and `idDocumentLast4` (exactly 4 digits).

### Realtime Event Sanitization
- Realtime event payloads recorded in the database outbox omit bearer tokens, token hashes, phone numbers, and full identity numbers.
- Subscribers receive only necessary references (`childId`, `passId`, `status`, `actorId`, `societyId`).

### Strict Output DTO Sanitizers
- All backend endpoints pass records through strict sanitizers before returning HTTP responses:
  - `sanitizeChildProfileDto`: strips internal metadata and joins.
  - `sanitizePickupDto`: guarantees only `idDocumentLast4` is exposed.
  - `sanitizeGatePassDto`: guarantees `tokenHash` is NEVER returned to clients.
  - `sanitizeSafetyAlertDto`: returns normalized alert and responder details.

---

## 9. Invariant 8: Realtime Connection & Outbox Integrity

### Single-Connection Invariant
- The application enforces a strict single-connection architecture.
- `src/context/AuthContext.tsx` owns and manages the single authenticated Fetch SSE connection (`realtimeService.connect()`).
- Individual domain components (`SafetyCommandHub.tsx`, `ResidentChildSafetyPanel.tsx`, `ChildGateScannerPage.tsx`) MUST NEVER call `realtimeService.connect()` or instantiate an `EventSource`.

### Zero Client-Side Event Broadcasting
- `realtimeService.publish()` is strictly forbidden in frontend components.
- All realtime events are generated exclusively on the backend following successful database transactions via `realtimeEngine.recordOutboxEvent()`.
- Client components interact with the backend exclusively via authoritative HTTP REST calls.

### Reactive Invalidation Architecture
- Inbound SSE messages do not overwrite client state directly.
- Inbound SSE events trigger debounced, coalesced calls to authoritative HTTP fetchers (`childSafetyService.onCacheInvalidated()`).
- This guarantees the client UI always reflects verified PostgreSQL database truth.

---

## 10. Invariant 9: Session Lifecycle & Memory Hygiene

### Token Authentication
- All API requests transmit the JWT bearer token in the `Authorization: Bearer <token>` HTTP header.
- Transmission of tokens via URL query parameters (`?jwt=...` or `?token=...`) is strictly prohibited.

### Session Teardown & Account Switching
- Upon user logout or tenant switch:
  - `AuthContext.logout()` terminates the active SSE connection.
  - All event listeners are unregistered.
  - In-memory caches, active incident feeds, child rosters, and gate pass tokens are cleared.
  - Cached data from Society A is never accessible to a subsequent session in Society B.

---

## 11. Security Audit Matrix Summary

| Security Domain | Risk Level | Mitigation Strategy | Verification Status |
| :--- | :--- | :--- | :--- |
| **Tenant Isolation** | CRITICAL | Backend-derived JWT claims + composite SQL unique keys | **VERIFIED PASS** |
| **Roster Privacy** | CRITICAL | Explicit deny-by-default role classifier + guard exclusions | **VERIFIED PASS** |
| **Pass Forgery / Replay** | CRITICAL | 256-bit CSPRNG + SHA-256 hash persistence + single-use SQL update | **VERIFIED PASS** |
| **Missing Child Egress** | CRITICAL | PostgreSQL `FOR UPDATE` row lock + gate freeze check | **VERIFIED PASS** |
| **PII Data Leakage** | HIGH | Strict raw ID validation + last-4 truncation + DTO sanitizers | **VERIFIED PASS** |
| **Alarm Storms / Flooding** | HIGH | Duplicate alert check (409) + IP/user rate limiting | **VERIFIED PASS** |
| **Realtime Spoofing** | HIGH | Server-only outbox emission + reactive HTTP re-fetch | **VERIFIED PASS** |
| **Connection Exhaustion** | MEDIUM | Single `AuthContext` SSE stream + debounced event coalescing | **VERIFIED PASS** |

*All security controls and invariants have been verified against source code and automated regression suites with zero critical or high vulnerabilities.*
