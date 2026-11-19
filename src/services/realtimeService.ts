import type { RealtimeTopic, RealtimeMessage, RealtimeConnectionStatus } from '../types/realtime';
import { getBackendBaseUrl } from '../utils/backendConfig';
import { triggerHaptic } from '../utils/nativeMobile';
import {
  authenticatedFetch,
  clearAuthSession,
  getAuthToken,
  getStoredUser,
  isSessionValid,
} from './authStorage';
import { SseFrameParser, isValidSseEventId } from './sseFrameParser';
import type { ParsedSseFrame } from './sseFrameParser';

type MessageCallback<T = any> = (msg: RealtimeMessage<T>) => void;
type StatusCallback = (status: RealtimeConnectionStatus) => void;
type AlertCallback = (alert: {
  id: string;
  topic: string;
  title: string;
  description: string;
  urgency: 'info' | 'alert' | 'emergency';
  timestamp: string;
  actionPath?: string;
  payload?: any;
}) => void;

export interface RealtimeSessionContext {
  token: string;
  userId: string;
  societyId?: string;
  role?: string;
}

export interface RealtimeServiceOptions {
  /** Override fetch implementation for deterministic testing. */
  fetchFn?: typeof fetch;
  /** Override base URL resolver for deterministic testing. */
  getBaseUrl?: () => string;
  /**
   * @deprecated BroadcastChannel domain-event relay has been permanently removed (F-P2-01B).
   * Authenticated Fetch SSE is the sole authoritative cross-tab/network domain-event transport.
   * Option is retained solely for backward type compatibility and is ignored.
   */
  enableBroadcastChannel?: boolean;
  /** Disable window online listener binding. */
  enableOnlineListener?: boolean;
  /** Base reconnect delay in ms (default 1000ms). */
  baseReconnectDelayMs?: number;
  /** Maximum exponential backoff delay in ms (default 30000ms). */
  maxReconnectDelayMs?: number;
  /** Maximum jitter in ms added to backoff (default 500ms). */
  maxJitterMs?: number;
  /** Duration stream must remain open to reset backoff if no handshake arrives (default 5000ms). */
  stableConnectionMs?: number;
  /** Maximum SSE frame size in bytes before dropping oversized frame safely (default 256 KiB). */
  maxFrameBytes?: number;
}

export type RealtimeDeliveryOrigin = 'SSE' | 'LOCAL_PUBLISH';

export type RealtimeTopicCategory =
  | 'CHILD_EMERGENCY'
  | 'EMERGENCY'
  | 'SECURITY_ALERT'
  | 'CHILD_SAFETY'
  | 'VISITOR'
  | 'GATE_DELIVERY'
  | 'PAYMENT'
  | 'OPERATIONAL_PUBLIC'
  | 'UNKNOWN';

export interface RealtimeTopicClassification {
  /** Canonical trimmed uppercase topic, or '' when malformed/empty. */
  normalizedTopic: string;
  category: RealtimeTopicCategory;
  /** True ONLY for canonical supported active emergency/SOS topics. */
  isEmergency: boolean;
  /** True for all sensitive, security, child-safety, resident, financial, or unknown topics (fail-closed). */
  isProtected: boolean;
  /** True ONLY for explicitly allowlisted non-sensitive operational topics permitted on POST /api/realtime/broadcast. */
  canClientNetworkBroadcast: boolean;
}

const PLATFORM_ADMIN_SENTINELS = new Set(['soc-platform', 'platform', '*', 'all']);
const CANONICAL_TOPIC_FORMAT_REGEX = /^[A-Z][A-Z0-9_]{1,63}$/;

// Canonical allowlists — single source of truth for protection AND UI alert classification (F-P2-01A).
// Unknown, malformed, or substring-spoofed topics (e.g. FIRE_EMERGENCY, bare EMERGENCY) fail closed as UNKNOWN.
const CANONICAL_CHILD_EMERGENCY_TOPICS = new Set<string>([
  'CHILD_SAFETY_SOS_TRIGGERED',
]);

const CANONICAL_EMERGENCY_TOPICS = new Set<string>([
  'EMERGENCY_ALERTS',
  'EMERGENCY_ALERT',
  'EMERGENCY_TRIGGERED',
  'EMERGENCY_INCIDENT_CREATED',
  'SOS_TRIGGERED',
  'SOS_ALERT',
]);

const CANONICAL_SECURITY_ALERT_TOPICS = new Set<string>([
  'SECURITY_ALERT_CREATED',
  'SECURITY_ALERT_TRIGGERED',
  'SECURITY_ALERT_RESOLVED',
  'EMERGENCY_INCIDENT_ACKNOWLEDGED',
  'EMERGENCY_INCIDENT_RESOLVED',
]);

const CANONICAL_CHILD_SAFETY_TOPICS = new Set<string>([
  'CHILD_PROFILE_CREATED',
  'CHILD_PROFILE_UPDATED',
  'CHILD_PROFILE_ARCHIVED',
  'CHILD_PICKUP_AUTHORIZED',
  'CHILD_PICKUP_UPDATED',
  'CHILD_PICKUP_REVOKED',
  'CHILD_GATE_PASS_GENERATED',
  'CHILD_GATE_PASS_VERIFIED',
  'CHILD_GATE_PASS_REVOKED',
  'CHILD_EXIT_TRIGGERED',
  'CHILD_EXIT_DENIED',
  'CHILD_SAFETY_ALERT_ACKNOWLEDGED',
  'CHILD_SAFETY_ALERT_RESOLVED',
]);

const CANONICAL_VISITOR_TOPICS = new Set<string>([
  'VISITOR_ARRIVAL',
  'VISITOR_APPROVAL',
  'VISITOR_ENTRY',
  'VISITOR_EXIT',
]);

const CANONICAL_GATE_DELIVERY_TOPICS = new Set<string>([
  'QR_SCAN',
  'DELIVERY_STATUS',
  'PARCEL_ARRIVED',
  'WORKER_ENTRY_EXIT',
  'PARKING_GATE_TRIGGERED',
  'PARKING_OCCUPANCY',
]);

const CANONICAL_PAYMENT_TOPICS = new Set<string>([
  'PAYMENT_COMPLETED',
  'PAYMENT_STATUS',
  'OFFLINE_PAYMENT_LOGGED',
]);

