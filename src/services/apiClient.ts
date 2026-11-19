import { getBackendBaseUrl } from '../utils/backendConfig';
import { getAuthHeaders, getAuthToken, clearAuthSession } from './authStorage';
import type {
  AuthorizedPickupDto,
  ChildExitLogDto,
  ChildGatePassChildSummaryDto,
  ChildGatePassCreatedDto,
  ChildGatePassDto,
  ChildProfileDto,
  ChildSafetyAlertDto,
  ChildSosCreatedDto,
  CreateAuthorizedPickupRequest,
  CreateChildGatePassOptions,
  CreateChildGatePassRequest,
  CreateChildProfileRequest,
  ListChildAlertsParams,
  ListChildExitLogsParams,
  ListChildGatePassesParams,
  ListChildrenParams,
  ResolveChildAlertRequest,
  RevokeChildGatePassRequest,
  TriggerChildSosRequest,
  UpdateAuthorizedPickupRequest,
  UpdateChildProfileRequest,
  VerifyChildGatePassRequest,
  VerifyChildGatePassSuccessDto,
} from '../types/childSafety';

/**
 * AARIZO CommunityOS - Unified API Client
 * Connects React frontend directly to the Node.js + Express + Prisma + PostgreSQL backend.
 * Provides canonical strict error propagation (`apiRequestStrict` + `ApiError`) for
 * security-critical Child Safety APIs while preserving legacy `apiRequest` compatibility
 * for unrelated modules.
 */

const API_BASE = `${getBackendBaseUrl()}/api`;

const DEFAULT_STRICT_TIMEOUT_MS = 15000;
const GATE_VERIFY_TIMEOUT_MS = 10000;
const MAX_ERROR_PAYLOAD_DEPTH = 6;
const MAX_ERROR_PAYLOAD_KEYS = 50;
const MAX_ERROR_ARRAY_ITEMS = 50;

const FORBIDDEN_RAW_ID_FIELDS_LOWER = new Set([
  'idproofnumber',
  'id_proof_number',
  'aadhaarnumber',
  'aadhaar_number',
  'aadhaar',
  'pannumber',
  'pan_number',
  'passportnumber',
  'passport_number',
  'drivinglicensenumber',
  'driving_license_number',
  'govidnumber',
  'gov_id_number',
]);

const SENSITIVE_ERROR_PAYLOAD_KEYS_LOWER = new Set([
  'token',
  'bearertoken',
  'qrpayload',
  'tokenhash',
  'iddocumenthash',
  'password',
  'passwordhash',
  'stack',
  'sql',
  'query',
  'authorization',
  'secret',
  'jwt',
  'apikey',
  'accesstoken',
  'refreshtoken',
  ...FORBIDDEN_RAW_ID_FIELDS_LOWER,
]);

const BLOCKED_CALLER_HEADERS_LOWER = new Set([
  'authorization',
  'x-society-id',
  'x-user-id',
  'x-user-role',
]);

const UNSAFE_MESSAGE_PATTERNS = [
  /\b(SELECT|INSERT|UPDATE|DELETE)\b[\s\S]*\b(FROM|INTO|SET)\b/i,
  /prisma\./i,
  /\b(ECONNREFUSED|ETIMEDOUT|ENOTFOUND|P1001|P1002|P2002|P2003|P2025)\b/i,
  /\bat\s+[A-Za-z0-9_$.<>]+\s*\(/,
  /\bDATABASE_URL\b/i,
  /\bBearer\s+[A-Za-z0-9._-]{12,}/i,
  /AARIZO_CHILD_PASS:[A-Fa-f0-9]{16,}/i,
  /\b[a-f0-9]{64}\b/i,
];

// Exact Prisma / Backend enum membership sets (server/prisma/schema.prisma & validation.ts)
const ALLOWED_CHILD_GENDER_SET = new Set(['MALE', 'FEMALE', 'OTHER', 'UNSPECIFIED']);
const ALLOWED_CHILD_STATUS_SET = new Set(['SAFE', 'OUT_OF_SOCIETY', 'MISSING', 'ARCHIVED']);
const ALLOWED_EXIT_PERMISSION_MODE_SET = new Set([
  'ESCORT_REQUIRED',
  'SOLO_ALLOWED',
  'TIMED_PASS_ONLY',
  'UNKNOWN',
]);
const ALLOWED_PICKUP_STATUS_SET = new Set(['ACTIVE', 'REVOKED', 'EXPIRED', 'ARCHIVED']);
const ALLOWED_PICKUP_ID_VERIFICATION_STATUS_SET = new Set([
  'NOT_COLLECTED',
  'UNVERIFIED',
  'PENDING_REVIEW',
  'VERIFIED',
  'REJECTED',
]);
const ALLOWED_GATE_PASS_STATUS_SET = new Set(['ACTIVE', 'USED', 'EXPIRED', 'REVOKED', 'ARCHIVED']);
const ALLOWED_EXIT_OUTCOME_SET = new Set([
  'ALLOWED',
  'DENIED',
  'MISSING_ALERT_BLOCKED',
  'VERIFICATION_UNAVAILABLE',
]);
const ALLOWED_VERIFICATION_CHANNEL_SET = new Set([
  'ONLINE_QR_TOKEN',
  'ONLINE_PASS_CODE_ASSISTED',
  'MANUAL_OVERRIDE_DENIED',
  'BACKEND_UNAVAILABLE',
]);
const ALLOWED_ALERT_TYPE_SET = new Set([
  'MISSING_CHILD',
  'UNATTENDED_CHILD',
  'UNAUTHORIZED_EXIT_ATTEMPT',
  'EMERGENCY_SOS',
]);
const ALLOWED_ALERT_STATUS_SET = new Set(['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_ALARM']);
const ALLOWED_INCIDENT_SEVERITY_SET = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

export type ApiErrorKind =
  | 'NETWORK'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'SERVER_ERROR'
  | 'INVALID_RESPONSE';

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly kind: ApiErrorKind;
  public readonly endpoint: string;
  public readonly payload?: Record<string, unknown>;
  public readonly retryAfterSeconds?: number;

  constructor(params: {
    message: string;
    status: number;
    code: string;
    kind: ApiErrorKind;
    endpoint: string;
    payload?: Record<string, unknown>;
    retryAfterSeconds?: number;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.status = params.status;
    this.code = params.code;
    this.kind = params.kind;
    this.endpoint = params.endpoint;
    this.payload = params.payload;
    this.retryAfterSeconds = params.retryAfterSeconds;
  }

  public get isFailClosedUnavailable(): boolean {
    return this.kind === 'UNAVAILABLE' || this.kind === 'NETWORK';
  }
}

export interface StrictRequestOptions<T> extends RequestInit {
  timeoutMs?: number;
  validate?: (data: unknown) => data is T;
}

function getDefaultErrorMessage(status: number, kind: ApiErrorKind): string {
  switch (kind) {
    case 'NETWORK':
      return 'Unable to reach the server. Please check your connection and try again.';
    case 'UNAUTHORIZED':
      return 'Your session has expired or is unauthorized. Please sign in again.';
    case 'FORBIDDEN':
      return 'You do not have permission to perform this action.';
    case 'NOT_FOUND':
      return 'The requested record was not found.';
    case 'CONFLICT':
      return 'This action conflicts with the current state of the record.';
    case 'VALIDATION':
      return 'Please review the submitted details and try again.';
    case 'RATE_LIMITED':
      return 'Too many requests. Please wait briefly before trying again.';
    case 'UNAVAILABLE':
      return 'The service is temporarily unavailable. Please try again shortly.';
    case 'INVALID_RESPONSE':
      return 'Received an unexpected response from the server.';
    case 'SERVER_ERROR':
    default:
      return status >= 500
        ? 'An unexpected server error occurred. Please try again shortly.'
        : 'The request could not be completed.';
  }
}

function classifyHttpStatus(status: number): ApiErrorKind {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 422 || status === 400) return 'VALIDATION';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 503) return 'UNAVAILABLE';
  if (status >= 500) return 'SERVER_ERROR';
  return 'VALIDATION';
}

