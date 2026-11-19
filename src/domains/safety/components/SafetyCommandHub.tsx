import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Flame,
  Zap,
  Users,
  CheckCircle2,
  Radio,
  QrCode,
  UserPlus,
  Lock,
  Clock,
  Phone,
  IdCard,
  Trash2,
  Info,
  Shield,
  Loader2,
  Bell,
  RefreshCw,
} from 'lucide-react';
import { safetyCommandEngine } from '../services/safetyCommandEngine';
import type { EmergencyIncidentItem, EmergencyCategory, ChildProfileItem, AuthorizedPickupPerson } from '../types/index';
import { childSafetyService } from '../../../services/childSafetyService';
import { apiClient } from '../../../services/apiClient';
import { QRCodeSVG } from 'qrcode.react';
import type {
  ChildProfileDto,
  AuthorizedPickupDto,
  ChildGenderDto,
  CreateChildProfileRequest,
  CreateAuthorizedPickupRequest,
  CreateChildGatePassRequest,
  ChildGatePassCreatedDto,
  ChildSafetyAlertDto,
  ChildSosCreatedDto,
  TriggerChildSosRequest,
  ResolveChildAlertRequest,
  ChildAlertTypeDto,
  IncidentSeverityDto,
} from '../../../types/childSafety';
import { useAuth } from '../../../context/AuthContext';
import { useSecurityChildSafetyRealtime } from '../../../hooks/useSecurityChildSafetyRealtime';
import { realtimeService } from '../../../services/realtimeService';
import { Modal } from '../../../components/ui/Modal';
import { ResidentChildSafetyPanel } from './ResidentChildSafetyPanel';
import { ResidentChildSosModal } from './ResidentChildSosModal';

export interface ChildSafetyHubPermissions {
  canReadRoster: boolean;
  canManageProfiles: boolean;
  canManagePickups: boolean;
  canGeneratePasses: boolean;
  canViewConsole: boolean;
  canManageAlerts: boolean;
  isGuardRole: boolean;
  isResidentRole: boolean;
  isStaffRole: boolean;
}

/**
 * Pure role authorization classifier enforcing canonical backend access rules:
 * - Child roster read: resident, secretary, committee, admin
 * - Staff child creation: secretary, admin
 * - Staff pickup management: secretary, admin
 * - Staff gate pass generation: secretary, admin
 * - Staff alert management (ack/resolve): guard, secretary, committee, admin
 * - Live incident console: guard, secretary, committee, admin
 * - Guard: no roster access (must use Scanner)
 * - Unsupported roles/aliases ('security', 'vendor', etc.) & unauthenticated: fail closed.
 */
export function getChildSafetyHubPermissions(role?: string | null): ChildSafetyHubPermissions {
  const normalized = (role || '').trim().toLowerCase();
  return {
    canReadRoster: ['resident', 'secretary', 'committee', 'admin'].includes(normalized),
    canManageProfiles: ['secretary', 'admin'].includes(normalized),
    canManagePickups: ['secretary', 'admin'].includes(normalized),
    canGeneratePasses: ['secretary', 'admin'].includes(normalized),
    canViewConsole: ['guard', 'secretary', 'committee', 'admin'].includes(normalized),
    canManageAlerts: ['guard', 'secretary', 'committee', 'admin'].includes(normalized),
    isGuardRole: normalized === 'guard',
    isResidentRole: normalized === 'resident',
    isStaffRole: ['admin', 'secretary', 'committee', 'guard'].includes(normalized),
  };
}

/**
 * Controller executing authoritative child profile creation for staff.
 */
export async function executeStaffCreateChildProfile(
  childForm: {
    childName: string;
    guardianName: string;
    guardianPhone: string;
    flatId: string;
    residentId: string;
    age?: string | number;
    gender?: string;
  },
  activeRole: string,
  service: typeof childSafetyService = childSafetyService
): Promise<ChildProfileDto> {
  const perms = getChildSafetyHubPermissions(activeRole);
  if (!perms.canManageProfiles) {
    throw new Error('Forbidden: Only secretaries and administrators can register child profiles.');
  }
  if (!childForm.childName?.trim()) {
    throw new Error('Child full name is required.');
  }
  if (!childForm.guardianName?.trim() || !childForm.guardianPhone?.trim()) {
    throw new Error('Guardian name and phone are required.');
  }
  if (!childForm.flatId?.trim() || !childForm.residentId?.trim()) {
    throw new Error('Resident ID and Flat ID are required for staff registration.');
  }

  const genderMap: Record<string, ChildGenderDto> = {
    Boy: 'MALE',
    Girl: 'FEMALE',
    Other: 'OTHER',
  };

  const payload: CreateChildProfileRequest = {
    fullName: childForm.childName.trim(),
    guardianName: childForm.guardianName.trim(),
    guardianPhone: childForm.guardianPhone.trim(),
    flatId: childForm.flatId.trim(),
    residentId: childForm.residentId.trim(),
    reportedAge: childForm.age ? parseInt(String(childForm.age), 10) : undefined,
    gender: genderMap[childForm.gender || ''] || 'UNSPECIFIED',
    exitPermissionMode: 'ESCORT_REQUIRED',
    allowedSoloExit: false,
  };

  return service.createChildProfileAsync(payload);
}

/**
 * Controller executing authoritative authorized pickup creation for staff.
 * Submits only accepted DTO fields. Never submits raw government ID numbers.
 */
export async function executeStaffAddAuthorizedPickup(
  childId: string,
  pickupForm: {
    name: string;
    phone: string;
    relationship?: string;
    idDocumentType?: string | null;
    idDocumentLast4?: string | null;
    notes?: string | null;
  },
  activeRole: string,
  service: typeof childSafetyService = childSafetyService
): Promise<AuthorizedPickupDto> {
  const perms = getChildSafetyHubPermissions(activeRole);
  if (!perms.canManagePickups) {
    throw new Error('Forbidden: Only secretaries and administrators can manage authorized escorts.');
  }
  if (!childId?.trim()) {
    throw new Error('Child ID is required to add an authorized escort.');
  }
  if (!pickupForm.name?.trim() || !pickupForm.phone?.trim()) {
    throw new Error('Escort name and phone number are required.');
  }

  const sanitizedLast4 = pickupForm.idDocumentLast4
    ? pickupForm.idDocumentLast4.trim().replace(/\D/g, '').slice(-4)
    : null;

  const payload: CreateAuthorizedPickupRequest = {
    name: pickupForm.name.trim(),
    phone: pickupForm.phone.trim(),
    relationship: pickupForm.relationship?.trim() || 'Authorized Escort',
    idDocumentType: pickupForm.idDocumentType || null,
    idDocumentLast4: sanitizedLast4 || null,
    notes: pickupForm.notes?.trim() || null,
  };

  return service.addAuthorizedPickup(childId.trim(), payload);
}

/**
 * Controller executing authoritative authorized pickup revocation for staff.
 */
export async function executeStaffRevokeAuthorizedPickup(
  childId: string,
  pickupId: string,
  activeRole: string,
  service: typeof childSafetyService = childSafetyService
): Promise<AuthorizedPickupDto> {
  const perms = getChildSafetyHubPermissions(activeRole);
  if (!perms.canManagePickups) {
    throw new Error('Forbidden: Only secretaries and administrators can revoke escort authorizations.');
  }
  if (!childId?.trim() || !pickupId?.trim()) {
    throw new Error('Child ID and Pickup ID are required to revoke escort authorization.');
  }

  return service.revokeAuthorizedPickup(childId.trim(), pickupId.trim());
}

/**
 * Controller executing authoritative child gate pass generation for staff.
 */
export async function executeStaffGenerateGatePass(
  passForm: {
    childId: string;
    pickupPersonId?: string | null;
    durationHours?: number | string;
    validUntil?: string;
    notes?: string | null;
  },
  activeRole: string,
  service: typeof childSafetyService = childSafetyService
): Promise<ChildGatePassCreatedDto> {
  const perms = getChildSafetyHubPermissions(activeRole);
  if (!perms.canGeneratePasses) {
    throw new Error('Forbidden: Only secretaries and administrators can issue child gate passes.');
  }
  if (!passForm.childId?.trim()) {
    throw new Error('Child ID is required to generate a gate exit pass.');
  }

  const now = new Date();
  let validUntil: string;
  if (passForm.validUntil) {
    validUntil = passForm.validUntil;
  } else {
    const hours = Number(passForm.durationHours) || 4;
    validUntil = new Date(now.getTime() + hours * 3600 * 1000).toISOString();
  }

  const payload: CreateChildGatePassRequest = {
    childId: passForm.childId.trim(),
    pickupPersonId: passForm.pickupPersonId?.trim() || null,
    validFrom: now.toISOString(),
    validUntil,
    maxUses: 1,
    notes: passForm.notes?.trim() || null,
  };

  return service.createGatePass(payload);
}

/**
 * Controller executing authoritative Child Safety SOS trigger for staff.
 */
export async function executeStaffTriggerChildSos(
  input: {
    childId?: string | null;
    alertType?: ChildAlertTypeDto;
    severity?: IncidentSeverityDto;
    location: string;
    lastSeenDetails?: string | null;
    description?: string | null;
  },
  activeRole: string,
  service: typeof childSafetyService = childSafetyService
): Promise<ChildSosCreatedDto> {
  const perms = getChildSafetyHubPermissions(activeRole);
  if (!perms.canManageAlerts || perms.isResidentRole) {
    throw new Error('Forbidden: Only staff roles (guard, secretary, committee, admin) can trigger staff Child SOS.');
  }

  const location = (input.location || (input as any).triggerLocation || '').trim();
  if (!location) {
    throw new Error('Trigger location is required.');
  }

  const alertType = input.alertType || 'MISSING_CHILD';
  const severity = input.severity || 'CRITICAL';
  const lastSeen = (input.lastSeenDetails || (input as any).lastKnownLocation || '').trim() || null;
  const description = (input.description || '').trim() || null;

  const payload: TriggerChildSosRequest = {
    childId: input.childId?.trim() || undefined,
    location,
    alertType,
    severity,
    lastSeenDetails: lastSeen,
    description,
  };

  return service.triggerSos(payload);
}

/**
 * Controller executing authoritative Child Safety alert acknowledgment for staff.
 */
export async function executeStaffAcknowledgeChildAlert(
  alertId: string,
  activeRole: string,
  service: typeof childSafetyService = childSafetyService
): Promise<ChildSafetyAlertDto> {
  const perms = getChildSafetyHubPermissions(activeRole);
  if (!perms.canManageAlerts || perms.isResidentRole) {
    throw new Error('Forbidden: Only staff roles (guard, secretary, committee, admin) can acknowledge Child Safety alerts.');
  }
  if (!alertId?.trim()) {
    throw new Error('Alert ID is required.');
  }

  return service.acknowledgeAlert(alertId.trim());
}

/**
 * Controller executing authoritative Child Safety alert resolution for staff.
 */
export async function executeStaffResolveChildAlert(
  alertId: string,
  input: {
    resolutionNotes: string;
    status?: 'RESOLVED' | 'FALSE_ALARM';
  },
  activeRole: string,
  service: typeof childSafetyService = childSafetyService
): Promise<ChildSafetyAlertDto> {
  const perms = getChildSafetyHubPermissions(activeRole);
  if (!perms.canManageAlerts || perms.isResidentRole) {
    throw new Error('Forbidden: Only staff roles (guard, secretary, committee, admin) can resolve Child Safety alerts.');
  }
  if (!alertId?.trim()) {
    throw new Error('Alert ID is required.');
  }
  if (!input.resolutionNotes?.trim()) {
    throw new Error('Resolution notes are required to resolve a Child Safety alert.');
  }

  const payload: ResolveChildAlertRequest = {
    resolutionNotes: input.resolutionNotes.trim(),
    status: input.status || 'RESOLVED',
  };

  return service.resolveAlert(alertId.trim(), payload);
}

/**
 * Controller executing authoritative general emergency incident resolution for staff.
 * Note: Under server/src/index.ts:2332, only guard, secretary, and admin have resolution authority.
 */
export async function executeStaffResolveGeneralIncident(
  incidentId: string,
  activeRole: string,
  client: typeof apiClient = apiClient
): Promise<any> {
  const normalized = (activeRole || '').trim().toLowerCase();
  if (!['admin', 'secretary', 'guard'].includes(normalized)) {
    throw new Error('Forbidden: Only security guards, secretaries, and administrators can resolve general emergency incidents.');
  }
  if (!incidentId?.trim()) {
    throw new Error('Incident ID is required.');
  }

  return client.resolveEmergencyIncidentStrict(incidentId.trim());
}

export interface SafetyCommandHubProps {
  initialTab?: 'ONE_TAP_SOS' | 'COMMAND_CONSOLE' | 'CHILD_SAFETY' | 'GATE_VERIFIER';
  initialChildren?: ChildProfileItem[];
}

