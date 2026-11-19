# AARIZO — ISSUE-06 / Phase B.2.1 Remaining Risks & B.2.2 Handoff Requirements

**Project:** `D:\AAZIRA\AARIZO`  
**Phase:** ISSUE-06 — B.2.1 Child Safety Relational Database Foundation (Remediation)  
**Date:** November 18, 2026  

---

## 1. Risks Still Open Beyond Phase B.2.1 Scope (Must Be Addressed in B.2.2 / B.2.3)

| Risk ID | Severity | Description | Required Mitigation Phase & Action |
| :--- | :---: | :--- | :--- |
| **R-B21-01** | **CRITICAL** | **Legacy Child Safety API routes are still active** in [server/src/index.ts#L2675-L2785](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2675-L2785) (writing to `EntityRecord`, using fallback `'soc-gvs'`, lacking strict role/ownership checks on `POST /api/children/sos`). | **Phase B.2.2:** Replace all child-safety routes with fail-closed, tenant-isolated, role-and-ownership-enforced APIs backed by the 5 remediated relational models. |
| **R-B21-02** | **HIGH** | **Pass-code brute-force & bearer-token handling** cannot be fully enforced by schema alone. Database enforces 64-hex `token_hash` format and per-society `pass_code` uniqueness, but B.2.2 must generate >= 256-bit CSPRNG tokens (`crypto.randomBytes(32)`), compute server-keyed `HMAC-SHA256(CHILD_PASS_TOKEN_PEPPER, rawToken)`, enforce rate limiting, and NEVER accept `passCode` as standalone gate authorization. | **Phase B.2.2:** Implement cryptographic pass issuance, constant-time/indexed `token_hash` lookup, atomic conditional consumption (`UPDATE ... WHERE status = 'ACTIVE' AND current_uses < max_uses`), and strict DTO redaction omitting `tokenHash` from list responses. |
| **R-B21-03** | **HIGH** | **Gate scanner fail-closed UX when backend is unreachable:** Database now prohibits recording `(BACKEND_UNAVAILABLE, ALLOWED)`, but gate scanner frontend & service layers must explicitly refuse approval when offline and queue/log `VERIFICATION_UNAVAILABLE` upon recovery without ever showing a green approval state. | **Phase B.2.2 / B.2.3:** Implement explicit unavailable/indeterminate UI state in gate scanner and guard terminal; remove any client-side local pass verification. |
| **R-B21-04** | **HIGH** | **Resident-to-Flat alignment within the same society:** Composite FKs guarantee `child_profiles.resident_id` and `child_profiles.flat_id` belong to the same `society_id`, but a resident in Flat A-101 could still be linked to Flat A-102 in the same society unless checked in the write transaction. | **Phase B.2.2:** Inside `POST/PATCH /api/children` transactions, verify `resident.flatId === flatId` (or approved multi-flat ownership) before persisting. |
| **R-B21-05** | **MEDIUM** | **Legacy `localStorage` & `EntityRecord` PII retention:** Historical `entity_records` JSON blobs and browser `localStorage` entries may still contain legacy `idProofNumber` strings until post-cutover retirement. | **Phase B.2.3 & Post-Cutover Cleanup:** Retire browser `localStorage` child-safety caches, complete quarantine reconciliation, and run a controlled redaction/purge of legacy `entity_records` child collections after sign-off. |
| **R-B21-06** | **MEDIUM** | **Continuous CI execution of live PostgreSQL constraint tests:** [tests/issue06_child_safety_db_constraints.test.ts](file:///D:/AAZIRA/AARIZO/tests/issue06_child_safety_db_constraints.test.ts) passed against an isolated local `postgres:16-alpine` container during remediation, but is skipped during default offline `npm test` unless `AARIZO_ISOLATED_TEST_DATABASE_URL` is configured. | **CI/DevOps:** Wire a dedicated ephemeral PostgreSQL 16 service container in CI passing `AARIZO_ISOLATED_TEST_DATABASE_URL` so live constraint tests execute on every PR. |
| **R-B21-07** | **LOW** | **Pre-existing `IncidentSeverity` vs `incident_severity` casing split** between Prisma baseline `init_dwellora` and raw SQL `01_schema.sql` remains documented (both define identical `LOW, MEDIUM, HIGH, CRITICAL` values). | **Documented Convention:** Keep consistent across future migrations; only unify if a coordinated baseline migration overhaul is scheduled. |

---

## 2. Operational Constraints Confirmed Preserved

- Unrelated external container `nexus-postgres` (port `5432`) was **never touched**.
- Ephemeral `postgres:16-alpine` test container used for live verification was **removed cleanly**.
- Phase B.1 Visitor Pass schema, indexes, routes, and tests remain **100% intact** (`tests/issue06_visitor_pass_api.test.ts` and `tests/issue06_visitor_pass_routes.test.ts` passed).
- No Git commits or pushes were created.