function defaultCodeForStatus(status: number, kind: ApiErrorKind): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'UNPROCESSABLE_ENTITY';
    case 429:
      return 'RATE_LIMIT_EXCEEDED';
    case 503:
      return 'BACKEND_UNAVAILABLE';
    default:
      return kind === 'SERVER_ERROR' ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_FAILED';
  }
}

function hasUnsafePattern(value: string): boolean {
  for (const pattern of UNSAFE_MESSAGE_PATTERNS) {
    if (pattern.test(value)) {
      return true;
    }
  }
  return false;
}

function sanitizeUserErrorMessage(rawMessage: unknown, status: number, kind: ApiErrorKind): string {
  if (typeof rawMessage !== 'string') {
    return getDefaultErrorMessage(status, kind);
  }
  const trimmed = rawMessage.trim();
  if (!trimmed || trimmed.length > 400 || hasUnsafePattern(trimmed)) {
    return getDefaultErrorMessage(status, kind);
  }
  return trimmed;
}

function sanitizeErrorValue(
  value: unknown,
  status: number,
  kind: ApiErrorKind,
  seen: WeakSet<object>,
  depth: number,
  keyLower?: string
): unknown {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    if (keyLower === 'error' || keyLower === 'message') {
      return sanitizeUserErrorMessage(value, status, kind);
    }
    const trimmed = value.trim();
    if (trimmed.length > 400 || hasUnsafePattern(trimmed)) {
      return '[REDACTED]';
    }
    return value;
  }

  if (typeof value !== 'object') {
    return undefined;
  }

  if (depth >= MAX_ERROR_PAYLOAD_DEPTH || seen.has(value)) {
    return undefined;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const cleanItems: unknown[] = [];
    const limit = Math.min(value.length, MAX_ERROR_ARRAY_ITEMS);
    for (let i = 0; i < limit; i++) {
      const sanitizedItem = sanitizeErrorValue(value[i], status, kind, seen, depth + 1);
      if (sanitizedItem !== undefined) {
        cleanItems.push(sanitizedItem);
      }
    }
    return cleanItems;
  }

  const cleanObj: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  let kept = 0;
  for (const [k, v] of entries) {
    if (kept >= MAX_ERROR_PAYLOAD_KEYS) break;
    const normalizedKey = k.toLowerCase();
    if (SENSITIVE_ERROR_PAYLOAD_KEYS_LOWER.has(normalizedKey)) {
      continue;
    }
    const sanitizedVal = sanitizeErrorValue(v, status, kind, seen, depth + 1, normalizedKey);
    if (sanitizedVal !== undefined) {
      cleanObj[k] = sanitizedVal;
      kept++;
    }
  }
  return Object.keys(cleanObj).length > 0 ? cleanObj : undefined;
}

function sanitizeErrorPayload(
  raw: unknown,
  status: number,
  kind: ApiErrorKind
): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const seen = new WeakSet<object>();
  const sanitized = sanitizeErrorValue(raw, status, kind, seen, 0);
  return isPlainRecord(sanitized) && Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function normalizeCallerHeaders(extraHeaders?: HeadersInit): Array<[string, string]> {
  if (!extraHeaders) return [];

  if (Array.isArray(extraHeaders)) {
    const entries: Array<[string, string]> = [];
    for (const pair of extraHeaders) {
      if (Array.isArray(pair) && pair.length >= 2 && typeof pair[0] === 'string' && typeof pair[1] === 'string') {
        entries.push([pair[0], pair[1]]);
      }
    }
    return entries;
  }

  if (typeof (extraHeaders as Headers).forEach === 'function') {
    const entries: Array<[string, string]> = [];
    (extraHeaders as Headers).forEach((value, key) => {
      entries.push([key, value]);
    });
    return entries;
  }

  if (typeof extraHeaders === 'object') {
    const entries: Array<[string, string]> = [];
    for (const [key, value] of Object.entries(extraHeaders as Record<string, string>)) {
      if (typeof value === 'string') {
        entries.push([key, value]);
      }
    }
    return entries;
  }

  return [];
}

function parseRetryAfterHeader(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  if (!trimmed) return undefined;
  const asSeconds = Number(trimmed);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.ceil(asSeconds);
  }
  const asDateMs = Date.parse(trimmed);
  if (!Number.isNaN(asDateMs)) {
    const deltaSeconds = Math.ceil((asDateMs - Date.now()) / 1000);
    return deltaSeconds > 0 ? deltaSeconds : 0;
  }
  return undefined;
}

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

function isNonEmptyStringValue(val: unknown): val is string {
  return typeof val === 'string' && val.trim().length > 0;
}

function isStringValue(val: unknown): val is string {
  return typeof val === 'string';
}

