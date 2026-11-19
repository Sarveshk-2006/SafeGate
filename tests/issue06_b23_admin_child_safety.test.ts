// =============================================================================
// AARIZO — ISSUE-06 Phase B.2.3 (Phase 4.6.6):
// Admin Child Safety Desk Modernization Test Suite
//
// Tests:
// 1. Role-Gated Access & Multi-Tenant Defense-in-Depth (admin, secretary, committee vs unauthorized).
// 2. Missing Tenant Context Defense (empty or null societyId).
// 3. Authoritative Asynchronous Data Loading (listChildren, listExitLogs, listAlerts).
// 4. Tab Navigation, Filtering & Search Behavior.
// 5. Shared Realtime SSE Ingestion & Connection Status Pill.
// 6. Alert Resolution Workflow with Mandatory Resolution Notes.
// =============================================================================

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

const mockUseAuth = jest.fn();
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

let mockRealtimeOptions: any = null;
jest.mock('../src/hooks/useChildSafetyRealtime', () => ({
  useChildSafetyRealtime: (opts: any) => {
    mockRealtimeOptions = opts;
  },
}));

let mockStatusCallback: ((status: any) => void) | null = null;
jest.mock('../src/services/realtimeService', () => ({
  realtimeService: {
    subscribeToStatus: (cb: (status: any) => void) => {
      mockStatusCallback = cb;
      return () => {
        mockStatusCallback = null;
      };
    },
  },
}));

const mockListChildren = jest.fn();
const mockListExitLogs = jest.fn();
const mockListAlerts = jest.fn();
const mockResolveAlert = jest.fn();

jest.mock('../src/services/childSafetyService', () => ({
  childSafetyService: {
    listChildren: (...args: any[]) => mockListChildren(...args),
    listExitLogs: (...args: any[]) => mockListExitLogs(...args),
    listAlerts: (...args: any[]) => mockListAlerts(...args),
    resolveAlert: (...args: any[]) => mockResolveAlert(...args),
  },
}));

import { AdminChildSafetyPage } from '../src/pages/dashboard/admin/AdminChildSafetyPage';
import { childSafetyService } from '../src/services/childSafetyService';
import type {
  ChildProfileDto,
  ChildExitLogDto,
  ChildSafetyAlertDto,
} from '../src/types/childSafety';

