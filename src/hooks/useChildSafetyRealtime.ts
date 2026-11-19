// =============================================================================
// AARIZO — ISSUE-06 Phase B.2.3 (Phase 3): Shared Child Safety Realtime Hook
// Subscribes strictly to the exact 14 backend Child Safety SSE topics emitted by
// `server/src/childSafety/router.ts` via the accepted Phase 2 Fetch-based SSE
// `realtimeService`. Zero cross-tab channel relay, zero legacy browser SSE API, zero polling.
// =============================================================================

import { useEffect, useRef } from 'react';
import { realtimeService } from '../services/realtimeService';
import type { RealtimeService } from '../services/realtimeService';
import { childSafetyService } from '../services/childSafetyService';
import type { ChildSafetyInvalidationScope } from '../services/childSafetyService';
import { getAuthToken, getStoredUser } from '../services/authStorage';
import type { RealtimeConnectionStatus, RealtimeMessage } from '../types/realtime';

// Exact backend event topics emitted by `server/src/childSafety/router.ts` (zero invented topics)
export const CHILD_SAFETY_PROFILE_TOPICS = [
  'CHILD_PROFILE_CREATED',
  'CHILD_PROFILE_UPDATED',
  'CHILD_PROFILE_ARCHIVED',
] as const;

export const CHILD_SAFETY_PICKUP_TOPICS = [
  'CHILD_PICKUP_AUTHORIZED',
  'CHILD_PICKUP_UPDATED',
  'CHILD_PICKUP_REVOKED',
] as const;

export const CHILD_SAFETY_PASS_TOPICS = [
  'CHILD_GATE_PASS_GENERATED',
  'CHILD_GATE_PASS_VERIFIED',
  'CHILD_GATE_PASS_REVOKED',
] as const;

export const CHILD_SAFETY_EXIT_TOPICS = [
  'CHILD_EXIT_TRIGGERED',
  'CHILD_EXIT_DENIED',
] as const;

export const CHILD_SAFETY_ALERT_TOPICS = [
  'CHILD_SAFETY_SOS_TRIGGERED',
  'CHILD_SAFETY_ALERT_ACKNOWLEDGED',
  'CHILD_SAFETY_ALERT_RESOLVED',
] as const;

export const CHILD_SAFETY_REALTIME_TOPICS = [
  ...CHILD_SAFETY_PROFILE_TOPICS,
  ...CHILD_SAFETY_PICKUP_TOPICS,
  ...CHILD_SAFETY_PASS_TOPICS,
  ...CHILD_SAFETY_EXIT_TOPICS,
  ...CHILD_SAFETY_ALERT_TOPICS,
] as const;

export type ChildSafetyRealtimeTopic = (typeof CHILD_SAFETY_REALTIME_TOPICS)[number];

const VALID_CHILD_SAFETY_TOPIC_SET = new Set<string>(CHILD_SAFETY_REALTIME_TOPICS);
const PROFILE_TOPIC_SET = new Set<string>(CHILD_SAFETY_PROFILE_TOPICS);
const PLATFORM_ADMIN_SENTINELS = new Set(['soc-platform', 'platform', '*', 'all']);

const DEFAULT_MAX_DEDUPE_IDS = 250;

export interface ChildSafetyRealtimeEvent {
  id: string;
  topic: ChildSafetyRealtimeTopic;
  societyId: string;
  childId?: string;
  payload: Record<string, unknown>;
  timestamp: string;
  scopes: ReadonlyArray<ChildSafetyInvalidationScope>;
}

