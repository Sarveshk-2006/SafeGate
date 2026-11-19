// =============================================================================
// AARIZO — ISSUE-06 Phase B.2.3 (Subphase 4.6.3.1):
// Shared Security Child Safety Realtime Hook & Controller
//
// Invariants:
// - Subscribes EXCLUSIVELY to the 8 guard-authorized backend Child Safety topics
//   (`GATE_AND_SOS_EVENT_ROLES`).
// - Rejects household profile and pickup roster events (`PROFILE_EVENT_ROLES`)
//   to enforce resident privacy defense-in-depth.
// - Reuses the established Fetch-based SSE transport (`realtimeService`) with
//   zero URL token leaks, zero EventSource fallback, zero BroadcastChannel.
// - Strict session, role ('guard', 'secretary', 'committee', 'admin'),
//   and society isolation (fail-closed on unauthenticated or cross-society events).
// - Encapsulates 50ms coalescing debounce, in-flight request tracking, monotonic
//   refresh nonces, bounded FIFO deduplication, and automatic reconnect recovery.
// - React 18 Strict Mode double-mount safe with zero memory/connection leaks.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { realtimeService } from '../services/realtimeService';
import type { RealtimeService } from '../services/realtimeService';
import { childSafetyService } from '../services/childSafetyService';
import { getAuthToken, getStoredUser } from '../services/authStorage';
import type { RealtimeConnectionStatus, RealtimeMessage } from '../types/realtime';

// Exact backend event topics authorized for guards by `server/src/childSafety/router.ts`
export const SECURITY_CHILD_SAFETY_TOPICS = [
  'CHILD_GATE_PASS_GENERATED',
  'CHILD_GATE_PASS_VERIFIED',
  'CHILD_GATE_PASS_REVOKED',
  'CHILD_EXIT_TRIGGERED',
  'CHILD_EXIT_DENIED',
  'CHILD_SAFETY_SOS_TRIGGERED',
  'CHILD_SAFETY_ALERT_ACKNOWLEDGED',
  'CHILD_SAFETY_ALERT_RESOLVED',
] as const;

export type SecurityChildSafetyTopic = (typeof SECURITY_CHILD_SAFETY_TOPICS)[number];

const VALID_SECURITY_TOPIC_SET = new Set<string>(SECURITY_CHILD_SAFETY_TOPICS);
const PLATFORM_ADMIN_SENTINELS = new Set(['soc-platform', 'platform', '*', 'all']);
const ALLOWED_SECURITY_ROLES = new Set(['guard', 'secretary', 'committee', 'admin']);

const DEFAULT_MAX_DEDUPE_IDS = 250;

export type SecurityInvalidationScope = 'activePasses' | 'exitLogs' | 'activeAlerts' | 'all';

export interface SecurityChildSafetyEvent {
  id: string;
  topic: SecurityChildSafetyTopic;
  societyId: string;
  childId?: string;
  payload: Record<string, unknown>;
  timestamp: string;
  scopes: ReadonlyArray<SecurityInvalidationScope>;
}

export interface UseSecurityChildSafetyRealtimeOptions {
  /** Set false to temporarily disable subscriptions (default: true). */
  enabled?: boolean;
  /** Optional subset of security topics (defaults to all 8). */
  topics?: ReadonlyArray<SecurityChildSafetyTopic>;
  /** Optional society filter honored ONLY for verified platform-admin sessions. */
  societyId?: string;
  /** Optional bounded FIFO deduplication window size (default: 250). */
  maxDedupeIds?: number;
  /** Invoked for every deduplicated Security Child Safety SSE event. */
  onEvent?: (event: SecurityChildSafetyEvent) => void;
  /** Invoked when active gate pass availability or pass status changes. */
  onActivePassesChange?: (event: SecurityChildSafetyEvent) => void;
  /** Invoked when gate exit audit logs change (exit allowed or denied). */
  onExitLogsChange?: (event: SecurityChildSafetyEvent) => void;
  /** Invoked when Child Safety SOS / active alerts change. */
  onAlertsChange?: (event: SecurityChildSafetyEvent) => void;
  /** Coalesced refresh callback with the combined set of invalidated scopes. */
  onRefresh?: (scopes: ReadonlySet<SecurityInvalidationScope>) => Promise<void> | void;
  /** Invoked when SSE recovers from RECONNECTING to CONNECTED for authoritative resync. */
  onReconnect?: (status: RealtimeConnectionStatus) => void;
  /** Whether to emit invalidation notifications on `childSafetyService` (default: true). */
  notifyServiceInvalidation?: boolean;
}

