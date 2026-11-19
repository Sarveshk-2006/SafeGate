// =============================================================================
// AARIZO — ISSUE-06 Phase B.2.3 (Phase 4.2):
// Resident Child Safety Profile Panel (Listing, Registration, Editing & Archival)
//
// Authoritative invariants:
// - Backed strictly by canonical `childSafetyService` (PostgreSQL backend APIs).
// - Uses approved Phase 4.1 pure helpers for validation, payload construction,
//   RBAC checks, and safe display formatting.
// - Residents NEVER submit `residentId`, `flatId`, `flatNumber`, `guardianUserId`,
//   or `societyId`; backend resolves ownership strictly from verified JWT + DB.
// - Zero mock/demo children, zero hardcoded identities, zero localStorage writes.
// - Monotonic request guards + session-key reset prevent stale/cross-session leaks.
// - Synchronous in-flight mutation lock prevents duplicate submissions.
// =============================================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Edit3,
  Loader2,
  RefreshCw,
  Shield,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import type { UserProfile } from '../../auth/types';
import {
  childSafetyService,
  formatChildSafetyError,
  type FormattedChildSafetyError,
} from '../../../services/childSafetyService';
import type { ChildProfileDto } from '../../../types/childSafety';
import type { RealtimeConnectionStatus } from '../../../types/realtime';
import { realtimeService } from '../../../services/realtimeService';
import type { RealtimeService } from '../../../services/realtimeService';
import { useChildSafetyRealtime } from '../../../hooks/useChildSafetyRealtime';
import { Modal } from '../../../components/ui/Modal';
import {
  buildResidentCreateChildPayload,
  buildResidentUpdateChildPayload,
  formatChildProfileDisplay,
  getResidentChildSafetyPermissions,
  type ResidentCreateChildFormInput,
  type ResidentUpdateChildFormInput,
} from '../utils/childSafetyResidentHelpers';
import { ResidentAuthorizedPickupsSection } from './ResidentAuthorizedPickupsSection';
import { ResidentGatePassesSection } from './ResidentGatePassesSection';
import { ResidentChildAlertsSection } from './ResidentChildAlertsSection';
import { ResidentChildSosModal } from './ResidentChildSosModal';

export interface ChildFormState {
  fullName: string;
  guardianName: string;
  guardianPhone: string;
  dateOfBirth: string;
  reportedAge: string;
  gender: string;
  exitPermissionMode: string;
  emergencyPhone: string;
  medicalNotes: string;
}

export type ChildProfileModalMode = 'CREATE' | 'EDIT' | 'ARCHIVE' | null;

function createEmptyChildForm(user: UserProfile | null): ChildFormState {
  return {
    fullName: '',
    guardianName: typeof user?.name === 'string' ? user.name.trim() : '',
    guardianPhone: typeof user?.phone === 'string' ? user.phone.trim() : '',
    dateOfBirth: '',
    reportedAge: '',
    gender: 'UNSPECIFIED',
    exitPermissionMode: 'ESCORT_REQUIRED',
    emergencyPhone: '',
    medicalNotes: '',
  };
}

function createEditFormFromDto(child: ChildProfileDto): ChildFormState {
  return {
    fullName: child.fullName || '',
    guardianName: child.guardianName || '',
    guardianPhone: child.guardianPhone || '',
    dateOfBirth: child.dateOfBirth ? child.dateOfBirth.slice(0, 10) : '',
    reportedAge:
      typeof child.reportedAge === 'number' && Number.isFinite(child.reportedAge)
        ? String(child.reportedAge)
        : '',
    gender: child.gender || 'UNSPECIFIED',
    exitPermissionMode: child.exitPermissionMode || 'ESCORT_REQUIRED',
    emergencyPhone: child.emergencyPhone || '',
    medicalNotes: child.medicalNotes || '',
  };
}

function getSessionKey(user: UserProfile | null): string {
  if (!user) return '';
  const uid = user.id || (user as { uid?: string }).uid || '';
  if (!uid) return '';
  const soc = typeof user.societyId === 'string' ? user.societyId.trim() : '';
  const role = typeof user.role === 'string' ? user.role.trim().toLowerCase() : '';
  return `${uid}:${soc}:${role}`;
}

export interface ResidentChildProfilesController {
  children: ChildProfileDto[];
  selectedChildId: string | null;
  isLoading: boolean;
  isSubmitting: boolean;
  isLoadingDetail: boolean;
  loadError: FormattedChildSafetyError | null;
  actionError: FormattedChildSafetyError | null;
  formError: string | null;
  successMessage: string | null;
  modalMode: ChildProfileModalMode;
  editingChild: ChildProfileDto | null;
  archivingChild: ChildProfileDto | null;
  formState: ChildFormState;
  permissions: ReturnType<typeof getResidentChildSafetyPermissions>;
  selectChild: (childId: string | null) => void;
  setFormField: <K extends keyof ChildFormState>(field: K, value: ChildFormState[K]) => void;
  loadChildren: (options?: { silent?: boolean }) => Promise<void>;
  openCreateModal: () => void;
  openEditModal: (childId: string) => Promise<void>;
  openArchiveModal: (child: ChildProfileDto) => void;
  closeModal: () => void;
  clearBanners: () => void;
  submitCreateChild: () => Promise<boolean>;
  submitEditChild: () => Promise<boolean>;
  confirmArchiveChild: () => Promise<boolean>;
}

/**
 * Authoritative Resident Child Profile state & action controller.
 * Encapsulates loading, registration, editing (fresh `getChildById`), archival confirmation,
 * duplicate-submit locking, stale-response guarding, and cross-session state reset.
 */
