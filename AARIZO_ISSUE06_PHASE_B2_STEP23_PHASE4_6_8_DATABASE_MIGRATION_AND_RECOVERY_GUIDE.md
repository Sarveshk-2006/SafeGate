# AARIZO — ISSUE-06 — PHASE B.2 — STEP 2.3 — PHASE 4.6.8
# FINAL PRODUCTION READINESS, DEPLOYMENT VALIDATION & CLIENT HANDOFF
## DELIVERABLE 4: DATABASE MIGRATION & DISASTER RECOVERY GUIDE

---

## 1. Executive Summary & Database Architecture

The AARIZO Community Platform uses **PostgreSQL 16 LTS** as its authoritative relational data store, managed through **Prisma ORM 6.19** and native SQL scripts.

All tables enforce strict multi-tenant isolation through composite tenant keys (`@@unique([societyId, id])`), referential integrity via `onDelete: Restrict`, immutable audit logging, and check constraints that mirror TypeScript enums.

This guide provides operational runbooks for:
1. Executing production migrations safely.
2. Backfilling existing child safety records.
3. Connection pool sizing and query timeouts.
4. Continuous backups, disaster recovery, and data restoration.
5. Soft-delete archival and data retention policies.

---

## 2. Migration History & Parity Verification

### 2.1 Sequential Migration Log
The database schema has evolved through six sequential, version-controlled migrations:

```mermaid
flowchart LR
    M1["1. 20261020000000\ninit_dwellora\n(Core Schema)"] --> M2["2. 20261107000000\nsafegate_2_extended\n(Visitor & Gate)"]
    M2 --> M3["3. 20261114000000\nadd_password_hash\n(Scrypt Auth)"]
    M3 --> M4["4. 20261117000000\nadd_visitor_pass_idx\n(Performance Indexes)"]
    M4 --> M5["5. 20261118000000\nadd_child_safety\n(5 Child Safety Tables)"]
    M5 --> M6["6. 20261118010000\nremediate_constraints\n(Composite Keys & Restrict)"]
```

| Migration Directory | Core Changes | Parity Status |
|---|---|---|
| `20261020000000_init_dwellora` | Base tables: societies, towers, flats, users, residents, staff, tickets. | Verified in `01_schema.sql` |
| `20261107000000_safegate_2_extended_models` | Visitor passes, security checkpoints, gate logs, amenities. | Verified in `01_schema.sql` |
| `20261114000000_add_password_hash_and_salt` | Added `password_hash` and `password_salt` columns to `users`. | Verified in `01_schema.sql` |
| `20261117000000_add_visitor_pass_indexes` | High-throughput composite indexes on visitor passes. | Verified in `01_schema.sql` |
| `20261118000000_add_child_safety_models` | Initial Child Safety tables (`child_profiles`, `child_escorts`, `child_gate_passes`, `child_exit_logs`, `child_safety_alerts`). | Verified in `01_schema.sql` |
| `20261118010000_remediate_child_safety_constraints` | Added composite keys `@@unique([societyId, id])`, `token_hash` unique constraint, and `onDelete: Restrict` referential actions. | Verified in `01_schema.sql` |

### 2.2 Relational Invariants Enforced
- **Multi-Tenant Composite Keys:** Every Child Safety table includes `CONSTRAINT uq_*_society_id UNIQUE (society_id, id)`. Prevents cross-society record linkage at the database engine level.
- **HMAC Hash Uniqueness:** `token_hash VARCHAR(64) UNIQUE NOT NULL` ensures token digests are globally collision-free.
- **Reference Pass Code Scoping:** `CONSTRAINT uq_child_passes_society_code UNIQUE (society_id, pass_code)` scopes human-readable reference codes per society.
- **Cascade Deletion Prohibition:** Child profile and pass relationships enforce `ON DELETE RESTRICT`. Accidental bulk deletion of residents or societies will fail closed rather than destroying child safety history.
- **Append-Only Exit Audit:** `child_exit_logs` has zero update or delete endpoints. Audit records remain permanent.

---

## 3. Safe Production Migration Sequence

### ⚠️ Pre-Migration Safety Rules:
1. **Never run `prisma migrate dev` in production.** It creates shadow databases and prompts for interactive resets. Always use `prisma migrate deploy`.
2. **Never execute `03_seed.sql` on a production database.** It is guarded by PL/pgSQL logic and excluded from production runner scripts.
3. **Always take an immediate snapshot/dump before executing schema changes.**

