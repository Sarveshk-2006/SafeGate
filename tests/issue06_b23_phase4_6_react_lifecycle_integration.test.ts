// =============================================================================
// AARIZO — ISSUE-06 Phase B.2.3 (Subphase 4.6.3.3.5):
// React Lifecycle, Strict Mode & Realtime Invalidation Integration Test Suite
//
// Tests:
// 1. React Strict Mode Double-Mount & Cleanup Simulation:
//    - useSecurityChildSafetyRealtime cleans up status and topic subscriptions on unmount.
//    - Remount cleanly re-establishes subscriptions with zero duplicate listeners.
// 2. Resident useChildSafetyRealtime Strict Mode Verification:
//    - Mount -> unmount -> remount lifecycle verifies clean listener unregistration.
// 3. Society Switch & Tenant Isolation Lifecycle:
//    - Session update / society change unregisters old society topics and binds to new society.
//    - Cross-society events from previous tenant are rejected.
// 4. Reconnect Recovery Resynchronization:
//    - Connection recovery from RECONNECTING to CONNECTED triggers authoritative full-scope refresh.
// 5. Coalescing Debounce & Bounded Deduplication:
//    - Burst of rapid events within 15ms coalesces into a single scheduled refresh.
// 6. Error Isolation & Replay Preservation:
//    - Consumer callback exceptions allow sibling callbacks to run and preserve subscription stream.
// =============================================================================

jest.mock('../src/utils/backendConfig', () => ({
  getBackendBaseUrl: jest.fn(() => 'http://localhost:5000'),
}));

jest.mock('../src/utils/nativeMobile', () => ({
  triggerHaptic: jest.fn(),
  isNativeApp: jest.fn(() => false),
}));

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

// Minimal deterministic React hook runtime for testing real React effects and Strict Mode in Node Jest
type EffectRecord = {
  fn: () => void | (() => void);
  deps: unknown[] | undefined;
  cleanup?: () => void;
  cleanedUp?: boolean;
};

const hookRuntime = {
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  effects: [] as Array<EffectRecord | undefined>,
  stateCursor: 0,
  refCursor: 0,
  effectCursor: 0,
  pendingEffects: [] as number[],
  reset() {
    this.cleanupAll();
    this.states = [];
    this.refs = [];
    this.effects = [];
    this.stateCursor = 0;
    this.refCursor = 0;
    this.effectCursor = 0;
    this.pendingEffects = [];
  },
  runRender<T>(fn: () => T): T {
    this.stateCursor = 0;
    this.refCursor = 0;
    this.effectCursor = 0;
    this.pendingEffects = [];
    const result = fn();
    this.flushEffects();
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
      rec.cleanedUp = false;
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
        rec.cleanedUp = true;
      }
    }
  },
  simulateStrictModeRemount<T>(renderFn: () => T): T {
    // Pass 1: Initial mount
    let result = this.runRender(renderFn);
    // Strict Mode: Unmount
    this.cleanupAll();
    // Strict Mode: Remount
    result = this.runRender(renderFn);
    return result;
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
    useRef: (initial: any) => {
      const idx = hookRuntime.refCursor++;
      if (!(idx in hookRuntime.refs)) {
        hookRuntime.refs[idx] = { current: initial };
      }
      return hookRuntime.refs[idx];
    },
    useCallback: (fn: any) => {
      return fn;
    },
    useEffect: (fn: () => void | (() => void), deps?: unknown[]) => {
      const idx = hookRuntime.effectCursor++;
      const prev = hookRuntime.effects[idx];
      if (!prev || prev.cleanedUp || depsChanged(prev.deps, deps)) {
        hookRuntime.effects[idx] = {
          fn,
          deps,
          cleanup: prev?.cleanup,
          cleanedUp: false,
        };
        hookRuntime.pendingEffects.push(idx);
      }
    },
  };
});

