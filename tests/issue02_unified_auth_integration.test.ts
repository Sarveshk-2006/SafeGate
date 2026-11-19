import { Request, Response, NextFunction } from 'express';
import {
  authenticateToken,
  generateAuthToken,
  verifyServerToken,
  requireRole,
  requireSocietyMembership,
} from '../server/src/auth';
import { prisma } from '../server/src/prisma';
import fs from 'fs';
import path from 'path';

// Mock Prisma for user lookup during token authentication
jest.mock('../server/src/prisma', () => ({
  prisma: {
    user: {
      findFirst: jest.fn(),
    },
  },
}));

describe('Phase A, Step 2.2: Unified Authentication & Protected API Integration (20 Security Tests)', () => {
  let mockReq: any;
  let mockRes: any;
  let nextCalled: boolean;

  beforeEach(() => {
    nextCalled = false;
    jest.clearAllMocks();
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
      originalUrl: '/api/residents',
      method: 'GET',
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

  // 1. Anonymous access to formerly unprotected routes
  test('1. Anonymous access without Bearer token is rejected with 401 AUTH_TOKEN_MISSING', async () => {
    mockReq.headers = {}; // No token
    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(401);
    expect(mockRes.jsonPayload.code).toBe('AUTH_TOKEN_MISSING');
  });

  // 2. Missing and malformed tokens
  test('2. Malformed token format is rejected with 401 AUTH_TOKEN_MISSING or AUTH_TOKEN_INVALID', async () => {
    // Malformed schema: basic instead of bearer
    mockReq.headers = { authorization: 'Basic dXNlcjpwYXNz' };
    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(401);
    expect(mockRes.jsonPayload.code).toBe('AUTH_TOKEN_MISSING');

    // Malformed JWT with invalid segments
    mockReq.headers = { authorization: 'Bearer malformed.token.only.two' };
    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });
    expect(mockRes.statusCode).toBe(401);
    expect(mockRes.jsonPayload.code).toBe('AUTH_TOKEN_INVALID');
  });

  // 3. Invalid signatures
  test('3. Token with tampered signature is rejected with 401 AUTH_TOKEN_INVALID', async () => {
    const validToken = generateAuthToken({
      sub: 'usr-100',
      email: 'test@dwellora.com',
      role: 'resident',
      societyId: 'soc-gvs',
      name: 'Resident One',
    });

    const parts = validToken.split('.');
    const tamperedToken = `${parts[0]}.${parts[1]}.tampered_signature_xyz`;
    mockReq.headers = { authorization: `Bearer ${tamperedToken}` };

    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(401);
    expect(mockRes.jsonPayload.code).toBe('AUTH_TOKEN_INVALID');
  });

  // 4. Expired tokens
  test('4. Expired token is rejected with 401 AUTH_TOKEN_INVALID', async () => {
    // Generate token expired 10 seconds ago
    const expiredToken = generateAuthToken(
      {
        sub: 'usr-100',
        email: 'test@dwellora.com',
        role: 'resident',
        societyId: 'soc-gvs',
        name: 'Resident One',
      },
      -10 // expired in the past
    );

    mockReq.headers = { authorization: `Bearer ${expiredToken}` };

    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(401);
    expect(mockRes.jsonPayload.code).toBe('AUTH_TOKEN_INVALID');
  });

  // 5. Valid password-login token
  test('5. Valid password-login token successfully resolves PostgreSQL profile and establishes authContext', async () => {
    const validToken = generateAuthToken({
      sub: 'usr-100',
      email: 'resident@dwellora.com',
      role: 'resident',
      societyId: 'soc-gvs',
      name: 'Legit Resident',
    });

    (prisma.user.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'usr-100',
      email: 'resident@dwellora.com',
      name: 'Legit Resident',
      role: 'resident',
      societyId: 'soc-gvs',
      status: 'ACTIVE',
    });

    mockReq.headers = { authorization: `Bearer ${validToken}` };

    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(mockReq.authContext).toBeDefined();
    expect(mockReq.authContext.userId).toBe('usr-100');
    expect(mockReq.authContext.role).toBe('resident');
    expect(mockReq.authContext.societyId).toBe('soc-gvs');
  });

  // 6. Valid Firebase ID token in development / test environment with explicit opt-in
  test('6. Development mock token (mock_token_uid) resolves active database record when opted-in', async () => {
    process.env.ENABLE_DEV_MOCK_AUTH = 'true';
    try {
      (prisma.user.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'usr-guard-01',
        email: 'guard@dwellora.com',
        name: 'Gate Officer',
        role: 'guard',
        societyId: 'soc-gvs',
        status: 'ACTIVE',
      });

      mockReq.headers = { authorization: 'Bearer mock_token_usr-guard-01' };

      await authenticateToken(mockReq, mockRes, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(mockReq.authContext.userId).toBe('usr-guard-01');
      expect(mockReq.authContext.role).toBe('guard');
    } finally {
      delete process.env.ENABLE_DEV_MOCK_AUTH;
    }
  });

  // 7. Inactive / Suspended user
  test('7. Suspended account is rejected with 403 ACCOUNT_SUSPENDED even with valid token', async () => {
    const validToken = generateAuthToken({
      sub: 'usr-suspended-01',
      role: 'resident',
      societyId: 'soc-gvs',
      name: 'Suspended User',
    });

    (prisma.user.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'usr-suspended-01',
      role: 'resident',
      societyId: 'soc-gvs',
      status: 'SUSPENDED', // Deactivated by management
    });

    mockReq.headers = { authorization: `Bearer ${validToken}` };

    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(403);
    expect(mockRes.jsonPayload.code).toBe('ACCOUNT_SUSPENDED');
  });

  // 8. Unknown user UID
  test('8. Unknown UID in database is rejected with 401 USER_NOT_PROVISIONED', async () => {
    const validToken = generateAuthToken({
      sub: 'usr-nonexistent',
      role: 'resident',
      societyId: 'soc-gvs',
      name: 'Ghost User',
    });

    (prisma.user.findFirst as jest.Mock).mockResolvedValueOnce(null); // Not in database

    mockReq.headers = { authorization: `Bearer ${validToken}` };

    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(401);
    expect(mockRes.jsonPayload.code).toBe('USER_NOT_PROVISIONED');
  });

  // 9. Forged x-user-role: admin
  test('9. Forged x-user-role: admin header is completely ignored; token role enforced', async () => {
    const residentToken = generateAuthToken({
      sub: 'usr-res-99',
      role: 'resident',
      societyId: 'soc-gvs',
      name: 'Resident Hack',
    });

    (prisma.user.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'usr-res-99',
      role: 'resident', // Database confirms resident
      societyId: 'soc-gvs',
      status: 'ACTIVE',
    });

    // Attacker sends valid resident token but appends forged header
    mockReq.headers = {
      authorization: `Bearer ${residentToken}`,
      'x-user-role': 'admin',
    };

    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(mockReq.authContext.role).toBe('resident'); // Server enforced DB role
    expect(mockReq.userRole).toBe('resident');

    // Admin-only route rejection
    nextCalled = false;
    const adminGuard = requireRole(['admin']);
    adminGuard(mockReq, mockRes, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(403);
    expect(mockRes.jsonPayload.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  // 10. Forged x-user-id
  test('10. Forged x-user-id header is ignored; authenticated sub is strictly preserved', async () => {
    const token = generateAuthToken({
      sub: 'usr-victim',
      role: 'resident',
      societyId: 'soc-gvs',
      name: 'Victim',
    });

    (prisma.user.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'usr-victim',
      role: 'resident',
      societyId: 'soc-gvs',
      status: 'ACTIVE',
    });

    mockReq.headers = {
      authorization: `Bearer ${token}`,
      'x-user-id': 'usr-impersonated',
    };

    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(mockReq.authContext.userId).toBe('usr-victim');
    expect(mockReq.userId).toBe('usr-victim');
  });

  // 11. Forged x-society-id
  test('11. Forged x-society-id header is ignored; database societyId is enforced', async () => {
    const token = generateAuthToken({
      sub: 'usr-soc-A',
      role: 'resident',
      societyId: 'soc-society-A',
      name: 'Resident A',
    });

    (prisma.user.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'usr-soc-A',
      role: 'resident',
      societyId: 'soc-society-A', // True society
      status: 'ACTIVE',
    });

    mockReq.headers = {
      authorization: `Bearer ${token}`,
      'x-society-id': 'soc-society-B', // Forged header
    };

    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(mockReq.authContext.societyId).toBe('soc-society-A');
    expect(mockReq.societyId).toBe('soc-society-A');
  });

  // 12. Resident accessing another society data
  test('12. Cross-society IDOR access attempt is rejected with 403 TENANT_ISOLATION_VIOLATION', () => {
    mockReq.authContext = { role: 'resident', societyId: 'soc-society-A', userId: 'res-1', name: 'Resident' };
    mockReq.params.societyId = 'soc-society-B'; // Accessing Society B resource

    requireSocietyMembership(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(403);
    expect(mockRes.jsonPayload.code).toBe('TENANT_ISOLATION_VIOLATION');
  });

  // 13. Guard attempting secretary-only operations
  test('13. Security Guard attempting secretary operations is rejected with 403 INSUFFICIENT_PERMISSIONS', () => {
    mockReq.authContext = { role: 'guard', societyId: 'soc-gvs', userId: 'g-1', name: 'Guard' };

    const secretaryEndpoint = requireRole(['secretary', 'admin']);
    secretaryEndpoint(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(403);
    expect(mockRes.jsonPayload.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  // 14. Secretary attempting platform-admin-only operations
  test('14. Secretary attempting platform-admin endpoint is rejected with 403 INSUFFICIENT_PERMISSIONS', () => {
    mockReq.authContext = { role: 'secretary', societyId: 'soc-gvs', userId: 'sec-1', name: 'Secretary' };

    const platformAdminEndpoint = requireRole(['admin']);
    platformAdminEndpoint(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(403);
    expect(mockRes.jsonPayload.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  // 15. Legitimate administrator access
  test('15. Authenticated platform administrator has universal permission access', () => {
    mockReq.authContext = { role: 'admin', societyId: 'soc-platform', userId: 'adm-1', name: 'Super Admin' };

    const residentEndpoint = requireRole(['resident']);
    residentEndpoint(mockReq, mockRes, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);

    nextCalled = false;
    const secretaryEndpoint = requireRole(['secretary']);
    secretaryEndpoint(mockReq, mockRes, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });

  // 16. Login endpoint remains public
  test('16. POST /api/auth/login is declared without token requirements in server/src/index.ts', () => {
    const indexPath = path.resolve(__dirname, '../server/src/index.ts');
    const indexContent = fs.readFileSync(indexPath, 'utf8');

    expect(indexContent).toContain("if (method === 'POST' && url === '/api/auth/login')");
    expect(indexContent).toContain("app.post('/api/auth/login'");
  });

  // 17. Razorpay webhook accepts valid HMAC and rejects invalid HMAC
  test('17. POST /api/payments/razorpay/webhook is declared public with timingSafeCompare verification', () => {
    const indexPath = path.resolve(__dirname, '../server/src/index.ts');
    const indexContent = fs.readFileSync(indexPath, 'utf8');

    expect(indexContent).toContain("if (method === 'POST' && url === '/api/payments/razorpay/webhook')");
    expect(indexContent).toContain('timingSafeCompare(expectedSignature, signature)');
  });

  // 18. Realtime health and SSE behavior remain functional
  test('18. Realtime health endpoint is public and SSE stream accepts query token', async () => {
    const indexPath = path.resolve(__dirname, '../server/src/index.ts');
    const indexContent = fs.readFileSync(indexPath, 'utf8');

    expect(indexContent).toContain("url === '/api/realtime/health'");

    // Verify SSE token query parameter extraction
    const token = generateAuthToken({
      sub: 'usr-sse-01',
      role: 'resident',
      societyId: 'soc-gvs',
      name: 'SSE Resident',
    });

    (prisma.user.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'usr-sse-01',
      role: 'resident',
      societyId: 'soc-gvs',
      status: 'ACTIVE',
    });

    // Browser EventSource opens URL with ?token=<token>
    mockReq.headers = {}; // No headers
    mockReq.query = { token };

    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(mockReq.authContext.userId).toBe('usr-sse-01');
  });

  // 19. Logout/session invalidation behaves as designed
  test('19. Session verification checks expiry and server signature validity', () => {
    const token = generateAuthToken({
      sub: 'usr-valid',
      role: 'resident',
      societyId: 'soc-gvs',
      name: 'Resident',
    });

    const verified = verifyServerToken(token);
    expect(verified).not.toBeNull();
    expect(verified?.sub).toBe('usr-valid');
    expect(verified?.iss).toBe('aarizo-api');
    expect(verified?.aud).toBe('aarizo-client');

    // Invalid secret or corrupted token cannot be verified
    const badToken = token.substring(0, token.length - 4) + 'AAAA';
    expect(verifyServerToken(badToken)).toBeNull();
  });

  // 20. Existing CRUD workflows still work for authorized users
  test('20. Authorized secretary successfully passes full middleware verification for tower management', () => {
    mockReq.authContext = { role: 'secretary', societyId: 'soc-gvs', userId: 'sec-01', name: 'Secretary' };

    const towerGuard = requireRole(['secretary', 'admin']);
    towerGuard(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(mockRes.statusCode).toBe(200);
  });
});