export function useResidentChildProfiles(
  currentUser: UserProfile | null
): ResidentChildProfilesController {
  const sessionKey = getSessionKey(currentUser);
  const permissions = getResidentChildSafetyPermissions(currentUser?.role);

  const [children, setChildren] = useState<ChildProfileDto[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<FormattedChildSafetyError | null>(null);
  const [actionError, setActionError] = useState<FormattedChildSafetyError | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [modalMode, setModalMode] = useState<ChildProfileModalMode>(null);
  const [editingChild, setEditingChild] = useState<ChildProfileDto | null>(null);
  const [archivingChild, setArchivingChild] = useState<ChildProfileDto | null>(null);
  const [formState, setFormState] = useState<ChildFormState>(() => createEmptyChildForm(currentUser));

  // Monotonic sequence & session guards prevent stale responses or double submissions
  const mountedRef = useRef<boolean>(true);
  const activeSessionKeyRef = useRef<string>(sessionKey);
  const listRequestSeqRef = useRef<number>(0);
  const detailRequestSeqRef = useRef<number>(0);
  const mutationSeqRef = useRef<number>(0);
  const mutationInFlightRef = useRef<boolean>(false);
  const currentUserRef = useRef<UserProfile | null>(currentUser);
  const formStateRef = useRef<ChildFormState>(formState);
  const editingChildRef = useRef<ChildProfileDto | null>(editingChild);
  const archivingChildRef = useRef<ChildProfileDto | null>(archivingChild);

  activeSessionKeyRef.current = sessionKey;
  currentUserRef.current = currentUser;
  formStateRef.current = formState;
  editingChildRef.current = editingChild;
  archivingChildRef.current = archivingChild;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      listRequestSeqRef.current += 1;
      detailRequestSeqRef.current += 1;
      mutationSeqRef.current += 1;
    };
  }, []);

  const loadChildren = useCallback(async (options?: { silent?: boolean }): Promise<void> => {
    const reqSession = activeSessionKeyRef.current;
    const reqSeq = ++listRequestSeqRef.current;

    if (!reqSession || !getResidentChildSafetyPermissions(currentUserRef.current?.role).canListChildren) {
      if (mountedRef.current) {
        setChildren([]);
        setSelectedChildId(null);
        setIsLoading(false);
        setLoadError(null);
      }
      return;
    }

    if (!options?.silent) {
      setIsLoading(true);
    }
    setLoadError(null);

    try {
      const records = await childSafetyService.listChildren();
      if (!mountedRef.current || reqSeq !== listRequestSeqRef.current || activeSessionKeyRef.current !== reqSession) {
        return;
      }
      setChildren(records);
      setSelectedChildId((prev) => {
        if (prev && records.some((c) => c.id === prev)) {
          return prev;
        }
        const firstActive = records.find((c) => c.status !== 'ARCHIVED' && !c.archivedAt);
        return firstActive?.id ?? records[0]?.id ?? null;
      });
      setLoadError(null);
    } catch (err) {
      if (!mountedRef.current || reqSeq !== listRequestSeqRef.current || activeSessionKeyRef.current !== reqSession) {
        return;
      }
      const formatted = formatChildSafetyError(err);
      if (formatted.kind === 'UNAUTHORIZED') {
        setChildren([]);
        setSelectedChildId(null);
      }
      setLoadError(formatted);
    } finally {
      if (mountedRef.current && reqSeq === listRequestSeqRef.current && activeSessionKeyRef.current === reqSession) {
        setIsLoading(false);
      }
    }
  }, []);

  // Immediately wipe all local state on logout or user/society/role switch, then reload if authorized
  useEffect(() => {
    listRequestSeqRef.current += 1;
    detailRequestSeqRef.current += 1;
    mutationSeqRef.current += 1;
    mutationInFlightRef.current = false;

    setChildren([]);
    setSelectedChildId(null);
    setModalMode(null);
    setEditingChild(null);
    setArchivingChild(null);
    setFormState(createEmptyChildForm(currentUserRef.current));
    setLoadError(null);
    setActionError(null);
    setFormError(null);
    setSuccessMessage(null);
    setIsLoadingDetail(false);
    setIsSubmitting(false);

    if (sessionKey && getResidentChildSafetyPermissions(currentUserRef.current?.role).canListChildren) {
      void loadChildren();
    } else {
      setIsLoading(false);
    }
  }, [sessionKey, loadChildren]);

  const selectChild = useCallback((childId: string | null) => {
    setSelectedChildId(childId);
  }, []);

  const setFormField = useCallback(<K extends keyof ChildFormState>(field: K, value: ChildFormState[K]) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
    setFormError(null);
  }, []);

  const clearBanners = useCallback(() => {
    setActionError(null);
    setSuccessMessage(null);
  }, []);

  const closeModal = useCallback(() => {
    if (mutationInFlightRef.current) return;
    detailRequestSeqRef.current += 1;
    setModalMode(null);
    setEditingChild(null);
    setArchivingChild(null);
    setFormError(null);
    setIsLoadingDetail(false);
  }, []);

  const openCreateModal = useCallback(() => {
    if (!getResidentChildSafetyPermissions(currentUserRef.current?.role).canRegisterOwnChild) {
      return;
    }
    setActionError(null);
    setSuccessMessage(null);
    setFormError(null);
    setEditingChild(null);
    setArchivingChild(null);
    setFormState(createEmptyChildForm(currentUserRef.current));
    setModalMode('CREATE');
  }, []);

  const openEditModal = useCallback(async (childId: string): Promise<void> => {
    if (!getResidentChildSafetyPermissions(currentUserRef.current?.role).canEditChild) {
      return;
    }
    const reqSession = activeSessionKeyRef.current;
    const reqSeq = ++detailRequestSeqRef.current;

    setActionError(null);
    setSuccessMessage(null);
    setFormError(null);
    setIsLoadingDetail(true);

    try {
      const freshProfile = await childSafetyService.getChildById(childId);
      if (
        !mountedRef.current ||
        reqSeq !== detailRequestSeqRef.current ||
        activeSessionKeyRef.current !== reqSession
      ) {
        return;
      }
      if (freshProfile.status === 'ARCHIVED' || freshProfile.archivedAt) {
        setActionError({
          title: 'Profile Archived',
          message: 'Archived child profiles cannot be edited.',
          kind: 'CONFLICT',
          code: 'CHILD_ARCHIVED',
          status: 409,
          isRetryable: false,
        });
        return;
      }
      setEditingChild(freshProfile);
      setFormState(createEditFormFromDto(freshProfile));
      setModalMode('EDIT');
    } catch (err) {
      if (
        !mountedRef.current ||
        reqSeq !== detailRequestSeqRef.current ||
        activeSessionKeyRef.current !== reqSession
      ) {
        return;
      }
      setActionError(formatChildSafetyError(err));
    } finally {
      if (
        mountedRef.current &&
        reqSeq === detailRequestSeqRef.current &&
        activeSessionKeyRef.current === reqSession
      ) {
        setIsLoadingDetail(false);
      }
    }
  }, []);

  const openArchiveModal = useCallback((child: ChildProfileDto) => {
    if (!getResidentChildSafetyPermissions(currentUserRef.current?.role).canArchiveChild) {
      return;
    }
    if (child.status === 'ARCHIVED' || child.archivedAt) return;
    setActionError(null);
    setSuccessMessage(null);
    setFormError(null);
    setEditingChild(null);
    setArchivingChild(child);
    setModalMode('ARCHIVE');
  }, []);

  const submitCreateChild = useCallback(async (): Promise<boolean> => {
    if (mutationInFlightRef.current) return false;
    if (!getResidentChildSafetyPermissions(currentUserRef.current?.role).canRegisterOwnChild) {
      setFormError('Your account role is not authorized to register a resident child profile here.');
      return false;
    }

    const form = formStateRef.current;
    const input: ResidentCreateChildFormInput = {
      fullName: form.fullName,
      guardianName: form.guardianName,
      guardianPhone: form.guardianPhone,
      dateOfBirth: form.dateOfBirth || null,
      reportedAge: form.reportedAge || null,
      gender: form.gender,
      exitPermissionMode: form.exitPermissionMode,
      emergencyPhone: form.emergencyPhone || null,
      medicalNotes: form.medicalNotes || null,
    };

    const built = buildResidentCreateChildPayload(input);
    if (!built.ok) {
      setFormError(built.error);
      return false;
    }

    const reqSession = activeSessionKeyRef.current;
    const reqMutationSeq = ++mutationSeqRef.current;
    mutationInFlightRef.current = true;
    setIsSubmitting(true);
    setFormError(null);
    setActionError(null);

    try {
      const created = await childSafetyService.createChildProfileAsync(built.value);
      if (!mountedRef.current || mutationSeqRef.current !== reqMutationSeq || activeSessionKeyRef.current !== reqSession) {
        return false;
      }
      setModalMode(null);
      setFormState(createEmptyChildForm(currentUserRef.current));
      setSuccessMessage(`Child profile for "${created.fullName}" registered with society security.`);
      await loadChildren();
      return true;
    } catch (err) {
      if (!mountedRef.current || mutationSeqRef.current !== reqMutationSeq || activeSessionKeyRef.current !== reqSession) {
        return false;
      }
      const formatted = formatChildSafetyError(err);
      if (formatted.kind === 'UNAUTHORIZED') {
        setChildren([]);
        setSelectedChildId(null);
      }
      setFormError(formatted.message);
      setActionError(formatted);
      return false;
    } finally {
      if (mutationSeqRef.current === reqMutationSeq) {
        mutationInFlightRef.current = false;
        if (mountedRef.current && activeSessionKeyRef.current === reqSession) {
          setIsSubmitting(false);
        }
      }
    }
  }, [loadChildren]);

  const submitEditChild = useCallback(async (): Promise<boolean> => {
    if (mutationInFlightRef.current) return false;
    const target = editingChildRef.current;
    if (!target) return false;
    if (!getResidentChildSafetyPermissions(currentUserRef.current?.role).canEditChild) {
      setFormError('Your account role is not authorized to edit child profiles.');
      return false;
    }

    const form = formStateRef.current;
    const input: ResidentUpdateChildFormInput = {
      fullName: form.fullName,
      guardianName: form.guardianName,
      guardianPhone: form.guardianPhone,
      dateOfBirth: form.dateOfBirth ? form.dateOfBirth : null,
      reportedAge: form.reportedAge ? form.reportedAge : null,
      gender: form.gender,
      exitPermissionMode: form.exitPermissionMode,
      emergencyPhone: form.emergencyPhone ? form.emergencyPhone : null,
      medicalNotes: form.medicalNotes ? form.medicalNotes : null,
    };

    const built = buildResidentUpdateChildPayload(input);
    if (!built.ok) {
      setFormError(built.error);
      return false;
    }

    const reqSession = activeSessionKeyRef.current;
    const reqMutationSeq = ++mutationSeqRef.current;
    mutationInFlightRef.current = true;
    setIsSubmitting(true);
    setFormError(null);
    setActionError(null);

    try {
      const updated = await childSafetyService.updateChildProfile(target.id, built.value);
      if (!mountedRef.current || mutationSeqRef.current !== reqMutationSeq || activeSessionKeyRef.current !== reqSession) {
        return false;
      }
      setModalMode(null);
      setEditingChild(null);
      setSuccessMessage(`Updated child profile for "${updated.fullName}".`);
      await loadChildren();
      return true;
    } catch (err) {
      if (!mountedRef.current || mutationSeqRef.current !== reqMutationSeq || activeSessionKeyRef.current !== reqSession) {
        return false;
      }
      const formatted = formatChildSafetyError(err);
      if (formatted.kind === 'UNAUTHORIZED') {
        setChildren([]);
        setSelectedChildId(null);
      }
      setFormError(formatted.message);
      setActionError(formatted);
      return false;
    } finally {
      if (mutationSeqRef.current === reqMutationSeq) {
        mutationInFlightRef.current = false;
        if (mountedRef.current && activeSessionKeyRef.current === reqSession) {
          setIsSubmitting(false);
        }
      }
    }
  }, [loadChildren]);

  const confirmArchiveChild = useCallback(async (): Promise<boolean> => {
    if (mutationInFlightRef.current) return false;
    const target = archivingChildRef.current;
    if (!target) return false;
    if (!getResidentChildSafetyPermissions(currentUserRef.current?.role).canArchiveChild) {
      setFormError('Your account role is not authorized to archive child profiles.');
      return false;
    }

    const reqSession = activeSessionKeyRef.current;
    const reqMutationSeq = ++mutationSeqRef.current;
    mutationInFlightRef.current = true;
    setIsSubmitting(true);
    setFormError(null);
    setActionError(null);

    try {
      const archived = await childSafetyService.archiveChildProfile(target.id);
      if (!mountedRef.current || mutationSeqRef.current !== reqMutationSeq || activeSessionKeyRef.current !== reqSession) {
        return false;
      }
      setModalMode(null);
      setArchivingChild(null);
      setSuccessMessage(
        `Child profile for "${archived.fullName}" archived. Any active gate passes were revoked.`
      );
      await loadChildren();
      return true;
    } catch (err) {
      if (!mountedRef.current || mutationSeqRef.current !== reqMutationSeq || activeSessionKeyRef.current !== reqSession) {
        return false;
      }
      const formatted = formatChildSafetyError(err);
      if (formatted.kind === 'UNAUTHORIZED') {
        setChildren([]);
        setSelectedChildId(null);
      }
      setFormError(formatted.message);
      setActionError(formatted);
      return false;
    } finally {
      if (mutationSeqRef.current === reqMutationSeq) {
        mutationInFlightRef.current = false;
        if (mountedRef.current && activeSessionKeyRef.current === reqSession) {
          setIsSubmitting(false);
        }
      }
    }
  }, [loadChildren]);

  return {
    children,
    selectedChildId,
    isLoading,
    isSubmitting,
    isLoadingDetail,
    loadError,
    actionError,
    formError,
    successMessage,
    modalMode,
    editingChild,
    archivingChild,
    formState,
    permissions,
    selectChild,
    setFormField,
    loadChildren,
    openCreateModal,
    openEditModal,
    openArchiveModal,
    closeModal,
    clearBanners,
    submitCreateChild,
    submitEditChild,
    confirmArchiveChild,
  };
}

