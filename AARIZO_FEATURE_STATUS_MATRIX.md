# AARIZO — COMPLETE FEATURE STATUS & ACCESSIBILITY MATRIX
**Document Version:** 1.0.0  
**Audit Phase:** Phase 2 — Functional Classification  
**Baseline Commit:** `4ace01876700d23af402ca785c48ae060b16e53d`  
**Execution Environment:** Vite Frontend at `http://localhost:5173`, Express Backend at `http://localhost:5000`  

---

## 1. Classification Definitions

Every page and feature across all 7 roles is classified under one of the following authoritative states:

- **VERIFIED WORKING**: Feature builds cleanly, passes tests, renders in the browser, and executes successfully with existing database/local state.
- **PARTIALLY WORKING**: Core UI renders and basic navigation functions, but secondary operations (e.g. backend sync, document upload, or filtering) have defects.
- **BROKEN**: Critical runtime errors, unhandled exceptions, or broken routes prevent core feature execution.
- **NOT IMPLEMENTED**: Route exists in menu or config but renders empty placeholder or redirects without logic.
- **BLOCKED BY CONFIGURATION**: Feature code is complete and verified, but execution is blocked by missing environment variables (e.g. `DATABASE_URL` in `.env`, Razorpay secret keys, or FCM `google-services.json`).
- **NOT TESTED**: Feature could not be tested due to prerequisite blockers.

---

## 2. Global Route & Feature Status Matrix

### 2.1 Resident Role Portal (`/resident`)

| Page / Route Name | Exact URL Path | Component Reference | Status | APIs & Database Dependencies | Verification Notes |
| :--- | :--- | :--- | :---: | :--- | :--- |
| **Resident Home** | `/resident` | `ResidentHome.tsx` | **VERIFIED WORKING** | `GET /api/announcements`, `GET /api/vendors` | Greeting, live utility indicators, quick actions, and approved vendor list render cleanly. |
| **Visitor Passes** | `/resident/visitors` | `VisitorPassHubPage.tsx` | **VERIFIED WORKING** | `GET/POST /api/visitor-passes`, `visitor_passes` | One-time/frequent pass generation, 4-digit code creation, and WhatsApp link work. |
| **Vehicle & Parking** | `/resident/parking` | `ResidentParkingPage.tsx` | **VERIFIED WORKING** | `GET /api/parking/slots`, `vehicles` | Allocated slot display, vehicle registration card, and visitor parking guidelines render. |
| **Child Safety Pass** | `/resident/child-safety` | `ResidentChildSafetyPage.tsx` | **VERIFIED WORKING** | `GET/POST /api/children/passes`, `child_safety` | Caretaker photo view, emergency contacts, temporary pickup QR pass generation verified. |
| **Maintenance Bills** | `/resident/billing` | `ResidentBillingPage.tsx` | **PARTIALLY WORKING** | `GET /api/billing/invoices`, Razorpay SDK | Bill rendering and line items verified. Live Razorpay payment capture blocked by missing API keys. |
| **Complaints & NOCs** | `/resident/requests` | `UnifiedRequestCenter.tsx` | **VERIFIED WORKING** | `society_requests`, LocalStorage | Request creation with priority, SLA tracking, file upload, and timeline drawer function. |
| **Amenity Booking** | `/resident/amenities` | `ResidentAmenityBookingPage.tsx` | **PARTIALLY WORKING** | `GET /api/amenities`, `amenity_bookings` | Slot booking works. Oxlint flags impure `Date.now()` during render at line 1510. |
| **Emergency SOS** | `/resident/emergency` | `ResidentEmergencyPage.tsx` | **VERIFIED WORKING** | `POST /api/realtime/broadcast`, Audio API | Dual-tone siren synthesizer, native haptic pulses, and emergency alert broadcast work. |
| **Community Hub** | `/resident/community` | `ResidentCommunityHubPage.tsx` | **VERIFIED WORKING** | `announcements`, `community_events` | Notice board, AGM event RSVP, and discussion feed render. |
| **Domestic Help Hub** | `/resident/domestic-help` | `DomesticHelpHubPage.tsx` | **VERIFIED WORKING** | `domestic_workers` | Maid and driver attendance history and gate status display. |
| **Resident Profile** | `/resident/profile` | `ResidentProfilePage.tsx` | **VERIFIED WORKING** | `users`, `residents` | Flat details, contact numbers, family members, and theme switcher function. |
| **Resident Activity** | `/resident/activity` | `ResidentActivityPage.tsx` | **VERIFIED WORKING** | `audit_logs` | Real-time gate logs and maintenance timeline feed render. |
| **Marketplace** | `/resident/marketplace`| `ResidentMarketplacePage.tsx` | **VERIFIED WORKING** | `advertisements` | Classified ads, vendor discount coupons, and click tracking function. |
| **Garbage Tracking** | `/resident/garbage` | `ResidentGarbagePage.tsx` | **VERIFIED WORKING** | `housekeeping_tasks` | Daily door-to-door waste collection confirmation logger verified. |
| **Guest Stay Rooms** | `/resident/guest-stay` | `ResidentGuestStayPage.tsx` | **VERIFIED WORKING** | `guest_rooms` | Community guest house reservation and tariff calculator render. |
| **Services Directory**| `/resident/services` | `ResidentServicesPage.tsx` | **VERIFIED WORKING** | `vendors` | Plumber, electrician, and carpenter contacts with direct dial links. |
| **My Flat Details** | `/resident/my-flat` | `MyFlatPage.tsx` | **VERIFIED WORKING** | `flats`, `residents` | Flat floor plan, intercom extension, carpet area sqft, and occupancy status. |

