import type { UserProfile } from '../domains/auth/types';

export const AUTH_KEYS = {
  TOKEN: 'aarizo_token',
  USER: 'aarizo_user',
  SESSION_ACTIVE: 'aarizo_active_session',
  LAST_ROUTE: 'aarizo_last_route',
  LAST_ROLE: 'aarizo_last_role',
  ONBOARDING_COMPLETED: 'aarizo_onboarding_completed',
  AUTH_PROVIDER: 'aarizo_auth_provider',
} as const;

export const LEGACY_KEYS = {
  USER: ['dwellora_user', 'communityos_auth_user'],
  TOKEN: ['dwellora_token', 'communityos_token'],
  SESSION_ACTIVE: ['dwellora_active_session'],
  LAST_ROUTE: ['dwellora_last_route'],
  LAST_ROLE: ['dwellora_last_role'],
  ONBOARDING_COMPLETED: ['dwellora_onboarding_completed'],
} as const;

/**
 * Safely accesses localStorage in browser or mock environments
 */
const getLocalStorage = (): Storage | null => {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  if (typeof localStorage !== 'undefined') {
    return localStorage;
  }
  return null;
};

/**
 * Safely accesses sessionStorage in browser or mock environments
 */
const getSessionStorage = (): Storage | null => {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    return window.sessionStorage;
  }
  if (typeof sessionStorage !== 'undefined') {
    return sessionStorage;
  }
  return null;
};

/**
 * Retrieves the active Bearer token.
 * Checks canonical 'aarizo_token', with transparent migration from legacy keys.
 */
export const getAuthToken = (): string | null => {
  try {
    const ls = getLocalStorage();
    const ss = getSessionStorage();

    const token = ls?.getItem(AUTH_KEYS.TOKEN) || ss?.getItem(AUTH_KEYS.TOKEN);
    if (token) return token;

    // Legacy fallback check & transparent migration
    for (const legacyKey of LEGACY_KEYS.TOKEN) {
      const legacyToken = ls?.getItem(legacyKey) || ss?.getItem(legacyKey);
      if (legacyToken) {
        ls?.setItem(AUTH_KEYS.TOKEN, legacyToken);
        ls?.removeItem(legacyKey);
        ss?.removeItem(legacyKey);
        return legacyToken;
      }
    }
  } catch {}
  return null;
};

/**
 * Retrieves the stored UserProfile.
 * Checks canonical 'aarizo_user', with transparent migration from legacy keys.
 */
export const getStoredUser = (): UserProfile | null => {
  try {
    const ls = getLocalStorage();
    const raw = ls?.getItem(AUTH_KEYS.USER);
    if (raw) {
      return JSON.parse(raw) as UserProfile;
    }

    // Legacy fallback check & transparent migration
    for (const legacyKey of LEGACY_KEYS.USER) {
      const legacyRaw = ls?.getItem(legacyKey);
      if (legacyRaw) {
        try {
          const parsed = JSON.parse(legacyRaw) as UserProfile;
          ls?.setItem(AUTH_KEYS.USER, legacyRaw);
          ls?.removeItem(legacyKey);
          return parsed;
        } catch {}
      }
    }
  } catch {}
  return null;
};

/**
 * Evaluates whether an authenticated session is valid.
 * An active session requires:
 * 1. An active session flag in sessionStorage.
 * 2. A non-empty Bearer token in storage.
 * 3. A valid UserProfile.
 * A stored user profile alone is NEVER proof of authentication.
 */
export const isSessionValid = (): boolean => {
  try {
    const ss = getSessionStorage();
    const isSessionActive =
      ss?.getItem(AUTH_KEYS.SESSION_ACTIVE) === 'true' ||
      ss?.getItem('dwellora_active_session') === 'true';

    const token = getAuthToken();
    const user = getStoredUser();

    return Boolean(isSessionActive && token && user);
  } catch {
    return false;
  }
};

/**
 * Retrieves the current authentication provider ('password' | 'firebase' | 'mock').
 */
export const getAuthProvider = (): 'password' | 'firebase' | 'mock' | null => {
  try {
    const ls = getLocalStorage();
    const val = ls?.getItem(AUTH_KEYS.AUTH_PROVIDER);
    if (val === 'password' || val === 'firebase' || val === 'mock') {
      return val;
    }
  } catch {}
  return null;
};

/**
 * Updates the active Bearer token for the current authenticated session.
 * Used for silent token refreshes (e.g. Firebase onIdTokenChanged).
 */
export const updateAuthToken = (
  token: string,
  provider?: 'password' | 'firebase' | 'mock'
): boolean => {
  try {
    const ls = getLocalStorage();
    const ss = getSessionStorage();

    const isSessionActive =
      ss?.getItem(AUTH_KEYS.SESSION_ACTIVE) === 'true' ||
      ss?.getItem('dwellora_active_session') === 'true';

    if (!isSessionActive || !token) {
      return false;
    }

    ls?.setItem(AUTH_KEYS.TOKEN, token);
    if (provider) {
      ls?.setItem(AUTH_KEYS.AUTH_PROVIDER, provider);
    }
    return true;
  } catch (e) {
    console.warn('Failed to update auth token:', e);
    return false;
  }
};