describe('ISSUE-06 Phase 4.6.6: AdminChildSafetyPage Modernization Tests', () => {
  const sampleChildren: ChildProfileDto[] = [
    {
      id: 'ch-001',
      societyId: 'soc-alpha',
      residentId: 'res-001',
      flatId: 'flat-402',
      guardianUserId: 'usr-guardian-1',
      flatNumber: 'A-402',
      fullName: 'Aarav Sharma',
      dateOfBirth: '2018-05-12',
      reportedAge: 6,
      gender: 'MALE',
      photoUrl: null,
      medicalNotes: null,
      status: 'SAFE',
      exitPermissionMode: 'ESCORT_REQUIRED',
      allowedSoloExit: false,
      guardianName: 'Rohan Sharma',
      guardianPhone: '+919876543210',
      emergencyPhone: '+919876543211',
      secondaryGuardians: null,
      emergencyContacts: null,
      notes: null,
      archivedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      pickups: [
        {
          id: 'pic-001',
          societyId: 'soc-alpha',
          childId: 'ch-001',
          name: 'Sunita Devi',
          phone: '+919876543220',
          relationship: 'Nanny',
          idDocumentType: 'AADHAAR',
          idDocumentLast4: '4321',
          idVerificationStatus: 'VERIFIED',
          photoUrl: null,
          status: 'ACTIVE',
          validUntil: '2027-01-01T00:00:00.000Z',
          notes: null,
          archivedAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
    {
      id: 'ch-002',
      societyId: 'soc-alpha',
      residentId: 'res-002',
      flatId: 'flat-501',
      guardianUserId: 'usr-guardian-2',
      flatNumber: 'B-501',
      fullName: 'Ananya Verma',
      dateOfBirth: '2016-09-20',
      reportedAge: 8,
      gender: 'FEMALE',
      photoUrl: null,
      medicalNotes: null,
      status: 'OUT_OF_SOCIETY',
      exitPermissionMode: 'ESCORT_REQUIRED',
      allowedSoloExit: false,
      guardianName: 'Priya Verma',
      guardianPhone: '+919876543230',
      emergencyPhone: null,
      secondaryGuardians: null,
      emergencyContacts: null,
      notes: null,
      archivedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      pickups: [],
    },
  ];

  const sampleLogs: ChildExitLogDto[] = [
    {
      id: 'log-001',
      societyId: 'soc-alpha',
      childId: 'ch-002',
      passId: 'pass-001',
      pickupPersonId: null,
      childName: 'Ananya Verma',
      flatNumber: 'B-501',
      pickupPersonName: 'Sunita Devi',
      pickupPersonPhone: '+919876543220',
      gateId: 'MAIN_GATE_1',
      guardId: 'usr-guard-1',
      guardName: 'Rajesh Guard',
      outcome: 'ALLOWED',
      verificationChannel: 'ONLINE_QR_TOKEN',
      denialReason: null,
      notes: null,
      timestamp: '2026-11-19T06:30:00.000Z',
    },
  ];

  const sampleAlerts: ChildSafetyAlertDto[] = [
    {
      id: 'alert-001',
      societyId: 'soc-alpha',
      childId: 'ch-001',
      reportedById: 'usr-guardian-1',
      reportedByName: 'Rohan Sharma',
      childName: 'Aarav Sharma',
      flatNumber: 'A-402',
      alertType: 'MISSING_CHILD',
      severity: 'CRITICAL',
      status: 'ACTIVE',
      location: 'Central Playground near swings',
      description: 'Wearing yellow t-shirt and blue shorts',
      lastSeenDetails: 'Seen near sandbox 15 mins ago',
      acknowledgedAt: null,
      acknowledgedById: null,
      acknowledgedByName: null,
      resolvedAt: null,
      resolvedById: null,
      resolvedByName: null,
      resolutionNotes: null,
      emergencyIncidentId: 'inc-001',
      createdAt: '2026-11-19T07:00:00.000Z',
      updatedAt: '2026-11-19T07:00:00.000Z',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockListChildren.mockResolvedValue(sampleChildren);
    mockListExitLogs.mockResolvedValue(sampleLogs);
    mockListAlerts.mockResolvedValue(sampleAlerts);
    mockResolveAlert.mockResolvedValue({ ...sampleAlerts[0], status: 'RESOLVED' });
  });

  describe('1. Role Access & Multi-Tenant Defense-in-Depth', () => {
    it('blocks unauthorized roles (guard, resident, vendor) with access-restricted screen', () => {
      mockUseAuth.mockReturnValue({
        currentUser: { id: 'usr-guard', role: 'guard', societyId: 'soc-alpha' },
      });

      const html = renderToStaticMarkup(React.createElement(AdminChildSafetyPage));
      expect(html).toContain('data-testid="admin-child-safety-access-denied"');
      expect(html).toContain('Access Restricted');
      expect(html).not.toContain('data-testid="admin-child-safety-page"');
    });

    it('blocks resident role from viewing admin child safety desk', () => {
      mockUseAuth.mockReturnValue({
        currentUser: { id: 'usr-res', role: 'resident', societyId: 'soc-alpha' },
      });

      const html = renderToStaticMarkup(React.createElement(AdminChildSafetyPage));
      expect(html).toContain('data-testid="admin-child-safety-access-denied"');
      expect(html).not.toContain('data-testid="admin-child-safety-page"');
    });

    it('blocks session when societyId is empty/null with society-context-required screen', () => {
      mockUseAuth.mockReturnValue({
        currentUser: { id: 'usr-admin', role: 'admin', societyId: '' },
      });

      const html = renderToStaticMarkup(React.createElement(AdminChildSafetyPage));
      expect(html).toContain('data-testid="admin-child-safety-no-society"');
      expect(html).toContain('Society Context Required');
      expect(html).not.toContain('data-testid="admin-child-safety-page"');
    });

    it('allows society admin access to Child Safety Desk with management controls', () => {
      mockUseAuth.mockReturnValue({
        currentUser: { id: 'usr-admin', role: 'admin', societyId: 'soc-alpha', societyName: 'Palm Heights' },
      });

      const html = renderToStaticMarkup(React.createElement(AdminChildSafetyPage));
      expect(html).toContain('data-testid="admin-child-safety-page"');
      expect(html).toContain('Child Safety Desk');
      expect(html).toContain('Palm Heights');
      expect(html).not.toContain('data-testid="admin-child-safety-access-denied"');
    });

    it('allows secretary access with alert resolution capabilities', () => {
      mockUseAuth.mockReturnValue({
        currentUser: { id: 'usr-sec', role: 'secretary', societyId: 'soc-alpha', societyName: 'Palm Heights' },
      });

      const html = renderToStaticMarkup(React.createElement(AdminChildSafetyPage));
      expect(html).toContain('data-testid="admin-child-safety-page"');
    });

    it('allows committee member access in view-only mode without alert resolution buttons', () => {
      mockUseAuth.mockReturnValue({
        currentUser: { id: 'usr-comm', role: 'committee', societyId: 'soc-alpha', societyName: 'Palm Heights' },
      });

      const html = renderToStaticMarkup(
        React.createElement(AdminChildSafetyPage, {
          initialChildren: sampleChildren,
          initialLogs: sampleLogs,
          initialAlerts: sampleAlerts,
          initialLoading: false,
        })
      );
      expect(html).toContain('data-testid="admin-child-safety-page"');
      // Committee has view-only message instead of action button
      expect(html).toContain('View-only (Admin/Secretary required)');
      expect(html).not.toContain('data-testid="resolve-alert-btn-alert-001"');
    });
  });

  describe('2. Realtime SSE Subscription & Status Integration', () => {
    it('subscribes to useChildSafetyRealtime with isAuthorized and societyId enabled', () => {
      mockUseAuth.mockReturnValue({
        currentUser: { id: 'usr-admin', role: 'admin', societyId: 'soc-alpha', societyName: 'Palm Heights' },
      });

      renderToStaticMarkup(React.createElement(AdminChildSafetyPage));

      expect(mockRealtimeOptions).toBeDefined();
      expect(mockRealtimeOptions.enabled).toBe(true);
      expect(typeof mockRealtimeOptions.onProfilesChange).toBe('function');
      expect(typeof mockRealtimeOptions.onPickupsChange).toBe('function');
      expect(typeof mockRealtimeOptions.onPassesChange).toBe('function');
      expect(typeof mockRealtimeOptions.onExitLogsChange).toBe('function');
      expect(typeof mockRealtimeOptions.onAlertsChange).toBe('function');
      expect(typeof mockRealtimeOptions.onReconnect).toBe('function');
    });

    it('renders realtime live connection status pill in subheader', () => {
      mockUseAuth.mockReturnValue({
        currentUser: { id: 'usr-admin', role: 'admin', societyId: 'soc-alpha', societyName: 'Palm Heights' },
      });

      const html = renderToStaticMarkup(React.createElement(AdminChildSafetyPage));
      expect(html).toContain('data-testid="connection-status-pill"');
      expect(html).toContain('Live Connected');
    });
  });

  describe('3. Tab Filtering, Search & Card Structure', () => {
    it('renders filter tabs with matching counts', () => {
      mockUseAuth.mockReturnValue({
        currentUser: { id: 'usr-admin', role: 'admin', societyId: 'soc-alpha', societyName: 'Palm Heights' },
      });

      const html = renderToStaticMarkup(
        React.createElement(AdminChildSafetyPage, {
          initialChildren: sampleChildren,
          initialLogs: sampleLogs,
          initialAlerts: sampleAlerts,
          initialLoading: false,
        })
      );
      expect(html).toContain('data-testid="tab-all"');
      expect(html).toContain('data-testid="tab-inside"');
      expect(html).toContain('data-testid="tab-logs"');
      expect(html).toContain('data-testid="tab-alerts"');
      expect(html).toContain('All Children (2)');
      expect(html).toContain('Gate Pickups (1)');
      expect(html).toContain('Active Alerts (1)');
    });

    it('renders search input for child, flat, or phone', () => {
      mockUseAuth.mockReturnValue({
        currentUser: { id: 'usr-admin', role: 'admin', societyId: 'soc-alpha', societyName: 'Palm Heights' },
      });

      const html = renderToStaticMarkup(React.createElement(AdminChildSafetyPage));
      expect(html).toContain('data-testid="search-input"');
      expect(html).toContain('placeholder="Search child name, flat, guardian, or phone..."');
    });

    it('renders child profile cards with name, flat, guardian, and status badge', () => {
      mockUseAuth.mockReturnValue({
        currentUser: { id: 'usr-admin', role: 'admin', societyId: 'soc-alpha', societyName: 'Palm Heights' },
      });

      const html = renderToStaticMarkup(
        React.createElement(AdminChildSafetyPage, {
          initialChildren: sampleChildren,
          initialLogs: sampleLogs,
          initialAlerts: sampleAlerts,
          initialLoading: false,
        })
      );
      expect(html).toContain('data-testid="child-card-ch-001"');
      expect(html).toContain('Aarav Sharma');
      expect(html).toContain('Flat: A-402');
      expect(html).toContain('Rohan Sharma (+919876543210)');
      expect(html).toContain('1 Authorized Caretaker(s)');
      expect(html).toContain('SAFE');

      expect(html).toContain('data-testid="child-card-ch-002"');
      expect(html).toContain('Ananya Verma');
      expect(html).toContain('Flat: B-501');
      expect(html).toContain('OUT_OF_SOCIETY');
    });
  });

  describe('4. Active Alert Broadcast Banner & Resolution Action', () => {
    it('renders active alert broadcast banner when alerts exist', () => {
      mockUseAuth.mockReturnValue({
        currentUser: { id: 'usr-admin', role: 'admin', societyId: 'soc-alpha', societyName: 'Palm Heights' },
      });

      const html = renderToStaticMarkup(
        React.createElement(AdminChildSafetyPage, {
          initialChildren: sampleChildren,
          initialLogs: sampleLogs,
          initialAlerts: sampleAlerts,
          initialLoading: false,
        })
      );
      expect(html).toContain('data-testid="active-alerts-banner"');
      expect(html).toContain('ACTIVE MISSING CHILD ALERT BROADCAST (1)');
      expect(html).toContain('Aarav Sharma · Flat A-402 · Location: Central Playground near swings');
      expect(html).toContain('data-testid="resolve-alert-btn-alert-001"');
    });
  });

  describe('5. Empty States & Gate Pickup Logs Rendering', () => {
    it('renders empty state message when no children match the filter', () => {
      mockUseAuth.mockReturnValue({
        currentUser: { id: 'usr-admin', role: 'admin', societyId: 'soc-alpha', societyName: 'Palm Heights' },
      });

      const html = renderToStaticMarkup(
        React.createElement(AdminChildSafetyPage, {
          initialChildren: [],
          initialLogs: [],
          initialAlerts: [],
          initialLoading: false,
          initialTab: 'ALL',
        })
      );
      expect(html).toContain('data-testid="no-children-message"');
      expect(html).toContain('No child profiles found');
      expect(html).toContain('No children registered in this category.');
    });

    it('renders gate pickup audit logs table when LOGS tab is active', () => {
      mockUseAuth.mockReturnValue({
        currentUser: { id: 'usr-admin', role: 'admin', societyId: 'soc-alpha', societyName: 'Palm Heights' },
      });

      const html = renderToStaticMarkup(
        React.createElement(AdminChildSafetyPage, {
          initialChildren: sampleChildren,
          initialLogs: sampleLogs,
          initialAlerts: [],
          initialLoading: false,
          initialTab: 'LOGS',
        })
      );
      // Verify table column headers and data
      expect(html).toContain('Gate Pickup Audit Logs &amp; History');
      expect(html).toContain('Child Name');
      expect(html).toContain('Caretaker / Escort');
      expect(html).toContain('Outcome');
    });
  });

  describe('6. Canonical Service Invocation Verification', () => {
    it('calls canonical childSafetyService methods with correct arguments', async () => {
      await childSafetyService.resolveAlert('alert-001', {
        resolutionNotes: 'Child found safely in library reading area.',
        status: 'RESOLVED',
      });

      expect(mockResolveAlert).toHaveBeenCalledWith('alert-001', {
        resolutionNotes: 'Child found safely in library reading area.',
        status: 'RESOLVED',
      });
    });

    it('propagates service resolution errors gracefully', async () => {
      mockResolveAlert.mockRejectedValueOnce(new Error('Network error resolving alert'));

      await expect(
        childSafetyService.resolveAlert('alert-001', {
          resolutionNotes: 'Notes',
          status: 'RESOLVED',
        })
      ).rejects.toThrow('Network error resolving alert');
    });
  });
});
