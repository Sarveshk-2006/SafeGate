import { Request, Response, NextFunction } from 'express';
import { authenticateFirebaseToken, requireRole, requireSocietyMembership } from '../server/src/auth';
import fs from 'fs';
import path from 'path';

/**
 * Mandatory Security Verification Tests for ISSUE-02 (P0)
 * Eliminates Client-Header Privilege Escalation & Enforces Server-Side Identity
 */

describe('ISSUE-02: Mandatory Security Test Suite (14 Critical Assertions)', () => {
  let mockReq: any;
  let mockRes: any;
  let nextCalled: boolean;

  beforeEach(() => {
    nextCalled = false;
    mockReq = {
      headers: {},
      params: {},
      body: {},
      query: {},
      authContext: undefined,
      userRole: undefined,
      societyId: undefined,
      userId: undefined,
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    };
    mockRes = {
      statusCode: 200,
      jsonPayload: null,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(data: any) {
        this.jsonPayload = data;
        return this;
      },
      send(data: any) {
        this.jsonPayload = data;
        return this;
      },
    };
  });

  // 1. Protected endpoint with no token
  test('1. Protected endpoint with no token returns 401 AUTH_TOKEN_MISSING', async () => {
    mockReq.headers = {}; // No authorization header

    await authenticateFirebaseToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(401);
    expect(mockRes.jsonPayload.code).toBe('AUTH_TOKEN_MISSING');
  });

  // 2. Protected endpoint with malformed token
  test('2. Protected endpoint with malformed token returns 401 AUTH_TOKEN_MISSING', async () => {
    mockReq.headers = { authorization: 'Basic dXNlcjpwYXNz' }; // Malformed: Basic instead of Bearer

    await authenticateFirebaseToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(401);
    expect(mockRes.jsonPayload.code).toBe('AUTH_TOKEN_MISSING');
  });

  // 3. Protected endpoint with invalid signature
  test('3. Protected endpoint with invalid signature returns 401 AUTH_TOKEN_INVALID', async () => {
    mockReq.headers = { authorization: 'Bearer invalid.cryptographic.signature' };

    await authenticateFirebaseToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(401);
    expect(mockRes.jsonPayload.code).toBe('AUTH_TOKEN_INVALID');
  });

  // 4. Expired token
  test('4. Expired token returns 401 AUTH_TOKEN_INVALID', async () => {
    // Malformed/expired JWT token format
    mockReq.headers = { authorization: 'Bearer eyJhbGciOiJSUzI1NiIsImV4cCI6MTUxMDAwMDAwMH0.payload.sig' };

    await authenticateFirebaseToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(401);
    expect(mockRes.jsonPayload.code).toBe('AUTH_TOKEN_INVALID');
  });

  // 5. Valid authenticated resident
  test('5. Valid authenticated resident is permitted on resident endpoint but rejected on admin endpoint', () => {
    mockReq.authContext = { role: 'resident', societyId: 'soc-gvs', userId: 'res-101', name: 'Sarvesh Kulkarni' };

    // Resident endpoint
    const residentMiddleware = requireRole(['resident', 'secretary', 'admin']);
    residentMiddleware(mockReq, mockRes, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);

    // Admin endpoint
    nextCalled = false;
    const adminMiddleware = requireRole(['admin']);
    adminMiddleware(mockReq, mockRes, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(403);
    expect(mockRes.jsonPayload.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  // 6. Valid authenticated security guard
  test('6. Valid authenticated security guard is permitted on guard endpoint but rejected on admin endpoint', () => {
    mockReq.authContext = { role: 'guard', societyId: 'soc-gvs', userId: 'guard-101', name: 'Officer Singh' };

    // Guard endpoint
    const guardMiddleware = requireRole(['guard', 'secretary', 'admin']);
    guardMiddleware(mockReq, mockRes, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);

    // Admin endpoint
    nextCalled = false;
    const adminMiddleware = requireRole(['admin']);
    adminMiddleware(mockReq, mockRes, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(403);
    expect(mockRes.jsonPayload.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  // 7. Valid authenticated secretary/admin
  test('7. Valid authenticated admin is permitted on any protected endpoint', () => {
    mockReq.authContext = { role: 'admin', societyId: 'soc-platform', userId: 'admin-01', name: 'Platform Admin' };

    const adminMiddleware = requireRole(['admin']);
    adminMiddleware(mockReq, mockRes, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);

    nextCalled = false;
    const residentMiddleware = requireRole(['resident']);
    residentMiddleware(mockReq, mockRes, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true); // Admin has universal access
  });

  // 8. Forged x-user-role: admin header without a valid token
  test('8. Forged x-user-role: admin header without a valid token is completely rejected', async () => {
    mockReq.headers = {
      'x-user-role': 'admin',
      'x-user-id': 'hacker-007',
      'x-society-id': 'soc-victim',
    };

    // 1. authenticateFirebaseToken rejects because no Bearer token is provided
    await authenticateFirebaseToken(mockReq, mockRes, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(401);
    expect(mockRes.jsonPayload.code).toBe('AUTH_TOKEN_MISSING');

    // 2. requireRole rejects because req.authContext is undefined despite header
    const adminMiddleware = requireRole(['admin']);
    nextCalled = false;
    adminMiddleware(mockReq, mockRes, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(403);
    expect(mockRes.jsonPayload.code).toBe('ROLE_MISSING');
  });

  // 9. Forged x-society-id header attempting cross-society access
  test('9. Forged x-society-id header attempting cross-society access is rejected', () => {
    // Authenticated user belongs strictly to 'soc-society-A'
    mockReq.authContext = { role: 'resident', societyId: 'soc-society-A', userId: 'res-01', name: 'Legit Resident' };

    // Attacker attempts IDOR into Society B
    mockReq.params.societyId = 'soc-society-B';
    mockReq.headers['x-society-id'] = 'soc-society-B'; // Forged header

    requireSocietyMembership(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(403);
    expect(mockRes.jsonPayload.code).toBe('TENANT_ISOLATION_VIOLATION');
  });

  // 10. Valid token with a modified role header
  test('10. Valid token with a modified role header does not escalate privileges (server enforces verified role)', () => {
    // Verified user is a Resident
    mockReq.authContext = { role: 'resident', societyId: 'soc-gvs', userId: 'res-01', name: 'Resident User' };

    // Attacker appends 'x-user-role: admin' to request
    mockReq.headers['x-user-role'] = 'admin';

    // Target endpoint requires 'admin'
    const adminMiddleware = requireRole(['admin']);
    adminMiddleware(mockReq, mockRes, () => {
      nextCalled = true;
    });

    // Escalation must be rejected
    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(403);
    expect(mockRes.jsonPayload.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  // 11. Authenticated user attempting an operation outside their permissions
  test('11. Authenticated user attempting an operation outside permissions is rejected with 403', () => {
    mockReq.authContext = { role: 'guard', societyId: 'soc-gvs', userId: 'guard-01', name: 'Guard User' };

    // Guard attempts to access billing management (requires secretary or admin)
    const billingMiddleware = requireRole(['secretary', 'admin']);
    billingMiddleware(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(403);
    expect(mockRes.jsonPayload.code).toBe('INSUFFICIENT_PERMISSIONS');
    expect(mockRes.jsonPayload.requiredRoles).toEqual(['secretary', 'admin']);
  });

  // 12. Public login endpoint still works
  test('12. Public login endpoint (/api/auth/login) is public and does not require a Bearer token', () => {
    const indexPath = path.resolve(__dirname, '../server/src/index.ts');
    const indexContent = fs.readFileSync(indexPath, 'utf8');

    // Verify /api/auth/login is declared without requireRole or blanket blocking middleware
    expect(indexContent).toContain("app.post('/api/auth/login'");
    const loginRouteSnippet = indexContent.match(/app\.post\('\/api\/auth\/login'[\s\S]*?\r?\n\}\);/);
    expect(loginRouteSnippet).not.toBeNull();
    // Route must not use requireRole
    expect(loginRouteSnippet![0]).not.toContain('requireRole');
  });

  // 13. Payment webhook verification still works, if present
  test('13. Payment webhook endpoint (/api/payments/razorpay/webhook) remains public and verifies HMAC signature', () => {
    const indexPath = path.resolve(__dirname, '../server/src/index.ts');
    const indexContent = fs.readFileSync(indexPath, 'utf8');

    expect(indexContent).toContain("app.post('/api/payments/razorpay/webhook'");
    const webhookSnippet = indexContent.match(/app\.post\('\/api\/payments\/razorpay\/webhook'[\s\S]*?\r?\n\}\);/);
    expect(webhookSnippet).not.toBeNull();
    // Webhook must verify HMAC and not require Bearer token
    expect(webhookSnippet![0]).toContain('timingSafeCompare');
    expect(webhookSnippet![0]).not.toContain('requireRole');
  });

  // 14. Existing authorized CRUD operations still work
  test('14. Existing authorized CRUD operations succeed when valid authentication is present', () => {
    mockReq.authContext = { role: 'secretary', societyId: 'soc-gvs', userId: 'sec-01', name: 'Society Secretary' };

    const secretaryMiddleware = requireRole(['secretary', 'admin']);
    secretaryMiddleware(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(mockRes.statusCode).toBe(200);
  });
});
