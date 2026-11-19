import { Request, Response } from 'express';
import { realtimeEngine, handleSseSubscription } from '../server/src/realtimeEngine';

describe('GAP-03: Realtime SSE Identity & Tenant Authorization Hardening', () => {
  let mockReq: any;
  let mockRes: any;
  let closeCallbacks: Array<() => void>;

  beforeEach(() => {
    closeCallbacks = [];
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
      headers: {} as Record<string, string>,
      jsonPayload: null,
      setHeader(key: string, val: string) {
        this.headers[key.toLowerCase()] = val;
        return this;
      },
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(data: any) {
        this.jsonPayload = data;
        return this;
      },
      write: jest.fn(),
      flushHeaders: jest.fn(),
      on(event: string, callback: () => void) {
        if (event === 'close') {
          closeCallbacks.push(callback);
        }
      },
    };
  });

  // 1. Resident subscribes to their own society
  test('1. Resident legitimately subscribes to their authorized society stream', () => {
    mockReq.authContext = {
      userId: 'usr-res-1',
      role: 'resident',
      societyId: 'soc-gvs',
      name: 'Resident Vikram',
    };
    mockReq.societyId = 'soc-gvs';
    mockReq.userId = 'usr-res-1';
    mockReq.userRole = 'resident';

    handleSseSubscription(mockReq, mockRes);

    expect(mockRes.statusCode).toBe(200);
    expect(mockRes.headers['content-type']).toBe('text/event-stream');
    expect(mockRes.write).toHaveBeenCalledWith(
      expect.stringContaining('SafeGate 2.0 Real-time Stream Connected')
    );
  });

  // 2. Resident attempts ?role=admin
  test('2. Resident attempting ?role=admin is registered strictly as resident; query role is ignored', () => {
    mockReq.authContext = {
      userId: 'usr-res-1',
      role: 'resident',
      societyId: 'soc-gvs',
      name: 'Resident Vikram',
    };
    mockReq.societyId = 'soc-gvs';
    mockReq.userId = 'usr-res-1';
    mockReq.userRole = 'resident';
    mockReq.query = { role: 'admin' }; // Attacker attempts role spoofing

    const registerSpy = jest.spyOn(realtimeEngine, 'registerClient');

    handleSseSubscription(mockReq, mockRes);

    expect(registerSpy).toHaveBeenCalledWith(
      expect.any(String),
      mockRes,
      'soc-gvs',
      'usr-res-1',
      'resident', // Enforced role from authContext, NOT 'admin'
      undefined
    );

    registerSpy.mockRestore();
  });

  // 3. Resident attempts a different societyId
  test('3. Resident attempting ?societyId=soc-other is rejected with 403 TENANT_ISOLATION_VIOLATION', () => {
    mockReq.authContext = {
      userId: 'usr-res-1',
      role: 'resident',
      societyId: 'soc-gvs',
      name: 'Resident Vikram',
    };
    mockReq.societyId = 'soc-gvs';
    mockReq.userId = 'usr-res-1';
    mockReq.userRole = 'resident';
    mockReq.query = { societyId: 'soc-other-target' }; // Cross-tenant attempt

    const registerSpy = jest.spyOn(realtimeEngine, 'registerClient');

    handleSseSubscription(mockReq, mockRes);

    expect(registerSpy).not.toHaveBeenCalled();
    expect(mockRes.statusCode).toBe(403);
    expect(mockRes.jsonPayload.code).toBe('TENANT_ISOLATION_VIOLATION');

    registerSpy.mockRestore();
  });

  // 4. Resident attempts to impersonate another userId
  test('4. Resident attempting ?userId=usr-victim has their query ignored; authenticated userId is enforced', () => {
    mockReq.authContext = {
      userId: 'usr-res-1',
      role: 'resident',
      societyId: 'soc-gvs',
      name: 'Resident Vikram',
    };
    mockReq.societyId = 'soc-gvs';
    mockReq.userId = 'usr-res-1';
    mockReq.userRole = 'resident';
    mockReq.query = { userId: 'usr-victim-999' }; // Impersonation attempt

    const registerSpy = jest.spyOn(realtimeEngine, 'registerClient');

    handleSseSubscription(mockReq, mockRes);

    expect(registerSpy).toHaveBeenCalledWith(
      expect.any(String),
      mockRes,
      'soc-gvs',
      'usr-res-1', // Enforced userId from authContext, NOT 'usr-victim-999'
      'resident',
      undefined
    );

    registerSpy.mockRestore();
  });

  // 5. Secretary attempts to subscribe to another society
  test('5. Secretary attempting to subscribe to another society is rejected with 403 TENANT_ISOLATION_VIOLATION', () => {
    mockReq.authContext = {
      userId: 'usr-sec-1',
      role: 'secretary',
      societyId: 'soc-gvs',
      name: 'Secretary Mayuri',
    };
    mockReq.societyId = 'soc-gvs';
    mockReq.userId = 'usr-sec-1';
    mockReq.userRole = 'secretary';
    mockReq.query = { societyId: 'soc-competing-society' };

    const registerSpy = jest.spyOn(realtimeEngine, 'registerClient');

    handleSseSubscription(mockReq, mockRes);

    expect(registerSpy).not.toHaveBeenCalled();
    expect(mockRes.statusCode).toBe(403);
    expect(mockRes.jsonPayload.code).toBe('TENANT_ISOLATION_VIOLATION');

    registerSpy.mockRestore();
  });

  // 6. Authorized administrator subscription with explicit societyId
  test('6. Authorized platform administrator can subscribe to specific target society', () => {
    mockReq.authContext = {
      userId: 'usr-admin-1',
      role: 'admin',
      societyId: 'soc-platform',
      name: 'Platform Admin',
    };
    mockReq.societyId = 'soc-platform';
    mockReq.userId = 'usr-admin-1';
    mockReq.userRole = 'admin';
    mockReq.query = { societyId: 'soc-audited-tenant' }; // Admin can monitor any tenant

    const registerSpy = jest.spyOn(realtimeEngine, 'registerClient');

    handleSseSubscription(mockReq, mockRes);

    expect(registerSpy).toHaveBeenCalledWith(
      expect.any(String),
      mockRes,
      'soc-audited-tenant', // Admin allowed to monitor specific society
      'usr-admin-1',
      'admin', // Role is strictly admin
      undefined
    );

    registerSpy.mockRestore();
  });

  // 7. Missing or invalid auth context
  test('7. Missing or unresolved auth context returns 401 AUTH_REQUIRED before registration', () => {
    mockReq.authContext = undefined; // Unresolved context

    const registerSpy = jest.spyOn(realtimeEngine, 'registerClient');

    handleSseSubscription(mockReq, mockRes);

    expect(registerSpy).not.toHaveBeenCalled();
    expect(mockRes.statusCode).toBe(401);
    expect(mockRes.jsonPayload.code).toBe('AUTH_REQUIRED');

    registerSpy.mockRestore();
  });

  // 8. Connection cleanup on client disconnect
  test('8. Client disconnect triggers close callback and deregisters connection cleanly', () => {
    mockReq.authContext = {
      userId: 'usr-res-1',
      role: 'resident',
      societyId: 'soc-gvs',
      name: 'Resident Vikram',
    };

    const initialCount = realtimeEngine.getActiveConnectionCount('soc-gvs');

    handleSseSubscription(mockReq, mockRes);

    // Active connection count should increase by 1
    expect(realtimeEngine.getActiveConnectionCount('soc-gvs')).toBe(initialCount + 1);

    // Simulate client closing the browser tab / connection
    expect(closeCallbacks.length).toBeGreaterThan(0);
    closeCallbacks.forEach((cb) => cb());

    // Connection count should return to original
    expect(realtimeEngine.getActiveConnectionCount('soc-gvs')).toBe(initialCount);
  });
});
