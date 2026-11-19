// =============================================================================
// ISSUE-06 Phase B.2.3 — Phase 4.5:
// Real React SSR Component Render & Role-Preservation Tests for
// `ResidentChildAlertsSection`, `ResidentChildSosModal`, and `SafetyCommandHub`.
// =============================================================================

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockUseAuth = jest.fn();

jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('../src/utils/backendConfig', () => ({
  getBackendBaseUrl: jest.fn(() => 'http://localhost:5000'),
}));

jest.mock('../src/utils/nativeMobile', () => ({
  triggerHaptic: jest.fn(),
  isNativeApp: jest.fn(() => false),
}));

jest.mock('../src/repositories/safety/EmergencyIncidentRepository', () => ({
  emergencyIncidentRepository: {
    create: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../src/components/ui/Modal', () => ({
  Modal: ({
    isOpen,
    title,
    subtitle,
    children,
    footer,
  }: {
    isOpen: boolean;
    title?: React.ReactNode;
    subtitle?: React.ReactNode;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) => {
    if (!isOpen) return null;
    return React.createElement(
      'div',
      { 'data-testid': 'mock-modal' },
      title ? React.createElement('div', { 'data-testid': 'mock-modal-title' }, title) : null,
      subtitle ? React.createElement('div', { 'data-testid': 'mock-modal-subtitle' }, subtitle) : null,
      children,
      footer ? React.createElement('div', { 'data-testid': 'mock-modal-footer' }, footer) : null
    );
  },
}));

import { ResidentChildAlertsSection } from '../src/domains/safety/components/ResidentChildAlertsSection';
import { ResidentChildSosModal } from '../src/domains/safety/components/ResidentChildSosModal';
import { SafetyCommandHub } from '../src/domains/safety/components/SafetyCommandHub';
import type { UserProfile } from '../src/domains/auth/types';
import type { ChildProfileDto } from '../src/types/childSafety';

const residentUser: UserProfile = {
  id: 'usr-res-1',
  name: 'Rohan Sharma',
  phone: '+919876543210',
  role: 'resident',
  societyId: 'soc-alpha',
  flatNumber: 'A-402',
};

const safeChild: ChildProfileDto = {
  id: 'chd-1',
  societyId: 'soc-alpha',
  residentId: 'res-1',
  flatId: 'flt-1',
  guardianUserId: 'usr-res-1',
  flatNumber: 'A-402',
  fullName: 'Aarav Sharma',
  dateOfBirth: '2018-05-14T00:00:00.000Z',
  reportedAge: 8,
  gender: 'MALE',
  photoUrl: null,
  medicalNotes: null,
  status: 'SAFE',
  exitPermissionMode: 'ESCORT_REQUIRED',
  allowedSoloExit: false,
  guardianName: 'Rohan Sharma',
  guardianPhone: '+919876543210',
  emergencyPhone: null,
  secondaryGuardians: null,
  emergencyContacts: null,
  notes: null,
  archivedAt: null,
  createdAt: '2026-11-18T10:00:00.000Z',
  updatedAt: '2026-11-18T10:00:00.000Z',
  pickups: [],
};

describe('ISSUE-06 Phase B.2.3 (Phase 4.5): Resident SOS & Alerts Render & Role Preservation', () => {
  afterEach(() => {
    mockUseAuth.mockReset();
  });

  test('renders ResidentChildAlertsSection for resident with Report Missing/SOS button, refresh button, empty state, and zero staff mutation controls', () => {
    const onSosRequested = jest.fn();
    const html = renderToStaticMarkup(
      React.createElement(ResidentChildAlertsSection, {
        childrenList: [safeChild],
        selectedChildId: 'chd-1',
        currentUser: residentUser,
        onTriggerSosRequested: onSosRequested,
      })
    );

    expect(html).toContain('data-testid="resident-child-alerts-section"');
    expect(html).toContain('Child Safety SOS &amp; Live Alerts');
    expect(html).toContain('data-testid="refresh-child-alerts-btn"');
    expect(html).toContain('data-testid="trigger-child-sos-btn"');
    expect(html).toContain('data-testid="no-active-alerts-card"');

    // Zero staff mutation buttons (Acknowledge / Resolve)
    expect(html).not.toContain('Acknowledge Alert');
    expect(html).not.toContain('Resolve Incident');
    expect(html).not.toContain('data-testid="acknowledge-alert-btn"');
    expect(html).not.toContain('data-testid="resolve-alert-btn"');
  });

  test('renders ResidentChildSosModal with child select, category select, urgency, required location, and dispatch button', () => {
    const html = renderToStaticMarkup(
      React.createElement(ResidentChildSosModal, {
        isOpen: true,
        onClose: jest.fn(),
        childrenList: [safeChild],
        preselectedChildId: 'chd-1',
        currentUser: residentUser,
      })
    );

    expect(html).toContain('data-testid="resident-child-sos-form"');
    expect(html).toContain('Dispatch Child Safety SOS Alarm');
    expect(html).toContain('data-testid="child-sos-select"');
    expect(html).toContain('Aarav Sharma (Flat A-402)');
    expect(html).toContain('data-testid="child-sos-alert-type"');
    expect(html).toContain('Missing Child (Default)');
    expect(html).toContain('data-testid="child-sos-severity"');
    expect(html).toContain('data-testid="child-sos-location"');
    expect(html).toContain('data-testid="child-sos-last-seen"');
    expect(html).toContain('data-testid="child-sos-description"');
    expect(html).toContain('data-testid="submit-child-sos-btn"');
    expect(html).toContain('DISPATCH SOS ALARM NOW');

    // Modal when closed renders empty
    const closedHtml = renderToStaticMarkup(
      React.createElement(ResidentChildSosModal, {
        isOpen: false,
        onClose: jest.fn(),
        childrenList: [safeChild],
        currentUser: residentUser,
      })
    );
    expect(closedHtml).toBe('');
  });

  test('preserves SafetyCommandHub all 6 SOS cards, removes dead fake MISSING_ALERT modal, and preserves Command Console for staff', () => {
    // 1. Resident view in SafetyCommandHub
    mockUseAuth.mockReturnValue({ currentUser: residentUser });
    const residentHubHtml = renderToStaticMarkup(
      React.createElement(SafetyCommandHub, { initialTab: 'ONE_TAP_SOS' })
    );

    expect(residentHubHtml).toContain('Medical Emergency');
    expect(residentHubHtml).toContain('Fire Alert');
    expect(residentHubHtml).toContain('Security Threat');
    expect(residentHubHtml).toContain('Child Safety SOS');
    expect(residentHubHtml).toContain('Lift Trapped');
    expect(residentHubHtml).toContain('Electrical Hazard');

    // Dead fake MISSING_ALERT modal is gone
    expect(residentHubHtml).not.toContain('High Priority Security Alarm');
    expect(residentHubHtml).not.toContain('HIGH PRIORITY CHILD MISSING ALERT DISPATCHED TO MAIN GATE');

    // 2. Staff view preserves Command Console and Gate Verifier
    for (const role of ['admin', 'secretary', 'guard']) {
      mockUseAuth.mockReturnValue({
        currentUser: { ...residentUser, id: `usr-${role}`, role },
      });
      const staffHtml = renderToStaticMarkup(
        React.createElement(SafetyCommandHub, { initialTab: 'COMMAND_CONSOLE' })
      );
      expect(staffHtml).toContain('Console (');
      expect(staffHtml).toContain('Gate Verifier');
      expect(staffHtml).not.toContain('data-testid="resident-child-safety-panel"');
    }
  });

  test('fails closed (renders empty) for unauthenticated, guard, committee, or vendor users', () => {
    const unauthHtml = renderToStaticMarkup(
      React.createElement(ResidentChildAlertsSection, {
        childrenList: [safeChild],
        currentUser: null,
      })
    );
    expect(unauthHtml).toBe('');

    for (const role of ['guard', 'committee', 'vendor', 'facility_manager']) {
      const html = renderToStaticMarkup(
        React.createElement(ResidentChildAlertsSection, {
          childrenList: [safeChild],
          currentUser: { ...residentUser, role },
        })
      );
      expect(html).toBe('');
    }
  });
});