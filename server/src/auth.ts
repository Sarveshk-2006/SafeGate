import './env.js';
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from './prisma.js';
import { timingSafeCompare } from './crypto.js';

let firebaseAuthInstance: any = null;

const getFirebaseAuth = async () => {
  if (!firebaseAuthInstance) {
    const { getApps, initializeApp, cert } = await import('firebase-admin/app');
    const { getAuth } = await import('firebase-admin/auth');

    if (!getApps().length) {
      const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
      if (serviceAccountKey) {
        const parsed = JSON.parse(serviceAccountKey);
        initializeApp({ credential: cert(parsed) });
      } else {
        initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || 'aarizo-community' });
      }
    }
    firebaseAuthInstance = getAuth();
  }
  return firebaseAuthInstance;
};

export interface AuthenticatedUserContext {
  userId: string;
  firebaseUid?: string;
  email?: string;
  role: string;
  societyId: string;
  name: string;
}

export interface ServerTokenPayload {
  sub: string;
  email?: string;
  role: string;
  societyId: string;
  name: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
  jti: string;
}

declare global {
  namespace Express {
    interface Request {
      authContext?: AuthenticatedUserContext;
    }
  }
}

let devEphemeralSecret: string | null = null;

export const resetDevEphemeralSecret = (): void => {
  devEphemeralSecret = null;
};

/**
 * Validates the authentication configuration at startup.
 * In production, fails closed if AUTH_SECRET is missing or insufficiently strong.
 */
export const validateAuthConfiguration = (): void => {
  const isProduction = process.env.NODE_ENV === 'production';
  const secret = process.env.AUTH_SECRET || process.env.JWT_SECRET;

  if (isProduction) {
    if (!secret) {
      throw new Error(
        'FATAL: Production authentication secret is missing. Set AUTH_SECRET with at least 32 cryptographically random characters.'
      );
    }
    if (secret.length < 32) {
      throw new Error(
        'FATAL: Production authentication secret is insufficiently strong. Minimum length is 32 characters.'
      );
    }
  }
};

/**
 * Evaluates whether development mock token authentication is explicitly permitted.
 * - Strictly forbidden in production under all configurations.
 * - Missing or undefined NODE_ENV will never enable mock auth.
 * - In development or test, requires explicit ENABLE_DEV_MOCK_AUTH === 'true'.
 */
export const isMockAuthEnabled = (): boolean => {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  const isAllowedEnv = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
  return isAllowedEnv && process.env.ENABLE_DEV_MOCK_AUTH === 'true';
};

/**
 * Retrieves the cryptographic secret for signing and verifying tokens.
 * - In production: strictly requires AUTH_SECRET or JWT_SECRET (>= 32 chars). Never falls back to a hardcoded string.
 * - In development / test: uses configured secret if present, or generates an ephemeral in-memory random 32-byte secret.
 * The secret value is never printed or leaked in logs or error messages.
 */
export const getAuthSecret = (): string => {
  const isProduction = process.env.NODE_ENV === 'production';
  const secret = process.env.AUTH_SECRET || process.env.JWT_SECRET;

  if (secret) {
    if (isProduction && secret.length < 32) {
      throw new Error(
        'FATAL: Production authentication secret is insufficiently strong. Minimum length is 32 characters.'
      );
    }
    return secret;
  }

  if (isProduction) {
    throw new Error(
      'FATAL: Production authentication secret is missing. Set AUTH_SECRET with at least 32 cryptographically random characters.'
    );
  }

  // Non-production safe ephemeral random secret (generated fresh per process, never hardcoded)
  if (!devEphemeralSecret) {
    devEphemeralSecret = crypto.randomBytes(32).toString('hex');
  }
  return devEphemeralSecret;
};

/**
 * Generates an authoritative HMAC-SHA256 Bearer access token
 */
export const generateAuthToken = (
  payload: Omit<ServerTokenPayload, 'iat' | 'exp' | 'iss' | 'aud' | 'jti'>,
  expiresInSeconds = 86400 // 24 hours
): string => {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: ServerTokenPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
    iss: 'aarizo-api',
    aud: 'aarizo-client',
    jti: crypto.randomUUID(),
  };

  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', getAuthSecret())
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  return `${headerB64}.${payloadB64}.${signature}`;
};

/**
 * Cryptographically verifies an HMAC-SHA256 server token in constant time
 */
