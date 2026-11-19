# AARIZO / Dwellora — Phase 4.8
# Landing Page & Initial Experience Forensic Audit

**Document Date:** November 19, 2026  
**Auditor:** Principal Product UI Engineer & Frontend Architect  
**Scope:** Landing Page Restoration, Onboarding Carousel, Asset Audit & Startup Lifecycle  
**Target Flow:** Application Startup (`SplashScreen`) → Landing Page (Three-Image Carousel) → Login / Account Activation  

---

## 1. Executive Summary

This audit establishes the exact state of the Dwellora landing experience, carousel architecture, and image assets. 
During earlier refactoring cycles (commit `d8afcd2`), prototype directories and reference folders were pruned, causing the canonical 3D illustration assets to be unlinked. Consequently, `src/components/auth/onboarding/OnboardingFlow.tsx` substituted remote Unsplash photography placeholders, while `src/routes/index.tsx` bypassed the landing page entirely by routing unauthenticated root visits (`/`) straight to `/login`.

This audit details:
1. The exact location and restoration of the original three high-resolution 3D illustration assets.
2. The root cause analysis of why the landing page was inaccessible.
3. The functional gaps in the carousel (touch vs. desktop mouse drag, keyboard navigation, call-to-action entry points).
4. The required loading → landing → authentication lifecycle.

---

## 2. Asset Forensic Inventory

The repository history was examined to identify the original landing page illustrations:

| Asset Name | Original Path (Commit `bf9d2b3`) | Restored Target Path | Format & Dimensions | Size | Content Theme |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Slide 1 Hero** | `mobile/communityos_mobile/assets/images/onboarding_visitor_management.png` | `src/assets/images/onboarding_visitor_management.png` | JPEG (JFIF), 1024x1024 | 704,736 B | Modern 3D isometric gatehouse, barrier arm, and security guard with digital tablet. |
| **Slide 2 Hero** | `mobile/communityos_mobile/assets/images/onboarding_community_services.png` | `src/assets/images/onboarding_community_services.png` | JPEG (JFIF), 1024x1024 | 716,794 B | Modern 3D clubhouse, resident community pavilion, pool, and amenity greenery. |
| **Slide 3 Hero** | `mobile/communityos_mobile/assets/images/onboarding_family_hub.png` | `src/assets/images/onboarding_family_hub.png` | JPEG (JFIF), 1024x1024 | 760,937 B | Modern 3D family with child, shield security emblem, vehicle parking, and emergency beacon. |

### Additional Historical Reference Assets:
- `references/onboarding-01.png`, `02.png`, `03.png`: 437x815 UI mobile screen captures from initial design feedback verifying exact layout, floating pill positions, and typography.
- `screenshots/phase-3a/onboarding-01.png`: Pre-release visual regression screenshots.

**Conclusion:** The three canonical 1024x1024 3D illustrations exist in git commit `bf9d2b3a19ba76a1642678677ca7bfadefd0afd4` and have been restored to `src/assets/images/`. No stock or synthetic replacement is necessary.

---

## 3. Component & Routing Architecture Audit

### 3.1 Existing Components
1. **`src/components/common/SplashScreen.tsx`:**
   - **Visuals:** Warm off-white background (`#F7FBFE`), Coral `#F06543` gradient logo badge with `ShieldCheck` icon, `Dwellora` wordmark, and 3-dot pulsing loader.
   - **Timing:** 1.75 seconds minimum duration with a 280ms smooth fade-out exit transition.
   - **Status:** Fully functional, verified in native Android and web viewports. Supports `prefers-reduced-motion`.

2. **`src/components/auth/onboarding/OnboardingFlow.tsx`:**
   - **Visuals:** Warm organic background SVGs (`#FAF6F0`, `#F5EBE0`), 2-tone typography (`#083B56` navy + `#F06543` coral), floating glassmorphic feature badges, and smooth pagination track.
   - **Touch Navigation:** Supports touch drag on mobile with horizontal vector locking (`Math.abs(deltaX) > deltaY`).
   - **Deficiencies:**
     - Remote Unsplash image URLs instead of local original assets.
     - Lacks desktop mouse drag or hover controls.
     - Lacks keyboard arrow navigation (`ArrowLeft`, `ArrowRight`).
     - Lacks a direct "Login" button and "Activate Account" entry point.
     - Slide 3 only offered a generic "Get Started" navigating to demo login.

3. **`src/routes/index.tsx` (Route Redirection Defect):**
   ```tsx
   {/* Root Redirection */}
   <Route
     path="/"
     element={
       status === 'AUTHENTICATED' ? <Navigate to={getDefaultRoute()} replace /> : <Navigate to="/login" replace />
     }
   />
   ```
   **Defect:** Unauthenticated users hitting `/` were redirected straight to `<Navigate to="/login" replace />`. As a result, the landing page at `/onboarding` was orphaned and never visible to new visitors.

---

## 4. Required User Experience & Sequence

```
                                 ┌────────────────────────┐
                                 │     App Cold Launch    │
                                 └───────────┬────────────┘
                                             │
                                             ▼
                                 ┌────────────────────────┐
                                 │      SplashScreen      │
                                 │ (1.75s Branded Motion) │
                                 └───────────┬────────────┘
                                             │
                        ┌────────────────────┴────────────────────┐
                        ▼                                         ▼
            [Active Valid Session]                      [No Active Session]
                        │                                         │
                        ▼                                         ▼
             Restore Authorized Portal                 Landing Page (3 Slides)
             (/resident, /admin, etc.)                 (Three Original Images)
                                                                  │
                                               ┌──────────────────┴──────────────────┐
                                               ▼                                     ▼
                                      "Login" Action                        "Get Started" Action
                                             │                                       │
                                             ▼                                       ▼
                                       LoginPage.tsx                         Account Activation
                                   (Email/Password Login)                   (/activate or /login)
```

---

## 5. Slide Content & Design Token Alignment

| Slide | Eyebrow | Title Part 1 | Title Part 2 | Badges | Canonical Image Asset |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | `01 / 03` | `Smart Visitor ` | `Management` | • *Pre-approved Visitor* (Entry made easy)<br>• *Digital Gate Pass* (Secure & Contactless) | `onboarding_visitor_management.png` |
| **2** | `02 / 03` | `Community & Society ` | `Services` | • *Clubhouse Booking* (Amenities & Events)<br>• *Instant Dues* (Zero Hassle Payments) | `onboarding_community_services.png` |
| **3** | `03 / 03` | `Complete Family & ` | `Security Hub` | • *1-Tap Emergency SOS* (Instant Broadcast)<br>• *Staff & Vehicle Sync* (24/7 Gate Protection) | `onboarding_family_hub.png` |

---

## 6. Action Items for Implementation Phase

1. **Asset Integration:** Import the three restored local 1024x1024 images directly into `OnboardingFlow.tsx`.
2. **Carousel Controls Enhancement:**
   - Add desktop mouse drag interaction.
   - Add keyboard arrow key navigation.
   - Add left/right desktop arrow pills.
3. **Entry Points:**
   - Add "Log In" button in top-right header alongside "Skip".
   - On Slide 3, provide primary CTA "Get Started / Activate Account" leading to `/activate` or `/login`.
4. **Router Unification:**
   - Set `/` to display the Landing Page for unauthenticated users, or restore the portal for authenticated users.
   - Retain `/onboarding` as an explicit route for backwards compatibility.
