// =============================================================================
// ISSUE-06 Phase B.2.3 — Phase 1: Canonical Child Safety API Client & Strict Errors
// Full Remediation Regression Suite (F-P1-01 through F-P1-06)
// =============================================================================

class MockStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

jest.mock('../src/utils/backendConfig', () => ({
  getBackendBaseUrl: jest.fn(() => 'http://localhost:5000'),
}));

import {
  apiClient,
  apiRequestStrict,
  ApiError,
} from '../src/services/apiClient';
import {
  AUTH_KEYS,
  saveAuthSession,
  clearAuthSession,
  getAuthToken,
} from '../src/services/authStorage';
import type { UserProfile } from '../src/domains/auth/types';
import type {
  AuthorizedPickupDto,
  ChildExitLogDto,
  ChildGatePassCreatedDto,
  ChildGatePassDto,
  ChildProfileDto,
  ChildSafetyAlertDto,
  ChildSosCreatedDto,
  VerifyChildGatePassSuccessDto,
} from '../src/types/childSafety';

function makeResponse(
  status: number,
  body: unknown,
  headersMap: Record<string, string> = {}
): Response {
  const normalizedHeaders = new Map<string, string>();
  for (const [k, v] of Object.entries(headersMap)) {
    normalizedHeaders.set(k.toLowerCase(), v);
  }
  const rawText =
    typeof body === 'string'
      ? body
      : body === undefined
        ? ''
        : JSON.stringify(body);

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => normalizedHeaders.get(name.toLowerCase()) ?? null,
    },
    text: jest.fn().mockResolvedValue(rawText),
    json: jest.fn().mockImplementation(async () => JSON.parse(rawText)),
  } as unknown as Response;
}

const VALID_BEARER_TOKEN = 'a'.repeat(64);
const VALID_QR_PAYLOAD = `AARIZO_CHILD_PASS:${VALID_BEARER_TOKEN}`;

const samplePickup: AuthorizedPickupDto = {
  id: 'pickup-001',
  societyId: 'soc-alpha',
  childId: 'child-001',
  name: 'Meera Sharma',
  phone: '+919876500001',
  relationship: 'Grandmother',
  idDocumentType: 'DRIVING_LICENSE',
  idDocumentLast4: '4321',
  idVerificationStatus: 'UNVERIFIED',
  idVerifiedAt: null,
  photoUrl: null,
  status: 'ACTIVE',
  validUntil: '2027-01-01T00:00:00.000Z',
  notes: 'School pickup',
  archivedAt: null,
  createdAt: '2026-11-18T00:00:00.000Z',
  updatedAt: '2026-11-18T00:00:00.000Z',
};

const sampleChild: ChildProfileDto = {
  id: 'child-001',
  societyId: 'soc-alpha',
  residentId: 'res-001',
  flatId: 'flat-001',
  guardianUserId: 'user-res-001',
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
  emergencyPhone: '+919876543211',
  secondaryGuardians: null,
  emergencyContacts: null,
  notes: null,
  archivedAt: null,
  createdAt: '2026-11-18T00:00:00.000Z',
  updatedAt: '2026-11-18T00:00:00.000Z',
  pickups: [samplePickup],
};

const samplePass: ChildGatePassDto = {
  id: 'pass-001',
  societyId: 'soc-alpha',
  childId: 'child-001',
  pickupPersonId: 'pickup-001',
  passCode: 'CGP-ABCD-1234',
  pickupPersonName: 'Meera Sharma',
  pickupPersonPhone: '+919876500001',
  validFrom: '2026-11-18T01:00:00.000Z',
  validUntil: '2026-11-18T05:00:00.000Z',
  status: 'ACTIVE',
  maxUses: 1,
  currentUses: 0,
  firstUsedAt: null,
  lastUsedAt: null,
  revokedAt: null,
  revocationReason: null,
  notes: 'After school',
  archivedAt: null,
  createdAt: '2026-11-18T01:00:00.000Z',
  updatedAt: '2026-11-18T01:00:00.000Z',
  child: {
    id: 'child-001',
    fullName: 'Aarav Sharma',
    flatNumber: 'A-402',
    status: 'SAFE',
  },
};

const sampleCreatedPass: ChildGatePassCreatedDto = {
  ...samplePass,
  bearerToken: VALID_BEARER_TOKEN,
  qrPayload: VALID_QR_PAYLOAD,
};

const sampleExitLog: ChildExitLogDto = {
  id: 'log-001',
  societyId: 'soc-alpha',
  childId: 'child-001',
  passId: 'pass-001',
  pickupPersonId: 'pickup-001',
  childName: 'Aarav Sharma',
  flatNumber: 'A-402',
  pickupPersonName: 'Meera Sharma',
  pickupPersonPhone: '+919876500001',
  gateId: 'MAIN_GATE',
  guardId: 'guard-001',
  guardName: 'Officer Vikram',
  outcome: 'ALLOWED',
  verificationChannel: 'ONLINE_QR_TOKEN',
  denialReason: null,
  notes: null,
  timestamp: '2026-11-18T02:00:00.000Z',
};

const sampleVerifySuccess: VerifyChildGatePassSuccessDto = {
  authorized: true,
  outcome: 'ALLOWED',
  pass: { ...samplePass, status: 'USED', currentUses: 1 },
  exitLog: sampleExitLog,
};

const sampleAlert: ChildSafetyAlertDto = {
  id: 'alert-001',
  societyId: 'soc-alpha',
  childId: 'child-001',
  reportedById: 'user-res-001',
  reportedByName: 'Rohan Sharma',
  childName: 'Aarav Sharma',
  flatNumber: 'A-402',
  alertType: 'MISSING_CHILD',
  severity: 'CRITICAL',
  status: 'ACTIVE',
  location: 'Tower A Playground',
  description: 'Not seen since 5 PM',
  lastSeenDetails: 'Blue t-shirt near swings',
  acknowledgedAt: null,
  acknowledgedById: null,
  acknowledgedByName: null,
  resolvedAt: null,
  resolvedById: null,
  resolvedByName: null,
  resolutionNotes: null,
  emergencyIncidentId: 'inc-001',
  createdAt: '2026-11-18T02:00:00.000Z',
  updatedAt: '2026-11-18T02:00:00.000Z',
};

