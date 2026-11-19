import fs from 'fs';
import path from 'path';
import type { UserRole } from '../src/domains/auth/types';

/**
 * Unit & Static Security Tests for Route Protection (ISSUE-01: /dev/database)
 */

describe('ISSUE-01 Route Protection & Access Control (/dev/database & /dev/db)', () => {
  // Pure logic replica of ProtectedRoute guard logic from src/routes/ProtectedRoute.tsx
  const evaluateAccess = (
    status: string,
    activeRole: string,
    allowedRoles?: string[]
  ): { allowed: boolean; redirectUrl?: string } => {
    if (status !== 'AUTHENTICATED') {
      return { allowed: false, redirectUrl: '/login' };
    }

    if (allowedRoles && allowedRoles.length > 0) {
      const normalizedAllowed = allowedRoles.map((r) => r.toLowerCase());
      if (!normalizedAllowed.includes(activeRole.toLowerCase())) {
        return { allowed: false, redirectUrl: '/unauthorized' };
      }
    }

    return { allowed: true };
  };

  const DEV_DATABASE_ALLOWED_ROLES: UserRole[] = ['admin'];

  test('Logged-out visitor (UNAUTHENTICATED) is blocked and redirected to /login', () => {
    const result = evaluateAccess('UNAUTHENTICATED', 'resident', DEV_DATABASE_ALLOWED_ROLES);
    expect(result.allowed).toBe(false);
    expect(result.redirectUrl).toBe('/login');
  });

  test('Authentication still loading / initializing is blocked and redirected to /login', () => {
    const result = evaluateAccess('INITIALIZING', 'admin', DEV_DATABASE_ALLOWED_ROLES);
    expect(result.allowed).toBe(false);
    expect(result.redirectUrl).toBe('/login');
  });

  test('Authenticated Resident is forbidden and redirected to /unauthorized', () => {
    const result = evaluateAccess('AUTHENTICATED', 'resident', DEV_DATABASE_ALLOWED_ROLES);
    expect(result.allowed).toBe(false);
    expect(result.redirectUrl).toBe('/unauthorized');
  });

  test('Authenticated Security Guard is forbidden and redirected to /unauthorized', () => {
    const result = evaluateAccess('AUTHENTICATED', 'guard', DEV_DATABASE_ALLOWED_ROLES);
    expect(result.allowed).toBe(false);
    expect(result.redirectUrl).toBe('/unauthorized');
  });

  test('Authenticated Secretary (Society Admin) is forbidden and redirected to /unauthorized', () => {
    const result = evaluateAccess('AUTHENTICATED', 'secretary', DEV_DATABASE_ALLOWED_ROLES);
    expect(result.allowed).toBe(false);
    expect(result.redirectUrl).toBe('/unauthorized');
  });

  test('Authenticated Committee Member is forbidden and redirected to /unauthorized', () => {
    const result = evaluateAccess('AUTHENTICATED', 'committee', DEV_DATABASE_ALLOWED_ROLES);
    expect(result.allowed).toBe(false);
    expect(result.redirectUrl).toBe('/unauthorized');
  });

  test('Authenticated Facility Manager is forbidden and redirected to /unauthorized', () => {
    const result = evaluateAccess('AUTHENTICATED', 'facility_manager', DEV_DATABASE_ALLOWED_ROLES);
    expect(result.allowed).toBe(false);
    expect(result.redirectUrl).toBe('/unauthorized');
  });

  test('Authenticated Vendor is forbidden and redirected to /unauthorized', () => {
    const result = evaluateAccess('AUTHENTICATED', 'vendor', DEV_DATABASE_ALLOWED_ROLES);
    expect(result.allowed).toBe(false);
    expect(result.redirectUrl).toBe('/unauthorized');
  });

  test('Authenticated Admin is allowed to access /dev/database', () => {
    const result = evaluateAccess('AUTHENTICATED', 'admin', DEV_DATABASE_ALLOWED_ROLES);
    expect(result.allowed).toBe(true);
    expect(result.redirectUrl).toBeUndefined();
  });

  test('Case insensitivity: Admin in uppercase/mixed case is properly permitted', () => {
    const resultUpper = evaluateAccess('AUTHENTICATED', 'ADMIN', DEV_DATABASE_ALLOWED_ROLES);
    expect(resultUpper.allowed).toBe(true);

    const resultMixed = evaluateAccess('AUTHENTICATED', 'Admin', DEV_DATABASE_ALLOWED_ROLES);
    expect(resultMixed.allowed).toBe(true);
  });

  test('AST / Static verification: src/routes/index.tsx encloses /dev/database and /dev/db in ProtectedRoute', () => {
    const routesFilePath = path.resolve(__dirname, '../src/routes/index.tsx');
    const content = fs.readFileSync(routesFilePath, 'utf8');

    // Verify /dev/database and /dev/db are protected
    const protectedBlockMatch = content.match(
      /<Route element=\{<ProtectedRoute allowedRoles=\{\['admin'\]\} \/>\}>([\s\S]*?)<\/Route>/
    );

    expect(protectedBlockMatch).not.toBeNull();
    const innerContent = protectedBlockMatch![1];
    expect(innerContent).toContain('path="/dev/database"');
    expect(innerContent).toContain('path="/dev/db"');
    expect(innerContent).toContain('element={<DeveloperDatabaseStudio />}');

    // Verify there are no un-guarded duplicate routes for /dev/database
    const allDatabaseOccurrences = content.match(/path="\/dev\/database"/g);
    expect(allDatabaseOccurrences).toHaveLength(1);

    const allDbOccurrences = content.match(/path="\/dev\/db"/g);
    expect(allDbOccurrences).toHaveLength(1);
  });
});

