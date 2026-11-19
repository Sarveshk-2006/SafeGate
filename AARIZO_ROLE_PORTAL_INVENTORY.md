# AARIZO — COMPLETE ROLE & PORTAL INVENTORY
**Document Version:** 1.0.0  
**Audit Date:** November 14, 2026  
**Auditor Roles:** Principal Software Architect, Senior Full-Stack Engineer, Product Analyst  

---

## 1. Role Discovery & Taxonomy Summary

An exhaustive audit of `server/prisma/schema.prisma`, `src/domains/auth/types.ts`, `src/types/rbac.ts`, and `src/routes/index.tsx` establishes the authoritative taxonomy of **7 user roles**:

| # | Role Identifier | Database Enum | Display Title | Default Landing Route | Layout Component |
| :- | :--- | :--- | :--- | :--- | :--- |
| **1** | `resident` | `UserRole.resident` | Resident / Flat Owner | `/resident` | `ResidentLayout` |
| **2** | `secretary` | `UserRole.secretary` | Society Secretary / Admin | `/admin` | `SocietyAdminLayout` |
| **3** | `guard` | `UserRole.guard` | Chief Security Officer | `/security` | `SecurityLayout` |
| **4** | `committee` | `UserRole.committee` | Committee Board Member | `/committee` | `CommitteeLayout` |
| **5** | `facility_manager` | `UserRole.facility_manager` | Facility Operations Manager | `/facility` | `FacilityManagerLayout` |
| **6** | `vendor` | `UserRole.vendor` | Verified Vendor / Service Provider | `/vendor` | `VendorLayout` |
| **7** | `admin` | `UserRole.admin` | Enterprise Super Admin | `/super-admin` | `SuperAdminLayout` |

> [!NOTE]
> Additional sub-roles or managed profiles exist in the system (`domestic_worker`, `staff`), but they do not possess separate entries in the `UserRole` Prisma enum; their workflows operate under specialized portals (`/domestic`, `/staff/housekeeping-tasks`, `/service-provider`) with cross-role access permissions.

---

## 2. Comprehensive Inventory by Role

---

### ROLE 1: RESIDENT (`resident`)

- **Role Identifier**: `resident`
- **Login Entry Point**: `/login` (enter mobile `9876543210` or email `vikram.joshi@aarizo.com`)
- **Authentication Method**:
  1. *Phone + OTP*: Simulated OTP (`4092` / `1234`) or Firebase RecaptchaVerifier SMS.
  2. *Email + Password*: Authenticated via `/api/auth/login` (SHA-256 HMAC).
  3. *Demo Fast-Switch*: Clicking the "Resident" card executes `loginAsRole('resident')`.
- **Redirect Destination**: `/resident`
- **Portal Layout**: `ResidentLayout` with `MobileAppShell`.

#### Navigation & Route Map
- **Bottom Navigation Tabs**:
  1. `Home` (`/resident`) -> `ResidentDashboard` / `ResidentHome`
  2. `Services` (`/resident/services`) -> `ResidentServicesPage`
  3. `Community` (`/resident/community`) -> `ResidentCommunityHubPage`
  4. `Profile` (`/resident/profile`) -> `ResidentProfilePage`
- **Side Drawer Navigation Items**:
  - `Home Dashboard` (`/resident`)
  - `Visitor Passes` (`/resident/visitors`) -> `VisitorPassHubPage`
  - `Vehicle & Parking` (`/resident/parking`) -> `ResidentParkingPage`
  - `Child Safety Pass` (`/resident/child-safety`) -> `ResidentChildSafetyPage`
  - `Maintenance Bills` (`/resident/billing`) -> `ResidentBillingPage`
  - `Complaints & NOCs` (`/resident/requests`) -> `UnifiedRequestCenter`
  - `Amenity Bookings` (`/resident/amenities`) -> `ResidentAmenityBookingPage`
  - `Services & Help` (`/resident/services`) -> `ResidentServicesPage`
  - `Community & Notices` (`/resident/community`) -> `ResidentCommunityHubPage`
  - `Activity Logs` (`/resident/activity`) -> `ResidentActivityPage`
  - `Emergency SOS` (`/resident/emergency`) -> `ResidentEmergencyPage`
  - `Profile & Settings` (`/resident/profile`) -> `ResidentProfilePage`
