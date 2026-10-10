import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getOrCreateEmployeeForUser } from './employeeUtils';
import { normalizeRole, CANONICAL_ROLES } from './roleConstants';
import { getManagerScopedEmployeeFilter, resolveUserManagerScope } from './managerScope';

export const getTenantEmployeeFilterAsync = async (user?: any): Promise<Prisma.EmployeeWhereInput> => {
  return await getManagerScopedEmployeeFilter(user);
};

export const getTenantEmployeeFilter = (user?: { id?: string; userId?: string; role?: string; email?: string; companyName?: string; companyId?: string }): Prisma.EmployeeWhereInput => {
  const rawRole = typeof user?.role === 'string' ? user.role : (user?.role as any)?.name || '';
  const role = normalizeRole(rawRole);

  if (role === CANONICAL_ROLES.SUPER_ADMIN) {
    return { isDeleted: false };
  }

  const userId = user?.id || (user as any)?.userId || (user as any)?.sub || 'NO_USER';
  const email = user?.email;
  const companyName = user?.companyName;
  const companyId = user?.companyId;

  const matchConditions: Prisma.EmployeeWhereInput[] = [
    { createdById: userId },
    { userId: userId }
  ];

  if (email) {
    matchConditions.push({ email: { equals: email, mode: 'insensitive' as const } });
  }

  // Regular employees only see their own profile
  if (role === CANONICAL_ROLES.EMPLOYEES) {
    return {
      isDeleted: false,
      OR: matchConditions,
      NOT: [
        { email: { equals: 'superadmin@hrmspro.com', mode: 'insensitive' as const } },
        { email: { equals: 'akhlaquerahman18@gmail.com', mode: 'insensitive' as const } },
        { user: { role: { name: 'SUPER_ADMIN' } } },
        { AND: [{ firstName: { equals: 'Super', mode: 'insensitive' as const } }, { lastName: { equals: 'Admin', mode: 'insensitive' as const } }] },
        { employeeId: { in: ['EMP-SUPER-001', 'SUPER-ADMIN'] } }
      ]
    };
  }

  // HR Admin sees employees belonging to their Company / Tenant
  if (companyId) {
    matchConditions.push({ companyId });
  } else if (companyName && companyName.trim()) {
    matchConditions.push({
      user: {
        companyName: { equals: companyName.trim(), mode: 'insensitive' as const }
      }
    });
  }

  return {
    isDeleted: false,
    OR: matchConditions,
    NOT: [
      { email: { equals: 'superadmin@hrmspro.com', mode: 'insensitive' as const } },
      { email: { equals: 'akhlaquerahman18@gmail.com', mode: 'insensitive' as const } },
      { user: { role: { name: 'SUPER_ADMIN' } } },
      { AND: [{ firstName: { equals: 'Super', mode: 'insensitive' as const } }, { lastName: { equals: 'Admin', mode: 'insensitive' as const } }] },
      { employeeId: { in: ['EMP-SUPER-001', 'SUPER-ADMIN'] } }
    ]
  };
};

export const getTenantCreatorId = async (user?: any): Promise<string> => {
  if (!user) return 'NO_USER';
  const userId = typeof user === 'string' ? user : user?.id || user?.userId || user?.sub || 'NO_USER';
  const rawRole = typeof user === 'string' ? '' : typeof user?.role === 'string' ? user.role : (user?.role as any)?.name || '';
  const role = normalizeRole(rawRole);

  if (role === CANONICAL_ROLES.SUPER_ADMIN) {
    return userId;
  }

  let creatorId = userId;
  try {
    const emp = await getOrCreateEmployeeForUser(user);
    if (emp && emp.createdById) {
      if (emp.createdById === userId && role === CANONICAL_ROLES.EMPLOYEES) {
        const companyName = user?.companyName;
        if (companyName) {
          const hrUser = await prisma.user.findFirst({
            where: {
              companyName: { equals: companyName, mode: 'insensitive' },
              role: { name: { in: ['HR_ADMIN', 'MANAGER'] } }
            }
          });
          if (hrUser) return hrUser.id;
        }
      }
      creatorId = emp.createdById;
    }
  } catch (e) {}

  return creatorId;
};

