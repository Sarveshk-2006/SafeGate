# AARIZO — ISSUE-06 PHASE B.2.2 FINAL SECURITY SCORECARD

**Project:** `D:\AAZIRA\AARIZO`  
**Audit Date:** 2026-11-18  
**Overall Verdict:** **`FAIL — TARGETED REMEDIATION STILL REQUIRED`**

---

## 1. Original Findings Scorecard (`F-B22-01` – `F-B22-07`)

| Finding ID | Original Severity | Re-Audit Status | Blocks Closure? | Verification Classification | Key Evidence |
| --- | --- | --- | --- | --- | --- |
| **F-B22-01** | HIGH / CRITICAL (Blocking) | **`FAIL`** | **YES** | Independently verified by code inspection; Independently reproduced against live PostgreSQL | Direct `/api/collections/child_*` & `POST /api/entityRecord/query` blocked, **BUT** live PG 16 probes proved `vendor` reads `child_profiles` via `GET /api/collections/entityRecord(/:id)`, reads `CHILD_SAFETY` SOS via `GET /api/collections/emergencyIncident`, and `facility_manager` mutates `child_profiles` via `PATCH /api/housekeeping/tasks/:id`. |
| **F-B22-02** | HIGH (Blocking) | **`FAIL`** | **YES** | Independently verified by code inspection; Independently reproduced against live PostgreSQL | `handleSseSubscription` & `CHILD_*` filtering fixed, **BUT** live PG 16 probes proved `vendor` can forge cross-society `CHILD_SAFETY_SOS_TRIGGERED` + `_audience` via `POST /api/realtime/broadcast`, and `isClientAuthorizedForEvent` fails open on `EMERGENCY_INCIDENT_CREATED` without `_audience` & malformed `_audience: {}`. |
| **F-B22-03** | HIGH (Blocking) | **`PASS`** | No | Independently verified by code inspection; Independently reproduced through an HTTP test; Independently reproduced against live PostgreSQL | Stale JWT `claimsSocietyId` fallback removed (`server/src/auth.ts#L294`); live PG 16 proves `UPDATE users SET society_id = NULL` yields `403 TENANT_CONTEXT_REQUIRED`; `GET /passes/:id` enforces active-only filter for `guard`. |
| **F-B22-04** | MEDIUM (Blocking) | **`PASS`** | No | Independently verified by code inspection; Independently reproduced through an HTTP test | Bounded `5,000`-bucket store, periodic sweeps, fail-closed `429 RATE_LIMIT_CAPACITY_EXCEEDED`, `authContext.userId` keying (immune to `X-Forwarded-For`), and `POST /passes` throttled (`20/10m`). |
| **F-B22-05** | MEDIUM (Hardening) | **`PASS`** | No | Independently verified by code inspection; Independently reproduced against live PostgreSQL | Consistent `SELECT ... FOR UPDATE` row lock on `child_profiles` across `verify`, `sos`, and `resolve`; live PG 16 proves concurrent `SOS vs verify` preserves `MISSING` and never double-spends passes. |
| **F-B22-06** | MEDIUM (Hardening) | **`PASS`** | No | Independently verified by code inspection; Independently reproduced through an HTTP test; Independently reproduced against live PostgreSQL | Concurrent duplicate `MISSING_CHILD` SOS returns `[201, 409]` in live PG 16; `validateContactList()` enforced on create & update; `REVOKED`/`EXPIRED` pickup reactivation rules enforced. *(Defense-in-depth note: partial unique index in PG not yet present.)* |
| **F-B22-07** | LOW (Testing) | **`PARTIAL`** | No (Tied to `01`/`02`) | Independently reproduced through an HTTP test; Independently reproduced against live PostgreSQL | Existing `83/83` focused, `9/9` live PG 16, and `348/348` full offline tests are genuine and pass, but miss tests for the newly discovered `F-B22-01A/B/C` and `F-B22-02A/B/C` bypasses and `SOS vs Resolve` race. |

---

## 2. Domain Security Posture Summary

| Security Control Domain | Status | Independent Assessment |
| --- | --- | --- |
| Authoritative `/api/children/*` Authentication & RBAC | **PASS** | Globally behind `authenticateToken`; `resolveChildSafetyActor` + `enforceAllowedRoles` deny-by-default; zero forged header trust. |
| Database-Authoritative Identity (`server/src/auth.ts`) | **PASS** | Current PostgreSQL `user.role`, `user.societyId`, and `user.status` authoritative across HMAC and Firebase paths. |
| Gate Pass Cryptography & Fail-Closed Verification | **PASS** | 256-bit CSPRNG bearer token, SHA-256 hash-only DB storage, constant-time compare, `503 VERIFICATION_UNAVAILABLE` on DB outage, zero offline approval. |
| Child Safety Concurrency & Transactional Atomicity | **PASS** | `FOR UPDATE` serialization on `child_profiles`, conditional atomic `currentUses` increment, proven live PostgreSQL trigger rollback. |
| Child Safety Input Validation & Pickup Lifecycle | **PASS** | Structured `validateContactList`, raw ID field rejection, immutable field blocking, strict `REVOKED`/`EXPIRED` pickup rules. |
| Rate Limiting & DoS Resilience | **PASS** | Bounded memory, deterministic sweeps, fail-closed capacity `429`, `Retry-After`, trusted identity keying. |
| Generic Collection / `EntityRecord` Isolation | **`FAIL`** | **Blocked by `F-B22-01A`, `F-B22-01B`, `F-B22-01C`** (`GET /api/collections/entityRecord(/:id)`, `GET /api/collections/emergencyIncident`, unscoped `PATCH /api/housekeeping/tasks/:id` & `POST /api/amenities/bookings/:id/cancel`). |
| Realtime SSE & Broadcast Authorization | **`FAIL`** | **Blocked by `F-B22-02A`, `F-B22-02B`** (`POST /api/realtime/broadcast` cross-society & `_audience` forgery; `isClientAuthorizedForEvent` fail-open on `EMERGENCY_INCIDENT_CREATED` / `{}`). |
| Phase B.1 Visitor Pass Non-Regression | **PASS** | `30/30` route tests + `issue06_visitor_pass_api.test.ts` pass; zero Visitor Pass files modified. |

