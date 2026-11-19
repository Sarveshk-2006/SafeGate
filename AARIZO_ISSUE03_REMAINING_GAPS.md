# AARIZO — ISSUE-03 Remaining Gaps & Technical Debt Register

**Date:** November 14, 2026  
**Auditor:** Principal Software Architect & Senior Security Auditor  
**Scope:** Client-side token lifecycle, multi-tab synchronization, and edge-case session management  
**Classification:** Post-Verification Gap Analysis for ISSUE-03

---

## 1. Executive Summary

While the core objectives of **ISSUE-03** (Storage Key Mismatch, Cold-Launch Safety, and Bearer Token Propagation across all 24 direct fetch calls) are fully resolved and verified, four non-blocking secondary gaps have been identified during independent verification.

These gaps do not prevent core login, navigation, or API operations, but represent edge-case vulnerabilities and quality improvements required for production readiness.

---

## 2. Itemized Gap Dossiers

### GAP-07 [P2]: Firebase ID Token Silent Refresh Synchronization
- **Category**: Authentication Token Lifecycle / Expiry Handling
- **Location**: [src/context/AuthContext.tsx#L135-L210](file:///d:/AAZIRA/AARIZO/src/context/AuthContext.tsx#L135-L210)
- **Description**: `AuthContext.tsx` subscribes to Firebase Auth via `onAuthStateChanged()`. While the Firebase Web SDK automatically refreshes ID tokens every ~55 minutes internally, `onAuthStateChanged()` only triggers on initial sign-in, user switch, or sign-out—it does **not** trigger on token refresh alone.
- **Impact**: If a Firebase OTP authenticated user keeps a single browser tab open and continuously active for over 60 minutes without reloading the page, the Bearer token in `localStorage.getItem('aarizo_token')` will expire. The user's next API request will receive an HTTP 401 `AUTH_TOKEN_INVALID` from the backend, triggering an unexpected session teardown and logout.
- **Risk Assessment**: Medium. Affects users on prolonged single-session dashboard usage without page refresh.
- **Recommended Remediation**:
  In `AuthContext.tsx`, subscribe to `onIdTokenChanged(auth, async (user) => { ... })`:
  ```typescript
  import { onIdTokenChanged } from 'firebase/auth';
  // Inside AuthProvider:
  useEffect(() => {
    const unsub = onIdTokenChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const freshToken = await firebaseUser.getIdToken();
          const user = getStoredUser();
          if (user) {
            saveAuthSession(user, freshToken, 'firebase');
          }
        } catch (e) {
          console.warn('Silent token refresh failed:', e);
        }
      }
    });
    return () => unsub();
  }, []);
  ```

---

### GAP-08 [P2]: Multi-Tab Logout & Invalidation Synchronization
- **Category**: Cross-Tab Session Consistency
- **Location**: [src/context/AuthContext.tsx#L120-L130](file:///d:/AAZIRA/AARIZO/src/context/AuthContext.tsx#L120-L130)
- **Description**: When a user logs out in Tab 1, `clearAuthSession()` removes `aarizo_token` and `aarizo_user` from `localStorage`. However, `AuthContext.tsx` only listens to `aarizo:unauthorized` via `window.dispatchEvent`, which is scoped to the current tab. Tab 2 does not listen to native browser `window.addEventListener('storage')`.
- **Impact**: Tab 2 remains visually logged in with its cached React state until the user either refreshes Tab 2 or makes a network call that triggers a 401 response.
- **Risk Assessment**: Low to Medium. Tab 2 cannot make successful unauthorized API calls (they will fail with 401 and reset Tab 2), but sensitive dashboard information remains visible in Tab 2 until an interaction occurs.
- **Recommended Remediation**:
  Add a native `storage` event listener in `AuthContext.tsx`:
  ```typescript
  useEffect(() => {
    const handleStorageEvent = (event: StorageEvent) => {
      if (event.key === AUTH_KEYS.TOKEN && !event.newValue) {
        // Token was removed in another tab -> Log out current tab
        setCurrentUser(null);
        setStatus('UNAUTHENTICATED');
        clearAuthSession();
      }
    };
    window.addEventListener('storage', handleStorageEvent);
    return () => window.removeEventListener('storage', handleStorageEvent);
  }, []);
  ```

---

### GAP-09 [P3]: User Switching Token Invalidation Guard
- **Category**: Defensive Session Storage Management
- **Location**: [src/services/authStorage.ts#L129-L159](file:///d:/AAZIRA/AARIZO/src/services/authStorage.ts#L129-L159)
- **Description**: `saveAuthSession(user, token?, provider?)` takes `token?: string`. If `token` is `undefined`, it leaves the existing token in `localStorage` intact:
  ```typescript
  if (token) {
    ls?.setItem(AUTH_KEYS.TOKEN, token);
  }
  ```
- **Impact**: In all existing application login flows, `token` is always passed. However, if a future caller invokes `saveAuthSession(newUser)` with a different user identity without passing a token, the stored Bearer token from the *previous* user would remain associated with the new profile.
- **Risk Assessment**: Low. Existing callers pass tokens on every login; this is defensive hygiene.
- **Recommended Remediation**:
  ```typescript
  const existingUser = getStoredUser();
  if (token) {
    ls?.setItem(AUTH_KEYS.TOKEN, token);
  } else if (existingUser && existingUser.id !== user.id) {
    // Prevent carrying over token from previous user
    ls?.removeItem(AUTH_KEYS.TOKEN);
  }
  ```

---

### GAP-10 [P3]: Client-Side Proactive JWT Expiry Detection
- **Category**: UX Optimization / Preemptive Expiry
- **Location**: [src/services/authStorage.ts#L110-L124](file:///d:/AAZIRA/AARIZO/src/services/authStorage.ts#L110-L124)
- **Description**: `isSessionValid()` checks only whether a non-empty token string exists, leaving expiry detection entirely to backend HTTP 401 responses.
- **Impact**: If a user returns to a tab with an expired JWT token, the UI initially appears authenticated until an API call fails with 401. If the user submits a complex form right after expiry, their in-flight form submission fails.
- **Risk Assessment**: Low. Backend correctly rejects expired tokens; proactive decoding would improve user experience.
- **Recommended Remediation**:
  Optionally decode the unencrypted JWT payload (`JSON.parse(atob(parts[1]))`) in `isSessionValid()` to inspect `exp * 1000 < Date.now()`. If expired, proactively trigger logout before attempting doomed API calls.

---

## 3. Summary of Gaps vs Release Status

| Gap ID | Priority | Description | Severity | Blocker for Next Phase? |
| :---: | :---: | :--- | :---: | :---: |
| **GAP-07** | P2 | Firebase ID token silent refresh not synced to storage | Medium | No |
| **GAP-08** | P2 | Multi-tab logout sync relies on reactive 401 network call | Low-Med | No |
| **GAP-09** | P3 | `saveAuthSession` does not purge token when user changes without new token | Low | No |
| **GAP-10** | P3 | Client-side lacks proactive client-side JWT expiry check | Low | No |

---

## 4. Recommendation for Phase Planning

These 4 gaps are scoped, well-defined quality and lifecycle enhancements. They can either be remediated as a quick hardening pass before ISSUE-04, or tracked in the register for Phase B hardening.

