# AARIZO / Dwellora — Phase 4.7
# Profile Functionality & Real-Time Sync Audit Report

**Document Date:** November 19, 2026  
**Auditor:** Principal Frontend Architect & Senior Application Security Engineer  
**Scope:** Multi-Portal Profile Architecture, Real-Time Synchronization & Role-Aware Document Systems  
**Gold Standard Reference:** `src/pages/dashboard/resident/ResidentProfilePage.tsx`  
**State Context Audited:** `src/context/AuthContext.tsx`, `src/services/authStorage.ts`, `src/components/mobile/MobileAppShell.tsx`

---

## 1. Executive Summary

A core mission of Phase 4.7 is to deliver a fully functional, role-aware **Profile experience** across every portal in AARIZO / Dwellora.

In the current codebase, the Profile tab functions well in the Residents portal (`/resident/profile`), featuring avatar management, personal contact details, verified resident documents locker, preference links, and secure sign-out. However, in the other portals:
1. **Admin Portal (`/admin/profile`):** Broken route target. Renders `<AdminHomePage />`. No dedicated profile page exists.
2. **Security Guard Portal (`/security/profile`):** Broken route target. Renders `<SecurityTerminalPage />`. No dedicated profile page exists.
3. **Committee Portal (`/committee/profile`):** Route misdirection. Router points to `<CommitteeDashboard />`, although a comprehensive 729-line `CommitteeProfilePage.tsx` exists.
4. **Facility Manager Portal (`/facility/profile`):** Exists (`FacilityProfilePage.tsx`), but has minor layout deviations and lacks immediate real-time synchronization with `AuthContext`.
5. **Super Admin Portal (`/super-admin/profile`):** Route missing completely.
6. **State Synchronization Disconnect:** `AuthContext.tsx` maintains `currentUser` state, but does **not** expose a standard `updateCurrentUser(updates: Partial<UserProfile>)` method. When profile components update `localStorage`, the parent `MobileAppShell` (header title, drawer avatar, display name) is not immediately re-rendered in the current tab without a full browser reload.

---

## 2. Baseline Architecture: Resident Profile Page

The Resident Profile Page (`src/pages/dashboard/resident/ResidentProfilePage.tsx`) provides the architectural blueprint:

```
┌───────────────────────────────────────────────────────────────┐
│               RESIDENT PROFILE ARCHITECTURE                   │
├───────────────────────────────────────────────────────────────┤
│ 1. Hero Identity Card:                                        │
│    - 84x84 Avatar with initials fallback                      │
│    - Camera icon trigger for Avatar Upload Modal              │
│    - Full Name (font-weight 800, Navy #083B56)                │
│    - Role Badge ("Resident" · Gold / Navy pill)               │
│    - Flat & Society Subtitle ("Tower B · Flat 301 · GVS")     │
│                                                               │
│ 2. Contact & Personal Details:                                │
│    - Phone number (display + edit capability)                 │
│    - Email address (display + edit capability)                │
│    - Unit / Flat details                                      │
│                                                               │
│ 3. Role-Aware Document Locker:                                │
│    - Verified Resident Govt ID (Aadhaar / Passport)           │
│    - Registered Rent Agreement / Possession Letter            │
│    - Vehicle Registration Certificate (RC)                    │
│    - Document upload modal with FileUploader integration      │
│    - Status badges: VERIFIED (Green) / UNDER_REVIEW (Yellow)  │
│                                                               │
│ 4. Settings & Quick Actions:                                  │
│    - Notification Preferences (`/notifications`)              │
│    - My Flat Details (`/resident/my-flat`)                    │
│    - Privacy & Security Settings                              │
│    - Help & Support                                           │
│                                                               │
│ 5. Security & Session:                                        │
│    - Logout Button invoking `useAuth().logout()`              │
│    - App version & copyright footer                           │
└───────────────────────────────────────────────────────────────┘
```

---

## 3. Portal-by-Portal Profile Audit

### 3.1 Society Admin / Secretary Profile
- **Current State:** Navigating to `/admin/profile` loads `AdminHomePage.tsx`. No profile UI is displayed.
- **Required Role Fields:**
  - Full Name, Official Contact Phone, Official Email.
  - Role: Secretary / Society Admin.
  - Society Name & Society ID.
  - Appointment Date / Tenure Period.
- **Required Admin Document Verification:**
  - Society Registration Certificate (under Societies Registration Act / MCS Act).
  - Secretary Appointment Order / Election Resolution.
  - Society PAN / Tax Deduction Account Number (TAN).
- **Required Admin Settings:**
  - Society Notification Dispatch Settings.
  - Operational Escalation Rules.
  - Audit Log Access.
  - Logout.

---

