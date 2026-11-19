import fs from 'fs';
import path from 'path';
import { Prisma } from '../server/node_modules/@prisma/client';
import { prisma } from '../server/src/prisma';

function extractSqlTableColumns(sql: string, tableName: string): Record<string, { raw: string; notNull: boolean }> {
  const regex = new RegExp(`CREATE TABLE IF NOT EXISTS\\s+"?${tableName}"?\\s*\\(([\\s\\S]*?)\\n\\);`, 'i');
  const match = sql.match(regex);
  if (!match) {
    throw new Error(`Table ${tableName} not found in SQL file`);
  }
  const body = match[1];
  const columns: Record<string, { raw: string; notNull: boolean }> = {};
  for (const rawLine of body.split('\n')) {
    const line = rawLine.replace(/--.*$/, '').trim().replace(/,$/, '');
    if (!line || /^CONSTRAINT\b/i.test(line) || /^PRIMARY\s+KEY\b/i.test(line) || /^UNIQUE\b/i.test(line)) {
      continue;
    }
    const colMatch = line.match(/^"?([a-z_][a-z0-9_]*)"?\s+(.+)$/i);
    if (!colMatch) continue;
    const colName = colMatch[1];
    const colDef = colMatch[2];
    const isPk = /\bPRIMARY\s+KEY\b/i.test(colDef);
    const notNull = isPk || /\bNOT\s+NULL\b/i.test(colDef);
    columns[colName] = { raw: colDef, notNull };
  }
  return columns;
}

