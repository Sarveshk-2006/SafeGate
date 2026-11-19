# AARIZO — ISSUE-03 Storage & Direct API Fetch Comprehensive Audit

**Date:** November 14, 2026  
**Auditor:** Principal Software Architect & Security Lead  
**Scope:** Client-side storage keys (`localStorage`, `sessionStorage`) & direct `fetch()` calls across `d:\AAZIRA\AARIZO\src`  
**Target Issue:** ISSUE-03 (P1: Authentication Storage Key Mismatch & Session Consistency)

---

## 1. Executive Summary

During the Phase A, Step 2 independent security gate, two related client-side authentication vulnerabilities were discovered:
1. **Authentication Storage Key Mismatch & Cold-Launch Inconsistency**: The application exhibited fragmented storage key usage across historical brands (`dwellora_user`, `dwellora_token`, `communityos_auth_user`, `aarizo_user`, `aarizo_token`). Critically, `AuthContext.tsx` on initial boot evaluated authentication status solely based on the presence of `dwellora_user` in `localStorage`, treating a cached profile as proof of active authentication even when the Bearer token had expired, been cleared, or never existed.
2. **Direct Unauthenticated API Invocations**: Repositories (`BaseRepository`, `PaymentRepository`, `AdvertisementRepository`, `VendorRepository`) and services (`amenityService`, `RazorpayService`, `realtimeService`, `postgres.ts`) made raw `window.fetch()` calls to protected `/api/...` endpoints without attaching the authoritative `Authorization: Bearer <token>` header, leading to HTTP 401 failures after backend authentication was hardened in Step 2.2.

This document records the exhaustive audit of all 310 client-side storage references and 24 direct network fetch invocations.

---

## 2. Comprehensive Client-Side Storage Inventory

### 2.1 Authentication & Session Keys

| Storage Key | Storage Engine | Historical Origin | Purpose | Writers | Readers | Cleanup Trigger | Assessment & Action |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `aarizo_user` | `localStorage` | Canonical (AARIZO) | Stored `UserProfile` object | `authStorage.saveAuthSession`, `AuthContext` | `authStorage.getStoredUser`, `BaseRepository`, `apiClient` | `authStorage.clearAuthSession`, `logout` | **Canonical.** Kept as authoritative user profile storage key. |
| `aarizo_token` | `localStorage` | Canonical (AARIZO) | Cryptographically signed Bearer JWT or Firebase ID token | `authStorage.saveAuthSession`, `AuthContext` | `authStorage.getAuthToken`, `apiClient`, `authenticatedFetch` | `authStorage.clearAuthSession`, `logout`, HTTP 401 | **Canonical.** Kept as authoritative token key. |
| `aarizo_active_session` | `sessionStorage` | Canonical (AARIZO) | Active tab session lifecycle flag | `authStorage.saveAuthSession`, `AuthContext` | `authStorage.isSessionValid`, `sessionRouteTracker` | Tab close, `clearAuthSession`, `logout`, HTTP 401 | **Canonical.** Required flag preventing cold-launch profile elevation. |
| `aarizo_last_route` | `sessionStorage` | Canonical (AARIZO) | Validated restorable navigation route | `sessionRouteTracker.trackActiveRoute` | `sessionRouteTracker.getRestoredOrRoleDefaultRoute` | Tab close, `clearAuthSession`, `logout` | **Canonical.** Safely restores active route on page refresh. |
| `aarizo_last_role` | `sessionStorage` | Canonical (AARIZO) | Last active role in session | `sessionRouteTracker`, `saveAuthSession` | `sessionRouteTracker`, `AuthContext` | Tab close, `clearAuthSession`, `logout` | **Canonical.** Enforces role-route consistency. |
| `aarizo_auth_provider` | `localStorage` | Canonical (AARIZO) | Authentication mechanism (`password`, `firebase`, `mock`) | `authStorage.saveAuthSession` | `authStorage`, debugging tools | `authStorage.clearAuthSession`, `logout` | **Canonical.** Tracks active credential source. |
| `aarizo_onboarding_completed` | `localStorage` | Canonical (AARIZO) | User onboarding walkthrough completed flag | `AuthContext.completeOnboarding` | `AuthContext` initial state | User account reset | **Canonical.** Controls first-time user tour. |
| `dwellora_user` | `localStorage` | Legacy (Dwellora) | Old cached user profile | Legacy code paths | Legacy code paths | Cold launch, `clearAuthSession` | **Obsolete / Migrated.** Transparently migrated to `aarizo_user` then purged. |
| `dwellora_token` | `localStorage` / `sessionStorage` | Legacy (Dwellora) | Old cached access token | Legacy code paths | Legacy code paths | Cold launch, `clearAuthSession` | **Obsolete / Migrated.** Transparently migrated to `aarizo_token` then purged. |
| `dwellora_active_session` | `sessionStorage` | Legacy (Dwellora) | Old session active flag | Legacy code paths | Legacy code paths | Tab close, `clearAuthSession` | **Obsolete / Migrated.** Purged on session save/clear. |
| `dwellora_last_route` | `sessionStorage` | Legacy (Dwellora) | Old route restoration | Legacy code paths | Legacy code paths | Tab close, `clearAuthSession` | **Obsolete / Migrated.** Purged on session save/clear. |
| `dwellora_last_role` | `sessionStorage` | Legacy (Dwellora) | Old role tracking | Legacy code paths | Legacy code paths | Tab close, `clearAuthSession` | **Obsolete / Migrated.** Purged on session save/clear. |
| `dwellora_onboarding_completed` | `localStorage` | Legacy (Dwellora) | Old onboarding flag | Legacy code paths | `AuthContext` fallback | User account reset | **Obsolete / Migrated.** Supported for backward compatibility. |
| `communityos_auth_user` | `localStorage` | Legacy (CommunityOS) | Early prototype user profile | Prototype code | Legacy fallbacks | `clearAuthSession` | **Obsolete.** Purged on any auth session interaction. |