export const getTenantDepartmentFilter = async (user?: { id?: string; role?: string; email?: string; companyId?: string }): Promise<Prisma.DepartmentWhereInput> => {
  const rawRole = typeof user?.role === 'string' ? user.role : (user?.role as any)?.name || '';
  const role = normalizeRole(rawRole);

  if (role === CANONICAL_ROLES.SUPER_ADMIN) {
    return {};
  }

  if (role === CANONICAL_ROLES.MANAGER) {
    const scope = await resolveUserManagerScope(user);
    if (scope.departmentIds.length > 0) {
      return {
        id: { in: scope.departmentIds },
        ...(user?.companyId ? { companyId: user.companyId } : {})
      };
    }
    return { id: 'NO_MATCH' };
  }

  if (user?.companyId) {
    return {
      OR: [
        { companyId: user.companyId },
        { createdById: null }
      ]
    };
  }

  const creatorId = await getTenantCreatorId(user);
  return {
    OR: [
      { createdById: null },
      { createdById: creatorId }
    ]
  };
};

export const getTenantDesignationFilter = async (user?: { id?: string; role?: string; email?: string; companyId?: string }): Promise<Prisma.DesignationWhereInput> => {
  const rawRole = typeof user?.role === 'string' ? user.role : (user?.role as any)?.name || '';
  const role = normalizeRole(rawRole);

  if (role === CANONICAL_ROLES.SUPER_ADMIN) {
    return {};
  }

  if (role === CANONICAL_ROLES.MANAGER) {
    const scope = await resolveUserManagerScope(user);
    if (scope.departmentIds.length > 0) {
      return {
        departmentId: { in: scope.departmentIds }
      };
    }
    return { id: 'NO_MATCH' };
  }

  const creatorId = await getTenantCreatorId(user);
  return {
    OR: [
      { createdById: null },
      { createdById: creatorId }
    ]
  };
};

export const getTenantDocumentTypeFilter = async (user?: { id?: string; role?: string; email?: string }): Promise<Prisma.DocumentTypeWhereInput> => {
  const rawRole = typeof user?.role === 'string' ? user.role : (user?.role as any)?.name || '';
  const role = normalizeRole(rawRole);

  if (role === CANONICAL_ROLES.SUPER_ADMIN) {
    return {};
  }

  const creatorId = await getTenantCreatorId(user);
  return {
    OR: [
      { createdById: null },
      { createdById: creatorId }
    ]
  };
};

export const getTenantShiftFilter = async (user?: { id?: string; role?: string; email?: string }): Promise<Prisma.ShiftWhereInput> => {
  const rawRole = typeof user?.role === 'string' ? user.role : (user?.role as any)?.name || '';
  const role = normalizeRole(rawRole);

  if (role === CANONICAL_ROLES.SUPER_ADMIN) {
    return {};
  }

  if (role === CANONICAL_ROLES.MANAGER) {
    const scope = await resolveUserManagerScope(user);
    const creatorId = await getTenantCreatorId(user);
    if (scope.departmentIds.length > 0) {
      return {
        OR: [
          { createdById: creatorId },
          { employees: { some: { departmentId: { in: scope.departmentIds } } } }
        ]
      };
    }
  }

  const creatorId = await getTenantCreatorId(user);
  return {
    OR: [
      { createdById: null },
      { createdById: creatorId }
    ]
  };
};

export const getTenantHolidayFilter = async (user?: { id?: string; role?: string; email?: string }): Promise<Prisma.HolidayWhereInput> => {
  const rawRole = typeof user?.role === 'string' ? user.role : (user?.role as any)?.name || '';
  const role = normalizeRole(rawRole);

  if (role === CANONICAL_ROLES.SUPER_ADMIN) {
    return {};
  }

  const creatorId = await getTenantCreatorId(user);
  return {
    OR: [
      { createdById: null },
      { createdById: creatorId }
    ]
  };
};

export const getTenantLeaveTypeFilter = async (user?: { id?: string; role?: string; email?: string }): Promise<Prisma.LeaveTypeWhereInput> => {
  const rawRole = typeof user?.role === 'string' ? user.role : (user?.role as any)?.name || '';
  const role = normalizeRole(rawRole);

  if (role === CANONICAL_ROLES.SUPER_ADMIN) {
    return {};
  }

  const creatorId = await getTenantCreatorId(user);
  return {
    OR: [
      { createdById: null },
      { createdById: creatorId }
    ]
  };
};

export const getTenantJobRoleFilter = async (user?: { id?: string; role?: string; email?: string }): Promise<Prisma.JobRoleWhereInput> => {
  const rawRole = typeof user?.role === 'string' ? user.role : (user?.role as any)?.name || '';
  const role = normalizeRole(rawRole);

  if (role === CANONICAL_ROLES.SUPER_ADMIN) {
    return {};
  }

  const creatorId = await getTenantCreatorId(user);
  return {
    OR: [
      { createdById: null },
      { createdById: creatorId }
    ]
  };
};