### Step-by-Step Production Cutover Runbook:
```bash
# 1. Capture pre-migration backup
pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -F c -b -v -f "/backups/pre_cutover_$(date +%Y%m%d_%H%M%S).dump"

# 2. Deploy Prisma migrations
cd /app/server
npx prisma migrate deploy

# 3. Check migration status
npx prisma migrate status

# 4. If legacy child data exists in resident metadata, run idempotent backfill
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -f /app/scripts/postgres/backfill_child_safety_b21.sql

# 5. Verify database readiness probe returns 200
curl -f http://127.0.0.1:5000/api/health/ready
```

---

## 4. Connection Pool Sizing & Timeout Tuning

### 4.1 Prisma Connection Pool Configuration
Prisma manages an internal connection pool per Node.js process. In PostgreSQL, connection limits must be budgeted across all container replicas:

$$\text{Total Connections} = (\text{Number of Container Replicas} \times \text{connection\_limit}) + \text{Admin/Migration Reserve}$$

Configure the connection pool via the `DATABASE_URL` query parameters:
```ini
DATABASE_URL="postgresql://aarizo_admin:pass@host:5432/aarizo_community?schema=public&sslmode=require&connection_limit=15&pool_timeout=10"
```
- `connection_limit=15`: Allocates 15 active connections per Node.js container instance.
- `pool_timeout=10`: If all connections are busy, incoming queries wait at most 10 seconds before failing fast with an error.

### 4.2 PostgreSQL Server Parameters (`postgresql.conf`)
For a 4 GB - 8 GB RAM database server, configure the following parameters:
```ini
max_connections = 100
shared_buffers = 1GB
work_mem = 16MB
maintenance_work_mem = 256MB
effective_cache_size = 3GB
statement_timeout = 15000          # Bounded 15s timeout for API queries
idle_in_transaction_session_timeout = 10000  # Terminate abandoned transactions
```

---

## 5. Backup, Restoration & Disaster Recovery

### 5.1 Automated Backup Policy
- **Continuous WAL Archiving:** Enable PostgreSQL Write-Ahead Log (WAL) archiving for Point-in-Time Recovery (PITR) with a Recovery Point Objective (RPO) $\le 5\text{ minutes}$.
- **Daily Automated Snapshots:** Full logical `pg_dump` taken every 24 hours at 02:00 UTC and replicated to a multi-region cloud bucket (e.g., AWS S3 Glacier).
- **Snapshot Retention:** Retain daily dumps for 30 days, weekly dumps for 12 weeks, and monthly dumps for 1 year.

### 5.2 Backup Script (`backup_aarizo.sh`)
```bash
#!/bin/bash
set -euo pipefail

BACKUP_DIR="/var/backups/aarizo"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="aarizo_backup_${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"

echo "Starting PostgreSQL backup: $FILENAME"
pg_dump \
  -h "${DB_HOST:-localhost}" \
  -U "${DB_USER:-aarizo_admin}" \
  -d "${DB_NAME:-aarizo_community}" \
  -F c \
  -b \
  -v \
  -f "${BACKUP_DIR}/${FILENAME}"

# Encrypt backup before cloud sync
gpg --batch --yes --encrypt --recipient ops@aarizo.com "${BACKUP_DIR}/${FILENAME}"

# Sync to secure S3 bucket
aws s3 cp "${BACKUP_DIR}/${FILENAME}.gpg" "s3://aarizo-db-backups-secure/daily/${FILENAME}.gpg"

echo "Backup completed and uploaded successfully."
```

### 5.3 Point-In-Time Restoration Procedure
In the event of database corruption or hardware failure:
1. Stop inbound traffic to backend API servers (set maintenance mode in Nginx / ALB).
2. Provision a clean PostgreSQL 16 instance.
3. Download and decrypt the target backup snapshot:
   ```bash
   gpg --decrypt aarizo_backup_20261119_020000.dump.gpg > restore.dump
   ```
4. Restore database schema and records:
   ```bash
   pg_restore \
     -h "$NEW_DB_HOST" \
     -U aarizo_admin \
     -d aarizo_community \
     --clean \
     --if-exists \
     -v restore.dump
   ```
5. Run the health probe against the restored database:
   ```bash
   curl -f http://127.0.0.1:5000/api/health/ready
   ```
6. Re-enable traffic at the load balancer.

---

## 6. Data Retention & Archival Policies

1. **Soft Delete Archival:** Child profiles and escorts use `archived_at TIMESTAMPTZ(3)`. When a resident archives a child, records are marked archived but retained permanently to maintain foreign key integrity for past exit logs.
2. **Exit Logs Retention:** `child_exit_logs` must be retained for a minimum of 365 days in accordance with community security compliance standards.
3. **Historical Table Partitioning (Future Recommendation):** For societies with over 10,000 daily gate entries, partition `child_exit_logs` by month using PostgreSQL declarative table partitioning (`PARTITION BY RANGE (created_at)`).