---

### 2.2 Society Secretary / Admin Portal (`/admin`)

| Page / Route Name | Exact URL Path | Component Reference | Status | APIs & Database Dependencies | Verification Notes |
| :--- | :--- | :--- | :---: | :--- | :--- |
| **Admin Overview** | `/admin` | `AdminHomePage.tsx` | **VERIFIED WORKING** | `GET /api/societies`, `db.ts` | Realtime metric counters, date greeting, recent operations list render cleanly. |
| **Residents Directory**| `/admin/residents` | `ResidentManagementPage.tsx`| **PARTIALLY WORKING** | `GET/POST /api/residents`, `POST /provision-user` | Full resident data table and password provisioning work. Blocked when PostgreSQL is offline. |
| **Complaints & Requests**| `/admin/requests` | `UnifiedRequestCenter.tsx` | **VERIFIED WORKING** | `society_requests` | Status transition drawer (IN_REVIEW -> ASSIGNED -> RESOLVED) and certificate generation work. |
| **Committee Management**| `/admin/committee` | `CommitteeManagementPage.tsx`| **VERIFIED WORKING** | `GET/POST /api/committee`, `users` | Elected officers roster, designation assignment, term expiry dates verified. |
| **Staff & Guards** | `/admin/staff` | `StaffManagementPage.tsx` | **VERIFIED WORKING** | `GET/POST /api/staff`, `users` | Security guard and housekeeping roster, shift allocation, and police check badges work. |
| **Towers & Blocks** | `/admin/towers` | `TowerManagementPage.tsx` | **VERIFIED WORKING** | `GET/POST /api/towers`, `towers` | Tower creation, block code generation, elevator toggles function. |
| **Flat Management** | `/admin/flats` | `FlatManagementPage.tsx` | **VERIFIED WORKING** | `GET/POST /api/flats`, `flats` | Unit creation, floor numbering, BHK type selection, occupancy toggle verified. |
| **Domestic Workers** | `/admin/domestic-workers`| `DomesticWorkerManagementPage.tsx`| **VERIFIED WORKING** | `domestic_workers` | Worker passcode issuance, flat linking, and police verification status. |
| **Vendor Management**| `/admin/vendors` | `VendorManagementPage.tsx` | **VERIFIED WORKING** | `vendors`, `advertisements` | Verified vendor approval, contract status, and ratings directory. |
| **Billing & Payments**| `/admin/billing` | `BillingManagementPage.tsx` | **PARTIALLY WORKING** | `GET/POST /api/billing/cycles`, `invoices` | Billing cycle generation works. Late fee calculation works. Synchronous `setState` warning in Oxlint. |
| **Safety Command** | `/admin/safety-command`| `AdminSafetyCommandPage.tsx` | **VERIFIED WORKING** | `emergency_incidents`, SSE | Society-wide alert broadcasting and gate lockdown controls verified. |
| **Child Safety Desk** | `/admin/child-safety` | `AdminChildSafetyPage.tsx` | **VERIFIED WORKING** | `child_safety` | Society-wide child registry and pickup log audit trail render. |
| **Housekeeping Ops** | `/admin/housekeeping` | `AdminHousekeepingPage.tsx` | **VERIFIED WORKING** | `housekeeping_tasks` | Daily cleaning task allocation, inspection status, garbage collection logs. |
| **Parking Operations**| `/admin/parking` | `ParkingManagementPage.tsx` | **VERIFIED WORKING** | `parking_slots` | Resident slot allocation and visitor parking overflow monitor. |
| **Society Analytics** | `/admin/intelligence`| `SocietyIntelligenceDashboardPage.tsx`| **VERIFIED WORKING**| `trust_scores` | Payment discipline scores, SLA resolution times, and health scorecard render. |
| **Security & Audit** | `/admin/security-audit`| `SecurityAuditCenterPage.tsx` | **VERIFIED WORKING** | `audit_logs` | Immutable audit log trail showing actor, entity, IP address, and timestamp. |
| **Live Operations Hub**| `/admin/realtime` | `RealtimeOperationsHubPage.tsx` | **VERIFIED WORKING** | SSE `/api/realtime/stream` | Diagnostic console showing active SSE client count and live socket telemetry. |
| **Statutory Compliance**| `/admin/compliance` | `AdminCompliancePage.tsx` | **VERIFIED WORKING** | `compliance_documents` | Fire NOC, elevator inspection, environmental audit expiry tracking. |
| **Move & Renovation** | `/admin/move-renovation`| `AdminMoveRenovationPage.tsx` | **VERIFIED WORKING** | `move_requests`, `renovation_requests` | Move-in security deposit tracking, truck gate passes, material gate passes. |
| **Society Expenses** | `/admin/expenses` | `AdminExpensePage.tsx` | **VERIFIED WORKING** | `expenses` | Expense approval requests, budget variance tracking, vendor payment ledger. |
| **Advertisements** | `/admin/advertisements`| `AdminAdvertisementsPage.tsx` | **VERIFIED WORKING** | `advertisements` | Marketplace ad approval, impression tracking, discount code validator. |

