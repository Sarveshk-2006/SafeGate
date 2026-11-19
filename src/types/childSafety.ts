// =============================================================================
// LEGACY FRONTEND TYPES (DEPRECATED — Retained for backward compatibility until Phase 7)
// Do NOT use these for new B.2.3 backend-backed API calls.
// =============================================================================

/** @deprecated Legacy localStorage status type. Use `ChildProfileStatusDto`. */
export type ChildStatus = 'SAFE' | 'OUT_OF_SOCIETY' | 'MISSING';
/** @deprecated Legacy localStorage pickup status type. Use `PickupAuthorizationStatusDto`. */
export type PickupPersonStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';
/** @deprecated Legacy localStorage pass status type. Use `ChildGatePassStatusDto`. */
export type QRPassStatus = 'ACTIVE' | 'EXPIRED' | 'USED' | 'REVOKED';
/** @deprecated Legacy localStorage log status type. Use `ChildExitOutcomeDto`. */
export type PickupLogStatus = 'ALLOWED' | 'DENIED' | 'MISSING_ALERT_FLAGGED';
/** @deprecated Legacy localStorage alert type. Use `ChildAlertTypeDto`. */
export type SafetyAlertType = 'EMERGENCY' | 'MISSING_CHILD' | 'UNAUTHORIZED_PICKUP_ATTEMPT';

/** @deprecated Legacy guardian type. Use `ChildSecondaryGuardianDto`. */
export interface Guardian {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  email?: string;
  isPrimary: boolean;
}

/** @deprecated Legacy emergency contact type. Use `ChildEmergencyContactDto`. */
export interface EmergencyContact {
  id: string;
  name: string;
  relationship: string;
  phone: string;
}

/** @deprecated Legacy pickup type containing prohibited `idProofNumber`. Use `AuthorizedPickupDto`. */
export interface AuthorizedPickupPerson {
  id: string;
  childId: string;
  name: string;
  phone: string;
  relationship: string;
  idProofType: string;
  idProofNumber: string;
  photoUrl?: string;
  status: PickupPersonStatus;
  validUntil?: string;
  createdAt: string;
}

/** @deprecated Legacy localStorage child profile. Use `ChildProfileDto`. */
export interface ChildProfile {
  id: string;
  societyId: string;
  flatNumber: string;
  fullName: string;
  dateOfBirth: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  photoUrl?: string;
  medicalNotes?: string;
  status: ChildStatus;
  guardians: Guardian[];
  emergencyContacts: EmergencyContact[];
  authorizedPickups: AuthorizedPickupPerson[];
  createdAt: string;
  updatedAt: string;
}

/** @deprecated Legacy localStorage QR pass. Use `ChildGatePassDto` / `ChildGatePassCreatedDto`. */
export interface ChildPickupQR {
  id: string;
  qrCode: string;
  societyId: string;
  childId: string;
  childName: string;
  flatNumber: string;
  pickupPersonId: string;
  pickupPersonName: string;
  validFrom: string;
  validUntil: string;
  maxUses: number;
  currentUses: number;
  status: QRPassStatus;
  createdAt: string;
}

/** @deprecated Legacy localStorage pickup log. Use `ChildExitLogDto`. */
export interface PickupLog {
  id: string;
  societyId: string;
  childId: string;
  childName: string;
  flatNumber: string;
  pickupPersonName: string;
  pickupPersonPhone: string;
  timestamp: string;
  gateId: string;
  securityGuardId: string;
  status: PickupLogStatus;
  notes?: string;
}

