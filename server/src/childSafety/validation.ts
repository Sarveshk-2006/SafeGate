import { Response } from 'express';
import { sanitizeErrorMessage } from '../dbConfig.js';

export const ALLOWED_CHILD_GENDERS = ['MALE', 'FEMALE', 'OTHER', 'UNSPECIFIED'] as const;
export const ALLOWED_CHILD_STATUSES = ['SAFE', 'OUT_OF_SOCIETY', 'MISSING', 'ARCHIVED'] as const;
export const ALLOWED_EXIT_PERMISSION_MODES = [
  'ESCORT_REQUIRED',
  'SOLO_ALLOWED',
  'TIMED_PASS_ONLY',
  'UNKNOWN',
] as const;
export const ALLOWED_PICKUP_STATUSES = ['ACTIVE', 'REVOKED', 'EXPIRED', 'ARCHIVED'] as const;
export const ALLOWED_ALERT_TYPES = [
  'MISSING_CHILD',
  'UNATTENDED_CHILD',
  'UNAUTHORIZED_EXIT_ATTEMPT',
  'EMERGENCY_SOS',
] as const;
export const ALLOWED_INCIDENT_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const ALLOWED_ALERT_RESOLVE_STATUSES = ['RESOLVED', 'FALSE_ALARM'] as const;

export const FORBIDDEN_RAW_ID_FIELDS = [
  'idProofNumber',
  'id_proof_number',
  'aadhaarNumber',
  'aadhaar',
  'panNumber',
  'passportNumber',
  'drivingLicenseNumber',
  'govIdNumber',
];

export function isNonEmptyString(val: unknown, maxLen = 255): val is string {
  return typeof val === 'string' && val.trim().length > 0 && val.trim().length <= maxLen;
}

export function normalizeOptionalString(val: unknown, maxLen = 500): { valid: boolean; value?: string | null } {
  if (val === undefined) return { valid: true, value: undefined };
  if (val === null || val === '') return { valid: true, value: null };
  if (typeof val !== 'string') return { valid: false };
  const trimmed = val.trim();
  if (trimmed.length > maxLen) return { valid: false };
  return { valid: true, value: trimmed.length > 0 ? trimmed : null };
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
 * Accepts optional leading `+`, digits, spaces, dashes, dots, and balanced parentheses
 * (7–15 digits, max 32 chars, ending in a digit or `)`).
 */
export function isValidPhoneNumber(val: unknown): val is string {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (trimmed.length < 7 || trimmed.length > 32) return false;
  if (!ALLOWED_PHONE_CHARS_RE.test(trimmed)) return false;
  if (!hasBalancedPhoneParentheses(trimmed)) return false;
  const digitsOnly = trimmed.replace(/\D/g, '');
  return digitsOnly.length >= 7 && digitsOnly.length <= 15;
}

/**
 * Strictly parses an ISO-8601 date or timestamp (or `Date`), rejecting impossible
 * calendar dates (e.g. `2027-02-30`, `2027-04-31`, `2027-02-29`) and invalid time/offset components.
 */
export function parseIsoDate(val: unknown): Date | null {
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? null : val;
  }
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (trimmed.length === 0) return null;

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
  const parsed = new Date(normalized);
  return isNaN(parsed.getTime()) ? null : parsed;
}

export function hasForbiddenRawIdField(body: Record<string, any>): string | null {
  if (!body || typeof body !== 'object') return null;
  for (const field of FORBIDDEN_RAW_ID_FIELDS) {
    if (body[field] !== undefined && body[field] !== null && String(body[field]).trim() !== '') {
      return field;
    }
  }
  return null;
}

const SIMPLE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface NormalizedContactEntry {
  name: string;
  relationship: string;
  phone: string;
  email?: string;
}

/**
 * Strictly validates and normalizes `secondaryGuardians` or `emergencyContacts` arrays.
 * Rejects non-arrays, oversized lists (> maxItems), unknown nested fields, or raw ID numbers.
 */
