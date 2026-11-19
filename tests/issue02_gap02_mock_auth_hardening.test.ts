import {
  authenticateToken,
  isMockAuthEnabled,
  requireRole,
  requireSocietyMembership,
} from '../server/src/auth';
import { prisma } from '../server/src/prisma';

// Mock Prisma for user resolution
jest.mock('../server/src/prisma', () => ({
  prisma: {
    user: {
      findFirst: jest.fn(),
    },
  },
}));

describe('GAP-02: Disable Implicit Development Mock Authentication', () => {
  const originalEnv = { ...process.env };
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
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // 1. Production with mock flag enabled
  test('1. Production environment rejects mock_token_ even when ENABLE_DEV_MOCK_AUTH === "true"', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_DEV_MOCK_AUTH = 'true';

    expect(isMockAuthEnabled()).toBe(false);

    mockReq.headers = { authorization: 'Bearer mock_token_user-admin-1' };
    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(401);
    expect(mockRes.jsonPayload.code).toBe('AUTH_TOKEN_INVALID');
  });

  // 2. Production with mock flag disabled
  test('2. Production environment rejects mock_token_ when ENABLE_DEV_MOCK_AUTH is disabled', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ENABLE_DEV_MOCK_AUTH;

    expect(isMockAuthEnabled()).toBe(false);

    mockReq.headers = { authorization: 'Bearer mock_token_user-admin-1' };
    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(401);
    expect(mockRes.jsonPayload.code).toBe('AUTH_TOKEN_INVALID');
  });

  // 3. Development with mock flag missing
  test('3. Development environment rejects mock_token_ when ENABLE_DEV_MOCK_AUTH is missing', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ENABLE_DEV_MOCK_AUTH;

    expect(isMockAuthEnabled()).toBe(false);

    mockReq.headers = { authorization: 'Bearer mock_token_user-res-1' };
    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(401);
    expect(mockRes.jsonPayload.code).toBe('AUTH_TOKEN_INVALID');
  });

  // 4. Development with mock flag set to false
  test('4. Development environment rejects mock_token_ when ENABLE_DEV_MOCK_AUTH === "false"', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_DEV_MOCK_AUTH = 'false';

    expect(isMockAuthEnabled()).toBe(false);

    mockReq.headers = { authorization: 'Bearer mock_token_user-res-1' };
    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(401);
    expect(mockRes.jsonPayload.code).toBe('AUTH_TOKEN_INVALID');
  });

  // 5. Development with explicit opt-in
  test('5. Development environment accepts mock_token_ ONLY when ENABLE_DEV_MOCK_AUTH === "true"', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_DEV_MOCK_AUTH = 'true';

    expect(isMockAuthEnabled()).toBe(true);

    (prisma.user.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'user-res-1',
      name: 'Vikram Joshi',
      email: 'vikram.joshi@aarizo.com',
      role: 'resident',
      societyId: 'soc-gvs',
      status: 'ACTIVE',
    });

    mockReq.headers = { authorization: 'Bearer mock_token_user-res-1' };
    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(mockReq.authContext.userId).toBe('user-res-1');
    expect(mockReq.authContext.role).toBe('resident');
  });

  // 6. Undefined NODE_ENV
  test('6. Undefined NODE_ENV rejects mock_token_ even if ENABLE_DEV_MOCK_AUTH === "true"', async () => {
    delete process.env.NODE_ENV;
    process.env.ENABLE_DEV_MOCK_AUTH = 'true';

    expect(isMockAuthEnabled()).toBe(false);

    mockReq.headers = { authorization: 'Bearer mock_token_user-admin-1' };
    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(401);
    expect(mockRes.jsonPayload.code).toBe('AUTH_TOKEN_INVALID');
  });

  // 7. Test environment
  test('7. Test environment rejects mock_token_ by default, unless explicitly opted in', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.ENABLE_DEV_MOCK_AUTH;

    expect(isMockAuthEnabled()).toBe(false);

    mockReq.headers = { authorization: 'Bearer mock_token_user-guard-1' };
    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(401);
  });

  // 8. Unknown mock user in database
  test('8. Mock token for non-existent database user is rejected with 401 USER_NOT_PROVISIONED', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_DEV_MOCK_AUTH = 'true';

    (prisma.user.findFirst as jest.Mock).mockResolvedValueOnce(null);

    mockReq.headers = { authorization: 'Bearer mock_token_non-existent-user-id' };
    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(401);
    expect(mockRes.jsonPayload.code).toBe('USER_NOT_PROVISIONED');
  });

  // 9. Mock user attempting unauthorized role access
  test('9. Mock user with resident role is rejected by admin role check', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_DEV_MOCK_AUTH = 'true';

    (prisma.user.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'user-res-1',
      name: 'Resident',
      role: 'resident',
      societyId: 'soc-gvs',
      status: 'ACTIVE',
    });

    mockReq.headers = { authorization: 'Bearer mock_token_user-res-1' };
    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);

    nextCalled = false;
    const adminOnly = requireRole(['admin']);
    adminOnly(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(403);
    expect(mockRes.jsonPayload.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  // 10. Mock user attempting cross-society access
  test('10. Mock user cannot bypass society isolation check', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_DEV_MOCK_AUTH = 'true';

    (prisma.user.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'user-sec-1',
      name: 'Secretary',
      role: 'secretary',
      societyId: 'soc-gvs',
      status: 'ACTIVE',
    });

    mockReq.headers = { authorization: 'Bearer mock_token_user-sec-1' };
    await authenticateToken(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);

    nextCalled = false;
    mockReq.params.societyId = 'soc-different-society';
    requireSocietyMembership(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(mockRes.statusCode).toBe(403);
    expect(mockRes.jsonPayload.code).toBe('TENANT_ISOLATION_VIOLATION');
  });
});