/** @deprecated Legacy localStorage alert. Use `ChildSafetyAlertDto`. */
export interface ChildSafetyAlert {
  id: string;
  societyId: string;
  childId: string;
  childName: string;
  flatNumber: string;
  alertType: SafetyAlertType;
  message: string;
  status: 'ACTIVE' | 'RESOLVED';
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

// =============================================================================
// AUTHORITATIVE PHASE B.2.2 / B.2.3 CHILD SAFETY API CONTRACTS
// Source of truth: server/src/childSafety/router.ts & server/src/childSafety/validation.ts
// =============================================================================

export type ChildGenderDto = 'MALE' | 'FEMALE' | 'OTHER' | 'UNSPECIFIED';
export type ChildProfileStatusDto = 'SAFE' | 'OUT_OF_SOCIETY' | 'MISSING' | 'ARCHIVED';
export type ChildExitPermissionModeDto =
  | 'ESCORT_REQUIRED'
  | 'SOLO_ALLOWED'
  | 'TIMED_PASS_ONLY'
  | 'UNKNOWN';
export type PickupAuthorizationStatusDto = 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'ARCHIVED';
export type PickupIdVerificationStatusDto =
  | 'NOT_COLLECTED'
  | 'UNVERIFIED'
  | 'PENDING_REVIEW'
  | 'VERIFIED'
  | 'REJECTED';
export type ChildGatePassStatusDto = 'ACTIVE' | 'USED' | 'EXPIRED' | 'REVOKED' | 'ARCHIVED';
export type ChildExitOutcomeDto =
  | 'ALLOWED'
  | 'DENIED'
  | 'MISSING_ALERT_BLOCKED'
  | 'VERIFICATION_UNAVAILABLE';
export type ChildVerificationChannelDto =
  | 'ONLINE_QR_TOKEN'
  | 'ONLINE_PASS_CODE_ASSISTED'
  | 'MANUAL_OVERRIDE_DENIED'
  | 'BACKEND_UNAVAILABLE';
export type ChildAlertTypeDto =
  | 'MISSING_CHILD'
  | 'UNATTENDED_CHILD'
  | 'UNAUTHORIZED_EXIT_ATTEMPT'
  | 'EMERGENCY_SOS';
export type ChildAlertStatusDto = 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_ALARM';
export type ChildAlertResolveStatusDto = 'RESOLVED' | 'FALSE_ALARM';
export type IncidentSeverityDto = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ChildSecondaryGuardianDto {
  name: string;
  relationship: string;
  phone: string;
  email?: string;
}

export interface ChildEmergencyContactDto {
  name: string;
  relationship: string;
  phone: string;
}

/**
 * Authorized pickup DTO returned by backend (`sanitizePickupDto`).
 * Never contains `idDocumentHash` or raw identity document numbers.
 */
export interface AuthorizedPickupDto {
  id: string;
  societyId: string;
  childId: string;
  name: string;
  phone: string;
  relationship: string;
  idDocumentType: string | null;
  idDocumentLast4: string | null;
  idVerificationStatus: PickupIdVerificationStatusDto;
  idVerifiedAt: string | null;
  photoUrl: string | null;
  status: PickupAuthorizationStatusDto;
  validUntil: string | null;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Canonical Child Profile DTO returned by backend (`sanitizeChildProfileDto`).
 */
export interface ChildProfileDto {
  id: string;
  societyId: string;
  residentId: string;
  flatId: string;
  guardianUserId: string | null;
  flatNumber: string;
  fullName: string;
  dateOfBirth: string | null;
  reportedAge: number | null;
  gender: ChildGenderDto;
  photoUrl: string | null;
  medicalNotes: string | null;
  status: ChildProfileStatusDto;
  exitPermissionMode: ChildExitPermissionModeDto;
  allowedSoloExit: boolean;
  guardianName: string;
  guardianPhone: string;
  emergencyPhone: string | null;
  secondaryGuardians: ChildSecondaryGuardianDto[] | null;
  emergencyContacts: ChildEmergencyContactDto[] | null;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  pickups?: AuthorizedPickupDto[];
}

export interface ChildGatePassChildSummaryDto {
  id: string;
  fullName: string;
  flatNumber: string;
  status: ChildProfileStatusDto;
}

/**
 * Canonical Child Gate Pass DTO returned by list/get/revoke/verify endpoints (`sanitizeGatePassDto`).
 * Never exposes `tokenHash`, `bearerToken`, or `qrPayload`.
 */
export interface ChildGatePassDto {
  id: string;
  societyId: string;
  childId: string;
  pickupPersonId: string | null;
  passCode: string;
  pickupPersonName: string;
  pickupPersonPhone: string | null;
  validFrom: string;
  validUntil: string;
  status: ChildGatePassStatusDto;
  maxUses: number;
  currentUses: number;
  firstUsedAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  child?: ChildGatePassChildSummaryDto;
}

/**
 * One-time creation response from `POST /api/children/passes`.
 * `bearerToken` and `qrPayload` are returned ONCE and must NEVER be persisted to browser storage or logs.
 */
export interface ChildGatePassCreatedDto extends ChildGatePassDto {
  bearerToken: string;
  qrPayload: string;
}

/**
 * Canonical Gate Exit Audit Log DTO (`sanitizeExitLogDto`).
 */
export interface ChildExitLogDto {
  id: string;
  societyId: string;
  childId: string | null;
  passId: string | null;
  pickupPersonId: string | null;
  childName: string;
  flatNumber: string;
  pickupPersonName: string;
  pickupPersonPhone: string | null;
  gateId: string;
  guardId: string | null;
  guardName: string;
  outcome: ChildExitOutcomeDto;
  verificationChannel: ChildVerificationChannelDto;
  denialReason: string | null;
  notes: string | null;
  timestamp: string;
}

/**
 * Verified HTTP 200 success payload from `POST /api/children/passes/verify`.
 */
export interface VerifyChildGatePassSuccessDto {
  authorized: true;
  outcome: 'ALLOWED';
  pass: ChildGatePassDto;
  exitLog: ChildExitLogDto;
}

/**
 * Structured error payload returned by `POST /api/children/passes/verify` on 4xx/503 denials.
 */
export interface VerifyChildGatePassDenialPayload {
  authorized: false;
  outcome?: 'DENIED' | 'MISSING_ALERT_BLOCKED' | 'VERIFICATION_UNAVAILABLE';
  verificationChannel?: ChildVerificationChannelDto;
  code: string;
  error: string;
  exitLog?: ChildExitLogDto;
}

/**
 * Canonical Child Safety Alert DTO (`sanitizeSafetyAlertDto`).
 */
export interface ChildSafetyAlertDto {
  id: string;
  societyId: string;
  childId: string | null;
  reportedById: string | null;
  reportedByName: string | null;
  childName: string;
  flatNumber: string;
  alertType: ChildAlertTypeDto;
  severity: IncidentSeverityDto;
  status: ChildAlertStatusDto;
  location: string;
  description: string | null;
  lastSeenDetails: string | null;
  acknowledgedAt: string | null;
  acknowledgedById: string | null;
  acknowledgedByName: string | null;
  resolvedAt: string | null;
  resolvedById: string | null;
  resolvedByName: string | null;
  resolutionNotes: string | null;
  emergencyIncidentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChildSosEmergencyIncidentSummaryDto {
  id: string;
  societyId: string;
  incidentType: string;
  severity: IncidentSeverityDto;
  location: string;
  dispatchStatus: string;
  createdAt: string;
}

/**
 * Verified HTTP 201 response payload from `POST /api/children/sos`.
 */
export interface ChildSosCreatedDto {
  alert: ChildSafetyAlertDto;
  emergencyIncident: ChildSosEmergencyIncidentSummaryDto;
}

// =============================================================================
// REQUEST PARAMETER & PAYLOAD CONTRACTS
// =============================================================================

export interface ListChildrenParams {
  includeArchived?: boolean;
  /** Optional target society filter for verified platform admins only. */
  societyId?: string;
}

export interface CreateChildProfileRequest {
  fullName: string;
  guardianName: string;
  guardianPhone: string;
  dateOfBirth?: string | null;
  reportedAge?: number | null;
  gender?: ChildGenderDto;
  exitPermissionMode?: ChildExitPermissionModeDto;
  allowedSoloExit?: boolean;
  photoUrl?: string | null;
  medicalNotes?: string | null;
  emergencyPhone?: string | null;
  secondaryGuardians?: ChildSecondaryGuardianDto[] | null;
  emergencyContacts?: ChildEmergencyContactDto[] | null;
  notes?: string | null;
  /** Required for secretary/admin creation; must belong to the same society. */
  residentId?: string;
  /** Required for secretary/admin creation; must belong to the same society. */
  flatId?: string;
  guardianUserId?: string;
  /** Optional target society for platform admin only. */
  societyId?: string;
}

export interface UpdateChildProfileRequest {
  fullName?: string;
  dateOfBirth?: string | null;
  reportedAge?: number | null;
  gender?: ChildGenderDto;
  photoUrl?: string | null;
  medicalNotes?: string | null;
  /** Administrative profile status only — NEVER used to simulate a gate re-entry event. */
  status?: Exclude<ChildProfileStatusDto, 'ARCHIVED'>;
  exitPermissionMode?: ChildExitPermissionModeDto;
  allowedSoloExit?: boolean;
  guardianName?: string;
  guardianPhone?: string;
  emergencyPhone?: string | null;
  secondaryGuardians?: ChildSecondaryGuardianDto[] | null;
  emergencyContacts?: ChildEmergencyContactDto[] | null;
  notes?: string | null;
}

/**
 * Authorized pickup creation request.
 * Raw government ID fields (`idProofNumber`, `aadhaarNumber`, etc.) are strictly forbidden.
 * Only optional `idDocumentType` and `idDocumentLast4` (1–4 chars) may be submitted.
 */
export interface CreateAuthorizedPickupRequest {
  name: string;
  phone: string;
  relationship: string;
  idDocumentType?: string | null;
  idDocumentLast4?: string | null;
  photoUrl?: string | null;
  validUntil?: string | null;
  notes?: string | null;
}

export interface UpdateAuthorizedPickupRequest {
  name?: string;
  phone?: string;
  relationship?: string;
  idDocumentType?: string | null;
  idDocumentLast4?: string | null;
  photoUrl?: string | null;
  status?: Exclude<PickupAuthorizationStatusDto, 'ARCHIVED'>;
  validUntil?: string | null;
  notes?: string | null;
}

export interface ListChildGatePassesParams {
  childId?: string;
  status?: ChildGatePassStatusDto;
  limit?: number;
  offset?: number;
  /** Optional target society for platform admin only. */
  societyId?: string;
}

export interface CreateChildGatePassRequest {
  childId: string;
  /** Required by backend unless child has `exitPermissionMode === 'SOLO_ALLOWED'` and `allowedSoloExit === true`. */
  pickupPersonId?: string | null;
  pickupPersonName?: string;
  pickupPersonPhone?: string | null;
  validFrom?: string;
  validUntil: string;
  maxUses?: number;
  notes?: string | null;
  /** Optional target society for platform admin only. */
  societyId?: string;
}

export interface CreateChildGatePassOptions {
  /**
   * When supplied by caller, client enforces that `pickupPersonId` is present
   * whenever `childExitPermissionMode !== 'SOLO_ALLOWED'` before issuing the request.
   */
  childExitPermissionMode?: ChildExitPermissionModeDto;
}

export interface RevokeChildGatePassRequest {
  reason?: string;
}

export interface VerifyChildGatePassRequest {
  qrPayload?: string;
  bearerToken?: string;
  gateId?: string;
  notes?: string | null;
  /** Optional target society for platform admin only. */
  societyId?: string;
}

export interface ListChildExitLogsParams {
  childId?: string;
  limit?: number;
  offset?: number;
  /** Optional target society for platform admin only. */
  societyId?: string;
}

export interface TriggerChildSosRequest {
  location: string;
  childId?: string;
  childName?: string;
  flatNumber?: string;
  alertType?: ChildAlertTypeDto;
  severity?: IncidentSeverityDto;
  description?: string | null;
  lastSeenDetails?: string | null;
  /** Optional target society for platform admin only. */
  societyId?: string;
}

export interface ListChildAlertsParams {
  status?: ChildAlertStatusDto;
  limit?: number;
  offset?: number;
  /** Optional target society for platform admin only. */
  societyId?: string;
}

export interface ResolveChildAlertRequest {
  resolutionNotes: string;
  status?: ChildAlertResolveStatusDto;
}

export type ChildSafetyErrorCode =
  | 'AUTH_TOKEN_MISSING'
  | 'AUTH_TOKEN_INVALID'
  | 'USER_NOT_PROVISIONED'
  | 'ACCOUNT_SUSPENDED'
  | 'INSUFFICIENT_PERMISSIONS'
  | 'TENANT_CONTEXT_REQUIRED'
  | 'TENANT_ISOLATION_VIOLATION'
  | 'RAW_ID_DOCUMENT_FORBIDDEN'
  | 'INVALID_PICKUP_METADATA'
  | 'INVALID_CONTACT_LIST'
  | 'INVALID_CHILD_ID'
  | 'INVALID_VALIDITY_WINDOW'
  | 'VALIDITY_WINDOW_TOO_LONG'
  | 'INVALID_MAX_USES'
  | 'AUTHORIZED_PICKUP_REQUIRED'
  | 'PICKUP_AUTHORIZATION_INACTIVE'
  | 'PICKUP_AUTHORIZATION_EXPIRED'
  | 'PICKUP_PERSON_NOT_FOUND'
  | 'PICKUP_PERSON_UNAUTHORIZED'
  | 'PICKUP_NOT_FOUND'
  | 'BEARER_TOKEN_REQUIRED'
  | 'INVALID_OR_UNKNOWN_PASS'
  | 'CHILD_MISSING_ALERT_BLOCKED'
  | 'CHILD_MISSING_ALERT_ACTIVE'
  | 'CHILD_ARCHIVED'
  | 'PASS_REVOKED'
  | 'PASS_ARCHIVED'
  | 'PASS_ALREADY_CONSUMED'
  | 'PASS_EXPIRED'
  | 'PASS_NOT_YET_VALID'
  | 'PASS_NOT_FOUND'
  | 'PASS_NOT_REVOCABLE'
  | 'ESCORT_REQUIRED'
  | 'CHILD_STATE_CONFLICT'
  | 'DUPLICATE_ACTIVE_SOS_ALERT'
  | 'RESOLUTION_NOTES_REQUIRED'
  | 'INVALID_RESOLUTION_STATUS'
  | 'INVALID_ALERT_TRANSITION'
  | 'ALERT_NOT_FOUND'
  | 'ACTIVE_MISSING_ALERT_MUST_BE_RESOLVED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'BACKEND_UNAVAILABLE'
  | 'DATABASE_UNAVAILABLE'
  | 'NETWORK_UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'INTERNAL_SERVER_ERROR';

