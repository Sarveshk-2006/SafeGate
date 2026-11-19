# AARIZO — Phase A, Step 4.1: ISSUE-04 Environment Matrix & Configuration Specification

**Date:** 2026-11-14  
**Scope:** Frontend (Vite), Backend (Express + Prisma), Container (Docker Compose), Serverless (Cloud Functions)  
**Workspace:** `D:\AAZIRA\AARIZO`  

---

## 1. Master Environment Variables Matrix

The table below catalogs every environment variable referenced across the entire AARIZO repository, its consumption locations, runtime requirements, defaults, and security implications.

| Variable Name | Component / Scope | Consuming Files & Lines | Required? | Default / Fallback | Validated on Boot? | Present in `.env.example` | Present in `server/.env.example` | Present in `docker-compose.yml` | Security / Reliability Impact |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`DATABASE_URL`** | Backend (Prisma / Express) | [prisma/schema.prisma:3](file:///d:/AAZIRA/AARIZO/server/prisma/schema.prisma#L3)<br>[server/src/prisma.ts:8](file:///d:/AAZIRA/AARIZO/server/src/prisma.ts#L8) | **Mandatory** | None | **No (Delayed Runtime Failure)** | Yes (`dwellora_db`) | Yes (`dwellora_db`) | Yes (`aarizo_community`) | Critical. Without this, every database-backed route returns HTTP 500 and realtime outbox poller spins infinitely. |
| **`PORT`** | Backend (Express) | [server/src/index.ts:33](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L33) | Optional | `5000` | No | Yes (`5000`) | Yes (`5000`) | Yes (`5000`) | Low. Falls back cleanly to 5000. |
| **`NODE_ENV`** | Backend & Build | [server/src/auth.ts:68,92,106](file:///d:/AAZIRA/AARIZO/server/src/auth.ts#L68)<br>[server/src/index.ts:3526](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L3526)<br>[Dockerfile:23](file:///d:/AAZIRA/AARIZO/Dockerfile#L23) | Recommended | `undefined` (treated as non-prod) | Yes (for auth secret validation) | No | No | No (Set in Dockerfile) | High. Controls whether ephemeral dev secret is generated, whether mock auth is permitted, and whether detailed stack traces might leak. |
| **`AUTH_SECRET`** | Backend (Auth Engine) | [server/src/auth.ts:69,107](file:///d:/AAZIRA/AARIZO/server/src/auth.ts#L69) | **Mandatory in Production** | Ephemeral 32-byte hex in non-prod | **Yes (`validateAuthConfiguration`)** | **Missing** | **Missing** | **Missing** | Critical. If missing in production, server crashes at boot. If missing in Docker Compose, container exits with code 1. |
| **`JWT_SECRET`** | Backend (Auth Engine) | [server/src/auth.ts:69,107](file:///d:/AAZIRA/AARIZO/server/src/auth.ts#L69) | Optional (Alias for `AUTH_SECRET`) | None | Yes | **Missing** | **Missing** | **Missing** | Low. Serves as backward-compatible fallback for `AUTH_SECRET`. |
| **`ENABLE_DEV_MOCK_AUTH`** | Backend (Auth Engine) | [server/src/auth.ts:96](file:///d:/AAZIRA/AARIZO/server/src/auth.ts#L96) | Optional (Dev/Test only) | `'false'` | No | **Missing** | **Missing** | **Missing** | High. When set to `'true'` in development/test, allows `mock_token_<uid>` bypass. Strict guard prevents enabling in production. |
| **`RAZORPAY_KEY_ID`** | Backend & Functions | [server/src/index.ts:2610,2924](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L2610)<br>[functions/.env.example:5](file:///d:/AAZIRA/AARIZO/functions/.env.example#L5) | Optional (Payment) | `'rzp_test_AARIZO_2026'` | No | Yes (placeholder) | Yes (placeholder) | No | Medium. Hardcoded fallback active; mock payment flow triggers if placeholder contains `test_AARIZO`. |
| **`RAZORPAY_KEY_SECRET`** | Backend & Functions | [server/src/index.ts:2611,2724,2925](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L2611)<br>[functions/.env.example:6](file:///d:/AAZIRA/AARIZO/functions/.env.example#L6) | Optional (Payment) | `'rzp_secret_AARIZO_2026'` | No | Yes (placeholder) | Yes (placeholder) | No | High. Hardcoded secret fallback in development allows test signatures. |
| **`RAZORPAY_WEBHOOK_SECRET`** | Backend & Functions | [server/src/index.ts:3053](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L3053)<br>[functions/.env.example:7](file:///d:/AAZIRA/AARIZO/functions/.env.example#L7) | Optional (Webhook) | `'rzp_webhook_AARIZO_2026'` | No | Yes (placeholder) | Yes (placeholder) | No | High. Webhook signature verification falls back to hardcoded string and accepts `test_sig_` prefix. |
| **`FIREBASE_SERVICE_ACCOUNT_KEY`** | Backend (Firebase Admin) | [server/src/auth.ts:14](file:///d:/AAZIRA/AARIZO/server/src/auth.ts#L14) | Optional | `undefined` | No | No | No | No | High. If unset, Firebase Admin initializes with default project credentials. |
| **`VITE_FIREBASE_PROJECT_ID`** | Backend & Frontend | [server/src/auth.ts:19](file:///d:/AAZIRA/AARIZO/server/src/auth.ts#L19)<br>[src/lib/firebase.ts:9](file:///d:/AAZIRA/AARIZO/src/lib/firebase.ts#L9) | Optional | `'aarizo-community'` / `'dummy_project_id'` | No | Yes (`dwellora-society`) | No | No | Medium. Inconsistent naming: Backend reads `VITE_FIREBASE_PROJECT_ID` (a frontend prefix). |
| **`VITE_FIREBASE_API_KEY`** | Frontend (Vite) | [src/lib/firebase.ts:7](file:///d:/AAZIRA/AARIZO/src/lib/firebase.ts#L7) | Optional | `'dummy_api_key'` | No | Yes | No | No | Low. Frontend Firebase client initialization. |
| **`VITE_FIREBASE_AUTH_DOMAIN`** | Frontend (Vite) | [src/lib/firebase.ts:8](file:///d:/AAZIRA/AARIZO/src/lib/firebase.ts#L8) | Optional | `'dummy_auth_domain'` | No | Yes | No | No | Low. Frontend Firebase auth domain. |
| **`VITE_FIREBASE_STORAGE_BUCKET`** | Frontend (Vite) | [src/lib/firebase.ts:10](file:///d:/AAZIRA/AARIZO/src/lib/firebase.ts#L10) | Optional | `'dummy_storage_bucket'` | No | Yes | No | No | Low. Frontend Firebase storage bucket. |
| **`VITE_FIREBASE_MESSAGING_SENDER_ID`** | Frontend (Vite) | [src/lib/firebase.ts:11](file:///d:/AAZIRA/AARIZO/src/lib/firebase.ts#L11) | Optional | `'dummy_sender_id'` | No | Yes | No | No | Low. Cloud messaging sender ID. |
| **`VITE_FIREBASE_APP_ID`** | Frontend (Vite) | [src/lib/firebase.ts:12](file:///d:/AAZIRA/AARIZO/src/lib/firebase.ts#L12) | Optional | `'dummy_app_id'` | No | Yes | No | No | Low. Firebase Web App ID. |
| **`VITE_USE_FIREBASE_EMULATOR`** | Frontend (Vite) | [src/lib/firebase.ts](file:///d:/AAZIRA/AARIZO/src/lib/firebase.ts) | Optional | `false` | No | Yes | No | No | Low. Toggles local Firebase emulator connection. |
| **`VITE_RAZORPAY_KEY_ID`** | Frontend (Vite) | [src/services/payment/RazorpayService.ts](file:///d:/AAZIRA/AARIZO/src/services/payment/RazorpayService.ts) | Optional | `undefined` | No | Yes | No | No | Medium. Frontend checkout modal key. |
| **`VITE_PUBLIC_LOGO_URL`** | Frontend (Vite) | [src/services/payment/RazorpayService.ts](file:///d:/AAZIRA/AARIZO/src/services/payment/RazorpayService.ts) | Optional | `''` | No | Yes | No | No | Low. Branding image for Razorpay popup. |
| **`VITE_BACKEND_URL`** | Frontend (Vite) | [src/services/apiClient.ts](file:///d:/AAZIRA/AARIZO/src/services/apiClient.ts) | Optional | `''` (defaults to origin) | No | Yes (`http://localhost:5000`) | No | No | Low. Base URL for Express API. |
| **`VITE_POSTGRES_API_URL`** | Frontend (Vite) | [src/lib/postgres.ts:29](file:///d:/AAZIRA/AARIZO/src/lib/postgres.ts#L29) | Optional | `'http://localhost:3000/api'` | No | No | No | No | Medium. Stale legacy endpoint URL (`localhost:3000` vs `5000`). |
| **`VERCEL`** | Backend (Deployment) | [server/src/index.ts:3526](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L3526) | Optional | `undefined` | No | No | No | No | Low. Prevents `app.listen()` when deployed as a serverless Vercel function. |

---

## 2. Environment Discrepancies & Drift Analysis

### 2.1 Database Connection URL Divergence

Three distinct database names and credential pairs exist across the documentation and configuration:

1. **`docker-compose.yml`**:
   `postgresql://aarizo_admin:aarizo_secure_password_2026@postgres:5432/aarizo_community?schema=public`
   - Database name: `aarizo_community`
   - User: `aarizo_admin`
   - Password: `aarizo_secure_password_2026`

2. **Root `.env.example`**:
   `postgresql://user:password@localhost:5432/dwellora_db?schema=public`
   - Database name: `dwellora_db` (Legacy pre-rebranding name)
   - User: `user`
   - Password: `password`

3. **`server/.env.example`**:
   `postgresql://user:password@localhost:5432/dwellora_db?schema=public`
   - Matches root `.env.example`, but conflicts with Docker Compose.

**Risk**: If a developer launches PostgreSQL via `docker compose up postgres` and then copies `.env.example` to `server/.env`, the backend fails to connect because `dwellora_db` does not exist in the PostgreSQL container (only `aarizo_community` is created).

### 2.2 Missing Security Secrets in Docker Compose

In [docker-compose.yml](file:///d:/AAZIRA/AARIZO/docker-compose.yml#L27-L41):
```yaml
app:
  environment:
    PORT: 5000
    DATABASE_URL: postgresql://aarizo_admin:aarizo_secure_password_2026@postgres:5432/aarizo_community?schema=public
```
Notice:
- `AUTH_SECRET` is **omitted**.
- In [Dockerfile](file:///d:/AAZIRA/AARIZO/Dockerfile#L23), `ENV NODE_ENV=production` is set.
- When `app` starts in production, `validateAuthConfiguration()` executes:
  ```typescript
  if (isProduction && (!secret || secret.trim().length < 32)) {
    throw new Error('FATAL: AUTH_SECRET or JWT_SECRET must be configured in production environment with at least 32 characters.');
  }
  ```
- **Consequence**: `docker compose up app` crashes immediately with a fatal exit code 1 because `AUTH_SECRET` is missing.

### 2.3 Cross-Contamination of Prefixes

In [server/src/auth.ts](file:///d:/AAZIRA/AARIZO/server/src/auth.ts#L19):
```typescript
initializeApp({ projectId: process.env.VITE_FIREBASE_PROJECT_ID || 'aarizo-community' });
```
- The backend server is inspecting an environment variable with a `VITE_` prefix (`VITE_FIREBASE_PROJECT_ID`).
- While this was likely done so that a single root `.env` could configure both frontend and backend, standard backend configuration should accept `FIREBASE_PROJECT_ID` with a fallback to `VITE_FIREBASE_PROJECT_ID`.

---

## 3. Directory & Path Resolution Matrix

Node.js `dotenv.config()` resolves paths relative to `process.cwd()`. The table below outlines how `dotenv` behaves depending on how the application is started:

| Execution Command | Working Directory (`process.cwd()`) | File Looked Up by `dotenv.config()` | Result if `.env` in Root | Result if `.env` in `server/` |
| :--- | :--- | :--- | :--- | :--- |
| `npm --prefix server run dev` (from root) | `D:\AAZIRA\AARIZO` | `D:\AAZIRA\AARIZO\.env` | **Loads root `.env`** | **Fails to load `server/.env`** |
| `cd server && npm run dev` | `D:\AAZIRA\AARIZO\server` | `D:\AAZIRA\AARIZO\server\.env` | **Fails to load root `.env`** | **Loads `server/.env`** |
| `node dist/index.js` in Docker (`/app`) | `/app` | `/app/.env` | Loads `/app/.env` | Ignores `/app/server/.env` |

**Conclusion**: Single-path `dotenv.config()` without path resolution is brittle and directory-dependent. Multi-path fallback resolution is required.