export interface SecurityRealtimeAuthContext {
  fingerprint: string;
  societyId: string;
  role: string;
  isPlatformAdmin: boolean;
}

export function getActiveSecurityRealtimeAuthContext(): SecurityRealtimeAuthContext | null {
  const token = getAuthToken();
  const user = getStoredUser();
  if (!token || !user) return null;

  const uid = user.id || (user as { uid?: string }).uid || '';
  if (!uid) return null;

  const societyId = typeof user.societyId === 'string' ? user.societyId.trim() : '';
  const role = typeof user.role === 'string' ? user.role.trim().toLowerCase() : '';

  // Fail closed if the role is not an authorized security/staff role
  if (!ALLOWED_SECURITY_ROLES.has(role)) {
    return null;
  }

  const isPlatformAdmin =
    role === 'admin' && (!societyId || PLATFORM_ADMIN_SENTINELS.has(societyId.toLowerCase()));

  return {
    fingerprint: `${uid}:${societyId}:${role}`,
    societyId,
    role,
    isPlatformAdmin,
  };
}

/**
 * Maps an authoritative security topic to the resource scopes requiring invalidation.
 */
export function getSecurityInvalidationScopes(
  topic: SecurityChildSafetyTopic,
  _payload?: Record<string, unknown>
): ReadonlyArray<SecurityInvalidationScope> {
  switch (topic) {
    case 'CHILD_GATE_PASS_GENERATED':
    case 'CHILD_GATE_PASS_REVOKED':
      return ['activePasses'];

    case 'CHILD_GATE_PASS_VERIFIED':
      return ['activePasses', 'exitLogs'];

    case 'CHILD_EXIT_TRIGGERED':
      return ['exitLogs'];

    case 'CHILD_EXIT_DENIED':
      return ['exitLogs', 'activeAlerts'];

    case 'CHILD_SAFETY_SOS_TRIGGERED':
    case 'CHILD_SAFETY_ALERT_ACKNOWLEDGED':
    case 'CHILD_SAFETY_ALERT_RESOLVED':
      return ['activeAlerts'];

    default:
      return [];
  }
}

function extractChildId(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.childId === 'string' && payload.childId.trim()) {
    return payload.childId.trim();
  }
  if (typeof payload.id === 'string' && payload.id.trim()) {
    return payload.id.trim();
  }
  return undefined;
}

/**
 * Pure, testable Security Child Safety realtime subscription controller.
 * Subscribes strictly to the 8 guard topics via `realtimeService`.
 */
