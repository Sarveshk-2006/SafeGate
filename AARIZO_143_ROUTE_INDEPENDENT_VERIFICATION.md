# AARIZO — 143 API Route Independent Verification Audit

**Document ID**: AARIZO-AUD-143-ROUTES-001  
**Audit Phase**: Phase A, Step 2.3 (Security Verification Gate)  
**Source Code**: `server/src/index.ts` (Commit Baseline `4ace018`)  
**Audit Methodology**: Independent source code AST parsing and live HTTP execution  
**Total Registered Routes Audited**: 143  
**Date**: November 14, 2026  

---

## 1. Executive Summary & Recalculation

An independent scan of `server/src/index.ts` recalculates and verifies exactly **143 endpoint routes** registered on the Express application instance, plus 2 middleware mounts (`/uploads` static handler at line 49 and `/api` global authentication router at line 73).

### Key Architectural Findings:
1. **Global Route Coverage**: All 142 routes prefixed with `/api` are intercepted by `app.use('/api', ...)` at line 73.
2. **Public Allowlist**: Exactly **4 routes** are allowlisted in `isPublicApiRoute` (`GET /api/health`, `GET /api/realtime/health`, `POST /api/auth/login`, `POST /api/payments/razorpay/webhook`).
3. **Role-Guarded Routes**: **85 routes** explicitly mount `requireRole([...])`.
4. **General Protected Routes**: **53 routes** prefixed with `/api` lack explicit `requireRole` middleware but are protected from unauthenticated access by the global `authenticateToken` middleware.
5. **Frontend SPA Fallback**: Exactly **1 route** (`GET *` at line 3525) handles non-API client navigation and serves `dist/index.html`. Any unauthenticated request to `GET /api/nonexistent` is intercepted by `app.use('/api', ...)` and rejected with HTTP 401 `AUTH_TOKEN_MISSING`.
6. **Critical Tenant Isolation Gap**: **0 out of 143 routes** mount `requireSocietyMembership` middleware. In addition, route handlers rely on inconsistent ad-hoc queries (`req.societyId || req.body.societyId || 'soc-gvs'`), and `GET /api/realtime/stream` prioritizes unverified `req.query.societyId` and `req.query.role` over authenticated server context.

---

## 2. Route Classification Summary Table

| Category | Count | Global Auth Enforced | Role Check Enforced | Tenant Isolation Enforced |
| :--- | :---: | :---: | :---: | :---: |
| **Intentionally Public** | 4 | Excluded (Allowlisted) | N/A (Public) | N/A |
| **Role-Guarded Protected API** | 85 | Yes (HTTP 401 on missing token) | Yes (requireRole) | Ad-hoc / Missing Middleware |
| **General Protected API** | 53 | Yes (HTTP 401 on missing token) | None (Any Authenticated Role) | Ad-hoc / Missing Middleware |
| **SPA Frontend Fallback** | 1 | Intercepts `/api/*` (401), Serves HTML otherwise | N/A | N/A |
| **Total Endpoints** | **143** | | | |

---

## 3. Complete 143-Route Independent Inventory

