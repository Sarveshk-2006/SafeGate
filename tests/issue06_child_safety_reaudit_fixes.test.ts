import request from 'supertest';
import { generateAuthToken } from '../server/src/auth';
import { prisma } from '../server/src/prisma';
import {
  realtimeEngine,
  isClientAuthorizedForEvent,
  isValidAudiencePolicy,
} from '../server/src/realtimeEngine';
import app from '../server/src/index';

jest.mock('../server/src/prisma', () => {
  const mockPrisma: any = {
    user: { findFirst: jest.fn() },
    amenity: { findFirst: jest.fn(), findUnique: jest.fn() },
    emergencyIncident: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    entityRecord: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    outboxEvent: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
  return { prisma: mockPrisma };
});

describe('ISSUE-06 Phase B.2.2 Re-Audit Targeted Remediation (F-B22-01A/B/C & F-B22-02A/B/C)', () => {
  let vendorAToken: string;
  let fmAToken: string;
  let resA1Token: string;
  let resA2Token: string;
  let guardAToken: string;
  let secAToken: string;
  let socAdminAToken: string;
  let platformAdminToken: string;
  let noSocSecToken: string;

  const mockUsers: Record<string, any> = {
    'usr-vnd-a': { id: 'usr-vnd-a', name: 'Vendor A', email: 'va@t.local', role: 'vendor', societyId: 'soc-a', status: 'ACTIVE' },
    'usr-fm-a': { id: 'usr-fm-a', name: 'FM A', email: 'fma@t.local', role: 'facility_manager', societyId: 'soc-a', status: 'ACTIVE' },
    'usr-res-a1': { id: 'usr-res-a1', name: 'Resident A1', email: 'ra1@t.local', role: 'resident', societyId: 'soc-a', status: 'ACTIVE' },
    'usr-res-a2': { id: 'usr-res-a2', name: 'Resident A2', email: 'ra2@t.local', role: 'resident', societyId: 'soc-a', status: 'ACTIVE' },
    'usr-grd-a': { id: 'usr-grd-a', name: 'Guard A', email: 'ga@t.local', role: 'guard', societyId: 'soc-a', status: 'ACTIVE' },
    'usr-sec-a': { id: 'usr-sec-a', name: 'Secretary A', email: 'sa@t.local', role: 'secretary', societyId: 'soc-a', status: 'ACTIVE' },
    'usr-adm-a': { id: 'usr-adm-a', name: 'Admin A', email: 'aa@t.local', role: 'admin', societyId: 'soc-a', status: 'ACTIVE' },
    'usr-plat': { id: 'usr-plat', name: 'Platform Admin', email: 'plat@t.local', role: 'admin', societyId: null, status: 'ACTIVE' },
    'usr-nosoc-sec': { id: 'usr-nosoc-sec', name: 'Unassigned Sec', email: 'ns@t.local', role: 'secretary', societyId: null, status: 'ACTIVE' },
  };

  let outboxSpy: jest.SpyInstance;
  let broadcastSpy: jest.SpyInstance;

  beforeAll(() => {
    vendorAToken = generateAuthToken({ sub: 'usr-vnd-a', email: 'va@t.local', role: 'vendor', societyId: 'soc-a', name: 'Vendor A' });
    fmAToken = generateAuthToken({ sub: 'usr-fm-a', email: 'fma@t.local', role: 'facility_manager', societyId: 'soc-a', name: 'FM A' });
    resA1Token = generateAuthToken({ sub: 'usr-res-a1', email: 'ra1@t.local', role: 'resident', societyId: 'soc-a', name: 'Resident A1' });
    resA2Token = generateAuthToken({ sub: 'usr-res-a2', email: 'ra2@t.local', role: 'resident', societyId: 'soc-a', name: 'Resident A2' });
    guardAToken = generateAuthToken({ sub: 'usr-grd-a', email: 'ga@t.local', role: 'guard', societyId: 'soc-a', name: 'Guard A' });
    secAToken = generateAuthToken({ sub: 'usr-sec-a', email: 'sa@t.local', role: 'secretary', societyId: 'soc-a', name: 'Secretary A' });
    socAdminAToken = generateAuthToken({ sub: 'usr-adm-a', email: 'aa@t.local', role: 'admin', societyId: 'soc-a', name: 'Admin A' });
    platformAdminToken = generateAuthToken({ sub: 'usr-plat', email: 'plat@t.local', role: 'admin', societyId: 'soc-platform', name: 'Platform Admin' });
    noSocSecToken = generateAuthToken({ sub: 'usr-nosoc-sec', email: 'ns@t.local', role: 'secretary', societyId: '', name: 'Unassigned Sec' });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(prisma));
    outboxSpy = jest.spyOn(realtimeEngine, 'recordOutboxEvent').mockResolvedValue('evt_test_ok');
    broadcastSpy = jest.spyOn(realtimeEngine, 'broadcastToSociety').mockImplementation(() => {});

    (prisma.user.findFirst as jest.Mock).mockImplementation(({ where }: any) => {
      const id = where?.OR?.[0]?.id || where?.id;
      return Promise.resolve(mockUsers[id] || null);
    });
  });

  afterEach(() => {
    outboxSpy.mockRestore();
    broadcastSpy.mockRestore();
  });

  // =========================================================================
  // F-B22-01A: EntityRecord Generic Collection Alias Bypass Closure
  // =========================================================================
  describe('F-B22-01A: Block EntityRecord collection alias bypasses', () => {
    it('filters all Child Safety rows on GET /api/collections/entityRecord, /entityRecords, and /entity_records while preserving unrelated records', async () => {
      (prisma.entityRecord.findMany as jest.Mock).mockResolvedValue([
        { id: 'rec-ann-1', societyId: 'soc-a', collection: 'announcements', data: { title: 'Water' } },
        { id: 'rec-child-1', societyId: 'soc-a', collection: 'child_profiles', data: { fullName: 'Secret' } },
        { id: 'rec-child-2', societyId: 'soc-a', collection: 'Child-Gate-Passes', data: { passCode: 'CGP-1' } },
      ]);

      for (const alias of ['entityRecord', 'entityRecords', 'entity_records', 'ENTITY_RECORD']) {
        const res = await request(app)
          .get(`/api/collections/${alias}`)
          .set('Authorization', `Bearer ${vendorAToken}`);
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].id).toBe('rec-ann-1');
        expect(prisma.entityRecord.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              societyId: 'soc-a',
              collection: { notIn: expect.arrayContaining(['child_profiles', 'child_gate_passes']) },
            }),
          })
        );
      }
    });

    it('blocks GET /api/collections/entityRecord/:id on same-society Child Safety rows (403), hides cross-society rows (404), and allows non-child rows (200)', async () => {
      // 1. Same-society child_profiles row -> 403
      (prisma.entityRecord.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'legacy-child-1',
        societyId: 'soc-a',
        collection: 'child_profiles',
        data: { fullName: 'Secret' },
      });
      const sameSocChild = await request(app)
        .get('/api/collections/entityRecord/legacy-child-1')
        .set('Authorization', `Bearer ${vendorAToken}`);
      expect(sameSocChild.status).toBe(403);
      expect(sameSocChild.body.code).toBe('CHILD_SAFETY_COLLECTION_FORBIDDEN');

      // 2. Cross-society record -> findFirst(where: { id, societyId: 'soc-a' }) returns null -> 404 (no existence leak!)
      (prisma.entityRecord.findFirst as jest.Mock).mockResolvedValueOnce(null);
      const crossSoc = await request(app)
        .get('/api/collections/entityRecord/soc-b-child-1')
        .set('Authorization', `Bearer ${vendorAToken}`);
      expect(crossSoc.status).toBe(404);
      expect(prisma.entityRecord.findFirst).toHaveBeenLastCalledWith({
        where: { id: 'soc-b-child-1', societyId: 'soc-a' },
      });

      // 3. Unrelated announcement row -> 200
      (prisma.entityRecord.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'rec-ann-1',
        societyId: 'soc-a',
        collection: 'announcements',
        data: { title: 'Notice' },
      });
      const validRec = await request(app)
        .get('/api/collections/entityRecord/rec-ann-1')
        .set('Authorization', `Bearer ${vendorAToken}`);
      expect(validRec.status).toBe(200);
      expect(validRec.body.id).toBe('rec-ann-1');
    });

    it('blocks generic writes (POST/PUT/PATCH/DELETE) targeting entityRecord or emergencyIncident aliases (403)', async () => {
      for (const alias of ['entityRecord', 'entityRecords', 'emergencyIncident', 'auditLog']) {
        const p = await request(app)
          .post(`/api/collections/${alias}`)
          .set('Authorization', `Bearer ${socAdminAToken}`)
          .send({ foo: 'bar' });
        expect(p.status).toBe(403);
        expect(p.body.code).toBe('RESTRICTED_COLLECTION_WRITE');

        const u = await request(app)
          .put(`/api/collections/${alias}/id-1`)
          .set('Authorization', `Bearer ${socAdminAToken}`)
          .send({ foo: 'bar' });
        expect(u.status).toBe(403);

        const d = await request(app)
          .delete(`/api/collections/${alias}/id-1`)
          .set('Authorization', `Bearer ${socAdminAToken}`);
        expect(d.status).toBe(403);
      }
    });
  });

  // =========================================================================
  // F-B22-01B: Native Prisma Model Role Policies on Generic Routes
  // =========================================================================
  describe('F-B22-01B: Enforce native Prisma model role policies on generic routes', () => {
    it('blocks vendor and facility_manager from GET /api/collections/emergencyIncident(s) and /:id (403)', async () => {
      for (const token of [vendorAToken, fmAToken]) {
        const listRes = await request(app)
          .get('/api/collections/emergencyIncident')
          .set('Authorization', `Bearer ${token}`);
        expect(listRes.status).toBe(403);
        expect(listRes.body.code).toBe('INSUFFICIENT_PERMISSIONS');

        const pluralRes = await request(app)
          .get('/api/collections/emergencyIncidents')
          .set('Authorization', `Bearer ${token}`);
        expect(pluralRes.status).toBe(403);

        const detailRes = await request(app)
          .get('/api/collections/emergencyIncident/inc-1')
          .set('Authorization', `Bearer ${token}`);
        expect(detailRes.status).toBe(403);

        const directRes = await request(app)
          .get('/api/emergency-incidents')
          .set('Authorization', `Bearer ${token}`);
        expect(directRes.status).toBe(403);
      }
      expect(prisma.emergencyIncident.findMany).not.toHaveBeenCalled();
    });

    it('excludes CHILD_SAFETY incidents when a resident queries emergencyIncident generically, while allowing guard/admin within their society', async () => {
      (prisma.emergencyIncident.findMany as jest.Mock).mockResolvedValue([]);

      const resList = await request(app)
        .get('/api/collections/emergencyIncident')
        .set('Authorization', `Bearer ${resA1Token}`);
      expect(resList.status).toBe(200);
      expect(prisma.emergencyIncident.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { societyId: 'soc-a', incidentType: { not: 'CHILD_SAFETY' } },
        })
      );

      const resQuery = await request(app)
        .post('/api/emergencyIncident/query')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({});
      expect(resQuery.status).toBe(200);
      expect(prisma.emergencyIncident.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { societyId: 'soc-a', incidentType: { not: 'CHILD_SAFETY' } },
        })
      );

      const guardList = await request(app)
        .get('/api/collections/emergencyIncident')
        .set('Authorization', `Bearer ${guardAToken}`);
      expect(guardList.status).toBe(200);
      expect(prisma.emergencyIncident.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { societyId: 'soc-a' },
        })
      );
    });

    it('blocks vendor/resident from GET /api/collections/auditLog (403) while allowing secretary', async () => {
      const vndAudit = await request(app)
        .get('/api/collections/auditLog')
        .set('Authorization', `Bearer ${vendorAToken}`);
      expect(vndAudit.status).toBe(403);

      (prisma.auditLog.findMany as jest.Mock).mockResolvedValueOnce([]);
      const secAudit = await request(app)
        .get('/api/collections/auditLog')
        .set('Authorization', `Bearer ${secAToken}`);
      expect(secAudit.status).toBe(200);
    });

    it('hides cross-society protected records on PUT/DELETE /api/collections/announcements/:id (404, zero oracle)', async () => {
      (prisma.entityRecord.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'soc-b-child-1',
        societyId: 'soc-b',
        collection: 'child_profiles',
        data: {},
      });
      const putCross = await request(app)
        .put('/api/collections/announcements/soc-b-child-1')
        .set('Authorization', `Bearer ${vendorAToken}`)
        .send({ title: 'Probe' });
      expect(putCross.status).toBe(404);

      (prisma.entityRecord.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'soc-b-child-1',
        societyId: 'soc-b',
        collection: 'child_profiles',
        data: {},
      });
      const delCross = await request(app)
        .delete('/api/collections/announcements/soc-b-child-1')
        .set('Authorization', `Bearer ${vendorAToken}`);
      expect(delCross.status).toBe(404);
    });
  });

  // =========================================================================
  // F-B22-01C: Direct EntityRecord ID Lookups (Housekeeping & Amenities)
  // =========================================================================
  describe('F-B22-01C: Direct EntityRecord ID lookups strictly collection- and society-scoped', () => {
    it('PATCH /api/housekeeping/tasks/:id scopes lookup strictly to housekeeping_tasks + societyId and preserves valid updates', async () => {
      (prisma.entityRecord.findFirst as jest.Mock).mockResolvedValueOnce(null);
      const miss = await request(app)
        .patch('/api/housekeeping/tasks/legacy-child-1')
        .set('Authorization', `Bearer ${fmAToken}`)
        .send({ status: 'DONE' });
      expect(miss.status).toBe(404);
      expect(prisma.entityRecord.findFirst).toHaveBeenCalledWith({
        where: { id: 'legacy-child-1', collection: 'housekeeping_tasks', societyId: 'soc-a' },
      });
      expect(prisma.entityRecord.updateMany).not.toHaveBeenCalled();

      // Legitimate housekeeping task succeeds
      (prisma.entityRecord.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'hk-1',
        societyId: 'soc-a',
        collection: 'housekeeping_tasks',
        data: { title: 'Clean Lobby', status: 'PENDING' },
      });
      (prisma.entityRecord.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });
      const ok = await request(app)
        .patch('/api/housekeeping/tasks/hk-1')
        .set('Authorization', `Bearer ${fmAToken}`)
        .send({ status: 'COMPLETED' });
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe('COMPLETED');
    });

    it('POST /api/amenities/bookings/:id/cancel scopes to amenityBookings + societyId + resident ownership', async () => {
      // 1. Non-booking ID (e.g., child_profiles) -> 404
      (prisma.entityRecord.findFirst as jest.Mock).mockResolvedValueOnce(null);
      const childAttempt = await request(app)
        .post('/api/amenities/bookings/legacy-child-1/cancel')
        .set('Authorization', `Bearer ${resA1Token}`);
      expect(childAttempt.status).toBe(404);
      expect(prisma.entityRecord.findFirst).toHaveBeenCalledWith({
        where: { id: 'legacy-child-1', collection: 'amenityBookings', societyId: 'soc-a' },
      });

      // 2. Another resident's booking -> 403
      (prisma.entityRecord.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'bk-a1',
        societyId: 'soc-a',
        collection: 'amenityBookings',
        data: { residentId: 'usr-res-a1', status: 'CONFIRMED' },
      });
      const otherResident = await request(app)
        .post('/api/amenities/bookings/bk-a1/cancel')
        .set('Authorization', `Bearer ${resA2Token}`);
      expect(otherResident.status).toBe(403);
      expect(otherResident.body.code).toBe('UNAUTHORIZED_BOOKING_ACCESS');

      // 3. Own booking -> 200
      (prisma.entityRecord.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'bk-a1',
        societyId: 'soc-a',
        collection: 'amenityBookings',
        data: { residentId: 'usr-res-a1', status: 'CONFIRMED', amenityId: 'am-1', bookingDate: '2026-11-20' },
      });
      (prisma.entityRecord.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });
      const ownCancel = await request(app)
        .post('/api/amenities/bookings/bk-a1/cancel')
        .set('Authorization', `Bearer ${resA1Token}`);
      expect(ownCancel.status).toBe(200);
      expect(ownCancel.body.status).toBe('CANCELLED');
    });

    it('POST /api/housekeeping/garbage-logs/confirm blocks vendor (403), scopes strictly to garbage_pickup_logs + societyId, and allows valid confirm', async () => {
      const vnd = await request(app)
        .post('/api/housekeeping/garbage-logs/confirm')
        .set('Authorization', `Bearer ${vendorAToken}`)
        .send({ id: 'legacy-child-1' });
      expect(vnd.status).toBe(403);

      (prisma.entityRecord.findFirst as jest.Mock).mockResolvedValueOnce(null);
      const childAttempt = await request(app)
        .post('/api/housekeeping/garbage-logs/confirm')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ id: 'legacy-child-1' });
      expect(childAttempt.status).toBe(404);
      expect(prisma.entityRecord.findFirst).toHaveBeenCalledWith({
        where: { id: 'legacy-child-1', collection: 'garbage_pickup_logs', societyId: 'soc-a' },
      });

      (prisma.entityRecord.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'garb-1',
        societyId: 'soc-a',
        collection: 'garbage_pickup_logs',
        data: { status: 'PENDING' },
      });
      (prisma.entityRecord.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });
      const ok = await request(app)
        .post('/api/housekeeping/garbage-logs/confirm')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ id: 'garb-1' });
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe('COLLECTED');
    });
  });

  // =========================================================================
  // F-B22-02A: Secure POST /api/realtime/broadcast
  // =========================================================================
  describe('F-B22-02A: Secure POST /api/realtime/broadcast', () => {
    it('blocks vendor and resident from publishing generic broadcasts (403)', async () => {
      const vnd = await request(app)
        .post('/api/realtime/broadcast')
        .set('Authorization', `Bearer ${vendorAToken}`)
        .send({ eventType: 'GENERAL', payload: { msg: 'hi' } });
      expect(vnd.status).toBe(403);
      expect(vnd.body.code).toBe('INSUFFICIENT_PERMISSIONS');

      const res = await request(app)
        .post('/api/realtime/broadcast')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ eventType: 'GENERAL', payload: { msg: 'hi' } });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('blocks cross-society injection, missing society context, invalid eventType, forged _audience, and protected Child Safety/Emergency event types', async () => {
      // Cross-society injection by society-bound admin
      const crossSoc = await request(app)
        .post('/api/realtime/broadcast')
        .set('Authorization', `Bearer ${socAdminAToken}`)
        .send({ societyId: 'soc-b', eventType: 'GENERAL', payload: { msg: 'spoof' } });
      expect(crossSoc.status).toBe(403);
      expect(crossSoc.body.code).toBe('TENANT_ISOLATION_VIOLATION');

      // Missing society context (no soc-gvs fallback!)
      const noSoc = await request(app)
        .post('/api/realtime/broadcast')
        .set('Authorization', `Bearer ${noSocSecToken}`)
        .send({ eventType: 'GENERAL', payload: { msg: 'hi' } });
      expect(noSoc.status).toBe(403);
      expect(noSoc.body.code).toBe('TENANT_CONTEXT_REQUIRED');

      // Missing / invalid event type
      const badType = await request(app)
        .post('/api/realtime/broadcast')
        .set('Authorization', `Bearer ${socAdminAToken}`)
        .send({ eventType: 'not valid!', payload: {} });
      expect(badType.status).toBe(400);
      expect(badType.body.code).toBe('INVALID_EVENT_TYPE');

      // Protected Child Safety & EmergencyIncident event injection blocked EVEN for admin
      for (const forbiddenType of ['CHILD_SAFETY_SOS_TRIGGERED', 'EMERGENCY_INCIDENT_CREATED', 'SOS_ALERT', 'GATE_PASS_VERIFIED']) {
        const prot = await request(app)
          .post('/api/realtime/broadcast')
          .set('Authorization', `Bearer ${socAdminAToken}`)
          .send({ eventType: forbiddenType, payload: { alertId: 'forged' } });
        expect(prot.status).toBe(403);
        expect(prot.body.code).toBe('PROTECTED_EVENT_TYPE_FORBIDDEN');
      }

      // Forged _audience / societyId in payload rejected (400)
      const forgedAud = await request(app)
        .post('/api/realtime/broadcast')
        .set('Authorization', `Bearer ${socAdminAToken}`)
        .send({ eventType: 'ANNOUNCEMENT_POSTED', payload: { title: 'x', _audience: { allowedRoles: ['vendor'] } } });
      expect(forgedAud.status).toBe(400);
      expect(forgedAud.body.code).toBe('FORBIDDEN_EVENT_METADATA');

      // Facility manager attempting admin-only announcement event -> 403 EVENT_TYPE_NOT_AUTHORIZED
      const fmWrongEvent = await request(app)
        .post('/api/realtime/broadcast')
        .set('Authorization', `Bearer ${fmAToken}`)
        .send({ eventType: 'ANNOUNCEMENT_POSTED', payload: { title: 'nope' } });
      expect(fmWrongEvent.status).toBe(403);
      expect(fmWrongEvent.body.code).toBe('EVENT_TYPE_NOT_AUTHORIZED');

      expect(outboxSpy).not.toHaveBeenCalled();
    });

    it('permits authorized facility_manager, society admin, and verified platform admin (with concrete societyId) using server-derived identity', async () => {
      const fmOk = await request(app)
        .post('/api/realtime/broadcast')
        .set('Authorization', `Bearer ${fmAToken}`)
        .send({ eventType: 'MAINTENANCE_UPDATE', payload: { lift: 'A1' } });
      expect(fmOk.status).toBe(200);
      expect(outboxSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          societyId: 'soc-a',
          eventType: 'MAINTENANCE_UPDATE',
          actorId: 'usr-fm-a',
          payload: expect.objectContaining({ lift: 'A1', senderRole: 'facility_manager', senderName: 'FM A' }),
        })
      );

      // Platform admin must provide explicit concrete societyId
      const platMissing = await request(app)
        .post('/api/realtime/broadcast')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send({ eventType: 'ANNOUNCEMENT_GLOBAL', payload: { title: 'Maintenance' } });
      expect(platMissing.status).toBe(400);
      expect(platMissing.body.code).toBe('TARGET_SOCIETY_REQUIRED');

      const platOk = await request(app)
        .post('/api/realtime/broadcast')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send({ societyId: 'soc-b', eventType: 'ANNOUNCEMENT_GLOBAL', payload: { title: 'Maintenance' } });
      expect(platOk.status).toBe(200);
      expect(platOk.body.societyId).toBe('soc-b');
    });
  });

  // =========================================================================
  // F-B22-02B & F-B22-02C: Fail-Closed SSE Authorization & Scoped Replay Cursor
  // =========================================================================
  describe('F-B22-02B & F-B22-02C: Fail-closed SSE audience & tenant-scoped replay cursor', () => {
    it('fails closed on EMERGENCY_INCIDENT_CREATED without _audience, with _audience: {}, unknown roles, and malformed society/context', () => {
      // 1. EMERGENCY_INCIDENT_CREATED without _audience -> false for EVERY role (including vendor, delivery, guard, admin)
      for (const role of ['vendor', 'delivery', 'facility_manager', 'resident', 'guard', 'admin']) {
        expect(
          isClientAuthorizedForEvent(
            { societyId: 'soc-a', userId: 'u1', role },
            'soc-a',
            'EMERGENCY_INCIDENT_CREATED',
            { id: 'inc-1' }
          )
        ).toBe(false);
      }

      // 2. EMERGENCY_INCIDENT_CREATED with malformed empty _audience: {} -> false
      expect(isValidAudiencePolicy({})).toBe(false);
      expect(isValidAudiencePolicy({ allowedRoles: ['unknown_hacker_role'] })).toBe(false);
      expect(isValidAudiencePolicy({ allowedRoles: ['guard'], extraField: true })).toBe(false);

      expect(
        isClientAuthorizedForEvent(
          { societyId: 'soc-a', userId: 'u-del', role: 'delivery' },
          'soc-a',
          'EMERGENCY_INCIDENT_CREATED',
          { id: 'inc-1', _audience: {} }
        )
      ).toBe(false);

      // 3. Unknown audience role fails closed
      expect(
        isClientAuthorizedForEvent(
          { societyId: 'soc-a', userId: 'u-adm', role: 'admin' },
          'soc-a',
          'EMERGENCY_INCIDENT_CREATED',
          { id: 'inc-1', _audience: { allowedRoles: ['admin', 'forged_role'] } }
        )
      ).toBe(false);

      // 4. Missing / malformed society identifiers fail closed
      expect(
        isClientAuthorizedForEvent(
          { societyId: '', userId: 'u-adm', role: 'admin' },
          'soc-a',
          'ANNOUNCEMENT_CREATED',
          { id: 'a1' }
        )
      ).toBe(false);
      expect(
        isClientAuthorizedForEvent(
          { societyId: 'soc-a', userId: 'u-adm', role: 'admin' },
          '',
          'ANNOUNCEMENT_CREATED',
          { id: 'a1' }
        )
      ).toBe(false);

      // 5. Valid EMERGENCY_INCIDENT_CREATED with proper audience authorizes guard/admin/owner and denies vendor/delivery/non-owner resident
      const validAudience = { allowedRoles: ['guard', 'secretary', 'committee', 'admin'], targetUserIds: ['usr-res-a1'] };
      expect(isClientAuthorizedForEvent({ societyId: 'soc-a', userId: 'usr-grd-a', role: 'guard' }, 'soc-a', 'EMERGENCY_INCIDENT_CREATED', { id: 'inc-1' }, validAudience)).toBe(true);
      expect(isClientAuthorizedForEvent({ societyId: 'soc-a', userId: 'usr-res-a1', role: 'resident' }, 'soc-a', 'EMERGENCY_INCIDENT_CREATED', { id: 'inc-1' }, validAudience)).toBe(true);
      expect(isClientAuthorizedForEvent({ societyId: 'soc-a', userId: 'usr-res-a2', role: 'resident' }, 'soc-a', 'EMERGENCY_INCIDENT_CREATED', { id: 'inc-1' }, validAudience)).toBe(false);
      expect(isClientAuthorizedForEvent({ societyId: 'soc-a', userId: 'usr-vnd-a', role: 'vendor' }, 'soc-a', 'EMERGENCY_INCIDENT_CREATED', { id: 'inc-1' }, validAudience)).toBe(false);
      expect(isClientAuthorizedForEvent({ societyId: 'soc-a', userId: 'usr-del-a', role: 'delivery' }, 'soc-a', 'EMERGENCY_INCIDENT_CREATED', { id: 'inc-1' }, validAudience)).toBe(false);

      // 6. Legitimate non-sensitive public society event still allowed within same society
      expect(isClientAuthorizedForEvent({ societyId: 'soc-a', userId: 'usr-vnd-a', role: 'vendor' }, 'soc-a', 'ANNOUNCEMENT_CREATED', { id: 'a1' })).toBe(true);
    });

    it('F-B22-02C: scopes Last-Event-ID replay cursor lookup strictly to client societyId and filters sensitive replayed events', async () => {
      // Cross-society cursor returns null from findFirst({ where: { eventId, societyId: 'soc-a' } })
      (prisma.outboxEvent.findFirst as jest.Mock).mockResolvedValueOnce(null);
      (prisma.outboxEvent.findMany as jest.Mock).mockResolvedValueOnce([
        {
          eventId: 'evt-emg-no-aud',
          societyId: 'soc-a',
          eventType: 'EMERGENCY_INCIDENT_CREATED',
          payload: { id: 'inc-no-aud' }, // missing _audience -> MUST fail closed during replay!
          createdAt: new Date(),
        },
        {
          eventId: 'evt-ann-pub',
          societyId: 'soc-a',
          eventType: 'ANNOUNCEMENT_CREATED',
          payload: { title: 'Public Notice' },
          createdAt: new Date(),
        },
      ]);

      const chunks: string[] = [];
      const mockRes: any = { write: jest.fn((c: string) => chunks.push(c)), flush: jest.fn() };

      await (realtimeEngine as any).replayEventsSince(
        {
          id: 'c-res',
          res: mockRes,
          societyId: 'soc-a',
          userId: 'usr-res-a2',
          role: 'resident',
          connectedAt: new Date(),
        },
        'evt-belonging-to-soc-b'
      );

      // Cursor lookup MUST include societyId: 'soc-a'
      expect(prisma.outboxEvent.findFirst).toHaveBeenCalledWith({
        where: { eventId: 'evt-belonging-to-soc-b', societyId: 'soc-a' },
      });
      // Unprotected EMERGENCY_INCIDENT_CREATED without _audience was blocked; public announcement delivered
      const wire = chunks.join('');
      expect(wire).not.toContain('evt-emg-no-aud');
      expect(wire).toContain('evt-ann-pub');
    });
  });
});

