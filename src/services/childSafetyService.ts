// =============================================================================
// AARIZO — ISSUE-06 Phase B.2.3 (Phase 3): Unified Authoritative Child Safety Service
// Single shared asynchronous facade backed strictly by Phase 1 `apiClient.*Strict`
// and authenticated PostgreSQL backend APIs.
//
// Architectural invariants:
// - Backend is the exclusive authoritative source of truth for Child Safety data.
// - All 20 canonical async operations preserve `ApiError` (status, kind, code, retry).
// - Zero `localStorage` / `sessionStorage` writes for Child Safety records.
// - Zero hardcoded `'soc-gvs'` / `'soc-1'` tenant fallbacks.
// - Zero persistence of raw government IDs, `bearerToken`, or `qrPayload`.
// - Deprecated synchronous compatibility adapters (retained only for unmigrated
//   Phase 4/5/6 UI pages until their designated phases) NEVER write to localStorage
//   and NEVER fabricate mutation or gate-verification success.
// =============================================================================

import { apiClient, ApiError } from './apiClient';
import type { ApiErrorKind } from './apiClient';
import { getAuthToken, getStoredUser } from './authStorage';
import type {
  AuthorizedPickupDto,
  AuthorizedPickupPerson,
  ChildExitLogDto,
  ChildGatePassCreatedDto,
  ChildGatePassDto,
  ChildPickupQR,
  ChildProfile,
  ChildProfileDto,
  ChildSafetyAlert,
  ChildSafetyAlertDto,
  ChildSosCreatedDto,
  CreateAuthorizedPickupRequest,
  CreateChildGatePassOptions,
  CreateChildGatePassRequest,
  CreateChildProfileRequest,
  EmergencyContact,
  Guardian,
  ListChildAlertsParams,
  ListChildExitLogsParams,
  ListChildGatePassesParams,
  ListChildrenParams,
  PickupLog,
  ResolveChildAlertRequest,
  RevokeChildGatePassRequest,
  TriggerChildSosRequest,
  UpdateAuthorizedPickupRequest,
  UpdateChildProfileRequest,
  VerifyChildGatePassRequest,
  VerifyChildGatePassSuccessDto,
} from '../types/childSafety';

const PLATFORM_ADMIN_SENTINELS = new Set(['soc-platform', 'platform', '*', 'all']);

type SnapshotResource = 'children' | 'passes' | 'exitLogs' | 'alerts';

interface RequestSessionContext {
  fingerprint: string | null;
  revision: number;
  resourceVersion?: number;
}

interface ScopedSnapshotEntry<T = unknown> {
  sessionFingerprint: string;
  societyScope: string;
  resource: SnapshotResource;
  filterKey: string;
  isDefaultScope: boolean;
  data: T;
  updatedAt: string;
}

const MAX_SCOPED_SNAPSHOTS = 64;

export type ChildSafetyInvalidationScope =
  | 'children'
  | 'pickups'
  | 'passes'
  | 'exitLogs'
  | 'alerts'
  | 'all';

export interface ChildSafetyInvalidationEvent {
  scopes: ReadonlyArray<ChildSafetyInvalidationScope>;
  reason: 'mutation' | 'realtime' | 'reconnect' | 'session_reset';
  childId?: string;
  topic?: string;
  timestamp: string;
}

export interface FormattedChildSafetyError {
  title: string;
  message: string;
  kind: ApiErrorKind | 'UNKNOWN';
  code: string;
  status: number;
  retryAfterSeconds?: number;
  isRetryable: boolean;
}

type InvalidationListener = (event: ChildSafetyInvalidationEvent) => void;

/**
 * Formats an `ApiError` or unexpected error into a safe, consistent UI-facing structure
 * without leaking raw backend stack traces, credentials, or internal details.
 */
export function formatChildSafetyError(err: unknown): FormattedChildSafetyError {
  if (err instanceof ApiError) {
    switch (err.kind) {
      case 'UNAUTHORIZED':
        return {
          title: 'Session Expired',
          message: err.message || 'Your session has expired. Please sign in again.',
          kind: err.kind,
          code: err.code,
          status: err.status,
          isRetryable: false,
        };
      case 'FORBIDDEN':
        return {
          title: 'Access Denied',
          message: err.message || 'You do not have permission to perform this Child Safety action.',
          kind: err.kind,
          code: err.code,
          status: err.status,
          isRetryable: false,
        };
      case 'VALIDATION':
        return {
          title: 'Invalid Request',
          message: err.message || 'Please check the entered details and try again.',
          kind: err.kind,
          code: err.code,
          status: err.status,
          isRetryable: false,
        };
      case 'NOT_FOUND':
        return {
          title: 'Record Not Found',
          message: err.message || 'The requested Child Safety record could not be found.',
          kind: err.kind,
          code: err.code,
          status: err.status,
          isRetryable: false,
        };
      case 'CONFLICT':
        return {
          title: 'State Conflict',
          message: err.message || 'This record was updated elsewhere or conflicts with an active safety rule.',
          kind: err.kind,
          code: err.code,
          status: err.status,
          isRetryable: false,
        };
      case 'RATE_LIMITED':
        return {
          title: 'Too Many Requests',
          message: err.retryAfterSeconds
            ? `Too many requests. Please wait ${err.retryAfterSeconds} seconds and try again.`
            : err.message || 'Too many requests. Please wait before trying again.',
          kind: err.kind,
          code: err.code,
          status: err.status,
          retryAfterSeconds: err.retryAfterSeconds,
          isRetryable: true,
        };
      case 'UNAVAILABLE':
      case 'NETWORK':
        return {
          title: 'Service Unavailable',
          message:
            err.message ||
            'Authoritative Child Safety verification service is currently unreachable. Please retry once connected.',
          kind: err.kind,
          code: err.code,
          status: err.status,
          retryAfterSeconds: err.retryAfterSeconds,
          isRetryable: true,
        };
      case 'INVALID_RESPONSE':
      case 'SERVER_ERROR':
      default:
        return {
          title: 'Server Error',
          message: 'An unexpected server error occurred while processing the Child Safety request.',
          kind: err.kind,
          code: err.code,
          status: err.status,
          isRetryable: err.status >= 500 || err.status === 0,
        };
    }
  }

  return {
    title: 'Unexpected Error',
    message: 'Unable to complete the Child Safety request right now. Please try again.',
    kind: 'UNKNOWN',
    code: 'UNEXPECTED_ERROR',
    status: 0,
    isRetryable: false,
  };
}

