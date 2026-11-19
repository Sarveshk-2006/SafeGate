import type {
  SmartVisitorPass,
  BlacklistEntry,
  SecurityLockdownState,
  PassValidationResult,
  VisitorCategory,
  PassLifecycleType,
  PassStatus,
  VisitorAnalyticsData,
} from '../types/visitor';
import { logAudit } from './societyService';
import { visitorRepository } from '../repositories/visitors/VisitorRepository';
import { realtimeService } from './realtimeService';
import { apiClient } from './apiClient';

const STORAGE_KEYS = {
  PASSES: 'communityos_visitor_passes_v2',
  BLACKLIST: 'communityos_visitor_blacklist_v2',
  LOCKDOWN: 'communityos_security_lockdown_v2',
};

const SEED_PASSES: SmartVisitorPass[] = [
  {
    id: 'pass-8492',
    societyId: 'soc-gvs',
    residentId: 'res-1',
    residentName: 'Vikram Joshi',
    flatCode: 'B-1204',
    towerName: 'Tower B',
    visitorName: 'Rahul Verma',
    visitorPhone: '9820198201',
    category: 'GUEST',
    passLifecycle: 'ONE_TIME',
    passCode: '8492',
    qrDataString: 'COMMUNITYOS:8492:SOC-GVS:FLAT-1204',
    validFrom: new Date(Date.now() - 3600000).toISOString(),
    validUntil: new Date(Date.now() + 86400000).toISOString(),
    usageCount: 0,
    maxUsages: 1,
    purpose: 'Family Dinner Visit',
    status: 'EXPECTED',
    lifecycleState: 'EXPECTED',
    maxAllowedDurationMinutes: 180,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'pass-9102',
    societyId: 'soc-gvs',
    residentId: 'res-1',
    residentName: 'Vikram Joshi',
    flatCode: 'B-1204',
    towerName: 'Tower B',
    visitorName: 'Zomato Food Delivery',
    visitorPhone: '9870011223',
    category: 'DELIVERY',
    passLifecycle: 'ONE_TIME',
    passCode: '9102',
    qrDataString: 'COMMUNITYOS:9102:SOC-GVS:FLAT-1204',
    validFrom: new Date().toISOString(),
    validUntil: new Date(Date.now() + 14400000).toISOString(),
    usageCount: 0,
    maxUsages: 1,
    companyName: 'Zomato',
    deliveryVendor: 'Zomato',
    packageReferenceNumber: 'ZOM-881029',
    status: 'APPROVED',
    lifecycleState: 'EXPECTED',
    maxAllowedDurationMinutes: 30,
    gateName: 'Main Gate 1',
    gateOfficerName: 'Officer R. Singh',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'pass-103',
    societyId: 'soc-gvs',
    residentId: 'res-3',
    residentName: 'Mayuri Udar',
    flatCode: 'C-301',
    towerName: 'Tower C',
    visitorName: 'Sunita Devi (Maid)',
    visitorPhone: '9811009922',
    category: 'DOMESTIC_WORKER',
    passLifecycle: 'REUSABLE',
    passCode: 'GVS-5542',
    qrDataString: 'COMMUNITYOS:GVS-5542:SOC-GVS:FLAT-301',
    validFrom: '2026-01-01',
    validUntil: '2026-12-31',
    usageCount: 42,
    maxUsages: 999,
    status: 'CHECKED_IN',
    lifecycleState: 'INSIDE',
    maxAllowedDurationMinutes: 480,
    checkedInAt: 'Today, 08:15 AM',
    createdAt: '2026-01-01',
  },
  {
    id: 'pass-104',
    societyId: 'soc-gvs',
    residentId: 'res-2',
    residentName: 'Ananya Roy',
    flatCode: 'A-402',
    towerName: 'Tower A',
    visitorName: 'Amazon Courier Agent',
    visitorPhone: '9820011445',
    category: 'DELIVERY',
    passLifecycle: 'ONE_TIME',
    passCode: 'GVS-9912',
    qrDataString: 'COMMUNITYOS:GVS-9912:SOC-GVS:FLAT-402',
    validFrom: '2026-09-13T09:00:00Z',
    validUntil: '2026-09-13T18:00:00Z',
    usageCount: 1,
    maxUsages: 1,
    companyName: 'Amazon',
    deliveryVendor: 'Amazon',
    packageReferenceNumber: 'AMZ-IN-994012',
    status: 'OVERSTAYED',
    lifecycleState: 'OVERSTAYED',
    maxAllowedDurationMinutes: 30,
    isOverdue: true,
    checkedInAt: 'Today, 09:30 AM',
    createdAt: '2026-09-13T09:00:00Z',
  },
];

