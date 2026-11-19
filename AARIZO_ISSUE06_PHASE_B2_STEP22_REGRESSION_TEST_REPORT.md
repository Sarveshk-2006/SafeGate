# AARIZO — ISSUE-06 PHASE B.2.2 REGRESSION & BUILD TEST REPORT

**Project:** `D:\AAZIRA\AARIZO`  
**Date:** 2026-11-18  
**Status:** **`REMEDIATION COMPLETE — READY FOR FINAL INDEPENDENT RE-AUDIT`**

---

## 1. Test Classification Summary

| Category | Executed | Passed | Failed | Skipped | Exit Code |
| --- | --- | --- | --- | --- | --- |
| **Focused Offline Suites (6 suites)** | 98 | **98** | 0 | 0 | `0` (21.838 s) |
| **Live Isolated PostgreSQL 16 Suites (2 suites, `127.0.0.1:5444`)** | 11 | **11** | 0 | 0 | `0` (6.983 s) |
| **Full Offline Suite (`npm test`, 23 suites total)** | 363 | **363** | 0 | 11 *(strictly the 2 live PG suites above)* | `0` (34.305 s) |
| **Backend Build (`npm --prefix server run build`)** | `tsc` | **PASS** | — | — | `0` |
| **Frontend Build (`npm run build`)** | `tsc -b && vite build` | **PASS** | — | — | `0` (2,179 modules) |
| **Prisma Schema Validation (`prisma validate`)** | `schema.prisma` | **PASS** | — | — | `0` |
| **Live Deployment Verification** | Staging / Prod | *Not Run* | — | — | Separate operational step |

---

## 2. Focused Offline Suites Breakdown (`98/98 PASS`)

Command:
`npx jest tests/issue06_child_safety_reaudit_fixes.test.ts tests/issue06_child_safety_remediation.test.ts tests/issue06_child_safety_api_routes.test.ts tests/issue06_visitor_pass_routes.test.ts tests/issue02_gap03_sse_authorization.test.ts tests/auth_middleware.test.ts --verbose`

| Suite | Passed | Scope Verified |
| --- | --- | --- |
| [tests/issue06_child_safety_reaudit_fixes.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_reaudit_fixes.test.ts) *(NEW)* | **15/15** | `F-B22-01A` (`entityRecord` aliases/detail/writes), `F-B22-01B` (`emergencyIncident`, `auditLog`, cross-society `PUT`/`DELETE` 404), `F-B22-01C` (`housekeeping/tasks/:id`, `amenities/bookings/:id/cancel`, `housekeeping/garbage-logs/confirm`), `F-B22-02A` (`POST /api/realtime/broadcast` role/event/tenant/metadata checks), `F-B22-02B` (`EMERGENCY_INCIDENT_CREATED` without `_audience` & `{}`, unknown roles, malformed society), `F-B22-02C` (tenant-scoped replay cursor). |
| [tests/issue06_child_safety_remediation.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_remediation.test.ts) | **16/16** | `F-B22-01`..`F-B22-07` first-pass remediation regression (including `F-B22-03`, `F-B22-04`, `F-B22-06`). |
| [tests/issue06_child_safety_api_routes.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_api_routes.test.ts) | **21/21** | Core Child Safety routes, CSPRNG token hash-only storage, fail-closed 503, SOS rollback. |
| [tests/issue06_visitor_pass_routes.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_visitor_pass_routes.test.ts) | **30/30** | Phase B.1 Visitor Pass non-regression. |
| [tests/issue02_gap03_sse_authorization.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue02_gap03_sse_authorization.test.ts) | **8/8** | GAP-03 SSE identity & tenant hardening non-regression. |
| [tests/auth_middleware.test.ts](file:///D:/AAZIRA/AARIZO/tests/auth_middleware.test.ts) | **8/8** | Core RBAC & tenant middleware non-regression. |

---

## 3. Full Offline Suite (`npm test`) Notes

- **21 suites passed, 2 skipped (23 total)** | **363 tests passed, 11 skipped (374 total)**.
- The 2 skipped suites (11 tests) are exclusively `tests/issue06_child_safety_db_constraints.test.ts` (3) and `tests/issue06_child_safety_api_pg_integration.test.ts` (8), gated by `AARIZO_ISOLATED_TEST_DATABASE_URL` and **verified 11/11 PASS** against disposable PostgreSQL 16 (`127.0.0.1:5444`).
- `tests/security.test.ts` passed overall while skipping local Firestore emulator rules checks (port `8088` offline; unrelated legacy Firebase rules).

