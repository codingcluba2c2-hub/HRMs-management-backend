import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

export const getTenantEmployeeFilter = (user?: { id?: string; role?: string; email?: string }): Prisma.EmployeeWhereInput => {
  const rawRole = typeof user?.role === 'string' ? user.role : (user?.role as any)?.name || '';
  const normalizedRole = rawRole.toUpperCase().trim().replace(/[\s\_]+/g, '_');

  if (normalizedRole === 'SUPER_ADMIN' || normalizedRole === 'SUPER_ADMINISTRATOR') {
    return { isDeleted: false };
  }

  const userId = user?.id || 'NO_USER';
  return {
    isDeleted: false,
    OR: [
      { createdById: userId },
      { userId: userId }
    ],
    NOT: [
      { email: { equals: 'akhlaquerahman18@gmail.com', mode: 'insensitive' as const } },
      { user: { role: { name: { in: ['SUPER_ADMIN', 'SUPER_ADMINISTRATOR', 'Super Admin'] } } } },
      { employeeId: { in: ['EMP-SUPER-001', 'SUPER-ADMIN'] } }
    ]
  };
};

export const getTenantDepartmentFilter = async (user?: { id?: string; role?: string; email?: string }): Promise<Prisma.DepartmentWhereInput> => {
  const rawRole = typeof user?.role === 'string' ? user.role : (user?.role as any)?.name || '';
  const normalizedRole = rawRole.toUpperCase().trim().replace(/[\s\_]+/g, '_');

  if (normalizedRole === 'SUPER_ADMIN' || normalizedRole === 'SUPER_ADMINISTRATOR') {
    return {};
  }

  const userId = user?.id || 'NO_USER';

  // If user is an employee, find their creator HR Manager's ID
  let creatorId = userId;
  try {
    const emp = await prisma.employee.findUnique({ where: { userId } });
    if (emp && emp.createdById) {
      creatorId = emp.createdById;
    }
  } catch (e) {}

  return {
    createdById: creatorId
  };
};

export const getTenantDesignationFilter = async (user?: { id?: string; role?: string; email?: string }): Promise<Prisma.DesignationWhereInput> => {
  const rawRole = typeof user?.role === 'string' ? user.role : (user?.role as any)?.name || '';
  const normalizedRole = rawRole.toUpperCase().trim().replace(/[\s\_]+/g, '_');

  if (normalizedRole === 'SUPER_ADMIN' || normalizedRole === 'SUPER_ADMINISTRATOR') {
    return {};
  }

  const userId = user?.id || 'NO_USER';

  // If user is an employee, find their creator HR Manager's ID
  let creatorId = userId;
  try {
    const emp = await prisma.employee.findUnique({ where: { userId } });
    if (emp && emp.createdById) {
      creatorId = emp.createdById;
    }
  } catch (e) {}

  return {
    createdById: creatorId
  };
};

export const getTenantDocumentTypeFilter = async (user?: { id?: string; role?: string; email?: string }): Promise<Prisma.DocumentTypeWhereInput> => {
  const rawRole = typeof user?.role === 'string' ? user.role : (user?.role as any)?.name || '';
  const normalizedRole = rawRole.toUpperCase().trim().replace(/[\s\_]+/g, '_');

  if (normalizedRole === 'SUPER_ADMIN' || normalizedRole === 'SUPER_ADMINISTRATOR') {
    return {};
  }

  const userId = user?.id || 'NO_USER';

  // If user is an employee, find their creator HR Manager's ID
  let creatorId = userId;
  try {
    const emp = await prisma.employee.findUnique({ where: { userId } });
    if (emp && emp.createdById) {
      creatorId = emp.createdById;
    }
  } catch (e) {}

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

  const userId = user?.id || 'NO_USER';
  let creatorId = userId;
  try {
    const emp = await prisma.employee.findUnique({ where: { userId } });
    if (emp && emp.createdById) {
      creatorId = emp.createdById;
    }
  } catch (e) {}

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

  const userId = user?.id || 'NO_USER';
  let creatorId = userId;
  try {
    const emp = await prisma.employee.findUnique({ where: { userId } });
    if (emp && emp.createdById) {
      creatorId = emp.createdById;
    }
  } catch (e) {}

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

  const userId = user?.id || 'NO_USER';
  let creatorId = userId;
  try {
    const emp = await prisma.employee.findUnique({ where: { userId } });
    if (emp && emp.createdById) {
      creatorId = emp.createdById;
    }
  } catch (e) {}

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

  const userId = user?.id || 'NO_USER';
  let creatorId = userId;
  try {
    const emp = await prisma.employee.findUnique({ where: { userId } });
    if (emp && emp.createdById) {
      creatorId = emp.createdById;
    }
  } catch (e) {}

  return {
    OR: [
      { createdById: null },
      { createdById: creatorId }
    ]
  };
};

