# AARIZO / Dwellora — Phase 4.8
# Implementation & Security Architecture Plan

**Document Date:** November 19, 2026  
**Auditor / Architect:** Principal Full-Stack Engineer, AppSec Lead & QA Specialist  
**Scope:** Execution Blueprint for Phases 1–10 (Landing Restoration, Invitations, Login & Tests)  
**Security Standard:** OWASP ASVS v4.0 & NIST SP 800-63B  

---

## 1. Executive Implementation Roadmap

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PHASE 4.8 EXECUTION PHASES                      │
├────────────────────────────────────────────────────────────────────────┤
│ Phase 1: Landing Page Restoration                                      │
│ - Import original 3D assets into OnboardingFlow.tsx                    │
│ - Add desktop mouse drag, keyboard arrows, and responsive controls     │
│ - Connect root route (/) to Landing Page for unauthenticated visitors  │
│ - Add explicit "Log In" and "Activate Account" entry points            │
├────────────────────────────────────────────────────────────────────────┤
│ Phase 2 & 3: Database & Invitation Infrastructure                     │
│ - Add `invitations` & `password_reset_tokens` tables to schema         │
│ - Implement `emailService.ts` (Resend HTTPS + SMTP + Test Mock)        │
│ - Implement `invitationService.ts` (256-bit CSPRNG token + SHA-256 hash│
│ - Implement backend invitation verification & atomic redemption        │
├────────────────────────────────────────────────────────────────────────┤
│ Phase 4: Production Email/Password Login Hardening                     │
│ - Remove demo role cards and hardcoded passwords from LoginScreen.tsx  │
│ - Connect directly to authoritative PostgreSQL backend authentication  │
│ - Guard development mock tokens behind strict non-production checks   │
├────────────────────────────────────────────────────────────────────────┤
│ Phase 5: Password Reset & Recovery Lifecycle                           │
│ - Implement `POST /api/auth/password-reset/request` (Anti-enumeration) │
│ - Implement `POST /api/auth/password-reset/confirm` (Scrypt rehash)    │
│ - Implement ForgotPasswordPage.tsx & ResetPasswordPage.tsx             │
├────────────────────────────────────────────────────────────────────────┤
│ Phase 6: Secretary Management UI Integration                           │
│ - Add invitation badges to ResidentManagementPage.tsx                  │
│ - Integrate Send, Resend, and Revoke action triggers                   │
├────────────────────────────────────────────────────────────────────────┤
│ Phase 7: Account Activation Frontend                                   │
│ - Implement AccountActivationPage.tsx (/activate?token=...)            │
│ - Real-time password strength validation & confirmation                │
├────────────────────────────────────────────────────────────────────────┤
│ Phase 8, 9 & 10: Environment Config, Security Audit & Full QA Suite    │
│ - Document environment variables                                       │
│ - Execute automated Jest unit & integration test suites                │
│ - Execute tsc -b and Vite production build                             │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Security Threat Model & Defense Invariants

| Threat / Vulnerability | Attack Vector | Security Countermeasure |
| :--- | :--- | :--- |
| **Token Theft via Database Leak** | Attacker dumps database and steals activation links | **Hash-Only Storage:** Only SHA-256 hash is persisted. Raw tokens exist only in transient memory during email generation. |
| **Account Enumeration (CWE-204)** | Probing login/reset endpoints to discover resident emails | **Unified Generic Responses:** Returns identical `Invalid email or password` or `If account exists, email has been sent`. |
| **Token Replay / Race Condition** | Concurrent redemption of invitation token | **Atomic DB Transaction:** State transitions to `ACCEPTED` in a single transaction with row locking. Subsequent requests fail with `INVITATION_ALREADY_USED`. |
| **Brute-Force Password Guessing** | High-velocity password guessing attacks | **Sliding Window Rate Limiting:** 10 requests/min per IP via `loginRateLimiter` with `Retry-After` header. |
| **Denial-of-Service via Scrypt RAM** | Flooding scrypt endpoints to exhaust server memory | **Bounded Concurrency Semaphore:** `authConcurrencyLimiter` bounds simultaneous scrypt operations to 4 (max 512 MiB total). |
| **Cross-Society Invitation Injection** | Malicious secretary attempting to invite users into another society | **Strict Tenant Isolation:** Backend verifies `req.authContext.societyId === targetSocietyId` from session token. |
| **Unauthorized Role Elevation** | Attacker manipulating request payload to invite an admin | **RBAC Enforcement:** Only Secretaries and Platform Admins can issue invitations; role defaults strictly to `resident`. |

---

## 3. Database Migration Strategy

The migration is **strictly additive**:
1. Add `model Invitation` and `model PasswordResetToken` to `server/prisma/schema.prisma`.
2. Add `CREATE TABLE IF NOT EXISTS invitations` and `CREATE TABLE IF NOT EXISTS password_reset_tokens` to `scripts/postgres/01_schema.sql`.
3. Run `npm run prisma:generate` to update `@prisma/client` types.
4. No destructive DDL (`ALTER`, `DROP`) is executed.

---

## 4. Environment Variables Specification

| Variable Name | Environment | Purpose | Default / Example |
| :--- | :--- | :--- | :--- |
| `FRONTEND_URL` | All | Base URL for invitation and reset links | `http://localhost:5173` (Dev) / `https://dwellora.app` (Prod) |
| `EMAIL_FROM` | Production | Sender address for transactional emails | `Dwellora Communities <invites@dwellora.app>` |
| `RESEND_API_KEY` | Production | Transactional email delivery API key | `re_...` |
| `SMTP_HOST` | Alternative | SMTP server hostname | `smtp.resend.com` |
| `SMTP_PORT` | Alternative | SMTP server port | `587` |
| `SMTP_USER` | Alternative | SMTP username | `resend` |
| `SMTP_PASS` | Alternative | SMTP password | `...` |
| `AUTH_SECRET` | Production | 256-bit secret for signing HMAC JWT tokens | At least 32 cryptographically random chars |
| `INVITATION_EXPIRY_HOURS`| All | TTL for invitation tokens | `168` (7 days) |
| `RESET_EXPIRY_HOURS` | All | TTL for password reset tokens | `1` (1 hour) |

---

## 5. Verification Gate & Acceptance Criteria

Phase 4.8 will be deemed complete and production ready upon satisfying:
1. **Landing Page:** 3 original 3D illustrations render smoothly with swipe/mouse drag, keyboard navigation, and dual entry points.
2. **Invitations:** Authorized secretary can invite residents, token is securely generated/hashed, activation email is dispatched, and first-time password creation successfully activates account.
3. **Login:** Activated residents can log in with email/password; demo role cards and mock shortcuts are eliminated from the production login view.
4. **Password Reset:** Secure reset token request, email delivery, and password update.
5. **Quality Gate:** `npm test` passes (all existing + new tests), `npx tsc -b` succeeds with 0 errors, and `npm run build` generates production bundle in under 2 seconds.
