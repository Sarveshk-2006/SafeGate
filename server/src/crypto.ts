import crypto from 'crypto';

const scryptAsync = (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions
): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
};

/**
 * Constant-time string comparison preventing cryptographic timing attacks.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Generates a cryptographically random salt (16 bytes / 128 bits minimum).
 */
export function generateSalt(byteLength: number = 16): string {
  const safeBytes = Math.max(16, byteLength);
  return crypto.randomBytes(safeBytes).toString('hex');
}

/**
 * Target OWASP High-Assurance Scrypt Configuration (2026 Milestone Target):
 * N=131072 (2^17), r=8, p=1, 32-byte derived key.
 * Memory requirement: 128 MB (128 * 8 * 131072 bytes).
 * Bound maxmem to 256 MB.
 */
export const TARGET_SCRYPT_CONFIG = {
  N: 131072,
  r: 8,
  p: 1,
  keylen: 32,
  maxmem: 256 * 1024 * 1024,
} as const;

/**
 * Explicit allowlist of permissible (N, r, p) configurations.
 * Prevents arbitrary CPU/memory abuse from tampered database records.
 */
export const ALLOWED_SCRYPT_CONFIG_KEYS = new Set<string>([
  '131072:8:1', // Target 2026 High-Assurance Configuration (128 MB RAM, ~340ms)
  '65536:8:1',  // Standard OWASP Intermediate Configuration (64 MB RAM, ~170ms)
  '16384:8:1',  // SafeGate 2.0 Step 5.2 Initial Configuration (16 MB RAM, ~42ms)
]);

const SCRYPT_ENVELOPE_REGEX = /^\$scrypt\$N=(\d+),r=(\d+),p=(\d+)\$([0-9a-fA-F]{64})$/;
const HEX_SALT_REGEX = /^[0-9a-fA-F]{32,}$/;
const LEGACY_HMAC_REGEX = /^[0-9a-fA-F]{64}$/;

/**
 * Hashes a password using Node.js scrypt with the target high-assurance parameters:
 * N=131072 (cost factor), r=8 (block size), p=1 (parallelization), 32-byte derived key.
 * Envelope: $scrypt$N=131072,r=8,p=1$<64-character-hex>
 */
export function hashPasswordScrypt(password: string, salt: string): string {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string.');
  }
  if (!salt || typeof salt !== 'string') {
    throw new Error('Salt must be a non-empty string.');
  }
  if (!HEX_SALT_REGEX.test(salt)) {
    throw new Error('Salt must be a valid hexadecimal string of at least 16 bytes (32 hex characters).');
  }

  const { N, r, p, keylen, maxmem } = TARGET_SCRYPT_CONFIG;
  const key = crypto.scryptSync(password, salt, keylen, { N, r, p, maxmem });
  return `$scrypt$N=${N},r=${r},p=${p}$${key.toString('hex')}`;
}

/**
 * Asynchronously hashes a password using Node.js scrypt with target high-assurance parameters:
 * N=131072, r=8, p=1, 32-byte derived key.
 * Offloads memory-hard key derivation to libuv worker threadpool.
 */
export async function hashPasswordScryptAsync(password: string, salt: string): Promise<string> {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string.');
  }
  if (!salt || typeof salt !== 'string') {
    throw new Error('Salt must be a non-empty string.');
  }
  if (!HEX_SALT_REGEX.test(salt)) {
    throw new Error('Salt must be a valid hexadecimal string of at least 16 bytes (32 hex characters).');
  }

  const { N, r, p, keylen, maxmem } = TARGET_SCRYPT_CONFIG;
  const key = (await scryptAsync(password, salt, keylen, { N, r, p, maxmem })) as Buffer;
  return `$scrypt$N=${N},r=${r},p=${p}$${key.toString('hex')}`;
}

/**
 * Hashes a password using legacy HMAC-SHA256. Retained strictly for backwards-compatibility.
 */
export function hashPasswordHmac(password: string, salt: string): string {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string.');
  }
  if (!salt || typeof salt !== 'string') {
    throw new Error('Salt must be a non-empty string.');
  }
  return crypto.createHmac('sha256', salt).update(password).digest('hex');
}

/**
 * Unified password hashing entry point. Defaults to target scrypt configuration.
 */
export function hashPassword(
  password: string,
  salt: string,
  algorithm: 'scrypt' | 'hmac-sha256' = 'scrypt'
): string {
  if (algorithm === 'scrypt') {
    return hashPasswordScrypt(password, salt);
  }
  return hashPasswordHmac(password, salt);
}

/**
 * Checks whether a stored password hash should be transparently upgraded to the target scrypt configuration.
 */
export function needsRehash(storedHash: string | null | undefined): boolean {
  if (typeof storedHash !== 'string' || !storedHash) return false;
  return !storedHash.startsWith(`$scrypt$N=${TARGET_SCRYPT_CONFIG.N},r=${TARGET_SCRYPT_CONFIG.r},p=${TARGET_SCRYPT_CONFIG.p}$`);
}

