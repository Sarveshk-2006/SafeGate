# AARIZO / Dwellora — Phase 4.8
# Email Invitation & Delivery System Audit

**Document Date:** November 19, 2026  
**Auditor:** Principal Backend & Email Infrastructure Architect  
**Scope:** Transactional Email Infrastructure, Provider Abstraction, Invitation Token Security & Resend Policies  

---

## 1. Executive Summary

A forensic review of the Dwellora codebase reveals that no transactional email system or invitation lifecycle currently exists:
- `package.json` and `server/package.json` contain no email transport packages (`nodemailer`, `@sendgrid/mail`, `resend`, etc.).
- The database schema (`server/prisma/schema.prisma` and `scripts/postgres/01_schema.sql`) contains no tables or records for invitations or account activation tokens.
- In `UniversalProvisioningService.provisionUser()`, new residents are immediately provisioned with `status: 'ACTIVE'` and require the administrator to manually specify or generate a plaintext password upfront.
- `ResidentManagementPage.tsx` provides no controls to issue invitations, track delivery, monitor activation states, or handle token revocation.

To support real residential community onboarding, an authoritative Invitation and Account Activation system must be implemented. This report outlines the necessary email provider abstraction, cryptographically secure token lifecycle, and administrative management workflows.

---

## 2. Email Provider Integration Strategy

The email subsystem must support production transactional delivery while maintaining resilience during local development and automated testing:

```
                               ┌─────────────────────────────────────────┐
                               │           EmailService Interface        │
                               │ `sendInvitationEmail(opts)`             │
                               │ `sendPasswordResetEmail(opts)`          │
                               └────────────────────┬────────────────────┘
                                                    │
                 ┌──────────────────────────────────┼──────────────────────────────────┐
                 ▼                                  ▼                                  ▼
   ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐
   │      Resend Provider      │      │       SMTP Provider       │      │   Console / Test Mock     │
   │ - Native HTTPS Fetch      │      │ - Standard SMTP Client    │      │ - Captures payload in mem │
   │ - Zero extra npm modules  │      │ - Corporate mail relays   │      │ - Inspectable by tests    │
   │ - `RESEND_API_KEY`        │      │ - `SMTP_HOST`, `SMTP_PASS`│      │ - Zero external dependencies│
   └───────────────────────────┘      └───────────────────────────┘      └───────────────────────────┘
```

### 2.1 Provider Selection & Zero-Dependency Transport
- Node.js 18+ provides native `fetch`. The Resend API (`https://api.resend.com/emails`) can be driven via native HTTPS without introducing bloated external dependencies.
- A standardized `EmailProvider` interface will decouple the application logic from the transport:
  ```typescript
  export interface EmailMessage {
    to: string;
    from: string;
    subject: string;
    html: string;
    text: string;
  }
  ```
- **Fallback & Development Behavior**: If no API key is configured (or in test environments), the service logs the email content to server diagnostics and stores it in an in-memory test mailbox, preventing deployment blockers while ensuring transparent failure reporting.

---

## 3. Cryptographic Invitation Token Lifecycle

```
┌────────────────────────────────────────────────────────────────────────┐
│                      INVITATION TOKEN LIFECYCLE                        │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Generation:                                                         │
│    `rawToken = crypto.randomBytes(32).toString('hex')` (256 bits)       │
│                                                                        │
│ 2. Storage:                                                            │
│    `tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')`
│    *Only tokenHash is persisted to PostgreSQL. Raw token is never stored.* │
│                                                                        │
│ 3. Dispatch:                                                           │
│    Email sent with link: `${FRONTEND_URL}/activate?token=${rawToken}`   │
│                                                                        │
│ 4. Verification:                                                       │
│    Client sends rawToken -> Server hashes rawToken -> Queries DB       │
│    Checks: status === 'PENDING' && expiresAt > now                     │
│                                                                        │
│ 5. Atomic Redemption:                                                  │
│    Password provided -> Hashed via Scrypt                              │
│    In single DB transaction:                                           │
│    - Invitation status -> 'ACCEPTED', acceptedAt = now                 │
│    - User record created/activated with Scrypt hash                    │
│    - Resident record linked to userId, isVerified = true               │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Security Invariants
- **High-Entropy Token:** 256 bits of CSPRNG entropy from `crypto.randomBytes(32)`.
- **Hash-Only Storage:** Protection against database leaks; an attacker with database read access cannot forge activation links.
- **Atomic One-Time Use:** Database transaction uses optimistic concurrency / row locking to prevent race conditions and token replay.
- **Configurable Expiry:** Default 7 days (168 hours). Expired invitations reject activation and notify the user to request a fresh invitation from their society office.
- **Resend Invalidation:** Generating a new invitation token automatically marks any existing pending tokens for that email as superseded.

---

## 4. Dwellora-Branded Invitation Email Template

The invitation email must reinforce trust and community legitimacy:
- **Sender:** `Dwellora Community <invites@dwellora.app>` (or configured `EMAIL_FROM`).
- **Subject:** `Welcome to [Society Name] on Dwellora — Activate Your Account`
- **Branding:** Dwellora Coral (`#F06543`), Deep Navy (`#083B56`), Warm Off-White surface (`#FAF6F0`).
- **Content:**
  - Personalized greeting to the resident.
  - Society name and allocated flat/unit number.
  - Primary CTA button: **"Activate Your Account & Set Password"**.
  - Security warning: Links expire in 7 days; Dwellora administrators will never ask for your password.
  - Fallback plain text URL for accessibility.

---

## 5. Administrative Workflow & Status Matrix

In `ResidentManagementPage.tsx`, residents will display real-time invitation badges:

| Status Badge | Semantic Meaning | Available Secretary Actions |
| :--- | :--- | :--- |
| **NOT_INVITED** | Resident record created without account activation link | `Send Invitation` |
| **INVITED / PENDING** | Activation link sent; awaiting resident password creation | `Resend Invitation`, `Revoke Invitation` |
| **ACTIVATED** | Account activated; resident can log in with email/password | `Reset Password`, `View Account` |
| **EXPIRED** | 7-day token window expired without activation | `Resend Invitation` |
| **REVOKED** | Cancelled by secretary before redemption | `Re-Invite Resident` |
| **DELIVERY_FAILED** | Email provider rejected recipient address or bounced | `Retry Delivery`, `Edit Email` |

---

## 6. Action Items for Implementation Phase

1. **Email Provider Module (`server/src/services/emailService.ts`):** Implement zero-dependency HTTP client for Resend/SMTP/Mock.
2. **Invitation Service (`server/src/services/invitationService.ts`):** Token generation, SHA-256 hashing, verification, and atomic consumption.
3. **Invitation API Routes (`server/src/index.ts`):**
   - `POST /api/secretary/residents/:id/invite`
   - `POST /api/secretary/residents/:id/resend-invite`
   - `POST /api/secretary/residents/:id/revoke-invite`
   - `GET /api/auth/invitation/verify`
   - `POST /api/auth/invitation/accept`
4. **Admin UI Updates (`ResidentManagementPage.tsx`):** Add invitation status column and action dropdown.

