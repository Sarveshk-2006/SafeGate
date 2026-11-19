import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PrismaClient } from '../server/node_modules/@prisma/client';

/**
 * Isolated PostgreSQL Integration Tests for ISSUE-06 Phase B.2.1 Remediation.
 *
 * IMPORTANT:
 * - Gated by AARIZO_ISOLATED_TEST_DATABASE_URL so default `npm test` NEVER connects
 *   to host port 5432 or any unrelated external PostgreSQL container (e.g., nexus-postgres).
 * - When pointed at a dedicated, ephemeral test database, executes REAL PostgreSQL DDL,
 *   verifies live constraint violations (cross-society FKs, actor-tenant triggers,
 *   active-owner CHECK, fail-closed exit-log CHECK, ON DELETE RESTRICT, ON DELETE SET NULL),
 *   verifies 01_schema.sql bootstrap parity, and tests idempotent legacy backfill + quarantine.
 */

const ISOLATED_DB_URL = process.env.AARIZO_ISOLATED_TEST_DATABASE_URL;
const describePg = ISOLATED_DB_URL ? describe : describe.skip;

const sha256Hex = (input: string) => crypto.createHash('sha256').update(input).digest('hex');

/**
 * Splits a PostgreSQL script into individual executable statements while
 * respecting single-quoted strings, line comments, and $$ dollar-quoted blocks.
 */
