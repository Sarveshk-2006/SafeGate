import request from 'supertest';
import { generateAuthToken } from '../server/src/auth';
import { prisma } from '../server/src/prisma';
import { realtimeEngine, handleSseSubscription } from '../server/src/realtimeEngine';
import { hashChildPassToken } from '../server/src/childSafety/crypto';
import {
  resetChildSafetyRateLimiters,
  createBoundedSlidingWindowLimiter,
} from '../server/src/childSafety/rateLimit';
import app from '../server/src/index';

jest.mock('../server/src/prisma', () => {
  const mockPrisma: any = {
    user: { findFirst: jest.fn() },
    resident: { findFirst: jest.fn() },
    flat: { findFirst: jest.fn() },
    entityRecord: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    childProfile: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    childAuthorizedPickup: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    childGatePass: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    childExitLog: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    childSafetyAlert: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    emergencyIncident: {
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    outboxEvent: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
  return { prisma: mockPrisma };
});

describe('ISSUE-06 Phase B.2.2 Targeted Security Remediation Verification (F-B22-01..F-B22-07)', () => {
  let resA1Token: string;
  let guardAToken: string;
  let secAToken: string;
  let socAdminAToken: string;
  let platformAdminToken: string;
  let vendorAToken: string;
  let staleGuardToken: string;
  let staleSecToken: string;
  let staleResToken: string;

  const mockUsers: Record<string, any> = {
    'usr-res-a1': { id: 'usr-res-a1', name: 'Parent A1', email: 'a1@rem.test', role: 'resident', societyId: 'soc-a', status: 'ACTIVE' },
    'usr-grd-a': { id: 'usr-grd-a', name: 'Guard Alpha', email: 'ga@rem.test', role: 'guard', societyId: 'soc-a', status: 'ACTIVE' },
    'usr-sec-a': { id: 'usr-sec-a', name: 'Secretary Alpha', email: 'sa@rem.test', role: 'secretary', societyId: 'soc-a', status: 'ACTIVE' },
    'usr-adm-a': { id: 'usr-adm-a', name: 'Society Admin Alpha', email: 'adma@rem.test', role: 'admin', societyId: 'soc-a', status: 'ACTIVE' },
    'usr-plat-adm': { id: 'usr-plat-adm', name: 'Platform Admin', email: 'plat@rem.test', role: 'admin', societyId: null, status: 'ACTIVE' },
    'usr-vnd-a': { id: 'usr-vnd-a', name: 'Vendor Alpha', email: 'va@rem.test', role: 'vendor', societyId: 'soc-a', status: 'ACTIVE' },
    // Users whose DB societyId was revoked (null) while old JWT still carries societyId: 'soc-a'
    'usr-stale-grd': { id: 'usr-stale-grd', name: 'Revoked Guard', email: 'sgrd@rem.test', role: 'guard', societyId: null, status: 'ACTIVE' },
    'usr-stale-sec': { id: 'usr-stale-sec', name: 'Revoked Sec', email: 'ssec@rem.test', role: 'secretary', societyId: null, status: 'ACTIVE' },
    'usr-stale-res': { id: 'usr-stale-res', name: 'Revoked Res', email: 'sres@rem.test', role: 'resident', societyId: null, status: 'ACTIVE' },
  };

  let outboxSpy: jest.SpyInstance;
  let broadcastSpy: jest.SpyInstance;

  beforeAll(() => {
    resA1Token = generateAuthToken({ sub: 'usr-res-a1', email: 'a1@rem.test', role: 'resident', societyId: 'soc-a', name: 'Parent A1' });
    guardAToken = generateAuthToken({ sub: 'usr-grd-a', email: 'ga@rem.test', role: 'guard', societyId: 'soc-a', name: 'Guard Alpha' });
    secAToken = generateAuthToken({ sub: 'usr-sec-a', email: 'sa@rem.test', role: 'secretary', societyId: 'soc-a', name: 'Secretary Alpha' });
    socAdminAToken = generateAuthToken({ sub: 'usr-adm-a', email: 'adma@rem.test', role: 'admin', societyId: 'soc-a', name: 'Society Admin Alpha' });
    platformAdminToken = generateAuthToken({ sub: 'usr-plat-adm', email: 'plat@rem.test', role: 'admin', societyId: 'soc-platform', name: 'Platform Admin' });
    vendorAToken = generateAuthToken({ sub: 'usr-vnd-a', email: 'va@rem.test', role: 'vendor', societyId: 'soc-a', name: 'Vendor Alpha' });

    // Stale JWTs still carry societyId: 'soc-a', but DB record has societyId: null
    staleGuardToken = generateAuthToken({ sub: 'usr-stale-grd', email: 'sgrd@rem.test', role: 'guard', societyId: 'soc-a', name: 'Revoked Guard' });
    staleSecToken = generateAuthToken({ sub: 'usr-stale-sec', email: 'ssec@rem.test', role: 'secretary', societyId: 'soc-a', name: 'Revoked Sec' });
    staleResToken = generateAuthToken({ sub: 'usr-stale-res', email: 'sres@rem.test', role: 'resident', societyId: 'soc-a', name: 'Revoked Res' });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetChildSafetyRateLimiters();
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(prisma));

    outboxSpy = jest.spyOn(realtimeEngine, 'recordOutboxEvent').mockResolvedValue('evt_rem');
    broadcastSpy = jest.spyOn(realtimeEngine, 'broadcastToSociety').mockImplementation(() => {});

    (prisma.user.findFirst as jest.Mock).mockImplementation(({ where }: any) => {
      const id = where?.OR?.[0]?.id || where?.id;
      return Promise.resolve(mockUsers[id] || null);
    });

    (prisma.resident.findFirst as jest.Mock).mockImplementation(({ where }: any) => {
      const or = where?.OR || [];
      const uid = or[0]?.userId || where?.id;
      if (uid === 'usr-res-a1' || uid === 'res-a1') {
        return Promise.resolve({
          id: 'res-a1',
          userId: 'usr-res-a1',
          societyId: 'soc-a',
          flatId: 'flat-a1',
          name: 'Parent A1',
          phone: '+919000000001',
          status: 'ACTIVE',
          flat: { id: 'flat-a1', societyId: 'soc-a', flatNumber: 'A-101' },
        });
      }
      return Promise.resolve(null);
    });
  });

  afterEach(() => {
    outboxSpy.mockRestore();
    broadcastSpy.mockRestore();
  });

  // =========================================================================
  // F-B22-01: Generic Collection & EntityRecord Bypass Closure
  // =========================================================================
  describe('F-B22-01: Generic Collection & EntityRecord Child Safety Bypass Closure', () => {
    const blockedNames = [
      'child_profiles',
      'children',
      'child_gate_passes',
      'child_authorized_pickups',
      'child_exit_logs',
      'child_safety_alerts',
      'ChIlD_PrOfIlEs',
      'child%5Fprofiles',
      'child%255Fprofiles',
      'child-gate-passes',
      'child_safety_custom',
    ];

    it('blocks ALL HTTP methods on Child Safety collection names and casing/encoding variants across roles (403)', async () => {
      for (const col of blockedNames) {
        const g = await request(app)
          .get(`/api/collections/${col}`)
          .set('Authorization', `Bearer ${vendorAToken}`);
        expect(g.status).toBe(403);
        expect(g.body.code).toBe('CHILD_SAFETY_COLLECTION_FORBIDDEN');

        const p = await request(app)
          .post(`/api/collections/${col}`)
          .set('Authorization', `Bearer ${resA1Token}`)
          .send({ fullName: 'Injected' });
        expect(p.status).toBe(403);
        expect(p.body.code).toBe('CHILD_SAFETY_COLLECTION_FORBIDDEN');
      }

      // Verify GET /:id, PUT /:id, PATCH /:id, DELETE /:id even for society admin & platform admin
      for (const token of [vendorAToken, resA1Token, socAdminAToken, platformAdminToken]) {
        const getById = await request(app)
          .get('/api/collections/child_profiles/c1')
          .set('Authorization', `Bearer ${token}`);
        expect(getById.status).toBe(403);

        const putById = await request(app)
          .put('/api/collections/child_gate_passes/p1')
          .set('Authorization', `Bearer ${token}`)
          .send({ status: 'ACTIVE' });
        expect(putById.status).toBe(403);

        const patchById = await request(app)
          .patch('/api/collections/children/c1')
          .set('Authorization', `Bearer ${token}`)
          .send({ status: 'SAFE' });
        expect(patchById.status).toBe(403);

        const delById = await request(app)
          .delete('/api/collections/child_safety_alerts/a1')
          .set('Authorization', `Bearer ${token}`);
        expect(delById.status).toBe(403);
      }

      // Ensure Prisma entityRecord was NEVER touched for any blocked collection
      expect(prisma.entityRecord.findMany).not.toHaveBeenCalled();
      expect(prisma.entityRecord.create).not.toHaveBeenCalled();
      expect(prisma.entityRecord.delete).not.toHaveBeenCalled();
    });

    it('excludes Child Safety collections from POST /api/entityRecord/query and enforces tenant scoping', async () => {
      (prisma.entityRecord.findMany as jest.Mock).mockResolvedValue([
        { id: 'rec-1', societyId: 'soc-a', collection: 'announcements', data: { title: 'Notice' } },
        { id: 'rec-2', societyId: 'soc-a', collection: 'Child-Profiles', data: { fullName: 'Leaked' } },
      ]);

      const res = await request(app)
        .post('/api/entityRecord/query')
        .set('Authorization', `Bearer ${socAdminAToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe('rec-1');
      expect(prisma.entityRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            societyId: 'soc-a',
            collection: { notIn: expect.arrayContaining(['child_profiles', 'child_gate_passes', 'children']) },
          }),
        })
      );
    });

    it('enforces strict tenant isolation on generic non-child collections (no soc-gvs fallback)', async () => {
      const crossSoc = await request(app)
        .get('/api/collections/announcements?societyId=soc-b')
        .set('Authorization', `Bearer ${resA1Token}`);
      expect(crossSoc.status).toBe(403);
      expect(crossSoc.body.code).toBe('TENANT_ISOLATION_VIOLATION');

      const noSoc = await request(app)
        .get('/api/collections/announcements')
        .set('Authorization', `Bearer ${staleResToken}`);
      expect(noSoc.status).toBe(403);
      expect(noSoc.body.code).toBe('TENANT_CONTEXT_REQUIRED');
    });
  });

  // =========================================================================
  // F-B22-02: Realtime SSE Tenant & Event Audience Authorization
  // =========================================================================
  describe('F-B22-02: Realtime SSE Tenant Scope & Event Audience Filtering', () => {
    function createMockSseRes() {
      const chunks: string[] = [];
      const closeHandlers: Array<() => void> = [];
      const res: any = {
        statusCode: 200,
        headers: {} as Record<string, string>,
        jsonPayload: null,
        chunks,
        setHeader(k: string, v: string) {
          this.headers[k.toLowerCase()] = v;
          return this;
        },
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json(payload: any) {
          this.jsonPayload = payload;
          return this;
        },
        write: jest.fn((chunk: string) => {
          chunks.push(String(chunk));
        }),
        flushHeaders: jest.fn(),
        on(evt: string, cb: () => void) {
          if (evt === 'close') closeHandlers.push(cb);
        },
        disconnect() {
          closeHandlers.forEach((cb) => cb());
        },
      };
      return res;
    }

    it('blocks society-bound admin from subscribing to another society SSE stream (403) and removes soc-gvs fallback', () => {
      const resCross = createMockSseRes();
      handleSseSubscription(
        {
          headers: {},
          query: { societyId: 'soc-b' },
          authContext: { userId: 'usr-adm-a', role: 'admin', societyId: 'soc-a', name: 'Society Admin A' },
        } as any,
        resCross
      );
      expect(resCross.statusCode).toBe(403);
      expect(resCross.jsonPayload.code).toBe('TENANT_ISOLATION_VIOLATION');

      const resMissingSoc = createMockSseRes();
      handleSseSubscription(
        {
          headers: {},
          query: {},
          authContext: { userId: 'usr-nosoc', role: 'resident', societyId: undefined, name: 'No Society' },
        } as any,
        resMissingSoc
      );
      expect(resMissingSoc.statusCode).toBe(403);
      expect(resMissingSoc.jsonPayload.code).toBe('TENANT_CONTEXT_REQUIRED');

      // Verified platform admin IS allowed to monitor a target society
      const resPlat = createMockSseRes();
      handleSseSubscription(
        {
          headers: {},
          query: { societyId: 'soc-b' },
          authContext: { userId: 'usr-plat-adm', role: 'admin', societyId: 'soc-platform', name: 'Platform Admin' },
        } as any,
        resPlat
      );
      expect(resPlat.statusCode).toBe(200);
      resPlat.disconnect();
    });

    it('delivers Child Safety SSE events strictly to authorized roles/owners and strips internal _audience', () => {
      // Restore real broadcastToSociety for this test
      broadcastSpy.mockRestore();

      const clients = [
        { key: 'vendorA', userId: 'usr-vnd-a', role: 'vendor', societyId: 'soc-a', res: createMockSseRes() },
        { key: 'fmA', userId: 'usr-fm-a', role: 'facility_manager', societyId: 'soc-a', res: createMockSseRes() },
        { key: 'ownerResA1', userId: 'usr-res-a1', role: 'resident', societyId: 'soc-a', res: createMockSseRes() },
        { key: 'otherResA2', userId: 'usr-res-a2', role: 'resident', societyId: 'soc-a', res: createMockSseRes() },
        { key: 'guardA', userId: 'usr-grd-a', role: 'guard', societyId: 'soc-a', res: createMockSseRes() },
        { key: 'secA', userId: 'usr-sec-a', role: 'secretary', societyId: 'soc-a', res: createMockSseRes() },
        { key: 'adminA', userId: 'usr-adm-a', role: 'admin', societyId: 'soc-a', res: createMockSseRes() },
        { key: 'adminB', userId: 'usr-adm-b', role: 'admin', societyId: 'soc-b', res: createMockSseRes() },
      ];

      try {
        for (const c of clients) {
          handleSseSubscription(
            {
              headers: {},
              query: {},
              authContext: { userId: c.userId, role: c.role, societyId: c.societyId, name: c.key },
            } as any,
            c.res
          );
          c.res.chunks.length = 0; // clear initial welcome message
        }

        // 1. Broadcast CHILD_PROFILE_CREATED (owners + secretary/committee/admin ONLY — NOT guard, vendor, facility_manager, other resident, or soc-b)
        realtimeEngine.broadcastToSociety(
          'soc-a',
          'CHILD_PROFILE_CREATED',
          { eventId: 'evt-prof-1', id: 'child-a1', status: 'SAFE' },
          undefined,
          { allowedRoles: ['secretary', 'committee', 'admin'], targetUserIds: ['usr-res-a1'] }
        );

        const receivedProfile = clients.filter((c) => c.res.chunks.some((ch: string) => ch.includes('evt-prof-1'))).map((c) => c.key);
        expect(receivedProfile.sort()).toEqual(['adminA', 'ownerResA1', 'secA']);

        // Confirm _audience is NEVER serialized to wire
        for (const c of clients) {
          for (const ch of c.res.chunks) {
            expect(ch).not.toContain('_audience');
          }
          c.res.chunks.length = 0;
        }

        // 2. Broadcast CHILD_SAFETY_SOS_TRIGGERED (owners + guard/secretary/committee/admin — NOT vendor, facility_manager, other resident, or soc-b)
        realtimeEngine.broadcastToSociety(
          'soc-a',
          'CHILD_SAFETY_SOS_TRIGGERED',
          { eventId: 'evt-sos-1', alertId: 'al-1', status: 'ACTIVE' },
          undefined,
          { allowedRoles: ['guard', 'secretary', 'committee', 'admin'], targetUserIds: ['usr-res-a1'] }
        );

        const receivedSos = clients.filter((c) => c.res.chunks.some((ch: string) => ch.includes('evt-sos-1'))).map((c) => c.key);
        expect(receivedSos.sort()).toEqual(['adminA', 'guardA', 'ownerResA1', 'secA']);
      } finally {
        clients.forEach((c) => c.res.disconnect());
        broadcastSpy = jest.spyOn(realtimeEngine, 'broadcastToSociety').mockImplementation(() => {});
      }
    });

    it('enforces persisted _audience filtering during Last-Event-ID outbox replay', async () => {
      (prisma.outboxEvent.findFirst as jest.Mock).mockResolvedValue({
        eventId: 'evt-0',
        societyId: 'soc-a',
        createdAt: new Date(Date.now() - 60_000),
      });
      (prisma.outboxEvent.findMany as jest.Mock).mockResolvedValue([
        {
          eventId: 'evt-replay-1',
          societyId: 'soc-a',
          eventType: 'CHILD_SAFETY_SOS_TRIGGERED',
          payload: {
            alertId: 'al-replay',
            status: 'ACTIVE',
            _audience: {
              allowedRoles: ['guard', 'secretary', 'committee', 'admin'],
              targetUserIds: ['usr-res-a1'],
            },
          },
          createdAt: new Date(),
        },
      ]);

      const vendorRes = createMockSseRes();
      const ownerRes = createMockSseRes();

      await (realtimeEngine as any).replayEventsSince(
        {
          id: 'c-vnd',
          res: vendorRes,
          societyId: 'soc-a',
          userId: 'usr-vnd-a',
          role: 'vendor',
          connectedAt: Date.now(),
        },
        'evt-0'
      );
      expect(vendorRes.chunks.join('')).not.toContain('evt-replay-1');

      await (realtimeEngine as any).replayEventsSince(
        {
          id: 'c-own',
          res: ownerRes,
          societyId: 'soc-a',
          userId: 'usr-res-a1',
          role: 'resident',
          connectedAt: Date.now(),
        },
        'evt-0'
      );
      expect(ownerRes.chunks.join('')).toContain('evt-replay-1');
      expect(ownerRes.chunks.join('')).not.toContain('_audience');
    });
  });

  // =========================================================================
  // F-B22-03: Stale JWT societyId Removal & Guard GET /passes/:id Hardening
  // =========================================================================
  describe('F-B22-03: Stale JWT Society Claim Rejection & Guard Pass Scoping', () => {
    it('rejects previously valid JWT carrying societyId when DB user.societyId is null (guard, secretary, resident)', async () => {
      for (const token of [staleGuardToken, staleSecToken, staleResToken]) {
        const res = await request(app)
          .get('/api/children/passes')
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('TENANT_CONTEXT_REQUIRED');
      }
    });

    it('preserves platform admin access when DB role=admin and user.societyId=null', async () => {
      (prisma.childGatePass.findMany as jest.Mock).mockResolvedValue([]);
      const res = await request(app)
        .get('/api/children/passes?societyId=soc-a')
        .set('Authorization', `Bearer ${platformAdminToken}`);
      expect(res.status).toBe(200);
    });

    it('restricts guard GET /api/children/passes/:id to ACTIVE, unexpired, non-archived passes only', async () => {
      // Simulate DB returning null because REVOKED/USED/EXPIRED pass does not match active guard filter
      (prisma.childGatePass.findFirst as jest.Mock).mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/children/passes/pass-revoked-1')
        .set('Authorization', `Bearer ${guardAToken}`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('PASS_NOT_FOUND');
      expect(prisma.childGatePass.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'pass-revoked-1',
            societyId: 'soc-a',
            status: 'ACTIVE',
            archivedAt: null,
            validUntil: { gt: expect.any(Date) },
          }),
        })
      );
    });
  });

  // =========================================================================
  // F-B22-04: Bounded Rate Limiter & Pass Creation Rate Limiting
  // =========================================================================
  describe('F-B22-04: Bounded Sliding-Window Rate Limiter & Pass Creation Throttling', () => {
    it('sweeps expired buckets, fails closed on maxBuckets exhaustion, and ignores spoofed X-Forwarded-For', () => {
      let nowMs = 1_000_000;
      const dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
      const buckets = new Map<string, { count: number; resetTime: number }>();
      const middleware = createBoundedSlidingWindowLimiter(buckets, {
        windowMs: 1000,
        maxRequests: 2,
        maxBuckets: 2,
        code: 'UNIT_RATE_LIMITED',
        errorMessage: 'Too many requests',
      });

      const runReq = (reqObj: any) => {
        const resObj: any = {
          statusCode: 200,
          headers: {} as Record<string, string>,
          body: null,
          setHeader(k: string, v: string) {
            this.headers[k.toLowerCase()] = v;
          },
          status(c: number) {
            this.statusCode = c;
            return this;
          },
          json(b: any) {
            this.body = b;
            return this;
          },
        };
        let nextCalled = false;
        middleware(reqObj, resObj, () => {
          nextCalled = true;
        });
        return { resObj, nextCalled };
      };

      try {
        // Spoofed X-Forwarded-For MUST NOT bypass rate limiting for same authenticated user
        const u1a = runReq({ authContext: { userId: 'u1', societyId: 'soc-a' }, headers: { 'x-forwarded-for': '1.1.1.1' }, socket: { remoteAddress: '10.0.0.1' } });
        const u1b = runReq({ authContext: { userId: 'u1', societyId: 'soc-a' }, headers: { 'x-forwarded-for': '2.2.2.2' }, socket: { remoteAddress: '10.0.0.1' } });
        const u1c = runReq({ authContext: { userId: 'u1', societyId: 'soc-a' }, headers: { 'x-forwarded-for': '3.3.3.3' }, socket: { remoteAddress: '10.0.0.1' } });
        expect(u1a.nextCalled).toBe(true);
        expect(u1b.nextCalled).toBe(true);
        expect(u1c.nextCalled).toBe(false);
        expect(u1c.resObj.statusCode).toBe(429);
        expect(u1c.resObj.body.code).toBe('UNIT_RATE_LIMITED');
        expect(u1c.resObj.headers['retry-after']).toBeDefined();

        // Second distinct user fills maxBuckets=2
        const u2 = runReq({ authContext: { userId: 'u2', societyId: 'soc-a' }, headers: {}, socket: { remoteAddress: '10.0.0.2' } });
        expect(u2.nextCalled).toBe(true);
        expect(buckets.size).toBe(2);

        // Third distinct user hits capacity -> fails closed (429 RATE_LIMIT_CAPACITY_EXCEEDED)
        const u3 = runReq({ authContext: { userId: 'u3', societyId: 'soc-a' }, headers: {}, socket: { remoteAddress: '10.0.0.3' } });
        expect(u3.nextCalled).toBe(false);
        expect(u3.resObj.statusCode).toBe(429);
        expect(u3.resObj.body.code).toBe('RATE_LIMIT_CAPACITY_EXCEEDED');
        expect(u3.resObj.headers['retry-after']).toBeDefined();

        // Advance clock past window -> automatic sweep on next write reclaims expired buckets and allows u3
        nowMs += 2000;
        const u3AfterSweep = runReq({ authContext: { userId: 'u3', societyId: 'soc-a' }, headers: {}, socket: { remoteAddress: '10.0.0.3' } });
        expect(u3AfterSweep.nextCalled).toBe(true);
        expect(buckets.size).toBe(1);
      } finally {
        dateSpy.mockRestore();
      }
    });

    it('throttles POST /api/children/passes after 20 requests per 10-minute window with 429 and Retry-After', async () => {
      (prisma.childProfile.findFirst as jest.Mock).mockResolvedValue({
        id: 'child-a1',
        societyId: 'soc-a',
        residentId: 'res-a1',
        guardianUserId: 'usr-res-a1',
        status: 'SAFE',
        archivedAt: null,
        exitPermissionMode: 'SOLO_ALLOWED',
        allowedSoloExit: true,
      });
      (prisma.childGatePass.create as jest.Mock).mockImplementation(({ data }: any) =>
        Promise.resolve({ id: `pass-${Math.random()}`, ...data, createdAt: new Date(), updatedAt: new Date() })
      );

      let lastRes: any = null;
      for (let i = 0; i < 21; i++) {
        lastRes = await request(app)
          .post('/api/children/passes')
          .set('Authorization', `Bearer ${resA1Token}`)
          .set('X-Forwarded-For', `203.0.113.${i + 1}`) // Spoofed IP must be ignored
          .send({
            childId: 'child-a1',
            validUntil: new Date(Date.now() + 3600_000).toISOString(),
          });
      }
      expect(lastRes.status).toBe(429);
      expect(lastRes.body.code).toBe('CHILD_PASS_CREATE_RATE_LIMITED');
      expect(lastRes.headers['retry-after']).toBeDefined();
    });

    it('throttles POST /api/children/passes/verify after 30 requests per minute with 429 and Retry-After (ignoring spoofed X-Forwarded-For)', async () => {
      (prisma.childGatePass.findFirst as jest.Mock).mockResolvedValue(null);

      let lastRes: any = null;
      for (let i = 0; i < 31; i++) {
        lastRes = await request(app)
          .post('/api/children/passes/verify')
          .set('Authorization', `Bearer ${guardAToken}`)
          .set('X-Forwarded-For', `198.51.100.${i + 1}`)
          .send({ bearerToken: 'a'.repeat(43), gateId: 'Main-Gate' });
      }
      expect(lastRes.status).toBe(429);
      expect(lastRes.body.code).toBe('CHILD_PASS_VERIFY_RATE_LIMITED');
      expect(lastRes.headers['retry-after']).toBeDefined();
    });
  });

  // =========================================================================
  // F-B22-06A/B/C & F-B22-07: Data Integrity, Validation & Edge Cases
  // =========================================================================
  describe('F-B22-06 & F-B22-07: SOS Deduplication, Contact Validation, Pickup Reactivation & Edge Cases', () => {
    it('rejects duplicate active MISSING_CHILD SOS alert (409 DUPLICATE_ACTIVE_SOS_ALERT) without creating incident or events', async () => {
      (prisma.childProfile.findFirst as jest.Mock).mockResolvedValue({
        id: 'child-a1',
        societyId: 'soc-a',
        residentId: 'res-a1',
        guardianUserId: 'usr-res-a1',
        fullName: 'Aarav',
        flatNumber: 'A-101',
        status: 'MISSING',
        archivedAt: null,
      });
      (prisma.childSafetyAlert.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'alert-existing-1',
        societyId: 'soc-a',
        childId: 'child-a1',
        alertType: 'MISSING_CHILD',
        status: 'ACTIVE',
        location: 'Clubhouse',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .post('/api/children/sos')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ childId: 'child-a1', location: 'Park', alertType: 'MISSING_CHILD' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DUPLICATE_ACTIVE_SOS_ALERT');
      expect(res.body.activeAlert.id).toBe('alert-existing-1');
      expect(prisma.emergencyIncident.create).not.toHaveBeenCalled();
      expect(outboxSpy).not.toHaveBeenCalled();
    });

    it('rejects malformed, oversized, or raw-ID-bearing secondaryGuardians & emergencyContacts (400)', async () => {
      const base = { fullName: 'Aarav', guardianName: 'Parent A1', guardianPhone: '+919000000001' };

      // 1. Non-array
      const r1 = await request(app)
        .post('/api/children')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ ...base, secondaryGuardians: 'not-an-array' });
      expect(r1.status).toBe(400);
      expect(r1.body.code).toBe('INVALID_CONTACT_LIST');

      // 2. Unknown nested key / raw ID field
      const r2 = await request(app)
        .post('/api/children')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({
          ...base,
          emergencyContacts: [{ name: 'Uncle', relationship: 'Uncle', phone: '+919999999999', aadhaarNumber: '123456789012' }],
        });
      expect(r2.status).toBe(400);
      expect(r2.body.code).toBe('INVALID_CONTACT_LIST');

      // 3. > 5 entries
      const tooMany = Array.from({ length: 6 }, (_, i) => ({
        name: `Contact ${i}`,
        relationship: 'Relative',
        phone: '+919000000000',
      }));
      const r3 = await request(app)
        .post('/api/children')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ ...base, secondaryGuardians: tooMany });
      expect(r3.status).toBe(400);
      expect(r3.body.code).toBe('INVALID_CONTACT_LIST');
    });

    it('blocks reactivation of REVOKED or EXPIRED pickups without future validUntil, and allows valid renewal', async () => {
      (prisma.childProfile.findFirst as jest.Mock).mockResolvedValue({
        id: 'child-a1',
        societyId: 'soc-a',
        residentId: 'res-a1',
        guardianUserId: 'usr-res-a1',
        status: 'SAFE',
        archivedAt: null,
      });

      // 1. REVOKED -> ACTIVE rejected (422)
      (prisma.childAuthorizedPickup.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'pk-rev',
        societyId: 'soc-a',
        childId: 'child-a1',
        status: 'REVOKED',
        archivedAt: null,
        validUntil: null,
      });
      const rRev = await request(app)
        .patch('/api/children/child-a1/pickups/pk-rev')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ status: 'ACTIVE', validUntil: new Date(Date.now() + 86400_000).toISOString() });
      expect(rRev.status).toBe(422);
      expect(rRev.body.code).toBe('REVOKED_PICKUP_CANNOT_BE_REACTIVATED');

      // 2. EXPIRED -> ACTIVE without future validUntil rejected (422)
      (prisma.childAuthorizedPickup.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'pk-exp',
        societyId: 'soc-a',
        childId: 'child-a1',
        status: 'EXPIRED',
        archivedAt: null,
        validUntil: new Date(Date.now() - 3600_000),
      });
      const rExpNoDate = await request(app)
        .patch('/api/children/child-a1/pickups/pk-exp')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ status: 'ACTIVE' });
      expect(rExpNoDate.status).toBe(422);
      expect(rExpNoDate.body.code).toBe('EXPIRED_PICKUP_REQUIRES_FUTURE_VALID_UNTIL');

      // 3. EXPIRED -> ACTIVE WITH future validUntil succeeds (200)
      const futureDate = new Date(Date.now() + 86400_000);
      (prisma.childAuthorizedPickup.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'pk-exp',
        societyId: 'soc-a',
        childId: 'child-a1',
        status: 'EXPIRED',
        archivedAt: null,
        validUntil: new Date(Date.now() - 3600_000),
      });
      (prisma.childAuthorizedPickup.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });
      (prisma.childAuthorizedPickup.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'pk-exp',
        societyId: 'soc-a',
        childId: 'child-a1',
        name: 'Nanny',
        phone: '+919999999999',
        relationship: 'Nanny',
        status: 'ACTIVE',
        validUntil: futureDate,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const rExpRenew = await request(app)
        .patch('/api/children/child-a1/pickups/pk-exp')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ status: 'ACTIVE', validUntil: futureDate.toISOString() });
      expect(rExpRenew.status).toBe(200);
      expect(rExpRenew.body.status).toBe('ACTIVE');
    });

    it('rejects POST /passes/:id/verify with mismatched pass id (404) and blocks PATCH MISSING -> SAFE while alert active (409)', async () => {
      const rawToken = 'z'.repeat(43);
      const tokenHash = hashChildPassToken(rawToken);
      (prisma.childGatePass.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'pass-real-1',
        societyId: 'soc-a',
        childId: 'child-a1',
        tokenHash,
        status: 'ACTIVE',
        validFrom: new Date(Date.now() - 60_000),
        validUntil: new Date(Date.now() + 3600_000),
        maxUses: 1,
        currentUses: 0,
        child: { id: 'child-a1', status: 'SAFE', archivedAt: null, exitPermissionMode: 'SOLO_ALLOWED', allowedSoloExit: true },
        pickupPerson: null,
      });

      const mismatchRes = await request(app)
        .post('/api/children/passes/pass-wrong-999/verify')
        .set('Authorization', `Bearer ${guardAToken}`)
        .send({ bearerToken: rawToken, gateId: 'Gate-1' });
      expect(mismatchRes.status).toBe(404);
      expect(mismatchRes.body.code).toBe('INVALID_OR_UNKNOWN_PASS');

      // PATCH /api/children/:id MISSING -> SAFE blocked while active MISSING_CHILD alert exists
      (prisma.childProfile.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'child-a1',
        societyId: 'soc-a',
        residentId: 'res-a1',
        guardianUserId: 'usr-res-a1',
        status: 'MISSING',
        archivedAt: null,
      });
      (prisma.childSafetyAlert.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'al-active-1',
        alertType: 'MISSING_CHILD',
        status: 'ACTIVE',
      });
      const patchMissing = await request(app)
        .patch('/api/children/child-a1')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ status: 'SAFE' });
      expect(patchMissing.status).toBe(409);
      expect(patchMissing.body.code).toBe('ACTIVE_MISSING_ALERT_MUST_BE_RESOLVED');
    });
  });

  // =========================================================================
  // Phase 4.3 Remediation (F-P43-01, F-P43-02, F-P43-04):
  // Expired Pickup Renewal, Strict Calendar Dates & Phone Validation
  // =========================================================================
  describe('Phase 4.3 Remediation — Expired Pickup Lifecycle, Calendar Dates & Phone Validation', () => {
    const mockOwnedChild = () => {
      (prisma.resident.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'res-a1',
        societyId: 'soc-a',
        flatId: 'flat-a1',
        name: 'Parent A1',
        phone: '+919000000001',
        flat: { id: 'flat-a1', flatNumber: 'A-101', societyId: 'soc-a' },
      });
      (prisma.childProfile.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'child-a1',
        societyId: 'soc-a',
        residentId: 'res-a1',
        guardianUserId: 'usr-res-a1',
        status: 'SAFE',
        archivedAt: null,
      });
    };

    it('F-P43-01: rejects validUntil: null on persisted EXPIRED and time-expired ACTIVE pickups (422), allows valid renewals & active edits, protects REVOKED/ARCHIVED, and enforces cross-child/society scoping', async () => {
      const pastDate = new Date(Date.now() - 3600_000);
      const futureDate = new Date(Date.now() + 86400_000);

      // 1. Persisted EXPIRED + validUntil: null -> 422 EXPIRED_PICKUP_REQUIRES_FUTURE_VALID_UNTIL
      mockOwnedChild();
      (prisma.childAuthorizedPickup.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'pk-exp-1',
        societyId: 'soc-a',
        childId: 'child-a1',
        status: 'EXPIRED',
        archivedAt: null,
        validUntil: pastDate,
      });
      const rExpNull = await request(app)
        .patch('/api/children/child-a1/pickups/pk-exp-1')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ name: 'Updated Name', validUntil: null });
      expect(rExpNull.status).toBe(422);
      expect(rExpNull.body.code).toBe('EXPIRED_PICKUP_REQUIRES_FUTURE_VALID_UNTIL');

      // 2. Time-expired ACTIVE (validUntil <= now) + validUntil: null (status omitted) -> 422 EXPIRED_PICKUP_REQUIRES_FUTURE_VALID_UNTIL
      mockOwnedChild();
      (prisma.childAuthorizedPickup.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'pk-time-exp-1',
        societyId: 'soc-a',
        childId: 'child-a1',
        status: 'ACTIVE',
        archivedAt: null,
        validUntil: pastDate,
      });
      const rTimeExpNull = await request(app)
        .patch('/api/children/child-a1/pickups/pk-time-exp-1')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ name: 'Updated Name', validUntil: null });
      expect(rTimeExpNull.status).toBe(422);
      expect(rTimeExpNull.body.code).toBe('EXPIRED_PICKUP_REQUIRES_FUTURE_VALID_UNTIL');

      // 3. Time-expired ACTIVE + future expiry -> 200
      mockOwnedChild();
      (prisma.childAuthorizedPickup.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'pk-time-exp-1',
        societyId: 'soc-a',
        childId: 'child-a1',
        status: 'ACTIVE',
        archivedAt: null,
        validUntil: pastDate,
      });
      (prisma.childAuthorizedPickup.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });
      (prisma.childAuthorizedPickup.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'pk-time-exp-1',
        societyId: 'soc-a',
        childId: 'child-a1',
        name: 'Driver',
        phone: '+919999999999',
        relationship: 'Driver',
        status: 'ACTIVE',
        validUntil: futureDate,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const rTimeExpRenew = await request(app)
        .patch('/api/children/child-a1/pickups/pk-time-exp-1')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ validUntil: futureDate.toISOString(), status: 'ACTIVE' });
      expect(rTimeExpRenew.status).toBe(200);
      expect(rTimeExpRenew.body.status).toBe('ACTIVE');

      // 4. Persisted EXPIRED + non-expiry contact edit only (no validUntil/status change) -> 200
      mockOwnedChild();
      (prisma.childAuthorizedPickup.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'pk-exp-1',
        societyId: 'soc-a',
        childId: 'child-a1',
        status: 'EXPIRED',
        archivedAt: null,
        validUntil: pastDate,
      });
      (prisma.childAuthorizedPickup.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });
      (prisma.childAuthorizedPickup.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'pk-exp-1',
        societyId: 'soc-a',
        childId: 'child-a1',
        name: 'Updated Contact',
        phone: '+919888877777',
        relationship: 'Aunt',
        status: 'EXPIRED',
        validUntil: pastDate,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const rExpContactOnly = await request(app)
        .patch('/api/children/child-a1/pickups/pk-exp-1')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ name: 'Updated Contact', phone: '+919888877777' });
      expect(rExpContactOnly.status).toBe(200);
      expect(rExpContactOnly.body.status).toBe('EXPIRED');

      // 5. REVOKED (even with past validUntil) + validUntil: null -> 422 REVOKED_PICKUP_CANNOT_BE_REACTIVATED; ARCHIVED -> 409 PICKUP_ARCHIVED
      mockOwnedChild();
      (prisma.childAuthorizedPickup.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'pk-rev-past',
        societyId: 'soc-a',
        childId: 'child-a1',
        status: 'REVOKED',
        archivedAt: null,
        validUntil: pastDate,
      });
      const rRevNull = await request(app)
        .patch('/api/children/child-a1/pickups/pk-rev-past')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ validUntil: null });
      expect(rRevNull.status).toBe(422);
      expect(rRevNull.body.code).toBe('REVOKED_PICKUP_CANNOT_BE_REACTIVATED');

      mockOwnedChild();
      (prisma.childAuthorizedPickup.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'pk-arch-1',
        societyId: 'soc-a',
        childId: 'child-a1',
        status: 'ARCHIVED',
        archivedAt: pastDate,
        validUntil: null,
      });
      const rArch = await request(app)
        .patch('/api/children/child-a1/pickups/pk-arch-1')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ status: 'ACTIVE', validUntil: futureDate.toISOString() });
      expect(rArch.status).toBe(409);
      expect(rArch.body.code).toBe('PICKUP_ARCHIVED');

      // 6. Normal non-expired ACTIVE pickup can still clear validUntil: null -> 200
      mockOwnedChild();
      (prisma.childAuthorizedPickup.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'pk-act-1',
        societyId: 'soc-a',
        childId: 'child-a1',
        status: 'ACTIVE',
        archivedAt: null,
        validUntil: futureDate,
      });
      (prisma.childAuthorizedPickup.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });
      (prisma.childAuthorizedPickup.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'pk-act-1',
        societyId: 'soc-a',
        childId: 'child-a1',
        name: 'Grandma',
        phone: '+919811112222',
        relationship: 'Grandmother',
        status: 'ACTIVE',
        validUntil: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const rActClear = await request(app)
        .patch('/api/children/child-a1/pickups/pk-act-1')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ validUntil: null });
      expect(rActClear.status).toBe(200);
      expect(rActClear.body.validUntil).toBeNull();

      // 7. Cross-child / cross-society pickup PATCH returns 404 (joint scoping preserved)
      mockOwnedChild();
      (prisma.childAuthorizedPickup.findFirst as jest.Mock).mockResolvedValueOnce(null);
      const rForeignPickup = await request(app)
        .patch('/api/children/child-a1/pickups/pk-other-child')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ name: 'Injected' });
      expect(rForeignPickup.status).toBe(404);
      expect(rForeignPickup.body.code).toBe('PICKUP_NOT_FOUND');

      // Cross-society child returns 404
      (prisma.childProfile.findFirst as jest.Mock).mockResolvedValueOnce(null);
      const rCrossSoc = await request(app)
        .patch('/api/children/child-soc-b/pickups/pk-1')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ name: 'Injected' });
      expect(rCrossSoc.status).toBe(404);
      expect(rCrossSoc.body.code).toBe('CHILD_NOT_FOUND');
    });

    it('F-P43-02 & F-P43-04: rejects impossible calendar dates and malformed phone numbers on POST/PATCH while accepting leap-year and international phones', async () => {
      // Impossible calendar dates rejected with 400 INVALID_VALID_UNTIL
      for (const badDate of ['2027-02-30T12:00:00Z', '2027-04-31T12:00:00Z', '2027-02-29T12:00:00Z', '2027-13-01T12:00:00Z', '2027-00-10T12:00:00Z']) {
        mockOwnedChild();
        const rBadDate = await request(app)
          .post('/api/children/child-a1/pickups')
          .set('Authorization', `Bearer ${resA1Token}`)
          .send({
            name: 'Sunita Devi',
            phone: '+91 98199 88776',
            relationship: 'Grandmother',
            validUntil: badDate,
          });
        expect(rBadDate.status).toBe(400);
        expect(rBadDate.body.code).toBe('INVALID_VALID_UNTIL');
      }

      // Malformed phone numbers rejected with 400 INVALID_PHONE
      for (const badPhone of ['abc', '---', '123', '++919811112222', '1234567890123456']) {
        mockOwnedChild();
        const rBadPhone = await request(app)
          .post('/api/children/child-a1/pickups')
          .set('Authorization', `Bearer ${resA1Token}`)
          .send({
            name: 'Sunita Devi',
            phone: badPhone,
            relationship: 'Grandmother',
          });
        expect(rBadPhone.status).toBe(400);
        expect(rBadPhone.body.code).toBe('INVALID_PHONE');
      }

      // Valid leap-day ISO with timezone offset + valid international phone accepted (201)
      mockOwnedChild();
      (prisma.childAuthorizedPickup.create as jest.Mock).mockResolvedValueOnce({
        id: 'pk-leap-1',
        societyId: 'soc-a',
        childId: 'child-a1',
        name: 'Sunita Devi',
        phone: '+1 (415) 555-0199',
        relationship: 'Grandmother',
        idDocumentType: null,
        idDocumentLast4: null,
        idVerificationStatus: 'NOT_COLLECTED',
        status: 'ACTIVE',
        validUntil: new Date('2028-02-29T12:00:00+05:30'),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const rValid = await request(app)
        .post('/api/children/child-a1/pickups')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({
          name: 'Sunita Devi',
          phone: '+1 (415) 555-0199',
          relationship: 'Grandmother',
          validUntil: '2028-02-29T12:00:00+05:30',
        });
      expect(rValid.status).toBe(201);
      expect(rValid.body.phone).toBe('+1 (415) 555-0199');
    });

    it('F-P43-R1, F-P43-R2, F-P43-R3: unconditionally blocks all PATCH mutations on REVOKED pickups (0 DB writes), enforces concurrent revoke guard in updateMany, and rejects malformed phone punctuation', async () => {
      const futureIso = new Date(Date.now() + 86400_000).toISOString();
      const pastDate = new Date(Date.now() - 3600_000);
      const revokedRow = {
        id: 'pk-rev-immutable',
        societyId: 'soc-a',
        childId: 'child-a1',
        name: 'Original Escort',
        phone: '+919811112222',
        relationship: 'Driver',
        status: 'REVOKED',
        archivedAt: null,
        validUntil: null,
      };

      const updateCallsBefore = (prisma.childAuthorizedPickup.updateMany as jest.Mock).mock.calls.length;

      // 1–6: Every PATCH combination against a REVOKED pickup MUST return 422 REVOKED_PICKUP_CANNOT_BE_REACTIVATED with 0 DB updates
      const blockedPayloads = [
        { status: 'EXPIRED' }, // Blocks 2-step REVOKED -> EXPIRED -> ACTIVE bypass!
        { status: 'ACTIVE', validUntil: futureIso },
        { status: 'REVOKED', name: 'Tampered Name' }, // Blocks audit mutation of revoked row!
        { name: 'Contact Only Edit', phone: '+919876543210' },
        {}, // Empty PATCH
        { validUntil: futureIso }, // Expiry-only PATCH
      ];

      for (const payload of blockedPayloads) {
        mockOwnedChild();
        (prisma.childAuthorizedPickup.findFirst as jest.Mock).mockResolvedValueOnce(revokedRow);
        const res = await request(app)
          .patch('/api/children/child-a1/pickups/pk-rev-immutable')
          .set('Authorization', `Bearer ${resA1Token}`)
          .send(payload);
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('REVOKED_PICKUP_CANNOT_BE_REACTIVATED');
      }

      // Persisted row MUST remain completely untouched (0 updateMany calls)
      expect((prisma.childAuthorizedPickup.updateMany as jest.Mock).mock.calls.length).toBe(updateCallsBefore);

      // Expired pickup + empty-string validUntil: '' -> 422 EXPIRED_PICKUP_REQUIRES_FUTURE_VALID_UNTIL
      mockOwnedChild();
      (prisma.childAuthorizedPickup.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'pk-exp-empty-str',
        societyId: 'soc-a',
        childId: 'child-a1',
        status: 'EXPIRED',
        archivedAt: null,
        validUntil: pastDate,
      });
      const rEmptyStr = await request(app)
        .patch('/api/children/child-a1/pickups/pk-exp-empty-str')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ validUntil: '' });
      expect(rEmptyStr.status).toBe(422);
      expect(rEmptyStr.body.code).toBe('EXPIRED_PICKUP_REQUIRES_FUTURE_VALID_UNTIL');

      // F-P43-R3: Concurrent revocation TOCTOU between initial read (ACTIVE) and updateMany (0 rows matched)
      mockOwnedChild();
      (prisma.childAuthorizedPickup.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'pk-race-1',
        societyId: 'soc-a',
        childId: 'child-a1',
        status: 'ACTIVE',
        archivedAt: null,
        validUntil: null,
      });
      (prisma.childAuthorizedPickup.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });
      const rRace = await request(app)
        .patch('/api/children/child-a1/pickups/pk-race-1')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ name: 'Stale Concurrent Edit' });
      expect(rRace.status).toBe(422);
      expect(rRace.body.code).toBe('REVOKED_PICKUP_CANNOT_BE_REACTIVATED');
      const lastUpdateArgs = (prisma.childAuthorizedPickup.updateMany as jest.Mock).mock.calls.at(-1)[0];
      expect(lastUpdateArgs.where).toMatchObject({
        id: 'pk-race-1',
        societyId: 'soc-a',
        childId: 'child-a1',
        archivedAt: null,
        status: { not: 'REVOKED' },
      });

      // F-P43-R2: Unbalanced/nested/empty phone parentheses and trailing separators rejected with 400 INVALID_PHONE
      for (const badPunctPhone of ['(1234567', '123)4567', '((123))4567', '()1234567', '1234567----']) {
        mockOwnedChild();
        const rBad = await request(app)
          .post('/api/children/child-a1/pickups')
          .set('Authorization', `Bearer ${resA1Token}`)
          .send({ name: 'Sunita Devi', phone: badPunctPhone, relationship: 'Grandmother' });
        expect(rBad.status).toBe(400);
        expect(rBad.body.code).toBe('INVALID_PHONE');
      }
    });
  });
});
