// =============================================================================
// ISSUE-06 Phase B.2.3 — Phase 4.3:
// Resident Authorized Pickup Management Behavioral Tests
// Executes REAL `useResidentAuthorizedPickups` -> REAL `childSafetyResidentHelpers` ->
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
  useResidentAuthorizedPickups,
  type ResidentAuthorizedPickupsController,
} from '../src/domains/safety/components/ResidentAuthorizedPickupsSection';
import { formatAuthorizedPickupDisplay } from '../src/domains/safety/utils/childSafetyResidentHelpers';
import { childSafetyService } from '../src/services/childSafetyService';
import { saveAuthSession, clearAuthSession } from '../src/services/authStorage';
import type { UserProfile } from '../src/domains/auth/types';
import type { AuthorizedPickupDto, ChildProfileDto } from '../src/types/childSafety';

const mockJsonResponse = (status: number, body: unknown): Response => {
  const normalizedHeaders = new Map<string, string>([['content-type', 'application/json']]);
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

const FUTURE_ISO = '2027-06-15T12:00:00.000Z';
const PAST_ISO = '2025-01-10T08:00:00.000Z';
const CREATED_ISO = '2026-11-18T10:00:00.000Z';

const childOne: Pick<ChildProfileDto, 'id' | 'status' | 'archivedAt'> = {
  id: 'chd-alpha-1',
  status: 'SAFE',
  archivedAt: null,
};

const childTwo: Pick<ChildProfileDto, 'id' | 'status' | 'archivedAt'> = {
  id: 'chd-alpha-2',
  status: 'SAFE',
  archivedAt: null,
};

const betaChild: Pick<ChildProfileDto, 'id' | 'status' | 'archivedAt'> = {
  id: 'chd-beta-1',
  status: 'SAFE',
  archivedAt: null,
};

const pickupChild1Active: AuthorizedPickupDto = {
  id: 'pkp-1',
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
  validUntil: FUTURE_ISO,
  notes: 'Weekday school bus pickup',
  archivedAt: null,
  createdAt: CREATED_ISO,
  updatedAt: CREATED_ISO,
};

const pickupChild1ExpiredByTime: AuthorizedPickupDto = {
  ...pickupChild1Active,
  id: 'pkp-exp-time',
  name: 'Ramesh Verma',
  relationship: 'Driver',
  status: 'ACTIVE', // Persisted ACTIVE, but validUntil is in the past!
  validUntil: PAST_ISO,
};

const pickupChild1ExpiredStatus: AuthorizedPickupDto = {
  ...pickupChild1Active,
  id: 'pkp-exp-status',
  name: 'Neha Joshi',
  relationship: 'Aunt',
  status: 'EXPIRED',
  validUntil: PAST_ISO,
};

const pickupChild1Revoked: AuthorizedPickupDto = {
  ...pickupChild1Active,
  id: 'pkp-revoked',
  name: 'Old Escort',
  status: 'REVOKED',
};

const pickupChild1Archived: AuthorizedPickupDto = {
  ...pickupChild1Active,
  id: 'pkp-archived',
  name: 'Archived Escort',
  status: 'ARCHIVED',
  archivedAt: CREATED_ISO,
};

const pickupChild2Active: AuthorizedPickupDto = {
  ...pickupChild1Active,
  id: 'pkp-child2-1',
  childId: 'chd-alpha-2',
  name: 'Kavita Kulkarni',
  phone: '+919833334444',
  relationship: 'Nanny',
};

const pickupBetaActive: AuthorizedPickupDto = {
  ...pickupChild1Active,
  id: 'pkp-beta-1',
  societyId: 'soc-beta',
  childId: 'chd-beta-1',
  name: 'Suresh Menon',
  phone: '+919855556666',
  relationship: 'Uncle',
};

describe('ISSUE-06 Phase B.2.3 (Phase 4.3): Resident Authorized Pickup Management Controller', () => {
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
    saveAuthSession(residentAlpha, 'jwt-alpha-p43', 'password');
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
    child: Pick<ChildProfileDto, 'id' | 'status' | 'archivedAt'> | null,
    onMutated?: (childId: string) => void | Promise<void>
  ): ResidentAuthorizedPickupsController =>
    hookRuntime.render(() => useResidentAuthorizedPickups(user, child?.id ?? null, child, onMutated));

  test('loads pickups per child from backend, handles empty state, network error & retry, with zero localStorage writes', async () => {
    const defInit = createDeferred<Response>();
    mockFetch.mockReturnValueOnce(defInit.promise);

    let ctrl = mountController(residentAlpha, childOne);
    expect(ctrl.isLoading).toBe(true);
    expect(ctrl.pickups).toEqual([]);

    defInit.resolve(mockJsonResponse(200, []));
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();

    expect(ctrl.isLoading).toBe(false);
    expect(ctrl.loadError).toBeNull();
    expect(ctrl.pickups).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:5000/api/children/chd-alpha-1/pickups');

    // Network error surfaces retryable error
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await ctrl.loadPickups();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.loadError?.kind).toBe('NETWORK');
    expect(ctrl.loadError?.isRetryable).toBe(true);

    // Retry loads authoritative backend pickup list
    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [pickupChild1Active]));
    await ctrl.loadPickups();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.loadError).toBeNull();
    expect(ctrl.pickups).toHaveLength(1);
    expect(ctrl.pickups[0].name).toBe('Sunita Devi');

    // Zero storage persistence
    expect(mockLS.setItemCalls).toHaveLength(0);
    expect(mockSS.setItemCalls).toHaveLength(0);
  });

  test('isolates multiple children independently and discards stale Child 1 response when switching to Child 2 mid-flight', async () => {
    const defChild1 = createDeferred<Response>();
    const defChild2 = createDeferred<Response>();
    mockFetch.mockReturnValueOnce(defChild1.promise).mockReturnValueOnce(defChild2.promise);

    // Mount Child 1 (in flight)
    let ctrl = mountController(residentAlpha, childOne);
    expect(ctrl.selectedChildId).toBe('chd-alpha-1');
    expect(ctrl.isLoading).toBe(true);

    // Switch to Child 2 BEFORE Child 1 responds
    ctrl = mountController(residentAlpha, childTwo);
    expect(ctrl.selectedChildId).toBe('chd-alpha-2');
    expect(ctrl.pickups).toEqual([]);

    // Delayed Child 1 response resolves now -> MUST BE DISCARDED!
    defChild1.resolve(mockJsonResponse(200, [pickupChild1Active]));
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.pickups).toEqual([]);

    // Child 2 response resolves -> ONLY Child 2 pickup appears
    defChild2.resolve(mockJsonResponse(200, [pickupChild2Active]));
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.pickups).toHaveLength(1);
    expect(ctrl.pickups[0].childId).toBe('chd-alpha-2');
    expect(ctrl.pickups[0].name).toBe('Kavita Kulkarni');
  });

  test('adds authorized pickup via POST, rejects full government ID numbers client-side, prevents duplicate submit, and surfaces 403/409 errors', async () => {
    const onMutated = jest.fn();
    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, []));
    let ctrl = mountController(residentAlpha, childOne, onMutated);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();

    ctrl.openAddModal();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.modalMode).toBe('ADD');

    // Full Aadhaar / >4-char ID rejected client-side with ZERO fetch calls
    ctrl.setAddFormField('name', 'Sunita Devi');
    ctrl.setAddFormField('phone', '+919811112222');
    ctrl.setAddFormField('relationship', 'Grandmother');
    ctrl.setAddFormField('idDocumentType', 'Aadhaar Card');
    ctrl.setAddFormField('idDocumentLast4', '123456789012');
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();

    expect(await ctrl.submitAddPickup()).toBe(false);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.formError).toContain('last 4 characters');
    expect(mockFetch).toHaveBeenCalledTimes(1); // Only initial GET

    // Fix to valid 4-char last4 + future expiry -> hold POST in flight for duplicate-submit check
    ctrl.setAddFormField('idDocumentLast4', '4589');
    ctrl.setAddFormField('validUntil', FUTURE_ISO);
    ctrl.setAddFormField('notes', 'Weekday school bus pickup');
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();

    const defAdd = createDeferred<Response>();
    mockFetch
      .mockReturnValueOnce(defAdd.promise)
      .mockResolvedValueOnce(mockJsonResponse(200, [pickupChild1Active]));

    const p1 = ctrl.submitAddPickup();
    const p2 = ctrl.submitAddPickup(); // Blocked by synchronous lock!
    expect(await p2).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2); // 1 GET + 1 POST (never 2 POSTs)

    const postCall = mockFetch.mock.calls[1];
    expect(postCall[0]).toBe('http://localhost:5000/api/children/chd-alpha-1/pickups');
    expect(postCall[1].method).toBe('POST');
    const postBody = JSON.parse(postCall[1].body);
    expect(postBody).toEqual({
      name: 'Sunita Devi',
      phone: '+919811112222',
      relationship: 'Grandmother',
      idDocumentType: 'Aadhaar Card',
      idDocumentLast4: '4589',
      validUntil: FUTURE_ISO,
      notes: 'Weekday school bus pickup',
    });
    expect(postBody.societyId).toBeUndefined();
    expect(postBody.residentId).toBeUndefined();
    expect(postBody.flatId).toBeUndefined();
    expect(postBody.idProofNumber).toBeUndefined();

    defAdd.resolve(mockJsonResponse(201, pickupChild1Active));
    expect(await p1).toBe(true);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();

    expect(ctrl.modalMode).toBeNull();
    expect(ctrl.pickups).toHaveLength(1);
    expect(ctrl.successMessage).toContain('Sunita Devi');
    expect(onMutated).toHaveBeenCalledWith('chd-alpha-1');

    // 409 CHILD_ARCHIVED failure keeps modal open with visible error and zero fake success
    ctrl.openAddModal();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    ctrl.setAddFormField('name', 'Another Escort');
    ctrl.setAddFormField('phone', '+919800001111');
    ctrl.setAddFormField('relationship', 'Uncle');
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();

    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(409, {
        error: 'Cannot add pickup authorization to an archived child profile.',
        code: 'CHILD_ARCHIVED',
      })
    );
    expect(await ctrl.submitAddPickup()).toBe(false);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.modalMode).toBe('ADD');
    expect(ctrl.actionError?.kind).toBe('CONFLICT');
    expect(ctrl.actionError?.code).toBe('CHILD_ARCHIVED');
  });

  test('edits pickup submitting ONLY backend PATCH-supported fields, renews expired pickups cleanly, and blocks REVOKED/ARCHIVED edits', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(200, [
        pickupChild1Active,
        pickupChild1ExpiredStatus,
        pickupChild1Revoked,
        pickupChild1Archived,
      ])
    );
    let ctrl = mountController(residentAlpha, childOne);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();

    // Revoked and Archived pickups cannot open edit modal
    ctrl.openEditModal(pickupChild1Revoked);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.modalMode).toBeNull();
    expect(ctrl.actionError?.code).toBe('REVOKED_PICKUP_CANNOT_BE_REACTIVATED');

    ctrl.openEditModal(pickupChild1Archived);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.modalMode).toBeNull();
    expect(ctrl.actionError?.code).toBe('PICKUP_ARCHIVED');

    // Edit ACTIVE pickup: update phone & relationship only; MUST NOT send idDocumentType/idDocumentLast4/photoUrl/notes
    ctrl.openEditModal(pickupChild1Active);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.modalMode).toBe('EDIT');

    ctrl.setEditFormField('phone', '+919899990000');
    ctrl.setEditFormField('relationship', 'Maternal Grandmother');
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();

    const updatedPickup: AuthorizedPickupDto = {
      ...pickupChild1Active,
      phone: '+919899990000',
      relationship: 'Maternal Grandmother',
    };
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse(200, updatedPickup))
      .mockResolvedValueOnce(mockJsonResponse(200, [updatedPickup, pickupChild1ExpiredStatus]));

    expect(await ctrl.submitEditPickup()).toBe(true);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();

    const patchCall = mockFetch.mock.calls[1];
    expect(patchCall[0]).toBe('http://localhost:5000/api/children/chd-alpha-1/pickups/pkp-1');
    expect(patchCall[1].method).toBe('PATCH');
    const patchBody = JSON.parse(patchCall[1].body);
    expect(patchBody).toEqual({
      name: 'Sunita Devi',
      phone: '+919899990000',
      relationship: 'Maternal Grandmother',
    });
    expect(patchBody.idDocumentType).toBeUndefined();
    expect(patchBody.idDocumentLast4).toBeUndefined();
    expect(patchBody.photoUrl).toBeUndefined();
    expect(patchBody.notes).toBeUndefined();
    expect(patchBody.societyId).toBeUndefined();
    expect(patchBody.childId).toBeUndefined();

    // Renew EXPIRED pickup with a fresh future validUntil -> sends status='ACTIVE' + future validUntil
    ctrl.openEditModal(pickupChild1ExpiredStatus);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    ctrl.setEditFormField('validUntil', FUTURE_ISO);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();

    const renewedPickup: AuthorizedPickupDto = {
      ...pickupChild1ExpiredStatus,
      status: 'ACTIVE',
      validUntil: FUTURE_ISO,
    };
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse(200, renewedPickup))
      .mockResolvedValueOnce(mockJsonResponse(200, [updatedPickup, renewedPickup]));

    expect(await ctrl.submitEditPickup()).toBe(true);
    await flushMicrotasks();

    const renewCall = mockFetch.mock.calls[3];
    const renewBody = JSON.parse(renewCall[1].body);
    expect(renewBody.status).toBe('ACTIVE');
    expect(renewBody.validUntil).toBe(FUTURE_ISO);
    expect(renewBody.idDocumentType).toBeUndefined();
    expect(renewBody.idDocumentLast4).toBeUndefined();
    expect(renewBody.notes).toBeUndefined();

    // Edit failure (403 Forbidden) keeps modal open with visible error
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    ctrl.openEditModal(updatedPickup);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(403, { error: 'Forbidden: Not guardian owner.', code: 'UNAUTHORIZED_CHILD_ACCESS' })
    );
    expect(await ctrl.submitEditPickup()).toBe(false);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.modalMode).toBe('EDIT');
    expect(ctrl.actionError?.kind).toBe('FORBIDDEN');
  });

  test('requires revoke & archive confirmation, supports cancellation with 0 calls, prevents duplicate revoke, and handles 401/404/409', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [pickupChild1Active]));
    let ctrl = mountController(residentAlpha, childOne);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();

    // Open revoke modal -> 0 network calls; cancel -> 0 network calls
    ctrl.openRevokeModal(pickupChild1Active);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.modalMode).toBe('REVOKE');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    ctrl.closeModal();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.modalMode).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Reopen & confirm revoke with duplicate-submit protection
    ctrl.openRevokeModal(pickupChild1Active);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();

    const defRevoke = createDeferred<Response>();
    const revokedDto: AuthorizedPickupDto = { ...pickupChild1Active, status: 'REVOKED' };
    mockFetch
      .mockReturnValueOnce(defRevoke.promise)
      .mockResolvedValueOnce(mockJsonResponse(200, [revokedDto]));

    const r1 = ctrl.confirmRevokePickup();
    const r2 = ctrl.confirmRevokePickup(); // Blocked by duplicate-submit lock!
    expect(await r2).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toBe('http://localhost:5000/api/children/chd-alpha-1/pickups/pkp-1/revoke');
    expect(mockFetch.mock.calls[1][1].method).toBe('POST');

    defRevoke.resolve(mockJsonResponse(200, revokedDto));
    expect(await r1).toBe(true);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.modalMode).toBeNull();
    expect(ctrl.pickups[0].status).toBe('REVOKED');
    expect(ctrl.successMessage).toContain('revoked');

    // Confirmed archive calls actual backend DELETE endpoint
    ctrl.openArchiveModal(revokedDto);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.modalMode).toBe('ARCHIVE');

    const archivedDto: AuthorizedPickupDto = { ...revokedDto, status: 'ARCHIVED', archivedAt: CREATED_ISO };
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse(200, archivedDto))
      .mockResolvedValueOnce(mockJsonResponse(200, [archivedDto]));

    expect(await ctrl.confirmArchivePickup()).toBe(true);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(mockFetch.mock.calls[3][0]).toBe('http://localhost:5000/api/children/chd-alpha-1/pickups/pkp-1');
    expect(mockFetch.mock.calls[3][1].method).toBe('DELETE');
    expect(ctrl.pickups[0].status).toBe('ARCHIVED');

    // 404 Not Found on revoke surfaces NOT_FOUND cleanly
    ctrl.openRevokeModal(pickupChild1Active);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    mockFetch.mockResolvedValueOnce(mockJsonResponse(404, { error: 'Authorized pickup not found.', code: 'PICKUP_NOT_FOUND' }));
    expect(await ctrl.confirmRevokePickup()).toBe(false);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.actionError?.kind).toBe('NOT_FOUND');

    // 409 ALREADY_REVOKED surfaces CONFLICT cleanly
    mockFetch.mockResolvedValueOnce(mockJsonResponse(409, { error: 'Pickup authorization is already revoked.', code: 'ALREADY_REVOKED' }));
    expect(await ctrl.confirmRevokePickup()).toBe(false);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.actionError?.kind).toBe('CONFLICT');
    expect(ctrl.actionError?.code).toBe('ALREADY_REVOKED');

    // 401 UNAUTHORIZED on list refresh clears stale pickups eagerly
    ctrl.closeModal();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    mockFetch.mockResolvedValueOnce(mockJsonResponse(401, { error: 'Token expired', code: 'AUTH_TOKEN_INVALID' }));
    await ctrl.loadPickups();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.loadError?.kind).toBe('UNAUTHORIZED');
    expect(ctrl.pickups).toEqual([]);
  });

  test('prevents delayed User A list or mutation settlement from polluting User B state or disarming User B lock on session switch', async () => {
    const defListAlpha = createDeferred<Response>();
    mockFetch.mockReturnValueOnce(defListAlpha.promise);

    // Mount as User A -> initial GET held in flight
    let ctrl = mountController(residentAlpha, childOne);
    defListAlpha.resolve(mockJsonResponse(200, []));
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();

    // User A starts an ADD mutation (held in flight)
    ctrl.openAddModal();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    ctrl.setAddFormField('name', 'Alpha Escort');
    ctrl.setAddFormField('phone', '+919800001111');
    ctrl.setAddFormField('relationship', 'Nanny');
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();

    const defAddAlpha = createDeferred<Response>();
    const defListBeta = createDeferred<Response>();
    mockFetch.mockReturnValueOnce(defAddAlpha.promise).mockReturnValueOnce(defListBeta.promise);

    const alphaMutationPromise = ctrl.submitAddPickup();

    // Switch session to User B BEFORE User A's mutation settles!
    clearAuthSession();
    saveAuthSession(residentBeta, 'jwt-beta-p43', 'password');
    ctrl = mountController(residentBeta, betaChild);

    defListBeta.resolve(mockJsonResponse(200, [pickupBetaActive]));
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.pickups).toHaveLength(1);
    expect(ctrl.pickups[0].name).toBe('Suresh Menon');

    // User B starts their OWN add mutation (held in flight)
    ctrl.openAddModal();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    ctrl.setAddFormField('name', 'Beta Escort');
    ctrl.setAddFormField('phone', '+919855551111');
    ctrl.setAddFormField('relationship', 'Driver');
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();

    const defAddBeta = createDeferred<Response>();
    mockFetch
      .mockReturnValueOnce(defAddBeta.promise)
      .mockResolvedValueOnce(mockJsonResponse(200, [pickupBetaActive]));

    const betaP1 = ctrl.submitAddPickup();

    // NOW User A's delayed mutation resolves -> MUST NOT pollute User B AND MUST NOT disarm User B's lock!
    defAddAlpha.resolve(mockJsonResponse(201, pickupChild1Active));
    expect(await alphaMutationPromise).toBe(false);
    await flushMicrotasks();

    // User B duplicate click MUST STILL BE BLOCKED because mutationSeqRef guarded User A's finally block!
    const betaP2 = ctrl.submitAddPickup();
    expect(await betaP2).toBe(false);

    // Finish User B's mutation cleanly
    defAddBeta.resolve(mockJsonResponse(201, { ...pickupBetaActive, id: 'pkp-beta-2', name: 'Beta Escort' }));
    expect(await betaP1).toBe(true);
    await flushMicrotasks();

    // Logout immediately wipes pickup state
    clearAuthSession();
    ctrl = mountController(null, null);
    expect(ctrl.pickups).toEqual([]);
    expect(ctrl.modalMode).toBeNull();
    expect(ctrl.isLoading).toBe(false);
  });

  test('computes effective EXPIRED, REVOKED, ARCHIVED, and ACTIVE display statuses without mutating persisted DTO status', () => {
    const now = new Date('2026-11-18T12:00:00.000Z');

    const activeDisplay = formatAuthorizedPickupDisplay(pickupChild1Active, now);
    expect(activeDisplay.effectiveStatus).toBe('ACTIVE');
    expect(activeDisplay.canEdit).toBe(true);
    expect(activeDisplay.canRevoke).toBe(true);
    expect(activeDisplay.maskedIdLabel).toBe('Aadhaar Card · XXXX-4589');

    // Persisted status stays 'ACTIVE', effectiveStatus becomes 'EXPIRED'
    const expiredByTimeDisplay = formatAuthorizedPickupDisplay(pickupChild1ExpiredByTime, now);
    expect(pickupChild1ExpiredByTime.status).toBe('ACTIVE');
    expect(expiredByTimeDisplay.effectiveStatus).toBe('EXPIRED');
    expect(expiredByTimeDisplay.isSelectableForPass).toBe(false);
    expect(expiredByTimeDisplay.canEdit).toBe(true);
    expect(expiredByTimeDisplay.canRevoke).toBe(true);

    const revokedDisplay = formatAuthorizedPickupDisplay(pickupChild1Revoked, now);
    expect(revokedDisplay.effectiveStatus).toBe('REVOKED');
    expect(revokedDisplay.canEdit).toBe(false);
    expect(revokedDisplay.canRevoke).toBe(false);
    expect(revokedDisplay.canArchive).toBe(true);

    const archivedDisplay = formatAuthorizedPickupDisplay(pickupChild1Archived, now);
    expect(archivedDisplay.effectiveStatus).toBe('ARCHIVED');
    expect(archivedDisplay.canEdit).toBe(false);
    expect(archivedDisplay.canRevoke).toBe(false);
    expect(archivedDisplay.canArchive).toBe(false);
  });

  test('F-P43-01 & F-P43-02 & F-P43-04: blocks clearing validUntil on persisted/time-expired pickups, rejects invalid calendar dates & malformed phones, and preserves valid active edits', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(200, [pickupChild1Active, pickupChild1ExpiredByTime, pickupChild1ExpiredStatus])
    );
    let ctrl = mountController(residentAlpha, childOne);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();

    // 1. Persisted EXPIRED + clearValidUntil -> blocked client-side with ZERO extra fetch calls
    ctrl.openEditModal(pickupChild1ExpiredStatus);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    ctrl.setEditFormField('clearValidUntil', true);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(await ctrl.submitEditPickup()).toBe(false);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.formError).toContain('cannot remove their expiry limit');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // 2. Time-expired ACTIVE (validUntil <= now) + clearValidUntil -> blocked client-side with ZERO extra fetch calls
    ctrl.openEditModal(pickupChild1ExpiredByTime);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    ctrl.setEditFormField('clearValidUntil', true);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(await ctrl.submitEditPickup()).toBe(false);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.formError).toContain('cannot remove their expiry limit');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // 3. Impossible calendar dates (2027-02-30, 2027-02-29, 2027-04-31) rejected with ZERO fetch calls
    for (const badDate of ['2027-02-30T12:00', '2027-02-29T12:00', '2027-04-31T12:00']) {
      ctrl.setEditFormField('validUntil', badDate);
      ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
      expect(await ctrl.submitEditPickup()).toBe(false);
      ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
      expect(ctrl.formError).toContain('future');
    }
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // 4. Malformed phone rejected with ZERO fetch calls
    ctrl.setEditFormField('validUntil', '2028-02-29T12:00:00Z');
    ctrl.setEditFormField('phone', 'not-a-phone');
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(await ctrl.submitEditPickup()).toBe(false);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.formError).toContain('7–15 digits');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // 5. Valid renewal of time-expired ACTIVE with leap-year future date & international phone succeeds
    ctrl.setEditFormField('phone', '+1 (415) 555-0199');
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    const renewedTimeExp: AuthorizedPickupDto = {
      ...pickupChild1ExpiredByTime,
      phone: '+1 (415) 555-0199',
      status: 'ACTIVE',
      validUntil: '2028-02-29T12:00:00.000Z',
    };
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse(200, renewedTimeExp))
      .mockResolvedValueOnce(mockJsonResponse(200, [pickupChild1Active, renewedTimeExp]));

    expect(await ctrl.submitEditPickup()).toBe(true);
    await flushMicrotasks();
    const renewBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(renewBody).toEqual({
      name: 'Ramesh Verma',
      phone: '+1 (415) 555-0199',
      relationship: 'Driver',
      validUntil: '2028-02-29T12:00:00.000Z',
      status: 'ACTIVE',
    });

    // 6. Normal non-expired ACTIVE pickup CAN still remove expiry limit (validUntil: null)
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    ctrl.openEditModal(pickupChild1Active);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    ctrl.setEditFormField('clearValidUntil', true);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();

    const clearedActive: AuthorizedPickupDto = { ...pickupChild1Active, validUntil: null };
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse(200, clearedActive))
      .mockResolvedValueOnce(mockJsonResponse(200, [clearedActive, renewedTimeExp]));

    expect(await ctrl.submitEditPickup()).toBe(true);
    await flushMicrotasks();
    const clearBody = JSON.parse(mockFetch.mock.calls[3][1].body);
    expect(clearBody.validUntil).toBeNull();
    expect(clearBody.status).toBeUndefined();
  });

  test('F-P43-03 & F-P43-05: isolates throwing onPickupsMutated callback, handles failed post-mutation refresh, mid-flight child-switch mutation lock, archive cancel, and archived child guard', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const throwingCallback = jest.fn().mockRejectedValue(new Error('Parent summary sync failed'));

    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, []));
    let ctrl = mountController(residentAlpha, childOne, throwingCallback);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();

    // 1. Successful ADD + authoritative refresh succeeds + onPickupsMutated THROWS ->
    //    mutation STILL returns true, modal closes, successMessage preserved, lock released, non-PII log only
    ctrl.openAddModal();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    ctrl.setAddFormField('name', 'Sunita Devi');
    ctrl.setAddFormField('phone', '+919811112222');
    ctrl.setAddFormField('relationship', 'Grandmother');
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();

    mockFetch
      .mockResolvedValueOnce(mockJsonResponse(201, pickupChild1Active))
      .mockResolvedValueOnce(mockJsonResponse(200, [pickupChild1Active]));

    expect(await ctrl.submitAddPickup()).toBe(true);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.modalMode).toBeNull();
    expect(ctrl.isSubmitting).toBe(false);
    expect(ctrl.successMessage).toContain('Sunita Devi');
    expect(ctrl.pickups).toHaveLength(1);
    expect(ctrl.actionError?.code).toBe('POST_MUTATION_REFRESH_FAILED');
    expect(throwingCallback).toHaveBeenCalledWith('chd-alpha-1');
    // Log must NOT contain sensitive pickup details
    expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain('Sunita Devi');
    expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain('+919811112222');

    // 2. Failed GET refresh immediately after successful mutation does NOT convert mutation to false
    const okCallback = jest.fn().mockResolvedValue(undefined);
    ctrl = mountController(residentAlpha, childOne, okCallback);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();

    ctrl.openRevokeModal(pickupChild1Active);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse(200, { ...pickupChild1Active, status: 'REVOKED' }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    expect(await ctrl.confirmRevokePickup()).toBe(true);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.successMessage).toContain('revoked');
    expect(ctrl.loadError?.kind).toBe('NETWORK');

    // 3. Archive modal cancellation triggers ZERO network calls; 409 ALREADY_ARCHIVED surfaces CONFLICT
    const callsBeforeArchiveCancel = mockFetch.mock.calls.length;
    ctrl.openArchiveModal(pickupChild1Active);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.modalMode).toBe('ARCHIVE');
    ctrl.closeModal();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.modalMode).toBeNull();
    expect(mockFetch.mock.calls.length).toBe(callsBeforeArchiveCancel);

    ctrl.openArchiveModal(pickupChild1Active);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(409, { error: 'Pickup authorization is already archived.', code: 'ALREADY_ARCHIVED' })
    );
    expect(await ctrl.confirmArchivePickup()).toBe(false);
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.actionError?.code).toBe('ALREADY_ARCHIVED');

    // 4. Child switching during an in-flight mutation: Child 1 settles AFTER switching to Child 2
    //    while Child 2 has its own mutation in flight -> Child 2's lock MUST remain armed!
    ctrl.closeModal();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    ctrl.openAddModal();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    ctrl.setAddFormField('name', 'Child1 Escort');
    ctrl.setAddFormField('phone', '+919811110000');
    ctrl.setAddFormField('relationship', 'Uncle');
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();

    const defChild1Add = createDeferred<Response>();
    const defChild2List = createDeferred<Response>();
    mockFetch.mockReturnValueOnce(defChild1Add.promise).mockReturnValueOnce(defChild2List.promise);

    const child1AddP = ctrl.submitAddPickup();

    // Switch to Child 2 while Child 1's POST is in flight
    ctrl = mountController(residentAlpha, childTwo, okCallback);
    defChild2List.resolve(mockJsonResponse(200, []));
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();

    ctrl.openAddModal();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    ctrl.setAddFormField('name', 'Child2 Escort');
    ctrl.setAddFormField('phone', '+919822220000');
    ctrl.setAddFormField('relationship', 'Aunt');
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();

    const defChild2Add = createDeferred<Response>();
    mockFetch
      .mockReturnValueOnce(defChild2Add.promise)
      .mockResolvedValueOnce(mockJsonResponse(200, [pickupChild2Active]));

    const child2AddP1 = ctrl.submitAddPickup();

    // Child 1's delayed POST settles now -> returns false AND leaves Child 2's lock armed!
    defChild1Add.resolve(mockJsonResponse(201, pickupChild1Active));
    expect(await child1AddP).toBe(false);
    await flushMicrotasks();

    const child2AddP2 = ctrl.submitAddPickup();
    expect(await child2AddP2).toBe(false);

    defChild2Add.resolve(mockJsonResponse(201, pickupChild2Active));
    expect(await child2AddP1).toBe(true);
    await flushMicrotasks();

    // 5. Archived child fails closed on openAddModal with CHILD_ARCHIVED
    const archivedChild: Pick<ChildProfileDto, 'id' | 'status' | 'archivedAt'> = {
      id: 'chd-archived-1',
      status: 'ARCHIVED',
      archivedAt: CREATED_ISO,
    };
    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, []));
    ctrl = mountController(residentAlpha, archivedChild, okCallback);
    await flushMicrotasks();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    ctrl.openAddModal();
    ctrl = hookRuntime.rerender<ResidentAuthorizedPickupsController>();
    expect(ctrl.modalMode).toBeNull();
    expect(ctrl.actionError?.code).toBe('CHILD_ARCHIVED');

    consoleErrorSpy.mockRestore();
  });
});

