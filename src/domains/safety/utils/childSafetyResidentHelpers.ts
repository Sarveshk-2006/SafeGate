// =============================================================================
// AARIZO — ISSUE-06 Phase B.2.3 (Phase 4.1):
// Pure Resident Child Safety Contract Mapping, Validation & Display Helpers
//
// Invariants:
// - Pure, deterministic functions only (zero network, zero React state, zero storage).
// - Uses canonical DTOs and request types exclusively from `src/types/childSafety.ts`.
// - Residents NEVER send `residentId`, `flatId`, `flatNumber`, `guardianUserId`, or `societyId`
//   on child profile creation; backend derives ownership strictly from verified JWT + DB.
// - Never accepts, retains, or exposes raw government IDs, `tokenHash`, `bearerToken`, or `qrPayload`.
// - Never fabricates QR payloads, pass codes, or backend-confirmed state.
// - Unknown/malformed backend enum or timestamp values fail closed safely.
// =============================================================================

import type {
  AuthorizedPickupDto,
  ChildAlertStatusDto,
  ChildAlertTypeDto,
  ChildExitLogDto,
  ChildExitOutcomeDto,
  ChildExitPermissionModeDto,
  ChildGatePassDto,
  ChildGatePassStatusDto,
  ChildGenderDto,
  ChildProfileDto,
  ChildProfileStatusDto,
  ChildSafetyAlertDto,
  ChildVerificationChannelDto,
  CreateAuthorizedPickupRequest,
  CreateChildGatePassOptions,
  CreateChildGatePassRequest,
  CreateChildProfileRequest,
  IncidentSeverityDto,
  PickupAuthorizationStatusDto,
  PickupIdVerificationStatusDto,
  TriggerChildSosRequest,
  UpdateAuthorizedPickupRequest,
  UpdateChildProfileRequest,
} from '../../../types/childSafety';

// =============================================================================
// 1. CANONICAL CONTRACT CONSTANTS (Aligned with server/src/childSafety/router.ts & validation.ts)
// =============================================================================

export const MAX_CHILD_GATE_PASS_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const MIN_PASS_MAX_USES = 1;
export const MAX_PASS_MAX_USES = 10;
export const MIN_CHILD_AGE = 0;
export const MAX_CHILD_AGE = 25;

const ALLOWED_CHILD_GENDER_SET = new Set<string>(['MALE', 'FEMALE', 'OTHER', 'UNSPECIFIED']);
const ALLOWED_CHILD_STATUS_SET = new Set<string>(['SAFE', 'OUT_OF_SOCIETY', 'MISSING', 'ARCHIVED']);
const ALLOWED_EXIT_PERMISSION_MODE_SET = new Set<string>([
  'ESCORT_REQUIRED',
  'SOLO_ALLOWED',
  'TIMED_PASS_ONLY',
  'UNKNOWN',
]);
const ALLOWED_PICKUP_STATUS_SET = new Set<string>(['ACTIVE', 'REVOKED', 'EXPIRED', 'ARCHIVED']);
const ALLOWED_PICKUP_MUTABLE_STATUS_SET = new Set<string>(['ACTIVE', 'REVOKED', 'EXPIRED']);
const ALLOWED_PICKUP_VERIFICATION_SET = new Set<string>([
  'NOT_COLLECTED',
  'UNVERIFIED',
  'PENDING_REVIEW',
  'VERIFIED',
  'REJECTED',
]);
const ALLOWED_GATE_PASS_STATUS_SET = new Set<string>(['ACTIVE', 'USED', 'EXPIRED', 'REVOKED', 'ARCHIVED']);
const ALLOWED_EXIT_OUTCOME_SET = new Set<string>([
  'ALLOWED',
  'DENIED',
  'MISSING_ALERT_BLOCKED',
  'VERIFICATION_UNAVAILABLE',
]);
const ALLOWED_VERIFICATION_CHANNEL_SET = new Set<string>([
  'ONLINE_QR_TOKEN',
  'ONLINE_PASS_CODE_ASSISTED',
  'MANUAL_OVERRIDE_DENIED',
  'BACKEND_UNAVAILABLE',
]);
const ALLOWED_ALERT_TYPE_SET = new Set<string>([
  'MISSING_CHILD',
  'UNATTENDED_CHILD',
  'UNAUTHORIZED_EXIT_ATTEMPT',
  'EMERGENCY_SOS',
]);
const ALLOWED_ALERT_STATUS_SET = new Set<string>(['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_ALARM']);
const ALLOWED_INCIDENT_SEVERITY_SET = new Set<string>(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

const FORBIDDEN_RAW_ID_KEYS_LOWER = new Set<string>([
  'idproofnumber',
  'id_proof_number',
  'aadhaarnumber',
  'aadhaar',
  'pannumber',
  'passportnumber',
  'drivinglicensenumber',
  'govidnumber',
]);

const ID_LAST4_PATTERN = /^[A-Za-z0-9]{1,4}$/;

// =============================================================================
// 2. SHARED HELPER TYPES
// =============================================================================

export type HelperValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; field?: string };

export type EffectiveGatePassDisplayStatus = ChildGatePassStatusDto | 'UNKNOWN';
export type EffectivePickupDisplayStatus = PickupAuthorizationStatusDto | 'UNKNOWN';
export type SafeChildDisplayStatus = ChildProfileStatusDto | 'UNKNOWN';
export type SafeAlertDisplayStatus = ChildAlertStatusDto | 'UNKNOWN';
export type SafeExitOutcomeDisplay = ChildExitOutcomeDto | 'UNKNOWN';

export interface ResidentCreateChildFormInput {
  fullName: string;
  guardianName: string;
  guardianPhone: string;
  dateOfBirth?: string | null;
  reportedAge?: string | number | null;
  gender?: string | null;
  exitPermissionMode?: string | null;
  medicalNotes?: string | null;
  emergencyPhone?: string | null;
  notes?: string | null;
  photoUrl?: string | null;
}

export interface ResidentUpdateChildFormInput {
  fullName?: string;
  guardianName?: string;
  guardianPhone?: string;
  dateOfBirth?: string | null;
  reportedAge?: string | number | null;
  gender?: string | null;
  exitPermissionMode?: string | null;
  medicalNotes?: string | null;
  emergencyPhone?: string | null;
  notes?: string | null;
  photoUrl?: string | null;
}

export interface ResidentCreatePickupFormInput {
  name: string;
  phone: string;
  relationship: string;
  idDocumentType?: string | null;
  idDocumentLast4?: string | null;
  validUntil?: string | null;
  notes?: string | null;
  photoUrl?: string | null;
}

/**
 * Only fields actually processed by backend `PATCH /api/children/:childId/pickups/:pickupId`
 * (`server/src/childSafety/router.ts#L2361-L2434`).
 */
export interface ResidentUpdatePickupFormInput {
  name?: string;
  phone?: string;
  relationship?: string;
  validUntil?: string | null;
  status?: Exclude<PickupAuthorizationStatusDto, 'ARCHIVED'>;
}

export interface ResidentCreateGatePassFormInput {
  pickupPersonId?: string | null;
  validFrom?: string | Date | null;
  validUntil: string | Date;
  maxUses?: string | number | null;
  notes?: string | null;
}

export interface ResidentTriggerSosFormInput {
  childId: string;
  location: string;
  alertType?: string | null;
  severity?: string | null;
  description?: string | null;
  lastSeenDetails?: string | null;
}

export interface ChildSafetyRolePermissions {
  canListChildren: boolean;
  canRegisterOwnChild: boolean;
  requiresAdminDeskForChildCreation: boolean;
  canEditChild: boolean;
  canArchiveChild: boolean;
  canManagePickups: boolean;
  canCreateGatePass: boolean;
  canRevokeGatePass: boolean;
  canVerifyGatePass: boolean;
  canTriggerChildSos: boolean;
  canViewAlerts: boolean;
  canAcknowledgeAlert: boolean;
  canResolveAlert: boolean;
  canViewExitLogs: boolean;
}

