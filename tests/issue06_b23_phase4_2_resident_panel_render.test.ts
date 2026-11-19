// =============================================================================
// ISSUE-06 Phase B.2.3 — Phase 4.2:
// Real React Component Rendering & Role-Preservation Tests (`SafetyCommandHub` &
// `ResidentChildSafetyPanel` via `react-dom/server` without mocking React).
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

import { SafetyCommandHub } from '../src/domains/safety/components/SafetyCommandHub';
import { ResidentChildSafetyPanel } from '../src/domains/safety/components/ResidentChildSafetyPanel';

describe('ISSUE-06 Phase B.2.3 (Phase 4.2): Component Render & Role Preservation', () => {
  afterEach(() => {
    mockUseAuth.mockReset();
  });

  test('renders ResidentChildSafetyPanel for resident role on CHILD_SAFETY tab with zero demo/hardcoded records and zero Admin/Security tabs', () => {
    mockUseAuth.mockReturnValue({
      currentUser: {
        id: 'usr-res-1',
        name: 'Rohan Sharma',
        phone: '+919876543210',
        role: 'resident',
        societyId: 'soc-alpha',
        flatNumber: 'A-402',
      },
    });

    const html = renderToStaticMarkup(React.createElement(SafetyCommandHub, { initialTab: 'CHILD_SAFETY' }));

    // Resident panel mounted
    expect(html).toContain('data-testid="resident-child-safety-panel"');
    expect(html).toContain('CHILD SAFETY PROFILES');
    expect(html).toContain('Register Child');

    // Zero Admin/Security tabs leaked to resident
    expect(html).not.toContain('Gate Verifier');
    expect(html).not.toContain('Console (');

    // Zero hardcoded demo identities / legacy fake copy
    expect(html).not.toContain('Radha Bai');
    expect(html).not.toContain('Santosh Yadav');
    expect(html).not.toContain('Siddharth Malhotra');
    expect(html).not.toContain('DOB 14 May 2018');
    expect(html).not.toContain('B-1204');
  });

  test('preserves Admin and Security tabs in SafetyCommandHub and never leaks ResidentChildSafetyPanel into Admin or Guard roles', () => {
    for (const role of ['admin', 'secretary', 'guard']) {
      mockUseAuth.mockReturnValue({
        currentUser: {
          id: `usr-${role}-1`,
          name: `Test ${role}`,
          phone: '+919800000001',
          role,
          societyId: 'soc-alpha',
        },
      });

      const html = renderToStaticMarkup(React.createElement(SafetyCommandHub, { initialTab: 'CHILD_SAFETY' }));

      // Admin/Security tabs preserved
      expect(html).toContain('Gate Verifier');
      expect(html).toContain('Console (');

      // Resident-only panel MUST NOT leak into Admin/Secretary/Guard workflows
      expect(html).not.toContain('data-testid="resident-child-safety-panel"');
    }
  });

  test('preserves all 6 general emergency SOS cards on ONE_TAP_SOS tab for ResidentEmergencyPage & AdminSafetyCommandPage', () => {
    mockUseAuth.mockReturnValue({
      currentUser: {
        id: 'usr-res-1',
        name: 'Rohan Sharma',
        phone: '+919876543210',
        role: 'resident',
        societyId: 'soc-alpha',
        flatNumber: 'A-402',
      },
    });

    const html = renderToStaticMarkup(React.createElement(SafetyCommandHub, { initialTab: 'ONE_TAP_SOS' }));

    expect(html).toContain('Medical Emergency');
    expect(html).toContain('Fire Alert');
    expect(html).toContain('Security Threat');
    expect(html).toContain('Child Safety SOS');
    expect(html).toContain('Lift Trapped');
    expect(html).toContain('Electrical Hazard');
  });

  test('ResidentChildSafetyPanel fails closed cleanly when unauthenticated or rendered for unauthorized role', () => {
    mockUseAuth.mockReturnValue({ currentUser: null });
    const unauthHtml = renderToStaticMarkup(React.createElement(ResidentChildSafetyPanel));
    expect(unauthHtml).toContain('data-testid="resident-child-safety-unauthorized"');
    expect(unauthHtml).not.toContain('data-testid="resident-child-safety-panel"');

    mockUseAuth.mockReturnValue({
      currentUser: { id: 'usr-vendor-1', name: 'Vendor', phone: '+9198', role: 'vendor', societyId: 'soc-alpha' },
    });
    const vendorHtml = renderToStaticMarkup(React.createElement(ResidentChildSafetyPanel));
    expect(vendorHtml).toContain('data-testid="resident-child-safety-unauthorized"');
  });
});

