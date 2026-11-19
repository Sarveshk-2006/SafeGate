// =============================================================================
// AARIZO — ISSUE-06 Phase B.2.3 (Phase 4.5):
// Resident Child Safety SOS & Missing Child Alert Modal
//
// Authoritative invariants:
// - Backed strictly by canonical `childSafetyService.triggerSos()` (POST /api/children/sos).
// - Validates inputs with Phase 4.1 pure helper `buildResidentTriggerSosPayload()`.
// - Residents NEVER submit `societyId`, `residentId`, or `guardianUserId`;
//   backend derives ownership and tenant boundaries strictly from verified JWT.
// - Requires selecting an owned child profile (`childId`) and non-empty `location`.
// - Synchronous in-flight mutation lock (`mutationInFlightRef`) prevents duplicate submits.
// - Awaits server 201 before clearing form and calling `onSosDispatched`.
//   ZERO fake success banners or dispatched states before server confirmation!
// - Handles HTTP 409 `DUPLICATE_ACTIVE_SOS_ALERT` gracefully without fake success.
// - Purges form state and ephemeral inputs on close, unmount, and session switch.
// - Zero localStorage/sessionStorage persistence.
// =============================================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Loader2,
  MapPin,
  Radio,
  ShieldAlert,
} from 'lucide-react';
import type { UserProfile } from '../../auth/types';
import {
  childSafetyService,
  formatChildSafetyError,
} from '../../../services/childSafetyService';
import type {
  ChildAlertTypeDto,
  ChildProfileDto,
  ChildSafetyAlertDto,
  IncidentSeverityDto,
} from '../../../types/childSafety';
import { Modal } from '../../../components/ui/Modal';
import {
  buildResidentTriggerSosPayload,
  formatChildProfileDisplay,
  getResidentChildSafetyPermissions,
  type ResidentTriggerSosFormInput,
} from '../utils/childSafetyResidentHelpers';

export interface ResidentChildSosModalProps {
  isOpen: boolean;
  onClose: () => void;
  childrenList?: ChildProfileDto[];
  preselectedChildId?: string | null;
  currentUser: UserProfile | null;
  onSosDispatched?: (alert: ChildSafetyAlertDto) => void | Promise<void>;
}

export interface ChildSosFormState {
  childId: string;
  alertType: ChildAlertTypeDto;
  severity: IncidentSeverityDto;
  location: string;
  lastSeenDetails: string;
  description: string;
}

const DEFAULT_FORM_STATE: ChildSosFormState = {
  childId: '',
  alertType: 'MISSING_CHILD',
  severity: 'CRITICAL',
  location: '',
  lastSeenDetails: '',
  description: '',
};

function getSessionKey(user: UserProfile | null): string {
  if (!user) return '';
  const uid = user.id || (user as { uid?: string }).uid || '';
  if (!uid) return '';
  const soc = typeof user.societyId === 'string' ? user.societyId.trim() : '';
  const role = typeof user.role === 'string' ? user.role.trim().toLowerCase() : '';
  return `${uid}:${soc}:${role}`;
}