export interface ChildProfileDisplayModel {
  id: string;
  fullName: string;
  flatNumber: string;
  status: SafeChildDisplayStatus;
  statusLabel: string;
  gender: ChildGenderDto;
  genderLabel: string;
  ageOrDobLabel: string;
  exitPermissionMode: ChildExitPermissionModeDto;
  exitPolicyLabel: string;
  guardianName: string;
  guardianPhone: string;
  emergencyPhone: string | null;
  medicalNotes: string | null;
  notes: string | null;
  activePickupCount: number;
  isArchived: boolean;
  isMissing: boolean;
  canIssuePass: boolean;
}

export interface AuthorizedPickupDisplayModel {
  id: string;
  childId: string;
  name: string;
  phone: string;
  relationship: string;
  effectiveStatus: EffectivePickupDisplayStatus;
  statusLabel: string;
  maskedIdLabel: string;
  verificationStatus: PickupIdVerificationStatusDto | 'UNKNOWN';
  verificationLabel: string;
  validUntil: string | null;
  notes: string | null;
  isSelectableForPass: boolean;
  canEdit: boolean;
  canRevoke: boolean;
  canArchive: boolean;
}

export interface GatePassDisplayModel {
  id: string;
  childId: string;
  passCode: string;
  childName: string;
  flatNumber: string;
  pickupPersonId: string | null;
  pickupPersonName: string;
  pickupPersonPhone: string | null;
  effectiveStatus: EffectiveGatePassDisplayStatus;
  statusLabel: string;
  currentUses: number;
  maxUses: number;
  usageLabel: string;
  validFrom: string;
  validUntil: string;
  isNotYetValid: boolean;
  canRevoke: boolean;
  revocationReason: string | null;
  notes: string | null;
  createdAt: string;
}

export interface ExitLogDisplayModel {
  id: string;
  childId: string | null;
  passId: string | null;
  childName: string;
  flatNumber: string;
  pickupPersonName: string;
  pickupPersonPhone: string | null;
  gateId: string;
  guardName: string;
  outcome: SafeExitOutcomeDisplay;
  outcomeLabel: string;
  verificationChannel: ChildVerificationChannelDto | 'UNKNOWN';
  verificationChannelLabel: string;
  denialReason: string | null;
  notes: string | null;
  timestamp: string;
}

export interface SafetyAlertDisplayModel {
  id: string;
  childId: string | null;
  childName: string;
  flatNumber: string;
  alertType: ChildAlertTypeDto | 'UNKNOWN';
  alertTypeLabel: string;
  severity: IncidentSeverityDto | 'UNKNOWN';
  severityLabel: string;
  status: SafeAlertDisplayStatus;
  statusLabel: string;
  location: string;
  description: string | null;
  lastSeenDetails: string | null;
  reportedByName: string | null;
  acknowledgedByName: string | null;
  acknowledgedAt: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  createdAt: string;
  isOpen: boolean;
}

// =============================================================================
// 3. TIMESTAMP & INTERNAL VALIDATION UTILITIES
// =============================================================================

function resolveClockMs(now?: Date | number): number {
  if (typeof now === 'number') {
    return Number.isFinite(now) ? now : Date.now();
  }
  if (now instanceof Date) {
    const ms = now.getTime();
    return Number.isFinite(ms) ? ms : Date.now();
  }
  return Date.now();
}

const STRICT_ISO_TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|z|([+-])(\d{2}):?(\d{2}))?)?$/;

const ALLOWED_PHONE_CHARS_RE = /^\+?[\d(][\d\s\-().]{5,30}[\d)]$/;

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

function hasBalancedPhoneParentheses(val: string): boolean {
  let depth = 0;
  let hasDigitInParen = false;
  for (const ch of val) {
    if (ch === '(') {
      if (depth > 0) return false; // Disallow nested parentheses
      depth = 1;
      hasDigitInParen = false;
    } else if (ch === ')') {
      if (depth === 0 || !hasDigitInParen) return false; // Disallow unmatched or empty ()
      depth = 0;
    } else if (depth === 1 && ch >= '0' && ch <= '9') {
      hasDigitInParen = true;
    }
  }
  return depth === 0;
}

/**
 * Validates international-friendly phone numbers without country-specific assumptions.
 * Accepts optional leading `+`, digits, spaces, hyphens, dots, and balanced parentheses
 * (7–15 digits, max 32 chars, ending in a digit or `)`).
 */
export function isValidPhoneNumber(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < 7 || trimmed.length > 32) return false;
  if (!ALLOWED_PHONE_CHARS_RE.test(trimmed)) return false;
  if (!hasBalancedPhoneParentheses(trimmed)) return false;
  const digitsOnly = trimmed.replace(/\D/g, '');
  return digitsOnly.length >= 7 && digitsOnly.length <= 15;
}

/**
 * Strictly parses an ISO-8601 date or timestamp string (supporting UTC `Z`, timezone offsets
 * like `+05:30`, and `datetime-local` values) or `Date` into epoch milliseconds.
 * Rejects impossible calendar dates (e.g. `2027-02-30`, `2027-04-31`, `2027-02-29`),
 * invalid time/offset components, and locale-dependent formats.
 */
export function parseTimestampMs(value: string | Date | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = STRICT_ISO_TIMESTAMP_RE.exec(trimmed);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidCalendarDate(year, month, day)) return null;

  if (match[4] !== undefined) {
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = match[6] !== undefined ? Number(match[6]) : 0;
    if (hour > 23 || minute > 59 || second > 59) return null;

    if (match[9] !== undefined) {
      const offHour = Number(match[10]);
      const offMin = Number(match[11]);
      if (offHour > 23 || offMin > 59) return null;
    }
  }

  const normalized = trimmed.includes(' ') ? trimmed.replace(' ', 'T') : trimmed;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

function findForbiddenRawIdKey(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  if (Array.isArray(input)) {
    for (const item of input) {
      const hit = findForbiddenRawIdKey(item);
      if (hit) return hit;
    }
    return null;
  }
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (
      FORBIDDEN_RAW_ID_KEYS_LOWER.has(key.toLowerCase()) &&
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ''
    ) {
      return key;
    }
    if (value && typeof value === 'object') {
      const nested = findForbiddenRawIdKey(value);
      if (nested) return nested;
    }
  }
  return null;
}

function normalizeTrimmedOptional(
  value: string | null | undefined,
  maxLen: number,
  fieldLabel: string
): HelperValidationResult<string | null | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string') {
    return { ok: false, field: fieldLabel, error: `${fieldLabel} must be a valid text value.` };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > maxLen) {
    return { ok: false, field: fieldLabel, error: `${fieldLabel} cannot exceed ${maxLen} characters.` };
  }
  return { ok: true, value: trimmed };
}

function safeDisplayText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

// =============================================================================
// 4. EFFECTIVE PASS & PICKUP STATUS / EXPIRY HELPERS
// =============================================================================

/**
 * Computes the effective presentation status of a Child Gate Pass against a deterministic clock.
 * - An `ACTIVE` pass whose `validUntil <= now` is presented as `EXPIRED` (exact boundary).
 * - An `ACTIVE` pass with `currentUses >= maxUses` (where `maxUses > 0`) is presented as `USED`.
 * - An `ACTIVE` pass with a missing or unparseable `validUntil` fails closed as `UNKNOWN`.
 * - Unknown backend statuses fail closed as `UNKNOWN` (never coerced to `ACTIVE`).
 */
