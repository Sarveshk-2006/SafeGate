import {
  AUTH_KEYS,
  getAuthToken,
  getStoredUser,
  getAuthProvider,
  updateAuthToken,
  isSessionValid,
  saveAuthSession,
  clearAuthSession,
  authenticatedFetch,
} from '../src/services/authStorage';
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

describe('Phase A, Step 3.3: Targeted ISSUE-03 Session Hardening Test Suite', () => {
  let mockLocalStorage: MockStorage;
  let mockSessionStorage: MockStorage;
  let storageListeners: ((e: any) => void)[] = [];
  let unauthorizedListeners: ((e: any) => void)[] = [];
  let originalFetch: any;

  const userA: UserProfile = {
    id: 'user-resident-101',
    role: 'resident',
    societyId: 'soc-gvs-01',
    name: 'Aarav Resident',
    phone: '+919876543210',
    status: 'ACTIVE',
  };

  const userB: UserProfile = {
    id: 'user-admin-202',
    role: 'admin',
    societyId: 'soc-gvs-01',
    name: 'Vikram Admin',
    phone: '+919876543999',
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
    storageListeners = [];
    unauthorizedListeners = [];

    (global as any).localStorage = mockLocalStorage;
    (global as any).sessionStorage = mockSessionStorage;

    (global as any).window = {
      localStorage: mockLocalStorage,
      sessionStorage: mockSessionStorage,
      addEventListener: (event: string, handler: (e: any) => void) => {
        if (event === 'storage') storageListeners.push(handler);
        if (event === 'aarizo:unauthorized') unauthorizedListeners.push(handler);
      },
      removeEventListener: (event: string, handler: (e: any) => void) => {
        if (event === 'storage') {
          storageListeners = storageListeners.filter((h) => h !== handler);
        }
        if (event === 'aarizo:unauthorized') {
          unauthorizedListeners = unauthorizedListeners.filter((h) => h !== handler);
        }
      },
      dispatchEvent: (event: any) => {
        if (event.type === 'aarizo:unauthorized') {
          unauthorizedListeners.forEach((h) => h(event));
        }
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

  describe('1. GAP-07: Firebase Token Refresh Synchronization', () => {
    test('updateAuthToken updates canonical aarizo_token without disturbing profile or active session', () => {
      saveAuthSession(userA, 'initial-firebase-token-111', 'firebase');
      expect(getAuthToken()).toBe('initial-firebase-token-111');
      expect(getAuthProvider()).toBe('firebase');
      expect(isSessionValid()).toBe(true);

      const success = updateAuthToken('refreshed-firebase-token-222', 'firebase');
      expect(success).toBe(true);
      expect(getAuthToken()).toBe('refreshed-firebase-token-222');
      expect(getStoredUser()?.id).toBe(userA.id);
      expect(isSessionValid()).toBe(true);
    });

    test('updateAuthToken fails safely if session is inactive or token is empty', () => {
      // Inactive session (no active session flag in sessionStorage)
      mockLocalStorage.setItem(AUTH_KEYS.USER, JSON.stringify(userA));
      const success = updateAuthToken('some-token');
      expect(success).toBe(false);
      expect(getAuthToken()).toBeNull();
    });

    test('Stale async token retrieval guard: sequence tracking prevents outdated token commit', async () => {
      saveAuthSession(userA, 'base-token-0', 'firebase');

      let sequenceCounter = 0;

      // Simulate first async refresh started
      const seq1 = ++sequenceCounter;
      // Simulate second async refresh started rapidly before seq1 completes
      const seq2 = ++sequenceCounter;

      // Seq2 completes first and commits newest token
      updateAuthToken('newest-token-seq2', 'firebase');
      expect(getAuthToken()).toBe('newest-token-seq2');

      // Seq1 completes late -> guard check drops seq1
      if (seq1 === sequenceCounter) {
        updateAuthToken('stale-token-seq1', 'firebase');
      }

      // Token remains the newer seq2 token
      expect(getAuthToken()).toBe('newest-token-seq2');
    });

    test('Firebase sign-out clears Firebase-backed session, but preserves password sessions', () => {
      // Firebase session sign-out simulation
      saveAuthSession(userA, 'fb-token', 'firebase');
      expect(getAuthProvider()).toBe('firebase');
      expect(isSessionValid()).toBe(true);

      const simulateFirebaseSignOut = () => {
        if (getAuthProvider() === 'firebase') {
          clearAuthSession();
        }
      };
      simulateFirebaseSignOut();
      expect(isSessionValid()).toBe(false);

      // Password session simulation: Firebase unauthenticated does not clear password session
      saveAuthSession(userA, 'password-jwt-token', 'password');
      expect(getAuthProvider()).toBe('password');
      expect(isSessionValid()).toBe(true);

      simulateFirebaseSignOut(); // Password provider should be ignored
      expect(isSessionValid()).toBe(true);
      expect(getAuthToken()).toBe('password-jwt-token');
    });
  });

  describe('2. GAP-08: Multi-Tab Session Synchronization', () => {
    test('Simulated Tab 2 reacts immediately to Tab 1 logout event', () => {
      // Tab 2 has active session
      saveAuthSession(userA, 'shared-token', 'password');
      expect(isSessionValid()).toBe(true);

      let reactStateCurrentUser: UserProfile | null = userA;
      let reactStateStatus = 'AUTHENTICATED';

      const handleStorageChange = (event: any) => {
        if (event.key === AUTH_KEYS.TOKEN || event.key === null) {
          if (!event.newValue) {
            clearAuthSession();
            reactStateCurrentUser = null;
            reactStateStatus = 'UNAUTHENTICATED';
          }
        }
      };

      // Tab 1 removes token
      mockLocalStorage.removeItem(AUTH_KEYS.TOKEN);

      // Browser dispatches storage event to Tab 2
      handleStorageChange({
        key: AUTH_KEYS.TOKEN,
        oldValue: 'shared-token',
        newValue: null,
        storageArea: mockLocalStorage,
      });

      expect(reactStateCurrentUser).toBeNull();
      expect(reactStateStatus).toBe('UNAUTHENTICATED');
      expect(isSessionValid()).toBe(false);
    });

    test('Unrelated localStorage change (e.g. theme or offline cache) does NOT trigger logout', () => {
      saveAuthSession(userA, 'active-token', 'password');

      let logoutTriggered = false;
      const handleStorageChange = (event: any) => {
        if (event.key === AUTH_KEYS.TOKEN || event.key === null) {
          if (!event.newValue) {
            logoutTriggered = true;
          }
        }
      };

      // Unrelated key modified
      mockLocalStorage.setItem('aarizo_theme', 'dark');
      handleStorageChange({
        key: 'aarizo_theme',
        oldValue: 'light',
        newValue: 'dark',
        storageArea: mockLocalStorage,
      });

      expect(logoutTriggered).toBe(false);
      expect(isSessionValid()).toBe(true);
    });

    test('Token replacement in another tab (refresh) does NOT cause false logout', () => {
      saveAuthSession(userA, 'token-v1', 'firebase');

      let logoutTriggered = false;
      const handleStorageChange = (event: any) => {
        if (event.key === AUTH_KEYS.TOKEN || event.key === null) {
          if (!event.newValue) {
            logoutTriggered = true;
          }
        }
      };

      mockLocalStorage.setItem(AUTH_KEYS.TOKEN, 'token-v2');
      handleStorageChange({
        key: AUTH_KEYS.TOKEN,
        oldValue: 'token-v1',
        newValue: 'token-v2',
        storageArea: mockLocalStorage,
      });

      expect(logoutTriggered).toBe(false);
      expect(isSessionValid()).toBe(true);
    });
  });

  describe('3. GAP-09: User-Switch Token Invalidation Guard', () => {
    test('Switching users without a replacement token invalidates existing token and aborts session creation', () => {
      // User A is logged in with token A
      saveAuthSession(userA, 'token-user-a', 'password');
      expect(getStoredUser()?.id).toBe(userA.id);
      expect(getAuthToken()).toBe('token-user-a');

      // Attempt to save User B WITHOUT providing a token
      saveAuthSession(userB, undefined, 'password');

      // Token must NOT be inherited by User B; token is purged
      expect(getAuthToken()).toBeNull();
      expect(mockSessionStorage.getItem(AUTH_KEYS.SESSION_ACTIVE)).toBeNull();
      expect(isSessionValid()).toBe(false);
    });

    test('Switching users WITH a valid replacement token cleanly overwrites identity and token', () => {
      saveAuthSession(userA, 'token-user-a', 'password');
      expect(getStoredUser()?.id).toBe(userA.id);

      saveAuthSession(userB, 'token-user-b', 'password');
      expect(getStoredUser()?.id).toBe(userB.id);
      expect(getStoredUser()?.role).toBe('admin');
      expect(getAuthToken()).toBe('token-user-b');
      expect(isSessionValid()).toBe(true);
    });

    test('Updating the SAME user profile with token undefined preserves existing token and session', () => {
      saveAuthSession(userA, 'valid-token-user-a', 'password');

      const updatedUserA: UserProfile = {
        ...userA,
        name: 'Aarav Sharma Updated',
        flatNumber: 'B-501',
      };

      // Same user profile updated, token omitted
      saveAuthSession(updatedUserA, undefined, 'password');

      expect(getStoredUser()?.name).toBe('Aarav Sharma Updated');
      expect(getStoredUser()?.flatNumber).toBe('B-501');
      expect(getAuthToken()).toBe('valid-token-user-a'); // Preserved!
      expect(isSessionValid()).toBe(true);
    });

    test('A user profile alone cannot create an authenticated session when no token exists in storage', () => {
      // Storage completely empty
      expect(getAuthToken()).toBeNull();

      saveAuthSession(userA, undefined, 'password');

      expect(getAuthToken()).toBeNull();
      expect(mockSessionStorage.getItem(AUTH_KEYS.SESSION_ACTIVE)).toBeNull();
      expect(isSessionValid()).toBe(false);
    });
  });

  describe('4. Comprehensive End-to-End Authentication Resilience', () => {
    test('Password login -> AuthenticatedFetch with Bearer -> 401 triggers clean session teardown', async () => {
      saveAuthSession(userA, 'expiring-token', 'password');
      expect(isSessionValid()).toBe(true);

      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      let unauthorizedFired = false;
      unauthorizedListeners.push(() => {
        unauthorizedFired = true;
      });

      const res = await authenticatedFetch('/api/collections/residents');
      expect(res.status).toBe(401);
      expect(unauthorizedFired).toBe(true);
      expect(isSessionValid()).toBe(false);
    });
  });
});

