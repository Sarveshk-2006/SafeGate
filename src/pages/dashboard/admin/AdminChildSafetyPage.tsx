import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { childSafetyService } from '../../../services/childSafetyService';
import { useChildSafetyRealtime } from '../../../hooks/useChildSafetyRealtime';
import { realtimeService } from '../../../services/realtimeService';
import type { RealtimeConnectionStatus } from '../../../types/realtime';
import type {
  ChildProfileDto,
  ChildExitLogDto,
  ChildSafetyAlertDto,
  ChildAlertResolveStatusDto,
} from '../../../types/childSafety';
import {
  ShieldCheck,
  ShieldAlert,
  Search,
  ArrowLeft,
  Eye,
  RefreshCw,
  AlertTriangle,
  Loader2,
  Lock,
} from 'lucide-react';
import { DataTable } from '../../../components/ui/DataTable';
import type { Column } from '../../../components/ui/DataTable';
import { MobileDataCard } from '../../../components/ui/MobileDataCard';
import { Modal } from '../../../components/ui/Modal';

export interface AdminChildSafetyPageProps {
  initialChildren?: ChildProfileDto[];
  initialLogs?: ChildExitLogDto[];
  initialAlerts?: ChildSafetyAlertDto[];
  initialLoading?: boolean;
  initialTab?: 'ALL' | 'INSIDE' | 'LOGS' | 'ALERTS';
}

