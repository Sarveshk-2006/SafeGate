import type { UserRole } from '../domains/auth/types';
import { AUTH_KEYS } from '../services/authStorage';

const ACTIVE_SESSION_KEY = AUTH_KEYS.SESSION_ACTIVE;
const LAST_ROUTE_KEY = AUTH_KEYS.LAST_ROUTE;
const LAST_ROLE_KEY = AUTH_KEYS.LAST_ROLE;

/**
 * List of sensitive or transient paths/modals that should NEVER be restored after fresh launch or reload
 */
const SENSITIVE_PATH_PATTERNS = [
  '/login',
  '/onboarding',
  '/unauthorized',
  '/otp',
  '/pay',
  '/payment',
  '/confirm',
  '/qr',
  '/emergency/alert',
  '/emergency-command',
  '/child-safety/exit-pass',
];

/**
 * Validates whether a saved route can be safely restored for the active user role
 */
export const validateRestorableRoute = (role: UserRole | string | undefined, savedRoute: string | null): string | null => {
  if (!role || !savedRoute) return null;

  const cleanRole = role.toLowerCase();
  const cleanRoute = savedRoute.toLowerCase().trim();

  // Check if route matches any sensitive pattern
  const isSensitive = SENSITIVE_PATH_PATTERNS.some((pattern) => cleanRoute.includes(pattern));
  if (isSensitive) return null;

  // Verify role ownership
  if (cleanRole === 'resident' && (cleanRoute.startsWith('/resident') || cleanRoute.startsWith('/notifications') || cleanRoute.startsWith('/my-flat'))) {
    return savedRoute;
  }
  if ((cleanRole === 'guard' || cleanRole === 'security') && (cleanRoute.startsWith('/security') || cleanRoute.startsWith('/guard') || cleanRoute.startsWith('/notifications'))) {
    return savedRoute;
  }
  if (cleanRole === 'secretary' && (cleanRoute.startsWith('/admin') || cleanRoute.startsWith('/secretary') || cleanRoute.startsWith('/notifications'))) {
    return savedRoute;
  }
  if (cleanRole === 'committee' && (cleanRoute.startsWith('/committee') || cleanRoute.startsWith('/notifications'))) {
    return savedRoute;
  }
  if (cleanRole === 'vendor' && (cleanRoute.startsWith('/vendor') || cleanRoute.startsWith('/notifications'))) {
    return savedRoute;
  }
  if ((cleanRole === 'facility_manager' || cleanRole === 'facility') && (cleanRoute.startsWith('/facility') || cleanRoute.startsWith('/notifications'))) {
    return savedRoute;
  }
  if (cleanRole === 'admin' && (cleanRoute.startsWith('/super-admin') || cleanRoute.startsWith('/admin') || cleanRoute.startsWith('/notifications'))) {
    return savedRoute;
  }

  return null;
};

/**
 * Save active protected route during navigation
 */
export const trackActiveRoute = (role: string | undefined, currentPath: string) => {
  if (!role || typeof window === 'undefined') return;

  const isSessionActive =
    sessionStorage.getItem(ACTIVE_SESSION_KEY) === 'true' ||
    sessionStorage.getItem('dwellora_active_session') === 'true';
  if (!isSessionActive) return;

  const cleanPath = currentPath.toLowerCase();
  const isSensitive = SENSITIVE_PATH_PATTERNS.some((pattern) => cleanPath.includes(pattern));
  if (isSensitive) return;

  try {
    sessionStorage.setItem(LAST_ROUTE_KEY, currentPath);
    sessionStorage.setItem(LAST_ROLE_KEY, role.toLowerCase());
  } catch (e) {
    console.debug('Failed to store active route:', e);
  }
};

/**
 * Get the restored route if valid, or fallback default role route
 */
export const getRestoredOrRoleDefaultRoute = (role: string | undefined, defaultRoute: string): string => {
  if (typeof window === 'undefined') return defaultRoute;

  const isSessionActive =
    sessionStorage.getItem(ACTIVE_SESSION_KEY) === 'true' ||
    sessionStorage.getItem('dwellora_active_session') === 'true';
  if (!isSessionActive) return defaultRoute;

  const savedRoute =
    sessionStorage.getItem(LAST_ROUTE_KEY) ||
    sessionStorage.getItem('dwellora_last_route');
  const validated = validateRestorableRoute(role, savedRoute);

  return validated || defaultRoute;
};
