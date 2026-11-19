import { Router, Request, Response } from 'express';
import { prisma } from '../prisma.js';
import { realtimeEngine, EventAudiencePolicy } from '../realtimeEngine.js';
import {
  resolveChildSafetyActor,
  enforceAllowedRoles,
  resolveResidentOwnership,
  authorizeChildAccess,
  ResolvedChildSafetyActor,
} from './authz.js';
import {
  generateChildPassBearerToken,
  hashChildPassToken,
  verifyChildPassTokenConstantTime,
  generateDisplayPassCode,
  encodeChildPassQrPayload,
  extractBearerToken,
} from './crypto.js';
import {
  childPassVerifyRateLimiter,
  childPassCreateRateLimiter,
  childSosRateLimiter,
} from './rateLimit.js';
import {
  ALLOWED_CHILD_GENDERS,
  ALLOWED_CHILD_STATUSES,
  ALLOWED_EXIT_PERMISSION_MODES,
  ALLOWED_PICKUP_STATUSES,
  ALLOWED_ALERT_TYPES,
  ALLOWED_INCIDENT_SEVERITIES,
  ALLOWED_ALERT_RESOLVE_STATUSES,
  isNonEmptyString,
  isValidPhoneNumber,
  normalizeOptionalString,
  parseIsoDate,
  hasForbiddenRawIdField,
  validateContactList,
  isDatabaseUnavailableError,
  handleChildSafetyError,
  sanitizeChildProfileDto,
  sanitizePickupDto,
  sanitizeGatePassDto,
  sanitizeExitLogDto,
  sanitizeSafetyAlertDto,
} from './validation.js';

export const childSafetyRouter = Router();

const MAX_PASS_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days upper bound
const PROFILE_READ_ROLES = ['resident', 'secretary', 'committee', 'admin'] as const;
const PROFILE_WRITE_ROLES = ['resident', 'secretary', 'admin'] as const;
const PASS_READ_ROLES = ['resident', 'guard', 'secretary', 'committee', 'admin'] as const;
const PASS_WRITE_ROLES = ['resident', 'secretary', 'admin'] as const;
const GATE_VERIFY_ROLES = ['guard', 'admin'] as const;
const SOS_TRIGGER_ROLES = ['resident', 'guard', 'secretary', 'committee', 'admin'] as const;
const SOS_MANAGE_ROLES = ['guard', 'secretary', 'committee', 'admin'] as const;

const PROFILE_EVENT_ROLES = ['secretary', 'committee', 'admin'];
const GATE_AND_SOS_EVENT_ROLES = ['guard', 'secretary', 'committee', 'admin'];

function collectOwnerUserIds(...candidates: Array<string | null | undefined>): string[] {
  const unique = new Set<string>();
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) {
      unique.add(c.trim());
    }
  }
  return Array.from(unique);
}

/**
 * Acquires a PostgreSQL row-level `FOR UPDATE` lock on `child_profiles` inside an active transaction,
 * serializing concurrent SOS (`MISSING_CHILD`) and gate-pass verification operations on the same child.
 * Returns the freshly locked `{ status, archivedAt }` when running on live PostgreSQL, or `null` in mocked-tx unit tests.
 */
async function lockChildProfileRow(
  tx: any,
  childId: string,
  societyId: string
): Promise<{ status: string; archivedAt: Date | null } | null> {
  if (typeof tx.$queryRaw !== 'function') {
    return null;
  }
  const rows = await tx.$queryRaw<Array<{ status: string; archived_at: Date | null }>>`
    SELECT status::text AS status, archived_at
    FROM child_profiles
    WHERE id = ${childId} AND society_id = ${societyId}
    FOR UPDATE
  `;
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }
  return {
    status: rows[0].status,
    archivedAt: rows[0].archived_at ?? null,
  };
}

/**
 * Emits a strictly society-scoped, audience-filtered realtime event AFTER a database write/transaction commits.
 * Never broadcasts raw bearer tokens, token hashes, identity documents, or unnecessary child PII.
 */
async function emitChildSafetyEvent(
  societyId: string,
  eventType: string,
  entityId: string,
  actorId: string,
  payload: Record<string, unknown>,
  audience: EventAudiencePolicy
): Promise<void> {
  if (!societyId || societyId === '*') return;
  try {
    await realtimeEngine.recordOutboxEvent({
      societyId,
      eventType,
      entityId,
      actorId,
      payload: {
        ...payload,
        societyId,
      },
      audience,
    });
  } catch {
    realtimeEngine.broadcastToSociety(
      societyId,
      eventType,
      {
        ...payload,
        entityId,
        societyId,
        timestamp: new Date().toISOString(),
      },
      undefined,
      audience
    );
  }
}

// =============================================================================
// 1. CHILD GATE PASSES & GATE VERIFICATION (Static routes first)
// =============================================================================

/**
 * GET /api/children/passes
 * Lists child gate passes within authorized tenant & ownership scope.
 * Never exposes `tokenHash` or raw bearer tokens.
 */
