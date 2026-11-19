# AARIZO / Dwellora — Phase 4.7
# Portal UI Baseline Audit Report

**Audit Date:** November 19, 2026  
**Auditor:** Principal Product Designer, Senior React Architect & Frontend QA  
**Scope:** Multi-Portal Experience, Dashboard Consistency & UI Shell Architecture  
**Portals Audited:** Resident, Security Guard, Society Admin, Super Admin, Committee, Facility Manager, Vendor, Service Provider, Domestic Worker  
**Design Reference:** Resident Portal Home Overview (`src/components/resident/ResidentHome.tsx`)

---

## 1. Executive Summary

This audit establishes the baseline visual, architectural, and user experience state across all 9 operational portals in the AARIZO / Dwellora application.

The **Resident Home Overview** (`src/components/resident/ResidentHome.tsx`) serves as the product design gold standard. It features a disciplined design system:
- **Pale Sky Blue Greeting Banner** (`#EAF6FC`, border `#DCE8EF`, typography `#083B56`, `#657785`, `#8B9AA5`).
- **Urgent Dismissible Alert Banner** (`#FFF8E8`, left border 4px `#D99A2B`, rounded 16px).
- **Hero Action Cards** (`gridTemplateColumns: repeat(auto-fit, minmax(150px, 1fr))`, rounded 16px, gradient/accent background, 36x36 icon pill, bold action title, subtitle).
- **Quick Actions Grid** (uppercase heading `0.8125rem`, weight 800, Navy `#083B56`, buttons with 42x42 colored icon pill, white card background, rounded 16px, `0.75rem` label, elevation shadow `0 2px 8px rgba(8, 59, 86, 0.04)`).
- **Live Status Badges** (horizontal scroll or compact grid, white card, rounded 14px, status indicator dot + text).
- **Action Required List** (stacked white cards, rounded 16px, status indicator dot, chevron right).
- **Two-Column Responsive Desktop Grid** (`minmax(320px, 1fr)`) containing Recent Activity stream and Announcements / Critical Insights.

The audit revealed that while all portals share the common `<MobileAppShell>` layout wrapper (with deep espresso header `#231715`, role title, society name, realtime status badge, drawer, and bottom navigation), their home overview screens and profile experiences diverge significantly in structure, visual styling, data density, and navigation fidelity.

---

## 2. Portal-by-Portal Baseline Audit

### 2.1 Resident Portal (`/resident`) — The Gold Standard Baseline
- **Layout Shell:** `ResidentLayout.tsx` wrapping `MobileAppShell`.
  - Role Title: "Resident".
  - Drawer Items: 12 items (Home, Visitors, Parking, Child Safety, Billing, Requests, Amenities, Services, Community, Activity, Emergency SOS, Profile).
  - Bottom Items: 4 items (Home, Services, Community, Profile) + Center FAB navigating to `/resident/visitors`.
- **Overview Implementation:** `src/components/resident/ResidentHome.tsx`.
  - Greeting banner with `getGreeting()`, user first name, flat details, and sponsored offers pill.
  - Urgent announcements banner.
  - Hero action cards: "Generate Gate Pass" and "Society Vendors".
  - 6-item Quick Actions grid (Visitors, Parking, Pay, Complaint, Parcel, SOS).
  - 5-item Live Society Status badges (Water, Security, Garbage, Cleaning, Power).
  - Live Parcel Widget integration.
  - Action Required pending items.
  - Approved Society Vendors directory preview.
  - Desktop 2-column grid: Recent Activity stream & Society Announcements.
- **Findings:** Flawlessly structured, accessible, mobile-first, and desktop-responsive.

---

### 2.2 Security Guard Portal (`/security`, `/security/terminal`, `/security/verify`)
- **Layout Shell:** `SecurityLayout.tsx` wrapping `MobileAppShell`.
  - Role Title: "Security Guard".
  - Drawer Items: 9 items (Gate Terminal, Visitor Scanner, Child Gate Scanner, Staff Hub, Parking Console, Parcel Intelligence, Emergency Command, Guest Stays, Privacy & Audit).
  - Bottom Items: 4 items (Gate `/security`, Scan `/security/verify`, Emergency `/security/emergency-command`, Profile `/security/profile`) + Center FAB navigating to `/security/verify`.
- **Current Overview State:**
  - Navigating to `/security` lands directly into the complex 935-line `SecurityTerminalPage.tsx` (a dense operator tool with search input, 6-digit gate passcode lookup, walk-in form modal, and blacklist editor).
  - It lacks a high-level overview page matching `ResidentHome` structure: no greeting banner, no live status badges for perimeter security, no quick-action grid for rapid one-tap navigation to Child Gate Scanner, Staff Scanner, Parking Scanner, or Emergency SOS.
