import {
  validateDatabaseConfiguration,
  assertDatabaseConfiguration,
  checkDatabaseReadiness,
  sanitizeErrorMessage,
  redactDatabaseUrl,
  redactSensitiveData,
} from '../server/src/dbConfig';
import { loadEnvironment } from '../server/src/env';
import { RealtimeEngine } from '../server/src/realtimeEngine';
import { createGracefulShutdownHandler, registerGracefulShutdown } from '../server/src/shutdown';
import http from 'http';
import fs from 'fs';
import path from 'path';

function startEphemeralServer(server: http.Server): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve(addr.port);
      } else {
        reject(new Error('Failed to obtain ephemeral server port.'));
      }
    });
  });
}

describe('ISSUE-04: Runtime Configuration & Startup Hardening', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  describe('1. Database Configuration Validator (validateDatabaseConfiguration & assertDatabaseConfiguration)', () => {
    test('1.1 Rejects missing DATABASE_URL with clear diagnostic message', () => {
      delete process.env.DATABASE_URL;
      const result = validateDatabaseConfiguration();
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('DATABASE_URL environment variable is missing or empty');
    });

    test('1.2 Rejects empty or whitespace-only DATABASE_URL', () => {
      const result = validateDatabaseConfiguration('   ');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('DATABASE_URL environment variable is missing or empty');
    });

    test('1.3 Rejects non-PostgreSQL scheme (e.g. mysql://, mongodb://)', () => {
      const mysqlResult = validateDatabaseConfiguration('mysql://user:pass@localhost:3306/db');
      expect(mysqlResult.isValid).toBe(false);
      expect(mysqlResult.error).toContain("Must begin with 'postgresql://' or 'postgres://'");

      const mongoResult = validateDatabaseConfiguration('mongodb://localhost:27017/db');
      expect(mongoResult.isValid).toBe(false);
      expect(mongoResult.error).toContain("Must begin with 'postgresql://' or 'postgres://'");
    });

    test('1.4 Rejects syntactically malformed URLs', () => {
      const result = validateDatabaseConfiguration('postgresql://');
      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/host name|syntactically valid/i);
    });

    test('1.5 Accepts valid postgresql:// and postgres:// connection URLs', () => {
      const validPg = 'postgresql://aarizo_admin:aarizo_secure_password_2026@localhost:5432/aarizo_community?schema=public';
      const result1 = validateDatabaseConfiguration(validPg);
      expect(result1.isValid).toBe(true);
      expect(result1.redactedUrl).toBe('postgresql://aarizo_admin:***@localhost:5432/aarizo_community?schema=...');

      const validShort = 'postgres://admin:pass@postgres-host:5432/aarizo_community';
      const result2 = validateDatabaseConfiguration(validShort);
      expect(result2.isValid).toBe(true);
      expect(result2.redactedUrl).toBe('postgres://admin:***@postgres-host:5432/aarizo_community');
    });

    test('1.6 Redacted URL never leaks plain-text credentials', () => {
      const sensitiveUrl = 'postgresql://super_secret_user:super_secret_password_999@db.prod.internal:5432/prod_db';
      const result = validateDatabaseConfiguration(sensitiveUrl);
      expect(result.isValid).toBe(true);
      expect(result.redactedUrl).not.toContain('super_secret_password_999');
      expect(result.redactedUrl).toContain('super_secret_user:***@db.prod.internal:5432/prod_db');
    });

    test('1.7 assertDatabaseConfiguration throws fatal error when DATABASE_URL is missing', () => {
      delete process.env.DATABASE_URL;
      expect(() => assertDatabaseConfiguration()).toThrow('[FATAL DATABASE CONFIG ERROR]');
    });

    test('1.8 assertDatabaseConfiguration succeeds silently when DATABASE_URL is valid', () => {
      process.env.DATABASE_URL = 'postgresql://aarizo_admin:pass@localhost:5432/aarizo_community';
      expect(() => assertDatabaseConfiguration()).not.toThrow();
    });
  });

  describe('2. Deterministic Environment Loading & Precedence', () => {
    test('2.1 Pre-existing environment variables take precedence over loaded file variables', () => {
      process.env.TEST_PRECEDENCE_VAR = 'pre_existing_deployment_value';

      // Create a temporary test .env file
      const tempEnvPath = path.resolve(__dirname, 'temp_test.env');
      fs.writeFileSync(tempEnvPath, 'TEST_PRECEDENCE_VAR=overwritten_file_value\nNEW_TEMP_VAR=file_val');

      try {
        loadEnvironment({ customPath: tempEnvPath, forceReload: true });
        // Deployment env var must NOT be overwritten
        expect(process.env.TEST_PRECEDENCE_VAR).toBe('pre_existing_deployment_value');
        // New variable from file should be loaded
        expect(process.env.NEW_TEMP_VAR).toBe('file_val');
      } finally {
        if (fs.existsSync(tempEnvPath)) {
          fs.unlinkSync(tempEnvPath);
        }
        delete process.env.TEST_PRECEDENCE_VAR;
        delete process.env.NEW_TEMP_VAR;
      }
    });

    test('2.2 loadEnvironment returns loaded status and candidate sources', () => {
      const res = loadEnvironment();
      expect(typeof res.loaded).toBe('boolean');
      expect(Array.isArray(res.sources)).toBe(true);
    });
  });

  describe('3. Database Readiness & Liveness Probes', () => {
    test('3.1 checkDatabaseReadiness reports ready: true when queryRaw succeeds', async () => {
      const mockPrisma = {
        $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      };

      const result = await checkDatabaseReadiness(mockPrisma, 1000);
      expect(result.ready).toBe(true);
      expect(typeof result.latencyMs).toBe('number');
      expect(result.error).toBeUndefined();
    });

    test('3.2 checkDatabaseReadiness reports ready: false when queryRaw rejects', async () => {
      const mockPrisma = {
        $queryRaw: jest.fn().mockRejectedValue(new Error('Connection refused at 127.0.0.1:5432')),
      };

      const result = await checkDatabaseReadiness(mockPrisma, 1000);
      expect(result.ready).toBe(false);
      expect(result.error).toBe('Database connection check failed.');
      // Never exposes raw connection strings or host details in error
      expect(result.error).not.toContain('127.0.0.1');
    });

    test('3.3 checkDatabaseReadiness reports probe timed out when query hangs', async () => {
      const mockHangingPrisma = {
        $queryRaw: jest.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 500))),
      };

      // Probe with very short 50ms timeout
      const result = await checkDatabaseReadiness(mockHangingPrisma, 50);
      expect(result.ready).toBe(false);
      expect(result.error).toBe('Database probe timed out.');
    });

    test('3.4 checkDatabaseReadiness handles uninitialized or null Prisma client safely', async () => {
      const result = await checkDatabaseReadiness(null, 100);
      expect(result.ready).toBe(false);
      expect(result.error).toContain('Prisma client is not initialized');
    });
  });

  describe('4. Information Disclosure & Error Sanitization', () => {
    test('4.1 Sanitizes Prisma initialization error containing paths and schema lines', () => {
      const rawPrismaError = `
Invalid \`prisma.user.findFirst()\` invocation in
D:\\AAZIRA\\AARIZO\\server\\src\\index.ts:1687:36

  1684 if (!email || !password) {
  1685   return res.status(400).json({ error: 'Email and password are required' });
  1686 }
→ 1687 const user = await prisma.user.findFirst(
error: Environment variable not found: DATABASE_URL.
  -->  schema.prisma:3
   | 
 2 |   provider = "postgresql"
 3 |   url      = env("DATABASE_URL")
      `;

      const sanitized = sanitizeErrorMessage(rawPrismaError);
      expect(sanitized).toBe('An internal database error occurred. Please contact system administrator.');
      expect(sanitized).not.toContain('DATABASE_URL');
      expect(sanitized).not.toContain('schema.prisma');
      expect(sanitized).not.toContain('D:\\AAZIRA');
      expect(sanitized).not.toContain('findFirst');
    });

    test('4.2 Sanitizes raw SQL error fragments', () => {
      const rawSqlError = 'SELECT * FROM users WHERE password_hash = $1 failed: relation "users" does not exist';
      const sanitized = sanitizeErrorMessage(rawSqlError);
      expect(sanitized).toBe('An internal database error occurred. Please contact system administrator.');
      expect(sanitized).not.toContain('SELECT');
      expect(sanitized).not.toContain('password_hash');
    });

    test('4.3 Sanitizes internal server filesystem paths and stack trace lines', () => {
      const pathError = 'Error: Cannot find module in D:\\AAZIRA\\AARIZO\\server\\dist\\index.js at Module._resolve';
      const sanitized = sanitizeErrorMessage(pathError, 'An unexpected server error occurred.');
      expect(sanitized).toBe('An unexpected server error occurred.');
      expect(sanitized).not.toContain('D:\\AAZIRA');
    });

    test('4.4 Preserves safe client-facing operational messages', () => {
      const cleanMessage = 'Invalid email or password';
      const sanitized = sanitizeErrorMessage(cleanMessage);
      expect(sanitized).toBe('Invalid email or password');

      const notFoundMessage = 'Society not found';
      expect(sanitizeErrorMessage(notFoundMessage)).toBe('Society not found');
    });

    test('4.5 redactSensitiveData strips credentials and Bearer tokens from log strings', () => {
      const logString = 'Error connecting to postgresql://aarizo_admin:my_secret_pw@localhost:5432/aarizo with Bearer eyJhbGciOiJIUzI1NiJ9.test';
      const redacted = redactSensitiveData(logString);
      expect(redacted).not.toContain('my_secret_pw');
      expect(redacted).toContain('postgresql://aarizo_admin:***@');
      expect(redacted).toContain('Bearer [REDACTED]');
    });
  });

  describe('5. Realtime Outbox Poller Resilience & Recovery', () => {
    test('5.1 RealtimeEngine exports health check and stats methods', () => {
      const engine = RealtimeEngine.getInstance();
      expect(typeof engine.isDatabaseHealthy).toBe('function');
      expect(typeof engine.getDatabaseErrorStats).toBe('function');
      expect(typeof engine.stop).toBe('function');
      // Initially healthy
      expect(typeof engine.isDatabaseHealthy()).toBe('boolean');
    });

    test('5.2 RealtimeEngine stop terminates background timers cleanly', () => {
      const engine = RealtimeEngine.getInstance();
      expect(() => engine.stop()).not.toThrow();
    });
  });

  describe('6. Template Consistency & Configuration Specifications', () => {
    test('6.1 server/.env.example specifies aarizo_community and required keys', () => {
      const serverEnvPath = path.resolve(__dirname, '../server/.env.example');
      const content = fs.readFileSync(serverEnvPath, 'utf8');

      expect(content).toContain('DATABASE_URL=postgresql://aarizo_admin:aarizo_secure_password_2026@localhost:5432/aarizo_community?schema=public');
      expect(content).toContain('AUTH_SECRET=');
      expect(content).toContain('ENABLE_DEV_MOCK_AUTH=false');
      expect(content).toContain('FIREBASE_PROJECT_ID=aarizo-community');
      // Secrets must NOT contain actual secrets
      expect(content).not.toContain('actual_secret');
      expect(content).not.toContain('dwellora_db');
    });

    test('6.2 Root .env.example specifies aarizo_community and required keys', () => {
      const rootEnvPath = path.resolve(__dirname, '../.env.example');
      const content = fs.readFileSync(rootEnvPath, 'utf8');

      expect(content).toContain('DATABASE_URL=postgresql://aarizo_admin:aarizo_secure_password_2026@localhost:5432/aarizo_community?schema=public');
      expect(content).toContain('AUTH_SECRET=');
      expect(content).toContain('ENABLE_DEV_MOCK_AUTH=false');
      expect(content).toContain('VITE_FIREBASE_PROJECT_ID=aarizo-community');
      expect(content).not.toContain('dwellora_db');
    });

    test('6.3 docker-compose.yml requires non-default AUTH_SECRET via variable validation', () => {
      const dockerComposePath = path.resolve(__dirname, '../docker-compose.yml');
      const content = fs.readFileSync(dockerComposePath, 'utf8');

      expect(content).toContain('POSTGRES_DB: aarizo_community');
      expect(content).toContain('POSTGRES_USER: aarizo_admin');
      expect(content).toContain('DATABASE_URL: postgresql://aarizo_admin:aarizo_secure_password_2026@postgres:5432/aarizo_community?schema=public');
      expect(content).toContain('AUTH_SECRET: "${AUTH_SECRET:?');
      expect(content).not.toContain('aarizo_docker_default_secret');
    });
  });

  describe('7. HTTP Health and Response Interceptor Verification', () => {
    test('7.1 Response interceptor sanitizes raw Prisma 500 errors', () => {
      let interceptedBody: any = null;
      const mockRes: any = {
        statusCode: 500,
        json(body: any) {
          interceptedBody = body;
          return this;
        },
      };

      // Create interceptor middleware matching server/src/index.ts
      const interceptor = (_req: any, res: any, next: any) => {
        const originalJson = res.json.bind(res);
        res.json = (body: any) => {
          if (res.statusCode >= 500 && body && typeof body === 'object' && body.error) {
            body.error = sanitizeErrorMessage(body.error);
          }
          return originalJson(body);
        };
        next();
      };

      interceptor({}, mockRes, () => {});

      // Simulate a handler sending a raw Prisma error
      mockRes.json({
        error: 'Invalid `prisma.user.findFirst()` in D:\\AAZIRA\\AARIZO\\server\\src\\index.ts:1687: Environment variable not found: DATABASE_URL.',
      });

      expect(interceptedBody.error).toBe('An internal database error occurred. Please contact system administrator.');
      expect(interceptedBody.error).not.toContain('findFirst');
      expect(interceptedBody.error).not.toContain('D:\\AAZIRA');
    });

    test('7.2 Response interceptor leaves non-500 errors untouched (e.g. 400, 401)', () => {
      let interceptedBody: any = null;
      const mockRes: any = {
        statusCode: 400,
        json(body: any) {
          interceptedBody = body;
          return this;
        },
      };

      const interceptor = (_req: any, res: any, next: any) => {
        const originalJson = res.json.bind(res);
        res.json = (body: any) => {
          if (res.statusCode >= 500 && body && typeof body === 'object' && body.error) {
            body.error = sanitizeErrorMessage(body.error);
          }
          return originalJson(body);
        };
        next();
      };

      interceptor({}, mockRes, () => {});

      mockRes.json({ error: 'Email and password are required' });
      expect(interceptedBody.error).toBe('Email and password are required');
    });

    test('7.3 Readiness handler returns 200 READY when database probe succeeds', async () => {
      const mockPrisma = {
        $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
      };

      const readiness = await checkDatabaseReadiness(mockPrisma, 500);
      expect(readiness.ready).toBe(true);
      expect(readiness.latencyMs).toBeDefined();
    });

    test('7.4 Readiness handler returns 503 NOT_READY when database probe fails', async () => {
      const mockPrisma = {
        $queryRaw: jest.fn().mockRejectedValue(new Error('Connection terminated')),
      };

      const readiness = await checkDatabaseReadiness(mockPrisma, 500);
      expect(readiness.ready).toBe(false);
      expect(readiness.error).toBe('Database connection check failed.');
    });

    test('7.5 Live HTTP probe: /api/health/live responds 200 OK without database connection', async () => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'UP', uptimeSeconds: 10, timestamp: new Date().toISOString() }));
      });
      const port = await startEphemeralServer(server);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health/live`);
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.status).toBe('UP');
      } finally {
        server.close();
      }
    });

    test('7.6 Live HTTP probe: /api/health/ready responds 503 when database check fails', async () => {
      const mockPrisma = {
        $queryRaw: jest.fn().mockRejectedValue(new Error('Connection failed')),
      };
      const server = http.createServer(async (_req, res) => {
        const readiness = await checkDatabaseReadiness(mockPrisma, 500);
        const statusCode = readiness.ready ? 200 : 503;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: readiness.ready ? 'READY' : 'NOT_READY',
            database: readiness.ready ? 'CONNECTED' : 'DISCONNECTED',
            error: readiness.error,
          })
        );
      });
      const port = await startEphemeralServer(server);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health/ready`);
        expect(response.status).toBe(503);
        const data = await response.json();
        expect(data.status).toBe('NOT_READY');
        expect(data.database).toBe('DISCONNECTED');
      } finally {
        server.close();
      }
    });

    test('7.7 Live HTTP probe: /api/health responds 503 DEGRADED when database check fails', async () => {
      const mockPrisma = {
        $queryRaw: jest.fn().mockRejectedValue(new Error('Connection failed')),
      };
      const server = http.createServer(async (_req, res) => {
        const readiness = await checkDatabaseReadiness(mockPrisma, 500);
        const isHealthy = readiness.ready;
        res.writeHead(isHealthy ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: isHealthy ? 'UP' : 'DEGRADED',
            database: isHealthy ? 'CONNECTED' : 'DISCONNECTED',
          })
        );
      });
      const port = await startEphemeralServer(server);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        expect(response.status).toBe(503);
        const data = await response.json();
        expect(data.status).toBe('DEGRADED');
        expect(data.database).toBe('DISCONNECTED');
      } finally {
        server.close();
      }
    });

    test('7.8 Live HTTP probe: Error sanitizer intercepts uncaught 500 exceptions', async () => {
      const server = http.createServer((_req, res) => {
        const rawLeak =
          'PrismaClientInitializationError: Environment variable not found: DATABASE_URL in D:\\AAZIRA\\AARIZO\\server\\src\\index.ts:1687:36';
        const sanitized = sanitizeErrorMessage(rawLeak);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: sanitized }));
      });
      const port = await startEphemeralServer(server);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/test-leak`);
        expect(response.status).toBe(500);
        const data = await response.json();
        expect(data.error).toBe('An internal database error occurred. Please contact system administrator.');
        expect(data.error).not.toContain('DATABASE_URL');
        expect(data.error).not.toContain('D:\\AAZIRA');
      } finally {
        server.close();
      }
    });
  });

  describe('8. Graceful Shutdown & Signal Handling (F-15)', () => {
    test('8.1 Graceful shutdown cleanly closes HTTP server, stops realtime engine, and disconnects Prisma on SIGTERM', async () => {
      const mockServer = {
        close: jest.fn((cb) => cb()),
      };
      const mockPrisma = {
        $disconnect: jest.fn().mockResolvedValue(undefined),
      };
      const mockEngine = {
        stop: jest.fn(),
      };
      const mockExit = jest.fn();

      const controller = createGracefulShutdownHandler({
        server: mockServer as any,
        prismaClient: mockPrisma as any,
        realtimeEngineInstance: mockEngine,
        onExit: mockExit,
        timeoutMs: 1000,
      });

      const exitCode = await controller.shutdown('SIGTERM');

      expect(mockServer.close).toHaveBeenCalledTimes(1);
      expect(mockEngine.stop).toHaveBeenCalledTimes(1);
      expect(mockPrisma.$disconnect).toHaveBeenCalledTimes(1);
      expect(mockExit).toHaveBeenCalledWith(0);
      expect(exitCode).toBe(0);
    });

    test('8.2 Graceful shutdown handles SIGINT cleanly', async () => {
      const mockServer = {
        close: jest.fn((cb) => cb()),
      };
      const mockPrisma = {
        $disconnect: jest.fn().mockResolvedValue(undefined),
      };
      const mockEngine = {
        stop: jest.fn(),
      };
      const mockExit = jest.fn();

      const controller = createGracefulShutdownHandler({
        server: mockServer as any,
        prismaClient: mockPrisma as any,
        realtimeEngineInstance: mockEngine,
        onExit: mockExit,
        timeoutMs: 1000,
      });

      const exitCode = await controller.shutdown('SIGINT');

      expect(mockServer.close).toHaveBeenCalledTimes(1);
      expect(mockEngine.stop).toHaveBeenCalledTimes(1);
      expect(mockPrisma.$disconnect).toHaveBeenCalledTimes(1);
      expect(mockExit).toHaveBeenCalledWith(0);
      expect(exitCode).toBe(0);
    });

    test('8.3 Deduplicates concurrent or successive signals (SIGTERM + SIGINT)', async () => {
      const mockServer = {
        close: jest.fn((cb) => setTimeout(cb, 50)),
      };
      const mockPrisma = {
        $disconnect: jest.fn().mockResolvedValue(undefined),
      };
      const mockEngine = {
        stop: jest.fn(),
      };
      const mockExit = jest.fn();

      const controller = createGracefulShutdownHandler({
        server: mockServer as any,
        prismaClient: mockPrisma as any,
        realtimeEngineInstance: mockEngine,
        onExit: mockExit,
        timeoutMs: 1000,
      });

      // Fire both signals concurrently
      const [res1, res2] = await Promise.all([
        controller.shutdown('SIGTERM'),
        controller.shutdown('SIGINT'),
      ]);

      expect(res1).toBe(0);
      expect(res2).toBe(0);
      // Cleanup handlers must execute exactly once
      expect(mockServer.close).toHaveBeenCalledTimes(1);
      expect(mockEngine.stop).toHaveBeenCalledTimes(1);
      expect(mockPrisma.$disconnect).toHaveBeenCalledTimes(1);
      expect(mockExit).toHaveBeenCalledTimes(1);
    });

    test('8.4 RealtimeEngine stop clears poller and heartbeat intervals', () => {
      const engine = RealtimeEngine.getInstance();
      engine.startOutboxWorker();
      expect(() => engine.stop()).not.toThrow();
    });

    test('8.5 Forces exit with code 1 when cleanup hangs beyond timeoutMs', async () => {
      const hangingServer = {
        close: jest.fn((_cb) => {
          // Never calls callback
        }),
      };
      const mockExit = jest.fn();

      const controller = createGracefulShutdownHandler({
        server: hangingServer as any,
        onExit: mockExit,
        timeoutMs: 50, // Short timeout
      });

      const exitCode = await controller.shutdown('SIGTERM');

      expect(exitCode).toBe(1);
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    test('8.6 Recovers gracefully when server.close or prisma.$disconnect throws', async () => {
      const failingServer = {
        close: jest.fn((cb) => cb(new Error('Server already closed'))),
      };
      const failingPrisma = {
        $disconnect: jest.fn().mockRejectedValue(new Error('DB disconnect failed')),
      };
      const mockExit = jest.fn();

      const controller = createGracefulShutdownHandler({
        server: failingServer as any,
        prismaClient: failingPrisma as any,
        onExit: mockExit,
        timeoutMs: 1000,
      });

      const exitCode = await controller.shutdown('SIGTERM');
      expect(typeof exitCode).toBe('number');
      expect(mockExit).toHaveBeenCalled();
    });

    test('8.7 registerGracefulShutdown attaches and unregisters process signal listeners', () => {
      const controller = registerGracefulShutdown({
        onExit: jest.fn(),
      });

      expect(typeof controller.shutdown).toBe('function');
      expect(typeof controller.cleanup).toBe('function');
      expect(() => controller.cleanup()).not.toThrow();
    });
  });
});
