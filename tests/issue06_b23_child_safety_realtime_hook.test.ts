// =============================================================================
// ISSUE-06 Phase B.2.3 — Phase 3 Remediation (F-P3-03):
// Real `useChildSafetyRealtime` React Hook Lifecycle Tests
// Verifies mount, unmount, React Strict Mode double-mount, re-render callback
// ref stability (zero subscription churn, zero stale closures), and session switch.
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

type EffectRecord = {
  fn: () => void | (() => void);
  deps: unknown[] | undefined;
  cleanup?: () => void;
};

const hookRuntime = {
  refs: [] as Array<{ current: unknown }>,
  effects: [] as Array<EffectRecord | undefined>,
  refCursor: 0,
  effectCursor: 0,
  pendingEffects: [] as number[],
  reset() {
    this.unmount();
    this.refs = [];
    this.effects = [];
    this.refCursor = 0;
    this.effectCursor = 0;
    this.pendingEffects = [];
  },
  render(fn: () => void) {
    this.refCursor = 0;
    this.effectCursor = 0;
    this.pendingEffects = [];
    fn();
    this.flushEffects();
  },
  renderStrictModeMount(fn: () => void) {
    // React 18+ StrictMode development behavior: mount -> run effects -> run cleanups -> re-run effects
    this.refCursor = 0;
    this.effectCursor = 0;
    this.pendingEffects = [];
    fn();
    const mountedIndices = [...this.pendingEffects];
    this.flushEffects();

    // Strict Mode simulated cleanup
    for (const idx of mountedIndices) {
      const rec = this.effects[idx];
      if (rec && typeof rec.cleanup === 'function') {
        rec.cleanup();
        rec.cleanup = undefined;
      }
    }

    // Strict Mode simulated remount of effects
    for (const idx of mountedIndices) {
      const rec = this.effects[idx];
      if (!rec) continue;
      const ret = rec.fn();
      if (typeof ret === 'function') {
        rec.cleanup = ret;
      }
    }
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
    useRef: <T>(initial: T) => {
      const idx = hookRuntime.refCursor++;
      if (!(idx in hookRuntime.refs)) {
        hookRuntime.refs[idx] = { current: initial };
      }
      return hookRuntime.refs[idx] as { current: T };
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

jest.mock('../src/utils/backendConfig', () => ({
  getBackendBaseUrl: jest.fn(() => 'http://localhost:5000'),
}));

jest.mock('../src/utils/nativeMobile', () => ({
  triggerHaptic: jest.fn(),
  isNativeApp: jest.fn(() => false),
}));

import { saveAuthSession, clearAuthSession } from '../src/services/authStorage';
import { childSafetyService } from '../src/services/childSafetyService';
import {
  CHILD_SAFETY_REALTIME_TOPICS,
  useChildSafetyRealtime,
} from '../src/hooks/useChildSafetyRealtime';
import type { UserProfile } from '../src/domains/auth/types';
import type { RealtimeConnectionStatus, RealtimeMessage } from '../src/types/realtime';

const createMockRealtimeBus = () => {
  const topicHandlers = new Map<string, Set<(msg: RealtimeMessage) => void>>();
  const statusHandlers = new Set<(status: RealtimeConnectionStatus) => void>();
  let subscribeCalls = 0;
  let statusSubscribeCalls = 0;

  const bus = {
    subscribe: jest.fn((topic: string, cb: (msg: RealtimeMessage) => void) => {
      subscribeCalls += 1;
      if (!topicHandlers.has(topic)) topicHandlers.set(topic, new Set());
      topicHandlers.get(topic)!.add(cb);
      return () => {
        topicHandlers.get(topic)?.delete(cb);
      };
    }),
    subscribeToStatus: jest.fn((cb: (status: RealtimeConnectionStatus) => void) => {
      statusSubscribeCalls += 1;
      statusHandlers.add(cb);
      return () => {
        statusHandlers.delete(cb);
      };
    }),
    emitMessage(topic: string, msg: RealtimeMessage) {
      const handlers = topicHandlers.get(topic);
      if (!handlers) return;
      for (const cb of Array.from(handlers)) {
        cb(msg);
      }
    },
    activeTopicListeners(): number {
      let total = 0;
      for (const set of topicHandlers.values()) total += set.size;
      return total;
    },
    activeStatusListeners(): number {
      return statusHandlers.size;
    },
    getSubscribeCalls: () => subscribeCalls,
    getStatusSubscribeCalls: () => statusSubscribeCalls,
  };

  return bus;
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

describe('ISSUE-06 Phase B.2.3 (Phase 3 Remediation): useChildSafetyRealtime React Hook Lifecycle', () => {
  let mockLS: MockStorage;
  let mockSS: MockStorage;

  beforeEach(() => {
    hookRuntime.reset();
    mockLS = new MockStorage();
    mockSS = new MockStorage();
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
    childSafetyService.clearInMemoryState();
    saveAuthSession(residentAlpha, 'jwt-alpha-hook', 'password');
  });

  afterEach(() => {
    hookRuntime.reset();
    clearAuthSession();
    childSafetyService.clearInMemoryState();
  });

  test('subscribes to all 14 topics + status on mount and cleans up every listener on unmount', () => {
    const bus = createMockRealtimeBus();
    const events: string[] = [];

    hookRuntime.render(() => {
      useChildSafetyRealtime(
        {
          onEvent: (ev) => events.push(ev.id),
        },
        bus
      );
    });

    expect(CHILD_SAFETY_REALTIME_TOPICS).toHaveLength(14);
    expect(bus.activeTopicListeners()).toBe(14);
    expect(bus.activeStatusListeners()).toBe(1);

    bus.emitMessage('CHILD_PROFILE_CREATED', {
      id: 'hk-1',
      topic: 'CHILD_PROFILE_CREATED',
      type: 'CHILD_PROFILE_CREATED',
      societyId: 'soc-alpha',
      payload: { id: 'chd-1', societyId: 'soc-alpha' },
      timestamp: new Date().toISOString(),
      senderRole: 'SYSTEM',
      senderName: 'SSE',
    });
    expect(events).toEqual(['hk-1']);

    // Unmount MUST remove all 14 topic listeners and the status listener
    hookRuntime.unmount();
    expect(bus.activeTopicListeners()).toBe(0);
    expect(bus.activeStatusListeners()).toBe(0);

    // Events emitted after unmount are ignored
    bus.emitMessage('CHILD_PROFILE_UPDATED', {
      id: 'hk-2',
      topic: 'CHILD_PROFILE_UPDATED',
      type: 'CHILD_PROFILE_UPDATED',
      societyId: 'soc-alpha',
      payload: { id: 'chd-1', societyId: 'soc-alpha' },
      timestamp: new Date().toISOString(),
      senderRole: 'SYSTEM',
      senderName: 'SSE',
    });
    expect(events).toEqual(['hk-1']);
  });

  test('handles React Strict Mode mount -> cleanup -> remount with zero leaked subscriptions and single event delivery', () => {
    const bus = createMockRealtimeBus();
    const events: string[] = [];

    hookRuntime.renderStrictModeMount(() => {
      useChildSafetyRealtime(
        {
          onEvent: (ev) => events.push(ev.id),
        },
        bus
      );
    });

    // Strict Mode ran effect twice and cleaned up first pass -> active count MUST be strictly 14 + 1
    expect(bus.activeTopicListeners()).toBe(14);
    expect(bus.activeStatusListeners()).toBe(1);

    bus.emitMessage('CHILD_GATE_PASS_GENERATED', {
      id: 'strict-1',
      topic: 'CHILD_GATE_PASS_GENERATED',
      type: 'CHILD_GATE_PASS_GENERATED',
      societyId: 'soc-alpha',
      payload: { id: 'pass-1', childId: 'chd-1', societyId: 'soc-alpha' },
      timestamp: new Date().toISOString(),
      senderRole: 'SYSTEM',
      senderName: 'SSE',
    });

    // Delivered EXACTLY ONCE (no duplicate Strict Mode subscription)
    expect(events).toEqual(['strict-1']);

    hookRuntime.unmount();
    expect(bus.activeTopicListeners()).toBe(0);
    expect(bus.activeStatusListeners()).toBe(0);
  });

  test('re-rendering with updated callback closures does NOT churn subscriptions, avoids stale closures, and respects session switches & enabled toggle', () => {
    const bus = createMockRealtimeBus();
    const observed: string[] = [];

    const renderWithVersion = (version: string, enabled = true) => {
      hookRuntime.render(() => {
        useChildSafetyRealtime(
          {
            enabled,
            onProfilesChange: (ev) => observed.push(`${version}:${ev.id}:${ev.societyId}`),
          },
          bus
        );
      });
    };

    // Initial mount
    renderWithVersion('v1');
    expect(bus.getSubscribeCalls()).toBe(14);
    expect(bus.getStatusSubscribeCalls()).toBe(1);

    // Re-render multiple times with fresh inline closures (v2, v3)
    renderWithVersion('v2');
    renderWithVersion('v3');

    // CRITICAL: Zero subscription churn across callback re-renders!
    expect(bus.getSubscribeCalls()).toBe(14);
    expect(bus.getStatusSubscribeCalls()).toBe(1);
    expect(bus.activeTopicListeners()).toBe(14);

    // Event invokes LATEST closure (v3), NOT stale v1!
    bus.emitMessage('CHILD_PROFILE_UPDATED', {
      id: 'rerender-1',
      topic: 'CHILD_PROFILE_UPDATED',
      type: 'CHILD_PROFILE_UPDATED',
      societyId: 'soc-alpha',
      payload: { id: 'chd-1', societyId: 'soc-alpha' },
      timestamp: new Date().toISOString(),
      senderRole: 'SYSTEM',
      senderName: 'SSE',
    });
    expect(observed).toEqual(['v3:rerender-1:soc-alpha']);

    // Switch authenticated session to User B (soc-beta) without remounting hook
    clearAuthSession();
    saveAuthSession(residentBeta, 'jwt-beta-hook', 'password');
    renderWithVersion('v4');

    // Stale soc-alpha event MUST be rejected; valid soc-beta event invokes v4
    bus.emitMessage('CHILD_PROFILE_UPDATED', {
      id: 'cross-soc-alpha',
      topic: 'CHILD_PROFILE_UPDATED',
      type: 'CHILD_PROFILE_UPDATED',
      societyId: 'soc-alpha',
      payload: { id: 'chd-1', societyId: 'soc-alpha' },
      timestamp: new Date().toISOString(),
      senderRole: 'SYSTEM',
      senderName: 'SSE',
    });
    bus.emitMessage('CHILD_PROFILE_UPDATED', {
      id: 'beta-ok-1',
      topic: 'CHILD_PROFILE_UPDATED',
      type: 'CHILD_PROFILE_UPDATED',
      societyId: 'soc-beta',
      payload: { id: 'chd-beta', societyId: 'soc-beta' },
      timestamp: new Date().toISOString(),
      senderRole: 'SYSTEM',
      senderName: 'SSE',
    });
    expect(observed).toEqual(['v3:rerender-1:soc-alpha', 'v4:beta-ok-1:soc-beta']);

    // Toggling enabled=false cleanly tears down all 14 listeners
    renderWithVersion('v5', false);
    expect(bus.activeTopicListeners()).toBe(0);
    expect(bus.activeStatusListeners()).toBe(0);

    // Re-enabling restores all 14 listeners
    renderWithVersion('v6', true);
    expect(bus.activeTopicListeners()).toBe(14);
    expect(bus.activeStatusListeners()).toBe(1);
  });
});

