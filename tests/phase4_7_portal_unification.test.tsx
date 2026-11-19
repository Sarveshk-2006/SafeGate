// =============================================================================
// AARIZO — PHASE 4.7
// Unified Multi-Portal UI/UX, Dashboard Consistency & Real-Time Profile System
// Unit & Integration Test Suite
// =============================================================================

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Mocks declared before component imports
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/admin' }),
}));

jest.mock('../src/services/firebase/config', () => ({
  auth: {},
  db: {},
  storage: {},
}));

const mockUpdateCurrentUser = jest.fn();
const mockLogout = jest.fn();

let mockCurrentUser: any = {
  id: 'user-sec-1',
  uid: 'user-sec-1',
  name: 'Vikram Joshi',
  role: 'secretary',
  societyId: 'soc-gvs',
  societyName: 'Green Valley Society',
  phone: '9820011223',
  email: 'secretary@greenvalley.com',
  designation: 'Hon. Secretary',
};

jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: mockCurrentUser,
    updateCurrentUser: mockUpdateCurrentUser,
    logout: mockLogout,
    status: 'AUTHENTICATED',
  }),
}));

jest.mock('../src/services/realtimeService', () => ({
  realtimeService: {
    subscribe: jest.fn(() => () => {}),
    publish: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
  },
}));

jest.mock('../src/services/apiClient', () => ({
  apiClient: {
    getVisitorPasses: jest.fn(() => Promise.resolve([])),
    getAnnouncements: jest.fn(() => Promise.resolve([])),
    getVendors: jest.fn(() => Promise.resolve([])),
  },
}));

jest.mock('../src/services/societyService', () => ({
  societyService: {
    getResidents: jest.fn(() => [1, 2, 3]),
    getStaff: jest.fn(() => [1, 2]),
    getVendors: jest.fn(() => []),
  },
}));

// Component imports
import {
  PortalGreetingBanner,
  PortalUrgentAlertBanner,
  PortalHeroActionCards,
  PortalQuickActionsGrid,
  PortalStatusBadges,
  PortalActionRequiredList,
  PortalActivityList,
  getPortalGreeting,
} from '../src/components/portal/PortalOverviewComponents';
import { SecurityHomePage } from '../src/pages/dashboard/security/SecurityHomePage';
import { AdminHomePage } from '../src/pages/dashboard/admin/AdminHomePage';
import { AdminProfilePage } from '../src/pages/dashboard/admin/AdminProfilePage';
import { SecurityProfilePage } from '../src/pages/dashboard/security/SecurityProfilePage';
import { SuperAdminProfilePage } from '../src/pages/dashboard/SuperAdminProfilePage';
import { StaffProfilePage } from '../src/pages/dashboard/staff/StaffProfilePage';
import {
  QrCode,
  Scan,
  Shield,
  Clock,
  CheckCircle2,
} from 'lucide-react';

