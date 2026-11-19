// =============================================================================
// ISSUE-06 Phase B.2.3 — Phase 2 Remediation (F-P2-05):
// AuthProvider + Firebase Sign-Out Synchronous SSE Disconnect Lifecycle Tests
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

// Minimal deterministic React hook runtime for executing real AuthProvider effects in Node Jest
type EffectRecord = {
  fn: () => void | (() => void);
  deps: unknown[] | undefined;
  cleanup?: () => void;
};

const hookRuntime = {
  states: [] as unknown[],
  effects: [] as Array<EffectRecord | undefined>,
  stateCursor: 0,
  effectCursor: 0,
  pendingEffects: [] as number[],
  renderFn: null as (() => void) | null,
  reset() {
    this.cleanupAll();
    this.states = [];
    this.effects = [];
    this.stateCursor = 0;
    this.effectCursor = 0;
    this.pendingEffects = [];
    this.renderFn = null;
  },
  runRender(fn: () => void) {
    this.renderFn = fn;
    this.stateCursor = 0;
    this.effectCursor = 0;
    this.pendingEffects = [];
    fn();
    this.flushEffects();
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
  cleanupAll() {
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
    default: {
      ...actual,
      createContext: actual.createContext,
    },
    useState: (initial: any) => {
      const idx = hookRuntime.stateCursor++;
      if (!(idx in hookRuntime.states)) {
        hookRuntime.states[idx] = typeof initial === 'function' ? initial() : initial;
      }
      const setState = (val: any) => {
        const nextVal = typeof val === 'function' ? val(hookRuntime.states[idx]) : val;
        if (!Object.is(hookRuntime.states[idx], nextVal)) {
          hookRuntime.states[idx] = nextVal;
        }
      };
      return [hookRuntime.states[idx], setState];
    },
    useEffect: (fn: () => void | (() => void), deps?: unknown[]) => {
      const idx = hookRuntime.effectCursor++;
      const prev = hookRuntime.effects[idx];
      if (!prev || depsChanged(prev.deps, deps)) {
        hookRuntime.effects[idx] = {
          fn,
          deps,
          cleanup: prev?.cleanup,
        };
        hookRuntime.pendingEffects.push(idx);
      }
    },
  };
});

let capturedIdTokenCallback: ((user: any) => Promise<void> | void) | null = null;
const mockFirebaseUnsubscribe = jest.fn();

jest.mock('firebase/auth', () => ({
  onIdTokenChanged: jest.fn((_auth: any, cb: (user: any) => void) => {
    capturedIdTokenCallback = cb;
    return mockFirebaseUnsubscribe;
  }),
  signInWithPhoneNumber: jest.fn(),
  signOut: jest.fn().mockResolvedValue(undefined),
  RecaptchaVerifier: jest.fn(),
}));

jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  getDoc: jest.fn(),
}));

jest.mock('../src/services/firebase/config', () => ({
  auth: { __mockAuth: true },
  db: { __mockDb: true },
}));

jest.mock('@capacitor/app', () => ({
  App: {
    addListener: jest.fn(),
  },
}));

jest.mock('../src/utils/backendConfig', () => ({
  getBackendBaseUrl: jest.fn(() => 'http://localhost:5000'),
}));

jest.mock('../src/utils/nativeMobile', () => ({
  triggerHaptic: jest.fn(),
  isNativeApp: jest.fn(() => false),
}));

import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import React from 'react';
import * as firebaseAuth from 'firebase/auth';
import * as firebaseFirestore from 'firebase/firestore';
import * as firebaseConfig from '../src/services/firebase/config';
import * as capacitorApp from '@capacitor/app';
import * as mockUsers from '../src/mockData/auth/mockUsers';
import * as nativeMobile from '../src/utils/nativeMobile';
import * as authStorage from '../src/services/authStorage';
import { realtimeService } from '../src/services/realtimeService';
import type { UserProfile } from '../src/domains/auth/types';

/**
 * Loads the real `src/context/AuthContext.tsx` module in Node CommonJS Jest
 * by substituting Vite's compile-time `import.meta.env.DEV` literal during transpilation
 * while binding all module imports to the live Jest module graph (real `realtimeService` & `authStorage`).
 */
