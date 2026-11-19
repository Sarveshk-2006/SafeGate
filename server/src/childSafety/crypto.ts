import crypto from 'crypto';
import { timingSafeCompare } from '../crypto.js';

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const QR_PREFIX = 'AARIZO_CHILD_PASS:';
const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;

/**
 * Generates a cryptographically secure random bearer token with 256 bits of entropy.
 * Returned ONCE to the authorized caller upon pass creation; never logged or stored raw.
 */
export function generateChildPassBearerToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Computes the canonical SHA-256 hex digest (64 lowercase hex chars) of a raw bearer token.
 * Matches PostgreSQL CHECK constraint `chk_child_passes_token_hash_format`.
 */
export function hashChildPassToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

/**
 * Constant-time verification of a presented raw bearer token against a stored SHA-256 hex hash.
 */
export function verifyChildPassTokenConstantTime(rawToken: string, storedHash: string): boolean {
  if (!rawToken || !storedHash || !SHA256_HEX_REGEX.test(storedHash)) {
    return false;
  }
  const computed = hashChildPassToken(rawToken);
  return timingSafeCompare(computed, storedHash);
}

/**
 * Generates a human-readable display/reference pass code (40 bits CSPRNG entropy, e.g., CGP-7K9M-2P4X).
 * Strictly a display label — NEVER accepted as standalone gate authorization.
 */
export function generateDisplayPassCode(): string {
  const bytes = crypto.randomBytes(8);
  let chars = '';
  for (let i = 0; i < 8; i++) {
    chars += CROCKFORD_ALPHABET[bytes[i] & 31];
  }
  return `CGP-${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

/**
 * Encodes ONLY the opaque bearer token into the QR payload string (zero child PII or predictable IDs).
 */
export function encodeChildPassQrPayload(rawToken: string): string {
  return `${QR_PREFIX}${rawToken}`;
}

/**
 * Extracts a raw bearer token from either `bearerToken` or `AARIZO_CHILD_PASS:<token>` QR payload.
 * Rejects short display codes (e.g., CGP-XXXX-XXXX) so passCode can never impersonate a bearer token.
 */
export function extractBearerToken(input: { bearerToken?: unknown; qrPayload?: unknown }): string | null {
  let candidate: string | null = null;

  if (typeof input.bearerToken === 'string' && input.bearerToken.trim().length > 0) {
    candidate = input.bearerToken.trim();
  } else if (typeof input.qrPayload === 'string' && input.qrPayload.trim().length > 0) {
    const trimmed = input.qrPayload.trim();
    candidate = trimmed.startsWith(QR_PREFIX) ? trimmed.slice(QR_PREFIX.length).trim() : trimmed;
  }

  if (!candidate) return null;

  // Reject display pass codes and low-entropy tokens (< 32 chars cannot hold 256-bit base64url)
  if (/^CGP-/i.test(candidate) || candidate.length < 32 || candidate.length > 256) {
    return null;
  }

  return candidate;
}

