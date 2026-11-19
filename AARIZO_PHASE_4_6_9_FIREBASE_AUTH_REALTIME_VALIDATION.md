# AARIZO / DWELLORA — PHASE 4.6.9
# PRODUCTION DEPLOYMENT, VERCEL INTEGRATION & LIVE APPLICATION HANDOFF
## DELIVERABLE 4: FIREBASE AUTHENTICATION & REALTIME SSE VALIDATION REPORT

---

## 1. Firebase Authentication Production Integration

The AARIZO platform utilizes **Firebase Authentication** for mobile phone OTP identity verification, coupled with a server-authoritative HMAC-SHA256 JWT session manager.

### 1.1 Client-Side Firebase Configuration ([`src/lib/firebase.ts`](file:///d:/AAZIRA/AARIZO/src/lib/firebase.ts))
The frontend initializes Firebase using standard public credentials:
```typescript
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
```

### 1.2 Required Firebase Console Authorized Domains
To prevent OAuth and reCAPTCHA phone verification from failing in production, the client must add the following domains to the Firebase Console:
*Firebase Console -> Authentication -> Settings -> Authorized Domains:*
1. `safegate-chi.vercel.app` (Primary Production Domain)
2. `safegate-nordjzd6v-sarveshkulkarni2006-9923s-projects.vercel.app` (Deployment Preview Domain)
3. `localhost` (Local Development)

### 1.3 Server-Side Firebase Admin Token Verification ([`server/src/auth.ts`](file:///d:/AAZIRA/AARIZO/server/src/auth.ts#L9-L26))
The backend initializes `firebase-admin/auth` using either:
- `FIREBASE_SERVICE_ACCOUNT_KEY`: Service account private key JSON.
- `FIREBASE_PROJECT_ID`: Default application credentials.
Upon phone OTP completion, `authenticateFirebaseToken()` verifies the user's phone number against PostgreSQL `users.phone` and issues an authoritative AARIZO Bearer token.

---

## 2. Realtime SSE Transport Architecture

The realtime engine operates under strict security and architectural invariants:

```mermaid
sequenceDiagram
    autonumber
    actor Client as React Portal (AuthContext)
    participant API as /api/realtime/stream
    participant Engine as RealtimeEngine (server)
    participant Outbox as PostgreSQL outbox_events

    Client->>API: GET /api/realtime/stream (Headers: Authorization: Bearer <token>)
    API->>API: Verify HMAC-SHA256 & extract societyId, userId, role
    API->>Engine: registerClient(clientId, res, societyId, userId, role)
    API-->>Client: HTTP 200 (text/event-stream; Connection: keep-alive)
    API-->>Client: event: connected\ndata: {"clientId":"...","status":"CONNECTED"}

    loop Every 15-30s Keepalive
        Engine-->>Client: :keepalive ping
    end

    Note over Client,Outbox: Automatic Reconnect & Outbox Replay
    Client-xAPI: Network Interruption / Drop
    Client->>API: GET /api/realtime/stream (Header: Last-Event-ID: evt_12345)
    API->>Outbox: Query events WHERE id > evt_12345 AND societyId = clientSoc
    Outbox-->>API: Missed events during disconnect
    API-->>Client: Replayed missed events in sequence
```

### Verified Security Invariants:
1. **Header-Only Authentication:** Authentication tokens are passed exclusively via `Authorization: Bearer <token>` in HTTP headers. Zero tokens in URL query strings.
2. **Zero Native `EventSource` Fallback:** The streaming reader uses standard chunked `fetch` with `ReadableStreamDefaultReader`, preventing credential leakage in browser history.
3. **Audience Filtering:** Events targeting specific roles (e.g., `guard`, `admin`) or specific residents are filtered on the server before network dispatch.
4. **Single-Socket Economy:** Managed exclusively by `AuthContext.tsx`. Child Safety, Security Hub, and Admin desks listen to the single connection without opening duplicate sockets.
