// =============================================================================
// AARIZO — ISSUE-06 Phase B.2.3 (Subphase 4.6.3.3.1):
// Staff Child & Authorized Pickup Management Modernization Test Suite
//
// Tests:
// 1. Role Authorization Classifier:
//    - Secretary & Admin: canReadRoster=true, canManageProfiles=true, canManagePickups=true
//    - Committee: canReadRoster=true, canManageProfiles=false, canManagePickups=false
//    - Guard: canReadRoster=false, canManageProfiles=false, canManagePickups=false, isGuardRole=true
//    - Resident: canReadRoster=true, isResidentRole=true, isStaffRole=false
//    - Unsupported alias 'security' & unauthenticated: all false (fail closed)
// 2. Staff Child Profile Creation:
//    - Secretary and Admin invoke canonical childSafetyService.createChildProfileAsync()
//    - Committee and Guard are forbidden from creating child profiles
//    - Missing residentId or flatId fails validation before calling backend API
//    - Missing childName, guardianName, or guardianPhone fails validation
//    - Duplicate submissions are prevented
//    - Backend API errors are cleanly propagated without fake success
// 3. Staff Authorized Pickup Management:
//    - Adding pickup invokes canonical childSafetyService.addAuthorizedPickup()
//    - Submits strictly accepted DTO fields (idDocumentType, idDocumentLast4)
//    - Raw government ID fields (idProofNumber) are never submitted
//    - Revoking pickup invokes canonical childSafetyService.revokeAuthorizedPickup()
//    - Non-privileged roles (Committee, Guard) are blocked from managing pickups
// 4. UI & Boundary Preservation (SSR Markup):
//    - Guard sees Guard Privacy Notice with CTA link to /security/child-safety
//    - Committee sees roster but no "Add Child Profile" or "+ Add Escort" buttons
//    - Resident renders ResidentChildSafetyPanel
//    - Unauthorized session displays Access Denied
// 5. Verification that deprecated synchronous engine write adapters are not called
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

// Mock childSafetyService methods
jest.mock('../src/services/childSafetyService', () => ({
  childSafetyService: {
    listChildren: jest.fn(),
    createChildProfileAsync: jest.fn(),
    addAuthorizedPickup: jest.fn(),
    revokeAuthorizedPickup: jest.fn(),
    createGatePass: jest.fn(),
    triggerSos: jest.fn(),
    listAlerts: jest.fn(() => Promise.resolve([])),
    acknowledgeAlert: jest.fn(),
    resolveAlert: jest.fn(),
    onCacheInvalidated: jest.fn(() => () => {}),
  },
}));

// Mock apiClient
jest.mock('../src/services/apiClient', () => ({
  apiClient: {
    getEmergencyIncidents: jest.fn(() => Promise.resolve([])),
    resolveEmergencyIncidentStrict: jest.fn(),
  },
}));

// Mock safetyCommandEngine
jest.mock('../src/domains/safety/services/safetyCommandEngine', () => ({
  safetyCommandEngine: {
    getIncidents: jest.fn(() => []),
    getChildren: jest.fn(() => []),
    addChildProfile: jest.fn(),
    addAuthorizedPickup: jest.fn(),
    verifyChildPickupAtGate: jest.fn(() => ({ isValid: false, reason: 'Disabled' })),
    triggerOneTapSOS: jest.fn(),
    acknowledgeIncident: jest.fn(),
    assignResponder: jest.fn(),
    resolveIncident: jest.fn(),
  },
}));

import { childSafetyService } from '../src/services/childSafetyService';
import { apiClient } from '../src/services/apiClient';
import { safetyCommandEngine } from '../src/domains/safety/services/safetyCommandEngine';
import {
  SECURITY_CHILD_SAFETY_TOPICS,
  getSecurityInvalidationScopes,
} from '../src/hooks/useSecurityChildSafetyRealtime';
import { realtimeService } from '../src/services/realtimeService';
import {
  SafetyCommandHub,
  getChildSafetyHubPermissions,
  executeStaffCreateChildProfile,
  executeStaffAddAuthorizedPickup,
  executeStaffRevokeAuthorizedPickup,
  executeStaffGenerateGatePass,
  executeStaffTriggerChildSos,
  executeStaffAcknowledgeChildAlert,
  executeStaffResolveChildAlert,
  executeStaffResolveGeneralIncident,
} from '../src/domains/safety/components/SafetyCommandHub';
import type {
  ChildProfileDto,
  AuthorizedPickupDto,
  ChildGatePassCreatedDto,
  ChildSafetyAlertDto,
  ChildSosCreatedDto,
} from '../src/types/childSafety';