export function getEffectiveGatePassStatus(
  pass: Pick<ChildGatePassDto, 'status' | 'validUntil' | 'archivedAt' | 'currentUses' | 'maxUses'>,
  now?: Date | number
): EffectiveGatePassDisplayStatus {
  if (!pass || typeof pass !== 'object') return 'UNKNOWN';
  if (pass.archivedAt) return 'ARCHIVED';

  const rawStatus = typeof pass.status === 'string' ? pass.status.trim().toUpperCase() : '';
  if (!ALLOWED_GATE_PASS_STATUS_SET.has(rawStatus)) {
    return 'UNKNOWN';
  }

  if (rawStatus !== 'ACTIVE') {
    return rawStatus as ChildGatePassStatusDto;
  }

  if (
    typeof pass.maxUses === 'number' &&
    typeof pass.currentUses === 'number' &&
    Number.isFinite(pass.maxUses) &&
    Number.isFinite(pass.currentUses) &&
    pass.maxUses > 0 &&
    pass.currentUses >= pass.maxUses
  ) {
    return 'USED';
  }

  const validUntilMs = parseTimestampMs(pass.validUntil);
  if (validUntilMs === null) {
    return 'UNKNOWN';
  }

  const nowMs = resolveClockMs(now);
  if (validUntilMs <= nowMs) {
    return 'EXPIRED';
  }

  return 'ACTIVE';
}

/**
 * Returns true if the pass's `validFrom` timestamp is strictly in the future.
 */
export function isGatePassNotYetValid(
  pass: Pick<ChildGatePassDto, 'validFrom'>,
  now?: Date | number
): boolean {
  const validFromMs = parseTimestampMs(pass?.validFrom);
  if (validFromMs === null) return false;
  return validFromMs > resolveClockMs(now);
}

/**
 * Returns true only when a pass is currently `ACTIVE` (neither expired, consumed, revoked, archived, nor invalid).
 */
export function canRevokeGatePass(
  pass: Pick<ChildGatePassDto, 'status' | 'validUntil' | 'archivedAt' | 'currentUses' | 'maxUses'>,
  now?: Date | number
): boolean {
  return getEffectiveGatePassStatus(pass, now) === 'ACTIVE';
}

/**
 * Computes the effective presentation status of an Authorized Pickup against a deterministic clock.
 * - An `ACTIVE` pickup with `validUntil <= now` is presented as `EXPIRED` (matching backend `POST /passes`).
 * - An `ACTIVE` pickup with a non-empty but invalid `validUntil` fails closed as `UNKNOWN`.
 * - Unknown backend statuses fail closed as `UNKNOWN`.
 */
export function getEffectivePickupStatus(
  pickup: Pick<AuthorizedPickupDto, 'status' | 'validUntil' | 'archivedAt'>,
  now?: Date | number
): EffectivePickupDisplayStatus {
  if (!pickup || typeof pickup !== 'object') return 'UNKNOWN';
  if (pickup.archivedAt) return 'ARCHIVED';

  const rawStatus = typeof pickup.status === 'string' ? pickup.status.trim().toUpperCase() : '';
  if (!ALLOWED_PICKUP_STATUS_SET.has(rawStatus)) {
    return 'UNKNOWN';
  }

  if (rawStatus !== 'ACTIVE') {
    return rawStatus as PickupAuthorizationStatusDto;
  }

  if (pickup.validUntil !== null && pickup.validUntil !== undefined && String(pickup.validUntil).trim() !== '') {
    const validUntilMs = parseTimestampMs(pickup.validUntil);
    if (validUntilMs === null) {
      return 'UNKNOWN';
    }
    if (validUntilMs <= resolveClockMs(now)) {
      return 'EXPIRED';
    }
  }

  return 'ACTIVE';
}

/**
 * Returns true only when the pickup authorization is effectively `ACTIVE` and eligible for gate pass issuance.
 */
export function isPickupSelectableForPass(
  pickup: Pick<AuthorizedPickupDto, 'status' | 'validUntil' | 'archivedAt'>,
  now?: Date | number
): boolean {
  return getEffectivePickupStatus(pickup, now) === 'ACTIVE';
}

// =============================================================================
// 5. GOVERNMENT ID LAST-4 VALIDATION & MASKED FORMATTING
// =============================================================================

/**
 * Validates optional `idDocumentLast4` input.
 * - Empty / null / undefined -> valid (`null`, optional field).
 * - Strictly allows 1–4 alphanumeric characters (`[A-Za-z0-9]{1,4}`).
 * - Rejects full government ID numbers, formatted masked strings (`XXXX-9901`), spaces, or >4 chars.
 */
export function validateIdDocumentLast4(
  raw: string | null | undefined
): HelperValidationResult<string | null> {
  if (raw === undefined || raw === null) {
    return { ok: true, value: null };
  }
  if (typeof raw !== 'string') {
    return {
      ok: false,
      field: 'idDocumentLast4',
      error: 'ID last 4 characters must be a text value.',
    };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }
  if (trimmed.length > 4) {
    return {
      ok: false,
      field: 'idDocumentLast4',
      error: 'Enter only the last 4 characters of the ID document, never the full government ID number.',
    };
  }
  if (!ID_LAST4_PATTERN.test(trimmed)) {
    return {
      ok: false,
      field: 'idDocumentLast4',
      error: 'ID last 4 characters must contain only 1 to 4 letters or digits (no spaces or dashes).',
    };
  }
  return { ok: true, value: trimmed.toUpperCase() };
}

/**
 * Formats optional masked pickup ID metadata for safe UI display.
 * Fails closed if `idDocumentLast4` is malformed or exceeds 4 characters (never echoes raw ID strings).
 */
export function formatMaskedPickupId(
  idDocumentType: string | null | undefined,
  idDocumentLast4: string | null | undefined
): string {
  const cleanType = typeof idDocumentType === 'string' ? idDocumentType.trim() : '';
  const last4Validation = validateIdDocumentLast4(idDocumentLast4);
  const safeLast4 = last4Validation.ok ? last4Validation.value : null;

  if (cleanType && safeLast4) {
    return `${cleanType} · XXXX-${safeLast4}`;
  }
  if (safeLast4) {
    return `ID · XXXX-${safeLast4}`;
  }
  if (cleanType) {
    return cleanType;
  }
  return 'ID Not Collected';
}

// =============================================================================
// 6. RESIDENT-SAFE REQUEST PAYLOAD MAPPERS (CANONICAL DTO CONTRACTS)
// =============================================================================

export function mapGenderInputToDto(input: string | null | undefined): ChildGenderDto {
  if (typeof input !== 'string') return 'UNSPECIFIED';
  const normalized = input.trim().toUpperCase();
  if (normalized === 'MALE' || normalized === 'BOY' || normalized === 'M') return 'MALE';
  if (normalized === 'FEMALE' || normalized === 'GIRL' || normalized === 'F') return 'FEMALE';
  if (normalized === 'OTHER') return 'OTHER';
  return 'UNSPECIFIED';
}

/**
 * Builds a validated `CreateChildProfileRequest` for a `resident` user.
 * - Strictly omits `residentId`, `flatId`, `flatNumber`, `guardianUserId`, and `societyId`
 *   so the backend resolves resident & flat ownership authoritatively from PostgreSQL.
 * - Automatically keeps `allowedSoloExit` consistent with `exitPermissionMode`.
 */
