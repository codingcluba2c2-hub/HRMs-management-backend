import { prisma } from '../lib/prisma';
import { CANONICAL_ROLES } from '../utils/roleConstants';
import redis from '../lib/redis';

/**
 * Reconciles the system User role for a given Employee.
 * If the employee manages at least 1 active department, their User role is set to MANAGER.
 * If they manage 0 departments, their User role is set to EMPLOYEES (unless they are HR_ADMIN or SUPER_ADMIN).
 */
export async function reconcileUserRoleForManagement(employeeId: string): Promise<void> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: {
      user: {
        include: { role: true }
      }
    }
  });

  if (!employee || !employee.userId || !employee.user) return;

  const currentRoleName = employee.user.role?.name?.toUpperCase() || 'EMPLOYEES';
  
  // Never change roles for SUPER_ADMIN or HR_ADMIN accounts
  if (currentRoleName.includes('SUPER_ADMIN') || currentRoleName.includes('HR_ADMIN')) {
    return;
  }

  // Count active departments managed by this employee
  const managedCount = await prisma.department.count({
    where: { managerId: employeeId }
  });

  let targetRoleName = managedCount > 0 ? CANONICAL_ROLES.MANAGER : CANONICAL_ROLES.EMPLOYEES;

  let targetRole = await prisma.role.findUnique({ where: { name: targetRoleName } });
  if (!targetRole) {
    targetRole = await prisma.role.create({
      data: {
        name: targetRoleName,
        description: targetRoleName === CANONICAL_ROLES.MANAGER ? 'Department Manager Role' : 'Regular Employee Role'
      }
    });
  }

  if (employee.user.roleId !== targetRole.id) {
    await prisma.user.update({
      where: { id: employee.userId },
      data: { roleId: targetRole.id }
    });

    // Audit Role Change
    await prisma.auditLog.create({
      data: {
        userId: employee.userId,
        action: managedCount > 0 ? 'ROLE_PROMOTED_TO_MANAGER' : 'ROLE_RECONCILED_TO_EMPLOYEE',
        entity: 'User',
        entityId: employee.userId
      }
    }).catch(() => {});
  }

  // Synchronize ManagerScope records
  if (managedCount > 0) {
    const managedDepts = await prisma.department.findMany({
      where: { managerId: employeeId },
      select: { id: true }
    });

    for (const d of managedDepts) {
      const existingScope = await prisma.managerScope.findFirst({
        where: {
          managerId: employeeId,
          departmentId: d.id
        }
      });

      if (!existingScope) {
        await prisma.managerScope.create({
          data: {
            managerId: employeeId,
            departmentId: d.id
          }
        });
      }
    }
  } else {
    // Clean up stale manager scope entries if no departments are managed
    await prisma.managerScope.deleteMany({
      where: { managerId: employeeId }
    }).catch(() => {});
  }
}

/**
 * Synchronizes department manager assignment for a given department.
 * - Updates Department.managerId
 * - Auto-sets reporting manager (Employee.managerId) for all department staff
 * - Reassigns pending leave & correction approvals from old manager to new manager
 * - Reconciles roles for both old and new managers
 */
export async function syncDepartmentManagerAssignments(
  departmentId: string,
  newManagerId: string | null | undefined,
  actorUserId?: string
): Promise<any> {
  const currentDept = await prisma.department.findUnique({
    where: { id: departmentId },
    include: { manager: true }
  });

  if (!currentDept) {
    throw new Error('Department not found');
  }

  const oldManagerId = currentDept.managerId;
  const targetManagerId = newManagerId || null;

  // Validate new manager if provided
  if (targetManagerId) {
    const managerEmp = await prisma.employee.findUnique({
      where: { id: targetManagerId },
      include: { user: true }
    });

    if (!managerEmp) {
      throw new Error('Selected department manager employee not found');
    }

    // Tenant isolation check
    if (currentDept.companyId && managerEmp.companyId && currentDept.companyId !== managerEmp.companyId) {
      throw new Error('Department manager must belong to the same tenant company');
    }

    // If manager belongs to another department or is unassigned, move them to this department
    if (managerEmp.departmentId !== departmentId) {
      await prisma.employee.update({
        where: { id: targetManagerId },
        data: { departmentId }
      });
    }
  }

  // Update Department Record
  const updatedDept = await prisma.department.update({
    where: { id: departmentId },
    data: { managerId: targetManagerId },
    include: {
      manager: {
        select: { id: true, firstName: true, lastName: true, employeeId: true, email: true }
      }
    }
  });

  if (targetManagerId) {
    // 1. Department Head's managerId is set to null (reports to executive level)
    await prisma.employee.update({
      where: { id: targetManagerId },
      data: { managerId: null }
    });

    // 2. All other employees in this department automatically inherit targetManagerId
    await prisma.employee.updateMany({
      where: {
        departmentId,
        id: { not: targetManagerId }
      },
      data: { managerId: targetManagerId }
    });

    // 3. Safe Pending Approvals Reassignment from oldManagerId to targetManagerId
    if (oldManagerId && oldManagerId !== targetManagerId) {
      const deptEmpIds = (await prisma.employee.findMany({
        where: { departmentId },
        select: { id: true }
      })).map(e => e.id);

      if (deptEmpIds.length > 0) {
        // Reassign pending attendance corrections
        await prisma.attendanceCorrection.updateMany({
          where: {
            employeeId: { in: deptEmpIds },
            status: 'PENDING',
            managerId: oldManagerId
          },
          data: { managerId: targetManagerId }
        }).catch(() => {});
      }
    }
  } else {
    // No manager assigned to department -> set managerId to null for all department staff
    await prisma.employee.updateMany({
      where: { departmentId },
      data: { managerId: null }
    });
  }

  // Reconcile role for new manager
  if (targetManagerId) {
    await reconcileUserRoleForManagement(targetManagerId);
  }

  // Reconcile role for old manager (if replaced or removed)
  if (oldManagerId && oldManagerId !== targetManagerId) {
    await reconcileUserRoleForManagement(oldManagerId);
  }

  // Audit Logging
  await prisma.auditLog.create({
    data: {
      userId: actorUserId || null,
      action: targetManagerId ? 'DEPARTMENT_MANAGER_ASSIGNED' : 'DEPARTMENT_MANAGER_REMOVED',
      entity: 'Department',
      entityId: departmentId
    }
  }).catch(() => {});

  // Cache Invalidation
  if (redis.status === 'ready') {
    const keys = await redis.keys('employees:*');
    const dashKeys = await redis.keys('dashboard:*');
    const allKeys = [...keys, ...dashKeys];
    if (allKeys.length > 0) await redis.del(allKeys);
  }

  return updatedDept;
}

