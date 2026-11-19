import React, { createContext, useContext, useState, useEffect } from 'react';
import { 
  onIdTokenChanged, 
  signInWithPhoneNumber, 
  signOut,
  RecaptchaVerifier,
} from 'firebase/auth';
import type { ConfirmationResult } from 'firebase/auth';
import { auth, db } from '../services/firebase/config';
import { doc, getDoc } from 'firebase/firestore';
import type { UserProfile, UserRole } from '../domains/auth/types';
import {
  AUTH_KEYS,
  getAuthToken,
  getStoredUser,
  getAuthProvider,
  updateAuthToken,
  isSessionValid,
  saveAuthSession,
  clearAuthSession,
} from '../services/authStorage';
import { realtimeService } from '../services/realtimeService';
import { MOCK_USERS } from '../mockData/auth/mockUsers';
import { isNativeApp } from '../utils/nativeMobile';
import { App } from '@capacitor/app';

export type AuthStatus = 
  | 'INITIALIZING'
  | 'AUTHENTICATED'
  | 'UNAUTHENTICATED'
  | 'PROFILE_MISSING'
  | 'CLAIMS_MISSING'
  | 'CLAIMS_MISMATCH';

interface AuthContextProps {
  status: AuthStatus;
  currentUser: UserProfile | null;
  phoneNumber: string;
  countryCode: string;
  error: string | null;
  hasCompletedOnboarding: boolean;
  completeOnboarding: () => void;
  setPhoneNumber: (phone: string) => void;
  submitLogin: (appVerifier: RecaptchaVerifier) => Promise<void>;
  verifyOtp: (code: string) => Promise<void>;
  loginAsRole: (role: UserRole) => void;
  loginWithProfile: (profile: UserProfile, token?: string) => void;
  logout: () => Promise<void>;
  setError: (err: string | null) => void;
}

const AuthContext = createContext<AuthContextProps | undefined>(undefined);