// Strictly mirrors server/src/index.ts BROADCAST_ROLE_EVENT_PREFIXES (non-sensitive public operational events only).
const CANONICAL_PUBLIC_NETWORK_BROADCAST_EXACT = new Set<string>([
  'GENERAL',
  'SYNC_PING',
]);

const CANONICAL_PUBLIC_NETWORK_BROADCAST_PREFIXES = [
  'ANNOUNCEMENT_',
  'COMMUNITY_',
  'NOTICE_',
  'POLL_',
  'MAINTENANCE_',
  'FACILITY_',
  'HOUSEKEEPING_',
  'UTILITY_',
  'AMENITY_',
  'ADVERTISEMENT_',
] as const;

const MAX_SEEN_MESSAGE_IDS = 500;
const MAX_RETRY_AFTER_MS = 60_000;
const DEFAULT_BASE_RECONNECT_MS = 1_000;
const DEFAULT_MAX_RECONNECT_MS = 30_000;
const DEFAULT_MAX_JITTER_MS = 500;
const DEFAULT_STABLE_CONNECTION_MS = 5_000;

/**
 * Single canonical, fail-closed topic classification policy used across both
 * outbound protection and inbound UI alert handling.
 * - Rejects empty, non-string, or malformed topics (returns normalizedTopic = '', isProtected = true).
 * - Uses strict canonical sets (never loose substring `.includes('EMERGENCY')` checks).
 * - Any unknown or unlisted topic fails closed (`category: 'UNKNOWN'`, `isEmergency: false`,
 *   `isProtected: true`, `canClientNetworkBroadcast: false`).
 */
export function classifyRealtimeTopic(topic: unknown): RealtimeTopicClassification {
  if (typeof topic !== 'string') {
    return {
      normalizedTopic: '',
      category: 'UNKNOWN',
      isEmergency: false,
      isProtected: true,
      canClientNetworkBroadcast: false,
    };
  }

  const normalized = topic.trim().toUpperCase();
  if (!normalized || !CANONICAL_TOPIC_FORMAT_REGEX.test(normalized)) {
    return {
      normalizedTopic: '',
      category: 'UNKNOWN',
      isEmergency: false,
      isProtected: true,
      canClientNetworkBroadcast: false,
    };
  }

  if (CANONICAL_CHILD_EMERGENCY_TOPICS.has(normalized)) {
    return {
      normalizedTopic: normalized,
      category: 'CHILD_EMERGENCY',
      isEmergency: true,
      isProtected: true,
      canClientNetworkBroadcast: false,
    };
  }

  if (CANONICAL_EMERGENCY_TOPICS.has(normalized)) {
    return {
      normalizedTopic: normalized,
      category: 'EMERGENCY',
      isEmergency: true,
      isProtected: true,
      canClientNetworkBroadcast: false,
    };
  }

  if (CANONICAL_SECURITY_ALERT_TOPICS.has(normalized)) {
    return {
      normalizedTopic: normalized,
      category: 'SECURITY_ALERT',
      isEmergency: false,
      isProtected: true,
      canClientNetworkBroadcast: false,
    };
  }

  if (CANONICAL_CHILD_SAFETY_TOPICS.has(normalized)) {
    return {
      normalizedTopic: normalized,
      category: 'CHILD_SAFETY',
      isEmergency: false,
      isProtected: true,
      canClientNetworkBroadcast: false,
    };
  }

  if (CANONICAL_VISITOR_TOPICS.has(normalized)) {
    return {
      normalizedTopic: normalized,
      category: 'VISITOR',
      isEmergency: false,
      isProtected: true,
      canClientNetworkBroadcast: false,
    };
  }

  if (CANONICAL_GATE_DELIVERY_TOPICS.has(normalized)) {
    return {
      normalizedTopic: normalized,
      category: 'GATE_DELIVERY',
      isEmergency: false,
      isProtected: true,
      canClientNetworkBroadcast: false,
    };
  }

  if (CANONICAL_PAYMENT_TOPICS.has(normalized)) {
    return {
      normalizedTopic: normalized,
      category: 'PAYMENT',
      isEmergency: false,
      isProtected: true,
      canClientNetworkBroadcast: false,
    };
  }

  const isPublicOperational =
    CANONICAL_PUBLIC_NETWORK_BROADCAST_EXACT.has(normalized) ||
    CANONICAL_PUBLIC_NETWORK_BROADCAST_PREFIXES.some((prefix) => normalized.startsWith(prefix));

  if (isPublicOperational) {
    return {
      normalizedTopic: normalized,
      category: 'OPERATIONAL_PUBLIC',
      isEmergency: false,
      isProtected: false,
      canClientNetworkBroadcast: true,
    };
  }

  // Fail closed for all unknown, resident-private, guest-stay, notification, or future topics
  return {
    normalizedTopic: normalized,
    category: 'UNKNOWN',
    isEmergency: false,
    isProtected: true,
    canClientNetworkBroadcast: false,
  };
}

function parseRetryAfterMs(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  if (!trimmed) return undefined;

  // Strict non-negative delta-seconds (rejects negative, NaN, Infinity, scientific notation)
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const asSeconds = Number(trimmed);
    if (Number.isFinite(asSeconds) && asSeconds >= 0) {
      return Math.min(Math.ceil(asSeconds * 1000), MAX_RETRY_AFTER_MS);
    }
    return undefined;
  }

  // RFC 7231 HTTP-date format
  const asDateMs = Date.parse(trimmed);
  if (!Number.isNaN(asDateMs)) {
    const deltaMs = asDateMs - Date.now();
    if (deltaMs <= 0) {
      // Past or immediate HTTP-date: fall back to normal bounded exponential backoff
      return undefined;
    }
    return Math.min(deltaMs, MAX_RETRY_AFTER_MS);
  }

  return undefined;
}

function resolveChildSafetyPathForRole(role?: string): string {
  const normalized = (role || '').trim().toLowerCase();
  if (normalized === 'guard') return '/security/child-safety';
  if (normalized === 'secretary' || normalized === 'admin' || normalized === 'committee') {
    return '/admin/child-safety';
  }
  return '/resident/child-safety';
}

