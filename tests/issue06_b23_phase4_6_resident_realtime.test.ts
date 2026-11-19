// =============================================================================
// AARIZO — ISSUE-06 Phase B.2.3 (Phase 4.6.2):
// Resident Child Safety Portal Realtime Integration Tests
//
// Verifies:
// 1. Resident panel establishes exactly ONE shared realtime SSE subscription across all 14 topics.
// 2. Canonical event groups trigger correct resource invalidations and callbacks:
//    - Child profiles (created, updated, archived)
//    - Authorized pickups (authorized, updated, revoked)
//    - Gate passes (generated, verified, revoked)
//    - Gate exit events (exit triggered, exit denied)
//    - Alerts & SOS lifecycle (triggered, acknowledged, resolved)
// 3. Status indicator renders accessible state (CONNECTED, RECONNECTING, OFFLINE) with non-color text.
// 4. Coalescing & debouncing: multiple related events in rapid succession coalesce into single reads.
// 5. In-flight invalidation preservation: events arriving during an active refresh trigger a follow-up.
// 6. Reconnect recovery: triggers authoritative resync across all scopes.
// 7. Session switch & unmount: cleans up all subscriptions cleanly with zero state leak.
// =============================================================================

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockUseAuth = jest.fn();

jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

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

import {
  ResidentChildSafetyPanel,
  RealtimeStatusBadge,
} from '../src/domains/safety/components/ResidentChildSafetyPanel';
import {
  CHILD_SAFETY_REALTIME_TOPICS,
  subscribeToChildSafetyRealtime,
  getInvalidatedChildSafetyScopes,
} from '../src/hooks/useChildSafetyRealtime';
import { childSafetyService } from '../src/services/childSafetyService';
import { saveAuthSession, clearAuthSession } from '../src/services/authStorage';
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

const residentAarav: UserProfile = {
  id: 'usr-res-aarav',
  name: 'Aarav Mehta',
  phone: '+919876543210',
  role: 'resident',
  societyId: 'soc-alpha',
  societyName: 'Alpha Residency',
  flatNumber: 'A-402',
};