- **Identified Gap:** Security personnel need a unified `SecurityHome` overview that matches the `ResidentHome` visual hierarchy:
  - Hero terminal status (Active Gate, Officer on duty, shift duration, gate open/lock status).
  - Quick action launcher cards: Visitor Scanner, Child Gate Scanner, Staff Scanner, Parking Scanner, Emergency Command.
  - Live Security Status badges (Main Gate, Perimeter Sensors, Guard Roster, Visitor Traffic, Child SOS).
  - Action Required list: Pending visitor arrivals, active child alerts, unverified walk-ins.
  - Desktop 2-column grid: Recent Gate Check-in logs & Security notices.

---

### 2.3 Society Admin / Secretary Portal (`/admin`)
- **Layout Shell:** `SocietyAdminLayout.tsx` wrapping `MobileAppShell`.
  - Role Title: "Secretary".
  - Drawer Items: 21 items covering operations, management, billing, compliance, and intelligence.
  - Bottom Items: 4 items (Home `/admin`, Residents `/admin/residents`, Notices `/admin/community`, Profile `/admin/profile`) + Center FAB navigating to `/admin/requests`.
- **Current Overview State:** `src/pages/dashboard/admin/AdminHomePage.tsx`.
  - Greeting card uses a gradient `#EAF6FC` to `#F4FAFE`, date/day clock, and 4 stat cards (Residents, Guards, Realtime, Collections).
  - Quick Management Hub uses 7 cards.
  - Desktop grid has Announcements and Recent Activity.
- **Inconsistencies with Resident Baseline:**
  - Header banner does not match `ResidentHome` full-width pale sky blue `#EAF6FC` styling with border `#DCE8EF`.
  - Missing Urgent Alert banner for pending escalations or urgent society notices.
  - Stat cards and Quick Actions lack the exact rounded 16px, 42x42 colored icon pill, and uppercase section headings defined in `ResidentHome`.
  - Live Society Operations status row is absent.
  - Action Required section (e.g. pending resident approvals, high-priority work orders) is missing.

---

### 2.4 Management Committee Portal (`/committee`)
- **Layout Shell:** `CommitteeLayout.tsx` wrapping `MobileAppShell`.
  - Role Title: "Committee".
  - Drawer Items: 8 items (Overview, Approvals, Financials, Compliance, Society Health, Governance, Reports, Profile).
  - Bottom Items: 4 items (Home `/committee`, Approvals `/committee/approvals`, Reports `/committee/reports`, Profile `/committee/profile`) + Center FAB navigating to `/committee/approvals`.
- **Current Overview State:** `src/pages/dashboard/CommitteeDashboard.tsx`.
  - The component manages multi-tab switching (`home`, `approvals`, `financials`, `compliance`, `health`, `governance`, `reports`, `profile`).
  - The Home overview tab features subheader cards, summary metrics, and quick action cards.
- **Inconsistencies with Resident Baseline:**
  - Uses inconsistent padding and borders compared to `ResidentHome`.
  - Header greeting banner is missing the standardized `getGreeting()` and user display name in Navy `#083B56`.
  - Lacks standardized live status indicators (Budget Health, Vendor Compliance, Resolution Quorum, AMC Status).

---

### 2.5 Facility Manager Portal (`/facility`)
- **Layout Shell:** `FacilityManagerLayout.tsx` wrapping `MobileAppShell`.
  - Role Title: "Facility Manager".
  - Drawer Items: 6 items (Overview, Maintenance, Staff Shifts, AMC Contracts, Cleaning Ops, Utilities).
  - Bottom Items: 4 items (Home `/facility`, Tasks `/facility/tasks`, Maintenance `/facility/maintenance`, Profile `/facility/profile`) + Center FAB navigating to `/facility/maintenance`.
- **Current Overview State:** `src/pages/dashboard/FacilityManagerDashboard.tsx`.
  - Renders a search bar, priority filters, and a data table of maintenance work orders.
  - Lacks a true Home overview matching `ResidentHome` with operational greeting, hero shift status, quick actions (Tasks, AMC, Cleaning, Utilities, Staff Roster), live equipment status (Elevators, DG Sets, Water Pumps, STP, Fire System), and action required queue.

---

