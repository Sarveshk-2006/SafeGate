# AARIZO — ISSUE-06 — PHASE B.2 — STEP 2.3 — PHASE 4.6.8
# FINAL PRODUCTION READINESS, DEPLOYMENT VALIDATION & CLIENT HANDOFF
## DELIVERABLE 2: CLIENT PRODUCTION DEPLOYMENT GUIDE

---

## 1. Purpose & Target Audience

This guide provides the official, step-by-step deployment instructions for the **AARIZO Smart Community Platform** (incorporating the fully integrated Child Safety System).

It is written specifically for client DevOps engineers, Cloud Architects, and Systems Administrators who will deploy, configure, and maintain the production environment in client-owned cloud infrastructure.

---

## 2. Infrastructure Sizing & Prerequisites

### 2.1 Recommended Production Sizing

| Component | Minimum Recommended Sizing | Notes |
|---|---|---|
| **Backend API Server** | 2 vCPU, 4 GB RAM (e.g., AWS t4g.medium / GCP e2-medium) | Scales horizontally with stateless containers behind a load balancer. |
| **PostgreSQL Database** | 2 vCPU, 8 GB RAM, 50 GB SSD (Storage Auto-scaling) | PostgreSQL 16 LTS (e.g., AWS RDS db.t4g.medium or DigitalOcean Managed DB). |
| **Frontend Static CDN** | Serverless Edge CDN (Cloudflare Pages, AWS S3 + CloudFront, or Vercel) | Global edge distribution for static Vite build artifacts (`dist/`). |
| **Reverse Proxy / Load Balancer** | Nginx 1.24+ or AWS ALB / Cloudflare WAF | Handles SSL termination, rate limiting, and SSE streaming buffer bypass. |

### 2.2 External Service Accounts & Licenses Required
Before deployment, the client operations team must create and own the following accounts:
1. **Cloud Hosting Provider:** AWS, Google Cloud Platform, Azure, or DigitalOcean account.
2. **PostgreSQL 16 Instance:** Provisioned in a private VPC with SSL enabled (`sslmode=require`).
3. **Firebase Console Project:** For phone number OTP authentication (Identity Platform).
4. **Domain & DNS Registrar:** Ownership of the production domain (e.g., `aarizo.com` or client brand).
5. **SSL/TLS Certificates:** Wildcard or dedicated TLS certificate covering the web and API domains.
6. **Payment Gateway (Optional):** Razorpay merchant account for maintenance fee processing.

---

## 3. Production Deployment Topologies

The repository supports two primary production deployment models:

### Model A: Containerized Architecture (Docker Compose or Kubernetes)
Both the Node.js API and the static web assets are served from the production container built via the repository's multi-stage `Dockerfile`.
- Reverse proxy routes `/api/*` to the Express backend and all other routes to the static React assets.
- Best suited for single-server or Kubernetes cluster environments.

### Model B: Decoupled Edge Frontend + Containerized Backend (Recommended)
- **Frontend:** Static directory (`dist/`) uploaded to an Edge CDN (e.g., Cloudflare Pages, AWS S3 + CloudFront).
- **Backend:** Node.js Express server running in a containerized environment (AWS ECS Fargate, GCP Cloud Run, or Kubernetes).
- Best suited for enterprise scale and maximum global caching performance.

```mermaid
flowchart TD
    User["End Users (Resident / Guard / Admin)"]
    DNS["DNS & Cloudflare / CDN Edge"]
    WAF["Reverse Proxy / WAF (Nginx / ALB)"]
    FE["Frontend Static Assets (CDN / S3)"]
    BE["AARIZO Express Backend (Port 5000)"]
    DB[("Managed PostgreSQL 16")]
    FB["Firebase Auth Service"]

    User --> DNS
    DNS --> FE
    DNS --> WAF
    WAF -->|API & SSE Stream| BE
    BE -->|Prisma Pool| DB
    BE -->|Verify Phone Token| FB
```

---

## 4. Step-by-Step Deployment Procedure

### Step 1: Provision Managed PostgreSQL Database
1. Provision a PostgreSQL 16 instance with UTF-8 encoding.
2. Create the production database and user:
   ```sql
   CREATE DATABASE aarizo_community;
   CREATE USER aarizo_admin WITH ENCRYPTED PASSWORD 'REPLACE_WITH_STRONG_RANDOM_PASSWORD';
   GRANT ALL PRIVILEGES ON DATABASE aarizo_community TO aarizo_admin;
   ```
3. Record the connection URL in the format:
   `postgresql://aarizo_admin:PASSWORD@HOST:5432/aarizo_community?sslmode=require&schema=public`

### Step 2: Initialize Database Schemas & Migrations
On an authorized administrative bastion or CI runner with network access to the database:
1. Clone the repository and navigate to the `server/` directory:
   ```bash
   cd server
   npm ci
   ```
