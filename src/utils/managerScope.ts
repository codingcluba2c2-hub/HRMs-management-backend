import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getOrCreateEmployeeForUser } from './employeeUtils';
import { normalizeRole, CANONICAL_ROLES } from './roleConstants';

export interface ScopeResolution {
  isSuperAdmin: boolean;
  isHrAdmin: boolean;
  isManager: boolean;
  isEmployeeOnly: boolean;
  managerEmployeeId?: string;
  departmentIds: string[];
  designationIds: string[];
  companyId?: string;
}

/**
 * Resolves the organizational scope for a given authenticated user.
 */
export async function resolveUserManagerScope(user?: any): Promise<ScopeResolution> {
  const rawRole = typeof user?.role === 'string' ? user.role : user?.role?.name || '';
  const role = normalizeRole(rawRole);

  if (role === CANONICAL_ROLES.SUPER_ADMIN) {
    return {
      isSuperAdmin: true,
      isHrAdmin: false,
      isManager: false,
      isEmployeeOnly: false,
      departmentIds: [],
      designationIds: []
    };
  }

  if (role === CANONICAL_ROLES.HR_ADMIN) {
    return {
      isSuperAdmin: false,
      isHrAdmin: true,
      isManager: false,
      isEmployeeOnly: false,
      departmentIds: [],
      designationIds: [],
      companyId: user?.companyId
    };
  }

  if (role === CANONICAL_ROLES.MANAGER) {
    const emp = await getOrCreateEmployeeForUser(user);
    if (!emp) {
      return {
        isSuperAdmin: false,
        isHrAdmin: false,
        isManager: true,
        isEmployeeOnly: false,
        departmentIds: [],
        designationIds: [],
        companyId: user?.companyId
      };
    }

    // Fetch ManagerScope entries for this employee
    const scopes = await prisma.managerScope.findMany({
      where: { managerId: emp.id }
    });

    const departmentIds = new Set<string>();
    const designationIds = new Set<string>();

    // Include departments where employee is explicitly set as Department.managerId
    const managedDepts = await prisma.department.findMany({
      where: { managerId: emp.id },
      select: { id: true }
    });
    managedDepts.forEach(d => departmentIds.add(d.id));

    // Include explicit ManagerScope records
    scopes.forEach(s => {
      if (s.departmentId) departmentIds.add(s.departmentId);
      if (s.designationId) designationIds.add(s.designationId);
    });

    return {
      isSuperAdmin: false,
      isHrAdmin: false,
      isManager: true,
      isEmployeeOnly: false,
      managerEmployeeId: emp.id,
      departmentIds: Array.from(departmentIds),
      designationIds: Array.from(designationIds),
      companyId: emp.companyId || user?.companyId
    };
  }

  // Regular Employee
  const emp = await getOrCreateEmployeeForUser(user);
  return {
    isSuperAdmin: false,
    isHrAdmin: false,
    isManager: false,
    isEmployeeOnly: true,
    managerEmployeeId: emp?.id,
    departmentIds: emp?.departmentId ? [emp.departmentId] : [],
    designationIds: emp?.designationId ? [emp.designationId] : [],
    companyId: emp?.companyId || user?.companyId
  };
}

/**
 * Returns Prisma EmployeeWhereInput scoped to the manager's authorized team/subordinates.
 */
export async function getManagerScopedEmployeeFilter(user?: any): Promise<Prisma.EmployeeWhereInput> {
  const scope = await resolveUserManagerScope(user);

  if (scope.isSuperAdmin) {
    return { isDeleted: false };
  }

  if (scope.isHrAdmin) {
    if (scope.companyId) {
      return { isDeleted: false, companyId: scope.companyId };
    }
    return { isDeleted: false };
  }

  if (scope.isManager && scope.managerEmployeeId) {
    const conditions: Prisma.EmployeeWhereInput[] = [
      // Direct reports
      { managerId: scope.managerEmployeeId }
    ];

    // Department-scoped employees
    if (scope.departmentIds.length > 0) {
      conditions.push({ departmentId: { in: scope.departmentIds } });
    }

    // Designation-scoped employees
    if (scope.designationIds.length > 0) {
      conditions.push({ designationId: { in: scope.designationIds } });
    }

    return {
      isDeleted: false,
      ...(scope.companyId ? { companyId: scope.companyId } : {}),
      OR: conditions,
      // Exclude Super Admin records from team views
      NOT: [
        { email: { equals: 'superadmin@hrmspro.com', mode: 'insensitive' } },
        { user: { role: { name: 'SUPER_ADMIN' } } }
      ]
    };
  }

  // Employee only: return own profile
  if (scope.managerEmployeeId) {
    return { id: scope.managerEmployeeId, isDeleted: false };
  }

  return { id: 'NO_MATCH', isDeleted: false };
}
