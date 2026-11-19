// =============================================================================
// AARIZO — ISSUE-06 Phase B.2.3 (Phase 4.5):
// Resident Child Safety Alerts & SOS History Section
//
// Authoritative invariants:
// - Backed strictly by canonical `childSafetyService.listAlerts()` (GET /api/children/alerts).
// - Formatted via approved Phase 4.1 pure helper `formatSafetyAlertDisplay()`.
// - Strictly READ-ONLY for `resident` role: ZERO Acknowledge or Resolve controls!
// - Displays live status badges: ACTIVE, ACKNOWLEDGED, RESOLVED, FALSE_ALARM.
// - Shows responder name and acknowledgment timestamp when acknowledged.
// - Shows resolver name and resolution notes when resolved.
// - Monotonic request guards + session-key reset prevent stale/cross-session leaks.
// - Zero localStorage/sessionStorage persistence.
// =============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  History,
  Loader2,
  MapPin,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import type { UserProfile } from '../../auth/types';
import {
  childSafetyService,
  formatChildSafetyError,
  type FormattedChildSafetyError,
} from '../../../services/childSafetyService';
import type {
  ChildProfileDto,
  ChildSafetyAlertDto,
} from '../../../types/childSafety';
import {
  formatSafetyAlertDisplay,
  getResidentChildSafetyPermissions,
  parseTimestampMs,
  type SafetyAlertDisplayModel,
} from '../utils/childSafetyResidentHelpers';

export interface ResidentChildAlertsSectionProps {
  childrenList: ChildProfileDto[];
  selectedChildId?: string | null;
  currentUser: UserProfile | null;
  refreshNonce?: number;
  onTriggerSosRequested?: (childId?: string) => void;
  onAlertMutated?: () => void | Promise<void>;
}

export interface ResidentChildAlertsController {
  alerts: ChildSafetyAlertDto[];
  activeAlerts: SafetyAlertDisplayModel[];
  pastAlerts: SafetyAlertDisplayModel[];
  isLoading: boolean;
  loadError: FormattedChildSafetyError | null;
  isPastAlertsOpen: boolean;
  filterBySelectedChild: boolean;
  permissions: ReturnType<typeof getResidentChildSafetyPermissions>;
  togglePastAlerts: () => void;
  setFilterBySelectedChild: (filter: boolean) => void;
  loadAlerts: (options?: { silent?: boolean }) => Promise<void>;
}

function getSessionKey(user: UserProfile | null): string {
  if (!user) return '';
  const uid = user.id || (user as { uid?: string }).uid || '';
  if (!uid) return '';
  const soc = typeof user.societyId === 'string' ? user.societyId.trim() : '';
  const role = typeof user.role === 'string' ? user.role.trim().toLowerCase() : '';
  return `${uid}:${soc}:${role}`;
}

function formatRelativeOrAbsoluteTime(iso: string | null | undefined): string {
  const ms = parseTimestampMs(iso);
  if (ms === null) return 'Unavailable';
  const diffSec = Math.floor((Date.now() - ms) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return 'Unavailable';
  }
}