export function buildResidentCreateChildPayload(
  input: ResidentCreateChildFormInput,
  now?: Date | number
): HelperValidationResult<CreateChildProfileRequest> {
  const forbidden = findForbiddenRawIdKey(input);
  if (forbidden) {
    return {
      ok: false,
      field: forbidden,
      error: 'Raw identity document fields are prohibited on child profiles.',
    };
  }

  const fullName = typeof input?.fullName === 'string' ? input.fullName.trim() : '';
  if (!fullName || fullName.length > 200) {
    return { ok: false, field: 'fullName', error: 'Child full name is required (1–200 characters).' };
  }

  const guardianName = typeof input?.guardianName === 'string' ? input.guardianName.trim() : '';
  if (!guardianName || guardianName.length > 200) {
    return { ok: false, field: 'guardianName', error: 'Primary guardian name is required (1–200 characters).' };
  }

  const guardianPhone = typeof input?.guardianPhone === 'string' ? input.guardianPhone.trim() : '';
  if (!guardianPhone || guardianPhone.length > 32) {
    return { ok: false, field: 'guardianPhone', error: 'Primary guardian phone is required (1–32 characters).' };
  }

  const nowMs = resolveClockMs(now);
  let dateOfBirth: string | undefined;
  if (input.dateOfBirth !== undefined && input.dateOfBirth !== null && String(input.dateOfBirth).trim() !== '') {
    const dobMs = parseTimestampMs(input.dateOfBirth);
    if (dobMs === null || dobMs > nowMs) {
      return { ok: false, field: 'dateOfBirth', error: 'Date of birth must be a valid non-future date.' };
    }
    dateOfBirth = new Date(dobMs).toISOString();
  }

  let reportedAge: number | undefined;
  if (input.reportedAge !== undefined && input.reportedAge !== null && String(input.reportedAge).trim() !== '') {
    const parsedAge = Number(input.reportedAge);
    if (!Number.isInteger(parsedAge) || parsedAge < MIN_CHILD_AGE || parsedAge > MAX_CHILD_AGE) {
      return {
        ok: false,
        field: 'reportedAge',
        error: `Child age must be a whole number between ${MIN_CHILD_AGE} and ${MAX_CHILD_AGE}.`,
      };
    }
    reportedAge = parsedAge;
  }

  const rawMode = typeof input.exitPermissionMode === 'string' ? input.exitPermissionMode.trim().toUpperCase() : '';
  const exitPermissionMode: ChildExitPermissionModeDto = rawMode
    ? ALLOWED_EXIT_PERMISSION_MODE_SET.has(rawMode)
      ? (rawMode as ChildExitPermissionModeDto)
      : 'ESCORT_REQUIRED'
    : 'ESCORT_REQUIRED';
  if (rawMode && !ALLOWED_EXIT_PERMISSION_MODE_SET.has(rawMode)) {
    return { ok: false, field: 'exitPermissionMode', error: 'Invalid exit permission mode selected.' };
  }

  const medical = normalizeTrimmedOptional(input.medicalNotes, 1000, 'Medical notes');
  if (!medical.ok) return medical;
  const emergencyPhone = normalizeTrimmedOptional(input.emergencyPhone, 32, 'Emergency phone');
  if (!emergencyPhone.ok) return emergencyPhone;
  const notes = normalizeTrimmedOptional(input.notes, 1000, 'Notes');
  if (!notes.ok) return notes;
  const photoUrl = normalizeTrimmedOptional(input.photoUrl, 1000, 'Photo URL');
  if (!photoUrl.ok) return photoUrl;

  const payload: CreateChildProfileRequest = {
    fullName,
    guardianName,
    guardianPhone,
    gender: mapGenderInputToDto(input.gender),
    exitPermissionMode,
    allowedSoloExit: exitPermissionMode === 'SOLO_ALLOWED',
    ...(dateOfBirth !== undefined ? { dateOfBirth } : {}),
    ...(reportedAge !== undefined ? { reportedAge } : {}),
    ...(medical.value ? { medicalNotes: medical.value } : {}),
    ...(emergencyPhone.value ? { emergencyPhone: emergencyPhone.value } : {}),
    ...(notes.value ? { notes: notes.value } : {}),
    ...(photoUrl.value ? { photoUrl: photoUrl.value } : {}),
  };

  return { ok: true, value: payload };
}

/**
 * Builds a validated `UpdateChildProfileRequest` for a `resident` user.
 * Never includes immutable ownership fields (`societyId`, `residentId`, `flatId`, `guardianUserId`)
 * or administrative status overrides.
 */
export function buildResidentUpdateChildPayload(
  input: ResidentUpdateChildFormInput,
  now?: Date | number
): HelperValidationResult<UpdateChildProfileRequest> {
  const forbidden = findForbiddenRawIdKey(input);
  if (forbidden) {
    return {
      ok: false,
      field: forbidden,
      error: 'Raw identity document fields are prohibited on child profiles.',
    };
  }

  const payload: UpdateChildProfileRequest = {};
  const nowMs = resolveClockMs(now);

  if (input.fullName !== undefined) {
    const trimmed = typeof input.fullName === 'string' ? input.fullName.trim() : '';
    if (!trimmed || trimmed.length > 200) {
      return { ok: false, field: 'fullName', error: 'Child full name must be 1–200 characters.' };
    }
    payload.fullName = trimmed;
  }

  if (input.guardianName !== undefined) {
    const trimmed = typeof input.guardianName === 'string' ? input.guardianName.trim() : '';
    if (!trimmed || trimmed.length > 200) {
      return { ok: false, field: 'guardianName', error: 'Primary guardian name must be 1–200 characters.' };
    }
    payload.guardianName = trimmed;
  }

  if (input.guardianPhone !== undefined) {
    const trimmed = typeof input.guardianPhone === 'string' ? input.guardianPhone.trim() : '';
    if (!trimmed || trimmed.length > 32) {
      return { ok: false, field: 'guardianPhone', error: 'Primary guardian phone must be 1–32 characters.' };
    }
    payload.guardianPhone = trimmed;
  }

  if (input.dateOfBirth !== undefined) {
    if (input.dateOfBirth === null || String(input.dateOfBirth).trim() === '') {
      payload.dateOfBirth = null;
    } else {
      const dobMs = parseTimestampMs(input.dateOfBirth);
      if (dobMs === null || dobMs > nowMs) {
        return { ok: false, field: 'dateOfBirth', error: 'Date of birth must be a valid non-future date.' };
      }
      payload.dateOfBirth = new Date(dobMs).toISOString();
    }
  }

  if (input.reportedAge !== undefined) {
    if (input.reportedAge === null || String(input.reportedAge).trim() === '') {
      payload.reportedAge = null;
    } else {
      const parsedAge = Number(input.reportedAge);
      if (!Number.isInteger(parsedAge) || parsedAge < MIN_CHILD_AGE || parsedAge > MAX_CHILD_AGE) {
        return {
          ok: false,
          field: 'reportedAge',
          error: `Child age must be a whole number between ${MIN_CHILD_AGE} and ${MAX_CHILD_AGE}.`,
        };
      }
      payload.reportedAge = parsedAge;
    }
  }

  if (input.gender !== undefined) {
    payload.gender = mapGenderInputToDto(input.gender);
  }

  if (input.exitPermissionMode !== undefined && input.exitPermissionMode !== null) {
    const mode = String(input.exitPermissionMode).trim().toUpperCase();
    if (!ALLOWED_EXIT_PERMISSION_MODE_SET.has(mode)) {
      return { ok: false, field: 'exitPermissionMode', error: 'Invalid exit permission mode.' };
    }
    payload.exitPermissionMode = mode as ChildExitPermissionModeDto;
    payload.allowedSoloExit = mode === 'SOLO_ALLOWED';
  }

  const medical = normalizeTrimmedOptional(input.medicalNotes, 1000, 'Medical notes');
  if (!medical.ok) return medical;
  if (medical.value !== undefined) payload.medicalNotes = medical.value;

  const emergencyPhone = normalizeTrimmedOptional(input.emergencyPhone, 32, 'Emergency phone');
  if (!emergencyPhone.ok) return emergencyPhone;
  if (emergencyPhone.value !== undefined) payload.emergencyPhone = emergencyPhone.value;

  const notes = normalizeTrimmedOptional(input.notes, 1000, 'Notes');
  if (!notes.ok) return notes;
  if (notes.value !== undefined) payload.notes = notes.value;

  const photoUrl = normalizeTrimmedOptional(input.photoUrl, 1000, 'Photo URL');
  if (!photoUrl.ok) return photoUrl;
  if (photoUrl.value !== undefined) payload.photoUrl = photoUrl.value;

  if (Object.keys(payload).length === 0) {
    return { ok: false, error: 'Provide at least one updated child profile field.' };
  }

  return { ok: true, value: payload };
}

/**
 * Builds a validated `CreateAuthorizedPickupRequest` using strictly supported backend DTO fields.
 * Rejects any forbidden raw government ID field or `idDocumentLast4` exceeding 4 characters.
 */
