# AARIZO — Password Hashing & Cryptographic Security Audit

**Document ID:** `AARIZO_ISSUE05_PASSWORD_HASHING_AUDIT`  
**Execution Phase:** Phase A, Step 5.1  
**Target:** Cryptographic evaluation of password hashing, salting, verification, and timing attack resistance  
**Date:** November 14, 2026  
**Auditor:** Antigravity Autonomous Security Engineer  

---

## 1. Executive Summary

This audit evaluates the password security architecture introduced in SafeGate 2.0 (commit `8204a21`), which powers user provisioning in [server/src/provisioning.ts](file:///d:/AAZIRA/AARIZO/server/src/provisioning.ts) and authentication verification in [server/src/index.ts](file:///d:/AAZIRA/AARIZO/server/src/index.ts).

### Key Audit Findings:
1. **Hashing Scheme**: The system employs single-iteration **HMAC-SHA256** with a per-user random salt (`crypto.createHmac('sha256', salt).update(password).digest('hex')`).
2. **Salt Quality**: Salt generation uses `crypto.randomBytes(16).toString('hex')` (128 bits of CSPRNG entropy), which satisfies OWASP minimum length requirements.
3. **Timing-Attack Resistance**: Verification uses `timingSafeCompare()` backed by `crypto.timingSafeEqual()`, effectively mitigating side-channel timing attacks.
4. **Seed Omission**: While dynamically provisioned users receive valid hashes and salts, **static seed scripts do not execute the hashing logic**, leaving database fields `NULL`.
5. **Architectural Evaluation**: HMAC-SHA256 provides zero external dependency overhead and high performance, but lacks the memory-hardness and configurable work factor of specialized password KDFs (such as Argon2id or bcrypt).

---

## 2. Password Hashing Algorithm Inspection

### Source Code Location:
[server/src/provisioning.ts](file:///d:/AAZIRA/AARIZO/server/src/provisioning.ts#L65-L67)

```typescript
export class UniversalProvisioningService {
  /**
   * Hashes a password using SHA-256 with a unique salt
   */
  public static hashPassword(password: string, salt: string): string {
    return crypto.createHmac('sha256', salt).update(password).digest('hex');
  }
...
```

### Cryptographic Analysis:
- **Primitive**: Keyed-Hash Message Authentication Code using SHA-256 (`HMAC-SHA256`, FIPS PUB 198-1).
- **Key Parameter**: The `salt` is utilized as the HMAC cryptographic key.
- **Input Message**: The plaintext `password` string is the message payload.
- **Output Format**: 64-character lowercase hexadecimal string (32 bytes / 256 bits).
- **Determinism**: Given an identical plaintext password and salt, the function is strictly deterministic.
- **Dependency Footprint**: Relies exclusively on Node.js built-in `crypto` module. No external native C++ compilation (e.g. `node-gyp`, `bcrypt`, `argon2`), ensuring cross-platform stability across Windows, macOS, Linux, and Docker Alpine environments.

---

## 3. Salt Generation & Entropy Evaluation

### Source Code Location:
[server/src/provisioning.ts](file:///d:/AAZIRA/AARIZO/server/src/provisioning.ts#L107, L286)

```typescript
const salt = crypto.randomBytes(16).toString('hex');
```

### Entropy Assessment:
| Property | Value | Security Standard Evaluation |
| :--- | :--- | :--- |
| **Entropy Source** | OS CSPRNG (`/dev/urandom` on POSIX, `BCryptGenRandom` on Win32) | Meets cryptographic standards |
| **Raw Byte Length** | 16 bytes (128 bits) | Fully complies with OWASP (min 128 bits) |
| **Encoded String Length** | 32 hex characters | Standard hexadecimal representation |
| **Uniqueness Guarantee** | Unique per user record | Defeats precomputed rainbow table attacks |
| **Storage Location** | `users.salt` (`VARCHAR(64)` / `String?`) | Stored in plaintext alongside hash in PostgreSQL |

**Finding**: The salt generation is cryptographically sound, high-entropy, and safe against collision and rainbow table attacks.

---

## 4. Hash Verification & Timing-Attack Resistance

### Source Code Location:
[server/src/index.ts](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L1762-L1765)  
[server/src/crypto.ts](file:///d:/AAZIRA/AARIZO/server/src/crypto.ts#L6-L12)

```typescript
// server/src/index.ts:1762
const computedHash = UniversalProvisioningService.hashPassword(password, user.salt);
if (!timingSafeCompare(computedHash, user.passwordHash)) {
  return res.status(401).json({ error: 'Invalid email or password' });
}

// server/src/crypto.ts:6-12
export function timingSafeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
```

### Security Evaluation:
1. **Constant-Time Comparison**:
   `crypto.timingSafeEqual(bufA, bufB)` compares the two byte buffers in time independent of where the first byte mismatch occurs. This completely prevents statistical timing attacks where an attacker measures nanosecond latency differences to deduce hash characters byte-by-byte.
2. **Buffer Length Guard**:
   `if (bufA.length !== bufB.length) return false;` prevents `timingSafeEqual` from throwing a `RangeError` (which Node.js throws if buffer lengths do not match). Because valid SHA-256 hex digests are invariant at 64 bytes, length comparison between valid hashes will always proceed to the constant-time path.
3. **Type Safety**:
   The initial type guard `typeof a !== 'string' || typeof b !== 'string'` ensures no runtime type confusion can crash the authentication handler.

---

## 5. Security Comparison: HMAC-SHA256 vs. Specialized KDFs

| Evaluation Metric | SafeGate 2.0 (HMAC-SHA256) | OWASP Recommended (Argon2id / bcrypt) | Assessment |
| :--- | :--- | :--- | :--- |
| **Computational Hardness** | Very Low (< 0.1 ms per hash) | Configurable / High (100–300 ms per hash) | SafeGate allows higher throughput, but is more vulnerable to offline brute-forcing if database is leaked |
| **Memory Hardness** | None (0 KB memory footprint) | High (19 MiB for Argon2id) | Vulnerable to ASIC/GPU mass parallelization if hashes are stolen |
| **External Dependencies** | Zero (Built-in Node `crypto`) | Requires native bindings or WebAssembly | SafeGate has 100% build reliability on Windows & Docker |
| **Rainbow Table Defense** | Complete (16-byte random salt per user) | Complete (Unique salt per user) | Equal protection against precomputed tables |
| **Timing Attack Defense** | Constant-time `timingSafeEqual` | Constant-time verification | Equal protection |

### Architectural Verdict:
For SafeGate 2.0 / AARIZO's current architecture, **HMAC-SHA256 with 16-byte random salt is the established contract** across both provisioning and authentication modules. Modifying the hashing algorithm in Step 5.2 would break compatibility with already-provisioned records and requires a multi-phase migration (ISSUE-05 scope is strictly fixing seeded users to adhere to this contract).

However, to harden this architecture against offline attacks in future milestones (Phase B/C), a migration path toward Argon2id or a server-side pepper secret should be scheduled.

---

## 6. Identified Vulnerabilities in the Authentication Handler

### Vulnerability 1: Account Enumeration (CWE-204)
**Location:** [server/src/index.ts:1756-1760](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L1756-L1760)

```typescript
if (!user) {
  return res.status(401).json({ error: 'Invalid email or password' });
}
if (!user.passwordHash || !user.salt) {
  return res.status(401).json({ 
    error: 'Password authentication is not configured for this user. Please contact administrator.' 
  });
}
```

- **Impact:** An attacker testing emails can distinguish between:
  - Non-existent emails (`"Invalid email or password"`)
  - Valid accounts without password configured (`"Password authentication is not configured for this user..."`)
  - Valid accounts with wrong password (`"Invalid email or password"`)
- **Remediation:** Unify the response to return `res.status(401).json({ error: 'Invalid email or password' })` in both conditions.

---

### Vulnerability 2: Missing Account Status Verification (CWE-285)
**Location:** [server/src/index.ts:1766](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L1766)

- **Impact:** The handler verifies the password and immediately generates a JWT token without checking whether `user.status === 'ACTIVE'`. If a user is deactivated, suspended, or marked pending, they can still successfully authenticate.
- **Remediation:** Add an explicit guard:
  ```typescript
  if (user.status !== 'ACTIVE') {
    return res.status(403).json({ error: 'Account is inactive or suspended. Please contact administrator.' });
  }
  ```

---

### Vulnerability 3: Missing Rate Limiting on Login Route
**Location:** [server/src/index.ts:1746](file:///d:/AAZIRA/AARIZO/server/src/index.ts#L1746)

- **Impact:** `POST /api/auth/login` does not apply dedicated per-IP or per-email brute-force protection middleware.
- **Remediation:** Apply rate limiting middleware or track failed attempts.