- **Nested & Sub-Routes**:
  - `/resident/my-flat` -> `MyFlatPage`
  - `/resident/domestic-help` -> `DomesticHelpHubPage`
  - `/resident/maintenance` -> `ResidentMaintenancePage`
  - `/resident/marketplace` -> `ResidentMarketplacePage`
  - `/resident/garbage` -> `ResidentGarbagePage`
  - `/resident/guest-stay` -> `ResidentGuestStayPage`
  - `/notifications` -> `NotificationCenterPage`

#### UI Controls, Actions & Modals
- **Buttons & Actions**:
  - Floating Action Button (FAB): Direct shortcut to create Visitor Pass (`/resident/visitors`).
  - Quick Action Pills: Visitors, Parking, Pay Bills, File Complaint, Pickup Parcel, SOS.
  - Create Visitor Pass: Modal with guest name, phone, vehicle, arrival time, pass type.
  - Pay Maintenance: Razorpay modal trigger with breakdown and online payment capture.
  - Submit Request / NOC: Unified modal with categories (`NOC`, `RENOVATION_PERMISSION`, `COMPLAINT`).
  - Book Amenity: Slot selection picker, date chooser, terms acceptance, booking confirmation.
  - Emergency SOS Trigger: Instant broadcast button with haptic pulse and siren audio chime.
  - Child Safety Pickup Pass: Generate QR pass, add authorized caretaker, trigger child SOS.
- **Data Displayed**:
  - Greeting with live time of day.
  - Flat details (`Tower B · B-1204`).
  - Live Society Utilities Status (Water, Security, Garbage, Cleaning, Power).
  - Pending Action alerts (parcel at gate, bill due, booking pending).
  - Recent activity feed (visitor arrivals, maintenance completion notices, AGM announcements).
  - Verified local vendor directory with phone and ratings.
- **Data Mutated (Create/Edit/Delete)**:
  - *Create*: Visitor passes, amenity bookings, maintenance requests, NOC petitions, child pickup passes, payments.
  - *Edit*: Family member details, vehicle registrations, profile settings.
  - *Delete/Cancel*: Cancel pending visitor passes, cancel future amenity bookings.
- **Backend APIs Called**:
  - `GET /api/announcements`
  - `GET /api/vendors`
  - `GET /api/visitor-passes` & `POST /api/visitor-passes`
  - `GET /api/billing/invoices` & `POST /api/payments/razorpay/create-order`
  - `GET /api/amenities` & `POST /api/amenity-bookings`
  - `POST /api/realtime/broadcast` (for SOS alerts)
- **Database Models Involved**: `User`, `Resident`, `Flat`, `Tower`, `VisitorPass`, `Parcel`, `BillingInvoice`, `Payment`, `Amenity`, `AmenityBooking`, `MaintenanceTicket`, `EmergencyIncident`, `FamilyMember`, `Vehicle`.
- **Authorization Restrictions**: Cannot view other flats' invoices, cannot access security gate scanner, cannot access secretary financial audit logs.

---

### ROLE 2: SOCIETY SECRETARY / ADMIN (`secretary`)

- **Role Identifier**: `secretary`
- **Login Entry Point**: `/login` (enter mobile `9820012345` or email `mayuri.sec@greenvalley.org`)
- **Authentication Method**: Phone OTP or Email + Password (`/api/auth/login`).
- **Redirect Destination**: `/admin`
- **Portal Layout**: `SocietyAdminLayout` with `MobileAppShell`.

#### Navigation & Route Map
- **Bottom Navigation Tabs**:
  1. `Home` (`/admin`) -> `AdminHomePage`
  2. `Residents` (`/admin/residents`) -> `ResidentManagementPage`
  3. `Notices` (`/admin/community`) -> `ResidentCommunityHubPage`
  4. `Profile` (`/admin/profile`) -> `AdminHomePage`