/**
 * Resolves whether the current authenticated user is a platform-scoped admin.
 * Non-platform users NEVER forward client-supplied `societyId` as an authorization override;
 * the backend derives tenant scope strictly from the verified JWT.
 */
function isAuthenticatedPlatformAdmin(): boolean {
  const user = getStoredUser();
  if (!user) return false;
  const role = (user.role || '').trim().toLowerCase();
  if (role !== 'admin') return false;
  const soc = typeof user.societyId === 'string' ? user.societyId.trim() : '';
  return !soc || PLATFORM_ADMIN_SENTINELS.has(soc);
}

/**
 * Strips untrusted client-supplied `societyId` for non-platform-admin callers so
 * backend JWT tenant derivation is strictly respected and no hardcoded fallback is ever sent.
 */
function sanitizeSocietyFilter(societyId?: string): string | undefined {
  if (!isAuthenticatedPlatformAdmin()) {
    return undefined;
  }
  const trimmed = typeof societyId === 'string' ? societyId.trim() : '';
  if (!trimmed || PLATFORM_ADMIN_SENTINELS.has(trimmed)) {
    return undefined;
  }
  return trimmed;
}

/**
 * Computes the current authenticated session fingerprint so ephemeral in-memory snapshots
 * are automatically invalidated across user, society, or role switches and logouts.
 */
function getCurrentSessionFingerprint(): string | null {
  const token = getAuthToken();
  const user = getStoredUser();
  if (!token || !user) return null;
  const uid = user.id || (user as any).uid || '';
  if (!uid) return null;
  const soc = (user.societyId || '').trim();
  const role = (user.role || '').trim().toLowerCase();
  return `${uid}:${soc}:${role}`;
}

/**
 * Resolves the active session's default society scope used to key unfiltered in-memory snapshots.
 */
function getActiveSessionDefaultSocietyScope(): string {
  const user = getStoredUser();
  const soc = typeof user?.societyId === 'string' ? user.societyId.trim() : '';
  return soc || '__PLATFORM__';
}

/**
 * Produces a deterministic normalized filter key so filtered queries never collide with or
 * overwrite the default unfiltered active-session snapshot.
 */
function buildSnapshotFilterKey(filters: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(filters)
    .filter(([, value]) => value !== undefined && value !== '' && value !== false)
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    return 'default';
  }
  return entries.map(([k, v]) => `${k}=${String(v)}`).join('&');
}

/**
 * Maps canonical backend `ChildProfileDto` to the legacy `ChildProfile` shape strictly in memory
 * for unmigrated Phase 4/5/6 views. Never exposes raw government ID numbers.
 */
