import {
  AUTH_KEYS,
  LEGACY_KEYS,
  getAuthToken,
  getStoredUser,
  isSessionValid,
  saveAuthSession,
  clearAuthSession,
  getAuthHeaders,
  authenticatedFetch,
} from '../src/services/authStorage';
import {
  validateRestorableRoute,
  trackActiveRoute,
  getRestoredOrRoleDefaultRoute,
} from '../src/utils/sessionRouteTracker';
import type { UserProfile } from '../src/domains/auth/types';

class MockStorage implements Storage {
  private store: Map<string, string> = new Map();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] || null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

describe('ISSUE-03: Authentication Storage & Session Consistency Test Suite', () => {
  let mockLocalStorage: MockStorage;
  let mockSessionStorage: MockStorage;
  let eventDispatched: { type: string; detail?: any }[] = [];
  let originalFetch: any;

  const mockUser: UserProfile = {
    id: 'user-resident-101',
    role: 'resident',
    societyId: 'soc-gvs-01',
    name: 'Aarav Sharma',
    phone: '+919876543210',
    email: 'aarav@aarizo.local',
    flatNumber: 'A-402',
    status: 'ACTIVE',
  };

  beforeAll(() => {
    originalFetch = (global as any).fetch;
  });

  afterAll(() => {
    (global as any).fetch = originalFetch;
  });

  beforeEach(() => {
    mockLocalStorage = new MockStorage();
    mockSessionStorage = new MockStorage();
    eventDispatched = [];

    (global as any).localStorage = mockLocalStorage;
    (global as any).sessionStorage = mockSessionStorage;

    (global as any).window = {
      localStorage: mockLocalStorage,
      sessionStorage: mockSessionStorage,
      dispatchEvent: (event: any) => {
        eventDispatched.push({ type: event.type, detail: event.detail });
        return true;
      },
    };

    (global as any).CustomEvent = class {
      type: string;
      detail: any;
      constructor(type: string, params?: { detail?: any }) {
        this.type = type;
        this.detail = params?.detail;
      }
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Canonical Storage Keys & Legacy Migration', () => {
    test('Reads and transparently migrates legacy dwellora_user to canonical aarizo_user', () => {
      mockLocalStorage.setItem('dwellora_user', JSON.stringify(mockUser));
      expect(mockLocalStorage.getItem(AUTH_KEYS.USER)).toBeNull();

      const user = getStoredUser();
      expect(user).not.toBeNull();
      expect(user?.id).toBe('user-resident-101');
      expect(user?.role).toBe('resident');

      // Verified: Migrated to canonical and purged from legacy
      expect(mockLocalStorage.getItem(AUTH_KEYS.USER)).toBe(JSON.stringify(mockUser));
      expect(mockLocalStorage.getItem('dwellora_user')).toBeNull();
    });

    test('Reads and transparently migrates legacy dwellora_token to canonical aarizo_token', () => {
      mockLocalStorage.setItem('dwellora_token', 'jwt-token-legacy-999');
      expect(mockLocalStorage.getItem(AUTH_KEYS.TOKEN)).toBeNull();

      const token = getAuthToken();
      expect(token).toBe('jwt-token-legacy-999');

      // Verified: Migrated to canonical and purged from legacy
      expect(mockLocalStorage.getItem(AUTH_KEYS.TOKEN)).toBe('jwt-token-legacy-999');
      expect(mockLocalStorage.getItem('dwellora_token')).toBeNull();
    });

    test('Reads from canonical aarizo_token directly when present', () => {
      mockLocalStorage.setItem(AUTH_KEYS.TOKEN, 'token-canonical-123');
      expect(getAuthToken()).toBe('token-canonical-123');
    });
  });

  describe('2. Authoritative Session Validity (isSessionValid)', () => {
    test('Stored user profile ALONE is rejected as unauthenticated (cold launch / missing token / missing session flag)', () => {
      mockLocalStorage.setItem(AUTH_KEYS.USER, JSON.stringify(mockUser));
      // No active session flag and no token
      expect(isSessionValid()).toBe(false);
    });

    test('Stored user profile with token but missing active session flag is rejected', () => {
      mockLocalStorage.setItem(AUTH_KEYS.USER, JSON.stringify(mockUser));
      mockLocalStorage.setItem(AUTH_KEYS.TOKEN, 'mock_token_resident_101');
      // No active session flag in sessionStorage
      expect(isSessionValid()).toBe(false);
    });

    test('Stored user profile with active session flag but missing token is rejected', () => {
      mockLocalStorage.setItem(AUTH_KEYS.USER, JSON.stringify(mockUser));
      mockSessionStorage.setItem(AUTH_KEYS.SESSION_ACTIVE, 'true');
      // No token
      expect(isSessionValid()).toBe(false);
    });

    test('Session is valid when user profile, non-empty Bearer token, and active session flag all exist', () => {
      mockLocalStorage.setItem(AUTH_KEYS.USER, JSON.stringify(mockUser));
      mockLocalStorage.setItem(AUTH_KEYS.TOKEN, 'jwt-signed-token-xyz');
      mockSessionStorage.setItem(AUTH_KEYS.SESSION_ACTIVE, 'true');

      expect(isSessionValid()).toBe(true);
    });
  });

  describe('3. Session Lifecycle Operations (saveAuthSession & clearAuthSession)', () => {
    test('saveAuthSession writes all canonical keys and purges legacy keys', () => {
      // Pre-seed legacy keys
      mockLocalStorage.setItem('dwellora_user', 'old_user');
      mockLocalStorage.setItem('dwellora_token', 'old_token');

      saveAuthSession(mockUser, 'new-bearer-token-456', 'password');

      expect(mockSessionStorage.getItem(AUTH_KEYS.SESSION_ACTIVE)).toBe('true');
      expect(mockSessionStorage.getItem(AUTH_KEYS.LAST_ROLE)).toBe('resident');
      expect(mockLocalStorage.getItem(AUTH_KEYS.USER)).toBe(JSON.stringify(mockUser));
      expect(mockLocalStorage.getItem(AUTH_KEYS.TOKEN)).toBe('new-bearer-token-456');
      expect(mockLocalStorage.getItem(AUTH_KEYS.AUTH_PROVIDER)).toBe('password');

      // Purged legacy keys
      expect(mockLocalStorage.getItem('dwellora_user')).toBeNull();
      expect(mockLocalStorage.getItem('dwellora_token')).toBeNull();
    });

    test('clearAuthSession wipes all canonical and legacy authentication keys', () => {
      // Seed canonical and legacy keys
      mockSessionStorage.setItem(AUTH_KEYS.SESSION_ACTIVE, 'true');
      mockSessionStorage.setItem(AUTH_KEYS.LAST_ROUTE, '/resident/home');
      mockSessionStorage.setItem(AUTH_KEYS.LAST_ROLE, 'resident');
      mockLocalStorage.setItem(AUTH_KEYS.USER, JSON.stringify(mockUser));
      mockLocalStorage.setItem(AUTH_KEYS.TOKEN, 'valid-token');
      mockLocalStorage.setItem('dwellora_user', 'legacy-user');
      mockLocalStorage.setItem('dwellora_token', 'legacy-token');
      mockSessionStorage.setItem('dwellora_active_session', 'true');

      clearAuthSession();

      expect(mockSessionStorage.getItem(AUTH_KEYS.SESSION_ACTIVE)).toBeNull();
      expect(mockSessionStorage.getItem(AUTH_KEYS.LAST_ROUTE)).toBeNull();
      expect(mockSessionStorage.getItem(AUTH_KEYS.LAST_ROLE)).toBeNull();
      expect(mockLocalStorage.getItem(AUTH_KEYS.USER)).toBeNull();
      expect(mockLocalStorage.getItem(AUTH_KEYS.TOKEN)).toBeNull();
      expect(mockLocalStorage.getItem('dwellora_user')).toBeNull();
      expect(mockLocalStorage.getItem('dwellora_token')).toBeNull();
      expect(mockSessionStorage.getItem('dwellora_active_session')).toBeNull();
    });

    test('Switching roles cleanly overwrites previous user identity and role in storage', () => {
      saveAuthSession(mockUser, 'resident-token', 'password');
      expect(mockSessionStorage.getItem(AUTH_KEYS.LAST_ROLE)).toBe('resident');

      const adminUser: UserProfile = {
        id: 'user-admin-999',
        role: 'admin',
        societyId: 'soc-gvs-01',
        name: 'Super Administrator',
        phone: '+919999999999',
        email: 'admin@aarizo.local',
        status: 'ACTIVE',
      };

      saveAuthSession(adminUser, 'admin-token', 'password');
      expect(mockSessionStorage.getItem(AUTH_KEYS.LAST_ROLE)).toBe('admin');
      expect(getStoredUser()?.id).toBe('user-admin-999');
      expect(getStoredUser()?.role).toBe('admin');
      expect(getAuthToken()).toBe('admin-token');
    });
  });

  describe('4. Auth Headers Generation (getAuthHeaders)', () => {
    test('Includes Bearer authorization and tenant headers when session exists', () => {
      mockLocalStorage.setItem(AUTH_KEYS.USER, JSON.stringify(mockUser));
      mockLocalStorage.setItem(AUTH_KEYS.TOKEN, 'bearer-token-test-123');

      const headers = getAuthHeaders();
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Authorization']).toBe('Bearer bearer-token-test-123');
      expect(headers['x-society-id']).toBe('soc-gvs-01');
      expect(headers['x-user-id']).toBe('user-resident-101');
      expect(headers['x-user-role']).toBe('resident');
    });

    test('Omits Authorization header when token is absent but preserves Content-Type and custom headers', () => {
      const headers = getAuthHeaders({ 'x-custom-request-id': 'req-888' });
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Authorization']).toBeUndefined();
      expect(headers['x-custom-request-id']).toBe('req-888');
    });
  });

  describe('5. Authenticated Fetch & 401 Interception (authenticatedFetch)', () => {
    test('Attaches Authorization header automatically to outgoing fetch requests', async () => {
      mockLocalStorage.setItem(AUTH_KEYS.USER, JSON.stringify(mockUser));
      mockLocalStorage.setItem(AUTH_KEYS.TOKEN, 'token-fetch-test');

      let interceptedHeaders: any = null;
      (global as any).fetch = jest.fn().mockImplementation((_url: string, init: any) => {
        interceptedHeaders = init.headers;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        });
      });

      const response = await authenticatedFetch('/api/collections/residents');
      expect(response.status).toBe(200);
      expect(interceptedHeaders['Authorization']).toBe('Bearer token-fetch-test');
    });

    test('On HTTP 401 from protected endpoint: clears session and dispatches aarizo:unauthorized event', async () => {
      mockLocalStorage.setItem(AUTH_KEYS.USER, JSON.stringify(mockUser));
      mockLocalStorage.setItem(AUTH_KEYS.TOKEN, 'expired-token');
      mockSessionStorage.setItem(AUTH_KEYS.SESSION_ACTIVE, 'true');

      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const response = await authenticatedFetch('/api/collections/payments');
      expect(response.status).toBe(401);

      // Session cleared
      expect(mockLocalStorage.getItem(AUTH_KEYS.USER)).toBeNull();
      expect(mockLocalStorage.getItem(AUTH_KEYS.TOKEN)).toBeNull();
      expect(mockSessionStorage.getItem(AUTH_KEYS.SESSION_ACTIVE)).toBeNull();

      // Dispatched unauthorized event
      expect(eventDispatched.some((e) => e.type === 'aarizo:unauthorized')).toBe(true);
    });

    test('On HTTP 401 from /api/auth/login: does NOT clear session or dispatch unauthorized event', async () => {
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const response = await authenticatedFetch('/api/auth/login');
      expect(response.status).toBe(401);
      expect(eventDispatched.length).toBe(0);
    });
  });

  describe('6. Session Route Tracker Consistency (sessionRouteTracker)', () => {
    test('Validates and restores appropriate role-specific route', () => {
      const restored = validateRestorableRoute('resident', '/resident/home');
      expect(restored).toBe('/resident/home');
    });

    test('Rejects sensitive routes from restoration (/login, /payment, /otp)', () => {
      expect(validateRestorableRoute('resident', '/login')).toBeNull();
      expect(validateRestorableRoute('resident', '/payment')).toBeNull();
      expect(validateRestorableRoute('admin', '/otp')).toBeNull();
    });

    test('Rejects role cross-restoration (e.g. resident trying to restore /admin)', () => {
      const restored = validateRestorableRoute('resident', '/admin/dashboard');
      expect(restored).toBeNull();
    });

    test('trackActiveRoute persists route in sessionStorage when session is active', () => {
      mockSessionStorage.setItem(AUTH_KEYS.SESSION_ACTIVE, 'true');
      trackActiveRoute('resident', '/resident/announcements');

      expect(mockSessionStorage.getItem(AUTH_KEYS.LAST_ROUTE)).toBe('/resident/announcements');
      expect(mockSessionStorage.getItem(AUTH_KEYS.LAST_ROLE)).toBe('resident');
    });

    test('trackActiveRoute ignores navigation when session is NOT active', () => {
      trackActiveRoute('resident', '/resident/announcements');
      expect(mockSessionStorage.getItem(AUTH_KEYS.LAST_ROUTE)).toBeNull();
    });

    test('getRestoredOrRoleDefaultRoute returns default route if session is inactive', () => {
      mockSessionStorage.setItem(AUTH_KEYS.LAST_ROUTE, '/resident/directory');
      // No active session flag
      const route = getRestoredOrRoleDefaultRoute('resident', '/resident/default');
      expect(route).toBe('/resident/default');
    });

    test('getRestoredOrRoleDefaultRoute returns saved route if session is active', () => {
      mockSessionStorage.setItem(AUTH_KEYS.SESSION_ACTIVE, 'true');
      mockSessionStorage.setItem(AUTH_KEYS.LAST_ROUTE, '/resident/directory');

      const route = getRestoredOrRoleDefaultRoute('resident', '/resident/default');
      expect(route).toBe('/resident/directory');
    });
  });
});