- **Side Drawer Navigation Items (21 Accessible Routes)**:
  1. Admin Overview (`/admin`)
  2. Residents Directory (`/admin/residents`)
  3. Complaints & Requests (`/admin/requests`)
  4. Housekeeping Ops (`/admin/housekeeping`)
  5. Child Safety Desk (`/admin/child-safety`)
  6. Safety Command (`/admin/safety-command`)
  7. Maintenance Ops (`/admin/maintenance`)
  8. Amenities Management (`/admin/amenities`)
  9. Staff Management (`/admin/staff`)
  10. Towers & Blocks (`/admin/towers`)
  11. Flat Management (`/admin/flats`)
  12. Parking Operations (`/admin/parking`)
  13. Domestic Workers (`/admin/domestic-workers`)
  14. Vendor Management (`/admin/vendors`)
  15. Advertisements (`/admin/advertisements`)
  16. Society Expenses (`/admin/expenses`)
  17. Billing & Payments (`/admin/billing`)
  18. Society Analytics (`/admin/intelligence`)
  19. Security & Audit (`/admin/security-audit`)
  20. Live Operations (`/admin/realtime`)
  21. Notifications (`/notifications`)

#### UI Controls, Actions & Modals
- **Buttons & Actions**:
  - Floating Action Button (FAB): Direct shortcut to Complaints & Requests (`/admin/requests`).
  - Provision Resident: Modal form with Name, Email, Phone, Flat Number, Resident Type (Owner/Tenant), and explicit Password field.
  - Provision Staff / Guard: Form assigning shifts, gate allocation, and password.
  - Tower & Flat Master CRUD: Add towers, add unit numbers, set BHK types, mark occupancy status.
  - Approve / Reject Requests: Workflow drawer with status transition, SLA tracking, and resolution document upload.
  - Financial Operations: Create billing cycle, generate batch invoices, apply late fees, review payments.
  - Safety & Lockdown: Trigger society-wide emergency alert or lockdown.
- **Data Displayed**:
  - Live counts: Registered residents, active security guards, open work orders, overdue bills.
  - Financial summary: Total billed amount, total collected amount, outstanding dues.
  - Security audit logs with IP addresses, timestamps, and actor roles.
  - Live Realtime telemetry stream with connected SSE client counts.
- **Data Mutated**:
  - *Create*: Residents, staff, flats, towers, billing cycles, invoices, advertisements, announcements.
  - *Edit*: Society settings, flat occupancy, invoice statuses, request workflows.
  - *Delete*: Remove flats, delete towers, deactivate vendors.
- **Backend APIs Called**:
  - `POST /api/secretary/provision-user`
  - `GET /api/residents`, `POST /api/residents`, `PATCH /api/residents/:id`
  - `GET /api/towers`, `POST /api/towers`, `PATCH /api/towers/:id`, `DELETE /api/towers/:id`
  - `GET /api/flats`, `POST /api/flats`, `PATCH /api/flats/:id`, `DELETE /api/flats/:id`
  - `GET /api/billing/cycles`, `POST /api/billing/cycles`, `POST /api/billing/apply-late-fees`
  - `GET /api/audit-logs`
- **Database Models Involved**: `Society`, `Tower`, `Flat`, `User`, `Resident`, `Staff`, `DomesticWorker`, `Vendor`, `BillingCycle`, `BillingInvoice`, `Payment`, `AuditLog`, `OutboxEvent`.

---

### ROLE 3: SECURITY GUARD (`guard`)

- **Role Identifier**: `guard`
- **Login Entry Point**: `/login` (enter mobile `9123456789` or email `guard1@greenvalley.com`)
- **Authentication Method**: Phone OTP or Email + Password.
- **Redirect Destination**: `/security`
- **Portal Layout**: `SecurityLayout` with `MobileAppShell`.

