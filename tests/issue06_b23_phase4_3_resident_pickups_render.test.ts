// =============================================================================
// ISSUE-06 Phase B.2.3 — Phase 4.3:
// Real React SSR Component Render & Role-Preservation Tests for
// `ResidentAuthorizedPickupsSection`, `ResidentChildSafetyPanel`, and `SafetyCommandHub`.
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

import { ResidentAuthorizedPickupsSection } from '../src/domains/safety/components/ResidentAuthorizedPickupsSection';
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

const childAlpha1: ChildProfileDto = {
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

const childAlpha2: ChildProfileDto = {
  ...childAlpha1,
  id: 'chd-2',
  fullName: 'Ananya Sharma',
  reportedAge: 5,
  gender: 'FEMALE',
};

describe('ISSUE-06 Phase B.2.3 (Phase 4.3): Authorized Pickups Render & Role Preservation', () => {
  afterEach(() => {
    mockUseAuth.mockReset();
  });

  test('renders ResidentAuthorizedPickupsSection with multi-child tabs, Add Authorized Pickup action, and zero demo/raw-ID copy', () => {
    const html = renderToStaticMarkup(
      React.createElement(ResidentAuthorizedPickupsSection, {
        childrenList: [childAlpha1, childAlpha2],
        selectedChildId: 'chd-1',
        onSelectChild: jest.fn(),
        currentUser: residentUser,
      })
    );

    expect(html).toContain('data-testid="resident-authorized-pickups-section"');
    expect(html).toContain('AUTHORIZED PICKUP ESCORTS');
    expect(html).toContain('data-testid="pickup-child-tab-chd-1"');
    expect(html).toContain('data-testid="pickup-child-tab-chd-2"');
    expect(html).toContain('Aarav Sharma');
    expect(html).toContain('Ananya Sharma');
    expect(html).toContain('data-testid="add-authorized-pickup-btn"');

    // Zero legacy demo pickup identities or fake ID strings
    expect(html).not.toContain('Radha Bai');
    expect(html).not.toContain('Santosh Yadav');
    expect(html).not.toContain('XXXX-XXXX-9901');
  });

  test('fails closed (renders empty) for unauthenticated, guard, or vendor users', () => {
    const unauthHtml = renderToStaticMarkup(
      React.createElement(ResidentAuthorizedPickupsSection, {
        childrenList: [childAlpha1],
        selectedChildId: 'chd-1',
        onSelectChild: jest.fn(),
        currentUser: null,
      })
    );
    expect(unauthHtml).toBe('');

    for (const role of ['guard', 'vendor']) {
      const html = renderToStaticMarkup(
        React.createElement(ResidentAuthorizedPickupsSection, {
          childrenList: [childAlpha1],
          selectedChildId: 'chd-1',
          onSelectChild: jest.fn(),
          currentUser: { ...residentUser, role },
        })
      );
      expect(html).toBe('');
    }
  });

  test('preserves Phase 4.2 ResidentChildSafetyPanel and SafetyCommandHub role boundaries for resident, admin, secretary, and guard', () => {
    mockUseAuth.mockReturnValue({ currentUser: residentUser });
    const residentHtml = renderToStaticMarkup(React.createElement(SafetyCommandHub, { initialTab: 'CHILD_SAFETY' }));
    expect(residentHtml).toContain('data-testid="resident-child-safety-panel"');
    expect(residentHtml).not.toContain('Gate Verifier');
    expect(residentHtml).not.toContain('Console (');

    for (const role of ['admin', 'secretary', 'guard']) {
      mockUseAuth.mockReturnValue({
        currentUser: { ...residentUser, id: `usr-${role}`, role },
      });
      const staffHtml = renderToStaticMarkup(React.createElement(SafetyCommandHub, { initialTab: 'CHILD_SAFETY' }));
      expect(staffHtml).toContain('Gate Verifier');
      expect(staffHtml).toContain('Console (');
      expect(staffHtml).not.toContain('data-testid="resident-child-safety-panel"');
      expect(staffHtml).not.toContain('data-testid="resident-authorized-pickups-section"');
    }
  });
});