function loadRealAuthContextModule(): { AuthProvider: React.FC<{ children: React.ReactNode }> } {
  const authContextPath = path.resolve(__dirname, '../src/context/AuthContext.tsx');
  const rawSource = fs.readFileSync(authContextPath, 'utf8');
  const nodeCompatibleSource = rawSource.replace(/\bimport\.meta\.env\.DEV\b/g, 'false');

  const transpiled = ts.transpileModule(nodeCompatibleSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
    fileName: authContextPath,
  }).outputText;

  const moduleMap: Record<string, unknown> = {
    react: React,
    'firebase/auth': firebaseAuth,
    'firebase/firestore': firebaseFirestore,
    '../services/firebase/config': firebaseConfig,
    '../services/authStorage': authStorage,
    '../services/realtimeService': { realtimeService },
    '../mockData/auth/mockUsers': mockUsers,
    '../utils/nativeMobile': nativeMobile,
    '@capacitor/app': capacitorApp,
  };

  const localModule: { exports: any } = { exports: {} };
  const localRequire = (specifier: string) => {
    if (specifier in moduleMap) {
      return moduleMap[specifier];
    }
    throw new Error(`Unexpected import in AuthContext.tsx during test: ${specifier}`);
  };

  const fn = new Function('require', 'module', 'exports', transpiled);
  fn(localRequire, localModule, localModule.exports);
  return localModule.exports;
}