describe('Phase 4.7 — Unified Multi-Portal UI/UX & Profile System', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. Shared Portal Overview Components Tests
  // ─────────────────────────────────────────────────────────────
  describe('1. PortalOverviewComponents', () => {
    test('getPortalGreeting returns valid time-aware greeting', () => {
      const greeting = getPortalGreeting();
      expect(['Good morning', 'Good afternoon', 'Good evening']).toContain(greeting);
    });

    test('PortalGreetingBanner renders username, role badge and subtitle', () => {
      const html = renderToStaticMarkup(
        <PortalGreetingBanner
          userName="Officer R. Singh"
          roleBadge="Security Officer"
          contextSubtitle="Main Gate #1 · Green Valley"
        />
      );
      expect(html).toContain('Officer R. Singh');
      expect(html).toContain('Security Officer');
      expect(html).toContain('Main Gate #1 · Green Valley');
      expect(html).toContain('#EAF6FC'); // Pale sky blue token
    });

    test('PortalUrgentAlertBanner renders urgent title and message', () => {
      const html = renderToStaticMarkup(
        <PortalUrgentAlertBanner
          title="Emergency Gate Lockdown"
          message="Perimeter sensor triggered in Wing B"
          actionLabel="View Command"
          onAction={jest.fn()}
        />
      );
      expect(html).toContain('Emergency Gate Lockdown');
      expect(html).toContain('Perimeter sensor triggered in Wing B');
      expect(html).toContain('View Command');
    });

    test('PortalHeroActionCards renders primary action hero cards', () => {
      const html = renderToStaticMarkup(
        <PortalHeroActionCards
          items={[
            {
              id: 'verify',
              title: 'Verify Pass Code',
              subtitle: 'Scan pass or enter 6-digit code',
              icon: QrCode,
              gradient: 'linear-gradient(135deg, #083B56 0%, #176B91 100%)',
              onClick: jest.fn(),
            },
          ]}
        />
      );
      expect(html).toContain('Verify Pass Code');
      expect(html).toContain('Scan pass or enter 6-digit code');
    });

    test('PortalQuickActionsGrid renders 42x42 icon pills and uppercase title', () => {
      const html = renderToStaticMarkup(
        <PortalQuickActionsGrid
          title="Fast Terminals"
          items={[
            {
              id: 'scan',
              label: 'Visitor Scan',
              icon: Scan,
              color: '#176B91',
              bg: '#EAF6FC',
            },
            {
              id: 'child',
              label: 'Child Gate',
              icon: Shield,
              color: '#D97706',
              bg: '#FEF3C7',
              badge: 'LIVE',
            },
          ]}
        />
      );
      expect(html).toContain('Fast Terminals');
      expect(html).toContain('Visitor Scan');
      expect(html).toContain('Child Gate');
      expect(html).toContain('LIVE');
    });

    test('PortalStatusBadges renders health metrics and status dots', () => {
      const html = renderToStaticMarkup(
        <PortalStatusBadges
          title="Operations Status"
          items={[
            { label: 'Gate Barrier', icon: Shield, status: 'good', statusText: 'OPEN' },
            { label: 'Shift Roster', icon: Clock, status: 'normal', statusText: 'Active' },
          ]}
        />
      );
      expect(html).toContain('Operations Status');
      expect(html).toContain('Gate Barrier');
      expect(html).toContain('OPEN');
      expect(html).toContain('Shift Roster');
    });

    test('PortalActionRequiredList renders pending actions and count badge', () => {
      const html = renderToStaticMarkup(
        <PortalActionRequiredList
          title="Pending Queue"
          items={[
            {
              id: 1,
              label: 'Approve Balcony Mesh Request — B-302',
              subtitle: 'Awaiting executive sign-off',
              urgent: true,
              onClick: jest.fn(),
            },
          ]}
        />
      );
      expect(html).toContain('Pending Queue');
      expect(html).toContain('1 Pending');
      expect(html).toContain('Approve Balcony Mesh Request — B-302');
    });

    test('PortalActivityList renders activity stream with timestamps', () => {
      const html = renderToStaticMarkup(
        <PortalActivityList
          title="Recent Movements"
          items={[
            {
              id: 'act-1',
              text: 'Courier Delivery (Swiggy) checked in for B-402',
              subtext: 'Gate #1 Boom Barrier',
              time: '2 mins ago',
              icon: CheckCircle2,
            },
          ]}
        />
      );
      expect(html).toContain('Recent Movements');
      expect(html).toContain('Courier Delivery (Swiggy) checked in for B-402');
      expect(html).toContain('2 mins ago');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. Security Overview & Home Tests
  // ─────────────────────────────────────────────────────────────
  describe('2. Security Overview Page', () => {
    test('renders SecurityHomePage with Pale Sky Blue banner and officer context', () => {
      const html = renderToStaticMarkup(<SecurityHomePage />);
      expect(html).toContain('Security Officer');
      expect(html).toContain('Main Gate #1');
      expect(html).toContain('BARRIER');
      expect(html).toContain('Verify Gate Pass / QR');
      expect(html).toContain('Operator Terminal');
      expect(html).toContain('Visitor Scan');
      expect(html).toContain('Child Gate');
      expect(html).toContain('Recent Gate Movements');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. Admin Overview Page Tests
  // ─────────────────────────────────────────────────────────────
  describe('3. Admin Overview Page', () => {
    test('renders AdminHomePage with unified greeting banner and executive actions', () => {
      const html = renderToStaticMarkup(<AdminHomePage />);
      expect(html).toContain('Secretary');
      expect(html).toContain('Managing Green Valley Society');
      expect(html).toContain('Resident Onboarding');
      expect(html).toContain('Complaints &amp; NOCs');
      expect(html).toContain('Administrative Hub');
      expect(html).toContain('Society Operations Status');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. Role-Aware Profile Pages Tests
  // ─────────────────────────────────────────────────────────────
  describe('4. Role-Aware Profile Pages', () => {
    test('renders AdminProfilePage with Secretary credentials and Society Document Locker', () => {
      const html = renderToStaticMarkup(<AdminProfilePage />);
      expect(html).toContain('Hon. Secretary');
      expect(html).toContain('Registered Phone');
      expect(html).toContain('Digital Document Locker');
      expect(html).toContain('Society Registration Certificate');
      expect(html).toContain('Secretary Election Resolution');
      expect(html).toContain('Society PAN &amp; Tax Exemption Certificate');
      expect(html).toContain('Sign Out');
    });

    test('renders SecurityProfilePage with Guard Badge ID and PSARA Document Locker', () => {
      const html = renderToStaticMarkup(<SecurityProfilePage />);
      expect(html).toContain('Badge SG-8821');
      expect(html).toContain('Verified Security Officer');
      expect(html).toContain('Registered Phone');
      expect(html).toContain('Digital Document Locker');
      expect(html).toContain('PSARA Security Guard License &amp; Certification');
      expect(html).toContain('Police Clearance &amp; Character Verification');
      expect(html).toContain('Sign Out');
    });

    test('renders SuperAdminProfilePage with Root Platform Administrator details', () => {
      const html = renderToStaticMarkup(<SuperAdminProfilePage />);
      expect(html).toContain('Platform Super Administrator');
      expect(html).toContain('Platform Super Admin');
      expect(html).toContain('Registered Phone');
      expect(html).toContain('Digital Document Locker');
      expect(html).toContain('Developer Database Studio');
      expect(html).toContain('Registered Societies Directory');
      expect(html).toContain('Sign Out');
    });

    test('renders StaffProfilePage with Domestic Worker QR Pass', () => {
      const html = renderToStaticMarkup(<StaffProfilePage staffType="DOMESTIC_WORKER" />);
      expect(html).toContain('Sunita Devi');
      expect(html).toContain('DW-9042');
      expect(html).toContain('Domestic Help / Maid');
      expect(html).toContain('Gate Entry QR Pass');
      expect(html).toContain('Show this QR code at Security Gate #1');
    });

    test('renders StaffProfilePage with Service Provider QR Pass', () => {
      const html = renderToStaticMarkup(<StaffProfilePage staffType="SERVICE_PROVIDER" />);
      expect(html).toContain('Rajesh Carpenter');
      expect(html).toContain('SP-4410');
      expect(html).toContain('Certified Service Technician');
      expect(html).toContain('Gate Entry QR Pass');
      expect(html).toContain('Show this QR code at Security Gate #1');
    });
  });
});
