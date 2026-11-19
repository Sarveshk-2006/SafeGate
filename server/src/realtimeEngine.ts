import './env.js';
import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from './prisma.js';

export interface SSEClient {
  id: string;
  res: Response;
  societyId: string;
  userId?: string;
  role?: string;
  connectedAt: Date;
}

export interface EventAudiencePolicy {
  allowedRoles?: string[];
  targetUserIds?: string[];
}

export interface DomainEventInput {
  societyId: string;
  eventType: string;
  entityId: string;
  actorId?: string;
  payload: Record<string, any>;
  audience?: EventAudiencePolicy;
}

const PLATFORM_ADMIN_SENTINELS = new Set(['soc-platform', 'platform', '*', 'all']);
const SENSITIVE_EVENT_PREFIXES = [
  'CHILD_',
  'EMERGENCY_INCIDENT_',
  'EMERGENCY_ALERTS',
  'SECURITY_ALERT_',
  'SOS_',
  'RESIDENT_PRIVATE_',
] as const;
const SENSITIVE_DENIED_ROLES = new Set(['vendor', 'facility_manager', 'delivery']);
const KNOWN_ROLES = new Set([
  'resident',
  'guard',
  'secretary',
  'committee',
  'facility_manager',
  'vendor',
  'delivery',
  'admin',
]);
const ALLOWED_AUDIENCE_KEYS = new Set(['allowedRoles', 'targetUserIds']);

export function isSensitiveEventType(eventType: string): boolean {
  if (typeof eventType !== 'string' || !eventType.trim()) return true; // Malformed event type fails closed
  const upper = eventType.trim().toUpperCase();
  return SENSITIVE_EVENT_PREFIXES.some((prefix) => upper.startsWith(prefix));
}

/**
 * Structurally and semantically validates an EventAudiencePolicy.
 * Rejects non-objects, empty `{}`, unknown keys, unknown role names, and malformed user ID lists.
 */
export function isValidAudiencePolicy(audience: unknown): audience is EventAudiencePolicy {
  if (!audience || typeof audience !== 'object' || Array.isArray(audience)) {
    return false;
  }
  const obj = audience as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    return false;
  }
  for (const key of keys) {
    if (!ALLOWED_AUDIENCE_KEYS.has(key)) {
      return false;
    }
  }

  let hasNonEmptyRule = false;

  if (obj.allowedRoles !== undefined) {
    if (!Array.isArray(obj.allowedRoles)) return false;
    for (const r of obj.allowedRoles) {
      if (typeof r !== 'string' || !KNOWN_ROLES.has(r.trim().toLowerCase())) {
        return false;
      }
    }
    if (obj.allowedRoles.length > 0) hasNonEmptyRule = true;
  }

  if (obj.targetUserIds !== undefined) {
    if (!Array.isArray(obj.targetUserIds)) return false;
    for (const uid of obj.targetUserIds) {
      if (typeof uid !== 'string' || uid.trim().length === 0 || uid.trim().length > 128) {
        return false;
      }
    }
    if (obj.targetUserIds.length > 0) hasNonEmptyRule = true;
  }

  return hasNonEmptyRule;
}

function isVerifiedPlatformAdminContext(authContext: { role?: string; societyId?: string }): boolean {
  const role = (authContext.role || '').toLowerCase();
  if (role !== 'admin') return false;
  const soc = typeof authContext.societyId === 'string' ? authContext.societyId.trim() : '';
  return !soc || PLATFORM_ADMIN_SENTINELS.has(soc);
}

/**
 * Centralized fail-closed server-side SSE event delivery authorization policy.
 * Enforces tenant isolation, sensitive-event protection (CHILD_*, EMERGENCY_INCIDENT_*, etc.),
 * structural/semantic validation of EventAudiencePolicy, and owner-scoped delivery.
 */
