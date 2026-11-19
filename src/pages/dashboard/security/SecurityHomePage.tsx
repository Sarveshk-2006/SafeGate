import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  QrCode,
  Scan,
  ShieldAlert,
  Car,
  HardHat,
  Package,
  ShieldCheck,
  Lock,
  Radio,
  Clock,
  CheckCircle2,
  Megaphone,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { realtimeService } from '../../../services/realtimeService';
import { apiClient } from '../../../services/apiClient';
import {
  PortalGreetingBanner,
  PortalUrgentAlertBanner,
  PortalHeroActionCards,
  PortalQuickActionsGrid,
  PortalStatusBadges,
  PortalActionRequiredList,
  PortalActivityList,
} from '../../../components/portal/PortalOverviewComponents';

export const SecurityHomePage: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [gateStatus, setGateStatus] = useState<'OPEN' | 'LOCKED'>('OPEN');
  const [activeAlert, setActiveAlert] = useState<{ title: string; message: string; action: string; path: string } | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<any[]>([]);
  const [recentMovements] = useState<any[]>([
    {
      id: 'mov-1',
      text: 'Delivery Courier (Swiggy) checked in for B-402',
      subtext: 'Passcode: 9481 · Gate #1 Boom Barrier',
      time: '2 mins ago',
      icon: Package,
      color: '#176B91',
    },
    {
      id: 'mov-2',
      text: 'Visitor Rajesh Mehta verified for A-102',
      subtext: 'QR Gate Pass Verified · Host Approved',
      time: '8 mins ago',
      icon: CheckCircle2,
      color: '#059669',
      bg: '#ECFDF5',
    },
    {
      id: 'mov-3',
      text: 'Domestic Worker Sunita Devi clocked in',
      subtext: 'Maid Pass DW-101 · Tower C',
      time: '25 mins ago',
      icon: HardHat,
      color: '#176B91',
    },
    {
      id: 'mov-4',
      text: 'Vehicle MH-02-CD-4421 cleared boom barrier',
      subtext: 'Resident RFID Slot P-12 · Tower B',
      time: '42 mins ago',
      icon: Car,
      color: '#D97706',
      bg: '#FFFBEB',
    },
  ]);

  const officerName = currentUser?.name || 'Officer R. Singh';
  const societyName = currentUser?.societyName || 'Green Valley Society';

  useEffect(() => {
    // Load live passes for pending items
    apiClient.getVisitorPasses().then((passes) => {
      if (passes && Array.isArray(passes)) {
        const pending = passes
          .filter((p: any) => p.status === 'EXPECTED' || p.status === 'AT_GATE')
          .slice(0, 3)
          .map((p: any) => ({
            id: p.id,
            label: `${p.visitorName || 'Visitor'} — ${p.flatCode || 'Flat Unit'}`,
            subtitle: `Expected: ${p.validFrom ? new Date(p.validFrom).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Today'} · Code: ${p.passCode || '8492'}`,
            urgent: p.status === 'AT_GATE',
            onClick: () => navigate('/security/verify'),
          }));
        setPendingApprovals(pending);
      }
    }).catch(() => {});

    // Listen for realtime security alerts
    const unsub = realtimeService.subscribe('*', (event) => {
      if (event.type === 'CHILD_PASS_ALERT' || event.type === 'CHILD_SOS_TRIGGERED') {
        setActiveAlert({
          title: 'URGENT: Child Safety Gate Alert',
          message: event.payload?.message || 'Child exit pass requiring mandatory physical guard verification.',
          action: 'Open Child Scanner',
          path: '/security/child-safety',
        });
      } else if (event.type === 'EMERGENCY_TRIGGERED') {
        setActiveAlert({
          title: 'SECURITY EMERGENCY SOS BROADCAST',
          message: event.payload?.message || 'Emergency trigger received from residential wing.',
          action: 'Emergency Command',
          path: '/security/emergency-command',
        });
      }
    });

    return () => unsub();
  }, [navigate]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, backgroundColor: 'var(--aarizo-page, #F7FBFE)', minHeight: '100%', paddingBottom: '5rem' }}>
      {/* ── 1. Greeting Banner in Pale Sky Blue (#EAF6FC) ── */}
      <PortalGreetingBanner
        userName={officerName}
        roleBadge="Security Officer"
        roleBadgeBg="#FEF2F2"
        roleBadgeColor="#DC2626"
        contextSubtitle={`Main Gate #1 · ${societyName}`}
        rightAction={
          <button
            type="button"
            onClick={() => setGateStatus((prev) => (prev === 'OPEN' ? 'LOCKED' : 'OPEN'))}
            style={{
              padding: '0.35rem 0.75rem',
              borderRadius: '9999px',
              background: gateStatus === 'OPEN' ? '#ECFDF5' : '#FEF2F2',
              color: gateStatus === 'OPEN' ? '#059669' : '#DC2626',
              border: `1px solid ${gateStatus === 'OPEN' ? '#A7F3D0' : '#FECACA'}`,
              fontSize: '0.6875rem',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
            title="Click to toggle gate barrier"
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: gateStatus === 'OPEN' ? '#059669' : '#DC2626',
              }}
            />
            <span>BARRIER {gateStatus}</span>
          </button>
        }
      />

      {/* ── 2. Urgent Security Alert ── */}
      {activeAlert && (
        <PortalUrgentAlertBanner
          title={activeAlert.title}
          message={activeAlert.message}
          actionLabel={activeAlert.action}
          onAction={() => navigate(activeAlert.path)}
          onDismiss={() => setActiveAlert(null)}
        />
      )}

      {/* Main Content Area */}
      <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* ── 3. High-Priority Officer Hero Action Cards ── */}
        <PortalHeroActionCards
          items={[
            {
              id: 'verify-pass',
              title: 'Verify Gate Pass / QR',
              subtitle: 'Scan pass or enter 6-digit passcode',
              icon: QrCode,
              iconColor: '#E5B842',
              gradient: 'linear-gradient(135deg, #083B56 0%, #176B91 100%)',
              onClick: () => navigate('/security/verify'),
            },
            {
              id: 'gate-terminal',
              title: 'Operator Terminal',
              subtitle: 'Walk-ins, blacklist & gate lookup',
              icon: Lock,
              iconColor: '#EA580C',
              gradient: 'linear-gradient(135deg, #FFF7ED 0%, #FFEDD5 100%)',
              textColor: '#9A3412',
              subtextColor: '#C2410C',
              borderColor: '#FED7AA',
              boxShadow: '0 4px 14px rgba(240, 101, 67, 0.08)',
              onClick: () => navigate('/security/terminal'),
            },
          ]}
        />

        {/* ── 4. Quick Actions Grid (Screenshot matched) ── */}
        <PortalQuickActionsGrid
          title="Security Actions"
          subtitle="Fast Gate Terminals"
          items={[
            {
              id: 'scanner',
              label: 'Visitor Scan',
              icon: Scan,
              color: '#176B91',
              bg: '#EAF6FC',
              onClick: () => navigate('/security/verify'),
            },
            {
              id: 'child-safety',
              label: 'Child Gate',
              icon: ShieldAlert,
              color: '#D97706',
              bg: '#FEF3C7',
              badge: 'LIVE',
              onClick: () => navigate('/security/child-safety'),
            },
            {
              id: 'staff-hub',
              label: 'Staff Hub',
              icon: HardHat,
              color: '#059669',
              bg: '#ECFDF5',
              onClick: () => navigate('/security/staff-scanner'),
            },
            {
              id: 'parking',
              label: 'Parking',
              icon: Car,
              color: '#176B91',
              bg: '#EAF6FC',
              onClick: () => navigate('/security/parking'),
            },
            {
              id: 'parcels',
              label: 'Parcels',
              icon: Package,
              color: '#176B91',
              bg: '#EAF6FC',
              onClick: () => navigate('/security/delivery-intelligence'),
            },
            {
              id: 'emergency',
              label: 'SOS Alert',
              icon: ShieldAlert,
              color: '#DC2626',
              bg: '#FEF2F2',
              onClick: () => navigate('/security/emergency-command'),
            },
          ]}
        />

        {/* ── 5. Live Security Status Badges ── */}
        <PortalStatusBadges
          title="Gate & Perimeter Status"
          items={[
            { label: 'Barrier', icon: Lock, status: gateStatus === 'OPEN' ? 'good' : 'warning', statusText: gateStatus },
            { label: 'Child Gate', icon: ShieldCheck, status: 'good', statusText: 'Arm/Active' },
            { label: 'Shift', icon: Clock, status: 'normal', statusText: '06:00-14:00' },
            { label: 'Cameras', icon: Radio, status: 'good', statusText: 'Online' },
            { label: 'Perimeter', icon: ShieldAlert, status: 'good', statusText: 'Clear' },
          ]}
        />

        {/* ── 6. Action Required / Pending Arrivals ── */}
        <PortalActionRequiredList
          title="Pending Gate Arrivals"
          items={
            pendingApprovals.length > 0
              ? pendingApprovals
              : [
                  {
                    id: 'sample-1',
                    label: 'Courier Delivery (Amazon) — Wing B',
                    subtitle: 'Passcode: 6021 · Expected within 10 mins',
                    urgent: false,
                    onClick: () => navigate('/security/verify'),
                  },
                ]
          }
        />

        {/* ── 7. Responsive Desktop 2-Col Grid for Activity & Bulletins ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
          {/* Recent Gate Movements */}
          <PortalActivityList
            title="Recent Gate Movements"
            items={recentMovements}
            onSeeAll={() => navigate('/security/terminal')}
          />

          {/* Security Bulletins & Orders */}
          <section>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.625rem' }}>
              <h2
                style={{
                  fontWeight: 800,
                  fontSize: '0.8125rem',
                  color: 'var(--aarizo-navy, #083B56)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  margin: 0,
                }}
              >
                Security Orders of the Day
              </h2>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div
                style={{
                  background: '#ffffff',
                  borderRadius: '16px',
                  border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
                  padding: '0.875rem 1rem',
                  boxShadow: '0 2px 8px rgba(8, 59, 86, 0.04)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                  <Megaphone size={16} style={{ color: 'var(--aarizo-blue, #176B91)', flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.84375rem', color: 'var(--aarizo-navy, #083B56)', marginBottom: '0.25rem' }}>
                      Mandatory Child Gate Verification
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--aarizo-text-secondary, #657785)', margin: 0, lineHeight: 1.4 }}>
                      All unaccompanied minors exiting through Gate #1 must present a digital Child Safety Pass with valid escort details.
                    </p>
                  </div>
                </div>
              </div>

              <div
                style={{
                  background: '#ffffff',
                  borderRadius: '16px',
                  border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
                  padding: '0.875rem 1rem',
                  boxShadow: '0 2px 8px rgba(8, 59, 86, 0.04)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                  <ShieldCheck size={16} style={{ color: '#059669', flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.84375rem', color: 'var(--aarizo-navy, #083B56)', marginBottom: '0.25rem' }}>
                      Commercial Delivery Parking Protocol
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--aarizo-text-secondary, #657785)', margin: 0, lineHeight: 1.4 }}>
                      Delivery 2-wheelers must park in designated Bay D. 15-minute grace period before gate warning trigger.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
