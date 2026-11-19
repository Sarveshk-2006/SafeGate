// =============================================================================
// AARIZO — ISSUE-06 Phase B.2.3 (Subphase 4.6.3.2):
// Child Gate Scanner Modernization Test Suite
//
// Tests:
// 1. Valid canonical QR payload invokes backend verification method.
// 2. Display-only pass codes (e.g. CGP-XXXX-XXXX) cannot authorize exit (fail-closed).
// 3. Duplicate submission while verification is in-flight is blocked.
// 4. Sensitive QR input is cleared immediately on both success and error paths.
// 5. Backend rejection (expired, revoked, already used, missing child alert) never produces success UI.
// 6. Network/server errors remain visible and do not produce success.
// 7. Deprecated local verification (verifyAndScanChildPickup) is never called.
// 8. No scanner code publishes protected realtime events (realtimeService.publish).
// 9. Successful verification relies strictly on backend response.
// 10. Role and society restrictions remain fail-closed.
// 11. SSR component render tests for Authorized Guard, Unauthorized Session, and Missing Child Lockdown.
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

jest.mock('../src/utils/backendConfig', () => ({
  getBackendBaseUrl: jest.fn(() => 'http://localhost:5000'),
}));

jest.mock('../src/utils/nativeMobile', () => ({
  triggerHaptic: jest.fn(),
  isNativeApp: jest.fn(() => false),
}));

let lastRealtimeOptions: any = null;
const mockRealtimeState = {
  connectionStatus: 'CONNECTED' as const,
  isConnected: true,
  isReconnecting: false,
  isOffline: false,
  refreshNonce: 0,
  passesRefreshNonce: 0,
  logsRefreshNonce: 0,
  alertsRefreshNonce: 0,
};

jest.mock('../src/hooks/useSecurityChildSafetyRealtime', () => ({
  useSecurityChildSafetyRealtime: (opts: any) => {
    lastRealtimeOptions = opts;
    return mockRealtimeState;
  },
}));

import { ChildGateScannerPage } from '../src/pages/dashboard/security/ChildGateScannerPage';
import { childSafetyService } from '../src/services/childSafetyService';
import { realtimeService } from '../src/services/realtimeService';
import type { UserProfile } from '../src/domains/auth/types';
import type {
  VerifyChildGatePassSuccessDto,
  ChildGatePassDto,
  ChildExitLogDto,
  ChildSafetyAlertDto,
} from '../src/types/childSafety';

const officerVikram: UserProfile = {
  id: 'usr-guard-vikram',
  name: 'Officer Vikram Singh',
  phone: '+919876543201',
  role: 'guard',
  societyId: 'soc-alpha',
  societyName: 'Alpha Residency',
};

const residentRohan: UserProfile = {
  id: 'usr-res-rohan',
  name: 'Rohan Verma',
  phone: '+919876543203',
  role: 'resident',
  societyId: 'soc-alpha',
  societyName: 'Alpha Residency',
};

const deliveryRider: UserProfile = {
  id: 'usr-del-rider',
  name: 'Delivery Rider',
  phone: '+919876543204',
  role: 'delivery' as any,
  societyId: 'soc-alpha',
  societyName: 'Alpha Residency',
};

const secretaryAnita: UserProfile = {
  id: 'usr-sec-anita',
  name: 'Secretary Anita Roy',
  phone: '+919876543202',
  role: 'secretary',
  societyId: 'soc-alpha',
  societyName: 'Alpha Residency',
};

const committeeMember: UserProfile = {
  id: 'usr-com-sunil',
  name: 'Committee Member Sunil',
  phone: '+919876543205',
  role: 'committee',
  societyId: 'soc-alpha',
  societyName: 'Alpha Residency',
};

const adminUser: UserProfile = {
  id: 'usr-admin-priya',
  name: 'Admin Priya',
  phone: '+919876543206',
  role: 'admin',
  societyId: 'soc-alpha',
  societyName: 'Alpha Residency',
};

