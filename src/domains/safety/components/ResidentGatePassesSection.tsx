// =============================================================================
// AARIZO — ISSUE-06 Phase B.2.3 (Phase 4.4):
// Resident One-Time Secure Child Gate Pass Lifecycle & Read-Only Exit History
//
// Security & Architectural Invariants:
// - Backed strictly by canonical `childSafetyService` (`listGatePasses`,
//   `createGatePass`, `revokeGatePass`, `listAuthorizedPickups`, `listExitLogs`)
//   and approved Phase 4.1 pure helpers.
// - Zero localStorage/sessionStorage persistence, zero demo/hardcoded passes,
//   zero legacy `safetyCommandEngine` calls, zero client-side gate verification.
// - One-time `qrPayload` returned by HTTP 201 `POST /api/children/passes` is
//   rendered strictly via `QRCodeSVG` (`qrcode.react`) inside an ephemeral modal
//   and NEVER written to storage, logs, URLs, or ordinary `passes` list state.
// - `bearerToken` is never stored in component state, logs, or DOM text; `qrPayload`
//   is never rendered as plaintext fallback text and is cleared immediately on
//   modal dismiss, child switch, session switch, logout, 401, or unmount.
// - Effective pass status (`ACTIVE`/`USED`/`EXPIRED`/`REVOKED`/`ARCHIVED`/`UNKNOWN`)
//   and `isNotYetValid` are computed via Phase 4.1 helpers without mutating DTOs.
// - Monotonic sequence guards + synchronous `mutationInFlightRef` prevent
//   duplicate submissions and cross-child / cross-session race contamination.
// =============================================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertCircle,
  Ban,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  History,
  Loader2,
  QrCode,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Ticket,
  X,
} from 'lucide-react';
import {
  childSafetyService,
  formatChildSafetyError,
  type FormattedChildSafetyError,
} from '../../../services/childSafetyService';
import type { UserProfile } from '../../auth/types';
import type {
  AuthorizedPickupDto,
  ChildExitLogDto,
  ChildGatePassDto,
  ChildProfileDto,
} from '../../../types/childSafety';
import {
  buildResidentCreateGatePassPayload,
  canRevokeGatePass,
  formatChildProfileDisplay,
  formatExitLogDisplay,
  formatGatePassDisplay,
  getResidentChildSafetyPermissions,
  isPickupSelectableForPass,
  parseTimestampMs,
  type ChildSafetyRolePermissions,
  type EffectiveGatePassDisplayStatus,
  type ResidentCreateGatePassFormInput,
} from '../utils/childSafetyResidentHelpers';
import { Modal } from '../../../components/ui/Modal';

export type GatePassModalMode = 'CREATE' | 'ONE_TIME_QR' | 'REVOKE' | null;

export interface CreateGatePassFormState {
  pickupPersonId: string;
  validFrom: string;
  validUntil: string;
  maxUses: string;
  notes: string;
}

/**
 * Strictly ephemeral presentation model for the one-time QR modal immediately
 * following HTTP 201 `POST /api/children/passes`.
 * Explicitly omits `bearerToken` and `tokenHash`, and is purged on modal close,
 * child change, session change, logout, 401, or unmount.
 */
export interface OneTimeGatePassPresentation {
  id: string;
  childId: string;
  passCode: string;
  childName: string;
  flatNumber: string;
  pickupPersonName: string;
  validFrom: string;
  validUntil: string;
  maxUses: number;
  qrPayload: string;
}

export interface ResidentGatePassesController {
  selectedChildId: string | null;
  passes: ChildGatePassDto[];
  eligiblePickups: AuthorizedPickupDto[];
  exitLogs: ChildExitLogDto[];
  isLoadingPasses: boolean;
  isLoadingPickups: boolean;
  isLoadingExitLogs: boolean;
  isExitLogsOpen: boolean;
  isSubmitting: boolean;
  loadError: FormattedChildSafetyError | null;
  pickupsError: FormattedChildSafetyError | null;
  exitLogsError: FormattedChildSafetyError | null;
  actionError: FormattedChildSafetyError | null;
  formError: string | null;
  successMessage: string | null;
  modalMode: GatePassModalMode;
  createForm: CreateGatePassFormState;
  oneTimeCreatedPass: OneTimeGatePassPresentation | null;
  revokingPass: ChildGatePassDto | null;
  revokeReason: string;
  permissions: ChildSafetyRolePermissions;
  loadPasses: () => Promise<void>;
  loadEligiblePickups: () => Promise<void>;
  loadExitLogs: () => Promise<void>;
  toggleExitLogs: () => void;
  openCreateModal: () => void;
  openRevokeModal: (pass: ChildGatePassDto) => void;
  closeModal: () => void;
  dismissOneTimeQrModal: () => void;
  setCreateFormField: <K extends keyof CreateGatePassFormState>(
    field: K,
    value: CreateGatePassFormState[K]
  ) => void;
  applyDurationPresetHours: (hours: number) => void;
  setRevokeReason: (reason: string) => void;
  submitCreatePass: () => Promise<boolean>;
  confirmRevokePass: () => Promise<boolean>;
  clearBanners: () => void;
}

export interface ResidentGatePassesSectionProps {
  selectedChild: ChildProfileDto | null;
  currentUser: UserProfile | null;
  /** Incremented by parent whenever pickups change so eligible escorts & cascade-revoked passes stay synced. */
  pickupsRefreshNonce?: number;
  /** Incremented by parent whenever gate passes or exit logs mutate via realtime SSE. */
  passesRefreshNonce?: number;
  onPassMutated?: (childId: string) => void | Promise<void>;
}

const DEFAULT_PASS_DURATION_HOURS = 4;
const DURATION_PRESET_HOURS = [2, 4, 8, 24] as const;

function getSessionKey(user: UserProfile | null): string {
  if (!user) return '';
  const uid = user.id || (user as { uid?: string }).uid || '';
  if (!uid) return '';
  const soc = typeof user.societyId === 'string' ? user.societyId.trim() : '';
  const role = typeof user.role === 'string' ? user.role.trim().toLowerCase() : '';
  return `${uid}:${soc}:${role}`;
}

function toDateTimeLocalValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function createDefaultGatePassForm(defaultPickupId = ''): CreateGatePassFormState {
  const nowMs = Date.now();
  const defaultUntilMs = nowMs + DEFAULT_PASS_DURATION_HOURS * 60 * 60 * 1000;
  return {
    pickupPersonId: defaultPickupId,
    validFrom: '',
    validUntil: toDateTimeLocalValue(defaultUntilMs),
    maxUses: '1',
    notes: '',
  };
}

function formatDateTimeDisplay(iso: string | null | undefined): string {
  const ms = parseTimestampMs(iso);
  if (ms === null) return 'Unavailable';
  try {
    return new Date(ms).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return new Date(ms).toISOString();
  }
}

