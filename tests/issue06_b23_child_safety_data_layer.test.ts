// =============================================================================
// ISSUE-06 Phase B.2.3 — Phase 3: Unified Child Safety Data Layer & Realtime Tests
// Exercises real `childSafetyService`, real `apiClient.*Strict` over mocked `fetch`,
// real `safetyCommandEngine`, real `safetyCommandService`, real `RealtimeService`,
// and real `subscribeToChildSafetyRealtime`.
// =============================================================================

class MockStorage implements Storage {
  private store = new Map<string, string>();
  public setItemCalls: Array<{ key: string; value: string }> = [];

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
    const str = String(value);
    this.setItemCalls.push({ key, value: str });
    this.store.set(key, str);
  }
  keys(): string[] {
    return Array.from(this.store.keys());
  }
}

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

jest.mock('../src/services/firebase/config', () => ({
  auth: {},
  db: {},
  functions: {},
}));

jest.mock('../src/services/payment/RazorpayService', () => ({
  RazorpayService: {
    createOrder: jest.fn(),
    verifyPayment: jest.fn(),
  },
}));

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  addDoc: jest.fn().mockResolvedValue(undefined),
  serverTimestamp: jest.fn(() => new Date().toISOString()),
  doc: jest.fn(),
  getDoc: jest.fn(),
  setDoc: jest.fn(),
  getDocs: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
}));

import { childSafetyService, formatChildSafetyError } from '../src/services/childSafetyService';
import { safetyCommandEngine } from '../src/domains/safety/services/safetyCommandEngine';
import { safetyCommandService } from '../src/services/safetyCommandService';
import { societyIntelligenceService } from '../src/services/societyIntelligenceService';
import { ApiError } from '../src/services/apiClient';
import { saveAuthSession, clearAuthSession } from '../src/services/authStorage';
import { RealtimeService } from '../src/services/realtimeService';
import type { RealtimeConnectionStatus, RealtimeMessage } from '../src/types/realtime';
import {
  CHILD_SAFETY_REALTIME_TOPICS,
  getInvalidatedChildSafetyScopes,
  subscribeToChildSafetyRealtime,
} from '../src/hooks/useChildSafetyRealtime';
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

// =============================================================================
// Mock HTTP / SSE Fixtures
// =============================================================================

function mockJsonResponse(status: number, body: unknown, headersMap: Record<string, string> = {}): Response {
  const normalized = new Map<string, string>();
  normalized.set('content-type', 'application/json');
  for (const [k, v] of Object.entries(headersMap)) {
    normalized.set(k.toLowerCase(), v);
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => normalized.get(name.toLowerCase()) ?? null,
    },
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

class MockSseStreamController {
  private queue: Array<{ done: boolean; value?: Uint8Array }> = [];
  private waitingResolve: ((res: { done: boolean; value?: Uint8Array }) => void) | null = null;
  private encoder = new TextEncoder();

  public pushText(text: string): void {
    const bytes = this.encoder.encode(text);
    if (this.waitingResolve) {
      const resolve = this.waitingResolve;
      this.waitingResolve = null;
      resolve({ done: false, value: bytes });
    } else {
      this.queue.push({ done: false, value: bytes });
    }
  }

  public close(): void {
    if (this.waitingResolve) {
      const resolve = this.waitingResolve;
      this.waitingResolve = null;
      resolve({ done: true, value: undefined });
    } else {
      this.queue.push({ done: true });
    }
  }

  public toResponse(status = 200): Response {
    const reader = {
      read: (): Promise<{ done: boolean; value?: Uint8Array }> => {
        if (this.queue.length > 0) return Promise.resolve(this.queue.shift()!);
        return new Promise((resolve) => {
          this.waitingResolve = resolve;
        });
      },
      cancel: async () => {},
    };
    return {
      ok: status === 200,
      status,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/event-stream' : null),
      },
      body: {
        getReader: () => reader,
        cancel: async () => {},
      },
    } as unknown as Response;
  }
}

async function flushMicrotasks(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
  }
}

const residentAlpha: UserProfile = {
  id: 'usr-res-alpha',
  role: 'resident',
  societyId: 'soc-alpha',
  name: 'Rohan Sharma',
  phone: '+919876543210',
  email: 'rohan@alpha.test',
  flatNumber: 'A-402',
  status: 'ACTIVE',
};

const platformAdmin: UserProfile = {
  id: 'usr-admin-platform',
  role: 'admin',
  societyId: 'soc-platform',
  name: 'Platform Admin',
  phone: '+919999999999',
  email: 'admin@aarizo.test',
  status: 'ACTIVE',
};

const nowIso = '2026-11-18T10:00:00.000Z';
const futureIso = '2026-11-18T14:00:00.000Z';

const samplePickupDto: AuthorizedPickupDto = {
  id: 'pkp-1',
  societyId: 'soc-alpha',
  childId: 'chd-1',
  name: 'Sunita Devi',
  phone: '+919811112222',
  relationship: 'Nanny',
  idDocumentType: 'Aadhaar',
  idDocumentLast4: '4589',
  idVerificationStatus: 'VERIFIED',
  idVerifiedAt: nowIso,
  photoUrl: null,
  status: 'ACTIVE',
  validUntil: futureIso,
  notes: null,
  archivedAt: null,
  createdAt: nowIso,
  updatedAt: nowIso,
};

const sampleChildDto: ChildProfileDto = {
  id: 'chd-1',
  societyId: 'soc-alpha',
  residentId: 'res-1',
  flatId: 'flt-1',
  guardianUserId: 'usr-res-alpha',
  flatNumber: 'A-402',
  fullName: 'Aarav Sharma',
  dateOfBirth: '2018-05-14',
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
  createdAt: nowIso,
  updatedAt: nowIso,
  pickups: [samplePickupDto],
};

const samplePassDto: ChildGatePassDto = {
  id: 'pass-1',
  societyId: 'soc-alpha',
  childId: 'chd-1',
  pickupPersonId: 'pkp-1',
  passCode: 'CGP-8842',
  pickupPersonName: 'Sunita Devi',
  pickupPersonPhone: '+919811112222',
  validFrom: nowIso,
  validUntil: futureIso,
  status: 'ACTIVE',
  maxUses: 1,
  currentUses: 0,
  firstUsedAt: null,
  lastUsedAt: null,
  revokedAt: null,
  revocationReason: null,
  notes: null,
  archivedAt: null,
  createdAt: nowIso,
  updatedAt: nowIso,
  child: {
    id: 'chd-1',
    fullName: 'Aarav Sharma',
    flatNumber: 'A-402',
    status: 'SAFE',
  },
};

const sampleCreatedPassDto: ChildGatePassCreatedDto = {
  ...samplePassDto,
  bearerToken: 'secret-one-time-bearer-token-999',
  qrPayload: 'AARIZO_CHILD_PASS:secret-one-time-bearer-token-999',
};

const sampleExitLogDto: ChildExitLogDto = {
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
  guardName: 'Officer Vikram',
  outcome: 'ALLOWED',
  verificationChannel: 'ONLINE_QR_TOKEN',
  denialReason: null,
  notes: null,
  timestamp: nowIso,
};

const sampleVerifySuccessDto: VerifyChildGatePassSuccessDto = {
  authorized: true,
  outcome: 'ALLOWED',
  pass: { ...samplePassDto, status: 'USED', currentUses: 1, firstUsedAt: nowIso, lastUsedAt: nowIso },
  exitLog: sampleExitLogDto,
};

const sampleAlertDto: ChildSafetyAlertDto = {
  id: 'alt-1',
  societyId: 'soc-alpha',
  childId: 'chd-1',
  reportedById: 'usr-res-alpha',
  reportedByName: 'Rohan Sharma',
  childName: 'Aarav Sharma',
  flatNumber: 'A-402',
  alertType: 'MISSING_CHILD',
  severity: 'CRITICAL',
  status: 'ACTIVE',
  location: 'Main Park',
  description: 'Last seen near swings',
  lastSeenDetails: 'Blue t-shirt',
  acknowledgedAt: null,
  acknowledgedById: null,
  acknowledgedByName: null,
  resolvedAt: null,
  resolvedById: null,
  resolvedByName: null,
  resolutionNotes: null,
  emergencyIncidentId: 'em-1',
  createdAt: nowIso,
  updatedAt: nowIso,
};

const sampleSosCreatedDto: ChildSosCreatedDto = {
  alert: sampleAlertDto,
  emergencyIncident: {
    id: 'em-1',
    societyId: 'soc-alpha',
    incidentType: 'CHILD_SAFETY',
    severity: 'CRITICAL',
    location: 'Main Park',
    dispatchStatus: 'TRIGGERED',
    createdAt: nowIso,
  },
};

const OBSOLETE_CHILD_STORAGE_KEYS = [
  'communityos_children_profiles',
  'communityos_child_pickup_qrs',
  'communityos_child_pickup_logs',
  'communityos_child_safety_alerts',
  'aarizo_child_profiles_v3',
  'aarizo_pickup_records_v3',
];

