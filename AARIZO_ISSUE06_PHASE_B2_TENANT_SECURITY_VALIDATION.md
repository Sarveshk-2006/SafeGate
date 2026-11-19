# AARIZO — ISSUE-06 Phase B.2: Tenant Security & Isolation Validation

**Project:** `D:\AAZIRA\AARIZO`  
**Phase:** ISSUE-06 — B.2 Child Safety & Biometric Gate Radar  
**Document:** Multi-Tenant Isolation & Security Boundary Audit  
**Mode:** STRICT READ-ONLY SECURITY AUDIT  
**Status:** COMPLETED  

---

## 1. Tenant Authentication & Context Resolution Audit

### 1.1 Population of `req.authContext`
The authentication pipeline was audited starting at [server/src/auth.ts#L206-L315](file:///D:/AAZIRA/AARIZO/server/src/auth.ts#L206-L315) and [server/src/index.ts#L129-L144](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L129-L144):
1. Every request to `/api/*` (outside public health/auth routes) is intercepted by `authenticateToken`.
2. `authenticateToken` validates the cryptographic Bearer token (server-issued HMAC-SHA256 or Firebase ID token).
3. The user ID is looked up in the authoritative PostgreSQL database via `prisma.user.findFirst`.
4. If found and `status === ACTIVE`, `req.authContext` is populated with:
   ```ts
   req.authContext = {
     userId: user.id,
     firebaseUid: uid,
     email: user.email,
     role: effectiveRole,
     societyId: effectiveSocietyId,
     name: user.name,
   };
   ```
5. In [server/src/index.ts#L139-L144](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L139-L144), Express middleware copies these values onto the request:
   ```ts
   req.societyId = req.authContext?.societyId;
   req.userId = req.authContext?.userId;
   req.userRole = req.authContext?.role;
   ```

**Verdict:** `req.authContext`, `req.societyId`, `req.userId`, and `req.userRole` are correctly populated from verified PostgreSQL database records.

---

## 2. Child Safety Endpoints Tenant Vulnerability Analysis

While `req.societyId` is populated correctly by the authentication layer, the Child Safety route handlers in [server/src/index.ts#L2658-L2786](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L2658-L2786) fail to enforce tenant boundaries.

### 2.1 Detailed Endpoint Audit

#### 1. `GET /api/children` (Line 2660)
- **Code:**
  ```ts
  const societyId = req.societyId || (req.query.societyId as string) || 'soc-gvs';
  const residentId = req.userId || (req.query.residentId as string);
  const where: any = { collection: 'child_profiles' };
  if (societyId && societyId !== 'all') where.societyId = societyId;
  const records = await prisma.entityRecord.findMany({ where, orderBy: { createdAt: 'desc' } });
  const children = records.map((r) => ({ id: r.id, societyId: r.societyId, ...(r.data as any), createdAt: r.createdAt }));
  const filtered = residentId && req.userRole === 'resident' ? children.filter((c: any) => c.residentId === residentId) : children;
  res.json(filtered);
  ```
- **Vulnerabilities:**
  1. **Query Override:** If `req.societyId` is not present on the user, `req.query.societyId` is accepted without membership validation.
  2. **Hardcoded Fallback:** Falls back to `'soc-gvs'` instead of returning HTTP 403.
  3. **Role Check Missing:** Route lacks `requireRole`.
  4. **Resident Leaking:** If `req.userRole !== 'resident'` (or if an attacker crafts a token with a custom or undefined role), `filtered` returns **all children in the society**.

#### 2. `POST /api/children` (Line 2675)
- **Code:**
  ```ts
  const societyId = req.societyId || req.body.societyId || 'soc-gvs';
  ...
  await prisma.entityRecord.create({
    data: { id, collection: 'child_profiles', societyId, data: childData },
  });
  ```
- **Vulnerabilities:**
  1. **Body Override:** Accepts `req.body.societyId` when `req.societyId` is falsy.
  2. **Hardcoded Fallback:** Falls back to `'soc-gvs'`.
  3. **Foreign Child Creation:** A resident in Society A can inject child profiles into Society B by passing `societyId` in body if their user object lacks a societyId.

#### 3. `GET /api/children/passes` (Line 2701)
- **Code:**
  ```ts
  const societyId = req.societyId || (req.query.societyId as string) || 'soc-gvs';
  const records = await prisma.entityRecord.findMany({
    where: { collection: 'child_gate_passes', societyId: societyId !== 'all' ? societyId : undefined },
    orderBy: { createdAt: 'desc' },
  });
  ```
- **Vulnerabilities:**
  1. **Zero Resident Scoping:** Returns ALL child passes across the entire society to ANY caller.
  2. **Query Override:** Accepts `?societyId=other`.
  3. **Hardcoded Fallback:** Falls back to `'soc-gvs'`.

#### 4. `POST /api/children/passes` (Line 2715)
- **Code:**
  ```ts
  const societyId = req.societyId || req.body.societyId || 'soc-gvs';
  ```
- **Vulnerabilities:**
  1. **Body Override:** Accepts `req.body.societyId`.
  2. **Custody Verification Missing:** Any resident in the society can create an exit pass for ANY child profile, even if they do not reside in the flat or have guardian custody.

#### 5. `POST /api/children/passes/:id/verify` (Line 2743)
- **Code:**
  ```ts
  const id = String(req.params.id);
  const { guardName, gate } = req.body;
  const record = await prisma.entityRecord.findUnique({ where: { id } });
  if (!record) return res.status(404).json({ error: 'Child pass not found' });
  ...
  await prisma.entityRecord.update({
    where: { id },
    data: { data: updatedData, updatedAt: new Date() },
  });
  broadcastEvent('CHILD_GATE_PASS_VERIFIED', updatedData, record.societyId);
  ```
- **Vulnerabilities:**
  1. **Zero Tenant Check:** **No comparison between `record.societyId` and `req.societyId`.**
  2. **Cross-Society Pass Exit:** A security guard from Society A can exit a child in Society B simply by passing the pass ID.

#### 6. `POST /api/children/sos` (Line 2767)
- **Code:**
  ```ts
  const societyId = req.societyId || req.body.societyId || 'soc-gvs';
  ```
- **Vulnerabilities:**
  1. **Body Override:** Allows injecting emergency incidents into any society.
  2. **Hardcoded Fallback:** Falls back to `'soc-gvs'`.

---

## 3. Platform Admin Privilege Policy Verification

In Phase B.1, the platform admin policy was established at [server/src/index.ts#L685-L697](file:///D:/AAZIRA/AARIZO/server/src/index.ts#L685-L697):
```ts
const isPlatform = isPlatformAdmin(req);
if (!isPlatform && !req.societyId) {
  return res.status(403).json({ error: 'Tenant context required', code: 'TENANT_CONTEXT_REQUIRED' });
}
if (!isPlatform && req.query.societyId && String(req.query.societyId) !== req.societyId) {
  return res.status(403).json({ error: 'Access denied: Cannot query another society', code: 'TENANT_ISOLATION_VIOLATION' });
}
const effectiveSocietyId = isPlatform && req.query.societyId ? String(req.query.societyId) : req.societyId;
```

**Audit Result for Child Safety:**
- Child Safety routes **do NOT implement `isPlatformAdmin(req)`**.
- Non-admin users are treated with the same loose fallback logic as platform admins.
- There is no privileged-access policy distinction between standard users and platform administrators.

---

## 4. Required Tenant Isolation Controls Matrix

Every Child Safety endpoint must be refactored to enforce the following verified security specifications:

| Endpoint | Method | Required Role Middleware | Fail-Closed Policy | Tenant Validation Rule | Resident Scoping Rule |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/children` | `GET` | `requireRole(['resident', 'guard', 'secretary', 'admin'])` | 403 `TENANT_CONTEXT_REQUIRED` if `!req.societyId` | Reject `?societyId=` if `!== req.societyId` (403 `TENANT_ISOLATION_VIOLATION`) | Filter `residentId === req.userId` if role is `resident` |
| `/api/children` | `POST` | `requireRole(['resident', 'secretary', 'admin'])` | 403 `TENANT_CONTEXT_REQUIRED` if `!req.societyId` | `societyId` strictly bound to `req.societyId` | `residentId` strictly bound to `req.userId` if role is `resident` |
| `/api/children/:id` | `GET` | `requireRole(['resident', 'guard', 'secretary', 'admin'])` | 403 `TENANT_CONTEXT_REQUIRED` | Must match `societyId: req.societyId` | If resident, must match child in resident's flat/custody |
| `/api/children/passes` | `GET` | `requireRole(['resident', 'guard', 'secretary', 'admin'])` | 403 `TENANT_CONTEXT_REQUIRED` | Must match `societyId: req.societyId` | If resident, must only return passes for resident's children |
| `/api/children/passes` | `POST` | `requireRole(['resident', 'secretary', 'admin'])` | 403 `TENANT_CONTEXT_REQUIRED` | `societyId` strictly bound to `req.societyId` | If resident, must verify custody of `childId` |
| `/api/children/passes/verify`| `POST` | `requireRole(['guard', 'secretary', 'admin'])` | 403 `TENANT_CONTEXT_REQUIRED` | Pass query MUST include `where: { passCode, societyId: req.societyId }` | N/A (Guards and Admins only) |
| `/api/children/sos` | `POST` | `requireRole(['resident', 'guard', 'secretary', 'admin'])` | 403 `TENANT_CONTEXT_REQUIRED` | `societyId` strictly bound to `req.societyId` | Must verify user belongs to specified society and flat |