export const verifyServerToken = (tokenString: string): ServerTokenPayload | null => {
  if (!tokenString || typeof tokenString !== 'string') return null;
  const parts = tokenString.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sigB64] = parts;

  // Validate constant-time HMAC signature
  const expectedSig = crypto
    .createHmac('sha256', getAuthSecret())
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  if (!timingSafeCompare(sigB64, expectedSig)) {
    return null;
  }

  try {
    const payload: ServerTokenPayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

    // Validate claims & expiry
    const now = Math.floor(Date.now() / 1000);
    if (!payload.sub || !payload.exp || payload.exp < now) {
      return null;
    }

    if (payload.iss !== 'aarizo-api' || payload.aud !== 'aarizo-client') {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
};

/**
 * P0 Security Unified Authentication Middleware
 * Supports Dual-Mode Authentication:
 * 1. Server-Issued Cryptographic HMAC-SHA256 Tokens (from password login)
 * 2. Google Firebase ID Tokens (from phone OTP login)
 * 3. Secure Development Tokens (strictly non-production, bound to PostgreSQL)
 * Resolves authoritative user profile from PostgreSQL and rejects all unverified identity headers.
 */
export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let token = '';
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split('Bearer ')[1].trim();
  } else if (req.query && typeof req.query.token === 'string') {
    // SSE EventSource stream support
    token = req.query.token.trim();
  }

  // Authorization Bearer token is strictly required. Unverified identity headers are never trusted.
  if (!token) {
    return res.status(401).json({
      error: 'Unauthorized: Missing or malformed Bearer authorization token',
      code: 'AUTH_TOKEN_MISSING',
    });
  }

  try {
    let uid = '';
    let email = '';
    let claimsRole: string | undefined;
    let claimsSocietyId: string | undefined;

    // 1. Verify if token is a Backend-Issued HMAC-SHA256 Token
    const serverPayload = verifyServerToken(token);
    if (serverPayload) {
      uid = serverPayload.sub;
      email = serverPayload.email || '';
      claimsRole = serverPayload.role.toLowerCase();
      claimsSocietyId = serverPayload.societyId;
    } else {
      // 2. Verify if token is a Google Firebase ID Token
      let isFirebaseVerified = false;
      try {
        const auth = await getFirebaseAuth();
        const decoded = await auth.verifyIdToken(token);
        uid = decoded.uid;
        email = decoded.email || '';
        claimsRole = decoded.role ? String(decoded.role).toLowerCase() : undefined;
        claimsSocietyId = decoded.societyId ? String(decoded.societyId) : undefined;
        isFirebaseVerified = true;
      } catch (fbErr: any) {
        // Fall through to dev check
      }

      if (!isFirebaseVerified) {
        // 3. Local dev/testing fallback (strictly explicit opt-in with ENABLE_DEV_MOCK_AUTH === 'true')
        if (isMockAuthEnabled() && token.startsWith('mock_token_')) {
          uid = token.replace('mock_token_', '');
        } else {
          return res.status(401).json({
            error: 'Unauthorized: Invalid or expired Bearer token',
            code: 'AUTH_TOKEN_INVALID',
          });
        }
      }
    }

    // Look up authoritative PostgreSQL User record
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ id: uid }, ...(email ? [{ email }] : [])],
      },
    });

    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized: User profile does not exist in authoritative database',
        code: 'USER_NOT_PROVISIONED',
      });
    }

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({
        error: 'Forbidden: Account has been suspended or deactivated by society administration',
        code: 'ACCOUNT_SUSPENDED',
      });
    }

    // Establish trusted server-side request context
    // Authoritative society membership MUST come strictly from the current PostgreSQL user record.
    // Stale JWT claimsSocietyId is NEVER used as a fallback when DB user.societyId is null.
    const effectiveRole = user.role.toLowerCase();
    const effectiveSocietyId =
      user.societyId || (effectiveRole === 'admin' ? 'soc-platform' : undefined);

    req.authContext = {
      userId: user.id,
      firebaseUid: uid,
      email: user.email || undefined,
      role: effectiveRole,
      societyId: effectiveSocietyId as string,
      name: user.name,
    };

    req.societyId = effectiveSocietyId;
    req.userId = user.id;
    req.userRole = effectiveRole;

    next();
  } catch (err: any) {
    return res.status(500).json({
      error: 'Authentication failed due to server error',
      code: 'AUTH_INTERNAL_ERROR',
    });
  }
};

export const authenticateFirebaseToken = authenticateToken;

/**
 * Deny-by-default role-based authorization middleware
 */
