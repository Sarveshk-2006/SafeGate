# AARIZO — ISSUE-06 — PHASE B.2 — STEP 2.3 — PHASE 4.6.4
# CHILD GATE SCANNER REALTIME ALIGNMENT — IMPLEMENTATION PLAN

**Audit Date:** 2026-11-19  
**Execution Mode:** STRICTLY READ-ONLY (Blueprint for subsequent implementation phase)  
**Target File:** [`src/pages/dashboard/security/ChildGateScannerPage.tsx`](file:///d:/AAZIRA/AARIZO/src/pages/dashboard/security/ChildGateScannerPage.tsx)

---

## 1. Upstream Prerequisites & Entry Criteria
1. **Upstream Blocker Resolution:**  
   Before executing the scanner changes outlined in this plan, the Admin Child Safety desk ([`AdminChildSafetyPage.tsx`](file:///d:/AAZIRA/AARIZO/src/pages/dashboard/admin/AdminChildSafetyPage.tsx)) must be modernized and receive a verdict of **PASS** on its independent audit.
2. **Read-Only Posture:**  
   No source code edits, migrations, or commits shall be made during this planning phase.

---

## 2. Granular Implementation Steps for `ChildGateScannerPage.tsx`

### Step 1: Differentiate Verification Permissions (`canVerifyPass`)
In [`ChildGateScannerPage.tsx#L47-L50`](file:///d:/AAZIRA/AARIZO/src/pages/dashboard/security/ChildGateScannerPage.tsx#L47-L50):
```typescript
const userRole = (currentUser?.role || '').toLowerCase();
// Terminal audit view: Guard, Secretary, Committee, Admin
const isAuthorizedRole = ['guard', 'secretary', 'committee', 'admin'].includes(userRole);
// Pass verification execution: Guard and Admin ONLY (matches backend GATE_VERIFY_ROLES)
const canVerifyPass = ['guard', 'admin'].includes(userRole);
```

### Step 2: Verification Guard in `handleScanQR`
Add an explicit early check before dispatching verification:
```typescript
if (!canVerifyPass) {
  setScanResult({
    scanned: true,
    allowed: false,
    message: 'Access Denied: Gate clearance verification requires Security Guard or Administrator privileges.',
    code: 'INSUFFICIENT_ROLE_PERMISSIONS',
  });
  setQrInput('');
  return;
}
```

### Step 3: Granular UI Disablement & View-Only Banner
Update the scan input form:
1. Disable the "Scan Pass" submit button when `!canVerifyPass`:
   ```tsx
   <button
     type="submit"
     disabled={isVerifying || !qrInput.trim() || !canVerifyPass}
     title={!canVerifyPass ? 'Gate clearance verification requires Guard or Admin role' : undefined}
     style={{
       padding: '0.65rem 1.25rem',
       background: isVerifying || !canVerifyPass ? '#94A3B8' : 'var(--aarizo-coral, #F06543)',
       color: '#ffffff',
       border: 'none',
       borderRadius: '12px',
       fontWeight: 800,
       fontSize: '0.8125rem',
       cursor: isVerifying || !canVerifyPass ? 'not-allowed' : 'pointer',
       boxShadow: '0 2px 8px rgba(240, 101, 67, 0.25)',
       whiteSpace: 'nowrap',
       display: 'flex',
       alignItems: 'center',
       gap: '0.35rem',
     }}
   >
     <Scan size={15} /> {isVerifying ? 'Verifying...' : 'Scan Pass'}
   </button>
   ```
2. Render an informative banner when accessed by a non-verify role (`committee`, `secretary`):
   ```tsx
   {!canVerifyPass && (
     <div
       style={{
         background: '#FFFBEB',
         border: '1px solid #FDE68A',
         borderRadius: '10px',
         padding: '0.625rem 0.875rem',
         fontSize: '0.75rem',
         color: '#92400E',
         display: 'flex',
         alignItems: 'center',
         gap: '0.5rem',
       }}
     >
       <AlertTriangle size={15} color="#D97706" />
       <span>
         <strong>View-Only Terminal:</strong> You are logged in as &quot;{currentUser?.role}&quot;. Gate clearance verification and pass scanning are strictly restricted to Security Guard and Admin personnel.
       </span>
     </div>
   )}
   ```

### Step 4: Optional Mobile Camera Scanner Modal Trigger
To support physical mobile devices without dedicated hardware barcode scanners:
1. Import `Camera` icon from `lucide-react` and `MobileQRScanner` from `src/components/ui/MobileQRScanner`:
   ```typescript
   import { MobileQRScanner } from '../../../components/ui/MobileQRScanner';
   ```
2. Introduce local state for camera modal visibility:
   ```typescript
   const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
   ```
3. Add a "Use Camera" trigger button alongside the text input:
   ```tsx
   <button
     type="button"
     disabled={isVerifying || !canVerifyPass}
     onClick={() => setIsCameraActive(true)}
     aria-label="Open Camera Scanner"
     style={{
       padding: '0.65rem 0.875rem',
       background: '#F4FAFE',
       border: '1px solid #DCE8EF',
       borderRadius: '12px',
       color: '#083B56',
       fontWeight: 700,
       fontSize: '0.8125rem',
       cursor: isVerifying || !canVerifyPass ? 'not-allowed' : 'pointer',
       display: 'flex',
       alignItems: 'center',
       gap: '0.35rem',
     }}
   >
     <Camera size={16} /> Camera
   </button>
   ```
4. Render `MobileQRScanner` modal when `isCameraActive === true`:
   ```tsx
   {isCameraActive && (
     <MobileQRScanner
       label="Scan Child Gate Pass QR Code"
       onScan={(scannedCode) => {
         setIsCameraActive(false);
         void handleScanQR(scannedCode);
       }}
       onClose={() => setIsCameraActive(false)}
     />
   )}
   ```
5. Ensure that closing or unmounting the camera modal releases media stream tracks immediately without leaving open camera handles.

### Step 5: Realtime Coalesced Synchronization Verification
Preserve the existing `useSecurityChildSafetyRealtime` integration:
- `onActivePassesChange`, `onExitLogsChange`, and `onAlertsChange` continue to trigger debounced refreshes via `loadData()`.
- Authoritative resync on SSE reconnect is maintained.

---

## 3. Rollback & Safety Strategy
- Changes are strictly confined to `ChildGateScannerPage.tsx`.
- Backend endpoints and cryptographic validation in `server/src/childSafety/router.ts` remain completely untouched.
- Rollback: Reverting `ChildGateScannerPage.tsx` restores baseline state immediately without schema or dependency impact.

