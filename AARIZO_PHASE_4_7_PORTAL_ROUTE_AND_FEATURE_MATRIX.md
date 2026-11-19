# AARIZO / Dwellora — Phase 4.7
# Portal Route and Feature Matrix

**Document Date:** November 19, 2026  
**Auditor:** Principal Frontend Architect & Application Security Engineer  
**Scope:** Multi-Portal Route Configuration, Navigation Synchronization & Role Authorization  
**Source File Audited:** `src/routes/index.tsx`, `src/components/layouts/*`, and `src/components/mobile/MobileAppShell.tsx`

---

## 1. Executive Summary

This matrix documents the complete route registry across all 9 operational roles in AARIZO / Dwellora.
It compares registered router paths in `src/routes/index.tsx` against layout navigation items (`drawerItems` and `bottomItems`), identifying route dead-ends, misdirected targets, missing pages, and security authorization boundaries.

### Key Audit Findings:
1. **Critical Profile Route Target Mismatches:**
   - `/admin/profile` in `src/routes/index.tsx` erroneously points to `<AdminHomePage />`.
   - `/security/profile` in `src/routes/index.tsx` erroneously points to `<SecurityTerminalPage />`.
   - `/committee/profile` in `src/routes/index.tsx` points to `<CommitteeDashboard />` instead of the dedicated `<CommitteeProfilePage />`.
   - `/super-admin/profile` is completely missing from `src/routes/index.tsx`, although present in `SuperAdminLayout` bottom navigation.
   - `/super-admin/users` is present in `SuperAdminLayout` bottom navigation but missing from `src/routes/index.tsx`.
2. **Security Overview Redirection:**
   - `/security` drops users directly into the 935-line operational `SecurityTerminalPage` instead of an overview dashboard that matches the `ResidentHome` visual architecture.
3. **Drawer vs Bottom Navigation Inconsistencies:**
   - In `SocietyAdminLayout`, `Profile` is in the bottom navigation bar (`/admin/profile`) but omitted from the slide-out drawer menu.
   - In `SecurityLayout`, `Profile` is in the bottom navigation bar (`/security/profile`) but omitted from the drawer.
   - In `FacilityManagerLayout`, `Profile` is in the bottom navigation bar (`/facility/profile`) but omitted from the drawer.

---

## 2. Multi-Portal Route & Feature Matrix

### 2.1 Resident Portal (`role: resident, secretary, admin`)
**Layout:** `ResidentLayout` (MobileAppShell · Role: "Resident" · Accent: Navy/Blue)

| Route Path | Component Rendered | Drawer Nav | Bottom Nav | FAB Action | Status | Notes |
|---|---|---|---|---|---|---|
| `/resident` | `ResidentDashboard` (renders `ResidentHome`) | Yes ("Home Dashboard") | Yes ("Home") | — | **PASS** | Canonical gold standard overview |
| `/resident/my-flat` | `MyFlatPage` | No (in profile menu) | No | — | **PASS** | Flat details & members |
| `/resident/visitors` | `VisitorPassHubPage` | Yes ("Visitor Passes") | No | Default FAB | **PASS** | QR pass generation & visitor logs |
| `/resident/parking` | `ResidentParkingPage` | Yes ("Vehicle & Parking") | No | — | **PASS** | Vehicle slots & RFID tags |
| `/resident/domestic-help` | `DomesticHelpHubPage` | Yes ("Services & Help") | No | — | **PASS** | Maid, cook & staff management |
| `/resident/maintenance` | `ResidentMaintenancePage` | No | No | — | **PASS** | Open work orders |
| `/resident/billing` | `ResidentBillingPage` | Yes ("Maintenance Bills") | No | — | **PASS** | Invoices & online payment |
| `/resident/marketplace` | `ResidentMarketplacePage` | No | No | — | **PASS** | Resident buy/sell classifieds |
| `/resident/amenities` | `ResidentAmenityBookingPage` | Yes ("Amenity Bookings") | No | — | **PASS** | Clubhouse & sports slots |
| `/resident/community` | `ResidentCommunityHubPage` | Yes ("Community & Notices")| Yes ("Community")| — | **PASS** | Announcements, polls & discussions |
| `/resident/child-safety` | `ResidentChildSafetyPage` | Yes ("Child Safety Pass") | No | — | **PASS** | Child profiles & gate passes |
| `/resident/emergency` | `ResidentEmergencyPage` | Yes ("Emergency SOS") | No | — | **PASS** | SOS trigger & emergency contacts |
| `/resident/garbage` | `ResidentGarbagePage` | No | No | — | **PASS** | Waste collection schedules |
| `/resident/guest-stay` | `ResidentGuestStayPage` | No | No | — | **PASS** | Short-term guest registration |
| `/resident/requests` | `UnifiedRequestCenter` | Yes ("Complaints & NOCs") | No | — | **PASS** | Tickets & NOC workflows |
| `/resident/profile` | `ResidentProfilePage` | Yes ("Profile & Settings") | Yes ("Profile") | — | **PASS** | Document locker, personal details |
| `/resident/services` | `ResidentServicesPage` | Yes ("Services & Help") | Yes ("Services") | — | **PASS** | Vendor directory & booking |
| `/resident/activity` | `ResidentActivityPage` | Yes ("Activity Logs") | No | — | **PASS** | Real-time movement history |