const sampleSosCreated: ChildSosCreatedDto = {
  alert: sampleAlert,
  emergencyIncident: {
    id: 'inc-001',
    societyId: 'soc-alpha',
    incidentType: 'CHILD_SAFETY',
    severity: 'CRITICAL',
    location: 'Tower A Playground',
    dispatchStatus: 'DISPATCHED',
    createdAt: '2026-11-18T02:00:00.000Z',
  },
};

describe('ISSUE-06 Phase B.2.3 (Phase 1): Canonical Child Safety API Client & Strict Error Semantics', () => {
  let mockLocalStorage: MockStorage;
  let mockSessionStorage: MockStorage;
  let mockFetch: jest.Mock;
  let dispatchedEvents: Array<{ type: string; detail?: unknown }>;
  let originalFetch: unknown;

  const mockResident: UserProfile = {
    id: 'user-res-001',
    role: 'resident',
    societyId: 'soc-alpha',
    name: 'Rohan Sharma',
    phone: '+919876543210',
    email: 'rohan@aarizo.test',
    flatNumber: 'A-402',
    status: 'ACTIVE',
  };

  beforeAll(() => {
    originalFetch = (global as any).fetch;
  });

  afterAll(() => {
    (global as any).fetch = originalFetch;
  });

  beforeEach(() => {
    mockLocalStorage = new MockStorage();
    mockSessionStorage = new MockStorage();
    dispatchedEvents = [];
    mockFetch = jest.fn();

    (global as any).localStorage = mockLocalStorage;
    (global as any).sessionStorage = mockSessionStorage;
    (global as any).fetch = mockFetch;
    (global as any).window = {
      localStorage: mockLocalStorage,
      sessionStorage: mockSessionStorage,
      dispatchEvent: (event: any) => {
        dispatchedEvents.push({ type: event.type, detail: event.detail });
        return true;
      },
    };
    (global as any).CustomEvent = class {
      type: string;
      detail: unknown;
      constructor(type: string, params?: { detail?: unknown }) {
        this.type = type;
        this.detail = params?.detail;
      }
    };

    saveAuthSession(mockResident, 'signed-jwt-token-xyz', 'password');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // 1. Authentication, Header Normalization (F-P1-04) & Race-Safe 401 (F-P1-03)
  // =========================================================================
  describe('1. Authentication, Header Normalization & Race-Safe 401 Handling', () => {
    test('attaches canonical Bearer token and strips identity/auth overrides from plain object headers while keeping custom headers', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(200, [sampleChild]));

      const result = await apiRequestStrict<ChildProfileDto[]>('/children', {
        method: 'GET',
        headers: {
          'x-society-id': 'spoofed-society',
          'X-User-Id': 'spoofed-user',
          'x-user-role': 'admin',
          Authorization: 'Bearer spoofed-token',
          'X-Correlation-Id': 'corr-plain-1',
        },
      });

      expect(result).toHaveLength(1);
      const [calledUrl, init] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe('http://localhost:5000/api/children');
      expect(init.headers['Authorization']).toBe('Bearer signed-jwt-token-xyz');
      expect(init.headers['X-Correlation-Id']).toBe('corr-plain-1');
      expect(init.headers['x-society-id']).toBeUndefined();
      expect(init.headers['X-User-Id']).toBeUndefined();
      expect(init.headers['x-user-role']).toBeUndefined();
    });

    test('F-P1-04: strips identity/auth overrides from Headers instance and preserves legitimate headers', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(200, [sampleChild]));

      const hdrs = new Headers();
      hdrs.set('Authorization', 'Bearer evil-override');
      hdrs.set('X-Society-Id', 'soc-evil');
      hdrs.set('X-User-Id', 'user-evil');
      hdrs.set('X-User-Role', 'admin');
      hdrs.set('X-Correlation-Id', 'corr-headers-2');

      await apiRequestStrict<ChildProfileDto[]>('/children', {
        method: 'GET',
        headers: hdrs,
      });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers['Authorization']).toBe('Bearer signed-jwt-token-xyz');
      expect(init.headers['x-correlation-id']).toBe('corr-headers-2');
      expect(init.headers['x-society-id']).toBeUndefined();
      expect(init.headers['x-user-id']).toBeUndefined();
      expect(init.headers['x-user-role']).toBeUndefined();
    });

    test('F-P1-04: strips identity/auth overrides from tuple array headers and preserves legitimate headers', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(200, [sampleChild]));

      await apiRequestStrict<ChildProfileDto[]>('/children', {
        method: 'GET',
        headers: [
          ['Authorization', 'Bearer evil-tuple'],
          ['x-society-id', 'soc-evil'],
          ['X-User-Id', 'user-evil'],
          ['X-User-Role', 'admin'],
          ['X-Request-Id', 'req-tuple-3'],
        ],
      });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers['Authorization']).toBe('Bearer signed-jwt-token-xyz');
      expect(init.headers['X-Request-Id']).toBe('req-tuple-3');
      expect(init.headers['x-society-id']).toBeUndefined();
      expect(init.headers['X-User-Id']).toBeUndefined();
      expect(init.headers['X-User-Role']).toBeUndefined();
    });

    test('fails fast with 401 AUTH_TOKEN_MISSING when auth token is absent (does not call fetch)', async () => {
      clearAuthSession();

      await expect(apiClient.getChildrenStrict()).rejects.toMatchObject({
        name: 'ApiError',
        status: 401,
        code: 'AUTH_TOKEN_MISSING',
        kind: 'UNAUTHORIZED',
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('F-P1-03: current-token 401 clears session and dispatches aarizo:unauthorized once', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse(401, { error: 'Unauthorized: Token expired', code: 'AUTH_TOKEN_INVALID' })
      );

      await expect(apiClient.getChildrenStrict()).rejects.toMatchObject({
        status: 401,
        code: 'AUTH_TOKEN_INVALID',
        kind: 'UNAUTHORIZED',
      });

      expect(getAuthToken()).toBeNull();
      expect(mockLocalStorage.getItem(AUTH_KEYS.TOKEN)).toBeNull();
      expect(dispatchedEvents.filter((e) => e.type === 'aarizo:unauthorized')).toHaveLength(1);
    });

    test('F-P1-03: multiple simultaneous 401 responses for the same token emit only ONE aarizo:unauthorized event', async () => {
      mockFetch.mockImplementation(async () =>
        makeResponse(401, { error: 'Session expired', code: 'AUTH_TOKEN_INVALID' })
      );

      const results = await Promise.allSettled([
        apiClient.getChildrenStrict(),
        apiClient.getChildPassesStrict(),
        apiClient.getChildExitLogsStrict(),
        apiClient.getChildAlertsStrict(),
      ]);

      expect(results.every((r) => r.status === 'rejected')).toBe(true);
      expect(getAuthToken()).toBeNull();
      expect(dispatchedEvents.filter((e) => e.type === 'aarizo:unauthorized')).toHaveLength(1);
    });

    test('F-P1-03: delayed stale-token 401 after a fresh login does NOT wipe the new session, and subsequent fresh request succeeds (and fresh 401 still works)', async () => {
      let resolveStaleFetch!: (res: Response) => void;
      const staleFetchPromise = new Promise<Response>((resolve) => {
        resolveStaleFetch = resolve;
      });
      mockFetch.mockReturnValueOnce(staleFetchPromise);

      // Start request with old token
      const staleRequest = apiClient.getChildrenStrict();

      // User logs in cleanly with a brand-new token while stale request is still in-flight
      saveAuthSession(mockResident, 'fresh-login-token-2026', 'password');

      // Now stale request finishes with 401
      resolveStaleFetch(makeResponse(401, { error: 'Old token expired', code: 'AUTH_TOKEN_INVALID' }));
      await expect(staleRequest).rejects.toMatchObject({ status: 401, code: 'AUTH_TOKEN_INVALID' });

      // Fresh session MUST remain intact with zero unauthorized events fired
      expect(getAuthToken()).toBe('fresh-login-token-2026');
      expect(dispatchedEvents.filter((e) => e.type === 'aarizo:unauthorized')).toHaveLength(0);

      // A fresh request with the new token succeeds cleanly
      mockFetch.mockResolvedValueOnce(makeResponse(200, [sampleChild]));
      const freshChildren = await apiClient.getChildrenStrict();
      expect(freshChildren).toHaveLength(1);
      expect(mockFetch.mock.calls[1][1].headers['Authorization']).toBe('Bearer fresh-login-token-2026');

      // And if the NEW session later receives a legitimate 401, it IS properly invalidated
      mockFetch.mockResolvedValueOnce(makeResponse(401, { error: 'New token expired', code: 'AUTH_TOKEN_INVALID' }));
      await expect(apiClient.getChildrenStrict()).rejects.toMatchObject({ status: 401 });
      expect(getAuthToken()).toBeNull();
      expect(dispatchedEvents.filter((e) => e.type === 'aarizo:unauthorized')).toHaveLength(1);
    });

    test('preserves auth session on HTTP 403 Forbidden (role/tenant denial)', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse(403, { error: 'Forbidden: Insufficient permissions', code: 'INSUFFICIENT_PERMISSIONS' })
      );

      await expect(apiClient.getChildrenStrict()).rejects.toMatchObject({
        status: 403,
        code: 'INSUFFICIENT_PERMISSIONS',
        kind: 'FORBIDDEN',
      });

      expect(getAuthToken()).toBe('signed-jwt-token-xyz');
      expect(dispatchedEvents.some((e) => e.type === 'aarizo:unauthorized')).toBe(false);
    });
  });

  // =========================================================================
  // 2. Strict Error Semantics, Recursive Sanitization (F-P1-02) & Timeouts
  // =========================================================================
  describe('2. Strict Error Semantics, Recursive Sanitization, Timeouts & Malformed Responses', () => {
    test.each([
      [400, 'INVALID_FULL_NAME', 'VALIDATION', 'fullName is required.'],
      [404, 'CHILD_NOT_FOUND', 'NOT_FOUND', 'Child profile not found.'],
      [409, 'DUPLICATE_ACTIVE_SOS_ALERT', 'CONFLICT', 'An active missing-child SOS alert already exists.'],
      [422, 'PICKUP_AUTHORIZATION_INACTIVE', 'VALIDATION', 'Selected pickup authorization is revoked.'],
      [500, 'INTERNAL_SERVER_ERROR', 'SERVER_ERROR', 'Temporary server issue.'],
      [503, 'DATABASE_UNAVAILABLE', 'UNAVAILABLE', 'Child Safety database service is temporarily unavailable.'],
    ] as const)(
      'propagates HTTP %i (%s -> %s) as typed ApiError without returning null',
      async (status, code, kind, message) => {
        mockFetch.mockResolvedValueOnce(makeResponse(status, { error: message, code }));

        let caught: unknown;
        try {
          await apiClient.getChildrenStrict();
        } catch (err) {
          caught = err;
        }

        expect(caught).toBeInstanceOf(ApiError);
        const apiErr = caught as ApiError;
        expect(apiErr.status).toBe(status);
        expect(apiErr.code).toBe(code);
        expect(apiErr.kind).toBe(kind);
        expect(apiErr.message).toBe(message);
        expect(apiErr.isFailClosedUnavailable).toBe(status === 503);
      }
    );

    test('parses Retry-After integer seconds and HTTP-date format on 429 and never retries non-idempotent POST', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse(
          429,
          { error: 'Rate limit exceeded. Please try again later.', code: 'RATE_LIMIT_EXCEEDED' },
          { 'Retry-After': '45' }
        )
      );

      let caughtInt: ApiError | undefined;
      try {
        await apiClient.triggerChildSosStrict({ location: 'North Gate', childId: 'child-001' });
      } catch (err) {
        caughtInt = err as ApiError;
      }
      expect(caughtInt?.status).toBe(429);
      expect(caughtInt?.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(caughtInt?.kind).toBe('RATE_LIMITED');
      expect(caughtInt?.retryAfterSeconds).toBe(45);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // HTTP-date format Retry-After
      const futureDate = new Date(Date.now() + 60_000).toUTCString();
      mockFetch.mockResolvedValueOnce(
        makeResponse(
          429,
          { error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
          { 'Retry-After': futureDate }
        )
      );
      let caughtDate: ApiError | undefined;
      try {
        await apiClient.triggerChildSosStrict({ location: 'North Gate', childId: 'child-001' });
      } catch (err) {
        caughtDate = err as ApiError;
      }
      expect(caughtDate?.status).toBe(429);
      expect(caughtDate?.retryAfterSeconds).toBeGreaterThanOrEqual(55);
      expect(caughtDate?.retryAfterSeconds).toBeLessThanOrEqual(65);
    });

    test('distinguishes network failure and request timeout (AbortError) as fail-closed NETWORK without retries', async () => {
      // Network TypeError
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      let netErr: ApiError | undefined;
      try {
        await apiClient.verifyChildPassStrict({ qrPayload: VALID_QR_PAYLOAD, gateId: 'MAIN_GATE' });
      } catch (err) {
        netErr = err as ApiError;
      }
      expect(netErr).toBeInstanceOf(ApiError);
      expect(netErr?.status).toBe(0);
      expect(netErr?.code).toBe('NETWORK_UNAVAILABLE');
      expect(netErr?.kind).toBe('NETWORK');
      expect(netErr?.isFailClosedUnavailable).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Timeout AbortError
      mockFetch.mockImplementationOnce((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const abortErr = new Error('The operation was aborted.');
            abortErr.name = 'AbortError';
            reject(abortErr);
          });
        });
      });

      let timeoutErr: ApiError | undefined;
      try {
        await apiRequestStrict('/children', { method: 'GET', timeoutMs: 25 });
      } catch (err) {
        timeoutErr = err as ApiError;
      }
      expect(timeoutErr).toBeInstanceOf(ApiError);
      expect(timeoutErr?.status).toBe(0);
      expect(timeoutErr?.code).toBe('REQUEST_TIMEOUT');
      expect(timeoutErr?.kind).toBe('NETWORK');
      expect(timeoutErr?.isFailClosedUnavailable).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test('F-P1-02: recursively strips mixed-case sensitive keys, sanitizes nested unsafe strings, preserves actual status fallback & safe codes, and bounds deep/large payloads', async () => {
      const deepPayload: Record<string, unknown> = { level: 0 };
      let cursor = deepPayload;
      for (let i = 1; i <= 10; i++) {
        cursor.next = { level: i };
        cursor = cursor.next as Record<string, unknown>;
      }

      const oversizedList = Array.from({ length: 80 }, (_, idx) => ({
        index: idx,
        TokenHash: `secret-hash-${idx}`,
        note: idx === 0 ? 'Safe note' : `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${idx}`,
      }));

      mockFetch.mockResolvedValueOnce(
        makeResponse(409, {
          error: `SELECT * FROM child_profiles WHERE token = ${VALID_QR_PAYLOAD}`,
          message: 'prisma.childGatePass.findUnique failed at Object.<anonymous> (router.ts:42)',
          code: 'CHILD_MISSING_ALERT_BLOCKED',
          outcome: 'MISSING_ALERT_BLOCKED',
          Authorization: 'Bearer super-secret-jwt-value',
          TokenHash: 'top-level-hash',
          details: {
            BearerToken: VALID_BEARER_TOKEN,
            IdProofNumber: 'DL-MH02-2018-9182',
            AADHAAR: '1234-5678-9012',
            Secret: 'top-secret',
            nestedMessage: 'Error at handleGatePassVerification (router.ts:500)',
            safeHint: 'Contact security desk',
            items: oversizedList,
          },
          deep: deepPayload,
        })
      );

      let caught: ApiError | undefined;
      try {
        await apiClient.verifyChildPassStrict({ qrPayload: VALID_QR_PAYLOAD });
      } catch (err) {
        caught = err as ApiError;
      }

      expect(caught).toBeInstanceOf(ApiError);
      expect(caught?.status).toBe(409);
      expect(caught?.code).toBe('CHILD_MISSING_ALERT_BLOCKED');
      // Uses actual 409 CONFLICT default message, NOT hardcoded 500 server error!
      expect(caught?.message).toBe('This action conflicts with the current state of the record.');
      expect(caught?.payload?.code).toBe('CHILD_MISSING_ALERT_BLOCKED');
      expect(caught?.payload?.outcome).toBe('MISSING_ALERT_BLOCKED');
      expect(caught?.payload?.error).toBe('This action conflicts with the current state of the record.');
      expect(caught?.payload?.message).toBe('This action conflicts with the current state of the record.');

      // Top-level mixed-case sensitive keys stripped
      expect(caught?.payload?.Authorization).toBeUndefined();
      expect(caught?.payload?.TokenHash).toBeUndefined();

      // Nested mixed-case sensitive keys stripped & unsafe nested strings redacted
      const details = caught?.payload?.details as Record<string, unknown>;
      expect(details).toBeDefined();
      expect(details.BearerToken).toBeUndefined();
      expect(details.IdProofNumber).toBeUndefined();
      expect(details.AADHAAR).toBeUndefined();
      expect(details.Secret).toBeUndefined();
      expect(details.nestedMessage).toBe('[REDACTED]');
      expect(details.safeHint).toBe('Contact security desk');

      // Oversized arrays bounded (<= 50 items) and nested items sanitized
      const items = details.items as Array<Record<string, unknown>>;
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeLessThanOrEqual(50);
      expect(items[0].TokenHash).toBeUndefined();
      expect(items[0].note).toBe('Safe note');
      expect(items[1].note).toBe('[REDACTED]');

      // Deep nesting safely truncated
      let depthCount = 0;
      let walk: any = caught?.payload?.deep;
      while (walk && typeof walk === 'object') {
        depthCount++;
        walk = walk.next;
      }
      expect(depthCount).toBeLessThanOrEqual(6);
    });

    test('handles non-JSON HTML error page safely (e.g., proxy 503)', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(503, '<html><body>503 Service Unavailable</body></html>'));

      await expect(apiClient.getChildrenStrict()).rejects.toMatchObject({
        status: 503,
        code: 'BACKEND_UNAVAILABLE',
        kind: 'UNAVAILABLE',
        isFailClosedUnavailable: true,
      });
    });

    test('rejects 200 OK with malformed JSON or empty body as INVALID_RESPONSE', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(200, '{not-valid-json'));
      await expect(apiClient.getChildrenStrict()).rejects.toMatchObject({
        status: 0,
        code: 'INVALID_RESPONSE',
        kind: 'INVALID_RESPONSE',
      });

      mockFetch.mockResolvedValueOnce(makeResponse(200, ''));
      await expect(apiClient.getChildrenStrict()).rejects.toMatchObject({
        status: 0,
        code: 'INVALID_RESPONSE',
        kind: 'INVALID_RESPONSE',
      });
    });
  });

  // =========================================================================
  // 3. F-P1-01 & F-P1-05: Strict Pass Credential Boundaries & Prisma Enums
  // =========================================================================
  describe('3. Strict Pass Credential Boundaries, Hash Rejection & Exact Enum Validation', () => {
    test('F-P1-01: ordinary pass list, getById, revoke, and verify reject unexpected bearerToken or qrPayload', async () => {
      // GET /passes leaking bearerToken
      mockFetch.mockResolvedValueOnce(makeResponse(200, [{ ...samplePass, bearerToken: VALID_BEARER_TOKEN }]));
      await expect(apiClient.getChildPassesStrict()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

      // GET /passes/:id leaking qrPayload
      mockFetch.mockResolvedValueOnce(makeResponse(200, { ...samplePass, qrPayload: VALID_QR_PAYLOAD }));
      await expect(apiClient.getChildPassByIdStrict('pass-001')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

      // POST /passes/:id/revoke leaking bearerToken
      mockFetch.mockResolvedValueOnce(
        makeResponse(200, { ...samplePass, status: 'REVOKED', bearerToken: VALID_BEARER_TOKEN })
      );
      await expect(apiClient.revokeChildPassStrict('pass-001')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

      // POST /passes/verify leaking qrPayload inside nested pass
      mockFetch.mockResolvedValueOnce(
        makeResponse(200, {
          ...sampleVerifySuccess,
          pass: { ...sampleVerifySuccess.pass, qrPayload: VALID_QR_PAYLOAD },
        })
      );
      await expect(apiClient.verifyChildPassStrict({ qrPayload: VALID_QR_PAYLOAD })).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    });

    test('F-P1-01: pass creation requires one-time bearerToken & qrPayload, preserves them untouched, and still rejects tokenHash', async () => {
      // Valid pass creation preserves exact one-time credentials untouched
      mockFetch.mockResolvedValueOnce(makeResponse(201, sampleCreatedPass));
      const created = await apiClient.createChildPassStrict(
        { childId: 'child-001', pickupPersonId: 'pickup-001', validUntil: '2026-11-18T05:00:00.000Z' },
        { childExitPermissionMode: 'ESCORT_REQUIRED' }
      );
      expect(created.bearerToken).toBe(VALID_BEARER_TOKEN);
      expect(created.qrPayload).toBe(VALID_QR_PAYLOAD);

      // Missing bearerToken rejected
      mockFetch.mockResolvedValueOnce(makeResponse(201, { ...samplePass, qrPayload: VALID_QR_PAYLOAD }));
      await expect(
        apiClient.createChildPassStrict({
          childId: 'child-001',
          pickupPersonId: 'pickup-001',
          validUntil: '2026-11-18T05:00:00.000Z',
        })
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

      // Leaked tokenHash rejected even on pass creation
      mockFetch.mockResolvedValueOnce(makeResponse(201, { ...sampleCreatedPass, tokenHash: 'leaked-sha256' }));
      await expect(
        apiClient.createChildPassStrict({
          childId: 'child-001',
          pickupPersonId: 'pickup-001',
          validUntil: '2026-11-18T05:00:00.000Z',
        })
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

      // Leaked idDocumentHash rejected on pickup reads
      mockFetch.mockResolvedValueOnce(makeResponse(200, [{ ...samplePickup, idDocumentHash: 'leaked-id-hash' }]));
      await expect(apiClient.getChildPickupsStrict('child-001')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    });

    test('F-P1-05: rejects invalid Prisma enum values and malformed optional pass.child summary', async () => {
      // Invalid ChildStatus enum
      mockFetch.mockResolvedValueOnce(makeResponse(200, [{ ...sampleChild, status: 'ESCAPED' }]));
      await expect(apiClient.getChildrenStrict()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

      // Invalid ChildExitPermissionMode enum
      mockFetch.mockResolvedValueOnce(makeResponse(200, [{ ...sampleChild, exitPermissionMode: 'FREE_ROAM' }]));
      await expect(apiClient.getChildrenStrict()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

      // Invalid PickupIdVerificationStatus enum
      mockFetch.mockResolvedValueOnce(makeResponse(200, [{ ...samplePickup, idVerificationStatus: 'BOGUS' }]));
      await expect(apiClient.getChildPickupsStrict('child-001')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

      // Invalid ChildGatePassStatus enum
      mockFetch.mockResolvedValueOnce(makeResponse(200, [{ ...samplePass, status: 'PENDING_OFFLINE' }]));
      await expect(apiClient.getChildPassesStrict()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

      // Malformed optional pass.child summary (invalid child.status)
      mockFetch.mockResolvedValueOnce(
        makeResponse(200, [{ ...samplePass, child: { id: 'child-001', fullName: 'Aarav', flatNumber: 'A-402', status: 'BAD' } }])
      );
      await expect(apiClient.getChildPassesStrict()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

      // Invalid ChildExitOutcome enum
      mockFetch.mockResolvedValueOnce(makeResponse(200, [{ ...sampleExitLog, outcome: 'OFFLINE_VERIFIED' }]));
      await expect(apiClient.getChildExitLogsStrict()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

      // Invalid ChildAlertStatus enum
      mockFetch.mockResolvedValueOnce(makeResponse(200, [{ ...sampleAlert, status: 'RESPONDING' }]));
      await expect(apiClient.getChildAlertsStrict()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    });
  });

  // =========================================================================
  // 4. All 20 Child Safety Strict Endpoints — URLs, Methods & Exact Payloads
  // =========================================================================
  describe('4. All 20 Child Safety Strict Endpoints — Exact URLs, Methods, Payloads & Path Encoding', () => {
    test('1-5: Child Profile endpoints (list, getById, create, update, archive) with payload & non-ignored-field assertions', async () => {
      // 1. GET /api/children
      mockFetch.mockResolvedValueOnce(makeResponse(200, [sampleChild]));
      const list = await apiClient.getChildrenStrict({ includeArchived: true, societyId: 'soc-alpha' });
      expect(list).toEqual([sampleChild]);
      expect(mockFetch.mock.calls[0][0]).toBe(
        'http://localhost:5000/api/children?includeArchived=true&societyId=soc-alpha'
      );
      expect(mockFetch.mock.calls[0][1].method).toBe('GET');

      // 2. GET /api/children/:id
      mockFetch.mockResolvedValueOnce(makeResponse(200, sampleChild));
      const one = await apiClient.getChildByIdStrict('child-001');
      expect(one.id).toBe('child-001');
      expect(mockFetch.mock.calls[1][0]).toBe('http://localhost:5000/api/children/child-001');

      // 3. POST /api/children
      const createPayload = {
        fullName: 'Aarav Sharma',
        guardianName: 'Rohan Sharma',
        guardianPhone: '+919876543210',
        exitPermissionMode: 'ESCORT_REQUIRED' as const,
      };
      mockFetch.mockResolvedValueOnce(makeResponse(201, sampleChild));
      await apiClient.createChildStrict(createPayload);
      expect(mockFetch.mock.calls[2][0]).toBe('http://localhost:5000/api/children');
      expect(mockFetch.mock.calls[2][1].method).toBe('POST');
      expect(JSON.parse(mockFetch.mock.calls[2][1].body)).toEqual(createPayload);

      // 4. PATCH /api/children/:id
      mockFetch.mockResolvedValueOnce(makeResponse(200, { ...sampleChild, medicalNotes: 'Updated allergy note' }));
      await apiClient.updateChildStrict('child-001', { medicalNotes: 'Updated allergy note' });
      expect(mockFetch.mock.calls[3][0]).toBe('http://localhost:5000/api/children/child-001');
      expect(mockFetch.mock.calls[3][1].method).toBe('PATCH');
      expect(JSON.parse(mockFetch.mock.calls[3][1].body)).toEqual({ medicalNotes: 'Updated allergy note' });

      // 5. POST /api/children/:id/archive (F-P1-05: sends no ignored reason body)
      mockFetch.mockResolvedValueOnce(
        makeResponse(200, { ...sampleChild, status: 'ARCHIVED', archivedAt: '2026-11-18T03:00:00.000Z' })
      );
      const archived = await apiClient.archiveChildStrict('child-001');
      expect(archived.status).toBe('ARCHIVED');
      expect(mockFetch.mock.calls[4][0]).toBe('http://localhost:5000/api/children/child-001/archive');
      expect(mockFetch.mock.calls[4][1].method).toBe('POST');
      expect(mockFetch.mock.calls[4][1].body).toBeUndefined();
    });

    test('6-10: Authorized Pickup endpoints (list, add, update, revoke, archive/DELETE)', async () => {
      // 6. GET /api/children/:childId/pickups (F-P1-05: no ignored ?includeArchived query param)
      mockFetch.mockResolvedValueOnce(makeResponse(200, [samplePickup]));
      const pickups = await apiClient.getChildPickupsStrict('child-001');
      expect(pickups).toHaveLength(1);
      expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:5000/api/children/child-001/pickups');

      // 7. POST /api/children/:childId/pickups
      const addPickupPayload = {
        name: 'Meera Sharma',
        phone: '+919876500001',
        relationship: 'Grandmother',
        idDocumentType: 'DRIVING_LICENSE',
        idDocumentLast4: '4321',
      };
      mockFetch.mockResolvedValueOnce(makeResponse(201, samplePickup));
      await apiClient.addChildPickupStrict('child-001', addPickupPayload);
      expect(mockFetch.mock.calls[1][0]).toBe('http://localhost:5000/api/children/child-001/pickups');
      expect(mockFetch.mock.calls[1][1].method).toBe('POST');
      expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual(addPickupPayload);

      // 8. PATCH /api/children/:childId/pickups/:pickupId
      mockFetch.mockResolvedValueOnce(makeResponse(200, { ...samplePickup, notes: 'Updated note' }));
      await apiClient.updateChildPickupStrict('child-001', 'pickup-001', { notes: 'Updated note' });
      expect(mockFetch.mock.calls[2][0]).toBe('http://localhost:5000/api/children/child-001/pickups/pickup-001');
      expect(mockFetch.mock.calls[2][1].method).toBe('PATCH');
      expect(JSON.parse(mockFetch.mock.calls[2][1].body)).toEqual({ notes: 'Updated note' });

      // 9. POST /api/children/:childId/pickups/:pickupId/revoke (F-P1-05: no ignored reason body)
      mockFetch.mockResolvedValueOnce(makeResponse(200, { ...samplePickup, status: 'REVOKED' }));
      const revoked = await apiClient.revokeChildPickupStrict('child-001', 'pickup-001');
      expect(revoked.status).toBe('REVOKED');
      expect(mockFetch.mock.calls[3][0]).toBe('http://localhost:5000/api/children/child-001/pickups/pickup-001/revoke');
      expect(mockFetch.mock.calls[3][1].method).toBe('POST');
      expect(mockFetch.mock.calls[3][1].body).toBeUndefined();

      // 10. DELETE /api/children/:childId/pickups/:pickupId
      mockFetch.mockResolvedValueOnce(
        makeResponse(200, { ...samplePickup, status: 'ARCHIVED', archivedAt: '2026-11-18T03:00:00.000Z' })
      );
      const archived = await apiClient.archiveChildPickupStrict('child-001', 'pickup-001');
      expect(archived.status).toBe('ARCHIVED');
      expect(mockFetch.mock.calls[4][0]).toBe('http://localhost:5000/api/children/child-001/pickups/pickup-001');
      expect(mockFetch.mock.calls[4][1].method).toBe('DELETE');
    });

    test('11-16: Gate Pass, Verification & Exit Log endpoints with exact payload verification', async () => {
      // 11. GET /api/children/passes
      mockFetch.mockResolvedValueOnce(makeResponse(200, [samplePass]));
      await apiClient.getChildPassesStrict({ childId: 'child-001', status: 'ACTIVE', limit: 25, offset: 5 });
      expect(mockFetch.mock.calls[0][0]).toBe(
        'http://localhost:5000/api/children/passes?childId=child-001&status=ACTIVE&limit=25&offset=5'
      );

      // 12. GET /api/children/passes/:id
      mockFetch.mockResolvedValueOnce(makeResponse(200, samplePass));
      const onePass = await apiClient.getChildPassByIdStrict('pass-001');
      expect(onePass.passCode).toBe('CGP-ABCD-1234');
      expect(mockFetch.mock.calls[1][0]).toBe('http://localhost:5000/api/children/passes/pass-001');

      // 13. POST /api/children/passes
      const createPassPayload = {
        childId: 'child-001',
        pickupPersonId: 'pickup-001',
        validUntil: '2026-11-18T05:00:00.000Z',
        maxUses: 1,
      };
      mockFetch.mockResolvedValueOnce(makeResponse(201, sampleCreatedPass));
      await apiClient.createChildPassStrict(createPassPayload, { childExitPermissionMode: 'ESCORT_REQUIRED' });
      expect(mockFetch.mock.calls[2][0]).toBe('http://localhost:5000/api/children/passes');
      expect(JSON.parse(mockFetch.mock.calls[2][1].body)).toEqual(createPassPayload);

      // 14. POST /api/children/passes/:id/revoke (backend persists `reason`)
      mockFetch.mockResolvedValueOnce(makeResponse(200, { ...samplePass, status: 'REVOKED' }));
      await apiClient.revokeChildPassStrict('pass-001', { reason: 'Plans changed' });
      expect(mockFetch.mock.calls[3][0]).toBe('http://localhost:5000/api/children/passes/pass-001/revoke');
      expect(JSON.parse(mockFetch.mock.calls[3][1].body)).toEqual({ reason: 'Plans changed' });

      // 15. POST /api/children/passes/verify
      mockFetch.mockResolvedValueOnce(makeResponse(200, sampleVerifySuccess));
      const verified = await apiClient.verifyChildPassStrict({
        qrPayload: VALID_QR_PAYLOAD,
        gateId: 'MAIN_GATE',
        notes: 'ID checked visually',
      });
      expect(verified.authorized).toBe(true);
      expect(verified.outcome).toBe('ALLOWED');
      expect(mockFetch.mock.calls[4][0]).toBe('http://localhost:5000/api/children/passes/verify');
      expect(JSON.parse(mockFetch.mock.calls[4][1].body)).toEqual({
        qrPayload: VALID_QR_PAYLOAD,
        gateId: 'MAIN_GATE',
        notes: 'ID checked visually',
      });

      // 16. GET /api/children/exit-logs
      mockFetch.mockResolvedValueOnce(makeResponse(200, [sampleExitLog]));
      await apiClient.getChildExitLogsStrict({ childId: 'child-001', limit: 50, offset: 0 });
      expect(mockFetch.mock.calls[5][0]).toBe(
        'http://localhost:5000/api/children/exit-logs?childId=child-001&limit=50&offset=0'
      );
    });

    test('17-20: SOS & Safety Alert endpoints (trigger, list, acknowledge, resolve)', async () => {
      // 17. POST /api/children/sos
      const sosPayload = {
        childId: 'child-001',
        location: 'Tower A Playground',
        alertType: 'MISSING_CHILD' as const,
        severity: 'CRITICAL' as const,
        lastSeenDetails: 'Blue t-shirt near swings',
      };
      mockFetch.mockResolvedValueOnce(makeResponse(201, sampleSosCreated));
      await apiClient.triggerChildSosStrict(sosPayload);
      expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:5000/api/children/sos');
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual(sosPayload);

      // 18. GET /api/children/alerts
      mockFetch.mockResolvedValueOnce(makeResponse(200, [sampleAlert]));
      await apiClient.getChildAlertsStrict({ status: 'ACTIVE', limit: 20 });
      expect(mockFetch.mock.calls[1][0]).toBe('http://localhost:5000/api/children/alerts?status=ACTIVE&limit=20');

      // 19. POST /api/children/alerts/:id/acknowledge (F-P1-05: no ignored notes body)
      mockFetch.mockResolvedValueOnce(
        makeResponse(200, { ...sampleAlert, status: 'ACKNOWLEDGED', acknowledgedByName: 'Officer Vikram' })
      );
      const acked = await apiClient.acknowledgeChildAlertStrict('alert-001');
      expect(acked.status).toBe('ACKNOWLEDGED');
      expect(mockFetch.mock.calls[2][0]).toBe('http://localhost:5000/api/children/alerts/alert-001/acknowledge');
      expect(mockFetch.mock.calls[2][1].body).toBeUndefined();

      // 20. POST /api/children/alerts/:id/resolve
      const resolvePayload = {
        resolutionNotes: 'Child found safely at clubhouse.',
        status: 'RESOLVED' as const,
      };
      mockFetch.mockResolvedValueOnce(
        makeResponse(200, { ...sampleAlert, status: 'RESOLVED', resolutionNotes: resolvePayload.resolutionNotes })
      );
      await apiClient.resolveChildAlertStrict('alert-001', resolvePayload);
      expect(mockFetch.mock.calls[3][0]).toBe('http://localhost:5000/api/children/alerts/alert-001/resolve');
      expect(JSON.parse(mockFetch.mock.calls[3][1].body)).toEqual(resolvePayload);
    });

    test('percent-encodes path segments to prevent path traversal and query injection', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(200, sampleChild));
      await apiClient.getChildByIdStrict('../passes?societyId=soc-other');
      expect(mockFetch.mock.calls[0][0]).toBe(
        'http://localhost:5000/api/children/..%2Fpasses%3FsocietyId%3Dsoc-other'
      );

      mockFetch.mockResolvedValueOnce(makeResponse(200, { ...samplePickup, status: 'REVOKED' }));
      await apiClient.revokeChildPickupStrict('child/1', 'pickup 2&admin=true');
      expect(mockFetch.mock.calls[1][0]).toBe(
        'http://localhost:5000/api/children/child%2F1/pickups/pickup%202%26admin%3Dtrue/revoke'
      );
    });
  });

  // =========================================================================
  // 5. Security-Critical Contract Guards (Gate Verify, Pass Policy, Raw IDs, Alerts)
  // =========================================================================
  describe('5. Security-Critical Pre-Flight & Gate Verification Outcome Contracts', () => {
    test.each([
      [409, 'CHILD_MISSING_ALERT_BLOCKED', 'CONFLICT', 'MISSING_ALERT_BLOCKED'],
      [409, 'PASS_ALREADY_CONSUMED', 'CONFLICT', 'DENIED'],
      [409, 'PASS_EXPIRED', 'CONFLICT', 'DENIED'],
      [409, 'PASS_REVOKED', 'CONFLICT', 'DENIED'],
      [409, 'PICKUP_PERSON_UNAUTHORIZED', 'CONFLICT', 'DENIED'],
      [404, 'INVALID_OR_UNKNOWN_PASS', 'NOT_FOUND', 'DENIED'],
      [422, 'PASS_NOT_YET_VALID', 'VALIDATION', 'DENIED'],
      [422, 'ESCORT_REQUIRED', 'VALIDATION', 'DENIED'],
    ] as const)(
      'gate verification preserves HTTP %i %s (%s / outcome=%s)',
      async (status, code, kind, outcome) => {
        mockFetch.mockResolvedValueOnce(
          makeResponse(status, {
            authorized: false,
            outcome,
            code,
            error: `Gate exit denied: ${code}`,
            exitLog: { ...sampleExitLog, outcome, denialReason: code },
          })
        );

        let err: ApiError | undefined;
        try {
          await apiClient.verifyChildPassStrict({ qrPayload: VALID_QR_PAYLOAD, gateId: 'MAIN_GATE' });
        } catch (e) {
          err = e as ApiError;
        }
        expect(err).toBeInstanceOf(ApiError);
        expect(err?.status).toBe(status);
        expect(err?.code).toBe(code);
        expect(err?.kind).toBe(kind);
        expect(err?.payload?.outcome).toBe(outcome);
        expect((err?.payload?.exitLog as any)?.denialReason).toBe(code);
      }
    );

    test('gate verification preserves 503 BACKEND_UNAVAILABLE fail-closed contract', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse(503, {
          authorized: false,
          outcome: 'VERIFICATION_UNAVAILABLE',
          verificationChannel: 'BACKEND_UNAVAILABLE',
          code: 'BACKEND_UNAVAILABLE',
          error: 'Gate verification service is temporarily unavailable. Fail-closed policy active.',
        })
      );
      let unavailableErr: ApiError | undefined;
      try {
        await apiClient.verifyChildPassStrict({ qrPayload: VALID_QR_PAYLOAD });
      } catch (err) {
        unavailableErr = err as ApiError;
      }
      expect(unavailableErr?.status).toBe(503);
      expect(unavailableErr?.code).toBe('BACKEND_UNAVAILABLE');
      expect(unavailableErr?.isFailClosedUnavailable).toBe(true);
      expect(unavailableErr?.payload?.outcome).toBe('VERIFICATION_UNAVAILABLE');
    });

    test('gate verification rejects empty token or display passCode-only input before hitting network', async () => {
      await expect(apiClient.verifyChildPassStrict({})).rejects.toMatchObject({
        status: 400,
        code: 'BEARER_TOKEN_REQUIRED',
      });

      await expect(apiClient.verifyChildPassStrict({ qrPayload: 'CGP-ABCD-1234' })).rejects.toMatchObject({
        status: 400,
        code: 'BEARER_TOKEN_REQUIRED',
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('pass creation enforces pickupPersonId whenever exitPermissionMode !== SOLO_ALLOWED', async () => {
      await expect(
        apiClient.createChildPassStrict(
          { childId: 'child-001', validUntil: '2026-11-18T05:00:00.000Z' },
          { childExitPermissionMode: 'ESCORT_REQUIRED' }
        )
      ).rejects.toMatchObject({
        status: 422,
        code: 'AUTHORIZED_PICKUP_REQUIRED',
        kind: 'VALIDATION',
      });
      expect(mockFetch).not.toHaveBeenCalled();

      // Allowed when SOLO_ALLOWED
      mockFetch.mockResolvedValueOnce(makeResponse(201, { ...sampleCreatedPass, pickupPersonId: null }));
      const soloPass = await apiClient.createChildPassStrict(
        { childId: 'child-001', validUntil: '2026-11-18T05:00:00.000Z' },
        { childExitPermissionMode: 'SOLO_ALLOWED' }
      );
      expect(soloPass.bearerToken).toBe(VALID_BEARER_TOKEN);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('F-P1-04: blocks raw government ID fields case-insensitively (including nested) and oversized idDocumentLast4 before hitting network', async () => {
      // Mixed-case IdProofNumber on pickup creation
      await expect(
        apiClient.addChildPickupStrict('child-001', {
          name: 'Meera Sharma',
          phone: '+919876500001',
          relationship: 'Grandmother',
          IdProofNumber: 'DL-MH02-2018-9182',
        } as any)
      ).rejects.toMatchObject({ status: 400, code: 'RAW_ID_DOCUMENT_FORBIDDEN' });

      // Uppercase AADHAAR nested inside secondaryGuardians on child creation
      await expect(
        apiClient.createChildStrict({
          fullName: 'Aarav Sharma',
          guardianName: 'Rohan Sharma',
          guardianPhone: '+919876543210',
          secondaryGuardians: [
            { name: 'Priya', relationship: 'Mother', phone: '+919876500009', AADHAAR: '1234-5678-9012' } as any,
          ],
        })
      ).rejects.toMatchObject({ status: 400, code: 'RAW_ID_DOCUMENT_FORBIDDEN' });

      // Mixed-case PAN_NUMBER on pickup update
      await expect(
        apiClient.updateChildPickupStrict('child-001', 'pickup-001', {
          PAN_NUMBER: 'ABCDE1234F',
        } as any)
      ).rejects.toMatchObject({ status: 400, code: 'RAW_ID_DOCUMENT_FORBIDDEN' });

      // idDocumentLast4 exceeding 4 characters
      await expect(
        apiClient.addChildPickupStrict('child-001', {
          name: 'Meera Sharma',
          phone: '+919876500001',
          relationship: 'Grandmother',
          idDocumentType: 'AADHAAR',
          idDocumentLast4: '12345',
        })
      ).rejects.toMatchObject({ status: 400, code: 'INVALID_PICKUP_METADATA' });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('alert resolution requires non-empty resolutionNotes and valid status before hitting network', async () => {
      await expect(
        apiClient.resolveChildAlertStrict('alert-001', { resolutionNotes: '   ' })
      ).rejects.toMatchObject({ status: 400, code: 'RESOLUTION_NOTES_REQUIRED' });

      await expect(
        apiClient.resolveChildAlertStrict('alert-001', {
          resolutionNotes: 'Found safe',
          status: 'CLOSED' as any,
        })
      ).rejects.toMatchObject({ status: 400, code: 'INVALID_RESOLUTION_STATUS' });

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 6. Backward Compatibility for Unrelated & Legacy API Consumers
  // =========================================================================
  describe('6. Backward Compatibility for Unrelated & Legacy API Consumers', () => {
    test('preserves legacy apiRequest null-returning behavior for unrelated modules (health, flats, visitor passes)', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(200, { status: 'UP', engine: 'Node.js' }));
      const health = await apiClient.checkHealth();
      expect(health).toEqual({ status: 'UP', engine: 'Node.js' });

      mockFetch.mockResolvedValueOnce(makeResponse(500, { error: 'Transient error' }));
      const flatsOnFailure = await apiClient.getFlats('soc-alpha');
      expect(flatsOnFailure).toBeNull();

      mockFetch.mockRejectedValueOnce(new TypeError('Offline'));
      const passesOnOffline = await apiClient.getVisitorPasses('soc-alpha');
      expect(passesOnOffline).toBeNull();
    });

    test('keeps deprecated legacy Child Safety stubs intact during Phase 1 so unmigrated callers do not break', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(400, { error: 'Legacy shape rejected' }));
      const legacyResult = await apiClient.createChild({ name: 'Legacy' });
      expect(legacyResult).toBeNull();
    });
  });
});
