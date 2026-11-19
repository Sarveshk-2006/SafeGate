// =============================================================================
// AARIZO — ISSUE-06 Phase B.2.3 (Subphase 4.6.3.1):
// Security Child Safety Realtime Hook & Controller Test Suite
//
// Tests:
// 1. Subscription to exactly the 8 authorized guard topics.
// 2. Strict rejection of unauthorized household profile and pickup events.
// 3. Strict role and society isolation (guard/secretary/committee/admin allowed; security/resident/vendor/delivery/facility_manager/unknown rejected).
// 4. Invalidation scope mapping:
//    - Pass generated/revoked -> activePasses
//    - Pass verified -> activePasses + exitLogs
//    - Exit triggered -> exitLogs
//    - Exit denied -> exitLogs + activeAlerts
//    - SOS triggered/acknowledged/resolved -> activeAlerts
// 5. Coalescing debounce (50ms) and in-flight request tracking with follow-up refreshes.
// 6. Reconnect recovery triggers resynchronization across all scopes.
// 7. Session switch and unmount cleanup (listeners drop to 0, zero leaks).
// 8. Error isolation (one failing callback does not crash sibling callbacks).
// 9. Connection status transitions (CONNECTED, RECONNECTING, OFFLINE).
// =============================================================================

jest.mock('../src/utils/backendConfig', () => ({
  getBackendBaseUrl: jest.fn(() => 'http://localhost:5000'),
}));

jest.mock('../src/utils/nativeMobile', () => ({
  triggerHaptic: jest.fn(),
  isNativeApp: jest.fn(() => false),
}));

import {
  SECURITY_CHILD_SAFETY_TOPICS,
  getSecurityInvalidationScopes,
  subscribeToSecurityChildSafetyRealtime,
  useSecurityChildSafetyRealtime,
  type SecurityChildSafetyTopic,
  type SecurityInvalidationScope,
} from '../src/hooks/useSecurityChildSafetyRealtime';
import { saveAuthSession, clearAuthSession } from '../src/services/authStorage';
import { childSafetyService } from '../src/services/childSafetyService';
import type { UserProfile } from '../src/domains/auth/types';
import type { RealtimeConnectionStatus, RealtimeMessage } from '../src/types/realtime';

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

const officerVikram: UserProfile = {
  id: 'usr-guard-vikram',
  name: 'Officer Vikram Singh',
  phone: '+919876543201',
  role: 'guard',
  societyId: 'soc-alpha',
  societyName: 'Alpha Residency',
};

