# AARIZO / DWELLORA — PHASE 4.6.9
# PRODUCTION DEPLOYMENT, VERCEL INTEGRATION & LIVE APPLICATION HANDOFF
## DELIVERABLE 3: BACKEND & DATABASE DEPLOYMENT SPECIFICATION

---

## 1. Hosting Architecture Evaluation: Persistent vs Serverless

The AARIZO backend combines standard REST request-response APIs with a high-throughput, persistent Server-Sent Events (SSE) streaming engine.

### Comparative Hosting Matrix:

| Operational Dimension | Option A: Vercel Serverless (`@vercel/node`) | Option B: Persistent Container (Railway / Render / AWS ECS) |
|---|---|---|
| **REST APIs (`/api/auth`, `/api/children`)** | **Supported.** Fast cold starts, auto-scales on demand. | **Supported.** Always warm, sub-10ms response times. |
| **Realtime SSE Streams (`/api/realtime/stream`)** | **Limited.** Max timeout 15s - 60s; requires frequent reconnects. | **Fully Supported.** Indefinite connection lifetime with 15s keepalive pings. |
| **In-Memory Outbox Event Dispatch** | **Isolated.** Serverless invocations cannot communicate in-memory. | **Fully Supported.** Immediate sub-millisecond broadcast across all connected clients. |
| **Database Connection Pooling** | Requires connection pooler (e.g., PgBouncer / Neon pooler). | Managed natively by Prisma connection pool (`connection_limit=15`). |
| **Cost Profile** | Free / Pay-per-invocation. | $5 - $20 / month for dedicated compute. |
| **Architectural Recommendation** | Suitable for development and demo REST traffic. | **Mandatory for production multi-tenant society operations.** |

---

## 2. Server Startup Validation & Security Verification

The backend entrypoint [`server/src/index.ts`](file:///d:/AAZIRA/AARIZO/server/src/index.ts) strictly asserts two mandatory security invariants on boot:

```typescript
validateAuthConfiguration();
if (process.env.NODE_ENV !== 'test') {
  assertDatabaseConfiguration();
}
```

### Verification in Live Vercel Deployment:
When `GET https://safegate-chi.vercel.app/api/health/live` was invoked, the function failed closed with the exact log output:
```text
Error: FATAL: Production authentication secret is missing. Set AUTH_SECRET with at least 32 cryptographically random characters.
    at validateAuthConfiguration (/vercel/path1/server/src/auth.ts:74:13)
    at <anonymous> (/vercel/path1/server/src/index.ts:49:1)
Node.js process exited with exit status: 1.
```
**Conclusion:** The application cannot be launched in production with insecure defaults or missing secrets.

---

## 3. Database Deployment & Migration Runbook

### Step 1: Provision Managed PostgreSQL 16 Database
The client must provision a managed PostgreSQL database. Recommended providers:
- **Neon.tech (Serverless PostgreSQL with built-in PgBouncer pooling):** Ideal for Vercel Serverless.
- **Supabase / AWS RDS / DigitalOcean Managed DB:** Ideal for persistent container hosting.

### Step 2: Configure Environment Variables
Execute via Vercel CLI or Cloud Console:
```bash
# 1. Add cryptographically secure signing secret (>= 32 chars)
vercel env add AUTH_SECRET --environment production --value "$(openssl rand -hex 32)" --yes

# 2. Add managed database connection string
vercel env add DATABASE_URL --environment production --value "postgresql://user:password@ep-cool-db.us-east-2.aws.neon.tech/aarizo?sslmode=require" --yes

# 3. Add explicit production flags
vercel env add NODE_ENV --environment production --value "production" --yes
vercel env add ENABLE_DEV_MOCK_AUTH --environment production --value "false" --yes
```

### Step 3: Execute Forward Database Migrations
From an authorized machine with database network access:
```bash
export DATABASE_URL="postgresql://user:password@host:5432/aarizo?sslmode=require"
cd server
npx prisma migrate deploy
```
*Applies all 6 version-controlled migrations: `init_dwellora`, `safegate_2_extended_models`, `add_password_hash_and_salt`, `add_visitor_pass_indexes`, `add_child_safety_models`, and `remediate_child_safety_constraints`.*

### Step 4: Verify Database Connectivity
```bash
# Verify process liveness
curl -f https://safegate-chi.vercel.app/api/health/live

# Verify database readiness probe (probes PostgreSQL with 2000ms bounded SELECT 1)
curl -f https://safegate-chi.vercel.app/api/health/ready
```