/**
 * Constant-time password verification supporting allowlisted scrypt envelopes and legacy HMAC-SHA256.
 * Enforces strict pre-computation bounds checking, rejecting malformed, unsupported, or tampered values.
 */
export function verifyPassword(password: string, storedHash: string, salt: string): boolean {
  if (typeof password !== 'string' || typeof storedHash !== 'string' || typeof salt !== 'string') {
    return false;
  }
  if (!password || !storedHash || !salt) {
    return false;
  }

  // Pre-validate salt format and length (minimum 16 bytes = 32 hex chars)
  if (!HEX_SALT_REGEX.test(salt)) {
    return false;
  }

  // 1. Versioned scrypt envelope verification
  if (storedHash.startsWith('$scrypt$')) {
    const match = storedHash.match(SCRYPT_ENVELOPE_REGEX);
    if (!match) {
      return false; // Malformed envelope, truncated hex, or unsupported envelope syntax
    }

    const N = parseInt(match[1], 10);
    const r = parseInt(match[2], 10);
    const p = parseInt(match[3], 10);
    const expectedHex = match[4].toLowerCase();

    // Enforce explicit allowlist of parameter combinations before invoking scryptSync
    const configKey = `${N}:${r}:${p}`;
    if (!ALLOWED_SCRYPT_CONFIG_KEYS.has(configKey)) {
      return false; // Unsupported or tampered parameter configuration rejected without CPU work
    }

    try {
      const computedKey = crypto.scryptSync(password, salt, 32, {
        N,
        r,
        p,
        maxmem: 256 * 1024 * 1024,
      });
      return timingSafeCompare(computedKey.toString('hex'), expectedHex);
    } catch {
      return false;
    }
  }

  // 2. Legacy HMAC-SHA256 format (strictly 64 hex characters)
  if (LEGACY_HMAC_REGEX.test(storedHash)) {
    try {
      const computedHmac = crypto.createHmac('sha256', salt).update(password).digest('hex');
      return timingSafeCompare(computedHmac, storedHash.toLowerCase());
    } catch {
      return false;
    }
  }

  // Unknown or malformed hash scheme
  return false;
}

/**
 * Asynchronous constant-time password verification supporting allowlisted scrypt envelopes and legacy HMAC-SHA256.
 * Offloads scrypt key derivation to libuv worker threadpool, preventing main-thread event loop starvation.
 */
export async function verifyPasswordAsync(password: string, storedHash: string, salt: string): Promise<boolean> {
  if (typeof password !== 'string' || typeof storedHash !== 'string' || typeof salt !== 'string') {
    return false;
  }
  if (!password || !storedHash || !salt) {
    return false;
  }

  // Pre-validate salt format and length (minimum 16 bytes = 32 hex chars)
  if (!HEX_SALT_REGEX.test(salt)) {
    return false;
  }

  // 1. Versioned scrypt envelope verification
  if (storedHash.startsWith('$scrypt$')) {
    const match = storedHash.match(SCRYPT_ENVELOPE_REGEX);
    if (!match) {
      return false; // Malformed envelope, truncated hex, or unsupported envelope syntax
    }

    const N = parseInt(match[1], 10);
    const r = parseInt(match[2], 10);
    const p = parseInt(match[3], 10);
    const expectedHex = match[4].toLowerCase();

    // Enforce explicit allowlist of parameter combinations before invoking scrypt
    const configKey = `${N}:${r}:${p}`;
    if (!ALLOWED_SCRYPT_CONFIG_KEYS.has(configKey)) {
      return false; // Unsupported or tampered parameter configuration rejected without CPU work
    }

    try {
      const computedKey = (await scryptAsync(password, salt, 32, {
        N,
        r,
        p,
        maxmem: 256 * 1024 * 1024,
      })) as Buffer;
      return timingSafeCompare(computedKey.toString('hex'), expectedHex);
    } catch {
      return false;
    }
  }

  // 2. Legacy HMAC-SHA256 format (strictly 64 hex characters)
  if (LEGACY_HMAC_REGEX.test(storedHash)) {
    try {
      const computedHmac = crypto.createHmac('sha256', salt).update(password).digest('hex');
      return timingSafeCompare(computedHmac, storedHash.toLowerCase());
    } catch {
      return false;
    }
  }

  // Unknown or malformed hash scheme
  return false;
}

/**
 * Computes standard Razorpay HMAC SHA256 checkout signature.
 */
export function computeCheckoutSignature(orderId: string, paymentId: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

/**
 * Computes Razorpay Webhook HMAC SHA256 signature from raw payload buffer.
 */
export function computeWebhookSignature(rawBody: Buffer | string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
}