export function subscribeToSecurityChildSafetyRealtime(
  options: UseSecurityChildSafetyRealtimeOptions,
  service: Pick<RealtimeService, 'subscribe' | 'subscribeToStatus'> = realtimeService
): () => void {
  if (options.enabled === false) {
    return () => {};
  }

  // Validate active security auth session
  const initialAuthCtx = getActiveSecurityRealtimeAuthContext();
  if (!initialAuthCtx) {
    return () => {};
  }

  const requestedTopics = options.topics && options.topics.length > 0
    ? options.topics
    : SECURITY_CHILD_SAFETY_TOPICS;

  const uniqueValidTopics = Array.from(
    new Set(requestedTopics.filter((t): t is SecurityChildSafetyTopic => VALID_SECURITY_TOPIC_SET.has(t)))
  );

  if (uniqueValidTopics.length === 0) {
    return () => {};
  }

  const maxDedupeIds =
    typeof options.maxDedupeIds === 'number' && Number.isFinite(options.maxDedupeIds) && options.maxDedupeIds >= 1
      ? Math.floor(options.maxDedupeIds)
      : DEFAULT_MAX_DEDUPE_IDS;

  const seenEventIds = new Set<string>();
  const shouldNotifyService = options.notifyServiceInvalidation !== false;
  let active = true;
  let previousState: RealtimeConnectionStatus['state'] | null = null;
  let hadReconnectGap = false;
  let boundSessionFingerprint: string | null = initialAuthCtx.fingerprint;

  const handleMessage = (topic: SecurityChildSafetyTopic, msg: RealtimeMessage) => {
    if (!active) return;

    // 1. Auth context verification (fail closed on logout or user switch)
    const authCtx = getActiveSecurityRealtimeAuthContext();
    if (!authCtx) {
      if (boundSessionFingerprint !== null || seenEventIds.size > 0) {
        boundSessionFingerprint = null;
        seenEventIds.clear();
        childSafetyService.clearInMemoryState();
      }
      return;
    }

    if (boundSessionFingerprint !== null && authCtx.fingerprint !== boundSessionFingerprint) {
      seenEventIds.clear();
      childSafetyService.clearInMemoryState();
    }
    boundSessionFingerprint = authCtx.fingerprint;

    const payloadObj: Record<string, unknown> =
      msg?.payload && typeof msg.payload === 'object' && !Array.isArray(msg.payload)
        ? (msg.payload as Record<string, unknown>)
        : {};

    // 2. Society scope verification (strictly reject cross-society messages)
    const eventSocietyId = typeof msg?.societyId === 'string' ? msg.societyId.trim() : '';
    const payloadSocietyId = typeof payloadObj.societyId === 'string' ? payloadObj.societyId.trim() : '';

    if (!eventSocietyId || PLATFORM_ADMIN_SENTINELS.has(eventSocietyId.toLowerCase())) {
      return;
    }
    if (payloadSocietyId) {
      if (PLATFORM_ADMIN_SENTINELS.has(payloadSocietyId.toLowerCase()) || payloadSocietyId !== eventSocietyId) {
        return;
      }
    }

    if (!authCtx.isPlatformAdmin) {
      if (!authCtx.societyId || PLATFORM_ADMIN_SENTINELS.has(authCtx.societyId.toLowerCase())) {
        return;
      }
      if (eventSocietyId !== authCtx.societyId) {
        return;
      }
    } else if (typeof options.societyId === 'string') {
      const targetSociety = options.societyId.trim();
      if (targetSociety && !PLATFORM_ADMIN_SENTINELS.has(targetSociety.toLowerCase()) && eventSocietyId !== targetSociety) {
        return;
      }
    }

    // 3. Deduplication check
    const eventId = typeof msg?.id === 'string' ? msg.id.trim() : '';
    if (eventId && seenEventIds.has(eventId)) {
      return;
    }

    const scopes = getSecurityInvalidationScopes(topic, payloadObj);
    const childId = extractChildId(payloadObj);

    const event: SecurityChildSafetyEvent = {
      id: eventId || `${topic}:${msg?.timestamp || Date.now()}`,
      topic,
      societyId: eventSocietyId,
      childId,
      payload: payloadObj,
      timestamp: typeof msg?.timestamp === 'string' ? msg.timestamp : new Date().toISOString(),
      scopes,
    };

    // 4. Invalidate underlying canonical service cache
    if (shouldNotifyService && scopes.length > 0) {
      const mappedServiceScopes: Array<'passes' | 'exitLogs' | 'alerts'> = [];
      if (scopes.includes('activePasses')) mappedServiceScopes.push('passes');
      if (scopes.includes('exitLogs')) mappedServiceScopes.push('exitLogs');
      if (scopes.includes('activeAlerts')) mappedServiceScopes.push('alerts');

      if (mappedServiceScopes.length > 0) {
        childSafetyService.notifyInvalidation(mappedServiceScopes, 'realtime', {
          childId,
          topic,
        });
      }
    }

    // 5. Invoke consumer callbacks with error isolation
    let firstError: unknown = undefined;
    let hadCallbackError = false;
    const invokeSafely = (cb?: (ev: SecurityChildSafetyEvent) => void) => {
      if (!cb) return;
      try {
        cb(event);
      } catch (err) {
        if (!hadCallbackError) {
          firstError = err;
        }
        hadCallbackError = true;
      }
    };

    invokeSafely(options.onEvent);
    if (scopes.includes('activePasses')) invokeSafely(options.onActivePassesChange);
    if (scopes.includes('exitLogs')) invokeSafely(options.onExitLogsChange);
    if (scopes.includes('activeAlerts')) invokeSafely(options.onAlertsChange);

    if (hadCallbackError) {
      throw firstError;
    }

    // 6. Record bounded FIFO deduplication ID only after all callbacks succeed
    if (eventId) {
      if (seenEventIds.size >= maxDedupeIds) {
        const oldest = seenEventIds.values().next().value;
        if (oldest !== undefined) {
          seenEventIds.delete(oldest);
        }
      }
      seenEventIds.add(eventId);
    }
  };

  // Subscribe to all authorized security topics
  const unsubs: Array<() => void> = uniqueValidTopics.map((topic) =>
    service.subscribe(topic, (msg) => handleMessage(topic, msg))
  );

  // Subscribe to realtime stream connection status
  const unsubStatus = service.subscribeToStatus((status) => {
    if (!active) return;
    const currentState = status.state;

    if (currentState === 'RECONNECTING' || currentState === 'OFFLINE') {
      hadReconnectGap = true;
    } else if (currentState === 'CONNECTED') {
      const isInitialConnect = previousState === null;
      if (hadReconnectGap || isInitialConnect) {
        hadReconnectGap = false;
        try {
          options.onReconnect?.(status);
        } catch (reconnectErr) {
          console.error('[useSecurityChildSafetyRealtime] onReconnect error:', reconnectErr);
        }
      }
    }
    previousState = currentState;
  });

  return () => {
    active = false;
    seenEventIds.clear();
    for (const unsub of unsubs) {
      unsub();
    }
    unsubStatus();
  };
}

