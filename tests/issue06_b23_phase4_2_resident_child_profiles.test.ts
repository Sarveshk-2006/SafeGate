// =============================================================================
// ISSUE-06 Phase B.2.3 — Phase 4.2:
// Resident Child Registration, Listing, Editing & Archival Behavioral Tests
// Executes REAL `useResidentChildProfiles` -> REAL `childSafetyResidentHelpers` ->
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

jest.mock('../src/context/AuthContext', () => ({
  useAuth: jest.fn(() => ({ currentUser: null })),
}));

import {
  useResidentChildProfiles,
  type ResidentChildProfilesController,
} from '../src/domains/safety/components/ResidentChildSafetyPanel';
import { childSafetyService } from '../src/services/childSafetyService';
import { saveAuthSession, clearAuthSession } from '../src/services/authStorage';
import type { UserProfile } from '../src/domains/auth/types';
import type { ChildProfileDto } from '../src/types/childSafety';

const mockJsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}): Response => {
  const normalizedHeaders = new Map<string, string>();
  normalizedHeaders.set('content-type', 'application/json');
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

const flushMicrotasks = async (ticks = 6) => {
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

const nowIso = '2026-11-18T12:00:00.000Z';

const alphaChildDto: ChildProfileDto = {
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
  pickups: [],
};

const betaChildDto: ChildProfileDto = {
  ...alphaChildDto,
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

describe('ISSUE-06 Phase B.2.3 (Phase 4.2): Resident Child Profile Controller & Authoritative Flows', () => {
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
    saveAuthSession(residentAlpha, 'jwt-alpha-p42', 'password');
    mockLS.setItemCalls = [];
  });

  afterEach(() => {
    hookRuntime.reset();
    clearAuthSession();
    childSafetyService.clearInMemoryState();
    jest.restoreAllMocks();
  });

  const mountController = (user: UserProfile | null): ResidentChildProfilesController =>
    hookRuntime.render(() => useResidentChildProfiles(user));

  test('loads real backend children on mount, handles empty state, network error, and retry recovery with zero demo records or localStorage writes', async () => {
    // 1. Initial mount hits GET /api/children -> returns [] (empty state, zero hardcoded/demo records)
    const defInit = createDeferred<Response>();
    mockFetch.mockReturnValueOnce(defInit.promise);

    let ctrl = mountController(residentAlpha);
    expect(ctrl.isLoading).toBe(true);
    expect(ctrl.children).toEqual([]);

    defInit.resolve(mockJsonResponse(200, []));
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();

    expect(ctrl.isLoading).toBe(false);
    expect(ctrl.loadError).toBeNull();
    expect(ctrl.children).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:5000/api/children');

    // 2. Network error on refresh -> surfaces retryable error cleanly
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await ctrl.loadChildren();
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();
    expect(ctrl.loadError?.kind).toBe('NETWORK');
    expect(ctrl.loadError?.isRetryable).toBe(true);

    // 3. Retry succeeds with real backend child record
    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [alphaChildDto]));
    await ctrl.loadChildren();
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();
    expect(ctrl.loadError).toBeNull();
    expect(ctrl.children).toHaveLength(1);
    expect(ctrl.children[0].fullName).toBe('Aarav Sharma');

    // Zero Child Safety localStorage writes
    expect(mockLS.setItemCalls).toHaveLength(0);
  });

  test('registers child via POST /api/children omitting ownership/tenant fields, handles failure visibly, and prevents duplicate submissions', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, []));
    let ctrl = mountController(residentAlpha);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();

    ctrl.openCreateModal();
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();
    expect(ctrl.modalMode).toBe('CREATE');
    expect(ctrl.formState.guardianName).toBe('Rohan Sharma');
    expect(ctrl.formState.guardianPhone).toBe('+919876543210');

    // Fill child details
    ctrl.setFormField('fullName', 'Aarav Sharma');
    ctrl.setFormField('reportedAge', '8');
    ctrl.setFormField('gender', 'MALE');
    ctrl.setFormField('medicalNotes', 'Peanut allergy');
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();

    // Hold POST /api/children in flight to test duplicate-submit prevention
    const defCreate = createDeferred<Response>();
    mockFetch
      .mockReturnValueOnce(defCreate.promise) // POST /api/children
      .mockResolvedValueOnce(mockJsonResponse(200, [alphaChildDto])); // post-create GET /api/children refresh

    const p1 = ctrl.submitCreateChild();
    const p2 = ctrl.submitCreateChild(); // Duplicate click while in flight -> blocked!

    expect(await p2).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2); // 1 initial GET + 1 POST (NOT 2 POSTs!)

    // Inspect exact outgoing POST payload: MUST NOT contain residentId, flatId, flatNumber, guardianUserId, or societyId!
    const postCall = mockFetch.mock.calls[1];
    expect(postCall[0]).toBe('http://localhost:5000/api/children');
    expect(postCall[1].method).toBe('POST');
    const sentBody = JSON.parse(postCall[1].body);
    expect(sentBody).toEqual({
      fullName: 'Aarav Sharma',
      guardianName: 'Rohan Sharma',
      guardianPhone: '+919876543210',
      gender: 'MALE',
      exitPermissionMode: 'ESCORT_REQUIRED',
      allowedSoloExit: false,
      reportedAge: 8,
      medicalNotes: 'Peanut allergy',
    });
    expect(sentBody.residentId).toBeUndefined();
    expect(sentBody.flatId).toBeUndefined();
    expect(sentBody.flatNumber).toBeUndefined();
    expect(sentBody.guardianUserId).toBeUndefined();
    expect(sentBody.societyId).toBeUndefined();

    defCreate.resolve(mockJsonResponse(201, alphaChildDto));
    expect(await p1).toBe(true);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();

    expect(ctrl.modalMode).toBeNull();
    expect(ctrl.successMessage).toContain('Aarav Sharma');
    expect(ctrl.children).toHaveLength(1);

    // Registration failure (403 RESIDENT_OWNERSHIP_REQUIRED) -> no fake success, keeps modal open with error
    ctrl.openCreateModal();
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();
    ctrl.setFormField('fullName', 'Kavya Sharma');
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();

    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(403, {
        error: 'Forbidden: Active resident and flat membership in this society is required.',
        code: 'RESIDENT_OWNERSHIP_REQUIRED',
      })
    );
    expect(await ctrl.submitCreateChild()).toBe(false);
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();
    expect(ctrl.modalMode).toBe('CREATE');
    expect(ctrl.actionError?.kind).toBe('FORBIDDEN');
    expect(ctrl.actionError?.code).toBe('RESIDENT_OWNERSHIP_REQUIRED');
    expect(ctrl.formError).toContain('Active resident');
  });

  test('edits child by loading fresh GET /api/children/:id, submits PATCH without ownership fields, and handles 403/404 distinctly', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [alphaChildDto]));
    let ctrl = mountController(residentAlpha);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();

    // 1. Attempting to edit another resident's child -> 403 Access Denied
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(403, { error: 'Forbidden: Not guardian owner.', code: 'UNAUTHORIZED_CHILD_ACCESS' })
    );
    await ctrl.openEditModal('chd-other-resident');
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();
    expect(ctrl.modalMode).toBeNull();
    expect(ctrl.actionError?.kind).toBe('FORBIDDEN');
    expect(ctrl.actionError?.title).toBe('Access Denied');

    // 2. Attempting to edit missing/cross-society child -> 404 Record Not Found
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(404, { error: 'Child profile not found.', code: 'CHILD_NOT_FOUND' })
    );
    await ctrl.openEditModal('chd-missing');
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();
    expect(ctrl.modalMode).toBeNull();
    expect(ctrl.actionError?.kind).toBe('NOT_FOUND');
    expect(ctrl.actionError?.title).toBe('Record Not Found');

    // 3. Authorized edit: loads fresh GET /api/children/chd-alpha-1 -> PATCH -> refreshes list
    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, alphaChildDto));
    await ctrl.openEditModal('chd-alpha-1');
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();
    expect(ctrl.modalMode).toBe('EDIT');
    expect(ctrl.editingChild?.id).toBe('chd-alpha-1');

    ctrl.setFormField('medicalNotes', 'No known allergies');
    ctrl.setFormField('exitPermissionMode', 'SOLO_ALLOWED');
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();

    const updatedDto: ChildProfileDto = {
      ...alphaChildDto,
      medicalNotes: 'No known allergies',
      exitPermissionMode: 'SOLO_ALLOWED',
      allowedSoloExit: true,
    };
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse(200, updatedDto))
      .mockResolvedValueOnce(mockJsonResponse(200, [updatedDto]));

    expect(await ctrl.submitEditChild()).toBe(true);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();

    const patchCall = mockFetch.mock.calls[4];
    expect(patchCall[0]).toBe('http://localhost:5000/api/children/chd-alpha-1');
    expect(patchCall[1].method).toBe('PATCH');
    const patchBody = JSON.parse(patchCall[1].body);
    expect(patchBody.exitPermissionMode).toBe('SOLO_ALLOWED');
    expect(patchBody.allowedSoloExit).toBe(true);
    expect(patchBody.residentId).toBeUndefined();
    expect(patchBody.flatId).toBeUndefined();
    expect(patchBody.societyId).toBeUndefined();
    expect(patchBody.status).toBeUndefined();
    expect(patchBody.notes).toBeUndefined(); // F-P42-02: never implies unsupported notes editing

    expect(ctrl.modalMode).toBeNull();
    expect(ctrl.children[0].medicalNotes).toBe('No known allergies');
  });

  test('requires archive confirmation, supports cancel, calls POST /api/children/:id/archive, prevents duplicate archive, and handles 401/409 errors', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [alphaChildDto]));
    let ctrl = mountController(residentAlpha);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();

    // Opening archive modal and cancelling does NOT trigger any network call
    ctrl.openArchiveModal(alphaChildDto);
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();
    expect(ctrl.modalMode).toBe('ARCHIVE');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    ctrl.closeModal();
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();
    expect(ctrl.modalMode).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // 409 ALREADY_ARCHIVED keeps modal open with visible conflict error
    ctrl.openArchiveModal(alphaChildDto);
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(409, { error: 'Child profile is already archived.', code: 'ALREADY_ARCHIVED' })
    );
    expect(await ctrl.confirmArchiveChild()).toBe(false);
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();
    expect(ctrl.modalMode).toBe('ARCHIVE');
    expect(ctrl.actionError?.kind).toBe('CONFLICT');
    expect(ctrl.actionError?.code).toBe('ALREADY_ARCHIVED');

    // Confirm archive with duplicate-submit guard
    const defArchive = createDeferred<Response>();
    mockFetch
      .mockReturnValueOnce(defArchive.promise)
      .mockResolvedValueOnce(mockJsonResponse(200, []));

    const a1 = ctrl.confirmArchiveChild();
    const a2 = ctrl.confirmArchiveChild();
    expect(await a2).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls[2][0]).toBe('http://localhost:5000/api/children/chd-alpha-1/archive');
    expect(mockFetch.mock.calls[2][1].method).toBe('POST');

    defArchive.resolve(mockJsonResponse(200, { ...alphaChildDto, status: 'ARCHIVED', archivedAt: nowIso }));
    expect(await a1).toBe(true);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();

    expect(ctrl.modalMode).toBeNull();
    expect(ctrl.children).toEqual([]);
    expect(ctrl.successMessage).toContain('archived');

    // Reload child, then trigger HTTP 401 -> F-P42-03 clears stale children and selectedChildId eagerly
    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [alphaChildDto]));
    await ctrl.loadChildren();
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();
    expect(ctrl.children).toHaveLength(1);
    expect(ctrl.selectedChildId).toBe('chd-alpha-1');

    mockFetch.mockResolvedValueOnce(mockJsonResponse(401, { error: 'Token expired', code: 'AUTH_TOKEN_INVALID' }));
    await ctrl.loadChildren();
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();
    expect(ctrl.loadError?.kind).toBe('UNAUTHORIZED');
    expect(ctrl.loadError?.title).toBe('Session Expired');
    expect(ctrl.children).toEqual([]);
    expect(ctrl.selectedChildId).toBeNull();
  });

  test('prevents delayed User A list/mutation from polluting User B or disarming User B lock (F-P42-01), rejects stale detail & client validation errors', async () => {
    const defAlpha = createDeferred<Response>();
    const defBeta = createDeferred<Response>();
    mockFetch
      .mockReturnValueOnce(defAlpha.promise)
      .mockReturnValueOnce(defBeta.promise);

    // 1. Mount as User A -> GET /api/children held in flight
    let ctrl = mountController(residentAlpha);
    expect(ctrl.isLoading).toBe(true);

    // 2. Switch authenticated session to User B BEFORE User A's response resolves
    clearAuthSession();
    saveAuthSession(residentBeta, 'jwt-beta-p42', 'password');
    ctrl = mountController(residentBeta);

    // 3. Delayed User A response resolves now -> MUST BE DISCARDED!
    defAlpha.resolve(mockJsonResponse(200, [alphaChildDto]));
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();
    expect(ctrl.children).toEqual([]);

    // 4. User B's response resolves -> ONLY User B's child appears
    defBeta.resolve(mockJsonResponse(200, [betaChildDto]));
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();
    expect(ctrl.children).toHaveLength(1);
    expect(ctrl.children[0].fullName).toBe('Diya Nair');

    // 5. Client-side validation failure fires ZERO fetch calls
    const callsBeforeValidation = mockFetch.mock.calls.length;
    ctrl.openCreateModal();
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();
    ctrl.setFormField('fullName', '   ');
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();
    expect(await ctrl.submitCreateChild()).toBe(false);
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();
    expect(ctrl.formError).toContain('full name');
    expect(mockFetch.mock.calls.length).toBe(callsBeforeValidation);

    // 6. F-P42-01 regression: User B starts create mutation -> switch back to User A ->
    //    User A starts create mutation -> delayed User B mutation settles -> MUST NOT disarm User A's lock!
    ctrl.setFormField('fullName', 'Beta Child 2');
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();
    const defCreateBeta = createDeferred<Response>();
    const defListAlpha2 = createDeferred<Response>();
    mockFetch.mockReturnValueOnce(defCreateBeta.promise).mockReturnValueOnce(defListAlpha2.promise);

    const betaCreateP = ctrl.submitCreateChild();

    clearAuthSession();
    saveAuthSession(residentAlpha, 'jwt-alpha-p42', 'password');
    ctrl = mountController(residentAlpha);
    defListAlpha2.resolve(mockJsonResponse(200, [alphaChildDto]));
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();

    ctrl.openCreateModal();
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();
    ctrl.setFormField('fullName', 'Alpha Child 2');
    ctrl = hookRuntime.rerender<ResidentChildProfilesController>();

    const defCreateAlpha = createDeferred<Response>();
    mockFetch
      .mockReturnValueOnce(defCreateAlpha.promise)
      .mockResolvedValueOnce(mockJsonResponse(200, [alphaChildDto]));

    const alphaCreateP1 = ctrl.submitCreateChild();

    // Delayed User B mutation settles now -> MUST return false AND leave User A's lock intact!
    defCreateBeta.resolve(mockJsonResponse(201, betaChildDto));
    expect(await betaCreateP).toBe(false);
    await flushMicrotasks();

    // User A duplicate click MUST STILL BE BLOCKED!
    const alphaCreateP2 = ctrl.submitCreateChild();
    expect(await alphaCreateP2).toBe(false);

    defCreateAlpha.resolve(mockJsonResponse(201, { ...alphaChildDto, id: 'chd-alpha-2', fullName: 'Alpha Child 2' }));
    expect(await alphaCreateP1).toBe(true);
    await flushMicrotasks();

    // 7. Logout clears local state immediately
    clearAuthSession();
    ctrl = mountController(null);
    expect(ctrl.children).toEqual([]);
    expect(ctrl.selectedChildId).toBeNull();
    expect(ctrl.isLoading).toBe(false);
  });
});