#### Navigation & Route Map
- **Bottom Navigation Tabs**:
  1. `Gate` (`/security`) -> `SecurityTerminalPage`
  2. `Scan` (`/security/verify`) -> `GuardDashboard`
  3. `Emergency` (`/security/emergency-command`) -> `SecurityEmergencyTerminalPage`
  4. `Profile` (`/security/profile`) -> `SecurityTerminalPage`
- **Side Drawer Navigation Items**:
  1. Gate Terminal (`/security`)
  2. Visitor Scanner (`/security/verify`)
  3. Child Gate Scanner (`/security/child-safety`) -> `ChildGateScannerPage`
  4. Staff Hub (`/security/staff-scanner`) -> `StaffGateTerminalPage`
  5. Parking Console (`/security/parking`) -> `ParkingGateScannerPage`
  6. Parcel Intelligence (`/security/delivery-intelligence`) -> `DeliveryIntelligencePage`
  7. Emergency Command (`/security/emergency-command`) -> `SecurityEmergencyTerminalPage`
  8. Guest Stays (`/security/guest-stay`) -> `GuestStayScannerPage`
  9. Privacy & Audit (`/security/privacy-hub`) -> `SecurityTerminalPage`

#### UI Controls, Actions & Modals
- **Buttons & Actions**:
  - QR Code Scanner Modal: Uses device camera or file upload to scan visitor and child QR tokens.
  - Manual Passcode Entry: 4-digit or 6-digit numeric keypad validation.
  - Walk-in Visitor Registration: Capture visitor name, phone, flat code, category, vehicle number, and photo.
  - Check-in & Check-out Actions: Single-tap entry logging with gate timestamp recording.
  - Child Gate Scanner: Scan child pickup QR, verify authorized caretaker ID/photo, log pickup.
  - Staff Check-in: Record security and housekeeping shift attendance at gate.
  - Parking Gate Scanner: Log entry/exit of resident vehicles via license plate / RFID lookup.
  - Blacklist Entry: Report suspicious individual or vehicle to alert society admin.
- **Data Displayed**:
  - Live visitor pass feed (Expected, Arrived, Checked In, Checked Out, Overstayed).
  - Overstay alerts (visitors exceeding permitted duration).
  - Blacklisted phone numbers and names.
  - Privacy Constraints: Guard UI hides full resident contact numbers and private notes (data minimization).
- **Backend APIs Called**:
  - `POST /api/visitor-passes/verify`
  - `POST /api/visitor-passes/check-overstay`
  - `POST /api/children/passes/:id/verify`
  - `POST /api/facility/staff-attendance/check-in`
  - `GET /api/parking/slots`
- **Database Models Involved**: `VisitorPass`, `VisitorLog`, `Attendance`, `ParkingSlot`, `EmergencyIncident`, `AuditLog`.

---

### ROLE 4: COMMITTEE BOARD MEMBER (`committee`)

- **Role Identifier**: `committee`
- **Login Entry Point**: `/login` (enter mobile `9900112233` or email `ashok.mehta@aarizo.com`)
- **Authentication Method**: Phone OTP or Email + Password.
- **Redirect Destination**: `/committee`
- **Portal Layout**: `CommitteeLayout` with `MobileAppShell`.

#### Navigation & Route Map
- **Bottom Navigation Tabs**:
  1. `Home` (`/committee`) -> `CommitteeDashboard`
  2. `Approvals` (`/committee/approvals`) -> `CommitteeDashboard` (Approvals tab)
  3. `Reports` (`/committee/reports`) -> `CommitteeDashboard` (Reports tab)
  4. `Profile` (`/committee/profile`) -> `CommitteeProfilePage`
- **Side Drawer Navigation Items**:
  - Overview (`/committee`)
  - Approvals (`/committee/approvals`)
  - Financials (`/committee/financials`)
  - Compliance (`/committee/compliance`)
  - Society Health (`/committee/health`)
  - Governance (`/committee/governance`)
  - Reports (`/committee/reports`)
  - Profile (`/committee/profile`)

