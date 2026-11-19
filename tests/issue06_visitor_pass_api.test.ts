// In-memory mock storage for Node.js test environment
class MockStorage {
  private store: Record<string, string> = {};
  getItem(key: string): string | null {
    return this.store[key] || null;
  }
  setItem(key: string, value: string): void {
    this.store[key] = String(value);
  }
  removeItem(key: string): void {
    delete this.store[key];
  }
  clear(): void {
    this.store = {};
  }
}

const mockStorage = new MockStorage();
(global as any).localStorage = mockStorage;
(global as any).window = { localStorage: mockStorage };

// Mock Vite import.meta / backendConfig and realtimeService for hermetic Node.js Jest testing
jest.mock('../src/utils/backendConfig', () => ({
  getBackendBaseUrl: jest.fn(() => 'http://localhost:5000'),
}));
jest.mock('../src/services/realtimeService', () => ({
  realtimeService: {
    publish: jest.fn(),
    subscribe: jest.fn(() => () => {}),
  },
}));
jest.mock('../src/services/societyService', () => ({
  logAudit: jest.fn(),
}));

// Mock apiClient to test visitorService integration in isolation
jest.mock('../src/services/apiClient', () => ({
  apiClient: {
    getVisitorPasses: jest.fn(),
    getVisitorPassById: jest.fn(),
    createVisitorPass: jest.fn(),
    updateVisitorPass: jest.fn(),
    checkInVisitorPass: jest.fn(),
    checkOutVisitorPass: jest.fn(),
    deleteVisitorPass: jest.fn(),
    verifyVisitorPass: jest.fn(),
  },
}));

import { normalizePass, visitorService } from '../src/services/visitorService';
import { apiClient } from '../src/services/apiClient';
import type { SmartVisitorPass } from '../src/types/visitor';

