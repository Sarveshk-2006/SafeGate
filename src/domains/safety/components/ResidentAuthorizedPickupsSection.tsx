// =============================================================================
// AARIZO — ISSUE-06 Phase B.2.3 (Phase 4.3):
// Resident Authorized Pickup Management — Authoritative Controller & UI Section
//
// Architectural Invariants:
// - Uses ONLY canonical `childSafetyService` pickup methods (`listAuthorizedPickups`,
//   `addAuthorizedPickup`, `updateAuthorizedPickup`, `revokeAuthorizedPickup`,
//   `archiveAuthorizedPickup`) and Phase 4.1 pure helpers.
// - Zero demo/hardcoded pickup records, zero localStorage/sessionStorage writes.
// - Edit modal exposes ONLY backend-supported PATCH fields (`name`, `phone`,
//   `relationship`, `validUntil`, and expiry renewal `status: 'ACTIVE'` when a
//   new future `validUntil` is provided on an expired pickup). Never submits or
//   implies edits to `idDocumentType`, `idDocumentLast4`, `photoUrl`, or `notes`.
// - Never collects, transmits, or renders raw government ID numbers; displays
//   only masked last-4 metadata via `formatMaskedPickupId()`.
// - Monotonic request/mutation sequence guards + active `(sessionKey, childId)`
//   checks prevent stale responses and cross-child or cross-session lock races.
// =============================================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Archive,
  Ban,
  CalendarClock,
  CheckCircle2,
  Edit3,
  IdCard,
  Loader2,
  Phone,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  childSafetyService,
  formatChildSafetyError,
  type FormattedChildSafetyError,
} from '../../../services/childSafetyService';
import type { UserProfile } from '../../auth/types';
import type { AuthorizedPickupDto, ChildProfileDto } from '../../../types/childSafety';
import {
  buildCreateAuthorizedPickupPayload,
  buildUpdateAuthorizedPickupPayload,
  formatAuthorizedPickupDisplay,
  getResidentChildSafetyPermissions,
  parseTimestampMs,
  type ChildSafetyRolePermissions,
  type EffectivePickupDisplayStatus,
  type ResidentCreatePickupFormInput,
  type ResidentUpdatePickupFormInput,
} from '../utils/childSafetyResidentHelpers';
import { Modal } from '../../../components/ui/Modal';

export type PickupModalMode = 'ADD' | 'EDIT' | 'REVOKE' | 'ARCHIVE' | null;

export interface AddPickupFormState {
  name: string;
  phone: string;
  relationship: string;
  idDocumentType: string;
  idDocumentLast4: string;
  validUntil: string;
  notes: string;
}

/**
 * Strictly mirrors backend `PATCH /api/children/:childId/pickups/:pickupId`
 * supported fields (`name`, `phone`, `relationship`, `validUntil`, and renewal
 * `status` when renewing an expired pickup with a fresh future `validUntil`).
 */
export interface EditPickupFormState {
  name: string;
  phone: string;
  relationship: string;
  validUntil: string;
  initialValidUntil: string;
  clearValidUntil: boolean;
}

export interface ResidentAuthorizedPickupsController {
  selectedChildId: string | null;
  pickups: AuthorizedPickupDto[];
  isLoading: boolean;
  isSubmitting: boolean;
  loadError: FormattedChildSafetyError | null;
  actionError: FormattedChildSafetyError | null;
  formError: string | null;
  successMessage: string | null;
  modalMode: PickupModalMode;
  editingPickup: AuthorizedPickupDto | null;
  confirmTarget: AuthorizedPickupDto | null;
  addForm: AddPickupFormState;
  editForm: EditPickupFormState;
  permissions: ChildSafetyRolePermissions;
  loadPickups: () => Promise<void>;
  openAddModal: () => void;
  openEditModal: (pickup: AuthorizedPickupDto) => void;
  openRevokeModal: (pickup: AuthorizedPickupDto) => void;
  openArchiveModal: (pickup: AuthorizedPickupDto) => void;
  closeModal: () => void;
  setAddFormField: <K extends keyof AddPickupFormState>(field: K, value: AddPickupFormState[K]) => void;
  setEditFormField: <K extends keyof EditPickupFormState>(field: K, value: EditPickupFormState[K]) => void;
  submitAddPickup: () => Promise<boolean>;
  submitEditPickup: () => Promise<boolean>;
  confirmRevokePickup: () => Promise<boolean>;
  confirmArchivePickup: () => Promise<boolean>;
  clearBanners: () => void;
}

export interface ResidentAuthorizedPickupsSectionProps {
  childrenList: ChildProfileDto[];
  selectedChildId: string | null;
  onSelectChild: (childId: string) => void;
  currentUser: UserProfile | null;
  refreshNonce?: number;
  onPickupsMutated?: (childId: string) => void | Promise<void>;
}

const ID_DOCUMENT_TYPE_OPTIONS = [
  '',
  'Aadhaar Card',
  'PAN Card',
  'Driving License',
  'Passport',
  'Voter ID',
  'Employee / School ID',
];

function getSessionKey(user: UserProfile | null): string {
  if (!user) return '';
  const uid = user.id || (user as any).uid || '';
  if (!uid) return '';
  const soc = (user.societyId || '').trim();
  const role = (user.role || '').trim().toLowerCase();
  return `${uid}:${soc}:${role}`;
}

function createEmptyAddForm(): AddPickupFormState {
  return {
    name: '',
    phone: '',
    relationship: '',
    idDocumentType: '',
    idDocumentLast4: '',
    validUntil: '',
    notes: '',
  };
}

