# AARIZO — Authentication Gap Remediation Plan

**Document ID**: AARIZO-PLAN-AUTH-GAP-001  
**Phase**: Phase A, Step 2.3  
**Target**: Technical Hardening & Gap Remediation for Unified Authentication Architecture  
**Author**: Principal Software Architect & Senior Security Auditor  
**Working Directory**: `d:\AAZIRA\AARIZO`  
**Date**: November 14, 2026  

---

## 1. Executive Summary

During the Phase A, Step 2.3 Security Verification Gate, the core P0 privilege escalation vulnerability was verified as eliminated. However, seven specific security and architectural gaps were identified across configuration, development fallbacks, realtime streaming, and repository data access.

This remediation plan provides the exact, smallest safe implementations required to resolve each gap without introducing breaking changes or regressions.

---

## 2. Actionable Gap Remediation Items

---

### GAP-01 [HIGH]: Hardcoded Fallback Secret in `getAuthSecret()`
- **Severity**: HIGH
- **File & Line**: `server/src/auth.ts:57-60`
- **Current Vulnerability**:
  ```ts
  const getAuthSecret = (): string => {
    return process.env.AUTH_SECRET || process.env.JWT_SECRET || 'aarizo_secure_production_secret_key_2026';
  };
  ```
  If environment variables are omitted, the server silently signs and validates tokens using a publicly visible hardcoded string.
- **Evidence**: Verified by inspecting `server/src/auth.ts` line 58.
- **Recommended Minimal Remediation**:
  Enforce strict fail-closed validation:
  ```ts
  const getAuthSecret = (): string => {
    const secret = process.env.AUTH_SECRET || process.env.JWT_SECRET;
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('FATAL: AUTH_SECRET or JWT_SECRET must be configured in production environment');
      }
      return 'aarizo_development_ephemeral_fallback_secret_only';
    }
    if (secret.length < 32 && process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: Production AUTH_SECRET must be at least 32 characters in length');
    }
    return secret;
  };
  ```

---

### GAP-02 [HIGH]: Development Mock Authentication Defaults to Enabled When `NODE_ENV` is Unset
- **Severity**: HIGH
- **File & Line**: `server/src/auth.ts:187-195`
- **Current Vulnerability**:
  ```ts
  if (process.env.NODE_ENV !== 'production' && token.startsWith('mock_token_')) {
    uid = token.replace('mock_token_', '');
  }
  ```
  In Node.js, `process.env.NODE_ENV` defaults to `undefined`. `undefined !== 'production'` evaluates to `true`. An attacker sending `mock_token_user-admin-1` can achieve full administrator takeover on an unconfigured server.
- **Evidence**: Verified by testing Node.js environment variable defaults.
- **Recommended Minimal Remediation**:
  Require explicit, opt-in development flags:
  ```ts
  const isDevMockAllowed = 
    process.env.NODE_ENV === 'development' && 
    process.env.ENABLE_DEV_MOCK_AUTH === 'true';

  if (isDevMockAllowed && token.startsWith('mock_token_')) {
    uid = token.replace('mock_token_', '');
  }
  ```

---

### GAP-03 [HIGH]: Realtime SSE Event Stream Parameter Override of Verified Claims
- **Severity**: HIGH
- **File & Line**: `server/src/index.ts:117-124`
- **Current Vulnerability**:
  ```ts
  app.get('/api/realtime/stream', (req: Request, res: Response) => {
    const societyId = (req.query.societyId as string) || req.societyId || 'soc-gvs';
    const userId = (req.query.userId as string) || req.userId;
    const role = (req.query.role as string) || req.userRole || 'resident';
  ...
  ```
  Query parameters take precedence over the authenticated context properties populated by `authenticateToken`. An authenticated resident can request `GET /api/realtime/stream?role=admin&societyId=soc-other` and register as an administrator on another tenant's realtime stream.
