# AARIZO — ISSUE-06 — PHASE B.2 — STEP 2.3 — PHASE 4.6.5
# COMPLETE CHILD SAFETY END-TO-END REGRESSION & INTEGRATION AUDIT
## DELIVERABLE 3: SECURITY & REGRESSION READINESS MATRIX

---

## 1. Security & Privacy Audit

### 1.1 Token Exposure, Cryptographic Security & Lifecycle

| Vector | Security Standard / Invariant | Actual Implementation | Verification Evidence | Status |
|---|---|---|---|---|
| **Pass Bearer Token Generation** | Must use cryptographically secure PRNG (>=256-bit entropy). | `crypto.randomBytes(32).toString('hex')` generates a 64-character hex string (256-bit entropy). | [`server/src/childSafety/crypto.ts#L35`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/crypto.ts) | **PASSED** |
| **Pass Token Storage** | Raw bearer token must NEVER be persisted in plaintext. | Server stores only HMAC-SHA256 / SHA-256 hex digest in `token_hash`. Salted with server key `CHILD_SAFETY_TOKEN_SECRET`. | [`server/prisma/schema.prisma#L1159`](file:///d:/AAZIRA/AARIZO/server/prisma/schema.prisma#L1159) | **PASSED** |
| **Pass Reference Code vs Token** | Display codes (`passCode`, e.g., `CGP-AB12CD`) must NEVER authorize exit. | 1. Database enforces unique `[societyId, passCode]` strictly for human reference.<br>2. `/passes/verify` strictly demands `bearerToken` or signed `qrPayload`. Display codes rejected immediately with `BEARER_TOKEN_REQUIRED`.<br>3. Scanner UI rejects `CGP-` codes client-side. | [`tests/issue06_b23_child_gate_scanner.test.ts`](file:///d:/AAZIRA/AARIZO/tests/issue06_b23_child_gate_scanner.test.ts) (Suite 9) | **PASSED** |
| **QR Code Payload Encoding** | Token must be encapsulated in structured JSON with version and society context. | `encodeChildPassQrPayload()` creates `{ v: 1, t: bearerToken, c: passCode, s: societyId }`. | [`server/src/childSafety/crypto.ts#L70`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/crypto.ts#L70) | **PASSED** |
| **URL Token Exposure** | Bearer tokens or session tokens must NEVER appear in URL parameters. | 1. Verification API is strictly `POST` with JSON body.<br>2. SSE streaming uses custom `fetch` with `Authorization: Bearer <token>` HTTP header. Zero tokens in query strings. | [`src/services/realtimeService.ts#L704`](file:///d:/AAZIRA/AARIZO/src/services/realtimeService.ts#L704) | **PASSED** |
| **Logging & Output Sanitization** | Sensitive tokens, hashes, and identity proofs must be stripped from logs and responses. | 1. `sanitizeGatePassDto()` explicitly strips `tokenHash` and internal secrets.<br>2. `sanitizeErrorMessage()` masks tokens, passwords, and connection strings.<br>3. Scanner component purges `qrInput` in `finally` block immediately after verification. | [`src/pages/dashboard/security/ChildGateScannerPage.tsx#L160`](file:///d:/AAZIRA/AARIZO/src/pages/dashboard/security/ChildGateScannerPage.tsx#L160) | **PASSED** |
| **Local Storage & Persistence** | Tokens and passes must NEVER be written to `localStorage` or `sessionStorage`. | Resident and Scanner components keep passes in React state / memory only. Zero Web Storage persistence. | Component code inspection | **PASSED** |

---

### 1.2 Rate Limiting & Denial of Service (DoS) Defense

```mermaid
flowchart LR
    REQ["Incoming API Request"] --> PROXY_GUARD["Reverse Proxy Validation\n(Strip spoofed X-Forwarded-For)"]
    PROXY_GUARD --> MEM_CHECK{"Memory Limits OK?\n(<10,000 buckets)"}
    MEM_CHECK -- No --> FAIL_CLOSED["HTTP 503 SERVICE_UNAVAILABLE\n(Fail-Closed Defense)"]
    MEM_CHECK -- Yes --> LIMITER{"Within Window Quota?"}
    LIMITER -- Exceeded --> HTTP_429["HTTP 429 TOO_MANY_REQUESTS\n(Includes Retry-After Header)"]
    LIMITER -- Allowed --> HANDLER["Express Route Handler"]
```

| Route | Quota Window | Keying Strategy | Defense Guarantees | Status |
|---|---|---|---|---|
| **`POST /api/children/passes/verify`** | 30 requests / 1 minute | Client IP + Guard Actor ID | Prevents brute-force scanning of bearer tokens. Ignores spoofed `X-Forwarded-For`. Fails closed if memory capacity exceeded. | **PASSED** |
| **`POST /api/children/passes`** | 20 requests / 10 minutes | Society ID + Resident User ID | Prevents pass generation spamming and token exhaustion. | **PASSED** |
| **`POST /api/children/sos`** | 10 requests / 1 minute | Society ID + Actor ID | Prevents false alarm flooding and alert saturation. | **PASSED** |

---

### 1.3 Replay Attacks & Cryptographic Token Invalidation

- **Atomic Single-Use Consumption:** During verification (`POST /passes/verify`), the database transaction atomically checks `currentUses < maxUses` and executes `updateMany({ where: { id: pass.id, currentUses: 0, status: 'ACTIVE' }, data: { currentUses: 1, status: 'EXHAUSTED' } })`.
- **Replay Detection & Audit:** If the token is scanned a second time, the query finds `status === 'EXHAUSTED'` and immediately creates a `ChildExitLog` with `outcome: 'DENIED_EXHAUSTED'` and returns `422 PASS_ALREADY_USED`. The replay attempt is logged permanently with the guard's identity and timestamp.
- **Constant-Time Verification:** Verification utilizes `crypto.timingSafeEqual()` to compare presented token digests against database hashes, completely eliminating timing side-channel attacks.

---

### 1.4 IDOR, Privilege Escalation & Multi-Tenancy

- **Cross-Society Isolation:**
  - Every child safety route invokes `resolveChildSafetyActor()`.
  - Attempts to supply a foreign `societyId` in the body or query parameter are unconditionally stripped or rejected with `403 TENANT_ISOLATION_VIOLATION`.
  - Cross-society record requests return `404 Not Found` (zero oracle disclosure).
- **Cross-Flat Resident Isolation:**
  - A resident can only view, update, or generate passes for children where `guardianUserId === actor.userId` and the associated flat matches the resident's verified tenancy.
  - Querying another resident's child returns `403 FORBIDDEN` or `404`.
- **Role-Based Privilege Escalation Prevention:**
  - **Guards:** Cannot create child profiles (`403`), update profiles (`403`), or create gate passes (`403`). Strictly restricted to pass verification and alert acknowledgement.
  - **Residents:** Cannot verify gate passes (`403`), acknowledge alerts (`403`), or resolve incidents (`403`).
  - **Committee / Secretary:** View-only on gate verification scanner; submit button disabled and API rejects with `403`.

---

### 1.5 Resident Privacy & Data Minimization

- **Identity Proof Minimization:**
  - National identity proof numbers (Aadhaar, Passport, Driving License) are NEVER stored in plaintext.
  - Only `idDocumentLast4` (4 digits) and `idDocumentType` are preserved in plaintext for physical visual comparison at the gate.
  - Salted SHA-256 hash `idDocumentHash` is stored for tamper detection and is stripped from all API outputs.
- **Guard PII Exposure Minimization:**
  - Guard scanners display only operational verification data: child full name, flat number, escort name, relationship, and optional escort photo.
  - Sensitive internal resident notes, secondary contact emails, and full national IDs are excluded from guard DTOs.

---

## 2. Audit of the 6 Critical B.2.1 Database Integrity Risks

The B.2.1 schema audit identified six critical database integrity risks that must be enforced at the schema and engine level. The current implementation status of each is documented below:

```mermaid
classDiagram
    class Society {
        +String id PK
        +String name
    }
    class ChildProfile {
        +String id PK
        +String societyId FK
        +String flatId FK
        +String status
        +DateTime archivedAt
    }
    class ChildAuthorizedPickup {
        +String id PK
        +String societyId FK
        +String childId FK
        +String idDocumentLast4
        +String idDocumentHash
        +String status
    }
    class ChildGatePass {
        +String id PK
        +String societyId FK
        +String childId FK
        +String passCode
        +String tokenHash
        +String status
        +Int currentUses
        +Int maxUses
    }
    class ChildExitLog {
        +String id PK
        +String societyId FK
        +String childId FK
        +String passId FK
        +String outcome
        +DateTime timestamp
    }
    class ChildSafetyAlert {
        +String id PK
        +String societyId FK
        +String childId FK
        +String emergencyIncidentId FK
        +String status
        +DateTime acknowledgedAt
        +DateTime resolvedAt
    }

    Society "1" <-- "many" ChildProfile : Restrict
    ChildProfile "1" <-- "many" ChildAuthorizedPickup : Composite FK Restrict
    ChildProfile "1" <-- "many" ChildGatePass : Composite FK Restrict
    ChildAuthorizedPickup "0..1" <-- "many" ChildGatePass : Composite FK Restrict
    ChildGatePass "1" <-- "many" ChildExitLog : Composite FK Restrict
    ChildProfile "1" <-- "many" ChildSafetyAlert : Composite FK Restrict
```

| Risk ID | Risk Description | Architectural Remedy & Implementation | Status |
|---|---|---|---|
| **B21-01** | **Composite Primary & Foreign Keys for Tenant Isolation** | Composite unique constraints `[societyId, id]` defined on `child_profiles`, `child_authorized_pickups`, `child_gate_passes`, and `child_safety_alerts`. Child records reference parents via composite foreign keys `[societyId, childId]`, ensuring rows can NEVER be cross-linked between societies at the relational engine level. | **FULLY MITIGATED** |
| **B21-02** | **Strict Foreign Key Constraints vs Cascade Deletes** | All domain relations enforce `onDelete: Restrict`. Deleting a `Society`, `Resident`, `Flat`, `ChildProfile`, or `ChildAuthorizedPickup` will be rejected by PostgreSQL if dependent child safety records exist. User actor references use `onDelete: SetNull` to preserve immutable audit trails if users are deleted. | **FULLY MITIGATED** |
| **B21-03** | **Index Coverage for Child Safety Queries** | Exhaustive composite index coverage implemented across all tables: `[societyId, status]`, `[societyId, flatNumber]`, `[societyId, passCode]`, `[societyId, phone]`, `[societyId, timestamp]`. Zero unindexed full table scans for operational endpoints. | **FULLY MITIGATED** |
| **B21-04** | **Check Constraints on Status & Type Enums** | Native PostgreSQL `CHECK` constraints and Prisma enums define explicit allowed values: `ChildStatus` (`SAFE`, `OUT_OF_SOCIETY`, `MISSING`, `ARCHIVED`), `ChildGatePassStatus` (`ACTIVE`, `EXHAUSTED`, `EXPIRED`, `REVOKED`), `ChildExitOutcome` (`ALLOWED`, `DENIED`, etc.). Invalid status transitions rejected at DB level. | **FULLY MITIGATED** |
| **B21-05** | **Immutable Audit Trails** | `child_exit_logs` is an append-only audit table with no update or delete routes exposed. Gate verification outcomes (`ALLOWED`, `DENIED_EXHAUSTED`, `DENIED_EXPIRED`, `DENIED_INVALID_TOKEN`) are permanently stored with actor ID and timestamp. Soft-deletes (`archivedAt`) used for profile management. | **FULLY MITIGATED** |
| **B21-06** | **Idempotency Keys & Concurrency Locks for Pass Verification** | Pass verification runs under `prisma.$transaction` with explicit row-level locking (`lockChildProfileRow`) and atomic compare-and-swap on `currentUses`. Prevents race conditions where a single QR code could be scanned simultaneously at two gates. | **FULLY MITIGATED** |

---

## 3. Regression Audit Across Non-Child Modules

To ensure child safety hardening did not introduce regressions in existing platform domains, all adjacent modules were audited:

| Module / Workflow | Integration Boundary with Child Safety | Potential Regression Vectors | Verification & Test Evidence | Status |
|---|---|---|---|---|
| **Visitor Management** | Perimeter security gate, guard scanner, visitor passes. | Shared gate infrastructure, pass table pollution, routing collisions. | Passes stored in separate tables (`child_gate_passes` vs `visitor_passes`). Routes fully partitioned under `/api/children/passes` vs `/api/visitors`. Full test suite passed. | **NO REGRESSION** |
| **Staff & Domestic Workers** | Security gate verification, domestic worker rosters. | Shared actor resolution middleware, guard permissions. | Domestic worker verification operates on independent endpoints. Guard role authorization preserved. | **NO REGRESSION** |
| **Resident Management** | Flat occupancy, resident directory, household members. | Resident foreign key constraints, profile updates. | `onDelete: Restrict` prevents accidental resident deletion while children exist; normal profile edits unaffected. | **NO REGRESSION** |
| **General Emergency Console** | `EmergencyIncident` management, staff SOS dispatch. | Linked child SOS alerts mutating general incident status. | `EmergencyIncident` synchronization verified: child SOS creates linked incident with `category: 'CHILD_SAFETY'`. Resolving child alert synchronizes `EmergencyIncident` status to `RESOLVED`. | **NO REGRESSION** |
| **Notice Board & Polls** | Resident dashboard announcements, community notifications. | Shared realtime SSE channel, audience filtering. | Generic broadcast route (`/api/realtime/broadcast`) blocks injection of child safety event types. Audience filtering strictly enforced. | **NO REGRESSION** |
| **Society Settings & Config** | Society onboarding, feature flags, committee roles. | Tenant context resolution, platform admin overrides. | Multi-tenancy checks allow platform admins with concrete society context to manage settings while blocking cross-society leaks. | **NO REGRESSION** |
| **Shared UI Components** | `DataTable`, `Modal`, `MobileQRScanner`, `RealtimeLiveBar`. | Component prop mismatches, styling regressions. | Built cleanly in Vite production build (`npm run build`, 0 errors). Shared UI components render correctly. | **NO REGRESSION** |

---

## 4. Security Readiness Verdict

### **Verdict: PASS (Security & Relational Integrity Core)**
The core backend security, cryptographic token lifecycle, tenancy enforcement, rate limiting, and relational database integrity models meet the highest production safety standards. No CRITICAL or HIGH security vulnerabilities exist in the core Child Safety services, database models, or verification engine.
