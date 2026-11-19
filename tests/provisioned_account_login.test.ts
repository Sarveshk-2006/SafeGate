import {
  saveProvisionedAccount,
  getProvisionedAccounts,
  findProvisionedAccount,
  mapProvisionedToProfile,
  type ProvisionedAccountRecord,
} from '../src/services/provisionedAccountsStore';

// Mock storage for Node test environment
const mockStorage: Record<string, string> = {};
const storageMock = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, val: string) => {
    mockStorage[key] = val;
  },
  removeItem: (key: string) => {
    delete mockStorage[key];
  },
  clear: () => {
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
  },
  length: 0,
  key: () => null,
};

Object.defineProperty(globalThis, 'localStorage', {
  value: storageMock,
  writable: true,
});

describe('Real-Time Dynamic Provisioning & Authentication Verification', () => {
  beforeEach(() => {
    storageMock.clear();
  });

  it('saves and retrieves provisioned resident accounts in real-time', () => {
    const testResident: ProvisionedAccountRecord = {
      id: 'user-prov-test-01',
      name: 'Rohan Sharma',
      email: 'rohan.sharma@community.com',
      phone: '9876543299',
      role: 'resident',
      flatNumber: 'B-302',
      flatDetails: 'Tower B · Flat 302',
      societyId: 'soc-gvs',
      societyName: 'Green Valley Society',
      password: 'mypassword@2026',
      createdAt: new Date().toISOString(),
      status: 'ACTIVE',
    };

    saveProvisionedAccount(testResident);

    const stored = getProvisionedAccounts();
    expect(stored.length).toBe(1);
    expect(stored[0].email).toBe('rohan.sharma@community.com');
    expect(stored[0].name).toBe('Rohan Sharma');
    expect(stored[0].password).toBe('mypassword@2026');
  });

  it('authenticates provisioned resident with exact password and universal password', () => {
    const testResident: ProvisionedAccountRecord = {
      id: 'user-prov-test-02',
      name: 'Pooja Verma',
      email: 'pooja.verma@dwellora.com',
      phone: '9820011223',
      role: 'resident',
      flatNumber: 'C-501',
      flatDetails: 'Tower C · Flat 501',
      societyId: 'soc-gvs',
      societyName: 'Green Valley Society',
      password: 'poojaSecret#123',
      createdAt: new Date().toISOString(),
      status: 'ACTIVE',
    };

    saveProvisionedAccount(testResident);

    // Exact password match
    const matchExact = findProvisionedAccount('pooja.verma@dwellora.com', 'poojaSecret#123');
    expect(matchExact).not.toBeNull();
    expect(matchExact?.profile.name).toBe('Pooja Verma');
    expect(matchExact?.profile.flatNumber).toBe('C-501');
    expect(matchExact?.route).toBe('/resident');

    // Universal fallback match
    const matchUniversal = findProvisionedAccount('pooja.verma@dwellora.com', 'dwellora@2026');
    expect(matchUniversal).not.toBeNull();

    // Wrong password rejected
    const matchWrong = findProvisionedAccount('pooja.verma@dwellora.com', 'wrongPass');
    expect(matchWrong).toBeNull();
  });

  it('maps provisioned records correctly across all portal roles', () => {
    const guardRecord: ProvisionedAccountRecord = {
      id: 'user-prov-guard',
      name: 'Officer Vikram',
      email: 'vikram.guard@dwellora.com',
      phone: '9123456780',
      role: 'guard',
      flatDetails: 'Main Gate 2',
      societyId: 'soc-gvs',
      password: 'guard@pass',
      createdAt: new Date().toISOString(),
      status: 'ACTIVE',
    };

    const { profile, route } = mapProvisionedToProfile(guardRecord);
    expect(profile.role).toBe('guard');
    expect(route).toBe('/security');
  });
});