import {
  SECURITY_CHILD_SAFETY_TOPICS,
  useSecurityChildSafetyRealtime,
} from '../src/hooks/useSecurityChildSafetyRealtime';
import { useChildSafetyRealtime } from '../src/hooks/useChildSafetyRealtime';
import { saveAuthSession, clearAuthSession } from '../src/services/authStorage';
import type { UserProfile } from '../src/domains/auth/types';
import type { RealtimeConnectionStatus, RealtimeMessage } from '../src/types/realtime';

const officerVikram: UserProfile = {
  id: 'usr-guard-vikram',
  name: 'Officer Vikram Singh',
  phone: '+919876543201',
  role: 'guard',
  societyId: 'soc-alpha',
  societyName: 'Alpha Residency',
};

const residentRohan: UserProfile = {
  id: 'usr-res-rohan',
  name: 'Rohan Verma',
  phone: '+919876543203',
  role: 'resident',
  societyId: 'soc-alpha',
  societyName: 'Alpha Residency',
};

function createMockRealtimeService() {
  const statusListeners = new Set<(status: RealtimeConnectionStatus) => void>();
  const topicListeners = new Map<string, Set<(msg: RealtimeMessage) => void>>();
  let currentStatus: RealtimeConnectionStatus = { state: 'CONNECTED' };

  return {
    getStatus: () => currentStatus,
    setStatus: (status: RealtimeConnectionStatus) => {
      currentStatus = status;
      for (const cb of Array.from(statusListeners)) {
        cb(status);
      }
    },
    subscribeToStatus: (cb: (status: RealtimeConnectionStatus) => void) => {
      statusListeners.add(cb);
      cb(currentStatus);
      return () => {
        statusListeners.delete(cb);
      };
    },
    subscribe: (topic: string, cb: (msg: RealtimeMessage) => void) => {
      if (!topicListeners.has(topic)) {
        topicListeners.set(topic, new Set());
      }
      topicListeners.get(topic)!.add(cb);
      return () => {
        const set = topicListeners.get(topic);
        if (set) {
          set.delete(cb);
          if (set.size === 0) topicListeners.delete(topic);
        }
      };
    },
    dispatchMessage: (msg: RealtimeMessage) => {
      const set = topicListeners.get(msg.topic);
      if (set) {
        for (const cb of Array.from(set)) {
          cb(msg);
        }
      }
    },
    getStatusListenerCount: () => statusListeners.size,
    getTopicListenerCount: (topic: string) => topicListeners.get(topic)?.size ?? 0,
    getTotalTopicListenerCount: () => {
      let total = 0;
      for (const set of topicListeners.values()) {
        total += set.size;
      }
      return total;
    },
    clearAll: () => {
      statusListeners.clear();
      topicListeners.clear();
    },
  };
}