### 3.2 Security Guard Profile
- **Current State:** Navigating to `/security/profile` loads `SecurityTerminalPage.tsx`. No profile UI is displayed.
- **Required Role Fields:**
  - Officer Full Name, Mobile Phone, Emergency Contact.
  - Guard Badge ID / Service Number (e.g., `SEC-8821`).
  - Assigned Post / Gate (e.g., `Gate #1 Main Boom Barrier`).
  - Shift Schedule (e.g., `Morning Shift · 06:00 AM – 02:00 PM`).
  - Security Agency Name (e.g., `Eagle Eye Security Services`).
- **Required Security Document Verification:**
  - PSARA (Private Security Agencies Regulation Act) Badge / Training Certificate.
  - Police Verification Clearance Certificate.
  - Government Photo ID (Aadhaar / Voter ID).
- **Required Security Settings:**
  - Terminal Alert Audio / Haptic toggles.
  - Emergency SOS Trigger confirmation settings.
  - Logout.

---

### 3.3 Management Committee Profile
- **Current State:** `src/pages/dashboard/committee/CommitteeProfilePage.tsx` exists (729 lines) with rich functionality (avatar upload, profile edit modal, verification docs, society details). However, `src/routes/index.tsx` routes `/committee/profile` to `<CommitteeDashboard />`.
- **Finding:** Connecting `/committee/profile` directly to `<CommitteeProfilePage />` in `src/routes/index.tsx` and adding real-time sync with `AuthContext` immediately resolves the gap.

---

### 3.4 Facility Manager Profile
- **Current State:** `src/pages/dashboard/facility/FacilityProfilePage.tsx` exists (277 lines). It renders contact info, quick navigation, and logout.
- **Gaps:**
  - Lacks editable profile modal.
  - Lacks document locker for Facility Engineering Certifications / AMC Licenses.
  - Needs layout alignment with the 2-column responsive design of `ResidentProfilePage`.

---

### 3.5 Super Admin Profile
- **Current State:** Completely absent from routes and pages.
- **Required Role Fields:**
  - Platform Administrator Name, Master Email, Secure Phone.
  - Role: Super Admin / Platform Architect.
  - Access Level: Multi-Tenant Root (`*` permissions).
- **Required Super Admin Actions:**
  - Developer Database Studio link (`/dev/database`).
  - Platform System Audit Logs.
  - Multi-factor authentication status.
  - Logout.

---

### 3.6 Vendor Profile
- **Current State:** `src/pages/dashboard/vendor/VendorProfilePage.tsx` exists (988 lines). It features comprehensive company details, GST/PAN verification, operating hours, service categories, and document uploads.
- **Finding:** Fully functional; needs `updateCurrentUser` hook integration for immediate header synchronization.

---

## 4. Real-Time Profile Synchronization Analysis

### Current Problem in `AuthContext.tsx`:
```ts
// src/context/AuthContext.tsx
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
```

**Deficiency:** Notice that `AuthContextProps` has no method to update the profile of the logged-in user (`updateCurrentUser` or `updateUserProfile`).

When a user updates their name, avatar, or contact information:
1. Some pages write to `localStorage.setItem('aarizo_user', ...)` or custom keys like `aarizo_resident_avatar`.
2. Because `currentUser` in `AuthContext` is stored in React state (`useState<UserProfile | null>`), updating `localStorage` directly **does not trigger a React state change** in the active tab!
3. Consequently, `<MobileAppShell>` continues displaying the old name, initials, and society name in the top espresso header and drawer until the page is forcibly refreshed.

### Required Architecture Solution:
1. Add `updateCurrentUser: (updates: Partial<UserProfile>) => void;` to `AuthContextProps`.
2. Implement `updateCurrentUser` inside `AuthProvider`:
   - Merge `updates` into `currentUser`.
   - Persist the updated object to `localStorage.setItem(AUTH_KEYS.USER, JSON.stringify(updated))`.
   - Dispatch a custom `window.dispatchEvent(new CustomEvent('aarizo:user-updated', { detail: updated }))` to notify all active listeners.
   - React state update triggers automatic, instantaneous re-render across `MobileAppShell`, drawer, greetings, and avatar badges without a page reload.

---

## 5. Implementation Roadmap for Profiles

1. **Update `AuthContext.tsx`:** Expose `updateCurrentUser` and support live state updates.
2. **Build `AdminProfilePage.tsx`:** Standardized 2-column layout matching `ResidentProfilePage` with Secretary appointment documents and society settings. Register at `/admin/profile`.
3. **Build `SecurityProfilePage.tsx`:** Standardized layout with Guard badge, shift details, PSARA verification documents, terminal settings, and logout. Register at `/security/profile`.
4. **Update `CommitteeProfilePage.tsx`:** Wire into `updateCurrentUser` and verify direct routing at `/committee/profile`.
5. **Update `FacilityProfilePage.tsx`:** Enhance with editable contact modal and facility credentials locker.
6. **Build `SuperAdminProfilePage.tsx`:** Platform administrator profile with security audit and database studio shortcuts. Register at `/super-admin/profile`.
7. **Ensure All Profile Pages:** Call `updateCurrentUser` on save and provide visible success feedback.

