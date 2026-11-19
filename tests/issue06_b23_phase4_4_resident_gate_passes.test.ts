// =============================================================================
// ISSUE-06 Phase B.2.3 — Phase 4.4:
// Resident One-Time Secure Gate Pass Lifecycle & Exit History Behavioral Tests
// Executes REAL `useResidentGatePasses` -> REAL `childSafetyResidentHelpers` ->
// REAL `childSafetyService` -> REAL `apiClient.*Strict` over mocked `fetch`.
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
}

type EffectRecord = {
  fn: () => void | (() => void);
  deps: unknown[] | undefined;
  cleanup?: () => void;
};

const hookRuntime = {
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  callbacks: [] as Array<{ fn: Function; deps: unknown[] | undefined }>,
  effects: [] as Array<EffectRecord | undefined>,
  stateCursor: 0,
  refCursor: 0,
  cbCursor: 0,
  effectCursor: 0,
  pendingEffects: [] as number[],
  renderFn: null as (() => unknown) | null,
  lastResult: null as any,
  reset() {
    this.unmount();
    this.states = [];
    this.refs = [];
    this.callbacks = [];
    this.effects = [];
    this.stateCursor = 0;
    this.refCursor = 0;
    this.cbCursor = 0;
    this.effectCursor = 0;
    this.pendingEffects = [];
    this.renderFn = null;
    this.lastResult = null;
  },
  render<T>(fn: () => T): T {
    this.renderFn = fn;
    this.stateCursor = 0;
    this.refCursor = 0;
    this.cbCursor = 0;
    this.effectCursor = 0;
    this.pendingEffects = [];
    const result = fn();
    this.lastResult = result;
    this.flushEffects();
    return this.rerender();
  },
  rerender<T>(): T {
    if (!this.renderFn) return this.lastResult as T;
    this.stateCursor = 0;
    this.refCursor = 0;
    this.cbCursor = 0;
    this.effectCursor = 0;
    this.pendingEffects = [];
    const result = this.renderFn() as T;
    this.lastResult = result;
    if (this.pendingEffects.length > 0) {
      this.flushEffects();
    }
    return result;
  },
  flushEffects() {
    const toRun = [...this.pendingEffects];
    this.pendingEffects = [];
    for (const idx of toRun) {
      const rec = this.effects[idx];
      if (!rec) continue;
      if (typeof rec.cleanup === 'function') {
        rec.cleanup();
        rec.cleanup = undefined;
      }
      const ret = rec.fn();
      if (typeof ret === 'function') {
        rec.cleanup = ret;
      }
    }
  },
  unmount() {
    for (const rec of this.effects) {
      if (rec && typeof rec.cleanup === 'function') {
        rec.cleanup();
        rec.cleanup = undefined;
      }
    }
  },
};

function depsChanged(prev: unknown[] | undefined, next: unknown[] | undefined): boolean {
  if (!prev || !next) return true;
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i++) {
    if (!Object.is(prev[i], next[i])) return true;
  }
  return false;
}

jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useState: <T>(initial: T | (() => T)) => {
      const idx = hookRuntime.stateCursor++;
      if (!(idx in hookRuntime.states)) {
        hookRuntime.states[idx] = typeof initial === 'function' ? (initial as () => T)() : initial;
      }
      const setState = (val: T | ((prev: T) => T)) => {
        const prev = hookRuntime.states[idx] as T;
        const nextVal = typeof val === 'function' ? (val as (p: T) => T)(prev) : val;
        if (!Object.is(prev, nextVal)) {
          hookRuntime.states[idx] = nextVal;
        }
      };
      return [hookRuntime.states[idx] as T, setState] as const;
    },
    useRef: <T>(initial: T) => {
      const idx = hookRuntime.refCursor++;
      if (!(idx in hookRuntime.refs)) {
        hookRuntime.refs[idx] = { current: initial };
      }
      return hookRuntime.refs[idx] as { current: T };
    },
    useCallback: <T extends Function>(fn: T, deps: unknown[]) => {
      const idx = hookRuntime.cbCursor++;
      const prev = hookRuntime.callbacks[idx];
      if (!prev || depsChanged(prev.deps, deps)) {
        hookRuntime.callbacks[idx] = { fn, deps };
      }
      return hookRuntime.callbacks[idx].fn as T;
    },
    useEffect: (fn: () => void | (() => void), deps?: unknown[]) => {
      const idx = hookRuntime.effectCursor++;
      const prev = hookRuntime.effects[idx];
      if (!prev || depsChanged(prev.deps, deps)) {
        hookRuntime.effects[idx] = { fn, deps, cleanup: prev?.cleanup };
        hookRuntime.pendingEffects.push(idx);
      }
    },
  };
});

