# AARIZO — ISSUE-06 — PHASE B.2 — STEP 2.3 — PHASE 4.6.3.3.4
# SECURITY COMMAND HUB — REALTIME IMPLEMENTATION PLAN

**Repository:** `D:\AAZIRA\AARIZO`  
**Phase:** Phase B.2 / Step 2.3 / Subphase 4.6.3.3.4  
**Date:** November 19, 2026  
**Status:** IMPLEMENTATION BLUEPRINT (READ-ONLY PLANNING)  

---

## 1. Objective

Integrate canonical, authenticated realtime synchronization into `SafetyCommandHub.tsx` by:
1. Adopting the established `useSecurityChildSafetyRealtime` hook for the 8 authorized Child Safety security topics.
2. Subscribing to authorized general emergency topics (`EMERGENCY_ALERTS`, `EMERGENCY_INCIDENT_RESOLVED`, `EMERGENCY_INCIDENT_CREATED`) directly on `realtimeService`.
3. Rendering a live connection status badge (Connected, Reconnecting, Offline, Last Refreshed) in the Command Console.
4. Permanently retiring the obsolete, unverified `realTimeSync.subscribe` calls.
5. Preserving React 18 Strict Mode double-mount safety, zero memory leaks, and post-reconnect resynchronization.

---

## 2. Granular Step-by-Step Implementation Sequence

### Step 1: Import Canonical Realtime Dependencies
In `src/domains/safety/components/SafetyCommandHub.tsx`:
- Import `useSecurityChildSafetyRealtime` from `../../../hooks/useSecurityChildSafetyRealtime`.
- Import `realtimeService` from `../../../services/realtimeService`.
- Remove `import { realTimeSync } from '../../../services/realTimeSync';`.

### Step 2: Wire `useSecurityChildSafetyRealtime` in `SafetyCommandHub`
Call `useSecurityChildSafetyRealtime` inside `SafetyCommandHub`:
```typescript
  const {
    connectionStatus,
    isConnected,
    isReconnecting,
    isOffline,
  } = useSecurityChildSafetyRealtime({
    enabled: isStaffRole && Boolean(currentUser?.societyId),
    onAlertsChange: () => {
      if (canViewConsole) {
        void loadAuthoritativeAlerts();
      }
      if (canReadRoster && !isGuardRole && !isResidentRole) {
        void loadAuthoritativeChildren();
      }
    },
    onRefresh: async () => {
      if (canViewConsole) {
        await loadAuthoritativeAlerts();
      }
      if (canReadRoster && !isGuardRole && !isResidentRole) {
        await loadAuthoritativeChildren();
      }
    },
    onReconnect: () => {
      loadData();
    },
  });
```

### Step 3: Wire General Emergency Realtime Subscriptions
Attach direct listeners for general emergency topics onto `realtimeService` within a dedicated `useEffect`:
```typescript
  useEffect(() => {
    if (!isStaffRole || !currentUser?.societyId) return;

    const currentSocietyId = currentUser.societyId;

    const handleGeneralIncidentEvent = (msg: any) => {
      // Validate society scope
      const eventSocietyId = msg?.societyId || msg?.payload?.societyId;
      if (eventSocietyId && eventSocietyId !== currentSocietyId) return;

      if (canViewConsole) {
        void loadGeneralIncidents();
      }
    };

    const unsubAlerts = realtimeService.subscribe('EMERGENCY_ALERTS', handleGeneralIncidentEvent);
    const unsubResolved = realtimeService.subscribe('EMERGENCY_INCIDENT_RESOLVED', handleGeneralIncidentEvent);
    const unsubCreated = realtimeService.subscribe('EMERGENCY_INCIDENT_CREATED', handleGeneralIncidentEvent);

    return () => {
      unsubAlerts();
      unsubResolved();
      unsubCreated();
    };
  }, [isStaffRole, currentUser?.societyId, canViewConsole, loadGeneralIncidents]);
```

### Step 4: Add Realtime Status Pill to the Command Console Header
In `COMMAND_CONSOLE` header, insert a visual connectivity indicator next to the Refresh button:
```tsx
  {/* Realtime Connection Status Pill */}
  <div
    data-testid="realtime-status-pill"
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.35rem',
      padding: '0.35rem 0.65rem',
      borderRadius: '8px',
      fontSize: '0.7rem',
      fontWeight: 700,
      background: isConnected ? '#ECFDF5' : isReconnecting ? '#FFFBEB' : '#FEF2F2',
      border: `1px solid ${isConnected ? '#A7F3D0' : isReconnecting ? '#FDE68A' : '#FECACA'}`,
      color: isConnected ? '#059669' : isReconnecting ? '#D97706' : '#DC2626',
    }}
  >
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: isConnected ? '#10B981' : isReconnecting ? '#F59E0B' : '#EF4444',
      }}
    />
    <span>{isConnected ? 'LIVE' : isReconnecting ? 'RECONNECTING' : 'OFFLINE'}</span>
  </div>
```

### Step 5: Session Switch & Unmount Safety
Ensure that when `currentUser` changes or unmounts:
- Component state clears.
- All subscriptions unregister cleanly.
- `childSafetyService.clearInMemoryState()` is called if needed.

---

## 3. Structural Synthesis

- **BLOCKERS:** None.
- **SECURITY RISKS:** Unchecked event topics or cross-society events could trigger unnecessary re-renders or state pollution. Handled by society validation and topic allowlists in `useSecurityChildSafetyRealtime`.
- **REQUIRED IMPLEMENTATION:** Implement Steps 1–5 in `SafetyCommandHub.tsx`.
- **REQUIRED TESTS:** Complete test suite verifying SSE lifecycle, general emergency invalidation, topic isolation, and connection status UI.
- **OUT-OF-SCOPE ITEMS:** Modifying backend SSE router or `realtimeService` transport core.

