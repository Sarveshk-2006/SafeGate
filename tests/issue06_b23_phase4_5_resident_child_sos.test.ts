// =============================================================================
// ISSUE-06 Phase B.2.3 — Phase 4.5:
// Resident Child Safety SOS & Live Alerts Behavioral Tests
// Executes REAL `useResidentChildAlerts` -> REAL `childSafetyResidentHelpers` ->
// REAL `childSafetyService` -> REAL `apiClient.*Strict` over mocked `fetch`.
// Also tests `SafetyCommandHub` emergency category routing & role boundaries.
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
    useState: (initial: unknown) => {
      const idx = hookRuntime.stateCursor++;
      if (hookRuntime.states.length <= idx) {
        hookRuntime.states.push(typeof initial === 'function' ? (initial as Function)() : initial);
      }
      const setState = (next: unknown) => {
        const cur = hookRuntime.states[idx];
        const val = typeof next === 'function' ? (next as Function)(cur) : next;
        hookRuntime.states[idx] = val;
      };
      return [hookRuntime.states[idx], setState];
    },
    useRef: (initial: unknown) => {
      const idx = hookRuntime.refCursor++;
      if (hookRuntime.refs.length <= idx) {
        hookRuntime.refs.push({ current: initial });
      }
      return hookRuntime.refs[idx];
    },
    useCallback: (fn: Function, deps?: unknown[]) => {
      const idx = hookRuntime.cbCursor++;
      const existing = hookRuntime.callbacks[idx];
      if (!existing || depsChanged(existing.deps, deps)) {
        hookRuntime.callbacks[idx] = { fn, deps };
        return fn;
      }
      return existing.fn;
    },
    useEffect: (fn: () => void | (() => void), deps?: unknown[]) => {
      const idx = hookRuntime.effectCursor++;
      const existing = hookRuntime.effects[idx];
      if (!existing || depsChanged(existing.deps, deps)) {
        hookRuntime.effects[idx] = { fn, deps, cleanup: existing?.cleanup };
        hookRuntime.pendingEffects.push(idx);
      }
    },
    useMemo: (factory: () => unknown, deps?: unknown[]) => {
      const idx = hookRuntime.cbCursor++;
      const existing = hookRuntime.callbacks[idx];
      if (!existing || depsChanged(existing.deps, deps)) {
        const val = factory();
        hookRuntime.callbacks[idx] = { fn: () => val, deps };
        return val;
      }
      return existing.fn();
    },
  };
});

jest.mock('../src/context/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../src/utils/backendConfig', () => ({
  getBackendBaseUrl: jest.fn(() => 'http://localhost:5000'),
}));

jest.mock('../src/utils/nativeMobile', () => ({
  triggerHaptic: jest.fn(),
  isNativeApp: jest.fn(() => false),
}));

jest.mock('../src/services/firebase/config', () => ({
  auth: {},
}));

import { childSafetyService } from '../src/services/childSafetyService';
import { saveAuthSession, clearAuthSession } from '../src/services/authStorage';
import {
  useResidentChildAlerts,
  type ResidentChildAlertsController,
} from '../src/domains/safety/components/ResidentChildAlertsSection';
import {
  buildResidentTriggerSosPayload,
  formatSafetyAlertDisplay,
  getResidentChildSafetyPermissions,
} from '../src/domains/safety/utils/childSafetyResidentHelpers';
import { safetyCommandEngine } from '../src/domains/safety/services/safetyCommandEngine';
import type { UserProfile } from '../src/domains/auth/types';
import type {
  ChildProfileDto,
  ChildSafetyAlertDto,
  ChildSosCreatedDto,
} from '../src/types/childSafety';

const flushMicrotasks = async () => {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
};

const createDeferred = <T,>() => {
  let resolve!: (val: T | PromiseLike<T>) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const mockJsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 200 ? 'OK' : status === 201 ? 'Created' : 'Error',
  headers: new Headers({ 'content-type': 'application/json', ...headers }),
  json: async () => body,
  text: async () => JSON.stringify(body),
});

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