---

### 2.2 Society Admin / Secretary Portal (`role: secretary, admin`)
**Layout:** `SocietyAdminLayout` (MobileAppShell · Role: "Secretary" · Accent: Navy/Gold)

| Route Path | Component Rendered | Drawer Nav | Bottom Nav | FAB Action | Status | Notes |
|---|---|---|---|---|---|---|
| `/admin` | `AdminHomePage` | Yes ("Admin Overview") | Yes ("Home") | — | **PASS** | Operational overview (needs UI alignment) |
| `/admin/residents` | `ResidentManagementPage` | Yes ("Residents Directory")| Yes ("Residents") | — | **PASS** | Directory, onboarding & approval |
| `/admin/requests` | `UnifiedRequestCenter` | Yes ("Complaints & Requests")| No | Default FAB | **PASS** | Issue ticketing & resolution |
| `/admin/towers` | `TowerManagementPage` | Yes ("Towers & Blocks") | No | — | **PASS** | Tower configuration |
| `/admin/flats` | `FlatManagementPage` | Yes ("Flat Management") | No | — | **PASS** | Flat units & occupancy |
| `/admin/staff` | `StaffManagementPage` | Yes ("Staff Management") | No | — | **PASS** | Guard & facility rosters |
| `/admin/committee` | `CommitteeManagementPage` | No | No | — | **PASS** | Committee roster |
| `/admin/domestic-workers`| `DomesticWorkerManagementPage`| Yes ("Domestic Workers") | No | — | **PASS** | Staff pass approval |
| `/admin/vendors` | `VendorManagementPage` | Yes ("Vendor Management") | No | — | **PASS** | Vendor onboarding & approval |
| `/admin/audit-logs` | `AuditLogsPage` | No | No | — | **PASS** | System audit trails |
| `/admin/parking` | `ParkingManagementPage` | Yes ("Parking Operations")| No | — | **PASS** | Slot assignment & boom barriers |
| `/admin/maintenance` | `MaintenanceManagementPage`| Yes ("Maintenance Ops") | No | — | **PASS** | AMC & work orders |
| `/admin/billing` | `BillingManagementPage` | Yes ("Billing & Payments")| No | — | **PASS** | Dues generation & collections |
| `/admin/service-hub` | `AdminServiceHubPage` | No | No | — | **PASS** | Service vendor hub |
| `/admin/delivery-intelligence` | `DeliveryIntelligencePage` | No | No | — | **PASS** | Delivery trends & analytics |
| `/admin/amenities` | `AdminAmenityManagementPage`| Yes ("Amenities") | No | — | **PASS** | Amenity rules & bookings |
| `/admin/child-safety` | `AdminChildSafetyPage` | Yes ("Child Safety Desk") | No | — | **PASS** | Child profiles & emergency alerts |
| `/admin/safety-command` | `AdminSafetyCommandPage` | Yes ("Safety Command") | No | — | **PASS** | Incident command & perimeter alerts |
| `/admin/housekeeping` | `AdminHousekeepingPage` | Yes ("Housekeeping Ops") | No | — | **PASS** | Cleaning logs & shift checklists |
| `/admin/guest-stay` | `AdminGuestStayPage` | No | No | — | **PASS** | Guest stay approvals |
| `/admin/intelligence` | `SocietyIntelligenceDashboardPage` | Yes ("Society Analytics") | No | — | **PASS** | AI society metrics & health |
| `/admin/security-audit` | `SecurityAuditCenterPage` | Yes ("Security & Audit") | No | — | **PASS** | Security compliance |
| `/admin/realtime` | `RealtimeOperationsHubPage`| Yes ("Live Operations") | No | — | **PASS** | SSE event stream monitor |
| `/admin/compliance` | `AdminCompliancePage` | No | No | — | **PASS** | Statutory compliance |
| `/admin/move-renovation` | `AdminMoveRenovationPage`| No | No | — | **PASS** | Move in/out NOCs |
| `/admin/expenses` | `AdminExpensePage` | Yes ("Society Expenses") | No | — | **PASS** | Petty cash & vendor payments |
| `/admin/community` | `ResidentCommunityHubPage`| No | Yes ("Notices") | — | **PASS** | Society notices feed |
| `/admin/profile` | `AdminHomePage` *(BUG)* | Missing from Drawer | Yes ("Profile") | — | **FAIL (BUG)**| **Target Mismatch:** Routes to `AdminHomePage`! Must route to `AdminProfilePage`. |

