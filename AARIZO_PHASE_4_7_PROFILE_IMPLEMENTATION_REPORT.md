# AARIZO / Dwellora — Phase 4.7
# Profile System Implementation Report

**Document Date:** November 19, 2026  
**Auditor / Implementer:** Principal Product Designer, Senior React Architect & Frontend QA  
**Scope:** Multi-Portal Role-Aware Profile System, Document Lockers & Real-Time Auth State Sync  
**Reference Model:** Resident Profile (`src/pages/dashboard/resident/ResidentProfilePage.tsx`)  
**Components Implemented & Enhanced:**
- `src/pages/dashboard/admin/AdminProfilePage.tsx` (New Dedicated Profile)
- `src/pages/dashboard/security/SecurityProfilePage.tsx` (New Dedicated Profile)
- `src/pages/dashboard/SuperAdminProfilePage.tsx` (New Dedicated Profile)
- `src/pages/dashboard/staff/StaffProfilePage.tsx` (New Dedicated Profile for Domestic & Service Staff)
- `src/pages/dashboard/committee/CommitteeProfilePage.tsx` (Enhanced with AuthContext Sync)
- `src/pages/dashboard/facility/FacilityProfilePage.tsx` (Enhanced with Document Locker & AuthContext Sync)
- `src/pages/dashboard/vendor/VendorProfilePage.tsx` (Enhanced with AuthContext Sync)
- `src/pages/dashboard/resident/ResidentProfilePage.tsx` (Enhanced with Avatar AuthContext Sync)
- `src/context/AuthContext.tsx` (Added `updateCurrentUser` Action)

---

## 1. Executive Summary

Prior to Phase 4.7, user profile management was deeply fragmented across portals:
1. **Resident Portal:** Contained a mature 2-column profile layout with avatar upload, document vault, and emergency contacts.
2. **Admin Portal:** Navigating to `/admin/profile` redirected to the Resident Profile page, misattributing flat numbers and resident emergency contacts to society secretaries.
3. **Security Portal:** Navigating to `/security/profile` had no dedicated view, redirecting or defaulting to the guard terminal.
4. **Super Admin Portal:** The global platform administrator had no profile view at all.
5. **Staff Portals (`DOMESTIC_WORKER`, `SERVICE_PROVIDER`):** Had no dedicated profile views, work schedule cards, or digital gate pass credentials.
6. **Committee, Facility & Vendor Portals:** Contained partial profile views that wrote solely to local mock states, failing to update `AuthContext`, the header avatar, or the drawer user label.

Phase 4.7 resolves this deficiency completely by implementing a role-aware Profile Architecture across all 9 roles. Every portal now provides a dedicated, visually unified, role-scoped profile experience. Furthermore, profile updates now trigger real-time synchronization through `AuthContext.updateCurrentUser`, instantly updating the app shell header and drawer across components without page reloads.

---

## 2. Profile System Architecture & Design Standard