childSafetyRouter.get('/passes', async (req: Request, res: Response) => {
  const actor = resolveChildSafetyActor(req, res, { requireConcreteSociety: false });
  if (!actor) return;
  if (!enforceAllowedRoles(actor, PASS_READ_ROLES, res)) return;

  try {
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 100), 200);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const where: any = {};

    if (!actor.isPlatformAdmin || actor.societyId) {
      where.societyId = actor.societyId;
    }

    if (typeof req.query.childId === 'string' && req.query.childId.trim()) {
      where.childId = req.query.childId.trim();
    }

    if (typeof req.query.status === 'string' && req.query.status.trim()) {
      const requestedStatus = req.query.status.trim().toUpperCase();
      if (!['ACTIVE', 'USED', 'EXPIRED', 'REVOKED', 'ARCHIVED'].includes(requestedStatus)) {
        return res.status(400).json({ error: 'Invalid pass status filter.', code: 'INVALID_STATUS' });
      }
      where.status = requestedStatus;
    }

    if (actor.role === 'resident') {
      const ownership = await resolveResidentOwnership(actor);
      if (!ownership) {
        return res.json([]);
      }
      where.child = {
        societyId: actor.societyId,
        OR: [{ residentId: ownership.residentId }, { guardianUserId: actor.userId }],
      };
    } else if (actor.role === 'guard') {
      // Guards only view currently active, unexpired, non-archived passes within their society
      where.status = 'ACTIVE';
      where.archivedAt = null;
      where.validUntil = { gt: new Date() };
    }

    const passes = await prisma.childGatePass.findMany({
      where,
      include: { child: { select: { id: true, fullName: true, flatNumber: true, status: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    return res.json(passes.map(sanitizeGatePassDto));
  } catch (err) {
    return handleChildSafetyError(res, err, 'GET /passes');
  }
});

/**
 * POST /api/children/passes
 * Generates a cryptographically secure child gate pass (256-bit CSPRNG bearer token).
 * Stores ONLY SHA-256 `tokenHash`; returns raw `bearerToken` and `qrPayload` ONCE.
 */
childSafetyRouter.post('/passes', childPassCreateRateLimiter(), async (req: Request, res: Response) => {
  const actor = resolveChildSafetyActor(req, res, { requireConcreteSociety: true });
  if (!actor) return;
  if (!enforceAllowedRoles(actor, PASS_WRITE_ROLES, res)) return;

  try {
    const body = req.body || {};
    if (!isNonEmptyString(body.childId, 128)) {
      return res.status(400).json({ error: 'childId is required.', code: 'INVALID_CHILD_ID' });
    }

    const child = await authorizeChildAccess(actor, body.childId.trim(), res);
    if (!child) return;

    if (child.status === 'ARCHIVED' || child.archivedAt) {
      return res.status(409).json({
        error: 'Cannot issue a gate pass for an archived child profile.',
        code: 'CHILD_ARCHIVED',
      });
    }

    if (child.status === 'MISSING') {
      return res.status(409).json({
        error: 'Cannot issue a gate pass while the child has an active MISSING status.',
        code: 'CHILD_MISSING_ALERT_ACTIVE',
      });
    }

    // Check for any active MISSING_CHILD alert on this child
    const activeMissingAlert = await prisma.childSafetyAlert.findFirst({
      where: {
        societyId: child.societyId,
        childId: child.id,
        alertType: 'MISSING_CHILD',
        status: { in: ['ACTIVE', 'ACKNOWLEDGED'] },
      },
    });
    if (activeMissingAlert) {
      return res.status(409).json({
        error: 'Cannot issue a gate pass while a missing-child alert is active.',
        code: 'CHILD_MISSING_ALERT_ACTIVE',
      });
    }

    const now = new Date();
    const validFrom = body.validFrom !== undefined ? parseIsoDate(body.validFrom) : now;
    const validUntil = parseIsoDate(body.validUntil);
    if (!validFrom || !validUntil) {
      return res.status(400).json({
        error: 'validUntil must be a valid ISO-8601 timestamp (and validFrom if supplied).',
        code: 'INVALID_VALIDITY_WINDOW',
      });
    }
    if (validUntil <= validFrom || validUntil <= now) {
      return res.status(400).json({
        error: 'validUntil must be strictly after validFrom and in the future.',
        code: 'INVALID_VALIDITY_WINDOW',
      });
    }
    if (validUntil.getTime() - validFrom.getTime() > MAX_PASS_DURATION_MS) {
      return res.status(400).json({
        error: 'Gate pass validity window cannot exceed 7 days.',
        code: 'VALIDITY_WINDOW_TOO_LONG',
      });
    }

    const maxUses = body.maxUses !== undefined ? Number(body.maxUses) : 1;
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 10) {
      return res.status(400).json({
        error: 'maxUses must be an integer between 1 and 10.',
        code: 'INVALID_MAX_USES',
      });
    }

    const notesCheck = normalizeOptionalString(body.notes, 500);
    if (!notesCheck.valid) {
      return res.status(400).json({ error: 'Invalid notes value.', code: 'INVALID_NOTES' });
    }

    // Validate authorized pickup person when provided or required by child exit policy
    let pickupPerson: any = null;
    const pickupPersonId =
      typeof body.pickupPersonId === 'string' && body.pickupPersonId.trim().length > 0
        ? body.pickupPersonId.trim()
        : null;

    if (pickupPersonId) {
      pickupPerson = await prisma.childAuthorizedPickup.findFirst({
        where: {
          id: pickupPersonId,
          societyId: child.societyId,
          childId: child.id,
        },
      });

      if (!pickupPerson) {
        return res.status(404).json({
          error: 'Authorized pickup person not found for this child.',
          code: 'PICKUP_PERSON_NOT_FOUND',
        });
      }

      if (pickupPerson.status !== 'ACTIVE' || pickupPerson.archivedAt) {
        return res.status(422).json({
          error: 'Selected pickup authorization is revoked, expired, or archived.',
          code: 'PICKUP_AUTHORIZATION_INACTIVE',
        });
      }

      if (pickupPerson.validUntil && new Date(pickupPerson.validUntil) <= now) {
        return res.status(422).json({
          error: 'Selected pickup authorization has expired.',
          code: 'PICKUP_AUTHORIZATION_EXPIRED',
        });
      }
    } else if (child.exitPermissionMode !== 'SOLO_ALLOWED' || !child.allowedSoloExit) {
      return res.status(422).json({
        error: 'An active authorized pickup person (pickupPersonId) is required by this child exit policy.',
        code: 'AUTHORIZED_PICKUP_REQUIRED',
      });
    }

    const pickupPersonName = pickupPerson
      ? pickupPerson.name
      : isNonEmptyString(body.pickupPersonName, 200)
        ? body.pickupPersonName.trim()
        : `${child.fullName} (Solo Exit)`;
    const pickupPersonPhone = pickupPerson
      ? pickupPerson.phone
      : typeof body.pickupPersonPhone === 'string' && body.pickupPersonPhone.trim()
        ? body.pickupPersonPhone.trim().slice(0, 32)
        : null;

    // Generate high-entropy 256-bit CSPRNG bearer token; store ONLY SHA-256 hex digest
    const rawBearerToken = generateChildPassBearerToken();
    const tokenHash = hashChildPassToken(rawBearerToken);

    let createdPass: any = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const displayPassCode = generateDisplayPassCode();
      try {
        createdPass = await prisma.childGatePass.create({
          data: {
            societyId: child.societyId,
            childId: child.id,
            pickupPersonId: pickupPerson ? pickupPerson.id : null,
            passCode: displayPassCode,
            tokenHash,
            pickupPersonName,
            pickupPersonPhone,
            validFrom,
            validUntil,
            status: 'ACTIVE',
            maxUses,
            currentUses: 0,
            createdById: actor.userId,
            notes: notesCheck.value ?? null,
          },
          include: { child: { select: { id: true, fullName: true, flatNumber: true, status: true } } },
        });
        break;
      } catch (err: any) {
        if (err?.code === 'P2002' && attempt < 4) {
          continue; // Retry display code collision cleanly
        }
        throw err;
      }
    }

    await emitChildSafetyEvent(
      child.societyId,
      'CHILD_GATE_PASS_GENERATED',
      createdPass.id,
      actor.userId,
      {
        id: createdPass.id,
        childId: createdPass.childId,
        passCode: createdPass.passCode,
        status: createdPass.status,
        validFrom: createdPass.validFrom.toISOString(),
        validUntil: createdPass.validUntil.toISOString(),
      },
      {
        allowedRoles: GATE_AND_SOS_EVENT_ROLES,
        targetUserIds: collectOwnerUserIds(child.guardianUserId, actor.role === 'resident' ? actor.userId : null),
      }
    );

    // Return raw bearerToken and qrPayload ONCE to the authorized creator; omit tokenHash
    return res.status(201).json({
      ...sanitizeGatePassDto(createdPass),
      bearerToken: rawBearerToken,
      qrPayload: encodeChildPassQrPayload(rawBearerToken),
    });
  } catch (err) {
    return handleChildSafetyError(res, err, 'POST /passes');
  }
});

/**
 * Shared fail-closed, concurrency-safe gate pass verification handler.
 * Enforces all 10 validation requirements and atomic one-time consumption.
 */
async function handleGatePassVerification(
  req: Request,
  res: Response,
  expectedPassId?: string
): Promise<Response> {
  const actor = resolveChildSafetyActor(req, res, { requireConcreteSociety: true });
  if (!actor) return res;
  if (!enforceAllowedRoles(actor, GATE_VERIFY_ROLES, res)) return res;

  const body = req.body || {};

  // Reject any attempt to verify using passCode, childId, or passId without a valid bearer token
  const rawToken = extractBearerToken({
    bearerToken: body.bearerToken,
    qrPayload: body.qrPayload ?? body.qrCode,
  });
  if (!rawToken) {
    return res.status(400).json({
      authorized: false,
      error: 'A valid cryptographic bearerToken or qrPayload is strictly required. Display passCode cannot authorize gate exit.',
      code: 'BEARER_TOKEN_REQUIRED',
    });
  }

  const gateId = isNonEmptyString(body.gateId || body.gate, 64)
    ? String(body.gateId || body.gate).trim()
    : 'MAIN_GATE';
  const notesCheck = normalizeOptionalString(body.notes, 500);
  if (!notesCheck.valid) {
    return res.status(400).json({ authorized: false, error: 'Invalid notes value.', code: 'INVALID_NOTES' });
  }

  const presentedHash = hashChildPassToken(rawToken);
  const now = new Date();

  try {
    type VerifyOutcome =
      | {
          authorized: true;
          httpStatus: 200;
          pass: any;
          exitLog: any;
          societyId: string;
          ownerUserIds: string[];
        }
      | {
          authorized: false;
          httpStatus: 404 | 409 | 422;
          code: string;
          error: string;
          exitLog: any | null;
          societyId: string;
          childId?: string | null;
          ownerUserIds: string[];
        };

    const result: VerifyOutcome = await prisma.$transaction(async (tx: any): Promise<VerifyOutcome> => {
      const pass = await tx.childGatePass.findUnique({
        where: { tokenHash: presentedHash },
        include: {
          child: true,
          pickupPerson: true,
        },
      });

      // Requirements 1, 2, 3, 4: Constant-time digest verification + strict tenant non-disclosure
      const hashMatches = pass ? verifyChildPassTokenConstantTime(rawToken, pass.tokenHash) : false;
      const societyMatches =
        Boolean(pass) &&
        pass.societyId === actor.societyId &&
        Boolean(pass.child) &&
        pass.child.societyId === actor.societyId;
      const idMatches = !expectedPassId || (pass && pass.id === expectedPassId);

      if (!pass || !hashMatches || !societyMatches || !idMatches) {
        const deniedLog = await tx.childExitLog.create({
          data: {
            societyId: actor.societyId,
            childId: null,
            passId: null,
            pickupPersonId: null,
            childName: 'UNVERIFIED',
            flatNumber: 'UNKNOWN',
            pickupPersonName: 'UNVERIFIED',
            gateId,
            guardId: actor.userId,
            guardName: actor.name,
            outcome: 'DENIED',
            verificationChannel: 'ONLINE_QR_TOKEN',
            denialReason: 'INVALID_OR_UNRECOGNIZED_TOKEN',
            notes: notesCheck.value ?? null,
          },
        });
        return {
          authorized: false,
          httpStatus: 404,
          code: 'INVALID_OR_UNKNOWN_PASS',
          error: 'Gate pass is invalid or not found in this society.',
          exitLog: deniedLog,
          societyId: actor.societyId,
          ownerUserIds: [],
        };
      }

      const ownerUserIds = collectOwnerUserIds(pass.child?.guardianUserId);

      // F-B22-05: Serialize child state against concurrent MISSING_CHILD SOS alerts via FOR UPDATE
      const lockedChild = await lockChildProfileRow(tx, pass.childId, actor.societyId);
      const effectiveChildStatus = lockedChild ? lockedChild.status : pass.child.status;
      const effectiveChildArchivedAt = lockedChild ? lockedChild.archivedAt : pass.child.archivedAt;

      const logDenial = async (
        outcome: 'DENIED' | 'MISSING_ALERT_BLOCKED',
        denialReason: string
      ) => {
        return tx.childExitLog.create({
          data: {
            societyId: actor.societyId,
            childId: pass.childId,
            passId: pass.id,
            pickupPersonId: pass.pickupPersonId ?? null,
            childName: pass.child.fullName,
            flatNumber: pass.child.flatNumber,
            pickupPersonName: pass.pickupPersonName,
            pickupPersonPhone: pass.pickupPersonPhone ?? null,
            gateId,
            guardId: actor.userId,
            guardName: actor.name,
            outcome,
            verificationChannel: 'ONLINE_QR_TOKEN',
            denialReason,
            notes: notesCheck.value ?? null,
          },
        });
      };

      // Requirement 5: Check locked child MISSING status AND active MISSING_CHILD alert (highest priority)
      const activeMissingAlert = await tx.childSafetyAlert.findFirst({
        where: {
          societyId: actor.societyId,
          childId: pass.childId,
          alertType: 'MISSING_CHILD',
          status: { in: ['ACTIVE', 'ACKNOWLEDGED'] },
        },
      });

      if (effectiveChildStatus === 'MISSING' || activeMissingAlert) {
        const blockedLog = await logDenial('MISSING_ALERT_BLOCKED', 'ACTIVE_MISSING_CHILD_ALERT');
        return {
          authorized: false,
          httpStatus: 409,
          code: 'CHILD_MISSING_ALERT_BLOCKED',
          error: 'EXIT BLOCKED: Active missing-child alert on this child profile. Hold at gate and contact security command.',
          exitLog: blockedLog,
          societyId: actor.societyId,
          childId: pass.childId,
          ownerUserIds,
        };
      }

      if (effectiveChildStatus === 'ARCHIVED' || effectiveChildArchivedAt) {
        const deniedLog = await logDenial('DENIED', 'CHILD_PROFILE_ARCHIVED');
        return {
          authorized: false,
          httpStatus: 409,
          code: 'CHILD_ARCHIVED',
          error: 'Child profile is archived and ineligible for gate exit.',
          exitLog: deniedLog,
          societyId: actor.societyId,
          childId: pass.childId,
          ownerUserIds,
        };
      }

      // Requirements 6, 7, 8: Check pass status, revocation, expiry, and consumption
      if (pass.status === 'REVOKED' || pass.revokedAt) {
        const deniedLog = await logDenial('DENIED', 'PASS_REVOKED');
        return {
          authorized: false,
          httpStatus: 409,
          code: 'PASS_REVOKED',
          error: 'Gate pass has been revoked.',
          exitLog: deniedLog,
          societyId: actor.societyId,
          childId: pass.childId,
          ownerUserIds,
        };
      }

      if (pass.status === 'ARCHIVED' || pass.archivedAt) {
        const deniedLog = await logDenial('DENIED', 'PASS_ARCHIVED');
        return {
          authorized: false,
          httpStatus: 409,
          code: 'PASS_ARCHIVED',
          error: 'Gate pass is archived.',
          exitLog: deniedLog,
          societyId: actor.societyId,
          childId: pass.childId,
          ownerUserIds,
        };
      }

      if (pass.status === 'USED' || pass.currentUses >= pass.maxUses) {
        const deniedLog = await logDenial('DENIED', 'PASS_ALREADY_CONSUMED');
        return {
          authorized: false,
          httpStatus: 409,
          code: 'PASS_ALREADY_CONSUMED',
          error: 'Gate pass has already been consumed.',
          exitLog: deniedLog,
          societyId: actor.societyId,
          childId: pass.childId,
          ownerUserIds,
        };
      }

      if (now < new Date(pass.validFrom)) {
        const deniedLog = await logDenial('DENIED', 'PASS_NOT_YET_VALID');
        return {
          authorized: false,
          httpStatus: 422,
          code: 'PASS_NOT_YET_VALID',
          error: 'Gate pass is not yet within its valid time window.',
          exitLog: deniedLog,
          societyId: actor.societyId,
          childId: pass.childId,
          ownerUserIds,
        };
      }

      if (pass.status === 'EXPIRED' || now >= new Date(pass.validUntil)) {
        const deniedLog = await logDenial('DENIED', 'PASS_EXPIRED');
        return {
          authorized: false,
          httpStatus: 409,
          code: 'PASS_EXPIRED',
          error: 'Gate pass has expired.',
          exitLog: deniedLog,
          societyId: actor.societyId,
          childId: pass.childId,
          ownerUserIds,
        };
      }

      // Requirements 9 & 10: Authorized pickup person and child exit-permission rules
      if (pass.pickupPersonId) {
        const pickup = pass.pickupPerson;
        const pickupValid =
          pickup &&
          pickup.societyId === actor.societyId &&
          pickup.childId === pass.childId &&
          pickup.status === 'ACTIVE' &&
          !pickup.archivedAt &&
          (!pickup.validUntil || new Date(pickup.validUntil) > now);

        if (!pickupValid) {
          const deniedLog = await logDenial('DENIED', 'PICKUP_PERSON_UNAUTHORIZED');
          return {
            authorized: false,
            httpStatus: 409,
            code: 'PICKUP_PERSON_UNAUTHORIZED',
            error: 'Authorized pickup person is revoked, expired, or no longer authorized for this child.',
            exitLog: deniedLog,
            societyId: actor.societyId,
            childId: pass.childId,
            ownerUserIds,
          };
        }
      } else if (pass.child.exitPermissionMode !== 'SOLO_ALLOWED' || !pass.child.allowedSoloExit) {
        const deniedLog = await logDenial('DENIED', 'ESCORT_REQUIRED');
        return {
          authorized: false,
          httpStatus: 422,
          code: 'ESCORT_REQUIRED',
          error: 'Child exit policy requires an authorized pickup escort.',
          exitLog: deniedLog,
          societyId: actor.societyId,
          childId: pass.childId,
          ownerUserIds,
        };
      }

      // Atomic conditional consumption — prevents concurrent double-spend on one-time passes
      const nextUses = pass.currentUses + 1;
      const nextStatus = nextUses >= pass.maxUses ? 'USED' : 'ACTIVE';

      const consumed = await tx.childGatePass.updateMany({
        where: {
          id: pass.id,
          societyId: actor.societyId,
          tokenHash: pass.tokenHash,
          status: 'ACTIVE',
          archivedAt: null,
          revokedAt: null,
          validFrom: { lte: now },
          validUntil: { gt: now },
          currentUses: pass.currentUses,
        },
        data: {
          currentUses: nextUses,
          firstUsedAt: pass.firstUsedAt ?? now,
          lastUsedAt: now,
          status: nextStatus,
        },
      });

      if (consumed.count !== 1) {
        const replayLog = await logDenial('DENIED', 'PASS_CONCURRENT_OR_ALREADY_CONSUMED');
        return {
          authorized: false,
          httpStatus: 409,
          code: 'PASS_ALREADY_CONSUMED',
          error: 'Gate pass was already consumed, revoked, or expired concurrently.',
          exitLog: replayLog,
          societyId: actor.societyId,
          childId: pass.childId,
          ownerUserIds,
        };
      }

      // Transition child status to OUT_OF_SOCIETY and verify affected row count under the row lock
      if (effectiveChildStatus === 'SAFE') {
        const childUpdated = await tx.childProfile.updateMany({
          where: {
            id: pass.childId,
            societyId: actor.societyId,
            status: 'SAFE',
            archivedAt: null,
          },
          data: { status: 'OUT_OF_SOCIETY' },
        });
        if (childUpdated.count !== 1) {
          throw new Error('CONCURRENT_CHILD_STATE_CONFLICT');
        }
      }

      const exitLog = await tx.childExitLog.create({
        data: {
          societyId: actor.societyId,
          childId: pass.childId,
          passId: pass.id,
          pickupPersonId: pass.pickupPersonId ?? null,
          childName: pass.child.fullName,
          flatNumber: pass.child.flatNumber,
          pickupPersonName: pass.pickupPersonName,
          pickupPersonPhone: pass.pickupPersonPhone ?? null,
          gateId,
          guardId: actor.userId,
          guardName: actor.name,
          outcome: 'ALLOWED',
          verificationChannel: 'ONLINE_QR_TOKEN',
          denialReason: null,
          notes: notesCheck.value ?? null,
        },
      });

      const updatedPass = {
        ...pass,
        currentUses: nextUses,
        firstUsedAt: pass.firstUsedAt ?? now,
        lastUsedAt: now,
        status: nextStatus,
      };

      return {
        authorized: true,
        httpStatus: 200,
        pass: updatedPass,
        exitLog,
        societyId: actor.societyId,
        ownerUserIds,
      };
    });

    // Emit realtime events STRICTLY AFTER transaction commit (never on rollback)
    const eventAudience: EventAudiencePolicy = {
      allowedRoles: GATE_AND_SOS_EVENT_ROLES,
      targetUserIds: result.ownerUserIds,
    };

    if (result.authorized) {
      await emitChildSafetyEvent(
        result.societyId,
        'CHILD_EXIT_TRIGGERED',
        result.exitLog.id,
        actor.userId,
        {
          exitLogId: result.exitLog.id,
          passId: result.pass.id,
          childId: result.pass.childId,
          passCode: result.pass.passCode,
          gateId: result.exitLog.gateId,
          outcome: result.exitLog.outcome,
        },
        eventAudience
      );
      await emitChildSafetyEvent(
        result.societyId,
        'CHILD_GATE_PASS_VERIFIED',
        result.pass.id,
        actor.userId,
        {
          passId: result.pass.id,
          childId: result.pass.childId,
          status: result.pass.status,
          currentUses: result.pass.currentUses,
          maxUses: result.pass.maxUses,
        },
        eventAudience
      );

      return res.status(200).json({
        authorized: true,
        outcome: 'ALLOWED',
        pass: sanitizeGatePassDto(result.pass),
        exitLog: sanitizeExitLogDto(result.exitLog),
      });
    }

    if (result.exitLog) {
      await emitChildSafetyEvent(
        result.societyId,
        'CHILD_EXIT_DENIED',
        result.exitLog.id,
        actor.userId,
        {
          exitLogId: result.exitLog.id,
          childId: result.childId ?? null,
          gateId,
          outcome: result.exitLog.outcome,
          reasonCode: result.code,
        },
        eventAudience
      );
    }

    return res.status(result.httpStatus).json({
      authorized: false,
      outcome: result.exitLog?.outcome || 'DENIED',
      code: result.code,
      error: result.error,
      ...(result.exitLog ? { exitLog: sanitizeExitLogDto(result.exitLog) } : {}),
    });
  } catch (err) {
    if ((err as any)?.message === 'CONCURRENT_CHILD_STATE_CONFLICT') {
      return res.status(409).json({
        authorized: false,
        outcome: 'DENIED',
        code: 'CHILD_STATE_CONFLICT',
        error: 'Child status changed concurrently during gate verification. Please re-verify.',
      });
    }
    if (isDatabaseUnavailableError(err)) {
      return res.status(503).json({
        authorized: false,
        outcome: 'VERIFICATION_UNAVAILABLE',
        verificationChannel: 'BACKEND_UNAVAILABLE',
        code: 'BACKEND_UNAVAILABLE',
        error: 'Gate verification service is temporarily unavailable. Fail-closed policy active: do not authorize child exit offline.',
      });
    }
    return handleChildSafetyError(res, err, 'POST /passes/verify');
  }
}

/**
 * POST /api/children/passes/verify
 * Primary gate verification endpoint (strictly bearer-token, guard/admin only, rate-limited).
 */
childSafetyRouter.post('/passes/verify', childPassVerifyRateLimiter(), async (req: Request, res: Response) => {
  return handleGatePassVerification(req, res);
});

/**
 * GET /api/children/passes/:id
 * Retrieves a single child gate pass safely (omits `tokenHash`).
 */
childSafetyRouter.get('/passes/:id', async (req: Request, res: Response) => {
  const actor = resolveChildSafetyActor(req, res, { requireConcreteSociety: false });
  if (!actor) return;
  if (!enforceAllowedRoles(actor, PASS_READ_ROLES, res)) return;

  try {
    const where: any = { id: String(req.params.id) };
    if (!actor.isPlatformAdmin || actor.societyId) {
      where.societyId = actor.societyId;
    }

    // F-B22-03: Guards may only retrieve currently active, unexpired, non-archived passes
    if (actor.role === 'guard') {
      where.status = 'ACTIVE';
      where.archivedAt = null;
      where.validUntil = { gt: new Date() };
    }

    const pass = await prisma.childGatePass.findFirst({
      where,
      include: { child: true },
    });

    if (!pass) {
      return res.status(404).json({ error: 'Child gate pass not found.', code: 'PASS_NOT_FOUND' });
    }

    if (actor.role === 'resident') {
      const ownership = await resolveResidentOwnership(actor);
      const isOwner =
        (ownership && pass.child.residentId === ownership.residentId) ||
        pass.child.guardianUserId === actor.userId;
      if (!isOwner) {
        return res.status(403).json({
          error: 'Forbidden: You do not own this child gate pass.',
          code: 'UNAUTHORIZED_PASS_ACCESS',
        });
      }
    }

    return res.json(sanitizeGatePassDto(pass));
  } catch (err) {
    return handleChildSafetyError(res, err, 'GET /passes/:id');
  }
});

/**
 * POST /api/children/passes/:id/verify
 * Legacy-compatible path that STILL requires the cryptographic bearerToken and enforces pass.id match.
 */
childSafetyRouter.post(
  '/passes/:id/verify',
  childPassVerifyRateLimiter(),
  async (req: Request, res: Response) => {
    return handleGatePassVerification(req, res, String(req.params.id));
  }
);

async function handleRevokePass(req: Request, res: Response): Promise<Response> {
  const actor = resolveChildSafetyActor(req, res, { requireConcreteSociety: false });
  if (!actor) return res;
  if (!enforceAllowedRoles(actor, PASS_WRITE_ROLES, res)) return res;

  try {
    const where: any = { id: String(req.params.id) };
    if (!actor.isPlatformAdmin || actor.societyId) {
      where.societyId = actor.societyId;
    }

    const pass = await prisma.childGatePass.findFirst({
      where,
      include: { child: true },
    });

    if (!pass) {
      return res.status(404).json({ error: 'Child gate pass not found.', code: 'PASS_NOT_FOUND' });
    }

    if (actor.role === 'resident') {
      const ownership = await resolveResidentOwnership(actor);
      const isOwner =
        (ownership && pass.child.residentId === ownership.residentId) ||
        pass.child.guardianUserId === actor.userId;
      if (!isOwner) {
        return res.status(403).json({
          error: 'Forbidden: You cannot revoke another resident’s child gate pass.',
          code: 'UNAUTHORIZED_PASS_ACCESS',
        });
      }
    }

    if (pass.status !== 'ACTIVE') {
      return res.status(409).json({
        error: `Gate pass cannot be revoked from status '${pass.status}'.`,
        code: 'PASS_NOT_REVOCABLE',
      });
    }

    const reasonCheck = normalizeOptionalString(req.body?.reason ?? req.body?.revocationReason, 300);
    if (!reasonCheck.valid) {
      return res.status(400).json({ error: 'Invalid revocation reason.', code: 'INVALID_REASON' });
    }

    const now = new Date();
    const updated = await prisma.childGatePass.updateMany({
      where: {
        id: pass.id,
        societyId: pass.societyId,
        status: 'ACTIVE',
      },
      data: {
        status: 'REVOKED',
        revokedAt: now,
        revokedById: actor.userId,
        revocationReason: reasonCheck.value ?? 'Revoked by authorized guardian/admin',
      },
    });

    if (updated.count !== 1) {
      return res.status(409).json({
        error: 'Gate pass was modified or consumed concurrently.',
        code: 'PASS_NOT_REVOCABLE',
      });
    }

    const refreshed = await prisma.childGatePass.findUnique({ where: { id: pass.id } });

    await emitChildSafetyEvent(
      pass.societyId,
      'CHILD_GATE_PASS_REVOKED',
      pass.id,
      actor.userId,
      {
        id: pass.id,
        childId: pass.childId,
        passCode: pass.passCode,
        status: 'REVOKED',
      },
      {
        allowedRoles: GATE_AND_SOS_EVENT_ROLES,
        targetUserIds: collectOwnerUserIds(pass.child?.guardianUserId, actor.role === 'resident' ? actor.userId : null),
      }
    );

    return res.json(sanitizeGatePassDto(refreshed));
  } catch (err) {
    return handleChildSafetyError(res, err, 'POST /passes/:id/revoke');
  }
}

childSafetyRouter.post('/passes/:id/revoke', handleRevokePass);
childSafetyRouter.delete('/passes/:id', handleRevokePass);

/**
 * GET /api/children/exit-logs
 * Lists historical child exit audit logs within authorized tenant & ownership scope.
 */
childSafetyRouter.get('/exit-logs', async (req: Request, res: Response) => {
  const actor = resolveChildSafetyActor(req, res, { requireConcreteSociety: false });
  if (!actor) return;
  if (!enforceAllowedRoles(actor, PASS_READ_ROLES, res)) return;

  try {
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 100), 200);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const where: any = {};

    if (!actor.isPlatformAdmin || actor.societyId) {
      where.societyId = actor.societyId;
    }

    if (typeof req.query.childId === 'string' && req.query.childId.trim()) {
      where.childId = req.query.childId.trim();
    }

    if (actor.role === 'resident') {
      const ownership = await resolveResidentOwnership(actor);
      if (!ownership) return res.json([]);
      where.child = {
        societyId: actor.societyId,
        OR: [{ residentId: ownership.residentId }, { guardianUserId: actor.userId }],
      };
    }

    const logs = await prisma.childExitLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit,
      skip: offset,
    });

    return res.json(logs.map(sanitizeExitLogDto));
  } catch (err) {
    return handleChildSafetyError(res, err, 'GET /exit-logs');
  }
});

