# AARIZO — ISSUE-06 — PHASE B.2 — STEP 2.3 — PHASE 4.6.4
# SCANNER VERIFICATION & CAMERA/QR SECURITY AUDIT

**Audit Date:** 2026-11-19  
**Execution Mode:** STRICTLY READ-ONLY  
**Source Files Inspected:**
- [`src/pages/dashboard/security/ChildGateScannerPage.tsx`](file:///d:/AAZIRA/AARIZO/src/pages/dashboard/security/ChildGateScannerPage.tsx)
- [`src/components/ui/MobileQRScanner.tsx`](file:///d:/AAZIRA/AARIZO/src/components/ui/MobileQRScanner.tsx)
- [`src/components/ui/QRScanner.tsx`](file:///d:/AAZIRA/AARIZO/src/components/ui/QRScanner.tsx)
- [`server/src/childSafety/crypto.ts`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/crypto.ts)
- [`server/src/childSafety/router.ts`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts)
- [`server/src/childSafety/authz.ts`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/authz.ts)

---

## 1. Cryptographic Verification & Backend Security Architecture

### 1.1 Token Generation & Storage Invariant
- **Generation:** Child gate pass bearer tokens are generated on the server using Node.js `crypto.randomBytes(32)` (256-bit CSPRNG entropy) in [`server/src/childSafety/crypto.ts#L36`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/crypto.ts#L36).
- **Storage:** Raw tokens are **NEVER** stored in the database. Only the SHA-256 digest (`tokenHash`) is persisted in PostgreSQL:
  ```typescript
  export function hashChildPassToken(token: string): string {
    return createHash('sha256').update(token.trim()).digest('hex');
  }
  ```
- **Transmission:** The raw `bearerToken` and encoded `qrPayload` are returned ONCE in the response of `POST /api/children/passes`. Neither is emitted over SSE or returned in subsequent `GET /api/children/passes` calls.

### 1.2 Constant-Time Verification Invariant
In [`server/src/childSafety/crypto.ts#L52`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/crypto.ts#L52), token verification uses `crypto.timingSafeEqual` over SHA-256 digests:
```typescript
export function verifyChildPassTokenConstantTime(rawToken: string, storedHash: string): boolean {
  const presentedHash = hashChildPassToken(rawToken);
  return timingSafeEqual(Buffer.from(presentedHash, 'hex'), Buffer.from(storedHash, 'hex'));
}
```
This guarantees timing-attack resistance against brute-force token enumeration.

### 1.3 Display Pass Code Rejection (Fail-Closed)
- Pass codes formatted as `CGP-XXXX-XXXX` are display-only references intended for visual identification on staff dashboards.
- In [`server/src/childSafety/router.ts#L425-L435`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L425-L435):
  ```typescript
  const rawToken = extractBearerToken({ bearerToken: body.bearerToken, qrPayload: body.qrPayload });
  if (!rawToken) {
    return res.status(400).json({
      authorized: false,
      error: 'A valid cryptographic bearerToken or qrPayload is strictly required. Display passCode cannot authorize gate exit.',
      code: 'BEARER_TOKEN_REQUIRED',
    });
  }
  ```
- The backend strictly rejects attempts to verify using display pass codes, ensuring that possession of the display code alone cannot authorize exit.

### 1.4 Double-Spend & Concurrency Prevention
- Pass consumption is executed inside a PostgreSQL database transaction (`prisma.$transaction`) with an explicit conditional update:
  ```typescript
  const consumed = await tx.childGatePass.updateMany({
    where: {
      id: pass.id,
      societyId: actor.societyId,
      status: 'ACTIVE',
      currentUses: pass.currentUses, // Optimistic concurrency lock
    },
    data: {
      currentUses: pass.currentUses + 1,
      status: pass.currentUses + 1 >= pass.maxUses ? 'USED' : 'ACTIVE',
      lastUsedAt: now,
    },
  });
  if (consumed.count !== 1) {
    // Aborts transaction — concurrent attempt fails
    return { authorized: false, httpStatus: 409, code: 'PASS_ALREADY_CONSUMED' };
  }
  ```
- Furthermore, [`lockChildProfileRow(tx, pass.childId, actor.societyId)`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L520) locks the child profile row (`SELECT ... FOR UPDATE`), serializing concurrent exit requests against emergency SOS alerts.

### 1.5 Missing Child Lockdown Supremacy
If an active `MISSING_CHILD` alert exists for the child profile or the child's status is `MISSING`, the backend immediately rejects the exit with `409 CHILD_MISSING_ALERT_BLOCKED` and records a blocked exit log, regardless of pass validity.

---

## 2. Camera & QR Code Lifecycle Security

### 2.1 Sensitive Input State Lifecycle in `ChildGateScannerPage.tsx`
- **Immediate Scrubbing:** In [`ChildGateScannerPage.tsx#L142-L144`](file:///d:/AAZIRA/AARIZO/src/pages/dashboard/security/ChildGateScannerPage.tsx#L142-L144):
  ```typescript
  finally {
    setIsVerifying(false);
    setQrInput(''); // Clear sensitive QR payload from state immediately
  }
  ```
  The sensitive QR payload is guaranteed to be cleared on both success and error paths.
- **Zero Browser Storage:** Neither the QR payload nor bearer token is ever saved to `localStorage`, `sessionStorage`, or indexedDB.
- **In-Flight Lock:** The component prevents double-submissions by checking `isVerifying`:
  ```typescript
  if (!trimmed || isVerifying) return;
  setIsVerifying(true);
  ```

### 2.2 Camera Hardware Track Management
- When mobile camera scanning is triggered via `MobileQRScanner`:
  - Camera tracks must acquire hardware video access (`@capacitor/camera` or `@capacitor-mlkit/barcode-scanning`).
  - Upon component unmount, scan cancellation, or modal close, all active camera media streams must be stopped (`track.stop()`) to release the device camera hardware and turn off the hardware camera indicator LED.
- **Limitation & Disclosure:** In current browser/desktop testing environments, physical camera hardware integration is simulated; live camera validation on actual Android/iOS hardware remains deferred.

---

## 3. Role Authorization & Multi-Tenant Enforcement

### 3.1 Backend Gate Verify Roles
- In [`server/src/childSafety/router.ts#L54`](file:///d:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L54):
  ```typescript
  const GATE_VERIFY_ROLES = ['guard', 'admin'] as const;
  ```
- Only verified security guards and administrators can verify passes and record exit clearance. Residents, vendors, and delivery staff receive `403 Forbidden`.
- **Scanner UI Discrepancy (Documented for Remediation):**
  `ChildGateScannerPage.tsx:49` lists `isAuthorizedRole = ['guard', 'secretary', 'committee', 'admin']`.
  While secretaries and committee members may inspect the gate terminal and exit audit logs, they must be prevented from clicking "Scan Pass" to avoid 403 API errors.

### 3.2 Tenant Isolation
- Backend verifies `pass.societyId === actor.societyId` and `pass.child.societyId === actor.societyId`.
- Cross-society token presentation returns `404 INVALID_OR_UNKNOWN_PASS` without disclosing whether the pass exists in another society.

---

## 4. Transport & Realtime Invariants

| Security Invariant | Status | Verification Evidence |
| :--- | :--- | :--- |
| **AuthContext Connection Ownership** | **MAINTAINED** | Scanner component does not call `realtimeService.connect()`. Single authenticated connection maintained. |
| **Zero URL Token Leaks** | **MAINTAINED** | Uses Fetch-based SSE transport with HTTP `Authorization` headers. Never passes JWT in query parameters. |
| **Zero EventSource Fallback** | **MAINTAINED** | Native `EventSource` is strictly omitted to prevent browser query-string token exposure. |
| **Zero Relay via BroadcastChannel** | **MAINTAINED** | No cross-tab broadcasting of protected security events. |
| **Zero Client Protected Publishing** | **MAINTAINED** | Scanner component never calls `realtimeService.publish()`. |
| **Bounded Deduplication Window** | **MAINTAINED** | `useSecurityChildSafetyRealtime` maintains a 250-item bounded FIFO deduplication cache. |
| **Strict Mode Safety** | **MAINTAINED** | Unmount cleanly unregisters SSE subscription listeners without memory leaks. |