export const SafetyCommandHub: React.FC<SafetyCommandHubProps> = ({
  initialTab = 'ONE_TAP_SOS',
  initialChildren,
}) => {
  const { currentUser } = useAuth();
  const activeRole = (currentUser?.role || '').toLowerCase();
  const flatNumber = (currentUser as any)?.flatNumber || (currentUser as any)?.flatDetails || 'B-1204';

  const {
    canReadRoster,
    canManageProfiles,
    canManagePickups,
    canGeneratePasses,
    canViewConsole,
    canManageAlerts,
    isGuardRole,
    isResidentRole,
    isStaffRole,
  } = getChildSafetyHubPermissions(activeRole);

  const [activeTab, setActiveTab] = useState<'ONE_TAP_SOS' | 'COMMAND_CONSOLE' | 'CHILD_SAFETY' | 'GATE_VERIFIER'>(initialTab);
  const [incidents, setIncidents] = useState<EmergencyIncidentItem[]>(() => safetyCommandEngine.getIncidents());
  const [children, setChildren] = useState<ChildProfileItem[]>(() => initialChildren || []);
  const [isLoadingChildren, setIsLoadingChildren] = useState(false);
  const [childrenError, setChildrenError] = useState<string | null>(null);

  const [selectedIncident, setSelectedIncident] = useState<EmergencyIncidentItem | null>(null);
  const [selectedEscortForDetail, setSelectedEscortForDetail] = useState<(AuthorizedPickupPerson & { childId?: string }) | null>(null);
  const [modalMode, setModalMode] = useState<
    'ASSIGN_RESPONDER' | 'ADD_CHILD' | 'ADD_PICKUP' | 'GENERATE_PASS' | 'STAFF_CHILD_SOS' | 'RESOLVE_CHILD_ALERT' | null
  >(null);
  const [isResidentSosModalOpen, setIsResidentSosModalOpen] = useState(false);
  const [selectedChildForPickupId, setSelectedChildForPickupId] = useState<string>('');

  // Authoritative Child Safety Alerts & General Emergency feeds
  const [childAlerts, setChildAlerts] = useState<ChildSafetyAlertDto[]>([]);
  const [isLoadingChildAlerts, setIsLoadingChildAlerts] = useState<boolean>(false);
  const [childAlertsError, setChildAlertsError] = useState<string | null>(null);

  const [generalIncidents, setGeneralIncidents] = useState<EmergencyIncidentItem[]>(() => safetyCommandEngine.getIncidents());
  const [isLoadingGeneralIncidents, setIsLoadingGeneralIncidents] = useState<boolean>(false);
  const [generalIncidentsError, setGeneralIncidentsError] = useState<string | null>(null);

  const [incidentFilter, setIncidentFilter] = useState<'ALL' | 'CHILD_SAFETY' | 'GENERAL'>('ALL');
  const [isAcknowledgingAlertId, setIsAcknowledgingAlertId] = useState<string | null>(null);
  const [isResolvingGeneralIncidentId, setIsResolvingGeneralIncidentId] = useState<string | null>(null);

  // Staff Child SOS Modal state
  const [staffSosChildId, setStaffSosChildId] = useState<string>('');
  const [staffSosAlertType, setStaffSosAlertType] = useState<ChildAlertTypeDto>('MISSING_CHILD');
  const [staffSosSeverity, setStaffSosSeverity] = useState<IncidentSeverityDto>('CRITICAL');
  const [staffSosLocation, setStaffSosLocation] = useState<string>('');
  const [staffSosLastSeen, setStaffSosLastSeen] = useState<string>('');
  const [staffSosDescription, setStaffSosDescription] = useState<string>('');
  const [staffSosError, setStaffSosError] = useState<string | null>(null);
  const [isSubmittingStaffSos, setIsSubmittingStaffSos] = useState<boolean>(false);

  // Resolve Child Alert Modal state
  const [selectedAlertForResolve, setSelectedAlertForResolve] = useState<ChildSafetyAlertDto | null>(null);
  const [resolveStatus, setResolveStatus] = useState<'RESOLVED' | 'FALSE_ALARM'>('RESOLVED');
  const [resolveNotes, setResolveNotes] = useState<string>('');
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [isResolvingAlert, setIsResolvingAlert] = useState<boolean>(false);

  // Pass generation target tracking (remediates F-P46332-01)
  const passSubmissionTargetRef = useRef<string | null>(null);

  // Pass generation state
  const [passChild, setPassChild] = useState<ChildProfileItem | null>(null);
  const [passEscortId, setPassEscortId] = useState<string>('');
  const [passDurationHours, setPassDurationHours] = useState<number>(4);
  const [passNotes, setPassNotes] = useState<string>('');
  const [passFormError, setPassFormError] = useState<string | null>(null);
  const [isSubmittingPass, setIsSubmittingPass] = useState(false);
  const [generatedPass, setGeneratedPass] = useState<{
    id: string;
    passCode: string;
    childName: string;
    flatNumber: string;
    pickupPersonName: string;
    validFrom: string;
    validUntil: string;
    qrPayload: string;
  } | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmittingChild, setIsSubmittingChild] = useState(false);
  const [isSubmittingPickup, setIsSubmittingPickup] = useState(false);
  const [isRevokingPickupId, setIsRevokingPickupId] = useState<string | null>(null);

  // Forms
  const [responderForm, setResponderForm] = useState({
    responderName: 'Guard Ramesh Shinde',
    responderRole: 'Head Security',
  });

  const [pickupForm, setPickupForm] = useState({
    name: '',
    phone: '',
    relationship: 'Trusted Family Maid / Nanny',
    idDocumentType: 'Aadhaar Card',
    idDocumentLast4: '',
    notes: '',
  });

  const [childForm, setChildForm] = useState({
    childName: '',
    flatCode: flatNumber,
    flatId: '',
    residentId: '',
    guardianName: '',
    guardianPhone: '',
    age: '8',
    gender: 'Boy',
  });

  const [alertSuccess, setAlertSuccess] = useState<string | null>(null);

  const loadAuthoritativeChildren = useCallback(async () => {
    if (!canReadRoster || isGuardRole || isResidentRole) {
      return;
    }
    setIsLoadingChildren(true);
    setChildrenError(null);
    try {
      const dtos = await childSafetyService.listChildren();
      const mapped: ChildProfileItem[] = dtos.map((dto) => ({
        id: dto.id,
        societyId: dto.societyId,
        childName: dto.fullName,
        flatCode: dto.flatNumber,
        guardianName: dto.guardianName,
        guardianPhone: dto.guardianPhone,
        authorizedPickups: (dto.pickups || [])
          .filter((p) => p.status !== 'ARCHIVED')
          .map((p) => ({
            id: p.id,
            childId: p.childId,
            name: p.name,
            phone: p.phone,
            relationship: p.relationship,
            idProofType: p.idDocumentType || 'Not Collected',
            idProofNumber: p.idDocumentLast4 ? `XXXX-${p.idDocumentLast4}` : 'Verified',
            photoUrl: p.photoUrl || undefined,
            isApproved: p.status === 'ACTIVE',
          })),
        createdAt: dto.createdAt,
      }));
      setChildren(mapped);
    } catch (err: any) {
      setChildrenError(err?.message || 'Failed to load society child roster.');
    } finally {
      setIsLoadingChildren(false);
    }
  }, [canReadRoster, isGuardRole, isResidentRole]);

  const loadAuthoritativeAlerts = useCallback(async () => {
    if (!canViewConsole) return;
    setIsLoadingChildAlerts(true);
    setChildAlertsError(null);
    try {
      const alerts = await childSafetyService.listAlerts();
      setChildAlerts(alerts);
    } catch (err: any) {
      setChildAlertsError(err?.message || 'Failed to load child safety alerts.');
    } finally {
      setIsLoadingChildAlerts(false);
    }
  }, [canViewConsole]);

  const loadGeneralIncidents = useCallback(async () => {
    if (!canViewConsole) return;
    setIsLoadingGeneralIncidents(true);
    setGeneralIncidentsError(null);
    try {
      const resp = await apiClient.getEmergencyIncidents();
      const rawList: any[] = Array.isArray(resp) ? resp : ((resp as any)?.incidents || (resp as any)?.data || []);
      const mapped: EmergencyIncidentItem[] = rawList
        .filter((item: any) => item.incidentType !== 'CHILD_SAFETY' && item.category !== 'CHILD_SAFETY')
        .map((item: any) => ({
          id: item.id,
          societyId: item.societyId,
          residentId: item.residentId || 'system',
          residentName: item.residentName || item.resident?.name || 'Resident',
          flatCode: item.flatCode || item.resident?.flatNumber || 'Society',
          phone: item.phone || item.resident?.phone || '',
          category: (item.incidentType as EmergencyCategory) || item.category || 'SECURITY',
          title: item.title || `${item.incidentType || 'Emergency'} Incident`,
          description: item.description || '',
          location: item.location || 'Society Premises',
          status: item.dispatchStatus === 'RESOLVED' || item.status === 'RESOLVED' ? 'RESOLVED' : (item.status || 'TRIGGERED'),
          timeline: item.timeline || [],
          createdAt: item.createdAt || new Date().toISOString(),
          updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
        }));
      setGeneralIncidents(mapped);
    } catch (err: any) {
      // Fallback to local memory engine for non-child emergencies
      const local = safetyCommandEngine.getIncidents().filter((i) => i.category !== 'CHILD_SAFETY');
      setGeneralIncidents(local);
    } finally {
      setIsLoadingGeneralIncidents(false);
    }
  }, [canViewConsole]);

  const loadData = useCallback(() => {
    setIncidents(safetyCommandEngine.getIncidents());
    if (canReadRoster && !isGuardRole && !isResidentRole) {
      loadAuthoritativeChildren();
    }
    if (canViewConsole) {
      loadAuthoritativeAlerts();
      loadGeneralIncidents();
    }
  }, [canReadRoster, isGuardRole, isResidentRole, canViewConsole, loadAuthoritativeChildren, loadAuthoritativeAlerts, loadGeneralIncidents]);

  // Canonical Security Child Safety Realtime Synchronization Hook
  const {
    connectionStatus,
    isConnected,
    isReconnecting,
    isOffline,
  } = useSecurityChildSafetyRealtime({
    enabled: isStaffRole && Boolean(currentUser?.societyId),
    onAlertsChange: () => {
      if (canViewConsole) {
        void loadAuthoritativeAlerts();
      }
      if (canReadRoster && !isGuardRole && !isResidentRole) {
        void loadAuthoritativeChildren();
      }
    },
    onRefresh: async () => {
      if (canViewConsole) {
        await loadAuthoritativeAlerts();
      }
      if (canReadRoster && !isGuardRole && !isResidentRole) {
        await loadAuthoritativeChildren();
      }
    },
    onReconnect: () => {
      loadData();
    },
  });

  // General Emergency Realtime Subscriptions (Staff authorized topics)
  useEffect(() => {
    if (!isStaffRole || !currentUser?.societyId) return;

    const currentSocietyId = currentUser.societyId;

    const handleGeneralIncidentEvent = (msg: any) => {
      const eventSocietyId = msg?.societyId || msg?.payload?.societyId;
      if (eventSocietyId && eventSocietyId !== currentSocietyId) return;

      if (canViewConsole) {
        void loadGeneralIncidents();
      }
    };

    const unsubAlerts = realtimeService.subscribe('EMERGENCY_ALERTS', handleGeneralIncidentEvent);
    const unsubResolved = realtimeService.subscribe('EMERGENCY_INCIDENT_RESOLVED', handleGeneralIncidentEvent);
    const unsubCreated = realtimeService.subscribe('EMERGENCY_INCIDENT_CREATED', handleGeneralIncidentEvent);

    return () => {
      unsubAlerts();
      unsubResolved();
      unsubCreated();
    };
  }, [isStaffRole, currentUser?.societyId, canViewConsole, loadGeneralIncidents]);

  // Underlying childSafetyService in-memory cache invalidation listener
  useEffect(() => {
    const unsubscribeCache = childSafetyService.onCacheInvalidated(() => {
      if (canReadRoster && !isGuardRole && !isResidentRole) {
        void loadAuthoritativeChildren();
      }
      if (canViewConsole) {
        void loadAuthoritativeAlerts();
      }
    });

    return () => {
      unsubscribeCache();
    };
  }, [canReadRoster, isGuardRole, isResidentRole, canViewConsole, loadAuthoritativeChildren, loadAuthoritativeAlerts]);

  // Initial data load on mount or parameter change
  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleOpenStaffSosModal = (child?: ChildProfileItem) => {
    setStaffSosChildId(child?.id || '');
    setStaffSosAlertType('MISSING_CHILD');
    setStaffSosSeverity('CRITICAL');
    setStaffSosLocation(child ? `Near Flat ${child.flatCode}` : 'Society Premises');
    setStaffSosLastSeen('');
    setStaffSosDescription(child ? `Reported missing child: ${child.childName}` : '');
    setStaffSosError(null);
    setModalMode('STAFF_CHILD_SOS');
  };

  const handleStaffSosSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStaffSosError(null);
    setIsSubmittingStaffSos(true);
    try {
      const res = await executeStaffTriggerChildSos(
        {
          childId: staffSosChildId || undefined,
          alertType: staffSosAlertType,
          severity: staffSosSeverity,
          location: staffSosLocation,
          lastSeenDetails: staffSosLastSeen || undefined,
          description: staffSosDescription || undefined,
        },
        activeRole
      );
      setModalMode(null);
      await loadAuthoritativeAlerts();
      await loadAuthoritativeChildren();
      const code = (res.alert as any).alertCode || res.alert.id.slice(0, 8).toUpperCase();
      setAlertSuccess(`CHILD SAFETY SOS [${code}] DISPATCHED! Perimeter gates notified.`);
      setTimeout(() => setAlertSuccess(null), 5000);
    } catch (err: any) {
      setStaffSosError(err?.message || 'Failed to dispatch Child Safety SOS.');
    } finally {
      setIsSubmittingStaffSos(false);
    }
  };

  const handleAcknowledgeChildAlert = async (alertId: string) => {
    setIsAcknowledgingAlertId(alertId);
    try {
      await executeStaffAcknowledgeChildAlert(alertId, activeRole);
      await loadAuthoritativeAlerts();
      setAlertSuccess('Child Safety alert acknowledged.');
      setTimeout(() => setAlertSuccess(null), 4000);
    } catch (err: any) {
      setChildAlertsError(err?.message || 'Failed to acknowledge alert.');
    } finally {
      setIsAcknowledgingAlertId(null);
    }
  };

  const handleOpenResolveModal = (alert: ChildSafetyAlertDto) => {
    setSelectedAlertForResolve(alert);
    setResolveStatus('RESOLVED');
    setResolveNotes('');
    setResolveError(null);
    setModalMode('RESOLVE_CHILD_ALERT');
  };

  const handleResolveChildAlertSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAlertForResolve) return;
    if (!resolveNotes.trim()) {
      setResolveError('Resolution notes are required to resolve a child safety alert.');
      return;
    }
    setIsResolvingAlert(true);
    setResolveError(null);
    try {
      await executeStaffResolveChildAlert(
        selectedAlertForResolve.id,
        {
          resolutionNotes: resolveNotes.trim(),
          status: resolveStatus,
        },
        activeRole
      );
      setModalMode(null);
      setSelectedAlertForResolve(null);
      await loadAuthoritativeAlerts();
      await loadAuthoritativeChildren();
      setAlertSuccess('Child Safety alert resolved successfully.');
      setTimeout(() => setAlertSuccess(null), 4000);
    } catch (err: any) {
      setResolveError(err?.message || 'Failed to resolve Child Safety alert.');
    } finally {
      setIsResolvingAlert(false);
    }
  };

  const handleResolveGeneralIncident = async (incidentId: string) => {
    setIsResolvingGeneralIncidentId(incidentId);
    try {
      await executeStaffResolveGeneralIncident(incidentId, activeRole);
      await loadGeneralIncidents();
      setAlertSuccess('Emergency incident resolved cleanly.');
      setTimeout(() => setAlertSuccess(null), 4000);
    } catch (err: any) {
      // Fallback
      safetyCommandEngine.resolveIncident(incidentId, 'RESOLVED', 'Incident resolved on site.', currentUser?.name || 'Security Post');
      loadData();
    } finally {
      setIsResolvingGeneralIncidentId(null);
    }
  };

  const handleTriggerSOS = (category: EmergencyCategory) => {
    if (category === 'CHILD_SAFETY') {
      if (isResidentRole) {
        setIsResidentSosModalOpen(true);
        return;
      }
      if (canManageAlerts) {
        handleOpenStaffSosModal();
        return;
      }
      setAlertSuccess('Forbidden: Your role cannot dispatch Child Safety SOS.');
      return;
    }

    safetyCommandEngine.triggerOneTapSOS(
      category,
      currentUser?.id || 'res-1',
      currentUser?.name || 'Staff / Security Post',
      flatNumber,
      currentUser?.phone || '+91 98765 00000',
      `Tower B, Flat ${flatNumber}`
    );
    loadData();
    setAlertSuccess(`ONE-TAP ${category} SOS DISPATCHED! Security Command Console & Guard Terminal notified.`);
    setTimeout(() => setAlertSuccess(null), 5000);
  };

  const handleAcknowledge = (id: string) => {
    safetyCommandEngine.acknowledgeIncident(id, currentUser?.name || 'Security Post');
    loadData();
  };

  const handleAssignSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIncident) return;

    safetyCommandEngine.assignResponder(
      selectedIncident.id,
      responderForm.responderName,
      responderForm.responderRole,
      currentUser?.name || 'Security Command'
    );

    setModalMode(null);
    loadData();
  };

  const handleAddChildSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    setIsSubmittingChild(true);
    try {
      const created = await executeStaffCreateChildProfile(childForm, activeRole);
      setModalMode(null);
      await loadAuthoritativeChildren();
      setAlertSuccess(`Child profile for "${created.fullName}" registered successfully.`);
      setChildForm({
        childName: '',
        flatCode: flatNumber,
        flatId: '',
        residentId: '',
        guardianName: '',
        guardianPhone: '',
        age: '8',
        gender: 'Boy',
      });
      setTimeout(() => setAlertSuccess(null), 5000);
    } catch (err: any) {
      setFormError(err?.message || 'Failed to register child profile.');
    } finally {
      setIsSubmittingChild(false);
    }
  };

  const handleAddPickupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const targetChildId = selectedChildForPickupId || children[0]?.id;
    if (!targetChildId) {
      setFormError('Please select a child profile first.');
      return;
    }

    setIsSubmittingPickup(true);
    try {
      const created = await executeStaffAddAuthorizedPickup(targetChildId, pickupForm, activeRole);
      setModalMode(null);
      await loadAuthoritativeChildren();
      setAlertSuccess(`Authorized escort "${created.name}" added successfully.`);
      setPickupForm({
        name: '',
        phone: '',
        relationship: 'Trusted Family Maid / Nanny',
        idDocumentType: 'Aadhaar Card',
        idDocumentLast4: '',
        notes: '',
      });
      setTimeout(() => setAlertSuccess(null), 4000);
    } catch (err: any) {
      setFormError(err?.message || 'Failed to add authorized escort.');
    } finally {
      setIsSubmittingPickup(false);
    }
  };

  const handleRemoveEscort = async (childId: string, escortId: string) => {
    if (isRevokingPickupId) return;
    setFormError(null);
    setIsRevokingPickupId(escortId);
    try {
      await executeStaffRevokeAuthorizedPickup(childId, escortId, activeRole);
      setSelectedEscortForDetail(null);
      await loadAuthoritativeChildren();
      setAlertSuccess('Escort authorization revoked.');
      setTimeout(() => setAlertSuccess(null), 4000);
    } catch (err: any) {
      setFormError(err?.message || 'Failed to revoke escort authorization.');
    } finally {
      setIsRevokingPickupId(null);
    }
  };

  const handleOpenGeneratePassModal = (child: ChildProfileItem, defaultEscortId?: string) => {
    passSubmissionTargetRef.current = child.id;
    setPassChild(child);
    setPassEscortId(defaultEscortId || child.authorizedPickups[0]?.id || '');
    setPassDurationHours(4);
    setPassNotes('');
    setPassFormError(null);
    setGeneratedPass(null);
    setModalMode('GENERATE_PASS');
  };

  const handleClosePassModal = () => {
    passSubmissionTargetRef.current = null;
    setModalMode(null);
    setGeneratedPass(null); // Ephemeral: clears sensitive QR payload & token immediately
    setPassFormError(null);
    setIsSubmittingPass(false);
  };

  const handleGeneratePassSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetChildId = passSubmissionTargetRef.current || passChild?.id;
    if (!targetChildId) {
      setPassFormError('No child profile selected.');
      return;
    }
    setPassFormError(null);
    setIsSubmittingPass(true);

    try {
      const created = await executeStaffGenerateGatePass(
        {
          childId: targetChildId,
          pickupPersonId: passEscortId || null,
          durationHours: passDurationHours,
          notes: passNotes || null,
        },
        activeRole
      );

      const targetChild = passChild || children.find((c) => c.id === targetChildId);
      const childName = targetChild?.childName || created.child?.fullName || 'Child';
      const childFlat = targetChild?.flatCode || created.child?.flatNumber || '';

      // Ephemeral presentation model: store only what is needed for one-time display, never persist
      setGeneratedPass({
        id: created.id,
        passCode: created.passCode,
        childName,
        flatNumber: childFlat,
        pickupPersonName: created.pickupPersonName,
        validFrom: created.validFrom,
        validUntil: created.validUntil,
        qrPayload: created.qrPayload,
      });
      setAlertSuccess(`Gate pass ${created.passCode} generated for ${childName}.`);
      setTimeout(() => setAlertSuccess(null), 5000);
    } catch (err: any) {
      setPassFormError(err?.message || 'Failed to generate gate pass.');
    } finally {
      setIsSubmittingPass(false);
    }
  };

  const activeChildAlerts = childAlerts.filter((a) => a.status === 'ACTIVE' || a.status === 'ACKNOWLEDGED');
  const activeGeneralIncidents = generalIncidents.filter((i) => i.status !== 'RESOLVED' && i.status !== 'CLOSED');
  const totalActiveIncidentsCount = activeChildAlerts.length + activeGeneralIncidents.length;

  return (
    <div className="max-w-7xl mx-auto space-y-5 pb-24 font-sans">
      {/* Segmented Experience Switcher Shell */}
      <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: '0.25rem' }}>
        <button
          type="button"
          onClick={() => setActiveTab('ONE_TAP_SOS')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.375rem',
            background: activeTab === 'ONE_TAP_SOS' ? 'var(--aarizo-coral, #F06543)' : '#ffffff',
            border: '1px solid var(--aarizo-border, #DCE8EF)',
            borderRadius: '10px',
            padding: '0.45rem 0.875rem',
            fontSize: '0.75rem',
            fontWeight: 700,
            color: activeTab === 'ONE_TAP_SOS' ? '#ffffff' : 'var(--aarizo-text, #203746)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <ShieldAlert size={14} color={activeTab === 'ONE_TAP_SOS' ? '#ffffff' : 'var(--aarizo-coral, #F06543)'} />
          <span>One-Tap SOS</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('CHILD_SAFETY')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.375rem',
            background: activeTab === 'CHILD_SAFETY' ? 'var(--aarizo-coral, #F06543)' : '#ffffff',
            border: '1px solid var(--aarizo-border, #DCE8EF)',
            borderRadius: '10px',
            padding: '0.45rem 0.875rem',
            fontSize: '0.75rem',
            fontWeight: 700,
            color: activeTab === 'CHILD_SAFETY' ? '#ffffff' : 'var(--aarizo-text, #203746)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <Users size={14} color={activeTab === 'CHILD_SAFETY' ? '#ffffff' : 'var(--aarizo-coral, #F06543)'} />
          <span>Child Safety</span>
        </button>

        {isStaffRole && (
          <button
            type="button"
            onClick={() => setActiveTab('COMMAND_CONSOLE')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.375rem',
              background: activeTab === 'COMMAND_CONSOLE' ? 'var(--aarizo-coral, #F06543)' : '#ffffff',
              border: '1px solid var(--aarizo-border, #DCE8EF)',
              borderRadius: '10px',
              padding: '0.45rem 0.875rem',
              fontSize: '0.75rem',
              fontWeight: 700,
              color: activeTab === 'COMMAND_CONSOLE' ? '#ffffff' : 'var(--aarizo-text, #203746)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <Radio size={14} color={activeTab === 'COMMAND_CONSOLE' ? '#ffffff' : 'var(--aarizo-coral, #F06543)'} />
            <span>Console ({totalActiveIncidentsCount})</span>
          </button>
        )}

        {isStaffRole && (
          <button
            type="button"
            onClick={() => setActiveTab('GATE_VERIFIER')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.375rem',
              background: activeTab === 'GATE_VERIFIER' ? 'var(--aarizo-coral, #F06543)' : '#ffffff',
              border: '1px solid var(--aarizo-border, #DCE8EF)',
              borderRadius: '10px',
              padding: '0.45rem 0.875rem',
              fontSize: '0.75rem',
              fontWeight: 700,
              color: activeTab === 'GATE_VERIFIER' ? '#ffffff' : 'var(--aarizo-text, #203746)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <QrCode size={14} color={activeTab === 'GATE_VERIFIER' ? '#ffffff' : 'var(--aarizo-coral, #F06543)'} />
            <span>Gate Verifier</span>
          </button>
        )}
      </div>

      {/* Success Banner */}
      {alertSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-2xl text-xs font-bold flex items-center gap-2.5 shadow-2xs animate-in fade-in duration-200">
          <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
          <span>{alertSuccess}</span>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* EXPERIENCE 1: ONE-TAP EMERGENCY SOS                           */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeTab === 'ONE_TAP_SOS' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          {/* SOS Clean Header Banner */}
          <div
            style={{
              background: '#ffffff',
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
                  background: '#FEF2F2',
                  border: '1px solid #FECACA',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#DC2626',
                  flexShrink: 0,
                }}
              >
                <ShieldAlert size={22} color="var(--aarizo-coral, #F06543)" />
              </div>
              <div>
                <h1 style={{ fontSize: '1.125rem', fontWeight: 800, color: 'var(--aarizo-navy, #083B56)', margin: 0, letterSpacing: '-0.02em' }}>
                  Safety Command &amp; Emergency Dispatch
                </h1>
                <p style={{ fontSize: '0.75rem', color: 'var(--aarizo-text-secondary, #657785)', margin: 0, marginTop: '0.125rem' }}>
                  One-Tap Emergency SOS, real-time command console, child pickup authorization &amp; guardian alerts.
                </p>
              </div>
            </div>

            {totalActiveIncidentsCount > 0 && (
              <div
                style={{
                  background: '#FEF2F2',
                  border: '1px solid #FECACA',
                  color: '#DC2626',
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  padding: '0.35rem 0.75rem',
                  borderRadius: '9999px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.375rem',
                }}
              >
                <Radio size={13} color="#DC2626" />
                <span>{totalActiveIncidentsCount} ACTIVE INCIDENT(S)</span>
              </div>
            )}
          </div>

          {/* AI Boundary Notice Card */}
          <div
            style={{
              padding: '0.625rem 0.875rem',
              background: '#FFFBEB',
              borderRadius: '12px',
              border: '1px solid #FDE68A',
              fontSize: '0.75rem',
              color: '#92400E',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <Lock size={15} color="#D97706" style={{ flexShrink: 0 }} />
            <span>
              <strong style={{ fontWeight: 800, color: '#78350F' }}>Strict AI Boundary Rule:</strong> AI is strictly prohibited from independently making child-safety or gate entry decisions. All authorizations remain guardian-verified.
            </span>
          </div>

          {/* SOS Incident Action Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { category: 'MEDICAL' as const, title: 'Medical Emergency', desc: 'Ambulance & Doctor Alert', bg: '#FEF2F2', border: '#FECACA', text: '#DC2626', icon: ShieldAlert },
              { category: 'FIRE' as const, title: 'Fire Alert', desc: 'Fire System & Evacuation', bg: '#FFF7ED', border: '#FFEDD5', text: '#EA580C', icon: Flame },
              { category: 'SECURITY' as const, title: 'Security Threat', desc: 'Intruder / Security Alert', bg: '#F0F9FF', border: '#BAE6FD', text: 'var(--aarizo-navy, #083B56)', icon: ShieldCheck },
              { category: 'CHILD_SAFETY' as const, title: 'Child Safety SOS', desc: 'Missing / Unsafe Alert', bg: '#ECFDF5', border: '#A7F3D0', text: '#059669', icon: Users },
              { category: 'LIFT' as const, title: 'Lift Trapped', desc: 'Elevator Emergency Trap', bg: '#F3E8FF', border: '#E9D5FF', text: '#7E22CE', icon: AlertTriangle },
              { category: 'ELECTRICAL' as const, title: 'Electrical Hazard', desc: 'Spark / Power Threat', bg: '#FEF3C7', border: '#FDE68A', text: '#D97706', icon: Zap },
            ].map((sos) => {
              const IconComp = sos.icon;
              return (
                <div
                  key={sos.category}
                  onClick={() => handleTriggerSOS(sos.category)}
                  style={{
                    background: '#ffffff',
                    border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
                    borderRadius: '16px',
                    padding: '0.875rem 1rem',
                    boxShadow: '0 2px 10px rgba(8, 59, 86, 0.04)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: '10px',
                        background: sos.bg,
                        border: `1px solid ${sos.border}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: sos.text,
                      }}
                    >
                      <IconComp size={18} color={sos.text} />
                    </div>
                    <div style={{ fontSize: '0.9375rem', fontWeight: 800, color: 'var(--aarizo-navy, #083B56)', marginTop: '0.25rem' }}>
                      {sos.title}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--aarizo-text-secondary, #657785)' }}>
                      {sos.desc}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTriggerSOS(sos.category);
                    }}
                    style={{
                      width: '100%',
                      padding: '0.45rem',
                      borderRadius: '10px',
                      background: 'var(--aarizo-coral, #F06543)',
                      color: '#ffffff',
                      fontWeight: 800,
                      fontSize: '0.75rem',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.35rem',
                      boxShadow: '0 2px 6px rgba(240, 101, 67, 0.2)',
                    }}
                  >
                    <Radio size={13} color="#ffffff" />
                    <span>Tap for SOS</span>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Recent Emergency Activity Timeline Section */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
              borderRadius: '16px',
              padding: '1rem 1.25rem',
              boxShadow: '0 2px 10px rgba(8, 59, 86, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.875rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Clock size={16} color="var(--aarizo-coral, #F06543)" />
                <span style={{ fontSize: '0.9375rem', fontWeight: 800, color: 'var(--aarizo-navy, #083B56)' }}>Recent Emergency Activity</span>
              </div>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--aarizo-coral, #F06543)', cursor: 'pointer' }}>View All</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {incidents.slice(0, 3).map((inc) => (
                <div
                  key={inc.id}
                  style={{
                    padding: '0.625rem 0.875rem',
                    borderRadius: '12px',
                    border: '1px solid var(--aarizo-border, #DCE8EF)',
                    background: 'var(--aarizo-pale-blue, #F4FAFE)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: '8px',
                        background: '#FEF2F2',
                        border: '1px solid #FECACA',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#DC2626',
                        flexShrink: 0,
                      }}
                    >
                      <ShieldAlert size={16} color="#DC2626" />
                    </div>
                    <div>
                      <div style={{ fontSize: '0.8125rem', fontWeight: 800, color: 'var(--aarizo-text, #203746)' }}>{inc.title}</div>
                      <div style={{ fontSize: '0.6875rem', color: 'var(--aarizo-text-secondary, #657785)' }}>
                        {inc.location} · {new Date(inc.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>

                  <span
                    style={{
                      fontSize: '0.625rem',
                      fontWeight: 800,
                      color: inc.status === 'RESOLVED' ? '#059669' : inc.status === 'TRIGGERED' ? '#DC2626' : '#D97706',
                      background: inc.status === 'RESOLVED' ? '#ECFDF5' : inc.status === 'TRIGGERED' ? '#FEF2F2' : '#FFFBEB',
                      border: `1px solid ${inc.status === 'RESOLVED' ? '#A7F3D0' : inc.status === 'TRIGGERED' ? '#FECACA' : '#FDE68A'}`,
                      padding: '0.2rem 0.5rem',
                      borderRadius: '9999px',
                      textTransform: 'uppercase',
                    }}
                  >
                    {inc.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* EXPERIENCE 2: CHILD SAFETY PASS                                */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeTab === 'CHILD_SAFETY' && isResidentRole && <ResidentChildSafetyPanel />}

      {activeTab === 'CHILD_SAFETY' && isGuardRole && (
        <div className="bg-white border border-[#DCE8EF] rounded-2xl p-6 text-center space-y-4 max-w-xl mx-auto shadow-sm">
          <div className="w-12 h-12 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto text-amber-600">
            <Lock size={24} />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-extrabold text-[#083B56]">
              Guard Privacy Boundary Notice
            </h3>
            <p className="text-xs text-[#657785] max-w-md mx-auto leading-relaxed">
              Security guards do not have direct access to household child rosters or family profiles. To verify authorized child exits and caretaker passes at the perimeter gate, please use the Child Gate Scanner.
            </p>
          </div>
          <div className="pt-2">
            <a
              href="/security/child-safety"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#F06543] text-white text-xs font-extrabold shadow-md hover:bg-[#D95333] transition-all"
            >
              <QrCode size={16} />
              <span>Open Child Gate Scanner</span>
            </a>
          </div>
        </div>
      )}

      {activeTab === 'CHILD_SAFETY' && !isResidentRole && !isGuardRole && !canReadRoster && (
        <div className="bg-white border border-rose-200 rounded-2xl p-6 text-center space-y-2 max-w-xl mx-auto shadow-sm">
          <AlertTriangle size={24} className="text-rose-500 mx-auto" />
          <h3 className="text-sm font-extrabold text-rose-900">Access Denied</h3>
          <p className="text-xs text-[#657785]">Your role does not have authorization to view or manage society child profiles.</p>
        </div>
      )}

      {activeTab === 'CHILD_SAFETY' && !isResidentRole && !isGuardRole && canReadRoster && (
        <div className="space-y-4 animate-in fade-in duration-200">
          {/* Child Safety Header Banner */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
              borderRadius: '16px',
              padding: '1rem 1.25rem',
              boxShadow: '0 2px 10px rgba(8, 59, 86, 0.05)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
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
                <h1 style={{ fontSize: '1.125rem', fontWeight: 800, color: 'var(--aarizo-navy, #083B56)', margin: 0, letterSpacing: '-0.02em' }}>
                  CHILD SAFETY
                </h1>
                <p style={{ fontSize: '0.75rem', color: 'var(--aarizo-text-secondary, #657785)', margin: 0, marginTop: '0.125rem' }}>
                  Society child roster · Gate authorization &amp; security escorts
                </p>
              </div>
            </div>

            <ShieldCheck size={28} color="var(--aarizo-coral, #F06543)" />
          </div>

          {/* Canonical Source Info Callout */}
          <div
            style={{
              background: 'var(--aarizo-light-blue, #EAF6FC)',
              border: '1px solid var(--aarizo-border, #DCE8EF)',
              borderRadius: '12px',
              padding: '0.75rem 1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
            }}
          >
            <Info size={18} color="var(--aarizo-navy, #083B56)" className="shrink-0" />
            <span style={{ fontSize: '0.75rem', color: 'var(--aarizo-navy, #083B56)', fontWeight: 600, lineHeight: 1.4 }}>
              Authoritative Child Safety Data: Loaded directly from authenticated society records. Gate security operates strictly via verified QR exit passes.
            </span>
          </div>

          {childrenError && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold rounded-xl flex items-center gap-2 shadow-2xs">
              <AlertTriangle size={16} className="text-rose-600 shrink-0" />
              <span>{childrenError}</span>
            </div>
          )}

          {/* Section Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 0.25rem' }}>
            <h3 style={{ fontSize: '0.875rem', fontWeight: 800, color: 'var(--aarizo-navy, #083B56)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Children registered in society ({children.length})
            </h3>
            {canManageProfiles && (
              <button
                type="button"
                onClick={() => {
                  setFormError(null);
                  setModalMode('ADD_CHILD');
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.45rem 0.85rem',
                  borderRadius: '10px',
                  background: 'var(--aarizo-navy, #083B56)',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '0.78rem',
                  border: 'none',
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(8, 59, 86, 0.15)',
                }}
              >
                <UserPlus size={14} color="var(--aarizo-gold, #E5B842)" />
                <span>Add Child Profile</span>
              </button>
            )}
          </div>

          {isLoadingChildren && (
            <div className="p-8 text-center text-[#657785] text-xs font-bold flex items-center justify-center gap-2">
              <Loader2 className="animate-spin text-[#083B56]" size={18} />
              <span>Loading society child roster...</span>
            </div>
          )}

          {!isLoadingChildren && children.length === 0 && !childrenError && (
            <div className="p-8 bg-white border border-[#E8F1F5] rounded-2xl text-center text-[#657785] text-xs font-semibold">
              No children registered in this society yet.
            </div>
          )}

          {/* SECTION A: Eligible Children Cards Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
            {children.map((child) => (
              <div
                key={child.id}
                style={{
                  background: '#ffffff',
                  border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
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
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.75rem' }}>
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
                      PROTECTED CHILD PASS
                    </span>
                    <span
                      style={{
                        fontSize: '0.625rem',
                        fontWeight: 800,
                        color: '#059669',
                        background: '#ECFDF5',
                        border: '1px solid #A7F3D0',
                        padding: '0.2rem 0.5rem',
                        borderRadius: '9999px',
                      }}
                    >
                      SAFE ON PREMISES
                    </span>
                  </div>

                  {/* Profile Row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                    <div
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
                      {child.childName.charAt(0).toUpperCase()}
                    </div>

                    <div>
                      <h2 style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--aarizo-text, #203746)', margin: 0 }}>
                        {child.childName}
                      </h2>
                      <p style={{ fontSize: '0.75rem', color: 'var(--aarizo-text-secondary, #657785)', margin: 0, marginTop: '0.125rem' }}>
                        Flat {child.flatCode} · Child
                      </p>
                      <p style={{ fontSize: '0.6875rem', color: 'var(--aarizo-blue, #176B91)', margin: 0, marginTop: '0.25rem', fontWeight: 600 }}>
                        Guardian: {child.guardianName} ({child.guardianPhone})
                      </p>
                    </div>
                  </div>
                </div>

                {/* Action Buttons Row */}
                <div style={{ display: 'flex', gap: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--aarizo-border, #DCE8EF)' }}>
                  {canGeneratePasses && (
                    <button
                      type="button"
                      data-testid={`generate-pass-child-${child.id}`}
                      onClick={() => handleOpenGeneratePassModal(child)}
                      style={{
                        flex: 1,
                        padding: '0.55rem 0.75rem',
                        borderRadius: '10px',
                        background: 'var(--aarizo-coral, #F06543)',
                        color: '#ffffff',
                        fontWeight: 800,
                        fontSize: '0.725rem',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.35rem',
                        boxShadow: '0 2px 8px rgba(240, 101, 67, 0.2)',
                      }}
                    >
                      <QrCode size={14} color="#ffffff" />
                      <span>Exit Pass</span>
                    </button>
                  )}

                  <button
                    type="button"
                    data-testid={`report-missing-btn-${child.id}`}
                    onClick={() => handleOpenStaffSosModal(child)}
                    style={{
                      flex: 1,
                      padding: '0.55rem 0.75rem',
                      borderRadius: '10px',
                      background: '#FEF2F2',
                      border: '1px solid #FECACA',
                      color: '#DC2626',
                      fontWeight: 800,
                      fontSize: '0.725rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.35rem',
                    }}
                  >
                    <AlertTriangle size={14} color="#DC2626" />
                    <span>Report Missing</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* SECTION B: Authorized Pickups & Escorts */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
              borderRadius: '16px',
              padding: '1.25rem',
              boxShadow: '0 2px 10px rgba(8, 59, 86, 0.05)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 800, color: 'var(--aarizo-navy, #083B56)', margin: 0 }}>
                  Authorized Pickups &amp; Escorts
                </h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--aarizo-text-secondary, #657785)', margin: 0, marginTop: '0.125rem' }}>
                  Verified caretakers authorized for gate pickup across registered children.
                </p>
              </div>

              {canManagePickups && (
                <button
                  type="button"
                  onClick={() => {
                    setFormError(null);
                    setModalMode('ADD_PICKUP');
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    padding: '0.4rem 0.75rem',
                    borderRadius: '8px',
                    background: 'var(--aarizo-light-blue, #EAF6FC)',
                    border: '1px solid var(--aarizo-border, #DCE8EF)',
                    color: 'var(--aarizo-navy, #083B56)',
                    fontWeight: 800,
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                  }}
                >
                  <UserPlus size={14} color="var(--aarizo-coral, #F06543)" />
                  <span>+ Add Escort</span>
                </button>
              )}
            </div>

            {/* Escort Cards */}
            {(() => {
              const allPickups: (AuthorizedPickupPerson & { childName?: string; childId: string })[] = [];
              children.forEach((c) => {
                (c.authorizedPickups || []).forEach((p) => {
                  allPickups.push({
                    ...p,
                    childId: c.id,
                    childName: c.childName,
                  });
                });
              });

              if (allPickups.length === 0) {
                return (
                  <div className="p-4 text-center text-[#657785] text-xs font-semibold">
                    No authorized escorts registered yet.
                  </div>
                );
              }

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                  {allPickups.map((escort) => (
                    <div
                      key={escort.id}
                      onClick={() => setSelectedEscortForDetail(escort)}
                      style={{
                        background: '#ffffff',
                        border: '1px solid var(--aarizo-border, #DCE8EF)',
                        borderRadius: '12px',
                        padding: '0.75rem 1rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.75rem',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: '50%',
                            background: 'var(--aarizo-pale-blue, #F4FAFE)',
                            border: '1px solid var(--aarizo-border, #DCE8EF)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--aarizo-navy, #083B56)',
                            fontWeight: 800,
                            fontSize: '0.875rem',
                            flexShrink: 0,
                          }}
                        >
                          {escort.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontSize: '0.875rem', fontWeight: 800, color: 'var(--aarizo-text, #203746)' }}>
                            {escort.name}{' '}
                            <span style={{ fontSize: '0.6875rem', color: 'var(--aarizo-text-secondary, #657785)', fontWeight: 600 }}>
                              ({escort.relationship})
                            </span>
                            {escort.childName && (
                              <span style={{ fontSize: '0.6875rem', color: 'var(--aarizo-blue, #176B91)', fontWeight: 600, marginLeft: '0.35rem' }}>
                                · for {escort.childName}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--aarizo-text-secondary, #657785)' }}>
                            📞 {escort.phone} · {escort.idProofType}: {escort.idProofNumber}
                          </div>
                        </div>
                      </div>

                      {canGeneratePasses && (
                        <button
                          type="button"
                          data-testid={`generate-pass-escort-${escort.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            const parentChild = children.find((c) => c.id === escort.childId);
                            if (parentChild) {
                              handleOpenGeneratePassModal(parentChild, escort.id);
                            }
                          }}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                            padding: '0.35rem 0.625rem',
                            borderRadius: '8px',
                            background: 'var(--aarizo-coral, #F06543)',
                            color: '#ffffff',
                            fontWeight: 800,
                            fontSize: '0.6875rem',
                            border: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          <QrCode size={12} color="#ffffff" />
                          <span>Pass</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* EXPERIENCE 3: COMMAND CONSOLE (ADMIN/SECURITY)                 */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeTab === 'COMMAND_CONSOLE' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div
            style={{
              background: '#ffffff',
              border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
              borderRadius: '16px',
              padding: '0.875rem 1.25rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              boxShadow: '0 2px 10px rgba(8, 59, 86, 0.04)',
              flexWrap: 'wrap',
              gap: '0.75rem',
            }}
          >
            <div>
              <h3 style={{ fontSize: '0.875rem', fontWeight: 800, color: 'var(--aarizo-navy, #083B56)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Live Incident Feed &amp; Response Console
              </h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--aarizo-text-secondary, #657785)', margin: 0, marginTop: '0.125rem' }}>
                Authoritative Child Safety alerts and society emergency dispatch feed.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              {/* Realtime Connection Status Pill */}
              <div
                data-testid="realtime-status-pill"
                data-status={connectionStatus}
                data-offline={String(isOffline)}
                title={`Realtime Status: ${connectionStatus}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.35rem 0.65rem',
                  borderRadius: '8px',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  background: isConnected ? '#ECFDF5' : isReconnecting ? '#FFFBEB' : '#FEF2F2',
                  border: `1px solid ${isConnected ? '#A7F3D0' : isReconnecting ? '#FDE68A' : '#FECACA'}`,
                  color: isConnected ? '#059669' : isReconnecting ? '#D97706' : '#DC2626',
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: isConnected ? '#10B981' : isReconnecting ? '#F59E0B' : '#EF4444',
                  }}
                />
                <span>{isConnected ? 'LIVE' : isReconnecting ? 'RECONNECTING' : 'OFFLINE'}</span>
              </div>

              {canManageAlerts && (
                <button
                  type="button"
                  data-testid="open-staff-sos-modal-btn"
                  onClick={() => handleOpenStaffSosModal()}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    padding: '0.45rem 0.85rem',
                    borderRadius: '10px',
                    background: '#DC2626',
                    color: '#ffffff',
                    fontWeight: 800,
                    fontSize: '0.75rem',
                    border: 'none',
                    cursor: 'pointer',
                    boxShadow: '0 2px 6px rgba(220, 38, 38, 0.25)',
                  }}
                >
                  <ShieldAlert size={14} color="#ffffff" />
                  <span>+ Staff Child SOS</span>
                </button>
              )}
              <button
                type="button"
                data-testid="refresh-console-btn"
                onClick={loadData}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  background: 'none',
                  border: '1px solid var(--aarizo-border, #DCE8EF)',
                  borderRadius: '10px',
                  padding: '0.45rem 0.75rem',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: 'var(--aarizo-coral, #F06543)',
                  cursor: 'pointer',
                }}
              >
                <RefreshCw size={13} color="var(--aarizo-coral, #F06543)" />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {/* Incident Filter Switcher */}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              data-testid="filter-all-btn"
              onClick={() => setIncidentFilter('ALL')}
              style={{
                padding: '0.35rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid',
                borderColor: incidentFilter === 'ALL' ? 'var(--aarizo-navy, #083B56)' : 'var(--aarizo-border, #DCE8EF)',
                background: incidentFilter === 'ALL' ? 'var(--aarizo-navy, #083B56)' : '#ffffff',
                color: incidentFilter === 'ALL' ? '#ffffff' : 'var(--aarizo-text, #203746)',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              All Active ({totalActiveIncidentsCount})
            </button>
            <button
              type="button"
              data-testid="filter-child-safety-btn"
              onClick={() => setIncidentFilter('CHILD_SAFETY')}
              style={{
                padding: '0.35rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid',
                borderColor: incidentFilter === 'CHILD_SAFETY' ? '#DC2626' : 'var(--aarizo-border, #DCE8EF)',
                background: incidentFilter === 'CHILD_SAFETY' ? '#DC2626' : '#ffffff',
                color: incidentFilter === 'CHILD_SAFETY' ? '#ffffff' : 'var(--aarizo-text, #203746)',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Child Safety ({activeChildAlerts.length})
            </button>
            <button
              type="button"
              data-testid="filter-general-btn"
              onClick={() => setIncidentFilter('GENERAL')}
              style={{
                padding: '0.35rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid',
                borderColor: incidentFilter === 'GENERAL' ? 'var(--aarizo-coral, #F06543)' : 'var(--aarizo-border, #DCE8EF)',
                background: incidentFilter === 'GENERAL' ? 'var(--aarizo-coral, #F06543)' : '#ffffff',
                color: incidentFilter === 'GENERAL' ? '#ffffff' : 'var(--aarizo-text, #203746)',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              General Emergencies ({activeGeneralIncidents.length})
            </button>
          </div>

          {childAlertsError && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold rounded-xl flex items-center gap-2 shadow-2xs">
              <AlertTriangle size={16} className="text-rose-600 shrink-0" />
              <span>{childAlertsError}</span>
            </div>
          )}

          {generalIncidentsError && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold rounded-xl flex items-center gap-2 shadow-2xs">
              <AlertTriangle size={16} className="text-rose-600 shrink-0" />
              <span>{generalIncidentsError}</span>
            </div>
          )}

          {/* FEED A: Child Safety Alerts Feed */}
          {(incidentFilter === 'ALL' || incidentFilter === 'CHILD_SAFETY') && (
            <div className="space-y-3">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 0.25rem' }}>
                <h4 style={{ fontSize: '0.8125rem', fontWeight: 800, color: 'var(--aarizo-navy, #083B56)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Child Safety Radar Alerts ({childAlerts.length})
                </h4>
                {isLoadingChildAlerts && (
                  <span style={{ fontSize: '0.7rem', color: '#657785', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Loader2 size={12} className="animate-spin" /> Updating alerts...
                  </span>
                )}
              </div>

              {childAlerts.length === 0 && !isLoadingChildAlerts && (
                <div className="p-6 bg-white border border-[#E8F1F5] rounded-2xl text-center text-[#657785] text-xs font-semibold">
                  No active Child Safety alerts for this society. Perimeter gates operating normally.
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {childAlerts.map((alert) => {
                  const isResolved = alert.status === 'RESOLVED' || alert.status === 'FALSE_ALARM';
                  const isAcknowledged = alert.status === 'ACKNOWLEDGED';
                  const isActive = alert.status === 'ACTIVE';

                  let statusBg = '#FEF2F2';
                  let statusBorder = '#FECACA';
                  let statusColor = '#DC2626';

                  if (isResolved) {
                    statusBg = '#ECFDF5';
                    statusBorder = '#A7F3D0';
                    statusColor = '#059669';
                  } else if (isAcknowledged) {
                    statusBg = '#FFFBEB';
                    statusBorder = '#FDE68A';
                    statusColor = '#D97706';
                  }

                  const alertCode = (alert as any).alertCode || alert.id.slice(0, 8).toUpperCase();

                  return (
                    <div
                      key={alert.id}
                      data-testid={`child-alert-card-${alert.id}`}
                      style={{
                        background: '#ffffff',
                        border: `1px solid ${isActive ? '#FECACA' : 'var(--aarizo-border-soft, #E8F1F5)'}`,
                        borderRadius: '16px',
                        padding: '1rem 1.25rem',
                        boxShadow: isActive ? '0 4px 14px rgba(220, 38, 38, 0.08)' : '0 2px 10px rgba(8, 59, 86, 0.05)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.75rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.625rem', fontWeight: 800, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', padding: '0.15rem 0.5rem', borderRadius: '6px' }}>
                            CHILD SAFETY
                          </span>
                          <span style={{ fontSize: '0.625rem', fontWeight: 800, color: '#083B56', background: '#EAF6FC', border: '1px solid #DCE8EF', padding: '0.15rem 0.5rem', borderRadius: '6px' }}>
                            {alert.alertType}
                          </span>
                          <span style={{ fontSize: '0.625rem', fontWeight: 800, color: alert.severity === 'CRITICAL' ? '#DC2626' : '#D97706', background: alert.severity === 'CRITICAL' ? '#FEF2F2' : '#FFFBEB', border: `1px solid ${alert.severity === 'CRITICAL' ? '#FECACA' : '#FDE68A'}`, padding: '0.15rem 0.5rem', borderRadius: '6px' }}>
                            {alert.severity}
                          </span>
                          <span style={{ fontSize: '0.75rem', fontWeight: 900, color: 'var(--aarizo-navy, #083B56)', fontFamily: 'monospace' }}>
                            {alertCode}
                          </span>
                        </div>

                        <span
                          style={{
                            fontSize: '0.625rem',
                            fontWeight: 800,
                            color: statusColor,
                            background: statusBg,
                            border: `1px solid ${statusBorder}`,
                            padding: '0.2rem 0.5rem',
                            borderRadius: '9999px',
                            textTransform: 'uppercase',
                          }}
                        >
                          {alert.status}
                        </span>
                      </div>

                      <div style={{ fontSize: '0.75rem', color: 'var(--aarizo-text-secondary, #657785)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <div>
                          Target Child: <strong style={{ color: 'var(--aarizo-text, #203746)' }}>{alert.childName || 'Unidentified'}</strong> ({alert.flatNumber ? `Flat ${alert.flatNumber}` : 'Flat not assigned'})
                        </div>
                        <div>
                          📍 Trigger Location: <strong style={{ color: 'var(--aarizo-text, #203746)' }}>{alert.location}</strong>
                        </div>
                        {alert.lastSeenDetails && (
                          <div>
                            👁️ Last Seen: <span style={{ color: 'var(--aarizo-text, #203746)' }}>{alert.lastSeenDetails}</span>
                          </div>
                        )}
                        {alert.description && (
                          <div style={{ color: '#475569', fontStyle: 'italic' }}>
                            "{alert.description}"
                          </div>
                        )}
                        <div style={{ fontSize: '0.7rem', color: '#94A3B8', marginTop: '0.15rem' }}>
                          Triggered: {new Date(alert.createdAt).toLocaleString()} by {alert.reportedByName || 'Staff / Guardian'}
                          {alert.acknowledgedAt && (
                            <span> · Acknowledged at {new Date(alert.acknowledgedAt).toLocaleTimeString()} by {alert.acknowledgedByName || 'Staff'}</span>
                          )}
                          {alert.resolvedAt && (
                            <span style={{ color: '#059669', fontWeight: 600 }}> · Resolved ({alert.status}) at {new Date(alert.resolvedAt).toLocaleTimeString()}: "{alert.resolutionNotes}"</span>
                          )}
                        </div>
                      </div>

                      {canManageAlerts && !isResolved && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--aarizo-border, #DCE8EF)', flexWrap: 'wrap' }}>
                          {isActive && (
                            <button
                              type="button"
                              data-testid={`ack-child-alert-${alert.id}`}
                              disabled={isAcknowledgingAlertId === alert.id}
                              onClick={() => handleAcknowledgeChildAlert(alert.id)}
                              style={{
                                padding: '0.4rem 0.85rem',
                                background: '#FFFBEB',
                                border: '1px solid #FDE68A',
                                color: '#D97706',
                                fontSize: '0.75rem',
                                fontWeight: 800,
                                borderRadius: '8px',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                              }}
                            >
                              {isAcknowledgingAlertId === alert.id ? <Loader2 size={13} className="animate-spin" /> : <Bell size={13} />}
                              <span>{isAcknowledgingAlertId === alert.id ? 'Acknowledging...' : 'Acknowledge Alert'}</span>
                            </button>
                          )}

                          <button
                            type="button"
                            data-testid={`resolve-child-alert-${alert.id}`}
                            onClick={() => handleOpenResolveModal(alert)}
                            style={{
                              padding: '0.4rem 0.85rem',
                              background: '#ECFDF5',
                              border: '1px solid #A7F3D0',
                              color: '#059669',
                              fontSize: '0.75rem',
                              fontWeight: 800,
                              borderRadius: '8px',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                            }}
                          >
                            <CheckCircle2 size={13} />
                            <span>Resolve Alert</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* FEED B: General Emergency Incidents Feed */}
          {(incidentFilter === 'ALL' || incidentFilter === 'GENERAL') && (
            <div className="space-y-3 pt-2">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 0.25rem' }}>
                <h4 style={{ fontSize: '0.8125rem', fontWeight: 800, color: 'var(--aarizo-navy, #083B56)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  General Society Emergencies ({generalIncidents.length})
                </h4>
                {isLoadingGeneralIncidents && (
                  <span style={{ fontSize: '0.7rem', color: '#657785', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Loader2 size={12} className="animate-spin" /> Updating feed...
                  </span>
                )}
              </div>

              {generalIncidents.length === 0 && !isLoadingGeneralIncidents && (
                <div className="p-6 bg-white border border-[#E8F1F5] rounded-2xl text-center text-[#657785] text-xs font-semibold">
                  No general emergency incidents currently reported.
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {generalIncidents.map((inc) => (
                  <div
                    key={inc.id}
                    data-testid={`general-incident-card-${inc.id}`}
                    style={{
                      background: '#ffffff',
                      border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
                      borderRadius: '16px',
                      padding: '1rem 1.25rem',
                      boxShadow: '0 2px 10px rgba(8, 59, 86, 0.05)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.75rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.625rem', fontWeight: 800, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', padding: '0.15rem 0.5rem', borderRadius: '6px' }}>
                          {inc.category}
                        </span>
                        <h4 style={{ fontSize: '0.9375rem', fontWeight: 800, color: 'var(--aarizo-text, #203746)', margin: 0 }}>
                          {inc.title}
                        </h4>
                      </div>
                      <span
                        style={{
                          fontSize: '0.625rem',
                          fontWeight: 800,
                          color: inc.status === 'RESOLVED' ? '#059669' : '#DC2626',
                          background: inc.status === 'RESOLVED' ? '#ECFDF5' : '#FEF2F2',
                          border: `1px solid ${inc.status === 'RESOLVED' ? '#A7F3D0' : '#FECACA'}`,
                          padding: '0.2rem 0.5rem',
                          borderRadius: '9999px',
                        }}
                      >
                        {inc.status}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.75rem', color: 'var(--aarizo-text-secondary, #657785)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <div>
                        Resident: <strong style={{ color: 'var(--aarizo-text, #203746)' }}>{inc.residentName}</strong> ({inc.flatCode}) {inc.phone ? `· Phone: ${inc.phone}` : ''}
                      </div>
                      <div>Location: {inc.location} · Triggered: {new Date(inc.createdAt).toLocaleString()}</div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--aarizo-border, #DCE8EF)', flexWrap: 'wrap' }}>
                      {isStaffRole && inc.status === 'TRIGGERED' && (
                        <button
                          type="button"
                          onClick={() => handleAcknowledge(inc.id)}
                          style={{
                            padding: '0.35rem 0.75rem',
                            background: '#FFFBEB',
                            border: '1px solid #FDE68A',
                            color: '#D97706',
                            fontSize: '0.75rem',
                            fontWeight: 800,
                            borderRadius: '8px',
                            cursor: 'pointer',
                          }}
                        >
                          Acknowledge Alert
                        </button>
                      )}

                      {isStaffRole && (inc.status === 'TRIGGERED' || inc.status === 'ACKNOWLEDGED') && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedIncident(inc);
                            setModalMode('ASSIGN_RESPONDER');
                          }}
                          style={{
                            padding: '0.35rem 0.75rem',
                            background: 'var(--aarizo-navy, #083B56)',
                            color: '#ffffff',
                            fontSize: '0.75rem',
                            fontWeight: 800,
                            borderRadius: '8px',
                            border: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          Assign Responder
                        </button>
                      )}

                      {isStaffRole && inc.status !== 'RESOLVED' && inc.status !== 'CLOSED' && (
                        <button
                          type="button"
                          disabled={isResolvingGeneralIncidentId === inc.id}
                          onClick={() => handleResolveGeneralIncident(inc.id)}
                          style={{
                            padding: '0.35rem 0.75rem',
                            background: '#ECFDF5',
                            border: '1px solid #A7F3D0',
                            color: '#059669',
                            fontSize: '0.75rem',
                            fontWeight: 800,
                            borderRadius: '8px',
                            cursor: 'pointer',
                          }}
                        >
                          {isResolvingGeneralIncidentId === inc.id ? 'Resolving...' : 'Mark Resolved'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* EXPERIENCE 4: GATE VERIFIER (ADMIN/SECURITY)                   */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeTab === 'GATE_VERIFIER' && (
        <div
          data-testid="gate-verifier-redirection-panel"
          style={{
            background: '#ffffff',
            border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
            borderRadius: '16px',
            padding: '2rem 1.5rem',
            boxShadow: '0 2px 10px rgba(8, 59, 86, 0.05)',
            maxWidth: '580px',
            margin: '0 auto',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1.25rem',
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '16px',
              background: 'var(--aarizo-pale-blue, #F4FAFE)',
              border: '1px solid var(--aarizo-border, #DCE8EF)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--aarizo-navy, #083B56)',
            }}
          >
            <QrCode size={30} />
          </div>

          <div>
            <h3
              style={{
                fontSize: '1.15rem',
                fontWeight: 800,
                color: 'var(--aarizo-navy, #083B56)',
                margin: 0,
              }}
            >
              Dedicated Gate Scanner Redirection
            </h3>
            <p
              style={{
                fontSize: '0.8rem',
                color: 'var(--aarizo-text-secondary, #657785)',
                margin: '0.5rem 0 0',
                lineHeight: 1.5,
              }}
            >
              For tenant privacy and perimeter security, child gate-pass verification is not processed in this administration hub. All physical exit verifications must be scanned through the dedicated Gate Scanner Terminal.
            </p>
          </div>

          <div
            style={{
              background: '#FFFBEB',
              border: '1px solid #FDE68A',
              borderRadius: '12px',
              padding: '0.85rem 1rem',
              color: '#92400E',
              fontSize: '0.75rem',
              lineHeight: 1.45,
              textAlign: 'left',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.5rem',
              width: '100%',
            }}
          >
            <Lock size={16} style={{ color: '#D97706', flexShrink: 0, marginTop: 2 }} />
            <span>
              <strong>Cryptographic Verification:</strong> Gate verification requires 256-bit single-use token validation and real-time gate lockdown checks. Guards and security operators should use the official perimeter scanner terminal.
            </span>
          </div>

          <a
            href="/security/child-safety"
            data-testid="open-child-gate-scanner-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              padding: '0.75rem 1.5rem',
              borderRadius: '12px',
              background: 'var(--aarizo-coral, #F06543)',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '0.85rem',
              textDecoration: 'none',
              boxShadow: '0 2px 8px rgba(240, 101, 67, 0.25)',
            }}
          >
            <QrCode size={16} />
            <span>Open Child Gate Scanner</span>
          </a>
        </div>
      )}

      {/* AUTHORIZED ESCORT DETAILS MODAL */}
      <Modal
        isOpen={!!selectedEscortForDetail}
        onClose={() => setSelectedEscortForDetail(null)}
        title="Authorized Escort Details"
        subtitle="Security verified escort profile for child pickup"
        icon={<Users size={20} />}
        maxWidth="540px"
      >
        {selectedEscortForDetail && (
          <div className="space-y-4">
            <div className="bg-[#F8FAFC] border border-slate-200/80 p-4 rounded-2xl flex items-center justify-between gap-3">
              <div className="flex items-center gap-3.5">
                <img
                  src={selectedEscortForDetail.photoUrl || 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=400&q=80'}
                  alt={selectedEscortForDetail.name}
                  className="w-14 h-14 rounded-2xl object-cover border border-slate-200 shadow-2xs shrink-0"
                />
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-extrabold text-slate-900 text-base">{selectedEscortForDetail.name}</h4>
                    <span className="px-2.5 py-0.5 rounded-lg text-xs font-bold bg-slate-200/80 text-slate-700">
                      {selectedEscortForDetail.relationship}
                    </span>
                  </div>
                  <p className="text-xs text-[#176B91] font-bold flex items-center gap-1">
                    <Phone size={12} /> {selectedEscortForDetail.phone}
                  </p>
                  <p className="text-xs text-slate-500 font-medium flex items-center gap-1">
                    <IdCard size={12} /> {selectedEscortForDetail.idProofType}: {selectedEscortForDetail.idProofNumber}
                  </p>
                </div>
              </div>

              <span className="px-3 py-1 rounded-full text-xs font-extrabold bg-emerald-100 text-emerald-800 uppercase shrink-0">
                APPROVED
              </span>
            </div>

            <div className="bg-slate-50/80 border border-slate-200/70 p-4 rounded-2xl space-y-3">
              <h4 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                <Users className="w-4 h-4 text-[#F06543]" />
                <span>Escort Information</span>
              </h4>
              <div className="space-y-2 text-xs divide-y divide-slate-200/60">
                <div className="flex justify-between pt-1">
                  <span className="text-slate-500 font-medium">Relationship:</span>
                  <strong className="text-slate-900 font-bold">{selectedEscortForDetail.relationship}</strong>
                </div>
                <div className="flex justify-between pt-2">
                  <span className="text-slate-500 font-medium">ID Type:</span>
                  <strong className="text-slate-900 font-bold">{selectedEscortForDetail.idProofType}</strong>
                </div>
                <div className="flex justify-between pt-2">
                  <span className="text-slate-500 font-medium">ID Number:</span>
                  <strong className="text-slate-900 font-bold">{selectedEscortForDetail.idProofNumber}</strong>
                </div>
                <div className="flex justify-between pt-2">
                  <span className="text-slate-500 font-medium">Contact Number:</span>
                  <strong className="text-slate-900 font-bold">{selectedEscortForDetail.phone}</strong>
                </div>
              </div>
            </div>

            <div className="bg-[#F0F9FF] border border-[#BAE6FD] p-4 rounded-2xl space-y-2">
              <h4 className="text-xs font-extrabold text-[#0369A1] uppercase tracking-wider flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-[#0284C7]" />
                <span>Permissions</span>
              </h4>
              <ul className="space-y-1.5 text-xs text-slate-700 font-medium">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Authorized to pick up child from gate</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Can generate gate exit passes</span>
                </li>
              </ul>
            </div>

            <div className="flex items-center gap-3 pt-2">
              {canManagePickups && (
                <button
                  type="button"
                  disabled={isRevokingPickupId === selectedEscortForDetail.id}
                  onClick={() => {
                    handleRemoveEscort(
                      (selectedEscortForDetail as any).childId || children[0]?.id || '',
                      selectedEscortForDetail.id
                    );
                  }}
                  className="flex-1 py-3 px-4 bg-white border border-rose-300 text-rose-600 hover:bg-rose-50 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                >
                  <Trash2 size={15} />
                  <span>{isRevokingPickupId === selectedEscortForDetail.id ? 'Revoking...' : 'Remove Escort'}</span>
                </button>
              )}

              {canGeneratePasses && (
                <button
                  type="button"
                  data-testid="detail-generate-pass-btn"
                  onClick={() => {
                    const parentChild = children.find(
                      (c) => c.id === (selectedEscortForDetail as any).childId
                    ) || children[0];
                    if (parentChild) {
                      handleOpenGeneratePassModal(parentChild, selectedEscortForDetail.id);
                    }
                    setSelectedEscortForDetail(null);
                  }}
                  className="flex-1 py-3 px-4 bg-[#F06543] hover:bg-[#D95333] text-white font-extrabold text-xs rounded-xl shadow-md flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <QrCode size={15} />
                  <span>Generate Pass</span>
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Modal: Assign Responder */}
      <Modal
        isOpen={modalMode === 'ASSIGN_RESPONDER' && !!selectedIncident}
        onClose={() => setModalMode(null)}
        title="Assign Emergency Responder"
        subtitle="Dispatch society guard or supervisor to incident location"
        icon={<Radio size={20} />}
        maxWidth="460px"
        footer={
          <div className="flex justify-end gap-2 w-full">
            <button
              type="button"
              onClick={() => setModalMode(null)}
              className="px-4 py-2.5 text-xs font-bold rounded-xl border border-slate-200 bg-slate-100 text-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                const form = document.getElementById('assign-responder-form') as HTMLFormElement;
                if (form) form.requestSubmit();
              }}
              className="px-5 py-2.5 text-xs font-extrabold rounded-xl shadow-md bg-[#083B56] text-white"
            >
              Dispatch Responder
            </button>
          </div>
        }
      >
        <form id="assign-responder-form" onSubmit={handleAssignSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-extrabold text-slate-700 mb-1">Responder Name</label>
            <input
              type="text"
              required
              value={responderForm.responderName}
              onChange={(e) => setResponderForm({ ...responderForm, responderName: e.target.value })}
              className="w-full px-3.5 py-2.5 border rounded-xl text-xs font-bold"
            />
          </div>

          <div>
            <label className="block text-xs font-extrabold text-slate-700 mb-1">Responder Role</label>
            <input
              type="text"
              required
              value={responderForm.responderRole}
              onChange={(e) => setResponderForm({ ...responderForm, responderRole: e.target.value })}
              className="w-full px-3.5 py-2.5 border rounded-xl text-xs font-bold"
            />
          </div>
        </form>
      </Modal>

      {/* Modal: Authoritative Gate Exit Pass Generation */}
      <Modal
        isOpen={modalMode === 'GENERATE_PASS'}
        onClose={handleClosePassModal}
        title={generatedPass ? 'Child Gate Exit Pass Ready' : 'Generate Child Gate Exit Pass'}
        subtitle={
          generatedPass
            ? `One-time QR pass for ${passChild?.childName || 'child'}`
            : `Issue authoritative gate verification pass for ${passChild?.childName || 'child'}`
        }
        icon={<QrCode size={20} />}
        maxWidth="480px"
        footer={
          generatedPass ? (
            <div style={{ display: 'flex', width: '100%' }}>
              <button
                type="button"
                data-testid="dismiss-one-time-qr-btn"
                onClick={handleClosePassModal}
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem',
                  borderRadius: '12px',
                  background: 'var(--aarizo-navy, #083B56)',
                  color: '#FFFFFF',
                  fontWeight: 800,
                  fontSize: '0.85rem',
                  border: 'none',
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(8, 59, 86, 0.25)',
                }}
              >
                Done — Clear One-Time QR
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '0.625rem', width: '100%' }}>
              <button
                type="button"
                onClick={handleClosePassModal}
                style={{
                  flex: 1,
                  padding: '0.75rem 1rem',
                  borderRadius: '12px',
                  background: '#FFFFFF',
                  border: '1px solid #DCE8EF',
                  color: '#475569',
                  fontWeight: 800,
                  fontSize: '0.8125rem',
                  cursor: 'pointer',
                  minHeight: '44px',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="submit-generate-pass-btn"
                disabled={isSubmittingPass || (!passEscortId && (passChild?.authorizedPickups?.length || 0) > 0)}
                onClick={() => {
                  const form = document.getElementById('generate-pass-form') as HTMLFormElement;
                  if (form) form.requestSubmit();
                }}
                style={{
                  flex: 1,
                  padding: '0.75rem 1rem',
                  borderRadius: '12px',
                  background: 'var(--aarizo-coral, #F06543)',
                  color: '#FFFFFF',
                  fontWeight: 800,
                  fontSize: '0.8125rem',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.45rem',
                  boxShadow: '0 2px 8px rgba(240, 101, 67, 0.25)',
                  minHeight: '44px',
                  opacity: isSubmittingPass || (!passEscortId && (passChild?.authorizedPickups?.length || 0) > 0) ? 0.6 : 1,
                }}
              >
                {isSubmittingPass ? <Loader2 size={15} className="animate-spin" /> : <QrCode size={15} />}
                <span>{isSubmittingPass ? 'Generating...' : 'Confirm & Issue Pass'}</span>
              </button>
            </div>
          )
        }
      >
        {generatedPass ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', textAlign: 'center' }}>
            <div
              style={{
                background: '#FFFBEB',
                border: '1px solid #FDE68A',
                borderRadius: '10px',
                padding: '0.65rem 0.85rem',
                fontSize: '0.74rem',
                color: '#92400E',
                fontWeight: 700,
                lineHeight: 1.45,
                textAlign: 'left',
                width: '100%',
              }}
            >
              🔒 <strong>Security Notice:</strong> This QR code is shown <strong>ONCE</strong> and is never saved in browser memory or persistent storage. Closing this dialog clears the QR code immediately.
            </div>

            <div
              data-testid="one-time-qr-svg-container"
              style={{
                padding: '1rem',
                background: '#FFFFFF',
                borderRadius: '16px',
                border: '1px solid #DCE8EF',
                boxShadow: '0 4px 14px rgba(8, 59, 86, 0.08)',
                display: 'inline-block',
              }}
            >
              <QRCodeSVG value={generatedPass.qrPayload} size={200} level="M" />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8rem', color: '#334155' }}>
              <div style={{ fontFamily: 'monospace', fontSize: '1rem', fontWeight: 900, color: 'var(--aarizo-navy, #083B56)' }}>
                Pass Code: {generatedPass.passCode}
              </div>
              <div>
                Child: <strong>{generatedPass.childName}</strong> (Flat {generatedPass.flatNumber})
              </div>
              <div>
                Authorized Escort: <strong>{generatedPass.pickupPersonName}</strong>
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748B' }}>
                Valid Until: {new Date(generatedPass.validUntil).toLocaleString()}
              </div>
            </div>
          </div>
        ) : (
          <form id="generate-pass-form" onSubmit={handleGeneratePassSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {passFormError && (
              <div
                role="alert"
                style={{
                  background: '#FEF2F2',
                  border: '1px solid #FECACA',
                  borderRadius: '10px',
                  padding: '0.65rem 0.85rem',
                  fontSize: '0.75rem',
                  color: '#991B1B',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
              >
                <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                <span>{passFormError}</span>
              </div>
            )}

            <div
              style={{
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: '12px',
                padding: '0.75rem',
                fontSize: '0.75rem',
              }}
            >
              <div style={{ color: '#334155', fontWeight: 700 }}>
                Child: <span style={{ color: 'var(--aarizo-navy, #083B56)', fontWeight: 800 }}>{passChild?.childName}</span> (Flat {passChild?.flatCode})
              </div>
              <div style={{ color: '#64748B', fontSize: '0.7rem', marginTop: '0.15rem' }}>
                Guardian: {passChild?.guardianName} ({passChild?.guardianPhone})
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>
                Select Authorized Escort *
              </label>
              {(passChild?.authorizedPickups?.length || 0) > 0 ? (
                <select
                  required
                  value={passEscortId}
                  onChange={(e) => setPassEscortId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.8rem',
                    borderRadius: '10px',
                    border: '1px solid #CBD5E1',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    background: '#FFFFFF',
                  }}
                >
                  <option value="" disabled>-- Select verified escort --</option>
                  {passChild?.authorizedPickups.map((escort) => (
                    <option key={escort.id} value={escort.id}>
                      {escort.name} ({escort.relationship}) — {escort.phone}
                    </option>
                  ))}
                </select>
              ) : (
                <div
                  style={{
                    background: '#FEF2F2',
                    border: '1px solid #FECACA',
                    borderRadius: '10px',
                    padding: '0.65rem 0.85rem',
                    fontSize: '0.75rem',
                    color: '#991B1B',
                    fontWeight: 600,
                  }}
                >
                  No verified authorized escorts found for this child. An authorized escort must be added before an exit pass can be issued.
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>
                  Pass Validity Window
                </label>
                <select
                  value={passDurationHours}
                  onChange={(e) => setPassDurationHours(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.8rem',
                    borderRadius: '10px',
                    border: '1px solid #CBD5E1',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    background: '#FFFFFF',
                  }}
                >
                  <option value={2}>2 Hours</option>
                  <option value={4}>4 Hours (Standard)</option>
                  <option value={8}>8 Hours (Full Day)</option>
                  <option value={24}>24 Hours</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>
                  Max Uses
                </label>
                <input
                  type="text"
                  value="1 (Single Exit)"
                  disabled
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.8rem',
                    borderRadius: '10px',
                    border: '1px solid #CBD5E1',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    background: '#F1F5F9',
                    color: '#64748B',
                  }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>
                Optional Notes
              </label>
              <input
                type="text"
                placeholder="e.g. Authorized school bus pickup"
                value={passNotes}
                onChange={(e) => setPassNotes(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.6rem 0.8rem',
                  borderRadius: '10px',
                  border: '1px solid #CBD5E1',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                }}
              />
            </div>
          </form>
        )}
      </Modal>

      {/* Modal: Add Child Profile */}
      <Modal
        isOpen={modalMode === 'ADD_CHILD'}
        onClose={() => {
          setFormError(null);
          setModalMode(null);
        }}
        title="Register Child Profile"
        subtitle="Enable gate exit tracking, escort passes, and missing radar"
        icon={<UserPlus size={20} />}
        maxWidth="500px"
      >
        <form onSubmit={handleAddChildSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', paddingTop: '0.25rem' }}>
          {formError && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold rounded-xl flex items-center gap-2">
              <AlertTriangle size={15} className="text-rose-600 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}>
              Child Full Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Aarav Malhotra"
              value={childForm.childName}
              onChange={(e) => setChildForm({ ...childForm, childName: e.target.value })}
              style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}>
                Resident ID *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. res-1"
                value={childForm.residentId}
                onChange={(e) => setChildForm({ ...childForm, residentId: e.target.value })}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}>
                Flat ID *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. flat-101"
                value={childForm.flatId}
                onChange={(e) => setChildForm({ ...childForm, flatId: e.target.value })}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}>
                Flat Code
              </label>
              <input
                type="text"
                value={childForm.flatCode}
                onChange={(e) => setChildForm({ ...childForm, flatCode: e.target.value })}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}>
                Age
              </label>
              <input
                type="number"
                min="1"
                max="17"
                value={childForm.age}
                onChange={(e) => setChildForm({ ...childForm, age: e.target.value })}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}>
                Primary Guardian Name *
              </label>
              <input
                type="text"
                required
                value={childForm.guardianName}
                onChange={(e) => setChildForm({ ...childForm, guardianName: e.target.value })}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.25rem' }}>
                Guardian Phone *
              </label>
              <input
                type="tel"
                required
                value={childForm.guardianPhone}
                onChange={(e) => setChildForm({ ...childForm, guardianPhone: e.target.value })}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid #E2E8F0' }}>
            <button
              type="button"
              onClick={() => {
                setFormError(null);
                setModalMode(null);
              }}
              style={{
                flex: 1,
                padding: '0.65rem',
                borderRadius: '10px',
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#475569',
                fontWeight: 700,
                fontSize: '0.8125rem',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmittingChild}
              style={{
                flex: 2,
                padding: '0.65rem',
                borderRadius: '10px',
                border: 'none',
                background: 'var(--aarizo-navy, #083B56)',
                color: '#FFFFFF',
                fontWeight: 800,
                fontSize: '0.8125rem',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(8, 59, 86, 0.25)',
                opacity: isSubmittingChild ? 0.7 : 1,
              }}
            >
              {isSubmittingChild ? 'Registering...' : 'Register Child'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Add Escort / Pickup */}
      <Modal
        isOpen={modalMode === 'ADD_PICKUP'}
        onClose={() => {
          setFormError(null);
          setModalMode(null);
        }}
        title="Add Authorized Escort"
        subtitle="Register trusted pickup person or escort for child safety"
        icon={<UserPlus size={20} />}
        maxWidth="480px"
        footer={
          <div className="flex justify-end gap-2 w-full">
            <button
              type="button"
              onClick={() => {
                setFormError(null);
                setModalMode(null);
              }}
              className="px-4 py-2.5 text-xs font-bold rounded-xl border border-slate-200 bg-slate-100 text-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSubmittingPickup}
              onClick={() => {
                const form = document.getElementById('add-pickup-form') as HTMLFormElement;
                if (form) form.requestSubmit();
              }}
              className="px-5 py-2.5 text-white text-xs font-extrabold rounded-xl shadow-md bg-[#F06543] disabled:opacity-70"
            >
              {isSubmittingPickup ? 'Saving...' : 'Save Escort'}
            </button>
          </div>
        }
      >
        <form id="add-pickup-form" onSubmit={handleAddPickupSubmit} className="space-y-3.5">
          {formError && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold rounded-xl flex items-center gap-2">
              <AlertTriangle size={15} className="text-rose-600 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          {children.length > 1 && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Select Child Profile *</label>
              <select
                value={selectedChildForPickupId || children[0]?.id || ''}
                onChange={(e) => setSelectedChildForPickupId(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-xs font-bold bg-white"
              >
                {children.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.childName} (Flat {c.flatCode})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Full Name *</label>
            <input
              type="text"
              required
              value={pickupForm.name}
              onChange={(e) => setPickupForm({ ...pickupForm, name: e.target.value })}
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-xs font-bold"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Phone *</label>
              <input
                type="text"
                required
                value={pickupForm.phone}
                onChange={(e) => setPickupForm({ ...pickupForm, phone: e.target.value })}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-xs font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Relationship *</label>
              <input
                type="text"
                required
                value={pickupForm.relationship}
                onChange={(e) => setPickupForm({ ...pickupForm, relationship: e.target.value })}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-xs font-bold"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">ID Document Type</label>
              <select
                value={pickupForm.idDocumentType}
                onChange={(e) => setPickupForm({ ...pickupForm, idDocumentType: e.target.value })}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-xs font-bold bg-white"
              >
                <option value="Aadhaar Card">Aadhaar Card</option>
                <option value="Driving License">Driving License</option>
                <option value="Passport">Passport</option>
                <option value="Voter ID">Voter ID</option>
                <option value="Other Govt ID">Other Govt ID</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">ID Last 4 Digits (Optional)</label>
              <input
                type="text"
                maxLength={4}
                placeholder="e.g. 9901"
                value={pickupForm.idDocumentLast4}
                onChange={(e) =>
                  setPickupForm({
                    ...pickupForm,
                    idDocumentLast4: e.target.value.replace(/\D/g, '').slice(0, 4),
                  })
                }
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-xs font-bold"
              />
            </div>
          </div>
        </form>
      </Modal>

      {/* Modal: Real Backend-Authoritative Staff Child Safety SOS */}
      <Modal
        isOpen={modalMode === 'STAFF_CHILD_SOS'}
        onClose={() => {
          setStaffSosError(null);
          setModalMode(null);
        }}
        title="Dispatch Child Safety SOS"
        subtitle="Broadcast emergency lockdown alarm to perimeter gates & guard terminals"
        icon={<ShieldAlert size={20} color="#DC2626" />}
        maxWidth="540px"
        footer={
          <div style={{ display: 'flex', gap: '0.625rem', width: '100%' }}>
            <button
              type="button"
              onClick={() => {
                setStaffSosError(null);
                setModalMode(null);
              }}
              style={{
                flex: 1,
                padding: '0.75rem 1rem',
                borderRadius: '12px',
                background: '#FFFFFF',
                border: '1px solid #DCE8EF',
                color: '#475569',
                fontWeight: 800,
                fontSize: '0.8125rem',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="submit-staff-sos-btn"
              disabled={isSubmittingStaffSos || !staffSosLocation.trim()}
              onClick={() => {
                const form = document.getElementById('staff-child-sos-form') as HTMLFormElement;
                if (form) form.requestSubmit();
              }}
              style={{
                flex: 2,
                padding: '0.75rem 1rem',
                borderRadius: '12px',
                background: '#DC2626',
                color: '#FFFFFF',
                fontWeight: 800,
                fontSize: '0.8125rem',
                border: 'none',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.45rem',
                boxShadow: '0 2px 8px rgba(220, 38, 38, 0.3)',
                opacity: isSubmittingStaffSos || !staffSosLocation.trim() ? 0.6 : 1,
              }}
            >
              {isSubmittingStaffSos ? <Loader2 size={15} className="animate-spin" /> : <ShieldAlert size={15} />}
              <span>{isSubmittingStaffSos ? 'Dispatching Alarm...' : 'DISPATCH SOS ALARM'}</span>
            </button>
          </div>
        }
      >
        <form
          id="staff-child-sos-form"
          data-testid="staff-child-sos-modal"
          onSubmit={handleStaffSosSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
        >
          {staffSosError && (
            <div
              role="alert"
              style={{
                background: '#FEF2F2',
                border: '1px solid #FECACA',
                borderRadius: '10px',
                padding: '0.65rem 0.85rem',
                fontSize: '0.75rem',
                color: '#991B1B',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              <AlertTriangle size={15} style={{ flexShrink: 0 }} />
              <span>{staffSosError}</span>
            </div>
          )}

          <div
            style={{
              padding: '0.75rem 0.875rem',
              background: '#FFF1F2',
              borderRadius: '12px',
              border: '1px solid #FECDD3',
              fontSize: '0.75rem',
              color: '#9F1239',
              lineHeight: 1.45,
            }}
          >
            <strong style={{ display: 'block', marginBottom: '0.2rem', color: '#881337' }}>
              🚨 Society-Wide Perimeter Gate Alert
            </strong>
            Triggering this alarm broadcasts an urgent alert to all security guard terminals, perimeter barrier controls, and mobile patrol units.
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>
              Target Child (Optional if unidentified child on grounds)
            </label>
            <select
              value={staffSosChildId}
              onChange={(e) => {
                const cid = e.target.value;
                setStaffSosChildId(cid);
                const c = children.find((item) => item.id === cid);
                if (c) {
                  setStaffSosLocation(`Near Flat ${c.flatCode}`);
                  setStaffSosDescription(`Missing child report: ${c.childName}`);
                }
              }}
              style={{
                width: '100%',
                padding: '0.6rem 0.8rem',
                borderRadius: '10px',
                border: '1px solid #CBD5E1',
                fontSize: '0.8rem',
                fontWeight: 600,
                background: '#FFFFFF',
              }}
            >
              <option value="">-- Unidentified / Wandering Child on Grounds --</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.childName} (Flat {c.flatCode}) · Guardian: {c.guardianName}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>
                Alert Type *
              </label>
              <select
                value={staffSosAlertType}
                onChange={(e) => setStaffSosAlertType(e.target.value as ChildAlertTypeDto)}
                style={{
                  width: '100%',
                  padding: '0.6rem 0.8rem',
                  borderRadius: '10px',
                  border: '1px solid #CBD5E1',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  background: '#FFFFFF',
                }}
              >
                <option value="MISSING_CHILD">MISSING CHILD</option>
                <option value="UNAUTHORIZED_EXIT_ATTEMPT">UNAUTHORIZED EXIT ATTEMPT</option>
                <option value="UNATTENDED_CHILD">UNATTENDED CHILD</option>
                <option value="EMERGENCY_SOS">EMERGENCY SOS</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>
                Severity *
              </label>
              <select
                value={staffSosSeverity}
                onChange={(e) => setStaffSosSeverity(e.target.value as IncidentSeverityDto)}
                style={{
                  width: '100%',
                  padding: '0.6rem 0.8rem',
                  borderRadius: '10px',
                  border: '1px solid #CBD5E1',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  background: '#FFFFFF',
                }}
              >
                <option value="CRITICAL">CRITICAL (Immediate Lockdown)</option>
                <option value="HIGH">HIGH (Urgent Patrol Required)</option>
                <option value="MEDIUM">MEDIUM (Gate Check)</option>
              </select>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>
              Incident Location *
            </label>
            <input
              type="text"
              required
              data-testid="staff-sos-location-input"
              placeholder="e.g. Podium Garden, Gate 2, Basement Parking..."
              value={staffSosLocation}
              onChange={(e) => setStaffSosLocation(e.target.value)}
              style={{
                width: '100%',
                padding: '0.6rem 0.8rem',
                borderRadius: '10px',
                border: '1px solid #CBD5E1',
                fontSize: '0.8rem',
                fontWeight: 600,
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>
              Last Seen Details (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Near Tower C Swimming Pool at 4:15 PM wearing blue shirt"
              value={staffSosLastSeen}
              onChange={(e) => setStaffSosLastSeen(e.target.value)}
              style={{
                width: '100%',
                padding: '0.6rem 0.8rem',
                borderRadius: '10px',
                border: '1px solid #CBD5E1',
                fontSize: '0.8rem',
                fontWeight: 500,
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>
              Description / Action Required
            </label>
            <textarea
              rows={2}
              placeholder="Provide key notes for guards and responders..."
              value={staffSosDescription}
              onChange={(e) => setStaffSosDescription(e.target.value)}
              style={{
                width: '100%',
                padding: '0.6rem 0.8rem',
                borderRadius: '10px',
                border: '1px solid #CBD5E1',
                fontSize: '0.8rem',
                fontWeight: 500,
                resize: 'none',
              }}
            />
          </div>
        </form>
      </Modal>

      {/* Modal: Authoritative Staff Resolve Child Alert */}
      <Modal
        isOpen={modalMode === 'RESOLVE_CHILD_ALERT'}
        onClose={() => {
          setResolveError(null);
          setModalMode(null);
          setSelectedAlertForResolve(null);
        }}
        title="Resolve Child Safety Alert"
        subtitle={`Close alert for ${selectedAlertForResolve?.childName || 'incident'}`}
        icon={<CheckCircle2 size={20} color="#059669" />}
        maxWidth="480px"
        footer={
          <div style={{ display: 'flex', gap: '0.625rem', width: '100%' }}>
            <button
              type="button"
              onClick={() => {
                setResolveError(null);
                setModalMode(null);
                setSelectedAlertForResolve(null);
              }}
              style={{
                flex: 1,
                padding: '0.75rem 1rem',
                borderRadius: '12px',
                background: '#FFFFFF',
                border: '1px solid #DCE8EF',
                color: '#475569',
                fontWeight: 800,
                fontSize: '0.8125rem',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="submit-resolve-alert-btn"
              disabled={isResolvingAlert || !resolveNotes.trim()}
              onClick={() => {
                const form = document.getElementById('resolve-child-alert-form') as HTMLFormElement;
                if (form) form.requestSubmit();
              }}
              style={{
                flex: 2,
                padding: '0.75rem 1rem',
                borderRadius: '12px',
                background: '#059669',
                color: '#FFFFFF',
                fontWeight: 800,
                fontSize: '0.8125rem',
                border: 'none',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.45rem',
                boxShadow: '0 2px 8px rgba(5, 150, 105, 0.3)',
                opacity: isResolvingAlert || !resolveNotes.trim() ? 0.6 : 1,
              }}
            >
              {isResolvingAlert ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              <span>{isResolvingAlert ? 'Resolving...' : 'Confirm Resolution'}</span>
            </button>
          </div>
        }
      >
        <form
          id="resolve-child-alert-form"
          data-testid="resolve-child-alert-modal"
          onSubmit={handleResolveChildAlertSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
        >
          {resolveError && (
            <div
              role="alert"
              style={{
                background: '#FEF2F2',
                border: '1px solid #FECACA',
                borderRadius: '10px',
                padding: '0.65rem 0.85rem',
                fontSize: '0.75rem',
                color: '#991B1B',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              <AlertTriangle size={15} style={{ flexShrink: 0 }} />
              <span>{resolveError}</span>
            </div>
          )}

          {selectedAlertForResolve && (
            <div
              style={{
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: '12px',
                padding: '0.75rem',
                fontSize: '0.75rem',
              }}
            >
              <div style={{ color: '#334155', fontWeight: 700 }}>
                Child: <span style={{ color: 'var(--aarizo-navy, #083B56)', fontWeight: 800 }}>{selectedAlertForResolve.childName || 'Unidentified'}</span> (Flat {selectedAlertForResolve.flatNumber || 'N/A'})
              </div>
              <div style={{ color: '#64748B', fontSize: '0.7rem', marginTop: '0.2rem' }}>
                Location: {selectedAlertForResolve.location} · Alert Type: {selectedAlertForResolve.alertType}
              </div>
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>
              Resolution Status *
            </label>
            <select
              value={resolveStatus}
              onChange={(e) => setResolveStatus(e.target.value as 'RESOLVED' | 'FALSE_ALARM')}
              style={{
                width: '100%',
                padding: '0.6rem 0.8rem',
                borderRadius: '10px',
                border: '1px solid #CBD5E1',
                fontSize: '0.8rem',
                fontWeight: 700,
                background: '#FFFFFF',
              }}
            >
              <option value="RESOLVED">RESOLVED — Child Safely Located / Normal Operations Restored</option>
              <option value="FALSE_ALARM">FALSE ALARM — Accidental Trigger / Test Drill</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>
              Resolution Notes *
            </label>
            <textarea
              required
              rows={3}
              data-testid="resolve-notes-textarea"
              placeholder="Document the resolution details, location found, and verified escort/guardian..."
              value={resolveNotes}
              onChange={(e) => setResolveNotes(e.target.value)}
              style={{
                width: '100%',
                padding: '0.6rem 0.8rem',
                borderRadius: '10px',
                border: '1px solid #CBD5E1',
                fontSize: '0.8rem',
                fontWeight: 500,
                resize: 'none',
              }}
            />
          </div>
        </form>
      </Modal>

      {/* Modal: Real Backend-Authoritative Resident Child Safety SOS */}
      <ResidentChildSosModal
        isOpen={isResidentSosModalOpen}
        onClose={() => setIsResidentSosModalOpen(false)}
        currentUser={currentUser}
        onSosDispatched={() => {
          loadData();
          setAlertSuccess('CHILD SAFETY SOS ALARM DISPATCHED! Perimeter gates and security terminals notified.');
          setTimeout(() => setAlertSuccess(null), 5000);
        }}
      />
    </div>
  );
};