export interface SecurityChildSafetyRealtimeState {
  connectionStatus: RealtimeConnectionStatus['state'];
  isConnected: boolean;
  isReconnecting: boolean;
  isOffline: boolean;
  refreshNonce: number;
  passesRefreshNonce: number;
  logsRefreshNonce: number;
  alertsRefreshNonce: number;
}

/**
 * Authoritative React Hook for Security Portal Child Safety Realtime Synchronization.
 * Provides:
 * - Exactly ONE authenticated SSE subscription per component lifecycle.
 * - 50ms coalescing debouncer merging rapid bursts of gate/SOS events into batched refreshes.
 * - In-flight refresh tracking (never loses an invalidation arriving while fetching).
 * - Monotonic refresh nonces for fine-grained subcomponent updates.
 * - Strict Mode safe with zero connection or memory leaks.
 */
export function useSecurityChildSafetyRealtime(
  options: UseSecurityChildSafetyRealtimeOptions = {},
  service: Pick<RealtimeService, 'subscribe' | 'subscribeToStatus' | 'getConnectionStatus'> = realtimeService
): SecurityChildSafetyRealtimeState {
  const optionsRef = useRef<UseSecurityChildSafetyRealtimeOptions>(options);
  optionsRef.current = options;

  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeConnectionStatus>(() => {
    if (typeof service.getConnectionStatus === 'function') {
      return service.getConnectionStatus();
    }
    return {
      connected: false,
      state: 'OFFLINE',
      transportType: 'SSE',
      latencyMs: 0,
      activeListenersCount: 0,
      messagesReceivedTotal: 0,
    };
  });

  const [refreshNonce, setRefreshNonce] = useState<number>(0);
  const [passesRefreshNonce, setPassesRefreshNonce] = useState<number>(0);
  const [logsRefreshNonce, setLogsRefreshNonce] = useState<number>(0);
  const [alertsRefreshNonce, setAlertsRefreshNonce] = useState<number>(0);

  // Coalescing debounce & in-flight state tracking
  const mountedRef = useRef<boolean>(true);
  const inFlightRefreshRef = useRef<boolean>(false);
  const hasPendingRefreshDuringInFlightRef = useRef<boolean>(false);
  const pendingScopesRef = useRef<Set<SecurityInvalidationScope>>(new Set());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const executeCoalescedRefresh = useCallback(async () => {
    if (!mountedRef.current) return;
    const scopesToRefresh = new Set(pendingScopesRef.current);
    pendingScopesRef.current.clear();
    if (scopesToRefresh.size === 0) return;

    inFlightRefreshRef.current = true;

    try {
      if (scopesToRefresh.has('all') || scopesToRefresh.has('activePasses')) {
        setPassesRefreshNonce((n) => n + 1);
      }
      if (scopesToRefresh.has('all') || scopesToRefresh.has('exitLogs')) {
        setLogsRefreshNonce((n) => n + 1);
      }
      if (scopesToRefresh.has('all') || scopesToRefresh.has('activeAlerts')) {
        setAlertsRefreshNonce((n) => n + 1);
      }
      setRefreshNonce((n) => n + 1);

      if (typeof optionsRef.current.onRefresh === 'function') {
        await optionsRef.current.onRefresh(scopesToRefresh);
      }
    } catch (refreshErr) {
      console.error('[useSecurityChildSafetyRealtime] Coalesced refresh failed:', refreshErr);
    } finally {
      if (mountedRef.current) {
        inFlightRefreshRef.current = false;
        if (hasPendingRefreshDuringInFlightRef.current) {
          hasPendingRefreshDuringInFlightRef.current = false;
          void executeCoalescedRefresh();
        }
      }
    }
  }, []);

  const scheduleCoalescedRefresh = useCallback(
    (scope: SecurityInvalidationScope) => {
      pendingScopesRef.current.add(scope);
      if (inFlightRefreshRef.current) {
        hasPendingRefreshDuringInFlightRef.current = true;
        return;
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        void executeCoalescedRefresh();
      }, 50);
    },
    [executeCoalescedRefresh]
  );

  useEffect(() => {
    // 1. Subscribe to connection status
    const unsubStatus = service.subscribeToStatus((status) => {
      if (mountedRef.current) {
        setRealtimeStatus(status);
      }
    });

    // 2. Subscribe to authorized security topics
    const unsubRealtime = subscribeToSecurityChildSafetyRealtime(
      {
        enabled: options.enabled,
        topics: options.topics,
        societyId: options.societyId,
        maxDedupeIds: options.maxDedupeIds,
        onEvent: (ev) => optionsRef.current.onEvent?.(ev),
        onActivePassesChange: (ev) => {
          optionsRef.current.onActivePassesChange?.(ev);
          scheduleCoalescedRefresh('activePasses');
        },
        onExitLogsChange: (ev) => {
          optionsRef.current.onExitLogsChange?.(ev);
          scheduleCoalescedRefresh('exitLogs');
        },
        onAlertsChange: (ev) => {
          optionsRef.current.onAlertsChange?.(ev);
          scheduleCoalescedRefresh('activeAlerts');
        },
        onReconnect: (status) => {
          optionsRef.current.onReconnect?.(status);
          scheduleCoalescedRefresh('all');
        },
        notifyServiceInvalidation: options.notifyServiceInvalidation,
      },
      service
    );

    return () => {
      unsubStatus();
      unsubRealtime();
    };
  }, [
    options.enabled,
    options.topics,
    options.societyId,
    options.maxDedupeIds,
    options.notifyServiceInvalidation,
    service,
    scheduleCoalescedRefresh,
  ]);

  const connectionStatus = realtimeStatus.state;
  const isConnected = connectionStatus === 'CONNECTED';
  const isReconnecting = connectionStatus === 'RECONNECTING';
  const isOffline = connectionStatus === 'OFFLINE';

  return {
    connectionStatus,
    isConnected,
    isReconnecting,
    isOffline,
    refreshNonce,
    passesRefreshNonce,
    logsRefreshNonce,
    alertsRefreshNonce,
  };
}