export interface UseChildSafetyRealtimeOptions {
  /** Set false to temporarily pause subscriptions (default: true). */
  enabled?: boolean;
  /** Optional subset of backend Child Safety topics to subscribe to (defaults to all 14). */
  topics?: ReadonlyArray<ChildSafetyRealtimeTopic>;
  /** Optional society filter honored ONLY for verified platform-admin sessions. */
  societyId?: string;
  /** Optional bounded FIFO deduplication window size (default: 250). */
  maxDedupeIds?: number;
  /** Invoked for every deduplicated Child Safety SSE event. */
  onEvent?: (event: ChildSafetyRealtimeEvent) => void;
  /** Invoked when child profile state may have changed. */
  onProfilesChange?: (event: ChildSafetyRealtimeEvent) => void;
  /** Invoked when authorized pickup state may have changed. */
  onPickupsChange?: (event: ChildSafetyRealtimeEvent) => void;
  /** Invoked when gate pass state may have changed. */
  onPassesChange?: (event: ChildSafetyRealtimeEvent) => void;
  /** Invoked when gate exit logs may have changed. */
  onExitLogsChange?: (event: ChildSafetyRealtimeEvent) => void;
  /** Invoked when Child Safety SOS/alerts may have changed. */
  onAlertsChange?: (event: ChildSafetyRealtimeEvent) => void;
  /** Invoked when SSE transitions from RECONNECTING back to CONNECTED (for authoritative resync). */
  onReconnect?: (status: RealtimeConnectionStatus) => void;
  /** Whether to emit invalidation notifications on `childSafetyService` (default: true). */
  notifyServiceInvalidation?: boolean;
}

interface ActiveRealtimeAuthContext {
  fingerprint: string;
  societyId: string;
  role: string;
  isPlatformAdmin: boolean;
}