/**
 * Clean Web Audio API Chime Synthesizer
 * Produces crisp harmonic notification tones with 0 external sound files
 */
function playAudioChime(urgency: 'info' | 'alert' | 'emergency' = 'info') {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    if (urgency === 'emergency') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1174, ctx.currentTime + 0.15);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.46);
    } else if (urgency === 'alert') {
      [784, 1046].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        const start = ctx.currentTime + idx * 0.11;
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.12, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.23);
      });
    } else {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(987.77, ctx.currentTime);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    }
  } catch {
    // Audio autoplay restrictions before first user interaction
  }
}

export class RealtimeService {
  private abortController: AbortController | null = null;
  private subscribers: Map<string, Set<MessageCallback>> = new Map();
  private statusSubscribers: Set<StatusCallback> = new Set();
  private alertSubscribers: Set<AlertCallback> = new Set();
  private recentMessages: RealtimeMessage[] = [];
  private seenMessageIds: Set<string> = new Set();
  private totalMessagesReceived = 0;
  private isConnected = false;
  private connectionState: 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'OFFLINE' = 'OFFLINE';
  private measuredLatencyMs = 8;
  public lastPingTime: number = Date.now();
  private lastEventTime?: string;
  private lastEventId: string | null = null;
  private sseErrorCount = 0;
  private serverRetryFloorMs: number | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private stableConnectionTimer: ReturnType<typeof setTimeout> | null = null;
  public currentSocietyId = '';

  // Session & generation guards prevent stale streams/callbacks from leaking across sessions
  private activeSession: RealtimeSessionContext | null = null;
  private activeSessionIdentity: string | null = null;
  private activeConnectionKey: string | null = null;
  private sessionEpoch = 0;
  private connectionGeneration = 0;

  private readonly fetchFn?: typeof fetch;
  private readonly getBaseUrl: () => string;
  private readonly baseReconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;
  private readonly maxJitterMs: number;
  private readonly stableConnectionMs: number;
  private readonly maxFrameBytes?: number;
  private readonly boundOnlineHandler: (() => void) | null = null;

  constructor(options: RealtimeServiceOptions = {}) {
    this.fetchFn = options.fetchFn;
    this.getBaseUrl = options.getBaseUrl || getBackendBaseUrl;
    this.baseReconnectDelayMs = options.baseReconnectDelayMs ?? DEFAULT_BASE_RECONNECT_MS;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_MS;
    this.maxJitterMs = options.maxJitterMs ?? DEFAULT_MAX_JITTER_MS;
    this.stableConnectionMs = options.stableConnectionMs ?? DEFAULT_STABLE_CONNECTION_MS;
    this.maxFrameBytes = options.maxFrameBytes;

    // Security invariant (F-P2-01B): BroadcastChannel is NEVER opened or used for domain events.
    // Authenticated Fetch SSE is the sole authoritative cross-tab/network domain-event transport.

    if (options.enableOnlineListener !== false && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      this.boundOnlineHandler = () => this.handleNetworkResume();
      window.addEventListener('online', this.boundOnlineHandler);
    }

    this.seedRecentMessages();
  }

  /**
   * Authoritative Fetch-based Authenticated SSE Connection Entry Point.
   * - Requires a valid Bearer token and userId; never connects unauthenticated.
   * - Never places tokens in URL query parameters.
   * - Deduplicates identical active connections.
   * - Preserves `lastEventId` across same-user token refresh, and resets state on user/society/role switch.
   */
  public connect(session: RealtimeSessionContext): void {
    const token = typeof session?.token === 'string' ? session.token.trim() : '';
    const userId = typeof session?.userId === 'string' ? session.userId.trim() : '';
    const societyId = typeof session?.societyId === 'string' ? session.societyId.trim() : '';
    const role = typeof session?.role === 'string' ? session.role.trim().toLowerCase() : '';

    if (!token || !userId) {
      this.disconnect();
      return;
    }

    const sessionIdentity = `${userId}:${societyId}:${role}`;
    const connectionKey = `${sessionIdentity}:${token}`;

    // Prevent duplicate concurrent connections for the exact same active session + token
    if (
      this.activeConnectionKey === connectionKey &&
      (this.connectionState === 'CONNECTING' || this.connectionState === 'CONNECTED') &&
      this.abortController &&
      !this.abortController.signal.aborted
    ) {
      return;
    }

    const isSameIdentity = this.activeSessionIdentity === sessionIdentity;

    // Tear down any previous connection & pending retry before opening the new stream
    this.clearTimers();
    this.abortActiveStream();

    if (!isSameIdentity) {
      // User, society, or role switched: invalidate epoch & purge session-scoped caches/cursors
      this.sessionEpoch += 1;
      this.lastEventId = null;
      this.seenMessageIds.clear();
      this.recentMessages = [];
      this.sseErrorCount = 0;
      this.serverRetryFloorMs = null;
    } else {
      // Same identity with refreshed token: preserve lastEventId & seenMessageIds to avoid replay gaps/dupes
      this.sseErrorCount = 0;
    }

    this.connectionGeneration += 1;
    this.activeSession = { token, userId, societyId, role };
    this.activeSessionIdentity = sessionIdentity;
    this.activeConnectionKey = connectionKey;
    this.currentSocietyId = societyId;

    this.openFetchSseStream(this.activeSession, this.sessionEpoch, this.connectionGeneration, false);
  }

  /**
   * Immediately terminates the SSE stream, cancels all reconnect timers, and clears session state.
   */
  public disconnect(): void {
    this.sessionEpoch += 1;
    this.connectionGeneration += 1;
    this.clearTimers();
    this.abortActiveStream();

    this.activeSession = null;
    this.activeSessionIdentity = null;
    this.activeConnectionKey = null;
    this.currentSocietyId = '';
    this.lastEventId = null;
    this.seenMessageIds.clear();
    this.recentMessages = [];
    this.sseErrorCount = 0;
    this.serverRetryFloorMs = null;
    this.isConnected = false;
    this.connectionState = 'OFFLINE';
    this.notifyStatusListeners();
  }

  /**
   * Tears down global listeners and active stream state (for test cleanup / unmount).
   */
  public destroy(): void {
    this.disconnect();
    if (this.boundOnlineHandler && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('online', this.boundOnlineHandler);
    }
  }

