import { Request, Response, NextFunction } from 'express';

/**
 * Dedicated bounded in-memory sliding-window rate limiters for sensitive Child Safety endpoints
 * (gate pass verification, pass generation, and SOS alert triggers).
 *
 * Security & Resource Guarantees (F-B22-04):
 * - Expired buckets are deterministically evicted on write sweeps.
 * - Strict maximum bucket capacity prevents unbounded memory growth; when capacity is genuinely
 *   exhausted by active entries, new keys fail closed with HTTP 429 + Retry-After.
 * - Identity is derived from verified `req.authContext.userId` first (immune to spoofed X-Forwarded-For);
 *   network fallback uses socket remote address / Express `req.ip` (respecting trusted proxy config).
 *
 * Distributed deployment note: in multi-instance deployments, replace the in-memory Map
 * with a shared Redis sliding-window store so quotas are enforced across all API replicas.
 */

interface RateLimitBucket {
  count: number;
  resetTime: number;
}

const DEFAULT_MAX_BUCKETS = 5_000;
const SWEEP_INTERVAL_WRITES = 100;

const verifyBuckets = new Map<string, RateLimitBucket>();
const passCreateBuckets = new Map<string, RateLimitBucket>();
const sosBuckets = new Map<string, RateLimitBucket>();

function sweepExpiredBuckets(buckets: Map<string, RateLimitBucket>, now: number): number {
  let removed = 0;
  for (const [k, v] of buckets.entries()) {
    if (now > v.resetTime) {
      buckets.delete(k);
      removed += 1;
    }
  }
  return removed;
}

function resolveTrustedClientKey(req: Request): string {
  // Primary: authenticated DB-resolved user ID (cannot be spoofed by client headers)
  if (req.authContext?.userId) {
    const soc = req.authContext.societyId || 'none';
    return `usr:${req.authContext.userId}:${soc}`;
  }
  // Fallback: direct socket peer address (never parses raw untrusted X-Forwarded-For header directly)
  const peerAddr = req.socket?.remoteAddress || req.ip || 'unknown';
  return `net:${peerAddr}`;
}

export interface SlidingWindowOptions {
  maxRequests: number;
  windowMs: number;
  maxBuckets?: number;
  code: string;
  errorMessage: string;
}

export function createBoundedSlidingWindowLimiter(
  buckets: Map<string, RateLimitBucket>,
  options: SlidingWindowOptions
) {
  const { maxRequests, windowMs, code, errorMessage } = options;
  const maxBuckets = Math.max(1, options.maxBuckets ?? DEFAULT_MAX_BUCKETS);
  let writesSinceSweep = 0;

  return (req: Request, res: Response, next: NextFunction) => {
    const key = resolveTrustedClientKey(req);
    const now = Date.now();

    writesSinceSweep += 1;
    if (writesSinceSweep >= SWEEP_INTERVAL_WRITES || buckets.size >= maxBuckets) {
      sweepExpiredBuckets(buckets, now);
      writesSinceSweep = 0;
    }

    const record = buckets.get(key);

    if (!record || now > record.resetTime) {
      if (!record && buckets.size >= maxBuckets) {
        // One final sweep before failing closed on capacity exhaustion
        sweepExpiredBuckets(buckets, now);
        if (buckets.size >= maxBuckets) {
          const retryAfterSeconds = Math.max(1, Math.ceil(windowMs / 1000));
          res.setHeader('Retry-After', String(retryAfterSeconds));
          return res.status(429).json({
            error: 'Rate limiter capacity temporarily exhausted. Please retry shortly.',
            code: 'RATE_LIMIT_CAPACITY_EXCEEDED',
            retryAfterMs: windowMs,
            retryAfterSeconds,
          });
        }
      }

      buckets.set(key, { count: 1, resetTime: now + windowMs });
      return next();
    }

    record.count += 1;
    if (record.count > maxRequests) {
      const retryAfterMs = Math.max(1, record.resetTime - now);
      const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        error: errorMessage,
        code,
        retryAfterMs,
        retryAfterSeconds,
      });
    }

    return next();
  };
}

export const childPassVerifyRateLimiter = (
  maxRequests = 30,
  windowMs = 60_000,
  maxBuckets = DEFAULT_MAX_BUCKETS
) =>
  createBoundedSlidingWindowLimiter(verifyBuckets, {
    maxRequests,
    windowMs,
    maxBuckets,
    code: 'CHILD_PASS_VERIFY_RATE_LIMITED',
    errorMessage: 'Too many child gate pass verification attempts. Please wait before retrying.',
  });

export const childPassCreateRateLimiter = (
  maxRequests = 20,
  windowMs = 600_000,
  maxBuckets = DEFAULT_MAX_BUCKETS
) =>
  createBoundedSlidingWindowLimiter(passCreateBuckets, {
    maxRequests,
    windowMs,
    maxBuckets,
    code: 'CHILD_PASS_CREATE_RATE_LIMITED',
    errorMessage: 'Too many child gate pass creation requests. Please wait before generating another pass.',
  });

export const childSosRateLimiter = (
  maxRequests = 10,
  windowMs = 300_000,
  maxBuckets = DEFAULT_MAX_BUCKETS
) =>
  createBoundedSlidingWindowLimiter(sosBuckets, {
    maxRequests,
    windowMs,
    maxBuckets,
    code: 'CHILD_SOS_RATE_LIMITED',
    errorMessage: 'Too many SOS requests submitted in a short period. Please wait before retrying.',
  });

/**
 * Resets in-memory rate-limit counters (intended for deterministic automated testing).
 */
export function resetChildSafetyRateLimiters(): void {
  verifyBuckets.clear();
  passCreateBuckets.clear();
  sosBuckets.clear();
}

export function getChildSafetyRateLimiterStats(): {
  verifyBucketCount: number;
  passCreateBucketCount: number;
  sosBucketCount: number;
} {
  return {
    verifyBucketCount: verifyBuckets.size,
    passCreateBucketCount: passCreateBuckets.size,
    sosBucketCount: sosBuckets.size,
  };
}