function getActiveRealtimeAuthContext(): ActiveRealtimeAuthContext | null {
  const token = getAuthToken();
  const user = getStoredUser();
  if (!token || !user) return null;

  const uid = user.id || (user as any).uid || '';
  if (!uid) return null;

  const societyId = typeof user.societyId === 'string' ? user.societyId.trim() : '';
  const role = typeof user.role === 'string' ? user.role.trim().toLowerCase() : '';
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
 * Maps an authoritative backend Child Safety SSE topic (and optional payload) to the exact
 * data scopes that should be invalidated or refreshed, matching backend Prisma transaction cascades.
 */
export function getInvalidatedChildSafetyScopes(
  topic: ChildSafetyRealtimeTopic,
  payload?: Record<string, unknown>
): ReadonlyArray<ChildSafetyInvalidationScope> {
  switch (topic) {
    // Child profiles
    case 'CHILD_PROFILE_CREATED':
    case 'CHILD_PROFILE_UPDATED':
      return ['children'];
    case 'CHILD_PROFILE_ARCHIVED':
      // Backend atomically revokes all ACTIVE gate passes for the archived child
      return ['children', 'pickups', 'passes'];

    // Authorized pickups
    case 'CHILD_PICKUP_AUTHORIZED':
      return ['pickups', 'children'];
    case 'CHILD_PICKUP_UPDATED': {
      const status = typeof payload?.status === 'string' ? payload.status.trim().toUpperCase() : '';
      if (status === 'REVOKED' || status === 'EXPIRED') {
        // Backend atomically revokes ACTIVE gate passes linked to this pickup
        return ['pickups', 'passes', 'children'];
      }
      return ['pickups', 'children'];
    }
    case 'CHILD_PICKUP_REVOKED':
      // Backend atomically revokes ACTIVE gate passes linked to this pickup (revoke & archive)
      return ['pickups', 'passes', 'children'];

    // Gate passes
    case 'CHILD_GATE_PASS_GENERATED':
    case 'CHILD_GATE_PASS_REVOKED':
      return ['passes', 'children'];
    case 'CHILD_GATE_PASS_VERIFIED':
      // Backend atomically updates pass usage, child status (OUT_OF_SOCIETY), and creates exit log
      return ['passes', 'exitLogs', 'children'];

    // Gate exit logs
    case 'CHILD_EXIT_TRIGGERED':
      return ['exitLogs', 'passes', 'children'];
    case 'CHILD_EXIT_DENIED':
      return ['exitLogs'];

    // Alerts & SOS
    case 'CHILD_SAFETY_SOS_TRIGGERED':
    case 'CHILD_SAFETY_ALERT_RESOLVED':
      return ['alerts', 'children'];
    case 'CHILD_SAFETY_ALERT_ACKNOWLEDGED':
      return ['alerts'];

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
 * Pure, testable subscription controller backed strictly by authenticated Fetch SSE
 * (`realtimeService`). Handles:
 * - Strict backend topic allowlist (rejects unknown/invented topics)
 * - Defense-in-depth authenticated session & society-scope validation (fail-closed)
 * - Backend-aligned cascade invalidation scopes
 * - Bounded FIFO event deduplication recorded ONLY after successful callback completion
 * - Per-callback exception isolation + replay-preserving error propagation
 * - Eager in-memory state cleanup on OFFLINE/disconnect & authoritative resync on reconnect
 */
export function subscribeToChildSafetyRealtime(
  options: UseChildSafetyRealtimeOptions,
  service: Pick<RealtimeService, 'subscribe' | 'subscribeToStatus'> = realtimeService
): () => void {
  if (options.enabled === false) {
    return () => {};
  }

  // Deduplicate requested topic list and reject any unknown/invented topic names
  const requestedTopics = options.topics && options.topics.length > 0
    ? options.topics
    : CHILD_SAFETY_REALTIME_TOPICS;

  const uniqueValidTopics = Array.from(
    new Set(requestedTopics.filter((t): t is ChildSafetyRealtimeTopic => VALID_CHILD_SAFETY_TOPIC_SET.has(t)))
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
  let boundSessionFingerprint: string | null = getActiveRealtimeAuthContext()?.fingerprint ?? null;

  const handleMessage = (topic: ChildSafetyRealtimeTopic, msg: RealtimeMessage) => {
    if (!active) return;

    // 1. Defense-in-depth authentication check (fail closed if unauthenticated)
    const authCtx = getActiveRealtimeAuthContext();
    if (!authCtx) {
      if (boundSessionFingerprint !== null || seenEventIds.size > 0) {
        boundSessionFingerprint = null;
        seenEventIds.clear();
        childSafetyService.clearInMemoryState();
      }
      return;
    }

    // Detect session switch even if no intermediate OFFLINE status arrived
    if (boundSessionFingerprint !== null && authCtx.fingerprint !== boundSessionFingerprint) {
      seenEventIds.clear();
      childSafetyService.clearInMemoryState();
    }
    boundSessionFingerprint = authCtx.fingerprint;

    const payloadObj: Record<string, unknown> =
      msg?.payload && typeof msg.payload === 'object' && !Array.isArray(msg.payload)
        ? (msg.payload as Record<string, unknown>)
        : {};

    // 2. Defense-in-depth society-scope validation (reject missing, malformed, sentinel, or cross-society)
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

    // 3. Deduplication check (only skip events that previously completed WITHOUT callback errors)
    const eventId = typeof msg?.id === 'string' ? msg.id.trim() : '';
    if (eventId && seenEventIds.has(eventId)) {
      return;
    }

    const scopes = getInvalidatedChildSafetyScopes(topic, payloadObj);
    const childId = PROFILE_TOPIC_SET.has(topic)
      ? extractChildId(payloadObj)
      : typeof payloadObj.childId === 'string' && payloadObj.childId.trim()
        ? payloadObj.childId.trim()
        : undefined;

    const event: ChildSafetyRealtimeEvent = {
      id: eventId || `${topic}:${msg?.timestamp || Date.now()}`,
      topic,
      societyId: eventSocietyId,
      childId,
      payload: payloadObj,
      timestamp: typeof msg?.timestamp === 'string' ? msg.timestamp : new Date().toISOString(),
      scopes,
    };

    // 4. Evict affected snapshots & notify service invalidation listeners
    if (shouldNotifyService && scopes.length > 0) {
      childSafetyService.notifyInvalidation(scopes, 'realtime', {
        childId,
        topic,
      });
    }

    // 5. Isolate every consumer callback so one failure never prevents sibling callbacks from running
    let firstError: unknown = undefined;
    let hadCallbackError = false;
    const invokeSafely = (cb?: (ev: ChildSafetyRealtimeEvent) => void) => {
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
    if (scopes.includes('children')) invokeSafely(options.onProfilesChange);
    if (scopes.includes('pickups')) invokeSafely(options.onPickupsChange);
    if (scopes.includes('passes')) invokeSafely(options.onPassesChange);
    if (scopes.includes('exitLogs')) invokeSafely(options.onExitLogsChange);
    if (scopes.includes('alerts')) invokeSafely(options.onAlertsChange);

    if (hadCallbackError) {
      // Do NOT record eventId in seenEventIds; propagate error so RealtimeService
      // evicts msg.id and withholds advancing lastEventId for replay recovery.
      throw firstError;
    }

    // 6. Record bounded FIFO dedupe ID ONLY after all callbacks succeed
    if (eventId) {
      seenEventIds.add(eventId);
      if (seenEventIds.size > maxDedupeIds) {
        const oldest = seenEventIds.values().next().value;
        if (oldest !== undefined) {
          seenEventIds.delete(oldest);
        }
      }
    }
  };

  const unsubscribers: Array<() => void> = [];

  for (const topic of uniqueValidTopics) {
    const unsub = service.subscribe(topic, (msg) => handleMessage(topic, msg));
    unsubscribers.push(unsub);
  }

  const unsubStatus = service.subscribeToStatus((status) => {
    if (!active) return;

    if (status.state === 'RECONNECTING') {
      hadReconnectGap = true;
    } else if (status.state === 'OFFLINE') {
      // Explicit disconnect/logout eagerly purges dedupe state AND ephemeral in-memory Child Safety snapshots
      seenEventIds.clear();
      hadReconnectGap = false;
      boundSessionFingerprint = null;
      childSafetyService.clearInMemoryState();
    } else if (status.state === 'CONNECTED' && hadReconnectGap && previousState !== 'CONNECTED') {
      hadReconnectGap = false;
      if (getActiveRealtimeAuthContext()) {
        if (shouldNotifyService) {
          childSafetyService.notifyInvalidation(['all'], 'reconnect');
        }
        try {
          options.onReconnect?.(status);
        } catch (err) {
          console.error('[useChildSafetyRealtime] onReconnect listener error:', err);
        }
      }
    }

    previousState = status.state;
  });
  unsubscribers.push(unsubStatus);

  return () => {
    if (!active) return;
    active = false;
    while (unsubscribers.length > 0) {
      const fn = unsubscribers.pop();
      try {
        fn?.();
      } catch {}
    }
    seenEventIds.clear();
  };
}

/**
 * Shared React hook for resident, security, and admin Child Safety portals.
 * Uses ref-stabilized handlers so component re-renders never churn or duplicate SSE subscriptions,
 * and cleans up cleanly on unmount (React Strict Mode safe).
 */
export function useChildSafetyRealtime(
  options: UseChildSafetyRealtimeOptions = {},
  service: Pick<RealtimeService, 'subscribe' | 'subscribeToStatus'> = realtimeService
): void {
  const optionsRef = useRef<UseChildSafetyRealtimeOptions>(options);
  optionsRef.current = options;

  const enabled = options.enabled !== false;
  const topicsKey = options.topics && options.topics.length > 0
    ? Array.from(new Set(options.topics)).sort().join(',')
    : 'ALL';
  const societyIdFilter = typeof options.societyId === 'string' ? options.societyId.trim() : '';

  useEffect(() => {
    if (!enabled) return;

    const current = optionsRef.current;
    const unsubscribe = subscribeToChildSafetyRealtime(
      {
        enabled: true,
        topics: current.topics,
        societyId: societyIdFilter || undefined,
        maxDedupeIds: current.maxDedupeIds,
        notifyServiceInvalidation: current.notifyServiceInvalidation,
        onEvent: (ev) => optionsRef.current.onEvent?.(ev),
        onProfilesChange: (ev) => optionsRef.current.onProfilesChange?.(ev),
        onPickupsChange: (ev) => optionsRef.current.onPickupsChange?.(ev),
        onPassesChange: (ev) => optionsRef.current.onPassesChange?.(ev),
        onExitLogsChange: (ev) => optionsRef.current.onExitLogsChange?.(ev),
        onAlertsChange: (ev) => optionsRef.current.onAlertsChange?.(ev),
        onReconnect: (st) => optionsRef.current.onReconnect?.(st),
      },
      service
    );

    return () => {
      unsubscribe();
    };
  }, [enabled, topicsKey, societyIdFilter, service]);
}

