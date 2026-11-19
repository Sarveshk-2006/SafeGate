# AARIZO — ISSUE-06 / Phase B.2.2 SOS & Realtime Security Audit

**Project:** `D:\AAZIRA\AARIZO`  
**Phase:** ISSUE-06 — B.2.2 Secure Child Safety Backend APIs  
**Mode:** STRICT READ-ONLY INDEPENDENT AUDIT  
**Audit Date:** November 18, 2026  

---

## 1. SOS Authorization & Transaction Audit

Inspected [server/src/childSafety/router.ts#L954-L1377](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L954-L1377):

| SOS Security Requirement | Audit Result | Evidence & Notes |
| :--- | :---: | :--- |
| Authenticated actors required | **PASS** | Global `authenticateToken` + `resolveChildSafetyActor` (`401` when missing/invalid). |
| Explicit role restriction (`vendor`/`facility_manager` blocked) | **PASS** | `SOS_TRIGGER_ROLES = ['resident', 'guard', 'secretary', 'committee', 'admin']`; `SOS_MANAGE_ROLES = ['guard', 'secretary', 'committee', 'admin']`. Verified in tests. |
| Resident SOS restricted to owned child in own society | **PASS** | Resident MUST provide `childId` (`400 CHILD_ID_REQUIRED`), scoped to `actor.societyId` (`404` cross-society), ownership verified via DB `Resident` (`403` for unrelated resident). |
| Caller-supplied `societyId`, `residentId`, `guardianId`, actor IDs ignored | **PASS** | `ignoreBodySocietyId: true` ignores forged body `societyId`; `reportedById` and `reportedByName` come strictly from verified `actor`. Verified in both Supertest and live PG 16 tests. |
| Transactional `ChildSafetyAlert` + `EmergencyIncident` creation | **PASS** | Single `prisma.$transaction` creates `EmergencyIncident`, creates linked `ChildSafetyAlert`, and transitions `ChildProfile.status = 'MISSING'` for `MISSING_CHILD`. Partial failure rolls back cleanly and emits zero realtime events (verified in Supertest; live PG rollback test recommended per `F-B22-07`). |
| Tenant-scoped & role-authorized acknowledge/resolve | **PASS** | `SOS_MANAGE_ROLES` blocks residents/vendors (`403`); `{ id, societyId }` returns `404` cross-society; enforces `ACTIVE -> ACKNOWLEDGED` and `ACTIVE|ACKNOWLEDGED -> RESOLVED|FALSE_ALARM` (`422` on invalid transitions); preserves immutable original event fields. |
| Duplicate / repeated SOS handling | **GAP (`F-B22-06`)** | Rate limiter caps at 10 per 5 minutes, but repeated triggers for the same child currently create duplicate active `MISSING_CHILD` alerts and duplicate `EmergencyIncident` records instead of deduplicating active incidents. |

---

## 2. Realtime Event & SSE Security Audit (**FAIL — Blocking Finding `F-B22-02`**)

Inspected [server/src/childSafety/router.ts#L56-L83](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L56-L83) and [server/src/realtimeEngine.ts#L117-L229, #L359-L391](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L117-L229):

| Realtime Security Requirement | Audit Result | Evidence & Exact Defect |
| :--- | :---: | :--- |
| Published strictly AFTER DB commit | **PASS** | All `emitChildSafetyEvent(...)` calls execute after `await prisma.$transaction(...)` or `await prisma.*.create/updateMany(...)` succeeds. Rolled-back transactions never reach `emitChildSafetyEvent`. |
| Zero raw tokens, token hashes, or ID hashes in payloads | **PASS** | Inspected every `emitChildSafetyEvent` call in `router.ts`: zero `bearerToken`, zero `tokenHash`, zero `idDocumentHash`, zero `idDocumentLast4`, zero `medicalNotes` or phone numbers. |
| Cross-society SSE subscription prevention | **FAIL (`F-B22-02`)** | `handleSseSubscription` ([realtimeEngine.ts#L374, #L383-L385](file:///D:/AAZIRA/AARIZO/server/src/realtimeEngine.ts#L374)) checks `userRole !== 'admin'` instead of `isPlatformAdmin`, allowing a **society-bound admin** (`societyId: 'soc-a'`) to subscribe to `?societyId=soc-b` and receive Society B's Child Safety & SOS stream. Also falls back to `'soc-gvs'` when `authContext.societyId` is empty. |
| Intra-society role/ownership filtering on Child Safety SSE events | **FAIL (`F-B22-02`)** | `emitChildSafetyEvent` passes NO role or user filter to `recordOutboxEvent`/`broadcastToSociety`. Consequently, `vendor`, `facility_manager`, and unrelated `resident` SSE subscribers in the society receive all `CHILD_PROFILE_*`, `CHILD_GATE_PASS_*`, `CHILD_EXIT_*`, and `CHILD_SAFETY_*` frames (and `replayEventsSince` replays them unconditionally to every client in `societyId`). |

---

## 3. Conclusion

The SOS endpoint authorization, ownership checks, and atomic `EmergencyIncident` + `ChildSafetyAlert` persistence are **strong and verified**, **but** the realtime SSE subscription and delivery layer has a **blocking HIGH finding (`F-B22-02`)** allowing society-bound admins cross-tenant subscriptions and leaking Child Safety movement/pass/SOS events to `vendor`, `facility_manager`, and unrelated `resident` clients within the society.

