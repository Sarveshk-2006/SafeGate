# AARIZO — Phase A, Step 4.1: ISSUE-04 Remediation Plan

**Date:** 2026-11-14  
**Target Issue:** ISSUE-04 (P1) — Missing `.env` / `DATABASE_URL` Runtime Initialization  
**Target Implementation Step:** Phase A, Step 4.2  
**Workspace:** `D:\AAZIRA\AARIZO`  

---

## 1. Remediation Objectives & Guardrails

The goal of this remediation plan is to eliminate runtime initialization hazards, prevent deceptive health reporting, protect against internal path disclosure, and ensure deterministic environment loading across all operating contexts (local development, Docker containers, production).

### Strict Guardrails
1. **Preserve ISSUE-02 & ISSUE-03 Hardening**: No changes that weaken unified authentication, token verification, session storage, or route protection.
2. **Backward Compatibility**: Support existing development workflows (`npm --prefix server run dev` and `cd server && npm run dev`).
3. **Fail-Closed Startup**: If `DATABASE_URL` is absent or malformed, the server must reject execution at boot with an actionable diagnostic message instead of failing during client transactions.
4. **Information Sanitization**: Ensure uncaught database exceptions never leak internal file paths, table schemas, or query strings to unauthenticated clients.
5. **No Blind Secrets**: Do not commit secrets, database passwords, or private keys to source control.

---

## 2. Identified Deficiencies & Specific Remediations

### Remediation 1: Robust Multi-Path Environment Loading (ESM-Safe)