All profile pages strictly adhere to the visual hierarchy, layout tokens, and elevation patterns established by `ResidentProfilePage`:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        UNIFIED PROFILE TOPOLOGY                        │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Profile Header Card (White Card, Rounded 16px, Border #E2E8F0)      │
│    - Large 72x72 Avatar with Hover/Click Camera Action                 │
│    - Display Name (1.25rem, Font-Weight 700, Dark Navy #0F172A)        │
│    - Official Role Badge (Role Pill, e.g. "HONORARY SECRETARY",        │
│      "CHIEF SECURITY OFFICER", "PLATFORM ROOT ADMINISTRATOR")          │
│    - Secondary Context (Society Name, Post Location, or Flat)          │
│    - Edit Profile Button (Triggers modal with form validation)         │
├────────────────────────────────────────────────────────────────────────┤
│ 2. Role Identity & Contact Details Card                                │
│    - Official Contact Phone & Email with copy/verification badges      │
│    - Designation & Unit/Room Assignment                                │
│    - Shift / Operating Hours / Jurisdiction                             │
├────────────────────────────────────────────────────────────────────────┤
│ 3. Role-Scoped Statutory Document Locker                               │
│    - Document title, issue date, issuing authority, and status badge   │
│    - View & Download actions                                           │
│    - Upload new document trigger with FileUploader integration         │
├────────────────────────────────────────────────────────────────────────┤
│ 4. Digital Credential / Identity Verification                          │
│    - Dynamic SVG QR Code (Staff / Security) or Verified Trust Seal     │
│    - Digital Signature / Roster Badge                                  │
├────────────────────────────────────────────────────────────────────────┤
│ 5. Account Settings & Security Controls                                │
│    - Password change modal with validation                             │
│    - Two-Factor / Biometric Authentication toggles                     │
│    - Push Notification Preferences                                     │
│    - Active Session Termination & Sign Out                             │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Role-by-Role Profile Implementation Breakdown

### 3.1 Society Admin (`AdminProfilePage.tsx`)
- **Route:** `/admin/profile`
- **Role Identity:** Honorary Secretary / Society President
- **Designation Details:**
  - Official Society Email (`secretary@greenvalley.com`)
  - Administrative Office: Society Main Office, Clubhouse 1st Floor
  - Jurisdiction: All Society Towers & Common Areas
- **Statutory Records Locker:**
  - *Society Registration Certificate* (Reg: BOM/HSG/2018/489, Registrar of Co-operative Societies)
  - *Current Managing Committee Resolution* (Resolution: AGM-2025-04)
  - *Society PAN & Tax Exemption Card* (AAATG1234F)
  - *Fire Safety & Occupancy Certificate* (CFO/FS/2024/991)
- **Administrative Quick Links:**
  - Society Audit Logs (`/admin/audit-logs`)
  - Member Registry (`/admin/residents`)
  - Financial Statements (`/admin/accounts`)

### 3.2 Security Guard / Officer (`SecurityProfilePage.tsx`)
- **Route:** `/security/profile`
- **Role Identity:** Senior Security Officer / Head Guard
- **Designation Details:**
  - Badge ID: `SEC-8821`
  - Security Agency: Eagle Eye Security Services Pvt. Ltd.
  - Assigned Duty Post: Main Gate — Boom Barrier 1
  - Shift Hours: Morning Shift (06:00 AM – 02:00 PM)
- **PSARA & Statutory Document Locker:**
  - *PSARA Guard Verification Certificate* (Lic: MH-PSARA-2023-8821)
  - *Local Police Verification Certificate* (PV Ref: POL-VER-9921)
  - *Security Agency Deployment Authorization* (Eagle Eye Deployment Order)
  - *First Aid & Fire Response Certification* (Red Cross Certified, Expiry 2027)
- **Security Command Quick Links:**
  - Terminal Console (`/security/terminal`)
  - Gate Pass QR Scanner (`/security/verify`)
  - Child Gate Scanner (`/security/child-safety/scanner`)
  - Emergency SOS Trigger (`/security/emergency`)

### 3.3 Platform Root Administrator (`SuperAdminProfilePage.tsx`)
- **Route:** `/super-admin/profile`
- **Role Identity:** Platform Super Administrator
- **Designation Details:**
  - Tenant Scope: Global Multi-Tenant (`*`)
  - Root Security Clearance: Tier 0 (Full Platform Governance)
  - Infrastructure Realm: Production Multi-Region (`in-south-1`, `in-west-1`)
- **Governance & Compliance Locker:**
  - *Master Enterprise Service Agreement* (Enterprise Multi-Tenant Contract)
  - *SOC 2 Type II Certification* (Global Compliance Audit 2026)
  - *ISO 27001 Information Security Standard* (Active Platform Certification)
  - *DPDP Act 2023 Compliance Register* (Data Protection Framework)
- **Platform Management Shortcuts:**
  - Society Management (`/super-admin/societies`)
  - Platform Analytics (`/super-admin/analytics`)
  - Database Studio (`/dev/database`)
  - Global Audit Log (`/super-admin/audit`)

### 3.4 Domestic Worker & Service Provider (`StaffProfilePage.tsx`)
- **Routes:**
  - `/domestic/profile` (renders with `staffType="DOMESTIC_WORKER"`)
  - `/service-provider/profile` (renders with `staffType="SERVICE_PROVIDER"`)
- **Role Scoping:**
  - Dynamically distinguishes worker persona from inspecting admin.
  - Domestic Worker: Sunita Devi, Maid / Housekeeping, ID: `DW-9042`.
  - Service Provider: Rajesh Carpenter, Certified Electrician / Carpenter, ID: `SP-4410`.
- **Digital Gate Entry QR Pass:**
  - Renders a scannable SVG QR Code containing dynamic payload: `AARIZO:STAFF:${profileData.staffId}:${profileData.phone}`.
  - Includes quick-share trigger to send pass to WhatsApp / Email.
- **Verification Documents:**
  - Domestic: Police Clearance Certificate, Aadhaar Verification, Covid-19 Full Vaccination.
  - Service Provider: Trade License & Wireman Certification, Police Clearance, Commercial Liability Insurance.

### 3.5 Managing Committee Member (`CommitteeProfilePage.tsx`)
- **Route:** `/committee/profile`
- **Role Identity:** Committee Member / Treasurer / Secretary
- **Enhancement:**
  - Integrated `updateCurrentUser` from `useAuth()` into `handleSave` and `handlePhotoUpload`.
  - Real-time synchronization of name, phone, email, and designation with application shell.
  - Statutory committee portfolio management.

### 3.6 Facility Manager (`FacilityProfilePage.tsx`)
- **Route:** `/facility/profile`
- **Role Identity:** Chief Facility Engineer & Estate Supervisor
- **Enhancement:**
  - Integrated `updateCurrentUser` into profile updates and photo upload modal.
  - Added statutory facility compliance locker:
    - *DG Set Pollution Control Board NOC* (NOC/PCB/2024/771)
    - *Elevator License & Annual Inspection* (PWD/LIFT/8820)
    - *Fire Hydrant & Sprinkler NOC* (MH-FIRE-2025-412)
    - *Water Quality & Potability Certificate* (LAB/WQ/2026/02)

### 3.7 Vendor Partner (`VendorProfilePage.tsx`)
- **Route:** `/vendor/profile`
- **Role Identity:** Authorized Vendor / Contractor Lead
- **Enhancement:**
  - Integrated `updateCurrentUser` into business profile updates and corporate representative contact changes.
  - Vendor compliance locker: GSTIN Certificate, Commercial Trade License, Work Orders, Vendor Insurance.

### 3.8 Resident (`ResidentProfilePage.tsx`)
- **Route:** `/resident/profile`
- **Role Identity:** Primary Unit Owner / Tenant
- **Enhancement:**
  - Integrated `updateCurrentUser({ avatarUrl })` on file upload in avatar modal.
  - Preserved existing digital document vault (Sale Deed, Rent Agreement, Possession Letter).
  - Maintained family members and emergency contact rosters.

---

## 4. Real-Time Profile Synchronization Pipeline

```
┌────────────────────────────────────────────────────────────────────────┐
│                   REAL-TIME PROFILE SYNC PIPELINE                      │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                      [User updates name/avatar]
                                    │
                                    ▼
                     `updateCurrentUser(partialUpdates)`
                                    │
       ┌────────────────────────────┼────────────────────────────┐
       ▼                            ▼                            ▼
[React Context State]     [localStorage Persistence]    [Custom Event Dispatch]
`setCurrentUser(updated)` `AUTH_KEYS.USER` updated      `aarizo:user-updated`
       │                            │                            │
       ▼                            ▼                            ▼
Instant component re-render Persistent across reloads  Cross-tab & sibling sync
`MobileAppShell` header    Session integrity maintained  Immediate drawer update
```

### 4.1 Implementation in `src/context/AuthContext.tsx`
```typescript
const updateCurrentUser = (updates: Partial<UserProfile>) => {
  setCurrentUser(prev => {
    if (!prev) return null;
    const updated = { ...prev, ...updates };
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(AUTH_KEYS.USER, JSON.stringify(updated));
        localStorage.setItem('aarizo_user', JSON.stringify(updated));
      }
    } catch (e) {
      console.warn('[AuthContext] Failed to persist user updates to localStorage', e);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('aarizo:user-updated', { detail: updated }));
    }
    return updated;
  });
};
```

---

## 5. Automated Verification & Test Coverage

The profile implementation is verified via `tests/phase4_7_portal_unification.test.tsx`:

| Test Case | Scope | Result |
| :--- | :--- | :--- |
| `AdminProfilePage renders with secretary details and statutory records` | Admin Profile | **PASS** |
| `SecurityProfilePage renders with officer badge and PSARA documents` | Security Profile | **PASS** |
| `SuperAdminProfilePage renders with multi-tenant platform details` | Super Admin Profile | **PASS** |
| `StaffProfilePage renders Domestic Worker profile and digital QR pass` | Staff Profile (Domestic) | **PASS** |
| `StaffProfilePage renders Service Provider profile with trade documents` | Staff Profile (Service) | **PASS** |
| `updateCurrentUser updates AuthContext state and dispatches sync event` | AuthContext Synchronization | **PASS** |
| `All profile pages render FileUploader without throwing` | Avatar Upload Pipeline | **PASS** |

---

## 6. Conclusion & Status

The role-aware Profile System is fully implemented, verified, and operational across all 9 roles. All portals possess dedicated, authenticated, role-scoped profiles that match the visual and structural standard of `ResidentProfilePage` while maintaining strict separation of concerns and real-time state propagation.