export function validateContactList(
  input: unknown,
  fieldName: 'secondaryGuardians' | 'emergencyContacts',
  options: { allowEmail: boolean; maxItems?: number }
): { valid: true; value: NormalizedContactEntry[] | null | undefined } | { valid: false; error: string } {
  if (input === undefined) return { valid: true, value: undefined };
  if (input === null) return { valid: true, value: null };
  if (!Array.isArray(input)) {
    return { valid: false, error: `${fieldName} must be an array of contact objects.` };
  }
  const maxItems = options.maxItems ?? 5;
  if (input.length > maxItems) {
    return { valid: false, error: `${fieldName} cannot exceed ${maxItems} entries.` };
  }

  const allowedKeys = new Set(
    options.allowEmail ? ['name', 'relationship', 'phone', 'email'] : ['name', 'relationship', 'phone']
  );

  const normalized: NormalizedContactEntry[] = [];
  for (let i = 0; i < input.length; i++) {
    const item = input[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { valid: false, error: `${fieldName}[${i}] must be a plain object.` };
    }

    const forbidden = hasForbiddenRawIdField(item);
    if (forbidden) {
      return { valid: false, error: `${fieldName}[${i}] contains prohibited raw ID field '${forbidden}'.` };
    }

    for (const key of Object.keys(item)) {
      if (!allowedKeys.has(key)) {
        return { valid: false, error: `${fieldName}[${i}] contains unexpected field '${key}'.` };
      }
    }

    if (!isNonEmptyString(item.name, 150)) {
      return { valid: false, error: `${fieldName}[${i}].name is required (1–150 chars).` };
    }
    if (!isNonEmptyString(item.relationship, 80)) {
      return { valid: false, error: `${fieldName}[${i}].relationship is required (1–80 chars).` };
    }
    if (!isNonEmptyString(item.phone, 32) || item.phone.trim().length < 5) {
      return { valid: false, error: `${fieldName}[${i}].phone is required (5–32 chars).` };
    }

    const entry: NormalizedContactEntry = {
      name: item.name.trim(),
      relationship: item.relationship.trim(),
      phone: item.phone.trim(),
    };

    if (options.allowEmail && item.email !== undefined && item.email !== null && item.email !== '') {
      if (typeof item.email !== 'string' || item.email.trim().length > 200 || !SIMPLE_EMAIL_REGEX.test(item.email.trim())) {
        return { valid: false, error: `${fieldName}[${i}].email must be a valid email address.` };
      }
      entry.email = item.email.trim().toLowerCase();
    }

    normalized.push(entry);
  }

  return { valid: true, value: normalized };
}

/**
 * Detects database connectivity / availability errors so gate verification and APIs
 * can return HTTP 503 (fail-closed) rather than silently falling back or leaking internals.
 */
export function isDatabaseUnavailableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as any;
  const code = String(e.code || '');
  const name = String(e.name || '');
  const msg = String(e.message || '');

  if (
    code === 'P1001' ||
    code === 'P1002' ||
    code === 'P1008' ||
    code === 'P1017' ||
    code === 'P2024' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === '57P01' ||
    code === '57P03'
  ) {
    return true;
  }

  if (
    name === 'PrismaClientInitializationError' ||
    name === 'PrismaClientRustPanicError'
  ) {
    return true;
  }

  if (
    /can't reach database server|connection refused|connection terminated|database unavailable|timeout expired/i.test(
      msg
    )
  ) {
    return true;
  }

  return false;
}

