# AARIZO — ISSUE-06 — PHASE B.2 — STEP 2.3 — PHASE 4.6.8
# FINAL PRODUCTION READINESS, DEPLOYMENT VALIDATION & CLIENT HANDOFF
## DELIVERABLE 3: ENVIRONMENT CONFIGURATION & SECRETS AUDIT GUIDE

---

## 1. Overview & Security Policy

This guide provides the authoritative inventory and security specification for all configuration parameters, environment variables, and cryptographic secrets across the AARIZO platform.

### Security Principles Enforced:
1. **Strict Separation of Concerns:** Server secrets (database connection strings, signing keys, private service accounts) are never exposed to the frontend browser or bundled into client code.
2. **Fail-Closed Boot Validation:** The application performs startup validation on critical environment variables and aborts immediately if production invariants are violated.
3. **Zero Hardcoded Secrets in Production:** Production environments require explicit, high-entropy secrets passed via environment variables or secret managers.
4. **Credential Redaction in Logs:** All database URLs, Bearer tokens, and password payloads are intercepted and redacted before printing to application logs or diagnostics.

---

## 2. Master Environment Variables Specification

The table below catalogs every variable utilized by the platform, its scope, validation behavior, and production requirements:

| Variable Name | Scope | Required in Prod? | Applicability | Safe Example Format (No Real Secrets) | Validation & Fail-Closed Behavior |
|---|---|---|---|---|---|
| **`NODE_ENV`** | Server & Build | **Required** | All | `production` | Determines security mode. When set to `production`, triggers strict secret length checks and disables mock auth. |
| **`PORT`** | Server | Optional | All | `5000` | Port for Express listener. Defaults to `5000` if omitted. |
| **`DATABASE_URL`** | Server-Only | **Mandatory** | All | `postgresql://user:pass@host:5432/db?sslmode=require&schema=public` | Validated by `assertDatabaseConfiguration()`. Must match `postgresql://` scheme and have valid host; crashes on boot if invalid. |
| **`AUTH_SECRET`** | Server-Only | **Mandatory** | Prod / Staging | `c4b7e8f192a3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b` | Validated by `validateAuthConfiguration()`. In production, must be >= 32 chars. If missing or short, process aborts on startup. |
| **`JWT_SECRET`** | Server-Only | Optional | All | Same as `AUTH_SECRET` | Backward-compatible alias for `AUTH_SECRET`. Used if `AUTH_SECRET` is unset. |
| **`ENABLE_DEV_MOCK_AUTH`** | Server-Only | Forbidden in Prod | Dev / Test | `false` | Evaluated by `isMockAuthEnabled()`. Unconditionally returns `false` if `NODE_ENV=production`. Only active in dev/test if set to `'true'`. |
| **`FIREBASE_PROJECT_ID`** | Server-Only | Recommended | Prod / Staging | `aarizo-community-prod` | Identifies Firebase project for Admin SDK token verification. Defaults to fallback string if omitted. |
| **`FIREBASE_SERVICE_ACCOUNT_KEY`**| Server-Only | Recommended | Prod / Staging | `{"type":"service_account","project_id":"...","private_key":"..."}` | JSON string or path to JSON file for service account credentials. If omitted, uses Application Default Credentials. |
| **`RAZORPAY_KEY_ID`** | Server-Only | Optional | Payment Prod | `rzp_live_PLACEHOLDER_KEY_ID` | Server-side Razorpay key for creating payment orders. |
| **`RAZORPAY_KEY_SECRET`** | Server-Only | Optional | Payment Prod | `PLACEHOLDER_RAZORPAY_SECRET` | Server-side secret for verifying Razorpay HMAC payment signatures. |
| **`RAZORPAY_WEBHOOK_SECRET`** | Server-Only | Optional | Payment Prod | `PLACEHOLDER_WEBHOOK_SECRET` | Verifies incoming Razorpay webhook signatures. |
| **`VITE_BACKEND_URL`** | Frontend-Visible| Optional | Frontend | `https://api.aarizo.example.com` | Base URL for REST API requests. If empty, defaults to same-origin relative paths (`/api`). |
| **`VITE_FIREBASE_API_KEY`** | Frontend-Visible| **Required** | Frontend | `AIzaSy_PLACEHOLDER_API_KEY` | Public Firebase Web SDK API key. Safe for browser exposure. |
| **`VITE_FIREBASE_AUTH_DOMAIN`**| Frontend-Visible| **Required** | Frontend | `aarizo-prod.firebaseapp.com` | Public Firebase Auth domain for OAuth and phone verification. |
| **`VITE_FIREBASE_PROJECT_ID`** | Frontend-Visible| **Required** | Frontend | `aarizo-prod` | Public Firebase project identifier. |
| **`VITE_FIREBASE_STORAGE_BUCKET`**| Frontend-Visible| Optional | Frontend | `aarizo-prod.firebasestorage.app` | Public Firebase storage bucket URL. |
| **`VITE_FIREBASE_MESSAGING_SENDER_ID`**| Frontend-Visible| Optional | Frontend | `123456789012` | Public FCM sender ID for browser push notifications. |
| **`VITE_FIREBASE_APP_ID`** | Frontend-Visible| **Required** | Frontend | `1:123456789012:web:abcdef123456` | Public Firebase Web App ID. |
| **`VITE_USE_FIREBASE_EMULATOR`**| Frontend-Visible| Optional | Dev Only | `false` | When `true`, connects to local Firebase Auth emulator. Must be `false` in production. |
| **`VITE_RAZORPAY_KEY_ID`** | Frontend-Visible| Optional | Frontend | `rzp_live_PLACEHOLDER_KEY_ID` | Public Razorpay Key ID used by the client-side checkout modal. |
| **`VITE_PUBLIC_LOGO_URL`** | Frontend-Visible| Optional | Frontend | `https://assets.aarizo.com/logo.png` | Public HTTPS URL for society or platform branding in payment modal. |