function getPassStatusBadgeStyle(status: EffectiveGatePassDisplayStatus): {
  bg: string;
  color: string;
  border: string;
} {
  switch (status) {
    case 'ACTIVE':
      return { bg: '#ECFDF5', color: '#047857', border: '#A7F3D0' };
    case 'USED':
      return { bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE' };
    case 'EXPIRED':
      return { bg: '#FFFBEB', color: '#B45309', border: '#FDE68A' };
    case 'REVOKED':
      return { bg: '#FEF2F2', color: '#B91C1C', border: '#FECACA' };
    case 'ARCHIVED':
      return { bg: '#F1F5F9', color: '#475569', border: '#CBD5E1' };
    default:
      return { bg: '#F8FAFC', color: '#64748B', border: '#E2E8F0' };
  }
}

function getExitOutcomeBadgeStyle(outcome: string): { bg: string; color: string; border: string } {
  switch (outcome) {
    case 'ALLOWED':
      return { bg: '#ECFDF5', color: '#047857', border: '#A7F3D0' };
    case 'MISSING_ALERT_BLOCKED':
      return { bg: '#FEF2F2', color: '#991B1B', border: '#FCA5A5' };
    case 'DENIED':
      return { bg: '#FFF7ED', color: '#C2410C', border: '#FED7AA' };
    default:
      return { bg: '#F1F5F9', color: '#475569', border: '#CBD5E1' };
  }
}

/**
 * Authoritative controller hook for Resident Gate Pass creation, one-time QR
 * presentation, listing, revocation, and read-only exit log history.
 * Exported directly for real behavioral tests against `childSafetyService`
 * and `apiClient.*Strict`.
 */
export function useResidentGatePasses(
  currentUser: UserProfile | null,
  selectedChild: ChildProfileDto | null,
  pickupsRefreshNonce = 0,
  onPassMutated?: (childId: string) => void | Promise<void>,
  passesRefreshNonce = 0
): ResidentGatePassesController {
  const sessionKey = getSessionKey(currentUser);
  const normalizedChildId =
    typeof selectedChild?.id === 'string' && selectedChild.id.trim().length > 0 ? selectedChild.id.trim() : null;
  const permissions = getResidentChildSafetyPermissions(currentUser?.role);

  const [passes, setPasses] = useState<ChildGatePassDto[]>([]);
  const [eligiblePickups, setEligiblePickups] = useState<AuthorizedPickupDto[]>([]);
  const [exitLogs, setExitLogs] = useState<ChildExitLogDto[]>([]);
  const [isLoadingPasses, setIsLoadingPasses] = useState<boolean>(
    Boolean(sessionKey && normalizedChildId && permissions.canCreateGatePass)
  );
  const [isLoadingPickups, setIsLoadingPickups] = useState<boolean>(false);
  const [isLoadingExitLogs, setIsLoadingExitLogs] = useState<boolean>(false);
  const [isExitLogsOpen, setIsExitLogsOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const [loadError, setLoadError] = useState<FormattedChildSafetyError | null>(null);
  const [pickupsError, setPickupsError] = useState<FormattedChildSafetyError | null>(null);
  const [exitLogsError, setExitLogsError] = useState<FormattedChildSafetyError | null>(null);
  const [actionError, setActionError] = useState<FormattedChildSafetyError | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [modalMode, setModalMode] = useState<GatePassModalMode>(null);
  const [createForm, setCreateForm] = useState<CreateGatePassFormState>(() => createDefaultGatePassForm());
  const [oneTimeCreatedPass, setOneTimeCreatedPass] = useState<OneTimeGatePassPresentation | null>(null);
  const [revokingPass, setRevokingPass] = useState<ChildGatePassDto | null>(null);
  const [revokeReason, setRevokeReasonState] = useState<string>('');

  // Monotonic sequence & active scope refs prevent stale overwrites and cross-session/child lock races
  const mountedRef = useRef<boolean>(true);
  const activeSessionKeyRef = useRef<string>(sessionKey);
  const activeChildIdRef = useRef<string | null>(normalizedChildId);
  const passesReqSeqRef = useRef<number>(0);
  const pickupsReqSeqRef = useRef<number>(0);
  const exitLogsReqSeqRef = useRef<number>(0);
  const mutationSeqRef = useRef<number>(0);
  const mutationInFlightRef = useRef<boolean>(false);

  const currentUserRef = useRef<UserProfile | null>(currentUser);
  const selectedChildRef = useRef<ChildProfileDto | null>(selectedChild);
  const eligiblePickupsRef = useRef<AuthorizedPickupDto[]>(eligiblePickups);
  const createFormRef = useRef<CreateGatePassFormState>(createForm);
  const revokingPassRef = useRef<ChildGatePassDto | null>(revokingPass);
  const revokeReasonRef = useRef<string>(revokeReason);
  const oneTimePassRef = useRef<OneTimeGatePassPresentation | null>(oneTimeCreatedPass);
  const onPassMutatedRef = useRef<((childId: string) => void | Promise<void>) | undefined>(onPassMutated);
  const prevPickupsNonceRef = useRef<number>(pickupsRefreshNonce);

  activeSessionKeyRef.current = sessionKey;
  activeChildIdRef.current = normalizedChildId;
  currentUserRef.current = currentUser;
  selectedChildRef.current = selectedChild;
  eligiblePickupsRef.current = eligiblePickups;
  createFormRef.current = createForm;
  revokingPassRef.current = revokingPass;
  revokeReasonRef.current = revokeReason;
  oneTimePassRef.current = oneTimeCreatedPass;
  onPassMutatedRef.current = onPassMutated;

  const purgeSensitiveOneTimeQr = useCallback(() => {
    setOneTimeCreatedPass(null);
  }, []);

  const purgeAllStateOnUnauthorized = useCallback(() => {
    setPasses([]);
    setEligiblePickups([]);
    setExitLogs([]);
    setOneTimeCreatedPass(null);
    setRevokingPass(null);
    setModalMode(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      passesReqSeqRef.current += 1;
      pickupsReqSeqRef.current += 1;
      exitLogsReqSeqRef.current += 1;
      mutationSeqRef.current += 1;
      // Ensure ephemeral one-time QR payload reference is dropped on unmount
      oneTimePassRef.current = null;
    };
  }, []);

  const loadPasses = useCallback(async (): Promise<void> => {
    const reqSession = activeSessionKeyRef.current;
    const reqChildId = activeChildIdRef.current;
    const reqSeq = ++passesReqSeqRef.current;
    const perms = getResidentChildSafetyPermissions(currentUserRef.current?.role);

    if (!reqSession || !reqChildId || !perms.canCreateGatePass) {
      if (mountedRef.current) {
        setPasses([]);
        setIsLoadingPasses(false);
        setLoadError(null);
      }
      return;
    }

    setIsLoadingPasses(true);
    setLoadError(null);

    try {
      const records = await childSafetyService.listGatePasses({ childId: reqChildId });
      if (
        !mountedRef.current ||
        reqSeq !== passesReqSeqRef.current ||
        activeSessionKeyRef.current !== reqSession ||
        activeChildIdRef.current !== reqChildId
      ) {
        return;
      }
      // Enforce child association defense-in-depth on returned DTOs
      setPasses(records.filter((p) => p.childId === reqChildId));
      setLoadError(null);
    } catch (err) {
      if (
        !mountedRef.current ||
        reqSeq !== passesReqSeqRef.current ||
        activeSessionKeyRef.current !== reqSession ||
        activeChildIdRef.current !== reqChildId
      ) {
        return;
      }
      const formatted = formatChildSafetyError(err);
      if (formatted.kind === 'UNAUTHORIZED') {
        purgeAllStateOnUnauthorized();
      }
      setLoadError(formatted);
    } finally {
      if (
        mountedRef.current &&
        reqSeq === passesReqSeqRef.current &&
        activeSessionKeyRef.current === reqSession &&
        activeChildIdRef.current === reqChildId
      ) {
        setIsLoadingPasses(false);
      }
    }
  }, [purgeAllStateOnUnauthorized]);

  const loadEligiblePickups = useCallback(async (): Promise<void> => {
    const reqSession = activeSessionKeyRef.current;
    const reqChildId = activeChildIdRef.current;
    const reqSeq = ++pickupsReqSeqRef.current;
    const perms = getResidentChildSafetyPermissions(currentUserRef.current?.role);

    if (!reqSession || !reqChildId || !perms.canCreateGatePass) {
      if (mountedRef.current) {
        setEligiblePickups([]);
        setIsLoadingPickups(false);
        setPickupsError(null);
      }
      return;
    }

    setIsLoadingPickups(true);
    setPickupsError(null);

    try {
      const allPickups = await childSafetyService.listAuthorizedPickups(reqChildId);
      if (
        !mountedRef.current ||
        reqSeq !== pickupsReqSeqRef.current ||
        activeSessionKeyRef.current !== reqSession ||
        activeChildIdRef.current !== reqChildId
      ) {
        return;
      }
      const activeOnly = allPickups.filter((p) => p.childId === reqChildId && isPickupSelectableForPass(p));
      setEligiblePickups(activeOnly);
      setPickupsError(null);
    } catch (err) {
      if (
        !mountedRef.current ||
        reqSeq !== pickupsReqSeqRef.current ||
        activeSessionKeyRef.current !== reqSession ||
        activeChildIdRef.current !== reqChildId
      ) {
        return;
      }
      const formatted = formatChildSafetyError(err);
      if (formatted.kind === 'UNAUTHORIZED') {
        purgeAllStateOnUnauthorized();
      }
      setPickupsError(formatted);
    } finally {
      if (
        mountedRef.current &&
        reqSeq === pickupsReqSeqRef.current &&
        activeSessionKeyRef.current === reqSession &&
        activeChildIdRef.current === reqChildId
      ) {
        setIsLoadingPickups(false);
      }
    }
  }, [purgeAllStateOnUnauthorized]);

  const loadExitLogs = useCallback(async (): Promise<void> => {
    const reqSession = activeSessionKeyRef.current;
    const reqChildId = activeChildIdRef.current;
    const reqSeq = ++exitLogsReqSeqRef.current;
    const perms = getResidentChildSafetyPermissions(currentUserRef.current?.role);

    if (!reqSession || !reqChildId || !perms.canViewExitLogs) {
      if (mountedRef.current) {
        setExitLogs([]);
        setIsLoadingExitLogs(false);
        setExitLogsError(null);
      }
      return;
    }

    setIsLoadingExitLogs(true);
    setExitLogsError(null);

    try {
      const logs = await childSafetyService.listExitLogs({ childId: reqChildId, limit: 25 });
      if (
        !mountedRef.current ||
        reqSeq !== exitLogsReqSeqRef.current ||
        activeSessionKeyRef.current !== reqSession ||
        activeChildIdRef.current !== reqChildId
      ) {
        return;
      }
      setExitLogs(logs.filter((l) => !l.childId || l.childId === reqChildId));
      setExitLogsError(null);
    } catch (err) {
      if (
        !mountedRef.current ||
        reqSeq !== exitLogsReqSeqRef.current ||
        activeSessionKeyRef.current !== reqSession ||
        activeChildIdRef.current !== reqChildId
      ) {
        return;
      }
      const formatted = formatChildSafetyError(err);
      if (formatted.kind === 'UNAUTHORIZED') {
        purgeAllStateOnUnauthorized();
      }
      setExitLogsError(formatted);
    } finally {
      if (
        mountedRef.current &&
        reqSeq === exitLogsReqSeqRef.current &&
        activeSessionKeyRef.current === reqSession &&
        activeChildIdRef.current === reqChildId
      ) {
        setIsLoadingExitLogs(false);
      }
    }
  }, [purgeAllStateOnUnauthorized]);

  // Immediately clear all pass state & one-time QR secrets on session switch, logout, or child switch
  useEffect(() => {
    passesReqSeqRef.current += 1;
    pickupsReqSeqRef.current += 1;
    exitLogsReqSeqRef.current += 1;
    mutationSeqRef.current += 1;
    mutationInFlightRef.current = false;

    setPasses([]);
    setEligiblePickups([]);
    setExitLogs([]);
    setIsExitLogsOpen(false);
    setOneTimeCreatedPass(null);
    setRevokingPass(null);
    setRevokeReasonState('');
    setModalMode(null);
    setCreateForm(createDefaultGatePassForm());
    setLoadError(null);
    setPickupsError(null);
    setExitLogsError(null);
    setActionError(null);
    setFormError(null);
    setSuccessMessage(null);
    setIsSubmitting(false);

    if (
      sessionKey &&
      normalizedChildId &&
      getResidentChildSafetyPermissions(currentUserRef.current?.role).canCreateGatePass
    ) {
      void loadPasses();
      void loadEligiblePickups();
    } else {
      setIsLoadingPasses(false);
      setIsLoadingPickups(false);
      setIsLoadingExitLogs(false);
    }
  }, [sessionKey, normalizedChildId, loadPasses, loadEligiblePickups]);

  // Sync eligible escorts & cascade-revoked passes when Phase 4.3 pickups mutate
  useEffect(() => {
    if (pickupsRefreshNonce === prevPickupsNonceRef.current) {
      return;
    }
    prevPickupsNonceRef.current = pickupsRefreshNonce;
    if (
      sessionKey &&
      normalizedChildId &&
      getResidentChildSafetyPermissions(currentUserRef.current?.role).canCreateGatePass
    ) {
      void loadEligiblePickups();
      void loadPasses();
    }
  }, [pickupsRefreshNonce, sessionKey, normalizedChildId, loadEligiblePickups, loadPasses]);

  // Sync passes and exit history when passes/exit logs mutate via realtime SSE
  const prevPassesNonceRef = useRef<number>(passesRefreshNonce);
  useEffect(() => {
    if (passesRefreshNonce === prevPassesNonceRef.current) {
      return;
    }
    prevPassesNonceRef.current = passesRefreshNonce;
    if (
      sessionKey &&
      normalizedChildId &&
      getResidentChildSafetyPermissions(currentUserRef.current?.role).canCreateGatePass
    ) {
      void loadPasses();
      void loadExitLogs();
    }
  }, [passesRefreshNonce, sessionKey, normalizedChildId, loadPasses, loadExitLogs]);

  const notifyParentSafely = useCallback(async (reqSession: string, reqChildId: string): Promise<void> => {
    const callback = onPassMutatedRef.current;
    if (!callback || !mountedRef.current || activeSessionKeyRef.current !== reqSession) {
      return;
    }
    try {
      await callback(reqChildId);
    } catch (callbackErr) {
      console.error(
        '[ResidentGatePassesSection] Post-mutation parent refresh failed:',
        callbackErr instanceof Error ? callbackErr.message : 'Callback failed'
      );
      if (
        mountedRef.current &&
        activeSessionKeyRef.current === reqSession &&
        activeChildIdRef.current === reqChildId
      ) {
        setActionError({
          kind: 'NETWORK',
          status: 0,
          code: 'POST_MUTATION_REFRESH_FAILED',
          title: 'Summary Refresh Failed',
          message:
            'Your gate pass update was saved, but the household summary could not be refreshed. Use Refresh to sync.',
          isRetryable: true,
        });
      }
    }
  }, []);

  const toggleExitLogs = useCallback(() => {
    setIsExitLogsOpen((prev) => {
      const next = !prev;
      if (next && activeSessionKeyRef.current && activeChildIdRef.current) {
        void loadExitLogs();
      }
      return next;
    });
  }, [loadExitLogs]);

  const setCreateFormField = useCallback(
    <K extends keyof CreateGatePassFormState>(field: K, value: CreateGatePassFormState[K]) => {
      setCreateForm((prev) => ({ ...prev, [field]: value }));
      setFormError(null);
    },
    []
  );

  const applyDurationPresetHours = useCallback((hours: number) => {
    if (!Number.isFinite(hours) || hours <= 0 || hours > 168) return;
    const baseMs = createFormRef.current.validFrom
      ? parseTimestampMs(createFormRef.current.validFrom) ?? Date.now()
      : Date.now();
    const nextUntilMs = baseMs + hours * 60 * 60 * 1000;
    setCreateForm((prev) => ({ ...prev, validUntil: toDateTimeLocalValue(nextUntilMs) }));
    setFormError(null);
  }, []);

  const setRevokeReason = useCallback((reason: string) => {
    setRevokeReasonState(reason);
    setFormError(null);
  }, []);

  const clearBanners = useCallback(() => {
    setActionError(null);
    setSuccessMessage(null);
  }, []);

  const dismissOneTimeQrModal = useCallback(() => {
    purgeSensitiveOneTimeQr();
    setModalMode(null);
    setFormError(null);
  }, [purgeSensitiveOneTimeQr]);

  const closeModal = useCallback(() => {
    if (mutationInFlightRef.current) return;
    purgeSensitiveOneTimeQr();
    setModalMode(null);
    setRevokingPass(null);
    setRevokeReasonState('');
    setFormError(null);
  }, [purgeSensitiveOneTimeQr]);

  const openCreateModal = useCallback(() => {
    const child = selectedChildRef.current;
    if (!child || !activeChildIdRef.current) return;
    if (!getResidentChildSafetyPermissions(currentUserRef.current?.role).canCreateGatePass) return;

    const childDisplay = formatChildProfileDisplay(child);
    if (!childDisplay.canIssuePass) {
      setActionError({
        kind: 'CONFLICT',
        status: 409,
        code: childDisplay.isArchived ? 'CHILD_ARCHIVED' : 'CHILD_MISSING_ALERT_ACTIVE',
        title: childDisplay.isArchived ? 'Child Profile Archived' : 'Gate Passes Blocked',
        message: childDisplay.isArchived
          ? 'Cannot issue a gate pass for an archived child profile.'
          : 'Cannot issue a gate pass while the child has an active MISSING status.',
        isRetryable: false,
      });
      return;
    }

    const activePickups = eligiblePickupsRef.current.filter((p) => isPickupSelectableForPass(p));
    const allowsSolo = child.exitPermissionMode === 'SOLO_ALLOWED' && Boolean(child.allowedSoloExit);
    const defaultPickupId = allowsSolo ? '' : activePickups[0]?.id ?? '';

    setActionError(null);
    setSuccessMessage(null);
    setFormError(null);
    setRevokingPass(null);
    purgeSensitiveOneTimeQr();
    setCreateForm(createDefaultGatePassForm(defaultPickupId));
    setModalMode('CREATE');
  }, [purgeSensitiveOneTimeQr]);

  const openRevokeModal = useCallback(
    (pass: ChildGatePassDto) => {
      if (!activeChildIdRef.current || pass.childId !== activeChildIdRef.current) return;
      if (!getResidentChildSafetyPermissions(currentUserRef.current?.role).canRevokeGatePass) return;

      if (!canRevokeGatePass(pass)) {
        setActionError({
          kind: 'CONFLICT',
          status: 409,
          code: 'PASS_NOT_REVOCABLE',
          title: 'Pass Cannot Be Revoked',
          message: 'Only active, unexpired, and unconsumed gate passes can be revoked.',
          isRetryable: false,
        });
        return;
      }

      setActionError(null);
      setSuccessMessage(null);
      setFormError(null);
      purgeSensitiveOneTimeQr();
      setRevokingPass(pass);
      setRevokeReasonState('');
      setModalMode('REVOKE');
    },
    [purgeSensitiveOneTimeQr]
  );

  const submitCreatePass = useCallback(async (): Promise<boolean> => {
    if (mutationInFlightRef.current) return false;
    const reqSession = activeSessionKeyRef.current;
    const reqChildId = activeChildIdRef.current;
    const child = selectedChildRef.current;
    if (!reqSession || !reqChildId || !child || child.id !== reqChildId) return false;

    if (!getResidentChildSafetyPermissions(currentUserRef.current?.role).canCreateGatePass) {
      setFormError('Your account role is not authorized to generate child gate passes.');
      return false;
    }

    const form = createFormRef.current;
    const selectedPickupId = form.pickupPersonId.trim();
    if (selectedPickupId) {
      const matched = eligiblePickupsRef.current.find((p) => p.id === selectedPickupId);
      if (matched && !isPickupSelectableForPass(matched)) {
        setFormError('The selected escort authorization has expired or is no longer active.');
        return false;
      }
    }

    const input: ResidentCreateGatePassFormInput = {
      pickupPersonId: selectedPickupId || null,
      validFrom: form.validFrom.trim() || null,
      validUntil: form.validUntil.trim(),
      maxUses: form.maxUses.trim() || '1',
      notes: form.notes || null,
    };

    const built = buildResidentCreateGatePassPayload(input, child);
    if (!built.ok) {
      setFormError(built.error);
      return false;
    }

    const reqMutationSeq = ++mutationSeqRef.current;
    mutationInFlightRef.current = true;
    setIsSubmitting(true);
    setFormError(null);
    setActionError(null);

    try {
      const created = await childSafetyService.createGatePass(built.value.request, built.value.options);
      if (
        !mountedRef.current ||
        mutationSeqRef.current !== reqMutationSeq ||
        activeSessionKeyRef.current !== reqSession ||
        activeChildIdRef.current !== reqChildId
      ) {
        // Session or child switched mid-flight: discard one-time QR secret immediately!
        return false;
      }

      // Extract ONLY safe display metadata + one-time qrPayload for ephemeral QR modal (drop bearerToken!)
      const oneTimePresentation: OneTimeGatePassPresentation = {
        id: created.id,
        childId: created.childId,
        passCode: created.passCode,
        childName: created.child?.fullName || child.fullName,
        flatNumber: created.child?.flatNumber || child.flatNumber,
        pickupPersonName: created.pickupPersonName,
        validFrom: created.validFrom,
        validUntil: created.validUntil,
        maxUses: created.maxUses,
        qrPayload: created.qrPayload,
      };

      setOneTimeCreatedPass(oneTimePresentation);
      setModalMode('ONE_TIME_QR');
      setCreateForm(createDefaultGatePassForm());
      setSuccessMessage(
        `Gate pass ${created.passCode} issued for ${oneTimePresentation.childName}. Show or share the one-time QR now.`
      );
      await loadPasses();
      await notifyParentSafely(reqSession, reqChildId);
      return true;
    } catch (err) {
      if (
        !mountedRef.current ||
        mutationSeqRef.current !== reqMutationSeq ||
        activeSessionKeyRef.current !== reqSession ||
        activeChildIdRef.current !== reqChildId
      ) {
        return false;
      }
      const formatted = formatChildSafetyError(err);
      if (formatted.kind === 'UNAUTHORIZED') {
        purgeAllStateOnUnauthorized();
      }
      setFormError(formatted.message);
      setActionError(formatted);
      return false;
    } finally {
      if (mutationSeqRef.current === reqMutationSeq) {
        mutationInFlightRef.current = false;
        if (
          mountedRef.current &&
          activeSessionKeyRef.current === reqSession &&
          activeChildIdRef.current === reqChildId
        ) {
          setIsSubmitting(false);
        }
      }
    }
  }, [loadPasses, notifyParentSafely, purgeAllStateOnUnauthorized]);

  const confirmRevokePass = useCallback(async (): Promise<boolean> => {
    if (mutationInFlightRef.current) return false;
    const reqSession = activeSessionKeyRef.current;
    const reqChildId = activeChildIdRef.current;
    const target = revokingPassRef.current;
    if (!reqSession || !reqChildId || !target || target.childId !== reqChildId) return false;

    if (!getResidentChildSafetyPermissions(currentUserRef.current?.role).canRevokeGatePass) {
      setFormError('Your account role is not authorized to revoke child gate passes.');
      return false;
    }

    if (!canRevokeGatePass(target)) {
      setFormError('This gate pass is no longer active and cannot be revoked.');
      return false;
    }

    const trimmedReason = revokeReasonRef.current.trim();
    if (trimmedReason.length > 300) {
      setFormError('Revocation reason cannot exceed 300 characters.');
      return false;
    }

    const reqMutationSeq = ++mutationSeqRef.current;
    mutationInFlightRef.current = true;
    setIsSubmitting(true);
    setFormError(null);
    setActionError(null);

    try {
      const revoked = await childSafetyService.revokeGatePass(
        target.id,
        trimmedReason ? { reason: trimmedReason } : undefined
      );
      if (
        !mountedRef.current ||
        mutationSeqRef.current !== reqMutationSeq ||
        activeSessionKeyRef.current !== reqSession ||
        activeChildIdRef.current !== reqChildId
      ) {
        return false;
      }
      if (oneTimePassRef.current?.id === revoked.id) {
        purgeSensitiveOneTimeQr();
      }
      setModalMode(null);
      setRevokingPass(null);
      setRevokeReasonState('');
      setSuccessMessage(`Gate pass ${revoked.passCode} has been revoked and invalidated at society gates.`);
      await loadPasses();
      await notifyParentSafely(reqSession, reqChildId);
      return true;
    } catch (err) {
      if (
        !mountedRef.current ||
        mutationSeqRef.current !== reqMutationSeq ||
        activeSessionKeyRef.current !== reqSession ||
        activeChildIdRef.current !== reqChildId
      ) {
        return false;
      }
      const formatted = formatChildSafetyError(err);
      if (formatted.kind === 'UNAUTHORIZED') {
        purgeAllStateOnUnauthorized();
      }
      setFormError(formatted.message);
      setActionError(formatted);
      return false;
    } finally {
      if (mutationSeqRef.current === reqMutationSeq) {
        mutationInFlightRef.current = false;
        if (
          mountedRef.current &&
          activeSessionKeyRef.current === reqSession &&
          activeChildIdRef.current === reqChildId
        ) {
          setIsSubmitting(false);
        }
      }
    }
  }, [loadPasses, notifyParentSafely, purgeAllStateOnUnauthorized, purgeSensitiveOneTimeQr]);

  return {
    selectedChildId: normalizedChildId,
    passes,
    eligiblePickups,
    exitLogs,
    isLoadingPasses,
    isLoadingPickups,
    isLoadingExitLogs,
    isExitLogsOpen,
    isSubmitting,
    loadError,
    pickupsError,
    exitLogsError,
    actionError,
    formError,
    successMessage,
    modalMode,
    createForm,
    oneTimeCreatedPass,
    revokingPass,
    revokeReason,
    permissions,
    loadPasses,
    loadEligiblePickups,
    loadExitLogs,
    toggleExitLogs,
    openCreateModal,
    openRevokeModal,
    closeModal,
    dismissOneTimeQrModal,
    setCreateFormField,
    applyDurationPresetHours,
    setRevokeReason,
    submitCreatePass,
    confirmRevokePass,
    clearBanners,
  };
}

export const ResidentGatePassesSection: React.FC<ResidentGatePassesSectionProps> = ({
  selectedChild,
  currentUser,
  pickupsRefreshNonce = 0,
  passesRefreshNonce = 0,
  onPassMutated,
}) => {
  const ctrl = useResidentGatePasses(
    currentUser,
    selectedChild,
    pickupsRefreshNonce,
    onPassMutated,
    passesRefreshNonce
  );

  if (!currentUser || !ctrl.permissions.canCreateGatePass || !selectedChild) {
    return null;
  }

  const childDisplay = formatChildProfileDisplay(selectedChild);
  const allowsSoloExit = selectedChild.exitPermissionMode === 'SOLO_ALLOWED' && Boolean(selectedChild.allowedSoloExit);
  const activeSelectablePickups = ctrl.eligiblePickups.filter((p) => isPickupSelectableForPass(p));

  return (
    <section
      aria-label="Child Gate Passes"
      data-testid="resident-gate-passes-section"
      style={{
        background: '#FFFFFF',
        border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
        borderRadius: '16px',
        padding: '1.25rem',
        boxShadow: '0 2px 10px rgba(8, 59, 86, 0.05)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}
    >
      {/* Section Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.875rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: '12px',
              background: 'var(--aarizo-pale-blue, #F4FAFE)',
              border: '1px solid var(--aarizo-border, #DCE8EF)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--aarizo-navy, #083B56)',
              flexShrink: 0,
            }}
          >
            <QrCode size={20} />
          </div>
          <div>
            <h4
              style={{
                fontSize: '0.95rem',
                fontWeight: 800,
                color: 'var(--aarizo-navy, #083B56)',
                margin: 0,
              }}
            >
              SECURE CHILD GATE PASSES
            </h4>
            <p
              style={{
                fontSize: '0.75rem',
                color: 'var(--aarizo-text-secondary, #657785)',
                margin: '0.15rem 0 0',
              }}
            >
              One-time cryptographic exit passes for {childDisplay.fullName} (Flat {childDisplay.flatNumber}). QR codes
              are displayed once at creation and never stored in the browser.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => void ctrl.loadPasses()}
            disabled={ctrl.isLoadingPasses || ctrl.isSubmitting}
            aria-label="Refresh gate passes"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.45rem 0.75rem',
              borderRadius: '10px',
              background: '#FFFFFF',
              border: '1px solid var(--aarizo-border, #DCE8EF)',
              color: 'var(--aarizo-navy, #083B56)',
              fontWeight: 700,
              fontSize: '0.75rem',
              cursor: ctrl.isLoadingPasses || ctrl.isSubmitting ? 'not-allowed' : 'pointer',
            }}
          >
            <RefreshCw size={13} className={ctrl.isLoadingPasses ? 'animate-spin' : undefined} />
            <span>Refresh</span>
          </button>

          {childDisplay.canIssuePass && (
            <button
              type="button"
              data-testid="generate-gate-pass-btn"
              onClick={ctrl.openCreateModal}
              disabled={ctrl.isSubmitting}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.5rem 0.875rem',
                borderRadius: '10px',
                background: 'var(--aarizo-coral, #F06543)',
                color: '#FFFFFF',
                fontWeight: 800,
                fontSize: '0.75rem',
                border: 'none',
                cursor: ctrl.isSubmitting ? 'not-allowed' : 'pointer',
              }}
            >
              <Ticket size={14} />
              <span>Generate Gate Pass</span>
            </button>
          )}
        </div>
      </div>

      {/* Blocked Child Status Notice */}
      {!childDisplay.canIssuePass && (
        <div
          role="status"
          data-testid="gate-pass-child-blocked-notice"
          style={{
            background: '#FEF2F2',
            border: '1px solid #FECACA',
            borderRadius: '12px',
            padding: '0.75rem 0.95rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            color: '#991B1B',
            fontSize: '0.78rem',
            fontWeight: 700,
          }}
        >
          <ShieldAlert size={16} color="#DC2626" style={{ flexShrink: 0 }} />
          <span>
            {childDisplay.isArchived
              ? 'New gate passes cannot be issued because this child profile is archived.'
              : 'New gate passes are blocked while a missing-child alert is active for this child.'}
          </span>
        </div>
      )}

      {/* Success Banner */}
      {ctrl.successMessage && (
        <div
          role="status"
          data-testid="gate-pass-success-banner"
          style={{
            background: '#ECFDF5',
            border: '1px solid #A7F3D0',
            borderRadius: '12px',
            padding: '0.7rem 0.9rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            color: '#065F46',
            fontSize: '0.78rem',
            fontWeight: 700,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
            <CheckCircle2 size={16} color="#059669" />
            {ctrl.successMessage}
          </span>
          <button
            type="button"
            onClick={ctrl.clearBanners}
            aria-label="Dismiss gate pass success notice"
            style={{ background: 'transparent', border: 'none', color: '#065F46', cursor: 'pointer', padding: '0.15rem' }}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* Action Error Banner */}
      {ctrl.actionError && !ctrl.modalMode && (
        <div
          role="alert"
          data-testid="gate-pass-action-error"
          style={{
            background: '#FEF2F2',
            border: '1px solid #FECACA',
            borderRadius: '12px',
            padding: '0.75rem 0.95rem',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '0.75rem',
            color: '#991B1B',
            fontSize: '0.78rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
            <AlertCircle size={16} color="#DC2626" style={{ flexShrink: 0, marginTop: '0.1rem' }} />
            <div>
              <strong style={{ display: 'block', fontWeight: 800 }}>{ctrl.actionError.title}</strong>
              <span>{ctrl.actionError.message}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={ctrl.clearBanners}
            aria-label="Dismiss gate pass error notice"
            style={{ background: 'transparent', border: 'none', color: '#991B1B', cursor: 'pointer', padding: '0.15rem' }}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* Loading State */}
      {ctrl.isLoadingPasses && (
        <div
          data-testid="gate-pass-loading-state"
          style={{
            padding: '1.5rem 1rem',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.5rem',
            color: 'var(--aarizo-text-secondary, #657785)',
            fontSize: '0.8rem',
            fontWeight: 600,
          }}
        >
          <Loader2 size={20} className="animate-spin" color="var(--aarizo-navy, #083B56)" />
          <span>Loading gate passes for {childDisplay.fullName}...</span>
        </div>
      )}

      {/* Load Error State with Retry */}
      {!ctrl.isLoadingPasses && ctrl.loadError && (
        <div
          role="alert"
          data-testid="gate-pass-load-error"
          style={{
            background: '#FEF2F2',
            border: '1px solid #FECACA',
            borderRadius: '12px',
            padding: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.6rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: '#991B1B' }}>
            <AlertCircle size={16} color="#DC2626" />
            <strong style={{ fontSize: '0.84rem', fontWeight: 800 }}>{ctrl.loadError.title}</strong>
          </div>
          <p style={{ margin: 0, fontSize: '0.78rem', color: '#7F1D1D', lineHeight: 1.45 }}>{ctrl.loadError.message}</p>
          <div>
            <button
              type="button"
              onClick={() => void ctrl.loadPasses()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.45rem 0.85rem',
                borderRadius: '9px',
                background: '#DC2626',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: '0.75rem',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={13} />
              <span>Retry</span>
            </button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!ctrl.isLoadingPasses && !ctrl.loadError && ctrl.passes.length === 0 && (
        <div
          data-testid="gate-pass-empty-state"
          style={{
            padding: '1.5rem 1rem',
            borderRadius: '12px',
            background: '#F8FAFC',
            border: '1px dashed #CBD5E1',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <QrCode size={24} color="var(--aarizo-navy, #083B56)" />
          <strong style={{ fontSize: '0.875rem', color: 'var(--aarizo-navy, #083B56)' }}>
            No Gate Passes Issued for {childDisplay.fullName}
          </strong>
          <p style={{ margin: 0, fontSize: '0.76rem', color: '#64748B', maxWidth: '440px', lineHeight: 1.45 }}>
            Issue a time-limited one-time gate pass when authorizing an escort pickup or permitted solo exit. Society
            guards verify passes online against the backend.
          </p>
        </div>
      )}

      {/* Authoritative Sanitized Gate Pass List (ZERO bearerToken / qrPayload / tokenHash!) */}
      {ctrl.loadError?.kind !== 'UNAUTHORIZED' && ctrl.passes.length > 0 && (
        <div
          data-testid="gate-pass-list"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(295px, 1fr))', gap: '0.875rem' }}
        >
          {ctrl.passes.map((passDto) => {
            const view = formatGatePassDisplay(passDto);
            const badgeStyle = getPassStatusBadgeStyle(view.effectiveStatus);

            return (
              <div
                key={view.id}
                data-testid={`gate-pass-card-${view.id}`}
                style={{
                  background: '#FBFDFF',
                  border: '1px solid var(--aarizo-border, #DCE8EF)',
                  borderRadius: '14px',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span
                      data-testid={`gate-pass-status-${view.id}`}
                      style={{
                        fontSize: '0.625rem',
                        fontWeight: 800,
                        color: badgeStyle.color,
                        background: badgeStyle.bg,
                        border: `1px solid ${badgeStyle.border}`,
                        padding: '0.18rem 0.5rem',
                        borderRadius: '9999px',
                        textTransform: 'uppercase',
                      }}
                    >
                      {view.statusLabel}
                    </span>

                    <span
                      style={{
                        fontSize: '0.68rem',
                        fontWeight: 800,
                        fontFamily: 'monospace',
                        color: 'var(--aarizo-navy, #083B56)',
                        background: '#EAF6FC',
                        border: '1px solid #DCE8EF',
                        padding: '0.16rem 0.5rem',
                        borderRadius: '8px',
                      }}
                    >
                      {view.passCode}
                    </span>
                  </div>

                  {view.effectiveStatus === 'ACTIVE' && view.isNotYetValid && (
                    <div
                      data-testid={`gate-pass-not-yet-valid-${view.id}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        color: '#1D4ED8',
                        background: '#EFF6FF',
                        border: '1px solid #BFDBFE',
                        borderRadius: '8px',
                        padding: '0.25rem 0.5rem',
                      }}
                    >
                      <Clock size={12} />
                      <span>Scheduled — Not Yet Valid</span>
                    </div>
                  )}

                  <div>
                    <h5 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 800, color: 'var(--aarizo-text, #203746)' }}>
                      {view.pickupPersonName}
                    </h5>
                    <p style={{ margin: '0.15rem 0 0', fontSize: '0.73rem', color: '#475569', fontWeight: 600 }}>
                      Uses: {view.usageLabel}
                    </p>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.22rem', fontSize: '0.72rem', color: '#334155' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                      <CalendarClock size={12} color="#176B91" />
                      From: {formatDateTimeDisplay(view.validFrom)}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                      <CalendarClock size={12} color="#176B91" />
                      Until: {formatDateTimeDisplay(view.validUntil)}
                    </span>
                  </div>

                  {view.revocationReason && (
                    <p
                      style={{
                        margin: '0.15rem 0 0',
                        padding: '0.4rem 0.55rem',
                        borderRadius: '8px',
                        background: '#FEF2F2',
                        border: '1px solid #FECACA',
                        fontSize: '0.71rem',
                        color: '#991B1B',
                      }}
                    >
                      Revoked: {view.revocationReason}
                    </p>
                  )}

                  {view.notes && (
                    <p
                      style={{
                        margin: '0.15rem 0 0',
                        padding: '0.4rem 0.55rem',
                        borderRadius: '8px',
                        background: '#F8FAFC',
                        border: '1px solid #E2E8F0',
                        fontSize: '0.71rem',
                        color: '#475569',
                      }}
                    >
                      Notes: {view.notes}
                    </p>
                  )}

                  {view.effectiveStatus === 'ACTIVE' && (
                    <p style={{ margin: '0.1rem 0 0', fontSize: '0.68rem', color: '#64748B', lineHeight: 1.35 }}>
                      QR code is shown once at creation only. If misplaced, revoke this pass and generate a new one.
                    </p>
                  )}
                </div>

                {view.canRevoke && ctrl.permissions.canRevokeGatePass && (
                  <div
                    style={{
                      display: 'flex',
                      paddingTop: '0.6rem',
                      borderTop: '1px solid var(--aarizo-border-soft, #E8F1F5)',
                    }}
                  >
                    <button
                      type="button"
                      data-testid={`revoke-gate-pass-btn-${view.id}`}
                      onClick={() => ctrl.openRevokeModal(passDto)}
                      disabled={ctrl.isSubmitting}
                      style={{
                        flex: 1,
                        padding: '0.45rem 0.7rem',
                        borderRadius: '9px',
                        background: '#FFFFFF',
                        border: '1px solid #FECACA',
                        color: '#DC2626',
                        fontWeight: 800,
                        fontSize: '0.73rem',
                        cursor: ctrl.isSubmitting ? 'not-allowed' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.35rem',
                      }}
                    >
                      <Ban size={13} />
                      <span>Revoke Pass</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Collapsible Read-Only Exit Audit History */}
      {ctrl.permissions.canViewExitLogs && (
        <div
          style={{
            borderTop: '1px solid var(--aarizo-border-soft, #E8F1F5)',
            paddingTop: '0.85rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}
        >
          <button
            type="button"
            data-testid="toggle-exit-logs-btn"
            onClick={ctrl.toggleExitLogs}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              background: '#F8FAFC',
              border: '1px solid var(--aarizo-border, #DCE8EF)',
              borderRadius: '10px',
              padding: '0.55rem 0.85rem',
              cursor: 'pointer',
              color: 'var(--aarizo-navy, #083B56)',
              fontWeight: 800,
              fontSize: '0.78rem',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <History size={15} />
              <span>Gate Exit Audit History ({childDisplay.fullName})</span>
            </span>
            {ctrl.isExitLogsOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>

          {ctrl.isExitLogsOpen && (
            <div data-testid="exit-logs-panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {ctrl.isLoadingExitLogs && (
                <div style={{ fontSize: '0.78rem', color: '#64748B', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Loading verified exit history...</span>
                </div>
              )}

              {!ctrl.isLoadingExitLogs && ctrl.exitLogsError && (
                <div
                  role="alert"
                  style={{
                    background: '#FEF2F2',
                    border: '1px solid #FECACA',
                    borderRadius: '10px',
                    padding: '0.7rem 0.85rem',
                    fontSize: '0.76rem',
                    color: '#991B1B',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                  }}
                >
                  <span>{ctrl.exitLogsError.message}</span>
                  <button
                    type="button"
                    onClick={() => void ctrl.loadExitLogs()}
                    style={{
                      padding: '0.35rem 0.65rem',
                      borderRadius: '8px',
                      border: 'none',
                      background: '#DC2626',
                      color: '#FFFFFF',
                      fontWeight: 700,
                      fontSize: '0.72rem',
                      cursor: 'pointer',
                    }}
                  >
                    Retry
                  </button>
                </div>
              )}

              {!ctrl.isLoadingExitLogs && !ctrl.exitLogsError && ctrl.exitLogs.length === 0 && (
                <p style={{ margin: 0, fontSize: '0.76rem', color: '#64748B' }}>
                  No gate exit verification records recorded for {childDisplay.fullName} yet.
                </p>
              )}

              {!ctrl.isLoadingExitLogs && !ctrl.exitLogsError && ctrl.exitLogs.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {ctrl.exitLogs.map((logDto) => {
                    const logView = formatExitLogDisplay(logDto);
                    const outcomeStyle = getExitOutcomeBadgeStyle(logView.outcome);
                    return (
                      <div
                        key={logView.id}
                        data-testid={`exit-log-row-${logView.id}`}
                        style={{
                          padding: '0.65rem 0.85rem',
                          borderRadius: '10px',
                          background: '#FBFDFF',
                          border: '1px solid #E2E8F0',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '0.75rem',
                          flexWrap: 'wrap',
                          fontSize: '0.74rem',
                        }}
                      >
                        <div>
                          <strong style={{ color: '#083B56' }}>{logView.pickupPersonName}</strong>
                          <span style={{ color: '#64748B' }}>
                            {' '}
                            · {logView.gateId} · Guard {logView.guardName}
                          </span>
                          <div style={{ color: '#64748B', fontSize: '0.7rem', marginTop: '0.15rem' }}>
                            {formatDateTimeDisplay(logView.timestamp)} · {logView.verificationChannelLabel}
                            {logView.denialReason ? ` · ${logView.denialReason}` : ''}
                          </div>
                        </div>
                        <span
                          style={{
                            fontSize: '0.625rem',
                            fontWeight: 800,
                            color: outcomeStyle.color,
                            background: outcomeStyle.bg,
                            border: `1px solid ${outcomeStyle.border}`,
                            padding: '0.18rem 0.5rem',
                            borderRadius: '9999px',
                            textTransform: 'uppercase',
                          }}
                        >
                          {logView.outcomeLabel}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Modal 1: Generate Gate Pass */}
      <Modal
        isOpen={ctrl.modalMode === 'CREATE'}
        onClose={ctrl.closeModal}
        title="Generate Child Gate Pass"
        subtitle={`Issuing secure exit pass for ${childDisplay.fullName} (Flat ${childDisplay.flatNumber})`}
        icon={<Ticket size={20} />}
        maxWidth="520px"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ctrl.submitCreatePass();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
        >
          {ctrl.formError && (
            <div
              role="alert"
              data-testid="gate-pass-form-error"
              style={{
                background: '#FEF2F2',
                border: '1px solid #FECACA',
                borderRadius: '10px',
                padding: '0.65rem 0.85rem',
                color: '#991B1B',
                fontSize: '0.78rem',
                fontWeight: 700,
              }}
            >
              {ctrl.formError}
            </div>
          )}

          {/* Escort Selection */}
          <div>
            <label
              htmlFor="gate-pass-escort"
              style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}
            >
              Authorized Pickup Escort {allowsSoloExit ? '(Optional — Solo Exit Permitted)' : '*'}
            </label>
            <select
              id="gate-pass-escort"
              disabled={ctrl.isSubmitting || ctrl.isLoadingPickups}
              value={ctrl.createForm.pickupPersonId}
              onChange={(e) => ctrl.setCreateFormField('pickupPersonId', e.target.value)}
              style={{
                width: '100%',
                padding: '0.6rem 0.8rem',
                borderRadius: '10px',
                border: '1px solid #CBD5E1',
                fontSize: '0.85rem',
                background: '#FFFFFF',
              }}
            >
              {allowsSoloExit ? (
                <option value="">Solo Exit (No Escort)</option>
              ) : (
                <option value="">
                  {activeSelectablePickups.length > 0
                    ? 'Select an active authorized escort...'
                    : 'No active authorized escorts available'}
                </option>
              )}
              {activeSelectablePickups.map((pickup) => (
                <option key={pickup.id} value={pickup.id}>
                  {pickup.name} ({pickup.relationship} · {pickup.phone})
                </option>
              ))}
            </select>
            {!allowsSoloExit && activeSelectablePickups.length === 0 && (
              <span style={{ fontSize: '0.7rem', color: '#B45309', display: 'block', marginTop: '0.25rem', fontWeight: 600 }}>
                Add or renew an active authorized pickup escort above before issuing a pass for this child’s exit policy.
              </span>
            )}
          </div>

          {/* Quick Validity Presets */}
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.3rem' }}>
              Quick Duration Presets (Max 7 Days)
            </span>
            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
              {DURATION_PRESET_HOURS.map((hrs) => (
                <button
                  key={hrs}
                  type="button"
                  disabled={ctrl.isSubmitting}
                  onClick={() => ctrl.applyDurationPresetHours(hrs)}
                  style={{
                    padding: '0.32rem 0.65rem',
                    borderRadius: '8px',
                    border: '1px solid #CBD5E1',
                    background: '#F8FAFC',
                    color: '#083B56',
                    fontSize: '0.73rem',
                    fontWeight: 700,
                    cursor: ctrl.isSubmitting ? 'not-allowed' : 'pointer',
                  }}
                >
                  {hrs}h
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label
                htmlFor="gate-pass-valid-from"
                style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}
              >
                Valid From (Optional — Now)
              </label>
              <input
                id="gate-pass-valid-from"
                type="datetime-local"
                disabled={ctrl.isSubmitting}
                value={ctrl.createForm.validFrom}
                onChange={(e) => ctrl.setCreateFormField('validFrom', e.target.value)}
                style={{ width: '100%', padding: '0.6rem 0.7rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.8rem' }}
              />
            </div>

            <div>
              <label
                htmlFor="gate-pass-valid-until"
                style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}
              >
                Valid Until *
              </label>
              <input
                id="gate-pass-valid-until"
                type="datetime-local"
                required
                disabled={ctrl.isSubmitting}
                value={ctrl.createForm.validUntil}
                onChange={(e) => ctrl.setCreateFormField('validUntil', e.target.value)}
                style={{ width: '100%', padding: '0.6rem 0.7rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.8rem' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '0.75rem' }}>
            <div>
              <label
                htmlFor="gate-pass-max-uses"
                style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}
              >
                Max Uses (1–10) *
              </label>
              <input
                id="gate-pass-max-uses"
                type="number"
                min={1}
                max={10}
                required
                disabled={ctrl.isSubmitting}
                value={ctrl.createForm.maxUses}
                onChange={(e) => ctrl.setCreateFormField('maxUses', e.target.value)}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
              />
            </div>

            <div>
              <label
                htmlFor="gate-pass-notes"
                style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}
              >
                Gate Instructions (Optional)
              </label>
              <input
                id="gate-pass-notes"
                type="text"
                maxLength={500}
                disabled={ctrl.isSubmitting}
                placeholder="e.g., After-school tuition pickup"
                value={ctrl.createForm.notes}
                onChange={(e) => ctrl.setCreateFormField('notes', e.target.value)}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.4rem', paddingTop: '0.75rem', borderTop: '1px solid #E2E8F0' }}>
            <button
              type="button"
              onClick={ctrl.closeModal}
              disabled={ctrl.isSubmitting}
              style={{
                flex: 1,
                padding: '0.6rem',
                borderRadius: '10px',
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#475569',
                fontWeight: 700,
                fontSize: '0.84rem',
                cursor: ctrl.isSubmitting ? 'not-allowed' : 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="submit-create-gate-pass-btn"
              disabled={ctrl.isSubmitting || (!allowsSoloExit && activeSelectablePickups.length === 0)}
              style={{
                flex: 1,
                padding: '0.6rem',
                borderRadius: '10px',
                border: 'none',
                background: 'var(--aarizo-coral, #F06543)',
                color: '#FFFFFF',
                fontWeight: 800,
                fontSize: '0.84rem',
                cursor: ctrl.isSubmitting || (!allowsSoloExit && activeSelectablePickups.length === 0) ? 'not-allowed' : 'pointer',
              }}
            >
              {ctrl.isSubmitting ? 'Issuing Pass...' : 'Issue Secure Pass'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal 2: One-Time QR Presentation (Ephemeral Only — NEVER stored or echoed as plaintext) */}
      <Modal
        isOpen={ctrl.modalMode === 'ONE_TIME_QR' && Boolean(ctrl.oneTimeCreatedPass?.qrPayload)}
        onClose={ctrl.dismissOneTimeQrModal}
        title="One-Time Secure Gate Pass QR"
        subtitle="Displayed once for immediate security presentation"
        icon={<ShieldCheck size={20} color="#059669" />}
        maxWidth="460px"
      >
        {ctrl.oneTimeCreatedPass && (
          <div
            data-testid="one-time-qr-modal"
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.9rem', textAlign: 'center' }}
          >
            <div
              style={{
                background: '#FFFBEB',
                border: '1px solid #FDE68A',
                borderRadius: '10px',
                padding: '0.65rem 0.85rem',
                fontSize: '0.76rem',
                color: '#92400E',
                fontWeight: 700,
                lineHeight: 1.45,
                width: '100%',
              }}
            >
              Security Notice: This QR code is shown ONCE and is never saved in your browser. Closing this dialog
              clears the QR immediately. If lost, revoke the pass and generate a new one.
            </div>

            <div
              data-testid="one-time-qr-svg-container"
              style={{
                padding: '1rem',
                background: '#FFFFFF',
                borderRadius: '16px',
                border: '1px solid #DCE8EF',
                boxShadow: '0 4px 14px rgba(8, 59, 86, 0.08)',
              }}
            >
              <QRCodeSVG value={ctrl.oneTimeCreatedPass.qrPayload} size={200} level="M" />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.8rem', color: '#334155' }}>
              <strong style={{ fontFamily: 'monospace', fontSize: '0.95rem', color: '#083B56' }}>
                Reference Code: {ctrl.oneTimeCreatedPass.passCode}
              </strong>
              <span>
                Child: <strong>{ctrl.oneTimeCreatedPass.childName}</strong> (Flat {ctrl.oneTimeCreatedPass.flatNumber})
              </span>
              <span>
                Escort: <strong>{ctrl.oneTimeCreatedPass.pickupPersonName}</strong> · Max Uses:{' '}
                {ctrl.oneTimeCreatedPass.maxUses}
              </span>
              <span style={{ fontSize: '0.74rem', color: '#64748B' }}>
                Valid Until: {formatDateTimeDisplay(ctrl.oneTimeCreatedPass.validUntil)}
              </span>
            </div>

            <button
              type="button"
              data-testid="dismiss-one-time-qr-btn"
              onClick={ctrl.dismissOneTimeQrModal}
              style={{
                width: '100%',
                padding: '0.65rem',
                borderRadius: '10px',
                border: 'none',
                background: 'var(--aarizo-navy, #083B56)',
                color: '#FFFFFF',
                fontWeight: 800,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              Done — Clear One-Time QR
            </button>
          </div>
        )}
      </Modal>

      {/* Modal 3: Confirm Revoke Gate Pass */}
      <Modal
        isOpen={ctrl.modalMode === 'REVOKE' && Boolean(ctrl.revokingPass)}
        onClose={ctrl.closeModal}
        title="Revoke Child Gate Pass"
        subtitle="Immediate gate invalidation confirmation"
        icon={<ShieldAlert size={20} color="#DC2626" />}
        maxWidth="460px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {ctrl.formError && (
            <div
              role="alert"
              data-testid="gate-pass-revoke-error"
              style={{
                background: '#FEF2F2',
                border: '1px solid #FECACA',
                borderRadius: '10px',
                padding: '0.65rem 0.85rem',
                color: '#991B1B',
                fontSize: '0.78rem',
                fontWeight: 700,
              }}
            >
              {ctrl.formError}
            </div>
          )}

          <p style={{ margin: 0, fontSize: '0.84rem', color: '#334155', lineHeight: 1.5 }}>
            Revoke gate pass <strong style={{ fontFamily: 'monospace' }}>{ctrl.revokingPass?.passCode}</strong> for{' '}
            <strong>{ctrl.revokingPass?.pickupPersonName}</strong>?
          </p>
          <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748B', lineHeight: 1.45 }}>
            Society security gates will immediately deny exit attempts using this pass. This cannot be undone.
          </p>

          <div>
            <label
              htmlFor="gate-pass-revoke-reason"
              style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}
            >
              Revocation Reason (Optional)
            </label>
            <input
              id="gate-pass-revoke-reason"
              type="text"
              maxLength={300}
              disabled={ctrl.isSubmitting}
              placeholder="e.g., Pickup plans changed"
              value={ctrl.revokeReason}
              onChange={(e) => ctrl.setRevokeReason(e.target.value)}
              style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.84rem' }}
            />
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '0.65rem', borderTop: '1px solid #E2E8F0' }}>
            <button
              type="button"
              onClick={ctrl.closeModal}
              disabled={ctrl.isSubmitting}
              style={{
                flex: 1,
                padding: '0.6rem',
                borderRadius: '10px',
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#475569',
                fontWeight: 700,
                fontSize: '0.84rem',
                cursor: ctrl.isSubmitting ? 'not-allowed' : 'pointer',
              }}
            >
              Keep Active
            </button>
            <button
              type="button"
              data-testid="confirm-revoke-gate-pass-btn"
              onClick={() => void ctrl.confirmRevokePass()}
              disabled={ctrl.isSubmitting}
              style={{
                flex: 1,
                padding: '0.6rem',
                borderRadius: '10px',
                border: 'none',
                background: '#DC2626',
                color: '#FFFFFF',
                fontWeight: 800,
                fontSize: '0.84rem',
                cursor: ctrl.isSubmitting ? 'not-allowed' : 'pointer',
              }}
            >
              {ctrl.isSubmitting ? 'Revoking...' : 'Confirm Revoke'}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
};

