import { URL } from 'url';

export interface DatabaseValidationResult {
  isValid: boolean;
  error?: string;
  redactedUrl?: string;
}

export interface DatabaseReadinessResult {
  ready: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * Redacts database credentials from a connection URL for safe logging and diagnostics.
 * e.g. postgresql://admin:secret123@localhost:5432/aarizo_community -> postgresql://admin:***@localhost:5432/aarizo_community
 */
export function redactDatabaseUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const user = parsed.username || 'user';
    const host = parsed.hostname || 'localhost';
    const port = parsed.port ? `:${parsed.port}` : '';
    const pathname = parsed.pathname || '';
    const search = parsed.search ? '?schema=...' : '';
    return `${parsed.protocol}//${user}:***@${host}${port}${pathname}${search}`;
  } catch {
    return '[INVALID_DATABASE_URL_REDACTED]';
  }
}

/**
 * Redacts sensitive tokens, passwords, and secrets from arbitrary log strings.
 */
export function redactSensitiveData(input: string): string {
  if (!input) return '';
  return input
    // Redact postgresql URLs
    .replace(/postgres(ql)?:\/\/([^:]+):([^@]+)@/gi, 'postgresql://$2:***@')
    // Redact Bearer tokens
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    // Redact password parameters
    .replace(/"password":\s*"[^"]*"/gi, '"password":"[REDACTED]"')
    .replace(/"secret":\s*"[^"]*"/gi, '"secret":"[REDACTED]"');
}

/**
 * Validates the database configuration against required format and PostgreSQL schemes.
 * Does NOT log credentials or secrets.
 */
export function validateDatabaseConfiguration(explicitUrl?: string): DatabaseValidationResult {
  const urlToValidate = explicitUrl !== undefined ? explicitUrl : process.env.DATABASE_URL;

  if (!urlToValidate || urlToValidate.trim() === '') {
    return {
      isValid: false,
      error: 'DATABASE_URL environment variable is missing or empty. A valid PostgreSQL connection string is required (e.g., postgresql://aarizo_admin:password@localhost:5432/aarizo_community?schema=public).',
    };
  }

  const trimmed = urlToValidate.trim();

  // Validate supported PostgreSQL schemes
  if (!/^postgres(ql)?:\/\//i.test(trimmed)) {
    return {
      isValid: false,
      error: "DATABASE_URL scheme is invalid. Must begin with 'postgresql://' or 'postgres://'.",
    };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
      return {
        isValid: false,
        error: `Unsupported database protocol '${parsed.protocol}'. Expected 'postgresql:' or 'postgres:'.`,
      };
    }

    if (!parsed.hostname || parsed.hostname.trim() === '') {
      return {
        isValid: false,
        error: 'DATABASE_URL is missing a valid host name.',
      };
    }

    return {
      isValid: true,
      redactedUrl: redactDatabaseUrl(trimmed),
    };
  } catch {
    return {
      isValid: false,
      error: 'DATABASE_URL is not a syntactically valid connection URL.',
    };
  }
}

/**
 * Asserts database configuration on startup.
 * Throws a fatal Error if configuration is missing or invalid.
 */
export function assertDatabaseConfiguration(): void {
  const validation = validateDatabaseConfiguration();
  if (!validation.isValid) {
    throw new Error(`[FATAL DATABASE CONFIG ERROR] ${validation.error}`);
  }
}

/**
 * Sanitizes error messages for public client responses, preventing internal schema,
 * table names, filesystem paths, or database stack traces from leaking to clients.
 */
export function sanitizeErrorMessage(error: unknown, fallbackMessage = 'An internal server error occurred.'): string {
  if (!error) return fallbackMessage;

  const rawMessage = error instanceof Error ? error.message : String(error);

  // Check for Prisma or database runtime internals
  const isInternalDbLeak =
    rawMessage.includes('prisma') ||
    rawMessage.includes('Prisma') ||
    rawMessage.includes('DATABASE_URL') ||
    rawMessage.includes('schema.prisma') ||
    rawMessage.includes('invocation in') ||
    rawMessage.includes('SELECT') ||
    rawMessage.includes('INSERT INTO') ||
    rawMessage.includes('UPDATE') ||
    rawMessage.includes('DELETE FROM') ||
    (error as any)?.name?.startsWith('Prisma');

  if (isInternalDbLeak) {
    return 'An internal database error occurred. Please contact system administrator.';
  }

  // Check for absolute filesystem paths or stack trace frames
  const isPathOrStackLeak =
    rawMessage.includes('\\server\\') ||
    rawMessage.includes('/server/') ||
    rawMessage.includes(':\\') ||
    rawMessage.includes('/app/dist') ||
    rawMessage.includes(' at ') ||
    rawMessage.includes('.ts:') ||
    rawMessage.includes('.js:');

  if (isPathOrStackLeak) {
    return fallbackMessage;
  }

  return rawMessage;
}

/**
 * Performs a bounded database connectivity probe using Prisma raw query.
 * Times out if the database does not respond within timeoutMs (default 2000ms).
 */
export async function checkDatabaseReadiness(
  prismaClient: any,
  timeoutMs = 2000
): Promise<DatabaseReadinessResult> {
  const startTime = Date.now();

  try {
    if (!prismaClient || typeof prismaClient.$queryRaw !== 'function') {
      return {
        ready: false,
        error: 'Prisma client is not initialized or unavailable.',
      };
    }

    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('DATABASE_PROBE_TIMEOUT'));
      }, timeoutMs);
      timer.unref?.();
    });

    try {
      await Promise.race([
        prismaClient.$queryRaw`SELECT 1`,
        timeoutPromise,
      ]);
      const latencyMs = Date.now() - startTime;
      return { ready: true, latencyMs };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (err: any) {
    const isTimeout = err?.message === 'DATABASE_PROBE_TIMEOUT';
    return {
      ready: false,
      error: isTimeout ? 'Database probe timed out.' : 'Database connection check failed.',
    };
  }
}