const { AuthProvider } = loadRealAuthContextModule();

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

  public toResponse(status = 200): Response {
    const reader = {
      read: (): Promise<{ done: boolean; value?: Uint8Array }> => {
        if (this.queue.length > 0) {
          return Promise.resolve(this.queue.shift()!);
        }
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

const firebaseResident: UserProfile = {
  id: 'usr-fb-1',
  uid: 'usr-fb-1',
  role: 'resident',
  societyId: 'soc-alpha',
  name: 'Ananya Deshmukh',
  phone: '+919822001122',
  email: 'ananya@alpha.test',
  flatNumber: 'C-204',
  status: 'ACTIVE',
};

describe('ISSUE-06 Phase B.2.3 (F-P2-05): AuthProvider Firebase Sign-Out & Synchronous SSE Disconnect', () => {
  let mockLocalStorage: MockStorage;
  let mockSessionStorage: MockStorage;
  let mockFetch: jest.Mock;
  let windowListeners: Map<string, Set<(ev: any) => void>>;

  beforeEach(() => {
    hookRuntime.reset();
    capturedIdTokenCallback = null;
    mockLocalStorage = new MockStorage();
    mockSessionStorage = new MockStorage();
    mockFetch = jest.fn();
    windowListeners = new Map();

    (global as any).localStorage = mockLocalStorage;
    (global as any).sessionStorage = mockSessionStorage;
    (global as any).fetch = mockFetch;
    (global as any).window = {
      localStorage: mockLocalStorage,
      sessionStorage: mockSessionStorage,
      fetch: mockFetch,
      addEventListener: jest.fn((type: string, cb: (ev: any) => void) => {
        if (!windowListeners.has(type)) windowListeners.set(type, new Set());
        windowListeners.get(type)!.add(cb);
      }),
      removeEventListener: jest.fn((type: string, cb: (ev: any) => void) => {
        windowListeners.get(type)?.delete(cb);
      }),
      dispatchEvent: jest.fn((event: any) => {
        windowListeners.get(event.type)?.forEach((cb) => cb(event));
        return true;
      }),
    };
  });

  afterEach(() => {
    hookRuntime.reset();
    realtimeService.disconnect();
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  test('Firebase !firebaseUser sign-out synchronously disconnects SSE BEFORE clearAuthSession() and rejects late events from old stream', async () => {
    // Seed an active authenticated Firebase session
    authStorage.saveAuthSession(firebaseResident, 'firebase-jwt-live-1', 'firebase');

    const stream = new MockSseStreamController();
    let capturedSignal: AbortSignal | undefined;
    mockFetch.mockImplementationOnce(async (_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return stream.toResponse(200);
    });

    const received: any[] = [];
    const unsubEvent = realtimeService.subscribe('CHILD_SAFETY_SOS_TRIGGERED', (msg) => received.push(msg));

    // Mount real AuthProvider — its useEffect connects realtimeService using the active Firebase session
    hookRuntime.runRender(() => {
      AuthProvider({ children: null });
    });
    await flushMicrotasks();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(capturedSignal?.aborted).toBe(false);
    expect(realtimeService.getConnectionStatus().state).toBe('CONNECTED');
    expect(capturedIdTokenCallback).not.toBeNull();

    // Deliver one legitimate event before sign-out
    stream.pushText(
      `id: evt_fb_before\ndata: {"eventId":"evt_fb_before","topic":"CHILD_SAFETY_SOS_TRIGGERED","location":"Gate 1"}\n\n`
    );
    await flushMicrotasks();
    expect(received).toHaveLength(1);
    expect(realtimeService.getLastEventId()).toBe('evt_fb_before');

    // Instrument call order of realtimeService.disconnect() vs authStorage.clearAuthSession()
    const callOrder: string[] = [];
    let abortedWhenClearAuthRan = false;
    const origDisconnect = realtimeService.disconnect.bind(realtimeService);
    const origClearAuth = authStorage.clearAuthSession;

    jest.spyOn(realtimeService, 'disconnect').mockImplementation(() => {
      callOrder.push('realtimeService.disconnect');
      return origDisconnect();
    });
    jest.spyOn(authStorage, 'clearAuthSession').mockImplementation(() => {
      callOrder.push('clearAuthSession');
      abortedWhenClearAuthRan = Boolean(capturedSignal?.aborted);
      return origClearAuth();
    });

    // Trigger Firebase sign-out (`onIdTokenChanged` fires with `null`)
    await capturedIdTokenCallback!(null);

    // 1. realtimeService.disconnect() MUST have been invoked synchronously BEFORE clearAuthSession()
    expect(callOrder[0]).toBe('realtimeService.disconnect');
    expect(callOrder[1]).toBe('clearAuthSession');
    expect(abortedWhenClearAuthRan).toBe(true);

    // 2. Stream is aborted, status is OFFLINE, and auth token is cleared
    expect(capturedSignal?.aborted).toBe(true);
    expect(realtimeService.getConnectionStatus().state).toBe('OFFLINE');
    expect(authStorage.getAuthToken()).toBeNull();

    // 3. Late event pushed on the old connection after Firebase sign-out MUST be rejected
    stream.pushText(
      `id: evt_fb_late\ndata: {"eventId":"evt_fb_late","topic":"CHILD_SAFETY_SOS_TRIGGERED","location":"Late Leak"}\n\n`
    );
    await flushMicrotasks();
    expect(received).toHaveLength(1);
    expect(realtimeService.getLastEventId()).toBeNull();

    unsubEvent();
  });

  test('Firebase !firebaseUser with invalid non-firebase session also disconnects SSE synchronously BEFORE clearAuthSession()', async () => {
    // Seed a password session then corrupt/invalidate its session flag so isSessionValid() returns false
    authStorage.saveAuthSession(firebaseResident, 'stale-token', 'password');
    const stream = new MockSseStreamController();
    mockFetch.mockResolvedValueOnce(stream.toResponse(200));

    hookRuntime.runRender(() => {
      AuthProvider({ children: null });
    });
    await flushMicrotasks();
    expect(realtimeService.getConnectionStatus().state).toBe('CONNECTED');

    // Simulate invalid session check while provider is not firebase
    jest.spyOn(authStorage, 'isSessionValid').mockReturnValue(false);

    const callOrder: string[] = [];
    const origDisconnect = realtimeService.disconnect.bind(realtimeService);
    const origClearAuth = authStorage.clearAuthSession;
    jest.spyOn(realtimeService, 'disconnect').mockImplementation(() => {
      callOrder.push('realtimeService.disconnect');
      return origDisconnect();
    });
    jest.spyOn(authStorage, 'clearAuthSession').mockImplementation(() => {
      callOrder.push('clearAuthSession');
      return origClearAuth();
    });

    await capturedIdTokenCallback!(null);

    expect(callOrder[0]).toBe('realtimeService.disconnect');
    expect(callOrder[1]).toBe('clearAuthSession');
    expect(realtimeService.getConnectionStatus().state).toBe('OFFLINE');
  });

  test('AuthProvider Strict Mode mount -> unmount cleanup -> remount aborts initial stream and maintains single active connection', async () => {
    authStorage.saveAuthSession(firebaseResident, 'jwt-auth-strict', 'password');

    const stream1 = new MockSseStreamController();
    const stream2 = new MockSseStreamController();
    const signals: AbortSignal[] = [];

    mockFetch
      .mockImplementationOnce(async (_u: string, init?: RequestInit) => {
        if (init?.signal) signals.push(init.signal);
        return stream1.toResponse(200);
      })
      .mockImplementationOnce(async (_u: string, init?: RequestInit) => {
        if (init?.signal) signals.push(init.signal);
        return stream2.toResponse(200);
      });

    // Mount #1
    hookRuntime.runRender(() => {
      AuthProvider({ children: null });
    });
    await flushMicrotasks();
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);

    // Strict Mode simulated unmount cleanup
    hookRuntime.cleanupAll();
    expect(signals[0].aborted).toBe(true);
    expect(realtimeService.getConnectionStatus().state).toBe('OFFLINE');

    // Strict Mode remount #2
    hookRuntime.effects = [];
    hookRuntime.runRender(() => {
      AuthProvider({ children: null });
    });
    await flushMicrotasks();

    expect(signals).toHaveLength(2);
    expect(signals[1].aborted).toBe(false);
    expect(realtimeService.getConnectionStatus().state).toBe('CONNECTED');
  });

  test('AuthProvider lifecycle never opens BroadcastChannel and blocks forged cross-tab domain/emergency events before and after sign-out', async () => {
    const channelInstances: any[] = [];
    class SpyBroadcastChannel {
      public readonly name: string;
      public onmessage: ((ev: { data: any }) => void) | null = null;
      constructor(name: string) {
        this.name = name;
        channelInstances.push(this);
      }
      public postMessage(data: any) {
        for (const peer of channelInstances) {
          if (peer !== this && peer.name === this.name && typeof peer.onmessage === 'function') {
            peer.onmessage({ data });
          }
        }
      }
      public close() {}
    }

    (global as any).BroadcastChannel = SpyBroadcastChannel;
    (global as any).window.BroadcastChannel = SpyBroadcastChannel;

    authStorage.saveAuthSession(firebaseResident, 'firebase-jwt-bc-check', 'firebase');
    const stream = new MockSseStreamController();
    mockFetch.mockResolvedValueOnce(stream.toResponse(200));

    const received: any[] = [];
    const alerts: any[] = [];
    const unsubMsg = realtimeService.subscribe('*', (m) => received.push(m));
    const unsubAlert = realtimeService.subscribeToAlerts((a) => alerts.push(a));

    hookRuntime.runRender(() => {
      AuthProvider({ children: null });
    });
    await flushMicrotasks();

    // AuthProvider + realtimeService MUST NOT open any BroadcastChannel
    expect(channelInstances).toHaveLength(0);

    // Attacker tab attempts to inject forged emergency & resident domain events while authenticated
    const attackerTab = new SpyBroadcastChannel('communityos_realtime_hub');
    attackerTab.postMessage({
      id: 'forged-auth-1',
      topic: 'FIRE_EMERGENCY',
      societyId: firebaseResident.societyId,
      userId: firebaseResident.id,
      payload: { message: 'Spoofed fire' },
    });
    attackerTab.postMessage({
      id: 'forged-auth-2',
      topic: 'VISITOR_ARRIVAL',
      societyId: firebaseResident.societyId,
      payload: { visitorName: 'Spoofed', flatCode: 'C-204' },
    });
    expect(received).toHaveLength(0);
    expect(alerts).toHaveLength(0);

    // Firebase sign-out disconnects SSE and still leaves zero BroadcastChannel listeners
    await capturedIdTokenCallback!(null);
    attackerTab.postMessage({
      id: 'forged-post-logout',
      topic: 'EMERGENCY_ALERT',
      societyId: firebaseResident.societyId,
      payload: { message: 'Post-logout spoof' },
    });
    expect(received).toHaveLength(0);
    expect(alerts).toHaveLength(0);
    expect(channelInstances).toHaveLength(1); // ONLY attackerTab

    unsubMsg();
    unsubAlert();
    delete (global as any).BroadcastChannel;
    delete (global as any).window.BroadcastChannel;
  });
});