#### UI Controls, Actions & Modals
- **Buttons & Actions**:
  - Budget & Expense Approvals: Review capital expenditure requests and vendor contracts.
  - Upload Governance Documents: Modal to upload AGM minutes, resolutions, and bylaw amendments.
  - Date Range Filter: Toggle reports by 'THIS_MONTH', 'LAST_QUARTER', or 'YTD'.
  - Move & Renovation Approvals: High-level review of major structural changes.
- **Data Displayed**:
  - Society Health Scorecard (Payment discipline, security compliance, SLA resolution).
  - Financial dashboards: Sinking fund balance, maintenance collection efficiency, expense ledger.
  - Statutory Compliance Tracker: Fire safety NOC, elevator AMC validity, environmental audits.
- **Backend APIs Called**:
  - `GET /api/billing/cycles`
  - `GET /api/trust-score/SOCIETY/soc-gvs`
  - `GET /api/ai/governance-check`
- **Database Models Involved**: `Approval`, `ComplianceDocument`, `TrustScore`, `BillingCycle`, `AMCContract`.

---

### ROLE 5: FACILITY OPERATIONS MANAGER (`facility_manager`)

- **Role Identifier**: `facility_manager`
- **Login Entry Point**: `/login` (enter mobile `9811223344` or email `rajesh.patil@aarizo.com`)
- **Authentication Method**: Phone OTP or Email + Password.
- **Redirect Destination**: `/facility`
- **Portal Layout**: `FacilityManagerLayout` with `MobileAppShell`.

#### Navigation & Route Map
- **Bottom Navigation Tabs**:
  1. `Home` (`/facility`) -> `FacilityManagerDashboard`
  2. `Tasks` (`/facility/tasks`) -> `FacilityMaintenanceTasksPage`
  3. `Maintenance` (`/facility/maintenance`) -> `FacilityMaintenanceTasksPage`
  4. `Profile` (`/facility/profile`) -> `FacilityProfilePage`
- **Side Drawer Navigation Items**:
  - Overview (`/facility`)
  - Maintenance (`/facility/maintenance`)
  - Staff Shifts (`/facility/shifts`) -> `FacilityStaffShiftsPage`
  - AMC Contracts (`/facility/amc`) -> `FacilityAMCContractsPage`
  - Cleaning Ops (`/facility/cleaning`) -> `FacilityCleaningOpsPage`
  - Utilities (`/facility/utilities`) -> `FacilityUtilitiesPage`

#### UI Controls, Actions & Modals
- **Buttons & Actions**:
  - Create Work Order / Maintenance Ticket: Set category (Plumbing, Electrical, Elevator), priority, assigned vendor.
  - Update Shift Rosters: Allocate staff to Morning, Afternoon, or Night shifts.
  - AMC Contract Renewal: Track expiry dates for lift, DG set, pump, and solar panels.
  - Housekeeping Task Checklist: Verify cleaning operations in common areas.
- **Data Displayed**:
  - Maintenance task list with priority badges (`HIGH`, `MEDIUM`, `LOW`) and status (`IN_PROGRESS`, `PENDING`).
  - Active vendor AMC contracts and renewal countdowns.
  - Utility meter readings (water pump levels, DG set fuel levels).
- **Backend APIs Called**:
  - `GET /api/maintenance` & `PATCH /api/maintenance/:id`
  - `GET /api/facility/staff-shifts` & `POST /api/facility/staff-shifts`
  - `GET /api/housekeeping/tasks`
- **Database Models Involved**: `WorkOrder`, `MaintenanceTicket`, `Shift`, `AMCContract`, `Staff`.

---

### ROLE 6: VENDOR / SERVICE PROVIDER (`vendor`)

- **Role Identifier**: `vendor`
- **Login Entry Point**: `/login` (enter mobile `9844556677` or email `ramesh.gupta@aquapure.com`)
- **Authentication Method**: Phone OTP or Email + Password.
- **Redirect Destination**: `/vendor`
- **Portal Layout**: `VendorLayout` with `MobileAppShell`.