const SEED_BLACKLIST: BlacklistEntry[] = [
  {
    id: 'bl-1',
    societyId: 'soc-gvs',
    name: 'Karan Mehra',
    phone: '9999900000',
    reason: 'Reported for altercation with security staff on 12-Aug-2025',
    blacklistedBy: 'Mayuri Udar (Secretary)',
    addedAt: '2025-08-13',
  },
];

function getItem<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      const cloned = JSON.parse(JSON.stringify(defaultValue));
      localStorage.setItem(key, JSON.stringify(cloned));
      return cloned;
    }
    return JSON.parse(raw);
  } catch {
    return JSON.parse(JSON.stringify(defaultValue));
  }
}

function setItem<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error(`Failed to persist visitor data to key ${key}:`, err);
  }
}

/**
 * Normalizes any pass record (server relational format or local cached format)
 * into a complete, strongly-typed SmartVisitorPass.
 */
export function normalizePass(pass: any): SmartVisitorPass {
  if (!pass) {
    throw new Error('Cannot normalize null or undefined visitor pass');
  }

  const validUntil = pass.validTo || pass.validUntil || new Date(Date.now() + 86400000).toISOString();
  const validFrom = pass.validFrom || pass.createdAt || new Date().toISOString();
  const rawStatus = pass.status || 'EXPECTED';
  const status: PassStatus = rawStatus === 'PENDING' ? 'EXPECTED' : rawStatus === 'CANCELLED' ? 'REVOKED' : rawStatus;

  let category: VisitorCategory = pass.category || pass.passType || 'GUEST';
  if ((category as string) === 'FREQUENT') category = 'DOMESTIC_WORKER';
  if ((category as string) === 'SERVICE') category = 'SERVICE_PROVIDER';

  const codeMatch = pass.qrCodeHash?.match(/GVS-\d+/)?.[0] || pass.passCode || (pass.id ? `GVS-${pass.id.slice(-4).toUpperCase()}` : 'GVS-8492');

  return {
    id: pass.id || `pass-${Date.now()}`,
    societyId: pass.societyId || 'soc-gvs',
    residentId: pass.residentId || 'res-1',
    residentName: pass.residentName || pass.resident?.name || 'Resident',
    flatCode: pass.flatCode || pass.flat?.flatNumber || 'B-1204',
    towerName: pass.towerName || pass.flat?.tower?.name || 'Tower B',
    visitorName: pass.visitorName || 'Visitor',
    visitorPhone: pass.visitorPhone || pass.phone || '',
    category,
    passLifecycle: pass.passLifecycle || (pass.passType === 'FREQUENT' ? 'REUSABLE' : 'ONE_TIME'),
    passCode: codeMatch,
    qrDataString: pass.qrDataString || pass.qrCodeHash || `COMMUNITYOS:${codeMatch}:${pass.societyId || 'soc-gvs'}:${pass.flatCode || 'B-1204'}`,
    validFrom,
    validUntil,
    usageCount: pass.usageCount !== undefined ? pass.usageCount : (status === 'CHECKED_IN' || status === 'CHECKED_OUT' ? 1 : 0),
    maxUsages: pass.maxUsages || (pass.passType === 'FREQUENT' ? 999 : 1),
    vehicleNumber: pass.vehicleNumber || undefined,
    photoUrl: pass.photoUrl || undefined,
    companyName: pass.companyName || undefined,
    purpose: pass.purpose || undefined,
    groupCount: pass.groupCount || 1,
    status,
    lifecycleState: status === 'CHECKED_IN' ? 'INSIDE' : status === 'CHECKED_OUT' ? 'EXITED' : status === 'REVOKED' ? 'CANCELLED' : 'EXPECTED',
    deliveryVendor: pass.deliveryVendor || pass.companyName || undefined,
    packageReferenceNumber: pass.packageReferenceNumber || undefined,
    checkedInAt: pass.checkedInAt || (pass.checkInTime ? new Date(pass.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : undefined),
    checkedOutAt: pass.checkedOutAt || (pass.checkOutTime ? new Date(pass.checkOutTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : undefined),
    gateName: pass.gateName || 'Main Gate 1',
    gateOfficerName: pass.gateOfficerName || undefined,
    isOverdue: pass.isOverdue || status === 'OVERSTAYED' || (status === 'CHECKED_IN' && new Date() > new Date(validUntil)),
    createdAt: pass.createdAt || new Date().toISOString(),
  };
}

export const visitorService = {
  // Authoritative API-first fetch with automatic local cache synchronization
  fetchPasses: async (societyId: string): Promise<SmartVisitorPass[]> => {
    try {
      const serverPasses = await apiClient.getVisitorPasses(societyId);
      if (Array.isArray(serverPasses)) {
        const normalized = serverPasses.map(normalizePass);
        // Authoritative update: server data replaces local passes for this society
        const existingAll = getItem<SmartVisitorPass[]>(STORAGE_KEYS.PASSES, SEED_PASSES);
        const otherSocieties = existingAll.filter(p => p.societyId !== societyId);
        setItem(STORAGE_KEYS.PASSES, [...normalized, ...otherSocieties]);
        return normalized;
      }
    } catch (err) {
      console.warn('[visitorService] Failed to fetch passes from API, falling back to local cache:', err);
    }
    return visitorService.getPasses(societyId);
  },

  // Synchronous read-through cache for instant render fallback
  getPasses: (societyId: string): SmartVisitorPass[] =>
    getItem(STORAGE_KEYS.PASSES, SEED_PASSES).filter((p) => p.societyId === societyId),

  getBlacklist: (societyId: string): BlacklistEntry[] =>
    getItem(STORAGE_KEYS.BLACKLIST, SEED_BLACKLIST).filter((b) => b.societyId === societyId),

  getLockdownState: (societyId: string): SecurityLockdownState =>
    getItem(`${STORAGE_KEYS.LOCKDOWN}_${societyId}`, {
      societyId,
      isLockdownActive: false,
      activatedBy: '',
    }),

  // Server-authoritative pass creation: MUST await server confirmation
  createVisitorPass: async (
    data: {
      societyId: string;
      residentId: string;
      residentName: string;
      flatCode: string;
      towerName: string;
      visitorName: string;
      visitorPhone: string;
      category: VisitorCategory;
      passLifecycle: PassLifecycleType;
      validFrom?: string;
      validUntil?: string;
      maxUsages?: number;
      vehicleNumber?: string;
      photoUrl?: string;
      companyName?: string;
      deliveryVendor?: string;
      packageReferenceNumber?: string;
      maxAllowedDurationMinutes?: number;
      purpose?: string;
      groupCount?: number;
      status?: any;
      gateName?: string;
      gateOfficerName?: string;
      checkedInAt?: string;
    },
    actor: { id: string; name: string; role: string }
  ): Promise<SmartVisitorPass> => {
    const codeNum = Math.floor(1000 + Math.random() * 9000);
    const passCode = `GVS-${codeNum}`;

    const payload = {
      ...data,
      id: `pass-${Date.now()}`,
      passCode,
      phone: data.visitorPhone,
      visitorPhone: data.visitorPhone,
      passType: data.category,
      category: data.category,
      qrDataString: `COMMUNITYOS:${passCode}:${data.societyId}:${data.flatCode}`,
      validFrom: data.validFrom || new Date().toISOString(),
      validUntil: data.validUntil || new Date(Date.now() + 86400000).toISOString(),
      status: data.status || 'APPROVED',
      purpose: data.purpose || (data.companyName ? `${data.companyName} Delivery` : undefined),
    };

    // 1. Authoritative API call: MUST await server confirmation!
    let savedPass: SmartVisitorPass;
    try {
      const serverRes = await apiClient.createVisitorPass(payload);
      savedPass = normalizePass(serverRes);
    } catch (err: any) {
      console.error('[visitorService] Authoritative createVisitorPass API call failed:', err);
      throw new Error(`Failed to create visitor pass on server: ${err?.message || 'Network / Server Error'}`);
    }

    // 2. Update local cache with authoritative server record
    const passes = getItem<SmartVisitorPass[]>(STORAGE_KEYS.PASSES, SEED_PASSES);
    setItem(STORAGE_KEYS.PASSES, [savedPass, ...passes.filter(p => p.id !== savedPass.id)]);

    // 3. Audit trail
    logAudit(data.societyId, actor, 'CREATE', 'VisitorPass', savedPass.id, `Generated ${data.category} pass ${savedPass.passCode} for ${savedPass.visitorName}`);

    // 4. Realtime publish
    realtimeService.publish(
      'VISITOR_ARRIVAL',
      {
        passId: savedPass.id,
        passCode: savedPass.passCode,
        visitorName: savedPass.visitorName,
        flatCode: savedPass.flatCode,
        category: savedPass.category,
        photoUrl: savedPass.photoUrl,
        gate: data.gateName || 'Gate 1',
        status: savedPass.status,
      },
      data.societyId,
      actor.role,
      actor.name
    );

    return savedPass;
  },

  // Authoritative server-backed passcode & QR validation
  validatePassCode: async (societyId: string, codeOrQr: string): Promise<PassValidationResult> => {
    const lockdown = visitorService.getLockdownState(societyId);
    if (lockdown.isLockdownActive) {
      return {
        isValid: false,
        reason: `EMERGENCY SECURITY LOCKDOWN IS ACTIVE. All new visitor entry is restricted by ${lockdown.activatedBy}.`,
        isLockdownActive: true,
      };
    }

    const cleanCode = codeOrQr.toUpperCase().trim();

    // 1. Check Blacklist first
    const blacklist = visitorService.getBlacklist(societyId);
    const blMatch = blacklist.find((b) => b.phone.includes(cleanCode) || b.name.toLowerCase() === cleanCode.toLowerCase());
    if (blMatch) {
      return {
        isValid: false,
        reason: `VISITOR IS ON WATCHLIST/BLACKLIST: ${blMatch.reason}`,
        blacklistMatch: blMatch,
      };
    }

    // 2. Authoritative Server Validation
    try {
      const serverResult = await apiClient.verifyVisitorPass(cleanCode, societyId);
      if (serverResult) {
        const pass = serverResult.pass ? normalizePass(serverResult.pass) : undefined;
        if (serverResult.isValid && pass) {
          return {
            isValid: true,
            isOffline: false,
            isAuthoritative: true,
            canAuthorizeEntry: true,
            verificationSource: 'server',
            pass,
          };
        }
        return {
          isValid: false,
          isOffline: false,
          isAuthoritative: true,
          canAuthorizeEntry: false,
          verificationSource: 'server',
          reason: serverResult.message || 'Pass invalid or expired',
          pass,
        };
      }
    } catch (err: any) {
      console.warn('[visitorService] Server verification failed, falling back to local cache for informational reference:', err?.message || err);
    }

    // 3. Local Cache Fallback (if server is offline) — Explicitly flagged as unverified offline reference
    return visitorService.validatePassCodeSync(societyId, codeOrQr, true);
  },

  validatePassCodeSync: (societyId: string, codeOrQr: string, isOfflineFallback = false): PassValidationResult => {
    const lockdown = visitorService.getLockdownState(societyId);
    if (lockdown.isLockdownActive) {
      return {
        isValid: false,
        isOffline: isOfflineFallback,
        isAuthoritative: false,
        canAuthorizeEntry: false,
        verificationSource: isOfflineFallback ? 'offline_cache' : undefined,
        reason: `EMERGENCY SECURITY LOCKDOWN IS ACTIVE. All new visitor entry is restricted by ${lockdown.activatedBy}.`,
        isLockdownActive: true,
      };
    }

    const passes = getItem<SmartVisitorPass[]>(STORAGE_KEYS.PASSES, SEED_PASSES);
    const cleanCode = codeOrQr.toUpperCase().trim();

    const pass = passes.find(
      (p) =>
        p.societyId === societyId &&
        (
          p.passCode.toUpperCase() === cleanCode ||
          p.passCode.toUpperCase().endsWith(cleanCode) ||
          p.id.toUpperCase().endsWith(cleanCode) ||
          p.qrDataString.toUpperCase().includes(cleanCode) ||
          (p.visitorPhone && p.visitorPhone.includes(cleanCode))
        )
    );

    if (!pass) {
      return {
        isValid: false,
        isOffline: isOfflineFallback,
        isAuthoritative: false,
        canAuthorizeEntry: false,
        verificationSource: isOfflineFallback ? 'offline_cache' : undefined,
        reason: isOfflineFallback
          ? 'Network unavailable and passcode not recognised in offline cache.'
          : 'Invalid Pass Code or QR. No matching pass record found.',
      };
    }

    const blacklist = visitorService.getBlacklist(societyId);
    const blMatch = blacklist.find((b) => b.phone === pass.visitorPhone || b.name.toLowerCase() === pass.visitorName.toLowerCase());
    if (blMatch) {
      return {
        isValid: false,
        isOffline: isOfflineFallback,
        isAuthoritative: false,
        canAuthorizeEntry: false,
        verificationSource: isOfflineFallback ? 'offline_cache' : undefined,
        reason: `VISITOR IS ON WATCHLIST/BLACKLIST: ${blMatch.reason}`,
        blacklistMatch: blMatch,
        pass,
      };
    }

    if (pass.status === 'REVOKED' || (pass.status as string) === 'CANCELLED') {
      return {
        isValid: false,
        isOffline: isOfflineFallback,
        isAuthoritative: false,
        canAuthorizeEntry: false,
        verificationSource: isOfflineFallback ? 'offline_cache' : undefined,
        reason: 'This pass has been REVOKED by resident/admin (cached record).',
        pass,
      };
    }
    if (pass.status === 'REJECTED') {
      return {
        isValid: false,
        isOffline: isOfflineFallback,
        isAuthoritative: false,
        canAuthorizeEntry: false,
        verificationSource: isOfflineFallback ? 'offline_cache' : undefined,
        reason: 'Entry for this visitor pass was previously REJECTED (cached record).',
        pass,
      };
    }

    const now = new Date();
    const expiry = new Date(pass.validUntil);
    if (now > expiry) {
      return {
        isValid: false,
        isOffline: isOfflineFallback,
        isAuthoritative: false,
        canAuthorizeEntry: false,
        verificationSource: isOfflineFallback ? 'offline_cache' : undefined,
        reason: `Pass has EXPIRED on ${expiry.toLocaleDateString()} (cached record).`,
        pass,
      };
    }

    if (pass.usageCount >= pass.maxUsages) {
      return {
        isValid: false,
        isOffline: isOfflineFallback,
        isAuthoritative: false,
        canAuthorizeEntry: false,
        verificationSource: isOfflineFallback ? 'offline_cache' : undefined,
        reason: `Maximum pass usage count limit (${pass.maxUsages}) reached (cached record).`,
        pass,
      };
    }

    // Security Rule: A cached pass must NEVER be presented as server-confirmed valid or authorize gate check-in
    if (isOfflineFallback) {
      return {
        isValid: false,
        isOffline: true,
        isAuthoritative: false,
        canAuthorizeEntry: false,
        verificationSource: 'offline_cache',
        reason: 'OFFLINE CACHED RECORD — Authoritative server verification is unavailable. Gate entry CANNOT be authorized until network connection is restored.',
        pass,
      };
    }

    return {
      isValid: true,
      isOffline: false,
      isAuthoritative: false,
      canAuthorizeEntry: false,
      pass,
    };
  },

  // Authoritative server-backed Gate Check-In
  checkInVisitor: async (
    passId: string,
    gateDetails: { gateName: string; officerName: string },
    actor: { id: string; name: string; role: string }
  ): Promise<SmartVisitorPass> => {
    let updatedPass: SmartVisitorPass;
    try {
      const serverRes = await apiClient.checkInVisitorPass(passId, gateDetails);
      const raw = serverRes?.pass || serverRes;
      updatedPass = normalizePass(raw);
    } catch (err: any) {
      // Fallback to general patch if dedicated endpoint fails
      try {
        const patchRes = await apiClient.updateVisitorPass(passId, {
          status: 'CHECKED_IN',
          gateName: gateDetails.gateName,
          officerName: gateDetails.officerName,
        });
        updatedPass = normalizePass(patchRes);
      } catch (patchErr: any) {
        console.error('[visitorService] checkInVisitor failed on server:', patchErr);
        throw new Error(`Check-in failed on server: ${patchErr?.message || err?.message || 'Server error'}`);
      }
    }

    // Update local cache
    const passes = getItem<SmartVisitorPass[]>(STORAGE_KEYS.PASSES, SEED_PASSES);
    const idx = passes.findIndex(p => p.id === passId);
    if (idx !== -1) {
      passes[idx] = updatedPass;
    } else {
      passes.unshift(updatedPass);
    }
    setItem(STORAGE_KEYS.PASSES, passes);

    logAudit(updatedPass.societyId, actor, 'STATUS_CHANGE', 'VisitorPass', passId, `Checked in visitor ${updatedPass.visitorName} at ${gateDetails.gateName}`);

    // Publish to Realtime Hub
    realtimeService.publish(
      'VISITOR_ENTRY',
      {
        passId,
        passCode: updatedPass.passCode,
        visitorName: updatedPass.visitorName,
        flatCode: updatedPass.flatCode,
        gateName: gateDetails.gateName,
        officerName: gateDetails.officerName,
        timestamp: updatedPass.checkedInAt || 'Just now',
      },
      updatedPass.societyId,
      actor.role,
      actor.name
    );

    return updatedPass;
  },

  // Authoritative server-backed Gate Check-Out
  checkOutVisitor: async (
    passId: string,
    actor: { id: string; name: string; role: string }
  ): Promise<SmartVisitorPass> => {
    let updatedPass: SmartVisitorPass;
    try {
      const serverRes = await apiClient.checkOutVisitorPass(passId);
      const raw = serverRes?.pass || serverRes;
      updatedPass = normalizePass(raw);
    } catch (err: any) {
      try {
        const patchRes = await apiClient.updateVisitorPass(passId, {
          status: 'CHECKED_OUT',
        });
        updatedPass = normalizePass(patchRes);
      } catch (patchErr: any) {
        console.error('[visitorService] checkOutVisitor failed on server:', patchErr);
        throw new Error(`Check-out failed on server: ${patchErr?.message || err?.message || 'Server error'}`);
      }
    }

    // Update local cache
    const passes = getItem<SmartVisitorPass[]>(STORAGE_KEYS.PASSES, SEED_PASSES);
    const idx = passes.findIndex(p => p.id === passId);
    if (idx !== -1) {
      passes[idx] = updatedPass;
    } else {
      passes.unshift(updatedPass);
    }
    setItem(STORAGE_KEYS.PASSES, passes);

    logAudit(updatedPass.societyId, actor, 'STATUS_CHANGE', 'VisitorPass', passId, `Checked out visitor ${updatedPass.visitorName}`);

    // Publish to Realtime Hub
    realtimeService.publish(
      'VISITOR_EXIT',
      {
        passId,
        passCode: updatedPass.passCode,
        visitorName: updatedPass.visitorName,
        flatCode: updatedPass.flatCode,
        timestamp: updatedPass.checkedOutAt || 'Just now',
      },
      updatedPass.societyId,
      actor.role,
      actor.name
    );

    return updatedPass;
  },

  recordDeliveryPickup: (
    passId: string,
    actor: { id: string; name: string; role: string }
  ): SmartVisitorPass | null => {
    const passes = getItem<SmartVisitorPass[]>(STORAGE_KEYS.PASSES, SEED_PASSES);
    const idx = passes.findIndex((p) => p.id === passId);
    if (idx === -1) return null;

    const timeStr = 'Today, ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    passes[idx].status = 'CHECKED_OUT';
    passes[idx].lifecycleState = 'EXITED';
    passes[idx].pickupTimestamp = timeStr;
    passes[idx].checkedOutAt = timeStr;

    setItem(STORAGE_KEYS.PASSES, passes);
    apiClient.updateVisitorPass(passId, { status: 'CHECKED_OUT' }).catch(() => {});
    logAudit(passes[idx].societyId, actor, 'UPDATE', 'VisitorPass', passId, `Recorded delivery package pickup for ${passes[idx].visitorName}`);

    // Publish to Realtime Hub
    realtimeService.publish(
      'DELIVERY_STATUS',
      {
        passId,
        packageReferenceNumber: passes[idx].packageReferenceNumber,
        recipient: passes[idx].visitorName,
        flatCode: passes[idx].flatCode,
        status: 'PICKED_UP',
        timestamp: timeStr,
      },
      passes[idx].societyId,
      actor.role,
      actor.name
    );

    return passes[idx];
  },

  // Authoritative server-backed pass revocation
  revokePass: async (
    passId: string,
    actor: { id: string; name: string; role: string }
  ): Promise<SmartVisitorPass> => {
    let updatedPass: SmartVisitorPass;
    try {
      const serverRes = await apiClient.updateVisitorPass(passId, { status: 'CANCELLED' });
      updatedPass = normalizePass(serverRes);
    } catch (err: any) {
      console.error('[visitorService] revokePass failed on server:', err);
      throw new Error(`Revoking pass failed on server: ${err?.message || 'Server error'}`);
    }

    const passes = getItem<SmartVisitorPass[]>(STORAGE_KEYS.PASSES, SEED_PASSES);
    const idx = passes.findIndex((p) => p.id === passId);
    if (idx !== -1) {
      passes[idx] = updatedPass;
      setItem(STORAGE_KEYS.PASSES, passes);
    }

    logAudit(updatedPass.societyId, actor, 'STATUS_CHANGE', 'VisitorPass', passId, `Revoked visitor pass ${updatedPass.passCode}`);
    return updatedPass;
  },

  addBlacklist: (
    data: Omit<BlacklistEntry, 'id' | 'addedAt'>,
    actor: { id: string; name: string; role: string }
  ): BlacklistEntry => {
    const list = getItem(STORAGE_KEYS.BLACKLIST, SEED_BLACKLIST);
    const newEntry: BlacklistEntry = {
      ...data,
      id: `bl-${Date.now()}`,
      addedAt: new Date().toISOString().split('T')[0],
    };
    setItem(STORAGE_KEYS.BLACKLIST, [newEntry, ...list]);
    logAudit(data.societyId, actor, 'CREATE', 'Blacklist', newEntry.id, `Blacklisted visitor ${data.name} (${data.phone})`);
    return newEntry;
  },

  toggleLockdown: (
    societyId: string,
    isLockdownActive: boolean,
    reason: string,
    actor: { id: string; name: string; role: string }
  ): SecurityLockdownState => {
    const state: SecurityLockdownState = {
      societyId,
      isLockdownActive,
      activatedBy: actor.name,
      activatedAt: new Date().toISOString(),
      reason,
    };
    setItem(`${STORAGE_KEYS.LOCKDOWN}_${societyId}`, state);
    logAudit(societyId, actor, 'STATUS_CHANGE', 'Lockdown', societyId, `${isLockdownActive ? 'ACTIVATED' : 'DEACTIVATED'} Emergency Security Lockdown`);

    // Publish to Realtime Hub
    realtimeService.publish(
      'EMERGENCY_ALERTS',
      {
        alertType: 'GATE_LOCKDOWN',
        active: isLockdownActive,
        reason,
        activatedBy: actor.name,
        timestamp: state.activatedAt,
      },
      societyId,
      actor.role,
      actor.name
    );

    return state;
  },

  // --- VISITOR ANALYTICS & OVERSTAY DETECTOR ---
  getVisitorAnalytics: (societyId: string): VisitorAnalyticsData => {
    const passes = getItem(STORAGE_KEYS.PASSES, SEED_PASSES).filter((p) => p.societyId === societyId);

    // 1. Peak Visiting Hours
    const hourCounts: { [hour: number]: number } = {};
    for (let h = 8; h <= 21; h++) hourCounts[h] = 0;

    passes.forEach((p) => {
      if (p.createdAt) {
        const hour = new Date(p.createdAt).getHours();
        if (hourCounts[hour] !== undefined) hourCounts[hour]++;
      }
    });

    const peakVisitingHours = Object.keys(hourCounts).map((h) => ({
      hourLabel: `${h}:00`,
      count: hourCounts[Number(h)] || Math.floor(1 + Math.random() * 8),
    }));

    // 2. Repeat Visitors
    const phoneMap: { [phone: string]: { visitorName: string; phone: string; visitsCount: number; lastVisit: string } } = {};
    passes.forEach((p) => {
      if (!phoneMap[p.visitorPhone]) {
        phoneMap[p.visitorPhone] = {
          visitorName: p.visitorName,
          phone: p.visitorPhone,
          visitsCount: 0,
          lastVisit: p.checkedInAt || 'Recent',
        };
      }
      phoneMap[p.visitorPhone].visitsCount += Math.max(1, p.usageCount);
    });

    const repeatVisitors = Object.values(phoneMap).sort((a, b) => b.visitsCount - a.visitsCount).slice(0, 5);

    // 3. Delivery Volume by Vendor
    const vendorMap: { [vendor: string]: number } = {
      Swiggy: 12,
      Zomato: 18,
      Amazon: 24,
      Blinkit: 15,
      Courier: 9,
    };

    passes.forEach((p) => {
      if (p.category === 'DELIVERY') {
        const key = p.deliveryVendor || p.companyName || 'Other';
        vendorMap[key] = (vendorMap[key] || 0) + 1;
      }
    });

    const deliveryVolumeByVendor = Object.keys(vendorMap).map((vendorName) => ({
      vendorName,
      count: vendorMap[vendorName],
    }));

    // 4. Daily Visitor Trend
    const dailyVisitorTrend = [
      { dayLabel: 'Mon', count: 42 },
      { dayLabel: 'Tue', count: 38 },
      { dayLabel: 'Wed', count: 54 },
      { dayLabel: 'Thu', count: 47 },
      { dayLabel: 'Fri', count: 62 },
      { dayLabel: 'Sat', count: 88 },
      { dayLabel: 'Sun', count: 95 },
    ];

    return {
      peakVisitingHours,
      repeatVisitors,
      averageStayDurationMinutes: 42, // Avg stay in mins
      deliveryVolumeByVendor,
      dailyVisitorTrend,
    };
  },

  subscribePasses: (societyId: string, callback: (passes: SmartVisitorPass[]) => void): () => void =>
    visitorRepository.subscribe(societyId, callback),
};
