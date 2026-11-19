# AARIZO — ISSUE-06 / Phase B.2.2 SOS Authorization & Incident Audit

**Project:** `D:\AAZIRA\AARIZO`  
**Phase:** ISSUE-06 — B.2.2 Secure Child Safety Backend APIs  
**Source:** [server/src/childSafety/router.ts#L769-L1080](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L769-L1080)  
**Date:** November 18, 2026  

---

## 1. Closure of Legacy B.2 Critical SOS Findings

| Legacy Vulnerability | B.2.2 Remediation | Source Reference |
| :--- | :--- | :--- |
| Unscoped `POST /api/children/sos` with `'soc-gvs'` fallback and trusting `req.body.societyId` | Strictly resolves `actor` from verified `req.authContext`; ignores caller-supplied `societyId`, `residentId`, `guardianId`, `reportedById`, `actorId` (`ignoreBodySocietyId: true`); zero `'soc-gvs'` fallback. | [authz.ts#L34-L103](file:///D:/AAZIRA/AARIZO/server/src/childSafety/authz.ts#L34-L103), [router.ts#L774-L780](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L774-L780) |
| Missing role restrictions (`vendor`, `facility_manager` could trigger SOS) | Explicit `enforceAllowedRoles(actor, ['resident', 'guard', 'secretary', 'committee', 'admin'], res)` blocks `vendor` and `facility_manager` (`403 INSUFFICIENT_PERMISSIONS`). | [router.ts#L45](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L45), [#L781](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L781) |
| Unrelated residents could trigger SOS on arbitrary children | Residents MUST supply a valid `childId` (`400 CHILD_ID_REQUIRED`) and MUST hold DB-verified ownership (`child.residentId === ownership.residentId || child.guardianUserId === actor.userId`), else `403 UNAUTHORIZED_SOS_TRIGGER`. Cross-society `childId` returns `404`. | [router.ts#L815-L855](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L815-L855) |
| Non-atomic alert creation (only `EmergencyIncident`, no `ChildSafetyAlert`, no `MISSING` block) | Single `prisma.$transaction` creates `EmergencyIncident` + linked `ChildSafetyAlert` (with `reportedById` + `reportedByName`) + transitions `ChildProfile.status = 'MISSING'` for `MISSING_CHILD` alerts. Partial failure rolls back everything and emits ZERO realtime events. | [router.ts#L872-L917](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L872-L917) |
| Missing acknowledgement / resolution access controls | `POST /api/children/alerts/:id/acknowledge` and `/resolve` restricted strictly to `['guard', 'secretary', 'committee', 'admin']` (residents/vendors denied `403`), tenant-scoped `{ id, societyId }`, with strict transition enforcement (`ACTIVE -> ACKNOWLEDGED`, `ACTIVE|ACKNOWLEDGED -> RESOLVED|FALSE_ALARM`, `422` on invalid transitions). | [router.ts#L984-L1140](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L984-L1140) |
| No SOS abuse protection | Dedicated `childSosRateLimiter()` (`10 requests / 5 minutes` per actor+society) returning HTTP `429` with `Retry-After`. | [rateLimit.ts#L57-L64](file:///D:/AAZIRA/AARIZO/server/src/childSafety/rateLimit.ts#L57-L64) |

---

## 2. Audit & Historical Context Preservation

- **Original SOS details are immutable:** Acknowledge and resolve operations ONLY update `status`, `acknowledgedAt`, `acknowledgedById`, `acknowledgedByName`, `resolvedAt`, `resolvedById`, `resolvedByName`, and `resolutionNotes` — preserving `childName`, `flatNumber`, `alertType`, `severity`, `location`, `description`, `lastSeenDetails`, `reportedById`, `reportedByName`, and `createdAt` verbatim.
- **Incident & Child Status Synchronization:** Resolving an alert atomically marks the linked `EmergencyIncident` `RESOLVED` (`resolvedAt = now`) and restores `ChildProfile.status` from `MISSING` to `SAFE` **only if** zero other `ACTIVE`/`ACKNOWLEDGED` `MISSING_CHILD` alerts exist for that child.
- **Profile PATCH guard:** [router.ts#L1265-L1281](file:///D:/AAZIRA/AARIZO/server/src/childSafety/router.ts#L1265-L1281) prevents clearing `ChildProfile.status = 'MISSING'` via `PATCH /api/children/:id` while an active `MISSING_CHILD` alert remains unresolved (`409 ACTIVE_MISSING_ALERT_MUST_BE_RESOLVED`).