function toDateTimeLocalValue(iso: string | null | undefined): string {
  const ms = parseTimestampMs(iso);
  if (ms === null) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function createEditFormFromPickup(pickup: AuthorizedPickupDto): EditPickupFormState {
  const formattedValidUntil = toDateTimeLocalValue(pickup.validUntil);
  return {
    name: pickup.name || '',
    phone: pickup.phone || '',
    relationship: pickup.relationship || '',
    validUntil: formattedValidUntil,
    initialValidUntil: formattedValidUntil,
    clearValidUntil: false,
  };
}

function formatValidUntilDisplay(iso: string | null): string {
  if (!iso) return 'No Expiry Set';
  const ms = parseTimestampMs(iso);
  if (ms === null) return 'Invalid Expiry';
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

function getPickupStatusBadgeStyle(status: EffectivePickupDisplayStatus): {
  bg: string;
  color: string;
  border: string;
} {
  switch (status) {
    case 'ACTIVE':
      return { bg: '#ECFDF5', color: '#047857', border: '#A7F3D0' };
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

/**
 * Authoritative controller hook for Resident Authorized Pickup Management.
 * Exported directly so behavioral tests execute the exact production hook against
 * real `childSafetyService`, real `apiClient.*Strict`, and real Phase 4.1 helpers.
 */
export function useResidentAuthorizedPickups(
  currentUser: UserProfile | null,
  selectedChildId: string | null,
  selectedChild?: Pick<ChildProfileDto, 'id' | 'status' | 'archivedAt'> | null,
  onPickupsMutated?: (childId: string) => void | Promise<void>,
  refreshNonce = 0
): ResidentAuthorizedPickupsController {
  const sessionKey = getSessionKey(currentUser);
  const normalizedChildId =
    typeof selectedChildId === 'string' && selectedChildId.trim().length > 0 ? selectedChildId.trim() : null;
  const permissions = getResidentChildSafetyPermissions(currentUser?.role);

  const [pickups, setPickups] = useState<AuthorizedPickupDto[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(
    Boolean(sessionKey && normalizedChildId && permissions.canManagePickups)
  );
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<FormattedChildSafetyError | null>(null);
  const [actionError, setActionError] = useState<FormattedChildSafetyError | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [modalMode, setModalMode] = useState<PickupModalMode>(null);
  const [editingPickup, setEditingPickup] = useState<AuthorizedPickupDto | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<AuthorizedPickupDto | null>(null);
  const [addForm, setAddForm] = useState<AddPickupFormState>(() => createEmptyAddForm());
  const [editForm, setEditForm] = useState<EditPickupFormState>(() => ({
    name: '',
    phone: '',
    relationship: '',
    validUntil: '',
    initialValidUntil: '',
    clearValidUntil: false,
  }));

  // Monotonic sequence & active scope refs prevent stale responses and cross-session/cross-child races
  const mountedRef = useRef<boolean>(true);
  const activeSessionKeyRef = useRef<string>(sessionKey);
  const activeChildIdRef = useRef<string | null>(normalizedChildId);
  const listRequestSeqRef = useRef<number>(0);
  const mutationSeqRef = useRef<number>(0);
  const mutationInFlightRef = useRef<boolean>(false);

  const currentUserRef = useRef<UserProfile | null>(currentUser);
  const selectedChildRef = useRef<Pick<ChildProfileDto, 'id' | 'status' | 'archivedAt'> | null | undefined>(
    selectedChild
  );
  const onPickupsMutatedRef = useRef<((childId: string) => void | Promise<void>) | undefined>(onPickupsMutated);
  const addFormRef = useRef<AddPickupFormState>(addForm);
  const editFormRef = useRef<EditPickupFormState>(editForm);
  const editingPickupRef = useRef<AuthorizedPickupDto | null>(editingPickup);
  const confirmTargetRef = useRef<AuthorizedPickupDto | null>(confirmTarget);

  activeSessionKeyRef.current = sessionKey;
  activeChildIdRef.current = normalizedChildId;
  currentUserRef.current = currentUser;
  selectedChildRef.current = selectedChild;
  onPickupsMutatedRef.current = onPickupsMutated;
  addFormRef.current = addForm;
  editFormRef.current = editForm;
  editingPickupRef.current = editingPickup;
  confirmTargetRef.current = confirmTarget;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      listRequestSeqRef.current += 1;
      mutationSeqRef.current += 1;
    };
  }, []);

  const loadPickups = useCallback(async (): Promise<void> => {
    const reqSession = activeSessionKeyRef.current;
    const reqChildId = activeChildIdRef.current;
    const reqSeq = ++listRequestSeqRef.current;

    if (!reqSession || !reqChildId || !getResidentChildSafetyPermissions(currentUserRef.current?.role).canManagePickups) {
      if (mountedRef.current) {
        setPickups([]);
        setIsLoading(false);
        setLoadError(null);
      }
      return;
    }

    setIsLoading(true);
    setLoadError(null);

    try {
      const records = await childSafetyService.listAuthorizedPickups(reqChildId);
      if (
        !mountedRef.current ||
        reqSeq !== listRequestSeqRef.current ||
        activeSessionKeyRef.current !== reqSession ||
        activeChildIdRef.current !== reqChildId
      ) {
        return;
      }
      setPickups(records);
      setLoadError(null);
    } catch (err) {
      if (
        !mountedRef.current ||
        reqSeq !== listRequestSeqRef.current ||
        activeSessionKeyRef.current !== reqSession ||
        activeChildIdRef.current !== reqChildId
      ) {
        return;
      }
      const formatted = formatChildSafetyError(err);
      if (formatted.kind === 'UNAUTHORIZED') {
        setPickups([]);
      }
      setLoadError(formatted);
    } finally {
      if (
        mountedRef.current &&
        reqSeq === listRequestSeqRef.current &&
        activeSessionKeyRef.current === reqSession &&
        activeChildIdRef.current === reqChildId
      ) {
        setIsLoading(false);
      }
    }
  }, []);

  // Immediately purge stale pickup state whenever session OR selected child changes
  useEffect(() => {
    listRequestSeqRef.current += 1;
    mutationSeqRef.current += 1;
    mutationInFlightRef.current = false;

    setPickups([]);
    setModalMode(null);
    setEditingPickup(null);
    setConfirmTarget(null);
    setAddForm(createEmptyAddForm());
    setEditForm({
      name: '',
      phone: '',
      relationship: '',
      validUntil: '',
      initialValidUntil: '',
      clearValidUntil: false,
    });
    setLoadError(null);
    setActionError(null);
    setFormError(null);
    setSuccessMessage(null);
    setIsSubmitting(false);

    if (
      sessionKey &&
      normalizedChildId &&
      getResidentChildSafetyPermissions(currentUserRef.current?.role).canManagePickups
    ) {
      void loadPickups();
    } else {
      setIsLoading(false);
    }
  }, [sessionKey, normalizedChildId, loadPickups]);

  // Re-fetch pickups whenever parent signals a refreshNonce bump (e.g. from realtime SSE)
  const prevRefreshNonceRef = useRef<number>(refreshNonce);
  useEffect(() => {
    if (refreshNonce === prevRefreshNonceRef.current) return;
    prevRefreshNonceRef.current = refreshNonce;
    if (
      sessionKey &&
      normalizedChildId &&
      getResidentChildSafetyPermissions(currentUserRef.current?.role).canManagePickups
    ) {
      void loadPickups();
    }
  }, [refreshNonce, sessionKey, normalizedChildId, loadPickups]);

  const setAddFormField = useCallback(<K extends keyof AddPickupFormState>(field: K, value: AddPickupFormState[K]) => {
    setAddForm((prev) => ({ ...prev, [field]: value }));
    setFormError(null);
  }, []);

  const setEditFormField = useCallback(
    <K extends keyof EditPickupFormState>(field: K, value: EditPickupFormState[K]) => {
      setEditForm((prev) => {
        if (field === 'validUntil' && typeof value === 'string' && value.trim().length > 0) {
          return { ...prev, validUntil: value, clearValidUntil: false };
        }
        if (field === 'clearValidUntil' && value === true) {
          return { ...prev, clearValidUntil: true, validUntil: '' };
        }
        return { ...prev, [field]: value };
      });
      setFormError(null);
    },
    []
  );

  const clearBanners = useCallback(() => {
    setActionError(null);
    setSuccessMessage(null);
  }, []);

  const closeModal = useCallback(() => {
    if (mutationInFlightRef.current) return;
    setModalMode(null);
    setEditingPickup(null);
    setConfirmTarget(null);
    setFormError(null);
  }, []);

  const isSelectedChildArchived = (): boolean => {
    const child = selectedChildRef.current;
    if (!child) return false;
    return child.status === 'ARCHIVED' || Boolean(child.archivedAt);
  };

  const openAddModal = useCallback(() => {
    if (!activeChildIdRef.current) return;
    if (!getResidentChildSafetyPermissions(currentUserRef.current?.role).canManagePickups) return;
    if (isSelectedChildArchived()) {
      setActionError({
        kind: 'CONFLICT',
        status: 409,
        code: 'CHILD_ARCHIVED',
        title: 'Child Profile Archived',
        message: 'Cannot add an authorized escort to an archived child profile.',
        isRetryable: false,
      });
      return;
    }
    setActionError(null);
    setSuccessMessage(null);
    setFormError(null);
    setEditingPickup(null);
    setConfirmTarget(null);
    setAddForm(createEmptyAddForm());
    setModalMode('ADD');
  }, []);

  const openEditModal = useCallback((pickup: AuthorizedPickupDto) => {
    if (!activeChildIdRef.current || pickup.childId !== activeChildIdRef.current) return;
    if (!getResidentChildSafetyPermissions(currentUserRef.current?.role).canManagePickups) return;

    const display = formatAuthorizedPickupDisplay(pickup);
    if (!display.canEdit) {
      setActionError({
        kind: 'CONFLICT',
        status: 422,
        code: display.effectiveStatus === 'ARCHIVED' ? 'PICKUP_ARCHIVED' : 'REVOKED_PICKUP_CANNOT_BE_REACTIVATED',
        title: display.effectiveStatus === 'ARCHIVED' ? 'Pickup Archived' : 'Pickup Revoked',
        message:
          display.effectiveStatus === 'ARCHIVED'
            ? 'Archived pickup authorizations cannot be modified.'
            : 'Revoked pickup authorizations are immutable. Add a new authorized pickup instead.',
        isRetryable: false,
      });
      return;
    }

    setActionError(null);
    setSuccessMessage(null);
    setFormError(null);
    setConfirmTarget(null);
    setEditingPickup(pickup);
    setEditForm(createEditFormFromPickup(pickup));
    setModalMode('EDIT');
  }, []);

  const openRevokeModal = useCallback((pickup: AuthorizedPickupDto) => {
    if (!activeChildIdRef.current || pickup.childId !== activeChildIdRef.current) return;
    if (!getResidentChildSafetyPermissions(currentUserRef.current?.role).canManagePickups) return;

    const display = formatAuthorizedPickupDisplay(pickup);
    if (!display.canRevoke) {
      setActionError({
        kind: 'CONFLICT',
        status: 409,
        code: display.effectiveStatus === 'ARCHIVED' ? 'ALREADY_ARCHIVED' : 'ALREADY_REVOKED',
        title: 'Action Not Available',
        message:
          display.effectiveStatus === 'ARCHIVED'
            ? 'This pickup authorization is already archived.'
            : 'This pickup authorization is already revoked.',
        isRetryable: false,
      });
      return;
    }

    setActionError(null);
    setSuccessMessage(null);
    setFormError(null);
    setEditingPickup(null);
    setConfirmTarget(pickup);
    setModalMode('REVOKE');
  }, []);

  const openArchiveModal = useCallback((pickup: AuthorizedPickupDto) => {
    if (!activeChildIdRef.current || pickup.childId !== activeChildIdRef.current) return;
    if (!getResidentChildSafetyPermissions(currentUserRef.current?.role).canManagePickups) return;

    const display = formatAuthorizedPickupDisplay(pickup);
    if (!display.canArchive) {
      setActionError({
        kind: 'CONFLICT',
        status: 409,
        code: 'ALREADY_ARCHIVED',
        title: 'Already Archived',
        message: 'This pickup authorization is already archived.',
        isRetryable: false,
      });
      return;
    }

    setActionError(null);
    setSuccessMessage(null);
    setFormError(null);
    setEditingPickup(null);
    setConfirmTarget(pickup);
    setModalMode('ARCHIVE');
  }, []);

  const notifyParentMutationSafely = useCallback(async (reqSession: string, reqChildId: string): Promise<void> => {
    const callback = onPickupsMutatedRef.current;
    if (!callback || !mountedRef.current || activeSessionKeyRef.current !== reqSession) {
      return;
    }
    try {
      await callback(reqChildId);
    } catch (callbackErr) {
      // Isolate parent refresh callback failure so a committed backend mutation is never
      // misrepresented as failed or left with an unhandled rejection; log non-PII reason only.
      console.error(
        '[ResidentAuthorizedPickupsSection] Post-mutation summary refresh failed:',
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
            'Your pickup update was saved, but the household summary could not be refreshed. Use Refresh to sync.',
          isRetryable: true,
        });
      }
    }
  }, []);

  const submitAddPickup = useCallback(async (): Promise<boolean> => {
    if (mutationInFlightRef.current) return false;
    const reqChildId = activeChildIdRef.current;
    const reqSession = activeSessionKeyRef.current;
    if (!reqSession || !reqChildId) return false;

    if (!getResidentChildSafetyPermissions(currentUserRef.current?.role).canManagePickups) {
      setFormError('Your account role is not authorized to add pickup escorts.');
      return false;
    }
    if (isSelectedChildArchived()) {
      setFormError('Cannot add an authorized escort to an archived child profile.');
      return false;
    }

    const form = addFormRef.current;
    const input: ResidentCreatePickupFormInput = {
      name: form.name,
      phone: form.phone,
      relationship: form.relationship,
      idDocumentType: form.idDocumentType || null,
      idDocumentLast4: form.idDocumentLast4 || null,
      validUntil: form.validUntil || null,
      notes: form.notes || null,
    };

    const built = buildCreateAuthorizedPickupPayload(input);
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
      const created = await childSafetyService.addAuthorizedPickup(reqChildId, built.value);
      if (
        !mountedRef.current ||
        mutationSeqRef.current !== reqMutationSeq ||
        activeSessionKeyRef.current !== reqSession ||
        activeChildIdRef.current !== reqChildId
      ) {
        return false;
      }
      setModalMode(null);
      setAddForm(createEmptyAddForm());
      setSuccessMessage(`Authorized escort "${created.name}" added and synced with society security.`);
      await loadPickups();
      await notifyParentMutationSafely(reqSession, reqChildId);
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
        setPickups([]);
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
  }, [loadPickups, notifyParentMutationSafely]);

  const submitEditPickup = useCallback(async (): Promise<boolean> => {
    if (mutationInFlightRef.current) return false;
    const reqChildId = activeChildIdRef.current;
    const reqSession = activeSessionKeyRef.current;
    const target = editingPickupRef.current;
    if (!reqSession || !reqChildId || !target || target.childId !== reqChildId) return false;

    if (!getResidentChildSafetyPermissions(currentUserRef.current?.role).canManagePickups) {
      setFormError('Your account role is not authorized to update pickup escorts.');
      return false;
    }

    const form = editFormRef.current;
    const trimmedValidUntil = form.validUntil.trim();
    const validUntilChanged = form.clearValidUntil || trimmedValidUntil !== form.initialValidUntil;
    const targetDisplay = formatAuthorizedPickupDisplay(target);

    // F-P43-01: Expired pickups (persisted EXPIRED or time-expired ACTIVE) cannot clear validUntil.
    // Renewal strictly requires a valid future expiry timestamp.
    if (targetDisplay.effectiveStatus === 'EXPIRED' && form.clearValidUntil) {
      setFormError(
        'Expired pickup authorizations cannot remove their expiry limit. Provide a valid future expiry date to renew.'
      );
      return false;
    }

    // Strictly build ONLY backend PATCH-supported fields (`name`, `phone`, `relationship`, `validUntil`, `status`).
    // Never send `idDocumentType`, `idDocumentLast4`, `photoUrl`, or `notes`.
    const input: ResidentUpdatePickupFormInput = {
      name: form.name,
      phone: form.phone,
      relationship: form.relationship,
    };

    if (form.clearValidUntil) {
      input.validUntil = null;
    } else if (validUntilChanged && trimmedValidUntil.length > 0) {
      input.validUntil = trimmedValidUntil;
      // Backend `router.ts#L2406-L2423`: renewing an expired pickup requires status='ACTIVE' + future validUntil
      if (targetDisplay.effectiveStatus === 'EXPIRED') {
        input.status = 'ACTIVE';
      }
    }

    const built = buildUpdateAuthorizedPickupPayload(input);
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
      const updated = await childSafetyService.updateAuthorizedPickup(reqChildId, target.id, built.value);
      if (
        !mountedRef.current ||
        mutationSeqRef.current !== reqMutationSeq ||
        activeSessionKeyRef.current !== reqSession ||
        activeChildIdRef.current !== reqChildId
      ) {
        return false;
      }
      setModalMode(null);
      setEditingPickup(null);
      setSuccessMessage(`Updated authorized escort "${updated.name}".`);
      await loadPickups();
      await notifyParentMutationSafely(reqSession, reqChildId);
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
        setPickups([]);
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
  }, [loadPickups, notifyParentMutationSafely]);

  const confirmRevokePickup = useCallback(async (): Promise<boolean> => {
    if (mutationInFlightRef.current) return false;
    const reqChildId = activeChildIdRef.current;
    const reqSession = activeSessionKeyRef.current;
    const target = confirmTargetRef.current;
    if (!reqSession || !reqChildId || !target || target.childId !== reqChildId) return false;

    if (!getResidentChildSafetyPermissions(currentUserRef.current?.role).canManagePickups) {
      setFormError('Your account role is not authorized to revoke pickup escorts.');
      return false;
    }

    const reqMutationSeq = ++mutationSeqRef.current;
    mutationInFlightRef.current = true;
    setIsSubmitting(true);
    setFormError(null);
    setActionError(null);

    try {
      const revoked = await childSafetyService.revokeAuthorizedPickup(reqChildId, target.id);
      if (
        !mountedRef.current ||
        mutationSeqRef.current !== reqMutationSeq ||
        activeSessionKeyRef.current !== reqSession ||
        activeChildIdRef.current !== reqChildId
      ) {
        return false;
      }
      setModalMode(null);
      setConfirmTarget(null);
      setSuccessMessage(
        `Pickup authorization for "${revoked.name}" revoked. Any active gate passes for this escort were invalidated.`
      );
      await loadPickups();
      await notifyParentMutationSafely(reqSession, reqChildId);
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
        setPickups([]);
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
  }, [loadPickups, notifyParentMutationSafely]);

  const confirmArchivePickup = useCallback(async (): Promise<boolean> => {
    if (mutationInFlightRef.current) return false;
    const reqChildId = activeChildIdRef.current;
    const reqSession = activeSessionKeyRef.current;
    const target = confirmTargetRef.current;
    if (!reqSession || !reqChildId || !target || target.childId !== reqChildId) return false;

    if (!getResidentChildSafetyPermissions(currentUserRef.current?.role).canManagePickups) {
      setFormError('Your account role is not authorized to archive pickup escorts.');
      return false;
    }

    const reqMutationSeq = ++mutationSeqRef.current;
    mutationInFlightRef.current = true;
    setIsSubmitting(true);
    setFormError(null);
    setActionError(null);

    try {
      const archived = await childSafetyService.archiveAuthorizedPickup(reqChildId, target.id);
      if (
        !mountedRef.current ||
        mutationSeqRef.current !== reqMutationSeq ||
        activeSessionKeyRef.current !== reqSession ||
        activeChildIdRef.current !== reqChildId
      ) {
        return false;
      }
      setModalMode(null);
      setConfirmTarget(null);
      setSuccessMessage(
        `Pickup authorization for "${archived.name}" archived. Any active gate passes for this escort were invalidated.`
      );
      await loadPickups();
      await notifyParentMutationSafely(reqSession, reqChildId);
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
        setPickups([]);
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
  }, [loadPickups, notifyParentMutationSafely]);

  return {
    selectedChildId: normalizedChildId,
    pickups,
    isLoading,
    isSubmitting,
    loadError,
    actionError,
    formError,
    successMessage,
    modalMode,
    editingPickup,
    confirmTarget,
    addForm,
    editForm,
    permissions,
    loadPickups,
    openAddModal,
    openEditModal,
    openRevokeModal,
    openArchiveModal,
    closeModal,
    setAddFormField,
    setEditFormField,
    submitAddPickup,
    submitEditPickup,
    confirmRevokePickup,
    confirmArchivePickup,
    clearBanners,
  };
}

export const ResidentAuthorizedPickupsSection: React.FC<ResidentAuthorizedPickupsSectionProps> = ({
  childrenList,
  selectedChildId,
  onSelectChild,
  currentUser,
  refreshNonce = 0,
  onPickupsMutated,
}) => {
  const selectedChild = childrenList.find((c) => c.id === selectedChildId) ?? null;
  const ctrl = useResidentAuthorizedPickups(
    currentUser,
    selectedChild?.id ?? null,
    selectedChild,
    onPickupsMutated,
    refreshNonce
  );

  if (!currentUser || !ctrl.permissions.canManagePickups) {
    return null;
  }

  if (childrenList.length === 0) {
    return null;
  }

  const selectedChildArchived = Boolean(selectedChild && (selectedChild.status === 'ARCHIVED' || selectedChild.archivedAt));
  const editingDisplay = ctrl.editingPickup ? formatAuthorizedPickupDisplay(ctrl.editingPickup) : null;

  return (
    <section
      aria-label="Authorized Pickup Management"
      data-testid="resident-authorized-pickups-section"
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
            <ShieldCheck size={20} />
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
              AUTHORIZED PICKUP ESCORTS
            </h4>
            <p
              style={{
                fontSize: '0.75rem',
                color: 'var(--aarizo-text-secondary, #657785)',
                margin: '0.15rem 0 0',
              }}
            >
              {selectedChild
                ? `Verified pickup escorts authorized for ${selectedChild.fullName} (Flat ${selectedChild.flatNumber}).`
                : 'Select a child profile to view and manage authorized pickup escorts.'}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {selectedChild && (
            <button
              type="button"
              onClick={() => void ctrl.loadPickups()}
              disabled={ctrl.isLoading || ctrl.isSubmitting}
              aria-label="Refresh authorized pickups"
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
                cursor: ctrl.isLoading || ctrl.isSubmitting ? 'not-allowed' : 'pointer',
              }}
            >
              <RefreshCw size={13} className={ctrl.isLoading ? 'animate-spin' : undefined} />
              <span>Refresh</span>
            </button>
          )}

          {selectedChild && !selectedChildArchived && (
            <button
              type="button"
              data-testid="add-authorized-pickup-btn"
              onClick={ctrl.openAddModal}
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
              <UserPlus size={14} />
              <span>Add Authorized Pickup</span>
            </button>
          )}
        </div>
      </div>

      {/* Multi-Child Selector Strip */}
      <div
        role="tablist"
        aria-label="Select child for authorized pickups"
        style={{
          display: 'flex',
          gap: '0.5rem',
          flexWrap: 'wrap',
          paddingBottom: '0.5rem',
          borderBottom: '1px solid var(--aarizo-border-soft, #E8F1F5)',
        }}
      >
        {childrenList.map((child) => {
          const isSelected = child.id === selectedChild?.id;
          return (
            <button
              key={child.id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              data-testid={`pickup-child-tab-${child.id}`}
              onClick={() => onSelectChild(child.id)}
              disabled={ctrl.isSubmitting}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.4rem 0.75rem',
                borderRadius: '9999px',
                border: isSelected ? '1px solid var(--aarizo-navy, #083B56)' : '1px solid var(--aarizo-border, #DCE8EF)',
                background: isSelected ? 'var(--aarizo-navy, #083B56)' : '#F8FAFC',
                color: isSelected ? '#FFFFFF' : 'var(--aarizo-text, #203746)',
                fontWeight: 700,
                fontSize: '0.75rem',
                cursor: ctrl.isSubmitting ? 'not-allowed' : 'pointer',
              }}
            >
              <Users size={13} />
              <span>{child.fullName}</span>
            </button>
          );
        })}
      </div>

      {/* Success Banner */}
      {ctrl.successMessage && (
        <div
          role="status"
          data-testid="pickup-success-banner"
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
            aria-label="Dismiss pickup success notice"
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
          data-testid="pickup-action-error"
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
            aria-label="Dismiss pickup error notice"
            style={{ background: 'transparent', border: 'none', color: '#991B1B', cursor: 'pointer', padding: '0.15rem' }}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* No Selected Child Prompt */}
      {!selectedChild && (
        <div
          data-testid="pickup-select-child-prompt"
          style={{
            padding: '1.25rem',
            borderRadius: '12px',
            background: '#F8FAFC',
            border: '1px dashed #CBD5E1',
            textAlign: 'center',
            fontSize: '0.8rem',
            color: '#64748B',
            fontWeight: 600,
          }}
        >
          Select one of your registered children above to view or manage their authorized pickup escorts.
        </div>
      )}

      {/* Loading State */}
      {selectedChild && ctrl.isLoading && (
        <div
          data-testid="pickup-loading-state"
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
          <span>Loading authorized pickup escorts for {selectedChild.fullName}...</span>
        </div>
      )}

      {/* Load Error State with Retry */}
      {selectedChild && !ctrl.isLoading && ctrl.loadError && (
        <div
          role="alert"
          data-testid="pickup-load-error"
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
              onClick={() => void ctrl.loadPickups()}
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
      {selectedChild && !ctrl.isLoading && !ctrl.loadError && ctrl.pickups.length === 0 && (
        <div
          data-testid="pickup-empty-state"
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
          <ShieldCheck size={24} color="var(--aarizo-navy, #083B56)" />
          <strong style={{ fontSize: '0.875rem', color: 'var(--aarizo-navy, #083B56)' }}>
            No Authorized Pickups for {selectedChild.fullName}
          </strong>
          <p style={{ margin: 0, fontSize: '0.76rem', color: '#64748B', maxWidth: '420px', lineHeight: 1.45 }}>
            Add trusted family members, nannies, or school transport escorts so gate security can verify authorized
            pickups.
          </p>
          {!selectedChildArchived && (
            <button
              type="button"
              onClick={ctrl.openAddModal}
              style={{
                marginTop: '0.25rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.48rem 0.9rem',
                borderRadius: '9px',
                background: 'var(--aarizo-coral, #F06543)',
                color: '#FFFFFF',
                fontWeight: 800,
                fontSize: '0.75rem',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              <UserPlus size={14} />
              <span>Add First Authorized Pickup</span>
            </button>
          )}
        </div>
      )}

      {/* Verified Backend Pickup Cards */}
      {selectedChild && ctrl.loadError?.kind !== 'UNAUTHORIZED' && ctrl.pickups.length > 0 && (
        <div
          data-testid="pickup-list"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '0.875rem' }}
        >
          {ctrl.pickups.map((pickupDto) => {
            const view = formatAuthorizedPickupDisplay(pickupDto);
            const statusStyle = getPickupStatusBadgeStyle(view.effectiveStatus);

            return (
              <div
                key={view.id}
                data-testid={`pickup-card-${view.id}`}
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
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <span
                      data-testid={`pickup-status-${view.id}`}
                      style={{
                        fontSize: '0.625rem',
                        fontWeight: 800,
                        color: statusStyle.color,
                        background: statusStyle.bg,
                        border: `1px solid ${statusStyle.border}`,
                        padding: '0.18rem 0.5rem',
                        borderRadius: '9999px',
                        textTransform: 'uppercase',
                      }}
                    >
                      {view.statusLabel}
                    </span>

                    <span
                      style={{
                        fontSize: '0.625rem',
                        fontWeight: 700,
                        color: '#475569',
                        background: '#F1F5F9',
                        border: '1px solid #E2E8F0',
                        padding: '0.18rem 0.45rem',
                        borderRadius: '9999px',
                      }}
                    >
                      {view.verificationLabel}
                    </span>
                  </div>

                  <div>
                    <h5
                      style={{
                        margin: 0,
                        fontSize: '0.92rem',
                        fontWeight: 800,
                        color: 'var(--aarizo-text, #203746)',
                        wordBreak: 'break-word',
                      }}
                    >
                      {view.name}
                    </h5>
                    <p style={{ margin: '0.15rem 0 0', fontSize: '0.75rem', color: '#475569', fontWeight: 600 }}>
                      {view.relationship}
                    </p>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.74rem', color: '#334155' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Phone size={13} color="#176B91" />
                      {view.phone}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                      <IdCard size={13} color="#176B91" />
                      {view.maskedIdLabel}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                      <CalendarClock size={13} color="#176B91" />
                      Valid Until: {formatValidUntilDisplay(view.validUntil)}
                    </span>
                  </div>

                  {view.notes && (
                    <p
                      style={{
                        margin: '0.2rem 0 0',
                        padding: '0.45rem 0.6rem',
                        borderRadius: '8px',
                        background: '#F8FAFC',
                        border: '1px solid #E2E8F0',
                        fontSize: '0.72rem',
                        color: '#475569',
                        lineHeight: 1.4,
                      }}
                    >
                      Notes: {view.notes}
                    </p>
                  )}
                </div>

                {/* Action Row */}
                {(view.canEdit || view.canRevoke || view.canArchive) && (
                  <div
                    style={{
                      display: 'flex',
                      gap: '0.45rem',
                      paddingTop: '0.65rem',
                      borderTop: '1px solid var(--aarizo-border-soft, #E8F1F5)',
                      flexWrap: 'wrap',
                    }}
                  >
                    {view.canEdit && (
                      <button
                        type="button"
                        data-testid={`edit-pickup-btn-${view.id}`}
                        onClick={() => ctrl.openEditModal(pickupDto)}
                        disabled={ctrl.isSubmitting}
                        style={{
                          flex: 1,
                          padding: '0.45rem 0.65rem',
                          borderRadius: '9px',
                          background: 'var(--aarizo-light-blue, #EAF6FC)',
                          border: '1px solid var(--aarizo-border, #DCE8EF)',
                          color: 'var(--aarizo-navy, #083B56)',
                          fontWeight: 800,
                          fontSize: '0.72rem',
                          cursor: ctrl.isSubmitting ? 'not-allowed' : 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.3rem',
                        }}
                      >
                        <Edit3 size={13} />
                        <span>Edit</span>
                      </button>
                    )}

                    {view.canRevoke && (
                      <button
                        type="button"
                        data-testid={`revoke-pickup-btn-${view.id}`}
                        onClick={() => ctrl.openRevokeModal(pickupDto)}
                        disabled={ctrl.isSubmitting}
                        style={{
                          flex: 1,
                          padding: '0.45rem 0.65rem',
                          borderRadius: '9px',
                          background: '#FFFFFF',
                          border: '1px solid #FECACA',
                          color: '#DC2626',
                          fontWeight: 800,
                          fontSize: '0.72rem',
                          cursor: ctrl.isSubmitting ? 'not-allowed' : 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.3rem',
                        }}
                      >
                        <Ban size={13} />
                        <span>Revoke</span>
                      </button>
                    )}

                    {view.canArchive && (
                      <button
                        type="button"
                        data-testid={`archive-pickup-btn-${view.id}`}
                        onClick={() => ctrl.openArchiveModal(pickupDto)}
                        disabled={ctrl.isSubmitting}
                        style={{
                          padding: '0.45rem 0.65rem',
                          borderRadius: '9px',
                          background: '#F8FAFC',
                          border: '1px solid #CBD5E1',
                          color: '#475569',
                          fontWeight: 700,
                          fontSize: '0.72rem',
                          cursor: ctrl.isSubmitting ? 'not-allowed' : 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.3rem',
                        }}
                      >
                        <Archive size={13} />
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

      {/* Modal: Add Authorized Pickup */}
      <Modal
        isOpen={ctrl.modalMode === 'ADD'}
        onClose={ctrl.closeModal}
        title="Add Authorized Pickup Escort"
        subtitle={
          selectedChild
            ? `Authorizing pickup escort for ${selectedChild.fullName} (Flat ${selectedChild.flatNumber})`
            : 'Authorize a trusted pickup escort'
        }
        icon={<UserPlus size={20} />}
        maxWidth="520px"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ctrl.submitAddPickup();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
        >
          {ctrl.formError && (
            <div
              role="alert"
              data-testid="pickup-form-error"
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

          <div>
            <label htmlFor="pickup-add-name" style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}>
              Escort Full Name *
            </label>
            <input
              id="pickup-add-name"
              type="text"
              required
              maxLength={200}
              disabled={ctrl.isSubmitting}
              placeholder="e.g., Sunita Devi"
              value={ctrl.addForm.name}
              onChange={(e) => ctrl.setAddFormField('name', e.target.value)}
              style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label htmlFor="pickup-add-phone" style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}>
                Phone Number *
              </label>
              <input
                id="pickup-add-phone"
                type="tel"
                required
                maxLength={32}
                disabled={ctrl.isSubmitting}
                placeholder="+91..."
                value={ctrl.addForm.phone}
                onChange={(e) => ctrl.setAddFormField('phone', e.target.value)}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
              />
            </div>

            <div>
              <label htmlFor="pickup-add-relationship" style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}>
                Relationship *
              </label>
              <input
                id="pickup-add-relationship"
                type="text"
                required
                maxLength={100}
                disabled={ctrl.isSubmitting}
                placeholder="e.g., Grandmother, Nanny"
                value={ctrl.addForm.relationship}
                onChange={(e) => ctrl.setAddFormField('relationship', e.target.value)}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label htmlFor="pickup-add-id-type" style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}>
                ID Document Type (Optional)
              </label>
              <select
                id="pickup-add-id-type"
                disabled={ctrl.isSubmitting}
                value={ctrl.addForm.idDocumentType}
                onChange={(e) => ctrl.setAddFormField('idDocumentType', e.target.value)}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem', background: '#FFFFFF' }}
              >
                {ID_DOCUMENT_TYPE_OPTIONS.map((opt) => (
                  <option key={opt || 'none'} value={opt}>
                    {opt || 'Not Collected'}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="pickup-add-id-last4" style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}>
                ID Last 4 Characters Only (Optional)
              </label>
              <input
                id="pickup-add-id-last4"
                type="text"
                maxLength={4}
                disabled={ctrl.isSubmitting}
                placeholder="e.g., 4589"
                value={ctrl.addForm.idDocumentLast4}
                onChange={(e) => ctrl.setAddFormField('idDocumentLast4', e.target.value)}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
              />
              <span style={{ fontSize: '0.68rem', color: '#64748B', display: 'block', marginTop: '0.2rem' }}>
                Never enter a full Aadhaar, PAN, or government ID number.
              </span>
            </div>
          </div>

          <div>
            <label htmlFor="pickup-add-valid-until" style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}>
              Authorization Valid Until (Optional)
            </label>
            <input
              id="pickup-add-valid-until"
              type="datetime-local"
              disabled={ctrl.isSubmitting}
              value={ctrl.addForm.validUntil}
              onChange={(e) => ctrl.setAddFormField('validUntil', e.target.value)}
              style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
            />
          </div>

          <div>
            <label htmlFor="pickup-add-notes" style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}>
              Notes for Gate Security (Optional)
            </label>
            <textarea
              id="pickup-add-notes"
              rows={2}
              maxLength={500}
              disabled={ctrl.isSubmitting}
              placeholder="e.g., Picks up from school bus stop on weekdays"
              value={ctrl.addForm.notes}
              onChange={(e) => ctrl.setAddFormField('notes', e.target.value)}
              style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem', resize: 'vertical' }}
            />
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
              data-testid="submit-add-pickup-btn"
              disabled={ctrl.isSubmitting}
              style={{
                flex: 1,
                padding: '0.6rem',
                borderRadius: '10px',
                border: 'none',
                background: 'var(--aarizo-coral, #F06543)',
                color: '#FFFFFF',
                fontWeight: 800,
                fontSize: '0.84rem',
                cursor: ctrl.isSubmitting ? 'not-allowed' : 'pointer',
              }}
            >
              {ctrl.isSubmitting ? 'Saving...' : 'Authorize Escort'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Edit Authorized Pickup (Strictly backend PATCH-supported fields ONLY) */}
      <Modal
        isOpen={ctrl.modalMode === 'EDIT' && Boolean(ctrl.editingPickup)}
        onClose={ctrl.closeModal}
        title="Edit Authorized Pickup"
        subtitle="Update contact details or authorization validity"
        icon={<Edit3 size={20} />}
        maxWidth="500px"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ctrl.submitEditPickup();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
        >
          {ctrl.formError && (
            <div
              role="alert"
              data-testid="pickup-edit-form-error"
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

          {/* Read-Only Preserved Metadata Notice */}
          {editingDisplay && (
            <div
              style={{
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: '10px',
                padding: '0.65rem 0.8rem',
                fontSize: '0.74rem',
                color: '#475569',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.25rem',
              }}
            >
              <strong style={{ color: '#083B56' }}>Preserved Record Metadata (Read-Only)</strong>
              <span>
                ID Verification: {editingDisplay.maskedIdLabel} ({editingDisplay.verificationLabel})
              </span>
              {editingDisplay.notes && <span>Notes: {editingDisplay.notes}</span>}
              <span style={{ fontSize: '0.69rem', color: '#64748B' }}>
                ID document metadata and notes are preserved automatically and are not editable here. To replace ID
                metadata, revoke this entry and add a new escort.
              </span>
            </div>
          )}

          <div>
            <label htmlFor="pickup-edit-name" style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}>
              Escort Full Name *
            </label>
            <input
              id="pickup-edit-name"
              type="text"
              required
              maxLength={200}
              disabled={ctrl.isSubmitting}
              value={ctrl.editForm.name}
              onChange={(e) => ctrl.setEditFormField('name', e.target.value)}
              style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label htmlFor="pickup-edit-phone" style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}>
                Phone Number *
              </label>
              <input
                id="pickup-edit-phone"
                type="tel"
                required
                maxLength={32}
                disabled={ctrl.isSubmitting}
                value={ctrl.editForm.phone}
                onChange={(e) => ctrl.setEditFormField('phone', e.target.value)}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
              />
            </div>

            <div>
              <label htmlFor="pickup-edit-relationship" style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}>
                Relationship *
              </label>
              <input
                id="pickup-edit-relationship"
                type="text"
                required
                maxLength={100}
                disabled={ctrl.isSubmitting}
                value={ctrl.editForm.relationship}
                onChange={(e) => ctrl.setEditFormField('relationship', e.target.value)}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
              />
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
              <label htmlFor="pickup-edit-valid-until" style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155' }}>
                Authorization Valid Until
              </label>
              {editingDisplay?.effectiveStatus !== 'EXPIRED' &&
                !ctrl.editForm.clearValidUntil &&
                (ctrl.editForm.validUntil || ctrl.editForm.initialValidUntil) && (
                  <button
                    type="button"
                    data-testid="remove-expiry-limit-btn"
                    onClick={() => ctrl.setEditFormField('clearValidUntil', true)}
                    disabled={ctrl.isSubmitting}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#176B91',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Remove Expiry Limit
                  </button>
                )}
            </div>
            <input
              id="pickup-edit-valid-until"
              type="datetime-local"
              disabled={ctrl.isSubmitting}
              value={ctrl.editForm.validUntil}
              onChange={(e) => ctrl.setEditFormField('validUntil', e.target.value)}
              style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
            />
            {editingDisplay?.effectiveStatus === 'EXPIRED' && (
              <span style={{ fontSize: '0.69rem', color: '#B45309', display: 'block', marginTop: '0.25rem', fontWeight: 600 }}>
                This authorization has expired. Set a new future expiry date to renew it.
              </span>
            )}
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
              data-testid="submit-edit-pickup-btn"
              disabled={ctrl.isSubmitting}
              style={{
                flex: 1,
                padding: '0.6rem',
                borderRadius: '10px',
                border: 'none',
                background: 'var(--aarizo-navy, #083B56)',
                color: '#FFFFFF',
                fontWeight: 800,
                fontSize: '0.84rem',
                cursor: ctrl.isSubmitting ? 'not-allowed' : 'pointer',
              }}
            >
              {ctrl.isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Confirm Revoke Authorized Pickup */}
      <Modal
        isOpen={ctrl.modalMode === 'REVOKE' && Boolean(ctrl.confirmTarget)}
        onClose={ctrl.closeModal}
        title="Revoke Pickup Authorization"
        subtitle="Immediate security revocation confirmation"
        icon={<ShieldAlert size={20} color="#DC2626" />}
        maxWidth="460px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          {ctrl.formError && (
            <div
              role="alert"
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
            Revoke pickup authorization for <strong>{ctrl.confirmTarget?.name}</strong> (
            {ctrl.confirmTarget?.relationship})?
          </p>
          <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748B', lineHeight: 1.45 }}>
            Gate security will immediately block pickup by this escort, and any active gate passes issued to them will
            be revoked. Revoked authorizations cannot be reactivated — you will need to add a new pickup entry if
            needed later.
          </p>

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
              Keep Authorized
            </button>
            <button
              type="button"
              data-testid="confirm-revoke-pickup-btn"
              onClick={() => void ctrl.confirmRevokePickup()}
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

      {/* Modal: Confirm Archive Authorized Pickup */}
      <Modal
        isOpen={ctrl.modalMode === 'ARCHIVE' && Boolean(ctrl.confirmTarget)}
        onClose={ctrl.closeModal}
        title="Archive Pickup Record"
        subtitle="Permanent archive confirmation"
        icon={<Archive size={20} color="#475569" />}
        maxWidth="460px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          {ctrl.formError && (
            <div
              role="alert"
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
            Archive pickup authorization for <strong>{ctrl.confirmTarget?.name}</strong>?
          </p>
          <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748B', lineHeight: 1.45 }}>
            Archiving preserves audit history while permanently deactivating this escort and revoking any active gate
            passes linked to them.
          </p>

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
              Cancel
            </button>
            <button
              type="button"
              data-testid="confirm-archive-pickup-btn"
              onClick={() => void ctrl.confirmArchivePickup()}
              disabled={ctrl.isSubmitting}
              style={{
                flex: 1,
                padding: '0.6rem',
                borderRadius: '10px',
                border: 'none',
                background: '#334155',
                color: '#FFFFFF',
                fontWeight: 800,
                fontSize: '0.84rem',
                cursor: ctrl.isSubmitting ? 'not-allowed' : 'pointer',
              }}
            >
              {ctrl.isSubmitting ? 'Archiving...' : 'Confirm Archive'}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
};
