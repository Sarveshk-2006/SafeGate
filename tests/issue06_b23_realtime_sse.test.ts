// =============================================================================
// ISSUE-06 Phase B.2.3 — Phase 2: Authenticated Fetch-Based SSE & Lifecycle Tests
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

jest.mock('../src/utils/backendConfig', () => ({
  getBackendBaseUrl: jest.fn(() => 'http://localhost:5000'),
}));

jest.mock('../src/utils/nativeMobile', () => ({
  triggerHaptic: jest.fn(),
  isNativeApp: jest.fn(() => false),
}));

import { SseFrameParser, isValidSseEventId } from '../src/services/sseFrameParser';
import { RealtimeService, classifyRealtimeTopic } from '../src/services/realtimeService';
import { realTimeSync } from '../src/services/realTimeSync';
import { saveAuthSession, clearAuthSession, getAuthToken } from '../src/services/authStorage';
import { triggerHaptic } from '../src/utils/nativeMobile';
import type { UserProfile } from '../src/domains/auth/types';

/**
 * Deterministic in-memory BroadcastChannel mock that mirrors browser multi-tab routing.
 */
class MockBroadcastChannel {
  public static instances: MockBroadcastChannel[] = [];
  public readonly name: string;
  public onmessage: ((event: { data: any }) => void) | null = null;
  public closed = false;
  public postedMessages: any[] = [];

  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }

  public postMessage(data: any): void {
    if (this.closed) {
      throw new Error('Cannot postMessage on closed BroadcastChannel');
    }
    this.postedMessages.push(data);
    for (const peer of MockBroadcastChannel.instances) {
      if (peer !== this && !peer.closed && peer.name === this.name && typeof peer.onmessage === 'function') {
        peer.onmessage({ data });
      }
    }
  }

  public close(): void {
    this.closed = true;
  }

  public static reset(): void {
    MockBroadcastChannel.instances = [];
  }
}

/**
 * Controllable streaming SSE response for deterministic Fetch ReadableStream testing.
 */
class MockSseStreamController {
  private queue: Array<{ done: boolean; value?: Uint8Array; error?: Error }> = [];
  private waitingResolve: ((res: { done: boolean; value?: Uint8Array }) => void) | null = null;
  private waitingReject: ((err: Error) => void) | null = null;
  public cancelled = false;
  private encoder = new TextEncoder();

  public pushText(text: string): void {
    this.pushBytes(this.encoder.encode(text));
  }

  public pushBytes(bytes: Uint8Array): void {
    if (this.waitingResolve) {
      const resolve = this.waitingResolve;
      this.waitingResolve = null;
      this.waitingReject = null;
      resolve({ done: false, value: bytes });
    } else {
      this.queue.push({ done: false, value: bytes });
    }
  }

  public close(): void {
    if (this.waitingResolve) {
      const resolve = this.waitingResolve;
      this.waitingResolve = null;
      this.waitingReject = null;
      resolve({ done: true, value: undefined });
    } else {
      this.queue.push({ done: true });
    }
  }

  public fail(error: Error): void {
    if (this.waitingReject) {
      const reject = this.waitingReject;
      this.waitingResolve = null;
      this.waitingReject = null;
      reject(error);
    } else {
      this.queue.push({ done: false, error });
    }
  }

  public toResponse(status = 200, headersMap?: Record<string, string>): Response {
    const effectiveHeaders =
      headersMap !== undefined
        ? headersMap
        : status === 200
          ? { 'Content-Type': 'text/event-stream' }
          : {};
    const normalized = new Map<string, string>();
    for (const [k, v] of Object.entries(effectiveHeaders)) {
      normalized.set(k.toLowerCase(), v);
    }

    const reader = {
      read: (): Promise<{ done: boolean; value?: Uint8Array }> => {
        if (this.queue.length > 0) {
          const next = this.queue.shift()!;
          if (next.error) return Promise.reject(next.error);
          return Promise.resolve({ done: next.done, value: next.value });
        }
        return new Promise((resolve, reject) => {
          this.waitingResolve = resolve;
          this.waitingReject = reject;
        });
      },
      cancel: async () => {
        this.cancelled = true;
      },
    };

    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name: string) => normalized.get(name.toLowerCase()) ?? null,
      },
      body: {
        getReader: () => reader,
        cancel: async () => {
          this.cancelled = true;
        },
      },
    } as unknown as Response;
  }
}

async function flushMicrotasks(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
  }
}

const residentA: UserProfile = {
  id: 'usr-res-a',
  role: 'resident',
  societyId: 'soc-alpha',
  name: 'Rohan Sharma',
  phone: '+919876543210',
  email: 'rohan@alpha.test',
  flatNumber: 'A-402',
  status: 'ACTIVE',
};

const guardA: UserProfile = {
  id: 'usr-guard-a',
  role: 'guard',
  societyId: 'soc-alpha',
  name: 'Officer Vikram',
  phone: '+919876500000',
  email: 'vikram@alpha.test',
  status: 'ACTIVE',
};

const residentB: UserProfile = {
  id: 'usr-res-b',
  role: 'resident',
  societyId: 'soc-beta',
  name: 'Priya Nair',
  phone: '+919811112222',
  email: 'priya@beta.test',
  flatNumber: 'B-101',
  status: 'ACTIVE',
};