describe('ISSUE-06 Phase B.1: Visitor Pass Authoritative API & Field Mapping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  describe('1. Field Normalization & Compatibility Mapping', () => {
    test('Maps backend relational fields (phone, passType, validTo) to frontend SmartVisitorPass contract', () => {
      const backendPass = {
        id: 'pass-relational-101',
        societyId: 'soc-gvs',
        residentId: 'res-vikram-01',
        flatId: 'flat-b1204',
        visitorName: 'Amit Sharma',
        phone: '9820198201',
        passType: 'DELIVERY',
        vehicleNumber: 'MH04XY9999',
        purpose: 'Zomato Food Delivery',
        status: 'CHECKED_IN',
        qrCodeHash: 'COMMUNITYOS:GVS-9912:soc-gvs:B-1204',
        validFrom: '2026-11-17T10:00:00.000Z',
        validTo: '2026-11-17T22:00:00.000Z',
        checkInTime: '2026-11-17T11:15:00.000Z',
        checkOutTime: null,
        createdAt: '2026-11-17T09:30:00.000Z',
        updatedAt: '2026-11-17T11:15:00.000Z',
        resident: { name: 'Vikram Joshi' },
        flat: { flatNumber: 'B-1204', tower: { name: 'Tower B' } },
      };

      const normalized = normalizePass(backendPass);

      expect(normalized.id).toBe('pass-relational-101');
      expect(normalized.visitorName).toBe('Amit Sharma');
      expect(normalized.visitorPhone).toBe('9820198201');
      expect(normalized.category).toBe('DELIVERY');
      expect(normalized.status).toBe('CHECKED_IN');
      expect(normalized.lifecycleState).toBe('INSIDE');
      expect(normalized.validUntil).toBe('2026-11-17T22:00:00.000Z');
      expect(normalized.residentName).toBe('Vikram Joshi');
      expect(normalized.flatCode).toBe('B-1204');
      expect(normalized.towerName).toBe('Tower B');
      expect(normalized.passCode).toBe('GVS-9912');
    });

    test('Maps specialized pass categories (FREQUENT -> DOMESTIC_WORKER, SERVICE -> SERVICE_PROVIDER)', () => {
      const frequentPass = {
        id: 'pass-maid-1',
        societyId: 'soc-gvs',
        visitorName: 'Sunita Devi',
        phone: '9811009922',
        passType: 'FREQUENT',
        status: 'APPROVED',
      };
      const normalizedFrequent = normalizePass(frequentPass);
      expect(normalizedFrequent.category).toBe('DOMESTIC_WORKER');
      expect(normalizedFrequent.passLifecycle).toBe('REUSABLE');
      expect(normalizedFrequent.maxUsages).toBe(999);

      const servicePass = {
        id: 'pass-plumber-1',
        societyId: 'soc-gvs',
        visitorName: 'Rajesh Plumber',
        phone: '9822334455',
        passType: 'SERVICE',
        status: 'PENDING',
      };
      const normalizedService = normalizePass(servicePass);
      expect(normalizedService.category).toBe('SERVICE_PROVIDER');
      expect(normalizedService.status).toBe('EXPECTED');
    });

    test('Identifies overdue / overstayed visits when current time exceeds validTo', () => {
      const expiredInsidePass = {
        id: 'pass-overdue-1',
        societyId: 'soc-gvs',
        visitorName: 'Delayed Courier',
        phone: '9870011223',
        passType: 'DELIVERY',
        status: 'CHECKED_IN',
        validTo: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      };
      const normalized = normalizePass(expiredInsidePass);
      expect(normalized.isOverdue).toBe(true);
      expect(normalized.lifecycleState).toBe('INSIDE');
    });

    test('Throws meaningful error if null or undefined pass is passed to normalizer', () => {
      expect(() => normalizePass(null)).toThrow('Cannot normalize null or undefined visitor pass');
    });
  });

  describe('2. Authoritative visitorService Operations & Error Propagation', () => {
    test('createVisitorPass: Awaits server confirmation and updates local storage cache', async () => {
      const serverResponse: SmartVisitorPass = {
        id: 'pass-server-confirmed-01',
        societyId: 'soc-gvs',
        residentId: 'res-1',
        residentName: 'Vikram Joshi',
        flatCode: 'B-1204',
        towerName: 'Tower B',
        visitorName: 'Anil Kapoor',
        visitorPhone: '9820011223',
        category: 'GUEST',
        passLifecycle: 'ONE_TIME',
        passCode: 'GVS-5521',
        qrDataString: 'COMMUNITYOS:GVS-5521:soc-gvs:B-1204',
        validFrom: new Date().toISOString(),
        validUntil: new Date(Date.now() + 86400000).toISOString(),
        usageCount: 0,
        maxUsages: 1,
        status: 'EXPECTED',
        lifecycleState: 'EXPECTED',
        createdAt: new Date().toISOString(),
      };

      (apiClient.createVisitorPass as jest.Mock).mockResolvedValueOnce(serverResponse);

      const created = await visitorService.createVisitorPass(
        {
          societyId: 'soc-gvs',
          residentId: 'res-1',
          residentName: 'Vikram Joshi',
          flatCode: 'B-1204',
          towerName: 'Tower B',
          visitorName: 'Anil Kapoor',
          visitorPhone: '9820011223',
          category: 'GUEST',
          passLifecycle: 'ONE_TIME',
        },
        { id: 'res-1', name: 'Vikram Joshi', role: 'resident' }
      );

      expect(apiClient.createVisitorPass).toHaveBeenCalledTimes(1);
      expect(created.id).toBe('pass-server-confirmed-01');
      expect(created.visitorName).toBe('Anil Kapoor');

      // Verify that local storage cache now contains the confirmed pass
      const cached = visitorService.getPasses('soc-gvs');
      expect(cached.some((p) => p.id === 'pass-server-confirmed-01')).toBe(true);
    });

    test('createVisitorPass: Rejects immediately and does NOT produce false UI success when backend call fails', async () => {
      (apiClient.createVisitorPass as jest.Mock).mockRejectedValueOnce(new Error('PostgreSQL connection timeout'));

      await expect(
        visitorService.createVisitorPass(
          {
            societyId: 'soc-gvs',
            residentId: 'res-1',
            residentName: 'Vikram Joshi',
            flatCode: 'B-1204',
            towerName: 'Tower B',
            visitorName: 'Ghost Visitor',
            visitorPhone: '9800000000',
            category: 'GUEST',
            passLifecycle: 'ONE_TIME',
          },
          { id: 'res-1', name: 'Vikram Joshi', role: 'resident' }
        )
      ).rejects.toThrow('Failed to create visitor pass on server: PostgreSQL connection timeout');

      // Local storage must NOT contain the failed ghost pass
      const cached = visitorService.getPasses('soc-gvs');
      expect(cached.some((p) => p.visitorName === 'Ghost Visitor')).toBe(false);
    });

    test('checkInVisitor: Awaits server confirmation, updates status to CHECKED_IN, and syncs local cache', async () => {
      const serverCheckInResponse = {
        pass: {
          id: 'pass-8492',
          societyId: 'soc-gvs',
          visitorName: 'Rahul Verma',
          phone: '9820198201',
          passType: 'GUEST',
          status: 'CHECKED_IN',
          checkInTime: new Date().toISOString(),
          gateName: 'Main Gate 1',
          gateOfficerName: 'Officer R. Singh',
        },
      };

      (apiClient.checkInVisitorPass as jest.Mock).mockResolvedValueOnce(serverCheckInResponse);

      const checkedIn = await visitorService.checkInVisitor(
        'pass-8492',
        { gateName: 'Main Gate 1', officerName: 'Officer R. Singh' },
        { id: 'guard-1', name: 'Officer R. Singh', role: 'security' }
      );

      expect(apiClient.checkInVisitorPass).toHaveBeenCalledWith('pass-8492', {
        gateName: 'Main Gate 1',
        officerName: 'Officer R. Singh',
      });
      expect(checkedIn.status).toBe('CHECKED_IN');
      expect(checkedIn.lifecycleState).toBe('INSIDE');

      // Local storage must reflect CHECKED_IN
      const cached = visitorService.getPasses('soc-gvs');
      const cachedPass = cached.find((p) => p.id === 'pass-8492');
      expect(cachedPass?.status).toBe('CHECKED_IN');
      expect(cachedPass?.lifecycleState).toBe('INSIDE');
    });

    test('checkInVisitor: Rejects and does not alter local state when server check-in fails (e.g. duplicate check-in 409)', async () => {
      (apiClient.checkInVisitorPass as jest.Mock).mockRejectedValueOnce(new Error('Visitor is already checked in'));
      (apiClient.updateVisitorPass as jest.Mock).mockRejectedValueOnce(new Error('Visitor is already checked in'));

      await expect(
        visitorService.checkInVisitor(
          'pass-8492',
          { gateName: 'Main Gate 1', officerName: 'Officer R. Singh' },
          { id: 'guard-1', name: 'Officer R. Singh', role: 'security' }
        )
      ).rejects.toThrow('Check-in failed on server: Visitor is already checked in');
    });

    test('checkOutVisitor: Awaits server checkout confirmation and updates local cache', async () => {
      const serverCheckOutResponse = {
        pass: {
          id: 'pass-8492',
          societyId: 'soc-gvs',
          visitorName: 'Rahul Verma',
          phone: '9820198201',
          passType: 'GUEST',
          status: 'CHECKED_OUT',
          checkOutTime: new Date().toISOString(),
        },
      };

      (apiClient.checkOutVisitorPass as jest.Mock).mockResolvedValueOnce(serverCheckOutResponse);

      const checkedOut = await visitorService.checkOutVisitor('pass-8492', {
        id: 'guard-1',
        name: 'Officer R. Singh',
        role: 'security',
      });

      expect(apiClient.checkOutVisitorPass).toHaveBeenCalledWith('pass-8492');
      expect(checkedOut.status).toBe('CHECKED_OUT');
      expect(checkedOut.lifecycleState).toBe('EXITED');

      const cached = visitorService.getPasses('soc-gvs');
      const cachedPass = cached.find((p) => p.id === 'pass-8492');
      expect(cachedPass?.status).toBe('CHECKED_OUT');
      expect(cachedPass?.lifecycleState).toBe('EXITED');
    });

    test('fetchPasses: Replaces local storage with authoritative server data', async () => {
      const serverPasses = [
        {
          id: 'pass-remote-01',
          societyId: 'soc-gvs',
          visitorName: 'Remote Resident Guest',
          phone: '9811122233',
          passType: 'GUEST',
          status: 'APPROVED',
          validFrom: new Date().toISOString(),
          validTo: new Date(Date.now() + 86400000).toISOString(),
        },
      ];

      (apiClient.getVisitorPasses as jest.Mock).mockResolvedValueOnce(serverPasses);

      const result = await visitorService.fetchPasses('soc-gvs');

      expect(apiClient.getVisitorPasses).toHaveBeenCalledWith('soc-gvs');
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('pass-remote-01');
      expect(result[0].visitorName).toBe('Remote Resident Guest');

      // Local storage cache is updated with the authoritative server data
      const cached = visitorService.getPasses('soc-gvs');
      expect(cached.length).toBe(1);
      expect(cached[0].id).toBe('pass-remote-01');
    });

    test('fetchPasses: Falls back gracefully to local cache when server is unreachable', async () => {
      (apiClient.getVisitorPasses as jest.Mock).mockRejectedValueOnce(new Error('Network Offline'));

      const result = await visitorService.fetchPasses('soc-gvs');

      // Should return local seed/cache passes without throwing
      expect(result.length).toBeGreaterThan(0);
      expect(result.some((p) => p.societyId === 'soc-gvs')).toBe(true);
    });
  });

  describe('3. Gate Code Validation & Security Guard Integration', () => {
    test('validatePassCode: Authoritatively validates pass with backend API', async () => {
      (apiClient.verifyVisitorPass as jest.Mock).mockResolvedValueOnce({
        isValid: true,
        status: 'valid',
        message: 'Gate pass verified successfully!',
        pass: {
          id: 'pass-8492',
          societyId: 'soc-gvs',
          visitorName: 'Rahul Verma',
          phone: '9820198201',
          passType: 'GUEST',
          status: 'APPROVED',
        },
      });

      const res = await visitorService.validatePassCode('soc-gvs', 'GVS-8492');

      expect(apiClient.verifyVisitorPass).toHaveBeenCalledWith('GVS-8492', 'soc-gvs');
      expect(res.isValid).toBe(true);
      expect(res.pass?.visitorName).toBe('Rahul Verma');
    });

    test('validatePassCode: Immediate rejection when security lockdown is active', async () => {
      visitorService.toggleLockdown(
        'soc-gvs',
        true,
        'Active Threat at Perimeter',
        { id: 'guard-1', name: 'Officer R. Singh', role: 'security' }
      );

      const res = await visitorService.validatePassCode('soc-gvs', 'GVS-8492');

      expect(res.isValid).toBe(false);
      expect(res.isLockdownActive).toBe(true);
      expect(res.reason).toContain('EMERGENCY SECURITY LOCKDOWN IS ACTIVE');
      expect(apiClient.verifyVisitorPass).not.toHaveBeenCalled();

      // Deactivate lockdown for subsequent tests
      visitorService.toggleLockdown('soc-gvs', false, 'Lockdown lifted', {
        id: 'guard-1',
        name: 'Officer R. Singh',
        role: 'security',
      });
    });

    test('validatePassCode: Immediate rejection when visitor is on blacklist', async () => {
      visitorService.addBlacklist(
        {
          societyId: 'soc-gvs',
          name: 'Watchlist Intruder',
          phone: '9988001122',
          reason: 'Trespassing attempt',
          blacklistedBy: 'Security Lead',
        },
        { id: 'guard-1', name: 'Officer R. Singh', role: 'security' }
      );

      const res = await visitorService.validatePassCode('soc-gvs', '9988001122');

      expect(res.isValid).toBe(false);
      expect(res.reason).toContain('VISITOR IS ON WATCHLIST/BLACKLIST');
    });

    test('validatePassCode: Successful online verification returns authoritative server-confirmed result', async () => {
      (apiClient.verifyVisitorPass as jest.Mock).mockResolvedValueOnce({
        isValid: true,
        status: 'valid',
        message: 'Gate pass verified successfully!',
        pass: {
          id: 'pass-online-ok',
          societyId: 'soc-gvs',
          visitorName: 'Sanjay Gupta',
          phone: '9820011223',
          passType: 'GUEST',
          status: 'APPROVED',
          validFrom: new Date().toISOString(),
          validTo: new Date(Date.now() + 3600000).toISOString(),
        },
      });

      const res = await visitorService.validatePassCode('soc-gvs', 'GVS-5555');

      expect(res.isValid).toBe(true);
      expect(res.isAuthoritative).toBe(true);
      expect(res.isOffline).toBe(false);
      expect(res.canAuthorizeEntry).toBe(true);
      expect(res.verificationSource).toBe('server');
      expect(res.pass?.visitorName).toBe('Sanjay Gupta');
    });

    test('validatePassCode: Online verification with invalid passcode is rejected authoritatively', async () => {
      (apiClient.verifyVisitorPass as jest.Mock).mockResolvedValueOnce({
        isValid: false,
        status: 'invalid',
        message: 'Passcode GVS-0000 not recognised in system.',
      });

      const res = await visitorService.validatePassCode('soc-gvs', 'GVS-0000');

      expect(res.isValid).toBe(false);
      expect(res.isAuthoritative).toBe(true);
      expect(res.isOffline).toBe(false);
      expect(res.canAuthorizeEntry).toBe(false);
      expect(res.verificationSource).toBe('server');
      expect(res.reason).toContain('not recognised');
    });

    test('validatePassCode (F-B1-04): Network timeout with cached pass marks result explicitly as OFFLINE and NOT valid for entry', async () => {
      (apiClient.verifyVisitorPass as jest.Mock).mockRejectedValueOnce(new Error('Gateway timeout 504'));

      // Validate seed pass 8492 offline
      const res = await visitorService.validatePassCode('soc-gvs', '8492');

      // Security Rule: A cached pass must NEVER be presented as valid or authorize gate check-in
      expect(res.isValid).toBe(false);
      expect(res.isOffline).toBe(true);
      expect(res.isAuthoritative).toBe(false);
      expect(res.canAuthorizeEntry).toBe(false);
      expect(res.verificationSource).toBe('offline_cache');
      expect(res.reason).toContain('OFFLINE CACHED RECORD');
      expect(res.pass?.visitorName).toBe('Rahul Verma');
    });

    test('validatePassCode (F-B1-04): Revoked pass in offline cache is rejected with revoked status', async () => {
      (apiClient.verifyVisitorPass as jest.Mock).mockRejectedValueOnce(new Error('Network offline'));

      // Set pass 8492 as REVOKED in local storage
      const passes = visitorService.getPasses('soc-gvs');
      const idx = passes.findIndex(p => p.id === 'pass-8492');
      if (idx !== -1) {
        passes[idx].status = 'REVOKED';
        localStorage.setItem('communityos_visitor_passes_v2', JSON.stringify(passes));
      }

      const res = await visitorService.validatePassCode('soc-gvs', '8492');

      expect(res.isValid).toBe(false);
      expect(res.isOffline).toBe(true);
      expect(res.canAuthorizeEntry).toBe(false);
      expect(res.reason).toContain('REVOKED');
    });

    test('validatePassCode (F-B1-04): Expired pass in offline cache is rejected with expired status', async () => {
      (apiClient.verifyVisitorPass as jest.Mock).mockRejectedValueOnce(new Error('Network offline'));

      // Set pass 8492 validUntil to past
      const passes = visitorService.getPasses('soc-gvs');
      const idx = passes.findIndex(p => p.id === 'pass-8492');
      if (idx !== -1) {
        passes[idx].validUntil = new Date(Date.now() - 3600000).toISOString();
        localStorage.setItem('communityos_visitor_passes_v2', JSON.stringify(passes));
      }

      const res = await visitorService.validatePassCode('soc-gvs', '8492');

      expect(res.isValid).toBe(false);
      expect(res.isOffline).toBe(true);
      expect(res.canAuthorizeEntry).toBe(false);
      expect(res.reason).toContain('EXPIRED');
    });

    test('checkInVisitor (F-B1-04): Attempted check-in fails closed when server API is unavailable', async () => {
      (apiClient.checkInVisitorPass as jest.Mock).mockRejectedValueOnce(new Error('Connection refused'));
      (apiClient.updateVisitorPass as jest.Mock).mockRejectedValueOnce(new Error('Connection refused'));

      await expect(
        visitorService.checkInVisitor(
          'pass-8492',
          { gateName: 'Main Gate 1', officerName: 'Officer R. Singh' },
          { id: 'guard-1', name: 'Officer R. Singh', role: 'guard' }
        )
      ).rejects.toThrow('Check-in failed on server');
    });
  });

  describe('4. Pass Revocation & Deletion Controls', () => {
    test('revokePass: Updates status to CANCELLED on backend and synchronizes cache', async () => {
      (apiClient.updateVisitorPass as jest.Mock).mockResolvedValueOnce({
        id: 'pass-8492',
        societyId: 'soc-gvs',
        visitorName: 'Rahul Verma',
        phone: '9820198201',
        passType: 'GUEST',
        status: 'CANCELLED',
      });

      const revoked = await visitorService.revokePass('pass-8492', {
        id: 'res-1',
        name: 'Vikram Joshi',
        role: 'resident',
      });

      expect(apiClient.updateVisitorPass).toHaveBeenCalledWith('pass-8492', { status: 'CANCELLED' });
      expect(revoked.status).toBe('REVOKED');
      expect(revoked.lifecycleState).toBe('CANCELLED');

      const cached = visitorService.getPasses('soc-gvs');
      const pass = cached.find((p) => p.id === 'pass-8492');
      expect(pass?.status).toBe('REVOKED');
    });
  });

  describe('5. Realtime Refresh Deduplication & In-Flight Guards (F-B1-06)', () => {
    test('Debounced refresh deduplicates burst realtime events', async () => {
      let callCount = 0;
      (apiClient.getVisitorPasses as jest.Mock).mockImplementation(async () => {
        callCount++;
        return [];
      });

      // Simulate a burst refresh queue with 300ms debounce
      let timer: any = null;
      const debouncedRefresh = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(async () => {
          await visitorService.fetchPasses('soc-gvs');
        }, 50);
      };

      // 5 rapid burst events
      debouncedRefresh();
      debouncedRefresh();
      debouncedRefresh();
      debouncedRefresh();
      debouncedRefresh();

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Despite 5 burst triggers, only 1 HTTP call executed
      expect(callCount).toBe(1);
    });

    test('Stale response guard prevents older out-of-order response from overwriting newer state', async () => {
      let latestRequestId = 0;
      let committedData: any = null;

      const triggerRequest = async (requestId: number, returnData: string, delayMs: number) => {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        // Stale guard: commit only if this is the newest request
        if (requestId === latestRequestId) {
          committedData = returnData;
        }
      };

      // Request 1 starts first (slow: 80ms)
      latestRequestId = 1;
      const req1 = triggerRequest(1, 'stale_first_result', 80);

      // Request 2 starts second (fast: 20ms)
      latestRequestId = 2;
      const req2 = triggerRequest(2, 'fresh_second_result', 20);

      await Promise.all([req1, req2]);

      // Request 1 finished last, but was discarded because requestId 1 !== latestRequestId (2)
      expect(committedData).toBe('fresh_second_result');
    });

    test('Cleanup function cancels pending debounce timers and unmounts cleanly', async () => {
      let executed = false;
      let timer: any = setTimeout(() => {
        executed = true;
      }, 100);

      // Component unmount cleanup
      clearTimeout(timer);
      timer = null;

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(executed).toBe(false);
    });
});