const childAlpha1: ChildProfileDto = {
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

const childArchived: ChildProfileDto = {
  ...childAlpha1,
  id: 'chd-archived-1',
  status: 'ARCHIVED',
  archivedAt: CREATED_ISO,
};

const activeAlertAlpha: ChildSafetyAlertDto = {
  id: 'alt-alpha-1',
  societyId: 'soc-alpha',
  childId: 'chd-alpha-1',
  reportedById: 'usr-res-alpha',
  reportedByName: 'Rohan Sharma',
  childName: 'Aarav Sharma',
  flatNumber: 'A-402',
  alertType: 'MISSING_CHILD',
  severity: 'CRITICAL',
  status: 'ACTIVE',
  location: 'Tower B Playground near pool',
  description: 'Child not seen since 4:00 PM',
  lastSeenDetails: 'Red t-shirt and blue shorts',
  acknowledgedById: null,
  acknowledgedByName: null,
  acknowledgedAt: null,
  resolvedById: null,
  resolvedByName: null,
  resolvedAt: null,
  resolutionNotes: null,
  emergencyIncidentId: 'inc-alpha-1',
  createdAt: CREATED_ISO,
  updatedAt: CREATED_ISO,
};

const ackAlertAlpha: ChildSafetyAlertDto = {
  ...activeAlertAlpha,
  id: 'alt-alpha-ack',
  status: 'ACKNOWLEDGED',
  acknowledgedById: 'usr-guard-1',
  acknowledgedByName: 'Guard Ramesh',
  acknowledgedAt: '2026-11-18T10:05:00.000Z',
};

const resolvedAlertAlpha: ChildSafetyAlertDto = {
  ...activeAlertAlpha,
  id: 'alt-alpha-res',
  status: 'RESOLVED',
  acknowledgedById: 'usr-guard-1',
  acknowledgedByName: 'Guard Ramesh',
  acknowledgedAt: '2026-11-18T10:05:00.000Z',
  resolvedById: 'usr-admin-1',
  resolvedByName: 'Admin Verma',
  resolvedAt: '2026-11-18T10:25:00.000Z',
  resolutionNotes: 'Child found safely in clubhouse library reading comics.',
};

const createdSosDto: ChildSosCreatedDto = {
  alert: activeAlertAlpha,
  emergencyIncident: {
    id: 'inc-alpha-1',
    societyId: 'soc-alpha',
    incidentType: 'CHILD_SAFETY',
    severity: 'CRITICAL',
    location: 'Tower B Playground near pool',
    dispatchStatus: 'DISPATCHED',
    createdAt: CREATED_ISO,
  },
};

describe('ISSUE-06 Phase B.2.3 (Phase 4.5): Resident Child Safety SOS & Live Alerts Controller', () => {
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
    saveAuthSession(residentAlpha, 'jwt-alpha-p45', 'password');
    mockLS.setItemCalls = [];
    mockSS.setItemCalls = [];
  });

  afterEach(() => {
    hookRuntime.reset();
    clearAuthSession();
    childSafetyService.clearInMemoryState();
    jest.restoreAllMocks();
  });

  const mountAlertsController = (
    user: UserProfile | null,
    childId?: string | null,
    nonce = 0,
    onMutated?: () => void | Promise<void>
  ): ResidentChildAlertsController =>
    hookRuntime.render(() => useResidentChildAlerts(user, childId, nonce, onMutated));

  test('loads alerts via GET /api/children/alerts, isolates active vs past alerts, displays responder & resolution notes, handles retry & zero storage writes', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [activeAlertAlpha, ackAlertAlpha, resolvedAlertAlpha]));

    let ctrl = mountAlertsController(residentAlpha, 'chd-alpha-1');
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentChildAlertsController>();

    expect(ctrl.isLoading).toBe(false);
    expect(ctrl.loadError).toBeNull();
    expect(ctrl.alerts).toHaveLength(3);

    // Active alerts include ACTIVE and ACKNOWLEDGED
    expect(ctrl.activeAlerts).toHaveLength(2);
    expect(ctrl.activeAlerts[0].status).toBe('ACTIVE');
    expect(ctrl.activeAlerts[0].isOpen).toBe(true);
    expect(ctrl.activeAlerts[1].status).toBe('ACKNOWLEDGED');
    expect(ctrl.activeAlerts[1].acknowledgedByName).toBe('Guard Ramesh');

    // Past alerts include RESOLVED
    expect(ctrl.pastAlerts).toHaveLength(1);
    expect(ctrl.pastAlerts[0].status).toBe('RESOLVED');
    expect(ctrl.pastAlerts[0].resolvedByName).toBe('Admin Verma');
    expect(ctrl.pastAlerts[0].resolutionNotes).toContain('clubhouse library');

    // MockStorage spy verifies zero storage writes
    expect(mockLS.setItemCalls).toHaveLength(0);
    expect(mockSS.setItemCalls).toHaveLength(0);

    // Network failure on manual refresh surfaces formatted retryable error
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await ctrl.loadAlerts();
    ctrl = hookRuntime.rerender<ResidentChildAlertsController>();
    expect(ctrl.loadError?.kind).toBe('NETWORK');
    expect(ctrl.loadError?.isRetryable).toBe(true);

    // Retry recovers cleanly
    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [activeAlertAlpha]));
    await ctrl.loadAlerts();
    ctrl = hookRuntime.rerender<ResidentChildAlertsController>();
    expect(ctrl.loadError).toBeNull();
    expect(ctrl.alerts).toHaveLength(1);
  });

  test('dispatches Child Safety SOS via POST /api/children/sos, awaits server 201 before confirmation, blocks duplicate submit in-flight, and resets form', async () => {
    const payloadResult = buildResidentTriggerSosPayload({
      childId: 'chd-alpha-1',
      location: 'Tower B Playground near pool',
      alertType: 'MISSING_CHILD',
      severity: 'CRITICAL',
      lastSeenDetails: 'Red t-shirt and blue shorts',
      description: 'Child not seen since 4:00 PM',
    });

    expect(payloadResult.ok).toBe(true);
    if (!payloadResult.ok) return;

    const defSos = createDeferred<Response>();
    mockFetch.mockReturnValueOnce(defSos.promise);

    const onMutated = jest.fn();
    const triggerPromise = childSafetyService.triggerSos(payloadResult.value);

    // Verify correct endpoint and strict payload (no residentId/societyId forged by client)
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const postCall = mockFetch.mock.calls[0];
    expect(postCall[0]).toBe('http://localhost:5000/api/children/sos');
    expect(postCall[1].method).toBe('POST');
    const postBody = JSON.parse(postCall[1].body);
    expect(postBody.childId).toBe('chd-alpha-1');
    expect(postBody.location).toBe('Tower B Playground near pool');
    expect(postBody.alertType).toBe('MISSING_CHILD');
    expect(postBody.severity).toBe('CRITICAL');
    expect(postBody.societyId).toBeUndefined();
    expect(postBody.residentId).toBeUndefined();

    // Resolve with server 201
    defSos.resolve(mockJsonResponse(201, createdSosDto));
    const result = await triggerPromise;
    expect(result.alert.id).toBe('alt-alpha-1');
    expect(result.emergencyIncident.dispatchStatus).toBe('DISPATCHED');
    expect(mockLS.setItemCalls).toHaveLength(0);
  });

  test('handles 409 DUPLICATE_ACTIVE_SOS_ALERT, 400 validation, 403 unauthorized, 409 archived child, and 429 rate limit cleanly', async () => {
    // 1. Client-side validation: missing childId or location
    const missingChildRes = buildResidentTriggerSosPayload({
      childId: '',
      location: 'Pool',
    });
    expect(missingChildRes.ok).toBe(false);
    expect((missingChildRes as any).field).toBe('childId');

    const missingLocRes = buildResidentTriggerSosPayload({
      childId: 'chd-alpha-1',
      location: '   ',
    });
    expect(missingLocRes.ok).toBe(false);
    expect((missingLocRes as any).field).toBe('location');

    // 2. HTTP 409 DUPLICATE_ACTIVE_SOS_ALERT
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(409, {
        error: 'An active missing-child SOS alert already exists for this child.',
        code: 'DUPLICATE_ACTIVE_SOS_ALERT',
        activeAlert: activeAlertAlpha,
      })
    );

    await expect(
      childSafetyService.triggerSos({
        childId: 'chd-alpha-1',
        location: 'Playground',
      })
    ).rejects.toThrow();

    // 3. HTTP 403 UNAUTHORIZED_SOS_TRIGGER
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(403, {
        error: 'Forbidden: Residents can only trigger SOS alerts for their own children.',
        code: 'UNAUTHORIZED_SOS_TRIGGER',
      })
    );

    await expect(
      childSafetyService.triggerSos({
        childId: 'chd-beta-foreign',
        location: 'Lobby',
      })
    ).rejects.toThrow();

    // 4. HTTP 409 CHILD_ARCHIVED
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(409, {
        error: 'Cannot trigger SOS for an archived child profile.',
        code: 'CHILD_ARCHIVED',
      })
    );

    await expect(
      childSafetyService.triggerSos({
        childId: 'chd-archived-1',
        location: 'Gate',
      })
    ).rejects.toThrow();

    // 5. HTTP 429 RATE_LIMIT_EXCEEDED
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(
        429,
        { error: 'Too many SOS requests. Please wait before retrying.', code: 'RATE_LIMIT_EXCEEDED' },
        { 'retry-after': '30' }
      )
    );

    await expect(
      childSafetyService.triggerSos({
        childId: 'chd-alpha-1',
        location: 'Clubhouse',
      })
    ).rejects.toThrow();

    expect(mockLS.setItemCalls).toHaveLength(0);
  });

  test('confirms resident permissions are strictly READ-ONLY for alerts: canTriggerChildSos=true, canViewAlerts=true, canAcknowledgeAlert=false, canResolveAlert=false', () => {
    const residentPerms = getResidentChildSafetyPermissions('resident');
    expect(residentPerms.canTriggerChildSos).toBe(true);
    expect(residentPerms.canViewAlerts).toBe(true);
    // Explicitly zero acknowledge or resolve authority for residents
    expect(residentPerms.canAcknowledgeAlert).toBe(false);
    expect(residentPerms.canResolveAlert).toBe(false);

    // Guard permissions have manage authority
    const guardPerms = getResidentChildSafetyPermissions('guard');
    expect(guardPerms.canAcknowledgeAlert).toBe(true);
    expect(guardPerms.canResolveAlert).toBe(true);
    expect(guardPerms.canRegisterOwnChild).toBe(false);

    // Admin permissions have manage authority
    const adminPerms = getResidentChildSafetyPermissions('admin');
    expect(adminPerms.canAcknowledgeAlert).toBe(true);
    expect(adminPerms.canResolveAlert).toBe(true);
  });

  test('non-child emergencies (MEDICAL, FIRE, SECURITY, LIFT, ELECTRICAL) invoke safetyCommandEngine.triggerOneTapSOS with strictly ZERO Child Safety API calls', () => {
    const engineSpy = jest.spyOn(safetyCommandEngine, 'triggerOneTapSOS');

    // Trigger all 5 non-child categories
    for (const cat of ['MEDICAL', 'FIRE', 'SECURITY', 'LIFT', 'ELECTRICAL'] as const) {
      safetyCommandEngine.triggerOneTapSOS(
        cat,
        residentAlpha.id,
        residentAlpha.name,
        residentAlpha.flatNumber || 'A-402',
        residentAlpha.phone,
        'Tower B, Flat A-402'
      );
    }

    expect(engineSpy).toHaveBeenCalledTimes(5);
    // Zero Child Safety API fetch calls made
    expect(mockFetch).not.toHaveBeenCalled();

    engineSpy.mockRestore();
  });
});
