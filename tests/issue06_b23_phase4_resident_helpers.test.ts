// =============================================================================
// ISSUE-06 Phase B.2.3 — Phase 4.1:
// Resident Child Safety Contract Mapping & Pure Helper Unit Tests
// Strictly deterministic fixed-clock tests (zero timers, zero storage, zero mocks).
// =============================================================================

import {
  MAX_CHILD_GATE_PASS_DURATION_MS,
  buildCreateAuthorizedPickupPayload,
  buildResidentCreateChildPayload,
  buildResidentCreateGatePassPayload,
  buildResidentTriggerSosPayload,
  buildResidentUpdateChildPayload,
  buildUpdateAuthorizedPickupPayload,
  canRevokeGatePass,
  formatAuthorizedPickupDisplay,
  formatChildProfileDisplay,
  formatExitLogDisplay,
  formatGatePassDisplay,
  formatMaskedPickupId,
  formatSafetyAlertDisplay,
  getEffectiveGatePassStatus,
  getEffectivePickupStatus,
  getResidentChildSafetyPermissions,
  isGatePassNotYetValid,
  isPickupSelectableForPass,
  isValidPhoneNumber,
  mapGenderInputToDto,
  parseTimestampMs,
  validateIdDocumentLast4,
} from '../src/domains/safety/utils/childSafetyResidentHelpers';
import type {
  AuthorizedPickupDto,
  ChildExitLogDto,
  ChildGatePassDto,
  ChildProfileDto,
  ChildSafetyAlertDto,
} from '../src/types/childSafety';

// Fixed deterministic reference clock: 2026-11-18T12:00:00.000Z
const FIXED_NOW = new Date('2026-11-18T12:00:00.000Z');
const FIXED_NOW_MS = FIXED_NOW.getTime();

const basePickupDto: AuthorizedPickupDto = {
  id: 'pkp-1',
  societyId: 'soc-alpha',
  childId: 'chd-1',
  name: 'Sunita Devi',
  phone: '+919811112222',
  relationship: 'Nanny',
  idDocumentType: 'Aadhaar Card',
  idDocumentLast4: '4589',
  idVerificationStatus: 'VERIFIED',
  idVerifiedAt: '2026-11-10T10:00:00.000Z',
  photoUrl: null,
  status: 'ACTIVE',
  validUntil: '2026-12-01T12:00:00.000Z',
  notes: null,
  archivedAt: null,
  createdAt: '2026-11-01T09:00:00.000Z',
  updatedAt: '2026-11-01T09:00:00.000Z',
};

const baseChildDto: ChildProfileDto = {
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
  medicalNotes: 'Peanut allergy',
  status: 'SAFE',
  exitPermissionMode: 'ESCORT_REQUIRED',
  allowedSoloExit: false,
  guardianName: 'Rohan Sharma',
  guardianPhone: '+919876543210',
  emergencyPhone: '+919811100000',
  secondaryGuardians: null,
  emergencyContacts: null,
  notes: null,
  archivedAt: null,
  createdAt: '2026-11-01T09:00:00.000Z',
  updatedAt: '2026-11-01T09:00:00.000Z',
  pickups: [basePickupDto],
};

const basePassDto: ChildGatePassDto = {
  id: 'pass-1',
  societyId: 'soc-alpha',
  childId: 'chd-1',
  pickupPersonId: 'pkp-1',
  passCode: 'CGP-8842',
  pickupPersonName: 'Sunita Devi',
  pickupPersonPhone: '+919811112222',
  validFrom: '2026-11-18T11:00:00.000Z',
  validUntil: '2026-11-18T16:00:00.000Z',
  status: 'ACTIVE',
  maxUses: 1,
  currentUses: 0,
  firstUsedAt: null,
  lastUsedAt: null,
  revokedAt: null,
  revocationReason: null,
  notes: null,
  archivedAt: null,
  createdAt: '2026-11-18T11:00:00.000Z',
  updatedAt: '2026-11-18T11:00:00.000Z',
  child: {
    id: 'chd-1',
    fullName: 'Aarav Sharma',
    flatNumber: 'A-402',
    status: 'SAFE',
  },
};