export const requireRole = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Authoritative role must originate exclusively from verified authContext
    const role = (req.authContext?.role || '').toLowerCase();

    if (!role) {
      return res.status(403).json({
        error: 'Access denied: No authenticated role found',
        code: 'ROLE_MISSING',
      });
    }

    // Platform admin has universal administrative access
    if (role === 'admin') {
      return next();
    }

    const normalizedAllowed = allowedRoles.map((r) => r.toLowerCase());
    if (normalizedAllowed.includes(role)) {
      return next();
    }

    return res.status(403).json({
      error: `Access denied: Role '${role}' lacks permission for this endpoint`,
      code: 'INSUFFICIENT_PERMISSIONS',
      requiredRoles: allowedRoles,
    });
  };
};

/**
 * Multi-tenant isolation verification middleware
 * Guarantees that users cannot query or mutate records belonging to other societies
 */
export const requireSocietyMembership = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const requestSocietyId = req.params.societyId || req.body.societyId || req.query.societyId;
  // Authoritative tenant context and role must originate exclusively from verified authContext
  const userSocietyId = req.authContext?.societyId;
  const userRole = (req.authContext?.role || '').toLowerCase();

  if (userRole === 'admin') {
    return next();
  }

  if (!userSocietyId) {
    return res.status(403).json({
      error: 'Tenant context required: User is not linked to any active society',
      code: 'TENANT_CONTEXT_REQUIRED',
    });
  }

  if (requestSocietyId && userSocietyId && requestSocietyId !== userSocietyId) {
    return res.status(403).json({
      error: 'Cross-society tenant access denied: Resource belongs to a different society',
      code: 'TENANT_ISOLATION_VIOLATION',
    });
  }

  next();
};

/**
 * In-memory sliding window rate limiter for security against brute-force attacks
 */
const requestCounts = new Map<string, { count: number; resetTime: number }>();

export const rateLimiter = (maxRequests = 100, windowMs = 60000) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = requestCounts.get(ip);

    if (!record || now > record.resetTime) {
      requestCounts.set(ip, { count: 1, resetTime: now + windowMs });
      return next();
    }

    record.count += 1;
    if (record.count > maxRequests) {
      return res.status(429).json({
        error: 'Too many requests. Please slow down.',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfterMs: record.resetTime - now,
      });
    }

    next();
  };
};

/**
 * Dedicated in-memory sliding window rate limiter for login attempts.
 * Stricter default: 10 attempts per minute per IP address.
 */
const loginAttemptCounts = new Map<string, { count: number; resetTime: number }>();

export const loginRateLimiter = (maxRequests = 10, windowMs = 60000) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = loginAttemptCounts.get(ip);

    if (!record || now > record.resetTime) {
      loginAttemptCounts.set(ip, { count: 1, resetTime: now + windowMs });
      return next();
    }

    record.count += 1;
    if (record.count > maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((record.resetTime - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        error: 'Too many login attempts. Please slow down.',
        code: 'LOGIN_RATE_LIMIT_EXCEEDED',
        retryAfterMs: record.resetTime - now,
        retryAfterSeconds,
      });
    }

    next();
  };
};

/**
 * Bounded Concurrency Semaphore for Expensive Password Derivation (Scrypt).
 * Ensures memory allocations (128 MiB per operation at N=131072) cannot exceed host capacity.
 * Default 4 concurrent slots = max 512 MiB total scrypt RAM overhead, matching default libuv threadpool.
 */
export class AuthConcurrencyLimiter {
  private activeCount = 0;
  private readonly maxConcurrent: number;

  constructor(maxConcurrent?: number) {
    const envLimit = parseInt(process.env.AUTH_MAX_CONCURRENT_HASHES || '', 10);
    const configured = !isNaN(envLimit) && envLimit > 0 ? envLimit : (maxConcurrent || 4);
    // Strict upper bound of 16 to prevent dangerous unbounded allocation
    this.maxConcurrent = Math.min(Math.max(1, configured), 16);
  }

  public getMaxConcurrent(): number {
    return this.maxConcurrent;
  }

  public getActiveCount(): number {
    return this.activeCount;
  }

  public tryAcquire(): boolean {
    if (this.activeCount >= this.maxConcurrent) {
      return false;
    }
    this.activeCount++;
    return true;
  }

  public release(): void {
    if (this.activeCount > 0) {
      this.activeCount--;
    }
  }

  public reset(): void {
    this.activeCount = 0;
  }
}

export const authConcurrencyLimiter = new AuthConcurrencyLimiter();
