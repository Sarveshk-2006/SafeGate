# AARIZO — ISSUE-06 Phase B.2: Child Safety Security & Threat Matrix

**Project:** `D:\AAZIRA\AARIZO`  
**Phase:** ISSUE-06 — B.2 Child Safety & Biometric Gate Radar  
**Document:** Security & Vulnerability Matrix  
**Audit Mode:** STRICT READ-ONLY AUDIT  
**Status:** COMPLETED  

---

## 1. Threat Identification & Vulnerability Analysis

This matrix documents the concrete security risks, CVSS severity ratings, attack vectors, affected code paths, and mandatory security controls identified during the Phase B.2 Child Safety audit.

| Threat ID | Vulnerability / Threat | Severity | CVSS v3.1 | Attack Vector & Mechanism | Affected Files & Lines | Required Security Control |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **SEC-B2-01** | Cross-Society Child Gate Verification Leak | **CRITICAL** | 9.1 | A security guard authenticated in Society A sends `POST /api/children/passes/:id/verify` with a pass ID from Society B. The server verifies and exits the child without checking tenant ownership. | [server/src/index.ts#L2743-L2760](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2743-L2760) | Strict tenant verification: reject with HTTP 403 if `pass.societyId !== req.societyId`. |
| **SEC-B2-02** | Unauthenticated Child Safety SOS Dispatch | **CRITICAL** | 9.0 | An unauthenticated attacker sends `POST /api/children/sos` from any network location, creating emergency incident rows in PostgreSQL and broadcasting panic alarms to guards. | [server/src/index.ts#L2767-L2786](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2767-L2786) | Require authentication & `requireRole(['resident', 'secretary', 'admin'])`; fail closed if missing. |
| **SEC-B2-03** | Insecure Society Fallback (`soc-gvs`) & Query Override | **CRITICAL** | 8.8 | An authenticated user without a bound `societyId` or passing `?societyId=other` accesses foreign society child profiles and gate passes. | [server/src/index.ts#L2662](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2662), [L2703](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2703), [L2717](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2717) | Disallow query/body overrides of `societyId`; eliminate `'soc-gvs'` fallback; fail closed with HTTP 403. |
| **SEC-B2-04** | Society-Wide Child Gate Pass Data Leak | **HIGH** | 7.5 | An authenticated resident in Society A calls `GET /api/children/passes`. The endpoint returns ALL child gate passes across the society, including caretaker names, phones, and pass codes. | [server/src/index.ts#L2701-L2713](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2701-L2713) | Enforce role-based scoping: residents can only retrieve passes for children registered to their own flat/profile. |
| **SEC-B2-05** | Unauthorized Child Pass Creation | **HIGH** | 7.4 | A resident sends `POST /api/children/passes` providing a `childId` belonging to another resident. The server creates the pass without verifying parental/guardian custody. | [server/src/index.ts#L2715-L2741](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2715-L2741) | Validate that the authenticated resident owns the child profile (by `residentId` or `flatId`) before issuing pass. |
| **SEC-B2-06** | Pass Replay & Unlimited Exit Exploit | **HIGH** | 7.2 | A caretaker presents an already-used or expired QR pass at the gate. The verification endpoint does not check `status === 'VERIFIED_EXITED'` or `validUntil < now`, repeatedly authorizing gate exits. | [server/src/index.ts#L2749-L2755](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2749-L2755) | Reject verification if status is not `ACTIVE` or current timestamp exceeds `validUntil`; implement state transition to `USED` / `VERIFIED_EXITED`. |
| **SEC-B2-07** | QR Pass Forgery (No Cryptographic Signature) | **HIGH** | 7.1 | Frontend generates pass codes with plaintext pattern `CP-QR-${Date.now()}-${random}` or `CGP-${random}`. Any actor knowing the pattern can forge valid-looking QR passes for offline verification. | [src/services/childSafetyService.ts#L389](file:///D:/AAZIRA/AARIZO/src/services/childSafetyService.ts#L389), [server/src/index.ts#L2724](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2724) | Issue HMAC-SHA256 cryptographically signed QR payloads from backend (consistent with Phase B.1 `signPassPayload`). |
| **SEC-B2-08** | Silent Mutation Dropping in Emergency Contexts | **HIGH** | 6.8 | In `childSafetyService.ts`, network requests for child profile creation, pass generation, and SOS alerts are swallowed via `.catch(() => {})`. Users believe children are registered or SOS is sent when backend dropped it. | [src/services/childSafetyService.ts#L283](file:///D:/AAZIRA/AARIZO/src/services/childSafetyService.ts#L283), [L412](file:///D:/AAZIRA/AARIZO/src/services/childSafetyService.ts#L412), [L580](file:///D:/AAZIRA/AARIZO/src/services/childSafetyService.ts#L580) | Await all network mutations; propagate errors to UI; block success confirmation if backend rejects. |
| **SEC-B2-09** | Gate Verifier Multi-Device Total Failure | **HIGH** | 6.5 | Security guard gate terminal checks only local browser `localStorage`. Valid QR codes generated on resident phones are rejected as invalid, forcing guards to bypass system manually. | [src/services/childSafetyService.ts#L417-L430](file:///D:/AAZIRA/AARIZO/src/services/childSafetyService.ts#L417-L430) | Guard scanner must call authoritative backend verification endpoint with fail-closed offline fallback. |

---

## 2. Role-Based Access Control (RBAC) Matrix

The table below defines the strict access control requirements to be implemented across all Child Safety endpoints.

| Endpoint | Method | Permitted Roles | Resident Scoping Rule | Guard Scoping Rule | Admin / Secretary Rule |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/children` | `GET` | `resident`, `guard`, `secretary`, `admin` | Scoped strictly to `residentId` or `flatId` of authenticated resident | Allowed to view active child profiles within assigned society for gate verification | Full read access across assigned society |
| `/api/children` | `POST` | `resident`, `secretary`, `admin` | Can only create children associated with authenticated resident's flat | Forbidden (403) | Can create on behalf of residents within assigned society |
| `/api/children/:id` | `GET` | `resident`, `guard`, `secretary`, `admin` | Can only read if child belongs to resident's flat | Society-scoped read | Society-scoped read |
| `/api/children/:id` | `PATCH` | `resident`, `secretary`, `admin` | Can only update if child belongs to resident's flat | Forbidden (403) | Society-scoped update |
| `/api/children/passes` | `GET` | `resident`, `guard`, `secretary`, `admin` | Scoped strictly to passes for resident's children | Society-scoped active pass list for gate operations | Full read access across assigned society |
| `/api/children/passes` | `POST` | `resident`, `secretary`, `admin` | Can only issue pass for children belonging to resident's flat | Forbidden (403) | Can issue pass on behalf of resident within assigned society |
| `/api/children/passes/verify` | `POST` | `guard`, `secretary`, `admin` | Forbidden (403) | Can verify and check out child at gate within assigned society | Can verify/override within assigned society |
| `/api/children/sos` | `POST` | `resident`, `guard`, `secretary`, `admin` | Can trigger for resident's child or flat | Can trigger gate emergency alert for society | Can trigger society emergency alert |

---

## 3. Cryptographic Verification & Offline Security Boundary

Following the standard proven in Phase B.1 (Visitor Pass), Child Gate Passes must support **fail-closed offline gate verification**:

1. **Online Verification (Authoritative)**:
   - Guard scans QR code at gate terminal.
   - Terminal dispatches `POST /api/children/passes/verify` with `{ code, gateId, guardName }`.
   - Backend performs atomic validation:
     - Confirms `societyId` match.
     - Confirms child status is `SAFE` (not `MISSING`).
     - Confirms pass status is `ACTIVE`.
     - Confirms timestamp is between `validFrom` and `validUntil`.
     - Increments `currentUses` and marks `USED` / `VERIFIED_EXITED`.
     - Inserts immutable `ChildExitLog` record.
     - Broadcasts `CHILD_GATE_PASS_VERIFIED` to connected residents and guards.

2. **Offline Verification (Fail-Closed Fallback)**:
   - If gate terminal network is down, the terminal parses the scanned QR payload.
   - The QR code contains:
     ```json
     {
       "id": "cpass_123",
       "childId": "child_456",
       "societyId": "soc_789",
       "pickupName": "Sunita Devi",
       "validUntil": "2026-11-17T22:00:00.000Z",
       "sig": "hmac_sha256_signature"
     }
     ```
   - Terminal validates signature against society gate public/secret key.
   - If invalid, expired, or wrong society -> **FAIL CLOSED (DENIED)**.
   - If valid -> authorizes exit, queues local verification log with `status: 'OFFLINE_VERIFIED'`, and replays to server upon network restoration.