export function isClientAuthorizedForEvent(
  client: Pick<SSEClient, 'societyId' | 'userId' | 'role'>,
  eventSocietyId: string,
  eventType: string,
  payload?: Record<string, any>,
  explicitAudience?: EventAudiencePolicy
): boolean {
  const clientSoc = typeof client?.societyId === 'string' ? client.societyId.trim() : '';
  const targetSoc = typeof eventSocietyId === 'string' ? eventSocietyId.trim() : '';
  if (!clientSoc || !targetSoc) {
    return false;
  }
  if (targetSoc !== '*' && clientSoc !== targetSoc) {
    return false;
  }
  if (typeof eventType !== 'string' || !eventType.trim()) {
    return false;
  }

  const clientRole = (client.role || '').trim().toLowerCase();
  const hasExplicitAudience =
    explicitAudience !== undefined ||
    (payload != null && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, '_audience'));
  const rawAudience: unknown = explicitAudience !== undefined ? explicitAudience : payload?._audience;
  const isSensitive = isSensitiveEventType(eventType);

  // Public non-sensitive society events without an audience restriction remain deliverable within the same society
  if (!isSensitive && !hasExplicitAudience) {
    return true;
  }

  // F-B22-02B: Sensitive events without explicit audience metadata MUST fail closed (never default to public delivery)
  if (isSensitive && !hasExplicitAudience) {
    return false;
  }

  // F-B22-02B: Any missing, empty (`{}`), malformed, or unknown-role audience MUST fail closed
  if (!isValidAudiencePolicy(rawAudience)) {
    return false;
  }

  // Unknown or missing client role cannot receive sensitive/audience-restricted events
  if (!clientRole || !KNOWN_ROLES.has(clientRole)) {
    return false;
  }

  // Defense-in-depth: vendor, facility_manager, and delivery roles never receive sensitive Child Safety / Emergency telemetry
  if (isSensitive && SENSITIVE_DENIED_ROLES.has(clientRole)) {
    return false;
  }

  const allowedRoles = new Set((rawAudience.allowedRoles || []).map((r) => r.trim().toLowerCase()));
  const targetUserIds = new Set((rawAudience.targetUserIds || []).map((u) => u.trim()));

  // Residents receive sensitive events ONLY when explicitly targeted by verified userId (owner/guardian/reporter)
  if (clientRole === 'resident') {
    if (client.userId && targetUserIds.has(client.userId)) {
      return true;
    }
    return !isSensitive && allowedRoles.has('resident');
  }

  // Explicitly targeted userId match (for non-denied roles)
  if (client.userId && targetUserIds.has(client.userId)) {
    return true;
  }

  // Explicitly allowed role match
  if (allowedRoles.has(clientRole)) {
    return true;
  }

  // Fail closed by default
  return false;
}

export class RealtimeEngine {
  private static instance: RealtimeEngine;
  private clients: Map<string, SSEClient> = new Map();
  private outboxInterval: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private isDbHealthy = true;
  private dbErrorCount = 0;
  private lastDbErrorTime = 0;

  private constructor() {
    if (process.env.NODE_ENV !== 'test') {
      this.startOutboxWorker();
    }
  }

  public static getInstance(): RealtimeEngine {
    if (!RealtimeEngine.instance) {
      RealtimeEngine.instance = new RealtimeEngine();
    }
    return RealtimeEngine.instance;
  }

  /**
   * Registers a new client for Server-Sent Events
   */
  public registerClient(
    clientId: string,
    res: Response,
    societyId: string,
    userId?: string,
    role?: string,
    lastEventId?: string
  ): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const client: SSEClient = {
      id: clientId,
      res,
      societyId,
      userId,
      role,
      connectedAt: new Date(),
    };

    this.clients.set(clientId, client);

    // Initial connection ack
    this.sendToClient(client, 'connected', {
      clientId,
      societyId,
      timestamp: new Date().toISOString(),
      message: 'SafeGate 2.0 Real-time Stream Connected',
    });

    // Replay missed events if Last-Event-ID was supplied
    if (lastEventId) {
      this.replayEventsSince(client, lastEventId).catch((err) =>
        console.error('[RealtimeEngine] Replay error:', err)
      );
    }