function assertNoForbiddenRawIdFields(input: unknown, endpoint: string): void {
  if (!input || typeof input !== 'object') return;
  if (Array.isArray(input)) {
    for (const item of input) {
      assertNoForbiddenRawIdFields(item, endpoint);
    }
    return;
  }
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (
      FORBIDDEN_RAW_ID_FIELDS_LOWER.has(key.toLowerCase()) &&
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ''
    ) {
      throw new ApiError({
        status: 400,
        code: 'RAW_ID_DOCUMENT_FORBIDDEN',
        kind: 'VALIDATION',
        endpoint,
        message: 'Raw identity document numbers are prohibited. Only optional document type and last 4 characters are allowed.',
      });
    }
    if (value && typeof value === 'object') {
      assertNoForbiddenRawIdFields(value, endpoint);
    }
  }
}

function assertValidIdDocumentLast4(value: string | null | undefined, endpoint: string): void {
  if (value === undefined || value === null || value === '') return;
  if (typeof value !== 'string') {
    throw new ApiError({
      status: 400,
      code: 'INVALID_PICKUP_METADATA',
      kind: 'VALIDATION',
      endpoint,
      message: 'idDocumentLast4 must be a string of 1 to 4 characters.',
    });
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return;
  if (trimmed.length > 4) {
    throw new ApiError({
      status: 400,
      code: 'INVALID_PICKUP_METADATA',
      kind: 'VALIDATION',
      endpoint,
      message: 'idDocumentLast4 cannot exceed 4 characters.',
    });
  }
}

function buildQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    sp.set(key, String(value));
  }
  const encoded = sp.toString();
  return encoded ? `?${encoded}` : '';
}

function encodeSegment(value: string, fieldName: string, endpoint: string): string {
  if (!isNonEmptyStringValue(value)) {
    throw new ApiError({
      status: 400,
      code: 'BAD_REQUEST',
      kind: 'VALIDATION',
      endpoint,
      message: `${fieldName} is required.`,
    });
  }
  return encodeURIComponent(value.trim());
}

// =============================================================================
// RUNTIME RESPONSE VALIDATORS (Child Safety DTO Contracts)
// =============================================================================

function isEnumValue(val: unknown, allowedSet: Set<string>): val is string {
  return typeof val === 'string' && allowedSet.has(val);
}

export function isAuthorizedPickupDto(val: unknown): val is AuthorizedPickupDto {
  if (!isPlainRecord(val)) return false;
  if ('idDocumentHash' in val) return false;
  return (
    isNonEmptyStringValue(val.id) &&
    isNonEmptyStringValue(val.societyId) &&
    isNonEmptyStringValue(val.childId) &&
    isStringValue(val.name) &&
    isStringValue(val.phone) &&
    isStringValue(val.relationship) &&
    isEnumValue(val.status, ALLOWED_PICKUP_STATUS_SET) &&
    isEnumValue(val.idVerificationStatus, ALLOWED_PICKUP_ID_VERIFICATION_STATUS_SET) &&
    isStringValue(val.createdAt)
  );
}

export function isChildProfileDto(val: unknown): val is ChildProfileDto {
  if (!isPlainRecord(val)) return false;
  const baseValid =
    isNonEmptyStringValue(val.id) &&
    isNonEmptyStringValue(val.societyId) &&
    isNonEmptyStringValue(val.residentId) &&
    isNonEmptyStringValue(val.flatId) &&
    isStringValue(val.flatNumber) &&
    isNonEmptyStringValue(val.fullName) &&
    isEnumValue(val.gender, ALLOWED_CHILD_GENDER_SET) &&
    isEnumValue(val.status, ALLOWED_CHILD_STATUS_SET) &&
    isEnumValue(val.exitPermissionMode, ALLOWED_EXIT_PERMISSION_MODE_SET) &&
    typeof val.allowedSoloExit === 'boolean' &&
    isStringValue(val.guardianName) &&
    isStringValue(val.guardianPhone);
  if (!baseValid) return false;
  if (val.pickups !== undefined) {
    if (!Array.isArray(val.pickups) || !val.pickups.every(isAuthorizedPickupDto)) {
      return false;
    }
  }
  return true;
}

export function isChildGatePassChildSummaryDto(val: unknown): val is ChildGatePassChildSummaryDto {
  if (!isPlainRecord(val)) return false;
  return (
    isNonEmptyStringValue(val.id) &&
    isNonEmptyStringValue(val.fullName) &&
    isStringValue(val.flatNumber) &&
    isEnumValue(val.status, ALLOWED_CHILD_STATUS_SET)
  );
}

function isChildGatePassBase(val: unknown): val is Record<string, unknown> {
  if (!isPlainRecord(val)) return false;
  if ('tokenHash' in val) return false;
  const baseValid =
    isNonEmptyStringValue(val.id) &&
    isNonEmptyStringValue(val.societyId) &&
    isNonEmptyStringValue(val.childId) &&
    isNonEmptyStringValue(val.passCode) &&
    isStringValue(val.pickupPersonName) &&
    isStringValue(val.validFrom) &&
    isStringValue(val.validUntil) &&
    isEnumValue(val.status, ALLOWED_GATE_PASS_STATUS_SET) &&
    typeof val.maxUses === 'number' &&
    Number.isFinite(val.maxUses) &&
    typeof val.currentUses === 'number' &&
    Number.isFinite(val.currentUses);
  if (!baseValid) return false;
  if (val.child !== undefined && !isChildGatePassChildSummaryDto(val.child)) {
    return false;
  }
  return true;
}

/**
 * Ordinary Child Gate Pass DTO validator (`GET /passes`, `GET /passes/:id`, `POST /passes/:id/revoke`, `POST /passes/verify`).
 * Strictly rejects `tokenHash`, `bearerToken`, and `qrPayload`.
 */
export function isChildGatePassDto(val: unknown): val is ChildGatePassDto {
  if (!isChildGatePassBase(val)) return false;
  if ('bearerToken' in val || 'qrPayload' in val) return false;
  return true;
}

/**
 * One-time pass creation DTO validator (`POST /api/children/passes` ONLY).
 * Requires one-time `bearerToken` and `qrPayload` while strictly rejecting `tokenHash`.
 */
export function isChildGatePassCreatedDto(val: unknown): val is ChildGatePassCreatedDto {
  if (!isChildGatePassBase(val)) return false;
  return isNonEmptyStringValue(val.bearerToken) && isNonEmptyStringValue(val.qrPayload);
}