const ONBOARDING_STORAGE_KEY = AUTH_KEYS.ONBOARDING_COMPLETED;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(() => {
    try {
      if (!isSessionValid()) {
        clearAuthSession();
        return null;
      }
      return getStoredUser();
    } catch {
      clearAuthSession();
      return null;
    }
  });

  const [status, setStatus] = useState<AuthStatus>(() => {
    try {
      if (!isSessionValid()) {
        return 'UNAUTHENTICATED';
      }
      return getStoredUser() ? 'AUTHENTICATED' : 'UNAUTHENTICATED';
    } catch {
      return 'UNAUTHENTICATED';
    }
  });

  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState<boolean>(() => {
    try {
      return (
        localStorage.getItem(AUTH_KEYS.ONBOARDING_COMPLETED) === 'true' ||
        localStorage.getItem('dwellora_onboarding_completed') === 'true'
      );
    } catch {
      return false;
    }
  });
  
  const [phoneNumber, setPhoneNumber] = useState('');
  const [countryCode] = useState('+91');
  const [error, setError] = useState<string | null>(null);
  const [tokenRevision, setTokenRevision] = useState(0);
  
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);

  // Phase 2: Authenticated Realtime SSE Lifecycle Synchronization
  useEffect(() => {
    if (status === 'AUTHENTICATED' && currentUser && isSessionValid()) {
      const token = getAuthToken();
      const userId = currentUser.id || (currentUser as any).uid || '';
      if (token && userId) {
        realtimeService.connect({
          token,
          userId,
          societyId: currentUser.societyId,
          role: currentUser.role,
        });
        return;
      }
    }

    realtimeService.disconnect();
  }, [status, currentUser?.id, currentUser?.societyId, currentUser?.role, tokenRevision]);

  // Ensure SSE stream is aborted if AuthProvider unmounts
  useEffect(() => {
    return () => {
      realtimeService.disconnect();
    };
  }, []);

  // App Lifecycle Detection for Native Mobile Background / Foreground Resume
  useEffect(() => {
    let listenerPromise: any = null;
    if (isNativeApp()) {
      try {
        listenerPromise = App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) {
            // App resumed from background: Verify active session state
            if (!isSessionValid()) {
              // Session expired or killed -> Force login
              logout();
            } else {
              realtimeService.handleNetworkResume();
            }
          }
        });
      } catch (e) {
        console.debug('Capacitor App state listener fallback:', e);
      }
    }
    return () => {
      if (listenerPromise) {
        listenerPromise.then((handle: any) => handle && typeof handle.remove === 'function' && handle.remove()).catch(() => {});
      }
    };
  }, []);

  // GAP-08: Multi-Tab Invalidation & Synchronization Listener
  useEffect(() => {
    const handleUnauthorized = () => {
      realtimeService.disconnect();
      clearAuthSession();
      setCurrentUser(null);
      setStatus('UNAUTHENTICATED');
    };

    const handleStorageChange = (event: StorageEvent) => {
      // Only handle events targeting localStorage
      if (event.storageArea && event.storageArea !== localStorage) return;

      // When another tab logs out, clears tokens, refreshes token, or wipes storage
      if (event.key === AUTH_KEYS.TOKEN || event.key === null) {
        if (!event.newValue) {
          realtimeService.disconnect();
          clearAuthSession();
          setCurrentUser(null);
          setStatus('UNAUTHENTICATED');
        } else if (event.key === AUTH_KEYS.TOKEN) {
          setTokenRevision((rev) => rev + 1);
        }
      } else if (event.key === AUTH_KEYS.USER) {
        if (!event.newValue) {
          realtimeService.disconnect();
          clearAuthSession();
          setCurrentUser(null);
          setStatus('UNAUTHENTICATED');
        } else {
          try {
            const updatedProfile = JSON.parse(event.newValue) as UserProfile;
            if (updatedProfile && updatedProfile.id) {
              setCurrentUser(updatedProfile);
            }
          } catch {}
        }
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('aarizo:unauthorized', handleUnauthorized);
      window.addEventListener('storage', handleStorageChange);
      return () => {
        window.removeEventListener('aarizo:unauthorized', handleUnauthorized);
        window.removeEventListener('storage', handleStorageChange);
      };
    }
  }, []);

  // GAP-07: Firebase ID Token Lifecycle & Refresh Synchronization
  useEffect(() => {
    let authStateSequence = 0;

    const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
      const currentSeq = ++authStateSequence;

      if (!firebaseUser) {
        // Firebase user signed out or absent — disconnect SSE synchronously BEFORE clearing session
        const currentProvider = getAuthProvider();
        if (currentProvider === 'firebase') {
          realtimeService.disconnect();
          clearAuthSession();
          setCurrentUser(null);
          setStatus('UNAUTHENTICATED');
        } else if (!isSessionValid()) {
          // If session is invalid and not a valid password/mock session, clean up
          realtimeService.disconnect();
          clearAuthSession();
          setCurrentUser(null);
          setStatus('UNAUTHENTICATED');
        }
        return;
      }

      try {
        const storedUser = getStoredUser();
        const isCurrentFirebaseUser =
          storedUser &&
          (storedUser.id === firebaseUser.uid || (storedUser as any).uid === firebaseUser.uid) &&
          getAuthProvider() === 'firebase' &&
          isSessionValid();

        if (isCurrentFirebaseUser) {
          // Silent token refresh for existing authenticated Firebase session
          const refreshedToken = await firebaseUser.getIdToken();
          if (currentSeq !== authStateSequence) return;

          updateAuthToken(refreshedToken, 'firebase');
          setTokenRevision((rev) => rev + 1);
          return;
        }

        // Full initial login or user change: verify claims & profile
        const idTokenResult = await firebaseUser.getIdTokenResult(true);
        if (currentSeq !== authStateSequence) return;

        const claimsRole = (idTokenResult.claims.role as string | undefined)?.toLowerCase() as UserRole | undefined;
        const claimsSocietyId = idTokenResult.claims.societyId as string | undefined;

        if (!claimsRole || !claimsSocietyId) {
          console.error("Missing Custom Claims:", idTokenResult.claims);
          realtimeService.disconnect();
          setStatus('CLAIMS_MISSING');
          return;
        }

        const docRef = doc(db, 'users', firebaseUser.uid);
        const docSnap = await getDoc(docRef);
        if (currentSeq !== authStateSequence) return;

        if (!docSnap.exists()) {
          realtimeService.disconnect();
          setStatus('PROFILE_MISSING');
          return;
        }

        const profileData = docSnap.data();
        const profile: UserProfile = {
          id: docSnap.id,
          uid: firebaseUser.uid,
          name: profileData.name || '',
          phone: profileData.phone || firebaseUser.phoneNumber || '',
          email: profileData.email || firebaseUser.email || undefined,
          role: (profileData.role || '').toLowerCase() as UserRole,
          societyId: profileData.societyId || '',
          societyName: profileData.societyName,
          flatNumber: profileData.flatNumber,
          flatDetails: profileData.flatDetails,
          unitId: profileData.unitId,
          status: profileData.status || 'ACTIVE',
          avatarUrl: profileData.avatarUrl,
          designation: profileData.designation,
          statusBadge: profileData.statusBadge,
          createdAt: profileData.createdAt,
          updatedAt: profileData.updatedAt
        };

        if (profile.role !== claimsRole || profile.societyId !== claimsSocietyId) {
          console.error("Claims mismatch:", { 
            claims: { role: claimsRole, societyId: claimsSocietyId }, 
            profile: { role: profile.role, societyId: profile.societyId } 
          });
          realtimeService.disconnect();
          setStatus('CLAIMS_MISMATCH');
          return;
        }

        let idToken: string | undefined = undefined;
        try {
          idToken = await firebaseUser.getIdToken();
        } catch (tokenErr) {
          console.warn("Failed to get Firebase ID token:", tokenErr);
        }

        if (currentSeq !== authStateSequence) return;

        saveAuthSession(profile, idToken, 'firebase');
        setCurrentUser(profile);
        setStatus('AUTHENTICATED');
        setTokenRevision((rev) => rev + 1);

      } catch (err) {
        if (currentSeq !== authStateSequence) return;
        console.error("Auth initialization error:", err);
        realtimeService.disconnect();
        setError("Failed to verify user identity.");
        setStatus('UNAUTHENTICATED');
      }
    });

    return () => unsubscribe();
  }, []);

  const completeOnboarding = () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
    setHasCompletedOnboarding(true);
  };

  const submitLogin = async (appVerifier: RecaptchaVerifier) => {
    try {
      setError(null);
      const fullNumber = countryCode + phoneNumber;
      const result = await signInWithPhoneNumber(auth, fullNumber, appVerifier);
      setConfirmationResult(result);
    } catch (err: any) {
      setError(err.message || "Failed to send OTP.");
      throw err;
    }
  };

  const verifyOtp = async (code: string) => {
    if (!confirmationResult) {
      setError("No pending OTP request.");
      return;
    }
    try {
      setError(null);
      await confirmationResult.confirm(code);
      sessionStorage.setItem(AUTH_KEYS.SESSION_ACTIVE, 'true');
    } catch (err: any) {
      setError(err.message || "Invalid OTP code.");
      throw err;
    }
  };

  const loginAsRole = (role: UserRole) => {
    const user = MOCK_USERS[role] || MOCK_USERS.resident;
    const mockToken = import.meta.env.DEV ? `mock_token_${user.id}` : undefined;
    saveAuthSession(user, mockToken, 'mock');
    sessionStorage.setItem(AUTH_KEYS.LAST_ROLE, role.toLowerCase());
    setCurrentUser(user);
    setStatus('AUTHENTICATED');
    setTokenRevision((rev) => rev + 1);
  };

  const loginWithProfile = (profile: UserProfile, token?: string) => {
    saveAuthSession(profile, token, 'password');
    sessionStorage.setItem(AUTH_KEYS.LAST_ROLE, profile.role.toLowerCase());
    setCurrentUser(profile);
    setStatus('AUTHENTICATED');
    setTokenRevision((rev) => rev + 1);
  };

  const logout = async () => {
    realtimeService.disconnect();
    try {
      await signOut(auth);
    } catch (e) {
      console.warn("Firebase signout error:", e);
    }
    clearAuthSession();
    setCurrentUser(null);
    setStatus('UNAUTHENTICATED');
  };

  return (
    <AuthContext.Provider
      value={{
        status,
        currentUser,
        phoneNumber,
        countryCode,
        error,
        hasCompletedOnboarding,
        completeOnboarding,
        setPhoneNumber,
        submitLogin,
        verifyOtp,
        loginAsRole,
        loginWithProfile,
        logout,
        setError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