---

## 3. Cryptographic Secret Generation Standards

### 3.1 Production `AUTH_SECRET` Generation
The `AUTH_SECRET` is used to sign and verify HMAC-SHA256 session tokens and gate pass digests. It must be generated using a cryptographically secure pseudorandom number generator (CSPRNG).

Execute the following command in a secure terminal:
```bash
# Generates 256 bits (32 bytes) of entropy formatted as a 64-character hexadecimal string
openssl rand -hex 32
```
*Requirements:*
- Minimum length: 32 characters (64 hex characters recommended).
- Never share, commit, or email this secret.
- Store exclusively in client-managed secret vaults (AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault, or encrypted container environment files).

### 3.2 Firebase Service Account Protection
1. Download the private key JSON file from the Firebase Console:
   *Project Settings -> Service Accounts -> Generate New Private Key*.
2. Store the JSON content in a secret manager or as a protected file with `0600` permissions on the host:
   ```bash
   chmod 600 /etc/aarizo/firebase-service-account.json
   ```
3. Set the environment variable:
   ```ini
   FIREBASE_SERVICE_ACCOUNT_KEY=/etc/aarizo/firebase-service-account.json
   ```

---

## 4. Static Bundle Secret Exposure Verification

Vite bundles client code into static JavaScript files. Vite enforces a strict compile-time isolation rule: only environment variables explicitly prefixed with `VITE_` are exposed to the client bundle.

A comprehensive static scan across the production build (`dist/assets/index-*.js`) verified:
- **Zero Database URLs:** `postgresql://` strings do not exist in the client bundle.
- **Zero Server Secrets:** `AUTH_SECRET`, `JWT_SECRET`, and `RAZORPAY_KEY_SECRET` are completely absent from client bundles.
- **Zero Private Keys:** No PEM or RSA private keys are present.

---

## 5. Safe Production Environment Template

Save the following template as `/etc/aarizo/production.env` (never commit to Git):

```ini
# ==============================================================================
# AARIZO CommunityOS — Production Environment Configuration
# ==============================================================================

# 1. CORE SERVER RUNTIME
NODE_ENV=production
PORT=5000

# 2. MANAGED POSTGRESQL CONNECTION (SSL Required)
# Format: postgresql://[user]:[password]@[host]:5432/[dbname]?sslmode=require&schema=public
DATABASE_URL=postgresql://aarizo_admin:REPLACE_WITH_STRONG_DB_PASSWORD@pg-cluster.internal.example.com:5432/aarizo_community?sslmode=require&schema=public

# 3. AUTHENTICATION ENGINE (Mandatory >= 32 characters)
# Generate with: openssl rand -hex 32
AUTH_SECRET=REPLACE_WITH_OPENSSL_GENERATED_64_CHAR_HEX_STRING

# 4. SECURITY GUARDS (Must be explicitly false)
ENABLE_DEV_MOCK_AUTH=false

# 5. FIREBASE ADMIN CONFIGURATION
FIREBASE_PROJECT_ID=aarizo-client-production
FIREBASE_SERVICE_ACCOUNT_KEY=/etc/aarizo/firebase-service-account.json

# 6. PAYMENT GATEWAY CREDENTIALS (Optional)
RAZORPAY_KEY_ID=rzp_live_CLIENT_KEY_ID
RAZORPAY_KEY_SECRET=CLIENT_SECRET_KEY
RAZORPAY_WEBHOOK_SECRET=CLIENT_WEBHOOK_SECRET
```
