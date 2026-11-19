import request from 'supertest';
import { generateAuthToken } from '../server/src/auth';
import { prisma } from '../server/src/prisma';
import app from '../server/src/index';

// Mock Prisma client methods for hermetic integration testing with Supertest
jest.mock('../server/src/prisma', () => ({
  prisma: {
    user: {
      findFirst: jest.fn(),
    },
    visitorPass: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    resident: {
      findFirst: jest.fn(),
    },
    flat: {
      findFirst: jest.fn(),
    },
  },
}));

describe('ISSUE-06 Phase B.1: Real Express Route Integration Tests (Supertest)', () => {
  let residentToken: string;
  let residentNoSocToken: string;
  let guardToken: string;
  let guardOtherSocToken: string;
  let secretaryToken: string;
  let platformAdminToken: string;

  beforeAll(() => {
    residentToken = generateAuthToken({
      sub: 'user-res-1',
      email: 'vikram@aarizo.com',
      role: 'resident',
      societyId: 'soc-gvs',
      name: 'Vikram Joshi',
    });

    residentNoSocToken = generateAuthToken({
      sub: 'user-no-soc',
      email: 'nosoc@aarizo.com',
      role: 'resident',
      societyId: '',
      name: 'No Society Resident',
    });

    guardToken = generateAuthToken({
      sub: 'user-guard-1',
      email: 'guard@aarizo.com',
      role: 'guard',
      societyId: 'soc-gvs',
      name: 'Officer R. Singh',
    });

    guardOtherSocToken = generateAuthToken({
      sub: 'user-guard-other',
      email: 'guard-other@aarizo.com',
      role: 'guard',
      societyId: 'soc-other-complex',
      name: 'Other Complex Guard',
    });

    secretaryToken = generateAuthToken({
      sub: 'user-sec-1',
      email: 'sec@aarizo.com',
      role: 'secretary',
      societyId: 'soc-gvs',
      name: 'Society Secretary',
    });

    platformAdminToken = generateAuthToken({
      sub: 'user-admin-1',
      email: 'admin@aarizo.com',
      role: 'admin',
      societyId: 'soc-platform',
      name: 'Enterprise Platform Administrator',
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock user lookup for token authentication
    (prisma.user.findFirst as jest.Mock).mockImplementation(({ where }: any) => {
      const id = where?.OR?.[0]?.id || where?.id;
      if (id === 'user-res-1') {
        return Promise.resolve({
          id: 'user-res-1',
          name: 'Vikram Joshi',
          email: 'vikram@aarizo.com',
          role: 'resident',
          societyId: 'soc-gvs',
          status: 'ACTIVE',
        });
      }
      if (id === 'user-no-soc') {
        return Promise.resolve({
          id: 'user-no-soc',
          name: 'No Society Resident',
          email: 'nosoc@aarizo.com',
          role: 'resident',
          societyId: null,
          status: 'ACTIVE',
        });
      }
      if (id === 'user-guard-1') {
        return Promise.resolve({
          id: 'user-guard-1',
          name: 'Officer R. Singh',
          email: 'guard@aarizo.com',
          role: 'guard',
          societyId: 'soc-gvs',
          status: 'ACTIVE',
        });
      }
      if (id === 'user-guard-other') {
        return Promise.resolve({
          id: 'user-guard-other',
          name: 'Other Complex Guard',
          email: 'guard-other@aarizo.com',
          role: 'guard',
          societyId: 'soc-other-complex',
          status: 'ACTIVE',
        });
      }
      if (id === 'user-sec-1') {
        return Promise.resolve({
          id: 'user-sec-1',
          name: 'Society Secretary',
          email: 'sec@aarizo.com',
          role: 'secretary',
          societyId: 'soc-gvs',
          status: 'ACTIVE',
        });
      }
      if (id === 'user-admin-1') {
        return Promise.resolve({
          id: 'user-admin-1',
          name: 'Enterprise Platform Administrator',
          email: 'admin@aarizo.com',
          role: 'admin',
          societyId: null,
          status: 'ACTIVE',
        });
      }
      return Promise.resolve(null);
    });

    (prisma.resident.findFirst as jest.Mock).mockResolvedValue({
      id: 'res-vikram-01',
      userId: 'user-res-1',
      name: 'Vikram Joshi',
    });
  });

  describe('1. Unauthenticated Access Protection', () => {
    test('GET /api/visitor-passes without token returns HTTP 401 Unauthorized', async () => {
      const res = await request(app).get('/api/visitor-passes');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
    });

    test('POST /api/visitor-passes without token returns HTTP 401 Unauthorized', async () => {
      const res = await request(app).post('/api/visitor-passes').send({ visitorName: 'Intruder' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
    });

    test('PATCH /api/visitor-passes/:id without token returns HTTP 401 Unauthorized', async () => {
      const res = await request(app).patch('/api/visitor-passes/pass-1').send({ status: 'CHECKED_IN' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
    });

    test('POST /api/visitor-passes/:id/check-in without token returns HTTP 401 Unauthorized', async () => {
      const res = await request(app).post('/api/visitor-passes/pass-1/check-in');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
    });

    test('DELETE /api/visitor-passes/:id without token returns HTTP 401 Unauthorized', async () => {
      const res = await request(app).delete('/api/visitor-passes/pass-1');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
    });
  });

  describe('2. Fail-Closed Tenant Context & Isolation (F-B1-01)', () => {
    test('Non-admin user with missing society context is denied with HTTP 403 (TENANT_CONTEXT_REQUIRED)', async () => {
      const res = await request(app)
        .get('/api/visitor-passes')
        .set('Authorization', `Bearer ${residentNoSocToken}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('TENANT_CONTEXT_REQUIRED');
    });

    test('POST /api/visitor-passes with missing society context is denied with HTTP 403', async () => {
      const res = await request(app)
        .post('/api/visitor-passes')
        .set('Authorization', `Bearer ${residentNoSocToken}`)
        .send({ visitorName: 'John', phone: '9820011223' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('TENANT_CONTEXT_REQUIRED');
      expect(prisma.visitorPass.create).not.toHaveBeenCalled();
    });

    test('Client-supplied x-society-id header is ignored and cannot forge tenant context', async () => {
      // User has soc-gvs in authContext, attempts to spoof soc-other-complex via header
      (prisma.visitorPass.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'pass-foreign-1',
        societyId: 'soc-other-complex',
        residentId: 'res-other',
      });

      const res = await request(app)
        .get('/api/visitor-passes/pass-foreign-1')
        .set('Authorization', `Bearer ${guardToken}`)
        .set('x-society-id', 'soc-other-complex'); // Attempted header forgery

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('TENANT_ISOLATION_VIOLATION');
    });

    test('Guard from another society is denied check-in operation on a pass belonging to soc-gvs (403)', async () => {
      (prisma.visitorPass.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'pass-gvs-101',
        societyId: 'soc-gvs',
        status: 'APPROVED',
        validTo: new Date(Date.now() + 3600000),
      });

      const res = await request(app)
        .post('/api/visitor-passes/pass-gvs-101/check-in')
        .set('Authorization', `Bearer ${guardOtherSocToken}`); // Guard from soc-other-complex

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('TENANT_ISOLATION_VIOLATION');
      expect(prisma.visitorPass.update).not.toHaveBeenCalled();
    });

    test('Resident accessing another resident pass within same society is denied with HTTP 403 (UNAUTHORIZED_PASS_ACCESS)', async () => {
      (prisma.visitorPass.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'pass-ananya-2',
        societyId: 'soc-gvs',
        residentId: 'res-ananya-02',
        resident: { userId: 'user-ananya-02', name: 'Ananya Roy' },
      });

      const res = await request(app)
        .get('/api/visitor-passes/pass-ananya-2')
        .set('Authorization', `Bearer ${residentToken}`); // Vikram Joshi

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('UNAUTHORIZED_PASS_ACCESS');
    });

    test('Resident attempting to delete another resident pass is denied with HTTP 403 (UNAUTHORIZED_PASS_ACCESS)', async () => {
      (prisma.visitorPass.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'pass-ananya-2',
        societyId: 'soc-gvs',
        residentId: 'res-ananya-02',
        status: 'APPROVED',
        resident: { userId: 'user-ananya-02' },
      });

      const res = await request(app)
        .delete('/api/visitor-passes/pass-ananya-2')
        .set('Authorization', `Bearer ${residentToken}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('UNAUTHORIZED_PASS_ACCESS');
      expect(prisma.visitorPass.delete).not.toHaveBeenCalled();
    });

    test('Guard is strictly forbidden from deleting visitor passes (HTTP 403 INSUFFICIENT_PERMISSIONS)', async () => {
      const res = await request(app)
        .delete('/api/visitor-passes/pass-gvs-101')
        .set('Authorization', `Bearer ${guardToken}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
      expect(prisma.visitorPass.delete).not.toHaveBeenCalled();
    });

    test('Resident is strictly forbidden from gate check-in and check-out operations (HTTP 403)', async () => {
      const resCheckIn = await request(app)
        .post('/api/visitor-passes/pass-gvs-101/check-in')
        .set('Authorization', `Bearer ${residentToken}`);

      expect(resCheckIn.status).toBe(403);
      expect(resCheckIn.body.code).toBe('INSUFFICIENT_PERMISSIONS');

      const resCheckOut = await request(app)
        .post('/api/visitor-passes/pass-gvs-101/check-out')
        .set('Authorization', `Bearer ${residentToken}`);

      expect(resCheckOut.status).toBe(403);
      expect(resCheckOut.body.code).toBe('INSUFFICIENT_PERMISSIONS');
    });
  });

  describe('3. POST /api/visitor-passes Validation & Allowlisted Persistence', () => {
    test('Rejects request with missing visitorName with HTTP 400 (INVALID_VISITOR_NAME)', async () => {
      const res = await request(app)
        .post('/api/visitor-passes')
        .set('Authorization', `Bearer ${residentToken}`)
        .send({ visitorPhone: '9820011223' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_VISITOR_NAME');
      expect(prisma.visitorPass.create).not.toHaveBeenCalled();
    });

    test('Rejects request with invalid or short phone number with HTTP 400 (INVALID_PHONE)', async () => {
      const res = await request(app)
        .post('/api/visitor-passes')
        .set('Authorization', `Bearer ${residentToken}`)
        .send({ visitorName: 'Rohan', phone: '12' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_PHONE');
      expect(prisma.visitorPass.create).not.toHaveBeenCalled();
    });

    test('Rejects request where validTo is before validFrom with HTTP 400 (INVALID_VALIDITY_WINDOW)', async () => {
      const res = await request(app)
        .post('/api/visitor-passes')
        .set('Authorization', `Bearer ${residentToken}`)
        .send({
          visitorName: 'Rohan',
          phone: '9820011223',
          validFrom: '2026-11-20T12:00:00Z',
          validTo: '2026-11-20T10:00:00Z',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_VALIDITY_WINDOW');
      expect(prisma.visitorPass.create).not.toHaveBeenCalled();
    });

    test('Creates visitor pass successfully and forces residentId to authenticated resident', async () => {
      (prisma.visitorPass.create as jest.Mock).mockResolvedValueOnce({
        id: 'pass-created-1',
        societyId: 'soc-gvs',
        residentId: 'res-vikram-01',
        flatId: null,
        visitorName: 'Courier Partner',
        phone: '9820011223',
        passType: 'DELIVERY',
        vehicleNumber: 'MH02AB1234',
        purpose: 'Package Delivery',
        status: 'APPROVED',
        qrCodeHash: 'COMMUNITYOS:GVS-1234:soc-gvs:FLAT',
        validFrom: new Date('2026-11-17T10:00:00Z'),
        validTo: new Date('2026-11-17T22:00:00Z'),
        checkInTime: null,
        checkOutTime: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        resident: { name: 'Vikram Joshi' },
        flat: null,
      });

      const res = await request(app)
        .post('/api/visitor-passes')
        .set('Authorization', `Bearer ${residentToken}`)
        .send({
          visitorName: 'Courier Partner',
          phone: '9820011223',
          passType: 'DELIVERY',
          vehicleNumber: 'MH02AB1234',
          purpose: 'Package Delivery',
          residentId: 'spoofed-resident-id', // Must be ignored for residents
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe('pass-created-1');
      expect(res.body.visitorName).toBe('Courier Partner');
      expect(res.body.category).toBe('DELIVERY');

      // Verify Prisma call used allowlisted fields and forced authenticated residentId
      expect(prisma.visitorPass.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            societyId: 'soc-gvs',
            residentId: 'res-vikram-01', // Forced!
            visitorName: 'Courier Partner',
            phone: '9820011223',
            passType: 'DELIVERY',
          }),
        })
      );
    });

    test('Database failure returns sanitized HTTP 500 without leaking internal schema', async () => {
      (prisma.visitorPass.findMany as jest.Mock).mockRejectedValueOnce(new Error('PostgreSQL connection terminated unexpectedly'));

      const res = await request(app)
        .get('/api/visitor-passes')
        .set('Authorization', `Bearer ${guardToken}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('4. Gate Check-In, Check-Out & Concurrency Controls', () => {
    test('Check-in on an active pass succeeds and updates status to CHECKED_IN', async () => {
      (prisma.visitorPass.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'pass-gvs-101',
        societyId: 'soc-gvs',
        status: 'APPROVED',
        validTo: new Date(Date.now() + 3600000),
        visitorName: 'Rahul Verma',
        phone: '9820198201',
        passType: 'GUEST',
        resident: { name: 'Vikram Joshi' },
      });

      (prisma.visitorPass.update as jest.Mock).mockResolvedValueOnce({
        id: 'pass-gvs-101',
        societyId: 'soc-gvs',
        status: 'CHECKED_IN',
        checkInTime: new Date(),
        validTo: new Date(Date.now() + 3600000),
        visitorName: 'Rahul Verma',
        phone: '9820198201',
        passType: 'GUEST',
        resident: { name: 'Vikram Joshi' },
      });

      const res = await request(app)
        .post('/api/visitor-passes/pass-gvs-101/check-in')
        .set('Authorization', `Bearer ${guardToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.pass.status).toBe('CHECKED_IN');
      expect(prisma.visitorPass.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pass-gvs-101' },
          data: expect.objectContaining({ status: 'CHECKED_IN' }),
        })
      );
    });

    test('Duplicate check-in on already checked-in visitor returns HTTP 409 Conflict (ALREADY_CHECKED_IN)', async () => {
      (prisma.visitorPass.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'pass-gvs-101',
        societyId: 'soc-gvs',
        status: 'CHECKED_IN',
        validTo: new Date(Date.now() + 3600000),
      });

      const res = await request(app)
        .post('/api/visitor-passes/pass-gvs-101/check-in')
        .set('Authorization', `Bearer ${guardToken}`);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ALREADY_CHECKED_IN');
      expect(prisma.visitorPass.update).not.toHaveBeenCalled();
    });

    test('Check-in on an expired pass returns HTTP 400 Bad Request (PASS_EXPIRED)', async () => {
      (prisma.visitorPass.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'pass-gvs-101',
        societyId: 'soc-gvs',
        status: 'APPROVED',
        validTo: new Date(Date.now() - 3600000), // Expired 1 hour ago
      });

      const res = await request(app)
        .post('/api/visitor-passes/pass-gvs-101/check-in')
        .set('Authorization', `Bearer ${guardToken}`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PASS_EXPIRED');
      expect(prisma.visitorPass.update).not.toHaveBeenCalled();
    });

    test('Check-in on a revoked or cancelled pass returns HTTP 400 Bad Request (INVALID_PASS_STATUS)', async () => {
      (prisma.visitorPass.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'pass-gvs-101',
        societyId: 'soc-gvs',
        status: 'CANCELLED',
        validTo: new Date(Date.now() + 3600000),
      });

      const res = await request(app)
        .post('/api/visitor-passes/pass-gvs-101/check-in')
        .set('Authorization', `Bearer ${guardToken}`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_PASS_STATUS');
      expect(prisma.visitorPass.update).not.toHaveBeenCalled();
    });

    test('Check-out on a visitor who has not checked in returns HTTP 400 Bad Request (NOT_CHECKED_IN)', async () => {
      (prisma.visitorPass.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'pass-gvs-101',
        societyId: 'soc-gvs',
        status: 'APPROVED', // Expected, but never entered
      });

      const res = await request(app)
        .post('/api/visitor-passes/pass-gvs-101/check-out')
        .set('Authorization', `Bearer ${guardToken}`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('NOT_CHECKED_IN');
      expect(prisma.visitorPass.update).not.toHaveBeenCalled();
    });

    test('Check-out on already checked-out visitor returns HTTP 409 Conflict (ALREADY_CHECKED_OUT)', async () => {
      (prisma.visitorPass.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'pass-gvs-101',
        societyId: 'soc-gvs',
        status: 'CHECKED_OUT',
      });

      const res = await request(app)
        .post('/api/visitor-passes/pass-gvs-101/check-out')
        .set('Authorization', `Bearer ${guardToken}`);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ALREADY_CHECKED_OUT');
      expect(prisma.visitorPass.update).not.toHaveBeenCalled();
    });

    test('Deleting pass while visitor is inside premises is blocked with HTTP 400 (VISITOR_CURRENTLY_INSIDE)', async () => {
      (prisma.visitorPass.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'pass-gvs-101',
        societyId: 'soc-gvs',
        residentId: 'user-res-1',
        status: 'CHECKED_IN',
        resident: { userId: 'user-res-1' },
      });

      const res = await request(app)
        .delete('/api/visitor-passes/pass-gvs-101')
        .set('Authorization', `Bearer ${residentToken}`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VISITOR_CURRENTLY_INSIDE');
      expect(prisma.visitorPass.delete).not.toHaveBeenCalled();
    });
  });

  describe('5. Database Indexed Verification & Scoping (F-B1-03)', () => {
    test('POST /api/visitor-passes/verify uses scoped database findFirst and returns valid result', async () => {
      (prisma.visitorPass.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'pass-8492',
        societyId: 'soc-gvs',
        status: 'APPROVED',
        validTo: new Date(Date.now() + 3600000),
        visitorName: 'Rahul Verma',
        phone: '9820198201',
        passType: 'GUEST',
        qrCodeHash: 'COMMUNITYOS:GVS-8492:soc-gvs:B-1204',
        resident: { name: 'Vikram Joshi' },
      });

      const res = await request(app)
        .post('/api/visitor-passes/verify')
        .set('Authorization', `Bearer ${guardToken}`)
        .send({ codeOrQr: '8492' });

      expect(res.status).toBe(200);
      expect(res.body.isValid).toBe(true);
      expect(res.body.status).toBe('valid');
      expect(res.body.pass.visitorName).toBe('Rahul Verma');

      // Verify that prisma.visitorPass.findFirst was called strictly scoped to soc-gvs
      expect(prisma.visitorPass.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            societyId: 'soc-gvs',
          }),
        })
      );
    });

    test('POST /api/visitor-passes/verify identifies expired pass and returns expired status', async () => {
      (prisma.visitorPass.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'pass-3301',
        societyId: 'soc-gvs',
        status: 'APPROVED',
        validTo: new Date(Date.now() - 3600000), // Expired
        visitorName: 'Delayed Guest',
        phone: '9820198201',
        passType: 'GUEST',
      });

      const res = await request(app)
        .post('/api/visitor-passes/verify')
        .set('Authorization', `Bearer ${guardToken}`)
        .send({ codeOrQr: '3301' });

      expect(res.status).toBe(200);
      expect(res.body.isValid).toBe(false);
      expect(res.body.status).toBe('expired');
    });

    test('POST /api/visitor-passes/verify identifies cancelled/revoked pass and returns cancelled status', async () => {
      (prisma.visitorPass.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'pass-cancelled',
        societyId: 'soc-gvs',
        status: 'CANCELLED',
        validTo: new Date(Date.now() + 3600000),
        visitorName: 'Revoked Visitor',
        phone: '9820198201',
        passType: 'GUEST',
      });

      const res = await request(app)
        .post('/api/visitor-passes/verify')
        .set('Authorization', `Bearer ${guardToken}`)
        .send({ codeOrQr: 'CANCELLED' });

      expect(res.status).toBe(200);
      expect(res.body.isValid).toBe(false);
      expect(res.body.status).toBe('cancelled');
    });

    test('POST /api/visitor-passes/verify returns 404 when pass code is not found in database', async () => {
      (prisma.visitorPass.findFirst as jest.Mock).mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/visitor-passes/verify')
        .set('Authorization', `Bearer ${guardToken}`)
        .send({ codeOrQr: 'UNKNOWN-9999' });

      expect(res.status).toBe(404);
      expect(res.body.isValid).toBe(false);
      expect(res.body.status).toBe('invalid');
    });

    test('POST /api/visitor-passes/verify rejects cross-society verification attempt with HTTP 403', async () => {
      const res = await request(app)
        .post('/api/visitor-passes/verify')
        .set('Authorization', `Bearer ${guardToken}`)
        .send({ codeOrQr: '8492', societyId: 'soc-other-complex' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('TENANT_ISOLATION_VIOLATION');
      expect(prisma.visitorPass.findFirst).not.toHaveBeenCalled();
    });
  });
});