export function useResidentChildAlerts(
  currentUser: UserProfile | null,
  selectedChildId?: string | null,
  refreshNonce = 0,
  onAlertMutated?: () => void | Promise<void>
): ResidentChildAlertsController {
  const sessionKey = getSessionKey(currentUser);
  const permissions = getResidentChildSafetyPermissions(currentUser?.role);

  const [alerts, setAlerts] = useState<ChildSafetyAlertDto[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<FormattedChildSafetyError | null>(null);
  const [isPastAlertsOpen, setIsPastAlertsOpen] = useState<boolean>(false);
  const [filterBySelectedChild, setFilterBySelectedChild] = useState<boolean>(false);

  const mountedRef = useRef<boolean>(true);
  const activeSessionKeyRef = useRef<string>(sessionKey);
  const alertsReqSeqRef = useRef<number>(0);
  const currentUserRef = useRef<UserProfile | null>(currentUser);
  const prevNonceRef = useRef<number>(refreshNonce);
  const onAlertMutatedRef = useRef(onAlertMutated);

  activeSessionKeyRef.current = sessionKey;
  currentUserRef.current = currentUser;
  onAlertMutatedRef.current = onAlertMutated;

  const purgeAllState = useCallback(() => {
    setAlerts([]);
    setIsLoading(false);
    setLoadError(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      alertsReqSeqRef.current += 1;
    };
  }, []);

  const loadAlerts = useCallback(
    async (options?: { silent?: boolean }): Promise<void> => {
      const reqSession = activeSessionKeyRef.current;
      const reqSeq = ++alertsReqSeqRef.current;
      const perms = getResidentChildSafetyPermissions(currentUserRef.current?.role);

      if (!reqSession || !perms.canViewAlerts) {
        if (mountedRef.current) {
          purgeAllState();
        }
        return;
      }

      if (!options?.silent) {
        setIsLoading(true);
      }
      setLoadError(null);

      try {
        const records = await childSafetyService.listAlerts();
        if (
          !mountedRef.current ||
          reqSeq !== alertsReqSeqRef.current ||
          activeSessionKeyRef.current !== reqSession
        ) {
          return;
        }

        setAlerts(records);
        setLoadError(null);
      } catch (err) {
        if (
          !mountedRef.current ||
          reqSeq !== alertsReqSeqRef.current ||
          activeSessionKeyRef.current !== reqSession
        ) {
          return;
        }

        const formatted = formatChildSafetyError(err);
        if (formatted.kind === 'UNAUTHORIZED') {
          purgeAllState();
        }
        setLoadError(formatted);
      } finally {
        if (
          mountedRef.current &&
          reqSeq === alertsReqSeqRef.current &&
          activeSessionKeyRef.current === reqSession
        ) {
          setIsLoading(false);
        }
      }
    },
    [purgeAllState]
  );

  // Initial load & session switch reset
  useEffect(() => {
    alertsReqSeqRef.current += 1;
    purgeAllState();

    if (sessionKey && getResidentChildSafetyPermissions(currentUserRef.current?.role).canViewAlerts) {
      void loadAlerts();
    }
  }, [sessionKey, loadAlerts, purgeAllState]);

  // Nonce increment triggers authoritative reload
  useEffect(() => {
    if (refreshNonce === prevNonceRef.current) return;
    prevNonceRef.current = refreshNonce;

    if (sessionKey && getResidentChildSafetyPermissions(currentUserRef.current?.role).canViewAlerts) {
      void loadAlerts({ silent: true });
    }
  }, [refreshNonce, sessionKey, loadAlerts]);

  const togglePastAlerts = useCallback(() => {
    setIsPastAlertsOpen((prev) => !prev);
  }, []);

  // Filter & format displays
  const normalizedChildId =
    typeof selectedChildId === 'string' && selectedChildId.trim().length > 0 ? selectedChildId.trim() : null;

  const relevantAlerts = useMemo(() => {
    if (!filterBySelectedChild || !normalizedChildId) {
      return alerts;
    }
    return alerts.filter((a) => a.childId === normalizedChildId);
  }, [alerts, filterBySelectedChild, normalizedChildId]);

  const formattedAlerts = useMemo(() => {
    return relevantAlerts.map(formatSafetyAlertDisplay);
  }, [relevantAlerts]);

  const activeAlerts = useMemo(() => {
    return formattedAlerts.filter((a) => a.isOpen);
  }, [formattedAlerts]);

  const pastAlerts = useMemo(() => {
    return formattedAlerts.filter((a) => !a.isOpen);
  }, [formattedAlerts]);

  return {
    alerts,
    activeAlerts,
    pastAlerts,
    isLoading,
    loadError,
    isPastAlertsOpen,
    filterBySelectedChild,
    permissions,
    togglePastAlerts,
    setFilterBySelectedChild,
    loadAlerts,
  };
}

export const ResidentChildAlertsSection: React.FC<ResidentChildAlertsSectionProps> = ({
  childrenList: _childrenList,
  selectedChildId,
  currentUser,
  refreshNonce = 0,
  onTriggerSosRequested,
  onAlertMutated,
}) => {
  const ctrl = useResidentChildAlerts(currentUser, selectedChildId, refreshNonce, onAlertMutated);

  if (
    !currentUser ||
    currentUser.role?.toLowerCase() !== 'resident' ||
    !ctrl.permissions.canViewAlerts
  ) {
    return null;
  }

  return (
    <div
      data-testid="resident-child-alerts-section"
      style={{
        background: '#FFFFFF',
        border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
        borderRadius: '16px',
        padding: '1.25rem',
        boxShadow: '0 2px 10px rgba(8, 59, 86, 0.04)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem',
          borderBottom: '1px solid var(--aarizo-border-soft, #E8F1F5)',
          paddingBottom: '0.85rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: '12px',
              background: ctrl.activeAlerts.length > 0 ? '#FEE2E2' : '#EFF6FF',
              color: ctrl.activeAlerts.length > 0 ? '#DC2626' : '#2563EB',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Radio size={20} className={ctrl.activeAlerts.length > 0 ? 'animate-pulse' : ''} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 900, color: 'var(--aarizo-navy, #083B56)' }}>
                Child Safety SOS & Live Alerts
              </h3>
              {ctrl.activeAlerts.length > 0 && (
                <span
                  data-testid="active-sos-count-badge"
                  style={{
                    background: '#DC2626',
                    color: '#FFFFFF',
                    fontSize: '0.625rem',
                    fontWeight: 900,
                    padding: '0.15rem 0.5rem',
                    borderRadius: '9999px',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  }}
                >
                  {ctrl.activeAlerts.length} Active
                </span>
              )}
            </div>
            <p style={{ margin: '0.15rem 0 0', fontSize: '0.75rem', color: '#64748B' }}>
              Live perimeter dispatch status, guard response tracking & resolution history
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            type="button"
            data-testid="refresh-child-alerts-btn"
            onClick={() => ctrl.loadAlerts()}
            disabled={ctrl.isLoading}
            style={{
              padding: '0.45rem 0.75rem',
              borderRadius: '10px',
              border: '1px solid #DCE8EF',
              background: '#FFFFFF',
              color: '#475569',
              fontWeight: 700,
              fontSize: '0.75rem',
              cursor: ctrl.isLoading ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
            }}
          >
            <RefreshCw size={13} className={ctrl.isLoading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>

          {ctrl.permissions.canTriggerChildSos && onTriggerSosRequested && (
            <button
              type="button"
              data-testid="trigger-child-sos-btn"
              onClick={() => onTriggerSosRequested(selectedChildId || undefined)}
              style={{
                padding: '0.45rem 0.85rem',
                borderRadius: '10px',
                border: 'none',
                background: 'linear-gradient(135deg, #DC2626 0%, #B91C1C 100%)',
                color: '#FFFFFF',
                fontWeight: 900,
                fontSize: '0.75rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                boxShadow: '0 2px 8px rgba(220, 38, 38, 0.25)',
              }}
            >
              <ShieldAlert size={14} />
              <span>Report Missing / SOS</span>
            </button>
          )}
        </div>
      </div>

      {/* Error Banner */}
      {ctrl.loadError && (
        <div
          role="alert"
          data-testid="child-alerts-error-banner"
          style={{
            background: '#FEF2F2',
            border: '1px solid #FECACA',
            borderRadius: '12px',
            padding: '0.75rem 1rem',
            color: '#991B1B',
            fontSize: '0.8rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertCircle size={16} color="#DC2626" style={{ flexShrink: 0 }} />
            <div>
              <strong>{ctrl.loadError.title}: </strong>
              <span>{ctrl.loadError.message}</span>
            </div>
          </div>
          {ctrl.loadError.isRetryable && (
            <button
              type="button"
              onClick={() => ctrl.loadAlerts()}
              style={{
                padding: '0.35rem 0.65rem',
                borderRadius: '8px',
                border: '1px solid #FCA5A5',
                background: '#FFFFFF',
                color: '#991B1B',
                fontWeight: 800,
                fontSize: '0.72rem',
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Loading Indicator */}
      {ctrl.isLoading && ctrl.alerts.length === 0 && (
        <div
          data-testid="child-alerts-loading"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            padding: '2rem 1rem',
            color: '#64748B',
            fontSize: '0.85rem',
          }}
        >
          <Loader2 size={18} className="animate-spin" />
          <span>Loading safety alerts...</span>
        </div>
      )}

      {/* 1. Active Alerts (High Visibility) */}
      {ctrl.activeAlerts.length > 0 && (
        <div data-testid="active-alerts-container" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#B91C1C', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Active Emergencies Awaiting Resolution ({ctrl.activeAlerts.length})
          </div>

          {ctrl.activeAlerts.map((alert) => {
            const isAcknowledged = alert.status === 'ACKNOWLEDGED';
            const cardBg = isAcknowledged ? '#FFFBEB' : '#FEF2F2';
            const cardBorder = isAcknowledged ? '#FDE68A' : '#FECDD3';
            const badgeBg = isAcknowledged ? '#F59E0B' : '#DC2626';

            return (
              <div
                key={alert.id}
                data-testid={`active-alert-card-${alert.id}`}
                style={{
                  background: cardBg,
                  border: `1.5px solid ${cardBorder}`,
                  borderRadius: '14px',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                  boxShadow: isAcknowledged ? 'none' : '0 4px 14px rgba(220, 38, 38, 0.12)',
                }}
              >
                {/* Status + Type Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span
                      data-testid={`alert-status-badge-${alert.id}`}
                      style={{
                        background: badgeBg,
                        color: '#FFFFFF',
                        fontWeight: 900,
                        fontSize: '0.68rem',
                        padding: '0.2rem 0.6rem',
                        borderRadius: '9999px',
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: '#FFFFFF',
                          display: 'inline-block',
                        }}
                        className={!isAcknowledged ? 'animate-ping' : ''}
                      />
                      {alert.statusLabel}
                    </span>
                    <strong style={{ fontSize: '0.9rem', color: '#083B56' }}>
                      {alert.childName} (Flat {alert.flatNumber})
                    </strong>
                  </div>

                  <span style={{ fontSize: '0.72rem', color: '#64748B', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Clock size={12} />
                    <span>Reported {formatRelativeOrAbsoluteTime(alert.createdAt)}</span>
                  </span>
                </div>

                {/* Alert Details */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem', fontSize: '0.78rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#334155' }}>
                    <MapPin size={14} color="#DC2626" style={{ flexShrink: 0 }} />
                    <span>
                      Location: <strong>{alert.location}</strong>
                    </span>
                  </div>
                  <div style={{ color: '#475569' }}>
                    Alert Type: <strong>{alert.alertTypeLabel}</strong> · Severity: <strong>{alert.severityLabel}</strong>
                  </div>
                </div>

                {alert.lastSeenDetails && (
                  <div
                    style={{
                      background: '#FFFFFF',
                      border: '1px solid #E2E8F0',
                      borderRadius: '8px',
                      padding: '0.5rem 0.75rem',
                      fontSize: '0.75rem',
                      color: '#334155',
                    }}
                  >
                    <strong>Last Seen Details:</strong> {alert.lastSeenDetails}
                  </div>
                )}

                {/* Responder Feedback */}
                {isAcknowledged && alert.acknowledgedByName && (
                  <div
                    data-testid={`alert-ack-info-${alert.id}`}
                    style={{
                      background: '#ECFDF5',
                      border: '1px solid #A7F3D0',
                      borderRadius: '8px',
                      padding: '0.45rem 0.75rem',
                      fontSize: '0.74rem',
                      color: '#065F46',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                    }}
                  >
                    <UserCheck size={14} color="#059669" />
                    <span>
                      Acknowledged by <strong>{alert.acknowledgedByName}</strong> ({formatRelativeOrAbsoluteTime(alert.acknowledgedAt)}). Patrol in progress.
                    </span>
                  </div>
                )}

                {/* Explanatory note confirming read-only nature for residents */}
                <div style={{ fontSize: '0.68rem', color: '#64748B', lineHeight: 1.4, borderTop: '1px dashed #E2E8F0', paddingTop: '0.4rem' }}>
                  Gate barriers and guard terminals are actively alerted. Society security staff and administrative
                  controllers manage incident resolution. Contact Main Gate for immediate updates.
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 2. Empty State (when no active alerts) */}
      {!ctrl.isLoading && ctrl.activeAlerts.length === 0 && (
        <div
          data-testid="no-active-alerts-card"
          style={{
            background: '#F8FAFC',
            border: '1px solid #E2E8F0',
            borderRadius: '12px',
            padding: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.85rem',
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: '10px',
              background: '#ECFDF5',
              border: '1px solid #A7F3D0',
              color: '#059669',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <ShieldCheck size={22} />
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#083B56' }}>
              No Active Child Safety Emergencies
            </div>
            <div style={{ fontSize: '0.74rem', color: '#64748B', marginTop: '0.15rem' }}>
              All registered children are marked safe on premises. Click &quot;Report Missing / SOS&quot; above to broadcast an
              immediate gate alarm if a child is lost or vulnerable.
            </div>
          </div>
        </div>
      )}

      {/* 3. Past / Resolved Alerts Collapsible Toggle */}
      {ctrl.pastAlerts.length > 0 && (
        <div style={{ borderTop: '1px solid var(--aarizo-border-soft, #E8F1F5)', paddingTop: '0.75rem' }}>
          <button
            type="button"
            data-testid="toggle-past-alerts-btn"
            onClick={ctrl.togglePastAlerts}
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'none',
              border: 'none',
              padding: '0.35rem 0',
              cursor: 'pointer',
              color: '#475569',
              fontWeight: 700,
              fontSize: '0.78rem',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <History size={14} />
              <span>Past Resolved Alerts ({ctrl.pastAlerts.length})</span>
            </span>
            {ctrl.isPastAlertsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          {ctrl.isPastAlertsOpen && (
            <div
              data-testid="past-alerts-container"
              style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginTop: '0.75rem' }}
            >
              {ctrl.pastAlerts.map((alert) => {
                const isFalseAlarm = alert.status === 'FALSE_ALARM';
                const badgeColor = isFalseAlarm ? '#64748B' : '#059669';

                return (
                  <div
                    key={alert.id}
                    data-testid={`past-alert-card-${alert.id}`}
                    style={{
                      background: '#F8FAFC',
                      border: '1px solid #E2E8F0',
                      borderRadius: '12px',
                      padding: '0.75rem 0.9rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.4rem',
                      fontSize: '0.75rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span
                          style={{
                            background: badgeColor,
                            color: '#FFFFFF',
                            fontSize: '0.625rem',
                            fontWeight: 900,
                            padding: '0.15rem 0.45rem',
                            borderRadius: '9999px',
                            textTransform: 'uppercase',
                          }}
                        >
                          {alert.statusLabel}
                        </span>
                        <strong style={{ color: '#083B56' }}>{alert.childName}</strong>
                        <span style={{ color: '#64748B' }}>· {alert.alertTypeLabel}</span>
                      </div>
                      <span style={{ color: '#94A3B8', fontSize: '0.7rem' }}>
                        {formatRelativeOrAbsoluteTime(alert.createdAt)}
                      </span>
                    </div>

                    <div style={{ color: '#475569' }}>
                      Location: <strong>{alert.location}</strong>
                    </div>

                    {alert.resolvedByName && (
                      <div style={{ color: '#065F46', background: '#ECFDF5', padding: '0.35rem 0.55rem', borderRadius: '6px' }}>
                        Resolved by <strong>{alert.resolvedByName}</strong>
                        {alert.resolvedAt ? ` (${formatRelativeOrAbsoluteTime(alert.resolvedAt)})` : ''}:{' '}
                        <span>{alert.resolutionNotes || 'Incident resolved cleanly on site.'}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