export const ResidentChildSosModal: React.FC<ResidentChildSosModalProps> = ({
  isOpen,
  onClose,
  childrenList: externalChildren,
  preselectedChildId,
  currentUser,
  onSosDispatched,
}) => {
  const sessionKey = getSessionKey(currentUser);
  const permissions = getResidentChildSafetyPermissions(currentUser?.role);

  const [form, setForm] = useState<ChildSosFormState>(() => ({
    ...DEFAULT_FORM_STATE,
    childId: preselectedChildId || '',
  }));
  const [internalChildren, setInternalChildren] = useState<ChildProfileDto[]>([]);
  const [isLoadingChildren, setIsLoadingChildren] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicateAlertNotice, setDuplicateAlertNotice] = useState<string | null>(null);

  // Guards for unmount, in-flight mutation lock, and monotonic sequence
  const mountedRef = useRef<boolean>(true);
  const mutationInFlightRef = useRef<boolean>(false);
  const mutationSeqRef = useRef<number>(0);
  const activeSessionKeyRef = useRef<string>(sessionKey);
  const onSosDispatchedRef = useRef(onSosDispatched);
  const formRef = useRef(form);

  activeSessionKeyRef.current = sessionKey;
  onSosDispatchedRef.current = onSosDispatched;
  formRef.current = form;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      mutationSeqRef.current += 1;
      mutationInFlightRef.current = false;
    };
  }, []);

  // Fetch children list authoritatively if not provided by parent
  useEffect(() => {
    if (!isOpen || !sessionKey || !permissions.canTriggerChildSos) return;
    if (externalChildren && externalChildren.length > 0) {
      setInternalChildren(externalChildren);
      return;
    }

    let isLocalMount = true;
    setIsLoadingChildren(true);
    childSafetyService
      .listChildren()
      .then((records) => {
        if (isLocalMount && mountedRef.current) {
          setInternalChildren(records);
          setIsLoadingChildren(false);
        }
      })
      .catch((err) => {
        if (isLocalMount && mountedRef.current) {
          setIsLoadingChildren(false);
          setFormError(formatChildSafetyError(err).message);
        }
      });

    return () => {
      isLocalMount = false;
    };
  }, [isOpen, sessionKey, externalChildren, permissions.canTriggerChildSos]);

  // Sync effective children list
  const activeChildren = externalChildren && externalChildren.length > 0 ? externalChildren : internalChildren;

  // Initialize or reset form when modal opens or session switches
  useEffect(() => {
    if (!isOpen) {
      setForm({ ...DEFAULT_FORM_STATE });
      setFormError(null);
      setDuplicateAlertNotice(null);
      setIsSubmitting(false);
      mutationInFlightRef.current = false;
      return;
    }

    // Determine initial child selection
    let initialChildId = preselectedChildId || '';
    if (!initialChildId && activeChildren.length > 0) {
      const activeFirst = activeChildren.find((c) => c.status !== 'ARCHIVED');
      initialChildId = activeFirst ? activeFirst.id : activeChildren[0].id;
    }

    setForm({
      ...DEFAULT_FORM_STATE,
      childId: initialChildId,
    });
    setFormError(null);
    setDuplicateAlertNotice(null);
  }, [isOpen, preselectedChildId, activeChildren, sessionKey]);

  const updateField = useCallback(<K extends keyof ChildSosFormState>(field: K, value: ChildSosFormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFormError(null);
    setDuplicateAlertNotice(null);
  }, []);

  const handleClose = useCallback(() => {
    if (mutationInFlightRef.current) return;
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (mutationInFlightRef.current) return;

      const reqSession = activeSessionKeyRef.current;
      if (!reqSession) {
        setFormError('You must be signed in as an authorized resident to dispatch a Child Safety SOS.');
        return;
      }

      if (!permissions.canTriggerChildSos) {
        setFormError('Your account role is not authorized to trigger Child Safety SOS alerts.');
        return;
      }

      const currentForm = formRef.current;
      const targetChild = activeChildren.find((c) => c.id === currentForm.childId);
      if (!targetChild) {
        setFormError('Please select a registered child profile before dispatching an SOS alert.');
        return;
      }

      const childDisplay = formatChildProfileDisplay(targetChild);
      if (childDisplay.isArchived) {
        setFormError('Cannot trigger SOS for an archived child profile.');
        return;
      }

      const input: ResidentTriggerSosFormInput = {
        childId: currentForm.childId,
        location: currentForm.location,
        alertType: currentForm.alertType,
        severity: currentForm.severity,
        lastSeenDetails: currentForm.lastSeenDetails || null,
        description: currentForm.description || null,
      };

      const built = buildResidentTriggerSosPayload(input);
      if (!built.ok) {
        setFormError(built.error);
        return;
      }

      const reqSeq = ++mutationSeqRef.current;
      mutationInFlightRef.current = true;
      setIsSubmitting(true);
      setFormError(null);
      setDuplicateAlertNotice(null);

      try {
        const created = await childSafetyService.triggerSos(built.value);
        if (!mountedRef.current || mutationSeqRef.current !== reqSeq || activeSessionKeyRef.current !== reqSession) {
          return;
        }

        // Await callback safely
        const callback = onSosDispatchedRef.current;
        if (callback) {
          try {
            await callback(created.alert);
          } catch (callbackErr) {
            console.error(
              '[ResidentChildSosModal] Post-dispatch callback failed:',
              callbackErr instanceof Error ? callbackErr.message : 'Callback failed'
            );
          }
        }

        handleClose();
      } catch (err: any) {
        if (!mountedRef.current || mutationSeqRef.current !== reqSeq || activeSessionKeyRef.current !== reqSession) {
          return;
        }

        const formatted = formatChildSafetyError(err);
        // Handle 409 DUPLICATE_ACTIVE_SOS_ALERT gracefully
        if (formatted.code === 'DUPLICATE_ACTIVE_SOS_ALERT' || (err && err.status === 409)) {
          setDuplicateAlertNotice(
            `An active emergency alert is already active for this child. Society security and gate terminals are currently responding.`
          );
        } else {
          setFormError(formatted.message);
        }
      } finally {
        if (mutationSeqRef.current === reqSeq) {
          mutationInFlightRef.current = false;
          if (mountedRef.current && activeSessionKeyRef.current === reqSession) {
            setIsSubmitting(false);
          }
        }
      }
    },
    [activeChildren, permissions.canTriggerChildSos, handleClose]
  );

  if (!isOpen || !currentUser || currentUser.role?.toLowerCase() !== 'resident') return null;

  const selectedChild = activeChildren.find((c) => c.id === form.childId);
  const selectedChildDisplay = selectedChild ? formatChildProfileDisplay(selectedChild) : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '1.05rem', fontWeight: 900, color: '#991B1B' }}>
            Dispatch Child Safety SOS Alarm
          </span>
          <span
            style={{
              fontSize: '0.625rem',
              fontWeight: 900,
              padding: '0.2rem 0.55rem',
              borderRadius: '6px',
              background: '#FEE2E2',
              color: '#DC2626',
              border: '1px solid #FCA5A5',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            HIGH PRIORITY
          </span>
        </div>
      }
      subtitle="Immediate perimeter notification & security gate terminal broadcast"
      icon={
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: '12px',
            background: '#FEE2E2',
            color: '#DC2626',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 0 3px rgba(220, 38, 38, 0.12)',
          }}
        >
          <ShieldAlert size={20} />
        </div>
      }
      maxWidth="500px"
    >
      <form
        onSubmit={handleSubmit}
        data-testid="resident-child-sos-form"
        style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}
      >
        {/* Protocol Notice Banner */}
        <div
          style={{
            background: 'linear-gradient(135deg, #FEF2F2 0%, #FFF1F2 100%)',
            border: '1px solid #FECDD3',
            borderRadius: '14px',
            padding: '0.75rem 0.9rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.3rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              color: '#B91C1C',
              fontWeight: 900,
              fontSize: '0.7rem',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            <Radio size={14} style={{ color: '#DC2626' }} />
            <span>Emergency Security Dispatch Protocol</span>
          </div>
          <p style={{ margin: 0, fontSize: '0.76rem', color: '#881337', fontWeight: 600, lineHeight: 1.45 }}>
            Triggering this SOS will immediately sound alerts on Security Gate Terminals and alert security mobile
            units. A high-priority incident is logged and perimeter exit gates verify child whereabouts.
          </p>
        </div>

        {/* Duplicate active alert notification (409) */}
        {duplicateAlertNotice && (
          <div
            role="alert"
            data-testid="duplicate-sos-alert-notice"
            style={{
              background: '#FFFBEB',
              border: '1px solid #FDE68A',
              borderRadius: '12px',
              padding: '0.75rem 0.9rem',
              color: '#92400E',
              fontSize: '0.78rem',
              fontWeight: 700,
              display: 'flex',
              gap: '0.5rem',
              alignItems: 'flex-start',
            }}
          >
            <AlertTriangle size={16} color="#D97706" style={{ flexShrink: 0, marginTop: '0.1rem' }} />
            <div>
              <strong style={{ display: 'block', marginBottom: '0.15rem' }}>Active SOS In Progress</strong>
              <span>{duplicateAlertNotice}</span>
            </div>
          </div>
        )}

        {/* Validation or API error banner */}
        {formError && !duplicateAlertNotice && (
          <div
            role="alert"
            data-testid="child-sos-form-error"
            style={{
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              borderRadius: '12px',
              padding: '0.7rem 0.9rem',
              color: '#991B1B',
              fontSize: '0.78rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
            }}
          >
            <AlertCircle size={15} color="#DC2626" style={{ flexShrink: 0 }} />
            <span>{formError}</span>
          </div>
        )}

        {/* 1. Child Selection */}
        <div>
          <label
            htmlFor="child-sos-select"
            style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}
          >
            Registered Child Profile *
          </label>
          <select
            id="child-sos-select"
            data-testid="child-sos-select"
            disabled={isSubmitting || isLoadingChildren || activeChildren.length === 0}
            value={form.childId}
            onChange={(e) => updateField('childId', e.target.value)}
            style={{
              width: '100%',
              padding: '0.6rem 0.8rem',
              borderRadius: '10px',
              border: '1px solid #CBD5E1',
              fontSize: '0.85rem',
              background: '#FFFFFF',
            }}
          >
            {activeChildren.length === 0 ? (
              <option value="">{isLoadingChildren ? 'Loading children...' : 'No registered children found'}</option>
            ) : (
              <>
                <option value="">Select child profile...</option>
                {activeChildren.map((child) => (
                  <option key={child.id} value={child.id} disabled={child.status === 'ARCHIVED'}>
                    {child.fullName} (Flat {child.flatNumber})
                    {child.status === 'MISSING' ? ' — ACTIVE MISSING' : ''}
                    {child.status === 'ARCHIVED' ? ' — (Archived)' : ''}
                  </option>
                ))}
              </>
            )}
          </select>
          {selectedChildDisplay?.isMissing && (
            <span
              style={{
                fontSize: '0.7rem',
                color: '#DC2626',
                display: 'block',
                marginTop: '0.25rem',
                fontWeight: 700,
              }}
            >
              Notice: This child currently has an active MISSING status in society records.
            </span>
          )}
        </div>

        {/* 2. Alert Type & Severity */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label
              htmlFor="child-sos-alert-type"
              style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}
            >
              Alert Category *
            </label>
            <select
              id="child-sos-alert-type"
              data-testid="child-sos-alert-type"
              disabled={isSubmitting}
              value={form.alertType}
              onChange={(e) => updateField('alertType', e.target.value as ChildAlertTypeDto)}
              style={{
                width: '100%',
                padding: '0.6rem 0.8rem',
                borderRadius: '10px',
                border: '1px solid #CBD5E1',
                fontSize: '0.85rem',
                background: '#FFFFFF',
              }}
            >
              <option value="MISSING_CHILD">Missing Child (Default)</option>
              <option value="EMERGENCY_SOS">Emergency Danger / SOS</option>
              <option value="UNATTENDED_CHILD">Unattended Child</option>
              <option value="UNAUTHORIZED_EXIT_ATTEMPT">Unauthorized Exit Attempt</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="child-sos-severity"
              style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}
            >
              Urgency Severity *
            </label>
            <select
              id="child-sos-severity"
              data-testid="child-sos-severity"
              disabled={isSubmitting}
              value={form.severity}
              onChange={(e) => updateField('severity', e.target.value as IncidentSeverityDto)}
              style={{
                width: '100%',
                padding: '0.6rem 0.8rem',
                borderRadius: '10px',
                border: '1px solid #CBD5E1',
                fontSize: '0.85rem',
                background: '#FFFFFF',
              }}
            >
              <option value="CRITICAL">Critical (Immediate siren & lockdown)</option>
              <option value="HIGH">High Priority</option>
              <option value="MEDIUM">Medium Priority</option>
              <option value="LOW">Low Priority</option>
            </select>
          </div>
        </div>

        {/* 3. Last Known Location (Required) */}
        <div>
          <label
            htmlFor="child-sos-location"
            style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}
          >
            Last Known Location *
          </label>
          <div style={{ position: 'relative' }}>
            <MapPin
              size={15}
              color="#64748B"
              style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)' }}
            />
            <input
              id="child-sos-location"
              data-testid="child-sos-location"
              type="text"
              required
              maxLength={255}
              disabled={isSubmitting}
              placeholder="e.g., Tower B Playground, Swimming Pool, Clubhouse"
              value={form.location}
              onChange={(e) => updateField('location', e.target.value)}
              style={{
                width: '100%',
                padding: '0.6rem 0.8rem 0.6rem 2.2rem',
                borderRadius: '10px',
                border: '1px solid #CBD5E1',
                fontSize: '0.85rem',
              }}
            />
          </div>
          <span style={{ fontSize: '0.68rem', color: '#64748B', display: 'block', marginTop: '0.2rem' }}>
            Where was the child last seen or suspected to be? (1–255 characters)
          </span>
        </div>

        {/* 4. Last Seen Details (Optional) */}
        <div>
          <label
            htmlFor="child-sos-last-seen"
            style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}
          >
            Last Seen Details (Clothing, Companions, Direction)
          </label>
          <textarea
            id="child-sos-last-seen"
            data-testid="child-sos-last-seen"
            maxLength={500}
            rows={2}
            disabled={isSubmitting}
            placeholder="e.g., Wearing blue shirt and jeans, red sneakers, last seen near cycle stand ~15 mins ago"
            value={form.lastSeenDetails}
            onChange={(e) => updateField('lastSeenDetails', e.target.value)}
            style={{
              width: '100%',
              padding: '0.55rem 0.8rem',
              borderRadius: '10px',
              border: '1px solid #CBD5E1',
              fontSize: '0.83rem',
              resize: 'vertical',
            }}
          />
        </div>

        {/* 5. Additional Description (Optional) */}
        <div>
          <label
            htmlFor="child-sos-description"
            style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}
          >
            Additional Details for Responders (Optional)
          </label>
          <textarea
            id="child-sos-description"
            data-testid="child-sos-description"
            maxLength={1000}
            rows={2}
            disabled={isSubmitting}
            placeholder="Any other helpful details, medical notes, or guard instructions..."
            value={form.description}
            onChange={(e) => updateField('description', e.target.value)}
            style={{
              width: '100%',
              padding: '0.55rem 0.8rem',
              borderRadius: '10px',
              border: '1px solid #CBD5E1',
              fontSize: '0.83rem',
              resize: 'vertical',
            }}
          />
        </div>

        {/* Action Buttons */}
        <div
          style={{
            display: 'flex',
            gap: '0.75rem',
            marginTop: '0.4rem',
            paddingTop: '0.75rem',
            borderTop: '1px solid #E2E8F0',
          }}
        >
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            style={{
              flex: 1,
              padding: '0.65rem',
              borderRadius: '10px',
              border: '1px solid #CBD5E1',
              background: '#FFFFFF',
              color: '#475569',
              fontWeight: 700,
              fontSize: '0.84rem',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            data-testid="submit-child-sos-btn"
            disabled={isSubmitting || activeChildren.length === 0 || !form.location.trim()}
            style={{
              flex: 1.5,
              padding: '0.65rem 1rem',
              borderRadius: '10px',
              border: 'none',
              background: 'linear-gradient(135deg, #DC2626 0%, #B91C1C 100%)',
              color: '#FFFFFF',
              fontWeight: 900,
              fontSize: '0.84rem',
              cursor: isSubmitting || activeChildren.length === 0 || !form.location.trim() ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.45rem',
              boxShadow: '0 4px 14px rgba(220, 38, 38, 0.35)',
            }}
          >
            {isSubmitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Broadcasting Alarm...</span>
              </>
            ) : (
              <>
                <ShieldAlert size={16} />
                <span>DISPATCH SOS ALARM NOW</span>
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