---

### 2.3 Security Guard Portal (`role: guard, secretary, admin`)
**Layout:** `SecurityLayout` (MobileAppShell · Role: "Security Guard" · Accent: Red/Espresso)

| Route Path | Component Rendered | Drawer Nav | Bottom Nav | FAB Action | Status | Notes |
|---|---|---|---|---|---|---|
| `/security` | `SecurityTerminalPage` | Yes ("Gate Terminal") | Yes ("Gate") | — | **GAP** | Drops directly to dense terminal; needs `SecurityHome` overview |
| `/security/terminal` | `SecurityTerminalPage` | Yes ("Gate Terminal") | No | — | **PASS** | Full operational terminal |
| `/security/verify` | `GuardDashboard` | Yes ("Visitor Scanner") | Yes ("Scan") | Default FAB | **PASS** | Pass verification & QR scanner |
| `/security/child-safety` | `ChildGateScannerPage` | Yes ("Child Gate Scanner")| No | — | **PASS** | Child gate pass QR & exit logging |
| `/security/staff-scanner`| `StaffGateTerminalPage` | Yes ("Staff Hub") | No | — | **PASS** | Domestic worker & staff terminal |
| `/security/parking` | `ParkingGateScannerPage` | Yes ("Parking Console") | No | — | **PASS** | Vehicle ANPR & boom barrier |
| `/security/delivery-intelligence`| `DeliveryIntelligencePage`| Yes ("Parcel Intelligence")| No | — | **PASS** | Delivery courier logs |
| `/security/emergency-command`| `SecurityEmergencyTerminalPage`| Yes ("Emergency Command")| Yes ("Emergency")| Top action | **PASS** | Critical SOS triggers & panic alarms |
| `/security/guest-stay` | `GuestStayScannerPage` | Yes ("Guest Stays") | No | — | **PASS** | Guest verification |
| `/security/privacy-hub` | `SecurityTerminalPage` | Yes ("Privacy & Audit") | No | — | **PASS** | Privacy policies & data audit |
| `/security/profile` | `SecurityTerminalPage` *(BUG)* | Missing from Drawer | Yes ("Profile") | — | **FAIL (BUG)**| **Target Mismatch:** Routes to `SecurityTerminalPage`! Must route to `SecurityProfilePage`. |