export function handleChildSafetyError(res: Response, err: unknown, contextLabel: string): Response {
  if (isDatabaseUnavailableError(err)) {
    return res.status(503).json({
      error: 'Child Safety database service is temporarily unavailable. Please retry shortly.',
      code: 'DATABASE_UNAVAILABLE',
    });
  }

  const code = (err as any)?.code;
  if (code === 'P2002') {
    return res.status(409).json({
      error: 'A conflicting record already exists.',
      code: 'CONFLICT',
    });
  }
  if (code === 'P2003') {
    return res.status(409).json({
      error: 'Referenced record constraint violation.',
      code: 'REFERENTIAL_INTEGRITY_VIOLATION',
    });
  }
  if (code === 'P2025') {
    return res.status(404).json({
      error: 'Requested resource not found.',
      code: 'NOT_FOUND',
    });
  }

  console.error(`[ChildSafety:${contextLabel}]`, sanitizeErrorMessage(err));
  return res.status(500).json({
    error: sanitizeErrorMessage(err),
    code: 'INTERNAL_SERVER_ERROR',
  });
}

// ---------------------------------------------------------------------------
// DTO Sanitizers — guarantee tokenHash and idDocumentHash are NEVER exposed
// ---------------------------------------------------------------------------

export function sanitizeChildProfileDto(child: any) {
  return {
    id: child.id,
    societyId: child.societyId,
    residentId: child.residentId,
    flatId: child.flatId,
    guardianUserId: child.guardianUserId ?? null,
    flatNumber: child.flatNumber,
    fullName: child.fullName,
    dateOfBirth: child.dateOfBirth instanceof Date ? child.dateOfBirth.toISOString() : child.dateOfBirth ?? null,
    reportedAge: child.reportedAge ?? null,
    gender: child.gender,
    photoUrl: child.photoUrl ?? null,
    medicalNotes: child.medicalNotes ?? null,
    status: child.status,
    exitPermissionMode: child.exitPermissionMode,
    allowedSoloExit: Boolean(child.allowedSoloExit),
    guardianName: child.guardianName,
    guardianPhone: child.guardianPhone,
    emergencyPhone: child.emergencyPhone ?? null,
    secondaryGuardians: child.secondaryGuardians ?? null,
    emergencyContacts: child.emergencyContacts ?? null,
    notes: child.notes ?? null,
    archivedAt: child.archivedAt instanceof Date ? child.archivedAt.toISOString() : child.archivedAt ?? null,
    createdAt: child.createdAt instanceof Date ? child.createdAt.toISOString() : child.createdAt,
    updatedAt: child.updatedAt instanceof Date ? child.updatedAt.toISOString() : child.updatedAt,
    ...(Array.isArray(child.pickups) ? { pickups: child.pickups.map(sanitizePickupDto) } : {}),
  };
}

export function sanitizePickupDto(pickup: any) {
  // Explicitly omits `idDocumentHash`
  return {
    id: pickup.id,
    societyId: pickup.societyId,
    childId: pickup.childId,
    name: pickup.name,
    phone: pickup.phone,
    relationship: pickup.relationship,
    idDocumentType: pickup.idDocumentType ?? null,
    idDocumentLast4: pickup.idDocumentLast4 ?? null,
    idVerificationStatus: pickup.idVerificationStatus,
    idVerifiedAt: pickup.idVerifiedAt instanceof Date ? pickup.idVerifiedAt.toISOString() : pickup.idVerifiedAt ?? null,
    photoUrl: pickup.photoUrl ?? null,
    status: pickup.status,
    validUntil: pickup.validUntil instanceof Date ? pickup.validUntil.toISOString() : pickup.validUntil ?? null,
    notes: pickup.notes ?? null,
    archivedAt: pickup.archivedAt instanceof Date ? pickup.archivedAt.toISOString() : pickup.archivedAt ?? null,
    createdAt: pickup.createdAt instanceof Date ? pickup.createdAt.toISOString() : pickup.createdAt,
    updatedAt: pickup.updatedAt instanceof Date ? pickup.updatedAt.toISOString() : pickup.updatedAt,
  };
}