/**
 * Persists an authenticated user session across storage layers.
 * GAP-09 Guard: A user switch without a replacement token immediately invalidates
 * the previous user's token and refuses to create an authenticated session.
 */
export const saveAuthSession = (
  user: UserProfile,
  token?: string,
  provider: 'password' | 'firebase' | 'mock' = 'password'
): void => {
  try {
    const ls = getLocalStorage();
    const ss = getSessionStorage();

    const existingUser = getStoredUser();
    const existingId = existingUser?.id || (existingUser as any)?.uid;
    const newId = user?.id || (user as any)?.uid;
    const isDifferentUser = Boolean(existingId && newId && existingId !== newId);

    // GAP-09: Prevent inheriting previous user's token on user switch
    if (isDifferentUser && !token) {
      ls?.removeItem(AUTH_KEYS.TOKEN);
      ss?.removeItem(AUTH_KEYS.TOKEN);
      ss?.removeItem(AUTH_KEYS.SESSION_ACTIVE);
      console.warn('[authStorage] User switch detected without a replacement token. Previous token invalidated.');
      return;
    }

    // A user profile alone is NEVER proof of authentication
    if (!token && !getAuthToken()) {
      console.warn('[authStorage] Cannot create an authenticated session without an authorization token.');
      return;
    }

    ss?.setItem(AUTH_KEYS.SESSION_ACTIVE, 'true');
    if (user.role) {
      ss?.setItem(AUTH_KEYS.LAST_ROLE, user.role.toLowerCase());
    }

    ls?.setItem(AUTH_KEYS.USER, JSON.stringify(user));
    ls?.setItem(AUTH_KEYS.AUTH_PROVIDER, provider);

    if (token) {
      ls?.setItem(AUTH_KEYS.TOKEN, token);
    }

    // Clean up all legacy storage keys
    for (const legacyKey of LEGACY_KEYS.USER) ls?.removeItem(legacyKey);
    for (const legacyKey of LEGACY_KEYS.TOKEN) {
      ls?.removeItem(legacyKey);
      ss?.removeItem(legacyKey);
    }
  } catch (e) {
    console.warn('Failed to save auth session:', e);
  }
};

/**
 * Clears all canonical and legacy authentication and session storage keys.
 */
export const clearAuthSession = (): void => {
  try {
    const ls = getLocalStorage();
    const ss = getSessionStorage();

    ss?.removeItem(AUTH_KEYS.SESSION_ACTIVE);
    ss?.removeItem(AUTH_KEYS.LAST_ROUTE);
    ss?.removeItem(AUTH_KEYS.LAST_ROLE);
    ss?.removeItem('dwellora_active_session');
    ss?.removeItem('dwellora_last_route');
    ss?.removeItem('dwellora_last_role');

    ls?.removeItem(AUTH_KEYS.USER);
    ls?.removeItem(AUTH_KEYS.TOKEN);
    ls?.removeItem(AUTH_KEYS.AUTH_PROVIDER);

    for (const legacyKey of LEGACY_KEYS.USER) ls?.removeItem(legacyKey);
    for (const legacyKey of LEGACY_KEYS.TOKEN) {
      ls?.removeItem(legacyKey);
      ss?.removeItem(legacyKey);
    }
  } catch (e) {
    console.warn('Failed to clear auth session:', e);
  }
};

/**
 * Constructs request headers with the authoritative Bearer authorization token.
 */
export const getAuthHeaders = (extraHeaders: Record<string, string> = {}): Record<string, string> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };

  const user = getStoredUser();
  if (user) {
    if (user.societyId && !headers['x-society-id']) headers['x-society-id'] = user.societyId;
    if ((user.id || (user as any).uid) && !headers['x-user-id']) headers['x-user-id'] = user.id || (user as any).uid;
    if (user.role && !headers['x-user-role']) headers['x-user-role'] = user.role;
  }

  const token = getAuthToken();
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
};

/**
 * Shared authenticated fetch wrapper ensuring every protected API call
 * transmits the authoritative Bearer token and handles 401s consistently.
 */
export const authenticatedFetch = async (
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> => {
  const currentHeaders = (init.headers as Record<string, string>) || {};
  const mergedHeaders = getAuthHeaders(currentHeaders);

  const response = await fetch(input, {
    ...init,
    headers: mergedHeaders,
  });

  if (response.status === 401) {
    // If backend rejects credentials on protected endpoint, clear stale session
    const urlStr = typeof input === 'string' ? input : input.toString();
    if (!urlStr.includes('/api/auth/login')) {
      clearAuthSession();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('aarizo:unauthorized'));
      }
    }
  }

  return response;
};