    // Handle disconnection
    res.on('close', () => {
      this.clients.delete(clientId);
    });
  }

  /**
   * Remove a client
   */
  public removeClient(clientId: string): void {
    this.clients.delete(clientId);
  }

  /**
   * Get active connection count
   */
  public getActiveConnectionCount(societyId?: string): number {
    if (!societyId) return this.clients.size;
    let count = 0;
    for (const client of this.clients.values()) {
      if (client.societyId === societyId) count++;
    }
    return count;
  }

  /**
   * Persists an event to the Transactional Outbox inside an existing Prisma transaction or standard client
   */
  public async recordOutboxEvent(
    eventInput: DomainEventInput,
    txClient?: any
  ): Promise<string> {
    const db = txClient || prisma;
    const eventId = `evt_${crypto.randomUUID()}`;

    const persistedPayload = eventInput.audience
      ? { ...eventInput.payload, _audience: eventInput.audience }
      : eventInput.payload;

    await db.outboxEvent.create({
      data: {
        eventId,
        societyId: eventInput.societyId,
        eventType: eventInput.eventType,
        entityId: eventInput.entityId,
        actorId: eventInput.actorId || 'system',
        payload: persistedPayload,
        status: 'PENDING',
      },
    });

    // Also trigger immediate in-memory dispatch to currently connected clients in this instance
    this.broadcastToSociety(
      eventInput.societyId,
      eventInput.eventType,
      {
        eventId,
        ...eventInput.payload,
        timestamp: new Date().toISOString(),
      },
      undefined,
      eventInput.audience
    );

    // Mark as published in outbox since in-memory delivery succeeded
    try {
      await db.outboxEvent.update({
        where: { eventId },
        data: {
          status: 'PUBLISHED',
          processedAt: new Date(),
        },
      });
    } catch {
      // Background worker will sweep and publish if direct update fails
    }

    return eventId;
  }

  /**
   * Broadcast an event to all authorized connected clients in a specific society or platform-wide ('*')
   */
  public broadcastToSociety(
    societyId: string,
    eventType: string,
    payload: any,
    targetRole?: string,
    audience?: EventAudiencePolicy
  ): void {
    const effectiveAudience: EventAudiencePolicy | undefined = audience || payload?._audience;
    for (const client of this.clients.values()) {
      if (societyId === '*' || client.societyId === societyId) {
        if (targetRole && client.role !== targetRole && client.role !== 'admin') {
          continue;
        }
        if (!isClientAuthorizedForEvent(client, societyId, eventType, payload, effectiveAudience)) {
          continue;
        }
        this.sendToClient(client, eventType, payload);
      }
    }
  }

  /**
   * Send single SSE frame to client (strips internal `_audience` metadata before wire serialization)
   */
  private sendToClient(client: SSEClient, eventType: string, data: any): void {
    try {
      const id = data.eventId || crypto.randomUUID();
      const { _audience: _strippedAudience, ...publicData } = data || {};
      const payloadString = JSON.stringify({
        ...publicData,
        id,
        topic: eventType,
        eventType,
        societyId: client.societyId,
        timestamp: publicData.timestamp || new Date().toISOString(),
      });
      client.res.write(`id: ${id}\n`);
      client.res.write(`data: ${payloadString}\n\n`);
      (client.res as any).flush?.();
    } catch (err) {
      this.clients.delete(client.id);
    }
  }

  /**
   * Replays missed outbox events since Last-Event-ID (enforcing tenant-scoped cursor lookup
   * and the exact same fail-closed event authorization policy as live delivery).
   */
  private async replayEventsSince(client: SSEClient, lastEventId: string): Promise<void> {
    try {
      const clientSoc = typeof client.societyId === 'string' ? client.societyId.trim() : '';
      if (!clientSoc || PLATFORM_ADMIN_SENTINELS.has(clientSoc)) {
        return;
      }

      const normalizedCursor = typeof lastEventId === 'string' ? lastEventId.trim() : '';
      let sinceDate = new Date(Date.now() - 3600000);

      // F-B22-02C: Scope cursor lookup strictly to the authenticated client's society.
      // A cursor belonging to another society resolves to null (indistinguishable from unknown cursor).
      if (normalizedCursor && normalizedCursor.length <= 128) {
        const lastEvent = await prisma.outboxEvent.findFirst({
          where: {
            eventId: normalizedCursor,
            societyId: clientSoc,
          },
        });
        if (lastEvent?.createdAt) {
          sinceDate = lastEvent.createdAt;
        }
      }

      const missedEvents = await prisma.outboxEvent.findMany({
        where: {
          societyId: clientSoc,
          createdAt: {
            gt: sinceDate,
          },
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });

      for (const ev of missedEvents) {
        const evPayload = (ev.payload as Record<string, any>) || {};
        if (!isClientAuthorizedForEvent(client, ev.societyId, ev.eventType, evPayload)) {
          continue;
        }
        this.sendToClient(client, ev.eventType, {
          eventId: ev.eventId,
          ...evPayload,
          replayed: true,
        });
      }
    } catch (err) {
      console.warn('[RealtimeEngine] Failed to replay events:', err);
    }
  }

  /**
   * Background outbox poller ensuring at-least-once delivery
   */
  public startOutboxWorker(): void {
    if (this.outboxInterval) return;

    // Send heartbeats every 10s to keep connections alive and provide network latency telemetry
    this.heartbeatTimer = setInterval(() => {
      const pingFrame = `data: ${JSON.stringify({ type: 'PING', timestamp: Date.now() })}\n\n`;
      for (const client of this.clients.values()) {
        try {
          client.res.write(pingFrame);
        } catch {
          this.clients.delete(client.id);
        }
      }
    }, 10000);
    this.heartbeatTimer.unref?.();

    // Process pending outbox records with fast 500ms cycle for instant durable recovery
    this.outboxInterval = setInterval(async () => {
      if (this.isProcessing) return;
      this.isProcessing = true;

      try {
        const pendingEvents = await prisma.outboxEvent.findMany({
          where: { status: 'PENDING' },
          orderBy: { createdAt: 'asc' },
          take: 20,
        });

        // If previously in error state, log recovery
        if (!this.isDbHealthy) {
          console.log(
            `[RealtimeEngine] Outbox poller database connection restored after ${this.dbErrorCount} failed attempts.`
          );
          this.isDbHealthy = true;
          this.dbErrorCount = 0;
        }

        for (const ev of pendingEvents) {
          try {
            this.broadcastToSociety(ev.societyId, ev.eventType, {
              eventId: ev.eventId,
              ...(ev.payload as object),
            });

            await prisma.outboxEvent.update({
              where: { id: ev.id },
              data: {
                status: 'PUBLISHED',
                processedAt: new Date(),
              },
            });
          } catch (dispatchErr: any) {
            await prisma.outboxEvent.update({
              where: { id: ev.id },
              data: {
                retryCount: { increment: 1 },
                error: dispatchErr?.message || 'Dispatch failed',
                status: ev.retryCount >= 5 ? 'FAILED' : 'PENDING',
              },
            });
          }
        }
      } catch (err: any) {
        this.dbErrorCount++;
        const now = Date.now();

        if (this.isDbHealthy) {
          // Transition to unhealthy state: log initial failure immediately
          this.isDbHealthy = false;
          this.lastDbErrorTime = now;
          const errorName = err?.name || 'DatabaseError';
          console.warn(`[RealtimeEngine] Outbox poller database connection error (${errorName}). Retrying in background.`);
        } else if (now - this.lastDbErrorTime >= 60000) {
          // Rate-limited warning: at most once every 60 seconds during prolonged database outage
          this.lastDbErrorTime = now;
          console.warn(
            `[RealtimeEngine] Outbox poller database still unreachable (${this.dbErrorCount} consecutive failures). Retrying...`
          );
        }
      } finally {
        this.isProcessing = false;
      }
    }, 500);
    this.outboxInterval.unref?.();
  }

  /**
   * Reports whether the realtime engine's database connection is currently healthy
   */
  public isDatabaseHealthy(): boolean {
    return this.isDbHealthy;
  }

  /**
   * Returns database error statistics for diagnostics
   */
  public getDatabaseErrorStats(): { consecutiveErrors: number; lastErrorTime: number } {
    return {
      consecutiveErrors: this.dbErrorCount,
      lastErrorTime: this.lastDbErrorTime,
    };
  }

  /**
   * Cleanly stops background timers for tests and graceful shutdown
   */
  public stop(): void {
    if (this.outboxInterval) {
      clearInterval(this.outboxInterval);
      this.outboxInterval = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

export const realtimeEngine = RealtimeEngine.getInstance();

/**
 * Authoritative Server-Sent Events (SSE) Subscription Controller
 * Binds stream subscription strictly to the verified req.authContext.
 * Client-supplied role, societyId, and userId parameters are never trusted.
 */
export const handleSseSubscription = (req: Request, res: Response): void => {
  const authContext = req.authContext;
  if (!authContext) {
    res.status(401).json({
      error: 'Unauthorized: Missing or invalid authentication context',
      code: 'AUTH_REQUIRED',
    });
    return;
  }

  const userRole = (authContext.role || '').toLowerCase();
  const userId = authContext.userId;
  const authSocietyId = typeof authContext.societyId === 'string' ? authContext.societyId.trim() : '';
  const requestedSocietyId =
    typeof req.query.societyId === 'string' ? req.query.societyId.trim() : undefined;
  const isPlatformAdmin = isVerifiedPlatformAdminContext(authContext);

  // Fail closed for society-bound roles (including society-bound admins) with missing tenant context
  if (!isPlatformAdmin && (!authSocietyId || PLATFORM_ADMIN_SENTINELS.has(authSocietyId))) {
    res.status(403).json({
      error: 'Tenant context required: User is not linked to any active society',
      code: 'TENANT_CONTEXT_REQUIRED',
    });
    return;
  }

  // Strict tenant isolation: only verified platform admins may specify an alternate societyId
  if (!isPlatformAdmin && requestedSocietyId && requestedSocietyId !== authSocietyId) {
    res.status(403).json({
      error: 'Forbidden: Cannot subscribe to events for an unauthorized society',
      code: 'TENANT_ISOLATION_VIOLATION',
    });
    return;
  }

  // Verified platform admin may subscribe to a specific target society; never falls back to 'soc-gvs'
  const societyId = isPlatformAdmin
    ? requestedSocietyId || 'soc-platform'
    : authSocietyId;

  const lastEventId = (req.headers['last-event-id'] as string) || (req.query.lastEventId as string);
  const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  realtimeEngine.registerClient(clientId, res, societyId, userId, userRole, lastEventId);
};
