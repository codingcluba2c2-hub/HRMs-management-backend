import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getOrCreateEmployeeForUser } from './employeeUtils';

export const getTenantEmployeeFilter = (user?: { id?: string; userId?: string; role?: string; email?: string; companyName?: string }): Prisma.EmployeeWhereInput => {
  const rawRole = typeof user?.role === 'string' ? user.role : (user?.role as any)?.name || '';
  const normalizedRole = rawRole.toUpperCase().trim().replace(/[\s\_]+/g, '_');

  if (normalizedRole === 'SUPER_ADMIN' || normalizedRole === 'SUPER_ADMINISTRATOR') {
    return { isDeleted: false };
  }

  const userId = user?.id || (user as any)?.userId || (user as any)?.sub || 'NO_USER';
  const email = user?.email;
  const companyName = user?.companyName;

  const matchConditions: Prisma.EmployeeWhereInput[] = [
    { createdById: userId },
    { userId: userId }
  ];

  if (email) {
    matchConditions.push({ email: { equals: email, mode: 'insensitive' as const } });
  }

  // Regular employees only see their own profile
  if (normalizedRole === 'EMPLOYEE' || normalizedRole === 'USER') {
    return {
      isDeleted: false,
      OR: matchConditions,
      NOT: [
        { email: { equals: 'akhlaquerahman18@gmail.com', mode: 'insensitive' as const } },
        { user: { role: { name: { in: ['SUPER_ADMIN', 'SUPER_ADMINISTRATOR', 'Super Admin'] } } } },
        { employeeId: { in: ['EMP-SUPER-001', 'SUPER-ADMIN'] } }
      ]
    };
  }

  // HR Managers, Admins, Managers see employees belonging to their Company / Tenant
  if (companyName && companyName.trim()) {
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
      { email: { equals: 'akhlaquerahman18@gmail.com', mode: 'insensitive' as const } },
      { user: { role: { name: { in: ['SUPER_ADMIN', 'SUPER_ADMINISTRATOR', 'Super Admin'] } } } },
      { employeeId: { in: ['EMP-SUPER-001', 'SUPER-ADMIN'] } }
    ]
  };
};

export const getTenantCreatorId = async (user?: any): Promise<string> => {
  if (!user) return 'NO_USER';
  const userId = typeof user === 'string' ? user : user?.id || user?.userId || user?.sub || 'NO_USER';
  const rawRole = typeof user === 'string' ? '' : typeof user?.role === 'string' ? user.role : (user?.role as any)?.name || '';
  const normalizedRole = rawRole.toUpperCase().trim().replace(/[\s\_]+/g, '_');

  if (normalizedRole === 'SUPER_ADMIN' || normalizedRole === 'SUPER_ADMINISTRATOR') {
    return userId;
  }

  let creatorId = userId;
  try {
    const emp = await getOrCreateEmployeeForUser(user);
    if (emp && emp.createdById) {
      if (emp.createdById === userId && (normalizedRole === 'EMPLOYEE' || normalizedRole === 'USER')) {
        const companyName = user?.companyName;
        if (companyName) {
          const hrUser = await prisma.user.findFirst({
            where: {
              companyName: { equals: companyName, mode: 'insensitive' },
              role: { name: { in: ['HR_MANAGER', 'HR_ADMIN', 'ADMIN', 'MANAGER'] } }
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

export const getTenantDepartmentFilter = async (user?: { id?: string; role?: string; email?: string }): Promise<Prisma.DepartmentWhereInput> => {
  const rawRole = typeof user?.role === 'string' ? user.role : (user?.role as any)?.name || '';
  const normalizedRole = rawRole.toUpperCase().trim().replace(/[\s\_]+/g, '_');

  if (normalizedRole === 'SUPER_ADMIN' || normalizedRole === 'SUPER_ADMINISTRATOR') {
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

export const getTenantDesignationFilter = async (user?: { id?: string; role?: string; email?: string }): Promise<Prisma.DesignationWhereInput> => {
  const rawRole = typeof user?.role === 'string' ? user.role : (user?.role as any)?.name || '';
  const normalizedRole = rawRole.toUpperCase().trim().replace(/[\s\_]+/g, '_');

  if (normalizedRole === 'SUPER_ADMIN' || normalizedRole === 'SUPER_ADMINISTRATOR') {
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

export const getTenantDocumentTypeFilter = async (user?: { id?: string; role?: string; email?: string }): Promise<Prisma.DocumentTypeWhereInput> => {
  const rawRole = typeof user?.role === 'string' ? user.role : (user?.role as any)?.name || '';
  const normalizedRole = rawRole.toUpperCase().trim().replace(/[\s\_]+/g, '_');

  if (normalizedRole === 'SUPER_ADMIN' || normalizedRole === 'SUPER_ADMINISTRATOR') {
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
  const normalizedRole = rawRole.toUpperCase().trim().replace(/[\s\_]+/g, '_');

  if (normalizedRole === 'SUPER_ADMIN' || normalizedRole === 'SUPER_ADMINISTRATOR') {
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

export const getTenantHolidayFilter = async (user?: { id?: string; role?: string; email?: string }): Promise<Prisma.HolidayWhereInput> => {
  const rawRole = typeof user?.role === 'string' ? user.role : (user?.role as any)?.name || '';
  const normalizedRole = rawRole.toUpperCase().trim().replace(/[\s\_]+/g, '_');

  if (normalizedRole === 'SUPER_ADMIN' || normalizedRole === 'SUPER_ADMINISTRATOR') {
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
  const normalizedRole = rawRole.toUpperCase().trim().replace(/[\s\_]+/g, '_');

  if (normalizedRole === 'SUPER_ADMIN' || normalizedRole === 'SUPER_ADMINISTRATOR') {
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
  const normalizedRole = rawRole.toUpperCase().trim().replace(/[\s\_]+/g, '_');

  if (normalizedRole === 'SUPER_ADMIN' || normalizedRole === 'SUPER_ADMINISTRATOR') {
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