---

### 2.4 Management Committee Portal (`role: committee, secretary, admin`)
**Layout:** `CommitteeLayout` (MobileAppShell · Role: "Committee" · Accent: Navy/Teal)

| Route Path | Component Rendered | Drawer Nav | Bottom Nav | FAB Action | Status | Notes |
|---|---|---|---|---|---|---|
| `/committee` | `CommitteeDashboard` | Yes ("Overview") | Yes ("Home") | — | **PASS** | Committee overview & executive summaries |
| `/committee/approvals` | `CommitteeDashboard` | Yes ("Approvals") | Yes ("Approvals") | Default FAB | **PASS** | Pending expense & NOC approvals |
| `/committee/financials` | `CommitteeDashboard` | Yes ("Financials") | No | — | **PASS** | Accounts, balances & audits |
| `/committee/compliance` | `CommitteeDashboard` | Yes ("Compliance") | No | — | **PASS** | Statutory & fire safety compliance |
| `/committee/health` | `CommitteeDashboard` | Yes ("Society Health") | No | — | **PASS** | Society operational scorecard |
| `/committee/governance` | `CommitteeDashboard` | Yes ("Governance") | No | — | **PASS** | Bye-laws, AGM minutes & resolutions |
| `/committee/reports` | `CommitteeDashboard` | Yes ("Reports") | Yes ("Reports") | — | **PASS** | Executive reports & exports |
| `/committee/profile` | `CommitteeDashboard` *(BUG)* | Yes ("Profile") | Yes ("Profile") | — | **FAIL (BUG)**| In `src/routes/index.tsx`, points to `CommitteeDashboard` instead of `CommitteeProfilePage`! |

---

### 2.5 Facility Manager Portal (`role: facility_manager, secretary, admin`)
**Layout:** `FacilityManagerLayout` (MobileAppShell · Role: "Facility Manager" · Accent: Blue/Slate)

| Route Path | Component Rendered | Drawer Nav | Bottom Nav | FAB Action | Status | Notes |
|---|---|---|---|---|---|---|
| `/facility` | `FacilityManagerDashboard` | Yes ("Overview") | Yes ("Home") | — | **PASS** | Operations overview |
| `/facility/tasks` | `FacilityMaintenanceTasksPage`| No | Yes ("Tasks") | — | **PASS** | Work orders & assignments |
| `/facility/maintenance` | `FacilityMaintenanceTasksPage`| Yes ("Maintenance") | Yes ("Maintenance")| Default FAB | **PASS** | Preventative & breakdown maintenance |
| `/facility/shifts` | `FacilityStaffShiftsPage` | Yes ("Staff Shifts") | No | — | **PASS** | Staff attendance & rosters |
| `/facility/amc` | `FacilityAMCContractsPage` | Yes ("AMC Contracts") | No | — | **PASS** | AMC vendor contracts |
| `/facility/cleaning` | `FacilityCleaningOpsPage` | Yes ("Cleaning Ops") | No | — | **PASS** | Sanitization & waste logs |
| `/facility/utilities` | `FacilityUtilitiesPage` | Yes ("Utilities") | No | — | **PASS** | Water, DG & power meters |
| `/facility/profile` | `FacilityProfilePage` | Missing from Drawer | Yes ("Profile") | — | **PASS** | Profile page exists, needs drawer entry & visual alignment |

---

### 2.6 Super Admin Portal (`role: admin`)
**Layout:** `SuperAdminLayout` (MobileAppShell · Role: "System Admin" · Accent: Navy/Gold)