2. Set the `DATABASE_URL` environment variable:
   ```bash
   export DATABASE_URL="postgresql://aarizo_admin:PASSWORD@HOST:5432/aarizo_community?sslmode=require&schema=public"
   ```
3. Execute Prisma production migration deployment:
   ```bash
   npx prisma migrate deploy
   ```
   *Note: This applies all 6 sequential migrations without modifying existing data or prompting for reset.*
4. If migrating from an existing deployment with legacy child data, execute the backfill script:
   ```bash
   psql "$DATABASE_URL" -f ../scripts/postgres/backfill_child_safety_b21.sql
   ```
5. Verify schema integrity:
   ```bash
   psql "$DATABASE_URL" -c "\dt"
   psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM child_profiles;"
   ```

### Step 3: Build Container Image
Build the multi-stage production container using the repository `Dockerfile`:
```bash
# From the repository root
docker build -t your-registry.example.com/aarizo/app:v1.0.0 .
docker push your-registry.example.com/aarizo/app:v1.0.0
```

### Step 4: Configure Environment Variables
Prepare the production environment file (`.env` or Cloud Secrets Manager):
```ini
# Production Runtime
NODE_ENV=production
PORT=5000

# Database
DATABASE_URL=postgresql://aarizo_admin:PASSWORD@HOST:5432/aarizo_community?sslmode=require&schema=public

# Authentication (Mandatory: Minimum 32 random characters)
# Generate with: openssl rand -hex 32
AUTH_SECRET=4a7c8e9b1d2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b

# Security Guards (Must remain false in production)
ENABLE_DEV_MOCK_AUTH=false

# Firebase Admin
FIREBASE_PROJECT_ID=client-aarizo-production
FIREBASE_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"client-aarizo-production",...}'
```

### Step 5: Configure Reverse Proxy (Nginx / Cloudflare)
To ensure reliable SSE streaming and strict security headers, configure Nginx as follows:

```nginx
upstream aarizo_backend {
    server 127.0.0.1:5000;
    keepalive 32;
}

server {
    listen 443 ssl http2;
    server_name api.aarizo.example.com;

    ssl_certificate /etc/letsencrypt/live/api.aarizo.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.aarizo.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    # Security Headers
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Health Probes (Fast response, no rate limiting)
    location /api/health/ {
        proxy_pass http://aarizo_backend;
        proxy_set_header Host $host;
    }

    # CRITICAL: Realtime SSE Streaming Configuration
    location /api/realtime/stream {
        proxy_pass http://aarizo_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Disable proxy buffering for instant SSE delivery
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;

        # Extend read timeout to allow long-lived SSE connections
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # Standard REST API routes
    location /api/ {
        proxy_pass http://aarizo_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        client_max_body_size 25M;
    }
}
```

### Step 6: Start Container & Verify Health
Start the application container:
```bash
docker run -d \
  --name aarizo_app \
  --restart unless-stopped \
  --env-file /etc/aarizo/production.env \
  -p 5000:5000 \
  your-registry.example.com/aarizo/app:v1.0.0
```

Verify service startup and database connectivity:
```bash
# 1. Check process liveness
curl -f http://127.0.0.1:5000/api/health/live
# Expected: {"status":"UP","uptimeSeconds":...,"timestamp":"..."}

# 2. Check database readiness (probes PostgreSQL)
curl -f http://127.0.0.1:5000/api/health/ready
# Expected: {"status":"READY","database":"CONNECTED","latencyMs":...,"timestamp":"..."}

# 3. Check combined health endpoint
curl -f http://127.0.0.1:5000/api/health
# Expected HTTP 200 with database: CONNECTED
```

---

## 5. Zero-Downtime Rolling Deployment Procedure

When deploying application updates:
1. **Pre-Deployment Migration Check:** Run `npx prisma migrate deploy` in CI. In accordance with database best practices, all migrations are additive (backwards-compatible with running versions).
2. **Blue-Green / Rolling Update:**
   - Launch new container instance(s) running version `vNext`.
   - Kubernetes or load balancer queries `/api/health/ready`.
   - Once `/api/health/ready` returns HTTP 200 on all new instances, route live traffic to `vNext`.
3. **Graceful Drain of Old Instances:**
   - Send `SIGTERM` to old container instances.
   - The built-in graceful shutdown controller closes the HTTP listener, notifies active SSE streams to reconnect to the new instances, and disconnects Prisma pools cleanly within 5000ms.

---

## 6. Emergency Rollback Procedure

If an unexpected critical issue occurs immediately following deployment:
1. **Application Rollback:** Point the load balancer or reverse proxy back to the previous stable container image tag (`vPrevious`).
2. **Database Considerations:**
   - Schema migrations in AARIZO are strictly non-destructive and backward-compatible.
   - Rolling back the container to `vPrevious` does not require rolling back PostgreSQL tables.
   - If a rollback of specific migration DDL is strictly required, refer to Deliverable 4 (`DATABASE_MIGRATION_AND_RECOVERY_GUIDE.md`).
