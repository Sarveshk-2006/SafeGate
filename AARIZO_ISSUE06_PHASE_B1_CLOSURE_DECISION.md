# AARIZO — ISSUE-06, Phase B.1: Closure Decision & Roadmap

**Project:** `D:\AAZIRA\AARIZO`  
**Parent Issue:** `ISSUE-06` — Tri-Tier State Desynchronization  
**Phase Target:** B.1 — Visitor Pass Authoritative API  
**Auditor:** Independent Quality & Security Inspector  
**Date:** 2026-11-17  

---

## 1. Final Decision

### **CONDITIONAL PASS — MINOR CORRECTIONS REQUIRED**

---

## 2. Decision Rationale

### Why Phase B.1 Does NOT Fail
1. **Zero Authorization Bypasses:** In-depth audit confirmed that `req.societyId` originates exclusively from verified cryptographic credentials, all default society fallbacks (`soc-gvs`) have been eradicated, and all 9 Visitor Pass endpoints fail closed with HTTP 403 `TENANT_CONTEXT_REQUIRED` when society context is absent.
2. **Zero Offline Gate Vulnerabilities:** In-depth audit confirmed that cached visitor passes return `isValid: false, isOffline: true, canAuthorizeEntry: false`. Guard UI components strictly suppress entry approval buttons during offline fallback, and gate check-in mutations fail closed when the server is unreachable.
3. **Zero Data Integrity Corruption:** Allowlisted persistence and authoritative field normalization prevent cache divergence between frontend and backend.
4. **Clean Code Boundaries:** No code outside the authorized Visitor Pass scope was modified. Child Safety, Flat Management, and Society Provisioning remain untouched.

### Why Full Closure is Deferred to Step B.1.1 (Conditional Requirements)
1. **Finding F-B1-08 (High Severity / Operational Blocker):**
   In `server/src/index.ts` line 48, declaring `const __dirname = (() => { ... })();` creates a lexical collision with the pre-existing CommonJS module wrapper parameter `__dirname` when imported in Jest via ts-jest. This causes a `SyntaxError: Identifier '__dirname' has already been declared`, preventing the 30 Supertest integration tests in `tests/issue06_visitor_pass_routes.test.ts` from executing in the automated `npm test` runner.
2. **Finding F-B1-07 (Medium Severity / Performance Defect):**
   While `POST /api/visitor-passes/verify` is tenant-scoped and uses `findFirst`, the `VisitorPass` model in `server/prisma/schema.prisma` has **no indexes defined**, and `scripts/postgres/01_schema.sql` lacks an index on `qr_code_hash`. A schema migration with compound and trigram indexes is required to prevent sequential table scans during gate verification.
3. **Live PostgreSQL Infrastructure Validation Pending:**
   As with ISSUE-05 (Step 5.8), all automated tests currently execute against in-memory mocks due to the host port 5432 conflict with external `nexus-postgres`. Full formal closure of ISSUE-06 in the Master Issue Register requires validation against a live isolated database instance.

---

## 3. Minimum Remediation Requirements for Full Closure

To achieve full unconditional closure of Phase B.1, the following targeted corrections must be executed:

### Correction 1 (Resolves F-B1-08):
In [server/src/index.ts](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L48):
Replace:
```typescript
const __dirname = (() => {
  try {
    const getImportMetaUrl = new Function('return import.meta.url');
    return path.dirname(fileURLToPath(getImportMetaUrl()));
  } catch {
    return process.cwd();
  }
})();
```
With:
```typescript
const currentDir = typeof __dirname !== 'undefined'
  ? __dirname
  : (() => {
      try {
        const getImportMetaUrl = new Function('return import.meta.url');
        return path.dirname(fileURLToPath(getImportMetaUrl()));
      } catch {
        return process.cwd();
      }
    })();
```
And replace usages of `__dirname` at lines 84 and 4119 with `currentDir`.

### Correction 2 (Resolves F-B1-07):
In [server/prisma/schema.prisma](file:///d:/AAZIRA/AARIZO/server/prisma/schema.prisma#L347):
Add compound indexes to `model VisitorPass`:
```prisma
  @@index([societyId, validFrom, validTo])
  @@index([societyId, qrCodeHash])
  @@index([societyId, phone])
```
And in `scripts/postgres/01_schema.sql`, add:
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_passes_qr_trgm ON visitor_passes USING gin (qr_code_hash gin_trgm_ops);
```

### Correction 3 (Execution Verification):
Re-run the full test runner (`npm test`) and confirm:
- 17/17 test suites pass.
- 296/296 tests pass without syntax or compilation errors.

---

## 4. Phase B.2 Readiness Protocol

- **Status:** **HOLD — Do NOT begin Phase B.2 until Correction 1 and Correction 3 are applied.**
- Once Correction 1 is applied and 296/296 tests pass in the Jest runner, Phase B.1 will be fully closed, and Phase B.2 (Child Safety Authoritative API) may be initiated.