export const AdminChildSafetyPage: React.FC<AdminChildSafetyPageProps> = ({
  initialChildren = [],
  initialLogs = [],
  initialAlerts = [],
  initialLoading,
  initialTab = 'ALL',
}) => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const societyId = currentUser?.societyId || '';
  const userRole = (currentUser?.role || '').toLowerCase();
  const isAuthorizedRole = ['admin', 'secretary', 'committee'].includes(userRole);
  const canManageAlerts = ['admin', 'secretary'].includes(userRole);
  const societyName = (currentUser as any)?.societyName || 'Society';

  const isMountedRef = useRef<boolean>(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [children, setChildren] = useState<ChildProfileDto[]>(initialChildren);
  const [pickupLogs, setPickupLogs] = useState<ChildExitLogDto[]>(initialLogs);
  const [safetyAlerts, setSafetyAlerts] = useState<ChildSafetyAlertDto[]>(initialAlerts);
  const [isLoading, setIsLoading] = useState<boolean>(
    initialLoading !== undefined
      ? initialLoading
      : (initialChildren.length === 0 && initialLogs.length === 0 && initialAlerts.length === 0)
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'ALL' | 'INSIDE' | 'LOGS' | 'ALERTS'>(initialTab);
  const [selectedChild, setSelectedChild] = useState<ChildProfileDto | null>(null);

  // Alert Resolution State
  const [resolvingAlert, setResolvingAlert] = useState<ChildSafetyAlertDto | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [resolutionStatus, setResolutionStatus] = useState<ChildAlertResolveStatusDto>('RESOLVED');
  const [isResolving, setIsResolving] = useState<boolean>(false);
  const [resolutionError, setResolutionError] = useState<string | null>(null);

  // Realtime Connection State
  const [connectionStatus, setConnectionStatus] = useState<RealtimeConnectionStatus['state']>('CONNECTED');

  const loadData = useCallback(async () => {
    if (!currentUser || !societyId || !isAuthorizedRole) {
      setIsLoading(false);
      return;
    }

    try {
      setLoadError(null);
      const [childrenRes, logsRes, alertsRes] = await Promise.allSettled([
        childSafetyService.listChildren(),
        childSafetyService.listExitLogs({ limit: 50 }),
        childSafetyService.listAlerts({ status: 'ACTIVE' }),
      ]);

      if (!isMountedRef.current) return;

      if (childrenRes.status === 'fulfilled') {
        setChildren(childrenRes.value);
      } else {
        console.error('[AdminChildSafetyPage] Failed to fetch children:', childrenRes.reason);
      }

      if (logsRes.status === 'fulfilled') {
        setPickupLogs(logsRes.value);
      } else {
        console.error('[AdminChildSafetyPage] Failed to fetch exit logs:', logsRes.reason);
      }

      if (alertsRes.status === 'fulfilled') {
        setSafetyAlerts(alertsRes.value);
      } else {
        console.error('[AdminChildSafetyPage] Failed to fetch alerts:', alertsRes.reason);
      }

      if (
        childrenRes.status === 'rejected' &&
        logsRes.status === 'rejected' &&
        alertsRes.status === 'rejected'
      ) {
        setLoadError('Failed to load child safety data from server.');
      }
    } catch (err: unknown) {
      if (isMountedRef.current) {
        console.error('[AdminChildSafetyPage] Unexpected load error:', err);
        setLoadError('An unexpected error occurred while loading authoritative data.');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [currentUser, societyId, isAuthorizedRole]);

  // Coalesced Debounced Refresh for Realtime Events
  const scheduleCoalescedRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        loadData();
      }
    }, 50);
  }, [loadData]);

  // Subscribes across all 14 Child Safety SSE topics
  useChildSafetyRealtime({
    enabled: isAuthorizedRole && Boolean(societyId),
    onProfilesChange: scheduleCoalescedRefresh,
    onPickupsChange: scheduleCoalescedRefresh,
    onPassesChange: scheduleCoalescedRefresh,
    onExitLogsChange: scheduleCoalescedRefresh,
    onAlertsChange: scheduleCoalescedRefresh,
    onReconnect: () => {
      if (isMountedRef.current) {
        loadData();
      }
    },
  });

  useEffect(() => {
    isMountedRef.current = true;
    loadData();

    const unsub = realtimeService.subscribeToStatus((status) => {
      if (isMountedRef.current) {
        setConnectionStatus(status.state);
      }
    });

    return () => {
      isMountedRef.current = false;
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      unsub();
    };
  }, [loadData]);

  const handleOpenResolveModal = (alert: ChildSafetyAlertDto) => {
    if (!canManageAlerts) return;
    setResolvingAlert(alert);
    setResolutionNotes('');
    setResolutionStatus('RESOLVED');
    setResolutionError(null);
  };

  const handleConfirmResolve = async () => {
    if (!resolvingAlert || isResolving) return;
    if (!resolutionNotes.trim()) {
      setResolutionError('Resolution notes are strictly required to resolve a safety alert.');
      return;
    }

    setIsResolving(true);
    setResolutionError(null);

    try {
      await childSafetyService.resolveAlert(resolvingAlert.id, {
        resolutionNotes: resolutionNotes.trim(),
        status: resolutionStatus,
      });

      if (!isMountedRef.current) return;
      setResolvingAlert(null);
      await loadData();
    } catch (err: unknown) {
      if (isMountedRef.current) {
        console.error('[AdminChildSafetyPage] Failed to resolve alert:', err);
        setResolutionError(
          err instanceof Error ? err.message : 'Failed to resolve alert. Please try again.'
        );
      }
    } finally {
      if (isMountedRef.current) {
        setIsResolving(false);
      }
    }
  };

  // Defense-in-depth: Unauthorized Role Check
  if (!currentUser || !isAuthorizedRole) {
    return (
      <div
        data-testid="admin-child-safety-access-denied"
        style={{
          minHeight: '100%',
          background: 'var(--aarizo-page, #F7FBFE)',
          padding: '2rem 1rem',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            maxWidth: '480px',
            background: '#ffffff',
            borderRadius: '16px',
            border: '1px solid var(--aarizo-border, #DCE8EF)',
            padding: '2rem',
            textAlign: 'center',
            boxShadow: '0 4px 16px rgba(8, 59, 86, 0.06)',
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: '#FEE2E2',
              color: '#DC2626',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1rem',
            }}
          >
            <Lock size={28} />
          </div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--aarizo-navy, #083B56)', margin: '0 0 0.5rem' }}>
            Access Restricted
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--aarizo-text-secondary, #657785)', margin: '0 0 1.5rem' }}>
            Society Admin or Committee authorization is required to access the Child Safety Desk.
          </p>
          <button
            onClick={() => navigate(-1)}
            style={{
              padding: '0.625rem 1.25rem',
              borderRadius: '10px',
              background: 'var(--aarizo-navy, #083B56)',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '0.875rem',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  // Missing Tenant Context Check
  if (!societyId) {
    return (
      <div
        data-testid="admin-child-safety-no-society"
        style={{
          minHeight: '100%',
          background: 'var(--aarizo-page, #F7FBFE)',
          padding: '2rem 1rem',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            maxWidth: '480px',
            background: '#ffffff',
            borderRadius: '16px',
            border: '1px solid var(--aarizo-border, #DCE8EF)',
            padding: '2rem',
            textAlign: 'center',
            boxShadow: '0 4px 16px rgba(8, 59, 86, 0.06)',
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: '#FEF3C7',
              color: '#D97706',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1rem',
            }}
          >
            <AlertTriangle size={28} />
          </div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--aarizo-navy, #083B56)', margin: '0 0 0.5rem' }}>
            Society Context Required
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--aarizo-text-secondary, #657785)', margin: '0 0 1.5rem' }}>
            No active society context was found. Please select or join a society to manage child safety.
          </p>
        </div>
      </div>
    );
  }

  const activeAlerts = safetyAlerts.filter((a) => a.status === 'ACTIVE');

  const filteredChildren = children.filter((c) => {
    const matchesTab =
      activeTab === 'ALL' ||
      activeTab === 'LOGS' ||
      activeTab === 'ALERTS' ||
      (activeTab === 'INSIDE' && c.status === 'SAFE');

    const matchesSearch =
      c.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.flatNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.guardianName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.guardianPhone.includes(searchQuery);

    return matchesTab && matchesSearch;
  });

  const logColumns: Column<ChildExitLogDto>[] = [
    { key: 'childName', header: 'Child Name' },
    { key: 'flatNumber', header: 'Flat' },
    { key: 'pickupPersonName', header: 'Caretaker / Escort' },
    { key: 'gateId', header: 'Gate' },
    { key: 'timestamp', header: 'Time', render: (l) => new Date(l.timestamp).toLocaleString() },
    {
      key: 'outcome',
      header: 'Outcome',
      render: (l) => (
        <span
          className={`px-2.5 py-1 text-xs rounded-full font-semibold ${
            l.outcome === 'ALLOWED' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
          }`}
        >
          {l.outcome}
        </span>
      ),
    },
  ];

  return (
    <div
      data-testid="admin-child-safety-page"
      style={{ minHeight: '100%', background: 'var(--aarizo-page, #F7FBFE)', paddingBottom: '2rem' }}
    >
      {/* ── Subheader with Back Button & Breadcrumbs ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '1rem 1rem 0.75rem',
          background: 'var(--aarizo-card-blue, #F4FAFE)',
          borderBottom: '1px solid var(--aarizo-border, #DCE8EF)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
          <button
            onClick={() => navigate(-1)}
            aria-label="Back"
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: '#ffffff',
              border: '1px solid var(--aarizo-border, #DCE8EF)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--aarizo-navy, #083B56)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 800, color: 'var(--aarizo-navy, #083B56)', margin: 0, letterSpacing: '-0.02em' }}>
              Child Safety Desk
            </h2>
            <p style={{ fontSize: '0.6875rem', color: 'var(--aarizo-text-secondary, #657785)', margin: 0 }}>
              {societyName} · {children.length} registered children &amp; passes
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {/* Realtime Status Indicator */}
          <div
            data-testid="connection-status-pill"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.45rem 0.875rem',
              borderRadius: '10px',
              background: connectionStatus === 'CONNECTED' ? 'var(--aarizo-light-blue, #EAF6FC)' : '#FEF2F2',
              border: `1px solid ${connectionStatus === 'CONNECTED' ? 'var(--aarizo-border, #DCE8EF)' : '#FECACA'}`,
              color: connectionStatus === 'CONNECTED' ? 'var(--aarizo-navy, #083B56)' : '#DC2626',
              fontWeight: 800,
              fontSize: '0.75rem',
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: connectionStatus === 'CONNECTED' ? '#10B981' : '#EF4444',
              }}
            />
            {connectionStatus === 'CONNECTED' ? 'Live Connected' : 'Offline'}
          </div>

          <button
            onClick={loadData}
            disabled={isLoading}
            title="Refresh Data"
            style={{
              padding: '0.45rem 0.65rem',
              borderRadius: '10px',
              background: '#ffffff',
              border: '1px solid var(--aarizo-border, #DCE8EF)',
              color: 'var(--aarizo-navy, #083B56)',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Active Missing Safety Alert Broadcast Banner ── */}
      {activeAlerts.length > 0 && (
        <div className="max-w-7xl mx-auto w-full px-4 pt-3">
          <div
            data-testid="active-alerts-banner"
            style={{
              background: '#DC2626',
              color: '#ffffff',
              borderRadius: '12px',
              padding: '0.75rem 1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              boxShadow: '0 4px 12px rgba(220, 38, 38, 0.25)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 800, fontSize: '0.875rem' }}>
              <ShieldAlert size={20} color="#ffffff" />
              <span>ACTIVE MISSING CHILD ALERT BROADCAST ({activeAlerts.length})</span>
            </div>
            {activeAlerts.map((alert) => (
              <div
                key={alert.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'rgba(255, 255, 255, 0.1)',
                  borderRadius: '8px',
                  padding: '0.5rem 0.75rem',
                }}
              >
                <div>
                  <p style={{ fontSize: '0.8125rem', fontWeight: 700, margin: 0 }}>
                    {alert.childName} · Flat {alert.flatNumber} · Location: {alert.location}
                  </p>
                  {alert.description && (
                    <p style={{ fontSize: '0.75rem', margin: '0.2rem 0 0', opacity: 0.9 }}>
                      {alert.description}
                    </p>
                  )}
                </div>
                {canManageAlerts ? (
                  <button
                    data-testid={`resolve-alert-btn-${alert.id}`}
                    onClick={() => handleOpenResolveModal(alert)}
                    style={{
                      background: '#ffffff',
                      color: '#DC2626',
                      fontWeight: 800,
                      border: 'none',
                      padding: '0.35rem 0.75rem',
                      borderRadius: '8px',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    Resolve Alert
                  </button>
                ) : (
                  <span style={{ fontSize: '0.6875rem', opacity: 0.85, fontStyle: 'italic' }}>
                    View-only (Admin/Secretary required)
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Search Bar & Filter Strip ── */}
      <div className="max-w-7xl mx-auto w-full" style={{ padding: '1rem 1rem 0.5rem' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.625rem',
            background: '#ffffff',
            border: '1px solid var(--aarizo-border, #DCE8EF)',
            borderRadius: '12px',
            padding: '0 0.875rem',
            height: '46px',
            boxShadow: '0 1px 4px rgba(8, 59, 86, 0.04)',
          }}
        >
          <Search size={18} color="var(--aarizo-text-secondary, #657785)" />
          <input
            data-testid="search-input"
            type="text"
            placeholder="Search child name, flat, guardian, or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              fontSize: '0.8125rem',
              color: 'var(--aarizo-text, #203746)',
              background: 'transparent',
              minHeight: 'auto',
            }}
          />
        </div>

        {/* Tab Filter Pills */}
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', overflowX: 'auto', scrollbarWidth: 'none' }}>
          {[
            { key: 'ALL', label: `All Children (${children.length})`, testId: 'tab-all' },
            { key: 'INSIDE', label: `Inside Society (${children.filter((c) => c.status === 'SAFE').length})`, testId: 'tab-inside' },
            { key: 'LOGS', label: `Gate Pickups (${pickupLogs.length})`, testId: 'tab-logs' },
            { key: 'ALERTS', label: `Active Alerts (${activeAlerts.length})`, testId: 'tab-alerts' },
          ].map((tab) => (
            <button
              key={tab.key}
              data-testid={tab.testId}
              onClick={() => setActiveTab(tab.key as any)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.375rem',
                background: activeTab === tab.key ? 'var(--aarizo-coral, #F06543)' : '#ffffff',
                border: '1px solid var(--aarizo-border, #DCE8EF)',
                borderRadius: '10px',
                padding: '0.4rem 0.75rem',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: activeTab === tab.key ? '#ffffff' : 'var(--aarizo-text, #203746)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <ShieldCheck size={14} color={activeTab === tab.key ? '#ffffff' : 'var(--aarizo-coral, #F06543)'} />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Loading Spinner State ── */}
      {isLoading && (
        <div data-testid="admin-child-safety-loading" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <Loader2 size={32} className="animate-spin" style={{ color: 'var(--aarizo-navy, #083B56)', margin: '0 auto 0.5rem' }} />
          <p style={{ fontSize: '0.8125rem', color: 'var(--aarizo-text-secondary, #657785)', margin: 0 }}>
            Loading authoritative child safety data...
          </p>
        </div>
      )}

      {/* ── Error State Banner ── */}
      {loadError && !isLoading && (
        <div className="max-w-7xl mx-auto w-full px-4 pt-2">
          <div
            data-testid="admin-child-safety-error"
            style={{
              background: '#FEE2E2',
              border: '1px solid #FECACA',
              borderRadius: '12px',
              padding: '0.75rem 1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              color: '#991B1B',
              fontSize: '0.8125rem',
            }}
          >
            <span>{loadError}</span>
            <button
              onClick={loadData}
              style={{
                background: '#991B1B',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                padding: '0.25rem 0.5rem',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* ── Count Heading ── */}
      {!isLoading && (
        <div className="max-w-7xl mx-auto w-full" style={{ padding: '0.5rem 1rem 0.25rem' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--aarizo-text-secondary, #657785)' }}>
            {activeTab === 'LOGS' ? pickupLogs.length : filteredChildren.length} items found
          </span>
        </div>
      )}

      {/* ── Registered Children List ── */}
      {!isLoading && activeTab !== 'LOGS' && (
        <div className="max-w-7xl mx-auto w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-3 sm:p-4">
          {filteredChildren.length === 0 ? (
            <div
              data-testid="no-children-message"
              style={{
                gridColumn: '1 / -1',
                background: '#ffffff',
                borderRadius: '16px',
                border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
                padding: '2.5rem 1rem',
                textAlign: 'center',
              }}
            >
              <ShieldCheck size={36} color="var(--aarizo-text-secondary, #657785)" style={{ margin: '0 auto 0.5rem' }} />
              <p style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--aarizo-navy, #083B56)', margin: '0 0 0.25rem' }}>
                No child profiles found
              </p>
              <p style={{ fontSize: '0.75rem', color: 'var(--aarizo-text-secondary, #657785)', margin: 0 }}>
                {searchQuery ? 'Try adjusting your search query.' : 'No children registered in this category.'}
              </p>
            </div>
          ) : (
            filteredChildren.map((c) => (
              <div
                key={c.id}
                data-testid={`child-card-${c.id}`}
                style={{
                  background: '#ffffff',
                  border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
                  borderRadius: '16px',
                  padding: '0.875rem 1rem',
                  boxShadow: '0 2px 10px rgba(8, 59, 86, 0.05)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '0.625rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: '50%',
                        background: 'var(--aarizo-pale-blue, #F4FAFE)',
                        border: '1px solid var(--aarizo-border, #DCE8EF)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--aarizo-navy, #083B56)',
                        fontWeight: 800,
                        fontSize: '1rem',
                        flexShrink: 0,
                      }}
                    >
                      {c.fullName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--aarizo-text, #203746)' }}>
                        {c.fullName}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--aarizo-text-secondary, #657785)', marginTop: '0.125rem' }}>
                        ⌂ Flat: {c.flatNumber} · DOB: {c.dateOfBirth || 'N/A'}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--aarizo-text-secondary, #657785)' }}>
                        👤 {c.guardianName} ({c.guardianPhone})
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--aarizo-text-secondary, #657785)' }}>
                        🛡️ {c.pickups?.length || 0} Authorized Caretaker(s)
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.75rem' }}>
                    <span
                      style={{
                        fontSize: '0.625rem',
                        fontWeight: 800,
                        color:
                          c.status === 'SAFE'
                            ? '#059669'
                            : c.status === 'OUT_OF_SOCIETY'
                            ? '#D97706'
                            : c.status === 'MISSING'
                            ? '#DC2626'
                            : '#64748B',
                        background:
                          c.status === 'SAFE'
                            ? '#ECFDF5'
                            : c.status === 'OUT_OF_SOCIETY'
                            ? '#FFFBEB'
                            : c.status === 'MISSING'
                            ? '#FEF2F2'
                            : '#F1F5F9',
                        border: `1px solid ${
                          c.status === 'SAFE'
                            ? '#A7F3D0'
                            : c.status === 'OUT_OF_SOCIETY'
                            ? '#FDE68A'
                            : c.status === 'MISSING'
                            ? '#FECACA'
                            : '#E2E8F0'
                        }`,
                        padding: '0.2rem 0.5rem',
                        borderRadius: '9999px',
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {c.status}
                    </span>

                    <button
                      data-testid={`view-child-btn-${c.id}`}
                      onClick={() => setSelectedChild(c)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        padding: '0.35rem 0.75rem',
                        borderRadius: '8px',
                        background: 'var(--aarizo-light-blue, #EAF6FC)',
                        border: '1px solid var(--aarizo-border, #DCE8EF)',
                        color: 'var(--aarizo-navy, #083B56)',
                        fontWeight: 700,
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                      }}
                    >
                      <Eye size={13} color="var(--aarizo-blue, #176B91)" />
                      <span>View</span>
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Gate Pickup Audit Logs ── */}
      {!isLoading && activeTab === 'LOGS' && (
        <div className="max-w-7xl mx-auto w-full p-4">
          <div className="bg-white p-4 md:p-6 rounded-2xl border border-slate-200/80 shadow-sm">
            <h2 className="text-sm font-extrabold text-slate-900 mb-3">Gate Pickup Audit Logs &amp; History</h2>
            <DataTable
              columns={logColumns}
              data={pickupLogs}
              keyExtractor={(l) => l.id}
              pageSize={10}
              mobileRender={(l) => (
                <MobileDataCard
                  title={l.childName}
                  subtitle={l.pickupPersonName}
                  status={
                    <span
                      className={`px-2 py-0.5 text-[0.65rem] rounded-full font-bold ${
                        l.outcome === 'ALLOWED' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {l.outcome}
                    </span>
                  }
                  attributes={[
                    { label: 'Flat', value: l.flatNumber },
                    { label: 'Time', value: new Date(l.timestamp).toLocaleString() },
                  ]}
                />
              )}
            />
          </div>
        </div>
      )}

      {/* ── Child Details Modal ── */}
      {selectedChild && (
        <Modal isOpen={!!selectedChild} onClose={() => setSelectedChild(null)} title={`Child Safety Pass: ${selectedChild.fullName}`}>
          <div className="space-y-4 text-slate-800">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-400 font-medium">Flat Code</span>
                <span className="font-bold text-[#083B56]">{selectedChild.flatNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-medium">Date of Birth</span>
                <span className="font-bold text-slate-800">{selectedChild.dateOfBirth || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-medium">Status</span>
                <span className="font-bold text-emerald-600">{selectedChild.status}</span>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Primary Guardian</h4>
              <div className="space-y-1.5 text-xs">
                <div className="p-2 bg-white rounded-lg border border-slate-200 flex justify-between">
                  <span className="font-bold text-slate-900">{selectedChild.guardianName}</span>
                  <span className="text-slate-600">📞 {selectedChild.guardianPhone}</span>
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Authorized Caretakers / Pickups</h4>
              <div className="space-y-1.5 text-xs">
                {!selectedChild.pickups || selectedChild.pickups.length === 0 ? (
                  <p className="text-slate-400 italic">No additional authorized pickup persons registered.</p>
                ) : (
                  selectedChild.pickups.map((p, idx) => (
                    <div key={idx} className="p-2 bg-emerald-50 border border-emerald-200 rounded-lg flex justify-between text-emerald-900">
                      <span className="font-bold">{p.name} ({p.relationship})</span>
                      <span>Status: {p.status}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button onClick={() => setSelectedChild(null)} className="px-4 py-2 bg-[#083B56] text-white text-xs font-bold rounded-xl">
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Alert Resolution Modal ── */}
      {resolvingAlert && (
        <Modal
          isOpen={!!resolvingAlert}
          onClose={() => !isResolving && setResolvingAlert(null)}
          title={`Resolve Alert: ${resolvingAlert.childName}`}
        >
          <div className="space-y-4 text-slate-800 text-xs">
            <div className="p-3 bg-red-50 rounded-xl border border-red-200 space-y-1.5 text-red-900">
              <div className="flex justify-between">
                <span className="font-semibold">Flat Number:</span>
                <span className="font-bold">{resolvingAlert.flatNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold">Last Reported Location:</span>
                <span className="font-bold">{resolvingAlert.location}</span>
              </div>
              {resolvingAlert.description && (
                <div>
                  <span className="font-semibold">Details: </span>
                  <span>{resolvingAlert.description}</span>
                </div>
              )}
            </div>

            {resolutionError && (
              <div
                data-testid="resolution-error"
                style={{
                  background: '#FEE2E2',
                  border: '1px solid #FECACA',
                  borderRadius: '8px',
                  padding: '0.5rem 0.75rem',
                  color: '#991B1B',
                  fontSize: '0.75rem',
                }}
              >
                {resolutionError}
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Resolution Outcome
              </label>
              <div className="flex gap-3">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="resolutionStatus"
                    value="RESOLVED"
                    checked={resolutionStatus === 'RESOLVED'}
                    onChange={() => setResolutionStatus('RESOLVED')}
                    disabled={isResolving}
                  />
                  <span>Mark Child Safe (RESOLVED)</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="resolutionStatus"
                    value="FALSE_ALARM"
                    checked={resolutionStatus === 'FALSE_ALARM'}
                    onChange={() => setResolutionStatus('FALSE_ALARM')}
                    disabled={isResolving}
                  />
                  <span>False Alarm (FALSE_ALARM)</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Resolution Notes <span className="text-red-500">*</span>
              </label>
              <textarea
                data-testid="resolution-notes-input"
                rows={3}
                placeholder="Describe how the incident was resolved or verified (mandatory, max 1000 chars)..."
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                maxLength={1000}
                disabled={isResolving}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  borderRadius: '8px',
                  border: '1px solid var(--aarizo-border, #DCE8EF)',
                  fontSize: '0.75rem',
                  outline: 'none',
                }}
              />
              <span className="text-[0.65rem] text-slate-400 block text-right">
                {resolutionNotes.length} / 1000
              </span>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                onClick={() => setResolvingAlert(null)}
                disabled={isResolving}
                className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                data-testid="confirm-resolve-button"
                onClick={handleConfirmResolve}
                disabled={isResolving || !resolutionNotes.trim()}
                style={{
                  background: isResolving || !resolutionNotes.trim() ? '#9CA3AF' : '#059669',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '0.75rem',
                  padding: '0.5rem 1rem',
                  borderRadius: '12px',
                  border: 'none',
                  cursor: isResolving || !resolutionNotes.trim() ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                }}
              >
                {isResolving && <Loader2 size={13} className="animate-spin" />}
                <span>{isResolving ? 'Resolving...' : 'Confirm Resolution'}</span>
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default AdminChildSafetyPage;
