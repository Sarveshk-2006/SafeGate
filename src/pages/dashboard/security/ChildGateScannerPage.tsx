import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { childSafetyService } from '../../../services/childSafetyService';
import { useSecurityChildSafetyRealtime } from '../../../hooks/useSecurityChildSafetyRealtime';
import { MobileQRScanner } from '../../../components/ui/MobileQRScanner';
import type {
  ChildGatePassDto,
  ChildExitLogDto,
  ChildSafetyAlertDto,
} from '../../../types/childSafety';
import {
  QrCode,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  UserCheck,
  ArrowLeft,
  Scan,
  AlertTriangle,
  Camera,
} from 'lucide-react';

interface ScanOutcome {
  scanned: boolean;
  allowed: boolean;
  message: string;
  code?: string;
  childName?: string;
  flatNumber?: string;
  pickupPersonName?: string;
  pickupPersonPhone?: string | null;
  passCode?: string;
}

export interface ChildGateScannerPageProps {
  initialAlerts?: ChildSafetyAlertDto[];
  initialPasses?: ChildGatePassDto[];
  initialLogs?: ChildExitLogDto[];
}

export const ChildGateScannerPage: React.FC<ChildGateScannerPageProps> = ({
  initialAlerts = [],
  initialPasses = [],
  initialLogs = [],
}) => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const societyId = currentUser?.societyId || '';
  const userRole = (currentUser?.role || '').toLowerCase();
  const isAuthorizedRole = ['guard', 'secretary', 'committee', 'admin'].includes(userRole);
  const canVerifyPass = ['guard', 'admin'].includes(userRole);

  const isMountedRef = useRef<boolean>(true);
  const [qrInput, setQrInput] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);

  const [activeAlerts, setActiveAlerts] = useState<ChildSafetyAlertDto[]>(initialAlerts);
  const [activePasses, setActivePasses] = useState<ChildGatePassDto[]>(initialPasses);
  const [pickupLogs, setPickupLogs] = useState<ChildExitLogDto[]>(initialLogs);
  const [resolvingAlertId, setResolvingAlertId] = useState<string | null>(null);

  // Scan Validation Result
  const [scanResult, setScanResult] = useState<ScanOutcome | null>(null);

  // Track component mount status to avoid stale async state updates
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Load backend-authoritative gate data
  const loadData = useCallback(async () => {
    if (!currentUser || !societyId) return;
    try {
      const [alertsRes, passesRes, logsRes] = await Promise.allSettled([
        childSafetyService.listAlerts({ status: 'ACTIVE' }),
        childSafetyService.listGatePasses({ status: 'ACTIVE' }),
        childSafetyService.listExitLogs({ limit: 50 }),
      ]);

      if (!isMountedRef.current) return;

      if (alertsRes.status === 'fulfilled') {
        setActiveAlerts(alertsRes.value);
      }
      if (passesRes.status === 'fulfilled') {
        setActivePasses(passesRes.value);
      }
      if (logsRes.status === 'fulfilled') {
        setPickupLogs(logsRes.value);
      }
    } catch (err: unknown) {
      console.error('[ChildGateScannerPage] Failed to load authoritative gate data:', err);
    }
  }, [currentUser, societyId]);

  // Hook into canonical Security Child Safety realtime controller
  const { connectionStatus, isConnected, isReconnecting, isOffline } = useSecurityChildSafetyRealtime({
    enabled: isAuthorizedRole && Boolean(societyId),
    onRefresh: async () => {
      await loadData();
    },
  });

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleScanQR = async (codeStr: string) => {
    const trimmed = codeStr.trim();
    if (!trimmed || isVerifying) return;

    if (!currentUser || !societyId || !isAuthorizedRole) {
      if (isMountedRef.current) {
        setScanResult({
          scanned: true,
          allowed: false,
          message: 'Unauthorized: Verified security guard session is required to verify gate passes.',
          code: 'UNAUTHORIZED_GUARD_SESSION',
        });
        setQrInput('');
      }
      return;
    }

    if (!canVerifyPass) {
      if (isMountedRef.current) {
        setScanResult({
          scanned: true,
          allowed: false,
          message: 'Access Denied: Gate clearance verification requires Security Guard or Administrator privileges.',
          code: 'INSUFFICIENT_ROLE_PERMISSIONS',
        });
        setQrInput('');
      }
      return;
    }

    // Client-side fail-closed rejection for display pass codes (e.g. CGP-XXXX-XXXX)
    if (trimmed.startsWith('CGP-')) {
      if (isMountedRef.current) {
        setScanResult({
          scanned: true,
          allowed: false,
          message: 'Invalid Pass: Display passCode (e.g. CGP-XXXX-XXXX) cannot authorize gate exit. A valid cryptographic QR code payload or bearer token is strictly required.',
          code: 'BEARER_TOKEN_REQUIRED',
        });
        setQrInput('');
      }
      return;
    }

    setIsVerifying(true);
    try {
      const res = await childSafetyService.verifyGatePass({
        qrPayload: trimmed,
        gateId: 'Main Gate 1',
      });

      if (!isMountedRef.current) return;

      setScanResult({
        scanned: true,
        allowed: true,
        message: 'PICKUP AUTHORIZED & PERMITTED by security backend.',
        childName: res.pass?.child?.fullName || res.exitLog?.childName,
        flatNumber: res.pass?.child?.flatNumber || res.exitLog?.flatNumber,
        pickupPersonName: res.pass?.pickupPersonName || res.exitLog?.pickupPersonName,
        pickupPersonPhone: res.pass?.pickupPersonPhone || res.exitLog?.pickupPersonPhone,
        passCode: res.pass?.passCode,
      });

      // Reload logs and active passes upon successful exit authorization
      void loadData();
    } catch (err: any) {
      if (!isMountedRef.current) return;
      setScanResult({
        scanned: true,
        allowed: false,
        message: err?.message || 'Gate pass verification failed or exit denied.',
        code: err?.code || 'VERIFICATION_DENIED',
      });
      void loadData();
    } finally {
      if (isMountedRef.current) {
        setIsVerifying(false);
        setQrInput(''); // Clear sensitive QR payload from state immediately
      }
    }
  };

  const handleResolveAlert = async (alertId: string) => {
    if (resolvingAlertId) return;
    setResolvingAlertId(alertId);
    try {
      await childSafetyService.resolveAlert(alertId, {
        resolutionNotes: `Child located safe. Verified by ${currentUser?.name || 'Security Officer'} at gate terminal.`,
        status: 'RESOLVED',
      });
      if (isMountedRef.current) {
        void loadData();
      }
    } catch (err: any) {
      console.error('[ChildGateScannerPage] Failed to resolve safety alert:', err);
    } finally {
      if (isMountedRef.current) {
        setResolvingAlertId(null);
      }
    }
  };

  if (!currentUser || !societyId || !isAuthorizedRole) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--aarizo-page, #F7FBFE)', padding: '2rem 1rem' }}>
        <div className="max-w-xl mx-auto bg-white rounded-2xl border border-red-200 p-6 shadow-sm text-center space-y-3">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto" />
          <h2 className="text-lg font-bold text-gray-900">Security Gate Access Restricted</h2>
          <p className="text-sm text-gray-600">
            A verified security guard, committee, or administrator session is required to operate the Child Safety Gate Scanner.
          </p>
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700"
          >
            Return to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--aarizo-page, #F7FBFE)', paddingBottom: '2.5rem' }}>
      {/* ── Subheader / Top Bar ── */}
      <div
        style={{
          background: '#ffffff',
          borderBottom: '1px solid var(--aarizo-border, #DCE8EF)',
          padding: '0.875rem 1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
          boxShadow: '0 1px 3px rgba(8, 59, 86, 0.03)',
          marginBottom: '1.25rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Go Back"
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'var(--aarizo-card-blue, #F4FAFE)',
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
            <h1 style={{ fontSize: '1.125rem', fontWeight: 800, color: 'var(--aarizo-navy, #083B56)', margin: 0, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              Child Security &amp; Gate Scanner
              <span
                data-connection-state={connectionStatus}
                style={{
                  fontSize: '0.65rem',
                  fontWeight: 800,
                  padding: '0.15rem 0.5rem',
                  borderRadius: '12px',
                  background: isConnected ? '#ECFDF5' : isReconnecting ? '#FFFBEB' : '#FEF2F2',
                  color: isConnected ? '#059669' : isReconnecting ? '#D97706' : '#DC2626',
                  border: `1px solid ${isConnected ? '#A7F3D0' : isReconnecting ? '#FDE68A' : '#FECACA'}`,
                }}
              >
                {isConnected ? 'Terminal Online' : isReconnecting ? 'Reconnecting...' : 'Sync Offline'}
              </span>
            </h1>
            <p style={{ fontSize: '0.6875rem', color: 'var(--aarizo-text-secondary, #657785)', margin: 0, marginTop: 2 }}>
              {currentUser.societyName || 'Society Security'} · Authoritative Child Safety gate pass verification &amp; lockdown enforcement
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto w-full px-3 sm:px-4 space-y-4">
        {/* Offline Warning Notice */}
        {isOffline && (
          <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '12px', padding: '0.75rem 1rem', fontSize: '0.75rem', color: '#92400E', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertTriangle size={16} color="#D97706" />
            <span>Terminal is offline. Gate clearance requires an online connection to the authoritative security backend. Offline authorization is disabled.</span>
          </div>
        )}

        {/* Active Missing Child Critical Alert Banner */}
        {activeAlerts.length > 0 && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '16px', padding: '1rem 1.25rem', boxShadow: '0 4px 16px rgba(220, 38, 38, 0.12)' }} className="animate-pulse flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-7 h-7 text-[#DC2626] shrink-0 mt-0.5" />
              <div>
                <h2 style={{ fontSize: '1rem', fontWeight: 900, color: '#DC2626', margin: 0 }}>🚨 CRITICAL MISSING CHILD LOCKDOWN ACTIVE</h2>
                <div style={{ fontSize: '0.75rem', color: '#991B1B', marginTop: 4 }} className="space-y-1">
                  {activeAlerts.map(alert => (
                    <div key={alert.id} className="flex items-center gap-2">
                      <span>{alert.childName} (Flat {alert.flatNumber}) · Last seen: {alert.location} {alert.description ? `— ${alert.description}` : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <button
              type="button"
              disabled={resolvingAlertId !== null}
              onClick={() => handleResolveAlert(activeAlerts[0].id)}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '10px',
                background: resolvingAlertId !== null ? '#9CA3AF' : '#DC2626',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: '0.75rem',
                border: 'none',
                cursor: resolvingAlertId !== null ? 'not-allowed' : 'pointer',
                boxShadow: '0 2px 8px rgba(220, 38, 38, 0.25)',
              }}
            >
              {resolvingAlertId !== null ? 'Resolving...' : 'Mark Child Safe / Resolve Alert'}
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Scanner Terminal Column */}
          <div className="flex flex-col gap-4">
            {/* QR Terminal Box */}
            <div
              style={{
                background: '#ffffff',
                borderRadius: '16px',
                border: '1px solid #DCE8EF',
                padding: '1.25rem',
                boxShadow: '0 2px 8px rgba(8, 59, 86, 0.04)',
              }}
              className="flex flex-col gap-4"
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h2 style={{ fontSize: '1rem', fontWeight: 800, color: '#083B56', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <QrCode size={18} color="#083B56" /> Security Gate Scanner Terminal
                </h2>
                <span
                  style={{
                    fontSize: '0.65rem',
                    fontWeight: 800,
                    padding: '0.15rem 0.5rem',
                    borderRadius: '12px',
                    background: isConnected ? '#ECFDF5' : '#FEF2F2',
                    color: isConnected ? '#059669' : '#DC2626',
                    border: `1px solid ${isConnected ? '#A7F3D0' : '#FECACA'}`,
                  }}
                >
                  {isConnected ? 'Gate Terminal Active' : 'Terminal Offline'}
                </span>
              </div>

              <p style={{ fontSize: '0.75rem', color: '#657785', margin: 0 }}>
                Scan barcode/QR code from caretaker&apos;s mobile or paste QR payload below to verify pickup permission.
              </p>

              <form
                onSubmit={e => {
                  e.preventDefault();
                  void handleScanQR(qrInput);
                }}
                style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="text"
                    placeholder="Scan or Enter QR Code payload..."
                    value={qrInput}
                    disabled={isVerifying || !canVerifyPass}
                    onChange={e => setQrInput(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '0.65rem 0.875rem',
                      borderRadius: '12px',
                      border: '1px solid #DCE8EF',
                      fontSize: '0.8125rem',
                      fontFamily: 'monospace',
                      background: !canVerifyPass ? '#F1F5F9' : '#F4FAFE',
                      color: '#083B56',
                      fontWeight: 700,
                      outline: 'none',
                    }}
                  />
                  <button
                    type="button"
                    disabled={isVerifying || !canVerifyPass}
                    onClick={() => setIsCameraActive(true)}
                    aria-label="Open Camera Scanner"
                    title={!canVerifyPass ? 'Gate clearance verification requires Guard or Admin role' : 'Open Camera Scanner'}
                    style={{
                      padding: '0.65rem 0.875rem',
                      background: isVerifying || !canVerifyPass ? '#E2E8F0' : '#F4FAFE',
                      border: '1px solid #DCE8EF',
                      borderRadius: '12px',
                      color: isVerifying || !canVerifyPass ? '#94A3B8' : '#083B56',
                      fontWeight: 700,
                      fontSize: '0.8125rem',
                      cursor: isVerifying || !canVerifyPass ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <Camera size={15} /> Camera
                  </button>
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
                      boxShadow: isVerifying || !canVerifyPass ? 'none' : '0 2px 8px rgba(240, 101, 67, 0.25)',
                      whiteSpace: 'nowrap',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                    }}
                  >
                    <Scan size={15} /> {isVerifying ? 'Verifying...' : 'Scan Pass'}
                  </button>
                </div>

                {!canVerifyPass && (
                  <div
                    data-testid="view-only-notice"
                    style={{
                      background: '#FFFBEB',
                      border: '1px solid #FDE68A',
                      borderRadius: '10px',
                      padding: '0.5rem 0.75rem',
                      fontSize: '0.75rem',
                      color: '#92400E',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <AlertTriangle size={15} color="#D97706" className="shrink-0" />
                    <span>
                      <strong>View-Only Mode:</strong> You are logged in with role &quot;{currentUser?.role}&quot;. Gate clearance verification and pass scanning are strictly restricted to Security Guard and Admin personnel.
                    </span>
                  </div>
                )}
              </form>

              {/* Mobile QR Scanner Modal */}
              {isCameraActive && (
                <MobileQRScanner
                  label="Scan Child Gate Pass QR Code"
                  onScan={code => {
                    setIsCameraActive(false);
                    void handleScanQR(code);
                  }}
                  onClose={() => setIsCameraActive(false)}
                />
              )}

              {/* Active Society Passes on File (Reference List) */}
              {activePasses.length > 0 && (
                <div style={{ paddingTop: '0.5rem', borderTop: '1px solid #DCE8EF' }}>
                  <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#657785', display: 'block', marginBottom: 6 }}>
                    Active Society Passes On File ({activePasses.length}):
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {activePasses.slice(0, 4).map(pass => (
                      <div
                        key={pass.id}
                        style={{
                          padding: '0.35rem 0.65rem',
                          borderRadius: '8px',
                          background: '#F4FAFE',
                          border: '1px solid #DCE8EF',
                          color: '#083B56',
                          fontSize: '0.6875rem',
                          fontFamily: 'monospace',
                          fontWeight: 700,
                        }}
                      >
                        {pass.child?.fullName || 'Child'} ({pass.pickupPersonName}) · {pass.passCode}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Validation Result Box */}
            {scanResult && (
              <div
                data-testid="scan-result-box"
                style={{
                  background: scanResult.allowed ? '#ECFDF5' : '#FEF2F2',
                  border: `1px solid ${scanResult.allowed ? '#A7F3D0' : '#FECACA'}`,
                  borderRadius: '16px',
                  padding: '1.25rem',
                  boxShadow: '0 4px 12px rgba(8, 59, 86, 0.05)',
                }}
              >
                <div className="flex items-start gap-3.5">
                  {scanResult.allowed ? (
                    <CheckCircle2 size={36} color="#059669" className="shrink-0" />
                  ) : (
                    <XCircle size={36} color="#DC2626" className="shrink-0" />
                  )}
                  <div className="space-y-2 flex-1">
                    <h3 style={{ fontSize: '1.125rem', fontWeight: 900, color: scanResult.allowed ? '#065F46' : '#991B1B', margin: 0 }}>
                      {scanResult.allowed ? 'PICKUP AUTHORIZED & PERMITTED' : 'PICKUP DENIED / BLOCKED'}
                    </h3>
                    <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: scanResult.allowed ? '#047857' : '#DC2626', margin: 0 }}>
                      {scanResult.message}
                    </p>

                    {scanResult.allowed && (scanResult.childName || scanResult.pickupPersonName) && (
                      <div style={{ padding: '0.875rem', background: '#ffffff', borderRadius: '12px', border: '1px solid #DCE8EF', fontSize: '0.75rem', color: '#083B56' }} className="space-y-1">
                        {scanResult.childName && (
                          <p style={{ margin: 0 }}><strong>Child Name:</strong> {scanResult.childName} {scanResult.flatNumber ? `(Flat ${scanResult.flatNumber})` : ''}</p>
                        )}
                        {scanResult.passCode && (
                          <p style={{ margin: 0 }}><strong>Pass Code:</strong> {scanResult.passCode}</p>
                        )}
                        {scanResult.pickupPersonName && (
                          <p style={{ margin: 0 }}><strong>Pickup Person:</strong> {scanResult.pickupPersonName}</p>
                        )}
                        {scanResult.pickupPersonPhone && (
                          <p style={{ margin: 0 }}><strong>Contact:</strong> {scanResult.pickupPersonPhone}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Gate Logs */}
          <div className="flex flex-col gap-4">
            <div
              style={{
                background: '#ffffff',
                borderRadius: '16px',
                border: '1px solid #DCE8EF',
                padding: '1.25rem',
                boxShadow: '0 2px 8px rgba(8, 59, 86, 0.04)',
              }}
              className="flex flex-col gap-3"
            >
              <h3 style={{ fontSize: '0.9375rem', fontWeight: 800, color: '#083B56', margin: 0 }} className="flex items-center gap-2">
                <UserCheck size={18} color="#083B56" /> Recent Gate Verification Logs
              </h3>

              <div className="flex flex-col gap-2.5 max-h-[420px] overflow-y-auto">
                {pickupLogs.length === 0 ? (
                  <p style={{ fontSize: '0.75rem', color: '#657785', textAlign: 'center', padding: '2rem 0', margin: 0 }}>
                    No recent child exit events recorded
                  </p>
                ) : (
                  pickupLogs.map(log => {
                    const isAllowed = log.outcome === 'ALLOWED' || (log as any).status === 'ALLOWED';
                    return (
                      <div
                        key={log.id}
                        style={{
                          padding: '0.75rem 0.875rem',
                          background: '#F4FAFE',
                          border: '1px solid #DCE8EF',
                          borderRadius: '12px',
                          fontSize: '0.75rem',
                        }}
                        className="space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <strong style={{ color: '#083B56' }}>{log.childName} (Flat {log.flatNumber})</strong>
                          <span
                            style={{
                              padding: '0.15rem 0.5rem',
                              fontSize: '0.65rem',
                              fontWeight: 800,
                              borderRadius: '10px',
                              background: isAllowed ? '#ECFDF5' : '#FEF2F2',
                              color: isAllowed ? '#059669' : '#DC2626',
                              border: `1px solid ${isAllowed ? '#A7F3D0' : '#FECACA'}`,
                            }}
                          >
                            {isAllowed ? 'ALLOWED' : 'DENIED'}
                          </span>
                        </div>
                        <p style={{ color: '#657785', margin: 0 }}>Caretaker: {log.pickupPersonName || 'N/A'}</p>
                        {log.denialReason && (
                          <p style={{ color: '#DC2626', fontSize: '0.6875rem', margin: 0 }}>Reason: {log.denialReason}</p>
                        )}
                        <p style={{ color: '#657785', fontSize: '0.6875rem', fontFamily: 'monospace', margin: 0 }}>
                          {new Date(log.timestamp).toLocaleString()} · {log.gateId || 'Main Gate'}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChildGateScannerPage;