---

### 2.2 Domain Feature Storage Keys (Non-Authentication)

The audit cataloged 18 non-authentication storage keys used for offline/local state caching. These keys operate independently of authentication tokens and are preserved to maintain offline-first UX:
- `communityos_amenities`, `communityos_amenity_bookings`, `communityos_announcements`, `communityos_events`, `communityos_polls`, `communityos_posts` (`src/services/amenityService.ts`)
- `dwellora_committee_members` (`src/mockData/committee/mockCommittee.ts`)
- `aarizo_theme_mode`, `aarizo_locale` (UI personalization)

---

## 3. Direct API Fetch Audit (`window.fetch` Bypasses)

Prior to Step 3.1, multiple service modules and repository classes made direct HTTP requests using native `fetch()` without invoking `apiClient.ts` or attaching the Bearer authentication header. Because Step 2.2 secured all backend routes behind strict HMAC-SHA256 Bearer verification, these requests were vulnerable to immediate HTTP 401 rejection:

| File Path | Function / Method | Endpoint Invoked | Pre-Hardening Header Status | Vulnerability / Risk | Remediation Applied |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `src/repositories/BaseRepository.ts` | `create()` | `POST /api/collections/:name` | `Content-Type`, `x-society-id` | HTTP 401 (Missing Bearer Token) | Replaced with `authenticatedFetch()` |
| `src/repositories/BaseRepository.ts` | `getById()` | `GET /api/collections/:name/:id` | None | HTTP 401 (Missing Bearer Token) | Replaced with `authenticatedFetch()` |
| `src/repositories/BaseRepository.ts` | `update()` | `PUT /api/collections/:name/:id` | `Content-Type` only | HTTP 401 (Missing Bearer Token) | Replaced with `authenticatedFetch()` |
| `src/repositories/BaseRepository.ts` | `delete()` | `DELETE /api/collections/:name/:id` | None | HTTP 401 (Missing Bearer Token) | Replaced with `authenticatedFetch()` |
| `src/repositories/BaseRepository.ts` | `upsertWithId()` | `PUT /api/collections/:name/:id` | `Content-Type` only | HTTP 401 (Missing Bearer Token) | Replaced with `authenticatedFetch()` |
| `src/repositories/BaseRepository.ts` | `listAll()` | `GET /api/collections/:name` | None | HTTP 401 (Missing Bearer Token) | Replaced with `authenticatedFetch()` |
| `src/repositories/BaseRepository.ts` | `list()` | `GET /api/collections/:name?societyId=...` | `x-society-id` only | HTTP 401 (Missing Bearer Token) | Replaced with `authenticatedFetch()` |
| `src/repositories/advertisements/AdvertisementRepository.ts` | `recordImpression()` | `POST /api/advertisements/:id/view` | None | HTTP 401 (Missing Bearer Token) | Replaced with `authenticatedFetch()` |
| `src/repositories/advertisements/AdvertisementRepository.ts` | `recordClick()` | `POST /api/advertisements/:id/click` | None | HTTP 401 (Missing Bearer Token) | Replaced with `authenticatedFetch()` |
| `src/repositories/payments/PaymentRepository.ts` | `listBySociety()` | `GET /api/payments?societyId=...` | None | HTTP 401 (Missing Bearer Token) | Replaced with `authenticatedFetch()` |
| `src/repositories/payments/PaymentRepository.ts` | `listByResident()` | `GET /api/payments?residentId=...` | None | HTTP 401 (Missing Bearer Token) | Replaced with `authenticatedFetch()` |
| `src/repositories/payments/PaymentRepository.ts` | `subscribeByInvoice()` | `GET /api/payments?invoiceId=...` | None | HTTP 401 (Missing Bearer Token) | Replaced with `authenticatedFetch()` |
| `src/repositories/payments/PaymentRepository.ts` | `subscribePayment()` | `GET /api/collections/payments/:id` | None | HTTP 401 (Missing Bearer Token) | Replaced with `authenticatedFetch()` |
| `src/repositories/vendors/VendorRepository.ts` | `getVendorByUid()` | `GET /api/collections/vendors/:id` | None | HTTP 401 (Missing Bearer Token) | Replaced with `authenticatedFetch()` |
| `src/services/amenityService.ts` | `getAmenityAvailability()` | `GET /api/amenities/:id/availability` | None | HTTP 401 (Missing Bearer Token) | Replaced with `authenticatedFetch()` |
| `src/services/amenityService.ts` | `bookAmenity()` | `POST /api/amenities/:id/book` | `Content-Type` only | HTTP 401 (Missing Bearer Token) | Replaced with `authenticatedFetch()` |
| `src/services/amenityService.ts` | `updateBookingStatus()` | `POST /api/amenities/bookings/:id/cancel` | `Content-Type` only | HTTP 401 (Missing Bearer Token) | Replaced with `authenticatedFetch()` |
| `src/services/payment/RazorpayService.ts` | `refundPayment()` | `POST /api/payments/razorpay/refund` | `Content-Type` only | HTTP 401 (Missing Bearer Token) | Replaced with `authenticatedFetch()` |
| `src/services/realtimeService.ts` | `publish()` | `POST /api/realtime/broadcast` | `Content-Type` only | HTTP 401 (Missing Bearer Token) | Replaced with `authenticatedFetch()` |
| `src/lib/postgres.ts` | `query()`, `insert()`, `update()`, `delete()` | `POST/PATCH/DELETE /api/:table` | Raw client headers | HTTP 401 (Missing Bearer Token) | Replaced with `authenticatedFetch()` |