// =============================================================================
// 2. CHILD SOS & SAFETY ALERTS
// =============================================================================

/**
 * POST /api/children/sos
 * Triggers a persistent ChildSafetyAlert + linked EmergencyIncident inside an atomic transaction.
 * Ignores caller-supplied societyId, residentId, guardianId, and actor IDs.
 */
childSafetyRouter.post('/sos', childSosRateLimiter(), async (req: Request, res: Response) => {
  const actor = resolveChildSafetyActor(req, res, {
    requireConcreteSociety: false,
    ignoreBodySocietyId: true,
  });
  if (!actor) return;
  if (!enforceAllowedRoles(actor, SOS_TRIGGER_ROLES, res)) return;

  try {
    const body = req.body || {};

    const alertType =
      typeof body.alertType === 'string' && body.alertType.trim()
        ? body.alertType.trim().toUpperCase()
        : 'MISSING_CHILD';
    if (!ALLOWED_ALERT_TYPES.includes(alertType as any)) {
      return res.status(400).json({ error: 'Invalid alertType value.', code: 'INVALID_ALERT_TYPE' });
    }

    const severity =
      typeof body.severity === 'string' && body.severity.trim()
        ? body.severity.trim().toUpperCase()
        : 'CRITICAL';
    if (!ALLOWED_INCIDENT_SEVERITIES.includes(severity as any)) {
      return res.status(400).json({ error: 'Invalid severity value.', code: 'INVALID_SEVERITY' });
    }

    const location = isNonEmptyString(body.location, 255) ? body.location.trim() : '';
    if (!location) {
      return res.status(400).json({ error: 'location is required for SOS alerts.', code: 'INVALID_LOCATION' });
    }

    const descriptionCheck = normalizeOptionalString(body.description, 1000);
    const lastSeenCheck = normalizeOptionalString(body.lastSeenDetails, 500);
    if (!descriptionCheck.valid || !lastSeenCheck.valid) {
      return res.status(400).json({ error: 'Invalid description or lastSeenDetails.', code: 'INVALID_SOS_DETAILS' });
    }

    const childId =
      typeof body.childId === 'string' && body.childId.trim().length > 0 ? body.childId.trim() : null;

    let targetChild: any = null;
    let targetSocietyId = actor.societyId;

    if (childId) {
      const childWhere: any = { id: childId };
      if (!actor.isPlatformAdmin || actor.societyId) {
        childWhere.societyId = actor.societyId;
      }
      targetChild = await prisma.childProfile.findFirst({ where: childWhere });
      if (!targetChild) {
        return res.status(404).json({ error: 'Child profile not found.', code: 'CHILD_NOT_FOUND' });
      }
      if (targetChild.status === 'ARCHIVED' || targetChild.archivedAt) {
        return res.status(409).json({
          error: 'Cannot trigger SOS for an archived child profile.',
          code: 'CHILD_ARCHIVED',
        });
      }

      if (actor.role === 'resident') {
        const ownership = await resolveResidentOwnership(actor);
        const isOwner =
          (ownership && targetChild.residentId === ownership.residentId) ||
          targetChild.guardianUserId === actor.userId;
        if (!isOwner) {
          return res.status(403).json({
            error: 'Forbidden: Residents can only trigger SOS alerts for their own children.',
            code: 'UNAUTHORIZED_SOS_TRIGGER',
          });
        }
      }

      targetSocietyId = targetChild.societyId;
    } else {
      // Residents must always reference an owned childId to prevent spoofed arbitrary SOS alerts
      if (actor.role === 'resident') {
        return res.status(400).json({
          error: 'childId is required when a resident triggers a child SOS alert.',
          code: 'CHILD_ID_REQUIRED',
        });
      }
      if (!targetSocietyId) {
        return res.status(400).json({
          error: 'A valid target societyId is required for an unidentified child SOS alert.',
          code: 'TARGET_SOCIETY_REQUIRED',
        });
      }
    }

    const childName = targetChild
      ? targetChild.fullName
      : isNonEmptyString(body.childName, 200)
        ? body.childName.trim()
        : 'Unidentified Child';
    const flatNumber = targetChild
      ? targetChild.flatNumber
      : isNonEmptyString(body.flatNumber, 64)
        ? body.flatNumber.trim()
        : 'PREMISES';

    const description =
      descriptionCheck.value || `CHILD SAFETY ALERT (${alertType}): ${childName} at ${location}`;

    const txResult = await prisma.$transaction(async (tx: any) => {
      // F-B22-05 & F-B22-06A: Serialize child row against concurrent gate verification & duplicate SOS
      if (targetChild) {
        const lockedChild = await lockChildProfileRow(tx, targetChild.id, targetSocietyId);
        if (lockedChild && (lockedChild.status === 'ARCHIVED' || lockedChild.archivedAt)) {
          return { duplicate: false as const, archived: true as const };
        }

        if (alertType === 'MISSING_CHILD') {
          const existingActive = await tx.childSafetyAlert.findFirst({
            where: {
              societyId: targetSocietyId,
              childId: targetChild.id,
              alertType: 'MISSING_CHILD',
              status: { in: ['ACTIVE', 'ACKNOWLEDGED'] },
            },
            orderBy: { createdAt: 'desc' },
          });
          if (existingActive) {
            return { duplicate: true as const, archived: false as const, existingAlert: existingActive };
          }
        }
      }

      const incident = await tx.emergencyIncident.create({
        data: {
          societyId: targetSocietyId,
          incidentType: 'CHILD_SAFETY',
          severity,
          location,
          description,
          dispatchStatus: 'DISPATCHED',
        },
      });

      const alert = await tx.childSafetyAlert.create({
        data: {
          societyId: targetSocietyId,
          childId: targetChild ? targetChild.id : null,
          reportedById: actor.userId,
          reportedByName: actor.name,
          childName,
          flatNumber,
          alertType,
          severity,
          status: 'ACTIVE',
          location,
          description,
          lastSeenDetails: lastSeenCheck.value ?? null,
          emergencyIncidentId: incident.id,
        },
      });

      if (targetChild && alertType === 'MISSING_CHILD') {
        await tx.childProfile.updateMany({
          where: {
            id: targetChild.id,
            societyId: targetSocietyId,
            archivedAt: null,
          },
          data: { status: 'MISSING' },
        });
      }

      return { duplicate: false as const, archived: false as const, alert, incident };
    });

    if (txResult.archived) {
      return res.status(409).json({
        error: 'Cannot trigger SOS for an archived child profile.',
        code: 'CHILD_ARCHIVED',
      });
    }

    if (txResult.duplicate) {
      return res.status(409).json({
        error: 'An active missing-child SOS alert already exists for this child.',
        code: 'DUPLICATE_ACTIVE_SOS_ALERT',
        activeAlert: sanitizeSafetyAlertDto(txResult.existingAlert),
      });
    }

    const created = txResult;
    const sosAudience: EventAudiencePolicy = {
      allowedRoles: GATE_AND_SOS_EVENT_ROLES,
      targetUserIds: collectOwnerUserIds(
        targetChild?.guardianUserId,
        actor.role === 'resident' ? actor.userId : null
      ),
    };

    // Emit realtime events STRICTLY AFTER transaction commit
    await emitChildSafetyEvent(
      targetSocietyId,
      'CHILD_SAFETY_SOS_TRIGGERED',
      created.alert.id,
      actor.userId,
      {
        alertId: created.alert.id,
        emergencyIncidentId: created.incident.id,
        childId: created.alert.childId,
        alertType: created.alert.alertType,
        severity: created.alert.severity,
        status: created.alert.status,
        location: created.alert.location,
      },
      sosAudience
    );
    await emitChildSafetyEvent(
      targetSocietyId,
      'EMERGENCY_INCIDENT_CREATED',
      created.incident.id,
      actor.userId,
      {
        id: created.incident.id,
        incidentType: created.incident.incidentType,
        severity: created.incident.severity,
        location: created.incident.location,
        dispatchStatus: created.incident.dispatchStatus,
      },
      sosAudience
    );

    return res.status(201).json({
      alert: sanitizeSafetyAlertDto(created.alert),
      emergencyIncident: {
        id: created.incident.id,
        societyId: created.incident.societyId,
        incidentType: created.incident.incidentType,
        severity: created.incident.severity,
        location: created.incident.location,
        dispatchStatus: created.incident.dispatchStatus,
        createdAt:
          created.incident.createdAt instanceof Date
            ? created.incident.createdAt.toISOString()
            : created.incident.createdAt,
      },
    });
  } catch (err) {
    return handleChildSafetyError(res, err, 'POST /sos');
  }
});