describe('ISSUE-06 Phase B.2.3 (Phase 3): Unified Child Safety Data Layer & Realtime Integration', () => {
  let mockLocalStorage: MockStorage;
  let mockSessionStorage: MockStorage;
  let mockFetch: jest.Mock;
  let dispatchedEvents: Array<{ type: string; detail?: unknown }>;

  beforeEach(() => {
    mockLocalStorage = new MockStorage();
    mockSessionStorage = new MockStorage();
    mockFetch = jest.fn();
    dispatchedEvents = [];

    (global as any).localStorage = mockLocalStorage;
    (global as any).sessionStorage = mockSessionStorage;
    (global as any).fetch = mockFetch;
    (global as any).window = {
      localStorage: mockLocalStorage,
      sessionStorage: mockSessionStorage,
      fetch: mockFetch,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
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

    childSafetyService.clearInMemoryState();
    saveAuthSession(residentAlpha, 'jwt-alpha-p3', 'password');
    mockLocalStorage.setItemCalls = [];
  });

  afterEach(() => {
    childSafetyService.clearInMemoryState();
    clearAuthSession();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // =========================================================================
  // 1. All 20 Canonical Async Operations + Zero Obsolete Storage Persistence
  // =========================================================================
  describe('1. Canonical Backend-Authoritative Service Facade (All 20 Endpoints)', () => {
    test('routes all 20 canonical async operations through strict API endpoints with zero obsolete localStorage writes and zero bearerToken persistence', async () => {
      const invalidations: Array<{ scopes: readonly string[]; reason: string }> = [];
      const unsubInv = childSafetyService.onCacheInvalidated((ev) => {
        invalidations.push({ scopes: ev.scopes, reason: ev.reason });
      });

      // 1-5: Children CRUD & archive
      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [sampleChildDto]));
      expect(await childSafetyService.listChildren()).toEqual([sampleChildDto]);
      expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:5000/api/children');

      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, sampleChildDto));
      expect(await childSafetyService.getChildById('chd-1')).toEqual(sampleChildDto);
      expect(mockFetch.mock.calls[1][0]).toBe('http://localhost:5000/api/children/chd-1');

      mockFetch.mockResolvedValueOnce(mockJsonResponse(201, sampleChildDto));
      expect(
        await childSafetyService.createChildProfileAsync({
          fullName: 'Aarav Sharma',
          guardianName: 'Rohan Sharma',
          guardianPhone: '+919876543210',
        })
      ).toEqual(sampleChildDto);
      expect(mockFetch.mock.calls[2][0]).toBe('http://localhost:5000/api/children');
      expect(mockFetch.mock.calls[2][1].method).toBe('POST');

      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, { ...sampleChildDto, medicalNotes: 'Updated' }));
      expect((await childSafetyService.updateChildProfile('chd-1', { medicalNotes: 'Updated' })).medicalNotes).toBe('Updated');
      expect(mockFetch.mock.calls[3][0]).toBe('http://localhost:5000/api/children/chd-1');
      expect(mockFetch.mock.calls[3][1].method).toBe('PATCH');

      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, { ...sampleChildDto, status: 'ARCHIVED', archivedAt: nowIso }));
      expect((await childSafetyService.archiveChildProfile('chd-1')).status).toBe('ARCHIVED');
      expect(mockFetch.mock.calls[4][0]).toBe('http://localhost:5000/api/children/chd-1/archive');

      // 6-10: Authorized Pickups
      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [samplePickupDto]));
      expect(await childSafetyService.listAuthorizedPickups('chd-1')).toEqual([samplePickupDto]);
      expect(mockFetch.mock.calls[5][0]).toBe('http://localhost:5000/api/children/chd-1/pickups');

      mockFetch.mockResolvedValueOnce(mockJsonResponse(201, samplePickupDto));
      expect(
        await childSafetyService.addAuthorizedPickup('chd-1', {
          name: 'Sunita Devi',
          phone: '+919811112222',
          relationship: 'Nanny',
          idDocumentType: 'Aadhaar',
          idDocumentLast4: '4589',
        })
      ).toEqual(samplePickupDto);
      expect(mockFetch.mock.calls[6][1].method).toBe('POST');

      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, { ...samplePickupDto, relationship: 'Aunt' }));
      expect((await childSafetyService.updateAuthorizedPickup('chd-1', 'pkp-1', { relationship: 'Aunt' })).relationship).toBe('Aunt');
      expect(mockFetch.mock.calls[7][0]).toBe('http://localhost:5000/api/children/chd-1/pickups/pkp-1');
      expect(mockFetch.mock.calls[7][1].method).toBe('PATCH');

      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, { ...samplePickupDto, status: 'REVOKED' }));
      expect((await childSafetyService.revokeAuthorizedPickup('chd-1', 'pkp-1')).status).toBe('REVOKED');
      expect(mockFetch.mock.calls[8][0]).toBe('http://localhost:5000/api/children/chd-1/pickups/pkp-1/revoke');

      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, { ...samplePickupDto, status: 'ARCHIVED', archivedAt: nowIso }));
      expect((await childSafetyService.archiveAuthorizedPickup('chd-1', 'pkp-1')).status).toBe('ARCHIVED');
      expect(mockFetch.mock.calls[9][0]).toBe('http://localhost:5000/api/children/chd-1/pickups/pkp-1');
      expect(mockFetch.mock.calls[9][1].method).toBe('DELETE');

      // 11-15: Gate Passes & Verification
      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [samplePassDto]));
      expect(await childSafetyService.listGatePasses({ childId: 'chd-1' })).toEqual([samplePassDto]);
      expect(mockFetch.mock.calls[10][0]).toBe('http://localhost:5000/api/children/passes?childId=chd-1');

      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, samplePassDto));
      expect(await childSafetyService.getGatePassById('pass-1')).toEqual(samplePassDto);
      expect(mockFetch.mock.calls[11][0]).toBe('http://localhost:5000/api/children/passes/pass-1');

      mockFetch.mockResolvedValueOnce(mockJsonResponse(201, sampleCreatedPassDto));
      const createdPass = await childSafetyService.createGatePass(
        { childId: 'chd-1', pickupPersonId: 'pkp-1', validUntil: futureIso },
        { childExitPermissionMode: 'ESCORT_REQUIRED' }
      );
      expect(createdPass.bearerToken).toBe('secret-one-time-bearer-token-999');
      expect(createdPass.qrPayload).toBe('AARIZO_CHILD_PASS:secret-one-time-bearer-token-999');

      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, { ...samplePassDto, status: 'REVOKED', revokedAt: nowIso }));
      expect((await childSafetyService.revokeGatePass('pass-1', { reason: 'Changed plans' })).status).toBe('REVOKED');
      expect(mockFetch.mock.calls[13][0]).toBe('http://localhost:5000/api/children/passes/pass-1/revoke');

      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, sampleVerifySuccessDto));
      const verified = await childSafetyService.verifyGatePass({
        qrPayload: 'AARIZO_CHILD_PASS:secret-one-time-bearer-token-999',
        gateId: 'MAIN_GATE',
      });
      expect(verified.authorized).toBe(true);
      expect(verified.outcome).toBe('ALLOWED');
      expect(mockFetch.mock.calls[14][0]).toBe('http://localhost:5000/api/children/passes/verify');

      // 16: Exit Logs
      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [sampleExitLogDto]));
      expect(await childSafetyService.listExitLogs({ childId: 'chd-1', limit: 20 })).toEqual([sampleExitLogDto]);
      expect(mockFetch.mock.calls[15][0]).toBe('http://localhost:5000/api/children/exit-logs?childId=chd-1&limit=20');

      // 17-20: SOS & Safety Alerts
      mockFetch.mockResolvedValueOnce(mockJsonResponse(201, sampleSosCreatedDto));
      expect(await childSafetyService.triggerSos({ childId: 'chd-1', location: 'Main Park' })).toEqual(sampleSosCreatedDto);
      expect(mockFetch.mock.calls[16][0]).toBe('http://localhost:5000/api/children/sos');

      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [sampleAlertDto]));
      expect(await childSafetyService.listAlerts({ status: 'ACTIVE' })).toEqual([sampleAlertDto]);
      expect(mockFetch.mock.calls[17][0]).toBe('http://localhost:5000/api/children/alerts?status=ACTIVE');

      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, { ...sampleAlertDto, status: 'ACKNOWLEDGED', acknowledgedAt: nowIso }));
      expect((await childSafetyService.acknowledgeAlert('alt-1')).status).toBe('ACKNOWLEDGED');
      expect(mockFetch.mock.calls[18][0]).toBe('http://localhost:5000/api/children/alerts/alt-1/acknowledge');

      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, { ...sampleAlertDto, status: 'RESOLVED', resolvedAt: nowIso }));
      expect((await childSafetyService.resolveAlert('alt-1', { resolutionNotes: 'Child found safely' })).status).toBe('RESOLVED');
      expect(mockFetch.mock.calls[19][0]).toBe('http://localhost:5000/api/children/alerts/alt-1/resolve');

      // Assert ZERO writes to any obsolete Child Safety localStorage keys
      for (const obsoleteKey of OBSOLETE_CHILD_STORAGE_KEYS) {
        expect(mockLocalStorage.getItem(obsoleteKey)).toBeNull();
      }
      expect(mockLocalStorage.setItemCalls).toHaveLength(0);

      // Assert bearerToken / qrPayload NEVER leaked into storage or legacy QR projection
      const allStoredValues = mockLocalStorage.keys().map((k) => mockLocalStorage.getItem(k) || '').join(' ');
      expect(allStoredValues).not.toContain('secret-one-time-bearer-token-999');
      expect(allStoredValues).not.toContain('AARIZO_CHILD_PASS:');
      const legacyQRs = childSafetyService.getPickupQRs();
      expect(JSON.stringify(legacyQRs)).not.toContain('secret-one-time-bearer-token-999');
      expect(JSON.stringify(legacyQRs)).not.toContain('AARIZO_CHILD_PASS:');

      // Confirm mutations triggered cache invalidation notifications
      expect(invalidations.length).toBeGreaterThanOrEqual(12);
      unsubInv();
    });

    test('never uses hardcoded soc-gvs fallback; strips client societyId for non-admins and permits explicit societyId only for verified platform admin', async () => {
      // Resident attempting to pass a different societyId or hardcoded soc-gvs -> stripped!
      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [sampleChildDto]));
      await childSafetyService.listChildren({ societyId: 'soc-gvs' });
      expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:5000/api/children');
      expect(mockFetch.mock.calls[0][0]).not.toContain('soc-gvs');

      mockFetch.mockResolvedValueOnce(mockJsonResponse(201, sampleChildDto));
      await childSafetyService.createChildProfileAsync({
        fullName: 'Aarav Sharma',
        guardianName: 'Rohan Sharma',
        guardianPhone: '+919876543210',
        societyId: 'soc-other',
      });
      const sentBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(sentBody.societyId).toBeUndefined();

      // Switch to verified platform admin -> explicit concrete societyId IS forwarded
      saveAuthSession(platformAdmin, 'jwt-platform-p3', 'password');
      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [sampleChildDto]));
      await childSafetyService.listChildren({ societyId: 'soc-alpha' });
      expect(mockFetch.mock.calls[2][0]).toBe('http://localhost:5000/api/children?societyId=soc-alpha');
    });

    test('rejects raw government ID numbers before hitting the network and never persists them', async () => {
      await expect(
        childSafetyService.addAuthorizedPickup('chd-1', {
          name: 'Sunita Devi',
          phone: '+919811112222',
          relationship: 'Nanny',
          idDocumentType: 'Aadhaar',
          idProofNumber: '1234-5678-9012',
        } as any)
      ).rejects.toMatchObject({
        code: 'RAW_ID_DOCUMENT_FORBIDDEN',
        kind: 'VALIDATION',
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockLocalStorage.setItemCalls).toHaveLength(0);
    });
  });

  // =========================================================================
  // 2. Strict Error Preservation (Never Fabricate Empty Arrays or Success)
  // =========================================================================
  describe('2. Strict Error Propagation & Safe UI Error Formatting', () => {
    test('preserves HTTP 503, 401, 403, 409, 429, and network errors intact without converting to [] or fake records', async () => {
      // HTTP 503 Service Unavailable -> MUST throw ApiError, NOT return []
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse(503, { error: 'Database offline', code: 'DATABASE_UNAVAILABLE' }, { 'Retry-After': '15' })
      );
      await expect(childSafetyService.listChildren()).rejects.toMatchObject({
        status: 503,
        kind: 'UNAVAILABLE',
        code: 'DATABASE_UNAVAILABLE',
        retryAfterSeconds: 15,
      });

      // HTTP 429 Rate Limit -> preserves retryAfterSeconds
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse(429, { error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' }, { 'Retry-After': '30' })
      );
      try {
        await childSafetyService.verifyGatePass({ bearerToken: 'tok-123' });
        fail('Expected ApiError on 429');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const formatted = formatChildSafetyError(err);
        expect(formatted.kind).toBe('RATE_LIMITED');
        expect(formatted.retryAfterSeconds).toBe(30);
        expect(formatted.isRetryable).toBe(true);
      }

      // HTTP 401 Unauthorized -> formats as Session Expired and emits aarizo:unauthorized
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse(401, { error: 'Token expired', code: 'AUTH_TOKEN_INVALID' })
      );
      try {
        await childSafetyService.listGatePasses();
        fail('Expected ApiError on 401');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const formatted = formatChildSafetyError(err);
        expect(formatted.kind).toBe('UNAUTHORIZED');
        expect(formatted.title).toBe('Session Expired');
        expect(formatted.isRetryable).toBe(false);
      }
      // Restore session for subsequent assertions in this test
      saveAuthSession(residentAlpha, 'jwt-alpha-p3', 'password');

      // HTTP 409 Conflict (e.g. CHILD_MISSING_ALERT_BLOCKED)
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse(409, {
          authorized: false,
          outcome: 'MISSING_ALERT_BLOCKED',
          code: 'CHILD_MISSING_ALERT_BLOCKED',
          error: 'Child has an active missing alert',
        })
      );
      await expect(childSafetyService.verifyGatePass({ bearerToken: 'tok-123' })).rejects.toMatchObject({
        status: 409,
        kind: 'CONFLICT',
        code: 'CHILD_MISSING_ALERT_BLOCKED',
      });

      // HTTP 403 Forbidden
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse(403, { error: 'Insufficient permissions', code: 'INSUFFICIENT_PERMISSIONS' })
      );
      await expect(childSafetyService.acknowledgeAlert('alt-1')).rejects.toMatchObject({
        status: 403,
        kind: 'FORBIDDEN',
        code: 'INSUFFICIENT_PERMISSIONS',
      });

      // Network failure -> throws NETWORK ApiError, never returns []
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await expect(childSafetyService.listAlerts()).rejects.toMatchObject({
        status: 0,
        kind: 'NETWORK',
        code: 'NETWORK_UNAVAILABLE',
      });
    });
  });

  // =========================================================================
  // 3. Split-Brain Elimination & Fail-Closed Compatibility Adapters
  // =========================================================================
  describe('3. Legacy Store Elimination, Fail-Closed Compatibility Adapters & General Incident Preservation', () => {
    test('deprecated sync compatibility adapters on childSafetyService & safetyCommandEngine NEVER write localStorage or fabricate success', async () => {
      // Hydrate ephemeral snapshot via authoritative async listChildren()
      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [sampleChildDto]));
      await childSafetyService.listChildren();

      // Legacy read adapters project from the authoritative in-memory snapshot (never hardcoded soc-gvs, never localStorage)
      const projected = safetyCommandEngine.getChildren();
      expect(projected).toHaveLength(1);
      expect(projected[0].childName).toBe('Aarav Sharma');
      expect(projected[0].qrPassCode).toBe(''); // Never fabricates deterministic QR-CHILD-... code
      expect(projected[0].authorizedPickups[0].idProofNumber).toBe('XXXX-4589'); // Masked last4 only

      // Deprecated sync gate verification MUST fail closed (never allowed: true / isValid: true)
      expect(childSafetyService.verifyAndScanChildPickup('soc-alpha', 'CGP-8842')).toMatchObject({
        allowed: false,
      });
      expect(safetyCommandEngine.verifyChildPickupAtGate('Aarav Sharma', 'Sunita Devi', 'Guard')).toMatchObject({
        isValid: false,
      });

      // Deprecated sync mutations MUST throw LEGACY_SYNC_API_DEPRECATED and write ZERO localStorage
      expect(() =>
        safetyCommandEngine.addChildProfile('Fake Child', 'A-101', 'Parent', '+919000000000')
      ).toThrow(ApiError);
      expect(() =>
        safetyCommandEngine.addAuthorizedPickup('chd-1', {
          name: 'Fake',
          phone: '+919000000000',
          relationship: 'Nanny',
          idProofType: 'Aadhaar',
          idProofNumber: '1234-5678-9012',
        })
      ).toThrow(ApiError);
      expect(() =>
        childSafetyService.createChildProfile('soc-alpha', 'A-101', 'Fake', '2020-01-01', 'MALE', [], [])
      ).toThrow(ApiError);
      expect(() =>
        childSafetyService.generatePickupQR('soc-alpha', 'chd-1', 'pkp-1', nowIso, futureIso)
      ).toThrow(ApiError);
      expect(() =>
        childSafetyService.triggerMissingChildAlert('soc-alpha', 'chd-1', 'Rohan')
      ).toThrow(ApiError);
      expect(() =>
        childSafetyService.resolveSafetyAlert('soc-alpha', 'alt-1', 'Admin')
      ).toThrow(ApiError);

      // Zero obsolete localStorage writes occurred
      for (const obsoleteKey of OBSOLETE_CHILD_STORAGE_KEYS) {
        expect(mockLocalStorage.getItem(obsoleteKey)).toBeNull();
      }
      expect(mockLocalStorage.setItemCalls).toHaveLength(0);

      // Logout immediately clears ephemeral projection so no cross-session data lingers
      clearAuthSession();
      expect(childSafetyService.getChildren()).toEqual([]);
      expect(safetyCommandEngine.getChildren()).toEqual([]);
    });

    test('preserves general EmergencyIncident consumers (safetyCommandService & safetyCommandEngine incidents) without redirecting to Child Safety APIs', () => {
      // safetyCommandService (consumed by SecurityEmergencyTerminalPage & societyIntelligenceService)
      const initialIncidents = safetyCommandService.getIncidents('soc-alpha');
      expect(initialIncidents.length).toBeGreaterThan(0);

      const triggered = safetyCommandService.triggerSOS(
        'soc-alpha',
        'FIRE',
        'A-402',
        'Tower A',
        'Kitchen smoke alarm',
        residentAlpha.id,
        residentAlpha.name,
        residentAlpha.phone
      );
      expect(triggered.status).toBe('TRIGGERED');

      const acked = safetyCommandService.acknowledgeIncident('soc-alpha', triggered.id, 'Officer Vikram');
      expect(acked.status).toBe('ACKNOWLEDGED');

      const resolved = safetyCommandService.resolveIncident('soc-alpha', triggered.id, 'Officer Vikram', 'False smoke');
      expect(resolved.status).toBe('RESOLVED');

      // safetyCommandEngine general incident workflow (consumed by SafetyCommandHub)
      const oneTap = safetyCommandEngine.triggerOneTapSOS(
        'MEDICAL',
        residentAlpha.id,
        residentAlpha.name,
        'A-402',
        residentAlpha.phone,
        'Flat A-402'
      );
      expect(oneTap.societyId).toBe('soc-alpha'); // Uses authenticated user's societyId, NOT hardcoded soc-gvs/soc-1!
      expect(oneTap.status).toBe('TRIGGERED');

      // Zero calls to Child Safety backend APIs occurred for general incidents
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 4. Shared Child Safety Realtime Integration (Authenticated Fetch SSE)
  // =========================================================================
  describe('4. Shared Child Safety Realtime Hook & Subscription Controller (Authenticated Fetch SSE)', () => {
    test('subscribes to all 14 exact backend Child Safety topics, routes scoped callbacks, deduplicates repeated events, handles reconnect, cleans up on unmount, and preserves unrelated subscribers', async () => {
      jest.useFakeTimers();

      const sseFetch = jest.fn();
      const stream1 = new MockSseStreamController();
      const stream2 = new MockSseStreamController();
      sseFetch
        .mockResolvedValueOnce(stream1.toResponse(200))
        .mockResolvedValueOnce(stream2.toResponse(200));

      const rtService = new RealtimeService({
        fetchFn: sseFetch,
        getBaseUrl: () => 'http://localhost:5000',
        enableOnlineListener: false,
        baseReconnectDelayMs: 500,
        maxReconnectDelayMs: 2000,
        maxJitterMs: 0,
      });

      const allEvents: string[] = [];
      const profileEvents: string[] = [];
      const pickupEvents: string[] = [];
      const passEvents: string[] = [];
      const exitEvents: string[] = [];
      const alertEvents: string[] = [];
      const reconnects: string[] = [];
      const unrelatedEvents: string[] = [];
      const serviceInvalidations: Array<{ scopes: readonly string[]; reason: string; topic?: string }> = [];

      const unsubInv = childSafetyService.onCacheInvalidated((ev) => {
        serviceInvalidations.push({ scopes: ev.scopes, reason: ev.reason, topic: ev.topic });
      });

      const unsubUnrelated = rtService.subscribe('VISITOR_ARRIVAL', (msg) => {
        unrelatedEvents.push(msg.id);
      });

      // Subscribe using the shared Phase 3 Child Safety realtime controller
      const unsubChildSafety = subscribeToChildSafetyRealtime(
        {
          onEvent: (ev) => allEvents.push(`${ev.topic}:${ev.id}`),
          onProfilesChange: (ev) => profileEvents.push(ev.topic),
          onPickupsChange: (ev) => pickupEvents.push(ev.topic),
          onPassesChange: (ev) => passEvents.push(ev.topic),
          onExitLogsChange: (ev) => exitEvents.push(ev.topic),
          onAlertsChange: (ev) => alertEvents.push(ev.topic),
          onReconnect: (st) => reconnects.push(st.state),
        },
        rtService
      );

      // 14 Child Safety topics + 1 unrelated VISITOR_ARRIVAL listener = 15 active topic listeners
      expect(CHILD_SAFETY_REALTIME_TOPICS).toHaveLength(14);
      expect(rtService.getConnectionStatus().activeListenersCount).toBe(15);

      // Connect authenticated Fetch SSE stream
      rtService.connect({
        token: 'jwt-alpha-p3',
        userId: residentAlpha.id,
        societyId: residentAlpha.societyId,
        role: residentAlpha.role,
      });
      await flushMicrotasks();

      // Deliver backend events across all 5 families + unrelated VISITOR_ARRIVAL
      stream1.pushText(
        `id: evt_p1\ndata: {"eventId":"evt_p1","topic":"CHILD_PROFILE_CREATED","id":"chd-1","societyId":"soc-alpha"}\n\n` +
          `id: evt_pk1\ndata: {"eventId":"evt_pk1","topic":"CHILD_PICKUP_AUTHORIZED","id":"pkp-1","childId":"chd-1","societyId":"soc-alpha"}\n\n` +
          `id: evt_gp1\ndata: {"eventId":"evt_gp1","topic":"CHILD_GATE_PASS_GENERATED","id":"pass-1","childId":"chd-1","passCode":"CGP-8842"}\n\n` +
          `id: evt_ex1\ndata: {"eventId":"evt_ex1","topic":"CHILD_EXIT_TRIGGERED","exitLogId":"log-1","childId":"chd-1"}\n\n` +
          `id: evt_al1\ndata: {"eventId":"evt_al1","topic":"CHILD_SAFETY_SOS_TRIGGERED","alertId":"alt-1","childId":"chd-1"}\n\n` +
          `id: evt_vis1\ndata: {"eventId":"evt_vis1","topic":"VISITOR_ARRIVAL","visitorName":"Amit"}\n\n`
      );
      await flushMicrotasks();

      expect(allEvents).toHaveLength(5);
      expect(profileEvents).toEqual([
        'CHILD_PROFILE_CREATED',
        'CHILD_PICKUP_AUTHORIZED',
        'CHILD_GATE_PASS_GENERATED',
        'CHILD_EXIT_TRIGGERED',
        'CHILD_SAFETY_SOS_TRIGGERED',
      ]);
      expect(pickupEvents).toEqual(['CHILD_PICKUP_AUTHORIZED']);
      expect(passEvents).toEqual(['CHILD_GATE_PASS_GENERATED', 'CHILD_EXIT_TRIGGERED']);
      expect(exitEvents).toEqual(['CHILD_EXIT_TRIGGERED']);
      expect(alertEvents).toEqual(['CHILD_SAFETY_SOS_TRIGGERED']);
      expect(unrelatedEvents).toEqual(['evt_vis1']);

      // Simulate premature EOF -> RECONNECTING -> CONNECTED with replay of evt_al1 + new evt_al2
      stream1.close();
      await flushMicrotasks();
      expect(rtService.getConnectionStatus().state).toBe('RECONNECTING');

      jest.advanceTimersByTime(500);
      await flushMicrotasks();
      expect(rtService.getConnectionStatus().state).toBe('CONNECTED');
      expect(reconnects).toEqual(['CONNECTED']);
      expect(serviceInvalidations.some((i) => i.reason === 'reconnect' && i.scopes.includes('all'))).toBe(true);

      // Replayed evt_al1 MUST be deduplicated (no duplicate UI update); new evt_al2 IS delivered
      stream2.pushText(
        `id: evt_al1\ndata: {"eventId":"evt_al1","topic":"CHILD_SAFETY_SOS_TRIGGERED","alertId":"alt-1","childId":"chd-1","replayed":true}\n\n` +
          `id: evt_al2\ndata: {"eventId":"evt_al2","topic":"CHILD_SAFETY_ALERT_RESOLVED","alertId":"alt-1","childId":"chd-1"}\n\n`
      );
      await flushMicrotasks();

      expect(allEvents).toHaveLength(6);
      expect(alertEvents).toEqual(['CHILD_SAFETY_SOS_TRIGGERED', 'CHILD_SAFETY_ALERT_RESOLVED']);

      // Unmount / unsubscribe cleans up ALL 14 Child Safety listeners while leaving unrelated subscriber intact
      unsubChildSafety();
      expect(rtService.getConnectionStatus().activeListenersCount).toBe(1);

      // Further Child Safety events do not invoke unsubscribed callbacks; unrelated VISITOR_ARRIVAL still works
      stream2.pushText(
        `id: evt_after_unsub\ndata: {"eventId":"evt_after_unsub","topic":"CHILD_PROFILE_UPDATED","id":"chd-1"}\n\n` +
          `id: evt_vis2\ndata: {"eventId":"evt_vis2","topic":"VISITOR_ARRIVAL","visitorName":"Neha"}\n\n`
      );
      await flushMicrotasks();

      expect(allEvents).toHaveLength(6);
      expect(unrelatedEvents).toEqual(['evt_vis1', 'evt_vis2']);

      // Verify exact scope mapping helper covers all 14 topics
      for (const topic of CHILD_SAFETY_REALTIME_TOPICS) {
        expect(getInvalidatedChildSafetyScopes(topic).length).toBeGreaterThan(0);
      }

      unsubUnrelated();
      unsubInv();
      rtService.destroy();
    });
  });

  // =========================================================================
  // 5. F-P3-01 Remediation: Session-Safe Snapshots, Filtered Query Isolation &
  //    Scoped Invalidation / Mutation Failure Invariants
  // =========================================================================
  describe('5. F-P3-01: Session-Safe Snapshot Management & Mutation Failure Invalidation', () => {
    const createDeferred = <T>() => {
      let resolve!: (value: T) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };

    const residentBeta: UserProfile = {
      id: 'usr-res-beta',
      name: 'Meera Nair',
      phone: '+919822223333',
      role: 'resident',
      societyId: 'soc-beta',
      societyName: 'Beta Heights',
      flatNumber: 'B-201',
    };

    const betaChildDto: ChildProfileDto = {
      ...sampleChildDto,
      id: 'chd-beta-1',
      societyId: 'soc-beta',
      guardianUserId: 'usr-res-beta',
      flatNumber: 'B-201',
      fullName: 'Diya Nair',
      guardianName: 'Meera Nair',
      guardianPhone: '+919822223333',
      pickups: [],
    };

    test('prevents in-flight User A listChildren response from polluting User B snapshot after session switch', async () => {
      const deferredAlpha = createDeferred<Response>();
      mockFetch.mockReturnValueOnce(deferredAlpha.promise);

      // User A initiates listChildren() and request remains in flight
      const alphaPromise = childSafetyService.listChildren();

      // Before User A's response resolves, session switches to User B (different user & society)
      clearAuthSession();
      saveAuthSession(residentBeta, 'jwt-beta-p3', 'password');

      // Now User A's stale HTTP response resolves
      deferredAlpha.resolve(mockJsonResponse(200, [sampleChildDto]));
      const alphaReturned = await alphaPromise;
      expect(alphaReturned).toHaveLength(1);
      expect(alphaReturned[0].fullName).toBe('Aarav Sharma');

      // CRITICAL INVARIANT: User B's snapshot MUST remain empty (never polluted by User A!)
      expect(childSafetyService.getChildren()).toEqual([]);
      expect(safetyCommandEngine.getChildren()).toEqual([]);

      // User B's own fetch populates User B's isolated snapshot cleanly
      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [betaChildDto]));
      await childSafetyService.listChildren();
      expect(childSafetyService.getChildren()).toHaveLength(1);
      expect(childSafetyService.getChildren()[0].fullName).toBe('Diya Nair');
      expect(childSafetyService.getChildren()[0].societyId).toBe('soc-beta');
    });

    test('prevents in-flight User A reads across ALL 4 snapshot resources (children, passes, exitLogs, alerts) from polluting User B or post-logout state', async () => {
      const defChildren = createDeferred<Response>();
      const defPasses = createDeferred<Response>();
      const defLogs = createDeferred<Response>();
      const defAlerts = createDeferred<Response>();

      mockFetch
        .mockReturnValueOnce(defChildren.promise)
        .mockReturnValueOnce(defPasses.promise)
        .mockReturnValueOnce(defLogs.promise)
        .mockReturnValueOnce(defAlerts.promise);

      const pChildren = childSafetyService.listChildren();
      const pPasses = childSafetyService.listGatePasses();
      const pLogs = childSafetyService.listExitLogs();
      const pAlerts = childSafetyService.listAlerts();

      // Switch session to User B while all 4 requests are in flight
      clearAuthSession();
      saveAuthSession(residentBeta, 'jwt-beta-p3', 'password');

      defChildren.resolve(mockJsonResponse(200, [sampleChildDto]));
      defPasses.resolve(mockJsonResponse(200, [samplePassDto]));
      defLogs.resolve(mockJsonResponse(200, [sampleExitLogDto]));
      defAlerts.resolve(mockJsonResponse(200, [sampleAlertDto]));

      await Promise.all([pChildren, pPasses, pLogs, pAlerts]);

      expect(childSafetyService.getChildren()).toEqual([]);
      expect(childSafetyService.getPickupQRs()).toEqual([]);
      expect(childSafetyService.getPickupLogs()).toEqual([]);
      expect(childSafetyService.getSafetyAlerts()).toEqual([]);

      // Also verify logout mid-flight leaves unauthenticated state empty
      const defLogout = createDeferred<Response>();
      mockFetch.mockReturnValueOnce(defLogout.promise);
      const pLogout = childSafetyService.listChildren();
      clearAuthSession();
      defLogout.resolve(mockJsonResponse(200, [betaChildDto]));
      await pLogout;
      expect(childSafetyService.getChildren()).toEqual([]);
    });

    test('prevents in-flight User A mutation from emitting invalidation into User B session and prevents stale pre-clear read from repopulating same user', async () => {
      // 1. In-flight mutation across session switch emits 0 invalidations into User B
      const defMut = createDeferred<Response>();
      mockFetch.mockReturnValueOnce(defMut.promise);

      const invalidations: Array<{ scopes: readonly string[]; reason: string }> = [];
      const unsub = childSafetyService.onCacheInvalidated((ev) => {
        invalidations.push({ scopes: ev.scopes, reason: ev.reason });
      });

      const pCreate = childSafetyService.createChildProfileAsync({
        fullName: 'Aarav Sharma',
        guardianName: 'Rohan Sharma',
        guardianPhone: '+919876543210',
      });

      clearAuthSession();
      saveAuthSession(residentBeta, 'jwt-beta-p3', 'password');
      invalidations.length = 0;

      defMut.resolve(mockJsonResponse(201, sampleChildDto));
      await pCreate;

      expect(invalidations).toHaveLength(0);
      unsub();

      // 2. Same-user clearInMemoryState() mid-flight discards stale in-flight response
      saveAuthSession(residentAlpha, 'jwt-alpha-p3', 'password');
      const defSameUser = createDeferred<Response>();
      mockFetch.mockReturnValueOnce(defSameUser.promise);
      const pStale = childSafetyService.listChildren();
      childSafetyService.clearInMemoryState();
      defSameUser.resolve(mockJsonResponse(200, [sampleChildDto]));
      await pStale;
      expect(childSafetyService.getChildren()).toEqual([]);
    });

    test('filtered queries NEVER overwrite the default unfiltered active-session snapshot', async () => {
      // 1. Populate all 4 default unfiltered snapshots
      mockFetch
        .mockResolvedValueOnce(mockJsonResponse(200, [sampleChildDto]))
        .mockResolvedValueOnce(mockJsonResponse(200, [samplePassDto]))
        .mockResolvedValueOnce(mockJsonResponse(200, [sampleExitLogDto]))
        .mockResolvedValueOnce(mockJsonResponse(200, [sampleAlertDto]));

      await childSafetyService.listChildren();
      await childSafetyService.listGatePasses();
      await childSafetyService.listExitLogs();
      await childSafetyService.listAlerts();

      expect(childSafetyService.getChildren()).toHaveLength(1);
      expect(childSafetyService.getPickupQRs()).toHaveLength(1);
      expect(childSafetyService.getPickupLogs()).toHaveLength(1);
      expect(childSafetyService.getSafetyAlerts()).toHaveLength(1);

      // 2. Run filtered queries that return different/empty slices
      const revokedPass: ChildGatePassDto = { ...samplePassDto, id: 'pass-revoked', status: 'REVOKED' };
      const resolvedAlert: ChildSafetyAlertDto = { ...sampleAlertDto, id: 'alt-resolved', status: 'RESOLVED' };

      mockFetch
        .mockResolvedValueOnce(mockJsonResponse(200, [])) // includeArchived=true
        .mockResolvedValueOnce(mockJsonResponse(200, [revokedPass])) // status=REVOKED
        .mockResolvedValueOnce(mockJsonResponse(200, [])) // childId filter on passes
        .mockResolvedValueOnce(mockJsonResponse(200, [])) // childId + limit on exit logs
        .mockResolvedValueOnce(mockJsonResponse(200, [resolvedAlert])); // status=RESOLVED on alerts

      await childSafetyService.listChildren({ includeArchived: true });
      await childSafetyService.listGatePasses({ status: 'REVOKED' });
      await childSafetyService.listGatePasses({ childId: 'chd-other' });
      await childSafetyService.listExitLogs({ childId: 'chd-other', limit: 5 });
      await childSafetyService.listAlerts({ status: 'RESOLVED' });

      // 3. Default snapshots MUST still hold the original unfiltered data
      expect(childSafetyService.getChildren().map((c) => c.id)).toEqual(['chd-1']);
      expect(childSafetyService.getPickupQRs().map((p) => p.id)).toEqual(['pass-1']);
      expect(childSafetyService.getPickupQRs()[0].status).toBe('ACTIVE');
      expect(childSafetyService.getPickupLogs().map((l) => l.id)).toEqual(['log-1']);
      expect(childSafetyService.getSafetyAlerts().map((a) => a.id)).toEqual(['alt-1']);
      expect(childSafetyService.getSafetyAlerts()[0].status).toBe('ACTIVE');
    });

    test('platform-admin cross-society query does NOT overwrite platform default snapshot and non-admin cross-society read fails closed', async () => {
      // Non-admin reading with mismatched societyId argument fails closed
      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [sampleChildDto]));
      await childSafetyService.listChildren();
      expect(childSafetyService.getChildren('soc-alpha')).toHaveLength(1);
      expect(childSafetyService.getChildren('soc-beta')).toEqual([]);

      // Platform admin default listChildren() vs explicit societyId='soc-beta'
      saveAuthSession(platformAdmin, 'jwt-platform-p3', 'password');
      mockFetch
        .mockResolvedValueOnce(mockJsonResponse(200, [sampleChildDto, betaChildDto]))
        .mockResolvedValueOnce(mockJsonResponse(200, [betaChildDto]));

      await childSafetyService.listChildren();
      expect(childSafetyService.getChildren()).toHaveLength(2);

      // Filtered to soc-beta must NOT overwrite platform default snapshot
      await childSafetyService.listChildren({ societyId: 'soc-beta' });
      expect(childSafetyService.getChildren()).toHaveLength(2);
    });

    test('scoped invalidation clears ONLY affected resource snapshots while preserving unrelated resource snapshots', async () => {
      // Hydrate all 4 default snapshots
      mockFetch
        .mockResolvedValueOnce(mockJsonResponse(200, [sampleChildDto]))
        .mockResolvedValueOnce(mockJsonResponse(200, [samplePassDto]))
        .mockResolvedValueOnce(mockJsonResponse(200, [sampleExitLogDto]))
        .mockResolvedValueOnce(mockJsonResponse(200, [sampleAlertDto]));

      await childSafetyService.listChildren();
      await childSafetyService.listGatePasses();
      await childSafetyService.listExitLogs();
      await childSafetyService.listAlerts();

      // 1. revokeGatePass invalidates ['passes'] ONLY -> passes cleared; children/logs/alerts preserved!
      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, { ...samplePassDto, status: 'REVOKED' }));
      await childSafetyService.revokeGatePass('pass-1', { reason: 'Parent cancelled' });

      expect(childSafetyService.getPickupQRs()).toEqual([]);
      expect(childSafetyService.getChildren()).toHaveLength(1);
      expect(childSafetyService.getPickupLogs()).toHaveLength(1);
      expect(childSafetyService.getSafetyAlerts()).toHaveLength(1);

      // Re-hydrate passes
      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [samplePassDto]));
      await childSafetyService.listGatePasses();
      expect(childSafetyService.getPickupQRs()).toHaveLength(1);

      // 2. acknowledgeAlert invalidates ['alerts'] ONLY -> alerts cleared; children/passes/logs preserved!
      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, { ...sampleAlertDto, status: 'ACKNOWLEDGED' }));
      await childSafetyService.acknowledgeAlert('alt-1');

      expect(childSafetyService.getSafetyAlerts()).toEqual([]);
      expect(childSafetyService.getChildren()).toHaveLength(1);
      expect(childSafetyService.getPickupQRs()).toHaveLength(1);
      expect(childSafetyService.getPickupLogs()).toHaveLength(1);

      // 3. updateAuthorizedPickup with status ACTIVE preserves passes, while status REVOKED cascades passes!
      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, { ...samplePickupDto, status: 'ACTIVE', notes: 'Updated' }));
      await childSafetyService.updateAuthorizedPickup('chd-1', 'pkp-1', { notes: 'Updated' });
      expect(childSafetyService.getChildren()).toEqual([]);
      expect(childSafetyService.getPickupQRs()).toHaveLength(1); // preserved on metadata-only update

      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [sampleChildDto]));
      await childSafetyService.listChildren();
      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, { ...samplePickupDto, status: 'REVOKED' }));
      await childSafetyService.updateAuthorizedPickup('chd-1', 'pkp-1', { status: 'REVOKED' });
      expect(childSafetyService.getChildren()).toEqual([]);
      expect(childSafetyService.getPickupQRs()).toEqual([]); // evicted on REVOKED cascade!
      expect(childSafetyService.getPickupLogs()).toHaveLength(1); // unrelated exitLogs preserved!
    });

    test('failed mutations across ALL mutation endpoints propagate ApiError and emit ZERO notifyInvalidation events', async () => {
      const invalidations: Array<{ scopes: readonly string[]; reason: string }> = [];
      const unsub = childSafetyService.onCacheInvalidated((ev) => {
        invalidations.push({ scopes: ev.scopes, reason: ev.reason });
      });

      const mutationCalls: Array<{ name: string; status: number; code: string; run: () => Promise<unknown> }> = [
        {
          name: 'createChildProfileAsync',
          status: 400,
          code: 'VALIDATION_ERROR',
          run: () =>
            childSafetyService.createChildProfileAsync({
              fullName: 'Bad',
              guardianName: 'Parent',
              guardianPhone: '+919876543210',
            }),
        },
        {
          name: 'updateChildProfile',
          status: 403,
          code: 'FORBIDDEN',
          run: () => childSafetyService.updateChildProfile('chd-1', { medicalNotes: 'None' }),
        },
        {
          name: 'archiveChildProfile',
          status: 404,
          code: 'CHILD_NOT_FOUND',
          run: () => childSafetyService.archiveChildProfile('chd-missing'),
        },
        {
          name: 'addAuthorizedPickup',
          status: 400,
          code: 'INVALID_PICKUP',
          run: () =>
            childSafetyService.addAuthorizedPickup('chd-1', {
              name: 'Sunita',
              phone: '+919811112222',
              relationship: 'Nanny',
            }),
        },
        {
          name: 'updateAuthorizedPickup',
          status: 409,
          code: 'CONFLICT',
          run: () => childSafetyService.updateAuthorizedPickup('chd-1', 'pkp-1', { notes: 'x' }),
        },
        {
          name: 'revokeAuthorizedPickup',
          status: 500,
          code: 'INTERNAL_ERROR',
          run: () => childSafetyService.revokeAuthorizedPickup('chd-1', 'pkp-1'),
        },
        {
          name: 'archiveAuthorizedPickup',
          status: 503,
          code: 'DATABASE_UNAVAILABLE',
          run: () => childSafetyService.archiveAuthorizedPickup('chd-1', 'pkp-1'),
        },
        {
          name: 'createGatePass',
          status: 429,
          code: 'RATE_LIMIT_EXCEEDED',
          run: () =>
            childSafetyService.createGatePass({
              childId: 'chd-1',
              pickupPersonId: 'pkp-1',
              validFrom: nowIso,
              validUntil: futureIso,
            }),
        },
        {
          name: 'revokeGatePass',
          status: 409,
          code: 'PASS_ALREADY_REVOKED',
          run: () => childSafetyService.revokeGatePass('pass-1'),
        },
        {
          name: 'verifyGatePass',
          status: 409,
          code: 'CHILD_MISSING_ALERT_BLOCKED',
          run: () => childSafetyService.verifyGatePass({ bearerToken: 'tok-xyz' }),
        },
        {
          name: 'triggerSos',
          status: 503,
          code: 'SERVICE_UNAVAILABLE',
          run: () =>
            childSafetyService.triggerSos({
              childId: 'chd-1',
              alertType: 'MISSING_CHILD',
              location: 'Park',
            }),
        },
        {
          name: 'acknowledgeAlert',
          status: 403,
          code: 'FORBIDDEN',
          run: () => childSafetyService.acknowledgeAlert('alt-1'),
        },
        {
          name: 'resolveAlert',
          status: 500,
          code: 'INTERNAL_ERROR',
          run: () => childSafetyService.resolveAlert('alt-1', { resolutionNotes: 'Found' }),
        },
      ];

      for (const tc of mutationCalls) {
        mockFetch.mockResolvedValueOnce(mockJsonResponse(tc.status, { error: `${tc.name} failed`, code: tc.code }));
        await expect(tc.run()).rejects.toMatchObject({
          status: tc.status,
          code: tc.code,
        });
      }

      // CRITICAL: ZERO invalidations emitted for any failed mutation!
      expect(invalidations).toHaveLength(0);
      unsub();
    });
  });

  // =========================================================================
  // 6. F-P3-02 Remediation: Realtime Society Isolation, Cascade Scopes,
  //    OFFLINE Purge, Callback Exception Replay Recovery & Bounded Dedupe
  // =========================================================================
  describe('6. F-P3-02: Realtime Security, Cascade Invalidation, Offline Purge & Replay Safety', () => {
    const createMockRealtimeBus = () => {
      const topicHandlers = new Map<string, Set<(msg: RealtimeMessage) => void>>();
      const statusHandlers = new Set<(status: RealtimeConnectionStatus) => void>();

      const bus = {
        subscribe(topic: string, cb: (msg: RealtimeMessage) => void) {
          if (!topicHandlers.has(topic)) topicHandlers.set(topic, new Set());
          topicHandlers.get(topic)!.add(cb);
          return () => {
            topicHandlers.get(topic)?.delete(cb);
          };
        },
        subscribeToStatus(cb: (status: RealtimeConnectionStatus) => void) {
          statusHandlers.add(cb);
          return () => {
            statusHandlers.delete(cb);
          };
        },
        emitMessage(topic: string, msg: RealtimeMessage) {
          const handlers = topicHandlers.get(topic);
          if (!handlers) return;
          for (const cb of Array.from(handlers)) {
            cb(msg);
          }
        },
        emitStatus(state: RealtimeConnectionStatus['state']) {
          const st: RealtimeConnectionStatus = {
            state,
            isConnected: state === 'CONNECTED',
            latencyMs: 5,
            activeListenersCount: bus.listenerCount(),
            totalMessagesReceived: 0,
            transport: 'sse',
          };
          for (const cb of Array.from(statusHandlers)) {
            cb(st);
          }
        },
        listenerCount() {
          let total = 0;
          for (const set of topicHandlers.values()) total += set.size;
          return total;
        },
      };
      return bus;
    };

    test('rejects cross-society, missing, empty, malformed, sentinel, and unauthenticated Child Safety realtime events', () => {
      const bus = createMockRealtimeBus();
      const received: string[] = [];
      const invalidations: string[] = [];

      const unsubInv = childSafetyService.onCacheInvalidated((ev) => {
        if (ev.reason === 'realtime') invalidations.push(`${ev.topic}:${ev.scopes.join(',')}`);
      });
      const unsubRt = subscribeToChildSafetyRealtime(
        {
          onEvent: (ev) => received.push(`${ev.topic}:${ev.id}`),
        },
        bus as any
      );

      // Active user is residentAlpha (societyId: 'soc-alpha')
      const badMessages: Array<Partial<RealtimeMessage>> = [
        // 1. Cross-society event
        { id: 'bad-1', topic: 'CHILD_PROFILE_UPDATED', societyId: 'soc-beta', payload: { id: 'chd-2', societyId: 'soc-beta' } },
        // 2. Empty societyId
        { id: 'bad-2', topic: 'CHILD_PROFILE_UPDATED', societyId: '', payload: { id: 'chd-2' } },
        // 3. Missing / undefined societyId
        { id: 'bad-3', topic: 'CHILD_PROFILE_UPDATED', societyId: undefined as any, payload: { id: 'chd-2' } },
        // 4. Malformed non-string societyId
        { id: 'bad-4', topic: 'CHILD_PROFILE_UPDATED', societyId: 12345 as any, payload: { id: 'chd-2' } },
        // 5. Wildcard / platform sentinel societyId
        { id: 'bad-5', topic: 'CHILD_PROFILE_UPDATED', societyId: '*', payload: { id: 'chd-2' } },
        { id: 'bad-6', topic: 'CHILD_PROFILE_UPDATED', societyId: 'soc-platform', payload: { id: 'chd-2' } },
        { id: 'bad-7', topic: 'CHILD_PROFILE_UPDATED', societyId: 'all', payload: { id: 'chd-2' } },
        // 6. Mismatched payload.societyId vs envelope societyId
        { id: 'bad-8', topic: 'CHILD_PROFILE_UPDATED', societyId: 'soc-alpha', payload: { id: 'chd-2', societyId: 'soc-beta' } },
      ];

      for (const bad of badMessages) {
        bus.emitMessage('CHILD_PROFILE_UPDATED', {
          id: bad.id!,
          topic: 'CHILD_PROFILE_UPDATED',
          type: 'CHILD_PROFILE_UPDATED',
          societyId: bad.societyId as any,
          payload: bad.payload as any,
          timestamp: nowIso,
          senderRole: 'SYSTEM',
          senderName: 'SSE',
        });
      }

      expect(received).toEqual([]);
      expect(invalidations).toEqual([]);

      // Valid matching society event IS accepted
      bus.emitMessage('CHILD_PROFILE_UPDATED', {
        id: 'good-1',
        topic: 'CHILD_PROFILE_UPDATED',
        type: 'CHILD_PROFILE_UPDATED',
        societyId: 'soc-alpha',
        payload: { id: 'chd-1', societyId: 'soc-alpha' },
        timestamp: nowIso,
        senderRole: 'SYSTEM',
        senderName: 'SSE',
      });
      expect(received).toEqual(['CHILD_PROFILE_UPDATED:good-1']);
      expect(invalidations).toHaveLength(1);

      // Unauthenticated (logged out) MUST reject even a matching societyId event
      clearAuthSession();
      bus.emitMessage('CHILD_PROFILE_UPDATED', {
        id: 'unauth-1',
        topic: 'CHILD_PROFILE_UPDATED',
        type: 'CHILD_PROFILE_UPDATED',
        societyId: 'soc-alpha',
        payload: { id: 'chd-1', societyId: 'soc-alpha' },
        timestamp: nowIso,
        senderRole: 'SYSTEM',
        senderName: 'SSE',
      });
      expect(received).toEqual(['CHILD_PROFILE_UPDATED:good-1']);
      expect(invalidations).toHaveLength(1);

      unsubRt();
      unsubInv();
    });

    test('applies exact backend-aligned cascade invalidation scopes for CHILD_PROFILE_ARCHIVED, CHILD_PICKUP_REVOKED, CHILD_PICKUP_UPDATED, and all 14 topics', async () => {
      // Static scope verification against backend Prisma transaction side effects
      expect(getInvalidatedChildSafetyScopes('CHILD_PROFILE_ARCHIVED')).toEqual(['children', 'pickups', 'passes']);
      expect(getInvalidatedChildSafetyScopes('CHILD_PICKUP_REVOKED')).toEqual(['pickups', 'passes', 'children']);
      expect(getInvalidatedChildSafetyScopes('CHILD_PICKUP_UPDATED', { status: 'REVOKED' })).toEqual([
        'pickups',
        'passes',
        'children',
      ]);
      expect(getInvalidatedChildSafetyScopes('CHILD_PICKUP_UPDATED', { status: 'EXPIRED' })).toEqual([
        'pickups',
        'passes',
        'children',
      ]);
      expect(getInvalidatedChildSafetyScopes('CHILD_PICKUP_UPDATED', { status: 'ACTIVE' })).toEqual([
        'pickups',
        'children',
      ]);
      expect(getInvalidatedChildSafetyScopes('CHILD_GATE_PASS_VERIFIED')).toEqual(['passes', 'exitLogs', 'children']);
      expect(getInvalidatedChildSafetyScopes('CHILD_EXIT_DENIED')).toEqual(['exitLogs']);
      expect(getInvalidatedChildSafetyScopes('CHILD_SAFETY_ALERT_ACKNOWLEDGED')).toEqual(['alerts']);
      expect(getInvalidatedChildSafetyScopes('CHILD_SAFETY_ALERT_RESOLVED')).toEqual(['alerts', 'children']);

      // Live cascade test: hydrate children & passes, then receive CHILD_PROFILE_ARCHIVED -> evicts BOTH!
      mockFetch
        .mockResolvedValueOnce(mockJsonResponse(200, [sampleChildDto]))
        .mockResolvedValueOnce(mockJsonResponse(200, [samplePassDto]));
      await childSafetyService.listChildren();
      await childSafetyService.listGatePasses();
      expect(childSafetyService.getChildren()).toHaveLength(1);
      expect(childSafetyService.getPickupQRs()).toHaveLength(1);

      const bus = createMockRealtimeBus();
      const callbacks: string[] = [];
      const unsub = subscribeToChildSafetyRealtime(
        {
          onProfilesChange: (ev) => callbacks.push(`profiles:${ev.topic}`),
          onPickupsChange: (ev) => callbacks.push(`pickups:${ev.topic}`),
          onPassesChange: (ev) => callbacks.push(`passes:${ev.topic}`),
        },
        bus as any
      );

      bus.emitMessage('CHILD_PROFILE_ARCHIVED', {
        id: 'evt-arch-1',
        topic: 'CHILD_PROFILE_ARCHIVED',
        type: 'CHILD_PROFILE_ARCHIVED',
        societyId: 'soc-alpha',
        payload: { id: 'chd-1', societyId: 'soc-alpha' },
        timestamp: nowIso,
        senderRole: 'SYSTEM',
        senderName: 'SSE',
      });

      expect(callbacks).toEqual([
        'profiles:CHILD_PROFILE_ARCHIVED',
        'pickups:CHILD_PROFILE_ARCHIVED',
        'passes:CHILD_PROFILE_ARCHIVED',
      ]);
      expect(childSafetyService.getChildren()).toEqual([]);
      expect(childSafetyService.getPickupQRs()).toEqual([]);

      // Re-hydrate passes, then receive CHILD_PICKUP_REVOKED -> evicts passes & triggers onPassesChange!
      callbacks.length = 0;
      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [samplePassDto]));
      await childSafetyService.listGatePasses();
      expect(childSafetyService.getPickupQRs()).toHaveLength(1);

      bus.emitMessage('CHILD_PICKUP_REVOKED', {
        id: 'evt-rev-1',
        topic: 'CHILD_PICKUP_REVOKED',
        type: 'CHILD_PICKUP_REVOKED',
        societyId: 'soc-alpha',
        payload: { id: 'pkp-1', childId: 'chd-1', societyId: 'soc-alpha' },
        timestamp: nowIso,
        senderRole: 'SYSTEM',
        senderName: 'SSE',
      });

      expect(callbacks).toEqual([
        'profiles:CHILD_PICKUP_REVOKED',
        'pickups:CHILD_PICKUP_REVOKED',
        'passes:CHILD_PICKUP_REVOKED',
      ]);
      expect(childSafetyService.getPickupQRs()).toEqual([]);

      unsub();
    });

    test('OFFLINE status transition eagerly purges in-memory childSafetyService snapshots and RECONNECTING->CONNECTED clears stale snapshots + invokes onReconnect', async () => {
      mockFetch
        .mockResolvedValueOnce(mockJsonResponse(200, [sampleChildDto]))
        .mockResolvedValueOnce(mockJsonResponse(200, [samplePassDto]));
      await childSafetyService.listChildren();
      await childSafetyService.listGatePasses();
      expect(childSafetyService.getChildren()).toHaveLength(1);
      expect(childSafetyService.getPickupQRs()).toHaveLength(1);

      const bus = createMockRealtimeBus();
      const reconnects: string[] = [];
      const unsub = subscribeToChildSafetyRealtime(
        {
          onReconnect: (st) => reconnects.push(st.state),
        },
        bus as any
      );

      // 1. OFFLINE eagerly clears all snapshots
      bus.emitStatus('OFFLINE');
      expect(childSafetyService.getChildren()).toEqual([]);
      expect(childSafetyService.getPickupQRs()).toEqual([]);

      // 2. Re-hydrate, then transition RECONNECTING -> CONNECTED -> clears stale snapshots & invokes onReconnect
      mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [sampleChildDto]));
      await childSafetyService.listChildren();
      expect(childSafetyService.getChildren()).toHaveLength(1);

      bus.emitStatus('CONNECTED');
      bus.emitStatus('RECONNECTING');
      bus.emitStatus('CONNECTED');

      expect(childSafetyService.getChildren()).toEqual([]);
      expect(reconnects).toEqual(['CONNECTED']);

      unsub();
    });

    test('throwing callback isolates sibling callbacks, avoids recording seenEventId, withholds RealtimeService lastEventId, and allows clean replay recovery', async () => {
      jest.useFakeTimers();

      const sseFetch = jest.fn();
      const stream1 = new MockSseStreamController();
      const stream2 = new MockSseStreamController();
      sseFetch
        .mockResolvedValueOnce(stream1.toResponse(200))
        .mockResolvedValueOnce(stream2.toResponse(200));

      const rtService = new RealtimeService({
        fetchFn: sseFetch,
        getBaseUrl: () => 'http://localhost:5000',
        enableOnlineListener: false,
        baseReconnectDelayMs: 500,
        maxReconnectDelayMs: 2000,
        maxJitterMs: 0,
      });

      const consoleErrSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      let shouldThrow = true;
      const profileDeliveries: string[] = [];
      const passDeliveries: string[] = [];
      const siblingDeliveries: string[] = [];

      const unsubSibling = rtService.subscribe('CHILD_PROFILE_ARCHIVED', (msg) => {
        siblingDeliveries.push(msg.id);
      });

      const unsubChild = subscribeToChildSafetyRealtime(
        {
          onProfilesChange: (ev) => {
            if (shouldThrow) {
              throw new Error('Simulated UI render failure');
            }
            profileDeliveries.push(ev.id);
          },
          onPassesChange: (ev) => {
            passDeliveries.push(ev.id);
          },
        },
        rtService
      );

      rtService.connect({
        token: 'jwt-alpha-p3',
        userId: residentAlpha.id,
        societyId: residentAlpha.societyId,
        role: residentAlpha.role,
      });
      await flushMicrotasks();

      // 1. Deliver evt_replay_1 while onProfilesChange throws
      stream1.pushText(
        `id: evt_replay_1\ndata: {"eventId":"evt_replay_1","topic":"CHILD_PROFILE_ARCHIVED","id":"chd-1","societyId":"soc-alpha"}\n\n`
      );
      await flushMicrotasks();

      // Sibling callback in the SAME hook (onPassesChange) AND separate rtService subscriber STILL ran!
      expect(passDeliveries).toEqual(['evt_replay_1']);
      expect(siblingDeliveries).toEqual(['evt_replay_1']);
      expect(profileDeliveries).toEqual([]);
      // CRITICAL: RealtimeService did NOT advance lastEventId past failed delivery!
      expect(rtService.getLastEventId()).toBeNull();

      // 2. Fix failing callback, drop connection, reconnect & replay evt_replay_1
      shouldThrow = false;
      stream1.close();
      await flushMicrotasks();
      jest.advanceTimersByTime(500);
      await flushMicrotasks();

      stream2.pushText(
        `id: evt_replay_1\ndata: {"eventId":"evt_replay_1","topic":"CHILD_PROFILE_ARCHIVED","id":"chd-1","societyId":"soc-alpha"}\n\n`
      );
      await flushMicrotasks();

      // Replayed evt_replay_1 now SUCCEEDS and advances lastEventId!
      expect(profileDeliveries).toEqual(['evt_replay_1']);
      expect(rtService.getLastEventId()).toBe('evt_replay_1');

      // 3. Subsequent duplicate of evt_replay_1 IS deduplicated cleanly
      stream2.pushText(
        `id: evt_replay_1\ndata: {"eventId":"evt_replay_1","topic":"CHILD_PROFILE_ARCHIVED","id":"chd-1","societyId":"soc-alpha"}\n\n`
      );
      await flushMicrotasks();
      expect(profileDeliveries).toEqual(['evt_replay_1']);

      unsubChild();
      unsubSibling();
      rtService.destroy();
      consoleErrSpy.mockRestore();
    });

    test('enforces bounded FIFO deduplication eviction and rejects invented/unsupported topics', () => {
      const bus = createMockRealtimeBus();

      // 1. Invented-only topics attach 0 listeners
      const unsubFake = subscribeToChildSafetyRealtime(
        { topics: ['CHILD_FAKE_EVENT' as any, 'ADMIN_OVERRIDE' as any] },
        bus as any
      );
      expect(bus.listenerCount()).toBe(0);
      unsubFake();

      // 2. Mixed valid + invented attaches ONLY valid topic (1 listener)
      const delivered: string[] = [];
      const unsubMixed = subscribeToChildSafetyRealtime(
        {
          topics: ['CHILD_PROFILE_CREATED', 'CHILD_FAKE_EVENT' as any],
          maxDedupeIds: 3,
          onEvent: (ev) => delivered.push(ev.id),
        },
        bus as any
      );
      expect(bus.listenerCount()).toBe(1);

      const sendId = (id: string) =>
        bus.emitMessage('CHILD_PROFILE_CREATED', {
          id,
          topic: 'CHILD_PROFILE_CREATED',
          type: 'CHILD_PROFILE_CREATED',
          societyId: 'soc-alpha',
          payload: { id: 'chd-1', societyId: 'soc-alpha' },
          timestamp: nowIso,
          senderRole: 'SYSTEM',
          senderName: 'SSE',
        });

      // Fill FIFO window of size 3: e1, e2, e3
      sendId('e1');
      sendId('e2');
      sendId('e3');
      // e1 is still inside the window -> deduplicated
      sendId('e1');
      expect(delivered).toEqual(['e1', 'e2', 'e3']);

      // e4 evicts oldest (e1) from window -> window is now [e2, e3, e4]
      sendId('e4');
      // e2 is still deduplicated; e1 was evicted so it is accepted again (proves bounded FIFO eviction!)
      sendId('e2');
      sendId('e1');
      expect(delivered).toEqual(['e1', 'e2', 'e3', 'e4', 'e1']);

      unsubMixed();
    });
  });

  // =========================================================================
  // 7. Regression Protection: Society Intelligence Analytics + General Incidents
  // =========================================================================
  describe('7. Feature Preservation: societyIntelligenceService & General Incidents', () => {
    test('societyIntelligenceService.getAnalytics() consumes safetyCommandService.getIncidents() cleanly without Child Safety regressions', () => {
      const triggered = safetyCommandService.triggerSOS(
        'soc-alpha',
        'MEDICAL',
        'A-402',
        'Tower A',
        'Senior resident fall assistance',
        residentAlpha.id,
        residentAlpha.name,
        residentAlpha.phone
      );
      expect(triggered.status).toBe('TRIGGERED');

      const analytics = societyIntelligenceService.getAnalytics({
        preset: '30_DAYS',
        societyId: 'soc-alpha',
      });

      expect(analytics).toBeDefined();
      expect(analytics.kpis.emergencyIncidents).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(analytics.charts.visitorTrends)).toBe(true);
      expect(Array.isArray(analytics.charts.paymentCollection)).toBe(true);
      expect(Array.isArray(analytics.charts.maintenanceTrends)).toBe(true);

      // Zero Child Safety backend API calls triggered by analytics computation
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