export function buildCreateAuthorizedPickupPayload(
  input: ResidentCreatePickupFormInput,
  now?: Date | number
): HelperValidationResult<CreateAuthorizedPickupRequest> {
  const forbidden = findForbiddenRawIdKey(input);
  if (forbidden) {
    return {
      ok: false,
      field: forbidden,
      error: 'Raw government ID numbers are prohibited. Provide only optional document type and last 4 characters.',
    };
  }

  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 200) {
    return { ok: false, field: 'name', error: 'Escort full name is required (1–200 characters).' };
  }

  const phone = typeof input?.phone === 'string' ? input.phone.trim() : '';
  if (!isValidPhoneNumber(phone)) {
    return {
      ok: false,
      field: 'phone',
      error: 'Escort phone number must be a valid phone number containing 7–15 digits.',
    };
  }

  const relationship = typeof input?.relationship === 'string' ? input.relationship.trim() : '';
  if (!relationship || relationship.length > 100) {
    return { ok: false, field: 'relationship', error: 'Escort relationship is required (1–100 characters).' };
  }

  const docType = normalizeTrimmedOptional(input.idDocumentType, 64, 'ID document type');
  if (!docType.ok) return docType;

  const docLast4 = validateIdDocumentLast4(input.idDocumentLast4);
  if (!docLast4.ok) return docLast4;

  const notes = normalizeTrimmedOptional(input.notes, 500, 'Notes');
  if (!notes.ok) return notes;

  const photoUrl = normalizeTrimmedOptional(input.photoUrl, 1000, 'Photo URL');
  if (!photoUrl.ok) return photoUrl;

  let validUntil: string | null | undefined;
  if (input.validUntil !== undefined && input.validUntil !== null && String(input.validUntil).trim() !== '') {
    const vuMs = parseTimestampMs(input.validUntil);
    if (vuMs === null || vuMs <= resolveClockMs(now)) {
      return { ok: false, field: 'validUntil', error: 'Escort authorization expiry must be a valid future timestamp.' };
    }
    validUntil = new Date(vuMs).toISOString();
  }

  const payload: CreateAuthorizedPickupRequest = {
    name,
    phone,
    relationship,
    ...(docType.value ? { idDocumentType: docType.value } : {}),
    ...(docLast4.value ? { idDocumentLast4: docLast4.value } : {}),
    ...(validUntil !== undefined ? { validUntil } : {}),
    ...(notes.value ? { notes: notes.value } : {}),
    ...(photoUrl.value ? { photoUrl: photoUrl.value } : {}),
  };

  return { ok: true, value: payload };
}

/**
 * Builds a validated `UpdateAuthorizedPickupRequest` containing ONLY fields processed by
 * backend `PATCH /api/children/:childId/pickups/:pickupId` (`name`, `phone`, `relationship`, `validUntil`, `status`).
 * Note: Backend `PATCH` does not mutate `idDocumentType`, `idDocumentLast4`, `photoUrl`, or `notes`.
 */
export function buildUpdateAuthorizedPickupPayload(
  input: ResidentUpdatePickupFormInput,
  now?: Date | number
): HelperValidationResult<UpdateAuthorizedPickupRequest> {
  const forbidden = findForbiddenRawIdKey(input);
  if (forbidden) {
    return {
      ok: false,
      field: forbidden,
      error: 'Raw government ID numbers are prohibited.',
    };
  }

  const payload: UpdateAuthorizedPickupRequest = {};

  if (input.name !== undefined) {
    const trimmed = typeof input.name === 'string' ? input.name.trim() : '';
    if (!trimmed || trimmed.length > 200) {
      return { ok: false, field: 'name', error: 'Escort full name must be 1–200 characters.' };
    }
    payload.name = trimmed;
  }

  if (input.phone !== undefined) {
    const trimmed = typeof input.phone === 'string' ? input.phone.trim() : '';
    if (!isValidPhoneNumber(trimmed)) {
      return {
        ok: false,
        field: 'phone',
        error: 'Escort phone number must be a valid phone number containing 7–15 digits.',
      };
    }
    payload.phone = trimmed;
  }

  if (input.relationship !== undefined) {
    const trimmed = typeof input.relationship === 'string' ? input.relationship.trim() : '';
    if (!trimmed || trimmed.length > 100) {
      return { ok: false, field: 'relationship', error: 'Escort relationship must be 1–100 characters.' };
    }
    payload.relationship = trimmed;
  }

  if (input.validUntil !== undefined) {
    if (input.validUntil === null || String(input.validUntil).trim() === '') {
      payload.validUntil = null;
    } else {
      const vuMs = parseTimestampMs(input.validUntil);
      if (vuMs === null || vuMs <= resolveClockMs(now)) {
        return { ok: false, field: 'validUntil', error: 'Escort authorization expiry must be in the future.' };
      }
      payload.validUntil = new Date(vuMs).toISOString();
    }
  }

  if (input.status !== undefined) {
    const normalized = String(input.status).trim().toUpperCase();
    if (!ALLOWED_PICKUP_MUTABLE_STATUS_SET.has(normalized)) {
      return {
        ok: false,
        field: 'status',
        error: 'Pickup status must be ACTIVE, REVOKED, or EXPIRED. Use archive to archive a pickup.',
      };
    }
    payload.status = normalized as Exclude<PickupAuthorizationStatusDto, 'ARCHIVED'>;
  }

  if (Object.keys(payload).length === 0) {
    return { ok: false, error: 'Provide at least one updatable pickup field (name, phone, relationship, validUntil, or status).' };
  }

  return { ok: true, value: payload };
}

/**
 * Builds a validated `{ request, options }` pair for `childSafetyService.createGatePass(request, options)`.
 * Enforces backend validity bounds (≤7 days, `validUntil > validFrom`, `validUntil > now`),
 * `maxUses` (`1..10`), child eligibility (`SAFE`/`OUT_OF_SOCIETY`), and pickup requirement.
 */
export function buildResidentCreateGatePassPayload(
  input: ResidentCreateGatePassFormInput,
  child: Pick<ChildProfileDto, 'id' | 'status' | 'archivedAt' | 'exitPermissionMode' | 'allowedSoloExit'>,
  now?: Date | number
): HelperValidationResult<{ request: CreateChildGatePassRequest; options: CreateChildGatePassOptions }> {
  if (!child || !child.id || !child.id.trim()) {
    return { ok: false, field: 'childId', error: 'Select a child profile before generating a gate pass.' };
  }
  if (child.status === 'ARCHIVED' || child.archivedAt) {
    return { ok: false, field: 'childId', error: 'Cannot issue a gate pass for an archived child profile.' };
  }
  if (child.status === 'MISSING') {
    return {
      ok: false,
      field: 'childId',
      error: 'Cannot issue a gate pass while the child has an active MISSING status.',
    };
  }

  const nowMs = resolveClockMs(now);
  const validFromMs =
    input.validFrom !== undefined && input.validFrom !== null && String(input.validFrom).trim() !== ''
      ? parseTimestampMs(input.validFrom)
      : nowMs;
  if (validFromMs === null) {
    return { ok: false, field: 'validFrom', error: 'Pass start time must be a valid timestamp.' };
  }

  const validUntilMs = parseTimestampMs(input.validUntil);
  if (validUntilMs === null) {
    return { ok: false, field: 'validUntil', error: 'Pass expiry time must be a valid future timestamp.' };
  }
  if (validUntilMs <= validFromMs || validUntilMs <= nowMs) {
    return {
      ok: false,
      field: 'validUntil',
      error: 'Pass expiry must be strictly after start time and in the future.',
    };
  }
  if (validUntilMs - validFromMs > MAX_CHILD_GATE_PASS_DURATION_MS) {
    return {
      ok: false,
      field: 'validUntil',
      error: 'Gate pass validity window cannot exceed 7 days.',
    };
  }

  const maxUses =
    input.maxUses !== undefined && input.maxUses !== null && String(input.maxUses).trim() !== ''
      ? Number(input.maxUses)
      : 1;
  if (!Number.isInteger(maxUses) || maxUses < MIN_PASS_MAX_USES || maxUses > MAX_PASS_MAX_USES) {
    return {
      ok: false,
      field: 'maxUses',
      error: `Maximum uses must be a whole number between ${MIN_PASS_MAX_USES} and ${MAX_PASS_MAX_USES}.`,
    };
  }

  const notes = normalizeTrimmedOptional(input.notes, 500, 'Notes');
  if (!notes.ok) return notes;

  const pickupPersonId =
    typeof input.pickupPersonId === 'string' && input.pickupPersonId.trim().length > 0
      ? input.pickupPersonId.trim()
      : null;

  const allowsSolo = child.exitPermissionMode === 'SOLO_ALLOWED' && Boolean(child.allowedSoloExit);
  if (!pickupPersonId && !allowsSolo) {
    return {
      ok: false,
      field: 'pickupPersonId',
      error: 'An active authorized escort must be selected for this child’s exit policy.',
    };
  }

  const request: CreateChildGatePassRequest = {
    childId: child.id.trim(),
    ...(pickupPersonId ? { pickupPersonId } : {}),
    validFrom: new Date(validFromMs).toISOString(),
    validUntil: new Date(validUntilMs).toISOString(),
    maxUses,
    ...(notes.value ? { notes: notes.value } : {}),
  };

  const options: CreateChildGatePassOptions = {
    childExitPermissionMode: child.exitPermissionMode,
  };

  return { ok: true, value: { request, options } };
}