describe('ISSUE-06 Phase B.2.3 (Phase 2): Authenticated Fetch SSE & Lifecycle Suite', () => {
  let mockLocalStorage: MockStorage;
  let mockSessionStorage: MockStorage;
  let dispatchedEvents: Array<{ type: string; detail?: unknown }>;
  let mockFetch: jest.Mock;
  let service: RealtimeService;

  beforeEach(() => {
    mockLocalStorage = new MockStorage();
    mockSessionStorage = new MockStorage();
    dispatchedEvents = [];
    mockFetch = jest.fn();

    MockBroadcastChannel.reset();
    (global as any).BroadcastChannel = MockBroadcastChannel;
    (global as any).localStorage = mockLocalStorage;
    (global as any).sessionStorage = mockSessionStorage;
    (global as any).fetch = mockFetch;
    (global as any).window = {
      BroadcastChannel: MockBroadcastChannel,
      localStorage: mockLocalStorage,
      sessionStorage: mockSessionStorage,
      fetch: mockFetch,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: (event: any) => {
        dispatchedEvents.push({ type: event.type, detail: event.detail });
        return true;
      },
    };
    (global as any).CustomEvent = class {
      type: string;
      detail: unknown;
      constructor(type: string, params?: { detail?: unknown }) {
        this.type = type;
        this.detail = params?.detail;
      }
    };

    service = new RealtimeService({
      fetchFn: mockFetch,
      getBaseUrl: () => 'http://localhost:5000',
      enableBroadcastChannel: false,
      enableOnlineListener: false,
      baseReconnectDelayMs: 1000,
      maxReconnectDelayMs: 8000,
      maxJitterMs: 0,
      stableConnectionMs: 5000,
    });
  });

  afterEach(() => {
    service.destroy();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // =========================================================================
  // 1. SSE Frame Parsing (Pure SseFrameParser)
  // =========================================================================
  describe('1. SSE Frame Parsing (WHATWG Compliance, UTF-8 & Memory Bounds)', () => {
    test('parses standard backend id + data frames, event names, multiline data, comments, and retry directives', () => {
      const parser = new SseFrameParser();
      const raw = [
        ': keep-alive heartbeat comment',
        '',
        'id: evt_001',
        'event: CHILD_EXIT_TRIGGERED',
        'retry: 3000',
        'data: {"line":1,',
        'data: "child":"Aarav"}',
        '',
        'id: evt_002',
        'data: {"topic":"PING","type":"PING","timestamp":1700000000000}',
        '',
        '',
      ].join('\n');

      const frames = parser.feed(raw);
      expect(frames).toHaveLength(2);
      expect(frames[0]).toEqual({
        id: 'evt_001',
        event: 'CHILD_EXIT_TRIGGERED',
        retryMs: 3000,
        data: '{"line":1,\n"child":"Aarav"}',
      });
      expect(frames[1]).toEqual({
        id: 'evt_002',
        data: '{"topic":"PING","type":"PING","timestamp":1700000000000}',
      });
    });

    test('handles arbitrary chunk boundaries, split CRLF, and multi-byte UTF-8 split mid-character', () => {
      const parser = new SseFrameParser();
      const encoder = new TextEncoder();
      const payload = `id: evt_utf8\r\ndata: {"msg":"🚨 ₹500 आरव"}\r\n\r\n`;
      const fullBytes = encoder.encode(payload);

      // Feed 1 byte at a time to stress-test multi-byte UTF-8 and CRLF splits!
      const parsed: ReturnType<SseFrameParser['feed']> = [];
      for (let i = 0; i < fullBytes.length; i++) {
        parsed.push(...parser.feed(fullBytes.slice(i, i + 1)));
      }

      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('evt_utf8');
      expect(JSON.parse(parsed[0].data)).toEqual({ msg: '🚨 ₹500 आरव' });
    });

    test('validates event IDs and ignores empty/comment-only frames and malformed IDs', () => {
      expect(isValidSseEventId('evt_123')).toBe(true);
      expect(isValidSseEventId('')).toBe(false);
      expect(isValidSseEventId('   ')).toBe(false);
      expect(isValidSseEventId('a'.repeat(129))).toBe(false);
      expect(isValidSseEventId('bad\0id')).toBe(false);
      expect(isValidSseEventId('bad\nid')).toBe(false);

      const parser = new SseFrameParser();
      const frames = parser.feed(`: comment only\n\n\nid: ${'x'.repeat(200)}\ndata: {"ok":true}\n\n`);
      expect(frames).toHaveLength(1);
      expect(frames[0].id).toBeUndefined();
      expect(frames[0].data).toBe('{"ok":true}');
    });

    test('drops oversized lines/frames safely without crashing and resumes parsing subsequent valid frames', () => {
      const onOversized = jest.fn();
      const parser = new SseFrameParser({ maxFrameBytes: 300, maxLineBytes: 150, onOversizedFrame: onOversized });

      const oversized = `id: evt_huge\ndata: ${'A'.repeat(400)}\n\n`;
      const validNext = `id: evt_after\ndata: {"topic":"VISITOR_ARRIVAL","ok":true}\n\n`;

      const frames = parser.feed(oversized + validNext);
      expect(onOversized).toHaveBeenCalledTimes(1);
      expect(frames).toHaveLength(1);
      expect(frames[0].id).toBe('evt_after');
      expect(JSON.parse(frames[0].data)).toEqual({ topic: 'VISITOR_ARRIVAL', ok: true });
    });
  });

  // =========================================================================
  // 2. Authentication Lifecycle & Zero Query-String JWTs
  // =========================================================================
  describe('2. Authentication Lifecycle, Token Refresh, User Switching & Zero URL Tokens', () => {
    test('never connects without a token and connects cleanly with Authorization Bearer header (zero JWT in URL)', async () => {
      // Unauthenticated startup state
      expect(service.getConnectionStatus().state).toBe('OFFLINE');
      expect(mockFetch).not.toHaveBeenCalled();

      // Missing token rejected before fetch
      service.connect({ token: '', userId: 'usr-res-a', societyId: 'soc-alpha', role: 'resident' });
      service.initSseStream('soc-alpha', 'usr-res-a', 'resident');
      service.forceReconnect('soc-alpha');
      expect(mockFetch).not.toHaveBeenCalled();

      // Valid authenticated session
      saveAuthSession(residentA, 'jwt-resident-alpha-1', 'password');
      const stream = new MockSseStreamController();
      mockFetch.mockResolvedValueOnce(stream.toResponse(200));

      service.connect({
        token: 'jwt-resident-alpha-1',
        userId: residentA.id,
        societyId: residentA.societyId,
        role: residentA.role,
      });

      await flushMicrotasks();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:5000/api/realtime/stream?societyId=soc-alpha');
      expect(url).not.toContain('token=');
      expect(url).not.toContain('jwt-resident-alpha-1');
      expect(url).not.toContain('userId=');
      expect(url).not.toContain('role=');
      expect(init.headers['Authorization']).toBe('Bearer jwt-resident-alpha-1');
      expect(init.headers['Accept']).toBe('text/event-stream');
      expect(service.getConnectionStatus().state).toBe('CONNECTED');
    });

    test('concurrent connect() calls for identical session+token do not create duplicate connections', async () => {
      saveAuthSession(residentA, 'jwt-res-1', 'password');
      const stream = new MockSseStreamController();
      mockFetch.mockResolvedValueOnce(stream.toResponse(200));

      const session = { token: 'jwt-res-1', userId: residentA.id, societyId: residentA.societyId, role: residentA.role };
      service.connect(session);
      service.connect(session);
      service.connect(session);

      await flushMicrotasks();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('logout (disconnect) aborts the active stream immediately and never triggers a retry', async () => {
      jest.useFakeTimers();
      saveAuthSession(residentA, 'jwt-res-1', 'password');

      let capturedSignal: AbortSignal | undefined;
      const stream = new MockSseStreamController();
      mockFetch.mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined;
        return stream.toResponse(200);
      });

      service.connect({ token: 'jwt-res-1', userId: residentA.id, societyId: residentA.societyId, role: residentA.role });
      await flushMicrotasks();
      expect(capturedSignal?.aborted).toBe(false);

      clearAuthSession();
      service.disconnect();
      expect(capturedSignal?.aborted).toBe(true);
      expect(service.getConnectionStatus().state).toBe('OFFLINE');

      // Advance timers — no reconnect must occur
      jest.advanceTimersByTime(60_000);
      await flushMicrotasks();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('token refresh replaces previous connection cleanly, aborts old stream, preserves Last-Event-ID, and avoids replay duplicates', async () => {
      saveAuthSession(residentA, 'jwt-old', 'password');
      const stream1 = new MockSseStreamController();
      const stream2 = new MockSseStreamController();
      const signals: AbortSignal[] = [];

      mockFetch
        .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
          if (init?.signal) signals.push(init.signal);
          return stream1.toResponse(200);
        })
        .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
          if (init?.signal) signals.push(init.signal);
          return stream2.toResponse(200);
        });

      const received: any[] = [];
      service.subscribe('CHILD_GATE_PASS_GENERATED', (msg) => received.push(msg));

      service.connect({ token: 'jwt-old', userId: residentA.id, societyId: residentA.societyId, role: residentA.role });
      await flushMicrotasks();

      stream1.pushText(
        `id: evt_101\ndata: {"eventId":"evt_101","topic":"CHILD_GATE_PASS_GENERATED","passCode":"CGP-1111"}\n\n`
      );
      await flushMicrotasks();
      expect(received).toHaveLength(1);
      expect(service.getLastEventId()).toBe('evt_101');

      // Refresh token for the same user
      saveAuthSession(residentA, 'jwt-refreshed', 'password');
      service.connect({
        token: 'jwt-refreshed',
        userId: residentA.id,
        societyId: residentA.societyId,
        role: residentA.role,
      });
      await flushMicrotasks();

      expect(signals[0].aborted).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1][1].headers['Authorization']).toBe('Bearer jwt-refreshed');
      expect(mockFetch.mock.calls[1][1].headers['Last-Event-ID']).toBe('evt_101');

      // Replaying evt_101 on the refreshed stream is deduplicated; evt_102 is delivered
      stream2.pushText(
        `id: evt_101\ndata: {"eventId":"evt_101","topic":"CHILD_GATE_PASS_GENERATED","passCode":"CGP-1111","replayed":true}\n\n` +
          `id: evt_102\ndata: {"eventId":"evt_102","topic":"CHILD_GATE_PASS_GENERATED","passCode":"CGP-2222"}\n\n`
      );
      await flushMicrotasks();
      expect(received).toHaveLength(2);
      expect(received[1].id).toBe('evt_102');
    });

    test('user/society switch aborts previous session, resets Last-Event-ID, and rejects stale events from the old stream', async () => {
      saveAuthSession(residentA, 'jwt-alpha', 'password');
      const streamAlpha = new MockSseStreamController();
      const streamBeta = new MockSseStreamController();

      mockFetch
        .mockResolvedValueOnce(streamAlpha.toResponse(200))
        .mockResolvedValueOnce(streamBeta.toResponse(200));

      const received: any[] = [];
      service.subscribe('*', (msg) => received.push(msg));

      service.connect({ token: 'jwt-alpha', userId: residentA.id, societyId: residentA.societyId, role: residentA.role });
      await flushMicrotasks();
      streamAlpha.pushText(`id: evt_alpha_1\ndata: {"eventId":"evt_alpha_1","topic":"CHILD_PROFILE_UPDATED","societyId":"soc-alpha"}\n\n`);
      await flushMicrotasks();
      expect(received).toHaveLength(1);
      expect(service.getLastEventId()).toBe('evt_alpha_1');

      // Switch to Resident B in Society Beta
      saveAuthSession(residentB, 'jwt-beta', 'password');
      service.connect({ token: 'jwt-beta', userId: residentB.id, societyId: residentB.societyId, role: residentB.role });
      await flushMicrotasks();

      // Must NOT send Alpha's Last-Event-ID to Beta
      expect(mockFetch.mock.calls[1][1].headers['Last-Event-ID']).toBeUndefined();
      expect(mockFetch.mock.calls[1][1].headers['Authorization']).toBe('Bearer jwt-beta');

      // Even if old Alpha stream somehow pushes late bytes before GC, stale session epoch rejects them
      streamAlpha.pushText(`id: evt_alpha_stale\ndata: {"eventId":"evt_alpha_stale","topic":"CHILD_SAFETY_SOS_TRIGGERED","societyId":"soc-alpha"}\n\n`);
      await flushMicrotasks();
      expect(received).toHaveLength(1);

      // Beta events deliver normally
      streamBeta.pushText(`id: evt_beta_1\ndata: {"eventId":"evt_beta_1","topic":"CHILD_PROFILE_CREATED","societyId":"soc-beta"}\n\n`);
      await flushMicrotasks();
      expect(received).toHaveLength(2);
      expect(received[1].id).toBe('evt_beta_1');
    });
  });

  // =========================================================================
  // 3. Network Errors, HTTP Statuses, Backoff & Recovery
  // =========================================================================
  describe('3. HTTP Status Handling (401/403/429/5xx), Exponential Backoff & Last-Event-ID Recovery', () => {
    test('HTTP 401 clears auth session, emits aarizo:unauthorized once, disconnects, and does NOT reconnect', async () => {
      jest.useFakeTimers();
      saveAuthSession(residentA, 'jwt-expired', 'password');
      mockFetch.mockResolvedValueOnce(new MockSseStreamController().toResponse(401));

      service.connect({ token: 'jwt-expired', userId: residentA.id, societyId: residentA.societyId, role: residentA.role });
      await flushMicrotasks();

      expect(getAuthToken()).toBeNull();
      expect(dispatchedEvents.filter((e) => e.type === 'aarizo:unauthorized')).toHaveLength(1);
      expect(service.getConnectionStatus().state).toBe('OFFLINE');

      jest.advanceTimersByTime(60_000);
      await flushMicrotasks();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('HTTP 403 stops permanently without clearing valid auth session', async () => {
      jest.useFakeTimers();
      saveAuthSession(residentA, 'jwt-valid-403', 'password');
      mockFetch.mockResolvedValueOnce(new MockSseStreamController().toResponse(403));

      service.connect({ token: 'jwt-valid-403', userId: residentA.id, societyId: residentA.societyId, role: residentA.role });
      await flushMicrotasks();

      expect(getAuthToken()).toBe('jwt-valid-403');
      expect(dispatchedEvents).toHaveLength(0);
      expect(service.getConnectionStatus().state).toBe('OFFLINE');

      jest.advanceTimersByTime(60_000);
      await flushMicrotasks();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('HTTP 429 respects Retry-After header before reconnecting', async () => {
      jest.useFakeTimers();
      saveAuthSession(residentA, 'jwt-429', 'password');
      const recoveredStream = new MockSseStreamController();

      mockFetch
        .mockResolvedValueOnce(new MockSseStreamController().toResponse(429, { 'Retry-After': '5' }))
        .mockResolvedValueOnce(recoveredStream.toResponse(200));

      service.connect({ token: 'jwt-429', userId: residentA.id, societyId: residentA.societyId, role: residentA.role });
      await flushMicrotasks();

      expect(service.getConnectionStatus().state).toBe('RECONNECTING');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Should NOT reconnect at 4000ms (< 5000ms Retry-After)
      jest.advanceTimersByTime(4000);
      await flushMicrotasks();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Should reconnect at 5000ms
      jest.advanceTimersByTime(1000);
      await flushMicrotasks();
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(service.getConnectionStatus().state).toBe('CONNECTED');
    });

    test('HTTP 503 and network errors use bounded exponential backoff, reset after connected handshake, and cancel retries on logout', async () => {
      jest.useFakeTimers();
      saveAuthSession(residentA, 'jwt-5xx', 'password');
      const healthyStream = new MockSseStreamController();

      mockFetch
        .mockResolvedValueOnce(new MockSseStreamController().toResponse(503)) // fails -> delay 1000ms
        .mockRejectedValueOnce(new TypeError('Network dropped'))            // fails -> delay 2000ms
        .mockResolvedValueOnce(healthyStream.toResponse(200));              // succeeds!

      service.connect({ token: 'jwt-5xx', userId: residentA.id, societyId: residentA.societyId, role: residentA.role });
      await flushMicrotasks();
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(service.getConnectionStatus().state).toBe('RECONNECTING');

      // First backoff: 1000ms
      jest.advanceTimersByTime(1000);
      await flushMicrotasks();
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Second backoff: 2000ms (not yet at 1500ms)
      jest.advanceTimersByTime(1500);
      await flushMicrotasks();
      expect(mockFetch).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(500);
      await flushMicrotasks();
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(service.getConnectionStatus().state).toBe('CONNECTED');

      // Server connected handshake resets backoff counter to 0 (and does NOT overwrite lastEventId)
      healthyStream.pushText(
        `id: conn-uuid-ignored\ndata: {"topic":"connected","eventType":"connected","message":"Connected"}\n\n` +
          `data: {"type":"PING","timestamp":${Date.now() - 12}}\n\n` +
          `id: evt_domain_9\ndata: {"eventId":"evt_domain_9","topic":"VISITOR_ARRIVAL","visitorName":"Ramesh"}\n\n`
      );
      await flushMicrotasks();
      expect(service.getLastEventId()).toBe('evt_domain_9');

      // Premature EOF triggers reconnect with Last-Event-ID and reset 1000ms delay — then logout cancels retry!
      healthyStream.close();
      await flushMicrotasks();
      expect(service.getConnectionStatus().state).toBe('RECONNECTING');

      clearAuthSession();
      service.disconnect();
      jest.advanceTimersByTime(10_000);
      await flushMicrotasks();
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  // =========================================================================
  // 4. Consumer Compatibility, Alert Routing & Protected Broadcast Boundaries
  // =========================================================================
  describe('4. Consumer Compatibility, Deduplication, Alert Routing & Broadcast Security', () => {
    test('preserves topic/wildcard subscriptions, prevents duplicate callbacks, and cleans up on unsubscribe', async () => {
      saveAuthSession(guardA, 'jwt-guard', 'password');
      const stream = new MockSseStreamController();
      mockFetch.mockResolvedValueOnce(stream.toResponse(200));

      const specificCb = jest.fn();
      const wildcardCb = jest.fn();

      // Registering the exact same callback twice must NOT fire twice
      const unsub1 = service.subscribe('CHILD_SAFETY_SOS_TRIGGERED', specificCb);
      service.subscribe('CHILD_SAFETY_SOS_TRIGGERED', specificCb);
      const unsubWild = service.subscribe('*', wildcardCb);

      expect(service.getConnectionStatus().activeListenersCount).toBe(2);

      service.connect({ token: 'jwt-guard', userId: guardA.id, societyId: guardA.societyId, role: guardA.role });
      await flushMicrotasks();

      stream.pushText(
        `id: evt_sos_1\ndata: {"eventId":"evt_sos_1","topic":"CHILD_SAFETY_SOS_TRIGGERED","location":"Main Park"}\n\n`
      );
      await flushMicrotasks();

      expect(specificCb).toHaveBeenCalledTimes(1);
      expect(wildcardCb).toHaveBeenCalledTimes(1);

      unsub1();
      unsubWild();
      expect(service.getConnectionStatus().activeListenersCount).toBe(0);

      stream.pushText(
        `id: evt_sos_2\ndata: {"eventId":"evt_sos_2","topic":"CHILD_SAFETY_SOS_TRIGGERED","location":"Gate 2"}\n\n`
      );
      await flushMicrotasks();
      expect(specificCb).toHaveBeenCalledTimes(1);
      expect(wildcardCb).toHaveBeenCalledTimes(1);
    });

    test('routes CHILD_* alerts to role-appropriate Child Safety path (never /resident/deliveries) and preserves unrelated alerts', async () => {
      saveAuthSession(guardA, 'jwt-guard', 'password');
      const stream = new MockSseStreamController();
      mockFetch.mockResolvedValueOnce(stream.toResponse(200));

      const alerts: any[] = [];
      const unsubAlert = service.subscribeToAlerts((a) => alerts.push(a));

      service.connect({ token: 'jwt-guard', userId: guardA.id, societyId: guardA.societyId, role: guardA.role });
      await flushMicrotasks();

      stream.pushText(
        `id: evt_c1\ndata: {"eventId":"evt_c1","topic":"CHILD_SAFETY_SOS_TRIGGERED","location":"Pool"}\n\n` +
          `id: evt_c2\ndata: {"eventId":"evt_c2","topic":"CHILD_GATE_PASS_GENERATED","passCode":"CGP-9999"}\n\n` +
          `id: evt_v1\ndata: {"eventId":"evt_v1","topic":"VISITOR_ARRIVAL","visitorName":"Amit","flatCode":"A-402"}\n\n`
      );
      await flushMicrotasks();

      expect(alerts).toHaveLength(3);
      expect(alerts[0]).toMatchObject({ urgency: 'emergency', actionPath: '/security/child-safety' });
      expect(alerts[1]).toMatchObject({ urgency: 'info', actionPath: '/security/child-safety' });
      expect(alerts[2]).toMatchObject({ urgency: 'alert', actionPath: '/resident/visitors' });

      unsubAlert();
    });

    test('publish() never posts protected CHILD_*/EMERGENCY_* topics to /api/realtime/broadcast while preserving unrelated local/allowed workflows', async () => {
      saveAuthSession(residentA, 'jwt-res-pub', 'password');
      const received: any[] = [];
      service.subscribe('CHILD_SAFETY_SOS_TRIGGERED', (m) => received.push(m));
      service.subscribe('ANNOUNCEMENT_CREATED', (m) => received.push(m));

      // Protected topic: local dispatch works for legacy callers, ZERO POST to /api/realtime/broadcast
      service.publish('CHILD_SAFETY_SOS_TRIGGERED', { childId: 'c1' }, 'soc-alpha');
      await flushMicrotasks();
      expect(received).toHaveLength(1);
      expect(mockFetch).not.toHaveBeenCalled();

      // Allowed non-protected topic: posts via authenticatedFetch to /api/realtime/broadcast
      mockFetch.mockResolvedValueOnce(new MockSseStreamController().toResponse(200));
      service.publish('ANNOUNCEMENT_CREATED', { title: 'Water maintenance' }, 'soc-alpha');
      await flushMicrotasks();
      expect(received).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:5000/api/realtime/broadcast');
    });

    test('delayed stale-token 401 on SSE stream never clears a newly authenticated session token', async () => {
      saveAuthSession(residentA, 'jwt-old-sse', 'password');
      let resolveOldFetch!: (res: Response) => void;
      const oldFetchPromise = new Promise<Response>((resolve) => {
        resolveOldFetch = resolve;
      });
      mockFetch.mockReturnValueOnce(oldFetchPromise);

      service.connect({
        token: 'jwt-old-sse',
        userId: residentA.id,
        societyId: residentA.societyId,
        role: residentA.role,
      });

      // Fresh login saves a new token before old fetch returns 401
      saveAuthSession(residentA, 'jwt-fresh-sse', 'password');

      resolveOldFetch(new MockSseStreamController().toResponse(401));
      await flushMicrotasks();

      // New token must NOT have been wiped and no unauthorized event fired
      expect(getAuthToken()).toBe('jwt-fresh-sse');
      expect(dispatchedEvents.filter((e) => e.type === 'aarizo:unauthorized')).toHaveLength(0);
    });

    test('handleNetworkResume triggers immediate single reconnect when RECONNECTING and cancels long backoff', async () => {
      jest.useFakeTimers();
      saveAuthSession(residentA, 'jwt-resume', 'password');
      const recoveredStream = new MockSseStreamController();

      mockFetch
        .mockRejectedValueOnce(new TypeError('Offline'))
        .mockResolvedValueOnce(recoveredStream.toResponse(200));

      service.connect({ token: 'jwt-resume', userId: residentA.id, societyId: residentA.societyId, role: residentA.role });
      await flushMicrotasks();
      expect(service.getConnectionStatus().state).toBe('RECONNECTING');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Network comes back online before backoff timer fires
      service.handleNetworkResume();
      await flushMicrotasks();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(service.getConnectionStatus().state).toBe('CONNECTED');
    });
  });

  // =========================================================================
  // 5. F-P2-02: WHATWG SSE Protocol Compliance (BOM, CR-only, EOF Discard, id:)
  // =========================================================================
  describe('5. F-P2-02: WHATWG SSE Protocol Correctness (BOM, CR-only, EOF, id: Reset/NUL)', () => {
    test('strips ONE leading UTF-8 BOM at stream start only, preserves mid-stream BOM, and supports CR-only line endings', () => {
      const parser = new SseFrameParser();
      const encoder = new TextEncoder();

      // Leading UTF-8 BOM bytes [0xEF, 0xBB, 0xBF] followed by CR-only (\r) line endings
      const bomBytes = new Uint8Array([0xef, 0xbb, 0xbf]);
      const frame1Bytes = encoder.encode('id: evt_bom_1\rdata: {"msg":"first"}\r\r');
      const combined1 = new Uint8Array(bomBytes.length + frame1Bytes.length);
      combined1.set(bomBytes, 0);
      combined1.set(frame1Bytes, bomBytes.length);

      const parsed1 = parser.feed(combined1);
      expect(parsed1).toHaveLength(1);
      expect(parsed1[0]).toEqual({
        id: 'evt_bom_1',
        data: '{"msg":"first"}',
      });

      // Subsequent frame starting with BOM in chunk or inside data MUST NOT be stripped!
      const parsed2 = parser.feed('\uFEFFdata: ignored_field_with_bom\n\ndata: \uFEFFkeep_me\r\r');
      expect(parsed2).toHaveLength(1);
      expect(parsed2[0].data).toBe('\uFEFFkeep_me');
    });

    test('discards incomplete unterminated frames at premature EOF while flushing valid complete frames', async () => {
      // Pure parser unit verification
      const parser = new SseFrameParser();
      expect(parser.feed('id: evt_partial\ndata: {"topic":"CHILD_EXIT_TRIGGERED"}')).toEqual([]);
      expect(parser.finishStream()).toEqual([]);

      // End-to-end RealtimeService stream verification: truncated frame at EOF is NEVER dispatched
      saveAuthSession(residentA, 'jwt-eof', 'password');
      const stream = new MockSseStreamController();
      mockFetch.mockResolvedValueOnce(stream.toResponse(200));

      const received: any[] = [];
      service.subscribe('*', (msg) => received.push(msg));

      service.connect({ token: 'jwt-eof', userId: residentA.id, societyId: residentA.societyId, role: residentA.role });
      await flushMicrotasks();

      // Complete frame followed immediately by unterminated partial frame before premature EOF
      stream.pushText(
        `id: evt_complete_1\ndata: {"eventId":"evt_complete_1","topic":"VISITOR_ARRIVAL","visitorName":"Kiran"}\n\n` +
          `id: evt_truncated_2\ndata: {"eventId":"evt_truncated_2","topic":"CHILD_EXIT_TRIGGERED"}`
      );
      stream.close();
      await flushMicrotasks();

      expect(received).toHaveLength(1);
      expect(received[0].id).toBe('evt_complete_1');
      expect(service.getLastEventId()).toBe('evt_complete_1');
    });

    test('handles empty id: cursor reset and ignores NUL-containing event IDs per WHATWG SSE', async () => {
      jest.useFakeTimers();
      saveAuthSession(residentA, 'jwt-id-reset', 'password');
      const stream1 = new MockSseStreamController();
      const stream2 = new MockSseStreamController();

      mockFetch
        .mockResolvedValueOnce(stream1.toResponse(200))
        .mockResolvedValueOnce(stream2.toResponse(200));

      const received: any[] = [];
      service.subscribe('VISITOR_ARRIVAL', (m) => received.push(m));

      service.connect({ token: 'jwt-id-reset', userId: residentA.id, societyId: residentA.societyId, role: residentA.role });
      await flushMicrotasks();

      // 1. Valid ID establishes cursor
      stream1.pushText(`id: evt_cursor_1\ndata: {"topic":"VISITOR_ARRIVAL","visitorName":"One"}\n\n`);
      await flushMicrotasks();
      expect(service.getLastEventId()).toBe('evt_cursor_1');

      // 2. NUL-containing ID MUST be ignored (cursor remains evt_cursor_1)
      stream1.pushText(`id: bad\0null_id\ndata: {"topic":"VISITOR_ARRIVAL","visitorName":"Two"}\n\n`);
      await flushMicrotasks();
      expect(service.getLastEventId()).toBe('evt_cursor_1');
      expect(received).toHaveLength(2);

      // 3. Empty `id:` explicitly resets cursor to null (even if payload had no id)
      stream1.pushText(`id:\ndata: {"topic":"VISITOR_ARRIVAL","visitorName":"Three"}\n\n`);
      await flushMicrotasks();
      expect(service.getLastEventId()).toBeNull();
      expect(received).toHaveLength(3);

      // 4. Subsequent reconnect MUST NOT send stale Last-Event-ID header
      stream1.close();
      await flushMicrotasks();
      jest.advanceTimersByTime(1000);
      await flushMicrotasks();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1][1].headers['Last-Event-ID']).toBeUndefined();
    });
  });

  // =========================================================================
  // 6. F-P2-01B: Complete Removal of BroadcastChannel Domain-Event Relay
  // =========================================================================
  describe('6. F-P2-01B: Zero BroadcastChannel Domain-Event Relay (Fetch SSE Is Exclusive Source)', () => {
    const createChannelService = () =>
      new RealtimeService({
        fetchFn: mockFetch,
        getBaseUrl: () => 'http://localhost:5000',
        enableBroadcastChannel: true,
        enableOnlineListener: false,
        baseReconnectDelayMs: 1000,
        maxReconnectDelayMs: 8000,
        maxJitterMs: 0,
      });

    test('never opens BroadcastChannel while logged out, authenticated, switching users, or after disconnect/destroy', async () => {
      const bcService = createChannelService();
      const received: any[] = [];
      const alerts: any[] = [];
      bcService.subscribe('*', (m) => received.push(m));
      bcService.subscribeToAlerts((a) => alerts.push(a));

      // 1. Logged out: zero BroadcastChannel instances
      expect(MockBroadcastChannel.instances).toHaveLength(0);

      // External tab posts while logged out -> zero delivery
      const externalTab = new MockBroadcastChannel('communityos_realtime_hub');
      externalTab.postMessage({
        id: 'bc-unauth-1',
        topic: 'ANNOUNCEMENT_CREATED',
        societyId: 'soc-alpha',
        userId: residentA.id,
        role: 'resident',
        payload: { title: 'Should never enter via BroadcastChannel' },
      });
      expect(received).toHaveLength(0);
      expect(alerts).toHaveLength(0);

      // 2. Authenticated connect: RealtimeService STILL opens zero BroadcastChannel instances
      saveAuthSession(residentA, 'jwt-bc-1', 'password');
      mockFetch.mockResolvedValueOnce(new MockSseStreamController().toResponse(200));
      bcService.connect({ token: 'jwt-bc-1', userId: residentA.id, societyId: residentA.societyId, role: residentA.role });
      await flushMicrotasks();
      expect(MockBroadcastChannel.instances).toHaveLength(1); // ONLY externalTab

      // 3. User switch & logout & destroy: zero BroadcastChannel instances opened at any point
      saveAuthSession(residentB, 'jwt-bc-2', 'password');
      mockFetch.mockResolvedValueOnce(new MockSseStreamController().toResponse(200));
      bcService.connect({ token: 'jwt-bc-2', userId: residentB.id, societyId: residentB.societyId, role: residentB.role });
      await flushMicrotasks();
      expect(MockBroadcastChannel.instances).toHaveLength(1);

      clearAuthSession();
      bcService.disconnect();
      externalTab.postMessage({
        id: 'bc-after-logout',
        topic: 'ANNOUNCEMENT_CREATED',
        societyId: 'soc-beta',
        payload: { title: 'Post-logout attempt' },
      });
      expect(received).toHaveLength(0);
      expect(alerts).toHaveLength(0);

      bcService.destroy();
      expect(MockBroadcastChannel.instances).toHaveLength(1);
    });

    test('blocks ALL inbound BroadcastChannel domain events (forged societyId/userId/role, sensitive, public, unknown, malformed) and never mutates Last-Event-ID', async () => {
      const bcService = createChannelService();
      saveAuthSession(residentA, 'jwt-bc-forge', 'password');
      const stream = new MockSseStreamController();
      mockFetch.mockResolvedValueOnce(stream.toResponse(200));

      const received: any[] = [];
      const alerts: any[] = [];
      bcService.subscribe('*', (m) => received.push(m));
      bcService.subscribeToAlerts((a) => alerts.push(a));

      bcService.connect({ token: 'jwt-bc-forge', userId: residentA.id, societyId: residentA.societyId, role: residentA.role });
      await flushMicrotasks();

      // Legitimate SSE event establishes server replay cursor
      stream.pushText(`id: evt_server_42\ndata: {"eventId":"evt_server_42","topic":"VISITOR_ARRIVAL","visitorName":"Legit"}\n\n`);
      await flushMicrotasks();
      expect(bcService.getLastEventId()).toBe('evt_server_42');
      expect(received).toHaveLength(1);
      expect(alerts).toHaveLength(1);
      (triggerHaptic as jest.Mock).mockClear();

      const attackerTab = new MockBroadcastChannel('communityos_realtime_hub');

      const allBlockedCrossTabTopics = [
        // Emergency & forged emergency substrings
        'FIRE_EMERGENCY',
        'EMERGENCY',
        'EMERGENCY_ALERT',
        'EMERGENCY_ALERTS',
        'EMERGENCY_INCIDENT_CREATED',
        'CHILD_SAFETY_SOS_TRIGGERED',
        'SOS_TRIGGERED',
        'SECURITY_ALERT_CREATED',
        // Child Safety & Gate Pass
        'CHILD_GATE_PASS_GENERATED',
        'CHILD_EXIT_TRIGGERED',
        'GATE_PASS_VERIFIED',
        // Visitor, Delivery, Worker, QR, Parking Gate
        'VISITOR_ARRIVAL',
        'VISITOR_APPROVAL',
        'VISITOR_ENTRY',
        'VISITOR_EXIT',
        'DELIVERY_STATUS',
        'WORKER_ENTRY_EXIT',
        'QR_SCAN',
        'PARKING_GATE_TRIGGERED',
        // Financial & Resident Private & Notifications
        'PAYMENT_COMPLETED',
        'PAYMENT_STATUS',
        'OFFLINE_PAYMENT_LOGGED',
        'GUEST_STAY_BOOKED',
        'NOTIFICATIONS',
        'RESIDENT_PRIVATE_MESSAGE',
        // Even public operational & unknown/malformed topics MUST NOT enter via BroadcastChannel
        'ANNOUNCEMENT_CREATED',
        'UNKNOWN_FUTURE_TOPIC',
        '',
        '   ',
      ];

      for (const topic of allBlockedCrossTabTopics) {
        attackerTab.postMessage({
          id: `evt_forged_${topic || 'empty'}`,
          topic,
          societyId: 'soc-alpha',
          userId: residentA.id,
          role: 'resident',
          payload: { spoofed: true, visitorName: 'Eve', flatCode: 'A-402', amount: 99999 },
        });
      }

      // Malformed non-object / null payloads
      attackerTab.postMessage(null);
      attackerTab.postMessage('FIRE_EMERGENCY');
      attackerTab.postMessage({ topic: 12345, societyId: 'soc-alpha' });

      expect(received).toHaveLength(1);
      expect(alerts).toHaveLength(1);
      expect(triggerHaptic).not.toHaveBeenCalled();
      expect(bcService.getLastEventId()).toBe('evt_server_42');

      bcService.destroy();
    });

    test('blocks ALL outbound BroadcastChannel forwarding from publish() across sensitive, financial, visitor, public, and unknown topics', async () => {
      const tabA = createChannelService();
      const tabB = createChannelService();
      const observerChannel = new MockBroadcastChannel('communityos_realtime_hub');
      const observedBroadcasts: any[] = [];
      observerChannel.onmessage = (ev) => observedBroadcasts.push(ev.data);

      saveAuthSession(residentA, 'jwt-tabs-alpha', 'password');
      mockFetch
        .mockResolvedValueOnce(new MockSseStreamController().toResponse(200))
        .mockResolvedValueOnce(new MockSseStreamController().toResponse(200));

      const tabBReceived: any[] = [];
      const tabBAlerts: any[] = [];
      tabB.subscribe('*', (m) => tabBReceived.push(m));
      tabB.subscribeToAlerts((a) => tabBAlerts.push(a));

      tabA.connect({ token: 'jwt-tabs-alpha', userId: residentA.id, societyId: residentA.societyId, role: residentA.role });
      tabB.connect({ token: 'jwt-tabs-alpha', userId: residentA.id, societyId: residentA.societyId, role: residentA.role });
      await flushMicrotasks();
      mockFetch.mockClear();

      // Sensitive/protected/unknown topics: ZERO BroadcastChannel relay AND ZERO /api/realtime/broadcast POST
      const blockedNetworkAndChannelTopics = [
        'CHILD_EXIT_TRIGGERED',
        'CHILD_SAFETY_SOS_TRIGGERED',
        'EMERGENCY_ALERT',
        'EMERGENCY_INCIDENT_CREATED',
        'FIRE_EMERGENCY',
        'EMERGENCY',
        'SOS_TRIGGERED',
        'SECURITY_ALERT_CREATED',
        'VISITOR_ARRIVAL',
        'VISITOR_APPROVAL',
        'VISITOR_ENTRY',
        'VISITOR_EXIT',
        'DELIVERY_STATUS',
        'WORKER_ENTRY_EXIT',
        'QR_SCAN',
        'PARKING_GATE_TRIGGERED',
        'PAYMENT_COMPLETED',
        'PAYMENT_STATUS',
        'OFFLINE_PAYMENT_LOGGED',
        'GUEST_STAY_BOOKED',
        'NOTIFICATIONS',
        'RESIDENT_PRIVATE_LEDGER',
        'UNKNOWN_FUTURE_EVENT',
      ];
      for (const topic of blockedNetworkAndChannelTopics) {
        tabA.publish(topic as any, { secret: true, flatCode: 'A-402', amount: 5000 }, 'soc-alpha');
      }
      await flushMicrotasks();
      expect(mockFetch).not.toHaveBeenCalled();

      // Even allowlisted public operational topic (ANNOUNCEMENT_CREATED) NEVER leaves via BroadcastChannel
      mockFetch.mockResolvedValueOnce(new MockSseStreamController().toResponse(200));
      tabA.publish('ANNOUNCEMENT_CREATED', { title: 'Water maintenance' }, 'soc-alpha');
      await flushMicrotasks();

      expect(observedBroadcasts).toHaveLength(0);
      expect(tabBReceived).toHaveLength(0);
      expect(tabBAlerts).toHaveLength(0);
      // Only the allowlisted public operational topic posted to /api/realtime/broadcast
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:5000/api/realtime/broadcast');

      tabA.destroy();
      tabB.destroy();
    });

    test('platform-admin session CANNOT relay or accept domain events through BroadcastChannel (no platform-admin exception)', async () => {
      const adminUser: UserProfile = {
        id: 'usr-platform-admin',
        role: 'admin',
        societyId: 'soc-platform',
        name: 'Platform Admin',
        phone: '+919999999999',
        email: 'admin@aarizo.test',
        status: 'ACTIVE',
      };
      const adminService = createChannelService();
      saveAuthSession(adminUser, 'jwt-platform-admin', 'password');
      const sseStream = new MockSseStreamController();
      mockFetch.mockResolvedValueOnce(sseStream.toResponse(200));

      const received: any[] = [];
      const alerts: any[] = [];
      adminService.subscribe('*', (m) => received.push(m));
      adminService.subscribeToAlerts((a) => alerts.push(a));

      adminService.connect({
        token: 'jwt-platform-admin',
        userId: adminUser.id,
        societyId: adminUser.societyId,
        role: adminUser.role,
      });
      await flushMicrotasks();

      const peerTab = new MockBroadcastChannel('communityos_realtime_hub');
      peerTab.postMessage({ id: 'bc-admin-1', topic: 'ANNOUNCEMENT_CREATED', societyId: 'soc-alpha', payload: { title: 'Injected' } });
      peerTab.postMessage({ id: 'bc-admin-2', topic: 'VISITOR_ARRIVAL', societyId: 'soc-alpha', payload: { visitorName: 'Injected' } });
      peerTab.postMessage({ id: 'bc-admin-3', topic: 'FIRE_EMERGENCY', societyId: 'soc-beta', payload: { message: 'Spoofed' } });

      expect(received).toHaveLength(0);
      expect(alerts).toHaveLength(0);

      // Legitimate authenticated SSE still reaches platform admin normally
      sseStream.pushText(
        `id: evt_admin_sse_1\ndata: {"eventId":"evt_admin_sse_1","topic":"ANNOUNCEMENT_CREATED","societyId":"soc-alpha","payload":{"title":"Server Auth Event"}}\n\n`
      );
      await flushMicrotasks();
      expect(received).toHaveLength(1);
      expect(received[0].id).toBe('evt_admin_sse_1');

      adminService.destroy();
    });
  });

  // =========================================================================
  // 7. F-P2-03: Explicit HTTP Status Handling & Strict 2xx Streaming Validation
  // =========================================================================
  describe('7. F-P2-03: Permanent 4xx, 204/Content-Type Validation, HTTP-Date Retry-After & 408', () => {
    test('HTTP 400 and HTTP 404 stop permanently in OFFLINE state with zero retries and preserve auth session', async () => {
      jest.useFakeTimers();

      for (const statusCode of [400, 404]) {
        mockFetch.mockReset();
        saveAuthSession(residentA, `jwt-status-${statusCode}`, 'password');
        const ctrl = new MockSseStreamController();
        mockFetch.mockResolvedValueOnce(ctrl.toResponse(statusCode, { 'Content-Type': 'application/json' }));

        service.connect({
          token: `jwt-status-${statusCode}`,
          userId: residentA.id,
          societyId: residentA.societyId,
          role: residentA.role,
        });
        await flushMicrotasks();

        expect(service.getConnectionStatus().state).toBe('OFFLINE');
        expect(service.getConnectionStatus().connected).toBe(false);
        expect(getAuthToken()).toBe(`jwt-status-${statusCode}`);
        expect(ctrl.cancelled).toBe(true);

        jest.advanceTimersByTime(60_000);
        await flushMicrotasks();
        expect(mockFetch).toHaveBeenCalledTimes(1);

        service.disconnect();
      }
    });

    test('HTTP 204 No Content is rejected as an active stream, never enters CONNECTED, cancels body, and schedules reconnect', async () => {
      jest.useFakeTimers();
      saveAuthSession(residentA, 'jwt-204', 'password');
      const observedStates: string[] = [];
      const unsub = service.subscribeToStatus((st) => observedStates.push(st.state));

      const ctrl204 = new MockSseStreamController();
      const ctrl200 = new MockSseStreamController();
      mockFetch
        .mockResolvedValueOnce(ctrl204.toResponse(204, { 'Content-Type': 'text/event-stream' }))
        .mockResolvedValueOnce(ctrl200.toResponse(200));

      service.connect({ token: 'jwt-204', userId: residentA.id, societyId: residentA.societyId, role: residentA.role });
      await flushMicrotasks();

      expect(observedStates).not.toContain('CONNECTED');
      expect(service.getConnectionStatus().state).toBe('RECONNECTING');
      expect(ctrl204.cancelled).toBe(true);

      // Reconnect recovers on valid HTTP 200 text/event-stream
      jest.advanceTimersByTime(1000);
      await flushMicrotasks();
      expect(service.getConnectionStatus().state).toBe('CONNECTED');
      unsub();
    });

    test('rejects HTTP 200 with missing, text/html, or application/json Content-Type (never CONNECTED) and accepts text/event-stream; charset=utf-8', async () => {
      jest.useFakeTimers();
      saveAuthSession(residentA, 'jwt-ct', 'password');

      const observedStates: string[] = [];
      const unsub = service.subscribeToStatus((st) => observedStates.push(st.state));

      const htmlCtrl = new MockSseStreamController();
      const jsonCtrl = new MockSseStreamController();
      const missingCtCtrl = new MockSseStreamController();
      const validSseCtrl = new MockSseStreamController();

      mockFetch
        .mockResolvedValueOnce(htmlCtrl.toResponse(200, { 'Content-Type': 'text/html; charset=utf-8' }))
        .mockResolvedValueOnce(jsonCtrl.toResponse(200, { 'Content-Type': 'application/json' }))
        .mockResolvedValueOnce(missingCtCtrl.toResponse(200, {}))
        .mockResolvedValueOnce(validSseCtrl.toResponse(200, { 'Content-Type': 'text/event-stream; charset=utf-8' }));

      service.connect({ token: 'jwt-ct', userId: residentA.id, societyId: residentA.societyId, role: residentA.role });
      await flushMicrotasks();
      expect(observedStates).not.toContain('CONNECTED');
      expect(htmlCtrl.cancelled).toBe(true);

      // Attempt 2: application/json -> rejected
      jest.advanceTimersByTime(1000);
      await flushMicrotasks();
      expect(observedStates).not.toContain('CONNECTED');
      expect(jsonCtrl.cancelled).toBe(true);

      // Attempt 3: missing Content-Type -> rejected
      jest.advanceTimersByTime(2000);
      await flushMicrotasks();
      expect(observedStates).not.toContain('CONNECTED');
      expect(missingCtCtrl.cancelled).toBe(true);

      // Attempt 4: text/event-stream; charset=utf-8 -> accepted!
      jest.advanceTimersByTime(4000);
      await flushMicrotasks();
      expect(service.getConnectionStatus().state).toBe('CONNECTED');
      unsub();
    });

    test('parses HTTP-date Retry-After, ignores past/negative/malformed Retry-After safely, and retries transient HTTP 408', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-11-18T10:00:00.000Z'));
      saveAuthSession(residentA, 'jwt-ra-date', 'password');

      const okStream = new MockSseStreamController();
      mockFetch
        // 1. Future HTTP-date (+7 seconds)
        .mockResolvedValueOnce(
          new MockSseStreamController().toResponse(429, { 'Retry-After': 'Wed, 18 Nov 2026 10:00:07 GMT' })
        )
        // 2. Past HTTP-date -> falls back to bounded backoff (2000ms at sseErrorCount=1), NOT 0ms
        .mockResolvedValueOnce(
          new MockSseStreamController().toResponse(429, { 'Retry-After': 'Wed, 18 Nov 2026 09:59:00 GMT' })
        )
        // 3. Malformed/negative Retry-After -> falls back to bounded backoff (4000ms at sseErrorCount=2)
        .mockResolvedValueOnce(new MockSseStreamController().toResponse(429, { 'Retry-After': '-50' }))
        // 4. Transient HTTP 408 Request Timeout -> falls back to bounded backoff (8000ms cap)
        .mockResolvedValueOnce(new MockSseStreamController().toResponse(408))
        // 5. Recovery!
        .mockResolvedValueOnce(okStream.toResponse(200));

      service.connect({ token: 'jwt-ra-date', userId: residentA.id, societyId: residentA.societyId, role: residentA.role });
      await flushMicrotasks();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Not before 7000ms
      jest.advanceTimersByTime(6500);
      await flushMicrotasks();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Fires at 7000ms -> gets past HTTP-date
      jest.advanceTimersByTime(500);
      await flushMicrotasks();
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Past HTTP-date MUST NOT tight-loop at 0ms; waits bounded backoff (2000ms)
      jest.advanceTimersByTime(1500);
      await flushMicrotasks();
      expect(mockFetch).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(500);
      await flushMicrotasks();
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Negative Retry-After '-50' falls back to bounded backoff (4000ms)
      jest.advanceTimersByTime(3900);
      await flushMicrotasks();
      expect(mockFetch).toHaveBeenCalledTimes(3);

      jest.advanceTimersByTime(100);
      await flushMicrotasks();
      expect(mockFetch).toHaveBeenCalledTimes(4);

      // HTTP 408 retries after capped 8000ms backoff and connects
      jest.advanceTimersByTime(8000);
      await flushMicrotasks();
      expect(mockFetch).toHaveBeenCalledTimes(5);
      expect(service.getConnectionStatus().state).toBe('CONNECTED');
    });
  });

  // =========================================================================
  // 8. F-P2-04 & F-P2-06: Cursor Ordering, Same-Token Switches, Strict Mode & realTimeSync
  // =========================================================================
  describe('8. F-P2-04 & F-P2-06: Cursor Ordering, Subscriber Isolation, Session Switches & Compatibility', () => {
    test('does not advance lastEventId when a subscriber throws, isolates other subscribers, and allows replay recovery', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      saveAuthSession(residentA, 'jwt-cursor-iso', 'password');
      const stream = new MockSseStreamController();
      mockFetch.mockResolvedValueOnce(stream.toResponse(200));

      const healthyEvents: any[] = [];
      service.connect({ token: 'jwt-cursor-iso', userId: residentA.id, societyId: residentA.societyId, role: residentA.role });
      await flushMicrotasks();

      // Deliver healthy event 1 -> cursor advances to evt_ok_1
      stream.pushText(`id: evt_ok_1\ndata: {"eventId":"evt_ok_1","topic":"CHILD_EXIT_TRIGGERED","child":"Aarav"}\n\n`);
      await flushMicrotasks();
      expect(service.getLastEventId()).toBe('evt_ok_1');

      // Attach throwing subscriber + healthy subscriber
      const unsubThrowing = service.subscribe('CHILD_EXIT_TRIGGERED', () => {
        throw new Error('Simulated UI subscriber crash');
      });
      service.subscribe('CHILD_EXIT_TRIGGERED', (msg) => healthyEvents.push(msg));

      // Deliver event 2 -> throwing subscriber throws, healthy subscriber STILL runs, cursor stays evt_ok_1
      stream.pushText(`id: evt_fail_2\ndata: {"eventId":"evt_fail_2","topic":"CHILD_EXIT_TRIGGERED","child":"Aarav"}\n\n`);
      await flushMicrotasks();

      expect(healthyEvents).toHaveLength(1);
      expect(healthyEvents[0].id).toBe('evt_fail_2');
      expect(service.getLastEventId()).toBe('evt_ok_1');

      // Unsubscribe failing handler and replay evt_fail_2 -> NOT suppressed by seenMessageIds, cursor now advances!
      unsubThrowing();
      stream.pushText(`id: evt_fail_2\ndata: {"eventId":"evt_fail_2","topic":"CHILD_EXIT_TRIGGERED","child":"Aarav"}\n\n`);
      await flushMicrotasks();

      expect(healthyEvents).toHaveLength(2);
      expect(service.getLastEventId()).toBe('evt_fail_2');
      consoleErrorSpy.mockRestore();
    });

    test('same-token society switch resets Last-Event-ID and rejects stale events from old society stream', async () => {
      saveAuthSession(residentA, 'jwt-shared-tok', 'password');
      const streamAlpha = new MockSseStreamController();
      const streamBeta = new MockSseStreamController();
      const signals: AbortSignal[] = [];

      mockFetch
        .mockImplementationOnce(async (_u: string, init?: RequestInit) => {
          if (init?.signal) signals.push(init.signal);
          return streamAlpha.toResponse(200);
        })
        .mockImplementationOnce(async (_u: string, init?: RequestInit) => {
          if (init?.signal) signals.push(init.signal);
          return streamBeta.toResponse(200);
        });

      const received: any[] = [];
      service.subscribe('*', (m) => received.push(m));

      service.connect({ token: 'jwt-shared-tok', userId: 'usr-multi', societyId: 'soc-alpha', role: 'admin' });
      await flushMicrotasks();
      streamAlpha.pushText(`id: evt_soc_a1\ndata: {"eventId":"evt_soc_a1","topic":"VISITOR_ARRIVAL","societyId":"soc-alpha"}\n\n`);
      await flushMicrotasks();
      expect(service.getLastEventId()).toBe('evt_soc_a1');

      // Same token + same userId, DIFFERENT societyId
      service.connect({ token: 'jwt-shared-tok', userId: 'usr-multi', societyId: 'soc-beta', role: 'admin' });
      await flushMicrotasks();

      expect(signals[0].aborted).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1][0]).toBe('http://localhost:5000/api/realtime/stream?societyId=soc-beta');
      expect(mockFetch.mock.calls[1][1].headers['Last-Event-ID']).toBeUndefined();
      expect(service.getLastEventId()).toBeNull();

      // Late event from old Alpha stream MUST be rejected
      streamAlpha.pushText(`id: evt_soc_a_late\ndata: {"eventId":"evt_soc_a_late","topic":"VISITOR_ARRIVAL","societyId":"soc-alpha"}\n\n`);
      await flushMicrotasks();
      expect(received).toHaveLength(1);
    });

    test('same-token role switch resets Last-Event-ID and rejects stale events from old role stream', async () => {
      saveAuthSession(residentA, 'jwt-role-tok', 'password');
      const streamRes = new MockSseStreamController();
      const streamSec = new MockSseStreamController();
      const signals: AbortSignal[] = [];

      mockFetch
        .mockImplementationOnce(async (_u: string, init?: RequestInit) => {
          if (init?.signal) signals.push(init.signal);
          return streamRes.toResponse(200);
        })
        .mockImplementationOnce(async (_u: string, init?: RequestInit) => {
          if (init?.signal) signals.push(init.signal);
          return streamSec.toResponse(200);
        });

      const received: any[] = [];
      service.subscribe('*', (m) => received.push(m));

      service.connect({ token: 'jwt-role-tok', userId: 'usr-1', societyId: 'soc-alpha', role: 'resident' });
      await flushMicrotasks();
      streamRes.pushText(`id: evt_role_1\ndata: {"eventId":"evt_role_1","topic":"CHILD_GATE_PASS_GENERATED"}\n\n`);
      await flushMicrotasks();
      expect(service.getLastEventId()).toBe('evt_role_1');

      // Same token + same userId + same societyId, DIFFERENT role
      service.connect({ token: 'jwt-role-tok', userId: 'usr-1', societyId: 'soc-alpha', role: 'secretary' });
      await flushMicrotasks();

      expect(signals[0].aborted).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1][1].headers['Last-Event-ID']).toBeUndefined();
      expect(service.getLastEventId()).toBeNull();

      streamRes.pushText(`id: evt_role_late\ndata: {"eventId":"evt_role_late","topic":"CHILD_GATE_PASS_GENERATED"}\n\n`);
      await flushMicrotasks();
      expect(received).toHaveLength(1);
    });

    test('post-logout late events arriving from a previously open stream are rejected and never mutate state or cursor', async () => {
      saveAuthSession(residentA, 'jwt-late-logout', 'password');
      const stream = new MockSseStreamController();
      mockFetch.mockResolvedValueOnce(stream.toResponse(200));

      const received: any[] = [];
      service.subscribe('*', (m) => received.push(m));

      service.connect({ token: 'jwt-late-logout', userId: residentA.id, societyId: residentA.societyId, role: residentA.role });
      await flushMicrotasks();

      stream.pushText(`id: evt_before_logout\ndata: {"eventId":"evt_before_logout","topic":"CHILD_EXIT_TRIGGERED"}\n\n`);
      await flushMicrotasks();
      expect(received).toHaveLength(1);

      // Logout clears session & disconnects
      clearAuthSession();
      service.disconnect();

      // Late bytes arrive on the old stream controller
      stream.pushText(`id: evt_after_logout\ndata: {"eventId":"evt_after_logout","topic":"CHILD_SAFETY_SOS_TRIGGERED"}\n\n`);
      await flushMicrotasks();

      expect(received).toHaveLength(1);
      expect(service.getLastEventId()).toBeNull();
      expect(service.getRecentMessages()).toHaveLength(0);
    });

    test('cancels pending backoff reconnect cleanly on disconnect() or replacement user connect()', async () => {
      jest.useFakeTimers();
      saveAuthSession(residentA, 'jwt-backoff-a', 'password');

      const streamB = new MockSseStreamController();
      mockFetch
        .mockResolvedValueOnce(new MockSseStreamController().toResponse(503)) // A enters backoff (1000ms)
        .mockResolvedValueOnce(streamB.toResponse(200));                    // B connects cleanly

      service.connect({ token: 'jwt-backoff-a', userId: residentA.id, societyId: residentA.societyId, role: residentA.role });
      await flushMicrotasks();
      expect(service.getConnectionStatus().state).toBe('RECONNECTING');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Replace with Resident B during Resident A's backoff window
      saveAuthSession(residentB, 'jwt-backoff-b', 'password');
      service.connect({ token: 'jwt-backoff-b', userId: residentB.id, societyId: residentB.societyId, role: residentB.role });
      await flushMicrotasks();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1][1].headers['Authorization']).toBe('Bearer jwt-backoff-b');
      expect(service.getConnectionStatus().state).toBe('CONNECTED');

      // Advancing past A's old backoff timer MUST NOT fire any stale reconnect for A
      jest.advanceTimersByTime(10_000);
      await flushMicrotasks();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test('preserves realTimeSync consumer compatibility (subscribe, publish, unsubscribe)', () => {
      const received: any[] = [];
      const unsub = realTimeSync.subscribe('ANNOUNCEMENT_CREATED', (msg) => received.push(msg));

      realTimeSync.publish('ANNOUNCEMENT_CREATED', { title: 'Annual General Meeting' });
      expect(received).toHaveLength(1);
      expect(received[0].payload).toEqual({ title: 'Annual General Meeting' });

      unsub();
      realTimeSync.publish('ANNOUNCEMENT_CREATED', { title: 'After Unsubscribe' });
      expect(received).toHaveLength(1);
    });

    test('React Strict Mode connect -> cleanup disconnect -> remount connect leaves exactly one healthy stream and listener', async () => {
      saveAuthSession(residentA, 'jwt-strict-mode', 'password');
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

      const session = {
        token: 'jwt-strict-mode',
        userId: residentA.id,
        societyId: residentA.societyId,
        role: residentA.role,
      };
      const onEvent = jest.fn();

      // 1. Mount #1
      const unsub1 = service.subscribe('CHILD_GATE_PASS_GENERATED', onEvent);
      service.connect(session);
      await flushMicrotasks();
      expect(signals).toHaveLength(1);
      expect(signals[0].aborted).toBe(false);

      // 2. Strict Mode simulated unmount cleanup
      unsub1();
      service.disconnect();
      expect(signals[0].aborted).toBe(true);
      expect(service.getConnectionStatus().state).toBe('OFFLINE');
      expect(service.getConnectionStatus().activeListenersCount).toBe(0);

      // 3. Strict Mode remount #2
      const unsub2 = service.subscribe('CHILD_GATE_PASS_GENERATED', onEvent);
      service.connect(session);
      await flushMicrotasks();

      expect(signals).toHaveLength(2);
      expect(signals[1].aborted).toBe(false);
      expect(service.getConnectionStatus().state).toBe('CONNECTED');
      expect(service.getConnectionStatus().activeListenersCount).toBe(1);

      // Old aborted stream event ignored; active remounted stream delivers exactly once
      stream1.pushText(`id: evt_sm_stale\ndata: {"eventId":"evt_sm_stale","topic":"CHILD_GATE_PASS_GENERATED"}\n\n`);
      stream2.pushText(`id: evt_sm_live\ndata: {"eventId":"evt_sm_live","topic":"CHILD_GATE_PASS_GENERATED","passCode":"CGP-7777"}\n\n`);
      await flushMicrotasks();

      expect(onEvent).toHaveBeenCalledTimes(1);
      expect(onEvent.mock.calls[0][0].id).toBe('evt_sm_live');

      unsub2();
    });
  });

  // =========================================================================
  // 9. F-P2-01A: Canonical Fail-Closed Event Classification & Event Source Validation
  // =========================================================================
  describe('9. F-P2-01A: Canonical Fail-Closed Topic Policy, Emergency Source Validation & Side-Effect Isolation', () => {
    const installMockAudioContext = () => {
      const createdOscillators: Array<{ type: string; started: boolean }> = [];
      (global as any).window.AudioContext = class MockAudioContext {
        public currentTime = 0;
        public destination = {};
        public createOscillator() {
          const osc = {
            type: 'sine',
            started: false,
            frequency: {
              setValueAtTime: jest.fn(),
              exponentialRampToValueAtTime: jest.fn(),
            },
            connect: jest.fn(),
            start: jest.fn(() => {
              osc.started = true;
            }),
            stop: jest.fn(),
          };
          createdOscillators.push(osc);
          return osc;
        }
        public createGain() {
          return {
            gain: {
              setValueAtTime: jest.fn(),
              exponentialRampToValueAtTime: jest.fn(),
            },
            connect: jest.fn(),
          };
        }
      };
      return createdOscillators;
    };

    test('canonical classifier fails closed on forged emergency substrings, bare EMERGENCY, unknown, empty, and malformed topics', () => {
      // Forged substring & bare EMERGENCY must NEVER classify as emergency or client-broadcastable
      expect(classifyRealtimeTopic('FIRE_EMERGENCY')).toMatchObject({
        category: 'UNKNOWN',
        isEmergency: false,
        isProtected: true,
        canClientNetworkBroadcast: false,
      });
      expect(classifyRealtimeTopic('EMERGENCY')).toMatchObject({
        category: 'UNKNOWN',
        isEmergency: false,
        isProtected: true,
        canClientNetworkBroadcast: false,
      });

      // Legitimate canonical emergency & security alert topics
      expect(classifyRealtimeTopic('EMERGENCY_ALERT')).toMatchObject({
        category: 'EMERGENCY',
        isEmergency: true,
        isProtected: true,
        canClientNetworkBroadcast: false,
      });
      expect(classifyRealtimeTopic('EMERGENCY_INCIDENT_CREATED')).toMatchObject({
        category: 'EMERGENCY',
        isEmergency: true,
        isProtected: true,
        canClientNetworkBroadcast: false,
      });
      expect(classifyRealtimeTopic('CHILD_SAFETY_SOS_TRIGGERED')).toMatchObject({
        category: 'CHILD_EMERGENCY',
        isEmergency: true,
        isProtected: true,
        canClientNetworkBroadcast: false,
      });
      expect(classifyRealtimeTopic('SECURITY_ALERT_CREATED')).toMatchObject({
        category: 'SECURITY_ALERT',
        isEmergency: false,
        isProtected: true,
        canClientNetworkBroadcast: false,
      });

      // Canonical Child Safety topics (including authorized pickup events)
      expect(classifyRealtimeTopic('CHILD_PICKUP_AUTHORIZED')).toMatchObject({
        category: 'CHILD_SAFETY',
        isEmergency: false,
        isProtected: true,
        canClientNetworkBroadcast: false,
      });
      expect(classifyRealtimeTopic('CHILD_PICKUP_UPDATED')).toMatchObject({
        category: 'CHILD_SAFETY',
        isEmergency: false,
        isProtected: true,
        canClientNetworkBroadcast: false,
      });
      expect(classifyRealtimeTopic('CHILD_PICKUP_REVOKED')).toMatchObject({
        category: 'CHILD_SAFETY',
        isEmergency: false,
        isProtected: true,
        canClientNetworkBroadcast: false,
      });
      expect(classifyRealtimeTopic('CHILD_PROFILE_CREATED')).toMatchObject({
        category: 'CHILD_SAFETY',
        isEmergency: false,
        isProtected: true,
        canClientNetworkBroadcast: false,
      });
      expect(classifyRealtimeTopic('CHILD_GATE_PASS_GENERATED')).toMatchObject({
        category: 'CHILD_SAFETY',
        isEmergency: false,
        isProtected: true,
        canClientNetworkBroadcast: false,
      });

      // Unknown, empty, and malformed values fail closed
      for (const badTopic of ['', '   ', null, undefined, 123, 'BAD TOPIC!', 'LINE\nBREAK', 'UNKNOWN_TOPIC_XYZ']) {
        expect(classifyRealtimeTopic(badTopic)).toMatchObject({
          category: 'UNKNOWN',
          isEmergency: false,
          isProtected: true,
          canClientNetworkBroadcast: false,
        });
      }
    });

    test('forged/unsupported topics (FIRE_EMERGENCY, bare EMERGENCY, unknown, empty, malformed) NEVER trigger emergency audio, haptics, or alert toasts even on SSE', async () => {
      const oscillators = installMockAudioContext();
      saveAuthSession(guardA, 'jwt-guard-class', 'password');
      const stream = new MockSseStreamController();
      mockFetch.mockResolvedValueOnce(stream.toResponse(200));

      const alerts: any[] = [];
      const received: any[] = [];
      service.subscribeToAlerts((a) => alerts.push(a));
      service.subscribe('*', (m) => received.push(m));

      service.connect({ token: 'jwt-guard-class', userId: guardA.id, societyId: guardA.societyId, role: guardA.role });
      await flushMicrotasks();
      (triggerHaptic as jest.Mock).mockClear();

      // Send forged/unsupported/empty/malformed topics through SSE
      stream.pushText(
        `id: evt_bad_1\ndata: {"eventId":"evt_bad_1","topic":"FIRE_EMERGENCY","message":"Spoofed fire"}\n\n` +
          `id: evt_bad_2\ndata: {"eventId":"evt_bad_2","topic":"EMERGENCY","message":"Bare emergency"}\n\n` +
          `id: evt_bad_3\ndata: {"eventId":"evt_bad_3","topic":"UNKNOWN_CUSTOM_EVENT","message":"Unknown"}\n\n` +
          `id: evt_bad_4\ndata: {"eventId":"evt_bad_4","topic":"","message":"Empty"}\n\n` +
          `id: evt_bad_5\ndata: {"eventId":"evt_bad_5","topic":"BAD TOPIC!!","message":"Malformed"}\n\n`
      );
      await flushMicrotasks();

      // Zero alerts, zero emergency audio chimes, zero haptics for all forged/unknown/malformed topics
      expect(alerts).toHaveLength(0);
      expect(oscillators).toHaveLength(0);
      expect(triggerHaptic).not.toHaveBeenCalled();

      // Empty and malformed topics did NOT even reach subscribers (strictly dropped before dispatch)
      expect(received.map((m) => m.topic)).toEqual(['FIRE_EMERGENCY', 'EMERGENCY', 'UNKNOWN_CUSTOM_EVENT']);
    });

    test('identical canonical emergency & security topics trigger privileged effects ONLY via authenticated SSE, NEVER via BroadcastChannel or local publish', async () => {
      const oscillators = installMockAudioContext();
      const testSvc = new RealtimeService({
        fetchFn: mockFetch,
        getBaseUrl: () => 'http://localhost:5000',
        enableBroadcastChannel: true,
        enableOnlineListener: false,
        baseReconnectDelayMs: 1000,
        maxReconnectDelayMs: 8000,
        maxJitterMs: 0,
      });

      saveAuthSession(guardA, 'jwt-guard-compare', 'password');
      const stream = new MockSseStreamController();
      mockFetch.mockResolvedValueOnce(stream.toResponse(200));

      const alerts: any[] = [];
      const received: any[] = [];
      testSvc.subscribeToAlerts((a) => alerts.push(a));
      testSvc.subscribe('*', (m) => received.push(m));

      testSvc.connect({ token: 'jwt-guard-compare', userId: guardA.id, societyId: guardA.societyId, role: guardA.role });
      await flushMicrotasks();
      (triggerHaptic as jest.Mock).mockClear();

      const canonicalTopics = [
        'EMERGENCY_ALERT',
        'EMERGENCY_INCIDENT_CREATED',
        'CHILD_SAFETY_SOS_TRIGGERED',
        'SECURITY_ALERT_CREATED',
      ] as const;

      // Phase A: Identical topics posted over BroadcastChannel -> ZERO subscribers, ZERO alerts, ZERO audio, ZERO haptics
      const attackerTab = new MockBroadcastChannel('communityos_realtime_hub');
      for (const topic of canonicalTopics) {
        attackerTab.postMessage({
          id: `bc-ident-${topic}`,
          topic,
          societyId: guardA.societyId,
          userId: guardA.id,
          role: guardA.role,
          payload: { message: `BroadcastChannel forged ${topic}` },
        });
      }
      expect(received).toHaveLength(0);
      expect(alerts).toHaveLength(0);
      expect(oscillators).toHaveLength(0);
      expect(triggerHaptic).not.toHaveBeenCalled();

      // Phase B: Identical topics via local publish() -> ZERO emergency audio/haptics/toasts (source !== 'SSE')
      for (const topic of canonicalTopics) {
        testSvc.publish(topic as any, { message: `Local publish ${topic}` }, guardA.societyId);
      }
      expect(alerts).toHaveLength(0);
      expect(oscillators).toHaveLength(0);
      expect(triggerHaptic).not.toHaveBeenCalled();
      received.length = 0;

      // Phase C: Identical topics arriving over authenticated Fetch SSE -> full legitimate emergency/security behavior!
      stream.pushText(
        `id: evt_sse_em1\ndata: {"eventId":"evt_sse_em1","topic":"EMERGENCY_ALERT","message":"Gate emergency"}\n\n` +
          `id: evt_sse_em2\ndata: {"eventId":"evt_sse_em2","topic":"EMERGENCY_INCIDENT_CREATED","message":"Incident #44"}\n\n` +
          `id: evt_sse_sos\ndata: {"eventId":"evt_sse_sos","topic":"CHILD_SAFETY_SOS_TRIGGERED","location":"Main Park"}\n\n` +
          `id: evt_sse_sec\ndata: {"eventId":"evt_sse_sec","topic":"SECURITY_ALERT_CREATED","message":"Perimeter sensor"}\n\n`
      );
      await flushMicrotasks();

      expect(received).toHaveLength(4);
      expect(alerts).toHaveLength(4);
      expect(alerts[0]).toMatchObject({ topic: 'EMERGENCY_ALERT', urgency: 'emergency', actionPath: '/emergency' });
      expect(alerts[1]).toMatchObject({ topic: 'EMERGENCY_INCIDENT_CREATED', urgency: 'emergency', actionPath: '/emergency' });
      expect(alerts[2]).toMatchObject({ topic: 'CHILD_SAFETY_SOS_TRIGGERED', urgency: 'emergency', actionPath: '/security/child-safety' });
      expect(alerts[3]).toMatchObject({ topic: 'SECURITY_ALERT_CREATED', urgency: 'alert', actionPath: '/emergency' });

      // 3 emergency events fired sawtooth siren + heavy haptic; SECURITY_ALERT_CREATED fired alert chime + medium haptic
      const sawtoothCount = oscillators.filter((o) => o.type === 'sawtooth' && o.started).length;
      expect(sawtoothCount).toBe(3);
      expect(triggerHaptic).toHaveBeenCalledWith('heavy');
      expect(triggerHaptic).toHaveBeenCalledWith('medium');

      testSvc.destroy();
    });

    test('caps far-future HTTP-date Retry-After at MAX_RETRY_AFTER_MS (60000ms) without unreasonable waits', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-11-18T10:00:00.000Z'));
      saveAuthSession(residentA, 'jwt-ra-cap', 'password');

      const okStream = new MockSseStreamController();
      mockFetch
        .mockResolvedValueOnce(
          new MockSseStreamController().toResponse(429, { 'Retry-After': 'Wed, 18 Nov 2099 10:00:00 GMT' })
        )
        .mockResolvedValueOnce(okStream.toResponse(200));

      service.connect({ token: 'jwt-ra-cap', userId: residentA.id, societyId: residentA.societyId, role: residentA.role });
      await flushMicrotasks();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Should not reconnect before 60s cap
      jest.advanceTimersByTime(59_000);
      await flushMicrotasks();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Reconnects right at 60s cap (never waiting until year 2099!)
      jest.advanceTimersByTime(1_000);
      await flushMicrotasks();
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(service.getConnectionStatus().state).toBe('CONNECTED');
    });

    test('Subphase 4.6.1: canonical pickup topics (CHILD_PICKUP_AUTHORIZED, CHILD_PICKUP_UPDATED, CHILD_PICKUP_REVOKED) are protected, block client broadcast, and route alerts correctly', async () => {
      saveAuthSession(residentA, 'jwt-res-pickup', 'password');
      const stream = new MockSseStreamController();
      mockFetch.mockResolvedValueOnce(stream.toResponse(200));

      const alerts: any[] = [];
      const received: any[] = [];
      service.subscribeToAlerts((a) => alerts.push(a));
      service.subscribe('CHILD_PICKUP_AUTHORIZED', (m) => received.push(m));
      service.subscribe('CHILD_PICKUP_UPDATED', (m) => received.push(m));
      service.subscribe('CHILD_PICKUP_REVOKED', (m) => received.push(m));

      service.connect({
        token: 'jwt-res-pickup',
        userId: residentA.id,
        societyId: residentA.societyId,
        role: residentA.role,
      });
      await flushMicrotasks();
      (triggerHaptic as jest.Mock).mockClear();

      // 1. Client publish() of pickup topics is protected: dispatches locally, NEVER posts to /api/realtime/broadcast
      mockFetch.mockClear();
      service.publish('CHILD_PICKUP_AUTHORIZED', { id: 'p-1', childId: 'chd-1' }, residentA.societyId);
      service.publish('CHILD_PICKUP_UPDATED', { id: 'p-1', childId: 'chd-1' }, residentA.societyId);
      service.publish('CHILD_PICKUP_REVOKED', { id: 'p-1', childId: 'chd-1' }, residentA.societyId);
      await flushMicrotasks();

      expect(received).toHaveLength(3);
      expect(mockFetch).not.toHaveBeenCalled(); // zero outbound /api/realtime/broadcast calls
      expect(alerts).toHaveLength(0); // local publish does NOT trigger alert toasts/audio/haptics
      received.length = 0;

      // 2. Incoming via authenticated SSE: dispatches to subscribers, triggers alerts with role-routed actionPath and correct titles
      stream.pushText(
        `id: evt_p_auth\ndata: {"eventId":"evt_p_auth","topic":"CHILD_PICKUP_AUTHORIZED","payload":{"id":"p-1","childId":"chd-1"}}\n\n` +
          `id: evt_p_upd\ndata: {"eventId":"evt_p_upd","topic":"CHILD_PICKUP_UPDATED","payload":{"id":"p-1","childId":"chd-1"}}\n\n` +
          `id: evt_p_rev\ndata: {"eventId":"evt_p_rev","topic":"CHILD_PICKUP_REVOKED","payload":{"id":"p-1","childId":"chd-1"}}\n\n`
      );
      await flushMicrotasks();

      expect(received).toHaveLength(3);
      expect(alerts).toHaveLength(3);

      expect(alerts[0]).toMatchObject({
        topic: 'CHILD_PICKUP_AUTHORIZED',
        title: '🤝 Authorized Pickup Registered',
        urgency: 'info',
        actionPath: '/resident/child-safety',
      });
      expect(alerts[1]).toMatchObject({
        topic: 'CHILD_PICKUP_UPDATED',
        title: '📝 Pickup Authorization Updated',
        urgency: 'info',
        actionPath: '/resident/child-safety',
      });
      expect(alerts[2]).toMatchObject({
        topic: 'CHILD_PICKUP_REVOKED',
        title: '🛑 Pickup Authorization Revoked',
        urgency: 'info',
        actionPath: '/resident/child-safety',
      });

      // Non-emergency child safety: light haptic triggered (never heavy emergency siren)
      expect(triggerHaptic).toHaveBeenCalledWith('light');
      expect(triggerHaptic).not.toHaveBeenCalledWith('heavy');
    });
  });
});
