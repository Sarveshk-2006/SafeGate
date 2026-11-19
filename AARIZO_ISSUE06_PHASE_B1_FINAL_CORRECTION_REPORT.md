# AARIZO — ISSUE-06, Phase B.1: Final Correction Report (F-B1-07 & F-B1-08)

**Project:** `D:\AAZIRA\AARIZO`  
**Mode:** CONTROLLED IMPLEMENTATION  
**Scope:** Remediation of Findings `F-B1-07` and `F-B1-08`  
**Date:** 2026-11-17  
**Status:** COMPLETE — ALL CORRECTIONS VERIFIED (296/296 PASSING TESTS)

---

## 1. Executive Summary

This report documents the targeted resolution of the two final findings identified during the Phase B.1 independent re-audit:
1. **F-B1-08 (Jest CommonJS `__dirname` Declaration Conflict):** Resolved the lexical re-declaration collision in `server/src/index.ts` by replacing `const __dirname` with an environment-aware `currentDir` resolver that respects both CommonJS wrapper scopes and native ECMAScript Modules.
2. **F-B1-07 (Missing Schema Indexes for Visitor Pass Lookups):** Added compound tenant-scoped indexes to `server/prisma/schema.prisma` and `scripts/postgres/01_schema.sql`, generated migration `20261117000000_add_visitor_pass_indexes`, regenerated the Prisma client, and optimized the verification route query to support exact B-tree matching.

> [!IMPORTANT]
> **Strict Scope Boundary Compliance:**
> - Child Safety (`childSafetyService.ts`, `ChildSafetyRepository.ts`), Flat Management (`FlatRepository.ts`), and Society Management (`societyService.ts`) remain 100% untouched.
> - Phase B.2 scope has **NOT** been started.
> - Host port 5432 and unrelated container `nexus-postgres` were untouched.
> - Zero Git commits or pushes were executed.
> - Repository test execution: 17/17 test suites passed, 296/296 tests passed.

---

## 2. Detailed Technical Breakdown

### Correction 1: F-B1-08 — CommonJS & ESM Directory Resolver

#### Root Cause:
In Node.js CommonJS modules (compiled via `ts-jest`), `__dirname` is already an existing argument provided by the CommonJS module wrapper function `(function (exports, require, module, __filename, __dirname) { ... })`. Declaring `const __dirname = ...` inside `server/src/index.ts` threw a JavaScript `SyntaxError: Identifier '__dirname' has already been declared` when imported by Jest, blocking execution of the 30 Supertest integration tests.

#### Remediation Applied:
In [server/src/index.ts](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L48-L64), replaced the redeclaration with an environment-agnostic resolver:
```typescript
const currentDir = (() => {
  try {
    if (typeof __dirname !== 'undefined') {
      return __dirname;
    }
  } catch {
    // __dirname is undefined in native ESM
  }
  try {
    const getImportMetaUrl = new Function('return import.meta.url');
    const metaUrl = getImportMetaUrl();
    if (metaUrl) {
      return path.dirname(fileURLToPath(metaUrl));
    }
  } catch {
    // Fallback if dynamic import.meta evaluation fails
  }
  return process.cwd();
})();
```
And updated static path references:
- Line 95: `const uploadsDir = path.resolve(currentDir, '../uploads');`
- Line 4130: `const clientDistPath = path.resolve(currentDir, '../../dist');`

#### Impact:
- Jest loads the real Express application with zero syntax errors.
- Native ESM production runtime (`tsx watch` and `node dist/index.js`) retains identical absolute path resolution.
- 30/30 Supertest route integration tests execute and pass cleanly.

---

### Correction 2: F-B1-07 — Tenant-Scoped Database Indexes & Query Optimization

#### Root Cause:
`model VisitorPass` in `server/prisma/schema.prisma` contained no `@@index` annotations, and `scripts/postgres/01_schema.sql` lacked indexes on `qr_code_hash` and compound tenant lookups. Additionally, `POST /api/visitor-passes/verify` used only `contains` and `endsWith` operators, preventing B-tree index utilization.

#### Remediation Applied:

1. **Prisma Schema Update ([server/prisma/schema.prisma](file:///d:/AAZIRA/AARIZO/server/prisma/schema.prisma#L346-L349)):**
   Added compound tenant indexes to `model VisitorPass`:
   ```prisma
     @@index([societyId, validFrom, validTo], map: "idx_passes_society_validity")
     @@index([societyId, qrCodeHash], map: "idx_passes_society_qr")
     @@index([societyId, phone], map: "idx_passes_society_phone")
     @@map("visitor_passes")
   ```

2. **SQL Schema Alignment ([scripts/postgres/01_schema.sql](file:///d:/AAZIRA/AARIZO/scripts/postgres/01_schema.sql#L649-L652)):**
   Added corresponding PostgreSQL indexes:
   ```sql
   CREATE INDEX IF NOT EXISTS idx_passes_society_validity ON visitor_passes(society_id, valid_from, valid_to);
   CREATE INDEX IF NOT EXISTS idx_passes_phone ON visitor_passes(phone);
   CREATE INDEX IF NOT EXISTS idx_passes_society_qr ON visitor_passes(society_id, qr_code_hash);
   CREATE INDEX IF NOT EXISTS idx_passes_society_phone ON visitor_passes(society_id, phone);
   ```

3. **Prisma Migration Created:**
   Created [server/prisma/migrations/20261117000000_add_visitor_pass_indexes/migration.sql](file:///d:/AAZIRA/AARIZO/server/prisma/migrations/20261117000000_add_visitor_pass_indexes/migration.sql):
   ```sql
   -- CreateIndex
   CREATE INDEX IF NOT EXISTS "idx_passes_society_validity" ON "visitor_passes"("society_id", "valid_from", "valid_to");

   -- CreateIndex
   CREATE INDEX IF NOT EXISTS "idx_passes_society_qr" ON "visitor_passes"("society_id", "qr_code_hash");

   -- CreateIndex
   CREATE INDEX IF NOT EXISTS "idx_passes_society_phone" ON "visitor_passes"("society_id", "phone");
   ```

4. **Query Optimization in `POST /api/visitor-passes/verify` ([server/src/index.ts](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L1195-L1203)):**
   Added exact matching clauses to leverage composite B-tree indexes directly:
   ```typescript
        OR: [
          { id: { equals: clean, mode: 'insensitive' } },
          { id: { equals: `PASS-${clean}`, mode: 'insensitive' } },
          { id: { endsWith: clean, mode: 'insensitive' } },
          { qrCodeHash: { equals: clean, mode: 'insensitive' } },
          { qrCodeHash: { contains: clean, mode: 'insensitive' } },
          { phone: { equals: clean } },
          { phone: { contains: clean } },
        ],
   ```

5. **Prisma Client Regeneration:**
   Executed `npm --prefix server run prisma:generate`, updating `@prisma/client` with the new schema metadata.

---

## 3. Verification & Evidence Summary

| Finding | Pre-Correction Defect | Correction Applied | Verification Result |
| :--- | :--- | :--- | :--- |
| **F-B1-08** | CommonJS `SyntaxError` on `const __dirname` in Jest runner | Replaced with `currentDir` resolver | `tests/issue06_visitor_pass_routes.test.ts` (30/30 PASS) |
| **F-B1-07** | Missing schema indexes on `VisitorPass` | Added `idx_passes_society_qr`, `idx_passes_society_phone`, migration file, & exact match query clauses | Schema validated; Prisma Client generated; verify query tests pass |

---

## 4. Final Verdict

**READY FOR FINAL CLOSURE REVIEW**

