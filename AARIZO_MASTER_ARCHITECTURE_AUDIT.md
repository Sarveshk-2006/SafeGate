# AARIZO — MASTER ARCHITECTURE & SYSTEM DESIGN AUDIT
**Document Version:** 1.0.0  
**Audit Date:** November 14, 2026  
**Auditor Roles:** Principal Software Architect, Senior Full-Stack Engineer, Security Auditor  
**Repository Working Copy:** `https://github.com/DhangarRohit18/AARIZO` (branch: `main`, commit: `4ace018`)  
**Working Directory:** `d:\AAZIRA\AARIZO`  

---

## 1. System Topology & Architecture Overview

AARIZO (internally referenced across legacy commits as *Dwellora* and *CommunityOS / SafeGate 2.0*) is a multi-tenant residential society management operating system designed for web and native Android mobile deployment.

The application implements a **tri-tier hybrid architecture** characterized by:
1. **Frontend Client Layer**: Single Page Application (SPA) built with React 19, TypeScript, Vite 8, Tailwind CSS 4, and Lucide Icons, wrapped inside a Capacitor 8 container for Android APK compilation.
2. **Dual-Backend Tier**:
   - **Authoritative Backend**: Node.js + Express 4 + Prisma ORM 6 + PostgreSQL 16 server exposing RESTful endpoints, Server-Sent Events (SSE) streaming, and a Transactional Outbox pattern.
   - **Cloud Functions / Serverless Tier**: Firebase Cloud Functions (v2) implementing callable functions (`provisionUser`, `createRazorpayOrder`, `verifyRazorpayPayment`, `processRazorpayRefund`, and `razorpayWebhook`).
3. **Data & State Management Tier**:
   - **Authoritative Database**: PostgreSQL 16 managed through Prisma ORM with 31 relational models.
   - **Client Storage & Cache**: Three-level fallback combining browser `localStorage` (`communityos_*`, `dwellora_*`), HTML5 `BroadcastChannel` for same-browser multi-tab sync, and optimistic UI state.
   - **External Cloud Datastore**: Firebase Firestore and Firebase Authentication with custom user claims.

```mermaid
flowchart TD
    subgraph ClientLayer ["Frontend Client Layer (Vite 8 + React 19 + Capacitor 8)"]
        UI["Web Browser & Android WebView"]
        AuthCtx["AuthContext (Dual: Firebase Phone OTP & PostgreSQL Password)"]
        ProtoCtx["PrototypeContext (Simulated State & Tabs)"]
        Repo["BaseRepository & Domain Repositories"]
        ApiClient["apiClient (Express REST Client)"]
        RTClient["RealtimeService (SSE + BroadcastChannel)"]
    end

    subgraph BackendLayer ["Authoritative Backend Tier (Express + Prisma)"]
        ExpressApp["Express API Server (Port 5000)"]
        AuthMW["Auth Middleware (requireRole, rateLimiter)"]
        ProvSvc["UniversalProvisioningService"]
        RTEngine["RealtimeEngine (SSE + Outbox Poller)"]
        PrismaClient["Prisma Client ORM (v6.19.3)"]
    end

    subgraph DatabaseTier ["Authoritative Storage"]
        PG[("PostgreSQL 16 (Relational DB & RLS)")]
        OutboxTable[("outbox_events Table")]
    end

    subgraph FirebaseTier ["Cloud Functions / Fallback Tier"]
        FBAuth["Firebase Authentication (Phone OTP & Claims)"]
        CF["Firebase Cloud Functions v2"]
        Firestore[("Firestore NoSQL DB")]
    end

    subgraph Gateways ["External Integrations"]
        RP["Razorpay Payment Gateway (Checkout SDK)"]
        FCM["Firebase Cloud Messaging (FCM Push)"]
    end

    UI --> AuthCtx
    UI --> ProtoCtx
    UI --> Repo
    Repo --> ApiClient
    Repo --> Firestore
    ApiClient --> ExpressApp
    RTClient <--> RTEngine
    RTClient <--> UI
    AuthCtx --> FBAuth
    AuthCtx --> ApiClient
    ExpressApp --> AuthMW
    AuthMW --> ProvSvc
    ProvSvc --> PrismaClient
    ExpressApp --> RTEngine
    RTEngine --> OutboxTable
    PrismaClient --> PG
    ApiClient --> CF
    CF --> FBAuth
    CF --> Firestore
    UI --> RP
    ExpressApp --> RP
    CF --> RP
    FBAuth --> FCM
```