jest.mock('../src/utils/backendConfig', () => ({
  getBackendBaseUrl: jest.fn(() => 'http://localhost:5000'),
}));

jest.mock('../src/utils/nativeMobile', () => ({
  triggerHaptic: jest.fn(),
  isNativeApp: jest.fn(() => false),
}));

jest.mock('../src/services/firebase/config', () => ({
  auth: {},
  db: {},
}));

import {
  useResidentGatePasses,
  type ResidentGatePassesController,
} from '../src/domains/safety/components/ResidentGatePassesSection';
import { formatGatePassDisplay } from '../src/domains/safety/utils/childSafetyResidentHelpers';
import { childSafetyService } from '../src/services/childSafetyService';
import { saveAuthSession, clearAuthSession } from '../src/services/authStorage';
import type { UserProfile } from '../src/domains/auth/types';
import type {
  AuthorizedPickupDto,
  ChildExitLogDto,
  ChildGatePassCreatedDto,
  ChildGatePassDto,
  ChildProfileDto,
} from '../src/types/childSafety';

const mockJsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}): Response => {
  const normalizedHeaders = new Map<string, string>([['content-type', 'application/json']]);
  for (const [k, v] of Object.entries(headers)) {
    normalizedHeaders.set(k.toLowerCase(), v);
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => normalizedHeaders.get(name.toLowerCase()) ?? null,
    },
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
};

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flushMicrotasks = async (ticks = 8) => {
  for (let i = 0; i < ticks; i++) {
    await Promise.resolve();
  }
};