const baseExitLogDto: ChildExitLogDto = {
  id: 'log-1',
  societyId: 'soc-alpha',
  childId: 'chd-1',
  passId: 'pass-1',
  pickupPersonId: 'pkp-1',
  childName: 'Aarav Sharma',
  flatNumber: 'A-402',
  pickupPersonName: 'Sunita Devi',
  pickupPersonPhone: '+919811112222',
  gateId: 'MAIN_GATE',
  guardId: 'usr-guard-1',
  guardName: 'Guard Vikram',
  outcome: 'ALLOWED',
  verificationChannel: 'ONLINE_QR_TOKEN',
  denialReason: null,
  notes: null,
  timestamp: '2026-11-18T11:30:00.000Z',
};

const baseAlertDto: ChildSafetyAlertDto = {
  id: 'alt-1',
  societyId: 'soc-alpha',
  childId: 'chd-1',
  reportedById: 'usr-res-1',
  reportedByName: 'Rohan Sharma',
  childName: 'Aarav Sharma',
  flatNumber: 'A-402',
  alertType: 'MISSING_CHILD',
  severity: 'CRITICAL',
  status: 'ACTIVE',
  location: 'Tower A Playground',
  description: 'Last seen near swings',
  lastSeenDetails: 'Blue t-shirt',
  acknowledgedAt: null,
  acknowledgedById: null,
  acknowledgedByName: null,
  resolvedAt: null,
  resolvedById: null,
  resolvedByName: null,
  resolutionNotes: null,
  emergencyIncidentId: 'inc-1',
  createdAt: '2026-11-18T11:45:00.000Z',
  updatedAt: '2026-11-18T11:45:00.000Z',
};