async function handleListAlerts(req: Request, res: Response): Promise<Response> {
  const actor = resolveChildSafetyActor(req, res, { requireConcreteSociety: false });
  if (!actor) return res;
  if (!enforceAllowedRoles(actor, SOS_TRIGGER_ROLES, res)) return res;

  try {
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 100), 200);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const where: any = {};

    if (!actor.isPlatformAdmin || actor.societyId) {
      where.societyId = actor.societyId;
    }

    if (typeof req.query.status === 'string' && req.query.status.trim()) {
      const s = req.query.status.trim().toUpperCase();
      if (!['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_ALARM'].includes(s)) {
        return res.status(400).json({ error: 'Invalid alert status filter.', code: 'INVALID_STATUS' });
      }
      where.status = s;
    }

    if (actor.role === 'resident') {
      const ownership = await resolveResidentOwnership(actor);
      where.OR = [
        { reportedById: actor.userId },
        ...(ownership
          ? [{ child: { societyId: actor.societyId, residentId: ownership.residentId } }]
          : []),
        { child: { societyId: actor.societyId, guardianUserId: actor.userId } },
      ];
    }

    const alerts = await prisma.childSafetyAlert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    return res.json(alerts.map(sanitizeSafetyAlertDto));
  } catch (err) {
    return handleChildSafetyError(res, err, 'GET /alerts');
  }
}