---

## 2. Baseline Environment & Repository Status

### 2.1 Git Repository Verification
- **Repository Root**: `d:\AAZIRA\AARIZO`
- **Current Branch**: `main`
- **Remote Origin URL**: `https://github.com/DhangarRohit18/AARIZO`
- **Latest Commit Hash**: `4ace01876700d23af402ca785c48ae060b16e53d`
- **Commit Message**: `feat(auth): add email and password login integration with PostgreSQL and dynamic prefix on login screen`
- **Working Tree**: Clean (`nothing to commit, working tree clean`)

#### Recent Commit History (Last 5 Commits)
| Commit Hash | Author | Date | Subject |
| :--- | :--- | :--- | :--- |
| `4ace018` | Rohit Dhangar | 2026-11-13 | feat(auth): add email and password login integration with PostgreSQL and dynamic prefix on login screen |
| `8204a21` | Rohit Dhangar | 2026-11-13 | feat(auth): enforce explicit passwords for all role provisioning across all dashboards; store passwordHash & salt in PostgreSQL |
| `308b5fa` | Rohit Dhangar | 2026-11-13 | feat(core): implement complete CRUD lifecycles, child safety pass & SOS, secretary resident creation, and resident vendor directory |
| `6be5e7f` | Rohit Dhangar | 2026-11-13 | feat(ui): implement committee member management, resident vendor visibility, and Google Play Store bundle |
| `dff19c0` | Rohit Dhangar | 2026-11-12 | style(ui): elevate and polish hero headers, responsive grids, and visual tokens across all admin, resident, and facility pages |

### 2.2 Framework & Dependency Versions
| Subsystem | Framework / Library | Declared Version | Verified Runtime |
| :--- | :--- | :--- | :--- |
| **Node.js Runtime** | Node.js | `>=20.0.0` | `v22.20.0` |
| **Package Manager** | npm | `>=10.0.0` | `11.6.3` |
| **Frontend Framework** | React | `^19.2.8` | `19.2.8` |
| **Frontend Routing** | React Router DOM | `^7.18.3` | `7.18.3` |
| **Frontend Bundler** | Vite | `^8.2.2` | `8.2.2` |
| **Styling** | Tailwind CSS / PostCSS | `^4.3.3` | `4.3.3` |
| **Icons** | Lucide React | `^1.41.0` | `1.41.0` |
| **Linter** | Oxlint | `^1.79.0` | `1.79.0` (216 warnings, 0 errors) |
| **Testing Engine** | Jest & ts-jest | `^30.5.2` | `30.5.2` (5 suites, 48 tests PASS) |
| **Mobile Runtime** | Capacitor Core & Android | `^8.5.2` | `8.5.2` (5 native plugins) |
| **Backend Server** | Express | `^4.21.2` | `4.21.2` |
| **Backend ORM** | Prisma Client & CLI | `^6.4.1` | `6.19.3` |
| **TypeScript (Root)** | TypeScript | `~6.0.2` | `5.7.3` (tsc -b) |
| **TypeScript (Server)** | TypeScript | `^5.7.3` | `5.7.3` |
| **Cloud Admin** | Firebase Admin SDK | `^14.5.0` | `14.5.0` |
| **Cloud Client** | Firebase JS SDK | `^12.19.0` | `12.19.0` |

---

## 3. Dependency Map & Package Manifests

