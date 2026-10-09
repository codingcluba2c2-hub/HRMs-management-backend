export const CANONICAL_ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  HR_ADMIN: 'HR_ADMIN',
  MANAGER: 'MANAGER',
  EMPLOYEES: 'EMPLOYEES'
} as const;

export type CanonicalRole = typeof CANONICAL_ROLES[keyof typeof CANONICAL_ROLES];

/**
 * Maps raw role strings (including legacy terms like EMPLOYEE or HR_MANAGER)
 * to the exact canonical 4 roles.
 */
export function normalizeRole(rawRole?: string | null): CanonicalRole {
  if (!rawRole) return CANONICAL_ROLES.EMPLOYEES;
  const clean = rawRole.toUpperCase().trim().replace(/[\s\_]+/g, '_');
  
  if (clean === 'SUPER_ADMIN' || clean === 'SUPER_ADMINISTRATOR' || clean === 'SUPERADMIN') {
    return CANONICAL_ROLES.SUPER_ADMIN;
  }
  if (clean === 'HR_ADMIN' || clean === 'HR_MANAGER' || clean === 'TENANT_ADMIN' || clean === 'HR') {
    return CANONICAL_ROLES.HR_ADMIN;
  }
  if (clean === 'MANAGER' || clean === 'DEPT_MANAGER' || clean === 'TEAM_LEAD') {
    return CANONICAL_ROLES.MANAGER;
  }
  return CANONICAL_ROLES.EMPLOYEES;
}
