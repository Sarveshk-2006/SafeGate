// =============================================================================
// ISSUE-06 Phase B.2.3 — Phase 4.4:
// Real React SSR Component Render & Role-Preservation Tests for
// `ResidentGatePassesSection`, `ResidentChildSafetyPanel`, and `SafetyCommandHub`.
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

import { ResidentGatePassesSection } from '../src/domains/safety/components/ResidentGatePassesSection';
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

describe('ISSUE-06 Phase B.2.3 (Phase 4.4): Resident Gate Passes Render & Role Preservation', () => {
  afterEach(() => {
    mockUseAuth.mockReset();
  });

  test('renders ResidentGatePassesSection for resident with Generate Gate Pass, Exit History toggle, and zero demo/secret/scanner markup', () => {
    const html = renderToStaticMarkup(
      React.createElement(ResidentGatePassesSection, {
        selectedChild: safeChild,
        currentUser: residentUser,
      })
    );

    expect(html).toContain('data-testid="resident-gate-passes-section"');
    expect(html).toContain('SECURE CHILD GATE PASSES');
    expect(html).toContain('data-testid="generate-gate-pass-btn"');
    expect(html).toContain('data-testid="toggle-exit-logs-btn"');
    expect(html).toContain('Aarav Sharma');

    // Zero hardcoded demo text, fake QR fallback, or secret fields
    expect(html).not.toContain('DWELLORA-QR-PASS');
    expect(html).not.toContain('Radha Bai');
    expect(html).not.toContain('tokenHash');
    expect(html).not.toContain('bearerToken');
    expect(html).not.toContain('Gate Verifier');
  });

  test('blocks Generate Gate Pass button and renders status notice for MISSING and ARCHIVED children', () => {
    const missingHtml = renderToStaticMarkup(
      React.createElement(ResidentGatePassesSection, {
        selectedChild: { ...safeChild, status: 'MISSING' },
        currentUser: residentUser,
      })
    );
    expect(missingHtml).toContain('data-testid="gate-pass-child-blocked-notice"');
    expect(missingHtml).not.toContain('data-testid="generate-gate-pass-btn"');

    const archivedHtml = renderToStaticMarkup(
      React.createElement(ResidentGatePassesSection, {
        selectedChild: { ...safeChild, status: 'ARCHIVED', archivedAt: '2026-11-18T11:00:00.000Z' },
        currentUser: residentUser,
      })
    );
    expect(archivedHtml).toContain('data-testid="gate-pass-child-blocked-notice"');
    expect(archivedHtml).not.toContain('data-testid="generate-gate-pass-btn"');
  });

  test('fails closed (renders empty) for unauthenticated, guard, committee, or vendor users', () => {
    const unauthHtml = renderToStaticMarkup(
      React.createElement(ResidentGatePassesSection, {
        selectedChild: safeChild,
        currentUser: null,
      })
    );
    expect(unauthHtml).toBe('');

    for (const role of ['guard', 'committee', 'vendor']) {
      const html = renderToStaticMarkup(
        React.createElement(ResidentGatePassesSection, {
          selectedChild: safeChild,
          currentUser: { ...residentUser, role },
        })
      );
      expect(html).toBe('');
    }
  });

  test('preserves SafetyCommandHub Admin/Security role boundaries and never leaks ResidentGatePassesSection to staff', () => {
    for (const role of ['admin', 'secretary', 'guard']) {
      mockUseAuth.mockReturnValue({
        currentUser: { ...residentUser, id: `usr-${role}`, role },
      });
      const staffHtml = renderToStaticMarkup(React.createElement(SafetyCommandHub, { initialTab: 'CHILD_SAFETY' }));
      expect(staffHtml).toContain('Gate Verifier');
      expect(staffHtml).toContain('Console (');
      expect(staffHtml).not.toContain('data-testid="resident-gate-passes-section"');
      expect(staffHtml).not.toContain('data-testid="resident-child-safety-panel"');
    }
  });
});