- **Evidence**: Verified by inspecting parameter resolution order at line 117-119.
- **Recommended Minimal Remediation**:
  Enforce authoritative server context for all non-admin users:
  ```ts
  app.get('/api/realtime/stream', (req: Request, res: Response) => {
    const isGlobalAdmin = req.userRole === 'admin';
    const societyId = isGlobalAdmin && req.query.societyId 
      ? (req.query.societyId as string) 
      : (req.societyId || 'soc-gvs');
    const userId = req.userId || (req.query.userId as string) || 'anonymous';
    const role = isGlobalAdmin && req.query.role 
      ? (req.query.role as string) 
      : (req.userRole || 'resident');
  ...
  ```

---

### GAP-04 [MEDIUM]: `BaseRepository.ts` Direct `fetch()` Calls Omit Bearer Tokens
- **Severity**: MEDIUM
- **File & Line**: `src/repositories/BaseRepository.ts:42, 62, 81, 95, 118`
- **Current Vulnerability**:
  `BaseRepository` makes raw `fetch()` calls to `/api/collections/...` without attaching the Bearer authorization header. Because `/api/collections/*` is now protected by global authentication, all repository CRUD operations fail with HTTP 401 `AUTH_TOKEN_MISSING`.
- **Evidence**: Verified by inspecting headers in `BaseRepository.ts` lines 44-48, 83, 120.
- **Recommended Minimal Remediation**:
  Attach the Bearer token helper to `BaseRepository`:
  ```ts
  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('aarizo_token') || sessionStorage.getItem('aarizo_token') || localStorage.getItem('dwellora_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }
  ```
  Pass `headers: this.getAuthHeaders()` on every `fetch` request in `BaseRepository`.

---

### GAP-05 [MEDIUM]: Total Absence of `requireSocietyMembership` Middleware Across Express Endpoints
- **Severity**: MEDIUM
- **File & Line**: `server/src/index.ts` (0 out of 143 endpoints)
- **Current Vulnerability**:
  `requireSocietyMembership` is defined in `server/src/auth.ts` but never mounted in `server/src/index.ts`. Endpoints rely on varying, ad-hoc tenant checks.
- **Evidence**: Confirmed by AST scan showing 0 occurrences of `requireSocietyMembership` in route definitions.
- **Recommended Minimal Remediation**:
  Mount `requireSocietyMembership` on all society-scoped routes where `:societyId` or `req.body.societyId` is accepted, or integrate society validation directly into the global `/api` middleware for tenant-scoped operations.

---

### GAP-06 [LOW]: Token Exposure via URL Query Parameter in SSE Connection
- **Severity**: LOW
- **File & Line**: `server/src/auth.ts:144`
- **Current Risk**:
  `token = req.query.token.trim()` allows passing tokens in URL query strings. Proxies, browser history, and access logs record query strings, potentially exposing long-lived Bearer tokens.
- **Evidence**: Verified in `server/src/auth.ts` lines 144-147.
- **Recommended Minimal Remediation**:
  Implement a short-lived Ticket Exchange endpoint:
  1. `POST /api/realtime/ticket` (Protected with Bearer header) -> Generates 30-second single-use ticket UUID in memory.
  2. `GET /api/realtime/stream?ticket=<ticket_uuid>` -> Consumes and invalidates ticket, establishing SSE stream without exposing the Bearer token.

---

## 3. Implementation Phasing & Alignment with Roadmap

| Phase | Target Items | Milestone Alignment |
| :--- | :--- | :--- |
| **Immediate (Step 2.4)** | GAP-01, GAP-02, GAP-03 | Finalize ISSUE-02 Security Hardening before touching ISSUE-03 |
| **Step 3.0 (ISSUE-03)** | GAP-04 | Resolve storage key mismatch & `BaseRepository` token attachment |
| **Phase B (P1/P2 Issues)** | GAP-05, GAP-06 | Multi-tenant isolation & Ticket-based SSE streaming |

---

## 4. Conclusion

Remediating GAP-01, GAP-02, and GAP-03 will elevate AARIZO's authentication subsystem from **CONDITIONAL PASS** to a definitive **FULL PASS**, establishing production-grade security and zero-trust authorization.