  /**
   * Trigger an immediate reconnect when network connectivity or mobile app foreground resumes.
   */
  public handleNetworkResume(): void {
    if (!this.activeSession) return;
    if (this.connectionState !== 'RECONNECTING') return;

    const latestToken = getAuthToken();
    if (!latestToken) {
      this.disconnect();
      return;
    }

    this.clearTimers();
    this.abortActiveStream();
    this.connectionGeneration += 1;
    const resumedSession: RealtimeSessionContext = {
      ...this.activeSession,
      token: latestToken,
    };
    this.activeSession = resumedSession;
    this.activeConnectionKey = `${this.activeSessionIdentity}:${latestToken}`;
    this.openFetchSseStream(resumedSession, this.sessionEpoch, this.connectionGeneration, true);
  }

  /**
   * Backward-compatible entry point. Never opens an unauthenticated stream.
   */
  public initSseStream(societyId?: string, userId?: string, userRole?: string): void {
    const token = getAuthToken();
    const storedUser = getStoredUser();
    const resolvedUserId = userId || storedUser?.id || (storedUser as any)?.uid || '';
    const resolvedSocietyId = societyId || storedUser?.societyId || '';
    const resolvedRole = userRole || storedUser?.role || '';

    if (!token || !resolvedUserId) {
      this.disconnect();
      return;
    }

    this.connect({
      token,
      userId: resolvedUserId,
      societyId: resolvedSocietyId,
      role: resolvedRole,
    });
  }

  /**
   * Backward-compatible manual reconnect trigger (used by RealtimeLiveBar).
   * Respects authentication: refuses to connect if no valid Bearer token exists.
   */
  public forceReconnect(societyId?: string): void {
    const token = getAuthToken();
    const storedUser = getStoredUser();
    const baseSession = this.activeSession || (
      token && storedUser
        ? {
            token,
            userId: storedUser.id || (storedUser as any).uid || '',
            societyId: storedUser.societyId || '',
            role: storedUser.role || '',
          }
        : null
    );

    if (!baseSession || !token || !baseSession.userId) {
      this.disconnect();
      return;
    }

    const nextSocietyId =
      typeof societyId === 'string' && societyId.trim().length > 0
        ? societyId.trim()
        : baseSession.societyId;

    this.clearTimers();
    this.abortActiveStream();
    this.sseErrorCount = 0;
    this.connectionGeneration += 1;

    const nextSession: RealtimeSessionContext = {
      ...baseSession,
      token,
      societyId: nextSocietyId,
    };

    const nextIdentity = `${nextSession.userId}:${nextSession.societyId || ''}:${(nextSession.role || '').toLowerCase()}`;
    const identityChanged = nextIdentity !== this.activeSessionIdentity;
    if (identityChanged) {
      this.sessionEpoch += 1;
      this.lastEventId = null;
      this.seenMessageIds.clear();
      this.recentMessages = [];
      this.activeSessionIdentity = nextIdentity;
    }

    this.activeSession = nextSession;
    this.activeConnectionKey = `${nextIdentity}:${token}`;
    this.currentSocietyId = nextSession.societyId || '';

    this.openFetchSseStream(nextSession, this.sessionEpoch, this.connectionGeneration, false);
  }