childSafetyRouter.get('/alerts', handleListAlerts);
childSafetyRouter.get('/sos', handleListAlerts);

/**
 * POST /api/children/alerts/:id/acknowledge
 * Security/emergency/admin roles acknowledge an ACTIVE alert (ACTIVE -> ACKNOWLEDGED).
 */
childSafetyRouter.post('/alerts/:id/acknowledge', async (req: Request, res: Response) => {
  const actor = resolveChildSafetyActor(req, res, { requireConcreteSociety: false });
  if (!actor) return;
  if (!enforceAllowedRoles(actor, SOS_MANAGE_ROLES, res)) return;

  try {
    const where: any = { id: String(req.params.id) };
    if (!actor.isPlatformAdmin || actor.societyId) {
      where.societyId = actor.societyId;
    }

    const alert = await prisma.childSafetyAlert.findFirst({
      where,
      include: { child: { select: { guardianUserId: true } } },
    });
    if (!alert) {
      return res.status(404).json({ error: 'Safety alert not found.', code: 'ALERT_NOT_FOUND' });
    }

    if (alert.status !== 'ACTIVE') {
      return res.status(422).json({
        error: `Cannot acknowledge alert from status '${alert.status}'. Only ACTIVE alerts can be acknowledged.`,
        code: 'INVALID_ALERT_TRANSITION',
      });
    }

    const now = new Date();
    const updated = await prisma.childSafetyAlert.updateMany({
      where: {
        id: alert.id,
        societyId: alert.societyId,
        status: 'ACTIVE',
      },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: now,
        acknowledgedById: actor.userId,
        acknowledgedByName: actor.name,
      },
    });

    if (updated.count !== 1) {
      return res.status(409).json({
        error: 'Safety alert state changed concurrently.',
        code: 'ALERT_STATE_CONFLICT',
      });
    }

    const refreshed = await prisma.childSafetyAlert.findUnique({ where: { id: alert.id } });

    await emitChildSafetyEvent(
      alert.societyId,
      'CHILD_SAFETY_ALERT_ACKNOWLEDGED',
      alert.id,
      actor.userId,
      {
        alertId: alert.id,
        childId: alert.childId,
        status: 'ACKNOWLEDGED',
        acknowledgedAt: now.toISOString(),
      },
      {
        allowedRoles: GATE_AND_SOS_EVENT_ROLES,
        targetUserIds: collectOwnerUserIds((alert as any).child?.guardianUserId, alert.reportedById),
      }
    );

    return res.json(sanitizeSafetyAlertDto(refreshed));
  } catch (err) {
    return handleChildSafetyError(res, err, 'POST /alerts/:id/acknowledge');
  }
});

/**
 * POST /api/children/alerts/:id/resolve
 * Security/emergency/admin roles resolve an ACTIVE or ACKNOWLEDGED alert -> RESOLVED or FALSE_ALARM.
 */
childSafetyRouter.post('/alerts/:id/resolve', async (req: Request, res: Response) => {
  const actor = resolveChildSafetyActor(req, res, { requireConcreteSociety: false });
  if (!actor) return;
  if (!enforceAllowedRoles(actor, SOS_MANAGE_ROLES, res)) return;

  try {
    const body = req.body || {};
    const targetStatus =
      typeof body.status === 'string' && body.status.trim()
        ? body.status.trim().toUpperCase()
        : 'RESOLVED';
    if (!ALLOWED_ALERT_RESOLVE_STATUSES.includes(targetStatus as any)) {
      return res.status(400).json({
        error: 'Resolution status must be RESOLVED or FALSE_ALARM.',
        code: 'INVALID_RESOLUTION_STATUS',
      });
    }

    if (!isNonEmptyString(body.resolutionNotes, 1000)) {
      return res.status(400).json({
        error: 'resolutionNotes is required when resolving a safety alert.',
        code: 'RESOLUTION_NOTES_REQUIRED',
      });
    }

    const where: any = { id: String(req.params.id) };
    if (!actor.isPlatformAdmin || actor.societyId) {
      where.societyId = actor.societyId;
    }

    const alert = await prisma.childSafetyAlert.findFirst({
      where,
      include: { child: { select: { guardianUserId: true } } },
    });
    if (!alert) {
      return res.status(404).json({ error: 'Safety alert not found.', code: 'ALERT_NOT_FOUND' });
    }

    if (alert.status !== 'ACTIVE' && alert.status !== 'ACKNOWLEDGED') {
      return res.status(422).json({
        error: `Cannot resolve alert from terminal status '${alert.status}'.`,
        code: 'INVALID_ALERT_TRANSITION',
      });
    }

    const now = new Date();
    const resolvedAlert = await prisma.$transaction(async (tx: any) => {
      if (alert.childId) {
        await lockChildProfileRow(tx, alert.childId, alert.societyId);
      }

      const updated = await tx.childSafetyAlert.updateMany({
        where: {
          id: alert.id,
          societyId: alert.societyId,
          status: { in: ['ACTIVE', 'ACKNOWLEDGED'] },
        },
        data: {
          status: targetStatus,
          resolvedAt: now,
          resolvedById: actor.userId,
          resolvedByName: actor.name,
          resolutionNotes: body.resolutionNotes.trim(),
        },
      });

      if (updated.count !== 1) {
        return null;
      }

      if (alert.emergencyIncidentId) {
        await tx.emergencyIncident.updateMany({
          where: {
            id: alert.emergencyIncidentId,
            societyId: alert.societyId,
          },
          data: {
            dispatchStatus: 'RESOLVED',
            resolvedAt: now,
          },
        });
      }

      // Restore child status from MISSING -> SAFE only if no other active MISSING_CHILD alert remains
      if (alert.childId && alert.alertType === 'MISSING_CHILD') {
        const remainingMissing = await tx.childSafetyAlert.count({
          where: {
            societyId: alert.societyId,
            childId: alert.childId,
            alertType: 'MISSING_CHILD',
            status: { in: ['ACTIVE', 'ACKNOWLEDGED'] },
          },
        });
        if (remainingMissing === 0) {
          await tx.childProfile.updateMany({
            where: {
              id: alert.childId,
              societyId: alert.societyId,
              status: 'MISSING',
              archivedAt: null,
            },
            data: { status: 'SAFE' },
          });
        }
      }

      return tx.childSafetyAlert.findUnique({ where: { id: alert.id } });
    });

    if (!resolvedAlert) {
      return res.status(409).json({
        error: 'Safety alert was already resolved concurrently.',
        code: 'ALERT_STATE_CONFLICT',
      });
    }

    await emitChildSafetyEvent(
      alert.societyId,
      'CHILD_SAFETY_ALERT_RESOLVED',
      alert.id,
      actor.userId,
      {
        alertId: alert.id,
        childId: alert.childId,
        status: targetStatus,
        resolvedAt: now.toISOString(),
      },
      {
        allowedRoles: GATE_AND_SOS_EVENT_ROLES,
        targetUserIds: collectOwnerUserIds((alert as any).child?.guardianUserId, alert.reportedById),
      }
    );

    return res.json(sanitizeSafetyAlertDto(resolvedAlert));
  } catch (err) {
    return handleChildSafetyError(res, err, 'POST /alerts/:id/resolve');
  }
});

// =============================================================================
// 3. CHILD PROFILES CRUD & ARCHIVAL
// =============================================================================

/**
 * GET /api/children
 * Lists child profiles accessible to the authenticated resident/guardian or society admin.
 */
