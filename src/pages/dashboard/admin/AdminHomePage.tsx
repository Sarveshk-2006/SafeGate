import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  CheckSquare,
  Wrench,
  Sparkles,
  HardHat,
  Calendar,
  Shield,
  CreditCard,
  DollarSign,
  Baby,
  ShieldCheck,
  Droplets,
  TrendingUp,
  Radio,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { societyService } from '../../../services/societyService';
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

export const AdminHomePage: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const currentSocietyId = currentUser?.societyId || 'soc-gvs';

  const [residentsCount, setResidentsCount] = useState(14);
  const [staffCount, setStaffCount] = useState(6);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [urgentAlert, setUrgentAlert] = useState<{ title: string; message: string } | null>(null);

  useEffect(() => {
    try {
      const res = societyService.getResidents(currentSocietyId);
      const staff = societyService.getStaff(currentSocietyId);
      if (res && res.length > 0) setResidentsCount(res.length);
      if (staff && staff.length > 0) setStaffCount(staff.length);
    } catch {}

    apiClient.getAnnouncements().then((res) => {
      if (res && Array.isArray(res) && res.length > 0) {
        setAnnouncements(res);
        const urgent = res.find((a: any) => a.isUrgent);
        if (urgent) {
          setUrgentAlert({ title: urgent.title, message: urgent.content || urgent.summary });
        }
      }
    }).catch(() => {});
  }, [currentSocietyId]);

  const secretaryName = currentUser?.name || 'Society Secretary';
  const societyName = currentUser?.societyName || 'Green Valley Society';

  const now = new Date();
  const formattedDate = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  const formattedDay = now.toLocaleDateString('en-IN', { weekday: 'short' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, backgroundColor: 'var(--aarizo-page, #F7FBFE)', minHeight: '100%', paddingBottom: '5rem' }}>
      {/* ── 1. Greeting Banner in Pale Sky Blue (#EAF6FC) ── */}
      <PortalGreetingBanner
        userName={secretaryName}
        roleBadge="Secretary"
        roleBadgeBg="#EAF6FC"
        roleBadgeColor="#083B56"
        contextSubtitle={`Managing ${societyName} · ${residentsCount} Units`}
        rightAction={
          <div
            style={{
              padding: '0.35rem 0.65rem',
              borderRadius: '12px',
              background: '#ffffff',
              border: '1px solid var(--aarizo-border, #DCE8EF)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              color: 'var(--aarizo-navy, #083B56)',
            }}
          >
            <Calendar size={14} color="#176B91" />
            <span style={{ fontSize: '0.75rem', fontWeight: 800 }}>
              {formattedDate}, {formattedDay}
            </span>
          </div>
        }
      />

      {/* ── 2. Urgent Society Alert ── */}
      {urgentAlert && (
        <PortalUrgentAlertBanner
          title={urgentAlert.title}
          message={urgentAlert.message}
          onDismiss={() => setUrgentAlert(null)}
          actionLabel="View Notices"
          onAction={() => navigate('/admin/community')}
        />
      )}

      {/* Main Content Area */}
      <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* ── 3. High-Priority Admin Hero Action Cards ── */}
        <PortalHeroActionCards
          items={[
            {
              id: 'manage-residents',
              title: 'Resident Onboarding',
              subtitle: `${residentsCount} units registered · Verify new residents`,
              icon: Users,
              iconColor: '#E5B842',
              gradient: 'linear-gradient(135deg, #083B56 0%, #176B91 100%)',
              onClick: () => navigate('/admin/residents'),
            },
            {
              id: 'manage-requests',
              title: 'Complaints & NOCs',
              subtitle: 'Unified Request Center · Action pending items',
              icon: CheckSquare,
              iconColor: '#EA580C',
              gradient: 'linear-gradient(135deg, #FFF7ED 0%, #FFEDD5 100%)',
              textColor: '#9A3412',
              subtextColor: '#C2410C',
              borderColor: '#FED7AA',
              boxShadow: '0 4px 14px rgba(240, 101, 67, 0.08)',
              onClick: () => navigate('/admin/requests'),
            },
          ]}
        />

        {/* ── 4. Quick Actions Grid (Screenshot matched) ── */}
        <PortalQuickActionsGrid
          title="Administrative Hub"
          subtitle="One-Tap Operations"
          items={[
            {
              id: 'residents',
              label: 'Residents',
              icon: Users,
              color: '#083B56',
              bg: '#EAF6FC',
              onClick: () => navigate('/admin/residents'),
            },
            {
              id: 'staff',
              label: 'Staff Roster',
              icon: HardHat,
              color: '#059669',
              bg: '#ECFDF5',
              onClick: () => navigate('/admin/staff'),
            },
            {
              id: 'child-safety',
              label: 'Child Desk',
              icon: Baby,
              color: '#D97706',
              bg: '#FEF3C7',
              onClick: () => navigate('/admin/child-safety'),
            },
            {
              id: 'safety-command',
              label: 'Safety Cmd',
              icon: ShieldCheck,
              color: '#DC2626',
              bg: '#FEF2F2',
              onClick: () => navigate('/admin/safety-command'),
            },
            {
              id: 'maintenance',
              label: 'Maintenance',
              icon: Wrench,
              color: '#176B91',
              bg: '#EAF6FC',
              onClick: () => navigate('/admin/maintenance'),
            },
            {
              id: 'billing',
              label: 'Finances',
              icon: CreditCard,
              color: '#176B91',
              bg: '#EAF6FC',
              onClick: () => navigate('/admin/billing'),
            },
            {
              id: 'amenities',
              label: 'Amenities',
              icon: Sparkles,
              color: '#7C3AED',
              bg: '#F5F3FF',
              onClick: () => navigate('/admin/amenities'),
            },
            {
              id: 'expenses',
              label: 'Expenses',
              icon: DollarSign,
              color: '#059669',
              bg: '#ECFDF5',
              onClick: () => navigate('/admin/expenses'),
            },
          ]}
        />

        {/* ── 5. Live Society Operations Status Badges ── */}
        <PortalStatusBadges
          title="Society Operations Status"
          items={[
            { label: 'Security', icon: Shield, status: 'good', statusText: `${staffCount} on duty` },
            { label: 'Water', icon: Droplets, status: 'normal', statusText: 'Normal' },
            { label: 'Housekeeping', icon: Sparkles, status: 'good', statusText: 'Done' },
            { label: 'Realtime SSE', icon: Radio, status: 'good', statusText: '99.9% Live' },
            { label: 'Collections', icon: CreditCard, status: 'good', statusText: '98.4% Paid' },
          ]}
        />

        {/* ── 6. Action Required / Pending Approvals ── */}
        <PortalActionRequiredList
          title="Action Required"
          items={[
            {
              id: 'act-1',
              label: 'New Resident Move-In Verification — B-302',
              subtitle: 'Aadhaar ID and registered rent agreement pending approval',
              urgent: true,
              onClick: () => navigate('/admin/residents'),
            },
            {
              id: 'act-2',
              label: 'Plumbing Breakdown Ticket #802 — Clubhouse',
              subtitle: 'Assigned to CoolCare Servicing · SLA due in 2 hours',
              urgent: false,
              onClick: () => navigate('/admin/requests'),
            },
            {
              id: 'act-3',
              label: 'Vendor AMC Renewal Invoice — Otis Elevator',
              subtitle: 'Quarterly maintenance invoice ₹45,000 awaiting secretary sign-off',
              urgent: false,
              onClick: () => navigate('/admin/expenses'),
            },
          ]}
        />

        {/* ── 7. Responsive Desktop 2-Col Grid for Activity & Announcements ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
          {/* Recent Operations Activity */}
          <PortalActivityList
            title="Recent Administrative Activity"
            items={[
              {
                id: 'op-1',
                text: 'Visitor Pass approved for Flat A-204 (Rajesh Mehta)',
                subtext: 'Pre-approved via Resident Mobile App',
                time: '5 mins ago',
                icon: Users,
                color: '#059669',
                bg: '#ECFDF5',
              },
              {
                id: 'op-2',
                text: 'Maintenance Levy collected for Unit B-302 (₹2,400)',
                subtext: 'Auto-receipt issued via Razorpay',
                time: '20 mins ago',
                icon: CreditCard,
                color: '#176B91',
                bg: '#EAF6FC',
              },
              {
                id: 'op-3',
                text: 'Housekeeping Wing C sanitization completed',
                subtext: 'Staff checklist logged by Sunita Devi',
                time: '1 hour ago',
                icon: Sparkles,
                color: '#D97706',
                bg: '#FFFBEB',
              },
              {
                id: 'op-4',
                text: 'Child Safety Pass verified at Main Gate #1',
                subtext: 'Child Aarav Sharma with authorized guardian',
                time: '2 hours ago',
                icon: Baby,
                color: '#176B91',
              },
            ]}
            onSeeAll={() => navigate('/admin/audit-logs')}
          />

          {/* Society Announcements */}
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
                Society Notices & Circulars
              </h2>
              <button
                type="button"
                onClick={() => navigate('/admin/community')}
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--aarizo-blue, #176B91)',
                  fontWeight: 700,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Manage Notices →
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {announcements.length > 0 ? (
                announcements.slice(0, 3).map((ann, i) => (
                  <div
                    key={ann.id || i}
                    style={{
                      background: '#ffffff',
                      borderRadius: '16px',
                      border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
                      padding: '0.875rem 1rem',
                      boxShadow: '0 2px 8px rgba(8, 59, 86, 0.04)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                      <TrendingUp size={16} style={{ color: 'var(--aarizo-blue, #176B91)', flexShrink: 0, marginTop: 2 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '0.84375rem', color: 'var(--aarizo-navy, #083B56)', marginBottom: '0.25rem' }}>
                          {ann.title}
                        </div>
                        <p style={{ fontSize: '0.75rem', color: 'var(--aarizo-text-secondary, #657785)', margin: 0, lineHeight: 1.4 }}>
                          {ann.content || ann.summary}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div
                  style={{
                    background: '#ffffff',
                    borderRadius: '16px',
                    border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
                    padding: '1rem',
                    boxShadow: '0 2px 8px rgba(8, 59, 86, 0.04)',
                  }}
                >
                  <p style={{ fontSize: '0.8125rem', color: 'var(--aarizo-text-secondary, #657785)', margin: 0 }}>
                    Notice: Annual General Meeting (AGM) scheduled for Sunday 10:00 AM at the Clubhouse. All registered owners requested to attend.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