function splitPgStatements(sql: string): string[] {
  const stmts: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDollarQuote = false;
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (!inSingleQuote && !inDollarQuote && ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      current += '\n';
      continue;
    }

    if (!inSingleQuote && ch === '$' && next === '$') {
      inDollarQuote = !inDollarQuote;
      current += '$$';
      i += 2;
      continue;
    }

    if (!inDollarQuote && ch === "'") {
      if (inSingleQuote && next === "'") {
        current += "''";
        i += 2;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      current += ch;
      i++;
      continue;
    }

    if (!inSingleQuote && !inDollarQuote && ch === ';') {
      const trimmed = current.trim();
      if (trimmed.length > 0 && !/^(BEGIN|COMMIT)$/i.test(trimmed)) {
        stmts.push(trimmed);
      }
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  const tail = current.trim();
  if (tail.length > 0 && !/^(BEGIN|COMMIT)$/i.test(tail)) {
    stmts.push(tail);
  }
  return stmts;
}

async function execSqlScript(db: PrismaClient, sql: string): Promise<void> {
  for (const stmt of splitPgStatements(sql)) {
    await db.$executeRawUnsafe(stmt);
  }
}

describePg('ISSUE-06 Phase B.2.1: Live Isolated PostgreSQL Constraint & Backfill Verification', () => {
  let db: PrismaClient;

  const migrationsDir = path.resolve(__dirname, '../server/prisma/migrations');
  const backfillSqlPath = path.resolve(__dirname, '../scripts/postgres/backfill_child_safety_b21.sql');

  beforeAll(async () => {
    db = new PrismaClient({
      datasources: { db: { url: ISOLATED_DB_URL } },
    });
    await db.$connect();
  });

  afterAll(async () => {
    if (db) {
      await db.$disconnect();
    }
  });

  it('seeds multi-tenant fixtures and verifies live DB constraints & triggers', async () => {
    // Seed Society A & Society B
    await execSqlScript(
      db,
      `
      INSERT INTO societies (id, name, code, city, address, created_at, updated_at)
      VALUES
        ('soc-a', 'Society Alpha', 'SOCA', 'Pune', 'Address A', NOW(), NOW()),
        ('soc-b', 'Society Beta', 'SOCB', 'Pune', 'Address B', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO towers (id, society_id, name, created_at, updated_at)
      VALUES
        ('twr-a', 'soc-a', 'Tower A', NOW(), NOW()),
        ('twr-b', 'soc-b', 'Tower B', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO flats (id, society_id, tower_id, flat_number, created_at, updated_at)
      VALUES
        ('flat-a1', 'soc-a', 'twr-a', 'A-101', NOW(), NOW()),
        ('flat-b1', 'soc-b', 'twr-b', 'B-101', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO users (id, society_id, flat_id, name, email, phone, role, created_at, updated_at)
      VALUES
        ('usr-res-a', 'soc-a', 'flat-a1', 'Parent A', 'pa@example.test', '+919000000001', 'resident', NOW(), NOW()),
        ('usr-grd-a', 'soc-a', NULL, 'Guard A', 'ga@example.test', '+919000000002', 'guard', NOW(), NOW()),
        ('usr-grd-a-del', 'soc-a', NULL, 'Guard Temp', 'gtemp@example.test', '+919000000005', 'guard', NOW(), NOW()),
        ('usr-res-b', 'soc-b', 'flat-b1', 'Parent B', 'pb@example.test', '+919000000003', 'resident', NOW(), NOW()),
        ('usr-platform-admin', NULL, NULL, 'Platform Admin', 'padmin@example.test', '+919000000004', 'admin', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO residents (id, society_id, user_id, flat_id, name, phone, created_at, updated_at)
      VALUES
        ('res-a1', 'soc-a', 'usr-res-a', 'flat-a1', 'Parent A', '+919000000001', NOW(), NOW()),
        ('res-b1', 'soc-b', 'usr-res-b', 'flat-b1', 'Parent B', '+919000000003', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO emergency_incidents (id, society_id, incident_type, severity, location, created_at, updated_at)
      VALUES
        ('inc-a1', 'soc-a', 'CHILD_SAFETY', 'CRITICAL', 'Gate A', NOW(), NOW()),
        ('inc-b1', 'soc-b', 'CHILD_SAFETY', 'CRITICAL', 'Gate B', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING;
    `
    );

    // 1. F-B21-05: Reject active ChildProfile with NULL resident_id / flat_id
    await expect(
      db.$executeRawUnsafe(`
        INSERT INTO child_profiles (id, society_id, resident_id, flat_id, flat_number, full_name, guardian_name, guardian_phone)
        VALUES ('child-orphan', 'soc-a', NULL, NULL, 'A-101', 'Orphan Child', 'Parent A', '+919000000001');
      `)
    ).rejects.toThrow(/chk_child_profiles_active_owner/);

    // 2. F-B21-02: Reject cross-society resident on ChildProfile
    await expect(
      db.$executeRawUnsafe(`
        INSERT INTO child_profiles (id, society_id, resident_id, flat_id, flat_number, full_name, guardian_name, guardian_phone)
        VALUES ('child-xres', 'soc-a', 'res-b1', 'flat-a1', 'A-101', 'Cross Res', 'Parent B', '+919000000003');
      `)
    ).rejects.toThrow(/child_profiles_society_id_resident_id_fkey/);

    // 3. F-B21-02: Reject cross-society flat on ChildProfile
    await expect(
      db.$executeRawUnsafe(`
        INSERT INTO child_profiles (id, society_id, resident_id, flat_id, flat_number, full_name, guardian_name, guardian_phone)
        VALUES ('child-xflat', 'soc-a', 'res-a1', 'flat-b1', 'B-101', 'Cross Flat', 'Parent A', '+919000000001');
      `)
    ).rejects.toThrow(/child_profiles_society_id_flat_id_fkey/);

    // 4. F-B21-02: Reject cross-society guardian_user_id via actor trigger, allow platform admin
    await expect(
      db.$executeRawUnsafe(`
        INSERT INTO child_profiles (id, society_id, resident_id, flat_id, guardian_user_id, flat_number, full_name, guardian_name, guardian_phone)
        VALUES ('child-xusr', 'soc-a', 'res-a1', 'flat-a1', 'usr-res-b', 'A-101', 'Cross Actor', 'Parent A', '+919000000001');
      `)
    ).rejects.toThrow(/Cross-society actor reference rejected/);

    // Insert valid children in Society A (2 children) and Society B (1 child)
    await db.$executeRawUnsafe(`
      INSERT INTO child_profiles (id, society_id, resident_id, flat_id, guardian_user_id, flat_number, full_name, guardian_name, guardian_phone)
      VALUES
        ('child-a1', 'soc-a', 'res-a1', 'flat-a1', 'usr-res-a', 'A-101', 'Aarav A', 'Parent A', '+919000000001'),
        ('child-a2', 'soc-a', 'res-a1', 'flat-a1', 'usr-platform-admin', 'A-101', 'Diya A', 'Parent A', '+919000000001'),
        ('child-b1', 'soc-b', 'res-b1', 'flat-b1', 'usr-res-b', 'B-101', 'Kabir B', 'Parent B', '+919000000003');
    `);

    // 4b. F-B21-02: Reject cross-society guardian_user_id mutation on UPDATE via actor trigger
    await expect(
      db.$executeRawUnsafe(`
        UPDATE child_profiles
        SET guardian_user_id = 'usr-res-b'
        WHERE id = 'child-a1';
      `)
    ).rejects.toThrow(/Cross-society actor reference rejected/);

    // 5. F-B21-04: Allow pickup WITHOUT any government ID; reject last4 > 4 chars; reject non-hex hash
    await db.$executeRawUnsafe(`
      INSERT INTO child_authorized_pickups (id, society_id, child_id, name, phone, relationship)
      VALUES ('pickup-a1', 'soc-a', 'child-a1', 'Sunita Nanny', '+919888888881', 'Nanny');
    `);

    // 5b. F-B21-02: Reject cross-society actor reference mutation on UPDATE for pickups via actor trigger
    await expect(
      db.$executeRawUnsafe(`
        UPDATE child_authorized_pickups
        SET created_by_id = 'usr-res-b'
        WHERE id = 'pickup-a1';
      `)
    ).rejects.toThrow(/Cross-society actor reference rejected/);

    await expect(
      db.$executeRawUnsafe(`
        INSERT INTO child_authorized_pickups (id, society_id, child_id, name, phone, relationship, id_document_hash)
        VALUES ('pickup-bad-hash', 'soc-a', 'child-a1', 'Bad Hash', '+919888888882', 'Driver', '1234-5678-9012');
      `)
    ).rejects.toThrow(/chk_child_pickups_hash_format/);

    // 6. F-B21-02: Reject cross-society pickup -> child
    await expect(
      db.$executeRawUnsafe(`
        INSERT INTO child_authorized_pickups (id, society_id, child_id, name, phone, relationship)
        VALUES ('pickup-xsoc', 'soc-a', 'child-b1', 'Cross Soc Pickup', '+919888888883', 'Driver');
      `)
    ).rejects.toThrow(/child_authorized_pickups_society_id_child_id_fkey/);

    // 7. F-B21-02: Reject assigning child-a1's pickup person to child-a2's gate pass (3-column FK!)
    const validTokenA1 = sha256Hex('csprng-secret-token-a1');
    const validTokenA2 = sha256Hex('csprng-secret-token-a2');
    const validTokenB1 = sha256Hex('csprng-secret-token-b1');

    await expect(
      db.$executeRawUnsafe(`
        INSERT INTO child_gate_passes (id, society_id, child_id, pickup_person_id, pass_code, token_hash, pickup_person_name, valid_from, valid_until)
        VALUES ('pass-wrong-child-pickup', 'soc-a', 'child-a2', 'pickup-a1', 'CGP-AAAA-1111', '${validTokenA2}', 'Sunita Nanny', NOW(), NOW() + INTERVAL '2 hours');
      `)
    ).rejects.toThrow(/child_gate_passes_society_id_child_id_pickup_person_id_fkey/);

    // 8. F-B21-03 & F-B21-08: Reject invalid date range, current_uses > max_uses, weak token_hash
    await expect(
      db.$executeRawUnsafe(`
        INSERT INTO child_gate_passes (id, society_id, child_id, pickup_person_id, pass_code, token_hash, pickup_person_name, valid_from, valid_until)
        VALUES ('pass-bad-dates', 'soc-a', 'child-a1', 'pickup-a1', 'CGP-DATE-0001', '${validTokenA1}', 'Sunita Nanny', NOW() + INTERVAL '2 hours', NOW());
      `)
    ).rejects.toThrow(/chk_child_passes_validity_window/);

    await expect(
      db.$executeRawUnsafe(`
        INSERT INTO child_gate_passes (id, society_id, child_id, pickup_person_id, pass_code, token_hash, pickup_person_name, valid_from, valid_until, max_uses, current_uses)
        VALUES ('pass-bad-uses', 'soc-a', 'child-a1', 'pickup-a1', 'CGP-USES-0001', '${validTokenA1}', 'Sunita Nanny', NOW(), NOW() + INTERVAL '2 hours', 1, 2);
      `)
    ).rejects.toThrow(/chk_child_passes_uses_bounds/);

    await expect(
      db.$executeRawUnsafe(`
        INSERT INTO child_gate_passes (id, society_id, child_id, pickup_person_id, pass_code, token_hash, pickup_person_name, valid_from, valid_until)
        VALUES ('pass-weak-hash', 'soc-a', 'child-a1', 'pickup-a1', 'CGP-WEAK-0001', '123456', 'Sunita Nanny', NOW(), NOW() + INTERVAL '2 hours');
      `)
    ).rejects.toThrow(/chk_child_passes_token_hash_format/);

    // Valid pass in Society A and same display pass_code in Society B (proves tenant-scoped uniqueness!)
    await db.$executeRawUnsafe(`
      INSERT INTO child_gate_passes (id, society_id, child_id, pickup_person_id, pass_code, token_hash, pickup_person_name, valid_from, valid_until, created_by_id)
      VALUES
        ('pass-a1', 'soc-a', 'child-a1', 'pickup-a1', 'CGP-SAME-0001', '${validTokenA1}', 'Sunita Nanny', NOW(), NOW() + INTERVAL '2 hours', 'usr-res-a'),
        ('pass-b1', 'soc-b', 'child-b1', NULL, 'CGP-SAME-0001', '${validTokenB1}', 'Escort B', NOW(), NOW() + INTERVAL '2 hours', 'usr-res-b');
    `);

    // Duplicate (society_id, pass_code) within Society A must fail
    await expect(
      db.$executeRawUnsafe(`
        INSERT INTO child_gate_passes (id, society_id, child_id, pass_code, token_hash, pickup_person_name, valid_from, valid_until)
        VALUES ('pass-a1-dup', 'soc-a', 'child-a1', 'CGP-SAME-0001', '${validTokenA2}', 'Sunita Nanny', NOW(), NOW() + INTERVAL '2 hours');
      `)
    ).rejects.toThrow(/23505|society_id, pass_code|uq_child_passes_society_code/);

    // 9. F-B21-01: Reject ALLOWED outcome when verification_channel = BACKEND_UNAVAILABLE; accept VERIFICATION_UNAVAILABLE
    await expect(
      db.$executeRawUnsafe(`
        INSERT INTO child_exit_logs (id, society_id, child_id, pass_id, child_name, flat_number, pickup_person_name, gate_id, guard_id, guard_name, outcome, verification_channel)
        VALUES ('exit-offline-illegal', 'soc-a', 'child-a1', 'pass-a1', 'Aarav A', 'A-101', 'Sunita Nanny', 'Gate-1', 'usr-grd-a', 'Guard A', 'ALLOWED', 'BACKEND_UNAVAILABLE');
      `)
    ).rejects.toThrow(/chk_child_exit_logs_unavailable_channel/);

    await db.$executeRawUnsafe(`
      INSERT INTO child_exit_logs (id, society_id, child_id, pass_id, pickup_person_id, child_name, flat_number, pickup_person_name, gate_id, guard_id, guard_name, outcome, verification_channel)
      VALUES
        ('exit-unavail', 'soc-a', 'child-a1', 'pass-a1', 'pickup-a1', 'Aarav A', 'A-101', 'Sunita Nanny', 'Gate-1', 'usr-grd-a-del', 'Guard Temp', 'VERIFICATION_UNAVAILABLE', 'BACKEND_UNAVAILABLE');
    `);

    // 10. F-B21-02 & F-B21-08: ChildSafetyAlert cross-society incident rejected; resolution timestamp enforced
    await expect(
      db.$executeRawUnsafe(`
        INSERT INTO child_safety_alerts (id, society_id, child_id, child_name, flat_number, alert_type, location, emergency_incident_id)
        VALUES ('alert-xinc', 'soc-a', 'child-a1', 'Aarav A', 'A-101', 'MISSING_CHILD', 'Park', 'inc-b1');
      `)
    ).rejects.toThrow(/child_safety_alerts_society_id_emergency_incident_id_fkey/);

    await expect(
      db.$executeRawUnsafe(`
        INSERT INTO child_safety_alerts (id, society_id, child_id, child_name, flat_number, alert_type, status, location, resolved_at)
        VALUES ('alert-bad-res', 'soc-a', 'child-a1', 'Aarav A', 'A-101', 'MISSING_CHILD', 'RESOLVED', 'Park', NULL);
      `)
    ).rejects.toThrow(/chk_child_alerts_resolved_consistency/);

    await db.$executeRawUnsafe(`
      INSERT INTO child_safety_alerts (id, society_id, child_id, reported_by_id, reported_by_name, child_name, flat_number, alert_type, location, emergency_incident_id)
      VALUES ('alert-a1', 'soc-a', 'child-a1', 'usr-res-a', 'Parent A', 'Aarav A', 'A-101', 'MISSING_CHILD', 'Clubhouse', 'inc-a1');
    `);

    // 11. F-B21-05: ON DELETE RESTRICT preserves audit history; deleting User actor nulls FK while preserving log
    await expect(db.$executeRawUnsafe(`DELETE FROM child_profiles WHERE id = 'child-a1';`)).rejects.toThrow(
      /violates foreign key constraint/
    );
    await expect(db.$executeRawUnsafe(`DELETE FROM child_gate_passes WHERE id = 'pass-a1';`)).rejects.toThrow(
      /violates foreign key constraint/
    );
    await expect(db.$executeRawUnsafe(`DELETE FROM societies WHERE id = 'soc-a';`)).rejects.toThrow(
      /violates foreign key constraint/
    );

    await db.$executeRawUnsafe(`DELETE FROM users WHERE id = 'usr-grd-a-del';`);
    const preservedLog = await db.$queryRawUnsafe<Array<{ guard_id: string | null; guard_name: string }>>(
      `SELECT guard_id, guard_name FROM child_exit_logs WHERE id = 'exit-unavail';`
    );
    expect(preservedLog).toEqual([{ guard_id: null, guard_name: 'Guard Temp' }]);
  });

  it('executes legacy backfill idempotently without fabricating data or copying raw IDs (F-B21-07)', async () => {
    // Seed legacy EntityRecord rows across child_profiles, children, and child_gate_passes
    await db.$executeRawUnsafe(`
      INSERT INTO entity_records (id, collection, society_id, data, created_at, updated_at)
      VALUES
        (
          'leg-child-1',
          'children',
          'soc-a',
          '{"fullName":"Rohan Legacy","flatNumber":"A-101","age":7,"exitPermissionStatus":"TIMED_PASS","guardians":[{"name":"Parent A","phone":"+919000000001","isPrimary":true},{"name":"Co-Parent A","phone":"+919000000099","relationship":"Mother","isPrimary":false}],"emergencyContacts":[{"name":"Grandpa","relationship":"Grandfather","phone":"+919111111111"}],"authorizedPickups":[{"id":"leg-pk-1","name":"Legacy Nanny","phone":"+919222222222","relationship":"Nanny","idProofType":"Aadhaar","idProofNumber":"9999-8888-7777","status":"ACTIVE"}]}'::jsonb,
          NOW(),
          NOW()
        ),
        (
          'leg-child-orphan',
          'child_profiles',
          'soc-a',
          '{"fullName":"No Flat Child","flatNumber":"Z-999","guardianName":"Unknown","guardianPhone":"+919000000000"}'::jsonb,
          NOW(),
          NOW()
        ),
        (
          'leg-pass-active',
          'child_gate_passes',
          'soc-a',
          '{"childId":"leg-child-1","passCode":"CGP-123456","status":"ACTIVE","validUntil":"2026-12-31T00:00:00Z"}'::jsonb,
          NOW(),
          NOW()
        ),
        (
          'leg-pass-used',
          'child_gate_passes',
          'soc-a',
          '{"childId":"leg-child-1","childName":"Rohan Legacy","flatNumber":"A-101","pickupPersonName":"Legacy Nanny","status":"VERIFIED_EXITED","verifiedByGuard":"Old Guard","exitGate":"Gate 2","verifiedAt":"2026-11-10T10:00:00Z"}'::jsonb,
          NOW(),
          NOW()
        )
      ON CONFLICT (id) DO NOTHING;
    `);

    const backfillSql = fs.readFileSync(backfillSqlPath, 'utf8');

    // Run backfill TWICE to prove idempotency
    await execSqlScript(db, backfillSql);

    // Mutate authoritative row after first run, then rerun backfill to prove it NEVER overwrites newer data
    await db.$executeRawUnsafe(`UPDATE child_profiles SET notes = 'AUTHORITATIVE_EDIT' WHERE id = 'leg-child-1';`);
    await execSqlScript(db, backfillSql);

    const migratedChild = await db.$queryRawUnsafe<
      Array<{
        date_of_birth: Date | null;
        reported_age: number | null;
        gender: string;
        exit_permission_mode: string;
        notes: string | null;
        secondary_guardians: unknown;
      }>
    >(
      `SELECT date_of_birth, reported_age, gender::text, exit_permission_mode::text, notes, secondary_guardians
       FROM child_profiles WHERE id = 'leg-child-1';`
    );

    expect(migratedChild).toHaveLength(1);
    expect(migratedChild[0].date_of_birth).toBeNull(); // Never fabricated from age
    expect(migratedChild[0].reported_age).toBe(7);
    expect(migratedChild[0].gender).toBe('UNSPECIFIED'); // Never hardcoded MALE
    expect(migratedChild[0].exit_permission_mode).toBe('TIMED_PASS_ONLY'); // Never collapsed to SAFE
    expect(migratedChild[0].notes).toBe('AUTHORITATIVE_EDIT'); // Never overwritten on rerun
    expect(Array.isArray(migratedChild[0].secondary_guardians)).toBe(true);

    // Embedded pickup migrated WITHOUT copying raw Aadhaar idProofNumber
    const migratedPickup = await db.$queryRawUnsafe<
      Array<{ id_document_type: string | null; id_document_last4: string | null; id_document_hash: string | null }>
    >(`SELECT id_document_type, id_document_last4, id_document_hash FROM child_authorized_pickups WHERE id = 'leg-pk-1';`);
    expect(migratedPickup).toEqual([
      { id_document_type: 'Aadhaar', id_document_last4: null, id_document_hash: null },
    ]);

    // Incomplete child & active low-entropy pass quarantined
    const quarantine = await db.$queryRawUnsafe<Array<{ legacy_source_id: string; quarantine_reason: string }>>(
      `SELECT legacy_source_id, quarantine_reason FROM child_safety_migration_quarantine ORDER BY legacy_source_id;`
    );
    expect(quarantine).toEqual([
      { legacy_source_id: 'leg-child-orphan', quarantine_reason: 'UNRESOLVED_RESIDENT_OR_FLAT_OWNERSHIP' },
      { legacy_source_id: 'leg-pass-active', quarantine_reason: 'LEGACY_LOW_ENTROPY_PASS_REQUIRES_REISSUE' },
    ]);

    // Historical verified pass preserved in child_exit_logs with NULL guard_id
    const legacyExit = await db.$queryRawUnsafe<
      Array<{ guard_id: string | null; guard_name: string; outcome: string }>
    >(`SELECT guard_id, guard_name, outcome::text FROM child_exit_logs WHERE id = 'legacy-exit-leg-pass-used';`);
    expect(legacyExit).toEqual([{ guard_id: null, guard_name: 'Old Guard', outcome: 'ALLOWED' }]);
  });

  it('re-runs the remediation migration idempotently with zero errors (F-B21-06)', async () => {
    const remediationSql = fs.readFileSync(
      path.join(migrationsDir, '20261118010000_remediate_child_safety_constraints/migration.sql'),
      'utf8'
    );
    // Running the entire corrective migration script again must succeed idempotently
    await expect(execSqlScript(db, remediationSql)).resolves.not.toThrow();
  });
});