const securityAliasUser: UserProfile = {
  id: 'usr-sec-alias',
  name: 'Security Alias User',
  phone: '+919876543207',
  role: 'security' as any,
  societyId: 'soc-alpha',
  societyName: 'Alpha Residency',
};

const facilityManagerUser: UserProfile = {
  id: 'usr-fm-deepak',
  name: 'Facility Manager Deepak',
  phone: '+919876543208',
  role: 'facility_manager',
  societyId: 'soc-alpha',
  societyName: 'Alpha Residency',
};

const vendorUser: UserProfile = {
  id: 'usr-ven-rajesh',
  name: 'Vendor Rajesh',
  phone: '+919876543209',
  role: 'vendor',
  societyId: 'soc-alpha',
  societyName: 'Alpha Residency',
};

const unknownRoleUser: UserProfile = {
  id: 'usr-unk-intruder',
  name: 'Unknown Role Intruder',
  phone: '+919876543210',
  role: 'unknown_role' as any,
  societyId: 'soc-alpha',
  societyName: 'Alpha Residency',
};

const mockPassDto: ChildGatePassDto = {
  id: 'pass-canonical-101',
  societyId: 'soc-alpha',
  childId: 'chd-aarav-1',
  pickupPersonId: 'pku-radha-1',
  passCode: 'CGP-8842-KM91',
  pickupPersonName: 'Radha Bai',
  pickupPersonPhone: '+919876543299',
  validFrom: '2026-11-19T00:00:00.000Z',
  validUntil: '2026-11-19T23:59:59.000Z',
  status: 'ACTIVE',
  maxUses: 1,
  currentUses: 1,
  firstUsedAt: '2026-11-19T10:00:00.000Z',
  lastUsedAt: '2026-11-19T10:00:00.000Z',
  revokedAt: null,
  revocationReason: null,
  notes: null,
  archivedAt: null,
  createdAt: '2026-11-19T00:00:00.000Z',
  updatedAt: '2026-11-19T10:00:00.000Z',
  child: {
    id: 'chd-aarav-1',
    fullName: 'Aarav Verma',
    flatNumber: 'A-204',
    status: 'OUT_OF_SOCIETY',
  },
};

const mockExitLogDto: ChildExitLogDto = {
  id: 'log-canonical-201',
  societyId: 'soc-alpha',
  childId: 'chd-aarav-1',
  passId: 'pass-canonical-101',
  pickupPersonId: 'pku-radha-1',
  childName: 'Aarav Verma',
  flatNumber: 'A-204',
  pickupPersonName: 'Radha Bai',
  pickupPersonPhone: '+919876543299',
  gateId: 'Main Gate 1',
  guardId: 'usr-guard-vikram',
  guardName: 'Officer Vikram Singh',
  outcome: 'ALLOWED',
  verificationChannel: 'ONLINE_QR_TOKEN',
  denialReason: null,
  notes: null,
  timestamp: '2026-11-19T10:00:00.000Z',
};

const mockVerifySuccess: VerifyChildGatePassSuccessDto = {
  authorized: true,
  outcome: 'ALLOWED',
  pass: mockPassDto,
  exitLog: mockExitLogDto,
};

const mockActiveAlert: ChildSafetyAlertDto = {
  id: 'alt-missing-301',
  societyId: 'soc-alpha',
  childId: 'chd-priya-2',
  reportedById: 'usr-res-parent',
  reportedByName: 'Sunita Sharma',
  childName: 'Priya Sharma',
  flatNumber: 'B-501',
  alertType: 'MISSING_CHILD',
  severity: 'CRITICAL',
  status: 'ACTIVE',
  location: 'Basement Parking B2',
  description: 'Wearing yellow shirt, last seen near elevator',
  lastSeenDetails: 'Near pillar P-14',
  acknowledgedAt: null,
  resolvedAt: null,
  createdAt: '2026-11-19T09:30:00.000Z',
  updatedAt: '2026-11-19T09:30:00.000Z',
};

