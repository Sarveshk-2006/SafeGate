import { Request, Response } from 'express';
import { prisma } from '../prisma.js';

export interface ResolvedChildSafetyActor {
  userId: string;
  role: string;
  name: string;
  societyId: string;
  isPlatformAdmin: boolean;
}

export interface ResolvedResidentOwnership {
  residentId: string;
  flatId: string;
  flatNumber: string;
  societyId: string;
  name: string;
  phone: string;
}

const PLATFORM_SENTINELS = new Set(['soc-platform', 'platform', '*', 'all']);

/**
 * Resolves and validates the authenticated actor strictly from verified `req.authContext`.
 *
 * Security invariants:
 * - Never trusts `x-user-id`, `x-user-role`, `x-society-id`, query params, or request body identity fields.
 * - Never falls back to `soc-gvs` or any hardcoded society ID.
 * - Non-platform-admin callers MUST have a valid non-empty authenticated societyId.
 * - Non-platform-admin callers attempting to pass a different `societyId` in body/query/params are rejected (403).
 * - Platform admins (`role === 'admin'` with platform sentinel / null society) may target a specific
 *   society via explicit verified `societyId` only when permitted, and must still pass real DB society validation.
 */
export function resolveChildSafetyActor(
  req: Request,
  res: Response,
  options: { requireConcreteSociety?: boolean; ignoreBodySocietyId?: boolean } = {
    requireConcreteSociety: true,
    ignoreBodySocietyId: false,
  }
): ResolvedChildSafetyActor | null {
  const ctx = req.authContext;
  if (!ctx || !ctx.userId || !ctx.role) {
    res.status(401).json({
      error: 'Unauthorized: Verified authentication context is required.',
      code: 'AUTH_CONTEXT_MISSING',
    });
    return null;
  }

  const role = ctx.role.toLowerCase();
  const rawAuthSociety = typeof ctx.societyId === 'string' ? ctx.societyId.trim() : '';
  const isPlatformAdmin =
    role === 'admin' && (!rawAuthSociety || PLATFORM_SENTINELS.has(rawAuthSociety));

  const callerSuppliedSociety =
    (typeof req.params?.societyId === 'string' && req.params.societyId.trim()) ||
    (!options.ignoreBodySocietyId && typeof req.body?.societyId === 'string' && req.body.societyId.trim()) ||
    (typeof req.query?.societyId === 'string' && req.query.societyId.trim()) ||
    '';

  if (!isPlatformAdmin) {
    if (!rawAuthSociety || PLATFORM_SENTINELS.has(rawAuthSociety)) {
      res.status(403).json({
        error: 'Tenant context required: Authenticated user is not linked to an active society.',
        code: 'TENANT_CONTEXT_REQUIRED',
      });
      return null;
    }

    if (callerSuppliedSociety && callerSuppliedSociety !== rawAuthSociety) {
      res.status(403).json({
        error: 'Forbidden: Cross-society tenant override is not permitted.',
        code: 'TENANT_ISOLATION_VIOLATION',
      });
      return null;
    }

    return {
      userId: ctx.userId,
      role,
      name: ctx.name || 'Authenticated User',
      societyId: rawAuthSociety,
      isPlatformAdmin: false,
    };
  }

  // Verified platform administrator
  const effectiveSocietyId =
    callerSuppliedSociety && !PLATFORM_SENTINELS.has(callerSuppliedSociety)
      ? callerSuppliedSociety
      : '';

  if (options.requireConcreteSociety && !effectiveSocietyId) {
    res.status(400).json({
      error: 'A valid target societyId is required for platform-admin write operations.',
      code: 'TARGET_SOCIETY_REQUIRED',
    });
    return null;
  }

  return {
    userId: ctx.userId,
    role,
    name: ctx.name || 'Platform Administrator',
    societyId: effectiveSocietyId,
    isPlatformAdmin: true,
  };
}

/**
 * Enforces explicit endpoint-level role authorization (deny-by-default).
 * Unlike generic `requireRole`, this does NOT implicitly allow `admin` unless listed
 * OR explicitly enabled via `allowPlatformAdmin`, preventing accidental role bypasses.
 */
export function enforceAllowedRoles(
  actor: ResolvedChildSafetyActor,
  allowedRoles: readonly string[],
  res: Response
): boolean {
  const normalized = allowedRoles.map((r) => r.toLowerCase());
  if (normalized.includes(actor.role)) {
    return true;
  }
  res.status(403).json({
    error: `Access denied: Role '${actor.role}' is not authorized for this Child Safety operation.`,
    code: 'INSUFFICIENT_PERMISSIONS',
  });
  return false;
}

/**
 * Resolves the database-backed active Resident + Flat record for an authenticated resident user
 * strictly within their verified society.
 */
export async function resolveResidentOwnership(
  actor: ResolvedChildSafetyActor
): Promise<ResolvedResidentOwnership | null> {
  const resident = await prisma.resident.findFirst({
    where: {
      societyId: actor.societyId,
      status: 'ACTIVE',
      OR: [{ userId: actor.userId }, { id: actor.userId }],
    },
    include: { flat: true },
  });

  if (!resident || !resident.flat || resident.flat.societyId !== actor.societyId) {
    return null;
  }

  return {
    residentId: resident.id,
    flatId: resident.flatId,
    flatNumber: resident.flat.flatNumber,
    societyId: resident.societyId,
    name: resident.name,
    phone: resident.phone,
  };
}

/**
 * Verifies whether an actor is authorized to access/mutate a specific ChildProfile.
 * - Cross-society records are treated as nonexistent (caller receives 404 — zero existence oracle).
 * - Same-society resident non-owners receive 403.
 */
export async function authorizeChildAccess(
  actor: ResolvedChildSafetyActor,
  childId: string,
  res: Response,
  includePickups = false
): Promise<any | null> {
  const where: any = { id: childId };
  if (!actor.isPlatformAdmin || actor.societyId) {
    where.societyId = actor.societyId;
  }

  const child = await prisma.childProfile.findFirst({
    where,
    ...(includePickups ? { include: { pickups: true } } : {}),
  });

  if (!child) {
    res.status(404).json({
      error: 'Child profile not found.',
      code: 'CHILD_NOT_FOUND',
    });
    return null;
  }

  if (actor.role === 'resident') {
    const ownership = await resolveResidentOwnership(actor);
    const isOwner =
      (ownership && child.residentId === ownership.residentId) ||
      child.guardianUserId === actor.userId;

    if (!isOwner) {
      res.status(403).json({
        error: 'Forbidden: You do not have guardian ownership over this child profile.',
        code: 'UNAUTHORIZED_CHILD_ACCESS',
      });
      return null;
    }
  }

  return child;
}
