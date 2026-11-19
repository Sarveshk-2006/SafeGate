import request from 'supertest';
import { PrismaClient } from '../server/node_modules/@prisma/client';
import { hashChildPassToken } from '../server/src/childSafety/crypto';
import { resetChildSafetyRateLimiters } from '../server/src/childSafety/rateLimit';

/**
 * Real Live Isolated PostgreSQL 16 + Supertest Express Integration Suite for Phase B.2.2.
 *
 * IMPORTANT:
 * - Gated by AARIZO_ISOLATED_TEST_DATABASE_URL so default offline `npm test` NEVER connects
 *   to host port 5432 or any unrelated external database (e.g., nexus-postgres).
 * - Uses REAL Prisma + PostgreSQL 16 (NO Prisma mocks) to prove true row-level locking,
 *   atomic one-time pass consumption under concurrent HTTP requests, real SOS transactions,
 *   pickup revocation cascading to active passes, and cross-society isolation.
 */

const ISOLATED_DB_URL = process.env.AARIZO_ISOLATED_TEST_DATABASE_URL;
const describePg = ISOLATED_DB_URL ? describe : describe.skip;

describePg('ISSUE-06 Phase B.2.2: Live Isolated PostgreSQL 16 API Concurrency & Persistence Suite', () => {
  let app: any;
  let db: PrismaClient;
  let generateAuthToken: any;

  let resA1Token: string;
  let resA2Token: string;
  let guardAToken: string;
  let guardBToken: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = ISOLATED_DB_URL;
    const authMod = await import('../server/src/auth');
    generateAuthToken = authMod.generateAuthToken;
    const appMod = await import('../server/src/index');
    app = appMod.default;

    db = new PrismaClient({ datasources: { db: { url: ISOLATED_DB_URL } } });
    await db.$connect();

    // Seed two societies, towers, flats, users, and active residents in PostgreSQL 16
    await db.$executeRawUnsafe(`
      INSERT INTO societies (id, name, code, city, address, created_at, updated_at)
      VALUES
        ('soc-a', 'Alpha Society', 'ALPHA', 'Pune', 'Lane 1', NOW(), NOW()),
        ('soc-b', 'Beta Society', 'BETA', 'Pune', 'Lane 2', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `);
    await db.$executeRawUnsafe(`
      INSERT INTO towers (id, society_id, name, created_at, updated_at)
      VALUES
        ('twr-a', 'soc-a', 'Tower A', NOW(), NOW()),
        ('twr-b', 'soc-b', 'Tower B', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `);
    await db.$executeRawUnsafe(`
      INSERT INTO flats (id, society_id, tower_id, flat_number, created_at, updated_at)
      VALUES
        ('flat-a1', 'soc-a', 'twr-a', 'A-101', NOW(), NOW()),
        ('flat-a2', 'soc-a', 'twr-a', 'A-102', NOW(), NOW()),
        ('flat-b1', 'soc-b', 'twr-b', 'B-101', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `);
    await db.$executeRawUnsafe(`
      INSERT INTO users (id, society_id, flat_id, name, email, phone, role, status, created_at, updated_at)
      VALUES
        ('usr-res-a1', 'soc-a', 'flat-a1', 'Parent A1', 'pa1@live.test', '+919100000001', 'resident', 'ACTIVE', NOW(), NOW()),
        ('usr-res-a2', 'soc-a', 'flat-a2', 'Parent A2', 'pa2@live.test', '+919100000002', 'resident', 'ACTIVE', NOW(), NOW()),
        ('usr-grd-a', 'soc-a', NULL, 'Guard Alpha', 'ga@live.test', '+919100000003', 'guard', 'ACTIVE', NOW(), NOW()),
        ('usr-grd-b', 'soc-b', NULL, 'Guard Beta', 'gb@live.test', '+919100000004', 'guard', 'ACTIVE', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `);
    await db.$executeRawUnsafe(`
      INSERT INTO residents (id, society_id, user_id, flat_id, name, phone, status, created_at, updated_at)
      VALUES
        ('res-live-a1', 'soc-a', 'usr-res-a1', 'flat-a1', 'Parent A1', '+919100000001', 'ACTIVE', NOW(), NOW()),
        ('res-live-a2', 'soc-a', 'usr-res-a2', 'flat-a2', 'Parent A2', '+919100000002', 'ACTIVE', NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        society_id = EXCLUDED.society_id,
        flat_id = EXCLUDED.flat_id,
        status = 'ACTIVE'
    `);

    resA1Token = generateAuthToken({ sub: 'usr-res-a1', email: 'pa1@live.test', role: 'resident', societyId: 'soc-a', name: 'Parent A1' });
    resA2Token = generateAuthToken({ sub: 'usr-res-a2', email: 'pa2@live.test', role: 'resident', societyId: 'soc-a', name: 'Parent A2' });
    guardAToken = generateAuthToken({ sub: 'usr-grd-a', email: 'ga@live.test', role: 'guard', societyId: 'soc-a', name: 'Guard Alpha' });
    guardBToken = generateAuthToken({ sub: 'usr-grd-b', email: 'gb@live.test', role: 'guard', societyId: 'soc-b', name: 'Guard Beta' });
  });

  beforeEach(() => {
    resetChildSafetyRateLimiters();
  });

  afterAll(async () => {
    if (db) await db.$disconnect();
    const prismaMod = await import('../server/src/prisma');
    await prismaMod.prisma.$disconnect();
  });

  it('proves atomic one-time consumption under TWO CONCURRENT gate verification requests in live PostgreSQL 16', async () => {
    // 1. Create Child Profile
    const childRes = await request(app)
      .post('/api/children')
      .set('Authorization', `Bearer ${resA1Token}`)
      .send({
        fullName: 'Aarav Live',
        gender: 'MALE',
        guardianName: 'Parent A1',
        guardianPhone: '+919100000001',
        exitPermissionMode: 'ESCORT_REQUIRED',
      });
    expect(childRes.status).toBe(201);
    const childId = childRes.body.id;

    // 2. Add Authorized Pickup (minimal PII)
    const pickupRes = await request(app)
      .post(`/api/children/${childId}/pickups`)
      .set('Authorization', `Bearer ${resA1Token}`)
      .send({
        name: 'Sunita Nanny',
        phone: '+919888888881',
        relationship: 'Nanny',
        idDocumentType: 'AADHAAR',
        idDocumentLast4: '4321',
      });
    expect(pickupRes.status).toBe(201);
    const pickupId = pickupRes.body.id;

    // 3. Issue One-Time Gate Pass (maxUses = 1)
    const passRes = await request(app)
      .post('/api/children/passes')
      .set('Authorization', `Bearer ${resA1Token}`)
      .send({
        childId,
        pickupPersonId: pickupId,
        validUntil: new Date(Date.now() + 2 * 3600_000).toISOString(),
        maxUses: 1,
      });
    expect(passRes.status).toBe(201);
    const passId = passRes.body.id;
    const rawBearerToken = passRes.body.bearerToken;
    expect(passRes.body.tokenHash).toBeUndefined();

    // Verify ONLY SHA-256 hash is stored in PostgreSQL
    const dbPass = await db.childGatePass.findUnique({ where: { id: passId } });
    expect(dbPass?.tokenHash).toBe(hashChildPassToken(rawBearerToken));

    // Cross-society guard B cannot verify Society A's valid bearer token (404 non-disclosure)
    const crossGuardRes = await request(app)
      .post('/api/children/passes/verify')
      .set('Authorization', `Bearer ${guardBToken}`)
      .send({ bearerToken: rawBearerToken, gateId: 'Gate-B' });
    expect(crossGuardRes.status).toBe(404);
    expect(crossGuardRes.body.authorized).toBe(false);

    // 4. Fire TWO SIMULTANEOUS gate verification requests for the same one-time pass
    const [r1, r2] = await Promise.all([
      request(app)
        .post('/api/children/passes/verify')
        .set('Authorization', `Bearer ${guardAToken}`)
        .send({ bearerToken: rawBearerToken, gateId: 'Main-Gate-1' }),
      request(app)
        .post('/api/children/passes/verify')
        .set('Authorization', `Bearer ${guardAToken}`)
        .send({ bearerToken: rawBearerToken, gateId: 'Main-Gate-2' }),
    ]);

    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const winner = r1.status === 200 ? r1 : r2;
    const loser = r1.status === 409 ? r1 : r2;
    expect(winner.body.authorized).toBe(true);
    expect(winner.body.outcome).toBe('ALLOWED');
    expect(loser.body.authorized).toBe(false);
    expect(loser.body.code).toBe('PASS_ALREADY_CONSUMED');

    // Confirm PostgreSQL state: currentUses === 1, status === 'USED', and EXACTLY ONE ALLOWED exit log
    const consumedPass = await db.childGatePass.findUnique({ where: { id: passId } });
    expect(consumedPass?.currentUses).toBe(1);
    expect(consumedPass?.status).toBe('USED');

    const allowedLogs = await db.childExitLog.count({
      where: { passId, outcome: 'ALLOWED' },
    });
    expect(allowedLogs).toBe(1);
  });

  it('persists atomic SOS + EmergencyIncident, blocks active passes on MISSING child, and resolves cleanly in live PostgreSQL 16', async () => {
    const childRes = await request(app)
      .post('/api/children')
      .set('Authorization', `Bearer ${resA1Token}`)
      .send({
        fullName: 'Diya SOS Test',
        gender: 'FEMALE',
        guardianName: 'Parent A1',
        guardianPhone: '+919100000001',
        exitPermissionMode: 'SOLO_ALLOWED',
        allowedSoloExit: true,
      });
    expect(childRes.status).toBe(201);
    const childId = childRes.body.id;

    // Issue an active pass BEFORE SOS is triggered
    const passRes = await request(app)
      .post('/api/children/passes')
      .set('Authorization', `Bearer ${resA1Token}`)
      .send({
        childId,
        validUntil: new Date(Date.now() + 2 * 3600_000).toISOString(),
      });
    expect(passRes.status).toBe(201);
    const rawToken = passRes.body.bearerToken;

    // Unrelated resident A2 cannot trigger SOS on child owned by A1
    const unauthSos = await request(app)
      .post('/api/children/sos')
      .set('Authorization', `Bearer ${resA2Token}`)
      .send({ childId, location: 'Garden' });
    expect(unauthSos.status).toBe(403);

    // Authorized guardian A1 triggers SOS (with forged societyId ignored)
    const sosRes = await request(app)
      .post('/api/children/sos')
      .set('Authorization', `Bearer ${resA1Token}`)
      .send({
        childId,
        societyId: 'soc-b',
        guardianId: 'usr-res-a2',
        location: 'Clubhouse Pool',
        alertType: 'MISSING_CHILD',
      });
    expect(sosRes.status).toBe(201);
    expect(sosRes.body.alert.societyId).toBe('soc-a');
    expect(sosRes.body.alert.reportedById).toBe('usr-res-a1');
    const alertId = sosRes.body.alert.id;
    const incidentId = sosRes.body.emergencyIncident.id;

    // Gate verification MUST BLOCK exit while MISSING_CHILD alert is active
    const blockedExit = await request(app)
      .post('/api/children/passes/verify')
      .set('Authorization', `Bearer ${guardAToken}`)
      .send({ bearerToken: rawToken, gateId: 'North-Gate' });
    expect(blockedExit.status).toBe(409);
    expect(blockedExit.body.authorized).toBe(false);
    expect(blockedExit.body.code).toBe('CHILD_MISSING_ALERT_BLOCKED');

    // Cross-society guard B cannot acknowledge Society A's alert (404)
    const crossAck = await request(app)
      .post(`/api/children/alerts/${alertId}/acknowledge`)
      .set('Authorization', `Bearer ${guardBToken}`);
    expect(crossAck.status).toBe(404);

    // Guard A acknowledges then resolves the alert
    const ackRes = await request(app)
      .post(`/api/children/alerts/${alertId}/acknowledge`)
      .set('Authorization', `Bearer ${guardAToken}`);
    expect(ackRes.status).toBe(200);
    expect(ackRes.body.status).toBe('ACKNOWLEDGED');
    expect(ackRes.body.acknowledgedById).toBe('usr-grd-a');

    const resolveRes = await request(app)
      .post(`/api/children/alerts/${alertId}/resolve`)
      .set('Authorization', `Bearer ${guardAToken}`)
      .send({ status: 'RESOLVED', resolutionNotes: 'Child found safely at clubhouse play area' });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.status).toBe('RESOLVED');
    expect(resolveRes.body.resolvedById).toBe('usr-grd-a');

    // Confirm linked EmergencyIncident is RESOLVED and ChildProfile restored to SAFE
    const dbIncident = await db.emergencyIncident.findUnique({ where: { id: incidentId } });
    expect(dbIncident?.dispatchStatus).toBe('RESOLVED');
    expect(dbIncident?.resolvedAt).not.toBeNull();

    const dbChild = await db.childProfile.findUnique({ where: { id: childId } });
    expect(dbChild?.status).toBe('SAFE');
  });

  it('F-B22-05: serializes concurrent MISSING_CHILD SOS vs POST /passes/verify via PostgreSQL FOR UPDATE row lock', async () => {
    const childRes = await request(app)
      .post('/api/children')
      .set('Authorization', `Bearer ${resA1Token}`)
      .send({
        fullName: 'Rohan Race Test',
        gender: 'MALE',
        guardianName: 'Parent A1',
        guardianPhone: '+919100000001',
        exitPermissionMode: 'SOLO_ALLOWED',
        allowedSoloExit: true,
      });
    expect(childRes.status).toBe(201);
    const childId = childRes.body.id;

    const passRes = await request(app)
      .post('/api/children/passes')
      .set('Authorization', `Bearer ${resA1Token}`)
      .send({
        childId,
        validUntil: new Date(Date.now() + 2 * 3600_000).toISOString(),
        maxUses: 1,
      });
    expect(passRes.status).toBe(201);
    const passId = passRes.body.id;
    const rawToken = passRes.body.bearerToken;

    // Fire MISSING_CHILD SOS and gate pass verification concurrently against live PostgreSQL 16
    const [sosRes, verifyRes] = await Promise.all([
      request(app)
        .post('/api/children/sos')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ childId, location: 'East Lawn', alertType: 'MISSING_CHILD' }),
      request(app)
        .post('/api/children/passes/verify')
        .set('Authorization', `Bearer ${guardAToken}`)
        .send({ bearerToken: rawToken, gateId: 'East-Gate' }),
    ]);

    expect(sosRes.status).toBe(201);
    const dbChild = await db.childProfile.findUnique({ where: { id: childId } });
    const dbPass = await db.childGatePass.findUnique({ where: { id: passId } });

    // In BOTH valid serializable orderings, final child status MUST be MISSING (never overwritten to OUT_OF_SOCIETY!)
    expect(dbChild?.status).toBe('MISSING');

    if (verifyRes.status === 409) {
      // Ordering A: SOS acquired FOR UPDATE first -> verify observed MISSING and blocked exit
      expect(verifyRes.body.authorized).toBe(false);
      expect(verifyRes.body.code).toBe('CHILD_MISSING_ALERT_BLOCKED');
      expect(dbPass?.currentUses).toBe(0);
      expect(dbPass?.status).toBe('ACTIVE');
    } else {
      // Ordering B: Verify acquired FOR UPDATE first -> allowed exit, then SOS transitioned child to MISSING
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.authorized).toBe(true);
      expect(dbPass?.currentUses).toBe(1);
      expect(dbPass?.status).toBe('USED');
    }
  });

  it('F-B22-06A: prevents concurrent duplicate active MISSING_CHILD SOS alerts and allows a new alert after resolution', async () => {
    const childRes = await request(app)
      .post('/api/children')
      .set('Authorization', `Bearer ${resA1Token}`)
      .send({
        fullName: 'Meera Dedup Test',
        gender: 'FEMALE',
        guardianName: 'Parent A1',
        guardianPhone: '+919100000001',
        exitPermissionMode: 'ESCORT_REQUIRED',
      });
    expect(childRes.status).toBe(201);
    const childId = childRes.body.id;

    // Fire TWO simultaneous MISSING_CHILD SOS requests for the same child
    const [s1, s2] = await Promise.all([
      request(app)
        .post('/api/children/sos')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ childId, location: 'Garden 1', alertType: 'MISSING_CHILD' }),
      request(app)
        .post('/api/children/sos')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ childId, location: 'Garden 2', alertType: 'MISSING_CHILD' }),
    ]);

    const statuses = [s1.status, s2.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    const createdRes = s1.status === 201 ? s1 : s2;
    const duplicateRes = s1.status === 409 ? s1 : s2;
    expect(duplicateRes.body.code).toBe('DUPLICATE_ACTIVE_SOS_ALERT');
    expect(duplicateRes.body.activeAlert?.id).toBe(createdRes.body.alert.id);

    const activeAlerts = await db.childSafetyAlert.count({
      where: { childId, alertType: 'MISSING_CHILD', status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } },
    });
    expect(activeAlerts).toBe(1);

    // Resolve the active alert, then verify a fresh MISSING_CHILD SOS succeeds
    const resolveRes = await request(app)
      .post(`/api/children/alerts/${createdRes.body.alert.id}/resolve`)
      .set('Authorization', `Bearer ${guardAToken}`)
      .send({ status: 'RESOLVED', resolutionNotes: 'Child located safely' });
    expect(resolveRes.status).toBe(200);

    const freshSos = await request(app)
      .post('/api/children/sos')
      .set('Authorization', `Bearer ${resA1Token}`)
      .send({ childId, location: 'Parking Lot', alertType: 'MISSING_CHILD' });
    expect(freshSos.status).toBe(201);
  });

  it('F-B22-07: proves real PostgreSQL transaction ROLLBACK leaves ZERO orphaned EmergencyIncident on partial SOS failure', async () => {
    const childRes = await request(app)
      .post('/api/children')
      .set('Authorization', `Bearer ${resA1Token}`)
      .send({
        fullName: 'Kabir Rollback Test',
        gender: 'MALE',
        guardianName: 'Parent A1',
        guardianPhone: '+919100000001',
        exitPermissionMode: 'ESCORT_REQUIRED',
      });
    expect(childRes.status).toBe(201);
    const childId = childRes.body.id;

    // Install a temporary PostgreSQL trigger that aborts ONLY when location = 'FORCE_PG_ROLLBACK_TEST'
    await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_child_alert_for_rollback_test()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.location = 'FORCE_PG_ROLLBACK_TEST' THEN
          RAISE EXCEPTION 'Simulated PostgreSQL child_safety_alerts failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await db.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS trg_fail_child_alert_rollback_test ON child_safety_alerts`
    );
    await db.$executeRawUnsafe(`
      CREATE TRIGGER trg_fail_child_alert_rollback_test
      BEFORE INSERT ON child_safety_alerts
      FOR EACH ROW EXECUTE FUNCTION fail_child_alert_for_rollback_test()
    `);

    try {
      const failedSos = await request(app)
        .post('/api/children/sos')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ childId, location: 'FORCE_PG_ROLLBACK_TEST', alertType: 'MISSING_CHILD' });

      expect(failedSos.status).toBe(500);

      // Verify ZERO orphaned emergency_incidents and ZERO child_safety_alerts committed in PostgreSQL
      const orphanedIncidents = await db.emergencyIncident.count({
        where: { societyId: 'soc-a', location: 'FORCE_PG_ROLLBACK_TEST' },
      });
      const orphanedAlerts = await db.childSafetyAlert.count({
        where: { societyId: 'soc-a', location: 'FORCE_PG_ROLLBACK_TEST' },
      });
      const dbChild = await db.childProfile.findUnique({ where: { id: childId } });

      expect(orphanedIncidents).toBe(0);
      expect(orphanedAlerts).toBe(0);
      expect(dbChild?.status).toBe('SAFE');
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS trg_fail_child_alert_rollback_test ON child_safety_alerts;`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS fail_child_alert_for_rollback_test();`);
    }
  });

  it('F-B22-01 & F-B22-03 live PG proof: blocks /api/collections/child_profiles and rejects stale JWT after DB society_id revocation', async () => {
    // 1. Even if a legacy EntityRecord exists in PostgreSQL, /api/collections/child_profiles returns 403
    await db.$executeRawUnsafe(`
      INSERT INTO entity_records (id, society_id, collection, data, created_at, updated_at)
      VALUES ('legacy-child-1', 'soc-a', 'child_profiles', '{"fullName":"Legacy"}', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `);
    try {
      const colBypass = await request(app)
        .get('/api/collections/child_profiles')
        .set('Authorization', `Bearer ${guardAToken}`);
      expect(colBypass.status).toBe(403);
      expect(colBypass.body.code).toBe('CHILD_SAFETY_COLLECTION_FORBIDDEN');
    } finally {
      await db.$executeRawUnsafe(`DELETE FROM entity_records WHERE id = 'legacy-child-1'`);
    }

    // 2. Create a user with society_id = 'soc-a', mint a valid JWT, then revoke society_id to NULL in PostgreSQL
    await db.$executeRawUnsafe(`
      INSERT INTO users (id, society_id, flat_id, name, email, phone, role, status, created_at, updated_at)
      VALUES ('usr-revoke-soc', 'soc-a', NULL, 'Revoked Guard', 'rev@live.test', '+919100000099', 'guard', 'ACTIVE', NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET society_id = 'soc-a'
    `);
    const validJwtBeforeRevoke = generateAuthToken({
      sub: 'usr-revoke-soc',
      email: 'rev@live.test',
      role: 'guard',
      societyId: 'soc-a',
      name: 'Revoked Guard',
    });

    const beforeRes = await request(app)
      .get('/api/children/passes')
      .set('Authorization', `Bearer ${validJwtBeforeRevoke}`);
    expect(beforeRes.status).toBe(200);

    // Revoke society assignment in PostgreSQL
    await db.$executeRawUnsafe(`UPDATE users SET society_id = NULL WHERE id = 'usr-revoke-soc'`);

    // Same cryptographically valid JWT with stale societyId='soc-a' MUST now be rejected (403 TENANT_CONTEXT_REQUIRED)
    const afterRes = await request(app)
      .get('/api/children/passes')
      .set('Authorization', `Bearer ${validJwtBeforeRevoke}`);
    expect(afterRes.status).toBe(403);
    expect(afterRes.body.code).toBe('TENANT_CONTEXT_REQUIRED');
  });

  it('F-B22-07: serializes concurrent MISSING_CHILD SOS creation vs Alert Resolution in live PostgreSQL 16 with consistent final DB state', async () => {
    const childRes = await request(app)
      .post('/api/children')
      .set('Authorization', `Bearer ${resA1Token}`)
      .send({
        fullName: 'Ananya SosResolve Race',
        gender: 'FEMALE',
        guardianName: 'Parent A1',
        guardianPhone: '+919100000001',
        exitPermissionMode: 'ESCORT_REQUIRED',
      });
    expect(childRes.status).toBe(201);
    const childId = childRes.body.id;

    // 1. Create initial active MISSING_CHILD SOS alert
    const initialSos = await request(app)
      .post('/api/children/sos')
      .set('Authorization', `Bearer ${resA1Token}`)
      .send({ childId, location: 'Play Area', alertType: 'MISSING_CHILD' });
    expect(initialSos.status).toBe(201);
    const initialAlertId = initialSos.body.alert.id;
    const initialIncidentId = initialSos.body.emergencyIncident.id;

    // 2. Fire concurrent SOS creation AND alert resolution on the exact same child in live PostgreSQL 16
    const [concurrentSos, concurrentResolve] = await Promise.all([
      request(app)
        .post('/api/children/sos')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ childId, location: 'Basement Gate', alertType: 'MISSING_CHILD' }),
      request(app)
        .post(`/api/children/alerts/${initialAlertId}/resolve`)
        .set('Authorization', `Bearer ${guardAToken}`)
        .send({ status: 'RESOLVED', resolutionNotes: 'Found with neighbor' }),
    ]);

    expect(concurrentResolve.status).toBe(200);
    expect([201, 409]).toContain(concurrentSos.status);

    const dbChild = await db.childProfile.findUnique({ where: { id: childId } });
    const dbInitialAlert = await db.childSafetyAlert.findUnique({ where: { id: initialAlertId } });
    const dbInitialIncident = await db.emergencyIncident.findUnique({ where: { id: initialIncidentId } });
    const activeAlerts = await db.childSafetyAlert.findMany({
      where: { childId, alertType: 'MISSING_CHILD', status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } },
    });

    // Initial alert & incident MUST always be RESOLVED
    expect(dbInitialAlert?.status).toBe('RESOLVED');
    expect(dbInitialIncident?.dispatchStatus).toBe('RESOLVED');

    if (concurrentSos.status === 409) {
      // Ordering A: SOS acquired FOR UPDATE first -> rejected duplicate; resolve then cleared child to SAFE
      expect(concurrentSos.body.code).toBe('DUPLICATE_ACTIVE_SOS_ALERT');
      expect(activeAlerts).toHaveLength(0);
      expect(dbChild?.status).toBe('SAFE');
    } else {
      // Ordering B: Resolve acquired FOR UPDATE first -> resolved old alert; SOS then created ONE new active alert
      expect(concurrentSos.status).toBe(201);
      expect(activeAlerts).toHaveLength(1);
      expect(activeAlerts[0].id).toBe(concurrentSos.body.alert.id);
      expect(dbChild?.status).toBe('MISSING');

      // Resolve the newly created alert so we can verify deterministic subsequent SOS creation
      const cleanupResolve = await request(app)
        .post(`/api/children/alerts/${activeAlerts[0].id}/resolve`)
        .set('Authorization', `Bearer ${guardAToken}`)
        .send({ status: 'RESOLVED', resolutionNotes: 'Second alert resolved safely' });
      expect(cleanupResolve.status).toBe(200);
      const childAfterCleanup = await db.childProfile.findUnique({ where: { id: childId } });
      expect(childAfterCleanup?.status).toBe('SAFE');
    }

    // 3. After resolution, a fresh legitimate SOS MUST succeed (201) and persist cleanly
    const freshSos = await request(app)
      .post('/api/children/sos')
      .set('Authorization', `Bearer ${resA1Token}`)
      .send({ childId, location: 'Terrace', alertType: 'MISSING_CHILD' });
    expect(freshSos.status).toBe(201);
    const finalActiveCount = await db.childSafetyAlert.count({
      where: { childId, alertType: 'MISSING_CHILD', status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } },
    });
    expect(finalActiveCount).toBe(1);
  });

  it('F-B22-01A/B/C & F-B22-02A live PG 16 proof: all re-audit exploit paths are blocked with zero data leakage or mutation', async () => {
    await db.$executeRawUnsafe(`
      INSERT INTO users (id, society_id, flat_id, name, email, phone, role, status, created_at, updated_at)
      VALUES
        ('usr-vnd-live', 'soc-a', NULL, 'Live Vendor', 'vl@live.test', '+919100000081', 'vendor', 'ACTIVE', NOW(), NOW()),
        ('usr-fm-live', 'soc-a', NULL, 'Live FM', 'fml@live.test', '+919100000082', 'facility_manager', 'ACTIVE', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `);
    const vendorLiveToken = generateAuthToken({ sub: 'usr-vnd-live', email: 'vl@live.test', role: 'vendor', societyId: 'soc-a', name: 'Live Vendor' });
    const fmLiveToken = generateAuthToken({ sub: 'usr-fm-live', email: 'fml@live.test', role: 'facility_manager', societyId: 'soc-a', name: 'Live FM' });

    await db.$executeRawUnsafe(`
      INSERT INTO entity_records (id, society_id, collection, data, created_at, updated_at)
      VALUES ('live-legacy-child-exploit', 'soc-a', 'child_profiles', '{"fullName":"Protected Legacy Child"}', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `);

    try {
      // 1. F-B22-01A: GET /api/collections/entityRecord & /:id cannot leak child_profiles
      const listAlias = await request(app)
        .get('/api/collections/entityRecord')
        .set('Authorization', `Bearer ${vendorLiveToken}`);
      expect(listAlias.status).toBe(200);
      expect(listAlias.body.some((r: any) => r.id === 'live-legacy-child-exploit')).toBe(false);

      const detailAlias = await request(app)
        .get('/api/collections/entityRecord/live-legacy-child-exploit')
        .set('Authorization', `Bearer ${vendorLiveToken}`);
      expect(detailAlias.status).toBe(403);
      expect(detailAlias.body.code).toBe('CHILD_SAFETY_COLLECTION_FORBIDDEN');

      // 2. F-B22-01B: Vendor blocked from GET /api/collections/emergencyIncident and /api/emergency-incidents
      const vndInc = await request(app)
        .get('/api/collections/emergencyIncident')
        .set('Authorization', `Bearer ${vendorLiveToken}`);
      expect(vndInc.status).toBe(403);
      expect(vndInc.body.code).toBe('INSUFFICIENT_PERMISSIONS');

      const vndDirectInc = await request(app)
        .get('/api/emergency-incidents')
        .set('Authorization', `Bearer ${vendorLiveToken}`);
      expect(vndDirectInc.status).toBe(403);

      // 3. F-B22-01C: Housekeeping, Amenities, and Garbage confirm cannot mutate child_profiles by ID
      const hkPatch = await request(app)
        .patch('/api/housekeeping/tasks/live-legacy-child-exploit')
        .set('Authorization', `Bearer ${fmLiveToken}`)
        .send({ tampered: true });
      expect(hkPatch.status).toBe(404);

      const amCancel = await request(app)
        .post('/api/amenities/bookings/live-legacy-child-exploit/cancel')
        .set('Authorization', `Bearer ${resA1Token}`);
      expect(amCancel.status).toBe(404);

      const garbConfirm = await request(app)
        .post('/api/housekeeping/garbage-logs/confirm')
        .set('Authorization', `Bearer ${resA1Token}`)
        .send({ id: 'live-legacy-child-exploit' });
      expect(garbConfirm.status).toBe(404);

      // Confirm legacy row in PostgreSQL was NEVER mutated
      const intactRow = await db.entityRecord.findUnique({ where: { id: 'live-legacy-child-exploit' } });
      expect((intactRow?.data as any)?.tampered).toBeUndefined();
      expect((intactRow?.data as any)?.status).toBeUndefined();

      // 4. F-B22-02A: Vendor cannot broadcast cross-society CHILD_SAFETY_SOS_TRIGGERED or forge _audience
      const forgedBcast = await request(app)
        .post('/api/realtime/broadcast')
        .set('Authorization', `Bearer ${vendorLiveToken}`)
        .send({
          societyId: 'soc-b',
          eventType: 'CHILD_SAFETY_SOS_TRIGGERED',
          payload: { alertId: 'forged-live', _audience: { allowedRoles: ['vendor'] } },
        });
      expect(forgedBcast.status).toBe(403);
      const forgedCount = await db.outboxEvent.count({
        where: { societyId: 'soc-b', eventType: 'CHILD_SAFETY_SOS_TRIGGERED' },
      });
      expect(forgedCount).toBe(0);
    } finally {
      await db.$executeRawUnsafe(`DELETE FROM entity_records WHERE id = 'live-legacy-child-exploit'`);
    }
  });
});