const residentAlpha: UserProfile = {
  id: 'usr-res-alpha',
  name: 'Rohan Sharma',
  phone: '+919876543210',
  role: 'resident',
  societyId: 'soc-alpha',
  societyName: 'Alpha Residency',
  flatNumber: 'A-402',
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

const CREATED_ISO = '2026-11-18T10:00:00.000Z';
const futureIsoFromNow = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString();
const pastIsoFromNow = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();

const childEscortRequired: ChildProfileDto = {
  id: 'chd-alpha-1',
  societyId: 'soc-alpha',
  residentId: 'res-alpha-1',
  flatId: 'flt-alpha-1',
  guardianUserId: 'usr-res-alpha',
  flatNumber: 'A-402',
  fullName: 'Aarav Sharma',
  dateOfBirth: '2018-05-14T00:00:00.000Z',
  reportedAge: 8,
  gender: 'MALE',
  photoUrl: null,
  medicalNotes: null,
  status: 'SAFE',
  exitPermissionMode: 'ESCORT_REQUIRED',
  allowedSoloExit: false,
  guardianName: 'Rohan Sharma',
  guardianPhone: '+919876543210',
  emergencyPhone: null,
  secondaryGuardians: null,
  emergencyContacts: null,
  notes: null,
  archivedAt: null,
  createdAt: CREATED_ISO,
  updatedAt: CREATED_ISO,
};

const childSoloAllowed: ChildProfileDto = {
  ...childEscortRequired,
  id: 'chd-alpha-2',
  fullName: 'Ananya Sharma',
  reportedAge: 14,
  gender: 'FEMALE',
  exitPermissionMode: 'SOLO_ALLOWED',
  allowedSoloExit: true,
};

const childMissing: ChildProfileDto = {
  ...childEscortRequired,
  id: 'chd-missing-1',
  status: 'MISSING',
};

const childArchived: ChildProfileDto = {
  ...childEscortRequired,
  id: 'chd-archived-1',
  status: 'ARCHIVED',
  archivedAt: CREATED_ISO,
};

const childBeta: ChildProfileDto = {
  ...childEscortRequired,
  id: 'chd-beta-1',
  societyId: 'soc-beta',
  residentId: 'res-beta-1',
  flatId: 'flt-beta-1',
  guardianUserId: 'usr-res-beta',
  flatNumber: 'B-201',
  fullName: 'Diya Nair',
  guardianName: 'Meera Nair',
  guardianPhone: '+919822223333',
};

const activePickupAlpha: AuthorizedPickupDto = {
  id: 'pkp-alpha-1',
  societyId: 'soc-alpha',
  childId: 'chd-alpha-1',
  name: 'Sunita Devi',
  phone: '+919811112222',
  relationship: 'Grandmother',
  idDocumentType: 'Aadhaar Card',
  idDocumentLast4: '4589',
  idVerificationStatus: 'VERIFIED',
  idVerifiedAt: CREATED_ISO,
  photoUrl: null,
  status: 'ACTIVE',
  validUntil: futureIsoFromNow(48),
  notes: null,
  archivedAt: null,
  createdAt: CREATED_ISO,
  updatedAt: CREATED_ISO,
};

const expiredPickupAlpha: AuthorizedPickupDto = {
  ...activePickupAlpha,
  id: 'pkp-alpha-exp',
  name: 'Expired Driver',
  status: 'ACTIVE',
  validUntil: pastIsoFromNow(12),
};

const activePickupBeta: AuthorizedPickupDto = {
  ...activePickupAlpha,
  id: 'pkp-beta-1',
  societyId: 'soc-beta',
  childId: 'chd-beta-1',
  name: 'Suresh Menon',
};

const makeActivePassDto = (overrides: Partial<ChildGatePassDto> = {}): ChildGatePassDto => ({
  id: 'pass-alpha-1',
  societyId: 'soc-alpha',
  childId: 'chd-alpha-1',
  pickupPersonId: 'pkp-alpha-1',
  passCode: 'CGP-7741',
  pickupPersonName: 'Sunita Devi',
  pickupPersonPhone: '+919811112222',
  validFrom: pastIsoFromNow(1),
  validUntil: futureIsoFromNow(4),
  status: 'ACTIVE',
  maxUses: 1,
  currentUses: 0,
  firstUsedAt: null,
  lastUsedAt: null,
  revokedAt: null,
  revocationReason: null,
  notes: 'School pickup',
  archivedAt: null,
  createdAt: CREATED_ISO,
  updatedAt: CREATED_ISO,
  child: {
    id: 'chd-alpha-1',
    fullName: 'Aarav Sharma',
    flatNumber: 'A-402',
    status: 'SAFE',
  },
  ...overrides,
});

const makeCreatedPassDto = (overrides: Partial<ChildGatePassCreatedDto> = {}): ChildGatePassCreatedDto => ({
  ...makeActivePassDto(overrides),
  bearerToken: 'secret-raw-bearer-token-256bit-never-persist',
  qrPayload: 'AARIZO_CHILD_PASS:v1:secret-raw-bearer-token-256bit-never-persist',
  ...overrides,
});

const exitLogAlpha: ChildExitLogDto = {
  id: 'log-alpha-1',
  societyId: 'soc-alpha',
  childId: 'chd-alpha-1',
  passId: 'pass-alpha-1',
  pickupPersonId: 'pkp-alpha-1',
  childName: 'Aarav Sharma',
  flatNumber: 'A-402',
  pickupPersonName: 'Sunita Devi',
  pickupPersonPhone: '+919811112222',
  gateId: 'MAIN_GATE',
  guardId: 'usr-guard-1',
  guardName: 'Ramesh',
  outcome: 'ALLOWED',
  verificationChannel: 'ONLINE_QR_TOKEN',
  denialReason: null,
  notes: null,
  timestamp: CREATED_ISO,
};

describe('ISSUE-06 Phase B.2.3 (Phase 4.4): Resident Gate Pass Lifecycle Controller', () => {
  let mockLS: MockStorage;
  let mockSS: MockStorage;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    hookRuntime.reset();
    mockLS = new MockStorage();
    mockSS = new MockStorage();
    mockFetch = jest.fn();

    Object.defineProperty(globalThis, 'localStorage', { value: mockLS, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'sessionStorage', { value: mockSS, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: mockLS,
        sessionStorage: mockSS,
        dispatchEvent: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'fetch', { value: mockFetch, configurable: true, writable: true });

    childSafetyService.clearInMemoryState();
    saveAuthSession(residentAlpha, 'jwt-alpha-p44', 'password');
    mockLS.setItemCalls = [];
    mockSS.setItemCalls = [];
  });

  afterEach(() => {
    hookRuntime.reset();
    clearAuthSession();
    childSafetyService.clearInMemoryState();
    jest.restoreAllMocks();
  });

  const mountController = (
    user: UserProfile | null,
    child: ChildProfileDto | null,
    nonce = 0,
    onMutated?: (childId: string) => void | Promise<void>
  ): ResidentGatePassesController =>
    hookRuntime.render(() => useResidentGatePasses(user, child, nonce, onMutated));

  test('loads passes & eligible pickups per child, filters mismatched child passes, supports retry & exit logs, with zero storage writes', async () => {
    const passForChild1 = makeActivePassDto();
    const foreignChildPass = makeActivePassDto({ id: 'pass-other-child', childId: 'chd-alpha-2', passCode: 'CGP-9999' });

    mockFetch
      .mockResolvedValueOnce(mockJsonResponse(200, [passForChild1, foreignChildPass])) // GET /passes?childId=chd-alpha-1
      .mockResolvedValueOnce(mockJsonResponse(200, [activePickupAlpha, expiredPickupAlpha])); // GET /chd-alpha-1/pickups

    let ctrl = mountController(residentAlpha, childEscortRequired);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();

    expect(ctrl.isLoadingPasses).toBe(false);
    expect(ctrl.loadError).toBeNull();
    // Only passes matching selected child are retained
    expect(ctrl.passes).toHaveLength(1);
    expect(ctrl.passes[0].id).toBe('pass-alpha-1');
    // Only effectively ACTIVE pickups are eligible for pass creation (expired pickup excluded!)
    expect(ctrl.eligiblePickups).toHaveLength(1);
    expect(ctrl.eligiblePickups[0].id).toBe('pkp-alpha-1');
    expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:5000/api/children/passes?childId=chd-alpha-1');

    // Network failure on manual refresh surfaces retryable error cleanly
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await ctrl.loadPasses();
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    expect(ctrl.loadError?.kind).toBe('NETWORK');
    expect(ctrl.loadError?.isRetryable).toBe(true);

    // Retry recovers cleanly
    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [passForChild1]));
    await ctrl.loadPasses();
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    expect(ctrl.loadError).toBeNull();
    expect(ctrl.passes).toHaveLength(1);

    // Expanding collapsible exit logs loads GET /api/children/exit-logs?childId=chd-alpha-1&limit=25
    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [exitLogAlpha]));
    ctrl.toggleExitLogs();
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    expect(ctrl.isExitLogsOpen).toBe(true);
    expect(ctrl.exitLogs).toHaveLength(1);
    expect(ctrl.exitLogs[0].outcome).toBe('ALLOWED');

    // Zero storage writes
    expect(mockLS.setItemCalls).toHaveLength(0);
    expect(mockSS.setItemCalls).toHaveLength(0);
  });

  test('creates gate pass via POST /passes, displays one-time QR strictly in ephemeral state (dropping bearerToken), prevents duplicate submit, and clears secret on dismiss', async () => {
    const onMutated = jest.fn();
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse(200, []))
      .mockResolvedValueOnce(mockJsonResponse(200, [activePickupAlpha]));

    let ctrl = mountController(residentAlpha, childEscortRequired, 0, onMutated);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();

    ctrl.openCreateModal();
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    expect(ctrl.modalMode).toBe('CREATE');
    expect(ctrl.createForm.pickupPersonId).toBe('pkp-alpha-1');

    const validUntilIso = futureIsoFromNow(4);
    ctrl.setCreateFormField('validUntil', validUntilIso);
    ctrl.setCreateFormField('maxUses', '2');
    ctrl.setCreateFormField('notes', 'Afternoon karate class');
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();

    const createdDto = makeCreatedPassDto({ validUntil: validUntilIso, maxUses: 2 });
    const sanitizedListDto = makeActivePassDto({ validUntil: validUntilIso, maxUses: 2 });
    const defCreate = createDeferred<Response>();

    mockFetch
      .mockReturnValueOnce(defCreate.promise) // POST /api/children/passes
      .mockResolvedValueOnce(mockJsonResponse(200, [sanitizedListDto])); // authoritative GET /passes refresh

    const p1 = ctrl.submitCreatePass();
    const p2 = ctrl.submitCreatePass(); // Duplicate click blocked synchronously!
    expect(await p2).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(3); // initial GET passes + GET pickups + strictly 1 POST

    const postCall = mockFetch.mock.calls[2];
    expect(postCall[0]).toBe('http://localhost:5000/api/children/passes');
    expect(postCall[1].method).toBe('POST');
    const postBody = JSON.parse(postCall[1].body);
    expect(postBody.childId).toBe('chd-alpha-1');
    expect(postBody.pickupPersonId).toBe('pkp-alpha-1');
    expect(postBody.maxUses).toBe(2);
    expect(postBody.notes).toBe('Afternoon karate class');
    expect(postBody.societyId).toBeUndefined();
    expect(postBody.residentId).toBeUndefined();

    defCreate.resolve(mockJsonResponse(201, createdDto));
    expect(await p1).toBe(true);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();

    // One-time QR modal opens with qrPayload, NEVER stores bearerToken, NEVER leaks secrets into passes list or storage
    expect(ctrl.modalMode).toBe('ONE_TIME_QR');
    expect(ctrl.oneTimeCreatedPass?.passCode).toBe('CGP-7741');
    expect(ctrl.oneTimeCreatedPass?.qrPayload).toBe(createdDto.qrPayload);
    expect((ctrl.oneTimeCreatedPass as any).bearerToken).toBeUndefined();
    expect((ctrl.oneTimeCreatedPass as any).tokenHash).toBeUndefined();

    expect(ctrl.passes).toHaveLength(1);
    const listJson = JSON.stringify(ctrl.passes);
    expect(listJson).not.toContain('secret-raw-bearer-token');
    expect(listJson).not.toContain('qrPayload');
    expect(listJson).not.toContain('bearerToken');
    expect(listJson).not.toContain('tokenHash');
    expect(mockLS.setItemCalls).toHaveLength(0);
    expect(mockSS.setItemCalls).toHaveLength(0);
    expect(onMutated).toHaveBeenCalledWith('chd-alpha-1');

    // Dismissing one-time QR modal immediately purges qrPayload from state
    ctrl.dismissOneTimeQrModal();
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    expect(ctrl.modalMode).toBeNull();
    expect(ctrl.oneTimeCreatedPass).toBeNull();
  });

  test('enforces child eligibility & exit policy, allows SOLO_ALLOWED without escort, rejects invalid windows/dates, and surfaces 409/422/429/403 errors', async () => {
    // 1. MISSING and ARCHIVED children block openCreateModal with 0 POST calls
    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [])).mockResolvedValueOnce(mockJsonResponse(200, []));
    let ctrl = mountController(residentAlpha, childMissing);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    ctrl.openCreateModal();
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    expect(ctrl.modalMode).toBeNull();
    expect(ctrl.actionError?.code).toBe('CHILD_MISSING_ALERT_ACTIVE');

    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [])).mockResolvedValueOnce(mockJsonResponse(200, []));
    ctrl = mountController(residentAlpha, childArchived);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    ctrl.openCreateModal();
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    expect(ctrl.modalMode).toBeNull();
    expect(ctrl.actionError?.code).toBe('CHILD_ARCHIVED');

    // 2. SOLO_ALLOWED child can issue pass without pickupPersonId, rejects >7d / impossible dates / maxUses > 10 client-side
    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [])).mockResolvedValueOnce(mockJsonResponse(200, []));
    ctrl = mountController(residentAlpha, childSoloAllowed);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();

    ctrl.openCreateModal();
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    expect(ctrl.modalMode).toBe('CREATE');
    expect(ctrl.createForm.pickupPersonId).toBe('');

    const callsBeforeValidation = mockFetch.mock.calls.length;
    ctrl.setCreateFormField('validUntil', '2027-02-30T12:00'); // Impossible calendar date!
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    expect(await ctrl.submitCreatePass()).toBe(false);
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    expect(ctrl.formError).toContain('valid future timestamp');

    ctrl.setCreateFormField('validUntil', futureIsoFromNow(24 * 10)); // 10 days > 7-day limit!
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    expect(await ctrl.submitCreatePass()).toBe(false);
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    expect(ctrl.formError).toContain('7 days');

    ctrl.setCreateFormField('validUntil', futureIsoFromNow(4));
    ctrl.setCreateFormField('maxUses', '11'); // > 10!
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    expect(await ctrl.submitCreatePass()).toBe(false);
    expect(mockFetch.mock.calls.length).toBe(callsBeforeValidation);

    // 3. Backend 409 CHILD_MISSING_ALERT_ACTIVE, 422 PICKUP_AUTHORIZATION_EXPIRED, 429 RATE_LIMIT_EXCEEDED, 403 FORBIDDEN
    ctrl.setCreateFormField('maxUses', '1');
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();

    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(409, { error: 'Cannot issue a gate pass while a missing-child alert is active.', code: 'CHILD_MISSING_ALERT_ACTIVE' })
    );
    expect(await ctrl.submitCreatePass()).toBe(false);
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    expect(ctrl.modalMode).toBe('CREATE');
    expect(ctrl.oneTimeCreatedPass).toBeNull();
    expect(ctrl.actionError?.code).toBe('CHILD_MISSING_ALERT_ACTIVE');

    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(422, { error: 'Selected pickup authorization has expired.', code: 'PICKUP_AUTHORIZATION_EXPIRED' })
    );
    expect(await ctrl.submitCreatePass()).toBe(false);
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    expect(ctrl.actionError?.code).toBe('PICKUP_AUTHORIZATION_EXPIRED');

    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(
        429,
        { error: 'Too many gate pass requests.', code: 'RATE_LIMIT_EXCEEDED' },
        { 'retry-after': '45' }
      )
    );
    expect(await ctrl.submitCreatePass()).toBe(false);
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    expect(ctrl.actionError?.kind).toBe('RATE_LIMITED');
    expect(ctrl.actionError?.retryAfterSeconds).toBe(45);

    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(403, { error: 'Forbidden: Not guardian owner.', code: 'UNAUTHORIZED_CHILD_ACCESS' })
    );
    expect(await ctrl.submitCreatePass()).toBe(false);
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    expect(ctrl.actionError?.kind).toBe('FORBIDDEN');
  });

  test('computes effective EXPIRED/USED/not-yet-valid display, requires confirmed revocation, supports cancel, prevents duplicate revoke, and handles revocation failures', async () => {
    const activePass = makeActivePassDto();
    const scheduledFuturePass = makeActivePassDto({
      id: 'pass-future',
      passCode: 'CGP-8801',
      validFrom: futureIsoFromNow(2),
      validUntil: futureIsoFromNow(6),
    });
    const timeExpiredPass = makeActivePassDto({
      id: 'pass-time-exp',
      passCode: 'CGP-8802',
      status: 'ACTIVE', // Persisted ACTIVE, but validUntil is past!
      validUntil: pastIsoFromNow(1),
    });
    const usedPass = makeActivePassDto({ id: 'pass-used', status: 'USED', currentUses: 1, maxUses: 1 });
    const revokedPass = makeActivePassDto({ id: 'pass-rev', status: 'REVOKED', revocationReason: 'Cancelled' });
    const archivedPass = makeActivePassDto({ id: 'pass-arch', status: 'ARCHIVED', archivedAt: CREATED_ISO });

    // Effective display checks without mutating persisted DTO status
    expect(formatGatePassDisplay(timeExpiredPass).effectiveStatus).toBe('EXPIRED');
    expect(formatGatePassDisplay(timeExpiredPass).canRevoke).toBe(false);
    expect(timeExpiredPass.status).toBe('ACTIVE');
    expect(formatGatePassDisplay(scheduledFuturePass).effectiveStatus).toBe('ACTIVE');
    expect(formatGatePassDisplay(scheduledFuturePass).isNotYetValid).toBe(true);
    expect(formatGatePassDisplay(scheduledFuturePass).canRevoke).toBe(true);
    expect(formatGatePassDisplay(usedPass).canRevoke).toBe(false);
    expect(formatGatePassDisplay(revokedPass).canRevoke).toBe(false);
    expect(formatGatePassDisplay(archivedPass).canRevoke).toBe(false);

    mockFetch
      .mockResolvedValueOnce(mockJsonResponse(200, [activePass, timeExpiredPass, usedPass, revokedPass, archivedPass]))
      .mockResolvedValueOnce(mockJsonResponse(200, [activePickupAlpha]));

    let ctrl = mountController(residentAlpha, childEscortRequired);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();

    // Attempting to open revoke modal on time-expired, used, revoked, or archived passes fails closed with 0 calls
    for (const nonRevocable of [timeExpiredPass, usedPass, revokedPass, archivedPass]) {
      ctrl.openRevokeModal(nonRevocable);
      ctrl = hookRuntime.rerender<ResidentGatePassesController>();
      expect(ctrl.modalMode).toBeNull();
      expect(ctrl.actionError?.code).toBe('PASS_NOT_REVOCABLE');
    }
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Opening & cancelling revoke confirmation on ACTIVE pass makes 0 network calls
    ctrl.openRevokeModal(activePass);
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    expect(ctrl.modalMode).toBe('REVOKE');
    ctrl.closeModal();
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    expect(ctrl.modalMode).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Confirmed revoke with reason + duplicate-submit lock + authoritative refresh
    ctrl.openRevokeModal(activePass);
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    ctrl.setRevokeReason('Plans changed');
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();

    const revokedResult = makeActivePassDto({ status: 'REVOKED', revocationReason: 'Plans changed' });
    const defRevoke = createDeferred<Response>();
    mockFetch
      .mockReturnValueOnce(defRevoke.promise)
      .mockResolvedValueOnce(mockJsonResponse(200, [revokedResult]));

    const r1 = ctrl.confirmRevokePass();
    const r2 = ctrl.confirmRevokePass(); // Duplicate click blocked!
    expect(await r2).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls[2][0]).toBe('http://localhost:5000/api/children/passes/pass-alpha-1/revoke');
    expect(mockFetch.mock.calls[2][1].method).toBe('POST');
    expect(JSON.parse(mockFetch.mock.calls[2][1].body)).toEqual({ reason: 'Plans changed' });

    defRevoke.resolve(mockJsonResponse(200, revokedResult));
    expect(await r1).toBe(true);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    expect(ctrl.modalMode).toBeNull();
    expect(ctrl.successMessage).toContain('CGP-7741');
    expect(ctrl.passes[0].status).toBe('REVOKED');

    // Failed revocation (409 PASS_NOT_REVOCABLE) keeps modal open with visible error and zero fake success
    ctrl.openRevokeModal(activePass);
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(409, { error: 'Gate pass was modified or consumed concurrently.', code: 'PASS_NOT_REVOCABLE' })
    );
    expect(await ctrl.confirmRevokePass()).toBe(false);
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    expect(ctrl.modalMode).toBe('REVOKE');
    expect(ctrl.actionError?.code).toBe('PASS_NOT_REVOCABLE');
  });

  test('prevents cross-session & cross-child leakage of one-time QR/passes, keeps User B lock armed, clears state on 401/logout, refreshes on pickupsRefreshNonce, and isolates callback failure', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const throwingCallback = jest.fn().mockRejectedValue(new Error('Parent count refresh offline'));

    // Mount as User A -> initial loads finish
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse(200, [makeActivePassDto()]))
      .mockResolvedValueOnce(mockJsonResponse(200, [activePickupAlpha]));

    let ctrl = mountController(residentAlpha, childEscortRequired, 0, throwingCallback);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();

    // 1. User A starts creating a pass (held in flight) -> switch to User B BEFORE response resolves!
    ctrl.openCreateModal();
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    ctrl.setCreateFormField('validUntil', futureIsoFromNow(3));
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();

    const defAlphaCreate = createDeferred<Response>();
    const defBetaPasses = createDeferred<Response>();
    const defBetaPickups = createDeferred<Response>();
    mockFetch
      .mockReturnValueOnce(defAlphaCreate.promise)
      .mockReturnValueOnce(defBetaPasses.promise)
      .mockReturnValueOnce(defBetaPickups.promise);

    const alphaCreateP = ctrl.submitCreatePass();

    // Switch session to User B mid-flight
    clearAuthSession();
    saveAuthSession(residentBeta, 'jwt-beta-p44', 'password');
    ctrl = mountController(residentBeta, childBeta, 0, throwingCallback);
    expect(ctrl.passes).toEqual([]);
    expect(ctrl.oneTimeCreatedPass).toBeNull();

    defBetaPasses.resolve(mockJsonResponse(200, []));
    defBetaPickups.resolve(mockJsonResponse(200, [activePickupBeta]));
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();

    // User B starts their own pass creation (held in flight)
    ctrl.openCreateModal();
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    ctrl.setCreateFormField('validUntil', futureIsoFromNow(3));
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();

    const defBetaCreate = createDeferred<Response>();
    const betaCreated = makeCreatedPassDto({
      id: 'pass-beta-1',
      societyId: 'soc-beta',
      childId: 'chd-beta-1',
      pickupPersonId: 'pkp-beta-1',
      passCode: 'CGP-BETA',
      pickupPersonName: 'Suresh Menon',
      qrPayload: 'AARIZO_CHILD_PASS:v1:beta-one-time-qr',
      child: { id: 'chd-beta-1', fullName: 'Diya Nair', flatNumber: 'B-201', status: 'SAFE' },
    });
    mockFetch
      .mockReturnValueOnce(defBetaCreate.promise)
      .mockResolvedValueOnce(mockJsonResponse(200, [{ ...makeActivePassDto({ id: 'pass-beta-1', societyId: 'soc-beta', childId: 'chd-beta-1', passCode: 'CGP-BETA', pickupPersonName: 'Suresh Menon' }) }]));

    const betaP1 = ctrl.submitCreatePass();

    // Delayed User A creation resolves -> MUST BE DISCARDED (no Alpha QR shown to Beta, Beta lock STILL armed!)
    defAlphaCreate.resolve(mockJsonResponse(201, makeCreatedPassDto()));
    expect(await alphaCreateP).toBe(false);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    expect(ctrl.oneTimeCreatedPass).toBeNull();

    const betaP2 = ctrl.submitCreatePass();
    expect(await betaP2).toBe(false);

    // User B creation finishes -> throwing callback isolated cleanly, returns true, Beta one-time QR shown
    defBetaCreate.resolve(mockJsonResponse(201, betaCreated));
    expect(await betaP1).toBe(true);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    expect(ctrl.modalMode).toBe('ONE_TIME_QR');
    expect(ctrl.oneTimeCreatedPass?.passCode).toBe('CGP-BETA');
    expect(ctrl.actionError?.code).toBe('POST_MUTATION_REFRESH_FAILED');
    // Callback error log MUST NOT leak qrPayload or bearerToken
    expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain('beta-one-time-qr');
    expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain('secret-raw-bearer');

    // 2. pickupsRefreshNonce increment triggers authoritative refresh of eligible pickups & passes
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse(200, [])) // pickups refreshed after pickup revoke
      .mockResolvedValueOnce(mockJsonResponse(200, [makeActivePassDto({ id: 'pass-beta-1', childId: 'chd-beta-1', status: 'REVOKED' })])); // cascade-revoked pass!
    ctrl = mountController(residentBeta, childBeta, 1, throwingCallback);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    expect(ctrl.eligiblePickups).toEqual([]);
    expect(ctrl.passes[0].status).toBe('REVOKED');

    // 3. HTTP 401 on refresh eagerly clears passes, pickups, and one-time QR
    mockFetch.mockResolvedValueOnce(mockJsonResponse(401, { error: 'Token expired', code: 'AUTH_TOKEN_INVALID' }));
    await ctrl.loadPasses();
    ctrl = hookRuntime.rerender<ResidentGatePassesController>();
    expect(ctrl.loadError?.kind).toBe('UNAUTHORIZED');
    expect(ctrl.passes).toEqual([]);
    expect(ctrl.oneTimeCreatedPass).toBeNull();

    // 4. Logout clears all state immediately
    clearAuthSession();
    ctrl = mountController(null, null, 1, throwingCallback);
    expect(ctrl.passes).toEqual([]);
    expect(ctrl.eligiblePickups).toEqual([]);
    expect(ctrl.oneTimeCreatedPass).toBeNull();

    consoleErrorSpy.mockRestore();
  });
});