describe('ISSUE-06 Phase B.2.3 (Phase 4.1): Resident Child Safety Pure Helpers', () => {
  // =========================================================================
  // 1. Gate Pass Effective Status, Exact Expiry Boundary & Timezone Offsets
  // =========================================================================
  describe('1. Effective Gate Pass Status & Expiry Calculations', () => {
    test('handles active, expired, exact boundary (validUntil === now), revoked, consumed, archived, and unknown states', () => {
      // Strictly future -> ACTIVE
      expect(getEffectiveGatePassStatus(basePassDto, FIXED_NOW)).toBe('ACTIVE');
      expect(canRevokeGatePass(basePassDto, FIXED_NOW)).toBe(true);

      // 1ms after now -> ACTIVE
      expect(
        getEffectiveGatePassStatus(
          { ...basePassDto, validUntil: new Date(FIXED_NOW_MS + 1).toISOString() },
          FIXED_NOW
        )
      ).toBe('ACTIVE');

      // Exact boundary validUntil === now -> EXPIRED
      expect(
        getEffectiveGatePassStatus(
          { ...basePassDto, validUntil: '2026-11-18T12:00:00.000Z' },
          FIXED_NOW
        )
      ).toBe('EXPIRED');
      expect(
        canRevokeGatePass({ ...basePassDto, validUntil: '2026-11-18T12:00:00.000Z' }, FIXED_NOW)
      ).toBe(false);

      // Past validUntil while backend still says ACTIVE -> EXPIRED
      expect(
        getEffectiveGatePassStatus(
          { ...basePassDto, validUntil: '2026-11-18T11:59:59.999Z' },
          FIXED_NOW
        )
      ).toBe('EXPIRED');

      // Explicitly REVOKED / USED / EXPIRED / ARCHIVED
      expect(getEffectiveGatePassStatus({ ...basePassDto, status: 'REVOKED' }, FIXED_NOW)).toBe('REVOKED');
      expect(getEffectiveGatePassStatus({ ...basePassDto, status: 'USED', currentUses: 1 }, FIXED_NOW)).toBe('USED');
      expect(getEffectiveGatePassStatus({ ...basePassDto, status: 'EXPIRED' }, FIXED_NOW)).toBe('EXPIRED');
      expect(getEffectiveGatePassStatus({ ...basePassDto, status: 'ARCHIVED' }, FIXED_NOW)).toBe('ARCHIVED');

      // archivedAt present overrides ACTIVE
      expect(
        getEffectiveGatePassStatus({ ...basePassDto, archivedAt: '2026-11-18T11:50:00.000Z' }, FIXED_NOW)
      ).toBe('ARCHIVED');

      // ACTIVE with currentUses >= maxUses -> USED
      expect(
        getEffectiveGatePassStatus({ ...basePassDto, status: 'ACTIVE', currentUses: 2, maxUses: 2 }, FIXED_NOW)
      ).toBe('USED');

      // Unknown backend status fails closed as UNKNOWN (never coerced to ACTIVE)
      expect(
        getEffectiveGatePassStatus({ ...basePassDto, status: 'FUTURE_UNKNOWN' as any }, FIXED_NOW)
      ).toBe('UNKNOWN');
      expect(
        canRevokeGatePass({ ...basePassDto, status: 'FUTURE_UNKNOWN' as any }, FIXED_NOW)
      ).toBe(false);
    });

    test('handles timezone offsets (+05:30, -04:00), invalid/missing timestamps, and not-yet-valid checks', () => {
      // 2026-11-18T17:30:00+05:30 === 2026-11-18T12:00:00.000Z (exact boundary -> EXPIRED!)
      expect(
        getEffectiveGatePassStatus(
          { ...basePassDto, validUntil: '2026-11-18T17:30:00+05:30' },
          FIXED_NOW
        )
      ).toBe('EXPIRED');

      // 2026-11-18T17:30:01+05:30 === 12:00:01Z (1s in future -> ACTIVE)
      expect(
        getEffectiveGatePassStatus(
          { ...basePassDto, validUntil: '2026-11-18T17:30:01+05:30' },
          FIXED_NOW
        )
      ).toBe('ACTIVE');

      // 2026-11-18T08:00:00-04:00 === 12:00:00Z (exact boundary -> EXPIRED!)
      expect(
        getEffectiveGatePassStatus(
          { ...basePassDto, validUntil: '2026-11-18T08:00:00-04:00' },
          FIXED_NOW
        )
      ).toBe('EXPIRED');

      // Invalid / missing validUntil on ACTIVE pass fails closed as UNKNOWN (not revocable/active)
      expect(getEffectiveGatePassStatus({ ...basePassDto, validUntil: '' }, FIXED_NOW)).toBe('UNKNOWN');
      expect(getEffectiveGatePassStatus({ ...basePassDto, validUntil: 'not-a-timestamp' }, FIXED_NOW)).toBe('UNKNOWN');
      expect(getEffectiveGatePassStatus({ ...basePassDto, validUntil: null as any }, FIXED_NOW)).toBe('UNKNOWN');
      expect(parseTimestampMs(undefined)).toBeNull();
      expect(parseTimestampMs('invalid-date')).toBeNull();

      // Not-yet-valid future validFrom
      expect(isGatePassNotYetValid({ validFrom: '2026-11-18T13:00:00.000Z' }, FIXED_NOW)).toBe(true);
      expect(isGatePassNotYetValid({ validFrom: '2026-11-18T12:00:00.000Z' }, FIXED_NOW)).toBe(false);
      expect(isGatePassNotYetValid({ validFrom: 'bad-date' }, FIXED_NOW)).toBe(false);
    });
  });

  // =========================================================================
  // 2. Authorized Pickup Effective Status & Expiry
  // =========================================================================
  describe('2. Effective Pickup Status & Expiry Calculations', () => {
    test('computes active, exact expiry boundary, timezone offsets, revoked, archived, and invalid states', () => {
      // No validUntil -> ACTIVE
      expect(getEffectivePickupStatus({ ...basePickupDto, validUntil: null }, FIXED_NOW)).toBe('ACTIVE');
      expect(isPickupSelectableForPass({ ...basePickupDto, validUntil: null }, FIXED_NOW)).toBe(true);

      // Future validUntil -> ACTIVE
      expect(getEffectivePickupStatus(basePickupDto, FIXED_NOW)).toBe('ACTIVE');

      // Exact boundary validUntil === now (with IST +05:30 offset) -> EXPIRED
      expect(
        getEffectivePickupStatus({ ...basePickupDto, validUntil: '2026-11-18T17:30:00+05:30' }, FIXED_NOW)
      ).toBe('EXPIRED');
      expect(
        isPickupSelectableForPass({ ...basePickupDto, validUntil: '2026-11-18T17:30:00+05:30' }, FIXED_NOW)
      ).toBe(false);

      // Invalid validUntil string on ACTIVE pickup -> UNKNOWN (fail closed)
      expect(getEffectivePickupStatus({ ...basePickupDto, validUntil: 'garbage' }, FIXED_NOW)).toBe('UNKNOWN');
      expect(isPickupSelectableForPass({ ...basePickupDto, validUntil: 'garbage' }, FIXED_NOW)).toBe(false);

      // Revoked / Archived / Unknown
      expect(getEffectivePickupStatus({ ...basePickupDto, status: 'REVOKED' }, FIXED_NOW)).toBe('REVOKED');
      expect(getEffectivePickupStatus({ ...basePickupDto, archivedAt: '2026-11-18T10:00:00.000Z' }, FIXED_NOW)).toBe(
        'ARCHIVED'
      );
      expect(getEffectivePickupStatus({ ...basePickupDto, status: 'WEIRD' as any }, FIXED_NOW)).toBe('UNKNOWN');
    });
  });

  // =========================================================================
  // 3. Government ID Last-4 Validation & Masked Display
  // =========================================================================
  describe('3. Government ID Last-4 Validation & Privacy Minimization', () => {
    test('accepts optional empty values and 1–4 alphanumeric characters; rejects full IDs and punctuation', () => {
      expect(validateIdDocumentLast4(undefined)).toEqual({ ok: true, value: null });
      expect(validateIdDocumentLast4(null)).toEqual({ ok: true, value: null });
      expect(validateIdDocumentLast4('   ')).toEqual({ ok: true, value: null });
      expect(validateIdDocumentLast4('4589')).toEqual({ ok: true, value: '4589' });
      expect(validateIdDocumentLast4(' 99a1 ')).toEqual({ ok: true, value: '99A1' });
      expect(validateIdDocumentLast4('7')).toEqual({ ok: true, value: '7' });

      // Rejects full Aadhaar, formatted Aadhaar, PAN, DL, masked strings, spaces, non-strings
      expect(validateIdDocumentLast4('123456789012').ok).toBe(false);
      expect(validateIdDocumentLast4('1234-5678-9012').ok).toBe(false);
      expect(validateIdDocumentLast4('XXXX-XXXX-9901').ok).toBe(false);
      expect(validateIdDocumentLast4('ABCDE1234F').ok).toBe(false);
      expect(validateIdDocumentLast4('DL-MH02-2018-9182').ok).toBe(false);
      expect(validateIdDocumentLast4('12-3').ok).toBe(false);
      expect(validateIdDocumentLast4('12 3').ok).toBe(false);
      expect(validateIdDocumentLast4(1234 as any).ok).toBe(false);
    });

    test('formats masked ID safely and never echoes raw >4-char values', () => {
      expect(formatMaskedPickupId('Aadhaar Card', '4589')).toBe('Aadhaar Card · XXXX-4589');
      expect(formatMaskedPickupId(null, '4589')).toBe('ID · XXXX-4589');
      expect(formatMaskedPickupId('Driving License', null)).toBe('Driving License');
      expect(formatMaskedPickupId(null, null)).toBe('ID Not Collected');
      // Malformed >4 char value fails closed without echoing raw ID
      expect(formatMaskedPickupId('Aadhaar', '123456789012')).toBe('Aadhaar');
      expect(formatMaskedPickupId(null, '123456789012')).toBe('ID Not Collected');
    });
  });

  // =========================================================================
  // 4. Resident Payload Builders (Strict Ownership Omission & Contract Rules)
  // =========================================================================
  describe('4. Resident Payload Mapping & Ownership Omission', () => {
    test('buildResidentCreateChildPayload omits residentId, flatId, flatNumber, guardianUserId, and societyId even if supplied on untyped input', () => {
      const untypedInput: any = {
        fullName: '  Aarav Sharma  ',
        guardianName: '  Rohan Sharma ',
        guardianPhone: ' +919876543210 ',
        reportedAge: '8',
        gender: 'Boy',
        dateOfBirth: '2018-05-14',
        exitPermissionMode: 'ESCORT_REQUIRED',
        medicalNotes: '  Peanut allergy  ',
        // Attempting to inject ownership/tenant fields must be stripped!
        residentId: 'res-spoofed',
        flatId: 'flt-spoofed',
        flatNumber: 'B-1204',
        guardianUserId: 'usr-spoofed',
        societyId: 'soc-gvs',
      };

      const res = buildResidentCreateChildPayload(untypedInput, FIXED_NOW);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.value).toEqual({
        fullName: 'Aarav Sharma',
        guardianName: 'Rohan Sharma',
        guardianPhone: '+919876543210',
        gender: 'MALE',
        exitPermissionMode: 'ESCORT_REQUIRED',
        allowedSoloExit: false,
        dateOfBirth: '2018-05-14T00:00:00.000Z',
        reportedAge: 8,
        medicalNotes: 'Peanut allergy',
      });

      // Strict negative assertions on ownership/tenant fields
      expect('residentId' in res.value).toBe(false);
      expect('flatId' in res.value).toBe(false);
      expect('flatNumber' in (res.value as any)).toBe(false);
      expect('guardianUserId' in res.value).toBe(false);
      expect('societyId' in res.value).toBe(false);

      // Gender normalization coverage
      expect(mapGenderInputToDto('Girl')).toBe('FEMALE');
      expect(mapGenderInputToDto('Other')).toBe('OTHER');
      expect(mapGenderInputToDto('unknown-value')).toBe('UNSPECIFIED');
      expect(mapGenderInputToDto(null)).toBe('UNSPECIFIED');

      // Rejects future DOB, out-of-range age, missing required fields, and forbidden raw IDs
      expect(
        buildResidentCreateChildPayload(
          { fullName: 'Aarav', guardianName: 'Rohan', guardianPhone: '+9198', dateOfBirth: '2027-01-01' },
          FIXED_NOW
        ).ok
      ).toBe(false);
      expect(
        buildResidentCreateChildPayload(
          { fullName: 'Aarav', guardianName: 'Rohan', guardianPhone: '+9198', reportedAge: 26 },
          FIXED_NOW
        ).ok
      ).toBe(false);
      expect(
        buildResidentCreateChildPayload(
          { fullName: 'Aarav', guardianName: 'Rohan', guardianPhone: '+9198', idProofNumber: '1234' } as any,
          FIXED_NOW
        ).ok
      ).toBe(false);
    });

    test('buildResidentUpdateChildPayload keeps exit policy consistent and rejects empty updates', () => {
      expect(buildResidentUpdateChildPayload({}, FIXED_NOW).ok).toBe(false);

      const res = buildResidentUpdateChildPayload(
        { exitPermissionMode: 'SOLO_ALLOWED', medicalNotes: '' },
        FIXED_NOW
      );
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toEqual({
          exitPermissionMode: 'SOLO_ALLOWED',
          allowedSoloExit: true,
          medicalNotes: null,
        });
      }
    });

    test('pickup create & update payload builders enforce backend PATCH field contract and reject raw IDs', () => {
      // Create rejects raw idProofNumber
      const badCreate = buildCreateAuthorizedPickupPayload(
        {
          name: 'Sunita',
          phone: '+919811112222',
          relationship: 'Nanny',
          idProofNumber: '1234-5678-9012',
        } as any,
        FIXED_NOW
      );
      expect(badCreate.ok).toBe(false);

      // Create rejects past validUntil
      const pastCreate = buildCreateAuthorizedPickupPayload(
        {
          name: 'Sunita',
          phone: '+919811112222',
          relationship: 'Nanny',
          validUntil: '2026-11-18T12:00:00.000Z', // exact boundary === now -> invalid
        },
        FIXED_NOW
      );
      expect(pastCreate.ok).toBe(false);

      // Valid create
      const okCreate = buildCreateAuthorizedPickupPayload(
        {
          name: '  Sunita Devi ',
          phone: ' +919811112222 ',
          relationship: ' Nanny ',
          idDocumentType: 'Aadhaar Card',
          idDocumentLast4: '4589',
          validUntil: '2026-12-01T12:00:00.000Z',
        },
        FIXED_NOW
      );
      expect(okCreate).toEqual({
        ok: true,
        value: {
          name: 'Sunita Devi',
          phone: '+919811112222',
          relationship: 'Nanny',
          idDocumentType: 'Aadhaar Card',
          idDocumentLast4: '4589',
          validUntil: '2026-12-01T12:00:00.000Z',
        },
      });

      // Update rejects ARCHIVED status and rejects ignored-only fields (empty backend PATCH)
      expect(buildUpdateAuthorizedPickupPayload({ status: 'ARCHIVED' as any }, FIXED_NOW).ok).toBe(false);
      expect(buildUpdateAuthorizedPickupPayload({ notes: 'ignored by backend' } as any, FIXED_NOW).ok).toBe(false);

      const okUpdate = buildUpdateAuthorizedPickupPayload(
        { name: 'Sunita Sharma', status: 'REVOKED' },
        FIXED_NOW
      );
      expect(okUpdate).toEqual({
        ok: true,
        value: {
          name: 'Sunita Sharma',
          status: 'REVOKED',
        },
      });
    });

    test('gate pass & SOS payload builders enforce validity bounds, escort policy, and resident SOS childId/location', () => {
      // Missing child cannot get pass
      expect(
        buildResidentCreateGatePassPayload(
          { pickupPersonId: 'pkp-1', validUntil: '2026-11-18T16:00:00.000Z' },
          { ...baseChildDto, status: 'MISSING' },
          FIXED_NOW
        ).ok
      ).toBe(false);

      // ESCORT_REQUIRED without pickupPersonId -> rejected
      expect(
        buildResidentCreateGatePassPayload(
          { validUntil: '2026-11-18T16:00:00.000Z' },
          baseChildDto,
          FIXED_NOW
        ).ok
      ).toBe(false);

      // Duration > 7 days -> rejected
      expect(
        buildResidentCreateGatePassPayload(
          {
            pickupPersonId: 'pkp-1',
            validFrom: FIXED_NOW,
            validUntil: new Date(FIXED_NOW_MS + MAX_CHILD_GATE_PASS_DURATION_MS + 1000),
          },
          baseChildDto,
          FIXED_NOW
        ).ok
      ).toBe(false);

      // Valid pass creation returns { request, options } with zero societyId
      const okPass = buildResidentCreateGatePassPayload(
        {
          pickupPersonId: 'pkp-1',
          validUntil: '2026-11-18T16:00:00.000Z',
          maxUses: 2,
          notes: 'School pickup',
        },
        baseChildDto,
        FIXED_NOW
      );
      expect(okPass.ok).toBe(true);
      if (okPass.ok) {
        expect(okPass.value.request).toEqual({
          childId: 'chd-1',
          pickupPersonId: 'pkp-1',
          validFrom: '2026-11-18T12:00:00.000Z',
          validUntil: '2026-11-18T16:00:00.000Z',
          maxUses: 2,
          notes: 'School pickup',
        });
        expect('societyId' in okPass.value.request).toBe(false);
        expect(okPass.value.options).toEqual({ childExitPermissionMode: 'ESCORT_REQUIRED' });
      }

      // SOS requires childId and location
      expect(buildResidentTriggerSosPayload({ childId: '', location: 'Park' }).ok).toBe(false);
      expect(buildResidentTriggerSosPayload({ childId: 'chd-1', location: '   ' }).ok).toBe(false);
      expect(
        buildResidentTriggerSosPayload({
          childId: 'chd-1',
          location: 'Tower A Park',
          alertType: 'INVALID_TYPE',
        }).ok
      ).toBe(false);

      const okSos = buildResidentTriggerSosPayload({
        childId: 'chd-1',
        location: '  Tower A Park  ',
        lastSeenDetails: '  Wearing red cap ',
      });
      expect(okSos).toEqual({
        ok: true,
        value: {
          childId: 'chd-1',
          location: 'Tower A Park',
          alertType: 'MISSING_CHILD',
          severity: 'CRITICAL',
          lastSeenDetails: 'Wearing red cap',
        },
      });
    });
  });

  // =========================================================================
  // 5. Role-Aware Resident Action Visibility
  // =========================================================================
  describe('5. Role-Aware Action Visibility (Resident Never Gets Alert Manage / Gate Verify)', () => {
    test('enforces exact backend RBAC boundaries across resident, secretary, admin, guard, committee, and unknown roles', () => {
      const residentPerms = getResidentChildSafetyPermissions('resident');
      expect(residentPerms.canRegisterOwnChild).toBe(true);
      expect(residentPerms.requiresAdminDeskForChildCreation).toBe(false);
      expect(residentPerms.canManagePickups).toBe(true);
      expect(residentPerms.canCreateGatePass).toBe(true);
      expect(residentPerms.canRevokeGatePass).toBe(true);
      expect(residentPerms.canTriggerChildSos).toBe(true);
      expect(residentPerms.canViewAlerts).toBe(true);
      // CRITICAL: Residents NEVER receive alert acknowledge/resolve or gate verify controls
      expect(residentPerms.canAcknowledgeAlert).toBe(false);
      expect(residentPerms.canResolveAlert).toBe(false);
      expect(residentPerms.canVerifyGatePass).toBe(false);

      const secretaryPerms = getResidentChildSafetyPermissions('secretary');
      expect(secretaryPerms.canRegisterOwnChild).toBe(false);
      expect(secretaryPerms.requiresAdminDeskForChildCreation).toBe(true);
      expect(secretaryPerms.canAcknowledgeAlert).toBe(true);
      expect(secretaryPerms.canResolveAlert).toBe(true);
      expect(secretaryPerms.canVerifyGatePass).toBe(false);

      const adminPerms = getResidentChildSafetyPermissions('admin');
      expect(adminPerms.canVerifyGatePass).toBe(true);
      expect(adminPerms.canAcknowledgeAlert).toBe(true);
      expect(adminPerms.canResolveAlert).toBe(true);

      const guardPerms = getResidentChildSafetyPermissions('guard');
      expect(guardPerms.canVerifyGatePass).toBe(true);
      expect(guardPerms.canAcknowledgeAlert).toBe(true);
      expect(guardPerms.canCreateGatePass).toBe(false);

      const committeePerms = getResidentChildSafetyPermissions('committee');
      expect(committeePerms.canListChildren).toBe(true);
      expect(committeePerms.canAcknowledgeAlert).toBe(true);
      expect(committeePerms.canEditChild).toBe(false);

      // Denied / unknown roles fail closed completely
      for (const denied of ['vendor', 'delivery', 'facility_manager', '', null, undefined, 'superuser']) {
        const p = getResidentChildSafetyPermissions(denied);
        expect(Object.values(p).every((v) => v === false)).toBe(true);
      }
    });
  });

  // =========================================================================
  // 6. Safe Display Projections, Unknown Enums, Null Optionals & Zero Secret Leakage
  // =========================================================================
  describe('6. Safe Display Formatting & Zero Token / Hash / QR / Raw ID Leakage', () => {
    test('handles null/missing optional DTO fields and unknown enum values safely without crashing', () => {
      const sparseChild = formatChildProfileDisplay(
        {
          ...baseChildDto,
          dateOfBirth: null,
          reportedAge: null,
          medicalNotes: null,
          emergencyPhone: null,
          pickups: undefined,
          status: 'NEW_BACKEND_STATUS' as any,
          gender: 'UNKNOWN_GENDER' as any,
          exitPermissionMode: 'FUTURE_MODE' as any,
        },
        FIXED_NOW
      );
      expect(sparseChild.status).toBe('UNKNOWN');
      expect(sparseChild.statusLabel).toBe('Status Unknown');
      expect(sparseChild.gender).toBe('UNSPECIFIED');
      expect(sparseChild.exitPermissionMode).toBe('UNKNOWN');
      expect(sparseChild.ageOrDobLabel).toBe('Age not provided');
      expect(sparseChild.canIssuePass).toBe(false);
      expect(sparseChild.activePickupCount).toBe(0);

      const sparseExit = formatExitLogDisplay({
        ...baseExitLogDto,
        outcome: 'NEW_OUTCOME' as any,
        verificationChannel: 'NEW_CHANNEL' as any,
        pickupPersonPhone: null,
        denialReason: null,
      });
      expect(sparseExit.outcome).toBe('UNKNOWN');
      expect(sparseExit.verificationChannel).toBe('UNKNOWN');

      const sparseAlert = formatSafetyAlertDisplay({
        ...baseAlertDto,
        alertType: 'NEW_ALERT' as any,
        severity: 'EXTREME' as any,
        status: 'NEW_STATUS' as any,
      });
      expect(sparseAlert.alertType).toBe('UNKNOWN');
      expect(sparseAlert.severity).toBe('UNKNOWN');
      expect(sparseAlert.status).toBe('UNKNOWN');
      expect(sparseAlert.isOpen).toBe(false);
    });

    test('ordinary display projections NEVER leak bearerToken, qrPayload, tokenHash, idDocumentHash, or raw idProofNumber', () => {
      const taintedPass: any = {
        ...basePassDto,
        bearerToken: 'secret-bearer-token-do-not-leak',
        qrPayload: 'AARIZO_CHILD_PASS:secret-qr-payload',
        tokenHash: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      };
      const passDisplay = formatGatePassDisplay(taintedPass, FIXED_NOW);
      const passJson = JSON.stringify(passDisplay);

      expect(passDisplay.passCode).toBe('CGP-8842');
      expect(passDisplay.effectiveStatus).toBe('ACTIVE');
      expect(passDisplay.usageLabel).toBe('0 of 1 used');
      expect(passJson).not.toContain('secret-bearer-token-do-not-leak');
      expect(passJson).not.toContain('AARIZO_CHILD_PASS');
      expect(passJson).not.toContain('tokenHash');
      expect(passJson).not.toContain('bearerToken');
      expect(passJson).not.toContain('qrPayload');

      const taintedPickup: any = {
        ...basePickupDto,
        idDocumentHash: 'deadbeefdeadbeefdeadbeefdeadbeef',
        idProofNumber: '1234-5678-9012',
      };
      const pickupDisplay = formatAuthorizedPickupDisplay(taintedPickup, FIXED_NOW);
      const pickupJson = JSON.stringify(pickupDisplay);

      expect(pickupDisplay.maskedIdLabel).toBe('Aadhaar Card · XXXX-4589');
      expect(pickupJson).not.toContain('deadbeef');
      expect(pickupJson).not.toContain('1234-5678-9012');
      expect(pickupJson).not.toContain('idDocumentHash');
      expect(pickupJson).not.toContain('idProofNumber');
    });
  });

  // =========================================================================
  // 8. Phase 4.3 Remediation: Strict Calendar Dates & Phone Validation
  // =========================================================================
  describe('8. Strict Calendar Date Parsing (F-P43-02) & International Phone Validation (F-P43-04)', () => {
    test('rejects impossible calendar dates and invalid time/offset components while preserving leap years and timezone offsets', () => {
      // Impossible calendar dates MUST return null (never roll over to March/May!)
      expect(parseTimestampMs('2027-02-30')).toBeNull();
      expect(parseTimestampMs('2027-02-30T12:00:00Z')).toBeNull();
      expect(parseTimestampMs('2027-04-31')).toBeNull();
      expect(parseTimestampMs('2027-04-31T12:00')).toBeNull();
      expect(parseTimestampMs('2027-13-01T10:00:00Z')).toBeNull();
      expect(parseTimestampMs('2027-00-10T10:00:00Z')).toBeNull();
      expect(parseTimestampMs('2027-02-29')).toBeNull(); // 2027 is not a leap year
      expect(parseTimestampMs('2027-02-29T12:00:00Z')).toBeNull();
      expect(parseTimestampMs('2100-02-29T00:00:00Z')).toBeNull(); // Century non-leap year
      expect(parseTimestampMs('2027-05-15T25:00:00Z')).toBeNull();
      expect(parseTimestampMs('2027-05-15T12:60:00Z')).toBeNull();
      expect(parseTimestampMs('2027-05-15T12:00:00+25:00')).toBeNull();
      expect(parseTimestampMs('May 14, 2018')).toBeNull(); // Reject locale-dependent strings

      // Valid leap-year dates (including 2000 century leap year), timezone offsets, and datetime-local values continue to work
      expect(parseTimestampMs('2000-02-29')).toBe(Date.parse('2000-02-29T00:00:00.000Z'));
      expect(parseTimestampMs('2028-02-29')).toBe(Date.parse('2028-02-29T00:00:00.000Z'));
      expect(parseTimestampMs('2028-02-29T12:00:00Z')).toBe(Date.parse('2028-02-29T12:00:00.000Z'));
      expect(parseTimestampMs('2028-02-29T17:30:00+05:30')).toBe(Date.parse('2028-02-29T12:00:00.000Z'));
      expect(parseTimestampMs('2028-02-29T08:00:00-04:00')).toBe(Date.parse('2028-02-29T12:00:00.000Z'));
      expect(parseTimestampMs('2028-02-29T09:15')).not.toBeNull();
    });

    test('validates international phone formats and rejects empty or clearly malformed values on pickup payloads', () => {
      // Valid international & local formats
      for (const good of [
        '+919876543210',
        '+91 98199 88776',
        '+1 (415) 555-0199',
        '(415) 555-0199',
        '+44-20-7946-0958',
        '9999999999',
        '555-0199',
      ]) {
        expect(isValidPhoneNumber(good)).toBe(true);
        const res = buildCreateAuthorizedPickupPayload({ name: 'Sunita Devi', phone: good, relationship: 'Nanny' }, FIXED_NOW);
        expect(res.ok).toBe(true);
      }

      // Invalid / malformed phones (including unbalanced/nested/empty parens and trailing dashes) rejected
      for (const bad of [
        '',
        '   ',
        'abc',
        '---',
        '123',
        '123456',
        '++919876543210',
        '+91-abc-1234567',
        '1234567890123456',
        '(1234567',
        '123)4567',
        '((123))4567',
        '()1234567',
        '1234567----',
      ]) {
        expect(isValidPhoneNumber(bad)).toBe(false);
        const createRes = buildCreateAuthorizedPickupPayload({ name: 'Sunita Devi', phone: bad, relationship: 'Nanny' }, FIXED_NOW);
        expect(createRes.ok).toBe(false);
        const updateRes = buildUpdateAuthorizedPickupPayload({ phone: bad }, FIXED_NOW);
        expect(updateRes.ok).toBe(false);
      }
    });
  });
});