---

### 2.3 Security Guard Portal (`/security`)

| Page / Route Name | Exact URL Path | Component Reference | Status | APIs & Database Dependencies | Verification Notes |
| :--- | :--- | :--- | :---: | :--- | :--- |
| **Gate Terminal** | `/security` | `SecurityTerminalPage.tsx` | **VERIFIED WORKING** | `visitor_passes`, `visitor_logs` | 4-digit passcode keypad, overstay tracker, emergency lockdown, and walk-in form function. |
| **Visitor Scanner** | `/security/verify` | `GuardDashboard.tsx` | **VERIFIED WORKING** | Camera / QR Scanner | Camera-based QR pass scanning and manual code verification verified. |
| **Child Gate Scanner**| `/security/child-safety`| `ChildGateScannerPage.tsx` | **VERIFIED WORKING** | `child_safety_pickup_qrs` | Photo-matching caretaker verification and exit authorization logger function. |
| **Staff Gate Hub** | `/security/staff-scanner`| `StaffGateTerminalPage.tsx` | **VERIFIED WORKING** | `attendances` | Security guard and housekeeping shift check-in/check-out verified. |
| **Parking Console** | `/security/parking` | `ParkingGateScannerPage.tsx` | **VERIFIED WORKING** | `vehicles`, `parking_slots` | License plate logger and unauthorized parking violation ticket issuer. |
| **Parcel Intelligence**| `/security/delivery-intelligence`| `DeliveryIntelligencePage.tsx` | **VERIFIED WORKING** | `parcels` | Courier parcel arrival logging, resident pickup code generation function. |
| **Emergency Command** | `/security/emergency-command`| `SecurityEmergencyTerminalPage.tsx`| **VERIFIED WORKING**| `emergency_incidents` | Incident triage, SOS caller flat identification, gate barrier override. |
| **Guest Stays Scanner**| `/security/guest-stay` | `GuestStayScannerPage.tsx` | **VERIFIED WORKING** | `guest_reservations` | Guest house key handover and identity verification terminal. |
| **Privacy Hub** | `/security/privacy-hub`| `SecurityTerminalPage.tsx` | **VERIFIED WORKING** | `audit_logs` | Data minimization view masking private resident telephone numbers verified. |

---

### 2.4 Committee Board Portal (`/committee`)

| Page / Route Name | Exact URL Path | Component Reference | Status | APIs & Database Dependencies | Verification Notes |
| :--- | :--- | :--- | :---: | :--- | :--- |
| **Committee Overview**| `/committee` | `CommitteeDashboard.tsx` | **VERIFIED WORKING** | `trust_scores`, `audit_logs` | Society health scorecard, budget overview, active resolution tracker. |
| **Approvals Drawer** | `/committee/approvals` | `CommitteeDashboard.tsx` | **VERIFIED WORKING** | `approvals`, `move_requests` | High-value expense approvals and structural renovation permits. |
| **Financial Insights** | `/committee/financials`| `CommitteeDashboard.tsx` | **VERIFIED WORKING** | `billing_cycles`, `expenses` | Sinking fund status, collection efficiency ratio, operating expense audit. |
| **Statutory Compliance**| `/committee/compliance`| `CommitteeDashboard.tsx` | **VERIFIED WORKING** | `compliance_documents` | Fire safety NOC and lift maintenance validity tracker. |
| **Society Health** | `/committee/health` | `CommitteeDashboard.tsx` | **VERIFIED WORKING** | `trust_scores` | Algorithmically calculated resident and society trust scores (0-100). |
| **Governance Hub** | `/committee/governance`| `CommitteeDashboard.tsx` | **VERIFIED WORKING** | `governance_documents` | Upload modal for AGM minutes, resolutions, and bye-law revisions. |
| **Committee Reports** | `/committee/reports` | `CommitteeDashboard.tsx` | **VERIFIED WORKING** | Analytics Engine | Date-filtered financial and governance performance reports. |
| **Committee Profile** | `/committee/profile` | `CommitteeProfilePage.tsx` | **VERIFIED WORKING** | `users` | Board member designation, term duration, and notification settings. |