childSafetyRouter.get('/', async (req: Request, res: Response) => {
  const actor = resolveChildSafetyActor(req, res, { requireConcreteSociety: false });
  if (!actor) return;
  if (!enforceAllowedRoles(actor, PROFILE_READ_ROLES, res)) return;

  try {
    const includeArchived = req.query.includeArchived === 'true';
    const where: any = {};

    if (!actor.isPlatformAdmin || actor.societyId) {
      where.societyId = actor.societyId;
    }

    if (!includeArchived) {
      where.archivedAt = null;
      where.status = { not: 'ARCHIVED' };
    }

    if (actor.role === 'resident') {
      const ownership = await resolveResidentOwnership(actor);
      if (!ownership) {
        return res.json([]);
      }
      where.OR = [{ residentId: ownership.residentId }, { guardianUserId: actor.userId }];
    }

    const children = await prisma.childProfile.findMany({
      where,
      include: { pickups: { where: { archivedAt: null } } },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(children.map(sanitizeChildProfileDto));
  } catch (err) {
    return handleChildSafetyError(res, err, 'GET /');
  }
});

/**
 * POST /api/children
 * Creates a child profile with verified guardian/resident + same-society flat ownership.
 */
childSafetyRouter.post('/', async (req: Request, res: Response) => {
  const actor = resolveChildSafetyActor(req, res, { requireConcreteSociety: true });
  if (!actor) return;
  if (!enforceAllowedRoles(actor, PROFILE_WRITE_ROLES, res)) return;

  try {
    const body = req.body || {};

    if (!isNonEmptyString(body.fullName, 200)) {
      return res.status(400).json({ error: 'fullName is required (1–200 chars).', code: 'INVALID_FULL_NAME' });
    }
    if (!isNonEmptyString(body.guardianName, 200)) {
      return res.status(400).json({ error: 'guardianName is required.', code: 'INVALID_GUARDIAN_NAME' });
    }
    if (!isNonEmptyString(body.guardianPhone, 32)) {
      return res.status(400).json({ error: 'guardianPhone is required.', code: 'INVALID_GUARDIAN_PHONE' });
    }

    const gender =
      typeof body.gender === 'string' && body.gender.trim()
        ? body.gender.trim().toUpperCase()
        : 'UNSPECIFIED';
    if (!ALLOWED_CHILD_GENDERS.includes(gender as any)) {
      return res.status(400).json({ error: 'Invalid gender enum value.', code: 'INVALID_GENDER' });
    }

    const exitPermissionMode =
      typeof body.exitPermissionMode === 'string' && body.exitPermissionMode.trim()
        ? body.exitPermissionMode.trim().toUpperCase()
        : 'ESCORT_REQUIRED';
    if (!ALLOWED_EXIT_PERMISSION_MODES.includes(exitPermissionMode as any)) {
      return res.status(400).json({
        error: 'Invalid exitPermissionMode enum value.',
        code: 'INVALID_EXIT_PERMISSION_MODE',
      });
    }

    const allowedSoloExit = exitPermissionMode === 'SOLO_ALLOWED';
    if (body.allowedSoloExit !== undefined && Boolean(body.allowedSoloExit) !== allowedSoloExit) {
      return res.status(400).json({
        error: 'allowedSoloExit must be consistent with exitPermissionMode (SOLO_ALLOWED).',
        code: 'INCONSISTENT_EXIT_POLICY',
      });
    }

    let dateOfBirth: Date | null = null;
    if (body.dateOfBirth !== undefined && body.dateOfBirth !== null && body.dateOfBirth !== '') {
      dateOfBirth = parseIsoDate(body.dateOfBirth);
      if (!dateOfBirth || dateOfBirth > new Date()) {
        return res.status(400).json({
          error: 'dateOfBirth must be a valid non-future ISO date.',
          code: 'INVALID_DATE_OF_BIRTH',
        });
      }
    }

    let reportedAge: number | null = null;
    if (body.reportedAge !== undefined && body.reportedAge !== null) {
      const parsedAge = Number(body.reportedAge);
      if (!Number.isInteger(parsedAge) || parsedAge < 0 || parsedAge > 25) {
        return res.status(400).json({
          error: 'reportedAge must be an integer between 0 and 25.',
          code: 'INVALID_REPORTED_AGE',
        });
      }
      reportedAge = parsedAge;
    }

    const photoCheck = normalizeOptionalString(body.photoUrl, 1000);
    const medicalCheck = normalizeOptionalString(body.medicalNotes, 1000);
    const emergencyCheck = normalizeOptionalString(body.emergencyPhone, 32);
    const notesCheck = normalizeOptionalString(body.notes, 1000);
    if (!photoCheck.valid || !medicalCheck.valid || !emergencyCheck.valid || !notesCheck.valid) {
      return res.status(400).json({ error: 'Invalid optional profile field.', code: 'INVALID_PROFILE_FIELD' });
    }

    // F-B22-06B: Strict structured validation for secondaryGuardians & emergencyContacts arrays
    const secondaryGuardiansCheck = validateContactList(body.secondaryGuardians, 'secondaryGuardians', {
      allowEmail: true,
    });
    if (!secondaryGuardiansCheck.valid) {
      return res.status(400).json({
        error: secondaryGuardiansCheck.error,
        code: 'INVALID_CONTACT_LIST',
      });
    }
    const emergencyContactsCheck = validateContactList(body.emergencyContacts, 'emergencyContacts', {
      allowEmail: false,
    });
    if (!emergencyContactsCheck.valid) {
      return res.status(400).json({
        error: emergencyContactsCheck.error,
        code: 'INVALID_CONTACT_LIST',
      });
    }

    let residentId: string;
    let flatId: string;
    let flatNumber: string;
    let guardianUserId: string | null = null;

    if (actor.role === 'resident') {
      const ownership = await resolveResidentOwnership(actor);
      if (!ownership) {
        return res.status(403).json({
          error: 'Forbidden: Active resident and flat membership in this society is required to register a child.',
          code: 'RESIDENT_OWNERSHIP_REQUIRED',
        });
      }

      // Reject attempts by resident to assign another residentId or another flatId
      if (body.residentId && String(body.residentId).trim() !== ownership.residentId) {
        return res.status(403).json({
          error: 'Forbidden: Residents cannot register children under another resident.',
          code: 'UNAUTHORIZED_OWNERSHIP_ASSIGNMENT',
        });
      }
      if (body.flatId && String(body.flatId).trim() !== ownership.flatId) {
        return res.status(403).json({
          error: 'Forbidden: Residents can only register children to their own assigned flat.',
          code: 'UNAUTHORIZED_FLAT_ASSIGNMENT',
        });
      }

      residentId = ownership.residentId;
      flatId = ownership.flatId;
      flatNumber = ownership.flatNumber;
      guardianUserId = actor.userId;
    } else {
      // Secretary / Admin must specify a valid residentId and flatId belonging to the SAME society
      if (!isNonEmptyString(body.residentId, 128) || !isNonEmptyString(body.flatId, 128)) {
        return res.status(400).json({
          error: 'residentId and flatId are required to register a child profile.',
          code: 'OWNER_AND_FLAT_REQUIRED',
        });
      }

      const [resident, flat] = await Promise.all([
        prisma.resident.findFirst({
          where: { id: body.residentId.trim(), societyId: actor.societyId, status: 'ACTIVE' },
        }),
        prisma.flat.findFirst({
          where: { id: body.flatId.trim(), societyId: actor.societyId },
        }),
      ]);

      if (!resident || !flat) {
        return res.status(400).json({
          error: 'Resident and flat must both exist within the authenticated society.',
          code: 'CROSS_SOCIETY_OR_MISSING_OWNER',
        });
      }

      if (resident.flatId !== flat.id) {
        return res.status(422).json({
          error: 'Specified resident does not belong to the specified flat.',
          code: 'RESIDENT_FLAT_MISMATCH',
        });
      }

      residentId = resident.id;
      flatId = flat.id;
      flatNumber = flat.flatNumber;
      guardianUserId = resident.userId ?? null;
    }

    const created = await prisma.childProfile.create({
      data: {
        societyId: actor.societyId,
        residentId,
        flatId,
        guardianUserId,
        flatNumber,
        fullName: body.fullName.trim(),
        dateOfBirth,
        reportedAge,
        gender: gender as any,
        photoUrl: photoCheck.value ?? null,
        medicalNotes: medicalCheck.value ?? null,
        status: 'SAFE',
        exitPermissionMode: exitPermissionMode as any,
        allowedSoloExit,
        guardianName: body.guardianName.trim(),
        guardianPhone: body.guardianPhone.trim(),
        emergencyPhone: emergencyCheck.value ?? null,
        secondaryGuardians: secondaryGuardiansCheck.value ? (secondaryGuardiansCheck.value as any) : undefined,
        emergencyContacts: emergencyContactsCheck.value ? (emergencyContactsCheck.value as any) : undefined,
        notes: notesCheck.value ?? null,
      },
    });

    await emitChildSafetyEvent(
      actor.societyId,
      'CHILD_PROFILE_CREATED',
      created.id,
      actor.userId,
      {
        id: created.id,
        flatNumber: created.flatNumber,
        status: created.status,
      },
      {
        allowedRoles: PROFILE_EVENT_ROLES,
        targetUserIds: collectOwnerUserIds(guardianUserId, actor.role === 'resident' ? actor.userId : null),
      }
    );

    return res.status(201).json(sanitizeChildProfileDto(created));
  } catch (err) {
    return handleChildSafetyError(res, err, 'POST /');
  }
});

/**
 * GET /api/children/:id
 */
childSafetyRouter.get('/:id', async (req: Request, res: Response) => {
  const actor = resolveChildSafetyActor(req, res, { requireConcreteSociety: false });
  if (!actor) return;
  if (!enforceAllowedRoles(actor, PROFILE_READ_ROLES, res)) return;

  try {
    const child = await authorizeChildAccess(actor, String(req.params.id), res, true);
    if (!child) return;

    return res.json(sanitizeChildProfileDto(child));
  } catch (err) {
    return handleChildSafetyError(res, err, 'GET /:id');
  }
});

/**
 * PATCH /api/children/:id
 * Updates mutable profile fields; strictly blocks changing ownership or society.
 */
childSafetyRouter.patch('/:id', async (req: Request, res: Response) => {
  const actor = resolveChildSafetyActor(req, res, { requireConcreteSociety: false });
  if (!actor) return;
  if (!enforceAllowedRoles(actor, PROFILE_WRITE_ROLES, res)) return;

  try {
    const body = req.body || {};

    // Prevent ownership or society reassignment through ordinary profile updates
    const immutableFields = ['societyId', 'residentId', 'flatId', 'guardianUserId', 'archivedAt', 'archivedById'];
    for (const field of immutableFields) {
      if (body[field] !== undefined) {
        return res.status(400).json({
          error: `Field '${field}' cannot be modified via profile update.`,
          code: 'IMMUTABLE_OWNERSHIP_FIELD',
        });
      }
    }

    const child = await authorizeChildAccess(actor, String(req.params.id), res);
    if (!child) return;

    if (child.status === 'ARCHIVED' || child.archivedAt) {
      return res.status(409).json({
        error: 'Archived child profiles cannot be updated.',
        code: 'CHILD_ARCHIVED',
      });
    }

    const updateData: Record<string, any> = {};

    if (body.fullName !== undefined) {
      if (!isNonEmptyString(body.fullName, 200)) {
        return res.status(400).json({ error: 'Invalid fullName.', code: 'INVALID_FULL_NAME' });
      }
      updateData.fullName = body.fullName.trim();
    }

    if (body.gender !== undefined) {
      const g = String(body.gender).trim().toUpperCase();
      if (!ALLOWED_CHILD_GENDERS.includes(g as any)) {
        return res.status(400).json({ error: 'Invalid gender.', code: 'INVALID_GENDER' });
      }
      updateData.gender = g;
    }

    if (body.dateOfBirth !== undefined) {
      if (body.dateOfBirth === null || body.dateOfBirth === '') {
        updateData.dateOfBirth = null;
      } else {
        const dob = parseIsoDate(body.dateOfBirth);
        if (!dob || dob > new Date()) {
          return res.status(400).json({ error: 'Invalid dateOfBirth.', code: 'INVALID_DATE_OF_BIRTH' });
        }
        updateData.dateOfBirth = dob;
      }
    }

    if (body.reportedAge !== undefined) {
      if (body.reportedAge === null) {
        updateData.reportedAge = null;
      } else {
        const age = Number(body.reportedAge);
        if (!Number.isInteger(age) || age < 0 || age > 25) {
          return res.status(400).json({ error: 'Invalid reportedAge.', code: 'INVALID_REPORTED_AGE' });
        }
        updateData.reportedAge = age;
      }
    }

    if (body.exitPermissionMode !== undefined) {
      const mode = String(body.exitPermissionMode).trim().toUpperCase();
      if (!ALLOWED_EXIT_PERMISSION_MODES.includes(mode as any)) {
        return res.status(400).json({ error: 'Invalid exitPermissionMode.', code: 'INVALID_EXIT_PERMISSION_MODE' });
      }
      if (body.allowedSoloExit !== undefined && Boolean(body.allowedSoloExit) !== (mode === 'SOLO_ALLOWED')) {
        return res.status(400).json({
          error: 'allowedSoloExit must match exitPermissionMode (SOLO_ALLOWED).',
          code: 'INCONSISTENT_EXIT_POLICY',
        });
      }
      updateData.exitPermissionMode = mode;
      updateData.allowedSoloExit = mode === 'SOLO_ALLOWED';
    } else if (body.allowedSoloExit !== undefined) {
      const solo = Boolean(body.allowedSoloExit);
      updateData.allowedSoloExit = solo;
      updateData.exitPermissionMode = solo ? 'SOLO_ALLOWED' : 'ESCORT_REQUIRED';
    }

    if (body.status !== undefined) {
      const nextStatus = String(body.status).trim().toUpperCase();
      if (!ALLOWED_CHILD_STATUSES.includes(nextStatus as any) || nextStatus === 'ARCHIVED') {
        return res.status(422).json({
          error: 'Invalid status transition. Use the archive endpoint to archive a child profile.',
          code: 'INVALID_STATUS_TRANSITION',
        });
      }
      if (child.status === 'MISSING' && nextStatus !== 'MISSING') {
        const activeMissingAlert = await prisma.childSafetyAlert.findFirst({
          where: {
            societyId: child.societyId,
            childId: child.id,
            alertType: 'MISSING_CHILD',
            status: { in: ['ACTIVE', 'ACKNOWLEDGED'] },
          },
        });
        if (activeMissingAlert) {
          return res.status(409).json({
            error: 'Cannot clear MISSING status while an active MISSING_CHILD alert remains unresolved.',
            code: 'ACTIVE_MISSING_ALERT_MUST_BE_RESOLVED',
          });
        }
      }
      updateData.status = nextStatus;
    }

    if (body.guardianName !== undefined) {
      if (!isNonEmptyString(body.guardianName, 200)) {
        return res.status(400).json({ error: 'Invalid guardianName.', code: 'INVALID_GUARDIAN_NAME' });
      }
      updateData.guardianName = body.guardianName.trim();
    }

    if (body.guardianPhone !== undefined) {
      if (!isNonEmptyString(body.guardianPhone, 32)) {
        return res.status(400).json({ error: 'Invalid guardianPhone.', code: 'INVALID_GUARDIAN_PHONE' });
      }
      updateData.guardianPhone = body.guardianPhone.trim();
    }

    for (const [key, maxLen] of [
      ['photoUrl', 1000],
      ['medicalNotes', 1000],
      ['emergencyPhone', 32],
      ['notes', 1000],
    ] as const) {
      if (body[key] !== undefined) {
        const chk = normalizeOptionalString(body[key], maxLen);
        if (!chk.valid) {
          return res.status(400).json({ error: `Invalid ${key}.`, code: 'INVALID_PROFILE_FIELD' });
        }
        updateData[key] = chk.value;
      }
    }

    // F-B22-06B: Validate secondaryGuardians & emergencyContacts updates when provided
    if (body.secondaryGuardians !== undefined) {
      if (body.secondaryGuardians === null) {
        updateData.secondaryGuardians = [];
      } else {
        const chk = validateContactList(body.secondaryGuardians, 'secondaryGuardians', { allowEmail: true });
        if (!chk.valid) {
          return res.status(400).json({ error: chk.error, code: 'INVALID_CONTACT_LIST' });
        }
        updateData.secondaryGuardians = chk.value;
      }
    }
    if (body.emergencyContacts !== undefined) {
      if (body.emergencyContacts === null) {
        updateData.emergencyContacts = [];
      } else {
        const chk = validateContactList(body.emergencyContacts, 'emergencyContacts', { allowEmail: false });
        if (!chk.valid) {
          return res.status(400).json({ error: chk.error, code: 'INVALID_CONTACT_LIST' });
        }
        updateData.emergencyContacts = chk.value;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No valid updatable fields provided.', code: 'EMPTY_UPDATE' });
    }

    const updatedCount = await prisma.childProfile.updateMany({
      where: {
        id: child.id,
        societyId: child.societyId,
        archivedAt: null,
      },
      data: updateData,
    });

    if (updatedCount.count !== 1) {
      return res.status(409).json({ error: 'Child profile could not be updated.', code: 'UPDATE_CONFLICT' });
    }

    const refreshed = await prisma.childProfile.findUnique({ where: { id: child.id } });

    await emitChildSafetyEvent(
      child.societyId,
      'CHILD_PROFILE_UPDATED',
      child.id,
      actor.userId,
      {
        id: child.id,
        status: refreshed?.status,
      },
      {
        allowedRoles: PROFILE_EVENT_ROLES,
        targetUserIds: collectOwnerUserIds(child.guardianUserId, actor.role === 'resident' ? actor.userId : null),
      }
    );

    return res.json(sanitizeChildProfileDto(refreshed));
  } catch (err) {
    return handleChildSafetyError(res, err, 'PATCH /:id');
  }
});

async function handleArchiveChild(req: Request, res: Response): Promise<Response> {
  const actor = resolveChildSafetyActor(req, res, { requireConcreteSociety: false });
  if (!actor) return res;
  if (!enforceAllowedRoles(actor, PROFILE_WRITE_ROLES, res)) return res;

  try {
    const child = await authorizeChildAccess(actor, String(req.params.id), res);
    if (!child) return res;

    if (child.status === 'ARCHIVED' || child.archivedAt) {
      return res.status(409).json({ error: 'Child profile is already archived.', code: 'ALREADY_ARCHIVED' });
    }

    const now = new Date();
    const archived = await prisma.$transaction(async (tx: any) => {
      await tx.childGatePass.updateMany({
        where: {
          societyId: child.societyId,
          childId: child.id,
          status: 'ACTIVE',
        },
        data: {
          status: 'REVOKED',
          revokedAt: now,
          revokedById: actor.userId,
          revocationReason: 'CHILD_PROFILE_ARCHIVED',
        },
      });

      await tx.childProfile.updateMany({
        where: {
          id: child.id,
          societyId: child.societyId,
          archivedAt: null,
        },
        data: {
          status: 'ARCHIVED',
          archivedAt: now,
          archivedById: actor.userId,
        },
      });

      return tx.childProfile.findUnique({ where: { id: child.id } });
    });

    await emitChildSafetyEvent(
      child.societyId,
      'CHILD_PROFILE_ARCHIVED',
      child.id,
      actor.userId,
      {
        id: child.id,
        status: 'ARCHIVED',
      },
      {
        allowedRoles: PROFILE_EVENT_ROLES,
        targetUserIds: collectOwnerUserIds(child.guardianUserId, actor.role === 'resident' ? actor.userId : null),
      }
    );

    return res.json(sanitizeChildProfileDto(archived));
  } catch (err) {
    return handleChildSafetyError(res, err, 'POST /:id/archive');
  }
}

childSafetyRouter.post('/:id/archive', handleArchiveChild);
childSafetyRouter.delete('/:id', handleArchiveChild);

// =============================================================================
// 4. AUTHORIZED PICKUPS (Scoped strictly to authorized child)
// =============================================================================

/**
 * GET /api/children/:childId/pickups
 */
childSafetyRouter.get('/:childId/pickups', async (req: Request, res: Response) => {
  const actor = resolveChildSafetyActor(req, res, { requireConcreteSociety: false });
  if (!actor) return;
  if (!enforceAllowedRoles(actor, PROFILE_READ_ROLES, res)) return;

  try {
    const child = await authorizeChildAccess(actor, String(req.params.childId), res);
    if (!child) return;

    const pickups = await prisma.childAuthorizedPickup.findMany({
      where: {
        societyId: child.societyId,
        childId: child.id,
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(pickups.map(sanitizePickupDto));
  } catch (err) {
    return handleChildSafetyError(res, err, 'GET /:childId/pickups');
  }
});

/**
 * POST /api/children/:childId/pickups
 * Adds an authorized pickup person with strict PII minimization (rejects raw ID numbers).
 */
childSafetyRouter.post('/:childId/pickups', async (req: Request, res: Response) => {
  const actor = resolveChildSafetyActor(req, res, { requireConcreteSociety: false });
  if (!actor) return;
  if (!enforceAllowedRoles(actor, PROFILE_WRITE_ROLES, res)) return;

  try {
    const body = req.body || {};

    const forbiddenField = hasForbiddenRawIdField(body);
    if (forbiddenField) {
      return res.status(400).json({
        error: `Raw identity document field '${forbiddenField}' is prohibited. Only optional document type and last 4 characters are allowed.`,
        code: 'RAW_ID_DOCUMENT_FORBIDDEN',
      });
    }

    const child = await authorizeChildAccess(actor, String(req.params.childId), res);
    if (!child) return;

    if (child.status === 'ARCHIVED' || child.archivedAt) {
      return res.status(409).json({
        error: 'Cannot add pickup authorization to an archived child profile.',
        code: 'CHILD_ARCHIVED',
      });
    }

    if (!isNonEmptyString(body.name, 200)) {
      return res.status(400).json({ error: 'name is required.', code: 'INVALID_NAME' });
    }
    if (!isValidPhoneNumber(body.phone)) {
      return res.status(400).json({ error: 'phone must be a valid phone number (7–15 digits).', code: 'INVALID_PHONE' });
    }
    if (!isNonEmptyString(body.relationship, 100)) {
      return res.status(400).json({ error: 'relationship is required.', code: 'INVALID_RELATIONSHIP' });
    }

    const docTypeCheck = normalizeOptionalString(body.idDocumentType, 64);
    const docLast4Check = normalizeOptionalString(body.idDocumentLast4, 4);
    const photoCheck = normalizeOptionalString(body.photoUrl, 1000);
    const notesCheck = normalizeOptionalString(body.notes, 500);

    if (!docTypeCheck.valid || !docLast4Check.valid || !photoCheck.valid || !notesCheck.valid) {
      return res.status(400).json({
        error: 'Invalid optional pickup metadata (idDocumentLast4 must be 1–4 characters).',
        code: 'INVALID_PICKUP_METADATA',
      });
    }

    let validUntil: Date | null = null;
    if (body.validUntil !== undefined && body.validUntil !== null && body.validUntil !== '') {
      validUntil = parseIsoDate(body.validUntil);
      if (!validUntil || validUntil <= new Date()) {
        return res.status(400).json({
          error: 'validUntil must be a valid future ISO timestamp.',
          code: 'INVALID_VALID_UNTIL',
        });
      }
    }

    const hasDocMeta = Boolean(docTypeCheck.value || docLast4Check.value);
    const created = await prisma.childAuthorizedPickup.create({
      data: {
        societyId: child.societyId,
        childId: child.id,
        name: body.name.trim(),
        phone: body.phone.trim(),
        relationship: body.relationship.trim(),
        idDocumentType: docTypeCheck.value ?? null,
        idDocumentLast4: docLast4Check.value ?? null,
        idVerificationStatus: hasDocMeta ? 'UNVERIFIED' : 'NOT_COLLECTED',
        createdById: actor.userId,
        photoUrl: photoCheck.value ?? null,
        status: 'ACTIVE',
        validUntil,
        notes: notesCheck.value ?? null,
      },
    });

    await emitChildSafetyEvent(
      child.societyId,
      'CHILD_PICKUP_AUTHORIZED',
      created.id,
      actor.userId,
      {
        id: created.id,
        childId: child.id,
        status: created.status,
      },
      {
        allowedRoles: PROFILE_EVENT_ROLES,
        targetUserIds: collectOwnerUserIds(child.guardianUserId, actor.role === 'resident' ? actor.userId : null),
      }
    );

    return res.status(201).json(sanitizePickupDto(created));
  } catch (err) {
    return handleChildSafetyError(res, err, 'POST /:childId/pickups');
  }
});

/**
 * PATCH /api/children/:childId/pickups/:pickupId
 */
childSafetyRouter.patch('/:childId/pickups/:pickupId', async (req: Request, res: Response) => {
  const actor = resolveChildSafetyActor(req, res, { requireConcreteSociety: false });
  if (!actor) return;
  if (!enforceAllowedRoles(actor, PROFILE_WRITE_ROLES, res)) return;

  try {
    const body = req.body || {};

    const forbiddenField = hasForbiddenRawIdField(body);
    if (forbiddenField) {
      return res.status(400).json({
        error: `Raw identity document field '${forbiddenField}' is prohibited.`,
        code: 'RAW_ID_DOCUMENT_FORBIDDEN',
      });
    }

    const immutablePickupFields = ['societyId', 'childId', 'archivedAt', 'createdById'];
    for (const field of immutablePickupFields) {
      if (body[field] !== undefined) {
        return res.status(400).json({
          error: `Field '${field}' cannot be modified via pickup update.`,
          code: 'IMMUTABLE_PICKUP_FIELD',
        });
      }
    }

    const child = await authorizeChildAccess(actor, String(req.params.childId), res);
    if (!child) return;

    const pickup = await prisma.childAuthorizedPickup.findFirst({
      where: {
        id: String(req.params.pickupId),
        societyId: child.societyId,
        childId: child.id,
      },
    });

    if (!pickup) {
      return res.status(404).json({ error: 'Authorized pickup not found.', code: 'PICKUP_NOT_FOUND' });
    }

    if (pickup.status === 'ARCHIVED' || pickup.archivedAt) {
      return res.status(409).json({
        error: 'Archived pickup authorization cannot be modified.',
        code: 'PICKUP_ARCHIVED',
      });
    }

    // F-B22-06C / F-P43-R1: Revoked pickups are unconditionally immutable via PATCH
    // regardless of payload (prevents REVOKED -> EXPIRED -> ACTIVE bypass and audit tampering).
    if (pickup.status === 'REVOKED') {
      return res.status(422).json({
        error:
          'Revoked pickup authorizations are immutable and cannot be modified or reactivated. Create a new pickup authorization instead.',
        code: 'REVOKED_PICKUP_CANNOT_BE_REACTIVATED',
      });
    }

    const now = new Date();
    const updateData: Record<string, any> = {};
    if (body.name !== undefined) {
      if (!isNonEmptyString(body.name, 200)) {
        return res.status(400).json({ error: 'Invalid name.', code: 'INVALID_NAME' });
      }
      updateData.name = body.name.trim();
    }
    if (body.phone !== undefined) {
      if (!isValidPhoneNumber(body.phone)) {
        return res.status(400).json({ error: 'Invalid phone number (7–15 digits required).', code: 'INVALID_PHONE' });
      }
      updateData.phone = body.phone.trim();
    }
    if (body.relationship !== undefined) {
      if (!isNonEmptyString(body.relationship, 100)) {
        return res.status(400).json({ error: 'Invalid relationship.', code: 'INVALID_RELATIONSHIP' });
      }
      updateData.relationship = body.relationship.trim();
    }

    const wasExpiredByTime = Boolean(pickup.validUntil && new Date(pickup.validUntil) <= now);
    const isExpiredPickup = pickup.status === 'EXPIRED' || wasExpiredByTime;

    let hasExplicitFutureValidUntil = false;
    if (body.validUntil !== undefined) {
      if (body.validUntil === null || body.validUntil === '') {
        // F-P43-01: Reject clearing validUntil on persisted-EXPIRED or time-expired ACTIVE pickups
        if (isExpiredPickup) {
          return res.status(422).json({
            error:
              'Expired pickup authorization cannot clear validUntil. Provide a new future validUntil timestamp to renew.',
            code: 'EXPIRED_PICKUP_REQUIRES_FUTURE_VALID_UNTIL',
          });
        }
        updateData.validUntil = null;
      } else {
        const vu = parseIsoDate(body.validUntil);
        if (!vu || vu <= now) {
          return res.status(400).json({ error: 'validUntil must be in the future.', code: 'INVALID_VALID_UNTIL' });
        }
        updateData.validUntil = vu;
        hasExplicitFutureValidUntil = true;
      }
    }
    if (body.status !== undefined) {
      const nextStatus = String(body.status).trim().toUpperCase();
      if (!ALLOWED_PICKUP_STATUSES.includes(nextStatus as any) || nextStatus === 'ARCHIVED') {
        return res.status(422).json({ error: 'Invalid pickup status transition.', code: 'INVALID_STATUS_TRANSITION' });
      }
      // F-B22-06C / F-P43-01: Expired (or past-validUntil) pickups can only be renewed to ACTIVE with a fresh future validUntil.
      const effectiveValidUntil =
        body.validUntil !== undefined
          ? updateData.validUntil
          : pickup.validUntil
            ? new Date(pickup.validUntil)
            : null;
      if (
        nextStatus === 'ACTIVE' &&
        isExpiredPickup &&
        (!hasExplicitFutureValidUntil || !effectiveValidUntil || effectiveValidUntil <= now)
      ) {
        return res.status(422).json({
          error: 'Expired pickup authorization cannot be reactivated without a new future validUntil timestamp.',
          code: 'EXPIRED_PICKUP_REQUIRES_FUTURE_VALID_UNTIL',
        });
      }
      updateData.status = nextStatus;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No valid updatable fields provided.', code: 'EMPTY_UPDATE' });
    }

    const txResult = await prisma.$transaction(async (tx: any) => {
      // F-P43-R3: Conditional `status: { not: 'REVOKED' }` & `archivedAt: null` closes concurrent revoke/archive TOCTOU
      const updateRes = await tx.childAuthorizedPickup.updateMany({
        where: {
          id: pickup.id,
          societyId: child.societyId,
          childId: child.id,
          archivedAt: null,
          status: { not: 'REVOKED' },
        },
        data: updateData,
      });

      if (typeof updateRes?.count === 'number' && updateRes.count === 0) {
        return { conflict: true as const };
      }

      if (updateData.status === 'REVOKED' || updateData.status === 'EXPIRED') {
        await tx.childGatePass.updateMany({
          where: {
            societyId: child.societyId,
            childId: child.id,
            pickupPersonId: pickup.id,
            status: 'ACTIVE',
          },
          data: {
            status: 'REVOKED',
            revokedAt: now,
            revokedById: actor.userId,
            revocationReason: 'PICKUP_AUTHORIZATION_REVOKED',
          },
        });
      }

      const fresh = await tx.childAuthorizedPickup.findUnique({ where: { id: pickup.id } });
      return { conflict: false as const, updatedPickup: fresh };
    });

    if (txResult.conflict) {
      return res.status(422).json({
        error: 'Pickup authorization was concurrently revoked or archived and can no longer be modified.',
        code: 'REVOKED_PICKUP_CANNOT_BE_REACTIVATED',
      });
    }
    const updatedPickup = txResult.updatedPickup;

    await emitChildSafetyEvent(
      child.societyId,
      'CHILD_PICKUP_UPDATED',
      pickup.id,
      actor.userId,
      {
        id: pickup.id,
        childId: child.id,
        status: updatedPickup?.status,
      },
      {
        allowedRoles: PROFILE_EVENT_ROLES,
        targetUserIds: collectOwnerUserIds(child.guardianUserId, actor.role === 'resident' ? actor.userId : null),
      }
    );

    return res.json(sanitizePickupDto(updatedPickup));
  } catch (err) {
    return handleChildSafetyError(res, err, 'PATCH /:childId/pickups/:pickupId');
  }
});

async function handleRevokeOrArchivePickup(req: Request, res: Response, archiveMode: boolean): Promise<Response> {
  const actor = resolveChildSafetyActor(req, res, { requireConcreteSociety: false });
  if (!actor) return res;
  if (!enforceAllowedRoles(actor, PROFILE_WRITE_ROLES, res)) return res;

  try {
    const child = await authorizeChildAccess(actor, String(req.params.childId), res);
    if (!child) return res;

    const pickup = await prisma.childAuthorizedPickup.findFirst({
      where: {
        id: String(req.params.pickupId),
        societyId: child.societyId,
        childId: child.id,
      },
    });

    if (!pickup) {
      return res.status(404).json({ error: 'Authorized pickup not found.', code: 'PICKUP_NOT_FOUND' });
    }

    if (pickup.status === 'ARCHIVED' || pickup.archivedAt) {
      return res.status(409).json({ error: 'Pickup authorization is already archived.', code: 'ALREADY_ARCHIVED' });
    }

    if (!archiveMode && pickup.status === 'REVOKED') {
      return res.status(409).json({ error: 'Pickup authorization is already revoked.', code: 'ALREADY_REVOKED' });
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx: any) => {
      await tx.childGatePass.updateMany({
        where: {
          societyId: child.societyId,
          childId: child.id,
          pickupPersonId: pickup.id,
          status: 'ACTIVE',
        },
        data: {
          status: 'REVOKED',
          revokedAt: now,
          revokedById: actor.userId,
          revocationReason: archiveMode ? 'PICKUP_AUTHORIZATION_ARCHIVED' : 'PICKUP_AUTHORIZATION_REVOKED',
        },
      });

      await tx.childAuthorizedPickup.updateMany({
        where: {
          id: pickup.id,
          societyId: child.societyId,
          childId: child.id,
          archivedAt: null,
        },
        data: archiveMode
          ? { status: 'ARCHIVED', archivedAt: now }
          : { status: 'REVOKED' },
      });

      return tx.childAuthorizedPickup.findUnique({ where: { id: pickup.id } });
    });

    await emitChildSafetyEvent(
      child.societyId,
      'CHILD_PICKUP_REVOKED',
      pickup.id,
      actor.userId,
      {
        id: pickup.id,
        childId: child.id,
        status: updated?.status,
      },
      {
        allowedRoles: PROFILE_EVENT_ROLES,
        targetUserIds: collectOwnerUserIds(child.guardianUserId, actor.role === 'resident' ? actor.userId : null),
      }
    );

    return res.json(sanitizePickupDto(updated));
  } catch (err) {
    return handleChildSafetyError(res, err, 'REVOKE/ARCHIVE pickup');
  }
}

childSafetyRouter.post('/:childId/pickups/:pickupId/revoke', (req, res) =>
  handleRevokeOrArchivePickup(req, res, false)
);
childSafetyRouter.delete('/:childId/pickups/:pickupId', (req, res) =>
  handleRevokeOrArchivePickup(req, res, true)
);