| Route Path | Component Rendered | Drawer Nav | Bottom Nav | FAB Action | Status | Notes |
|---|---|---|---|---|---|---|
| `/super-admin` | `SuperAdminDashboard` | Yes ("Super Admin") | Yes ("Home") | — | **PASS** | Platform overview |
| `/super-admin/societies` | `SuperAdminSocietiesPage`| Yes ("Societies") | Yes ("Societies") | Default FAB | **PASS** | Tenant society provisioning |
| `/super-admin/users` | *None (Missing Route)* | No | Yes ("Users") | — | **FAIL (BUG)**| Present in bottom nav but no route registered! |
| `/super-admin/profile` | *None (Missing Route)* | No | Yes ("Profile") | — | **FAIL (BUG)**| Present in bottom nav but no route registered! |

---

### 2.7 Vendor Portal (`role: vendor, secretary, admin`)
**Layout:** `VendorLayout` (MobileAppShell · Role: "Vendor" · Accent: Teal/Gold)

| Route Path | Component Rendered | Drawer Nav | Bottom Nav | FAB Action | Status | Notes |
|---|---|---|---|---|---|---|
| `/vendor` | `VendorDashboard` | Yes ("Vendor Hub") | Yes ("Home") | — | **PASS** | Multi-tab vendor dashboard |
| `/vendor/portal` | `VendorPortalPage` | Yes ("Jobs & Services")| Yes ("Jobs") | Default FAB | **PASS** | Work orders & resident requests |
| `/vendor/onboarding` | `VendorOnboardingPage` | Yes ("Onboarding & KYC")| Yes ("KYC") | — | **PASS** | Document verification & KYC |
| `/vendor/profile` | `VendorProfilePage` | Yes ("Vendor Profile") | Yes ("Profile") | — | **PASS** | Profile page exists |

---

### 2.8 Service Provider & Domestic Worker Portals
**Layouts:** `ServiceProviderLayout` & `DomesticWorkerLayout`

| Route Path | Layout | Component Rendered | Drawer Nav | Bottom Nav | Status | Notes |
|---|---|---|---|---|---|---|
| `/service-provider` | `ServiceProviderLayout` | `ServiceProviderDashboard` | Yes | Yes ("Home") | **PASS** | Daily gate pass & check-in |
| `/service-provider/tasks`| `ServiceProviderLayout` | `ServiceProviderTaskPage` | Yes | Yes ("Tasks") | **PASS** | Resident service tasks |
| `/service-provider/profile`| `ServiceProviderLayout` | *Redirects to /* | Yes | Yes ("Profile") | **GAP** | Needs role-aware profile |
| `/domestic` | `DomesticWorkerLayout` | `DomesticWorkerDashboard` | Yes | Yes ("Home") | **PASS** | Gate QR pass & attendance |
| `/domestic/profile` | `DomesticWorkerLayout` | *Redirects to /* | Yes | Yes ("Profile") | **GAP** | Needs role-aware profile |

---

## 3. Prioritized Fix Matrix

| Priority | Portal | Issue | Fix Required |
|---|---|---|---|
| **CRITICAL** | Society Admin | `/admin/profile` routes to `<AdminHomePage />` | Create `AdminProfilePage.tsx` and register at `/admin/profile`; add to Drawer Nav |
| **CRITICAL** | Security | `/security/profile` routes to `<SecurityTerminalPage />` | Create `SecurityProfilePage.tsx` and register at `/security/profile`; add to Drawer Nav |
| **CRITICAL** | Committee | `/committee/profile` in router points to `<CommitteeDashboard />` | Update router to route directly to `<CommitteeProfilePage />` |
| **CRITICAL** | Super Admin | `/super-admin/profile` route missing | Create `SuperAdminProfilePage.tsx` and register at `/super-admin/profile`; add to Drawer Nav |
| **HIGH** | Security | `/security` drops into raw terminal with no overview | Create `SecurityHome.tsx` overview matching `ResidentHome` visual standards |
| **HIGH** | Super Admin | `/super-admin/users` link in bottom nav is 404 | Register route pointing to `ResidentManagementPage` or user management view |
| **MEDIUM** | Facility | Drawer nav missing Profile | Add `{ label: 'Profile', path: '/facility/profile', icon: User }` to Drawer Nav |