  private clearTimers(): void {
    if (this.reconnectTimeout !== null) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.stableConnectionTimer !== null) {
      clearTimeout(this.stableConnectionTimer);
      this.stableConnectionTimer = null;
    }
  }

  private abortActiveStream(): void {
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {}
      this.abortController = null;
    }
  }

  private isCurrentStream(epoch: number, generation: number): boolean {
    return this.sessionEpoch === epoch && this.connectionGeneration === generation;
  }

  private buildStreamUrl(session: RealtimeSessionContext): string {
    const baseUrl = this.getBaseUrl().replace(/\/+$/, '');
    const params = new URLSearchParams();
    const soc = (session.societyId || '').trim();
    // Optional societyId query parameter ONLY for concrete non-sentinel IDs;
    // NEVER place JWTs, tokens, userId, or role in query parameters.
    if (soc && !PLATFORM_ADMIN_SENTINELS.has(soc)) {
      params.set('societyId', soc);
    }
    const qs = params.toString();
    return `${baseUrl}/api/realtime/stream${qs ? `?${qs}` : ''}`;
  }

  private async openFetchSseStream(
    session: RealtimeSessionContext,
    epoch: number,
    generation: number,
    isRetry: boolean
  ): Promise<void> {
    if (!this.isCurrentStream(epoch, generation)) return;

    const fetchImpl = this.fetchFn || (typeof fetch === 'function' ? fetch : undefined);
    if (!fetchImpl) {
      this.isConnected = false;
      this.connectionState = 'OFFLINE';
      this.notifyStatusListeners();
      return;
    }

    const controller = new AbortController();
    this.abortController = controller;
    this.isConnected = false;
    this.connectionState = isRetry || this.sseErrorCount > 0 ? 'RECONNECTING' : 'CONNECTING';
    this.notifyStatusListeners();

    const url = this.buildStreamUrl(session);
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${session.token}`,
      'Cache-Control': 'no-cache',
    };

    if (this.lastEventId && isValidSseEventId(this.lastEventId)) {
      headers['Last-Event-ID'] = this.lastEventId;
    }

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
    } catch {
      if (!this.isCurrentStream(epoch, generation) || controller.signal.aborted) {
        return;
      }
      this.scheduleReconnect(session, epoch, generation);
      return;
    }

    const safeCancelBody = async (res: Response): Promise<void> => {
      try {
        await res.body?.cancel?.();
      } catch {}
    };

    if (!this.isCurrentStream(epoch, generation) || controller.signal.aborted) {
      await safeCancelBody(response);
      return;
    }

    // Explicit HTTP status classification
    if (response.status === 401) {
      await safeCancelBody(response);
      // Race-safe 401 invalidation: clear session ONLY if stored token still matches this stream's token
      if (getAuthToken() === session.token) {
        clearAuthSession();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('aarizo:unauthorized', { detail: { endpoint: '/api/realtime/stream' } }));
        }
      }
      this.disconnect();
      return;
    }

    if (response.status === 403) {
      await safeCancelBody(response);
      // Forbidden (role/tenant/account suspended): stop permanently without clearing valid session
      this.clearTimers();
      this.abortActiveStream();
      this.isConnected = false;
      this.connectionState = 'OFFLINE';
      this.notifyStatusListeners();
      return;
    }

    if (response.status === 408) {
      await safeCancelBody(response);
      // Request Timeout: transient failure -> reconnect with bounded backoff
      this.scheduleReconnect(session, epoch, generation);
      return;
    }

    if (response.status === 429) {
      await safeCancelBody(response);
      const retryAfterMs = parseRetryAfterMs(response.headers?.get?.('Retry-After') ?? null);
      this.scheduleReconnect(session, epoch, generation, retryAfterMs);
      return;
    }

    // Other 4xx statuses (400, 404, 405, 410, 422, etc.) are permanent client/route failures — do NOT retry
    if (response.status >= 400 && response.status < 500) {
      await safeCancelBody(response);
      this.clearTimers();
      this.abortActiveStream();
      this.isConnected = false;
      this.connectionState = 'OFFLINE';
      this.notifyStatusListeners();
      return;
    }

    // 5xx or non-ok responses: transient server/proxy error -> reconnect with bounded backoff
    if (!response.ok) {
      await safeCancelBody(response);
      const retryAfterMs =
        response.status === 503
          ? parseRetryAfterMs(response.headers?.get?.('Retry-After') ?? null)
          : undefined;
      this.scheduleReconnect(session, epoch, generation, retryAfterMs);
      return;
    }

    // Strict 2xx streaming validation BEFORE marking CONNECTED:
    // 1. Must be HTTP 200 OK (rejects 204 No Content and non-streaming 2xx)
    if (response.status !== 200) {
      await safeCancelBody(response);
      this.scheduleReconnect(session, epoch, generation);
      return;
    }

    // 2. Must declare Content-Type media type `text/event-stream` (ignoring charset/params)
    const rawContentType =
      response.headers?.get?.('content-type') ??
      response.headers?.get?.('Content-Type') ??
      '';
    const mediaType = rawContentType.split(';')[0].trim().toLowerCase();
    if (mediaType !== 'text/event-stream') {
      await safeCancelBody(response);
      this.scheduleReconnect(session, epoch, generation);
      return;
    }

    // 3. Must provide a readable stream reader
    const reader = response.body?.getReader?.();
    if (!reader) {
      await safeCancelBody(response);
      this.scheduleReconnect(session, epoch, generation);
      return;
    }

    // Valid HTTP 200 text/event-stream accepted — mark connected and arm stable-connection backoff reset timer
    this.isConnected = true;
    this.connectionState = 'CONNECTED';
    this.notifyStatusListeners();

    this.stableConnectionTimer = setTimeout(() => {
      if (this.isCurrentStream(epoch, generation) && this.isConnected) {
        this.sseErrorCount = 0;
      }
    }, this.stableConnectionMs);

    const parser = new SseFrameParser({
      maxFrameBytes: this.maxFrameBytes,
    });

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (!this.isCurrentStream(epoch, generation) || controller.signal.aborted) {
          try {
            await reader.cancel();
          } catch {}
          return;
        }

        if (done) {
          // WHATWG SSE Section 9.2.6: flush UTF-8 decoder and discard any incomplete unterminated frame
          const trailingFrames = parser.finishStream();
          for (const frame of trailingFrames) {
            if (!this.isCurrentStream(epoch, generation)) return;
            this.processSseFrame(frame, session, epoch, generation);
          }
          break;
        }

        if (value && value.byteLength > 0) {
          const frames = parser.feed(value);
          for (const frame of frames) {
            if (!this.isCurrentStream(epoch, generation)) return;
            this.processSseFrame(frame, session, epoch, generation);
          }
        }
      }
    } catch {
      if (!this.isCurrentStream(epoch, generation) || controller.signal.aborted) {
        return;
      }
    } finally {
      if (this.stableConnectionTimer !== null) {
        clearTimeout(this.stableConnectionTimer);
        this.stableConnectionTimer = null;
      }
    }

    // Stream terminated unexpectedly (EOF or read error) while still the active generation -> reconnect
    if (this.isCurrentStream(epoch, generation) && !controller.signal.aborted) {
      this.scheduleReconnect(session, epoch, generation);
    }
  }

  private processSseFrame(
    frame: ParsedSseFrame,
    session: RealtimeSessionContext,
    epoch: number,
    generation: number
  ): void {
    if (!this.isCurrentStream(epoch, generation)) return;

    if (frame.retryMs !== undefined) {
      this.serverRetryFloorMs = Math.max(500, Math.min(frame.retryMs, this.maxReconnectDelayMs));
    }

    if (!frame.data || frame.data.trim().length === 0) {
      return;
    }

    let data: any;
    try {
      data = JSON.parse(frame.data);
    } catch {
      // Ignore malformed non-JSON frame safely without crashing the stream
      return;
    }

    if (!data || typeof data !== 'object') {
      return;
    }

    // 1. Server heartbeat telemetry frame (`{ type: 'PING', timestamp }`)
    if (data.type === 'PING') {
      this.measuredLatencyMs = Math.max(2, Date.now() - (Number(data.timestamp) || Date.now()));
      this.lastPingTime = Date.now();
      this.notifyStatusListeners();
      return;
    }

    // 2. Initial server handshake frame (`topic: 'connected'` / `eventType: 'connected'`)
    const rawTopic = frame.event || data.topic || data.eventType || data.type;
    if (typeof rawTopic === 'string' && rawTopic.toLowerCase() === 'connected') {
      this.isConnected = true;
      this.connectionState = 'CONNECTED';
      this.sseErrorCount = 0;
      this.notifyStatusListeners();
      return;
    }

    // 3. Domain event frame
    if (typeof rawTopic !== 'string' || rawTopic.trim().length === 0) {
      return;
    }

    const topicClassification = classifyRealtimeTopic(rawTopic);
    if (!topicClassification.normalizedTopic) {
      // Malformed / invalid topic syntax fails closed without side effects
      return;
    }

    const explicitCursorReset = frame.id === '';
    const candidateEventId = explicitCursorReset
      ? undefined
      : frame.id !== undefined
        ? frame.id
        : (data.eventId || data.id);
    const validCursorId = isValidSseEventId(candidateEventId) ? candidateEventId.trim() : undefined;

    const messageId = validCursorId || `sse_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const dispatchResult = this.handleIncomingMessage(
      {
        id: messageId,
        topic: rawTopic.trim(),
        type: rawTopic.trim(),
        societyId: data.societyId || session.societyId || '',
        payload: data.payload !== undefined ? data.payload : data,
        timestamp: typeof data.timestamp === 'string' ? data.timestamp : new Date().toISOString(),
        senderRole: data.senderRole || 'SYSTEM',
        senderName: data.senderName || 'PostgreSQL Realtime',
      },
      'SSE',
      epoch
    );

    // Advance (or explicitly reset) the replay cursor ONLY AFTER dispatch succeeds for the current active stream
    if (this.isCurrentStream(epoch, generation) && !dispatchResult.hadSubscriberError) {
      if (explicitCursorReset) {
        this.lastEventId = null;
      } else if (validCursorId) {
        this.lastEventId = validCursorId;
      }
    }
  }

  private scheduleReconnect(
    session: RealtimeSessionContext,
    epoch: number,
    generation: number,
    minDelayOverrideMs?: number
  ): void {
    if (!this.isCurrentStream(epoch, generation)) return;

    this.clearTimers();
    this.abortActiveStream();
    this.isConnected = false;

    // Stop retrying immediately if auth storage indicates the session has been cleared
    const currentStoredToken = getAuthToken();
    if (!currentStoredToken && !isSessionValid()) {
      this.connectionState = 'OFFLINE';
      this.notifyStatusListeners();
      return;
    }

    this.connectionState = 'RECONNECTING';
    this.notifyStatusListeners();

    const expDelay = Math.min(
      this.baseReconnectDelayMs * Math.pow(2, Math.min(this.sseErrorCount, 6)),
      this.maxReconnectDelayMs
    );
    const floorDelay = Math.max(expDelay, this.serverRetryFloorMs ?? 0, minDelayOverrideMs ?? 0);
    const boundedDelay = Math.min(floorDelay, Math.max(this.maxReconnectDelayMs, minDelayOverrideMs ?? 0, MAX_RETRY_AFTER_MS));
    const jitter = this.maxJitterMs > 0 ? Math.floor(Math.random() * this.maxJitterMs) : 0;
    const delayMs = boundedDelay + jitter;

    this.sseErrorCount += 1;

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (!this.isCurrentStream(epoch, generation)) return;

      // Always pick up latest canonical token in case it refreshed while waiting
      const refreshedToken = getAuthToken();
      if (!refreshedToken) {
        this.disconnect();
        return;
      }

      const nextSession: RealtimeSessionContext = {
        ...session,
        token: refreshedToken,
      };
      this.activeSession = nextSession;
      this.activeConnectionKey = `${this.activeSessionIdentity}:${refreshedToken}`;
      this.openFetchSseStream(nextSession, epoch, generation, true);
    }, delayMs);
  }

  private seedRecentMessages() {
    this.recentMessages = [];
    this.totalMessagesReceived = 0;
  }

  /**
   * Central Publish Engine: Dispatches to local in-tab listeners and, ONLY for explicitly allowlisted
   * non-sensitive public operational topics when authenticated, posts to `/api/realtime/broadcast`.
   * Security invariant (F-P2-01B): Domain events are NEVER relayed over BroadcastChannel.
   * Authenticated Fetch SSE is the exclusive cross-tab/network source of domain-event payloads.
   */
  public publish<T = any>(
    topicOrMsg:
      | RealtimeTopic
      | { type?: string; topic?: RealtimeTopic; payload?: any; societyId?: string; senderRole?: string; senderName?: string },
    payload?: T,
    societyId?: string,
    senderRole = 'SYSTEM',
    senderName = 'Realtime Engine'
  ): RealtimeMessage<T> {
    const fallbackSocietyId = societyId || this.currentSocietyId || this.activeSession?.societyId || '';
    let actualTopic: RealtimeTopic;
    let actualPayload: any;
    let actualSocietyId = fallbackSocietyId;
    let actualSenderRole = senderRole;
    let actualSenderName = senderName;

    if (typeof topicOrMsg === 'object' && topicOrMsg !== null && ('type' in topicOrMsg || 'topic' in topicOrMsg)) {
      actualTopic = (topicOrMsg.topic || topicOrMsg.type || 'GENERAL') as RealtimeTopic;
      actualPayload = topicOrMsg.payload;
      actualSocietyId = topicOrMsg.societyId || fallbackSocietyId;
      actualSenderRole = topicOrMsg.senderRole || senderRole;
      actualSenderName = topicOrMsg.senderName || senderName;
    } else {
      actualTopic = topicOrMsg as RealtimeTopic;
      actualPayload = payload;
    }

    const msg: RealtimeMessage<T> = {
      id: `rt-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      topic: actualTopic,
      type: actualTopic,
      societyId: actualSocietyId,
      payload: actualPayload,
      timestamp: new Date().toISOString(),
      senderRole: actualSenderRole,
      senderName: actualSenderName,
    };

    const classification = classifyRealtimeTopic(actualTopic);

    // 1. Broadcast across network ONLY for explicitly allowlisted public operational topics when authenticated.
    //    Protected/sensitive/unknown/malformed topics NEVER leave the client via /api/realtime/broadcast.
    if (
      classification.canClientNetworkBroadcast &&
      getAuthToken() &&
      typeof window !== 'undefined' &&
      typeof window.fetch === 'function'
    ) {
      try {
        authenticatedFetch(`${this.getBaseUrl()}/api/realtime/broadcast`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic: actualTopic,
            payload: actualPayload,
            societyId: actualSocietyId,
            senderRole: actualSenderRole,
            senderName: actualSenderName,
          }),
        }).catch(() => {});
      } catch {}
    }

    // 2. Dispatch strictly to local in-tab subscribers (no privileged emergency side effects)
    this.handleIncomingMessage(msg, 'LOCAL_PUBLISH', this.sessionEpoch);

    return msg;
  }

  public broadcast<T = any>(
    topic: string,
    payload: T,
    societyId?: string,
    senderRole = 'SYSTEM',
    senderName = 'Realtime Engine'
  ): RealtimeMessage<T> {
    return this.publish(topic as any, payload, societyId, senderRole, senderName);
  }

  /**
   * Internal message handler with strict event-source validation, canonical fail-closed topic
   * classification, epoch isolation, bounded FIFO deduplication, and per-subscriber error isolation.
   * Privileged emergency/security/operational UI alerts, audio chimes, and haptics are triggered
   * EXCLUSIVELY for canonical supported topics arriving from authenticated Fetch SSE (`source === 'SSE'`).
   */
  private handleIncomingMessage(
    msg: RealtimeMessage,
    source: RealtimeDeliveryOrigin,
    expectedEpoch?: number
  ): { delivered: boolean; hadSubscriberError: boolean } {
    if (expectedEpoch !== undefined && expectedEpoch !== this.sessionEpoch) {
      return { delivered: false, hadSubscriberError: false };
    }

    const classification = classifyRealtimeTopic(msg?.topic);
    if (!classification.normalizedTopic) {
      // Empty or malformed topic fails closed with zero state mutation or side effects
      return { delivered: false, hadSubscriberError: false };
    }

    if (this.seenMessageIds.has(msg.id)) {
      return { delivered: false, hadSubscriberError: false };
    }
    this.seenMessageIds.add(msg.id);
    if (this.seenMessageIds.size > MAX_SEEN_MESSAGE_IDS) {
      const oldest = this.seenMessageIds.values().next().value;
      if (oldest !== undefined) {
        this.seenMessageIds.delete(oldest);
      }
    }

    this.totalMessagesReceived += 1;
    this.lastEventTime = msg.timestamp;
    this.recentMessages = [msg, ...this.recentMessages.slice(0, 49)];

    let hadSubscriberError = false;
    const topicUpper = classification.normalizedTopic;
    const activeRole = this.activeSession?.role || getStoredUser()?.role;

    // Privileged alert toasts, audio chimes, and haptics execute ONLY for authenticated SSE events
    // classified under canonical supported categories. Unknown/unlisted topics fail closed silently.
    if (source === 'SSE') {
      switch (classification.category) {
        case 'CHILD_EMERGENCY': {
          playAudioChime('emergency');
          triggerHaptic('heavy');
          if (
            this.dispatchAlert({
              id: msg.id,
              topic: msg.topic,
              title: '🚨 Child Safety SOS Alert',
              description:
                msg.payload?.message ||
                msg.payload?.description ||
                msg.payload?.location ||
                'Immediate emergency protocol activated',
              urgency: 'emergency',
              timestamp: msg.timestamp,
              actionPath: resolveChildSafetyPathForRole(activeRole),
              payload: msg.payload,
            })
          ) {
            hadSubscriberError = true;
          }
          break;
        }
        case 'EMERGENCY': {
          playAudioChime('emergency');
          triggerHaptic('heavy');
          if (
            this.dispatchAlert({
              id: msg.id,
              topic: msg.topic,
              title: '🚨 Emergency Alert Broadcasted',
              description:
                msg.payload?.message ||
                msg.payload?.description ||
                msg.payload?.location ||
                'Immediate emergency protocol activated',
              urgency: 'emergency',
              timestamp: msg.timestamp,
              actionPath: '/emergency',
              payload: msg.payload,
            })
          ) {
            hadSubscriberError = true;
          }
          break;
        }
        case 'SECURITY_ALERT': {
          const isResolved = topicUpper.endsWith('_RESOLVED');
          playAudioChime(isResolved ? 'info' : 'alert');
          triggerHaptic(isResolved ? 'light' : 'medium');
          if (
            this.dispatchAlert({
              id: msg.id,
              topic: msg.topic,
              title: isResolved ? '✅ Security Alert Resolved' : '🛡️ Security Alert Notification',
              description:
                msg.payload?.message ||
                msg.payload?.description ||
                msg.payload?.location ||
                'Security alert status updated',
              urgency: isResolved ? 'info' : 'alert',
              timestamp: msg.timestamp,
              actionPath: '/emergency',
              payload: msg.payload,
            })
          ) {
            hadSubscriberError = true;
          }
          break;
        }
        case 'CHILD_SAFETY': {
          const isHighAlert = topicUpper === 'CHILD_EXIT_DENIED' || topicUpper === 'CHILD_EXIT_TRIGGERED';
          playAudioChime(isHighAlert ? 'alert' : 'info');
          triggerHaptic(isHighAlert ? 'medium' : 'light');
          const title =
            topicUpper === 'CHILD_EXIT_DENIED'
              ? '⚠️ Child Gate Exit Denied'
              : topicUpper === 'CHILD_EXIT_TRIGGERED' || topicUpper === 'CHILD_GATE_PASS_VERIFIED'
                ? '✅ Child Gate Exit Verified'
                : topicUpper === 'CHILD_GATE_PASS_GENERATED'
                  ? '🎫 Child Gate Pass Generated'
                  : topicUpper === 'CHILD_SAFETY_ALERT_RESOLVED'
                    ? '✅ Child Safety Alert Resolved'
                    : topicUpper === 'CHILD_PICKUP_AUTHORIZED'
                      ? '🤝 Authorized Pickup Registered'
                      : topicUpper === 'CHILD_PICKUP_REVOKED'
                        ? '🛑 Pickup Authorization Revoked'
                        : topicUpper === 'CHILD_PICKUP_UPDATED'
                          ? '📝 Pickup Authorization Updated'
                          : '🛡️ Child Safety Update';
          if (
            this.dispatchAlert({
              id: msg.id,
              topic: msg.topic,
              title,
              description: msg.payload?.passCode
                ? `Pass ${msg.payload.passCode}`
                : msg.payload?.reasonCode || 'Child safety record updated',
              urgency: isHighAlert ? 'alert' : 'info',
              timestamp: msg.timestamp,
              actionPath: resolveChildSafetyPathForRole(activeRole),
              payload: msg.payload,
            })
          ) {
            hadSubscriberError = true;
          }
          break;
        }
        case 'VISITOR': {
          playAudioChime('alert');
          triggerHaptic('medium');
          if (
            this.dispatchAlert({
              id: msg.id,
              topic: msg.topic,
              title: `👤 Visitor Entry: ${msg.payload?.visitorName || 'Guest'}`,
              description: msg.payload?.flatCode ? `For Flat ${msg.payload.flatCode}` : 'Activity recorded at gate',
              urgency: 'alert',
              timestamp: msg.timestamp,
              actionPath: '/resident/visitors',
              payload: msg.payload,
            })
          ) {
            hadSubscriberError = true;
          }
          break;
        }
        case 'GATE_DELIVERY': {
          playAudioChime('alert');
          triggerHaptic('medium');
          const title =
            topicUpper === 'PARCEL_ARRIVED'
              ? `📦 Parcel Arrived: ${msg.payload?.courier || 'Delivery'}`
              : `⚡ Gate Activity: ${msg.payload?.status || 'Update'}`;
          if (
            this.dispatchAlert({
              id: msg.id,
              topic: msg.topic,
              title,
              description: msg.payload?.flatCode ? `For Flat ${msg.payload.flatCode}` : 'Activity recorded at gate',
              urgency: 'alert',
              timestamp: msg.timestamp,
              actionPath: '/resident/deliveries',
              payload: msg.payload,
            })
          ) {
            hadSubscriberError = true;
          }
          break;
        }
        case 'PAYMENT': {
          playAudioChime('info');
          triggerHaptic('success');
          if (
            this.dispatchAlert({
              id: msg.id,
              topic: msg.topic,
              title: '💳 Payment Transaction Completed',
              description: msg.payload?.amount ? `Amount: ₹${msg.payload.amount}` : 'Society payment verified',
              urgency: 'info',
              timestamp: msg.timestamp,
              actionPath: '/resident/billing',
              payload: msg.payload,
            })
          ) {
            hadSubscriberError = true;
          }
          break;
        }
        case 'OPERATIONAL_PUBLIC': {
          triggerHaptic('light');
          break;
        }
        case 'UNKNOWN':
        default: {
          // Unknown/unsupported topics fail closed: zero emergency/alert/audio/haptic side effects
          break;
        }
      }
    }

    // Notify specific topic subscribers (snapshot Set so unsubscribes inside callbacks are safe)
    const topicSubscribers = this.subscribers.get(msg.topic);
    if (topicSubscribers) {
      Array.from(topicSubscribers).forEach((cb) => {
        if (expectedEpoch !== undefined && expectedEpoch !== this.sessionEpoch) return;
        try {
          cb(msg);
        } catch (err) {
          hadSubscriberError = true;
          console.error(`Error in realtime subscriber for topic ${msg.topic}:`, err);
        }
      });
    }

    // Notify wildcard '*' subscribers
    const wildcardSubscribers = this.subscribers.get('*');
    if (wildcardSubscribers) {
      Array.from(wildcardSubscribers).forEach((cb) => {
        if (expectedEpoch !== undefined && expectedEpoch !== this.sessionEpoch) return;
        try {
          cb(msg);
        } catch (err) {
          hadSubscriberError = true;
          console.error('Error in wildcard realtime subscriber:', err);
        }
      });
    }

    if (hadSubscriberError) {
      // Allow server replay after reconnect to re-deliver if a subscriber threw during handling
      this.seenMessageIds.delete(msg.id);
    }

    this.notifyStatusListeners();
    return { delivered: true, hadSubscriberError };
  }

  private dispatchAlert(alert: Parameters<AlertCallback>[0]): boolean {
    let hadError = false;
    Array.from(this.alertSubscribers).forEach((cb) => {
      try {
        cb(alert);
      } catch (err) {
        hadError = true;
        console.error('Error in alert subscriber:', err);
      }
    });
    return hadError;
  }

  /**
   * Subscribe to real-time UI floating alert toasts (duplicate identical callbacks ignored by Set).
   */
  public subscribeToAlerts(callback: AlertCallback): () => void {
    this.alertSubscribers.add(callback);
    return () => {
      this.alertSubscribers.delete(callback);
    };
  }

  /**
   * Subscribe to connection status changes (duplicate identical callbacks ignored by Set).
   */
  public subscribeToStatus(callback: StatusCallback): () => void {
    this.statusSubscribers.add(callback);
    callback(this.getConnectionStatus());
    return () => {
      this.statusSubscribers.delete(callback);
    };
  }

  private notifyStatusListeners() {
    const status = this.getConnectionStatus();
    Array.from(this.statusSubscribers).forEach((cb) => {
      try {
        cb(status);
      } catch {}
    });
  }

  /**
   * Central Subscription Engine with duplicate callback prevention and explicit unsubscribe cleanup.
   */
  public subscribe<T = any>(topic: RealtimeTopic | '*', callback: MessageCallback<T>): () => void {
    const key = topic;
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }

    const set = this.subscribers.get(key)!;
    set.add(callback as MessageCallback);

    return () => {
      const currentSet = this.subscribers.get(key);
      if (currentSet) {
        currentSet.delete(callback as MessageCallback);
        if (currentSet.size === 0) {
          this.subscribers.delete(key);
        }
      }
    };
  }

  /**
   * Get Recent Message Stream
   */
  public getRecentMessages(topicFilter?: RealtimeTopic | 'ALL'): RealtimeMessage[] {
    if (!topicFilter || topicFilter === 'ALL') {
      return this.recentMessages;
    }
    return this.recentMessages.filter((m) => m.topic === topicFilter);
  }

  /**
   * Get Last Verified Replay Event ID (for diagnostics / testing)
   */
  public getLastEventId(): string | null {
    return this.lastEventId;
  }

  /**
   * Get Diagnostic Connection Status
   */
  public getConnectionStatus(): RealtimeConnectionStatus {
    let activeListenersCount = 0;
    this.subscribers.forEach((set) => {
      activeListenersCount += set.size;
    });

    return {
      connected: this.isConnected,
      state: this.connectionState,
      transportType: 'HYBRID_OUTBOX',
      latencyMs: this.measuredLatencyMs,
      activeListenersCount,
      messagesReceivedTotal: this.totalMessagesReceived,
      lastEventTime: this.lastEventTime,
    };
  }
}

export const realtimeService = new RealtimeService();