export function isChildExitLogDto(val: unknown): val is ChildExitLogDto {
  if (!isPlainRecord(val)) return false;
  return (
    isNonEmptyStringValue(val.id) &&
    isNonEmptyStringValue(val.societyId) &&
    isStringValue(val.childName) &&
    isStringValue(val.flatNumber) &&
    isStringValue(val.pickupPersonName) &&
    isStringValue(val.gateId) &&
    isStringValue(val.guardName) &&
    isEnumValue(val.outcome, ALLOWED_EXIT_OUTCOME_SET) &&
    isEnumValue(val.verificationChannel, ALLOWED_VERIFICATION_CHANNEL_SET) &&
    isStringValue(val.timestamp)
  );
}

export function isVerifyChildGatePassSuccessDto(val: unknown): val is VerifyChildGatePassSuccessDto {
  if (!isPlainRecord(val)) return false;
  return (
    val.authorized === true &&
    val.outcome === 'ALLOWED' &&
    isChildGatePassDto(val.pass) &&
    isChildExitLogDto(val.exitLog)
  );
}

export function isChildSafetyAlertDto(val: unknown): val is ChildSafetyAlertDto {
  if (!isPlainRecord(val)) return false;
  return (
    isNonEmptyStringValue(val.id) &&
    isNonEmptyStringValue(val.societyId) &&
    isStringValue(val.childName) &&
    isStringValue(val.flatNumber) &&
    isEnumValue(val.alertType, ALLOWED_ALERT_TYPE_SET) &&
    isEnumValue(val.severity, ALLOWED_INCIDENT_SEVERITY_SET) &&
    isEnumValue(val.status, ALLOWED_ALERT_STATUS_SET) &&
    isStringValue(val.location) &&
    isStringValue(val.createdAt)
  );
}

export function isChildSosCreatedDto(val: unknown): val is ChildSosCreatedDto {
  if (!isPlainRecord(val)) return false;
  if (!isChildSafetyAlertDto(val.alert)) return false;
  if (!isPlainRecord(val.emergencyIncident)) return false;
  const inc = val.emergencyIncident;
  return (
    isNonEmptyStringValue(inc.id) &&
    isNonEmptyStringValue(inc.societyId) &&
    isNonEmptyStringValue(inc.incidentType) &&
    isEnumValue(inc.severity, ALLOWED_INCIDENT_SEVERITY_SET) &&
    isStringValue(inc.location) &&
    isNonEmptyStringValue(inc.dispatchStatus)
  );
}

function arrayValidator<T>(itemValidator: (item: unknown) => item is T): (data: unknown) => data is T[] {
  return (data: unknown): data is T[] => Array.isArray(data) && data.every(itemValidator);
}

/**
 * Strict, fail-closed HTTP request transport for security-critical APIs.
 * - Attaches ONLY canonical `Authorization: Bearer <token>` (never spoofable `x-society-id`/`x-user-id`/`x-user-role`).
 * - Never converts HTTP or network failures into `null` or fake success objects.
 * - Never silently retries requests.
 * - Validates response JSON and DTO shape before returning.
 */
export async function apiRequestStrict<T>(
  endpoint: string,
  options: StrictRequestOptions<T> = {}
): Promise<T> {
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = `${API_BASE}${normalizedEndpoint}`;
  const requestToken = getAuthToken();

  if (!requestToken) {
    throw new ApiError({
      status: 401,
      code: 'AUTH_TOKEN_MISSING',
      kind: 'UNAUTHORIZED',
      endpoint: normalizedEndpoint,
      message: 'Authentication required. Please sign in to continue.',
    });
  }

  const { timeoutMs = DEFAULT_STRICT_TIMEOUT_MS, validate, headers: extraHeaders, signal: callerSignal, ...fetchInit } =
    options;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${requestToken}`,
  };

  if (fetchInit.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  for (const [k, v] of normalizeCallerHeaders(extraHeaders)) {
    const lower = k.toLowerCase();
    // Never permit client-supplied identity or Authorization override headers on strict endpoints
    if (BLOCKED_CALLER_HEADERS_LOWER.has(lower)) {
      continue;
    }
    headers[k] = v;
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeoutHandle =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : null;

  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...fetchInit,
      headers,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError({
      status: 0,
      code: timedOut ? 'REQUEST_TIMEOUT' : 'NETWORK_UNAVAILABLE',
      kind: 'NETWORK',
      endpoint: normalizedEndpoint,
      message: timedOut
        ? 'The request timed out while contacting the server. Please try again.'
        : getDefaultErrorMessage(0, 'NETWORK'),
    });
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
  }

  const rawText = await response.text().catch(() => '');
  let parsedBody: unknown = undefined;
  let jsonParseFailed = false;

  if (rawText.trim().length > 0) {
    try {
      parsedBody = JSON.parse(rawText);
    } catch {
      jsonParseFailed = true;
    }
  }

  if (!response.ok) {
    const status = response.status;
    const kind = classifyHttpStatus(status);
    const bodyObj = isPlainRecord(parsedBody) ? parsedBody : undefined;
    const backendCode =
      bodyObj && isNonEmptyStringValue(bodyObj.code) ? bodyObj.code.trim() : defaultCodeForStatus(status, kind);
    const backendMessage = bodyObj?.error ?? bodyObj?.message;
    const retryAfterSeconds =
      status === 429 || status === 503
        ? parseRetryAfterHeader(response.headers?.get?.('Retry-After') ?? null)
        : undefined;

    // Race-safe 401 handling: clear session & notify ONLY if the stored token still matches
    // the exact token used by this failed request. Prevents delayed stale-token 401s from wiping
    // a fresh login session and prevents duplicate event storms across concurrent 401s.
    if (status === 401 && !normalizedEndpoint.includes('/auth/login') && getAuthToken() === requestToken) {
      clearAuthSession();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('aarizo:unauthorized', { detail: { endpoint: normalizedEndpoint } }));
      }
    }

    throw new ApiError({
      status,
      code: backendCode,
      kind,
      endpoint: normalizedEndpoint,
      message: sanitizeUserErrorMessage(backendMessage, status, kind),
      payload: sanitizeErrorPayload(bodyObj, status, kind),
      retryAfterSeconds,
    });
  }

  if (jsonParseFailed || parsedBody === undefined) {
    throw new ApiError({
      status: 0,
      code: 'INVALID_RESPONSE',
      kind: 'INVALID_RESPONSE',
      endpoint: normalizedEndpoint,
      message: getDefaultErrorMessage(0, 'INVALID_RESPONSE'),
    });
  }

  if (validate && !validate(parsedBody)) {
    throw new ApiError({
      status: 0,
      code: 'INVALID_RESPONSE',
      kind: 'INVALID_RESPONSE',
      endpoint: normalizedEndpoint,
      message: 'Received an unexpected response format from the server.',
    });
  }

  return parsedBody as T;
}

interface RequestOptions extends RequestInit {
  societyId?: string;
  userId?: string;
  userRole?: string;
}

async function apiRequest<T>(endpoint: string, options: RequestOptions = {}): Promise<T | null> {
  const url = `${API_BASE}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  const defaultHeaders = getAuthHeaders();

  if (options.societyId) defaultHeaders['x-society-id'] = options.societyId;
  if (options.userId) defaultHeaders['x-user-id'] = options.userId;
  if (options.userRole) defaultHeaders['x-user-role'] = options.userRole;

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...defaultHeaders,
        ...(options.headers || {}),
      },
    });

    if (response.status === 401) {
      if (!endpoint.includes('/auth/login')) {
        clearAuthSession();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('aarizo:unauthorized', { detail: { endpoint } }));
        }
      }
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`[API] ${options.method || 'GET'} ${url} returned ${response.status}:`, errorText);
      return null;
    }

    return (await response.json()) as T;
  } catch (err) {
    console.warn(`[API] Failed to fetch ${url}. Falling back to client-side cache/state.`, err);
    return null;
  }
}