**Problem:** `dotenv.config()` in `server/src/index.ts` runs after static imports are evaluated and only looks at `process.cwd()/.env`.  
**Solution:**
Create a dedicated environment loader module [server/src/config.ts](file:///d:/AAZIRA/AARIZO/server/src/config.ts) (or integrate into [server/src/prisma.ts](file:///d:/AAZIRA/AARIZO/server/src/prisma.ts) and [server/src/index.ts](file:///d:/AAZIRA/AARIZO/server/src/index.ts)) that:
1. Resolves candidate `.env` paths in priority order:
   - File path specified in `DOTENV_CONFIG_PATH` (if provided)
   - `<server_dir>/.env` (resolved relative to `import.meta.url`)
   - `<root_dir>/.env` (resolved relative to `import.meta.url/../../.env`)
   - Standard `process.cwd()/.env`
2. Loads variables into `process.env` immediately upon import before downstream singletons initialize.

### Remediation 2: Startup Fail-Closed Database Validation (`validateDatabaseConfiguration`)

**Problem:** Server starts up, prints green success banners, binds to port 5000, and only crashes when a user attempts to log in or query data.  
**Solution:**
Add a synchronous validation function `validateDatabaseConfiguration()` called immediately on startup:
```typescript
export function validateDatabaseConfiguration(): { isValid: boolean; error?: string } {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || dbUrl.trim() === '') {
    return {
      isValid: false,
      error: 'DATABASE_URL environment variable is missing or empty. Please configure server/.env or root .env.'
    };
  }

  // Validate format starts with postgresql:// or postgres://
  if (!/^postgres(ql)?:\/\//i.test(dbUrl.trim())) {
    return {
      isValid: false,
      error: 'DATABASE_URL format is invalid. Must begin with postgresql:// or postgres://'
    };
  }

  return { isValid: true };
}
```
In `server/src/index.ts`:
```typescript
const dbConfig = validateDatabaseConfiguration();
if (!dbConfig.isValid) {
  if (process.env.NODE_ENV === 'production') {
    console.error(`[FATAL] ${dbConfig.error}`);
    process.exit(1);
  } else {
    console.warn(`[WARN] ${dbConfig.error}`);
    console.warn('[WARN] Database operations will fail until DATABASE_URL is configured.');
  }
}
```

### Remediation 3: Verifiable Database Health Check in `/api/health`

**Problem:** `/api/health` returns `200 OK` and `{ status: "UP", engine: "Node.js + Express + Prisma + PostgreSQL" }` even when PostgreSQL is dead or `DATABASE_URL` is missing.  
**Solution:**
Update `GET /api/health` to perform an active database probe with a short timeout:
```typescript
app.get('/api/health', async (req, res) => {
  let dbStatus = 'DISCONNECTED';
  let dbLatencyMs: number | null = null;
  const start = Date.now();

  try {
    // 2-second timeout probe
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('DB_TIMEOUT')), 2000))
    ]);
    dbStatus = 'CONNECTED';
    dbLatencyMs = Date.now() - start;
  } catch (err: any) {
    dbStatus = err?.message === 'DB_TIMEOUT' ? 'TIMEOUT' : 'ERROR';
  }

  const isHealthy = dbStatus === 'CONNECTED';
  const statusCode = isHealthy ? 200 : 503;

  res.status(statusCode).json({
    status: isHealthy ? 'UP' : 'DEGRADED',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    database: {
      status: dbStatus,
      ...(dbLatencyMs !== null ? { latencyMs: dbLatencyMs } : {})
    },
    engine: 'Node.js + Express + Prisma + PostgreSQL'
  });
});
```
*Note: Maintain backward compatibility for `/api/health` structure so existing consumers reading `status: "UP"` continue functioning when database is connected.*

### Remediation 4: Outbox Poller Error Backoff & Logging in `realtimeEngine.ts`

**Problem:** Empty catch block in `realtimeEngine.ts` line 280 silences all database errors every 500ms.  
**Solution:**
Add exponential backoff or rate-limited error logging in `startOutboxPoller()`:
```typescript
} catch (err: any) {
  // Rate-limited warning (at most once every 60 seconds)
  const now = Date.now();
  if (now - this.lastDbErrorLogTime > 60000) {
    console.warn('[RealtimeEngine] Outbox poller database connection error:', err?.message || err);
    this.lastDbErrorLogTime = now;
  }
}
```

### Remediation 5: Information Disclosure Sanitization in Error Handlers

**Problem:** `server/src/index.ts` returns `error?.message` directly in 500 responses (e.g., line 1723), exposing file paths and Prisma schema details.  
**Solution:**
Wrap uncaught database errors in a centralized sanitizer helper:
```typescript
export function sanitizeDatabaseError(err: any): { error: string; code: string } {
  console.error('[Database Error]', err); // Detailed log on server console
  return {
    error: 'An internal database error occurred. Please contact system administrator.',
    code: 'DATABASE_ERROR'
  };
}
```

### Remediation 6: Harmonize `.env.example` Templates & Docker Compose

**Problem:** Template files use legacy `dwellora_db` while `docker-compose.yml` uses `aarizo_community`. Templates omit `AUTH_SECRET` and `ENABLE_DEV_MOCK_AUTH`. `docker-compose.yml` omits `AUTH_SECRET`.  
**Solution:**
1. Update `server/.env.example` and `.env.example`:
   - Set default database URL to `postgresql://aarizo_admin:aarizo_secure_password_2026@localhost:5432/aarizo_community?schema=public`
   - Include documented `AUTH_SECRET` (with instructions: `openssl rand -hex 32`)
   - Include `ENABLE_DEV_MOCK_AUTH=false`
2. Update `docker-compose.yml`:
   - Supply `AUTH_SECRET: aarizo_docker_default_secret_minimum_32_characters_2026` to service `app` so production mode startup validation passes out of the box.

---

## 3. Targeted Test Suite Design (`tests/issue04_runtime_config.test.ts`)

Create a dedicated automated test suite verifying:
1. `validateDatabaseConfiguration()` correctly rejects missing, empty, or non-postgres `DATABASE_URL`.
2. `validateDatabaseConfiguration()` accepts valid `postgresql://` and `postgres://` URLs with credentials and hosts.
3. Multi-path `.env` resolution correctly locates configuration regardless of execution CWD.
4. Database error sanitizer strips file paths, line numbers, and schema fragments.
5. `/api/health` returns status code 503 and `DEGRADED` when database connection fails or times out, and 200 `UP` when connected.

---

## 4. Execution Sequence for Step 4.2

1. **Step 4.2.1**: Implement `validateDatabaseConfiguration` and environment loading helper in `server/src/config.ts` or `server/src/prisma.ts`.
2. **Step 4.2.2**: Integrate startup validation in `server/src/index.ts` (fail-closed in production, warning in development).
3. **Step 4.2.3**: Update `/api/health` with active PostgreSQL probe and 503 degraded status.
4. **Step 4.2.4**: Sanitize database error responses in `server/src/index.ts`.
5. **Step 4.2.5**: Add backoff and rate-limited logging to `realtimeEngine.ts` outbox poller.
6. **Step 4.2.6**: Synchronize `.env.example`, `server/.env.example`, and `docker-compose.yml`.
7. **Step 4.2.7**: Run test suite and verify full regression safety.