function mapChildDtoToLegacy(dto: ChildProfileDto): ChildProfile {
  const primaryGuardian: Guardian = {
    id: dto.guardianUserId || `guardian-${dto.id}`,
    name: dto.guardianName,
    relationship: 'Primary Guardian',
    phone: dto.guardianPhone,
    isPrimary: true,
  };
  const secondaryGuardians: Guardian[] = (dto.secondaryGuardians || []).map((g, idx) => ({
    id: `sec-${dto.id}-${idx}`,
    name: g.name,
    relationship: g.relationship,
    phone: g.phone,
    email: g.email,
    isPrimary: false,
  }));
  const emergencyContacts: EmergencyContact[] = (dto.emergencyContacts || []).map((c, idx) => ({
    id: `ec-${dto.id}-${idx}`,
    name: c.name,
    relationship: c.relationship,
    phone: c.phone,
  }));
  const authorizedPickups: AuthorizedPickupPerson[] = (dto.pickups || [])
    .filter((p) => p.status !== 'ARCHIVED')
    .map((p) => ({
      id: p.id,
      childId: p.childId,
      name: p.name,
      phone: p.phone,
      relationship: p.relationship,
      idProofType: p.idDocumentType || 'Not Collected',
      // Only masked last-4 metadata from backend DTO — never a raw government ID number
      idProofNumber: p.idDocumentLast4 ? `XXXX-${p.idDocumentLast4}` : '',
      photoUrl: p.photoUrl || undefined,
      status: p.status === 'ACTIVE' || p.status === 'REVOKED' || p.status === 'EXPIRED' ? p.status : 'REVOKED',
      validUntil: p.validUntil || undefined,
      createdAt: p.createdAt,
    }));

  const legacyStatus: ChildProfile['status'] =
    dto.status === 'MISSING' || dto.status === 'OUT_OF_SOCIETY' ? dto.status : 'SAFE';
  const legacyGender: ChildProfile['gender'] =
    dto.gender === 'MALE' || dto.gender === 'FEMALE' ? dto.gender : 'OTHER';

  return {
    id: dto.id,
    societyId: dto.societyId,
    flatNumber: dto.flatNumber,
    fullName: dto.fullName,
    dateOfBirth: dto.dateOfBirth || '',
    gender: legacyGender,
    photoUrl: dto.photoUrl || undefined,
    medicalNotes: dto.medicalNotes || undefined,
    status: legacyStatus,
    guardians: [primaryGuardian, ...secondaryGuardians],
    emergencyContacts,
    authorizedPickups,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

/**
 * Maps canonical `ChildGatePassDto` to legacy `ChildPickupQR` strictly in memory.
 * Never exposes `bearerToken` or `qrPayload` — uses display `passCode` only.
 */
function mapPassDtoToLegacy(dto: ChildGatePassDto): ChildPickupQR {
  const legacyStatus: ChildPickupQR['status'] =
    dto.status === 'ACTIVE' || dto.status === 'USED' || dto.status === 'EXPIRED' || dto.status === 'REVOKED'
      ? dto.status
      : 'REVOKED';

  return {
    id: dto.id,
    qrCode: dto.passCode,
    societyId: dto.societyId,
    childId: dto.childId,
    childName: dto.child?.fullName || '',
    flatNumber: dto.child?.flatNumber || '',
    pickupPersonId: dto.pickupPersonId || '',
    pickupPersonName: dto.pickupPersonName,
    validFrom: dto.validFrom,
    validUntil: dto.validUntil,
    maxUses: dto.maxUses,
    currentUses: dto.currentUses,
    status: legacyStatus,
    createdAt: dto.createdAt,
  };
}

function mapExitLogDtoToLegacy(dto: ChildExitLogDto): PickupLog {
  const legacyStatus: PickupLog['status'] =
    dto.outcome === 'ALLOWED'
      ? 'ALLOWED'
      : dto.outcome === 'MISSING_ALERT_BLOCKED'
        ? 'MISSING_ALERT_FLAGGED'
        : 'DENIED';

  return {
    id: dto.id,
    societyId: dto.societyId,
    childId: dto.childId || '',
    childName: dto.childName,
    flatNumber: dto.flatNumber,
    pickupPersonName: dto.pickupPersonName,
    pickupPersonPhone: dto.pickupPersonPhone || '',
    timestamp: dto.timestamp,
    gateId: dto.gateId,
    securityGuardId: dto.guardId || dto.guardName,
    status: legacyStatus,
    notes: dto.notes || dto.denialReason || undefined,
  };
}

function mapAlertDtoToLegacy(dto: ChildSafetyAlertDto): ChildSafetyAlert {
  const legacyType: ChildSafetyAlert['alertType'] =
    dto.alertType === 'MISSING_CHILD'
      ? 'MISSING_CHILD'
      : dto.alertType === 'UNAUTHORIZED_EXIT_ATTEMPT'
        ? 'UNAUTHORIZED_PICKUP_ATTEMPT'
        : 'EMERGENCY';

  return {
    id: dto.id,
    societyId: dto.societyId,
    childId: dto.childId || '',
    childName: dto.childName,
    flatNumber: dto.flatNumber,
    alertType: legacyType,
    message: dto.description || dto.lastSeenDetails || `${dto.alertType} at ${dto.location}`,
    status: dto.status === 'RESOLVED' || dto.status === 'FALSE_ALARM' ? 'RESOLVED' : 'ACTIVE',
    createdAt: dto.createdAt,
    resolvedAt: dto.resolvedAt || undefined,
    resolvedBy: dto.resolvedByName || undefined,
  };
}

function createDeprecatedSyncApiError(methodName: string, replacement: string): ApiError {
  return new ApiError({
    status: 0,
    code: 'LEGACY_SYNC_API_DEPRECATED',
    kind: 'VALIDATION',
    endpoint: `/children#${methodName}`,
    message: `Synchronous ${methodName}() is disabled. Use authoritative async childSafetyService.${replacement}() instead.`,
  });
}

/**
 * Canonical, Backend-Authoritative Asynchronous Child Safety Service Facade.
 */
export class ChildSafetyService {
  // Ephemeral session- and scope-bound in-memory projections ONLY (never written to
  // localStorage/sessionStorage, never treated as a fallback when backend requests fail,
  // never holds bearerToken or qrPayload).
  private snapshotSessionFingerprint: string | null = null;
  private sessionRevision = 0;
  private resourceVersions: Record<SnapshotResource, number> = {
    children: 0,
    passes: 0,
    exitLogs: 0,
    alerts: 0,
  };
  private scopedSnapshots: Map<string, ScopedSnapshotEntry> = new Map();
  private invalidationListeners: Set<InvalidationListener> = new Set();

  constructor() {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('aarizo:unauthorized', () => {
        this.clearInMemoryState();
      });
    }
  }

  private syncSnapshotSession(): string | null {
    const currentFp = getCurrentSessionFingerprint();
    if (!currentFp || currentFp !== this.snapshotSessionFingerprint) {
      if (this.snapshotSessionFingerprint !== currentFp || this.scopedSnapshots.size > 0) {
        this.scopedSnapshots.clear();
        this.sessionRevision += 1;
        this.bumpAllResourceVersions();
      }
      this.snapshotSessionFingerprint = currentFp;
    }
    return currentFp;
  }

  private bumpAllResourceVersions(): void {
    this.resourceVersions.children += 1;
    this.resourceVersions.passes += 1;
    this.resourceVersions.exitLogs += 1;
    this.resourceVersions.alerts += 1;
  }

  private captureRequestSessionContext(resource?: SnapshotResource): RequestSessionContext {
    const fingerprint = this.syncSnapshotSession();
    return {
      fingerprint,
      revision: this.sessionRevision,
      resourceVersion: resource ? this.resourceVersions[resource] : undefined,
    };
  }

  private isSessionContextStillValid(ctx: RequestSessionContext, resource?: SnapshotResource): boolean {
    const currentFp = this.syncSnapshotSession();
    if (!ctx.fingerprint || !currentFp) {
      return false;
    }
    if (currentFp !== ctx.fingerprint || this.sessionRevision !== ctx.revision) {
      return false;
    }
    if (resource && ctx.resourceVersion !== undefined && this.resourceVersions[resource] !== ctx.resourceVersion) {
      return false;
    }
    return true;
  }

  private writeScopedSnapshot<T>(
    ctx: RequestSessionContext,
    resource: SnapshotResource,
    societyScope: string,
    filterKey: string,
    isDefaultScope: boolean,
    data: T[]
  ): void {
    if (!this.isSessionContextStillValid(ctx, resource) || !ctx.fingerprint) {
      // Session changed, cleared, or resource invalidated while request was in flight — discard safely.
      return;
    }

    const key = `${ctx.fingerprint}|${societyScope}|${resource}|${filterKey}`;
    if (!this.scopedSnapshots.has(key) && this.scopedSnapshots.size >= MAX_SCOPED_SNAPSHOTS) {
      const oldestKey = this.scopedSnapshots.keys().next().value;
      if (oldestKey !== undefined) {
        this.scopedSnapshots.delete(oldestKey);
      }
    }

    this.scopedSnapshots.set(key, {
      sessionFingerprint: ctx.fingerprint,
      societyScope,
      resource,
      filterKey,
      isDefaultScope,
      data: [...data],
      updatedAt: new Date().toISOString(),
    });
  }

  private getDefaultSnapshot<T>(resource: SnapshotResource, requestedSocietyId?: string): T[] {
    const currentFp = this.syncSnapshotSession();
    if (!currentFp) {
      return [];
    }

    const activeDefaultSoc = getActiveSessionDefaultSocietyScope();
    if (typeof requestedSocietyId === 'string') {
      const trimmedReq = requestedSocietyId.trim();
      if (
        trimmedReq &&
        !isAuthenticatedPlatformAdmin() &&
        !PLATFORM_ADMIN_SENTINELS.has(trimmedReq.toLowerCase()) &&
        trimmedReq !== activeDefaultSoc
      ) {
        // Fail closed: non-platform-admin cannot read another society's snapshot projection
        return [];
      }
    }

    const defaultKey = `${currentFp}|${activeDefaultSoc}|${resource}|default`;
    const entry = this.scopedSnapshots.get(defaultKey);
    if (!entry || entry.sessionFingerprint !== currentFp || !entry.isDefaultScope) {
      return [];
    }
    return [...(entry.data as T[])];
  }

  private evictSnapshotsForScopes(scopes: ReadonlyArray<ChildSafetyInvalidationScope>): void {
    if (scopes.includes('all')) {
      this.scopedSnapshots.clear();
      this.bumpAllResourceVersions();
      return;
    }

    const affectedResources = new Set<SnapshotResource>();
    for (const scope of scopes) {
      if (scope === 'children' || scope === 'passes' || scope === 'exitLogs' || scope === 'alerts') {
        affectedResources.add(scope);
      }
    }

    if (affectedResources.size === 0) {
      return;
    }

    for (const resource of affectedResources) {
      this.resourceVersions[resource] += 1;
    }

    for (const [key, entry] of Array.from(this.scopedSnapshots.entries())) {
      if (affectedResources.has(entry.resource)) {
        this.scopedSnapshots.delete(key);
      }
    }
  }

  /**
   * Clears all ephemeral in-memory projections (e.g., on logout, 401 unauthorized, offline, or session switch).
   */
  public clearInMemoryState(): void {
    this.snapshotSessionFingerprint = null;
    this.scopedSnapshots.clear();
    this.sessionRevision += 1;
    this.bumpAllResourceVersions();
    this.notifyInvalidation(['all'], 'session_reset');
  }

  /**
   * Subscribe to authoritative Child Safety invalidation notifications triggered by
   * completed backend mutations or authenticated Fetch SSE events.
   */
  public onCacheInvalidated(listener: InvalidationListener): () => void {
    this.invalidationListeners.add(listener);
    return () => {
      this.invalidationListeners.delete(listener);
    };
  }

  /**
   * Evicts affected in-memory snapshot scopes and emits an invalidation notification to
   * registered UI hooks/subscribers. Preserves snapshots for unrelated resource scopes.
   * Called after backend-confirmed mutations and from `useChildSafetyRealtime`.
   */
  public notifyInvalidation(
    scopes: ReadonlyArray<ChildSafetyInvalidationScope>,
    reason: ChildSafetyInvalidationEvent['reason'] = 'mutation',
    meta?: { childId?: string; topic?: string }
  ): void {
    this.evictSnapshotsForScopes(scopes);

    const event: ChildSafetyInvalidationEvent = {
      scopes,
      reason,
      childId: meta?.childId,
      topic: meta?.topic,
      timestamp: new Date().toISOString(),
    };
    Array.from(this.invalidationListeners).forEach((listener) => {
      try {
        listener(event);
      } catch (err) {
        console.error('[ChildSafetyService] Invalidation listener error:', err);
      }
    });
  }

  // =========================================================================
  // 1. CANONICAL ASYNCHRONOUS CHILD PROFILE OPERATIONS
  // =========================================================================

  /** Lists authoritative child profiles from `GET /api/children`. */
  public async listChildren(params?: ListChildrenParams): Promise<ChildProfileDto[]> {
    const ctx = this.captureRequestSessionContext('children');
    const activeDefaultSoc = getActiveSessionDefaultSocietyScope();
    const safeSocietyId = sanitizeSocietyFilter(params?.societyId);
    const requestParams: ListChildrenParams | undefined =
      params?.includeArchived || safeSocietyId
        ? {
            ...(params?.includeArchived ? { includeArchived: true } : {}),
            ...(safeSocietyId ? { societyId: safeSocietyId } : {}),
          }
        : undefined;

    const effectiveSocietyScope = safeSocietyId || activeDefaultSoc;
    const isDefaultScope = !params?.includeArchived && (!safeSocietyId || safeSocietyId === activeDefaultSoc);
    const filterKey = isDefaultScope
      ? 'default'
      : buildSnapshotFilterKey({
          includeArchived: Boolean(params?.includeArchived),
          societyId: safeSocietyId,
        });

    const children = await apiClient.getChildrenStrict(requestParams);
    this.writeScopedSnapshot(ctx, 'children', effectiveSocietyScope, filterKey, isDefaultScope, children);
    return children;
  }

  /** Fetches a single authoritative child profile from `GET /api/children/:id`. */
  public async getChildById(id: string): Promise<ChildProfileDto> {
    this.syncSnapshotSession();
    return apiClient.getChildByIdStrict(id);
  }

  /** Creates a child profile via `POST /api/children`. Rethrows `ApiError` on failure. */
  public async createChildProfileAsync(data: CreateChildProfileRequest): Promise<ChildProfileDto> {
    const ctx = this.captureRequestSessionContext();
    const safeSocietyId = sanitizeSocietyFilter(data.societyId);
    const payload: CreateChildProfileRequest = {
      ...data,
      societyId: safeSocietyId,
    };
    if (!safeSocietyId) {
      delete payload.societyId;
    }

    const created = await apiClient.createChildStrict(payload);
    if (this.isSessionContextStillValid(ctx)) {
      this.notifyInvalidation(['children'], 'mutation', { childId: created.id });
    }
    return created;
  }

  /** Updates a child profile via `PATCH /api/children/:id`. */
  public async updateChildProfile(id: string, data: UpdateChildProfileRequest): Promise<ChildProfileDto> {
    const ctx = this.captureRequestSessionContext();
    const updated = await apiClient.updateChildStrict(id, data);
    if (this.isSessionContextStillValid(ctx)) {
      this.notifyInvalidation(['children'], 'mutation', { childId: updated.id });
    }
    return updated;
  }

  /** Archives a child profile via `POST /api/children/:id/archive`. */
  public async archiveChildProfile(id: string): Promise<ChildProfileDto> {
    const ctx = this.captureRequestSessionContext();
    const archived = await apiClient.archiveChildStrict(id);
    if (this.isSessionContextStillValid(ctx)) {
      this.notifyInvalidation(['children', 'pickups', 'passes'], 'mutation', { childId: archived.id });
    }
    return archived;
  }

  // =========================================================================
  // 2. CANONICAL ASYNCHRONOUS AUTHORIZED PICKUP OPERATIONS
  // =========================================================================

  /** Lists authorized pickups for a child via `GET /api/children/:childId/pickups`. */
  public async listAuthorizedPickups(childId: string): Promise<AuthorizedPickupDto[]> {
    this.syncSnapshotSession();
    return apiClient.getChildPickupsStrict(childId);
  }

  /**
   * Adds an authorized pickup person via `POST /api/children/:childId/pickups`.
   * Rejects raw government ID numbers via Phase 1 strict client validation & backend policy.
   */
  public async addAuthorizedPickup(
    childId: string,
    data: CreateAuthorizedPickupRequest
  ): Promise<AuthorizedPickupDto> {
    const ctx = this.captureRequestSessionContext();
    const created = await apiClient.addChildPickupStrict(childId, data);
    if (this.isSessionContextStillValid(ctx)) {
      this.notifyInvalidation(['pickups', 'children'], 'mutation', { childId });
    }
    return created;
  }

  /** Updates an authorized pickup person via `PATCH /api/children/:childId/pickups/:pickupId`. */
  public async updateAuthorizedPickup(
    childId: string,
    pickupId: string,
    data: UpdateAuthorizedPickupRequest
  ): Promise<AuthorizedPickupDto> {
    const ctx = this.captureRequestSessionContext();
    const updated = await apiClient.updateChildPickupStrict(childId, pickupId, data);
    if (this.isSessionContextStillValid(ctx)) {
      const cascadesPasses = updated.status === 'REVOKED' || updated.status === 'EXPIRED';
      this.notifyInvalidation(
        cascadesPasses ? ['pickups', 'passes', 'children'] : ['pickups', 'children'],
        'mutation',
        { childId }
      );
    }
    return updated;
  }

  /** Revokes an authorized pickup person via `POST /api/children/:childId/pickups/:pickupId/revoke`. */
  public async revokeAuthorizedPickup(childId: string, pickupId: string): Promise<AuthorizedPickupDto> {
    const ctx = this.captureRequestSessionContext();
    const revoked = await apiClient.revokeChildPickupStrict(childId, pickupId);
    if (this.isSessionContextStillValid(ctx)) {
      this.notifyInvalidation(['pickups', 'passes', 'children'], 'mutation', { childId });
    }
    return revoked;
  }

  /** Archives an authorized pickup person via `DELETE /api/children/:childId/pickups/:pickupId`. */
  public async archiveAuthorizedPickup(childId: string, pickupId: string): Promise<AuthorizedPickupDto> {
    const ctx = this.captureRequestSessionContext();
    const archived = await apiClient.archiveChildPickupStrict(childId, pickupId);
    if (this.isSessionContextStillValid(ctx)) {
      this.notifyInvalidation(['pickups', 'passes', 'children'], 'mutation', { childId });
    }
    return archived;
  }

  // =========================================================================
  // 3. CANONICAL ASYNCHRONOUS GATE PASS & EXIT LOG OPERATIONS
  // =========================================================================

  /** Lists child gate passes via `GET /api/children/passes` (never contains bearer tokens). */
  public async listGatePasses(params?: ListChildGatePassesParams): Promise<ChildGatePassDto[]> {
    const ctx = this.captureRequestSessionContext('passes');
    const activeDefaultSoc = getActiveSessionDefaultSocietyScope();
    const safeSocietyId = sanitizeSocietyFilter(params?.societyId);
    const requestParams: ListChildGatePassesParams | undefined = params
      ? {
          ...(params.childId ? { childId: params.childId } : {}),
          ...(params.status ? { status: params.status } : {}),
          ...(params.limit !== undefined ? { limit: params.limit } : {}),
          ...(params.offset !== undefined ? { offset: params.offset } : {}),
          ...(safeSocietyId ? { societyId: safeSocietyId } : {}),
        }
      : undefined;

    const effectiveSocietyScope = safeSocietyId || activeDefaultSoc;
    const isDefaultScope =
      !params?.childId &&
      !params?.status &&
      params?.limit === undefined &&
      params?.offset === undefined &&
      (!safeSocietyId || safeSocietyId === activeDefaultSoc);
    const filterKey = isDefaultScope
      ? 'default'
      : buildSnapshotFilterKey({
          childId: params?.childId,
          status: params?.status,
          limit: params?.limit,
          offset: params?.offset,
          societyId: safeSocietyId,
        });

    const passes = await apiClient.getChildPassesStrict(requestParams);
    this.writeScopedSnapshot(ctx, 'passes', effectiveSocietyScope, filterKey, isDefaultScope, passes);
    return passes;
  }

  /** Fetches a single child gate pass via `GET /api/children/passes/:id`. */
  public async getGatePassById(id: string): Promise<ChildGatePassDto> {
    this.syncSnapshotSession();
    return apiClient.getChildPassByIdStrict(id);
  }

  /**
   * Generates a child gate pass via `POST /api/children/passes`.
   * Returns one-time `bearerToken` and `qrPayload` directly to the caller in memory ONLY.
   * NEVER caches or persists `bearerToken` or `qrPayload` in storage or snapshots.
   */
  public async createGatePass(
    data: CreateChildGatePassRequest,
    options?: CreateChildGatePassOptions
  ): Promise<ChildGatePassCreatedDto> {
    const ctx = this.captureRequestSessionContext();
    const safeSocietyId = sanitizeSocietyFilter(data.societyId);
    const payload: CreateChildGatePassRequest = {
      ...data,
      societyId: safeSocietyId,
    };
    if (!safeSocietyId) {
      delete payload.societyId;
    }

    const created = await apiClient.createChildPassStrict(payload, options);
    if (this.isSessionContextStillValid(ctx)) {
      this.notifyInvalidation(['passes'], 'mutation', { childId: created.childId });
    }
    return created;
  }

  /** Revokes a child gate pass via `POST /api/children/passes/:id/revoke`. */
  public async revokeGatePass(id: string, data?: RevokeChildGatePassRequest): Promise<ChildGatePassDto> {
    const ctx = this.captureRequestSessionContext();
    const revoked = await apiClient.revokeChildPassStrict(id, data);
    if (this.isSessionContextStillValid(ctx)) {
      this.notifyInvalidation(['passes'], 'mutation', { childId: revoked.childId });
    }
    return revoked;
  }

  /**
   * Verifies a child gate pass via `POST /api/children/passes/verify` (strict fail-closed).
   * Never marks a pass as verified before backend HTTP 200 confirmation.
   */
  public async verifyGatePass(data: VerifyChildGatePassRequest): Promise<VerifyChildGatePassSuccessDto> {
    const ctx = this.captureRequestSessionContext();
    const safeSocietyId = sanitizeSocietyFilter(data.societyId);
    const payload: VerifyChildGatePassRequest = {
      ...data,
      societyId: safeSocietyId,
    };
    if (!safeSocietyId) {
      delete payload.societyId;
    }

    const verified = await apiClient.verifyChildPassStrict(payload);
    if (this.isSessionContextStillValid(ctx)) {
      this.notifyInvalidation(['passes', 'exitLogs', 'children'], 'mutation', {
        childId: verified.pass.childId,
      });
    }
    return verified;
  }

  /** Lists immutable child gate exit audit logs via `GET /api/children/exit-logs`. */
  public async listExitLogs(params?: ListChildExitLogsParams): Promise<ChildExitLogDto[]> {
    const ctx = this.captureRequestSessionContext('exitLogs');
    const activeDefaultSoc = getActiveSessionDefaultSocietyScope();
    const safeSocietyId = sanitizeSocietyFilter(params?.societyId);
    const requestParams: ListChildExitLogsParams | undefined = params
      ? {
          ...(params.childId ? { childId: params.childId } : {}),
          ...(params.limit !== undefined ? { limit: params.limit } : {}),
          ...(params.offset !== undefined ? { offset: params.offset } : {}),
          ...(safeSocietyId ? { societyId: safeSocietyId } : {}),
        }
      : undefined;

    const effectiveSocietyScope = safeSocietyId || activeDefaultSoc;
    const isDefaultScope =
      !params?.childId &&
      params?.limit === undefined &&
      params?.offset === undefined &&
      (!safeSocietyId || safeSocietyId === activeDefaultSoc);
    const filterKey = isDefaultScope
      ? 'default'
      : buildSnapshotFilterKey({
          childId: params?.childId,
          limit: params?.limit,
          offset: params?.offset,
          societyId: safeSocietyId,
        });

    const logs = await apiClient.getChildExitLogsStrict(requestParams);
    this.writeScopedSnapshot(ctx, 'exitLogs', effectiveSocietyScope, filterKey, isDefaultScope, logs);
    return logs;
  }

  // =========================================================================
  // 4. CANONICAL ASYNCHRONOUS CHILD SAFETY ALERT & SOS OPERATIONS
  // =========================================================================

  /** Triggers an authoritative Child Safety SOS + linked EmergencyIncident via `POST /api/children/sos`. */
  public async triggerSos(data: TriggerChildSosRequest): Promise<ChildSosCreatedDto> {
    const ctx = this.captureRequestSessionContext();
    const safeSocietyId = sanitizeSocietyFilter(data.societyId);
    const payload: TriggerChildSosRequest = {
      ...data,
      societyId: safeSocietyId,
    };
    if (!safeSocietyId) {
      delete payload.societyId;
    }

    const created = await apiClient.triggerChildSosStrict(payload);
    if (this.isSessionContextStillValid(ctx)) {
      this.notifyInvalidation(['alerts', 'children'], 'mutation', {
        childId: created.alert.childId || undefined,
      });
    }
    return created;
  }

  /** Lists authoritative Child Safety alerts via `GET /api/children/alerts`. */
  public async listAlerts(params?: ListChildAlertsParams): Promise<ChildSafetyAlertDto[]> {
    const ctx = this.captureRequestSessionContext('alerts');
    const activeDefaultSoc = getActiveSessionDefaultSocietyScope();
    const safeSocietyId = sanitizeSocietyFilter(params?.societyId);
    const requestParams: ListChildAlertsParams | undefined = params
      ? {
          ...(params.status ? { status: params.status } : {}),
          ...(params.limit !== undefined ? { limit: params.limit } : {}),
          ...(params.offset !== undefined ? { offset: params.offset } : {}),
          ...(safeSocietyId ? { societyId: safeSocietyId } : {}),
        }
      : undefined;

    const effectiveSocietyScope = safeSocietyId || activeDefaultSoc;
    const isDefaultScope =
      !params?.status &&
      params?.limit === undefined &&
      params?.offset === undefined &&
      (!safeSocietyId || safeSocietyId === activeDefaultSoc);
    const filterKey = isDefaultScope
      ? 'default'
      : buildSnapshotFilterKey({
          status: params?.status,
          limit: params?.limit,
          offset: params?.offset,
          societyId: safeSocietyId,
        });

    const alerts = await apiClient.getChildAlertsStrict(requestParams);
    this.writeScopedSnapshot(ctx, 'alerts', effectiveSocietyScope, filterKey, isDefaultScope, alerts);
    return alerts;
  }

  /** Acknowledges an active Child Safety alert via `POST /api/children/alerts/:id/acknowledge`. */
  public async acknowledgeAlert(id: string): Promise<ChildSafetyAlertDto> {
    const ctx = this.captureRequestSessionContext();
    const acknowledged = await apiClient.acknowledgeChildAlertStrict(id);
    if (this.isSessionContextStillValid(ctx)) {
      this.notifyInvalidation(['alerts'], 'mutation', {
        childId: acknowledged.childId || undefined,
      });
    }
    return acknowledged;
  }

  /** Resolves a Child Safety alert via `POST /api/children/alerts/:id/resolve`. */
  public async resolveAlert(id: string, data: ResolveChildAlertRequest): Promise<ChildSafetyAlertDto> {
    const ctx = this.captureRequestSessionContext();
    const resolved = await apiClient.resolveChildAlertStrict(id, data);
    if (this.isSessionContextStillValid(ctx)) {
      this.notifyInvalidation(['alerts', 'children'], 'mutation', {
        childId: resolved.childId || undefined,
      });
    }
    return resolved;
  }

  // =========================================================================
  // 5. DEPRECATED SYNCHRONOUS COMPATIBILITY ADAPTERS (Retained strictly until Phases 4–7)
  //    - Zero localStorage reads/writes, zero hardcoded seeds, zero fake success.
  //    - Read adapters project strictly from the current session's default unfiltered snapshot.
  //    - Write/verify adapters fail closed (never fabricate success or mutate localStorage).
  // =========================================================================

  /**
   * @deprecated Retained until Phase 4/5/6 portal migrations complete. Use `await listChildren()`.
   * Returns a read-only projection from the current session's default unfiltered backend snapshot.
   */
  public getChildren(societyId?: string): ChildProfile[] {
    return this.getDefaultSnapshot<ChildProfileDto>('children', societyId).map(mapChildDtoToLegacy);
  }

  /** @deprecated Disabled localStorage write. Use `await createChildProfileAsync()` or `await updateChildProfile()`. */
  public saveChildProfile(_profile: ChildProfile): ChildProfile {
    throw createDeprecatedSyncApiError('saveChildProfile', 'updateChildProfile');
  }

  /** @deprecated Disabled localStorage write. Use `await createChildProfileAsync()`. */
  public createChildProfile(
    _societyId: string,
    _flatNumber: string,
    _fullName: string,
    _dateOfBirth: string,
    _gender: ChildProfile['gender'],
    _guardians: Guardian[],
    _emergencyContacts: EmergencyContact[],
    _medicalNotes?: string,
    _photoUrl?: string
  ): ChildProfile {
    throw createDeprecatedSyncApiError('createChildProfile', 'createChildProfileAsync');
  }

  /** @deprecated Disabled localStorage write (raw idProofNumber forbidden). Use `await addAuthorizedPickup()`. */
  public addAuthorizedPickupPerson(
    _societyId: string,
    _childId: string,
    _name: string,
    _phone: string,
    _relationship: string,
    _idProofType: string,
    _idProofNumber: string,
    _validUntil?: string
  ): ChildProfile {
    throw createDeprecatedSyncApiError('addAuthorizedPickupPerson', 'addAuthorizedPickup');
  }

  /** @deprecated Disabled localStorage write. Use `await revokeAuthorizedPickup()`. */
  public revokeAuthorizedPickupPerson(
    _societyId: string,
    _childId: string,
    _pickupPersonId: string
  ): ChildProfile {
    throw createDeprecatedSyncApiError('revokeAuthorizedPickupPerson', 'revokeAuthorizedPickup');
  }

  /**
   * @deprecated Retained until Phase 5 scanner migration. Use `await listGatePasses()`.
   * Never exposes `bearerToken` or `qrPayload`.
   */
  public getPickupQRs(societyId?: string): ChildPickupQR[] {
    return this.getDefaultSnapshot<ChildGatePassDto>('passes', societyId).map(mapPassDtoToLegacy);
  }

  /** @deprecated Disabled localStorage pass generator. Use `await createGatePass()`. */
  public generatePickupQR(
    _societyId: string,
    _childId: string,
    _pickupPersonId: string,
    _validFrom: string,
    _validUntil: string,
    _maxUses: number = 1
  ): ChildPickupQR {
    throw createDeprecatedSyncApiError('generatePickupQR', 'createGatePass');
  }

  /**
   * @deprecated Retained strictly for Phase 5 compile compatibility. Use `await verifyGatePass()`.
   * Fail-closed: NEVER fabricates `allowed: true` and NEVER writes localStorage.
   */
  public verifyAndScanChildPickup(
    _societyId: string,
    _qrCodeStr: string,
    _securityGuardId?: string,
    _gateId?: string
  ): { allowed: false; message: string; child?: ChildProfile; pickupPersonName?: string; log?: PickupLog } {
    return {
      allowed: false,
      message:
        'Local gate verification is disabled. Gate passes require online server confirmation via childSafetyService.verifyGatePass().',
    };
  }

  /**
   * @deprecated Retained until Phase 5/6 migrations. Use `await listExitLogs()`.
   */
  public getPickupLogs(societyId?: string): PickupLog[] {
    return this.getDefaultSnapshot<ChildExitLogDto>('exitLogs', societyId).map(mapExitLogDtoToLegacy);
  }

  /**
   * @deprecated Retained until Phase 5/6 migrations. Use `await listAlerts()`.
   */
  public getSafetyAlerts(societyId?: string): ChildSafetyAlert[] {
    return this.getDefaultSnapshot<ChildSafetyAlertDto>('alerts', societyId).map(mapAlertDtoToLegacy);
  }

  /** @deprecated Disabled localStorage SOS write. Use `await triggerSos()`. */
  public triggerMissingChildAlert(
    _societyId: string,
    _childId: string,
    _reportedBy: string
  ): ChildSafetyAlert {
    throw createDeprecatedSyncApiError('triggerMissingChildAlert', 'triggerSos');
  }

  /** @deprecated Disabled localStorage alert resolve. Use `await resolveAlert()`. */
  public resolveSafetyAlert(
    _societyId: string,
    _alertId: string,
    _resolvedBy: string
  ): ChildSafetyAlert {
    throw createDeprecatedSyncApiError('resolveSafetyAlert', 'resolveAlert');
  }
}

export const childSafetyService = new ChildSafetyService();