/**
 * Builds a validated `TriggerChildSosRequest` for a `resident` user.
 * Enforces backend resident requirements: owned `childId` and non-empty `location` (≤255 chars).
 */
export function buildResidentTriggerSosPayload(
  input: ResidentTriggerSosFormInput
): HelperValidationResult<TriggerChildSosRequest> {
  const childId = typeof input?.childId === 'string' ? input.childId.trim() : '';
  if (!childId || childId.length > 128) {
    return { ok: false, field: 'childId', error: 'Select the child profile before dispatching a Child Safety SOS.' };
  }

  const location = typeof input?.location === 'string' ? input.location.trim() : '';
  if (!location || location.length > 255) {
    return { ok: false, field: 'location', error: 'Last known location is required (1–255 characters).' };
  }

  const rawAlertType = typeof input.alertType === 'string' && input.alertType.trim()
    ? input.alertType.trim().toUpperCase()
    : 'MISSING_CHILD';
  if (!ALLOWED_ALERT_TYPE_SET.has(rawAlertType)) {
    return { ok: false, field: 'alertType', error: 'Invalid Child Safety alert type.' };
  }

  const rawSeverity = typeof input.severity === 'string' && input.severity.trim()
    ? input.severity.trim().toUpperCase()
    : 'CRITICAL';
  if (!ALLOWED_INCIDENT_SEVERITY_SET.has(rawSeverity)) {
    return { ok: false, field: 'severity', error: 'Invalid alert severity level.' };
  }

  const description = normalizeTrimmedOptional(input.description, 1000, 'Description');
  if (!description.ok) return description;

  const lastSeenDetails = normalizeTrimmedOptional(input.lastSeenDetails, 500, 'Last seen details');
  if (!lastSeenDetails.ok) return lastSeenDetails;

  const payload: TriggerChildSosRequest = {
    childId,
    location,
    alertType: rawAlertType as ChildAlertTypeDto,
    severity: rawSeverity as IncidentSeverityDto,
    ...(description.value ? { description: description.value } : {}),
    ...(lastSeenDetails.value ? { lastSeenDetails: lastSeenDetails.value } : {}),
  };

  return { ok: true, value: payload };
}

// =============================================================================
// 7. ROLE-AWARE ACTION VISIBILITY (Matches server/src/childSafety/router.ts#L49-L55)
// =============================================================================

/**
 * Computes UI action visibility for the authenticated role, mirroring backend RBAC sets.
 * Fails closed (all `false`) for unknown, empty, vendor, delivery, or facility_manager roles.
 * Residents NEVER receive alert acknowledge/resolve or gate-pass verify permissions.
 */
export function getResidentChildSafetyPermissions(
  role: string | null | undefined
): ChildSafetyRolePermissions {
  const normalized = typeof role === 'string' ? role.trim().toLowerCase() : '';

  if (normalized === 'resident') {
    return {
      canListChildren: true,
      canRegisterOwnChild: true,
      requiresAdminDeskForChildCreation: false,
      canEditChild: true,
      canArchiveChild: true,
      canManagePickups: true,
      canCreateGatePass: true,
      canRevokeGatePass: true,
      canVerifyGatePass: false,
      canTriggerChildSos: true,
      canViewAlerts: true,
      canAcknowledgeAlert: false,
      canResolveAlert: false,
      canViewExitLogs: true,
    };
  }

  if (normalized === 'secretary' || normalized === 'admin') {
    return {
      canListChildren: true,
      canRegisterOwnChild: false,
      requiresAdminDeskForChildCreation: true,
      canEditChild: true,
      canArchiveChild: true,
      canManagePickups: true,
      canCreateGatePass: true,
      canRevokeGatePass: true,
      canVerifyGatePass: normalized === 'admin',
      canTriggerChildSos: true,
      canViewAlerts: true,
      canAcknowledgeAlert: true,
      canResolveAlert: true,
      canViewExitLogs: true,
    };
  }

  if (normalized === 'guard') {
    return {
      canListChildren: false,
      canRegisterOwnChild: false,
      requiresAdminDeskForChildCreation: false,
      canEditChild: false,
      canArchiveChild: false,
      canManagePickups: false,
      canCreateGatePass: false,
      canRevokeGatePass: false,
      canVerifyGatePass: true,
      canTriggerChildSos: true,
      canViewAlerts: true,
      canAcknowledgeAlert: true,
      canResolveAlert: true,
      canViewExitLogs: true,
    };
  }

  if (normalized === 'committee') {
    return {
      canListChildren: true,
      canRegisterOwnChild: false,
      requiresAdminDeskForChildCreation: false,
      canEditChild: false,
      canArchiveChild: false,
      canManagePickups: false,
      canCreateGatePass: false,
      canRevokeGatePass: false,
      canVerifyGatePass: false,
      canTriggerChildSos: true,
      canViewAlerts: true,
      canAcknowledgeAlert: true,
      canResolveAlert: true,
      canViewExitLogs: true,
    };
  }

  // Fail closed for vendor, delivery, facility_manager, empty, or unknown roles
  return {
    canListChildren: false,
    canRegisterOwnChild: false,
    requiresAdminDeskForChildCreation: false,
    canEditChild: false,
    canArchiveChild: false,
    canManagePickups: false,
    canCreateGatePass: false,
    canRevokeGatePass: false,
    canVerifyGatePass: false,
    canTriggerChildSos: false,
    canViewAlerts: false,
    canAcknowledgeAlert: false,
    canResolveAlert: false,
    canViewExitLogs: false,
  };
}

// =============================================================================
// 8. SAFE DISPLAY PROJECTIONS (Zero token/hash/QR/raw-ID pass-through)
// =============================================================================

const CHILD_STATUS_LABELS: Record<SafeChildDisplayStatus, string> = {
  SAFE: 'Safe on Premises',
  OUT_OF_SOCIETY: 'Outside Premises',
  MISSING: 'Missing Alert Active',
  ARCHIVED: 'Archived',
  UNKNOWN: 'Status Unknown',
};

const CHILD_GENDER_LABELS: Record<ChildGenderDto, string> = {
  MALE: 'Male',
  FEMALE: 'Female',
  OTHER: 'Other',
  UNSPECIFIED: 'Not Specified',
};