/**
 * Handles automatic reporting manager resolution when an employee changes department.
 */
export async function handleEmployeeDepartmentTransfer(
  employeeId: string,
  targetDepartmentId: string | null | undefined,
  targetDesignationId: string | null | undefined,
  actorUserId?: string
): Promise<any> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId }
  });

  if (!employee) {
    throw new Error('Employee not found');
  }

  const oldDeptId = employee.departmentId;
  const newDeptId = targetDepartmentId !== undefined ? targetDepartmentId : oldDeptId;

  let resolvedManagerId: string | null = null;
  let resolvedDesignationId = targetDesignationId !== undefined ? targetDesignationId : employee.designationId;

  if (newDeptId) {
    const targetDept = await prisma.department.findUnique({
      where: { id: newDeptId }
    });

    if (!targetDept) {
      throw new Error('Target department not found');
    }

    // Tenant boundary check
    if (employee.companyId && targetDept.companyId && employee.companyId !== targetDept.companyId) {
      throw new Error('Cannot transfer employee across different company tenants');
    }

    // Designation validation: verify targetDesignationId belongs to newDeptId
    if (resolvedDesignationId) {
      const desig = await prisma.designation.findUnique({
        where: { id: resolvedDesignationId }
      });
      if (desig && desig.departmentId !== newDeptId) {
        throw new Error('Selected designation does not belong to the destination department');
      }
    }

    // Resolve Manager: if employee IS the department manager, their reporting manager is null.
    // Otherwise, inherit targetDept.managerId.
    if (targetDept.managerId === employeeId) {
      resolvedManagerId = null;
    } else {
      resolvedManagerId = targetDept.managerId || null;
    }
  } else {
    resolvedDesignationId = null;
    resolvedManagerId = null;
  }

  const updatedEmployee = await prisma.employee.update({
    where: { id: employeeId },
    data: {
      departmentId: newDeptId || null,
      designationId: resolvedDesignationId || null,
      managerId: resolvedManagerId
    },
    include: {
      department: { select: { id: true, name: true, code: true, managerId: true } },
      designation: { select: { id: true, name: true, code: true } },
      manager: { select: { id: true, firstName: true, lastName: true, employeeId: true } }
    }
  });

  // Reconcile role for transferred employee (in case they managed old department)
  await reconcileUserRoleForManagement(employeeId);

  // If old department lost its manager (because this employee moved), sync old department
  if (oldDeptId && oldDeptId !== newDeptId) {
    const oldDept = await prisma.department.findUnique({ where: { id: oldDeptId } });
    if (oldDept && oldDept.managerId === employeeId) {
      await prisma.department.update({
        where: { id: oldDeptId },
        data: { managerId: null }
      });
      await syncDepartmentManagerAssignments(oldDeptId, null, actorUserId);
    }
  }

  // Audit Log
  await prisma.auditLog.create({
    data: {
      userId: actorUserId || null,
      action: 'EMPLOYEE_DEPARTMENT_TRANSFERRED',
      entity: 'Employee',
      entityId: employeeId
    }
  }).catch(() => {});

  // Cache Invalidation
  if (redis.status === 'ready') {
    const keys = await redis.keys('employees:*');
    const dashKeys = await redis.keys('dashboard:*');
    const allKeys = [...keys, ...dashKeys];
    if (allKeys.length > 0) await redis.del(allKeys);
  }

  return updatedEmployee;
}

/**
 * Backfills / reconciles all department employees in the system so that every employee's
 * managerId strictly matches their assigned department's managerId.
 */
export async function backfillAllDepartmentManagers(): Promise<void> {
  const departments = await prisma.department.findMany({
    select: { id: true, managerId: true }
  });

  for (const dept of departments) {
    if (dept.managerId) {
      // 1. Department Head reports to executive (null)
      await prisma.employee.update({
        where: { id: dept.managerId },
        data: { managerId: null }
      }).catch(() => {});

      // 2. All other employees report to department manager
      await prisma.employee.updateMany({
        where: {
          departmentId: dept.id,
          id: { not: dept.managerId }
        },
        data: { managerId: dept.managerId }
      }).catch(() => {});

      // Reconcile manager user role
      await reconcileUserRoleForManagement(dept.managerId).catch(() => {});
    } else {
      // Department has no manager -> set employees' managerId to null
      await prisma.employee.updateMany({
        where: { departmentId: dept.id },
        data: { managerId: null }
      }).catch(() => {});
    }
  }
}