describe('ISSUE-06 Phase B.2.1 (Remediated): Child Safety Schema, DMMF & SQL Parity Validation', () => {
  const schemaPath = path.resolve(__dirname, '../server/prisma/schema.prisma');
  const initialMigrationPath = path.resolve(
    __dirname,
    '../server/prisma/migrations/20261118000000_add_child_safety_models/migration.sql'
  );
  const remediationMigrationPath = path.resolve(
    __dirname,
    '../server/prisma/migrations/20261118010000_remediate_child_safety_constraints/migration.sql'
  );
  const sqlSchemaPath = path.resolve(__dirname, '../scripts/postgres/01_schema.sql');
  const backfillScriptPath = path.resolve(__dirname, '../scripts/postgres/backfill_child_safety_b21.sql');

  let schemaContent: string;
  let initialMigrationContent: string;
  let remediationMigrationContent: string;
  let sqlSchemaContent: string;
  let backfillContent: string;

  const getDmmfModel = (name: string) => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === name);
    expect(model).toBeDefined();
    return model!;
  };

  const getDmmfEnum = (name: string) => {
    const e = Prisma.dmmf.datamodel.enums.find((en) => en.name === name);
    expect(e).toBeDefined();
    return e!;
  };

  beforeAll(() => {
    schemaContent = fs.readFileSync(schemaPath, 'utf8');
    initialMigrationContent = fs.readFileSync(initialMigrationPath, 'utf8');
    remediationMigrationContent = fs.readFileSync(remediationMigrationPath, 'utf8');
    sqlSchemaContent = fs.readFileSync(sqlSchemaPath, 'utf8');
    backfillContent = fs.readFileSync(backfillScriptPath, 'utf8');
  });

  describe('1. Prisma Client Delegates & DMMF Model Registration', () => {
    it('exposes all 5 Child Safety model delegates on prisma client', () => {
      expect(prisma.childProfile).toBeDefined();
      expect(prisma.childAuthorizedPickup).toBeDefined();
      expect(prisma.childGatePass).toBeDefined();
      expect(prisma.childExitLog).toBeDefined();
      expect(prisma.childSafetyAlert).toBeDefined();
    });

    it('registers all 10 Child Safety enums plus IncidentSeverity with exact states (F-B21-08)', () => {
      expect(getDmmfEnum('ChildGender').values.map((v) => v.name)).toEqual([
        'MALE',
        'FEMALE',
        'OTHER',
        'UNSPECIFIED',
      ]);
      expect(getDmmfEnum('ChildStatus').values.map((v) => v.name)).toEqual([
        'SAFE',
        'OUT_OF_SOCIETY',
        'MISSING',
        'ARCHIVED',
      ]);
      expect(getDmmfEnum('ChildExitPermissionMode').values.map((v) => v.name)).toEqual([
        'ESCORT_REQUIRED',
        'SOLO_ALLOWED',
        'TIMED_PASS_ONLY',
        'UNKNOWN',
      ]);
      expect(getDmmfEnum('PickupAuthorizationStatus').values.map((v) => v.name)).toEqual([
        'ACTIVE',
        'REVOKED',
        'EXPIRED',
        'ARCHIVED',
      ]);
      expect(getDmmfEnum('PickupIdVerificationStatus').values.map((v) => v.name)).toEqual([
        'NOT_COLLECTED',
        'UNVERIFIED',
        'PENDING_REVIEW',
        'VERIFIED',
        'REJECTED',
      ]);
      expect(getDmmfEnum('ChildGatePassStatus').values.map((v) => v.name)).toEqual([
        'ACTIVE',
        'USED',
        'EXPIRED',
        'REVOKED',
        'ARCHIVED',
      ]);
      expect(getDmmfEnum('ChildExitOutcome').values.map((v) => v.name)).toEqual([
        'ALLOWED',
        'DENIED',
        'MISSING_ALERT_BLOCKED',
        'VERIFICATION_UNAVAILABLE',
      ]);
      expect(getDmmfEnum('ChildVerificationChannel').values.map((v) => v.name)).toEqual([
        'ONLINE_QR_TOKEN',
        'ONLINE_PASS_CODE_ASSISTED',
        'MANUAL_OVERRIDE_DENIED',
        'BACKEND_UNAVAILABLE',
      ]);
      expect(getDmmfEnum('ChildAlertType').values.map((v) => v.name)).toEqual([
        'MISSING_CHILD',
        'UNATTENDED_CHILD',
        'UNAUTHORIZED_EXIT_ATTEMPT',
        'EMERGENCY_SOS',
      ]);
      expect(getDmmfEnum('ChildAlertStatus').values.map((v) => v.name)).toEqual([
        'ACTIVE',
        'ACKNOWLEDGED',
        'RESOLVED',
        'FALSE_ALARM',
      ]);

      const alertModel = getDmmfModel('ChildSafetyAlert');
      const severityField = alertModel.fields.find((f) => f.name === 'severity');
      expect(severityField?.kind).toBe('enum');
      expect(severityField?.type).toBe('IncidentSeverity');
    });
  });

  describe('2. F-B21-01: Complete Removal of Offline Pass Authorization & HMAC Secrets', () => {
    it('removes signature field from ChildGatePass DMMF and prohibits offline enum values', () => {
      const passModel = getDmmfModel('ChildGatePass');
      const passFieldNames = passModel.fields.map((f) => f.name);
      expect(passFieldNames).not.toContain('signature');
      expect(passFieldNames).toContain('tokenHash');

      const exitOutcomes = getDmmfEnum('ChildExitOutcome').values.map((v) => v.name);
      expect(exitOutcomes).not.toContain('OFFLINE_VERIFIED');
      expect(exitOutcomes).toContain('VERIFICATION_UNAVAILABLE');

      const channels = getDmmfEnum('ChildVerificationChannel').values.map((v) => v.name);
      expect(channels).not.toContain('OFFLINE_HMAC');
      expect(channels).toContain('BACKEND_UNAVAILABLE');
    });

    it('contains zero OFFLINE_VERIFIED or OFFLINE_HMAC states in schema.prisma and 01_schema.sql', () => {
      expect(schemaContent).not.toContain('OFFLINE_VERIFIED');
      expect(schemaContent).not.toContain('OFFLINE_HMAC');
      expect(sqlSchemaContent).not.toContain('OFFLINE_VERIFIED');
      expect(sqlSchemaContent).not.toContain('OFFLINE_HMAC');
      expect(remediationMigrationContent).toContain('DROP COLUMN IF EXISTS "signature"');
      expect(remediationMigrationContent).toContain('chk_child_exit_logs_unavailable_channel');
      expect(sqlSchemaContent).toContain('chk_child_exit_logs_unavailable_channel');
    });
  });

  describe('3. F-B21-02: Cross-Society Relational Integrity (Composite Unique & Composite FKs)', () => {
    it('defines composite [societyId, id] unique constraints on parent and child models', () => {
      for (const modelName of [
        'Flat',
        'Resident',
        'EmergencyIncident',
        'ChildProfile',
        'ChildAuthorizedPickup',
        'ChildGatePass',
      ]) {
        const model = getDmmfModel(modelName);
        const hasCompositeSocietyId = model.uniqueFields.some(
          (fields) => fields.length === 2 && fields[0] === 'societyId' && fields[1] === 'id'
        );
        expect(hasCompositeSocietyId).toBe(true);
      }

      const pickupModel = getDmmfModel('ChildAuthorizedPickup');
      const hasTripleUnique = pickupModel.uniqueFields.some(
        (fields) =>
          fields.length === 3 &&
          fields[0] === 'societyId' &&
          fields[1] === 'childId' &&
          fields[2] === 'id'
      );
      expect(hasTripleUnique).toBe(true);
    });

    it('uses composite tenant-scoped foreign keys across all 5 child-safety models', () => {
      const checkCompositeRelation = (
        modelName: string,
        relationName: string,
        expectedFrom: string[],
        expectedTo: string[]
      ) => {
        const model = getDmmfModel(modelName);
        const rel = model.fields.find((f) => f.name === relationName && f.kind === 'object');
        expect(rel).toBeDefined();
        expect(rel?.relationFromFields).toEqual(expectedFrom);
        expect(rel?.relationToFields).toEqual(expectedTo);
      };

      checkCompositeRelation('ChildProfile', 'resident', ['societyId', 'residentId'], ['societyId', 'id']);
      checkCompositeRelation('ChildProfile', 'flat', ['societyId', 'flatId'], ['societyId', 'id']);
      checkCompositeRelation('ChildAuthorizedPickup', 'child', ['societyId', 'childId'], ['societyId', 'id']);
      checkCompositeRelation('ChildGatePass', 'child', ['societyId', 'childId'], ['societyId', 'id']);
      checkCompositeRelation(
        'ChildGatePass',
        'pickupPerson',
        ['societyId', 'childId', 'pickupPersonId'],
        ['societyId', 'childId', 'id']
      );
      checkCompositeRelation('ChildExitLog', 'child', ['societyId', 'childId'], ['societyId', 'id']);
      checkCompositeRelation('ChildExitLog', 'pass', ['societyId', 'passId'], ['societyId', 'id']);
      checkCompositeRelation('ChildExitLog', 'pickupPerson', ['societyId', 'pickupPersonId'], ['societyId', 'id']);
      checkCompositeRelation('ChildSafetyAlert', 'child', ['societyId', 'childId'], ['societyId', 'id']);
      checkCompositeRelation(
        'ChildSafetyAlert',
        'incident',
        ['societyId', 'emergencyIncidentId'],
        ['societyId', 'id']
      );
    });

    it('installs cross-society actor validation triggers in both migration and 01_schema.sql', () => {
      expect(remediationMigrationContent).toContain('CREATE OR REPLACE FUNCTION enforce_child_safety_actor_tenant()');
      expect(sqlSchemaContent).toContain('CREATE OR REPLACE FUNCTION enforce_child_safety_actor_tenant()');
      for (const trg of [
        'trg_child_profiles_actor_tenant',
        'trg_child_pickups_actor_tenant',
        'trg_child_passes_actor_tenant',
        'trg_child_exit_logs_actor_tenant',
        'trg_child_alerts_actor_tenant',
      ]) {
        expect(remediationMigrationContent).toContain(trg);
        expect(sqlSchemaContent).toContain(trg);
      }
    });
  });

  describe('4. F-B21-03: Pass Code vs Bearer Token Authorization Design', () => {
    it('scopes passCode uniqueness per society, preserves unique tokenHash, and removes redundant index', () => {
      const passModel = getDmmfModel('ChildGatePass');
      const passCodeField = passModel.fields.find((f) => f.name === 'passCode');
      const tokenHashField = passModel.fields.find((f) => f.name === 'tokenHash');

      expect(passCodeField?.isUnique).toBe(false);
      expect(tokenHashField?.isUnique).toBe(true);

      const hasSocietyPassCodeUnique = passModel.uniqueFields.some(
        (fields) => fields.length === 2 && fields[0] === 'societyId' && fields[1] === 'passCode'
      );
      expect(hasSocietyPassCodeUnique).toBe(true);

      expect(schemaContent).not.toContain('idx_child_passes_code');
      expect(sqlSchemaContent).not.toContain('idx_child_passes_code');
      expect(remediationMigrationContent).toContain('DROP INDEX IF EXISTS "idx_child_passes_code"');
      expect(remediationMigrationContent).toContain('DROP INDEX IF EXISTS "child_gate_passes_pass_code_key"');
      expect(remediationMigrationContent).toContain('chk_child_passes_token_hash_format');
      expect(sqlSchemaContent).toContain('chk_child_passes_token_hash_format');
    });
  });

  describe('5. F-B21-04: Identity Document Data Minimization', () => {
    it('removes mandatory plaintext idProofNumber and enforces optional minimal verification metadata', () => {
      const pickupModel = getDmmfModel('ChildAuthorizedPickup');
      const fieldNames = pickupModel.fields.map((f) => f.name);
      expect(fieldNames).not.toContain('idProofNumber');
      expect(fieldNames).not.toContain('idProofType');

      const docType = pickupModel.fields.find((f) => f.name === 'idDocumentType');
      const docLast4 = pickupModel.fields.find((f) => f.name === 'idDocumentLast4');
      const docHash = pickupModel.fields.find((f) => f.name === 'idDocumentHash');
      const verStatus = pickupModel.fields.find((f) => f.name === 'idVerificationStatus');

      expect(docType?.isRequired).toBe(false);
      expect(docLast4?.isRequired).toBe(false);
      expect(docHash?.isRequired).toBe(false);
      expect(verStatus?.default).toBe('NOT_COLLECTED');

      expect(remediationMigrationContent).toContain('DROP COLUMN IF EXISTS "id_proof_number"');
      const pickupCols = extractSqlTableColumns(sqlSchemaContent, 'child_authorized_pickups');
      expect(pickupCols).not.toHaveProperty('id_proof_number');
      expect(pickupCols).not.toHaveProperty('id_proof_type');
      expect(pickupCols).toHaveProperty('id_document_type');
      expect(pickupCols).toHaveProperty('id_document_last4');
      expect(pickupCols).toHaveProperty('id_document_hash');
      expect(pickupCols).toHaveProperty('id_verification_status');
      expect(pickupCols.id_document_type.notNull).toBe(false);
      expect(pickupCols.id_document_last4.notNull).toBe(false);
      expect(pickupCols.id_document_hash.notNull).toBe(false);
    });
  });

  describe('6. F-B21-05 & F-B21-08: Audit Retention, Ownership & Actor Relations', () => {
    it('uses Restrict (zero Cascade) on all domain/tenant relations and SetNull on all User actor relations', () => {
      const restrictChecks: Array<[string, string]> = [
        ['ChildProfile', 'society'],
        ['ChildProfile', 'resident'],
        ['ChildProfile', 'flat'],
        ['ChildAuthorizedPickup', 'society'],
        ['ChildAuthorizedPickup', 'child'],
        ['ChildGatePass', 'society'],
        ['ChildGatePass', 'child'],
        ['ChildGatePass', 'pickupPerson'],
        ['ChildExitLog', 'society'],
        ['ChildExitLog', 'child'],
        ['ChildExitLog', 'pass'],
        ['ChildExitLog', 'pickupPerson'],
        ['ChildSafetyAlert', 'society'],
        ['ChildSafetyAlert', 'child'],
        ['ChildSafetyAlert', 'incident'],
      ];

      for (const [modelName, relName] of restrictChecks) {
        const model = getDmmfModel(modelName);
        const rel = model.fields.find((f) => f.name === relName && f.kind === 'object');
        expect(rel?.relationOnDelete).toBe('Restrict');
      }

      const actorSetNullChecks: Array<[string, string, string]> = [
        ['ChildProfile', 'guardianUser', 'guardianUserId'],
        ['ChildProfile', 'archivedBy', 'archivedById'],
        ['ChildAuthorizedPickup', 'createdBy', 'createdById'],
        ['ChildAuthorizedPickup', 'verifiedBy', 'verifiedById'],
        ['ChildGatePass', 'createdBy', 'createdById'],
        ['ChildGatePass', 'revokedBy', 'revokedById'],
        ['ChildExitLog', 'guard', 'guardId'],
        ['ChildSafetyAlert', 'reportedBy', 'reportedById'],
        ['ChildSafetyAlert', 'acknowledgedBy', 'acknowledgedById'],
        ['ChildSafetyAlert', 'resolvedBy', 'resolvedById'],
      ];

      for (const [modelName, relName, fkFieldName] of actorSetNullChecks) {
        const model = getDmmfModel(modelName);
        const rel = model.fields.find((f) => f.name === relName && f.kind === 'object');
        const fkField = model.fields.find((f) => f.name === fkFieldName);
        expect(rel?.relationOnDelete).toBe('SetNull');
        expect(fkField?.isRequired).toBe(false);
      }
    });

    it('includes soft-delete archivedAt on mutable domain models and active-owner CHECK constraint', () => {
      for (const modelName of ['ChildProfile', 'ChildAuthorizedPickup', 'ChildGatePass']) {
        const model = getDmmfModel(modelName);
        const archivedAt = model.fields.find((f) => f.name === 'archivedAt');
        expect(archivedAt).toBeDefined();
        expect(archivedAt?.isRequired).toBe(false);
      }

      expect(remediationMigrationContent).toContain('chk_child_profiles_active_owner');
      expect(sqlSchemaContent).toContain('chk_child_profiles_active_owner');
    });
  });

  describe('7. F-B21-06: Structured Column, Constraint & Namespace Parity (Prisma vs Migration vs 01_schema.sql)', () => {
    const modelTablePairs: Array<[string, string]> = [
      ['ChildProfile', 'child_profiles'],
      ['ChildAuthorizedPickup', 'child_authorized_pickups'],
      ['ChildGatePass', 'child_gate_passes'],
      ['ChildExitLog', 'child_exit_logs'],
      ['ChildSafetyAlert', 'child_safety_alerts'],
    ];

    it('matches every scalar column name and NOT NULL constraint between Prisma DMMF and scripts/postgres/01_schema.sql', () => {
      for (const [modelName, tableName] of modelTablePairs) {
        const model = getDmmfModel(modelName);
        const sqlCols = extractSqlTableColumns(sqlSchemaContent, tableName);

        const dmmfScalars = model.fields.filter((f) => f.kind === 'scalar' || f.kind === 'enum');
        const dmmfColNames = dmmfScalars.map((f) => f.dbName || f.name).sort();
        const sqlColNames = Object.keys(sqlCols).sort();

        expect(sqlColNames).toEqual(dmmfColNames);

        for (const field of dmmfScalars) {
          const colName = field.dbName || field.name;
          expect(sqlCols[colName].notNull).toBe(field.isRequired);
        }
      }
    });

    it('defines identical CHECK constraints across remediation migration and 01_schema.sql', () => {
      const expectedChecks = [
        'chk_child_profiles_active_owner',
        'chk_child_profiles_archive_consistency',
        'chk_child_profiles_reported_age',
        'chk_child_profiles_dob_not_future',
        'chk_child_pickups_archive_consistency',
        'chk_child_pickups_last4_len',
        'chk_child_pickups_hash_format',
        'chk_child_passes_validity_window',
        'chk_child_passes_max_uses_positive',
        'chk_child_passes_uses_bounds',
        'chk_child_passes_token_hash_format',
        'chk_child_passes_archive_consistency',
        'chk_child_passes_revoke_consistency',
        'chk_child_exit_logs_unavailable_channel',
        'chk_child_alerts_ack_consistency',
        'chk_child_alerts_resolved_consistency',
      ];

      for (const chk of expectedChecks) {
        expect(remediationMigrationContent).toContain(chk);
        expect(sqlSchemaContent).toContain(chk);
      }
    });

    it('uses schema-aware and table-aware pg_constraint guards in the remediation migration', () => {
      expect(initialMigrationContent).toContain('CREATE TABLE IF NOT EXISTS "child_profiles"');
      expect(remediationMigrationContent).toContain('c.connamespace = current_schema()::regnamespace');
      expect(remediationMigrationContent).toContain("c.conrelid = to_regclass(format('%I.%I', current_schema(),");
      expect(remediationMigrationContent).toContain('TIMESTAMPTZ(3)');
      expect(sqlSchemaContent).toContain('TIMESTAMPTZ(3)');
    });
  });

  describe('8. F-B21-07: Safe Legacy Backfill & Quarantine Strategy Verification', () => {
    it('covers all legacy sources without fabricating personal data or deleting legacy rows', () => {
      expect(backfillContent).toContain('child_safety_migration_quarantine');
      expect(backfillContent).toContain("'child_safety'");
      expect(backfillContent).toContain("'child_profiles', 'children'");
      expect(backfillContent).toContain("'child_gate_passes'");
      expect(backfillContent).toContain('authorizedPickups');
      expect(backfillContent).toContain("'UNSPECIFIED'::child_gender");
      expect(backfillContent).toContain('LEGACY_LOW_ENTROPY_PASS_REQUIRES_REISSUE');
      expect(backfillContent).toContain('DUPLICATE_PRIMARY_KEY');
      expect(backfillContent).toContain('MALFORMED_PICKUP_JSON');
      expect(backfillContent).toContain('ON CONFLICT');
      expect(backfillContent).not.toMatch(/DELETE\s+FROM\s+(child_safety|entity_records)/i);
      expect(backfillContent).not.toContain("'MALE' AS gender");
      expect(backfillContent).not.toMatch(/INTERVAL\s+'1 year'/i);
    });
  });
});