### 3.1 Root `package.json` Manifest
- **Path**: [package.json](file:///d:/AAZIRA/AARIZO/package.json)
- **Role**: Client SPA application, mobile Capacitor orchestrator, test runner.
- **Scripts**:
  - `dev`: `vite`
  - `build`: `tsc -b && vite build`
  - `vercel-build`: `npm --prefix server install && npm run prisma:generate && npm run server:build && npm run build`
  - `test`: `jest`
  - `lint`: `oxlint`
  - `server:dev`: `npm --prefix server run dev`
  - `server:build`: `npm --prefix server run build`
  - `prisma:generate`: `npm --prefix server run prisma:generate`
  - `cap:sync`: `npx cap sync`
  - `cap:android`: `npx cap open android`

### 3.2 Server `server/package.json` Manifest
- **Path**: [server/package.json](file:///d:/AAZIRA/AARIZO/server/package.json)
- **Role**: Express REST API, Prisma client runner, SSE streaming engine.
- **Dependencies**: `@prisma/client`, `cors`, `dotenv`, `express`, `firebase-admin`.
- **Dev Dependencies**: `@types/cors`, `@types/express`, `@types/node`, `prisma`, `tsx`, `typescript`.

### 3.3 Firebase Functions `functions/package.json` Manifest
- **Path**: [functions/package.json](file:///d:/AAZIRA/AARIZO/functions/package.json)
- **Role**: Serverless Cloud Functions v2 for Firebase Auth custom claims and Razorpay webhook/signature verification.
- **Dependencies**: `firebase-admin`, `firebase-functions`.

---

## 4. Environment Variables Schema & Configuration

The application requires specific environment variables across three layers without exposing credentials:

| Layer | Variable Name | Required / Optional | Purpose | Sensitive |
| :--- | :--- | :--- | :--- | :--- |
| **Frontend** | `VITE_BACKEND_URL` | Optional (default: `http://localhost:5000`) | Base URL for Express REST API | No |
| **Frontend** | `VITE_FIREBASE_API_KEY` | Required for Phone OTP | Firebase Web API key | Public |
| **Frontend** | `VITE_FIREBASE_AUTH_DOMAIN` | Required for Phone OTP | Firebase Auth domain | Public |
| **Frontend** | `VITE_FIREBASE_PROJECT_ID` | Required | Firebase project ID | Public |
| **Frontend** | `VITE_FIREBASE_STORAGE_BUCKET` | Optional | Firebase Cloud Storage bucket | Public |
| **Frontend** | `VITE_FIREBASE_MESSAGING_SENDER_ID` | Optional | FCM sender identifier | Public |
| **Frontend** | `VITE_FIREBASE_APP_ID` | Required | Firebase web application identifier | Public |
| **Frontend** | `VITE_USE_FIREBASE_EMULATOR` | Optional (boolean) | Toggle for local Firebase emulator suite | No |
| **Frontend** | `VITE_RAZORPAY_KEY_ID` | Required for Payment | Public Key ID for Razorpay Checkout Modal | Public |
| **Frontend** | `VITE_PUBLIC_LOGO_URL` | Optional | HTTPS URL for branding inside Razorpay modal | Public |
| **Backend** | `PORT` | Optional (default: `5000`) | Express server listener port | No |
| **Backend** | `DATABASE_URL` | **Required for DB queries** | PostgreSQL connection string (`postgresql://user:pass@host:5432/db`) | **YES** |
| **Backend** | `RAZORPAY_KEY_ID` | Required for Payments | Razorpay API key identifier | Secret |
| **Backend** | `RAZORPAY_KEY_SECRET` | Required for Payments | Razorpay HMAC-SHA256 signature verification secret | **STRICT SECRET** |
| **Backend** | `RAZORPAY_WEBHOOK_SECRET` | Required for Webhooks | Razorpay Webhook signature verification secret | **STRICT SECRET** |
| **Backend** | `FIREBASE_SERVICE_ACCOUNT_KEY` | Optional (stringified JSON) | Firebase Admin service account for token verification | **STRICT SECRET** |
| **Functions** | `RAZORPAY_KEY_ID` | Required | Razorpay key identifier in Cloud Functions | Secret |
| **Functions** | `RAZORPAY_KEY_SECRET` | Required | Razorpay secret key in Cloud Functions | **STRICT SECRET** |
| **Functions** | `RAZORPAY_WEBHOOK_SECRET` | Required | Webhook verification secret | **STRICT SECRET** |

> [!WARNING]
> In this audit working copy, `.env` files do not exist in root, `server/`, or `functions/`. Only `.env.example` templates exist. As a result, database queries fail with `PrismaClientInitializationError: Environment variable not found: DATABASE_URL`.

---

## 5. Mobile & Native Capacitor Architecture

The project contains a complete Capacitor 8 Android container in `android/`:
- **App ID**: `com.aarizo.app`
- **App Name**: `AARIZO`
- **Target SDK**: Configured via Android Gradle plugin (Java 17 target)
- **Active Native Plugins**:
  1. `@capacitor/app` (`7.1.2`): Hardware back button registration, background/foreground state detection.
  2. `@capacitor/camera` (`7.0.5`): QR code pass scanning at gates and document photo upload.
  3. `@capacitor/haptics` (`7.0.5`): Tactile feedback upon QR scanning, pass approval, and SOS trigger.
  4. `@capacitor/push-notifications` (`7.0.7`): System notifications for gate arrivals and approvals.
  5. `@capacitor/status-bar` (`7.0.6`): System bar tinting (`#000000`, dark style).

- **Android Permissions Declared in `AndroidManifest.xml`**:
  - `android.permission.INTERNET`
  - `android.permission.CAMERA` (with autofocus hardware feature optional)
  - `android.permission.POST_NOTIFICATIONS` (Android 13+ runtime permission)
  - `android.permission.VIBRATE` (Haptics)
  - `android.permission.READ_MEDIA_IMAGES` & `READ_EXTERNAL_STORAGE` (maxSdkVersion 32)
  - `android:usesCleartextTraffic="true"` (Allows local dev backend HTTP communication)

---

## 6. Dual-Backend Analysis & Architectural Divergence

A critical architectural finding is the **co-existence of two divergent backends**:
1. **The Modern Authoritative Express/Prisma/PostgreSQL Stack**:
   - Resides in `server/src/`.
   - Complete relational schema (31 models) in `server/prisma/schema.prisma`.
   - Express REST API with ~70 endpoints handling CRUD for all society entities.
   - Server-Sent Events (SSE) streaming engine with Transactional Outbox pattern.
   - Synchronous SHA-256 HMAC password hashing with per-user salt.
2. **The Serverless Firebase/Firestore Stack**:
   - Resides in `functions/src/` and `src/services/firebase/`.
   - Firestore security rules in `firestore.rules` (26 KB ruleset).
   - Firebase Phone Authentication with Custom User Claims (`role`, `societyId`).
   - Callable functions for Razorpay order generation and verification.

```mermaid
flowchart LR
    subgraph FrontendDispatch ["Client Service Layer"]
        FC["Call Service Method (e.g. createRazorpayOrder)"]
    end

    subgraph FirebasePath ["Path A: Firebase Cloud Functions"]
        CFN["httpsCallable('createRazorpayOrder')"]
        FS[("Firestore")]
    end

    subgraph ExpressPath ["Path B: Express REST API"]
        EXP["apiClient.createRazorpayOrder()"]
        PG[("PostgreSQL")]
    end

    FC -->|Try 1| CFN
    CFN -->|Success| FS
    CFN -->|Failure / Timeout / Missing Config| EXP
    EXP --> PG
```

### Architectural Risk
The frontend client maintains duplicate code paths: it attempts Firebase Cloud Functions first, and on error falls back to the Express REST API and LocalStorage. If both backends are partially active, data divergence occurs between Firestore documents and PostgreSQL records.