---

## 4. Root Cause Analysis of Session Inconsistencies

1. **Brand Migration Residue**: During the project's transition from Dwellora / CommunityOS to AARIZO, storage write operations began using `aarizo_user` and `aarizo_token`, while reading operations and cold-launch checks in `AuthContext.tsx` still checked `dwellora_user` and `dwellora_token`.
2. **Cold Launch Disconnect**: In `AuthContext.tsx`:
   ```typescript
   // Flawed pre-hardening logic:
   const [status, setStatus] = useState<AuthStatus>(() => {
     const savedUser = localStorage.getItem('dwellora_user');
     return savedUser ? 'AUTHENTICATED' : 'UNAUTHENTICATED';
   });
   ```
   This permitted any user with a stale profile in `localStorage` to be treated as `AUTHENTICATED` upon cold boot, even when no cryptographic Bearer token existed. The app would load the dashboard, make API calls, encounter 401 errors, and experience uncoordinated UI failures.
3. **Decoupled Fetch Calls**: Individual feature repositories bypassed the centralized `apiClient.ts` to implement custom REST calls, omitting standard headers and authentication tokens.

---

## 5. Architectural Corrective Actions

1. **Centralized Authentication Storage Service (`src/services/authStorage.ts`)**: Single source of truth defining canonical keys, transparent migration for legacy keys, authoritative session validation (`isSessionValid`), and clean teardown (`clearAuthSession`).
2. **Unified Authenticated Fetch Wrapper (`authenticatedFetch`)**: Injects Bearer tokens and tenant context headers automatically, catches HTTP 401 Unauthorized responses, clears stale sessions, and broadcasts the `'aarizo:unauthorized'` event.
3. **Elimination of Orphaned Tokens/Profiles**: `clearAuthSession()` removes both canonical and legacy keys across `localStorage` and `sessionStorage`.
4. **Authoritative Session Guard**: In `AuthContext.tsx`, `isSessionValid()` strictly enforces:
   $$\text{Session Valid} = (\text{Active Flag} = \text{true}) \land (\text{Bearer Token} \neq \emptyset) \land (\text{User Profile} \neq \emptyset)$$
   A stored user profile alone is **never** accepted as proof of authentication.