### 2.6 Super Admin Portal (`/super-admin`)
- **Layout Shell:** `SuperAdminLayout.tsx` wrapping `MobileAppShell`.
  - Role Title: "System Admin".
  - Drawer Items: 2 items (Super Admin `/super-admin`, Societies `/super-admin/societies`).
  - Bottom Items: 4 items (Home `/super-admin`, Societies `/super-admin/societies`, Users `/super-admin/users`, Profile `/super-admin/profile`).
- **Current Overview State:** `src/pages/dashboard/SuperAdminDashboard.tsx`.
  - Renders multi-tenant society management table directly without an executive overview.
  - Lacks unified greeting banner, platform health badges (API Uptime, Database Pool, Realtime SSE connections, Active Societies), and quick actions.

---

### 2.7 Vendor Portal (`/vendor`)
- **Layout Shell:** `VendorLayout.tsx` wrapping `MobileAppShell`.
  - Role Title: "Vendor".
  - Drawer Items: 4 items (Vendor Hub, Jobs & Services, Onboarding & KYC, Vendor Profile).
  - Bottom Items: 4 items (Home `/vendor`, Jobs `/vendor/portal`, KYC `/vendor/onboarding`, Profile `/vendor/profile`) + Center FAB navigating to `/vendor/portal`.
- **Current Overview State:** `src/pages/dashboard/VendorDashboard.tsx`.
  - Heavy 1510-line multi-tab state engine.
  - Needs alignment of its dashboard tab with `ResidentHome` visual standards (greeting banner, verified KYC status card, live job status, quick actions, pending service requests).

---

### 2.8 Service Provider & Domestic Worker Portals (`/service-provider`, `/domestic`)
- **Layout Shells:** `ServiceProviderLayout.tsx` and `DomesticWorkerLayout.tsx`.
  - Use custom dark navy header banners instead of the unified Pale Sky Blue `#EAF6FC` greeting banner.
  - Overview screens are simple check-in panels with QR codes.
  - Lack standardized profile routes and consistent status cards.

---

## 3. Design System Token Matrix

To guarantee structural and visual unity without duplicating resident logic, all portal overviews must strictly conform to these tokens:

| Token | Value | ResidentHome Usage | Unified Standard |
|---|---|---|---|
| Page Background | `#F7FBFE` | Root container background | Applied to all portal overviews |
| Top App Header | `#231715` | Espresso header with role pill | Provided by `MobileAppShell` |
| Greeting Banner Bg | `#EAF6FC` | Top greeting banner | Standardized across all 9 portals |
| Greeting Banner Border | `#DCE8EF` | 1px solid bottom border | Standardized across all 9 portals |
| Primary Heading | `#083B56` | 1.375rem, font-weight 800 | User name / Role title |
| Subtitle / Context | `#657785` | 0.75rem, font-weight 500 | Greeting prefix / Society & unit |
| Section Header | `#083B56` | 0.8125rem, weight 800, uppercase | Quick Actions, Live Status, Activity |
| Hero Card | Rounded 16px | Gradient / accent with 36x36 icon pill | Role-specific primary actions |
| Quick Action Button | Rounded 16px | White card, 42x42 icon pill, 0.75rem label | 1-tap navigation hub |
| Status Badge | Rounded 14px | White card, 6px status dot, 0.625rem text | Operational health indicators |
| Action Required Card | Rounded 16px | White card, 8px urgency dot, ChevronRight | Pending queue / approvals |
| Activity Stream | Rounded 16px | White card, stacked rows, border `#E8F1F5` | Real-time audit / event log |

---

## 4. Remediation Action Plan
1. Create a unified, modular UI component suite (`src/components/portal/PortalOverviewComponents.tsx`) encapsulating:
   - `PortalGreetingBanner`: Standardized Pale Sky Blue greeting with role badge and context.
   - `PortalHeroActionCard`: Standardized primary action hero cards.
   - `PortalQuickActionsGrid`: Unified 42x42 icon pill quick action launcher.
   - `PortalStatusBadges`: Live operational health status badges.
   - `PortalActionRequiredList`: Urgent pending tasks / approvals queue.
   - `PortalActivityList`: Real-time audit / movement activity stream.
2. Build `SecurityHome.tsx` overview matching `ResidentHome` structure, seamlessly connecting to existing `SecurityTerminalPage` and scanners.
3. Align `AdminHomePage.tsx` to match the exact visual tokens, adding live operations status and pending approval queues.
4. Align `CommitteeDashboard.tsx`, `FacilityManagerDashboard.tsx`, and `SuperAdminDashboard.tsx`.
5. Fix broken profile routes and deliver role-aware profile pages for Admin, Security, Committee, and Super Admin.