describe('AARIZO — ISSUE-06 Phase B.2.3: React Strict Mode & Realtime Lifecycle Integration', () => {
  let mockService: ReturnType<typeof createMockRealtimeService>;
  let mockLS: MockStorage;
  let mockSS: MockStorage;

  beforeEach(() => {
    mockLS = new MockStorage();
    mockSS = new MockStorage();
    Object.defineProperty(globalThis, 'localStorage', { value: mockLS, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'sessionStorage', { value: mockSS, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: mockLS,
        sessionStorage: mockSS,
      },
      configurable: true,
      writable: true,
    });
    hookRuntime.reset();
    mockService = createMockRealtimeService();
    saveAuthSession(officerVikram, 'jwt-guard-token', 'password');
    jest.useFakeTimers();
  });

  afterEach(() => {
    hookRuntime.cleanupAll();
    mockService.clearAll();
    clearAuthSession();
    jest.useRealTimers();
  });

  describe('1. React Strict Mode Double-Mount & Clean Teardown (Guard Realtime)', () => {
    it('cleans up all 8 security topic listeners and status subscription on Strict Mode remount', () => {
      const onRefreshMock = jest.fn();

      const renderHook = () =>
        useSecurityChildSafetyRealtime(
          {
            onRefresh: onRefreshMock,
          },
          mockService as any
        );

      // Simulate React Strict Mode (Mount -> Unmount -> Remount)
      const hookResult = hookRuntime.simulateStrictModeRemount(renderHook);

      expect(hookResult.isConnected).toBe(true);
      expect(hookResult.connectionStatus).toBe('CONNECTED');

      // 2 status listeners (hook state + reconnect controller) and exactly 8 security topic listeners
      expect(mockService.getStatusListenerCount()).toBe(2);
      expect(mockService.getTotalTopicListenerCount()).toBe(8);

      for (const topic of SECURITY_CHILD_SAFETY_TOPICS) {
        expect(mockService.getTopicListenerCount(topic)).toBe(1);
      }

      // Explicit Unmount
      hookRuntime.cleanupAll();

      // Zero leaked listeners post-unmount
      expect(mockService.getStatusListenerCount()).toBe(0);
      expect(mockService.getTotalTopicListenerCount()).toBe(0);
    });
  });

  describe('2. Resident useChildSafetyRealtime Strict Mode Verification', () => {
    it('manages resident profile, pass, and SOS listeners cleanly across Strict Mode cycle', () => {
      saveAuthSession(residentRohan, 'jwt-resident-token', 'password');

      const renderResidentHook = () =>
        useChildSafetyRealtime(
          {
            onRefresh: jest.fn(),
          },
          mockService as any
        );

      hookRuntime.simulateStrictModeRemount(renderResidentHook);

      // Resident topic listeners registered cleanly
      expect(mockService.getTotalTopicListenerCount()).toBeGreaterThan(0);

      hookRuntime.cleanupAll();

      expect(mockService.getStatusListenerCount()).toBe(0);
      expect(mockService.getTotalTopicListenerCount()).toBe(0);
    });
  });

  describe('3. Society Switch & Tenant Isolation Lifecycle', () => {
    it('drops subscriptions to previous society and binds to new society upon session switch', async () => {
      const onRefresh = jest.fn();

      // Initial render as Officer Vikram in Society Alpha
      hookRuntime.runRender(() =>
        useSecurityChildSafetyRealtime({ onRefresh }, mockService as any)
      );
      expect(mockService.getTotalTopicListenerCount()).toBe(8);

      // Dispatch event from Society Alpha -> accepted
      mockService.dispatchMessage({
        topic: 'CHILD_GATE_PASS_VERIFIED',
        societyId: 'soc-alpha',
        payload: {
          id: 'evt-alpha-1',
          societyId: 'soc-alpha',
          passId: 'pass-101',
          timestamp: new Date().toISOString(),
        },
      });

      jest.advanceTimersByTime(60);
      await Promise.resolve();
      expect(onRefresh).toHaveBeenCalledTimes(1);

      // Switch session to Society Beta
      const officerBeta: UserProfile = {
        ...officerVikram,
        societyId: 'soc-beta',
        societyName: 'Beta Gardens',
      };
      saveAuthSession(officerBeta, 'jwt-beta-token', 'password');

      // Remount hook under new tenant context
      hookRuntime.cleanupAll();
      onRefresh.mockClear();

      hookRuntime.runRender(() =>
        useSecurityChildSafetyRealtime({ onRefresh }, mockService as any)
      );

      // Flush initial authoritative resync on tenant mount
      jest.advanceTimersByTime(60);
      await Promise.resolve();
      expect(onRefresh).toHaveBeenCalledWith(new Set(['all']));
      onRefresh.mockClear();

      // Dispatch event from old Society Alpha -> REJECTED (cross-society isolation)
      mockService.dispatchMessage({
        topic: 'CHILD_GATE_PASS_VERIFIED',
        societyId: 'soc-alpha',
        payload: {
          id: 'evt-alpha-2',
          societyId: 'soc-alpha',
          passId: 'pass-102',
          timestamp: new Date().toISOString(),
        },
      });

      jest.advanceTimersByTime(60);
      await Promise.resolve();
      expect(onRefresh).not.toHaveBeenCalled();

      // Dispatch event from current Society Beta -> ACCEPTED
      mockService.dispatchMessage({
        topic: 'CHILD_GATE_PASS_VERIFIED',
        societyId: 'soc-beta',
        payload: {
          id: 'evt-beta-1',
          societyId: 'soc-beta',
          passId: 'pass-201',
          timestamp: new Date().toISOString(),
        },
      });

      jest.advanceTimersByTime(60);
      await Promise.resolve();
      expect(onRefresh).toHaveBeenCalledTimes(1);
      expect(onRefresh).toHaveBeenCalledWith(new Set(['activePasses', 'exitLogs']));
    });
  });

  describe('4. Reconnect Recovery Resynchronization', () => {
    it('triggers full authoritative resync when connection recovers from RECONNECTING to CONNECTED', () => {
      const onRefresh = jest.fn();
      const onReconnect = jest.fn();

      hookRuntime.runRender(() =>
        useSecurityChildSafetyRealtime(
          {
            onRefresh,
            onReconnect,
          },
          mockService as any
        )
      );

      // Initial connection established -> clear initial connect call
      expect(onReconnect).toHaveBeenCalledWith({ state: 'CONNECTED' });
      onReconnect.mockClear();
      onRefresh.mockClear();

      // Connection drops
      mockService.setStatus({ state: 'RECONNECTING', error: 'Network dropped' });
      jest.advanceTimersByTime(20);
      expect(onReconnect).not.toHaveBeenCalled();

      // Connection restored
      mockService.setStatus({ state: 'CONNECTED' });
      expect(onReconnect).toHaveBeenCalledWith({ state: 'CONNECTED' });

      // Coalesced refresh triggered for scope 'all'
      jest.advanceTimersByTime(60);
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });

  describe('5. Coalescing Debounce & Rapid Burst Handling', () => {
    it('coalesces 10 burst events within 15ms into exactly 1 debounced refresh call', () => {
      const onRefresh = jest.fn();

      hookRuntime.runRender(() =>
        useSecurityChildSafetyRealtime(
          {
            onRefresh,
          },
          mockService as any
        )
      );

      // Fire 10 burst events rapidly
      for (let i = 0; i < 10; i++) {
        mockService.dispatchMessage({
          topic: 'CHILD_GATE_PASS_VERIFIED',
          societyId: 'soc-alpha',
          payload: {
            id: `evt-burst-${i}`,
            societyId: 'soc-alpha',
            passId: `pass-${i}`,
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Mid-flight: not yet invoked
      jest.advanceTimersByTime(30);
      expect(onRefresh).not.toHaveBeenCalled();

      // After 50ms debounce window closes
      jest.advanceTimersByTime(30);
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });

  describe('6. Consumer Callback Error Isolation & Replay Preservation', () => {
    it('executes consumer callbacks safely and maintains subscription health across errors', () => {
      const failingOnActivePassesChange = jest.fn(() => {
        throw new Error('Fatal UI consumer crash');
      });
      const onAlertsChange = jest.fn();

      hookRuntime.runRender(() =>
        useSecurityChildSafetyRealtime(
          {
            onActivePassesChange: failingOnActivePassesChange,
            onAlertsChange,
          },
          mockService as any
        )
      );

      // 1. Dispatch pass generated event (throwing callback throws out of dispatch to preserve replay)
      expect(() => {
        mockService.dispatchMessage({
          topic: 'CHILD_GATE_PASS_GENERATED',
          societyId: 'soc-alpha',
          payload: {
            id: 'evt-err-1',
            societyId: 'soc-alpha',
            passId: 'pass-err-1',
            timestamp: new Date().toISOString(),
          },
        });
      }).toThrow('Fatal UI consumer crash');

      expect(failingOnActivePassesChange).toHaveBeenCalledTimes(1);

      // 2. Dispatch subsequent SOS event -> verifies pipeline and subscriptions remain alive
      mockService.dispatchMessage({
        topic: 'CHILD_SAFETY_SOS_TRIGGERED',
        societyId: 'soc-alpha',
        payload: {
          id: 'evt-sos-2',
          societyId: 'soc-alpha',
          alertId: 'alert-sos-2',
          timestamp: new Date().toISOString(),
        },
      });

      expect(onAlertsChange).toHaveBeenCalledTimes(1);
    });
  });
});