| # | Line | Method | Path | Active Middleware | Auth Status | Allowed Roles | Exercising Tests |
| :-: | :-: | :---: | :--- | :--- | :--- | :--- | :--- |
| 1 | 102 | `GET` | `/api/health` | None (Global Only) | Public (Allowlisted) | Public | None (Indirect) |
| 2 | 116 | `GET` | `/api/realtime/stream` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 3 | 127 | `POST` | `/api/realtime/broadcast` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 4 | 149 | `GET` | `/api/realtime/health` | None (Global Only) | Public (Allowlisted) | Public | issue02_unified_auth_integration.test.ts |
| 5 | 181 | `GET` | `/api/societies` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 6 | 193 | `POST` | `/api/societies` | `requireRole(['admin'])` | Protected by Global Auth | admin | None (Indirect) |
| 7 | 213 | `PATCH` | `/api/societies/:id` | `requireRole(['admin'])` | Protected by Global Auth | admin | None (Indirect) |
| 8 | 227 | `DELETE` | `/api/societies/:id` | `requireRole(['admin'])` | Protected by Global Auth | admin | None (Indirect) |
| 9 | 239 | `GET` | `/api/towers` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 10 | 252 | `POST` | `/api/towers` | `requireRole(['secretary', 'admin'])` | Protected by Global Auth | secretary, admin | None (Indirect) |
| 11 | 276 | `PATCH` | `/api/towers/:id` | `requireRole(['secretary', 'admin'])` | Protected by Global Auth | secretary, admin | None (Indirect) |
| 12 | 290 | `DELETE` | `/api/towers/:id` | `requireRole(['secretary', 'admin'])` | Protected by Global Auth | secretary, admin | None (Indirect) |
| 13 | 310 | `GET` | `/api/flats` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 14 | 323 | `POST` | `/api/flats` | `requireRole(['secretary', 'admin'])` | Protected by Global Auth | secretary, admin | None (Indirect) |
| 15 | 377 | `PATCH` | `/api/flats/:id` | `requireRole(['secretary', 'admin'])` | Protected by Global Auth | secretary, admin | None (Indirect) |
| 16 | 391 | `DELETE` | `/api/flats/:id` | `requireRole(['secretary', 'admin'])` | Protected by Global Auth | secretary, admin | None (Indirect) |
| 17 | 417 | `GET` | `/api/committee` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 18 | 429 | `POST` | `/api/committee` | `requireRole(['secretary', 'admin'])` | Protected by Global Auth | secretary, admin | None (Indirect) |
| 19 | 450 | `GET` | `/api/residents` | `requireRole(['secretary', 'guard', 'facility_manager', 'admin', 'resident'])` | Protected by Global Auth | secretary, guard, facility_manager, admin, resident | issue02_unified_auth_integration.test.ts |
| 20 | 467 | `POST` | `/api/residents` | `requireRole(['secretary', 'admin'])` | Protected by Global Auth | secretary, admin | issue02_unified_auth_integration.test.ts |
| 21 | 504 | `PATCH` | `/api/residents/:id` | `requireRole(['secretary', 'admin', 'resident'])` | Protected by Global Auth | secretary, admin, resident | None (Indirect) |
| 22 | 519 | `DELETE` | `/api/residents/:id` | `requireRole(['secretary', 'admin'])` | Protected by Global Auth | secretary, admin | None (Indirect) |
| 23 | 534 | `GET` | `/api/visitor-passes` | `requireRole(['resident', 'guard', 'secretary', 'admin', 'facility_manager'])` | Protected by Global Auth | resident, guard, secretary, admin, facility_manager | None (Indirect) |
| 24 | 551 | `POST` | `/api/visitor-passes` | `requireRole(['resident', 'guard', 'secretary', 'admin'])` | Protected by Global Auth | resident, guard, secretary, admin | None (Indirect) |
| 25 | 563 | `PATCH` | `/api/visitor-passes/:id` | `requireRole(['resident', 'guard', 'secretary', 'admin'])` | Protected by Global Auth | resident, guard, secretary, admin | None (Indirect) |
| 26 | 578 | `DELETE` | `/api/visitor-passes/:id` | `requireRole(['resident', 'secretary', 'admin'])` | Protected by Global Auth | resident, secretary, admin | None (Indirect) |
| 27 | 593 | `POST` | `/api/visitor-passes/check-overstay` | `requireRole(['guard', 'secretary', 'admin'])` | Protected by Global Auth | guard, secretary, admin | None (Indirect) |
| 28 | 633 | `POST` | `/api/visitor-passes/verify` | `requireRole(['guard', 'secretary', 'admin', 'resident'])` | Protected by Global Auth | guard, secretary, admin, resident | None (Indirect) |
| 29 | 692 | `GET` | `/api/maintenance` | `requireRole(['resident', 'facility_manager', 'secretary', 'admin', 'vendor'])` | Protected by Global Auth | resident, facility_manager, secretary, admin, vendor | None (Indirect) |
| 30 | 704 | `POST` | `/api/maintenance` | `requireRole(['resident', 'facility_manager', 'secretary', 'admin'])` | Protected by Global Auth | resident, facility_manager, secretary, admin | None (Indirect) |
| 31 | 716 | `PATCH` | `/api/maintenance/:id` | `requireRole(['facility_manager', 'secretary', 'admin', 'vendor'])` | Protected by Global Auth | facility_manager, secretary, admin, vendor | None (Indirect) |
| 32 | 731 | `GET` | `/api/billing/invoices` | `requireRole(['resident', 'secretary', 'admin', 'committee'])` | Protected by Global Auth | resident, secretary, admin, committee | None (Indirect) |
| 33 | 744 | `PATCH` | `/api/billing/invoices/:id` | `requireRole(['resident', 'secretary', 'admin', 'committee'])` | Protected by Global Auth | resident, secretary, admin, committee | None (Indirect) |
| 34 | 758 | `POST` | `/api/billing/invoices` | `requireRole(['secretary', 'admin', 'committee'])` | Protected by Global Auth | secretary, admin, committee | None (Indirect) |
| 35 | 791 | `DELETE` | `/api/billing/invoices/:id` | `requireRole(['secretary', 'admin'])` | Protected by Global Auth | secretary, admin | None (Indirect) |
| 36 | 803 | `GET` | `/api/billing/cycles` | `requireRole(['secretary', 'admin', 'committee'])` | Protected by Global Auth | secretary, admin, committee | None (Indirect) |
| 37 | 817 | `POST` | `/api/billing/cycles` | `requireRole(['secretary', 'admin'])` | Protected by Global Auth | secretary, admin | None (Indirect) |
| 38 | 841 | `POST` | `/api/billing/apply-late-fees` | `requireRole(['secretary', 'admin', 'committee'])` | Protected by Global Auth | secretary, admin, committee | None (Indirect) |
| 39 | 876 | `GET` | `/api/parcels` | `requireRole(['resident', 'guard', 'secretary', 'admin'])` | Protected by Global Auth | resident, guard, secretary, admin | None (Indirect) |
| 40 | 889 | `POST` | `/api/parcels` | `requireRole(['guard', 'secretary', 'admin'])` | Protected by Global Auth | guard, secretary, admin | None (Indirect) |
| 41 | 902 | `PATCH` | `/api/parcels/:id/collect` | `requireRole(['resident', 'guard', 'secretary', 'admin'])` | Protected by Global Auth | resident, guard, secretary, admin | None (Indirect) |
| 42 | 921 | `GET` | `/api/staff` | `requireRole(['guard', 'secretary', 'facility_manager', 'admin', 'resident'])` | Protected by Global Auth | guard, secretary, facility_manager, admin, resident | None (Indirect) |
| 43 | 933 | `POST` | `/api/staff` | `requireRole(['secretary', 'facility_manager', 'admin'])` | Protected by Global Auth | secretary, facility_manager, admin | None (Indirect) |
| 44 | 956 | `PATCH` | `/api/staff/:id` | `requireRole(['secretary', 'facility_manager', 'admin'])` | Protected by Global Auth | secretary, facility_manager, admin | None (Indirect) |
| 45 | 970 | `DELETE` | `/api/staff/:id` | `requireRole(['secretary', 'facility_manager', 'admin'])` | Protected by Global Auth | secretary, facility_manager, admin | None (Indirect) |
| 46 | 982 | `GET` | `/api/domestic-workers` | `requireRole(['resident', 'guard', 'secretary', 'facility_manager', 'admin'])` | Protected by Global Auth | resident, guard, secretary, facility_manager, admin | None (Indirect) |
| 47 | 994 | `POST` | `/api/domestic-workers` | `requireRole(['resident', 'guard', 'secretary', 'facility_manager', 'admin'])` | Protected by Global Auth | resident, guard, secretary, facility_manager, admin | None (Indirect) |
| 48 | 1018 | `PATCH` | `/api/domestic-workers/:id` | `requireRole(['resident', 'guard', 'secretary', 'facility_manager', 'admin'])` | Protected by Global Auth | resident, guard, secretary, facility_manager, admin | None (Indirect) |
| 49 | 1032 | `DELETE` | `/api/domestic-workers/:id` | `requireRole(['secretary', 'facility_manager', 'admin'])` | Protected by Global Auth | secretary, facility_manager, admin | None (Indirect) |
| 50 | 1044 | `GET` | `/api/vendors` | `requireRole(['resident', 'secretary', 'facility_manager', 'admin', 'vendor', 'committee'])` | Protected by Global Auth | resident, secretary, facility_manager, admin, vendor, committee | None (Indirect) |
| 51 | 1062 | `POST` | `/api/vendors` | `requireRole(['secretary', 'admin', 'committee', 'facility_manager'])` | Protected by Global Auth | secretary, admin, committee, facility_manager | None (Indirect) |
| 52 | 1107 | `PATCH` | `/api/vendors/:id` | `requireRole(['secretary', 'admin', 'committee', 'facility_manager'])` | Protected by Global Auth | secretary, admin, committee, facility_manager | None (Indirect) |
| 53 | 1121 | `DELETE` | `/api/vendors/:id` | `requireRole(['secretary', 'admin', 'committee'])` | Protected by Global Auth | secretary, admin, committee | None (Indirect) |
| 54 | 1133 | `GET` | `/api/amenities` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 55 | 1145 | `POST` | `/api/amenities` | `requireRole(['secretary', 'admin', 'facility_manager'])` | Protected by Global Auth | secretary, admin, facility_manager | None (Indirect) |
| 56 | 1171 | `PATCH` | `/api/amenities/:id` | `requireRole(['secretary', 'admin', 'facility_manager'])` | Protected by Global Auth | secretary, admin, facility_manager | None (Indirect) |
| 57 | 1185 | `DELETE` | `/api/amenities/:id` | `requireRole(['secretary', 'admin'])` | Protected by Global Auth | secretary, admin | None (Indirect) |
| 58 | 1197 | `GET` | `/api/amenities/:id/availability` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 59 | 1292 | `POST` | `/api/amenities/:id/book` | `requireRole(['resident', 'secretary', 'admin', 'committee'])` | Protected by Global Auth | resident, secretary, admin, committee | None (Indirect) |
| 60 | 1414 | `POST` | `/api/amenities/bookings/:id/cancel` | `requireRole(['resident', 'secretary', 'admin', 'committee'])` | Protected by Global Auth | resident, secretary, admin, committee | None (Indirect) |
| 61 | 1456 | `GET` | `/api/announcements` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 62 | 1468 | `POST` | `/api/announcements` | `requireRole(['secretary', 'admin', 'committee'])` | Protected by Global Auth | secretary, admin, committee | None (Indirect) |
| 63 | 1480 | `DELETE` | `/api/announcements/:id` | `requireRole(['secretary', 'admin', 'committee'])` | Protected by Global Auth | secretary, admin, committee | None (Indirect) |
| 64 | 1492 | `GET` | `/api/community-events` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 65 | 1504 | `POST` | `/api/community-events` | `requireRole(['secretary', 'admin', 'committee'])` | Protected by Global Auth | secretary, admin, committee | None (Indirect) |
| 66 | 1516 | `PATCH` | `/api/community-events/:id` | `requireRole(['secretary', 'admin', 'committee'])` | Protected by Global Auth | secretary, admin, committee | None (Indirect) |
| 67 | 1530 | `DELETE` | `/api/community-events/:id` | `requireRole(['secretary', 'admin', 'committee'])` | Protected by Global Auth | secretary, admin, committee | None (Indirect) |
| 68 | 1541 | `POST` | `/api/community-events/:id/rsvp` | `requireRole(['resident', 'secretary', 'admin', 'committee'])` | Protected by Global Auth | resident, secretary, admin, committee | None (Indirect) |
| 69 | 1556 | `GET` | `/api/emergency-incidents` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 70 | 1568 | `POST` | `/api/emergency-incidents` | `requireRole(['resident', 'guard', 'secretary', 'admin'])` | Protected by Global Auth | resident, guard, secretary, admin | None (Indirect) |
| 71 | 1580 | `PATCH` | `/api/emergency-incidents/:id/resolve` | `requireRole(['guard', 'secretary', 'admin'])` | Protected by Global Auth | guard, secretary, admin | None (Indirect) |
| 72 | 1598 | `GET` | `/api/notifications` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 73 | 1614 | `POST` | `/api/notifications` | `requireRole(['secretary', 'admin', 'guard', 'committee'])` | Protected by Global Auth | secretary, admin, guard, committee | None (Indirect) |
| 74 | 1626 | `PATCH` | `/api/notifications/:id/read` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 75 | 1640 | `GET` | `/api/audit-logs` | `requireRole(['secretary', 'admin', 'committee'])` | Protected by Global Auth | secretary, admin, committee | None (Indirect) |
| 76 | 1661 | `POST` | `/api/admin/provision-society` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 77 | 1670 | `POST` | `/api/secretary/provision-user` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 78 | 1687 | `POST` | `/api/auth/login` | None (Global Only) | Public (Allowlisted) | Public | issue02_privilege_escalation.test.ts<br>issue02_unified_auth_integration.test.ts |
| 79 | 1739 | `GET` | `/api/trust-score/:entityType/:entityId` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 80 | 1756 | `GET` | `/api/wallet/balance/:residentId` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 81 | 1767 | `POST` | `/api/wallet/transaction` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 82 | 1781 | `GET` | `/api/marketplace/federated-vendors` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 83 | 1793 | `POST` | `/api/ai/governance-check` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 84 | 1804 | `GET` | `/api/work-orders` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 85 | 1817 | `POST` | `/api/work-orders` | `requireRole(['facility_manager', 'secretary', 'admin'])` | Protected by Global Auth | facility_manager, secretary, admin | None (Indirect) |
| 86 | 1832 | `PATCH` | `/api/work-orders/:id` | `requireRole(['facility_manager', 'secretary', 'admin', 'vendor'])` | Protected by Global Auth | facility_manager, secretary, admin, vendor | None (Indirect) |
| 87 | 1847 | `GET` | `/api/attendance` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 88 | 1861 | `POST` | `/api/attendance/check-in` | `requireRole(['guard', 'facility_manager', 'secretary', 'admin'])` | Protected by Global Auth | guard, facility_manager, secretary, admin | None (Indirect) |
| 89 | 1877 | `GET` | `/api/compliance-documents` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 90 | 1890 | `POST` | `/api/compliance-documents` | `requireRole(['facility_manager', 'secretary', 'admin', 'committee'])` | Protected by Global Auth | facility_manager, secretary, admin, committee | None (Indirect) |
| 91 | 1900 | `PATCH` | `/api/compliance-documents/:id` | `requireRole(['facility_manager', 'secretary', 'admin', 'committee'])` | Protected by Global Auth | facility_manager, secretary, admin, committee | None (Indirect) |
| 92 | 1914 | `DELETE` | `/api/compliance-documents/:id` | `requireRole(['secretary', 'admin', 'committee'])` | Protected by Global Auth | secretary, admin, committee | None (Indirect) |
| 93 | 1926 | `GET` | `/api/move-requests` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 94 | 1939 | `POST` | `/api/move-requests` | `requireRole(['resident', 'secretary', 'admin'])` | Protected by Global Auth | resident, secretary, admin | None (Indirect) |
| 95 | 1949 | `PATCH` | `/api/move-requests/:id` | `requireRole(['secretary', 'admin', 'committee', 'guard'])` | Protected by Global Auth | secretary, admin, committee, guard | None (Indirect) |
| 96 | 1964 | `GET` | `/api/renovation-requests` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 97 | 1977 | `POST` | `/api/renovation-requests` | `requireRole(['resident', 'secretary', 'admin'])` | Protected by Global Auth | resident, secretary, admin | None (Indirect) |
| 98 | 1987 | `PATCH` | `/api/renovation-requests/:id` | `requireRole(['secretary', 'admin', 'committee'])` | Protected by Global Auth | secretary, admin, committee | None (Indirect) |
| 99 | 2002 | `GET` | `/api/facility/amc` | `requireRole(['facility_manager', 'secretary', 'admin', 'committee', 'vendor'])` | Protected by Global Auth | facility_manager, secretary, admin, committee, vendor | None (Indirect) |
| 100 | 2015 | `POST` | `/api/facility/amc` | `requireRole(['facility_manager', 'secretary', 'admin'])` | Protected by Global Auth | facility_manager, secretary, admin | None (Indirect) |
| 101 | 2033 | `PATCH` | `/api/facility/amc/:id` | `requireRole(['facility_manager', 'secretary', 'admin'])` | Protected by Global Auth | facility_manager, secretary, admin | None (Indirect) |
| 102 | 2050 | `GET` | `/api/children` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 103 | 2065 | `POST` | `/api/children` | `requireRole(['resident', 'secretary', 'admin'])` | Protected by Global Auth | resident, secretary, admin | None (Indirect) |
| 104 | 2091 | `GET` | `/api/children/passes` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 105 | 2105 | `POST` | `/api/children/passes` | `requireRole(['resident', 'secretary', 'admin'])` | Protected by Global Auth | resident, secretary, admin | None (Indirect) |
| 106 | 2133 | `POST` | `/api/children/passes/:id/verify` | `requireRole(['guard', 'secretary', 'admin'])` | Protected by Global Auth | guard, secretary, admin | None (Indirect) |
| 107 | 2157 | `POST` | `/api/children/sos` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 108 | 2181 | `GET` | `/api/parking/slots` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 109 | 2195 | `POST` | `/api/parking/slots` | `requireRole(['secretary', 'admin'])` | Protected by Global Auth | secretary, admin | None (Indirect) |
| 110 | 2215 | `POST` | `/api/parking/allocate` | `requireRole(['secretary', 'admin'])` | Protected by Global Auth | secretary, admin | None (Indirect) |
| 111 | 2232 | `GET` | `/api/parking/violations` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 112 | 2245 | `POST` | `/api/parking/violations` | `requireRole(['guard', 'secretary', 'admin'])` | Protected by Global Auth | guard, secretary, admin | None (Indirect) |
| 113 | 2275 | `GET` | `/api/guest-stay/rooms` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 114 | 2288 | `POST` | `/api/guest-stay/rooms` | `requireRole(['secretary', 'admin', 'facility_manager'])` | Protected by Global Auth | secretary, admin, facility_manager | None (Indirect) |
| 115 | 2303 | `GET` | `/api/guest-stay/reservations` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 116 | 2319 | `POST` | `/api/guest-stay/reservations` | `requireRole(['resident', 'secretary', 'admin'])` | Protected by Global Auth | resident, secretary, admin | None (Indirect) |
| 117 | 2344 | `GET` | `/api/housekeeping/garbage-logs` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 118 | 2357 | `POST` | `/api/housekeeping/garbage-logs/confirm` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 119 | 2374 | `POST` | `/api/housekeeping/garbage-logs/missed` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 120 | 2389 | `GET` | `/api/housekeeping/tasks` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 121 | 2402 | `PATCH` | `/api/housekeeping/tasks/:id` | `requireRole(['facility_manager', 'secretary', 'admin'])` | Protected by Global Auth | facility_manager, secretary, admin | None (Indirect) |
| 122 | 2422 | `GET` | `/api/facility/staff-shifts` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 123 | 2434 | `POST` | `/api/facility/staff-shifts` | `requireRole(['facility_manager', 'secretary', 'admin'])` | Protected by Global Auth | facility_manager, secretary, admin | None (Indirect) |
| 124 | 2454 | `GET` | `/api/facility/staff-attendance` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 125 | 2468 | `POST` | `/api/facility/staff-attendance/check-in` | `requireRole(['guard', 'facility_manager', 'secretary', 'admin'])` | Protected by Global Auth | guard, facility_manager, secretary, admin | None (Indirect) |
| 126 | 2492 | `POST` | `/api/upload` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 127 | 2561 | `POST` | `/api/payments/razorpay/create-order` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 128 | 2721 | `POST` | `/api/payments/razorpay/verify` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 129 | 2885 | `GET` | `/api/payments/status/:orderId` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 130 | 2923 | `POST` | `/api/payments/razorpay/refund` | `requireRole(['admin', 'secretary'])` | Protected by Global Auth | admin, secretary | None (Indirect) |
| 131 | 3019 | `GET` | `/api/payments` | None (Global Only) | Protected by Global Auth | Any Authenticated | issue02_privilege_escalation.test.ts<br>issue02_unified_auth_integration.test.ts |
| 132 | 3057 | `POST` | `/api/payments/razorpay/webhook` | None (Global Only) | Public (Allowlisted) | Public | issue02_privilege_escalation.test.ts<br>issue02_unified_auth_integration.test.ts |
| 133 | 3232 | `GET` | `/api/advertisements` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 134 | 3251 | `POST` | `/api/advertisements` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 135 | 3300 | `POST` | `/api/advertisements/:id/view` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 136 | 3312 | `POST` | `/api/advertisements/:id/click` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 137 | 3362 | `GET` | `/api/collections/:collection` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 138 | 3404 | `GET` | `/api/collections/:collection/:id` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 139 | 3423 | `POST` | `/api/collections/:collection` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 140 | 3447 | `PUT` | `/api/collections/:collection/:id` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 141 | 3475 | `DELETE` | `/api/collections/:collection/:id` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 142 | 3488 | `POST` | `/api/:table/query` | None (Global Only) | Protected by Global Auth | Any Authenticated | None (Indirect) |
| 143 | 3525 | `GET` | `*` | None (Global Only) | SPA Fallback | Any Authenticated | issue02_privilege_escalation.test.ts<br>razorpay.test.ts<br>route_protection.test.ts |

---

## 4. Middleware Execution Order Verification

1. `app.use(cors())` (Line 33)
2. `app.use(express.json({ verify }))` (Line 34) — Raw body buffer captured as `req.rawBody` for webhook HMAC verification.
3. `app.use(express.urlencoded({ extended: true }))` (Line 42)
4. `app.use('/uploads', express.static(uploadsDir))` (Line 49) — Static file uploads served before authentication.
5. `app.use(rateLimiter(200, 60000))` (Line 52) — Sliding window rate limiter.
6. `app.use('/api', ...)` (Line 73) — **Global Authentication Gateway**. Executes `isPublicApiRoute`. If false, executes `authenticateToken`.
7. `app.use((req, res, next) => { ... })` (Line 83) — Synchronizes `req.societyId`, `req.userId`, `req.userRole` strictly from `req.authContext`.
8. Application Route Handlers (Lines 102 - 3519)
9. `app.use(express.static(clientDistPath))` (Line 3523) — Static production assets.
10. `app.get('*', ...)` (Line 3525) — Catch-all router. If `req.path.startsWith('/api')`, returns 404 (or 401 if unauthenticated); otherwise serves `index.html`.
