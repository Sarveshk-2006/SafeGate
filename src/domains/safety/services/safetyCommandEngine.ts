import type { EmergencyIncidentItem, EmergencyCategory, ChildProfileItem, PickupRecord, AuthorizedPickupPerson } from '../types/index';
import { realTimeSync } from '../../../services/realTimeSync';
import { childSafetyService } from '../../../services/childSafetyService';
import { realtimeService } from '../../../services/realtimeService';
import { getStoredUser } from '../../../services/authStorage';
import { ApiError } from '../../../services/apiClient';

const cleanEncoding = (str: string): string => {
  return str
    .replace(/Ã¢â‚¬Â¢/g, '·')
    .replace(/Ã¢â‚¬â€œ/g, '–')
    .replace(/â€¢/g, '·')
    .replace(/Â·/g, '·')
    .replace(/Ã¢â€šÂ¹/g, '₹')
    .replace(/â‚¹/g, '₹')
    .replace(/â€”/g, '—')
    .replace(/Ã¢Å“â€¢/g, '✕')
    .replace(/âœ•/g, '✕');
};

// General Emergency Incidents store (kept strictly separate from authoritative Child Safety backend)
const STORAGE_KEY_INCIDENTS = 'aarizo_emergency_incidents_v3';

// Cleanup obsolete legacy v2 keys from previous versions (Child Safety localStorage keys removed in Phase 3)
try {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('aarizo_emergency_incidents_v2');
    localStorage.removeItem('aarizo_child_profiles_v2');
    localStorage.removeItem('aarizo_pickup_records_v2');
  }
} catch {}

function resolveActiveSocietyId(): string {
  const user = getStoredUser();
  return typeof user?.societyId === 'string' ? user.societyId.trim() : '';
}

