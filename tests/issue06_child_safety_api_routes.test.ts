import request from 'supertest';
import { generateAuthToken } from '../server/src/auth';
import { prisma } from '../server/src/prisma';
import { realtimeEngine } from '../server/src/realtimeEngine';
import { hashChildPassToken } from '../server/src/childSafety/crypto';
import { resetChildSafetyRateLimiters } from '../server/src/childSafety/rateLimit';
import app from '../server/src/index';

jest.mock('../server/src/prisma', () => {
  const mockPrisma: any = {
    user: { findFirst: jest.fn() },
    resident: { findFirst: jest.fn() },
    flat: { findFirst: jest.fn() },
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
    },
    $transaction: jest.fn(),
  };
  mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
  return { prisma: mockPrisma };
});

describe('ISSUE-06 Phase B.2.2: Child Safety Secure Backend APIs (Supertest Express Routes)', () => {
  let resA1Token: string;
  let resA2Token: string;
  let resNoSocToken: string;
  let guardAToken: string;
  let guardBToken: string;
  let secAToken: string;
  let vendorAToken: string;

  const mockUsers: Record<string, any> = {
    'usr-res-a1': { id: 'usr-res-a1', name: 'Parent A1', email: 'a1@test.local', role: 'resident', societyId: 'soc-a', status: 'ACTIVE' },
    'usr-res-a2': { id: 'usr-res-a2', name: 'Parent A2', email: 'a2@test.local', role: 'resident', societyId: 'soc-a', status: 'ACTIVE' },
    'usr-no-soc': { id: 'usr-no-soc', name: 'Unassigned User', email: 'nosoc@test.local', role: 'resident', societyId: null, status: 'ACTIVE' },
    'usr-grd-a': { id: 'usr-grd-a', name: 'Guard Alpha', email: 'ga@test.local', role: 'guard', societyId: 'soc-a', status: 'ACTIVE' },
    'usr-grd-b': { id: 'usr-grd-b', name: 'Guard Beta', email: 'gb@test.local', role: 'guard', societyId: 'soc-b', status: 'ACTIVE' },
    'usr-sec-a': { id: 'usr-sec-a', name: 'Secretary Alpha', email: 'sa@test.local', role: 'secretary', societyId: 'soc-a', status: 'ACTIVE' },
    'usr-vnd-a': { id: 'usr-vnd-a', name: 'Vendor Alpha', email: 'va@test.local', role: 'vendor', societyId: 'soc-a', status: 'ACTIVE' },
  };

  let outboxSpy: jest.SpyInstance;
  let broadcastSpy: jest.SpyInstance;

  beforeAll(() => {
    resA1Token = generateAuthToken({ sub: 'usr-res-a1', email: 'a1@test.local', role: 'resident', societyId: 'soc-a', name: 'Parent A1' });
    resA2Token = generateAuthToken({ sub: 'usr-res-a2', email: 'a2@test.local', role: 'resident', societyId: 'soc-a', name: 'Parent A2' });
    resNoSocToken = generateAuthToken({ sub: 'usr-no-soc', email: 'nosoc@test.local', role: 'resident', societyId: '', name: 'Unassigned User' });
    guardAToken = generateAuthToken({ sub: 'usr-grd-a', email: 'ga@test.local', role: 'guard', societyId: 'soc-a', name: 'Guard Alpha' });
    guardBToken = generateAuthToken({ sub: 'usr-grd-b', email: 'gb@test.local', role: 'guard', societyId: 'soc-b', name: 'Guard Beta' });
    secAToken = generateAuthToken({ sub: 'usr-sec-a', email: 'sa@test.local', role: 'secretary', societyId: 'soc-a', name: 'Secretary Alpha' });
    vendorAToken = generateAuthToken({ sub: 'usr-vnd-a', email: 'va@test.local', role: 'vendor', societyId: 'soc-a', name: 'Vendor Alpha' });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetChildSafetyRateLimiters();
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(prisma));

    outboxSpy = jest.spyOn(realtimeEngine, 'recordOutboxEvent').mockResolvedValue('evt_test');
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
      if (uid === 'usr-res-a2' || uid === 'res-a2') {
        return Promise.resolve({
          id: 'res-a2',
          userId: 'usr-res-a2',
          societyId: 'soc-a',
          flatId: 'flat-a2',
          name: 'Parent A2',
          phone: '+919000000002',
          status: 'ACTIVE',
          flat: { id: 'flat-a2', societyId: 'soc-a', flatNumber: 'A-102' },
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
  // 1. AUTHENTICATION & AUTHORIZATION
  // =========================================================================
  describe('1. Authentication, Role & Tenant Enforcement', () => {
    it('rejects unauthenticated requests (401) and forged identity headers', async () => {
      const r1 = await request(app)
        .get('/api/children')
        .set('x-user-id', 'usr-sec-a')
        .set('x-user-role', 'admin')
        .set('x-society-id', 'soc-a');
      expect(r1.status).toBe(401);

      const r2 = await request(app)
        .post('/api/children/sos')
        .set('Authorization', 'Bearer invalid.jwt.signature')
        .send({ childId: 'child-a1', location: 'Park' });
      expect(r2.status).toBe(401);
    });

    it('rejects users with missing society membership (403 TENANT_CONTEXT_REQUIRED)', async () => {
      const res = await request(app)
        .get('/api/children')
        .set('Authorization', `Bearer ${resNoSocToken}`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('TENANT_CONTEXT_REQUIRED');
    });

    it('rejects cross-society query override (403 TENANT_ISOLATION_VIOLATION)', async () => {
      const res = await request(app)
        .get('/api/children?societyId=soc-b')
        .set('Authorization', `Bearer ${resA1Token}`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('TENANT_ISOLATION_VIOLATION');
    });

    it('blocks vendor from all Child Safety endpoints (403)', async () => {
      for (const call of [
        request(app).get('/api/children').set('Authorization', `Bearer ${vendorAToken}`),
        request(app).post('/api/children/passes').set('Authorization', `Bearer ${vendorAToken}`).send({}),
        request(app).post('/api/children/passes/verify').set('Authorization', `Bearer ${vendorAToken}`).send({}),
        request(app).post('/api/children/sos').set('Authorization', `Bearer ${vendorAToken}`).send({ location: 'Gate' }),
      ]) {
        const res = await call;
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
      }
    });

    it('blocks security guard from resident-only child creation and blocks resident from gate verification', async () => {
      const guardCreate = await request(app)
        .post('/api/children')
        .set('Authorization', `Bearer ${guardAToken}`)
        .send({ fullName: 'Test', guardianName: 'G', guardianPhone: '9999999999' });
      expect(guardCreate.status).toBe(403);

      const residentVerify = await request(app)
        .post('/api/children/passes/verify')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ bearerToken: 'a'.repeat(43) });
      expect(residentVerify.status).toBe(403);
    });
  });

  // =========================================================================
  // 2. CHILD PROFILES
  // =========================================================================
  describe('2. Child Profiles CRUD, Ownership & Archival', () => {
    it('creates a child profile bound strictly to verified resident & flat ownership', async () => {
      (prisma.childProfile.create as jest.Mock).mockResolvedValue({
        id: 'child-a1',
        societyId: 'soc-a',
        residentId: 'res-a1',
        flatId: 'flat-a1',
        guardianUserId: 'usr-res-a1',
        flatNumber: 'A-101',
        fullName: 'Aarav',
        gender: 'MALE',
        status: 'SAFE',
        exitPermissionMode: 'ESCORT_REQUIRED',
        allowedSoloExit: false,
        guardianName: 'Parent A1',
        guardianPhone: '+919000000001',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .post('/api/children')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({
          fullName: 'Aarav',
          gender: 'MALE',
          guardianName: 'Parent A1',
          guardianPhone: '+919000000001',
        });

      expect(res.status).toBe(201);
      expect(res.body.societyId).toBe('soc-a');
      expect(res.body.residentId).toBe('res-a1');
      expect(res.body.flatId).toBe('flat-a1');
      expect(outboxSpy).toHaveBeenCalledWith(
        expect.objectContaining({ societyId: 'soc-a', eventType: 'CHILD_PROFILE_CREATED' })
      );
    });

    it('rejects cross-society flat/resident during secretary child creation (400)', async () => {
      (prisma.resident.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'res-a1',
        societyId: 'soc-a',
        flatId: 'flat-a1',
      });
      (prisma.flat.findFirst as jest.Mock).mockResolvedValueOnce(null); // flat-b1 not in soc-a

      const res = await request(app)
        .post('/api/children')
        .set('Authorization', `Bearer ${secAToken}`)
        .send({
          residentId: 'res-a1',
          flatId: 'flat-b1',
          fullName: 'Cross Child',
          guardianName: 'Parent A1',
          guardianPhone: '+919000000001',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CROSS_SOCIETY_OR_MISSING_OWNER');
    });

    it('blocks resident from reading or mutating another resident’s child (403) and blocks immutable ownership update (400)', async () => {
      (prisma.childProfile.findFirst as jest.Mock).mockResolvedValue({
        id: 'child-a1',
        societyId: 'soc-a',
        residentId: 'res-a1',
        guardianUserId: 'usr-res-a1',
        status: 'SAFE',
        archivedAt: null,
      });

      const readOther = await request(app)
        .get('/api/children/child-a1')
        .set('Authorization', `Bearer ${resA2Token}`);
      expect(readOther.status).toBe(403);

      const mutateOwner = await request(app)
        .patch('/api/children/child-a1')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ residentId: 'res-a2' });
      expect(mutateOwner.status).toBe(400);
      expect(mutateOwner.body.code).toBe('IMMUTABLE_OWNERSHIP_FIELD');
    });

    it('archives child profile and revokes active passes atomically without deleting history', async () => {
      const now = new Date();
      (prisma.childProfile.findFirst as jest.Mock).mockResolvedValue({
        id: 'child-a1',
        societyId: 'soc-a',
        residentId: 'res-a1',
        guardianUserId: 'usr-res-a1',
        status: 'SAFE',
        archivedAt: null,
      });
      (prisma.childGatePass.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.childProfile.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.childProfile.findUnique as jest.Mock).mockResolvedValue({
        id: 'child-a1',
        societyId: 'soc-a',
        residentId: 'res-a1',
        flatId: 'flat-a1',
        flatNumber: 'A-101',
        fullName: 'Aarav',
        gender: 'MALE',
        status: 'ARCHIVED',
        exitPermissionMode: 'ESCORT_REQUIRED',
        allowedSoloExit: false,
        guardianName: 'Parent A1',
        guardianPhone: '+919000000001',
        archivedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      const res = await request(app)
        .post('/api/children/child-a1/archive')
        .set('Authorization', `Bearer ${resA1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ARCHIVED');
      expect(prisma.childGatePass.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ childId: 'child-a1', status: 'ACTIVE' }),
          data: expect.objectContaining({ status: 'REVOKED' }),
        })
      );
      expect(outboxSpy).toHaveBeenCalledWith(
        expect.objectContaining({ societyId: 'soc-a', eventType: 'CHILD_PROFILE_ARCHIVED' })
      );
    });
  });

  // =========================================================================
  // 3. AUTHORIZED PICKUPS (PII MINIMIZATION & REVOCATION)
  // =========================================================================
  describe('3. Authorized Pickups & PII Minimization', () => {
    it('rejects raw government ID numbers (400) and omits idDocumentHash on retrieval', async () => {
      const badRes = await request(app)
        .post('/api/children/child-a1/pickups')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({
          name: 'Sunita',
          phone: '+919888888881',
          relationship: 'Nanny',
          idProofNumber: '1234-5678-9012',
        });
      expect(badRes.status).toBe(400);
      expect(badRes.body.code).toBe('RAW_ID_DOCUMENT_FORBIDDEN');

      (prisma.childProfile.findFirst as jest.Mock).mockResolvedValue({
        id: 'child-a1',
        societyId: 'soc-a',
        residentId: 'res-a1',
        guardianUserId: 'usr-res-a1',
        status: 'SAFE',
        archivedAt: null,
      });
      (prisma.childAuthorizedPickup.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'pk-1',
          societyId: 'soc-a',
          childId: 'child-a1',
          name: 'Sunita',
          phone: '+919888888881',
          relationship: 'Nanny',
          idDocumentType: 'AADHAAR',
          idDocumentLast4: '9012',
          idDocumentHash: 'f'.repeat(64),
          idVerificationStatus: 'UNVERIFIED',
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const listRes = await request(app)
        .get('/api/children/child-a1/pickups')
        .set('Authorization', `Bearer ${resA1Token}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body[0].idDocumentLast4).toBe('9012');
      expect(listRes.body[0].idDocumentHash).toBeUndefined();
    });

    it('revokes pickup authorization and cascades revocation to linked active gate passes', async () => {
      (prisma.childProfile.findFirst as jest.Mock).mockResolvedValue({
        id: 'child-a1',
        societyId: 'soc-a',
        residentId: 'res-a1',
        guardianUserId: 'usr-res-a1',
        status: 'SAFE',
        archivedAt: null,
      });
      (prisma.childAuthorizedPickup.findFirst as jest.Mock).mockResolvedValue({
        id: 'pk-1',
        societyId: 'soc-a',
        childId: 'child-a1',
        status: 'ACTIVE',
        archivedAt: null,
      });
      (prisma.childGatePass.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.childAuthorizedPickup.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.childAuthorizedPickup.findUnique as jest.Mock).mockResolvedValue({
        id: 'pk-1',
        societyId: 'soc-a',
        childId: 'child-a1',
        name: 'Sunita',
        phone: '+919888888881',
        relationship: 'Nanny',
        idVerificationStatus: 'NOT_COLLECTED',
        status: 'REVOKED',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .post('/api/children/child-a1/pickups/pk-1/revoke')
        .set('Authorization', `Bearer ${resA1Token}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('REVOKED');
      expect(prisma.childGatePass.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ pickupPersonId: 'pk-1', status: 'ACTIVE' }),
          data: expect.objectContaining({ status: 'REVOKED' }),
        })
      );
    });

    it('rejects pass creation when pickup authorization has expired (422)', async () => {
      (prisma.childProfile.findFirst as jest.Mock).mockResolvedValue({
        id: 'child-a1',
        societyId: 'soc-a',
        residentId: 'res-a1',
        guardianUserId: 'usr-res-a1',
        fullName: 'Aarav',
        flatNumber: 'A-101',
        status: 'SAFE',
        exitPermissionMode: 'ESCORT_REQUIRED',
        allowedSoloExit: false,
        archivedAt: null,
      });
      (prisma.childSafetyAlert.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.childAuthorizedPickup.findFirst as jest.Mock).mockResolvedValue({
        id: 'pk-exp',
        societyId: 'soc-a',
        childId: 'child-a1',
        status: 'ACTIVE',
        archivedAt: null,
        validUntil: new Date(Date.now() - 60_000),
      });

      const res = await request(app)
        .post('/api/children/passes')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({
          childId: 'child-a1',
          pickupPersonId: 'pk-exp',
          validUntil: new Date(Date.now() + 3600_000).toISOString(),
        });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('PICKUP_AUTHORIZATION_EXPIRED');
    });
  });

  // =========================================================================
  // 4. GATE PASSES, CRYPTOGRAPHY, VERIFICATION & FAIL-CLOSED 503
  // =========================================================================
  describe('4. Gate Passes: CSPRNG Token, Hash-Only Persistence, Verification & Fail-Closed', () => {
    it('generates 256-bit bearer token, persists ONLY SHA-256 tokenHash, and omits tokenHash from list responses', async () => {
      const future = new Date(Date.now() + 3600_000).toISOString();
      (prisma.childProfile.findFirst as jest.Mock).mockResolvedValue({
        id: 'child-a1',
        societyId: 'soc-a',
        residentId: 'res-a1',
        guardianUserId: 'usr-res-a1',
        fullName: 'Aarav',
        flatNumber: 'A-101',
        status: 'SAFE',
        exitPermissionMode: 'ESCORT_REQUIRED',
        allowedSoloExit: false,
        archivedAt: null,
      });
      (prisma.childSafetyAlert.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.childAuthorizedPickup.findFirst as jest.Mock).mockResolvedValue({
        id: 'pk-1',
        societyId: 'soc-a',
        childId: 'child-a1',
        name: 'Sunita',
        phone: '+919888888881',
        status: 'ACTIVE',
        archivedAt: null,
        validUntil: null,
      });

      let persistedData: any = null;
      (prisma.childGatePass.create as jest.Mock).mockImplementation(({ data }: any) => {
        persistedData = data;
        return Promise.resolve({
          id: 'pass-a1',
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          child: { id: 'child-a1', fullName: 'Aarav', flatNumber: 'A-101', status: 'SAFE' },
        });
      });

      const createRes = await request(app)
        .post('/api/children/passes')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ childId: 'child-a1', pickupPersonId: 'pk-1', validUntil: future });

      expect(createRes.status).toBe(201);
      expect(typeof createRes.body.bearerToken).toBe('string');
      expect(createRes.body.bearerToken.length).toBeGreaterThanOrEqual(43); // 256-bit base64url
      expect(createRes.body.qrPayload).toBe(`AARIZO_CHILD_PASS:${createRes.body.bearerToken}`);
      expect(createRes.body.tokenHash).toBeUndefined();
      expect(persistedData.tokenHash).toBe(hashChildPassToken(createRes.body.bearerToken));
      expect(persistedData.tokenHash).not.toBe(createRes.body.bearerToken);

      // Verify realtime payload contains NO bearerToken and NO tokenHash
      expect(outboxSpy).toHaveBeenCalledTimes(1);
      const emittedPayload = JSON.stringify(outboxSpy.mock.calls[0][0]);
      expect(emittedPayload).not.toContain(createRes.body.bearerToken);
      expect(emittedPayload).not.toContain(persistedData.tokenHash);

      // List endpoint must NEVER expose tokenHash or bearerToken
      (prisma.childGatePass.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'pass-a1',
          ...persistedData,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      const listRes = await request(app)
        .get('/api/children/passes')
        .set('Authorization', `Bearer ${resA1Token}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body[0].tokenHash).toBeUndefined();
      expect(listRes.body[0].bearerToken).toBeUndefined();
    });

    it('rejects display passCode without cryptographic bearerToken (400 BEARER_TOKEN_REQUIRED)', async () => {
      const res = await request(app)
        .post('/api/children/passes/verify')
        .set('Authorization', `Bearer ${guardAToken}`)
        .send({ passCode: 'CGP-7K9M-2P4X', qrPayload: 'CGP-7K9M-2P4X' });

      expect(res.status).toBe(400);
      expect(res.body.authorized).toBe(false);
      expect(res.body.code).toBe('BEARER_TOKEN_REQUIRED');
    });

    it('rejects expired, revoked, already-consumed, wrong-society, and unauthorized-pickup passes', async () => {
      const rawToken = 'B'.repeat(44);
      const storedHash = hashChildPassToken(rawToken);
      const basePass = {
        id: 'pass-a1',
        societyId: 'soc-a',
        childId: 'child-a1',
        pickupPersonId: 'pk-1',
        passCode: 'CGP-AAAA-1111',
        tokenHash: storedHash,
        pickupPersonName: 'Sunita',
        validFrom: new Date(Date.now() - 60_000),
        validUntil: new Date(Date.now() + 3600_000),
        status: 'ACTIVE',
        maxUses: 1,
        currentUses: 0,
        revokedAt: null,
        archivedAt: null,
        child: {
          id: 'child-a1',
          societyId: 'soc-a',
          fullName: 'Aarav',
          flatNumber: 'A-101',
          status: 'SAFE',
          exitPermissionMode: 'ESCORT_REQUIRED',
          allowedSoloExit: false,
          archivedAt: null,
        },
        pickupPerson: {
          id: 'pk-1',
          societyId: 'soc-a',
          childId: 'child-a1',
          status: 'ACTIVE',
          archivedAt: null,
          validUntil: null,
        },
      };

      (prisma.childSafetyAlert.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.childExitLog.create as jest.Mock).mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'log-1', ...data, timestamp: new Date() })
      );

      // Wrong society (guardB scanning soc-a pass -> 404 non-disclosure)
      (prisma.childGatePass.findUnique as jest.Mock).mockResolvedValueOnce(basePass);
      const wrongSoc = await request(app)
        .post('/api/children/passes/verify')
        .set('Authorization', `Bearer ${guardBToken}`)
        .send({ bearerToken: rawToken });
      expect(wrongSoc.status).toBe(404);
      expect(wrongSoc.body.authorized).toBe(false);

      // Revoked pass -> 409 PASS_REVOKED
      (prisma.childGatePass.findUnique as jest.Mock).mockResolvedValueOnce({
        ...basePass,
        status: 'REVOKED',
        revokedAt: new Date(),
      });
      const revoked = await request(app)
        .post('/api/children/passes/verify')
        .set('Authorization', `Bearer ${guardAToken}`)
        .send({ bearerToken: rawToken });
      expect(revoked.status).toBe(409);
      expect(revoked.body.code).toBe('PASS_REVOKED');

      // Expired pass -> 409 PASS_EXPIRED
      (prisma.childGatePass.findUnique as jest.Mock).mockResolvedValueOnce({
        ...basePass,
        validUntil: new Date(Date.now() - 1000),
      });
      const expired = await request(app)
        .post('/api/children/passes/verify')
        .set('Authorization', `Bearer ${guardAToken}`)
        .send({ bearerToken: rawToken });
      expect(expired.status).toBe(409);
      expect(expired.body.code).toBe('PASS_EXPIRED');

      // Unauthorized / revoked pickup person -> 409 PICKUP_PERSON_UNAUTHORIZED
      (prisma.childGatePass.findUnique as jest.Mock).mockResolvedValueOnce({
        ...basePass,
        pickupPerson: { ...basePass.pickupPerson, status: 'REVOKED' },
      });
      const badPickup = await request(app)
        .post('/api/children/passes/verify')
        .set('Authorization', `Bearer ${guardAToken}`)
        .send({ bearerToken: rawToken });
      expect(badPickup.status).toBe(409);
      expect(badPickup.body.code).toBe('PICKUP_PERSON_UNAUTHORIZED');

      // Concurrent consumption failure (updateMany count === 0) -> 409 PASS_ALREADY_CONSUMED
      (prisma.childGatePass.findUnique as jest.Mock).mockResolvedValueOnce(basePass);
      (prisma.childGatePass.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });
      const raceLoss = await request(app)
        .post('/api/children/passes/verify')
        .set('Authorization', `Bearer ${guardAToken}`)
        .send({ bearerToken: rawToken });
      expect(raceLoss.status).toBe(409);
      expect(raceLoss.body.code).toBe('PASS_ALREADY_CONSUMED');
    });

    it('fails closed with HTTP 503 VERIFICATION_UNAVAILABLE when database is unreachable (never offline-approves)', async () => {
      const dbErr: any = new Error("Can't reach database server at localhost:5432");
      dbErr.code = 'P1001';
      (prisma.$transaction as jest.Mock).mockRejectedValueOnce(dbErr);

      const res = await request(app)
        .post('/api/children/passes/verify')
        .set('Authorization', `Bearer ${guardAToken}`)
        .send({ bearerToken: 'C'.repeat(44) });

      expect(res.status).toBe(503);
      expect(res.body.authorized).toBe(false);
      expect(res.body.outcome).toBe('VERIFICATION_UNAVAILABLE');
      expect(res.body.code).toBe('BACKEND_UNAVAILABLE');
      expect(outboxSpy).not.toHaveBeenCalled();
    });

    it('enforces rate limiting (429) on repeated SOS bursts', async () => {
      (prisma.childProfile.findFirst as jest.Mock).mockResolvedValue({
        id: 'child-a1',
        societyId: 'soc-a',
        residentId: 'res-a1',
        guardianUserId: 'usr-res-a1',
        fullName: 'Aarav',
        flatNumber: 'A-101',
        status: 'SAFE',
        archivedAt: null,
      });
      (prisma.emergencyIncident.create as jest.Mock).mockResolvedValue({
        id: 'inc-rl',
        societyId: 'soc-a',
        incidentType: 'CHILD_SAFETY',
        severity: 'CRITICAL',
        location: 'Gate',
        dispatchStatus: 'DISPATCHED',
        createdAt: new Date(),
      });
      (prisma.childSafetyAlert.create as jest.Mock).mockResolvedValue({
        id: 'alert-rl',
        societyId: 'soc-a',
        childId: 'child-a1',
        reportedById: 'usr-res-a1',
        reportedByName: 'Parent A1',
        childName: 'Aarav',
        flatNumber: 'A-101',
        alertType: 'EMERGENCY_SOS',
        severity: 'CRITICAL',
        status: 'ACTIVE',
        location: 'Gate',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      let lastStatus = 201;
      for (let i = 0; i < 11; i++) {
        const r = await request(app)
          .post('/api/children/sos')
          .set('Authorization', `Bearer ${resA1Token}`)
          .send({ childId: 'child-a1', location: 'Gate', alertType: 'EMERGENCY_SOS' });
        lastStatus = r.status;
      }
      expect(lastStatus).toBe(429);
    });
  });

  // =========================================================================
  // 5. SOS AUTHORIZATION, TRANSITIONS & ROLLBACK SAFETY
  // =========================================================================
  describe('5. Child SOS Authorization, Transitions & Rollback Safety', () => {
    it('allows verified guardian to trigger SOS while ignoring forged societyId/guardianId/residentId', async () => {
      (prisma.childProfile.findFirst as jest.Mock).mockResolvedValue({
        id: 'child-a1',
        societyId: 'soc-a',
        residentId: 'res-a1',
        guardianUserId: 'usr-res-a1',
        fullName: 'Aarav',
        flatNumber: 'A-101',
        status: 'SAFE',
        archivedAt: null,
      });
      (prisma.emergencyIncident.create as jest.Mock).mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'inc-1', ...data, createdAt: new Date() })
      );
      (prisma.childSafetyAlert.create as jest.Mock).mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'alert-1', ...data, createdAt: new Date(), updatedAt: new Date() })
      );
      (prisma.childProfile.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      const res = await request(app)
        .post('/api/children/sos')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({
          childId: 'child-a1',
          societyId: 'soc-forged-evil',
          residentId: 'res-forged',
          guardianId: 'usr-forged',
          reportedById: 'usr-forged',
          location: 'Near Swimming Pool',
          alertType: 'MISSING_CHILD',
        });

      expect(res.status).toBe(201);
      expect(res.body.alert.societyId).toBe('soc-a');
      expect(res.body.alert.reportedById).toBe('usr-res-a1');
      expect(res.body.emergencyIncident.societyId).toBe('soc-a');
      expect(outboxSpy).toHaveBeenCalledWith(
        expect.objectContaining({ societyId: 'soc-a', eventType: 'CHILD_SAFETY_SOS_TRIGGERED' })
      );
    });

    it('rejects unrelated resident triggering SOS for another resident’s child (403)', async () => {
      (prisma.childProfile.findFirst as jest.Mock).mockResolvedValue({
        id: 'child-a1',
        societyId: 'soc-a',
        residentId: 'res-a1',
        guardianUserId: 'usr-res-a1',
        fullName: 'Aarav',
        flatNumber: 'A-101',
        status: 'SAFE',
        archivedAt: null,
      });

      const res = await request(app)
        .post('/api/children/sos')
        .set('Authorization', `Bearer ${resA2Token}`)
        .send({ childId: 'child-a1', location: 'Park' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('UNAUTHORIZED_SOS_TRIGGER');
      expect(outboxSpy).not.toHaveBeenCalled();
    });

    it('emits ZERO realtime events when SOS transaction rolls back on partial failure', async () => {
      (prisma.childProfile.findFirst as jest.Mock).mockResolvedValue({
        id: 'child-a1',
        societyId: 'soc-a',
        residentId: 'res-a1',
        guardianUserId: 'usr-res-a1',
        fullName: 'Aarav',
        flatNumber: 'A-101',
        status: 'SAFE',
        archivedAt: null,
      });
      (prisma.emergencyIncident.create as jest.Mock).mockResolvedValue({ id: 'inc-partial' });
      (prisma.childSafetyAlert.create as jest.Mock).mockRejectedValueOnce(new Error('Simulated DB write failure'));

      const res = await request(app)
        .post('/api/children/sos')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ childId: 'child-a1', location: 'Lobby' });

      expect(res.status).toBe(500);
      expect(outboxSpy).not.toHaveBeenCalled();
      expect(broadcastSpy).not.toHaveBeenCalled();
    });

    it('rejects resident trying to acknowledge/resolve alert (403) and rejects invalid status transition (422)', async () => {
      const resAck = await request(app)
        .post('/api/children/alerts/alert-1/acknowledge')
        .set('Authorization', `Bearer ${resA1Token}`);
      expect(resAck.status).toBe(403);

      (prisma.childSafetyAlert.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'alert-1',
        societyId: 'soc-a',
        status: 'RESOLVED',
      });
      const badTransition = await request(app)
        .post('/api/children/alerts/alert-1/acknowledge')
        .set('Authorization', `Bearer ${guardAToken}`);
      expect(badTransition.status).toBe(422);
      expect(badTransition.body.code).toBe('INVALID_ALERT_TRANSITION');
    });
  });
});