const EXIT_POLICY_LABELS: Record<ChildExitPermissionModeDto, string> = {
  ESCORT_REQUIRED: 'Authorized Escort Required',
  SOLO_ALLOWED: 'Solo Exit Permitted',
  TIMED_PASS_ONLY: 'Timed Pass Only',
  UNKNOWN: 'Escort Policy Unspecified',
};

const PICKUP_STATUS_LABELS: Record<EffectivePickupDisplayStatus, string> = {
  ACTIVE: 'Active',
  REVOKED: 'Revoked',
  EXPIRED: 'Expired',
  ARCHIVED: 'Archived',
  UNKNOWN: 'Status Unknown',
};

const PICKUP_VERIFICATION_LABELS: Record<PickupIdVerificationStatusDto | 'UNKNOWN', string> = {
  NOT_COLLECTED: 'ID Not Collected',
  UNVERIFIED: 'Pending Verification',
  PENDING_REVIEW: 'Pending Review',
  VERIFIED: 'ID Verified',
  REJECTED: 'ID Rejected',
  UNKNOWN: 'Verification Unknown',
};

const PASS_STATUS_LABELS: Record<EffectiveGatePassDisplayStatus, string> = {
  ACTIVE: 'Active',
  USED: 'Used',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
  ARCHIVED: 'Archived',
  UNKNOWN: 'Status Unknown',
};

const EXIT_OUTCOME_LABELS: Record<SafeExitOutcomeDisplay, string> = {
  ALLOWED: 'Exit Allowed',
  DENIED: 'Exit Denied',
  MISSING_ALERT_BLOCKED: 'Blocked — Missing Alert',
  VERIFICATION_UNAVAILABLE: 'Verification Unavailable',
  UNKNOWN: 'Outcome Unknown',
};

const VERIFICATION_CHANNEL_LABELS: Record<ChildVerificationChannelDto | 'UNKNOWN', string> = {
  ONLINE_QR_TOKEN: 'QR Pass Verified',
  ONLINE_PASS_CODE_ASSISTED: 'Assisted Online Check',
  MANUAL_OVERRIDE_DENIED: 'Manual Override Denied',
  BACKEND_UNAVAILABLE: 'Service Unavailable',
  UNKNOWN: 'Unknown Channel',
};

const ALERT_TYPE_LABELS: Record<ChildAlertTypeDto | 'UNKNOWN', string> = {
  MISSING_CHILD: 'Missing Child Alert',
  UNATTENDED_CHILD: 'Unattended Child',
  UNAUTHORIZED_EXIT_ATTEMPT: 'Unauthorized Exit Attempt',
  EMERGENCY_SOS: 'Child Emergency SOS',
  UNKNOWN: 'Child Safety Alert',
};

const ALERT_STATUS_LABELS: Record<SafeAlertDisplayStatus, string> = {
  ACTIVE: 'Active — Awaiting Security',
  ACKNOWLEDGED: 'Acknowledged by Security',
  RESOLVED: 'Resolved',
  FALSE_ALARM: 'Closed (False Alarm)',
  UNKNOWN: 'Status Unknown',
};

const SEVERITY_LABELS: Record<IncidentSeverityDto | 'UNKNOWN', string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
  UNKNOWN: 'Unknown',
};

export function formatChildProfileDisplay(
  child: ChildProfileDto,
  now?: Date | number
): ChildProfileDisplayModel {
  const rawStatus = typeof child?.status === 'string' ? child.status.trim().toUpperCase() : '';
  const status: SafeChildDisplayStatus = child?.archivedAt
    ? 'ARCHIVED'
    : ALLOWED_CHILD_STATUS_SET.has(rawStatus)
      ? (rawStatus as ChildProfileStatusDto)
      : 'UNKNOWN';

  const rawGender = typeof child?.gender === 'string' ? child.gender.trim().toUpperCase() : '';
  const gender: ChildGenderDto = ALLOWED_CHILD_GENDER_SET.has(rawGender)
    ? (rawGender as ChildGenderDto)
    : 'UNSPECIFIED';

  const rawMode = typeof child?.exitPermissionMode === 'string' ? child.exitPermissionMode.trim().toUpperCase() : '';
  const exitPermissionMode: ChildExitPermissionModeDto = ALLOWED_EXIT_PERMISSION_MODE_SET.has(rawMode)
    ? (rawMode as ChildExitPermissionModeDto)
    : 'UNKNOWN';

  const dobMs = parseTimestampMs(child?.dateOfBirth);
  let ageOrDobLabel = 'Age not provided';
  if (typeof child?.reportedAge === 'number' && Number.isFinite(child.reportedAge)) {
    ageOrDobLabel = `Age ${child.reportedAge}`;
  } else if (dobMs !== null) {
    ageOrDobLabel = `DOB ${new Date(dobMs).toISOString().slice(0, 10)}`;
  }

  const activePickupCount = Array.isArray(child?.pickups)
    ? child.pickups.filter((p) => isPickupSelectableForPass(p, now)).length
    : 0;

  const isArchived = status === 'ARCHIVED';
  const isMissing = status === 'MISSING';

  return {
    id: safeDisplayText(child?.id, ''),
    fullName: safeDisplayText(child?.fullName, 'Unnamed Child'),
    flatNumber: safeDisplayText(child?.flatNumber, 'Flat Unassigned'),
    status,
    statusLabel: CHILD_STATUS_LABELS[status],
    gender,
    genderLabel: CHILD_GENDER_LABELS[gender],
    ageOrDobLabel,
    exitPermissionMode,
    exitPolicyLabel: EXIT_POLICY_LABELS[exitPermissionMode],
    guardianName: safeDisplayText(child?.guardianName, 'Guardian Not Listed'),
    guardianPhone: safeDisplayText(child?.guardianPhone, 'Phone Not Listed'),
    emergencyPhone: typeof child?.emergencyPhone === 'string' && child.emergencyPhone.trim() ? child.emergencyPhone.trim() : null,
    medicalNotes: typeof child?.medicalNotes === 'string' && child.medicalNotes.trim() ? child.medicalNotes.trim() : null,
    notes: typeof child?.notes === 'string' && child.notes.trim() ? child.notes.trim() : null,
    activePickupCount,
    isArchived,
    isMissing,
    canIssuePass: status === 'SAFE' || status === 'OUT_OF_SOCIETY',
  };
}

export function formatAuthorizedPickupDisplay(
  pickup: AuthorizedPickupDto,
  now?: Date | number
): AuthorizedPickupDisplayModel {
  const effectiveStatus = getEffectivePickupStatus(pickup, now);

  const rawVerif =
    typeof pickup?.idVerificationStatus === 'string' ? pickup.idVerificationStatus.trim().toUpperCase() : '';
  const verificationStatus: PickupIdVerificationStatusDto | 'UNKNOWN' = ALLOWED_PICKUP_VERIFICATION_SET.has(rawVerif)
    ? (rawVerif as PickupIdVerificationStatusDto)
    : 'UNKNOWN';

  return {
    id: safeDisplayText(pickup?.id, ''),
    childId: safeDisplayText(pickup?.childId, ''),
    name: safeDisplayText(pickup?.name, 'Unnamed Escort'),
    phone: safeDisplayText(pickup?.phone, 'Phone Not Listed'),
    relationship: safeDisplayText(pickup?.relationship, 'Authorized Escort'),
    effectiveStatus,
    statusLabel: PICKUP_STATUS_LABELS[effectiveStatus],
    maskedIdLabel: formatMaskedPickupId(pickup?.idDocumentType, pickup?.idDocumentLast4),
    verificationStatus,
    verificationLabel: PICKUP_VERIFICATION_LABELS[verificationStatus],
    validUntil: parseTimestampMs(pickup?.validUntil) !== null ? String(pickup.validUntil) : null,
    notes: typeof pickup?.notes === 'string' && pickup.notes.trim() ? pickup.notes.trim() : null,
    isSelectableForPass: effectiveStatus === 'ACTIVE',
    // Backend blocks editing REVOKED or ARCHIVED pickups (`router.ts#L2353, #L2424`)
    canEdit: effectiveStatus === 'ACTIVE' || effectiveStatus === 'EXPIRED',
    canRevoke: effectiveStatus === 'ACTIVE' || effectiveStatus === 'EXPIRED',
    canArchive: effectiveStatus !== 'ARCHIVED' && effectiveStatus !== 'UNKNOWN',
  };
}