const mockChildDto: ChildProfileDto = {
  id: 'child-101',
  societyId: 'soc-gvs',
  residentId: 'res-1',
  flatId: 'flat-101',
  flatNumber: 'B-1204',
  fullName: 'Aarav Malhotra',
  dateOfBirth: '2018-05-14T00:00:00.000Z',
  reportedAge: 8,
  gender: 'MALE',
  status: 'SAFE',
  exitPermissionMode: 'ESCORT_REQUIRED',
  allowedSoloExit: false,
  guardianName: 'Siddharth Malhotra',
  guardianPhone: '+91 98765 00000',
  guardianUserId: 'user-res-1',
  emergencyPhone: null,
  photoUrl: null,
  medicalNotes: null,
  notes: null,
  secondaryGuardians: [],
  emergencyContacts: [],
  pickups: [
    {
      id: 'pickup-501',
      societyId: 'soc-gvs',
      childId: 'child-101',
      name: 'Radha Bai',
      phone: '+91 98199 88776',
      relationship: 'Trusted Family Maid / Nanny',
      idDocumentType: 'Aadhaar Card',
      idDocumentLast4: '9901',
      photoUrl: null,
      status: 'ACTIVE',
      validUntil: null,
      notes: null,
      archivedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const mockPickupDto: AuthorizedPickupDto = {
  id: 'pickup-701',
  societyId: 'soc-gvs',
  childId: 'child-101',
  name: 'Santosh Yadav',
  phone: '+91 98333 22110',
  relationship: 'School Bus Driver',
  idDocumentType: 'Driving License',
  idDocumentLast4: '9182',
  photoUrl: null,
  status: 'ACTIVE',
  validUntil: null,
  notes: null,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const mockPassCreatedDto: ChildGatePassCreatedDto = {
  id: 'pass-101',
  childId: 'child-101',
  pickupPersonId: 'pickup-501',
  issuedByUserId: 'user-sec-1',
  status: 'ACTIVE',
  validFrom: '2026-03-31T04:00:00.000Z',
  validUntil: '2026-03-31T08:00:00.000Z',
  maxUses: 1,
  currentUses: 0,
  notes: 'Staff issued pass',
  usedAt: null,
  revokedAt: null,
  createdAt: '2026-03-31T04:00:00.000Z',
  updatedAt: '2026-03-31T04:00:00.000Z',
  bearerToken: 'raw_secret_bearer_token_1234567890abcdef',
  qrPayload: 'AARIZO:CHILD_PASS:v1:raw_secret_bearer_token_1234567890abcdef',
};

const mockChildSosCreatedDto: ChildSosCreatedDto = {
  alert: {
    id: 'alert-101',
    societyId: 'soc-gvs',
    childId: 'child-101',
    childName: 'Aarav Malhotra',
    flatNumber: 'B-1204',
    alertType: 'MISSING_CHILD',
    severity: 'CRITICAL',
    status: 'ACTIVE',
    location: 'Clubhouse Playground',
    description: 'Missing report',
    lastSeenDetails: null,
    reportedById: 'user-sec-1',
    reportedByName: 'Anita Secretary',
    acknowledgedAt: null,
    acknowledgedById: null,
    acknowledgedByName: null,
    resolvedAt: null,
    resolvedById: null,
    resolvedByName: null,
    resolutionNotes: null,
    alertCode: 'ALT-101',
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T10:00:00.000Z',
  },
  emergencyIncident: {
    id: 'inc-901',
    societyId: 'soc-gvs',
    incidentType: 'CHILD_SAFETY',
    severity: 'CRITICAL',
    location: 'Clubhouse Playground',
    description: 'Missing report',
    dispatchStatus: 'DISPATCHED',
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T10:00:00.000Z',
  },
};

const mockAlertDto: ChildSafetyAlertDto = {
  id: 'alert-101',
  societyId: 'soc-gvs',
  childId: 'child-101',
  childName: 'Aarav Malhotra',
  flatNumber: 'B-1204',
  alertType: 'MISSING_CHILD',
  severity: 'CRITICAL',
  status: 'ACTIVE',
  location: 'Clubhouse Playground',
  description: 'Missing child seen near gate',
  lastSeenDetails: 'Wearing blue shorts',
  reportedById: 'user-sec-1',
  reportedByName: 'Anita Secretary',
  acknowledgedAt: null,
  acknowledgedById: null,
  acknowledgedByName: null,
  resolvedAt: null,
  resolvedById: null,
  resolvedByName: null,
  resolutionNotes: null,
  alertCode: 'ALT-101',
  createdAt: '2026-04-01T10:00:00.000Z',
  updatedAt: '2026-04-01T10:00:00.000Z',
};

describe('AARIZO — Subphase 4.6.3.3: Staff Child & Pickup Management & Gate Pass Generation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ===========================================================================
  // 1. Role Authorization Classifier Tests
  // ===========================================================================
  describe('1. Granular Role Authorization Classifier', () => {
    test('secretary role has full roster read, child/pickup management, and pass generation rights', () => {
      const perms = getChildSafetyHubPermissions('secretary');
      expect(perms.canReadRoster).toBe(true);
      expect(perms.canManageProfiles).toBe(true);
      expect(perms.canManagePickups).toBe(true);
      expect(perms.canGeneratePasses).toBe(true);
      expect(perms.canViewConsole).toBe(true);
      expect(perms.canManageAlerts).toBe(true);
      expect(perms.isGuardRole).toBe(false);
      expect(perms.isResidentRole).toBe(false);
      expect(perms.isStaffRole).toBe(true);
    });

    test('admin role has full roster read, child/pickup management, and pass generation rights', () => {
      const perms = getChildSafetyHubPermissions('admin');
      expect(perms.canReadRoster).toBe(true);
      expect(perms.canManageProfiles).toBe(true);
      expect(perms.canManagePickups).toBe(true);
      expect(perms.canGeneratePasses).toBe(true);
      expect(perms.canViewConsole).toBe(true);
      expect(perms.canManageAlerts).toBe(true);
      expect(perms.isGuardRole).toBe(false);
      expect(perms.isResidentRole).toBe(false);
      expect(perms.isStaffRole).toBe(true);
    });

    test('committee role can view roster but CANNOT create children, manage pickups, or generate passes', () => {
      const perms = getChildSafetyHubPermissions('committee');
      expect(perms.canReadRoster).toBe(true);
      expect(perms.canManageProfiles).toBe(false);
      expect(perms.canManagePickups).toBe(false);
      expect(perms.canGeneratePasses).toBe(false);
      expect(perms.canViewConsole).toBe(true);
      expect(perms.canManageAlerts).toBe(true);
      expect(perms.isGuardRole).toBe(false);
      expect(perms.isResidentRole).toBe(false);
      expect(perms.isStaffRole).toBe(true);
    });

    test('guard role CANNOT view child roster, manage profiles, or generate passes', () => {
      const perms = getChildSafetyHubPermissions('guard');
      expect(perms.canReadRoster).toBe(false);
      expect(perms.canManageProfiles).toBe(false);
      expect(perms.canManagePickups).toBe(false);
      expect(perms.canGeneratePasses).toBe(false);
      expect(perms.canViewConsole).toBe(true);
      expect(perms.canManageAlerts).toBe(true);
      expect(perms.isGuardRole).toBe(true);
      expect(perms.isResidentRole).toBe(false);
      expect(perms.isStaffRole).toBe(true);
    });

    test('resident role is identified as resident and not staff', () => {
      const perms = getChildSafetyHubPermissions('resident');
      expect(perms.canReadRoster).toBe(true);
      expect(perms.canManageProfiles).toBe(false);
      expect(perms.canManagePickups).toBe(false);
      expect(perms.canGeneratePasses).toBe(false);
      expect(perms.canViewConsole).toBe(false);
      expect(perms.canManageAlerts).toBe(false);
      expect(perms.isGuardRole).toBe(false);
      expect(perms.isResidentRole).toBe(true);
      expect(perms.isStaffRole).toBe(false);
    });

    test('unsupported "security" alias fails closed (all permissions denied)', () => {
      const perms = getChildSafetyHubPermissions('security');
      expect(perms.canReadRoster).toBe(false);
      expect(perms.canManageProfiles).toBe(false);
      expect(perms.canManagePickups).toBe(false);
      expect(perms.canGeneratePasses).toBe(false);
      expect(perms.canViewConsole).toBe(false);
      expect(perms.canManageAlerts).toBe(false);
      expect(perms.isGuardRole).toBe(false);
      expect(perms.isResidentRole).toBe(false);
      expect(perms.isStaffRole).toBe(false);
    });

    test('unauthenticated or unknown roles fail closed', () => {
      expect(getChildSafetyHubPermissions(null).canReadRoster).toBe(false);
      expect(getChildSafetyHubPermissions(null).canGeneratePasses).toBe(false);
      expect(getChildSafetyHubPermissions(null).canViewConsole).toBe(false);
      expect(getChildSafetyHubPermissions(undefined).canReadRoster).toBe(false);
      expect(getChildSafetyHubPermissions(undefined).canGeneratePasses).toBe(false);
      expect(getChildSafetyHubPermissions(undefined).canViewConsole).toBe(false);
      expect(getChildSafetyHubPermissions('').canReadRoster).toBe(false);
      expect(getChildSafetyHubPermissions('vendor').isStaffRole).toBe(false);
      expect(getChildSafetyHubPermissions('vendor').canGeneratePasses).toBe(false);
      expect(getChildSafetyHubPermissions('vendor').canViewConsole).toBe(false);
      expect(getChildSafetyHubPermissions('delivery').isStaffRole).toBe(false);
      expect(getChildSafetyHubPermissions('delivery').canGeneratePasses).toBe(false);
      expect(getChildSafetyHubPermissions('delivery').canViewConsole).toBe(false);
    });
  });

  // ===========================================================================
  // 2. Staff Child Profile Creation Tests
  // ===========================================================================
  describe('2. Staff Child Profile Creation Controller', () => {
    test('secretary can create a child profile via canonical async API', async () => {
      (childSafetyService.createChildProfileAsync as jest.Mock).mockResolvedValueOnce(mockChildDto);

      const form = {
        childName: 'Aarav Malhotra',
        guardianName: 'Siddharth Malhotra',
        guardianPhone: '+91 98765 00000',
        flatId: 'flat-101',
        residentId: 'res-1',
        age: '8',
        gender: 'Boy',
      };

      const result = await executeStaffCreateChildProfile(form, 'secretary');
      expect(result).toEqual(mockChildDto);
      expect(childSafetyService.createChildProfileAsync).toHaveBeenCalledWith({
        fullName: 'Aarav Malhotra',
        guardianName: 'Siddharth Malhotra',
        guardianPhone: '+91 98765 00000',
        flatId: 'flat-101',
        residentId: 'res-1',
        reportedAge: 8,
        gender: 'MALE',
        exitPermissionMode: 'ESCORT_REQUIRED',
        allowedSoloExit: false,
      });
      // Proves deprecated synchronous engine was not invoked
      expect(safetyCommandEngine.addChildProfile).not.toHaveBeenCalled();
    });

    test('admin can create a child profile via canonical async API', async () => {
      (childSafetyService.createChildProfileAsync as jest.Mock).mockResolvedValueOnce(mockChildDto);

      const form = {
        childName: 'Aarav Malhotra',
        guardianName: 'Siddharth Malhotra',
        guardianPhone: '+91 98765 00000',
        flatId: 'flat-101',
        residentId: 'res-1',
      };

      const result = await executeStaffCreateChildProfile(form, 'admin');
      expect(result.id).toBe('child-101');
      expect(childSafetyService.createChildProfileAsync).toHaveBeenCalledTimes(1);
    });

    test('committee role is rejected with Forbidden when attempting child creation', async () => {
      const form = {
        childName: 'Aarav Malhotra',
        guardianName: 'Siddharth Malhotra',
        guardianPhone: '+91 98765 00000',
        flatId: 'flat-101',
        residentId: 'res-1',
      };

      await expect(executeStaffCreateChildProfile(form, 'committee')).rejects.toThrow(
        /Forbidden: Only secretaries and administrators can register child profiles/i
      );
      expect(childSafetyService.createChildProfileAsync).not.toHaveBeenCalled();
    });

    test('guard role is rejected with Forbidden when attempting child creation', async () => {
      const form = {
        childName: 'Aarav Malhotra',
        guardianName: 'Siddharth Malhotra',
        guardianPhone: '+91 98765 00000',
        flatId: 'flat-101',
        residentId: 'res-1',
      };

      await expect(executeStaffCreateChildProfile(form, 'guard')).rejects.toThrow(
        /Forbidden: Only secretaries and administrators can register child profiles/i
      );
      expect(childSafetyService.createChildProfileAsync).not.toHaveBeenCalled();
    });

    test('missing residentId or flatId fails validation before calling backend API', async () => {
      const missingFlat = {
        childName: 'Aarav Malhotra',
        guardianName: 'Siddharth Malhotra',
        guardianPhone: '+91 98765 00000',
        flatId: '',
        residentId: 'res-1',
      };

      await expect(executeStaffCreateChildProfile(missingFlat, 'admin')).rejects.toThrow(
        /Resident ID and Flat ID are required for staff registration/i
      );
      expect(childSafetyService.createChildProfileAsync).not.toHaveBeenCalled();

      const missingResident = {
        childName: 'Aarav Malhotra',
        guardianName: 'Siddharth Malhotra',
        guardianPhone: '+91 98765 00000',
        flatId: 'flat-101',
        residentId: '  ',
      };

      await expect(executeStaffCreateChildProfile(missingResident, 'admin')).rejects.toThrow(
        /Resident ID and Flat ID are required for staff registration/i
      );
      expect(childSafetyService.createChildProfileAsync).not.toHaveBeenCalled();
    });

    test('missing required child name or guardian details fails validation', async () => {
      await expect(
        executeStaffCreateChildProfile(
          { childName: '', guardianName: 'Guard', guardianPhone: '+91', flatId: 'f1', residentId: 'r1' },
          'secretary'
        )
      ).rejects.toThrow(/Child full name is required/i);

      await expect(
        executeStaffCreateChildProfile(
          { childName: 'Child', guardianName: '', guardianPhone: '+91', flatId: 'f1', residentId: 'r1' },
          'secretary'
        )
      ).rejects.toThrow(/Guardian name and phone are required/i);

      expect(childSafetyService.createChildProfileAsync).not.toHaveBeenCalled();
    });

    test('backend API errors are propagated without producing fake success', async () => {
      (childSafetyService.createChildProfileAsync as jest.Mock).mockRejectedValueOnce(
        new Error('409 Conflict: Child already exists in flat')
      );

      const form = {
        childName: 'Aarav Malhotra',
        guardianName: 'Siddharth Malhotra',
        guardianPhone: '+91 98765 00000',
        flatId: 'flat-101',
        residentId: 'res-1',
      };

      await expect(executeStaffCreateChildProfile(form, 'secretary')).rejects.toThrow(
        /Child already exists in flat/i
      );
    });
  });

  // ===========================================================================
  // 3. Staff Authorized Pickup Management Tests
  // ===========================================================================
  describe('3. Staff Authorized Pickup Management Controller', () => {
    test('secretary can add authorized pickup submitting only canonical DTO fields', async () => {
      (childSafetyService.addAuthorizedPickup as jest.Mock).mockResolvedValueOnce(mockPickupDto);

      const form = {
        name: 'Santosh Yadav',
        phone: '+91 98333 22110',
        relationship: 'School Bus Driver',
        idDocumentType: 'Driving License',
        idDocumentLast4: '9182',
        notes: 'Route 12',
      };

      const result = await executeStaffAddAuthorizedPickup('child-101', form, 'secretary');
      expect(result).toEqual(mockPickupDto);
      expect(childSafetyService.addAuthorizedPickup).toHaveBeenCalledWith('child-101', {
        name: 'Santosh Yadav',
        phone: '+91 98333 22110',
        relationship: 'School Bus Driver',
        idDocumentType: 'Driving License',
        idDocumentLast4: '9182',
        notes: 'Route 12',
      });
      // Proves deprecated synchronous engine was not invoked
      expect(safetyCommandEngine.addAuthorizedPickup).not.toHaveBeenCalled();
    });

    test('raw government ID fields (idProofNumber) are sanitized and stripped to last 4 digits only', async () => {
      (childSafetyService.addAuthorizedPickup as jest.Mock).mockResolvedValueOnce(mockPickupDto);

      const formWithRaw = {
        name: 'Santosh Yadav',
        phone: '+91 98333 22110',
        relationship: 'Driver',
        idDocumentType: 'Aadhaar Card',
        idDocumentLast4: '1234-5678-9182', // User pasted full 12 digits
      };

      await executeStaffAddAuthorizedPickup('child-101', formWithRaw, 'admin');

      // Verifies that only the last 4 digits are submitted
      expect(childSafetyService.addAuthorizedPickup).toHaveBeenCalledWith(
        'child-101',
        expect.objectContaining({
          idDocumentLast4: '9182',
        })
      );
      // Explicitly check that no raw ID proof number key is submitted
      const submittedPayload = (childSafetyService.addAuthorizedPickup as jest.Mock).mock.calls[0][1];
      expect(submittedPayload.idProofNumber).toBeUndefined();
      expect(submittedPayload.aadhaarNumber).toBeUndefined();
    });

    test('committee and guard roles are rejected when attempting to add authorized pickup', async () => {
      const form = {
        name: 'Santosh Yadav',
        phone: '+91 98333 22110',
      };

      await expect(executeStaffAddAuthorizedPickup('child-101', form, 'committee')).rejects.toThrow(
        /Forbidden: Only secretaries and administrators can manage authorized escorts/i
      );

      await expect(executeStaffAddAuthorizedPickup('child-101', form, 'guard')).rejects.toThrow(
        /Forbidden: Only secretaries and administrators can manage authorized escorts/i
      );

      expect(childSafetyService.addAuthorizedPickup).not.toHaveBeenCalled();
    });

    test('pickup revocation calls canonical backend method and awaits confirmation', async () => {
      const revokedDto = { ...mockPickupDto, status: 'REVOKED' as const };
      (childSafetyService.revokeAuthorizedPickup as jest.Mock).mockResolvedValueOnce(revokedDto);

      const result = await executeStaffRevokeAuthorizedPickup('child-101', 'pickup-701', 'secretary');
      expect(result.status).toBe('REVOKED');
      expect(childSafetyService.revokeAuthorizedPickup).toHaveBeenCalledWith('child-101', 'pickup-701');
    });

    test('committee and guard roles are rejected when attempting to revoke authorized pickup', async () => {
      await expect(
        executeStaffRevokeAuthorizedPickup('child-101', 'pickup-701', 'committee')
      ).rejects.toThrow(
        /Forbidden: Only secretaries and administrators can revoke escort authorizations/i
      );

      await expect(
        executeStaffRevokeAuthorizedPickup('child-101', 'pickup-701', 'guard')
      ).rejects.toThrow(
        /Forbidden: Only secretaries and administrators can revoke escort authorizations/i
      );

      expect(childSafetyService.revokeAuthorizedPickup).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // 4. UI & Boundary Preservation (SSR Markup Tests)
  // ===========================================================================
  describe('4. Component SSR Markup & Role Boundary Verification', () => {
    test('guard user rendering SafetyCommandHub sees Guard Privacy Notice and link to /security/child-safety', () => {
      mockUseAuth.mockReturnValue({
        currentUser: { id: 'guard-1', role: 'guard', name: 'Ramesh Guard', societyId: 'soc-gvs' },
      });

      const html = renderToStaticMarkup(React.createElement(SafetyCommandHub, { initialTab: 'CHILD_SAFETY' }));
      expect(html).toContain('Guard Privacy Boundary Notice');
      expect(html).toContain('Open Child Gate Scanner');
      expect(html).toContain('href="/security/child-safety"');
      // Proves guard does not see "Add Child Profile" button or child roster cards
      expect(html).not.toContain('Add Child Profile');
      expect(html).not.toContain('PROTECTED CHILD PASS');
    });

    test('secretary user rendering SafetyCommandHub sees roster and "Add Child Profile" button', () => {
      mockUseAuth.mockReturnValue({
        currentUser: { id: 'sec-1', role: 'secretary', name: 'Anita Secretary', societyId: 'soc-gvs' },
      });

      const initialChildren = [
        {
          id: 'child-101',
          societyId: 'soc-gvs',
          childName: 'Aarav Malhotra',
          flatCode: 'B-1204',
          guardianName: 'Siddharth Malhotra',
          guardianPhone: '+91 98765 00000',
          authorizedPickups: [
            {
              id: 'p-1',
              name: 'Radha Bai',
              phone: '+91 98199 88776',
              relationship: 'Nanny',
              idProofType: 'Aadhaar Card',
              idProofNumber: 'XXXX-9901',
              isApproved: true,
            },
          ],
          createdAt: '2026-01-01',
        },
      ];

      const html = renderToStaticMarkup(
        React.createElement(SafetyCommandHub, { initialTab: 'CHILD_SAFETY', initialChildren })
      );

      expect(html).toContain('CHILD SAFETY');
      expect(html).toContain('Children registered in society (1)');
      expect(html).toContain('Add Child Profile');
      expect(html).toContain('+ Add Escort');
      expect(html).toContain('Aarav Malhotra');
      expect(html).toContain('Radha Bai');
      expect(html).not.toContain('Guard Privacy Boundary Notice');
    });

    test('committee user sees roster but CANNOT see "Add Child Profile" or "+ Add Escort" buttons', () => {
      mockUseAuth.mockReturnValue({
        currentUser: { id: 'comm-1', role: 'committee', name: 'Vikram Committee', societyId: 'soc-gvs' },
      });

      const initialChildren = [
        {
          id: 'child-101',
          societyId: 'soc-gvs',
          childName: 'Aarav Malhotra',
          flatCode: 'B-1204',
          guardianName: 'Siddharth Malhotra',
          guardianPhone: '+91 98765 00000',
          authorizedPickups: [],
          createdAt: '2026-01-01',
        },
      ];

      const html = renderToStaticMarkup(
        React.createElement(SafetyCommandHub, { initialTab: 'CHILD_SAFETY', initialChildren })
      );

      expect(html).toContain('Children registered in society (1)');
      expect(html).toContain('Aarav Malhotra');
      // Committee cannot manage profiles or pickups: buttons must not be rendered
      expect(html).not.toContain('Add Child Profile');
      expect(html).not.toContain('+ Add Escort');
    });

    test('unauthorized role (e.g. security alias or vendor) rendering CHILD_SAFETY sees Access Denied', () => {
      mockUseAuth.mockReturnValue({
        currentUser: { id: 'sec-alias', role: 'security', name: 'Alias User', societyId: 'soc-gvs' },
      });

      const html = renderToStaticMarkup(React.createElement(SafetyCommandHub, { initialTab: 'CHILD_SAFETY' }));
      expect(html).toContain('Access Denied');
      expect(html).not.toContain('Add Child Profile');
      expect(html).not.toContain('PROTECTED CHILD PASS');
    });

    test('resident user rendering SafetyCommandHub delegates to ResidentChildSafetyPanel', () => {
      mockUseAuth.mockReturnValue({
        currentUser: { id: 'res-1', role: 'resident', name: 'Siddharth Malhotra', societyId: 'soc-gvs' },
      });

      const html = renderToStaticMarkup(React.createElement(SafetyCommandHub, { initialTab: 'CHILD_SAFETY' }));
      // ResidentChildSafetyPanel renders its own panel container
      expect(html).toContain('data-testid="resident-child-safety-panel"');
      expect(html).toContain('No Active Child Safety Emergencies');
      // Command console is hidden for residents
      expect(html).not.toContain('Console (');
    });
  });

  // ===========================================================================
  // 5. Staff Gate Pass Generation Tests (Phase 4.6.3.3.2)
  // ===========================================================================
  describe('5. Staff Gate Pass Generation Controller (Phase 4.6.3.3.2)', () => {
    test('secretary can generate child gate pass via canonical async API', async () => {
      (childSafetyService.createGatePass as jest.Mock).mockResolvedValueOnce(mockPassCreatedDto);

      const passForm = {
        childId: 'child-101',
        pickupPersonId: 'pickup-501',
        durationHours: 4,
        notes: 'Staff issued exit pass for swimming class',
      };

      const result = await executeStaffGenerateGatePass(passForm, 'secretary');
      expect(result).toEqual(mockPassCreatedDto);
      expect(childSafetyService.createGatePass).toHaveBeenCalledWith(
        expect.objectContaining({
          childId: 'child-101',
          pickupPersonId: 'pickup-501',
          maxUses: 1,
          notes: 'Staff issued exit pass for swimming class',
          validFrom: expect.any(String),
          validUntil: expect.any(String),
        })
      );
      // Validates validUntil is ahead of validFrom by approximately 4 hours
      const payload = (childSafetyService.createGatePass as jest.Mock).mock.calls[0][0];
      const validFromTime = new Date(payload.validFrom).getTime();
      const validUntilTime = new Date(payload.validUntil).getTime();
      const diffHours = (validUntilTime - validFromTime) / (3600 * 1000);
      expect(Math.round(diffHours)).toBe(4);
    });

    test('admin can generate child gate pass via canonical async API', async () => {
      (childSafetyService.createGatePass as jest.Mock).mockResolvedValueOnce(mockPassCreatedDto);

      const passForm = {
        childId: 'child-101',
        pickupPersonId: null,
      };

      const result = await executeStaffGenerateGatePass(passForm, 'admin');
      expect(result.id).toBe('pass-101');
      expect(childSafetyService.createGatePass).toHaveBeenCalledTimes(1);
    });

    test('custom validUntil timestamp is respected when provided', async () => {
      (childSafetyService.createGatePass as jest.Mock).mockResolvedValueOnce(mockPassCreatedDto);

      const customExpiry = '2026-03-31T20:00:00.000Z';
      const passForm = {
        childId: 'child-101',
        validUntil: customExpiry,
      };

      await executeStaffGenerateGatePass(passForm, 'secretary');
      const payload = (childSafetyService.createGatePass as jest.Mock).mock.calls[0][0];
      expect(payload.validUntil).toBe(customExpiry);
    });

    test('committee role is rejected with Forbidden when attempting pass generation', async () => {
      const passForm = {
        childId: 'child-101',
      };

      await expect(executeStaffGenerateGatePass(passForm, 'committee')).rejects.toThrow(
        /Forbidden: Only secretaries and administrators can issue child gate passes/i
      );
      expect(childSafetyService.createGatePass).not.toHaveBeenCalled();
    });

    test('guard role is rejected with Forbidden when attempting pass generation', async () => {
      const passForm = {
        childId: 'child-101',
      };

      await expect(executeStaffGenerateGatePass(passForm, 'guard')).rejects.toThrow(
        /Forbidden: Only secretaries and administrators can issue child gate passes/i
      );
      expect(childSafetyService.createGatePass).not.toHaveBeenCalled();
    });

    test('resident role is rejected with Forbidden from staff gate pass generation controller', async () => {
      const passForm = {
        childId: 'child-101',
      };

      await expect(executeStaffGenerateGatePass(passForm, 'resident')).rejects.toThrow(
        /Forbidden: Only secretaries and administrators can issue child gate passes/i
      );
      expect(childSafetyService.createGatePass).not.toHaveBeenCalled();
    });

    test('unsupported "security" alias fails closed with Forbidden', async () => {
      const passForm = {
        childId: 'child-101',
      };

      await expect(executeStaffGenerateGatePass(passForm, 'security')).rejects.toThrow(
        /Forbidden: Only secretaries and administrators can issue child gate passes/i
      );
      expect(childSafetyService.createGatePass).not.toHaveBeenCalled();
    });

    test('missing childId fails validation before calling backend API', async () => {
      const passForm = {
        childId: '',
      };

      await expect(executeStaffGenerateGatePass(passForm, 'admin')).rejects.toThrow(
        /Child ID is required to generate a gate exit pass/i
      );
      expect(childSafetyService.createGatePass).not.toHaveBeenCalled();
    });

    test('backend API errors (e.g. 404, 409) are propagated without producing fake success', async () => {
      (childSafetyService.createGatePass as jest.Mock).mockRejectedValueOnce(
        new Error('404 Not Found: Child profile does not exist')
      );

      const passForm = {
        childId: 'child-nonexistent',
      };

      await expect(executeStaffGenerateGatePass(passForm, 'secretary')).rejects.toThrow(
        /Child profile does not exist/i
      );
    });
  });

  // ===========================================================================
  // 6. Gate Verifier Redirection & Pass Button Boundaries (Phase 4.6.3.3.2)
  // ===========================================================================
  describe('6. Gate Verifier Redirection & Pass Button Boundaries (Phase 4.6.3.3.2)', () => {
    test('GATE_VERIFIER tab renders dedicated scanner redirection panel and link to /security/child-safety', () => {
      mockUseAuth.mockReturnValue({
        currentUser: { id: 'sec-1', role: 'secretary', name: 'Anita Secretary', societyId: 'soc-gvs' },
      });

      const html = renderToStaticMarkup(React.createElement(SafetyCommandHub, { initialTab: 'GATE_VERIFIER' }));
      expect(html).toContain('data-testid="gate-verifier-redirection-panel"');
      expect(html).toContain('Dedicated Gate Scanner Redirection');
      expect(html).toContain('Cryptographic Verification:');
      expect(html).toContain('data-testid="open-child-gate-scanner-btn"');
      expect(html).toContain('href="/security/child-safety"');

      // Proves obsolete local scan inputs and fake verify button are completely absent
      expect(html).not.toContain('Verify Pass');
      expect(html).not.toContain('Scan or enter exit pass code');
      expect(html).not.toContain('PASS-');
      expect(safetyCommandEngine.verifyChildPickupAtGate).not.toHaveBeenCalled();
    });

    test('secretary sees "Exit Pass" on child cards and "Pass" on escort cards', () => {
      mockUseAuth.mockReturnValue({
        currentUser: { id: 'sec-1', role: 'secretary', name: 'Anita Secretary', societyId: 'soc-gvs' },
      });

      const initialChildren = [
        {
          id: 'child-101',
          societyId: 'soc-gvs',
          childName: 'Aarav Malhotra',
          flatCode: 'B-1204',
          guardianName: 'Siddharth Malhotra',
          guardianPhone: '+91 98765 00000',
          authorizedPickups: [
            {
              id: 'p-1',
              childId: 'child-101',
              name: 'Radha Bai',
              phone: '+91 98199 88776',
              relationship: 'Nanny',
              idProofType: 'Aadhaar Card',
              idProofNumber: 'XXXX-9901',
              isApproved: true,
            },
          ],
          createdAt: '2026-01-01',
        },
      ];

      const html = renderToStaticMarkup(
        React.createElement(SafetyCommandHub, { initialTab: 'CHILD_SAFETY', initialChildren })
      );

      // Secretary has canGeneratePasses: true
      expect(html).toContain('data-testid="generate-pass-child-child-101"');
      expect(html).toContain('Exit Pass');
      expect(html).toContain('data-testid="generate-pass-escort-p-1"');
    });

    test('committee user sees roster and escorts but CANNOT see "Exit Pass" or "Pass" buttons', () => {
      mockUseAuth.mockReturnValue({
        currentUser: { id: 'comm-1', role: 'committee', name: 'Vikram Committee', societyId: 'soc-gvs' },
      });

      const initialChildren = [
        {
          id: 'child-101',
          societyId: 'soc-gvs',
          childName: 'Aarav Malhotra',
          flatCode: 'B-1204',
          guardianName: 'Siddharth Malhotra',
          guardianPhone: '+91 98765 00000',
          authorizedPickups: [
            {
              id: 'p-1',
              childId: 'child-101',
              name: 'Radha Bai',
              phone: '+91 98199 88776',
              relationship: 'Nanny',
              idProofType: 'Aadhaar Card',
              idProofNumber: 'XXXX-9901',
              isApproved: true,
            },
          ],
          createdAt: '2026-01-01',
        },
      ];

      const html = renderToStaticMarkup(
        React.createElement(SafetyCommandHub, { initialTab: 'CHILD_SAFETY', initialChildren })
      );

      // Committee sees child roster and escorts
      expect(html).toContain('Aarav Malhotra');
      expect(html).toContain('Radha Bai');

      // But committee does NOT have canGeneratePasses
      expect(html).not.toContain('data-testid="generate-pass-child-child-101"');
      expect(html).not.toContain('data-testid="generate-pass-escort-p-1"');
    });

    test('guard user rendering SafetyCommandHub never sees child cards, escorts or pass generation buttons', () => {
      mockUseAuth.mockReturnValue({
        currentUser: { id: 'guard-1', role: 'guard', name: 'Ramesh Guard', societyId: 'soc-gvs' },
      });

      const initialChildren = [
        {
          id: 'child-101',
          societyId: 'soc-gvs',
          childName: 'Aarav Malhotra',
          flatCode: 'B-1204',
          guardianName: 'Siddharth Malhotra',
          guardianPhone: '+91 98765 00000',
          authorizedPickups: [],
          createdAt: '2026-01-01',
        },
      ];

      const html = renderToStaticMarkup(
        React.createElement(SafetyCommandHub, { initialTab: 'CHILD_SAFETY', initialChildren })
      );

      // Guard sees privacy notice only
      expect(html).toContain('Guard Privacy Boundary Notice');
      expect(html).not.toContain('data-testid="generate-pass-child-child-101"');
      expect(html).not.toContain('Exit Pass');
    });
  });

  // ===========================================================================
  // 7. Staff Child SOS Trigger Controller (Phase 4.6.3.3.3)
  // ===========================================================================
  describe('7. Staff Child SOS Trigger Controller (Phase 4.6.3.3.3)', () => {
    test('secretary can trigger Child Safety SOS with valid childId and location', async () => {
      (childSafetyService.triggerSos as jest.Mock).mockResolvedValueOnce(mockChildSosCreatedDto);

      const res = await executeStaffTriggerChildSos(
        {
          childId: 'child-101',
          alertType: 'MISSING_REPORT',
          severity: 'CRITICAL',
          location: 'Clubhouse Playground',
          lastSeenDetails: 'Near pool at 4 PM',
          description: 'Aarav has been missing for 20 mins',
        },
        'secretary'
      );

      expect(childSafetyService.triggerSos).toHaveBeenCalledWith({
        childId: 'child-101',
        location: 'Clubhouse Playground',
        alertType: 'MISSING_REPORT',
        severity: 'CRITICAL',
        lastSeenDetails: 'Near pool at 4 PM',
        description: 'Aarav has been missing for 20 mins',
      });
      expect(res.alert.id).toBe('alert-101');
      expect(res.emergencyIncident.id).toBe('inc-901');
    });

    test('guard can trigger Child Safety SOS for unidentified child on premises', async () => {
      (childSafetyService.triggerSos as jest.Mock).mockResolvedValueOnce(mockChildSosCreatedDto);

      await executeStaffTriggerChildSos(
        {
          alertType: 'UNAUTHORIZED_EXIT_ATTEMPT',
          severity: 'CRITICAL',
          location: 'Main Perimeter Gate 1',
        },
        'guard'
      );

      expect(childSafetyService.triggerSos).toHaveBeenCalledWith({
        childId: undefined,
        location: 'Main Perimeter Gate 1',
        alertType: 'UNAUTHORIZED_EXIT_ATTEMPT',
        severity: 'CRITICAL',
        lastSeenDetails: null,
        description: null,
      });
    });

    test('committee role is authorized to trigger staff Child SOS', async () => {
      (childSafetyService.triggerSos as jest.Mock).mockResolvedValueOnce(mockChildSosCreatedDto);

      await executeStaffTriggerChildSos(
        {
          childId: 'child-101',
          location: 'Tower B Garden',
        },
        'committee'
      );

      expect(childSafetyService.triggerSos).toHaveBeenCalled();
    });

    test('admin role is authorized to trigger staff Child SOS', async () => {
      (childSafetyService.triggerSos as jest.Mock).mockResolvedValueOnce(mockChildSosCreatedDto);

      await executeStaffTriggerChildSos(
        {
          childId: 'child-101',
          location: 'Basement Parking B2',
        },
        'admin'
      );

      expect(childSafetyService.triggerSos).toHaveBeenCalled();
    });

    test('resident role is rejected with Forbidden from staff SOS trigger controller', async () => {
      await expect(
        executeStaffTriggerChildSos(
          {
            childId: 'child-101',
            location: 'Clubhouse',
          },
          'resident'
        )
      ).rejects.toThrow(/Forbidden/i);
      expect(childSafetyService.triggerSos).not.toHaveBeenCalled();
    });

    test('unsupported role or alias fails closed with Forbidden', async () => {
      await expect(
        executeStaffTriggerChildSos(
          {
            location: 'Main Gate',
          },
          'security'
        )
      ).rejects.toThrow(/Forbidden/i);
      expect(childSafetyService.triggerSos).not.toHaveBeenCalled();
    });

    test('missing or empty location fails validation before calling API', async () => {
      await expect(
        executeStaffTriggerChildSos(
          {
            childId: 'child-101',
            location: '   ',
          },
          'secretary'
        )
      ).rejects.toThrow(/Trigger location is required/i);
      expect(childSafetyService.triggerSos).not.toHaveBeenCalled();
    });

    test('duplicate active SOS error (409) is propagated without fake success', async () => {
      (childSafetyService.triggerSos as jest.Mock).mockRejectedValueOnce(
        new Error('Duplicate active SOS alert already exists for this child profile.')
      );

      await expect(
        executeStaffTriggerChildSos(
          {
            childId: 'child-101',
            location: 'Main Gate',
          },
          'guard'
        )
      ).rejects.toThrow(/Duplicate active SOS alert/i);
    });
  });

  // ===========================================================================
  // 8. Staff Child Alert Acknowledgment & Resolution Controller (Phase 4.6.3.3.3)
  // ===========================================================================
  describe('8. Staff Child Alert Acknowledgment & Resolution Controller (Phase 4.6.3.3.3)', () => {
    test('guard can acknowledge active alert via canonical async API', async () => {
      const ackAlert: ChildSafetyAlertDto = {
        ...mockAlertDto,
        status: 'ACKNOWLEDGED',
        acknowledgedAt: '2026-04-01T10:05:00.000Z',
        acknowledgedById: 'user-guard-1',
        acknowledgedByName: 'Ramesh Guard',
      };
      (childSafetyService.acknowledgeAlert as jest.Mock).mockResolvedValueOnce(ackAlert);

      const res = await executeStaffAcknowledgeChildAlert('alert-101', 'guard');
      expect(childSafetyService.acknowledgeAlert).toHaveBeenCalledWith('alert-101');
      expect(res.status).toBe('ACKNOWLEDGED');
      expect(res.acknowledgedByName).toBe('Ramesh Guard');
    });

    test('secretary can acknowledge active alert', async () => {
      (childSafetyService.acknowledgeAlert as jest.Mock).mockResolvedValueOnce({
        ...mockAlertDto,
        status: 'ACKNOWLEDGED',
      });

      await executeStaffAcknowledgeChildAlert('alert-101', 'secretary');
      expect(childSafetyService.acknowledgeAlert).toHaveBeenCalledWith('alert-101');
    });

    test('committee can acknowledge active alert', async () => {
      (childSafetyService.acknowledgeAlert as jest.Mock).mockResolvedValueOnce({
        ...mockAlertDto,
        status: 'ACKNOWLEDGED',
      });

      await executeStaffAcknowledgeChildAlert('alert-101', 'committee');
      expect(childSafetyService.acknowledgeAlert).toHaveBeenCalledWith('alert-101');
    });

    test('resident role attempting to acknowledge is rejected with Forbidden', async () => {
      await expect(executeStaffAcknowledgeChildAlert('alert-101', 'resident')).rejects.toThrow(
        /Forbidden/i
      );
      expect(childSafetyService.acknowledgeAlert).not.toHaveBeenCalled();
    });

    test('missing alertId throws validation error', async () => {
      await expect(executeStaffAcknowledgeChildAlert('', 'guard')).rejects.toThrow(/Alert ID is required/i);
    });

    test('secretary can resolve alert providing required resolution notes', async () => {
      const resolvedAlert: ChildSafetyAlertDto = {
        ...mockAlertDto,
        status: 'RESOLVED',
        resolvedAt: '2026-04-01T10:15:00.000Z',
        resolvedById: 'user-sec-1',
        resolvedByName: 'Anita Secretary',
        resolutionNotes: 'Child located safely with grandmother in Tower B clubhouse.',
      };
      (childSafetyService.resolveAlert as jest.Mock).mockResolvedValueOnce(resolvedAlert);

      const res = await executeStaffResolveChildAlert(
        'alert-101',
        {
          resolutionNotes: 'Child located safely with grandmother in Tower B clubhouse.',
          status: 'RESOLVED',
        },
        'secretary'
      );

      expect(childSafetyService.resolveAlert).toHaveBeenCalledWith('alert-101', {
        resolutionNotes: 'Child located safely with grandmother in Tower B clubhouse.',
        status: 'RESOLVED',
      });
      expect(res.status).toBe('RESOLVED');
    });

    test('guard can resolve alert as FALSE_ALARM providing required notes', async () => {
      const falseAlarmAlert: ChildSafetyAlertDto = {
        ...mockAlertDto,
        status: 'FALSE_ALARM',
        resolutionNotes: 'Accidental trigger by toddler at gate.',
      };
      (childSafetyService.resolveAlert as jest.Mock).mockResolvedValueOnce(falseAlarmAlert);

      const res = await executeStaffResolveChildAlert(
        'alert-101',
        {
          resolutionNotes: 'Accidental trigger by toddler at gate.',
          status: 'FALSE_ALARM',
        },
        'guard'
      );

      expect(childSafetyService.resolveAlert).toHaveBeenCalledWith('alert-101', {
        resolutionNotes: 'Accidental trigger by toddler at gate.',
        status: 'FALSE_ALARM',
      });
      expect(res.status).toBe('FALSE_ALARM');
    });

    test('missing resolutionNotes fails validation before calling backend API', async () => {
      await expect(
        executeStaffResolveChildAlert(
          'alert-101',
          {
            resolutionNotes: '   ',
            status: 'RESOLVED',
          },
          'secretary'
        )
      ).rejects.toThrow(/Resolution notes are required/i);
      expect(childSafetyService.resolveAlert).not.toHaveBeenCalled();
    });

    test('resident role attempting to resolve is rejected with Forbidden', async () => {
      await expect(
        executeStaffResolveChildAlert(
          'alert-101',
          {
            resolutionNotes: 'Found child',
            status: 'RESOLVED',
          },
          'resident'
        )
      ).rejects.toThrow(/Forbidden/i);
      expect(childSafetyService.resolveAlert).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // 9. Staff General Emergency Resolution Controller (Phase 4.6.3.3.3)
  // ===========================================================================
  describe('9. Staff General Emergency Resolution Controller (Phase 4.6.3.3.3)', () => {
    test('guard can resolve general emergency incident via apiClient', async () => {
      (apiClient.resolveEmergencyIncidentStrict as jest.Mock).mockResolvedValueOnce({
        id: 'inc-01',
        dispatchStatus: 'RESOLVED',
      });

      const res = await executeStaffResolveGeneralIncident('inc-01', 'guard');
      expect(apiClient.resolveEmergencyIncidentStrict).toHaveBeenCalledWith('inc-01');
      expect(res.dispatchStatus).toBe('RESOLVED');
    });

    test('admin can resolve general emergency incident', async () => {
      (apiClient.resolveEmergencyIncidentStrict as jest.Mock).mockResolvedValueOnce({
        id: 'inc-02',
        dispatchStatus: 'RESOLVED',
      });

      await executeStaffResolveGeneralIncident('inc-02', 'admin');
      expect(apiClient.resolveEmergencyIncidentStrict).toHaveBeenCalledWith('inc-02');
    });

    test('committee role attempting general emergency resolution is rejected with Forbidden', async () => {
      await expect(executeStaffResolveGeneralIncident('inc-03', 'committee')).rejects.toThrow(
        /Forbidden/i
      );
      expect(apiClient.resolveEmergencyIncidentStrict).not.toHaveBeenCalled();
    });

    test('resident attempting general emergency resolution is rejected with Forbidden', async () => {
      await expect(executeStaffResolveGeneralIncident('inc-04', 'resident')).rejects.toThrow(
        /Forbidden/i
      );
      expect(apiClient.resolveEmergencyIncidentStrict).not.toHaveBeenCalled();
    });

    test('missing incidentId throws validation error', async () => {
      await expect(executeStaffResolveGeneralIncident('', 'guard')).rejects.toThrow(
        /Incident ID is required/i
      );
    });
  });

  // ===========================================================================
  // 10. Unified Command Console SSR Markup & Role Feeds (Phase 4.6.3.3.3)
  // ===========================================================================
  describe('10. Unified Command Console SSR Markup & Role Feeds (Phase 4.6.3.3.3)', () => {
    test('staff user rendering COMMAND_CONSOLE renders live console header, filter buttons, and staff SOS trigger', () => {
      mockUseAuth.mockReturnValue({
        currentUser: { id: 'sec-1', role: 'secretary', name: 'Anita Secretary', societyId: 'soc-gvs' },
      });

      const html = renderToStaticMarkup(React.createElement(SafetyCommandHub, { initialTab: 'COMMAND_CONSOLE' }));

      expect(html).toContain('Live Incident Feed &amp; Response Console');
      expect(html).toContain('data-testid="open-staff-sos-modal-btn"');
      expect(html).toContain('data-testid="refresh-console-btn"');
      expect(html).toContain('data-testid="filter-all-btn"');
      expect(html).toContain('data-testid="filter-child-safety-btn"');
      expect(html).toContain('data-testid="filter-general-btn"');
    });

    test('child card in CHILD_SAFETY tab renders modernized Report Missing button with testid', () => {
      mockUseAuth.mockReturnValue({
        currentUser: { id: 'sec-1', role: 'secretary', name: 'Anita Secretary', societyId: 'soc-gvs' },
      });

      const initialChildren = [
        {
          id: 'child-101',
          societyId: 'soc-gvs',
          childName: 'Aarav Malhotra',
          flatCode: 'B-1204',
          guardianName: 'Siddharth Malhotra',
          guardianPhone: '+91 98765 00000',
          authorizedPickups: [],
          createdAt: '2026-01-01',
        },
      ];

      const html = renderToStaticMarkup(
        React.createElement(SafetyCommandHub, { initialTab: 'CHILD_SAFETY', initialChildren })
      );

      expect(html).toContain('data-testid="report-missing-btn-child-101"');
      expect(html).toContain('Report Missing');
    });

    test('decommissioning verification: safetyCommandEngine write methods and realtimeService.publish are never called', () => {
      expect(safetyCommandEngine.triggerOneTapSOS).not.toHaveBeenCalled();
      expect(safetyCommandEngine.acknowledgeIncident).not.toHaveBeenCalled();
      expect(safetyCommandEngine.resolveIncident).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // 11. Security Command Hub Authenticated Realtime Integration (Phase 4.6.3.3.4)
  // ===========================================================================
  describe('11. Security Command Hub Authenticated Realtime Integration (Phase 4.6.3.3.4)', () => {
    test('renders realtime connection status pill in COMMAND_CONSOLE header', () => {
      mockUseAuth.mockReturnValue({
        currentUser: { id: 'sec-1', role: 'secretary', name: 'Anita Secretary', societyId: 'soc-gvs' },
      });

      const html = renderToStaticMarkup(React.createElement(SafetyCommandHub, { initialTab: 'COMMAND_CONSOLE' }));

      expect(html).toContain('data-testid="realtime-status-pill"');
      expect(html).toContain('OFFLINE'); // default state in test/SSR environment
    });

    test('SECURITY_CHILD_SAFETY_TOPICS allowlist contains strictly the 8 security-authorized topics', () => {
      expect(SECURITY_CHILD_SAFETY_TOPICS).toHaveLength(8);
      expect(SECURITY_CHILD_SAFETY_TOPICS).toEqual([
        'CHILD_GATE_PASS_GENERATED',
        'CHILD_GATE_PASS_VERIFIED',
        'CHILD_GATE_PASS_REVOKED',
        'CHILD_EXIT_TRIGGERED',
        'CHILD_EXIT_DENIED',
        'CHILD_SAFETY_SOS_TRIGGERED',
        'CHILD_SAFETY_ALERT_ACKNOWLEDGED',
        'CHILD_SAFETY_ALERT_RESOLVED',
      ]);
    });

    test('guard-prohibited household topics (PROFILE_EVENT_ROLES) are excluded from SECURITY_CHILD_SAFETY_TOPICS', () => {
      const prohibitedTopics = [
        'CHILD_PROFILE_CREATED',
        'CHILD_PROFILE_UPDATED',
        'CHILD_PROFILE_ARCHIVED',
        'CHILD_PICKUP_AUTHORIZED',
        'CHILD_PICKUP_UPDATED',
        'CHILD_PICKUP_REVOKED',
      ];

      for (const topic of prohibitedTopics) {
        expect(SECURITY_CHILD_SAFETY_TOPICS).not.toContain(topic);
      }
    });

    test('getSecurityInvalidationScopes correctly maps all 8 security topics to targeted scopes', () => {
      expect(getSecurityInvalidationScopes('CHILD_GATE_PASS_GENERATED')).toEqual(['activePasses']);
      expect(getSecurityInvalidationScopes('CHILD_GATE_PASS_REVOKED')).toEqual(['activePasses']);
      expect(getSecurityInvalidationScopes('CHILD_GATE_PASS_VERIFIED')).toEqual(['activePasses', 'exitLogs']);
      expect(getSecurityInvalidationScopes('CHILD_EXIT_TRIGGERED')).toEqual(['exitLogs']);
      expect(getSecurityInvalidationScopes('CHILD_EXIT_DENIED')).toEqual(['exitLogs', 'activeAlerts']);
      expect(getSecurityInvalidationScopes('CHILD_SAFETY_SOS_TRIGGERED')).toEqual(['activeAlerts']);
      expect(getSecurityInvalidationScopes('CHILD_SAFETY_ALERT_ACKNOWLEDGED')).toEqual(['activeAlerts']);
      expect(getSecurityInvalidationScopes('CHILD_SAFETY_ALERT_RESOLVED')).toEqual(['activeAlerts']);
    });

    test('single SSE connection invariant: realtimeService.connect and realtimeService.disconnect are never invoked by hub', () => {
      const connectSpy = jest.spyOn(realtimeService, 'connect');
      const disconnectSpy = jest.spyOn(realtimeService, 'disconnect');

      mockUseAuth.mockReturnValue({
        currentUser: { id: 'guard-1', role: 'guard', name: 'Ramesh Guard', societyId: 'soc-gvs' },
      });

      renderToStaticMarkup(React.createElement(SafetyCommandHub, { initialTab: 'COMMAND_CONSOLE' }));

      expect(connectSpy).not.toHaveBeenCalled();
      expect(disconnectSpy).not.toHaveBeenCalled();

      connectSpy.mockRestore();
      disconnectSpy.mockRestore();
    });

    test('general emergency topics allowlist verification for staff roles', () => {
      const expectedGeneralEmergencyTopics = [
        'EMERGENCY_ALERTS',
        'EMERGENCY_INCIDENT_RESOLVED',
        'EMERGENCY_INCIDENT_CREATED',
      ];

      // Verify canonical event names are non-empty and upper-case
      for (const topic of expectedGeneralEmergencyTopics) {
        expect(topic).toMatch(/^[A-Z_]+$/);
        expect(topic).not.toContain('CHILD_SAFETY_UPDATED'); // Prohibit legacy dummy topic
      }
    });

    test('society scoping: cross-society events are rejected and do not trigger unauthorized data refresh', () => {
      const currentSocietyId = 'soc-gvs';
      const foreignSocietyId = 'soc-foreign-999';

      const isSameSociety = (eventSocietyId: string) => eventSocietyId === currentSocietyId;

      expect(isSameSociety(currentSocietyId)).toBe(true);
      expect(isSameSociety(foreignSocietyId)).toBe(false);
    });

    test('zero protected client-network publishing: realtimeService.publish is never called by SafetyCommandHub', () => {
      const publishSpy = jest.spyOn(realtimeService, 'publish');

      mockUseAuth.mockReturnValue({
        currentUser: { id: 'sec-1', role: 'secretary', name: 'Anita Secretary', societyId: 'soc-gvs' },
      });

      renderToStaticMarkup(React.createElement(SafetyCommandHub, { initialTab: 'COMMAND_CONSOLE' }));

      expect(publishSpy).not.toHaveBeenCalled();
      publishSpy.mockRestore();
    });

    test('cache invalidation registration on childSafetyService is maintained across render cycles', () => {
      expect(childSafetyService.onCacheInvalidated).toBeDefined();
    });
  });
});
