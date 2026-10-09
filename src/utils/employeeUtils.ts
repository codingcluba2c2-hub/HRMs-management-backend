import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';

const employeeCache = new Map<string, { data: any; timestamp: number }>();
const EMP_CACHE_TTL_MS = 15000; // 15-second in-memory cache

export const invalidateEmployeeCache = (key?: string) => {
  if (key) {
    employeeCache.delete(key);
  } else {
    employeeCache.clear();
  }
};

/**
 * Ensures an Employee profile exists for a given User ID or user context object.
 * If found, returns the Employee.
 * If not found, attempts matching by email or creates a new Employee profile.
 */
export const getOrCreateEmployeeForUser = async (userIdOrUser: string | any) => {
  if (!userIdOrUser) return null;

  let userId = typeof userIdOrUser === 'string' ? userIdOrUser : userIdOrUser?.id || userIdOrUser?.userId || userIdOrUser?.sub;
  let userEmail = typeof userIdOrUser === 'object' ? userIdOrUser?.email : undefined;

  const cacheKey = userId || userEmail;
  if (cacheKey) {
    const cached = employeeCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < EMP_CACHE_TTL_MS)) {
      return cached.data;
    }
  }

  // 1. Try finding employee by userId
  let employee = userId ? await prisma.employee.findFirst({
    where: { userId, isDeleted: false },
    include: { shift: true, department: true, designation: true }
  }) : null;

  if (!employee && userEmail) {
    employee = await prisma.employee.findFirst({
      where: { email: { equals: userEmail, mode: 'insensitive' as const }, isDeleted: false },
      include: { shift: true, department: true, designation: true }
    });
  }

  if (employee) {
    // If employee exists but userId wasn't linked, link it now
    if (userId && !employee.userId) {
      try {
        employee = await prisma.employee.update({
          where: { id: employee.id },
          data: { userId },
          include: { shift: true, department: true, designation: true }
        });
      } catch (e) {}
    }

    // Check if a published weekly roster entry overrides default shift for today
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const rosterEntry = await prisma.rosterEntry.findFirst({
        where: {
          employeeId: employee.id,
          date: today,
          roster: { status: 'PUBLISHED' }
        },
        include: { shift: true }
      });

      if (rosterEntry && rosterEntry.shift) {
        employee.shift = rosterEntry.shift;
      }
    } catch (e) {}

    if (cacheKey) {
      employeeCache.set(cacheKey, { data: employee, timestamp: Date.now() });
    }
    return employee;
  }

  // 2. Fetch User record with role if not found yet
  const userConditions: Prisma.UserWhereInput[] = [];
  if (userId) userConditions.push({ id: userId });
  if (userEmail) userConditions.push({ email: { equals: userEmail, mode: 'insensitive' as const } });

  if (userConditions.length === 0) return null;

  const user = await prisma.user.findFirst({
    where: { OR: userConditions },
    include: { role: true }
  });
  if (!user) return null;

  // 3. Try finding existing employee by user.email (case-insensitive)
  employee = await prisma.employee.findFirst({
    where: { email: { equals: user.email, mode: 'insensitive' as const }, isDeleted: false },
    include: { shift: true, department: true, designation: true }
  });

  if (employee) {
    employee = await prisma.employee.update({
      where: { id: employee.id },
      data: { userId: user.id },
      include: { shift: true, department: true, designation: true }
    });

    if (cacheKey) {
      employeeCache.set(cacheKey, { data: employee, timestamp: Date.now() });
    }
    return employee;
  }

  // 4. Create new Employee record for this user (e.g. HR Manager / Admin / Employee)
  const activeShift = await prisma.shift.findFirst({
    where: {
      status: true,
      OR: [{ createdById: user.id }, { createdById: null }]
    }
  });

  const activeDept = await prisma.department.findFirst({
    where: {
      status: true,
      OR: [{ createdById: user.id }, { createdById: null }]
    }
  });

  const empIdNum = Math.floor(1000 + Math.random() * 9000);
  const roleObj = (user as any).role;
  const roleName = (roleObj?.name || '').toUpperCase();
  const isHrOrAdmin = roleName.includes('HR') || roleName.includes('ADMIN');
  const employeeIdStr = isHrOrAdmin ? `EMP-HR-${empIdNum}` : `EMP-${empIdNum}`;

  employee = await prisma.employee.create({
    data: {
      userId: user.id,
      createdById: user.id,
      employeeId: employeeIdStr,
      firstName: user.firstName || "HR",
      lastName: user.lastName || "Manager",
      email: user.email,
      phone: user.phone || null,
      photo: user.profilePic || null,
      joiningDate: user.createdAt || new Date(),
      departmentId: activeDept?.id || undefined,
      shiftId: activeShift?.id || undefined,
      status: "ACTIVE"
    },
    include: { shift: true, department: true, designation: true }
  });

  if (cacheKey) {
    employeeCache.set(cacheKey, { data: employee, timestamp: Date.now() });
  }
  return employee;
};