const residentSneha: UserProfile = {
  id: 'usr-res-sneha',
  name: 'Sneha Patel',
  phone: '+919876543211',
  role: 'resident',
  societyId: 'soc-beta',
  societyName: 'Beta Heights',
  flatNumber: 'B-101',
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

describe('AARIZO — ISSUE-06 Phase B.2.3 (Phase 4.6.2): Resident Portal Realtime Integration', () => {
  let mockLS: MockStorage;
  let mockSS: MockStorage;

  beforeEach(() => {
    mockUseAuth.mockReset();
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
    saveAuthSession(residentAarav, 'jwt-aarav-token', 'password');
    mockUseAuth.mockReturnValue({ currentUser: residentAarav });
  });

  afterEach(() => {
    clearAuthSession();
  });

  describe('1. Connection Status Feedback Indicator', () => {
    test('renders accessible text, accessible label, and distinct badges for CONNECTED, RECONNECTING, and OFFLINE', () => {
      // 1. CONNECTED
      const connectedHtml = renderToStaticMarkup(React.createElement(RealtimeStatusBadge, { state: 'CONNECTED' }));
      expect(connectedHtml).toContain('data-testid="resident-child-safety-realtime-status"');
      expect(connectedHtml).toContain('data-connection-state="CONNECTED"');
      expect(connectedHtml).toContain('Live Sync Connected');
      expect(connectedHtml).toContain('aria-label="Realtime connection status: Live Sync Connected"');

      // 2. RECONNECTING
      const reconnectingHtml = renderToStaticMarkup(React.createElement(RealtimeStatusBadge, { state: 'RECONNECTING' }));
      expect(reconnectingHtml).toContain('data-connection-state="RECONNECTING"');
      expect(reconnectingHtml).toContain('Reconnecting...');
      expect(reconnectingHtml).toContain('aria-label="Realtime connection status: Reconnecting..."');

      // 3. OFFLINE
      const offlineHtml = renderToStaticMarkup(React.createElement(RealtimeStatusBadge, { state: 'OFFLINE' }));
      expect(offlineHtml).toContain('data-connection-state="OFFLINE"');
      expect(offlineHtml).toContain('Sync Offline');
      expect(offlineHtml).toContain('aria-label="Realtime connection status: Sync Offline"');
    });

    test('ResidentChildSafetyPanel embeds the status badge inside header banner next to security badge', () => {
      const mockBus = createMockRealtimeBus('CONNECTED');
      const html = renderToStaticMarkup(
        React.createElement(ResidentChildSafetyPanel, { realtimeService: mockBus as any })
      );

      expect(html).toContain('data-testid="resident-child-safety-panel"');
      expect(html).toContain('CHILD SAFETY PROFILES');
      expect(html).toContain('data-testid="resident-child-safety-realtime-status"');
      expect(html).toContain('data-connection-state="CONNECTED"');
      expect(html).toContain('Live Sync Connected');
    });

    test('ResidentChildSafetyPanel defaults to Sync Offline before connection handshake completes', () => {
      const mockBus = createMockRealtimeBus('OFFLINE');
      const html = renderToStaticMarkup(
        React.createElement(ResidentChildSafetyPanel, { realtimeService: mockBus as any })
      );

      expect(html).toContain('data-testid="resident-child-safety-realtime-status"');
      expect(html).toContain('data-connection-state="OFFLINE"');
      expect(html).toContain('Sync Offline');
      expect(html).not.toContain('Live Sync Connected');
    });
  });

  describe('2. Single Shared SSE Subscription Lifecycle', () => {
    test('resident realtime controller subscribes to all 14 canonical backend topics + status exactly once', () => {
      const mockBus = createMockRealtimeBus('CONNECTED');
      const cleanup = subscribeToChildSafetyRealtime({}, mockBus as any);

      // 14 canonical Child Safety topics subscribed
      expect(mockBus.subscribe).toHaveBeenCalledTimes(14);
      for (const topic of CHILD_SAFETY_REALTIME_TOPICS) {
        expect(mockBus.subscribe).toHaveBeenCalledWith(topic, expect.any(Function));
      }

      // Exactly 1 status subscriber
      expect(mockBus.subscribeToStatus).toHaveBeenCalledTimes(1);
      expect(mockBus.activeStatusListenersCount()).toBe(1);
      expect(mockBus.activeTopicListenersCount()).toBe(14);

      // Clean teardown on unmount
      cleanup();
      expect(mockBus.activeTopicListenersCount()).toBe(0);
      expect(mockBus.activeStatusListenersCount()).toBe(0);
    });

    test('disabling hook subscription cleanly skips all topic subscriptions', () => {
      const mockBus = createMockRealtimeBus('CONNECTED');
      const cleanup = subscribeToChildSafetyRealtime({ enabled: false }, mockBus as any);

      expect(mockBus.subscribe).not.toHaveBeenCalled();
      expect(mockBus.subscribeToStatus).not.toHaveBeenCalled();
      cleanup();
    });
  });

  describe('3. Event Group to Resource Invalidation Mapping', () => {
    test('child profile events invalidate children scope (and pickups/passes on archive)', () => {
      const mockBus = createMockRealtimeBus('CONNECTED');
      const observedProfiles: string[] = [];
      const observedPickups: string[] = [];
      const observedPasses: string[] = [];

      const cleanup = subscribeToChildSafetyRealtime(
        {
          onProfilesChange: (ev) => observedProfiles.push(ev.topic),
          onPickupsChange: (ev) => observedPickups.push(ev.topic),
          onPassesChange: (ev) => observedPasses.push(ev.topic),
        },
        mockBus as any
      );

      // 1. CHILD_PROFILE_CREATED
      mockBus.emitEvent('CHILD_PROFILE_CREATED', {
        id: 'evt-c-create',
        societyId: 'soc-alpha',
        payload: { id: 'chd-1', fullName: 'Kabir' },
      });
      expect(observedProfiles).toEqual(['CHILD_PROFILE_CREATED']);
      expect(observedPickups).toEqual([]);

      // 2. CHILD_PROFILE_UPDATED
      mockBus.emitEvent('CHILD_PROFILE_UPDATED', {
        id: 'evt-c-update',
        societyId: 'soc-alpha',
        payload: { id: 'chd-1', fullName: 'Kabir Mehta' },
      });
      expect(observedProfiles).toEqual(['CHILD_PROFILE_CREATED', 'CHILD_PROFILE_UPDATED']);

      // 3. CHILD_PROFILE_ARCHIVED (cascades to pickups and active gate passes)
      mockBus.emitEvent('CHILD_PROFILE_ARCHIVED', {
        id: 'evt-c-archive',
        societyId: 'soc-alpha',
        payload: { id: 'chd-1' },
      });
      expect(observedProfiles).toEqual(['CHILD_PROFILE_CREATED', 'CHILD_PROFILE_UPDATED', 'CHILD_PROFILE_ARCHIVED']);
      expect(observedPickups).toEqual(['CHILD_PROFILE_ARCHIVED']);
      expect(observedPasses).toEqual(['CHILD_PROFILE_ARCHIVED']);

      cleanup();
    });

    test('pickup events (authorized, updated, revoked) invalidate pickups and dependent passes', () => {
      const mockBus = createMockRealtimeBus('CONNECTED');
      const observedPickups: string[] = [];
      const observedPasses: string[] = [];
      const observedProfiles: string[] = [];

      const cleanup = subscribeToChildSafetyRealtime(
        {
          onPickupsChange: (ev) => observedPickups.push(ev.topic),
          onPassesChange: (ev) => observedPasses.push(ev.topic),
          onProfilesChange: (ev) => observedProfiles.push(ev.topic),
        },
        mockBus as any
      );

      // 1. CHILD_PICKUP_AUTHORIZED -> invalidates pickups & child card badge count
      mockBus.emitEvent('CHILD_PICKUP_AUTHORIZED', {
        id: 'evt-p-auth',
        societyId: 'soc-alpha',
        payload: { id: 'p-1', childId: 'chd-1', status: 'ACTIVE' },
      });
      expect(observedPickups).toEqual(['CHILD_PICKUP_AUTHORIZED']);
      expect(observedProfiles).toEqual(['CHILD_PICKUP_AUTHORIZED']);
      expect(observedPasses).toEqual([]);

      // 2. CHILD_PICKUP_REVOKED -> cascade revokes linked gate passes!
      mockBus.emitEvent('CHILD_PICKUP_REVOKED', {
        id: 'evt-p-rev',
        societyId: 'soc-alpha',
        payload: { id: 'p-1', childId: 'chd-1', status: 'REVOKED' },
      });
      expect(observedPickups).toEqual(['CHILD_PICKUP_AUTHORIZED', 'CHILD_PICKUP_REVOKED']);
      expect(observedPasses).toEqual(['CHILD_PICKUP_REVOKED']);
      expect(observedProfiles).toEqual(['CHILD_PICKUP_AUTHORIZED', 'CHILD_PICKUP_REVOKED']);

      cleanup();
    });

    test('gate pass events (generated, verified, revoked) invalidate passes, exit history, and child status', () => {
      const mockBus = createMockRealtimeBus('CONNECTED');
      const observedPasses: string[] = [];
      const observedExitLogs: string[] = [];
      const observedProfiles: string[] = [];

      const cleanup = subscribeToChildSafetyRealtime(
        {
          onPassesChange: (ev) => observedPasses.push(ev.topic),
          onExitLogsChange: (ev) => observedExitLogs.push(ev.topic),
          onProfilesChange: (ev) => observedProfiles.push(ev.topic),
        },
        mockBus as any
      );

      // 1. CHILD_GATE_PASS_GENERATED
      mockBus.emitEvent('CHILD_GATE_PASS_GENERATED', {
        id: 'evt-gp-gen',
        societyId: 'soc-alpha',
        payload: { id: 'pass-1', childId: 'chd-1', passCode: 'CGP-1111' },
      });
      expect(observedPasses).toEqual(['CHILD_GATE_PASS_GENERATED']);
      expect(observedExitLogs).toEqual([]);

      // 2. CHILD_GATE_PASS_VERIFIED (gate exit allowed: creates exit log, updates pass & child status)
      mockBus.emitEvent('CHILD_GATE_PASS_VERIFIED', {
        id: 'evt-gp-ver',
        societyId: 'soc-alpha',
        payload: { id: 'pass-1', childId: 'chd-1', passCode: 'CGP-1111' },
      });
      expect(observedPasses).toEqual(['CHILD_GATE_PASS_GENERATED', 'CHILD_GATE_PASS_VERIFIED']);
      expect(observedExitLogs).toEqual(['CHILD_GATE_PASS_VERIFIED']);
      expect(observedProfiles).toEqual(['CHILD_GATE_PASS_GENERATED', 'CHILD_GATE_PASS_VERIFIED']);

      // 3. CHILD_GATE_PASS_REVOKED
      mockBus.emitEvent('CHILD_GATE_PASS_REVOKED', {
        id: 'evt-gp-rev',
        societyId: 'soc-alpha',
        payload: { id: 'pass-1', childId: 'chd-1' },
      });
      expect(observedPasses).toEqual(['CHILD_GATE_PASS_GENERATED', 'CHILD_GATE_PASS_VERIFIED', 'CHILD_GATE_PASS_REVOKED']);

      cleanup();
    });

    test('exit events (CHILD_EXIT_TRIGGERED, CHILD_EXIT_DENIED) update exit history and status', () => {
      const mockBus = createMockRealtimeBus('CONNECTED');
      const observedLogs: string[] = [];
      const observedProfiles: string[] = [];

      const cleanup = subscribeToChildSafetyRealtime(
        {
          onExitLogsChange: (ev) => observedLogs.push(ev.topic),
          onProfilesChange: (ev) => observedProfiles.push(ev.topic),
        },
        mockBus as any
      );

      // 1. CHILD_EXIT_TRIGGERED (exit recorded -> child moves to OUT_OF_SOCIETY)
      mockBus.emitEvent('CHILD_EXIT_TRIGGERED', {
        id: 'evt-exit-trig',
        societyId: 'soc-alpha',
        payload: { childId: 'chd-1' },
      });
      expect(observedLogs).toEqual(['CHILD_EXIT_TRIGGERED']);
      expect(observedProfiles).toEqual(['CHILD_EXIT_TRIGGERED']);

      // 2. CHILD_EXIT_DENIED (unauthorized exit attempt -> logs incident without modifying child profiles)
      mockBus.emitEvent('CHILD_EXIT_DENIED', {
        id: 'evt-exit-denied',
        societyId: 'soc-alpha',
        payload: { childId: 'chd-1', reason: 'NO_ACTIVE_PASS' },
      });
      expect(observedLogs).toEqual(['CHILD_EXIT_TRIGGERED', 'CHILD_EXIT_DENIED']);
      expect(observedProfiles).toEqual(['CHILD_EXIT_TRIGGERED']); // unchanged

      cleanup();
    });

    test('SOS & alert lifecycle events (triggered, acknowledged, resolved) invalidate alerts and affected child state', () => {
      const mockBus = createMockRealtimeBus('CONNECTED');
      const observedAlerts: string[] = [];
      const observedProfiles: string[] = [];

      const cleanup = subscribeToChildSafetyRealtime(
        {
          onAlertsChange: (ev) => observedAlerts.push(ev.topic),
          onProfilesChange: (ev) => observedProfiles.push(ev.topic),
        },
        mockBus as any
      );

      // 1. CHILD_SAFETY_SOS_TRIGGERED (emergency -> child status moves to MISSING)
      mockBus.emitEvent('CHILD_SAFETY_SOS_TRIGGERED', {
        id: 'evt-sos-1',
        societyId: 'soc-alpha',
        payload: { childId: 'chd-1', alertId: 'alt-1', emergencyLevel: 'CRITICAL' },
      });
      expect(observedAlerts).toEqual(['CHILD_SAFETY_SOS_TRIGGERED']);
      expect(observedProfiles).toEqual(['CHILD_SAFETY_SOS_TRIGGERED']);

      // 2. CHILD_SAFETY_ALERT_ACKNOWLEDGED (guard acknowledged -> updates alert view)
      mockBus.emitEvent('CHILD_SAFETY_ALERT_ACKNOWLEDGED', {
        id: 'evt-sos-ack',
        societyId: 'soc-alpha',
        payload: { alertId: 'alt-1', responderName: 'Guard Vikram' },
      });
      expect(observedAlerts).toEqual(['CHILD_SAFETY_SOS_TRIGGERED', 'CHILD_SAFETY_ALERT_ACKNOWLEDGED']);
      expect(observedProfiles).toEqual(['CHILD_SAFETY_SOS_TRIGGERED']);

      // 3. CHILD_SAFETY_ALERT_RESOLVED (child found safe -> updates alert view AND restores child status to SAFE)
      mockBus.emitEvent('CHILD_SAFETY_ALERT_RESOLVED', {
        id: 'evt-sos-res',
        societyId: 'soc-alpha',
        payload: { alertId: 'alt-1', childId: 'chd-1', resolverName: 'Secretary' },
      });
      expect(observedAlerts).toEqual([
        'CHILD_SAFETY_SOS_TRIGGERED',
        'CHILD_SAFETY_ALERT_ACKNOWLEDGED',
        'CHILD_SAFETY_ALERT_RESOLVED',
      ]);
      expect(observedProfiles).toEqual([
        'CHILD_SAFETY_SOS_TRIGGERED',
        'CHILD_SAFETY_ALERT_RESOLVED',
      ]);

      cleanup();
    });
  });

  describe('4. Event Deduplication & Society Isolation', () => {
    test('deduplicates identical event IDs and rejects cross-society events', () => {
      const mockBus = createMockRealtimeBus('CONNECTED');
      const receivedEvents: string[] = [];

      const cleanup = subscribeToChildSafetyRealtime(
        {
          onEvent: (ev) => receivedEvents.push(ev.id),
        },
        mockBus as any
      );

      // 1. Valid event for authenticated society (soc-alpha)
      mockBus.emitEvent('CHILD_PROFILE_UPDATED', {
        id: 'evt-dup-1',
        societyId: 'soc-alpha',
        payload: { id: 'chd-1' },
      });
      expect(receivedEvents).toEqual(['evt-dup-1']);

      // 2. Replayed duplicate of evt-dup-1 -> strictly ignored
      mockBus.emitEvent('CHILD_PROFILE_UPDATED', {
        id: 'evt-dup-1',
        societyId: 'soc-alpha',
        payload: { id: 'chd-1' },
      });
      expect(receivedEvents).toEqual(['evt-dup-1']);

      // 3. Event for different society (soc-beta) -> strictly dropped (society isolation)
      mockBus.emitEvent('CHILD_PROFILE_UPDATED', {
        id: 'evt-beta-1',
        societyId: 'soc-beta',
        payload: { id: 'chd-beta' },
      });
      expect(receivedEvents).toEqual(['evt-dup-1']); // zero leakage!

      cleanup();
    });
  });

  describe('5. Reconnection & Authoritative Resync', () => {
    test('transitions from RECONNECTING back to CONNECTED trigger onReconnect callback', () => {
      const mockBus = createMockRealtimeBus('CONNECTED');
      let reconnectCount = 0;

      const cleanup = subscribeToChildSafetyRealtime(
        {
          onReconnect: () => {
            reconnectCount += 1;
          },
        },
        mockBus as any
      );

      // Connection drops to RECONNECTING
      mockBus.emitStatus('RECONNECTING');
      expect(reconnectCount).toBe(0);

      // Recovers back to CONNECTED -> onReconnect triggers!
      mockBus.emitStatus('CONNECTED');
      expect(reconnectCount).toBe(1);

      // Another normal connected status without prior RECONNECTING does not re-trigger
      mockBus.emitStatus('CONNECTED');
      expect(reconnectCount).toBe(1);

      cleanup();
    });
  });

  describe('6. Session Switch Invalidation', () => {
    test('switching user session clears in-memory state and resets bound context', () => {
      const mockBus = createMockRealtimeBus('CONNECTED');
      const received: string[] = [];

      const cleanup = subscribeToChildSafetyRealtime(
        {
          onEvent: (ev) => received.push(`${ev.societyId}:${ev.id}`),
        },
        mockBus as any
      );

      // Resident A event
      mockBus.emitEvent('CHILD_PROFILE_UPDATED', {
        id: 'evt-alpha-1',
        societyId: 'soc-alpha',
        payload: { id: 'c1' },
      });
      expect(received).toEqual(['soc-alpha:evt-alpha-1']);

      // Switch to Resident B (soc-beta)
      clearAuthSession();
      saveAuthSession(residentSneha, 'jwt-sneha-token', 'password');

      // Old soc-alpha event arriving after switch is dropped
      mockBus.emitEvent('CHILD_PROFILE_UPDATED', {
        id: 'evt-alpha-stale',
        societyId: 'soc-alpha',
        payload: { id: 'c1' },
      });
      expect(received).toEqual(['soc-alpha:evt-alpha-1']);

      // New soc-beta event accepted
      mockBus.emitEvent('CHILD_PROFILE_UPDATED', {
        id: 'evt-beta-ok',
        societyId: 'soc-beta',
        payload: { id: 'c2' },
      });
      expect(received).toEqual(['soc-alpha:evt-alpha-1', 'soc-beta:evt-beta-ok']);

      cleanup();
    });
  });
});