export const apiClient = {
  // Health
  checkHealth: () => apiRequest<{ status: string; engine: string }>('/health'),

  // Universal Provisioning API (7 Roles)
  provisionUser: (data: {
    societyId: string;
    role: string;
    name: string;
    email: string;
    phone: string;
    flatNumber?: string;
    password?: string;
    metadata?: Record<string, any>;
  }) =>
    apiRequest<{
      success: boolean;
      message: string;
      userId: string;
      role: string;
      temporaryPassword?: string;
      details?: any;
    }>('/secretary/provision-user', {
      method: 'POST',
      body: JSON.stringify(data),
      societyId: data.societyId,
    }),

  provisionSociety: (data: {
    societyName: string;
    address: string;
    city: string;
    state?: string;
    pincode: string;
    secretaryName: string;
    secretaryEmail: string;
    secretaryPhone: string;
    secretaryPassword?: string;
    towersCount?: number;
    flatsCount?: number;
  }) =>
    apiRequest<{
      success: boolean;
      message: string;
      societyId: string;
      userId: string;
      role: string;
      temporaryPassword?: string;
      details?: any;
    }>('/admin/provision-society', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  loginWithPassword: (data: { email: string; password: string }) =>
    apiRequest<{
      success: boolean;
      token?: string;
      user: {
        id: string;
        name: string;
        email: string;
        phone: string;
        role: string;
        societyId?: string;
        flatNumber?: string;
        societyName?: string;
      };
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Societies
  getSocieties: () => apiRequest<any[]>('/societies'),
  createSociety: (data: any) =>
    apiRequest<any>('/societies', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateSociety: (id: string, data: any) =>
    apiRequest<any>(`/societies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteSociety: (id: string) =>
    apiRequest<any>(`/societies/${id}`, {
      method: 'DELETE',
    }),

  // Committee Members
  getCommitteeMembers: (societyId?: string) => apiRequest<any[]>('/committee', { societyId }),
  createCommitteeMember: (data: {
    societyId?: string;
    name: string;
    email: string;
    phone: string;
    designation: string;
    flatNumber?: string;
  }) =>
    apiRequest<any>('/committee', {
      method: 'POST',
      body: JSON.stringify(data),
      societyId: data.societyId,
    }),

  // =========================================================================
  // Child Safety — Legacy Null-Returning Stubs (DEPRECATED: retained until Phase 7)
  // =========================================================================
  /** @deprecated Legacy null-returning stub. Use `apiClient.getChildrenStrict`. */
  getChildren: (societyId?: string) => apiRequest<any[]>('/children', { societyId }),
  /** @deprecated Legacy null-returning stub. Use `apiClient.createChildStrict`. */
  createChild: (data: any) =>
    apiRequest<any>('/children', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  /** @deprecated Legacy null-returning stub. Use `apiClient.getChildPassesStrict`. */
  getChildPasses: (societyId?: string) => apiRequest<any[]>('/children/passes', { societyId }),
  /** @deprecated Legacy null-returning stub. Use `apiClient.createChildPassStrict`. */
  createChildPass: (data: any) =>
    apiRequest<any>('/children/passes', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  /** @deprecated Legacy null-returning stub. Use `apiClient.verifyChildPassStrict`. */
  verifyChildPass: (id: string, societyId?: string) =>
    apiRequest<any>(`/children/passes/${id}/verify`, {
      method: 'POST',
      body: JSON.stringify({ societyId }),
    }),
  /** @deprecated Legacy null-returning stub. Use `apiClient.triggerChildSosStrict`. */
  triggerChildSOS: (data: any) =>
    apiRequest<any>('/children/sos', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // =========================================================================
  // Child Safety — Canonical Strict B.2.2 / B.2.3 APIs (Fail-Closed, Typed)
  // =========================================================================

  // 1. GET /api/children
  getChildrenStrict: async (params?: ListChildrenParams): Promise<ChildProfileDto[]> => {
    const query = buildQueryString({
      includeArchived: params?.includeArchived ? 'true' : undefined,
      societyId: params?.societyId,
    });
    return apiRequestStrict<ChildProfileDto[]>(`/children${query}`, {
      method: 'GET',
      validate: arrayValidator(isChildProfileDto),
    });
  },

  // 2. GET /api/children/:id
  getChildByIdStrict: async (id: string): Promise<ChildProfileDto> => {
    const safeId = encodeSegment(id, 'childId', '/children/:id');
    return apiRequestStrict<ChildProfileDto>(`/children/${safeId}`, {
      method: 'GET',
      validate: isChildProfileDto,
    });
  },

  // 3. POST /api/children
  createChildStrict: async (data: CreateChildProfileRequest): Promise<ChildProfileDto> => {
    assertNoForbiddenRawIdFields(data, '/children');
    return apiRequestStrict<ChildProfileDto>('/children', {
      method: 'POST',
      body: JSON.stringify(data),
      validate: isChildProfileDto,
    });
  },

  // 4. PATCH /api/children/:id
  updateChildStrict: async (id: string, data: UpdateChildProfileRequest): Promise<ChildProfileDto> => {
    const safeId = encodeSegment(id, 'childId', '/children/:id');
    assertNoForbiddenRawIdFields(data, `/children/${safeId}`);
    return apiRequestStrict<ChildProfileDto>(`/children/${safeId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
      validate: isChildProfileDto,
    });
  },

  // 5. POST /api/children/:id/archive
  archiveChildStrict: async (id: string): Promise<ChildProfileDto> => {
    const safeId = encodeSegment(id, 'childId', '/children/:id/archive');
    return apiRequestStrict<ChildProfileDto>(`/children/${safeId}/archive`, {
      method: 'POST',
      validate: isChildProfileDto,
    });
  },

  // 6. GET /api/children/:childId/pickups
  getChildPickupsStrict: async (childId: string): Promise<AuthorizedPickupDto[]> => {
    const safeChildId = encodeSegment(childId, 'childId', '/children/:childId/pickups');
    return apiRequestStrict<AuthorizedPickupDto[]>(`/children/${safeChildId}/pickups`, {
      method: 'GET',
      validate: arrayValidator(isAuthorizedPickupDto),
    });
  },

  // 7. POST /api/children/:childId/pickups
  addChildPickupStrict: async (childId: string, data: CreateAuthorizedPickupRequest): Promise<AuthorizedPickupDto> => {
    const safeChildId = encodeSegment(childId, 'childId', '/children/:childId/pickups');
    const endpoint = `/children/${safeChildId}/pickups`;
    assertNoForbiddenRawIdFields(data, endpoint);
    assertValidIdDocumentLast4(data.idDocumentLast4, endpoint);
    return apiRequestStrict<AuthorizedPickupDto>(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
      validate: isAuthorizedPickupDto,
    });
  },

  // 8. PATCH /api/children/:childId/pickups/:pickupId
  updateChildPickupStrict: async (
    childId: string,
    pickupId: string,
    data: UpdateAuthorizedPickupRequest
  ): Promise<AuthorizedPickupDto> => {
    const safeChildId = encodeSegment(childId, 'childId', '/children/:childId/pickups/:pickupId');
    const safePickupId = encodeSegment(pickupId, 'pickupId', '/children/:childId/pickups/:pickupId');
    const endpoint = `/children/${safeChildId}/pickups/${safePickupId}`;
    assertNoForbiddenRawIdFields(data, endpoint);
    assertValidIdDocumentLast4(data.idDocumentLast4, endpoint);
    return apiRequestStrict<AuthorizedPickupDto>(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(data),
      validate: isAuthorizedPickupDto,
    });
  },

  // 9. POST /api/children/:childId/pickups/:pickupId/revoke
  revokeChildPickupStrict: async (childId: string, pickupId: string): Promise<AuthorizedPickupDto> => {
    const safeChildId = encodeSegment(childId, 'childId', '/children/:childId/pickups/:pickupId/revoke');
    const safePickupId = encodeSegment(pickupId, 'pickupId', '/children/:childId/pickups/:pickupId/revoke');
    return apiRequestStrict<AuthorizedPickupDto>(`/children/${safeChildId}/pickups/${safePickupId}/revoke`, {
      method: 'POST',
      validate: isAuthorizedPickupDto,
    });
  },

  // 10. DELETE /api/children/:childId/pickups/:pickupId
  archiveChildPickupStrict: async (childId: string, pickupId: string): Promise<AuthorizedPickupDto> => {
    const safeChildId = encodeSegment(childId, 'childId', '/children/:childId/pickups/:pickupId');
    const safePickupId = encodeSegment(pickupId, 'pickupId', '/children/:childId/pickups/:pickupId');
    return apiRequestStrict<AuthorizedPickupDto>(`/children/${safeChildId}/pickups/${safePickupId}`, {
      method: 'DELETE',
      validate: isAuthorizedPickupDto,
    });
  },

  // 11. GET /api/children/passes
  getChildPassesStrict: async (params?: ListChildGatePassesParams): Promise<ChildGatePassDto[]> => {
    const query = buildQueryString({
      childId: params?.childId,
      status: params?.status,
      limit: params?.limit,
      offset: params?.offset,
      societyId: params?.societyId,
    });
    return apiRequestStrict<ChildGatePassDto[]>(`/children/passes${query}`, {
      method: 'GET',
      validate: arrayValidator(isChildGatePassDto),
    });
  },

  // 12. GET /api/children/passes/:id
  getChildPassByIdStrict: async (id: string): Promise<ChildGatePassDto> => {
    const safeId = encodeSegment(id, 'passId', '/children/passes/:id');
    return apiRequestStrict<ChildGatePassDto>(`/children/passes/${safeId}`, {
      method: 'GET',
      validate: isChildGatePassDto,
    });
  },

  // 13. POST /api/children/passes (returns one-time bearerToken & qrPayload)
  createChildPassStrict: async (
    data: CreateChildGatePassRequest,
    options?: CreateChildGatePassOptions
  ): Promise<ChildGatePassCreatedDto> => {
    const endpoint = '/children/passes';
    assertNoForbiddenRawIdFields(data, endpoint);
    if (!isNonEmptyStringValue(data.childId)) {
      throw new ApiError({
        status: 400,
        code: 'INVALID_CHILD_ID',
        kind: 'VALIDATION',
        endpoint,
        message: 'childId is required to generate a child gate pass.',
      });
    }
    if (!isNonEmptyStringValue(data.validUntil)) {
      throw new ApiError({
        status: 400,
        code: 'INVALID_VALIDITY_WINDOW',
        kind: 'VALIDATION',
        endpoint,
        message: 'validUntil is required to generate a child gate pass.',
      });
    }
    if (
      options?.childExitPermissionMode &&
      options.childExitPermissionMode !== 'SOLO_ALLOWED' &&
      !isNonEmptyStringValue(data.pickupPersonId)
    ) {
      throw new ApiError({
        status: 422,
        code: 'AUTHORIZED_PICKUP_REQUIRED',
        kind: 'VALIDATION',
        endpoint,
        message: 'An active authorized pickup person (pickupPersonId) is required by this child exit policy.',
      });
    }
    return apiRequestStrict<ChildGatePassCreatedDto>(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
      validate: isChildGatePassCreatedDto,
    });
  },

  // 14. POST /api/children/passes/:id/revoke
  revokeChildPassStrict: async (id: string, data?: RevokeChildGatePassRequest): Promise<ChildGatePassDto> => {
    const safeId = encodeSegment(id, 'passId', '/children/passes/:id/revoke');
    return apiRequestStrict<ChildGatePassDto>(`/children/passes/${safeId}/revoke`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
      validate: isChildGatePassDto,
    });
  },

  // 15. POST /api/children/passes/verify (fail-closed, bearer-token only, guard/admin)
  verifyChildPassStrict: async (data: VerifyChildGatePassRequest): Promise<VerifyChildGatePassSuccessDto> => {
    const endpoint = '/children/passes/verify';
    const rawQr = typeof data.qrPayload === 'string' ? data.qrPayload.trim() : '';
    const rawBearer = typeof data.bearerToken === 'string' ? data.bearerToken.trim() : '';

    if (!rawQr && !rawBearer) {
      throw new ApiError({
        status: 400,
        code: 'BEARER_TOKEN_REQUIRED',
        kind: 'VALIDATION',
        endpoint,
        message: 'A valid QR payload or bearer token is required to verify a child gate pass.',
      });
    }

    const displayCodeOnlyPattern = /^CGP-[A-Z0-9-]+$/i;
    if ((!rawBearer && displayCodeOnlyPattern.test(rawQr)) || (!rawQr && displayCodeOnlyPattern.test(rawBearer))) {
      throw new ApiError({
        status: 400,
        code: 'BEARER_TOKEN_REQUIRED',
        kind: 'VALIDATION',
        endpoint,
        message: 'Display pass codes cannot authorize gate exit. Please scan the caretaker’s QR pass or bearer token.',
      });
    }

    const bodyPayload: VerifyChildGatePassRequest = {
      ...(rawQr ? { qrPayload: rawQr } : {}),
      ...(rawBearer ? { bearerToken: rawBearer } : {}),
      ...(data.gateId ? { gateId: data.gateId } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
      ...(data.societyId ? { societyId: data.societyId } : {}),
    };

    return apiRequestStrict<VerifyChildGatePassSuccessDto>(endpoint, {
      method: 'POST',
      body: JSON.stringify(bodyPayload),
      timeoutMs: GATE_VERIFY_TIMEOUT_MS,
      validate: isVerifyChildGatePassSuccessDto,
    });
  },

  // 16. GET /api/children/exit-logs
  getChildExitLogsStrict: async (params?: ListChildExitLogsParams): Promise<ChildExitLogDto[]> => {
    const query = buildQueryString({
      childId: params?.childId,
      limit: params?.limit,
      offset: params?.offset,
      societyId: params?.societyId,
    });
    return apiRequestStrict<ChildExitLogDto[]>(`/children/exit-logs${query}`, {
      method: 'GET',
      validate: arrayValidator(isChildExitLogDto),
    });
  },

  // 17. POST /api/children/sos
  triggerChildSosStrict: async (data: TriggerChildSosRequest): Promise<ChildSosCreatedDto> => {
    const endpoint = '/children/sos';
    assertNoForbiddenRawIdFields(data, endpoint);
    if (!isNonEmptyStringValue(data.location)) {
      throw new ApiError({
        status: 400,
        code: 'INVALID_LOCATION',
        kind: 'VALIDATION',
        endpoint,
        message: 'location is required for child safety SOS alerts.',
      });
    }
    return apiRequestStrict<ChildSosCreatedDto>(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
      validate: isChildSosCreatedDto,
    });
  },

  // 18. GET /api/children/alerts
  getChildAlertsStrict: async (params?: ListChildAlertsParams): Promise<ChildSafetyAlertDto[]> => {
    const query = buildQueryString({
      status: params?.status,
      limit: params?.limit,
      offset: params?.offset,
      societyId: params?.societyId,
    });
    return apiRequestStrict<ChildSafetyAlertDto[]>(`/children/alerts${query}`, {
      method: 'GET',
      validate: arrayValidator(isChildSafetyAlertDto),
    });
  },

  // 19. POST /api/children/alerts/:id/acknowledge
  acknowledgeChildAlertStrict: async (id: string): Promise<ChildSafetyAlertDto> => {
    const safeId = encodeSegment(id, 'alertId', '/children/alerts/:id/acknowledge');
    return apiRequestStrict<ChildSafetyAlertDto>(`/children/alerts/${safeId}/acknowledge`, {
      method: 'POST',
      validate: isChildSafetyAlertDto,
    });
  },

  // 20. POST /api/children/alerts/:id/resolve
  resolveChildAlertStrict: async (
    id: string,
    data: ResolveChildAlertRequest
  ): Promise<ChildSafetyAlertDto> => {
    const safeId = encodeSegment(id, 'alertId', '/children/alerts/:id/resolve');
    const endpoint = `/children/alerts/${safeId}/resolve`;
    if (!isNonEmptyStringValue(data.resolutionNotes)) {
      throw new ApiError({
        status: 400,
        code: 'RESOLUTION_NOTES_REQUIRED',
        kind: 'VALIDATION',
        endpoint,
        message: 'resolutionNotes is required when resolving a safety alert.',
      });
    }
    if (data.status !== undefined && data.status !== 'RESOLVED' && data.status !== 'FALSE_ALARM') {
      throw new ApiError({
        status: 400,
        code: 'INVALID_RESOLUTION_STATUS',
        kind: 'VALIDATION',
        endpoint,
        message: 'Resolution status must be RESOLVED or FALSE_ALARM.',
      });
    }
    return apiRequestStrict<ChildSafetyAlertDto>(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
      validate: isChildSafetyAlertDto,
    });
  },

  // Flats
  getFlats: (societyId?: string) => apiRequest<any[]>('/flats', { societyId }),
  createFlat: (data: any) =>
    apiRequest<any>('/flats', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteFlat: (id: string) =>
    apiRequest<any>(`/flats/${id}`, {
      method: 'DELETE',
    }),

  // Residents
  getResidents: (societyId?: string) => apiRequest<any[]>('/residents', { societyId }),
  createResident: (data: any) =>
    apiRequest<any>('/residents', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateResident: (id: string, data: any) =>
    apiRequest<any>(`/residents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteResident: (id: string) =>
    apiRequest<any>(`/residents/${id}`, {
      method: 'DELETE',
    }),

  // Visitor Passes
  getVisitorPasses: (societyId?: string) => apiRequest<any[]>('/visitor-passes', { societyId }),
  getVisitorPassById: (id: string, societyId?: string) => apiRequest<any>(`/visitor-passes/${id}`, { societyId }),
  verifyVisitorPass: (codeOrQr: string, societyId?: string) =>
    apiRequest<any>('/visitor-passes/verify', {
      method: 'POST',
      body: JSON.stringify({ codeOrQr, societyId }),
    }),
  createVisitorPass: (data: any) =>
    apiRequest<any>('/visitor-passes', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateVisitorPass: (id: string, data: any) =>
    apiRequest<any>(`/visitor-passes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  checkInVisitorPass: (id: string, data?: { gateName?: string; officerName?: string }) =>
    apiRequest<any>(`/visitor-passes/${id}/check-in`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),
  checkOutVisitorPass: (id: string) =>
    apiRequest<any>(`/visitor-passes/${id}/check-out`, {
      method: 'POST',
    }),
  deleteVisitorPass: (id: string) =>
    apiRequest<any>(`/visitor-passes/${id}`, {
      method: 'DELETE',
    }),

  // Maintenance Tickets
  getMaintenanceTickets: (societyId?: string) => apiRequest<any[]>('/maintenance', { societyId }),
  createMaintenanceTicket: (data: any) =>
    apiRequest<any>('/maintenance', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateMaintenanceTicket: (id: string, data: any) =>
    apiRequest<any>(`/maintenance/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // Billing Invoices
  getBillingInvoices: (societyId?: string) => apiRequest<any[]>('/billing/invoices', { societyId }),
  updateBillingInvoice: (id: string, data: any) =>
    apiRequest<any>(`/billing/invoices/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // Parcels
  getParcels: (societyId?: string) => apiRequest<any[]>('/parcels', { societyId }),
  createParcel: (data: any) =>
    apiRequest<any>('/parcels', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  collectParcel: (id: string, collectedBy?: string) =>
    apiRequest<any>(`/parcels/${id}/collect`, {
      method: 'PATCH',
      body: JSON.stringify({ collectedBy }),
    }),

  // Staff
  getStaff: (societyId?: string) => apiRequest<any[]>('/staff', { societyId }),

  // Domestic Workers
  getDomesticWorkers: (societyId?: string) => apiRequest<any[]>('/domestic-workers', { societyId }),

  // Vendors
  getVendors: (societyId?: string) => apiRequest<any[]>('/vendors', { societyId }),

  // Amenities
  getAmenities: (societyId?: string) => apiRequest<any[]>('/amenities', { societyId }),

  // Announcements
  getAnnouncements: (societyId?: string) => apiRequest<any[]>('/announcements', { societyId }),
  createAnnouncement: (data: any) =>
    apiRequest<any>('/announcements', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Community Events
  getCommunityEvents: (societyId?: string) => apiRequest<any[]>('/community-events', { societyId }),
  createCommunityEvent: (data: any) =>
    apiRequest<any>('/community-events', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Emergency Incidents
  getEmergencyIncidents: (societyId?: string) => apiRequest<any[]>('/emergency-incidents', { societyId }),
  createEmergencyIncident: (data: any) =>
    apiRequest<any>('/emergency-incidents', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  resolveEmergencyIncidentStrict: async (id: string): Promise<any> => {
    const safeId = encodeSegment(id, 'id', '/emergency-incidents/:id/resolve');
    return apiRequestStrict<any>(`/emergency-incidents/${safeId}/resolve`, {
      method: 'PATCH',
    });
  },

  // Notifications
  getNotifications: (societyId?: string) => apiRequest<any[]>('/notifications', { societyId }),
  markNotificationRead: (id: string) =>
    apiRequest<any>(`/notifications/${id}/read`, {
      method: 'PATCH',
    }),

  // File Upload Engine
  uploadFile: async (file: File, category: string = 'attachments'): Promise<{ success: boolean; url: string; fullUrl: string; filename: string; size: number }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const fileData = reader.result as string;
          const res = await apiRequest<{ success: boolean; url: string; filename: string; size: number }>('/upload', {
            method: 'POST',
            body: JSON.stringify({
              filename: file.name,
              fileData,
              category,
            }),
          });
          if (!res || !res.url) {
            throw new Error('Upload failed on server');
          }
          const baseUrl = API_BASE.replace(/\/api$/, '');
          const relativeOrAbsUrl = res.url;
          resolve({
            success: Boolean(res.success),
            url: relativeOrAbsUrl,
            filename: res.filename || file.name,
            size: res.size || file.size,
            fullUrl: relativeOrAbsUrl.startsWith('http') ? relativeOrAbsUrl : `${baseUrl}${relativeOrAbsUrl}`,
          });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  },

  // Razorpay Payment Engine
  createRazorpayOrder: (invoiceId: string, amount: number) =>
    apiRequest<{ orderId: string; amount: number; currency: string; keyId: string; notes?: any }>('/payments/razorpay/create-order', {
      method: 'POST',
      body: JSON.stringify({ invoiceId, amount }),
    }),

  verifyRazorpayPayment: (data: { invoiceId: string; razorpayPaymentId: string; razorpayOrderId: string; amount: number; razorpaySignature?: string }) =>
    apiRequest<{ success: boolean; message: string; invoice: any; transactionId: string }>('/payments/razorpay/verify', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  refundRazorpayPayment: (data: { paymentId: string; amount: number; reason: string }) =>
    apiRequest<{ success: boolean; refundId: string; amount: number; message: string }>('/payments/razorpay/refund', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getPayments: (societyId?: string, residentId?: string, invoiceId?: string) => {
    const params = new URLSearchParams();
    if (societyId) params.append('societyId', societyId);
    if (residentId) params.append('residentId', residentId);
    if (invoiceId) params.append('invoiceId', invoiceId);
    const queryString = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<any[]>(`/payments${queryString}`, { societyId });
  },

  // Advertisements & Sponsored Offers
  getAdvertisements: (societyId?: string) => apiRequest<any[]>('/advertisements', { societyId }),
  createAdvertisement: (data: any) =>
    apiRequest<any>('/advertisements', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  recordAdView: (id: string) =>
    apiRequest<any>(`/advertisements/${id}/view`, {
      method: 'POST',
    }),
  recordAdClick: (id: string) =>
    apiRequest<any>(`/advertisements/${id}/click`, {
      method: 'POST',
    }),

  // Vendors
  registerVendor: (data: any) =>
    apiRequest<any>('/vendors', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateVendor: (id: string, data: any) =>
    apiRequest<any>(`/vendors/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteVendor: (id: string) =>
    apiRequest<any>(`/vendors/${id}`, {
      method: 'DELETE',
    }),

  // Generic Query
  queryTable: (table: string, societyId?: string) =>
    apiRequest<any[]>(`/${table}/query`, {
      method: 'POST',
      societyId,
    }),
};