function getStatusBadgeStyle(status: string): { bg: string; border: string; color: string } {
  switch (status) {
    case 'SAFE':
      return { bg: '#ECFDF5', border: '#A7F3D0', color: '#059669' };
    case 'OUT_OF_SOCIETY':
      return { bg: '#EFF6FF', border: '#BFDBFE', color: '#1D4ED8' };
    case 'MISSING':
      return { bg: '#FEF2F2', border: '#FECACA', color: '#DC2626' };
    case 'ARCHIVED':
      return { bg: '#F1F5F9', border: '#CBD5E1', color: '#475569' };
    default:
      return { bg: '#FFFBEB', border: '#FDE68A', color: '#B45309' };
  }
}

export function RealtimeStatusBadge({ state }: { state: RealtimeConnectionStatus['state'] }) {
  const isConnected = state === 'CONNECTED';
  const isReconnecting = state === 'RECONNECTING';

  const config = isConnected
    ? {
        bg: '#ECFDF5',
        border: '#A7F3D0',
        text: '#065F46',
        dot: '#10B981',
        label: 'Live Sync Connected',
      }
    : isReconnecting
      ? {
          bg: '#FFFBEB',
          border: '#FDE68A',
          text: '#B45309',
          dot: '#F59E0B',
          label: 'Reconnecting...',
        }
      : {
          bg: '#F1F5F9',
          border: '#CBD5E1',
          text: '#475569',
          dot: '#64748B',
          label: 'Sync Offline',
        };

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Realtime connection status: ${config.label}`}
      data-testid="resident-child-safety-realtime-status"
      data-connection-state={state}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        padding: '0.35rem 0.65rem',
        borderRadius: '9999px',
        background: config.bg,
        border: `1px solid ${config.border}`,
        color: config.text,
        fontSize: '0.72rem',
        fontWeight: 700,
        letterSpacing: '0.01em',
        lineHeight: 1,
      }}
    >
      <span
        style={{
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          backgroundColor: config.dot,
          display: 'inline-block',
          boxShadow: isConnected ? '0 0 6px #10B981' : undefined,
        }}
        aria-hidden="true"
      />
      <span>{config.label}</span>
    </div>
  );
}

export interface ResidentChildSafetyPanelProps {
  realtimeService?: Pick<RealtimeService, 'subscribe' | 'subscribeToStatus' | 'getConnectionStatus'>;
}

export const ResidentChildSafetyPanel: React.FC<ResidentChildSafetyPanelProps> = ({
  realtimeService: customRealtimeService,
}) => {
  const service = customRealtimeService || realtimeService;
  const { currentUser } = useAuth();
  const ctrl = useResidentChildProfiles(currentUser);
  const [pickupsRefreshNonce, setPickupsRefreshNonce] = useState<number>(0);
  const [passesRefreshNonce, setPassesRefreshNonce] = useState<number>(0);
  const [alertsRefreshNonce, setAlertsRefreshNonce] = useState<number>(0);
  const [isSosModalOpen, setIsSosModalOpen] = useState<boolean>(false);
  const [sosModalChildId, setSosModalChildId] = useState<string | null>(null);
  const selectedChild = ctrl.children.find((c) => c.id === ctrl.selectedChildId) ?? null;

  // Track authoritative realtime connection status
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeConnectionStatus>(() => {
    if (typeof service.getConnectionStatus === 'function') {
      return service.getConnectionStatus();
    }
    return {
      connected: false,
      state: 'OFFLINE',
      transportType: 'SSE',
      latencyMs: 0,
      activeListenersCount: 0,
      messagesReceivedTotal: 0,
    };
  });

  useEffect(() => {
    const unsub = service.subscribeToStatus((status) => {
      setRealtimeStatus(status);
    });
    return unsub;
  }, [service]);

  // Monotonic refresh tracking & coalescing
  const mountedPanelRef = useRef<boolean>(true);
  const inFlightRefreshRef = useRef<boolean>(false);
  const hasPendingRefreshDuringInFlightRef = useRef<boolean>(false);
  const pendingScopesRef = useRef<Set<'children' | 'pickups' | 'passes' | 'exitLogs' | 'alerts' | 'all'>>(new Set());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedPanelRef.current = true;
    return () => {
      mountedPanelRef.current = false;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const executeCoalescedRefresh = useCallback(async () => {
    if (!mountedPanelRef.current) return;
    const scopesToRefresh = new Set(pendingScopesRef.current);
    pendingScopesRef.current.clear();
    if (scopesToRefresh.size === 0) return;

    inFlightRefreshRef.current = true;

    try {
      if (scopesToRefresh.has('all') || scopesToRefresh.has('children')) {
        await ctrl.loadChildren({ silent: true });
      }
      if (scopesToRefresh.has('all') || scopesToRefresh.has('pickups')) {
        setPickupsRefreshNonce((n) => n + 1);
        if (!scopesToRefresh.has('children')) {
          await ctrl.loadChildren({ silent: true });
        }
      }
      if (scopesToRefresh.has('all') || scopesToRefresh.has('passes') || scopesToRefresh.has('exitLogs')) {
        setPassesRefreshNonce((n) => n + 1);
        if (!scopesToRefresh.has('children') && !scopesToRefresh.has('pickups')) {
          await ctrl.loadChildren({ silent: true });
        }
      }
      if (scopesToRefresh.has('all') || scopesToRefresh.has('alerts')) {
        setAlertsRefreshNonce((n) => n + 1);
        if (!scopesToRefresh.has('children') && !scopesToRefresh.has('pickups') && !scopesToRefresh.has('passes')) {
          await ctrl.loadChildren({ silent: true });
        }
      }
    } finally {
      if (mountedPanelRef.current) {
        inFlightRefreshRef.current = false;
        if (hasPendingRefreshDuringInFlightRef.current) {
          hasPendingRefreshDuringInFlightRef.current = false;
          void executeCoalescedRefresh();
        }
      }
    }
  }, [ctrl]);

  const scheduleCoalescedRefresh = useCallback(
    (scope: 'children' | 'pickups' | 'passes' | 'exitLogs' | 'alerts' | 'all') => {
      pendingScopesRef.current.add(scope);
      if (inFlightRefreshRef.current) {
        hasPendingRefreshDuringInFlightRef.current = true;
        return;
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        void executeCoalescedRefresh();
      }, 50);
    },
    [executeCoalescedRefresh]
  );

  // Authoritative shared Child Safety realtime subscription
  useChildSafetyRealtime(
    {
      enabled: Boolean(currentUser && ctrl.permissions.canListChildren),
      onProfilesChange: () => scheduleCoalescedRefresh('children'),
      onPickupsChange: () => scheduleCoalescedRefresh('pickups'),
      onPassesChange: () => scheduleCoalescedRefresh('passes'),
      onExitLogsChange: () => scheduleCoalescedRefresh('exitLogs'),
      onAlertsChange: () => scheduleCoalescedRefresh('alerts'),
      onReconnect: () => scheduleCoalescedRefresh('all'),
    },
    service
  );

  const readOnlyFlatLabel =
    typeof currentUser?.flatNumber === 'string' && currentUser.flatNumber.trim()
      ? currentUser.flatNumber.trim()
      : 'Assigned automatically from your resident flat record';

  if (!currentUser || !ctrl.permissions.canListChildren) {
    return (
      <div
        role="alert"
        data-testid="resident-child-safety-unauthorized"
        style={{
          background: '#FFFFFF',
          border: '1px solid #FECACA',
          borderRadius: '16px',
          padding: '1.25rem',
          color: '#991B1B',
          fontSize: '0.8125rem',
          fontWeight: 600,
        }}
      >
        Sign in with an authorized resident account to view and manage your household&apos;s child profiles.
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-200" data-testid="resident-child-safety-panel">
      {/* Header Banner */}
      <div
        style={{
          background: '#FFFFFF',
          border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
          borderRadius: '16px',
          padding: '1rem 1.25rem',
          boxShadow: '0 2px 10px rgba(8, 59, 86, 0.05)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
          <div
            style={{
              width: 44,
              height: 44,
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
            <Shield size={22} color="var(--aarizo-navy, #083B56)" />
          </div>
          <div>
            <h2
              style={{
                fontSize: '1.125rem',
                fontWeight: 800,
                color: 'var(--aarizo-navy, #083B56)',
                margin: 0,
                letterSpacing: '-0.02em',
              }}
            >
              CHILD SAFETY PROFILES
            </h2>
            <p
              style={{
                fontSize: '0.75rem',
                color: 'var(--aarizo-text-secondary, #657785)',
                margin: 0,
                marginTop: '0.125rem',
              }}
            >
              Verified backend child profiles synced with society security &amp; gate controls
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <RealtimeStatusBadge state={realtimeStatus.state} />
          <ShieldCheck size={28} color="var(--aarizo-coral, #F06543)" aria-hidden="true" />
        </div>
      </div>

      {/* Success Banner */}
      {ctrl.successMessage && (
        <div
          role="status"
          style={{
            background: '#ECFDF5',
            border: '1px solid #A7F3D0',
            color: '#065F46',
            padding: '0.875rem 1rem',
            borderRadius: '14px',
            fontSize: '0.8125rem',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <CheckCircle2 size={18} color="#059669" style={{ flexShrink: 0 }} />
            <span>{ctrl.successMessage}</span>
          </div>
          <button
            type="button"
            onClick={ctrl.clearBanners}
            aria-label="Dismiss notification"
            style={{
              background: 'none',
              border: 'none',
              color: '#065F46',
              fontWeight: 800,
              fontSize: '0.75rem',
              cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Action Error Banner (e.g., 401/403/404 on edit/archive) */}
      {ctrl.actionError && !ctrl.modalMode && (
        <div
          role="alert"
          style={{
            background: '#FEF2F2',
            border: '1px solid #FECACA',
            color: '#991B1B',
            padding: '0.875rem 1rem',
            borderRadius: '14px',
            fontSize: '0.8125rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertCircle size={18} color="#DC2626" style={{ flexShrink: 0 }} />
            <div>
              <strong style={{ display: 'block', fontWeight: 800 }}>{ctrl.actionError.title}</strong>
              <span>{ctrl.actionError.message}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={ctrl.clearBanners}
            style={{
              background: '#FFFFFF',
              border: '1px solid #FECACA',
              borderRadius: '8px',
              padding: '0.35rem 0.75rem',
              color: '#991B1B',
              fontWeight: 700,
              fontSize: '0.75rem',
              cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Section Header + Actions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          flexWrap: 'wrap',
          padding: '0 0.25rem',
        }}
      >
        <h3
          style={{
            fontSize: '0.875rem',
            fontWeight: 800,
            color: 'var(--aarizo-navy, #083B56)',
            margin: 0,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Registered Children ({ctrl.children.length})
        </h3>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            type="button"
            onClick={() => void ctrl.loadChildren()}
            disabled={ctrl.isLoading}
            aria-label="Refresh child profiles"
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
              cursor: ctrl.isLoading ? 'not-allowed' : 'pointer',
              opacity: ctrl.isLoading ? 0.65 : 1,
            }}
          >
            <RefreshCw size={14} />
            <span>Refresh</span>
          </button>

          {ctrl.permissions.canRegisterOwnChild && (
            <button
              type="button"
              onClick={ctrl.openCreateModal}
              disabled={ctrl.isLoadingDetail || ctrl.isSubmitting}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.45rem 0.85rem',
                borderRadius: '10px',
                background: 'var(--aarizo-navy, #083B56)',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: '0.78rem',
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(8, 59, 86, 0.15)',
              }}
            >
              <UserPlus size={14} color="var(--aarizo-gold, #E5B842)" />
              <span>Register Child</span>
            </button>
          )}
        </div>
      </div>

      {/* Loading State */}
      {ctrl.isLoading && ctrl.children.length === 0 && (
        <div
          role="status"
          aria-live="polite"
          data-testid="resident-child-safety-loading"
          style={{
            background: '#FFFFFF',
            border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
            borderRadius: '16px',
            padding: '2rem 1.25rem',
            textAlign: 'center',
            color: 'var(--aarizo-text-secondary, #657785)',
            fontSize: '0.8125rem',
            fontWeight: 600,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.625rem',
          }}
        >
          <Loader2 size={24} className="animate-spin" color="var(--aarizo-navy, #083B56)" />
          <span>Loading your household&apos;s verified child profiles...</span>
        </div>
      )}

      {/* Load Error State with Retry */}
      {!ctrl.isLoading && ctrl.loadError && (
        <div
          role="alert"
          data-testid="resident-child-safety-error"
          style={{
            background: '#FEF2F2',
            border: '1px solid #FECACA',
            borderRadius: '16px',
            padding: '1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#991B1B' }}>
            <AlertCircle size={18} color="#DC2626" />
            <strong style={{ fontSize: '0.875rem', fontWeight: 800 }}>{ctrl.loadError.title}</strong>
          </div>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: '#7F1D1D', lineHeight: 1.45 }}>
            {ctrl.loadError.message}
          </p>
          <div>
            <button
              type="button"
              onClick={() => void ctrl.loadChildren()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.5rem 0.9rem',
                borderRadius: '10px',
                background: '#DC2626',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: '0.78rem',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={14} />
              <span>Retry</span>
            </button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!ctrl.isLoading && !ctrl.loadError && ctrl.children.length === 0 && (
        <div
          data-testid="resident-child-safety-empty"
          style={{
            background: '#FFFFFF',
            border: '1px dashed var(--aarizo-border, #CBD5E1)',
            borderRadius: '16px',
            padding: '2rem 1.25rem',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.625rem',
          }}
        >
          <Users size={30} color="var(--aarizo-navy, #083B56)" />
          <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: 'var(--aarizo-navy, #083B56)' }}>
            No Child Profiles Registered Yet
          </h4>
          <p
            style={{
              margin: 0,
              maxWidth: '420px',
              fontSize: '0.78rem',
              color: 'var(--aarizo-text-secondary, #657785)',
              lineHeight: 1.45,
            }}
          >
            Register your child to enable verified gate authorization policies and society security protection.
          </p>
          {ctrl.permissions.canRegisterOwnChild && (
            <button
              type="button"
              onClick={ctrl.openCreateModal}
              style={{
                marginTop: '0.35rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.55rem 1rem',
                borderRadius: '10px',
                background: 'var(--aarizo-coral, #F06543)',
                color: '#FFFFFF',
                fontWeight: 800,
                fontSize: '0.8rem',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              <UserPlus size={15} />
              <span>Register First Child</span>
            </button>
          )}
        </div>
      )}

      {/* Verified Backend Child Cards Grid */}
      {ctrl.loadError?.kind !== 'UNAUTHORIZED' && ctrl.children.length > 0 && (
        <div
          data-testid="resident-child-safety-list"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: '1rem' }}
        >
          {ctrl.children.map((childDto) => {
            const view = formatChildProfileDisplay(childDto);
            const badgeStyle = getStatusBadgeStyle(view.status);
            const isSelectedForPickups = ctrl.selectedChildId === childDto.id;

            return (
              <div
                key={view.id}
                data-testid={`child-card-${view.id}`}
                style={{
                  background: '#FFFFFF',
                  border: isSelectedForPickups
                    ? '2px solid var(--aarizo-navy, #083B56)'
                    : '1px solid var(--aarizo-border-soft, #E8F1F5)',
                  borderRadius: '16px',
                  padding: '1.25rem',
                  boxShadow: '0 2px 10px rgba(8, 59, 86, 0.05)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '1rem',
                }}
              >
                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.5rem',
                      marginBottom: '0.75rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '0.625rem',
                        fontWeight: 800,
                        color: 'var(--aarizo-navy, #083B56)',
                        background: 'var(--aarizo-light-blue, #EAF6FC)',
                        border: '1px solid var(--aarizo-border, #DCE8EF)',
                        padding: '0.2rem 0.5rem',
                        borderRadius: '9999px',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {view.exitPolicyLabel.toUpperCase()}
                    </span>

                    <span
                      style={{
                        fontSize: '0.625rem',
                        fontWeight: 800,
                        color: badgeStyle.color,
                        background: badgeStyle.bg,
                        border: `1px solid ${badgeStyle.border}`,
                        padding: '0.2rem 0.55rem',
                        borderRadius: '9999px',
                        textTransform: 'uppercase',
                      }}
                    >
                      {view.statusLabel}
                    </span>
                  </div>

                  {/* Child Identity Summary */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                    <div
                      aria-hidden="true"
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: '50%',
                        background: 'var(--aarizo-pale-blue, #F4FAFE)',
                        border: '1px solid var(--aarizo-border, #DCE8EF)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--aarizo-navy, #083B56)',
                        fontWeight: 800,
                        fontSize: '1.125rem',
                        flexShrink: 0,
                      }}
                    >
                      {view.fullName.charAt(0).toUpperCase()}
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <h4
                        style={{
                          fontSize: '1.05rem',
                          fontWeight: 800,
                          color: 'var(--aarizo-text, #203746)',
                          margin: 0,
                          wordBreak: 'break-word',
                        }}
                      >
                        {view.fullName}
                      </h4>
                      <p
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--aarizo-text-secondary, #657785)',
                          margin: '0.15rem 0 0',
                        }}
                      >
                        Flat {view.flatNumber} · {view.ageOrDobLabel} · {view.genderLabel}
                      </p>
                      <p
                        style={{
                          fontSize: '0.7rem',
                          color: 'var(--aarizo-blue, #176B91)',
                          margin: '0.25rem 0 0',
                          fontWeight: 600,
                        }}
                      >
                        Guardian: {view.guardianName} ({view.guardianPhone})
                      </p>
                    </div>
                  </div>

                  {view.medicalNotes && (
                    <div
                      style={{
                        marginTop: '0.75rem',
                        padding: '0.5rem 0.75rem',
                        borderRadius: '10px',
                        background: '#FFFBEB',
                        border: '1px solid #FDE68A',
                        fontSize: '0.72rem',
                        color: '#92400E',
                        fontWeight: 600,
                      }}
                    >
                      Medical Notes: {view.medicalNotes}
                    </div>
                  )}
                </div>

                {/* Phase 4.2 & 4.3 Profile Actions (Pickups, Edit & Archive) */}
                {!view.isArchived && (
                  <div
                    style={{
                      display: 'flex',
                      gap: '0.5rem',
                      paddingTop: '0.75rem',
                      borderTop: '1px solid var(--aarizo-border, #DCE8EF)',
                      flexWrap: 'wrap',
                    }}
                  >
                    {ctrl.permissions.canManagePickups && (
                      <button
                        type="button"
                        data-testid={`select-pickups-btn-${view.id}`}
                        onClick={() => ctrl.selectChild(childDto.id)}
                        disabled={ctrl.isLoadingDetail || ctrl.isSubmitting}
                        style={{
                          flex: 1,
                          padding: '0.5rem 0.75rem',
                          borderRadius: '10px',
                          background: isSelectedForPickups ? 'var(--aarizo-navy, #083B56)' : '#F8FAFC',
                          border: isSelectedForPickups
                            ? '1px solid var(--aarizo-navy, #083B56)'
                            : '1px solid var(--aarizo-border, #DCE8EF)',
                          color: isSelectedForPickups ? '#FFFFFF' : 'var(--aarizo-navy, #083B56)',
                          fontWeight: 800,
                          fontSize: '0.75rem',
                          cursor: ctrl.isLoadingDetail || ctrl.isSubmitting ? 'not-allowed' : 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.35rem',
                        }}
                      >
                        <ShieldCheck size={14} />
                        <span>Pickups ({view.activePickupCount})</span>
                      </button>
                    )}

                    {ctrl.permissions.canEditChild && (
                      <button
                        type="button"
                        onClick={() => void ctrl.openEditModal(childDto.id)}
                        disabled={ctrl.isLoadingDetail || ctrl.isSubmitting}
                        style={{
                          flex: 1,
                          padding: '0.5rem 0.75rem',
                          borderRadius: '10px',
                          background: 'var(--aarizo-light-blue, #EAF6FC)',
                          border: '1px solid var(--aarizo-border, #DCE8EF)',
                          color: 'var(--aarizo-navy, #083B56)',
                          fontWeight: 800,
                          fontSize: '0.75rem',
                          cursor: ctrl.isLoadingDetail || ctrl.isSubmitting ? 'not-allowed' : 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.35rem',
                        }}
                      >
                        <Edit3 size={14} />
                        <span>Edit Profile</span>
                      </button>
                    )}

                    {ctrl.permissions.canArchiveChild && (
                      <button
                        type="button"
                        onClick={() => ctrl.openArchiveModal(childDto)}
                        disabled={ctrl.isLoadingDetail || ctrl.isSubmitting}
                        style={{
                          flex: 1,
                          padding: '0.5rem 0.75rem',
                          borderRadius: '10px',
                          background: '#FFFFFF',
                          border: '1px solid #FECACA',
                          color: '#DC2626',
                          fontWeight: 800,
                          fontSize: '0.75rem',
                          cursor: ctrl.isLoadingDetail || ctrl.isSubmitting ? 'not-allowed' : 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.35rem',
                        }}
                      >
                        <Archive size={14} />
                        <span>Archive</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Phase 4.5: Child Safety SOS & Live Alerts Section */}
      {ctrl.loadError?.kind !== 'UNAUTHORIZED' && (
        <ResidentChildAlertsSection
          childrenList={ctrl.children}
          selectedChildId={ctrl.selectedChildId}
          currentUser={currentUser}
          refreshNonce={alertsRefreshNonce}
          onTriggerSosRequested={(childId) => {
            setSosModalChildId(childId || ctrl.selectedChildId || null);
            setIsSosModalOpen(true);
          }}
          onAlertMutated={async () => {
            await ctrl.loadChildren({ silent: true });
          }}
        />
      )}

      {/* Phase 4.3: Authorized Pickup Management Section */}
      {ctrl.loadError?.kind !== 'UNAUTHORIZED' && ctrl.children.length > 0 && (
        <ResidentAuthorizedPickupsSection
          childrenList={ctrl.children}
          selectedChildId={ctrl.selectedChildId}
          onSelectChild={(id) => ctrl.selectChild(id)}
          currentUser={currentUser}
          refreshNonce={pickupsRefreshNonce}
          onPickupsMutated={async () => {
            setPickupsRefreshNonce((n) => n + 1);
            await ctrl.loadChildren({ silent: true });
          }}
        />
      )}

      {/* Phase 4.4: One-Time Secure Child Gate Pass & Exit History Section */}
      {ctrl.loadError?.kind !== 'UNAUTHORIZED' && selectedChild && (
        <ResidentGatePassesSection
          selectedChild={selectedChild}
          currentUser={currentUser}
          pickupsRefreshNonce={pickupsRefreshNonce}
          passesRefreshNonce={passesRefreshNonce}
        />
      )}

      {/* Modal: Create or Edit Child Profile */}
      <Modal
        isOpen={ctrl.modalMode === 'CREATE' || ctrl.modalMode === 'EDIT'}
        onClose={ctrl.closeModal}
        title={ctrl.modalMode === 'EDIT' ? 'Edit Child Profile' : 'Register Child Profile'}
        subtitle={
          ctrl.modalMode === 'EDIT'
            ? 'Update guardian details, medical notes, or gate exit policy'
            : 'Ownership and flat assignment are verified automatically from your resident account'
        }
        icon={ctrl.modalMode === 'EDIT' ? <Edit3 size={20} /> : <UserPlus size={20} />}
        maxWidth="520px"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (ctrl.modalMode === 'EDIT') {
              void ctrl.submitEditChild();
            } else {
              void ctrl.submitCreateChild();
            }
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', paddingTop: '0.25rem' }}
        >
          {ctrl.formError && (
            <div
              role="alert"
              style={{
                background: '#FEF2F2',
                border: '1px solid #FECACA',
                color: '#991B1B',
                padding: '0.65rem 0.85rem',
                borderRadius: '10px',
                fontSize: '0.78rem',
                fontWeight: 700,
              }}
            >
              {ctrl.formError}
            </div>
          )}

          {/* Read-only flat context (never submitted by resident) */}
          <div
            style={{
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
              borderRadius: '10px',
              padding: '0.55rem 0.75rem',
              fontSize: '0.75rem',
              color: '#475569',
            }}
          >
            <strong>Assigned Flat:</strong>{' '}
            {ctrl.modalMode === 'EDIT' && ctrl.editingChild
              ? ctrl.editingChild.flatNumber
              : readOnlyFlatLabel}
          </div>

          <div>
            <label
              htmlFor="child-full-name"
              style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}
            >
              Child Full Name *
            </label>
            <input
              id="child-full-name"
              type="text"
              required
              maxLength={200}
              disabled={ctrl.isSubmitting}
              placeholder="Enter child full name"
              value={ctrl.formState.fullName}
              onChange={(e) => ctrl.setFormField('fullName', e.target.value)}
              style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label
                htmlFor="child-dob"
                style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}
              >
                Date of Birth
              </label>
              <input
                id="child-dob"
                type="date"
                disabled={ctrl.isSubmitting}
                value={ctrl.formState.dateOfBirth}
                onChange={(e) => ctrl.setFormField('dateOfBirth', e.target.value)}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
              />
            </div>

            <div>
              <label
                htmlFor="child-age"
                style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}
              >
                Age (0–25)
              </label>
              <input
                id="child-age"
                type="number"
                min={0}
                max={25}
                disabled={ctrl.isSubmitting}
                placeholder="Optional"
                value={ctrl.formState.reportedAge}
                onChange={(e) => ctrl.setFormField('reportedAge', e.target.value)}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label
                htmlFor="child-gender"
                style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}
              >
                Gender
              </label>
              <select
                id="child-gender"
                disabled={ctrl.isSubmitting}
                value={ctrl.formState.gender}
                onChange={(e) => ctrl.setFormField('gender', e.target.value)}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem', background: '#FFFFFF' }}
              >
                <option value="UNSPECIFIED">Prefer not to say</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="child-exit-policy"
                style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}
              >
                Gate Exit Policy
              </label>
              <select
                id="child-exit-policy"
                disabled={ctrl.isSubmitting}
                value={ctrl.formState.exitPermissionMode}
                onChange={(e) => ctrl.setFormField('exitPermissionMode', e.target.value)}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem', background: '#FFFFFF' }}
              >
                <option value="ESCORT_REQUIRED">Authorized Escort Required</option>
                <option value="TIMED_PASS_ONLY">Timed Pass Only</option>
                <option value="SOLO_ALLOWED">Solo Exit Permitted</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label
                htmlFor="child-guardian-name"
                style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}
              >
                Primary Guardian Name *
              </label>
              <input
                id="child-guardian-name"
                type="text"
                required
                maxLength={200}
                disabled={ctrl.isSubmitting}
                placeholder="Guardian full name"
                value={ctrl.formState.guardianName}
                onChange={(e) => ctrl.setFormField('guardianName', e.target.value)}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
              />
            </div>

            <div>
              <label
                htmlFor="child-guardian-phone"
                style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}
              >
                Guardian Phone *
              </label>
              <input
                id="child-guardian-phone"
                type="tel"
                required
                maxLength={32}
                disabled={ctrl.isSubmitting}
                placeholder="+91..."
                value={ctrl.formState.guardianPhone}
                onChange={(e) => ctrl.setFormField('guardianPhone', e.target.value)}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="child-emergency-phone"
              style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}
            >
              Emergency Contact Phone (Optional)
            </label>
            <input
              id="child-emergency-phone"
              type="tel"
              maxLength={32}
              disabled={ctrl.isSubmitting}
              placeholder="Alternate emergency number"
              value={ctrl.formState.emergencyPhone}
              onChange={(e) => ctrl.setFormField('emergencyPhone', e.target.value)}
              style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
            />
          </div>

          <div>
            <label
              htmlFor="child-medical-notes"
              style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}
            >
              Medical Notes / Allergies (Optional)
            </label>
            <textarea
              id="child-medical-notes"
              rows={2}
              maxLength={1000}
              disabled={ctrl.isSubmitting}
              placeholder="Allergies, medication, or emergency care notes"
              value={ctrl.formState.medicalNotes}
              onChange={(e) => ctrl.setFormField('medicalNotes', e.target.value)}
              style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem', resize: 'vertical' }}
            />
          </div>

          <div
            style={{
              display: 'flex',
              gap: '0.75rem',
              marginTop: '0.5rem',
              paddingTop: '0.75rem',
              borderTop: '1px solid #E2E8F0',
            }}
          >
            <button
              type="button"
              onClick={ctrl.closeModal}
              disabled={ctrl.isSubmitting}
              style={{
                flex: 1,
                padding: '0.65rem',
                borderRadius: '10px',
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#475569',
                fontWeight: 700,
                fontSize: '0.8125rem',
                cursor: ctrl.isSubmitting ? 'not-allowed' : 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={ctrl.isSubmitting}
              style={{
                flex: 2,
                padding: '0.65rem',
                borderRadius: '10px',
                border: 'none',
                background: 'var(--aarizo-navy, #083B56)',
                color: '#FFFFFF',
                fontWeight: 800,
                fontSize: '0.8125rem',
                cursor: ctrl.isSubmitting ? 'not-allowed' : 'pointer',
                opacity: ctrl.isSubmitting ? 0.7 : 1,
                boxShadow: '0 2px 8px rgba(8, 59, 86, 0.25)',
              }}
            >
              {ctrl.isSubmitting
                ? ctrl.modalMode === 'EDIT'
                  ? 'Saving Changes...'
                  : 'Registering...'
                : ctrl.modalMode === 'EDIT'
                  ? 'Save Changes'
                  : 'Register Child'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Confirm Child Archive */}
      <Modal
        isOpen={ctrl.modalMode === 'ARCHIVE' && !!ctrl.archivingChild}
        onClose={ctrl.closeModal}
        title="Archive Child Profile"
        subtitle="Confirm permanent archival of this child safety profile"
        icon={<Archive size={20} />}
        maxWidth="460px"
      >
        {ctrl.archivingChild && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', fontSize: '0.8125rem' }}>
            {ctrl.formError && (
              <div
                role="alert"
                style={{
                  background: '#FEF2F2',
                  border: '1px solid #FECACA',
                  color: '#991B1B',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '10px',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                }}
              >
                {ctrl.formError}
              </div>
            )}

            <p style={{ margin: 0, color: '#334155', lineHeight: 1.5 }}>
              Are you sure you want to archive the child profile for{' '}
              <strong>{ctrl.archivingChild.fullName}</strong> (Flat {ctrl.archivingChild.flatNumber})?
            </p>
            <div
              style={{
                background: '#FEF2F2',
                border: '1px solid #FECACA',
                borderRadius: '12px',
                padding: '0.75rem',
                color: '#991B1B',
                fontSize: '0.75rem',
                fontWeight: 600,
                lineHeight: 1.45,
              }}
            >
              Archiving immediately revokes all active gate passes for this child and removes the profile from active security verification.
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '0.5rem' }}>
              <button
                type="button"
                onClick={ctrl.closeModal}
                disabled={ctrl.isSubmitting}
                style={{
                  flex: 1,
                  padding: '0.65rem',
                  borderRadius: '10px',
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  color: '#475569',
                  fontWeight: 700,
                  fontSize: '0.8125rem',
                  cursor: ctrl.isSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void ctrl.confirmArchiveChild()}
                disabled={ctrl.isSubmitting}
                style={{
                  flex: 1.5,
                  padding: '0.65rem',
                  borderRadius: '10px',
                  border: 'none',
                  background: '#DC2626',
                  color: '#FFFFFF',
                  fontWeight: 800,
                  fontSize: '0.8125rem',
                  cursor: ctrl.isSubmitting ? 'not-allowed' : 'pointer',
                  opacity: ctrl.isSubmitting ? 0.7 : 1,
                }}
              >
                {ctrl.isSubmitting ? 'Archiving...' : 'Confirm Archive'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal: Dispatch Child Safety SOS */}
      <ResidentChildSosModal
        isOpen={isSosModalOpen}
        onClose={() => {
          setIsSosModalOpen(false);
          setSosModalChildId(null);
        }}
        childrenList={ctrl.children}
        preselectedChildId={sosModalChildId || ctrl.selectedChildId}
        currentUser={currentUser}
        onSosDispatched={async () => {
          setAlertsRefreshNonce((n) => n + 1);
          setPickupsRefreshNonce((n) => n + 1);
          await ctrl.loadChildren({ silent: true });
        }}
      />
    </div>
  );
};