export function sanitizeGatePassDto(pass: any) {
  // Explicitly omits `tokenHash` — NEVER exposed in any API response
  return {
    id: pass.id,
    societyId: pass.societyId,
    childId: pass.childId,
    pickupPersonId: pass.pickupPersonId ?? null,
    passCode: pass.passCode,
    pickupPersonName: pass.pickupPersonName,
    pickupPersonPhone: pass.pickupPersonPhone ?? null,
    validFrom: pass.validFrom instanceof Date ? pass.validFrom.toISOString() : pass.validFrom,
    validUntil: pass.validUntil instanceof Date ? pass.validUntil.toISOString() : pass.validUntil,
    status: pass.status,
    maxUses: pass.maxUses,
    currentUses: pass.currentUses,
    firstUsedAt: pass.firstUsedAt instanceof Date ? pass.firstUsedAt.toISOString() : pass.firstUsedAt ?? null,
    lastUsedAt: pass.lastUsedAt instanceof Date ? pass.lastUsedAt.toISOString() : pass.lastUsedAt ?? null,
    revokedAt: pass.revokedAt instanceof Date ? pass.revokedAt.toISOString() : pass.revokedAt ?? null,
    revocationReason: pass.revocationReason ?? null,
    notes: pass.notes ?? null,
    archivedAt: pass.archivedAt instanceof Date ? pass.archivedAt.toISOString() : pass.archivedAt ?? null,
    createdAt: pass.createdAt instanceof Date ? pass.createdAt.toISOString() : pass.createdAt,
    updatedAt: pass.updatedAt instanceof Date ? pass.updatedAt.toISOString() : pass.updatedAt,
    ...(pass.child
      ? {
          child: {
            id: pass.child.id,
            fullName: pass.child.fullName,
            flatNumber: pass.child.flatNumber,
            status: pass.child.status,
          },
        }
      : {}),
  };
}

export function sanitizeExitLogDto(log: any) {
  return {
    id: log.id,
    societyId: log.societyId,
    childId: log.childId ?? null,
    passId: log.passId ?? null,
    pickupPersonId: log.pickupPersonId ?? null,
    childName: log.childName,
    flatNumber: log.flatNumber,
    pickupPersonName: log.pickupPersonName,
    pickupPersonPhone: log.pickupPersonPhone ?? null,
    gateId: log.gateId,
    guardId: log.guardId ?? null,
    guardName: log.guardName,
    outcome: log.outcome,
    verificationChannel: log.verificationChannel,
    denialReason: log.denialReason ?? null,
    notes: log.notes ?? null,
    timestamp: log.timestamp instanceof Date ? log.timestamp.toISOString() : log.timestamp,
  };
}

export function sanitizeSafetyAlertDto(alert: any) {
  return {
    id: alert.id,
    societyId: alert.societyId,
    childId: alert.childId ?? null,
    reportedById: alert.reportedById ?? null,
    reportedByName: alert.reportedByName ?? null,
    childName: alert.childName,
    flatNumber: alert.flatNumber,
    alertType: alert.alertType,
    severity: alert.severity,
    status: alert.status,
    location: alert.location,
    description: alert.description ?? null,
    lastSeenDetails: alert.lastSeenDetails ?? null,
    acknowledgedAt:
      alert.acknowledgedAt instanceof Date ? alert.acknowledgedAt.toISOString() : alert.acknowledgedAt ?? null,
    acknowledgedById: alert.acknowledgedById ?? null,
    acknowledgedByName: alert.acknowledgedByName ?? null,
    resolvedAt: alert.resolvedAt instanceof Date ? alert.resolvedAt.toISOString() : alert.resolvedAt ?? null,
    resolvedById: alert.resolvedById ?? null,
    resolvedByName: alert.resolvedByName ?? null,
    resolutionNotes: alert.resolutionNotes ?? null,
    emergencyIncidentId: alert.emergencyIncidentId ?? null,
    createdAt: alert.createdAt instanceof Date ? alert.createdAt.toISOString() : alert.createdAt,
    updatedAt: alert.updatedAt instanceof Date ? alert.updatedAt.toISOString() : alert.updatedAt,
  };
}

