# AARIZO — ISSUE-06 — PHASE B.2 — STEP 2.3 — PHASE 4.6.4
# ADMIN & SCANNER REALTIME ALIGNMENT — IMPLEMENTATION PLAN

**Audit Date:** 2026-11-19  
**Execution Mode:** STRICTLY READ-ONLY (Blueprint for subsequent implementation phase)  
**Target Files:**
- [`src/pages/dashboard/admin/AdminChildSafetyPage.tsx`](file:///d:/AAZIRA/AARIZO/src/pages/dashboard/admin/AdminChildSafetyPage.tsx)
- [`src/pages/dashboard/security/ChildGateScannerPage.tsx`](file:///d:/AAZIRA/AARIZO/src/pages/dashboard/security/ChildGateScannerPage.tsx)

---

## 1. Objectives & Scope
1. **Modernize Admin Child Safety Desk (`AdminChildSafetyPage.tsx`):**
   - Eliminate hardcoded `'soc-gvs'` fallback and enforce strict tenant isolation from authenticated session context.
   - Replace all deprecated synchronous mock APIs (`getChildren`, `getPickupLogs`, `getSafetyAlerts`, `resolveSafetyAlert`) with canonical asynchronous backend REST methods (`listChildren`, `listAlerts`, `listExitLogs`, `resolveAlert`).
   - Migrate data models from legacy `ChildProfile` to canonical DTOs (`ChildProfileDto`, `ChildExitLogDto`, `ChildSafetyAlertDto`).
   - Hook into shared realtime engine via [`useChildSafetyRealtime`](file:///d:/AAZIRA/AARIZO/src/hooks/useChildSafetyRealtime.ts) across all 14 Child Safety SSE topics with a 50ms coalesced debounce.
   - Subscribe to `realtimeService.subscribeToStatus` and display live connection status pill (`data-connection-state`).
   - Add component-level defense-in-depth role check (`admin`, `secretary`).
   - Add robust async loading, error retry, and empty state cards.
   - Replace hardcoded "Green Valley Society" with `currentUser.societyName`.
2. **Align Perimeter Gate Scanner (`ChildGateScannerPage.tsx`):**
   - Distinguish terminal viewing rights (`guard`, `secretary`, `committee`, `admin`) from gate pass verification execution (`guard`, `admin`).
   - Disable the "Scan Pass" submit button for non-guard/non-admin roles (`secretary`, `committee`) with an explanatory badge to prevent guaranteed 403 API rejections.

---

## 2. Detailed Implementation Blueprint: Admin Child Safety Desk

### Step 1: Authentication & Society Isolation Hardening
- Remove line 22: `const societyId = (currentUser as any)?.societyId || 'soc-gvs';`.
- Enforce strict authenticated extraction:
  ```typescript
  const { currentUser } = useAuth();
  const societyId = currentUser?.societyId?.trim() || '';
  const userRole = (currentUser?.role || '').toLowerCase();
  const isPlatformAdmin = userRole === 'platform_admin' || userRole === 'superadmin';
  const isAuthorized = ['admin', 'secretary'].includes(userRole) || isPlatformAdmin;
  ```
- If `!currentUser || !societyId || !isAuthorized`, immediately render an `Access Denied` security card with zero data loading.

### Step 2: Canonical DTO Migration
- Replace legacy type imports with canonical DTOs from `src/types/childSafety`:
  ```typescript
  import type {
    ChildProfileDto,
    ChildExitLogDto,
    ChildSafetyAlertDto,
  } from '../../../types/childSafety';
  ```
- Update component state:
  ```typescript
  const [children, setChildren] = useState<ChildProfileDto[]>([]);
  const [pickupLogs, setPickupLogs] = useState<ChildExitLogDto[]>([]);
  const [safetyAlerts, setSafetyAlerts] = useState<ChildSafetyAlertDto[]>([]);
  const [selectedChild, setSelectedChild] = useState<ChildProfileDto | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resolvingAlertId, setResolvingAlertId] = useState<string | null>(null);
  ```

### Step 3: Canonical Asynchronous Data Loading
- Implement async `loadData` using `Promise.allSettled`:
  ```typescript
  const loadData = useCallback(async () => {
    if (!currentUser || !societyId || !isAuthorized) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const [childrenRes, logsRes, alertsRes] = await Promise.allSettled([
        childSafetyService.listChildren(),
        childSafetyService.listExitLogs({ limit: 50 }),
        childSafetyService.listAlerts({ status: 'ACTIVE' }),
      ]);

      if (childrenRes.status === 'fulfilled') {
        setChildren(childrenRes.value);
      }
      if (logsRes.status === 'fulfilled') {
        setPickupLogs(logsRes.value);
      }
      if (alertsRes.status === 'fulfilled') {
        setSafetyAlerts(alertsRes.value);
      }

      if (childrenRes.status === 'rejected' && logsRes.status === 'rejected') {
        setLoadError('Failed to load child safety data from server.');
      }
    } catch (err: unknown) {
      setLoadError('Unexpected network or server error occurred.');
    } finally {
      setIsLoading(false);
    }
  }, [currentUser, societyId, isAuthorized]);
  ```

### Step 4: Realtime Subscription & Coalescing
- Integrate `useChildSafetyRealtime` with debounced refresh:
  ```typescript
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  const scheduleCoalescedRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      void loadData();
    }, 50);
  }, [loadData]);

  useChildSafetyRealtime({
    enabled: isAuthorized && Boolean(societyId),
    onProfilesChange: scheduleCoalescedRefresh,
    onPickupsChange: scheduleCoalescedRefresh,
    onPassesChange: scheduleCoalescedRefresh,
    onExitLogsChange: scheduleCoalescedRefresh,
    onAlertsChange: scheduleCoalescedRefresh,
    onReconnect: () => {
      void loadData();
    },
  });
  ```

### Step 5: Realtime Connection Status Pill
- Subscribe to `realtimeService.subscribeToStatus`:
  ```typescript
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeConnectionStatus>(() =>
    realtimeService.getConnectionStatus()
  );

  useEffect(() => {
    const unsub = realtimeService.subscribeToStatus((status) => {
      setRealtimeStatus(status);
    });
    return unsub;
  }, []);
  ```
- Render status badge in header:
  ```tsx
  <span
    data-connection-state={realtimeStatus.state}
    className={`px-2 py-0.5 text-xs font-bold rounded-full ${
      realtimeStatus.state === 'CONNECTED'
        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
        : realtimeStatus.state === 'RECONNECTING'
        ? 'bg-amber-100 text-amber-800 border border-amber-300'
        : 'bg-rose-100 text-rose-800 border border-rose-300'
    }`}
  >
    {realtimeStatus.state === 'CONNECTED' ? '● Realtime Live' : realtimeStatus.state === 'RECONNECTING' ? '⟳ Reconnecting...' : '✕ Offline'}
  </span>
  ```

### Step 6: Canonical Backend Alert Resolution
- Replace synchronous mock resolve with backend API:
  ```typescript
  const handleResolveAlert = async (alertId: string) => {
    if (resolvingAlertId) return;
    setResolvingAlertId(alertId);
    try {
      await childSafetyService.resolveAlert(alertId, {
        resolutionNotes: `Resolved by ${currentUser?.name || 'Society Admin'} from Admin Desk.`,
        status: 'RESOLVED',
      });
      void loadData();
    } catch (err: unknown) {
      console.error('[AdminChildSafetyPage] Failed to resolve alert:', err);
    } finally {
      setResolvingAlertId(null);
    }
  };
  ```

### Step 7: UI Schema Field Alignment
- Update card and modal field references:
  - Guardian name: `c.guardianName` (fallback: `c.secondaryGuardians?.[0]?.name || 'Guardian'`).
  - Guardian phone: `c.guardianPhone` (fallback: `c.emergencyPhone || 'N/A'`).
  - Authorized pickups count: `c.pickups?.length ?? 0`.
  - Society name: `currentUser?.societyName || 'Society Administration'`.

---

## 3. Detailed Implementation Blueprint: Perimeter Gate Scanner Alignment

### Step 1: Differentiate Verification Permissions
- In [`ChildGateScannerPage.tsx#L47-L50`](file:///d:/AAZIRA/AARIZO/src/pages/dashboard/security/ChildGateScannerPage.tsx#L47-L50):
  ```typescript
  const userRole = (currentUser?.role || '').toLowerCase();
  const isAuthorizedRole = ['guard', 'secretary', 'committee', 'admin'].includes(userRole);
  const canVerifyPass = ['guard', 'admin'].includes(userRole);
  ```

### Step 2: Scanner UI Guard Disablement
- In the scan submit form:
  ```tsx
  <button
    type="submit"
    disabled={isVerifying || !qrInput.trim() || !canVerifyPass}
    title={!canVerifyPass ? 'Gate clearance verification requires Guard or Admin role' : undefined}
    className={...}
  >
    <Scan size={15} /> {isVerifying ? 'Verifying...' : 'Scan Pass'}
  </button>
  ```
- If `!canVerifyPass`, display an informational banner below the form:
  ```tsx
  {!canVerifyPass && (
    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 p-2 rounded-lg">
      ℹ View-only mode: You are logged in with role &quot;{currentUser?.role}&quot;. Verifying gate passes and clearing exits is restricted to Security Guard and Admin personnel.
    </p>
  )}
  ```

---

## 4. Rollback & Safety Strategy
1. **Zero Breaking Changes to Existing Hooks:**
   - Both `useChildSafetyRealtime` and `useSecurityChildSafetyRealtime` contracts remain untouched.
   - `realtimeService` remains untouched.
2. **Backward Compatibility:**
   - No database migrations or schema adjustments are needed.
3. **Rollback Plan:**
   - Should UI issues occur, reverting `AdminChildSafetyPage.tsx` and `ChildGateScannerPage.tsx` to git HEAD immediately restores baseline state.