/**
 * Formats an ordinary `ChildGatePassDto` into a safe display projection.
 * Explicitly constructs ONLY allowlisted non-secret properties — never passes through
 * `bearerToken`, `qrPayload`, or `tokenHash` even if unexpectedly attached at runtime.
 */
export function formatGatePassDisplay(
  pass: ChildGatePassDto,
  now?: Date | number
): GatePassDisplayModel {
  const effectiveStatus = getEffectiveGatePassStatus(pass, now);
  const currentUses =
    typeof pass?.currentUses === 'number' && Number.isFinite(pass.currentUses) && pass.currentUses >= 0
      ? pass.currentUses
      : 0;
  const maxUses =
    typeof pass?.maxUses === 'number' && Number.isFinite(pass.maxUses) && pass.maxUses >= 1
      ? pass.maxUses
      : 1;

  return {
    id: safeDisplayText(pass?.id, ''),
    childId: safeDisplayText(pass?.childId, ''),
    passCode: safeDisplayText(pass?.passCode, 'CODE-UNAVAILABLE'),
    childName: safeDisplayText(pass?.child?.fullName, 'Child Profile'),
    flatNumber: safeDisplayText(pass?.child?.flatNumber, ''),
    pickupPersonId: typeof pass?.pickupPersonId === 'string' && pass.pickupPersonId.trim() ? pass.pickupPersonId.trim() : null,
    pickupPersonName: safeDisplayText(pass?.pickupPersonName, 'Authorized Escort'),
    pickupPersonPhone:
      typeof pass?.pickupPersonPhone === 'string' && pass.pickupPersonPhone.trim() ? pass.pickupPersonPhone.trim() : null,
    effectiveStatus,
    statusLabel: PASS_STATUS_LABELS[effectiveStatus],
    currentUses,
    maxUses,
    usageLabel: `${currentUses} of ${maxUses} used`,
    validFrom: safeDisplayText(pass?.validFrom, ''),
    validUntil: safeDisplayText(pass?.validUntil, ''),
    isNotYetValid: isGatePassNotYetValid(pass, now),
    canRevoke: effectiveStatus === 'ACTIVE',
    revocationReason:
      typeof pass?.revocationReason === 'string' && pass.revocationReason.trim() ? pass.revocationReason.trim() : null,
    notes: typeof pass?.notes === 'string' && pass.notes.trim() ? pass.notes.trim() : null,
    createdAt: safeDisplayText(pass?.createdAt, ''),
  };
}

export function formatExitLogDisplay(log: ChildExitLogDto): ExitLogDisplayModel {
  const rawOutcome = typeof log?.outcome === 'string' ? log.outcome.trim().toUpperCase() : '';
  const outcome: SafeExitOutcomeDisplay = ALLOWED_EXIT_OUTCOME_SET.has(rawOutcome)
    ? (rawOutcome as ChildExitOutcomeDto)
    : 'UNKNOWN';

  const rawChannel =
    typeof log?.verificationChannel === 'string' ? log.verificationChannel.trim().toUpperCase() : '';
  const verificationChannel: ChildVerificationChannelDto | 'UNKNOWN' = ALLOWED_VERIFICATION_CHANNEL_SET.has(rawChannel)
    ? (rawChannel as ChildVerificationChannelDto)
    : 'UNKNOWN';

  return {
    id: safeDisplayText(log?.id, ''),
    childId: typeof log?.childId === 'string' && log.childId.trim() ? log.childId.trim() : null,
    passId: typeof log?.passId === 'string' && log.passId.trim() ? log.passId.trim() : null,
    childName: safeDisplayText(log?.childName, 'Child'),
    flatNumber: safeDisplayText(log?.flatNumber, ''),
    pickupPersonName: safeDisplayText(log?.pickupPersonName, 'Unknown Escort'),
    pickupPersonPhone:
      typeof log?.pickupPersonPhone === 'string' && log.pickupPersonPhone.trim() ? log.pickupPersonPhone.trim() : null,
    gateId: safeDisplayText(log?.gateId, 'Main Gate'),
    guardName: safeDisplayText(log?.guardName, 'Security Guard'),
    outcome,
    outcomeLabel: EXIT_OUTCOME_LABELS[outcome],
    verificationChannel,
    verificationChannelLabel: VERIFICATION_CHANNEL_LABELS[verificationChannel],
    denialReason: typeof log?.denialReason === 'string' && log.denialReason.trim() ? log.denialReason.trim() : null,
    notes: typeof log?.notes === 'string' && log.notes.trim() ? log.notes.trim() : null,
    timestamp: safeDisplayText(log?.timestamp, ''),
  };
}

export function formatSafetyAlertDisplay(alert: ChildSafetyAlertDto): SafetyAlertDisplayModel {
  const rawType = typeof alert?.alertType === 'string' ? alert.alertType.trim().toUpperCase() : '';
  const alertType: ChildAlertTypeDto | 'UNKNOWN' = ALLOWED_ALERT_TYPE_SET.has(rawType)
    ? (rawType as ChildAlertTypeDto)
    : 'UNKNOWN';

  const rawSeverity = typeof alert?.severity === 'string' ? alert.severity.trim().toUpperCase() : '';
  const severity: IncidentSeverityDto | 'UNKNOWN' = ALLOWED_INCIDENT_SEVERITY_SET.has(rawSeverity)
    ? (rawSeverity as IncidentSeverityDto)
    : 'UNKNOWN';

  const rawStatus = typeof alert?.status === 'string' ? alert.status.trim().toUpperCase() : '';
  const status: SafeAlertDisplayStatus = ALLOWED_ALERT_STATUS_SET.has(rawStatus)
    ? (rawStatus as ChildAlertStatusDto)
    : 'UNKNOWN';

  return {
    id: safeDisplayText(alert?.id, ''),
    childId: typeof alert?.childId === 'string' && alert.childId.trim() ? alert.childId.trim() : null,
    childName: safeDisplayText(alert?.childName, 'Child'),
    flatNumber: safeDisplayText(alert?.flatNumber, ''),
    alertType,
    alertTypeLabel: ALERT_TYPE_LABELS[alertType],
    severity,
    severityLabel: SEVERITY_LABELS[severity],
    status,
    statusLabel: ALERT_STATUS_LABELS[status],
    location: safeDisplayText(alert?.location, 'Premises'),
    description: typeof alert?.description === 'string' && alert.description.trim() ? alert.description.trim() : null,
    lastSeenDetails:
      typeof alert?.lastSeenDetails === 'string' && alert.lastSeenDetails.trim() ? alert.lastSeenDetails.trim() : null,
    reportedByName:
      typeof alert?.reportedByName === 'string' && alert.reportedByName.trim() ? alert.reportedByName.trim() : null,
    acknowledgedByName:
      typeof alert?.acknowledgedByName === 'string' && alert.acknowledgedByName.trim()
        ? alert.acknowledgedByName.trim()
        : null,
    acknowledgedAt: parseTimestampMs(alert?.acknowledgedAt) !== null ? String(alert.acknowledgedAt) : null,
    resolvedByName:
      typeof alert?.resolvedByName === 'string' && alert.resolvedByName.trim() ? alert.resolvedByName.trim() : null,
    resolvedAt: parseTimestampMs(alert?.resolvedAt) !== null ? String(alert.resolvedAt) : null,
    resolutionNotes:
      typeof alert?.resolutionNotes === 'string' && alert.resolutionNotes.trim() ? alert.resolutionNotes.trim() : null,
    createdAt: safeDisplayText(alert?.createdAt, ''),
    isOpen: status === 'ACTIVE' || status === 'ACKNOWLEDGED',
  };
}