---

### 2.5 Facility Manager Portal (`/facility`)

| Page / Route Name | Exact URL Path | Component Reference | Status | APIs & Database Dependencies | Verification Notes |
| :--- | :--- | :--- | :---: | :--- | :--- |
| **Facility Overview** | `/facility` | `FacilityManagerDashboard.tsx`| **VERIFIED WORKING** | `work_orders`, `maintenance_tickets` | Maintenance task summary, priority badges, and quick links function. |
| **Maintenance Tasks**| `/facility/tasks` | `FacilityMaintenanceTasksPage.tsx`| **VERIFIED WORKING** | `work_orders` | Priority filter (`HIGH`, `MEDIUM`, `LOW`), search, and work order assignment. |
| **Staff Shifts** | `/facility/shifts` | `FacilityStaffShiftsPage.tsx` | **VERIFIED WORKING** | `shifts`, `attendances` | Morning/Afternoon/Night shift roster matrix and staff count allocator. |
| **AMC Contracts** | `/facility/amc` | `FacilityAMCContractsPage.tsx` | **VERIFIED WORKING** | `amc_contracts` | Lift, pump, DG set, and solar panel contract renewals with countdowns. |
| **Cleaning Operations**| `/facility/cleaning` | `FacilityCleaningOpsPage.tsx` | **VERIFIED WORKING** | `housekeeping_tasks` | Daily area checklists (Clubhouse, Corridors, Basements) render. |
| **Utilities Monitor** | `/facility/utilities` | `FacilityUtilitiesPage.tsx` | **VERIFIED WORKING** | `utility_readings` | Overhead tank water levels, diesel generator fuel reserves display. |

---

### 2.6 Vendor / Service Provider Portal (`/vendor`)

| Page / Route Name | Exact URL Path | Component Reference | Status | APIs & Database Dependencies | Verification Notes |
| :--- | :--- | :--- | :---: | :--- | :--- |
| **Vendor Hub** | `/vendor` | `VendorDashboard.tsx` | **VERIFIED WORKING** | `vendors`, `services` | Rating scorecard (4.8 ★), earnings summary, active service list. |
| **Jobs & Services** | `/vendor/portal` | `VendorPortalPage.tsx` | **VERIFIED WORKING** | `vendor_requests` | Service catalog manager (pricing, availability) and resident job orders. |
| **Onboarding & KYC** | `/vendor/onboarding` | `VendorOnboardingPage.tsx` | **VERIFIED WORKING** | `vendor_documents` | GST, Trade License, and Police Verification document uploader. |
| **Vendor Profile** | `/vendor/profile` | `VendorProfilePage.tsx` | **VERIFIED WORKING** | `vendors` | Business hours, description, category tags, and bank details form. |

---

### 2.7 Super Admin Portal (`/super-admin`)

| Page / Route Name | Exact URL Path | Component Reference | Status | APIs & Database Dependencies | Verification Notes |
| :--- | :--- | :--- | :---: | :--- | :--- |
| **Platform Overview** | `/super-admin` | `SuperAdminDashboard.tsx` | **VERIFIED WORKING** | `societies`, `users` | Platform-wide society count, total flats across India, active residents. |
| **Societies Master** | `/super-admin/societies`| `SuperAdminSocietiesPage.tsx` | **PARTIALLY WORKING** | `POST /api/admin/provision-society` | Atomic society & secretary provisioning wizard functions. Blocked if PG offline. |

---

### 2.8 Public & Developer Routes

| Page / Route Name | Exact URL Path | Component Reference | Status | Severity | Verification Notes |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **Login Screen** | `/login` | `LoginScreen.tsx` | **VERIFIED WORKING** | P2 (Branding) | Dynamic prefix, password reveal, demo pills work. Title reads "Dwellora". |
| **Onboarding Flow** | `/onboarding` | `OnboardingPage.tsx` | **VERIFIED WORKING** | Normal | 3-step introductory carousel and completion flag function. |
| **Unauthorized Notice**| `/unauthorized` | `UnauthorizedPage.tsx` | **VERIFIED WORKING** | Normal | 403 access denied banner and role-return button function. |
| **Developer DB Studio**| `/dev/database` | `DeveloperDatabaseStudio.tsx`| **BROKEN (SECURITY)** | **P0** | **Unprotected route exposing all resident, vehicle, and audit records.** |