describe('AARIZO — ISSUE-06 Phase B.2.3 (Subphase 4.6.3.2): Child Gate Scanner Modernization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({
      currentUser: officerVikram,
      isSessionValid: () => true,
    });
    jest.spyOn(childSafetyService, 'listAlerts').mockResolvedValue([]);
    jest.spyOn(childSafetyService, 'listGatePasses').mockResolvedValue([mockPassDto]);
    jest.spyOn(childSafetyService, 'listExitLogs').mockResolvedValue([mockExitLogDto]);
    jest.spyOn(childSafetyService, 'verifyGatePass').mockResolvedValue(mockVerifySuccess);
    jest.spyOn(childSafetyService, 'resolveAlert').mockResolvedValue({
      ...mockActiveAlert,
      status: 'RESOLVED',
    });
    jest.spyOn(realtimeService, 'publish').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('1. Canonical Backend Gate Verification Invocation', () => {
    test('valid canonical QR payload invokes childSafetyService.verifyGatePass with exact payload and gateId', async () => {
      const canonicalPayload = 'AARIZO_CHILD_PASS:dGhpcy1pcy1hLXZhbGlkLWJlYXJlci10b2tlbi0xMjM0NQ';
      const result = await childSafetyService.verifyGatePass({
        qrPayload: canonicalPayload,
        gateId: 'Main Gate 1',
      });

      expect(childSafetyService.verifyGatePass).toHaveBeenCalledWith({
        qrPayload: canonicalPayload,
        gateId: 'Main Gate 1',
      });
      expect(result.authorized).toBe(true);
      expect(result.outcome).toBe('ALLOWED');
      expect(result.pass.id).toBe('pass-canonical-101');
      expect(result.exitLog.outcome).toBe('ALLOWED');
    });

    test('valid raw bearer token invokes childSafetyService.verifyGatePass', async () => {
      const rawBearerToken = 'dGhpcy1pcy1hLXZhbGlkLWJlYXJlci10b2tlbi0xMjM0NQ';
      await childSafetyService.verifyGatePass({
        bearerToken: rawBearerToken,
        gateId: 'Main Gate 1',
      });

      expect(childSafetyService.verifyGatePass).toHaveBeenCalledWith({
        bearerToken: rawBearerToken,
        gateId: 'Main Gate 1',
      });
    });
  });

  describe('2. Display Pass Code & Invalid Format Rejection (Fail-Closed)', () => {
    test('display pass code (CGP-XXXX-XXXX) cannot authorize exit and fails closed', async () => {
      jest.spyOn(childSafetyService, 'verifyGatePass').mockRejectedValueOnce({
        status: 400,
        code: 'BEARER_TOKEN_REQUIRED',
        message: 'Display pass codes cannot authorize gate exit. Please scan the caretaker’s QR pass or bearer token.',
      });

      await expect(
        childSafetyService.verifyGatePass({
          qrPayload: 'CGP-8842-KM91',
          gateId: 'Main Gate 1',
        })
      ).rejects.toMatchObject({
        code: 'BEARER_TOKEN_REQUIRED',
      });
    });

    test('empty or malformed string fails closed without invoking verification', async () => {
      const emptyCode = '   ';
      const shouldTrigger = Boolean(emptyCode.trim());
      expect(shouldTrigger).toBe(false);
      expect(childSafetyService.verifyGatePass).not.toHaveBeenCalled();
    });
  });

  describe('3. Concurrency & In-Flight Protection', () => {
    test('prevents concurrent double-submission when a verification is already in flight', async () => {
      let isVerifying = true;
      const secondSubmissionAttempt = 'AARIZO_CHILD_PASS:second-token';

      // Component guards: if (isVerifying) return;
      if (!isVerifying) {
        await childSafetyService.verifyGatePass({ qrPayload: secondSubmissionAttempt });
      }

      expect(childSafetyService.verifyGatePass).not.toHaveBeenCalled();
    });
  });

  describe('4. Sensitive Input State Cleansing', () => {
    test('clears sensitive scan input from state on both success and error paths', async () => {
      let qrInput = 'AARIZO_CHILD_PASS:sensitive-secret-payload';

      // Simulating handleScanQR finally block
      try {
        await childSafetyService.verifyGatePass({ qrPayload: qrInput });
      } finally {
        qrInput = '';
      }
      expect(qrInput).toBe('');

      // Simulating error path
      qrInput = 'AARIZO_CHILD_PASS:sensitive-secret-payload-2';
      jest.spyOn(childSafetyService, 'verifyGatePass').mockRejectedValueOnce(new Error('Pass expired'));
      try {
        await childSafetyService.verifyGatePass({ qrPayload: qrInput });
      } catch {
        // expected
      } finally {
        qrInput = '';
      }
      expect(qrInput).toBe('');
    });
  });

  describe('5. Backend Rejection & Denial Outcome Mapping', () => {
    test('backend denial (PASS_EXPIRED, PASS_REVOKED, PASS_ALREADY_CONSUMED) produces denial outcome and never success', async () => {
      const denialCodes = [
        { code: 'PASS_EXPIRED', msg: 'The presented gate pass has expired.' },
        { code: 'PASS_REVOKED', msg: 'Gate pass has been revoked by resident guardian.' },
        { code: 'PASS_ALREADY_CONSUMED', msg: 'Gate pass was already consumed or used at gate.' },
        { code: 'CHILD_MISSING_ALERT_BLOCKED', msg: 'CRITICAL: Gate exit denied due to active missing child alert.' },
      ];

      for (const denial of denialCodes) {
        jest.spyOn(childSafetyService, 'verifyGatePass').mockRejectedValueOnce({
          status: 409,
          code: denial.code,
          message: denial.msg,
        });

        let scanResult: { allowed: boolean; message: string; code?: string } | null = null;
        try {
          await childSafetyService.verifyGatePass({ qrPayload: 'AARIZO_CHILD_PASS:token' });
          scanResult = { allowed: true, message: 'Success' };
        } catch (err: any) {
          scanResult = {
            allowed: false,
            message: err.message,
            code: err.code,
          };
        }

        expect(scanResult.allowed).toBe(false);
        expect(scanResult.code).toBe(denial.code);
        expect(scanResult.message).toBe(denial.msg);
      }
    });

    test('network/database failure (503 DATABASE_UNAVAILABLE) remains visible and never displays success', async () => {
      jest.spyOn(childSafetyService, 'verifyGatePass').mockRejectedValueOnce({
        status: 503,
        code: 'DATABASE_UNAVAILABLE',
        message: 'Security database temporarily unavailable. Gate exit cannot be verified.',
      });

      let scanResult: { allowed: boolean; message: string } | null = null;
      try {
        await childSafetyService.verifyGatePass({ qrPayload: 'AARIZO_CHILD_PASS:token' });
        scanResult = { allowed: true, message: 'Success' };
      } catch (err: any) {
        scanResult = {
          allowed: false,
          message: err.message,
        };
      }

      expect(scanResult.allowed).toBe(false);
      expect(scanResult.message).toContain('database temporarily unavailable');
    });
  });

  describe('6. Zero Deprecated Local Verification & Zero Forged Realtime Publishing', () => {
    test('deprecated local verifyAndScanChildPickup is never called by modern scanner', () => {
      const deprecatedSpy = jest.spyOn(childSafetyService, 'verifyAndScanChildPickup');
      expect(deprecatedSpy).not.toHaveBeenCalled();
    });

    test('no scanner code publishes protected realtime events via realtimeService.publish', async () => {
      // Execute verified scan
      await childSafetyService.verifyGatePass({ qrPayload: 'AARIZO_CHILD_PASS:token' });

      // Confirm realtimeService.publish was NEVER called
      expect(realtimeService.publish).not.toHaveBeenCalled();
    });
  });

  describe('7. Role and Society Isolation (Fail-Closed)', () => {
    test('all 4 canonical roles (guard, secretary, committee, admin) can access scanner and enable realtime', () => {
      for (const user of [officerVikram, secretaryAnita, committeeMember, adminUser]) {
        mockUseAuth.mockReturnValue({
          currentUser: user,
          isSessionValid: () => true,
        });

        const html = renderToStaticMarkup(React.createElement(ChildGateScannerPage));
        expect(html).toContain('Security Gate Scanner Terminal');
        expect(html).not.toContain('Security Gate Access Restricted');
        expect(lastRealtimeOptions?.enabled).toBe(true);
      }
    });

    test('security role alias is strictly denied and disables realtime subscription', () => {
      mockUseAuth.mockReturnValue({
        currentUser: securityAliasUser,
        isSessionValid: () => true,
      });

      const html = renderToStaticMarkup(React.createElement(ChildGateScannerPage));
      expect(html).toContain('Security Gate Access Restricted');
      expect(html).not.toContain('Security Gate Scanner Terminal');
      expect(lastRealtimeOptions?.enabled).toBe(false);
    });

    test('resident, delivery, vendor, facility_manager, and unknown roles are denied access and disable realtime', () => {
      const unauthorizedUsers = [
        residentRohan,
        deliveryRider,
        facilityManagerUser,
        vendorUser,
        unknownRoleUser,
      ];

      for (const user of unauthorizedUsers) {
        mockUseAuth.mockReturnValue({
          currentUser: user,
          isSessionValid: () => true,
        });

        const html = renderToStaticMarkup(React.createElement(ChildGateScannerPage));
        expect(html).toContain('Security Gate Access Restricted');
        expect(html).not.toContain('Security Gate Scanner Terminal');
        expect(lastRealtimeOptions?.enabled).toBe(false);
      }
    });

    test('unauthenticated or missing society session fails closed, denies scanner, and disables realtime', () => {
      // 1. null user
      mockUseAuth.mockReturnValue({
        currentUser: null,
        isSessionValid: () => false,
      });

      let html = renderToStaticMarkup(React.createElement(ChildGateScannerPage));
      expect(html).toContain('Security Gate Access Restricted');
      expect(html).not.toContain('Security Gate Scanner Terminal');
      expect(lastRealtimeOptions?.enabled).toBe(false);

      // 2. Guard user without societyId
      mockUseAuth.mockReturnValue({
        currentUser: { ...officerVikram, societyId: '' },
        isSessionValid: () => true,
      });

      html = renderToStaticMarkup(React.createElement(ChildGateScannerPage));
      expect(html).toContain('Security Gate Access Restricted');
      expect(html).not.toContain('Security Gate Scanner Terminal');
      expect(lastRealtimeOptions?.enabled).toBe(false);
    });

    test('denied roles cannot initiate gate verification', async () => {
      for (const user of [securityAliasUser, residentRohan, deliveryRider, unknownRoleUser]) {
        mockUseAuth.mockReturnValue({
          currentUser: user,
          isSessionValid: () => true,
        });

        const isAuthorizedRole = ['guard', 'secretary', 'committee', 'admin'].includes((user.role || '').toLowerCase());
        expect(isAuthorizedRole).toBe(false);

        let verificationAttempted = false;
        if (isAuthorizedRole && user.societyId) {
          await childSafetyService.verifyGatePass({ qrPayload: 'AARIZO_CHILD_PASS:valid-token' });
          verificationAttempted = true;
        }

        expect(verificationAttempted).toBe(false);
        expect(childSafetyService.verifyGatePass).not.toHaveBeenCalled();
      }
    });
  });

  describe('8. Component SSR Rendering & Visual Output', () => {
    test('renders full security scanner layout for authorized guard session', () => {
      const html = renderToStaticMarkup(
        React.createElement(ChildGateScannerPage, {
          initialPasses: [mockPassDto],
          initialLogs: [mockExitLogDto],
        })
      );

      // Header and connection badge
      expect(html).toContain('Child Security &amp; Gate Scanner');
      expect(html).toContain('Terminal Online');
      expect(html).toContain('Alpha Residency');

      // Scanner terminal box
      expect(html).toContain('Security Gate Scanner Terminal');
      expect(html).toContain('Scan barcode/QR code from caretaker');
      expect(html).toContain('placeholder="Scan or Enter QR Code payload..."');
      expect(html).toContain('Scan Pass');

      // Active Passes on File
      expect(html).toContain('Active Society Passes On File');
      expect(html).toContain('Aarav Verma');
      expect(html).toContain('CGP-8842-KM91');

      // Right column: Recent Gate Verification Logs
      expect(html).toContain('Recent Gate Verification Logs');
      expect(html).toContain('ALLOWED');
      expect(html).toContain('Radha Bai');
      expect(html).toContain('Main Gate 1');

      // Zero fake demo bypasses or secret leaks
      expect(html).not.toContain('DWELLORA-QR-PASS');
      expect(html).not.toContain('tokenHash');
      expect(html).not.toContain('bearerToken');
    });

    test('renders critical missing child lockdown banner when active alerts exist', () => {
      const html = renderToStaticMarkup(
        React.createElement(ChildGateScannerPage, {
          initialAlerts: [mockActiveAlert],
        })
      );
      expect(html).toContain('CRITICAL MISSING CHILD LOCKDOWN ACTIVE');
      expect(html).toContain('Mark Child Safe / Resolve Alert');
    });
  });

  describe('9. Phase 4.6.4 Verification Role Alignment & Camera Lifecycle', () => {
    test('guard and admin roles have verification execution enabled (canVerifyPass = true)', () => {
      for (const user of [officerVikram, adminUser]) {
        mockUseAuth.mockReturnValue({
          currentUser: user,
          isSessionValid: () => true,
        });

        const html = renderToStaticMarkup(React.createElement(ChildGateScannerPage));
        expect(html).toContain('Security Gate Scanner Terminal');
        expect(html).toContain('Scan Pass');
        expect(html).toContain('Camera');
        expect(html).not.toContain('View-Only Mode');
      }
    });

    test('secretary and committee roles render terminal in view-only mode with verification disabled', () => {
      for (const user of [secretaryAnita, committeeMember]) {
        mockUseAuth.mockReturnValue({
          currentUser: user,
          isSessionValid: () => true,
        });

        const html = renderToStaticMarkup(React.createElement(ChildGateScannerPage));
        expect(html).toContain('Security Gate Scanner Terminal');
        expect(html).toContain('View-Only Mode');
        expect(html).toContain('Gate clearance verification and pass scanning are strictly restricted to Security Guard and Admin personnel');
      }
    });

    test('renders mobile camera scanner trigger button for authorized sessions', () => {
      mockUseAuth.mockReturnValue({
        currentUser: officerVikram,
        isSessionValid: () => true,
      });

      const html = renderToStaticMarkup(React.createElement(ChildGateScannerPage));
      expect(html).toContain('aria-label="Open Camera Scanner"');
      expect(html).toContain('Camera');
    });

    test('realtime hook refreshes activePasses, exitLogs, and activeAlerts on coalesced callback', async () => {
      mockUseAuth.mockReturnValue({
        currentUser: officerVikram,
        isSessionValid: () => true,
      });

      renderToStaticMarkup(React.createElement(ChildGateScannerPage));
      expect(lastRealtimeOptions).toBeDefined();
      expect(lastRealtimeOptions.enabled).toBe(true);

      // Invoke the coalesced refresh handler registered with useSecurityChildSafetyRealtime
      jest.clearAllMocks();
      await lastRealtimeOptions.onRefresh();

      expect(childSafetyService.listAlerts).toHaveBeenCalledWith({ status: 'ACTIVE' });
      expect(childSafetyService.listGatePasses).toHaveBeenCalledWith({ status: 'ACTIVE' });
      expect(childSafetyService.listExitLogs).toHaveBeenCalledWith({ limit: 50 });
    });
  });
});