#### Navigation & Route Map
- **Bottom Navigation Tabs**:
  1. `Home` (`/vendor`) -> `VendorDashboard`
  2. `Jobs` (`/vendor/portal`) -> `VendorPortalPage`
  3. `KYC` (`/vendor/onboarding`) -> `VendorOnboardingPage`
  4. `Profile` (`/vendor/profile`) -> `VendorProfilePage`
- **Side Drawer Navigation Items**:
  - Vendor Hub (`/vendor`)
  - Jobs & Services (`/vendor/portal`)
  - Onboarding & KYC (`/vendor/onboarding`)
  - Vendor Profile (`/vendor/profile`)

#### UI Controls, Actions & Modals
- **Buttons & Actions**:
  - Create Catalog Service: Modal with title, description, category, fixed/hourly pricing, availability toggle.
  - Respond to Resident Job Requests: Accept, mark in-progress, complete work orders.
  - Document & KYC Upload: Upload GST certificate, trade license, police verification, identity proofs.
  - Post Advertisements: Submit promotional banner ads to society marketplace.
- **Data Displayed**:
  - Active service catalog, rating score (e.g. `4.8 ★`), customer review logs.
  - KYC verification status (`APPROVED`, `PENDING`).
  - Earnings and transaction history.
- **Backend APIs Called**:
  - `GET /api/vendors`
  - `POST /api/advertisements`
  - `POST /api/upload`
- **Database Models Involved**: `Vendor`, `Advertisement`, `WorkOrder`, `TrustScore`.

---

### ROLE 7: PLATFORM SUPER ADMIN (`admin`)

- **Role Identifier**: `admin`
- **Login Entry Point**: `/login` (enter mobile `9000000001` or email `admin@aarizo.com`)
- **Authentication Method**: Phone OTP or Email + Password.
- **Redirect Destination**: `/super-admin`
- **Portal Layout**: `SuperAdminLayout` with `MobileAppShell`.

#### Navigation & Route Map
- **Bottom Navigation Tabs**:
  1. `Home` (`/super-admin`) -> `SuperAdminDashboard`
  2. `Societies` (`/super-admin/societies`) -> `SuperAdminSocietiesPage`
  3. `Users` (`/super-admin/users`) -> `SuperAdminDashboard`
  4. `Profile` (`/super-admin/profile`) -> `SuperAdminDashboard`
- **Side Drawer Navigation Items**:
  - Super Admin Overview (`/super-admin`)
  - Societies Master (`/super-admin/societies`)

#### UI Controls, Actions & Modals
- **Buttons & Actions**:
  - Provision Society (`/admin/provision-society`): Atomic creation of society, initial tower, initial flat, and primary secretary user with salted password.
  - Edit Society Details: Modal to change name, address, subscription tier (`PRO`, `ENTERPRISE`), admin contact.
  - Deactivate / Suspend Society: Toggle status between `ACTIVE` and `SUSPENDED`.
  - Delete Society: Hard delete with cascade across all society data.
- **Data Displayed**:
  - Platform-wide statistics: Total onboarded societies, total flats across India, active resident count.
  - System health and database engine metrics.
- **Backend APIs Called**:
  - `POST /api/admin/provision-society`
  - `GET /api/societies`, `POST /api/societies`, `PATCH /api/societies/:id`, `DELETE /api/societies/:id`
- **Database Models Involved**: Universal access to all 31 Prisma models.

---

## 3. Unprotected / Developer Portals

- **Developer Database Studio**:
  - **Routes**: `/dev/database`, `/dev/db`
  - **Component**: `DeveloperDatabaseStudio`
  - **Authorization**: **COMPLETELY UNPROTECTED** (Public route in `src/routes/index.tsx`).
  - **Functionality**: Live inspection and export of 10 collections: `visitor_passes`, `realtime_events`, `notification_logs`, `residents`, `flats`, `societies`, `vehicles`, `staff`, `audit_logs`, and raw browser `localStorage`.
  - **Security Assessment**: Critical P0 Vulnerability. Exposes private resident records, vehicle registrations, and security audit logs to unauthenticated users.