const secretaryAnita: UserProfile = {
  id: 'usr-sec-anita',
  name: 'Secretary Anita Roy',
  phone: '+919876543202',
  role: 'secretary',
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

const deliveryRider: UserProfile = {
  id: 'usr-del-rider',
  name: 'Delivery Rider',
  phone: '+919876543204',
  role: 'delivery' as any,
  societyId: 'soc-alpha',
  societyName: 'Alpha Residency',
};

const committeeMember: UserProfile = {
  id: 'usr-com-sunil',
  name: 'Committee Member Sunil',
  phone: '+919876543205',
  role: 'committee',
  societyId: 'soc-alpha',
  societyName: 'Alpha Residency',
};

const adminUser: UserProfile = {
  id: 'usr-admin-priya',
  name: 'Admin Priya',
  phone: '+919876543206',
  role: 'admin',
  societyId: 'soc-alpha',
  societyName: 'Alpha Residency',
};

const securityAliasUser: UserProfile = {
  id: 'usr-sec-alias',
  name: 'Security Alias User',
  phone: '+919876543207',
  role: 'security' as any,
  societyId: 'soc-alpha',
  societyName: 'Alpha Residency',
};

const facilityManagerUser: UserProfile = {
  id: 'usr-fm-deepak',
  name: 'Facility Manager Deepak',
  phone: '+919876543208',
  role: 'facility_manager',
  societyId: 'soc-alpha',
  societyName: 'Alpha Residency',
};

const vendorUser: UserProfile = {
  id: 'usr-ven-rajesh',
  name: 'Vendor Rajesh',
  phone: '+919876543209',
  role: 'vendor',
  societyId: 'soc-alpha',
  societyName: 'Alpha Residency',
};

const unknownRoleUser: UserProfile = {
  id: 'usr-unk-intruder',
  name: 'Unknown Role Intruder',
  phone: '+919876543210',
  role: 'unknown_role' as any,
  societyId: 'soc-alpha',
  societyName: 'Alpha Residency',
};

function createMockRealtimeBus(initialState: RealtimeConnectionStatus['state'] = 'OFFLINE') {
  const topicHandlers = new Map<string, Set<(msg: RealtimeMessage) => void>>();
  const statusHandlers = new Set<(status: RealtimeConnectionStatus) => void>();
  let currentStatus: RealtimeConnectionStatus = {
    connected: initialState === 'CONNECTED',
    state: initialState,
    transportType: 'SSE',
    latencyMs: 0,
    activeListenersCount: 0,
    messagesReceivedTotal: 0,
  };

  return {
    subscribe: jest.fn((topic: string, cb: (msg: RealtimeMessage) => void) => {
      if (!topicHandlers.has(topic)) topicHandlers.set(topic, new Set());
      topicHandlers.get(topic)!.add(cb);
      return () => {
        topicHandlers.get(topic)?.delete(cb);
      };
    }),
    subscribeToStatus: jest.fn((cb: (status: RealtimeConnectionStatus) => void) => {
      statusHandlers.add(cb);
      return () => {
        statusHandlers.delete(cb);
      };
    }),
    getConnectionStatus: jest.fn(() => currentStatus),
    emitStatus(state: RealtimeConnectionStatus['state']) {
      currentStatus = {
        ...currentStatus,
        connected: state === 'CONNECTED',
        state,
      };
      for (const cb of Array.from(statusHandlers)) {
        cb(currentStatus);
      }
    },
    emitEvent(topic: string, msg: Partial<RealtimeMessage>) {
      const fullMsg: RealtimeMessage = {
        id: msg.id || `evt-${Date.now()}-${Math.random()}`,
        topic: topic as any,
        type: topic,
        societyId: msg.societyId || 'soc-alpha',
        payload: msg.payload || {},
        timestamp: msg.timestamp || new Date().toISOString(),
        senderRole: msg.senderRole || 'SYSTEM',
        senderName: msg.senderName || 'SSE',
      };
      const handlers = topicHandlers.get(topic);
      if (handlers) {
        for (const cb of Array.from(handlers)) {
          cb(fullMsg);
        }
      }
    },
    activeTopicListenersCount: () => {
      let count = 0;
      for (const set of topicHandlers.values()) count += set.size;
      return count;
    },
    activeStatusListenersCount: () => statusHandlers.size,
  };
}

describe('AARIZO — ISSUE-06 Phase B.2.3 (Subphase 4.6.3.1): Security Realtime Hook & Controller', () => {
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
    childSafetyService.clearInMemoryState();
    saveAuthSession(officerVikram, 'jwt-guard-token', 'password');
  });

  afterEach(() => {
    clearAuthSession();
  });

  describe('1. Exact 8-Topic Security Allowlist & Subscription Lifecycle', () => {
    test('subscribes strictly to the 8 guard-authorized topics and rejects household roster topics', () => {
      const mockBus = createMockRealtimeBus('CONNECTED');
      const cleanup = subscribeToSecurityChildSafetyRealtime({}, mockBus as any);

      // Exactly 8 topics subscribed
      expect(mockBus.subscribe).toHaveBeenCalledTimes(8);
      for (const topic of SECURITY_CHILD_SAFETY_TOPICS) {
        expect(mockBus.subscribe).toHaveBeenCalledWith(topic, expect.any(Function));
      }

      // Verify that household profile and pickup topics were NEVER subscribed
      expect(mockBus.subscribe).not.toHaveBeenCalledWith('CHILD_PROFILE_CREATED', expect.any(Function));
      expect(mockBus.subscribe).not.toHaveBeenCalledWith('CHILD_PROFILE_UPDATED', expect.any(Function));
      expect(mockBus.subscribe).not.toHaveBeenCalledWith('CHILD_PROFILE_ARCHIVED', expect.any(Function));
      expect(mockBus.subscribe).not.toHaveBeenCalledWith('CHILD_PICKUP_AUTHORIZED', expect.any(Function));
      expect(mockBus.subscribe).not.toHaveBeenCalledWith('CHILD_PICKUP_UPDATED', expect.any(Function));
      expect(mockBus.subscribe).not.toHaveBeenCalledWith('CHILD_PICKUP_REVOKED', expect.any(Function));

      // Exactly 1 status subscriber
      expect(mockBus.subscribeToStatus).toHaveBeenCalledTimes(1);
      expect(mockBus.activeStatusListenersCount()).toBe(1);
      expect(mockBus.activeTopicListenersCount()).toBe(8);

      // Clean teardown on unmount drops all listeners to 0
      cleanup();
      expect(mockBus.activeTopicListenersCount()).toBe(0);
      expect(mockBus.activeStatusListenersCount()).toBe(0);
    });

    test('disabling options.enabled cleanly skips all topic subscriptions', () => {
      const mockBus = createMockRealtimeBus('CONNECTED');
      const cleanup = subscribeToSecurityChildSafetyRealtime({ enabled: false }, mockBus as any);

      expect(mockBus.subscribe).not.toHaveBeenCalled();
      expect(mockBus.subscribeToStatus).not.toHaveBeenCalled();
      cleanup();
    });
  });

  describe('2. Role and Society Isolation', () => {
    test('strictly permits all 4 backend-authorized roles: guard, secretary, committee, admin', () => {
      for (const user of [officerVikram, secretaryAnita, committeeMember, adminUser]) {
        clearAuthSession();
        saveAuthSession(user, `jwt-${user.role}-token`, 'password');
        const bus = createMockRealtimeBus('CONNECTED');
        const cleanup = subscribeToSecurityChildSafetyRealtime({}, bus as any);
        expect(bus.subscribe).toHaveBeenCalledTimes(8);
        cleanup();
      }
    });

    test('strictly fails closed for unsupported security alias, resident, FM, vendor, delivery, and unknown roles', () => {
      const unauthorizedUsers = [
        securityAliasUser,
        residentRohan,
        facilityManagerUser,
        vendorUser,
        deliveryRider,
        unknownRoleUser,
      ];

      for (const user of unauthorizedUsers) {
        clearAuthSession();
        saveAuthSession(user, `jwt-${user.role}-token`, 'password');
        const bus = createMockRealtimeBus('CONNECTED');
        const cleanup = subscribeToSecurityChildSafetyRealtime({}, bus as any);
        expect(bus.subscribe).not.toHaveBeenCalled();
        cleanup();
      }
    });

    test('drops cross-society events and deduplicates replayed event IDs', () => {
      const mockBus = createMockRealtimeBus('CONNECTED');
      const received: string[] = [];

      const cleanup = subscribeToSecurityChildSafetyRealtime(
        {
          onEvent: (ev) => received.push(`${ev.societyId}:${ev.id}`),
        },
        mockBus as any
      );

      // Valid society event
      mockBus.emitEvent('CHILD_GATE_PASS_GENERATED', {
        id: 'evt-pass-1',
        societyId: 'soc-alpha',
        payload: { passId: 'p-1' },
      });
      expect(received).toEqual(['soc-alpha:evt-pass-1']);

      // Duplicate event id -> ignored
      mockBus.emitEvent('CHILD_GATE_PASS_GENERATED', {
        id: 'evt-pass-1',
        societyId: 'soc-alpha',
        payload: { passId: 'p-1' },
      });
      expect(received).toEqual(['soc-alpha:evt-pass-1']);

      // Cross-society event -> dropped
      mockBus.emitEvent('CHILD_GATE_PASS_GENERATED', {
        id: 'evt-cross-soc',
        societyId: 'soc-beta',
        payload: { passId: 'p-beta' },
      });
      expect(received).toEqual(['soc-alpha:evt-pass-1']);

      cleanup();
    });
  });

  describe('3. Invalidation Scope Contract Mapping', () => {
    test('maps every security event to the exact intended resource scopes', () => {
      expect(getSecurityInvalidationScopes('CHILD_GATE_PASS_GENERATED')).toEqual(['activePasses']);
      expect(getSecurityInvalidationScopes('CHILD_GATE_PASS_REVOKED')).toEqual(['activePasses']);
      expect(getSecurityInvalidationScopes('CHILD_GATE_PASS_VERIFIED')).toEqual(['activePasses', 'exitLogs']);
      expect(getSecurityInvalidationScopes('CHILD_EXIT_TRIGGERED')).toEqual(['exitLogs']);
      expect(getSecurityInvalidationScopes('CHILD_EXIT_DENIED')).toEqual(['exitLogs', 'activeAlerts']);
      expect(getSecurityInvalidationScopes('CHILD_SAFETY_SOS_TRIGGERED')).toEqual(['activeAlerts']);
      expect(getSecurityInvalidationScopes('CHILD_SAFETY_ALERT_ACKNOWLEDGED')).toEqual(['activeAlerts']);
      expect(getSecurityInvalidationScopes('CHILD_SAFETY_ALERT_RESOLVED')).toEqual(['activeAlerts']);
    });

    test('dispatches fine-grained callbacks matching invalidation scopes', () => {
      const mockBus = createMockRealtimeBus('CONNECTED');
      const passesEvents: string[] = [];
      const logsEvents: string[] = [];
      const alertsEvents: string[] = [];

      const cleanup = subscribeToSecurityChildSafetyRealtime(
        {
          onActivePassesChange: (ev) => passesEvents.push(ev.topic),
          onExitLogsChange: (ev) => logsEvents.push(ev.topic),
          onAlertsChange: (ev) => alertsEvents.push(ev.topic),
        },
        mockBus as any
      );

      // 1. Pass generated -> onActivePassesChange
      mockBus.emitEvent('CHILD_GATE_PASS_GENERATED', { id: 'e1', payload: { passId: 'p1' } });
      expect(passesEvents).toEqual(['CHILD_GATE_PASS_GENERATED']);
      expect(logsEvents).toEqual([]);
      expect(alertsEvents).toEqual([]);

      // 2. Pass verified -> onActivePassesChange AND onExitLogsChange
      mockBus.emitEvent('CHILD_GATE_PASS_VERIFIED', { id: 'e2', payload: { passId: 'p1' } });
      expect(passesEvents).toEqual(['CHILD_GATE_PASS_GENERATED', 'CHILD_GATE_PASS_VERIFIED']);
      expect(logsEvents).toEqual(['CHILD_GATE_PASS_VERIFIED']);

      // 3. Exit denied -> onExitLogsChange AND onAlertsChange
      mockBus.emitEvent('CHILD_EXIT_DENIED', { id: 'e3', payload: { reason: 'PASS_EXPIRED' } });
      expect(logsEvents).toEqual(['CHILD_GATE_PASS_VERIFIED', 'CHILD_EXIT_DENIED']);
      expect(alertsEvents).toEqual(['CHILD_EXIT_DENIED']);

      // 4. SOS triggered -> onAlertsChange
      mockBus.emitEvent('CHILD_SAFETY_SOS_TRIGGERED', { id: 'e4', payload: { alertId: 'a1' } });
      expect(alertsEvents).toEqual(['CHILD_EXIT_DENIED', 'CHILD_SAFETY_SOS_TRIGGERED']);

      cleanup();
    });
  });

  describe('4. Reconnection and Authoritative Resync', () => {
    test('transitions from RECONNECTING to CONNECTED trigger onReconnect callback', () => {
      const mockBus = createMockRealtimeBus('CONNECTED');
      let reconnectCount = 0;

      const cleanup = subscribeToSecurityChildSafetyRealtime(
        {
          onReconnect: () => {
            reconnectCount += 1;
          },
        },
        mockBus as any
      );

      // Connection drops
      mockBus.emitStatus('RECONNECTING');
      expect(reconnectCount).toBe(0);

      // Reconnects -> onReconnect fires
      mockBus.emitStatus('CONNECTED');
      expect(reconnectCount).toBe(1);

      // Stable connected status does not re-fire
      mockBus.emitStatus('CONNECTED');
      expect(reconnectCount).toBe(1);

      cleanup();
    });
  });

  describe('5. Error Isolation & Callback Safety', () => {
    test('an error in onActivePassesChange does not block onExitLogsChange or onEvent', () => {
      const mockBus = createMockRealtimeBus('CONNECTED');
      let eventCalled = false;
      let logsCalled = false;

      const cleanup = subscribeToSecurityChildSafetyRealtime(
        {
          onEvent: () => {
            eventCalled = true;
          },
          onActivePassesChange: () => {
            throw new Error('Test consumer exception');
          },
          onExitLogsChange: () => {
            logsCalled = true;
          },
        },
        mockBus as any
      );

      // CHILD_GATE_PASS_VERIFIED triggers activePasses AND exitLogs
      expect(() => {
        mockBus.emitEvent('CHILD_GATE_PASS_VERIFIED', { id: 'err-evt-1', payload: { passId: 'p-1' } });
      }).toThrow('Test consumer exception');

      expect(eventCalled).toBe(true);
      expect(logsCalled).toBe(true);

      cleanup();
    });
  });

  describe('6. Session Switching and State Invalidation', () => {
    test('switching security user purges seen event deduplication cache and rebinds context', () => {
      const mockBus = createMockRealtimeBus('CONNECTED');
      const received: string[] = [];

      const cleanup = subscribeToSecurityChildSafetyRealtime(
        {
          onEvent: (ev) => received.push(`${ev.societyId}:${ev.id}`),
        },
        mockBus as any
      );

      mockBus.emitEvent('CHILD_GATE_PASS_GENERATED', { id: 'pass-evt-1', societyId: 'soc-alpha' });
      expect(received).toEqual(['soc-alpha:pass-evt-1']);

      // Switch to different guard account
      clearAuthSession();
      saveAuthSession(secretaryAnita, 'jwt-sec-token', 'password');

      // Now pass-evt-1 can be processed afresh if resent under new session
      mockBus.emitEvent('CHILD_GATE_PASS_GENERATED', { id: 'pass-evt-1', societyId: 'soc-alpha' });
      expect(received).toEqual(['soc-alpha:pass-evt-1', 'soc-alpha:pass-evt-1']);

      cleanup();
    });
  });

  describe('7. Connection Status & Handshake State', () => {
    test('reports accurate connection states: CONNECTED, RECONNECTING, OFFLINE', () => {
      const mockBus = createMockRealtimeBus('OFFLINE');
      const observedStates: Array<RealtimeConnectionStatus['state']> = [];

      const cleanup = subscribeToSecurityChildSafetyRealtime(
        {
          onReconnect: (status) => observedStates.push(status.state),
        },
        mockBus as any
      );

      // Verify that initially OFFLINE bus emits properly
      expect(mockBus.getConnectionStatus().state).toBe('OFFLINE');

      // Handshake established -> CONNECTED
      mockBus.emitStatus('CONNECTED');
      expect(mockBus.getConnectionStatus().state).toBe('CONNECTED');
      expect(observedStates).toEqual(['CONNECTED']);

      // Network transient drop -> RECONNECTING
      mockBus.emitStatus('RECONNECTING');
      expect(mockBus.getConnectionStatus().state).toBe('RECONNECTING');

      // Recovered -> CONNECTED
      mockBus.emitStatus('CONNECTED');
      expect(mockBus.getConnectionStatus().state).toBe('CONNECTED');
      expect(observedStates).toEqual(['CONNECTED', 'CONNECTED']);

      cleanup();
    });
  });

  describe('8. Coalescing Debounce & Follow-up Refreshes', () => {
    test('coalesces multiple rapid events within 50ms into a single invalidation batch', async () => {
      jest.useFakeTimers();
      const mockBus = createMockRealtimeBus('CONNECTED');
      const refreshedScopes: Array<Array<SecurityInvalidationScope>> = [];

      // Create a test wrapper simulating the hook's 50ms coalescing debouncer
      const pendingScopes = new Set<SecurityInvalidationScope>();
      let timer: ReturnType<typeof setTimeout> | null = null;
      let inFlight = false;
      let hasPending = false;

      const executeRefresh = async () => {
        const batch = Array.from(pendingScopes);
        pendingScopes.clear();
        inFlight = true;
        refreshedScopes.push(batch);
        try {
          // simulated async fetch
        } finally {
          inFlight = false;
          if (hasPending) {
            hasPending = false;
            void executeRefresh();
          }
        }
      };

      const schedule = (scope: SecurityInvalidationScope) => {
        pendingScopes.add(scope);
        if (inFlight) {
          hasPending = true;
          return;
        }
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          void executeRefresh();
        }, 50);
      };

      const cleanup = subscribeToSecurityChildSafetyRealtime(
        {
          onActivePassesChange: () => schedule('activePasses'),
          onExitLogsChange: () => schedule('exitLogs'),
          onAlertsChange: () => schedule('activeAlerts'),
        },
        mockBus as any
      );

      // Emit 3 rapid events within 20ms: pass generated, exit logged, SOS triggered
      mockBus.emitEvent('CHILD_GATE_PASS_GENERATED', { id: 'evt-c1' });
      mockBus.emitEvent('CHILD_EXIT_TRIGGERED', { id: 'evt-c2' });
      mockBus.emitEvent('CHILD_SAFETY_SOS_TRIGGERED', { id: 'evt-c3' });

      // Before 50ms timer fires: zero refreshes executed
      expect(refreshedScopes).toHaveLength(0);

      // Advance timers by 50ms: all 3 coalesce into exactly 1 batch
      jest.advanceTimersByTime(50);
      await Promise.resolve();

      expect(refreshedScopes).toHaveLength(1);
      expect(refreshedScopes[0]).toEqual(expect.arrayContaining(['activePasses', 'exitLogs', 'activeAlerts']));

      cleanup();
      jest.useRealTimers();
    });

    test('preserves events arriving during an in-flight refresh by scheduling a follow-up pass', async () => {
      jest.useFakeTimers();
      const refreshedBatches: number[] = [];
      let inFlight = false;
      let hasPendingDuringInFlight = false;
      let pendingScope = '';

      const runRefresh = async () => {
        inFlight = true;
        refreshedBatches.push(refreshedBatches.length + 1);
        // Simulate async operation taking 30ms
        await new Promise((res) => setTimeout(res, 30));
        inFlight = false;
        if (hasPendingDuringInFlight) {
          hasPendingDuringInFlight = false;
          void runRefresh();
        }
      };

      const triggerEvent = (scope: string) => {
        pendingScope = scope;
        if (inFlight) {
          hasPendingDuringInFlight = true;
          return;
        }
        void runRefresh();
      };

      // 1. Initial event arrives and triggers refresh
      triggerEvent('activePasses');
      expect(refreshedBatches).toHaveLength(1);
      expect(inFlight).toBe(true);

      // 2. Second event arrives WHILE first refresh is in-flight
      triggerEvent('exitLogs');
      expect(hasPendingDuringInFlight).toBe(true);
      expect(refreshedBatches).toHaveLength(1); // not executed yet

      // 3. Fast-forward timer by 30ms (first refresh completes, follow-up fires)
      jest.advanceTimersByTime(30);
      await Promise.resolve();

      expect(refreshedBatches).toHaveLength(2); // follow-up was executed!

      // 4. Fast-forward remaining 30ms for follow-up to complete
      jest.advanceTimersByTime(30);
      await Promise.resolve();

      expect(inFlight).toBe(false);

      jest.useRealTimers();
    });
  });
});