const INITIAL_INCIDENTS: EmergencyIncidentItem[] = [
  {
    id: 'inc-101',
    societyId: '',
    residentId: 'res-1',
    residentName: 'Siddharth Malhotra',
    flatCode: 'A-101',
    phone: '+91 98765 00000',
    category: 'MEDICAL',
    title: 'ONE-TAP SOS: Medical Emergency Reported',
    description: 'Resident triggered Medical SOS from Mobile App.',
    location: 'Tower A, Flat 101',
    status: 'TRIGGERED',
    timeline: [
      {
        id: 'log-1',
        status: 'TRIGGERED',
        timestamp: new Date().toISOString(),
        performedBy: 'Siddharth Malhotra',
        note: 'SOS triggered from resident app. Security & family notified.',
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

class SafetyCommandEngine {
  private getStoredIncidents(): EmergencyIncidentItem[] {
    if (typeof localStorage === 'undefined') return INITIAL_INCIDENTS;
    const raw = localStorage.getItem(STORAGE_KEY_INCIDENTS);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY_INCIDENTS, JSON.stringify(INITIAL_INCIDENTS));
      return INITIAL_INCIDENTS;
    }
    try {
      const sanitized = cleanEncoding(raw);
      return JSON.parse(sanitized);
    } catch {
      return INITIAL_INCIDENTS;
    }
  }

  private saveIncidents(incidents: EmergencyIncidentItem[]) {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_INCIDENTS, JSON.stringify(incidents));
    }
    realTimeSync.publish('EMERGENCY_ALERTS', { timestamp: new Date().toISOString() });
  }

  // =========================================================================
  // GENERAL EMERGENCY INCIDENTS API (Preserved separately from Child Safety)
  // =========================================================================

  public getIncidents(): EmergencyIncidentItem[] {
    return this.getStoredIncidents();
  }

  public triggerOneTapSOS(
    category: EmergencyCategory,
    residentId: string,
    residentName: string,
    flatCode: string,
    phone: string,
    location: string,
    description?: string
  ): EmergencyIncidentItem {
    const incidents = this.getStoredIncidents();
    const newId = `inc-${Date.now()}`;
    const timestamp = new Date().toISOString();
    const activeSocietyId = resolveActiveSocietyId();

    const newIncident: EmergencyIncidentItem = {
      id: newId,
      societyId: activeSocietyId,
      residentId,
      residentName,
      flatCode,
      phone,
      category,
      title: `ONE-TAP SOS: ${category} EMERGENCY`,
      description: description || `One-tap ${category} emergency triggered from Flat ${flatCode}.`,
      location: location || `Flat ${flatCode}`,
      status: 'TRIGGERED',
      timeline: [
        {
          id: `log-${Date.now()}`,
          status: 'TRIGGERED',
          timestamp,
          performedBy: residentName,
          note: `One-Tap SOS dispatched. Security gate post & family members alerted instantly.`,
        },
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    incidents.unshift(newIncident);
    this.saveIncidents(incidents);

    realtimeService.publish(
      'EMERGENCY_ALERTS',
      newIncident,
      activeSocietyId,
      'RESIDENT',
      residentName
    );

    return newIncident;
  }

  public acknowledgeIncident(incidentId: string, acknowledgedBy: string): EmergencyIncidentItem | null {
    const incidents = this.getStoredIncidents();
    const index = incidents.findIndex(i => i.id === incidentId);
    if (index === -1) return null;

    const timestamp = new Date().toISOString();
    const incident = incidents[index];
    const activeSocietyId = resolveActiveSocietyId();

    const updated: EmergencyIncidentItem = {
      ...incident,
      status: 'ACKNOWLEDGED',
      acknowledgedBy,
      acknowledgedAt: timestamp,
      timeline: [
        {
          id: `log-${Date.now()}`,
          status: 'ACKNOWLEDGED',
          timestamp,
          performedBy: acknowledgedBy,
          note: `Security Command acknowledged alert. Dispatching response.`,
        },
        ...incident.timeline,
      ],
      updatedAt: timestamp,
    };

    incidents[index] = updated;
    this.saveIncidents(incidents);

    realtimeService.publish(
      'EMERGENCY_ALERTS',
      { type: 'INCIDENT_ACKNOWLEDGED', incident: updated },
      activeSocietyId,
      'STAFF',
      acknowledgedBy
    );

    return updated;
  }

  public assignResponder(incidentId: string, responderName: string, responderRole: string, performedBy: string): EmergencyIncidentItem | null {
    const incidents = this.getStoredIncidents();
    const index = incidents.findIndex(i => i.id === incidentId);
    if (index === -1) return null;

    const timestamp = new Date().toISOString();
    const incident = incidents[index];
    const activeSocietyId = resolveActiveSocietyId();

    const updated: EmergencyIncidentItem = {
      ...incident,
      status: 'RESPONDING',
      responderName,
      responderRole,
      timeline: [
        {
          id: `log-${Date.now()}`,
          status: 'RESPONDING',
          timestamp,
          performedBy,
          note: `Responder ${responderName} (${responderRole}) assigned & en route.`,
        },
        ...incident.timeline,
      ],
      updatedAt: timestamp,
    };

    incidents[index] = updated;
    this.saveIncidents(incidents);

    realtimeService.publish(
      'EMERGENCY_ALERTS',
      { type: 'INCIDENT_RESPONDER_ASSIGNED', incident: updated },
      activeSocietyId,
      'STAFF',
      performedBy
    );

    return updated;
  }

  public resolveIncident(incidentId: string, status: 'RESOLVED' | 'CLOSED', note: string, performedBy: string): EmergencyIncidentItem | null {
    const incidents = this.getStoredIncidents();
    const index = incidents.findIndex(i => i.id === incidentId);
    if (index === -1) return null;

    const timestamp = new Date().toISOString();
    const incident = incidents[index];
    const activeSocietyId = resolveActiveSocietyId();

    const updated: EmergencyIncidentItem = {
      ...incident,
      status,
      resolvedAt: timestamp,
      timeline: [
        {
          id: `log-${Date.now()}`,
          status,
          timestamp,
          performedBy,
          note: note || `Incident marked as ${status}.`,
        },
        ...incident.timeline,
      ],
      updatedAt: timestamp,
    };

    incidents[index] = updated;
    this.saveIncidents(incidents);

    realtimeService.publish(
      'EMERGENCY_ALERTS',
      { type: 'INCIDENT_RESOLVED', incident: updated },
      activeSocietyId,
      'STAFF',
      performedBy
    );

    return updated;
  }

  // =========================================================================
  // DEPRECATED CHILD SAFETY COMPATIBILITY ADAPTERS (Retained until Phase 4/7)
  // - Eliminates split-brain `aarizo_child_profiles_v3` / `aarizo_pickup_records_v3`
  // - Eliminates hardcoded `'soc-gvs'` fallback
  // - Read adapters project strictly from authoritative `childSafetyService` memory snapshot
  // - Write/verify adapters fail closed (never write localStorage or fabricate success)
  // =========================================================================

  /** @deprecated Use `await childSafetyService.listChildren()` (Phase 4 cutover). */
  public getChildren(): ChildProfileItem[] {
    const canonicalChildren = childSafetyService.getChildren();
    return canonicalChildren.map(c => ({
      id: c.id,
      societyId: c.societyId,
      childName: c.fullName,
      flatCode: c.flatNumber,
      guardianName: c.guardians[0]?.name || 'Guardian',
      guardianPhone: c.guardians[0]?.phone || '',
      authorizedPickups: c.authorizedPickups.map(ap => ({
        id: ap.id,
        name: ap.name,
        phone: ap.phone,
        relationship: ap.relationship,
        idProofType: ap.idProofType,
        idProofNumber: ap.idProofNumber,
        photoUrl: ap.photoUrl,
        isApproved: ap.status === 'ACTIVE',
      })),
      // Never fabricate deterministic QR pass codes client-side; passes are server-issued only
      qrPassCode: '',
      createdAt: c.createdAt,
    }));
  }

  /** @deprecated Use `await childSafetyService.listExitLogs()` (Phase 4/5 cutover). */
  public getPickupRecords(): PickupRecord[] {
    return childSafetyService.getPickupLogs().map(log => ({
      id: log.id,
      childId: log.childId,
      childName: log.childName,
      flatCode: log.flatNumber,
      pickupPersonName: log.pickupPersonName,
      pickupPersonPhone: log.pickupPersonPhone,
      verifiedByGuard: log.securityGuardId,
      timestamp: log.timestamp,
      status: log.status === 'ALLOWED' ? 'GATE_CLEARED' : 'DENIED',
    }));
  }

  /** @deprecated Disabled localStorage write. Use `await childSafetyService.createChildProfileAsync()`. */
  public addChildProfile(
    _childName: string,
    _flatCode: string,
    _guardianName: string,
    _guardianPhone: string
  ): ChildProfileItem {
    throw new ApiError({
      status: 0,
      code: 'LEGACY_SYNC_API_DEPRECATED',
      kind: 'VALIDATION',
      endpoint: '/children#addChildProfile',
      message: 'Local child profile creation is disabled. Use authoritative async childSafetyService.createChildProfileAsync().',
    });
  }

  /** @deprecated Disabled localStorage write (raw idProofNumber forbidden). Use `await childSafetyService.addAuthorizedPickup()`. */
  public addAuthorizedPickup(
    _childId: string,
    _pickup: Omit<AuthorizedPickupPerson, 'id' | 'isApproved'>
  ): ChildProfileItem | null {
    throw new ApiError({
      status: 0,
      code: 'LEGACY_SYNC_API_DEPRECATED',
      kind: 'VALIDATION',
      endpoint: '/children#addAuthorizedPickup',
      message: 'Local authorized pickup creation is disabled. Use authoritative async childSafetyService.addAuthorizedPickup().',
    });
  }

  /**
   * @deprecated Local gate verification is disabled (fail-closed).
   * Use authoritative server verification `await childSafetyService.verifyGatePass()`.
   */
  public verifyChildPickupAtGate(
    _childNameOrQR: string,
    _pickupPersonName: string,
    _guardName: string
  ): { isValid: false; child?: ChildProfileItem; reason: string } {
    return {
      isValid: false,
      reason:
        'Local gate verification is disabled. Gate exit requires online server verification via childSafetyService.verifyGatePass().',
    };
  }
}

export const safetyCommandEngine = new SafetyCommandEngine();
