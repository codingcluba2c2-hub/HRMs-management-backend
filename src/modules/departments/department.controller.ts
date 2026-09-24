import { prisma } from '../../lib/prisma';
import { Request, Response } from 'express';
import { ApiResponse } from '../../utils/ApiResponse';

// Summary KPI metrics for Organization Management page
export const getDepartmentSummary = async (req: Request, res: Response) => {
  try {
    const totalDepartments = await prisma.department.count();
    const totalDesignations = await prisma.designation.count();
    const assignedEmployees = await prisma.employee.count({
      where: { departmentId: { not: null } }
    });
    const departmentManagers = await prisma.department.count({
      where: { managerId: { not: null } }
    });

    return res.status(200).json(new ApiResponse(true, 'Organization summary fetched successfully', {
      totalDepartments,
      totalDesignations,
      assignedEmployees,
      departmentManagers
    }));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const getDepartments = async (req: Request, res: Response) => {
  try {
    const departments = await prisma.department.findMany({
      include: {
        manager: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeId: true,
            email: true,
            photo: true,
            designation: { select: { name: true } }
          }
        },
        designations: {
          include: {
            _count: { select: { employees: true } }
          },
          orderBy: { name: 'asc' }
        },
        _count: {
          select: { employees: true, designations: true }
        }
      },
      orderBy: { name: 'asc' }
    });

    const formattedDepartments = departments.map((d) => ({
      ...d,
      manager: d.manager
    }));

    return res.status(200).json(new ApiResponse(true, 'Departments fetched successfully', formattedDepartments));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const createDepartment = async (req: Request, res: Response) => {
  try {
    const { name, code, description, status = true, managerId } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json(new ApiResponse(false, 'Department name is required'));
    }
    if (!code || !code.trim()) {
      return res.status(400).json(new ApiResponse(false, 'Department code is required'));
    }

    const formattedName = name.trim();
    const formattedCode = code.trim().toUpperCase();

    const existing = await prisma.department.findFirst({
      where: { OR: [{ name: { equals: formattedName, mode: 'insensitive' } }, { code: formattedCode }] }
    });

    if (existing) {
      return res.status(400).json(new ApiResponse(false, 'Department with this name or code already exists'));
    }

    if (managerId) {
      const emp = await prisma.employee.findUnique({ where: { id: managerId } });
      if (!emp) return res.status(404).json(new ApiResponse(false, 'Department manager employee profile not found'));
    }

    const department = await prisma.department.create({
      data: {
        name: formattedName,
        code: formattedCode,
        description: description?.trim() || null,
        status: status ?? true,
        managerId: managerId || null
      },
      include: {
        manager: {
          select: { id: true, firstName: true, lastName: true, employeeId: true, email: true }
        }
      }
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: (req as any).user?.id || null,
        action: 'DEPARTMENT_CREATED',
        entity: 'Department',
        entityId: department.id
      }
    }).catch(() => {});

    return res.status(201).json(new ApiResponse(true, 'Department created successfully', department));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const updateDepartment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, code, description, status, managerId } = req.body;

    const existingDept = await prisma.department.findUnique({ where: { id } });
    if (!existingDept) return res.status(404).json(new ApiResponse(false, 'Department not found'));

    const formattedCode = code ? code.trim().toUpperCase() : existingDept.code;
    const formattedName = name ? name.trim() : existingDept.name;

    if (code || name) {
      const conflict = await prisma.department.findFirst({
        where: {
          id: { not: id },
          OR: [
            { name: { equals: formattedName, mode: 'insensitive' } },
            { code: formattedCode }
          ]
        }
      });
      if (conflict) {
        return res.status(400).json(new ApiResponse(false, 'Another department with this name or code already exists'));
      }
    }

    if (managerId) {
      const emp = await prisma.employee.findUnique({ where: { id: managerId } });
      if (!emp) return res.status(404).json(new ApiResponse(false, 'Department manager employee profile not found'));
      
      // Auto-sync employee's department to this department if not already set
      if (emp.departmentId !== id) {
        await prisma.employee.update({
          where: { id: managerId },
          data: { departmentId: id }
        });
      }
    }

    const updatedDepartment = await prisma.department.update({
      where: { id },
      data: {
        name: formattedName,
        code: formattedCode,
        description: description !== undefined ? (description?.trim() || null) : existingDept.description,
        status: status !== undefined ? status : existingDept.status,
        managerId: managerId !== undefined ? (managerId || null) : existingDept.managerId
      },
      include: {
        manager: {
          select: { id: true, firstName: true, lastName: true, employeeId: true, email: true }
        }
      }
    });

    if (managerId) {
      // 1. Department Head reports to top management (null managerId)
      await prisma.employee.update({
        where: { id: managerId },
        data: { managerId: null }
      }).catch(() => {});

      // 2. All other employees in this department report to Department Head
      await prisma.employee.updateMany({
        where: { departmentId: id, id: { not: managerId } },
        data: { managerId }
      }).catch(() => {});
    }

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: (req as any).user?.id || null,
        action: 'DEPARTMENT_UPDATED',
        entity: 'Department',
        entityId: id
      }
    }).catch(() => {});

    return res.status(200).json(new ApiResponse(true, 'Department updated successfully', updatedDepartment));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const deleteDepartment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const force = req.query.force === 'true';
    const action = req.query.action as string;

    const dept = await prisma.department.findUnique({ where: { id } });
    if (!dept) return res.status(404).json(new ApiResponse(false, 'Department not found'));

    if (action === 'deactivate') {
      await prisma.department.update({
        where: { id },
        data: { status: false, managerId: null }
      });
      return res.status(200).json(new ApiResponse(true, `Department "${dept.name}" deactivated successfully`));
    }

    if (force || action === 'force_delete') {
      await prisma.employee.updateMany({
        where: { departmentId: id },
        data: { departmentId: null, designationId: null }
      });
      await prisma.designation.deleteMany({
        where: { departmentId: id }
      });
      await prisma.department.delete({ where: { id } });

      await prisma.auditLog.create({
        data: {
          userId: (req as any).user?.id || null,
          action: 'DEPARTMENT_DELETED',
          entity: 'Department',
          entityId: id
        }
      }).catch(() => {});

      return res.status(200).json(new ApiResponse(true, `Department "${dept.name}" and all child associations deleted successfully`));
    }

    const assignedEmployees = await prisma.employee.count({ where: { departmentId: id } });
    if (assignedEmployees > 0) {
      return res.status(400).json(new ApiResponse(
        false, 
        `This department cannot be deleted because it has ${assignedEmployees} assigned employees. Please deactivate the department or force delete it.`
      ));
    }

    const designations = await prisma.designation.count({ where: { departmentId: id } });
    if (designations > 0) {
      return res.status(400).json(new ApiResponse(
        false, 
        `This department cannot be deleted because it has ${designations} designations. Please delete or reassign designations first.`
      ));
    }

    await prisma.department.delete({ where: { id } });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: (req as any).user?.id || null,
        action: 'DEPARTMENT_DELETED',
        entity: 'Department',
        entityId: id
      }
    }).catch(() => {});

    return res.status(200).json(new ApiResponse(true, 'Department deleted successfully'));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const assignDepartmentManager = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { managerId } = req.body;

    const department = await prisma.department.findUnique({ where: { id } });
    if (!department) return res.status(404).json(new ApiResponse(false, 'Department not found'));

    if (managerId) {
      const emp = await prisma.employee.findUnique({ where: { id: managerId } });
      if (!emp) return res.status(404).json(new ApiResponse(false, 'Employee not found'));

      // If manager belongs to another department, transfer them to this department
      if (emp.departmentId !== id) {
        await prisma.employee.update({
          where: { id: managerId },
          data: { departmentId: id }
        });
      }
    }

    const updatedDepartment = await prisma.department.update({
      where: { id },
      data: { managerId: managerId || null },
      include: {
        manager: {
          select: { id: true, firstName: true, lastName: true, employeeId: true, email: true }
        }
      }
    });

    if (managerId) {
      // 1. Department Head reports to top management (null managerId)
      await prisma.employee.update({
        where: { id: managerId },
        data: { managerId: null }
      }).catch(() => {});

      // 2. All other employees in this department report to Department Head
      await prisma.employee.updateMany({
        where: { departmentId: id, id: { not: managerId } },
        data: { managerId }
      }).catch(() => {});
    }

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: (req as any).user?.id || null,
        action: 'DEPARTMENT_MANAGER_CHANGED',
        entity: 'Department',
        entityId: id
      }
    }).catch(() => {});

    return res.status(200).json(new ApiResponse(true, 'Department manager updated successfully', updatedDepartment));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const getOrganizationOverview = async (req: Request, res: Response) => {
  try {
    const totalDepartments = await prisma.department.count();
    const totalDesignations = await prisma.designation.count();
    const assignedEmployees = await prisma.employee.count({
      where: { departmentId: { not: null } }
    });

    const departments = await prisma.department.findMany({
      include: {
        manager: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeId: true,
            email: true,
            photo: true,
            designation: { select: { name: true } }
          }
        },
        designations: {
          include: {
            _count: { select: { employees: true } }
          },
          orderBy: [{ level: 'asc' }, { name: 'asc' }]
        },
        _count: {
          select: { employees: true, designations: true }
        }
      },
      orderBy: { name: 'asc' }
    });

    const formattedDepartments = departments.map((d) => {
      const deptManager = d.manager;

      return {
        id: d.id,
        name: d.name,
        code: d.code,
        description: d.description,
        status: d.status,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        employeeCount: d._count.employees,
        designationCount: d._count.designations,
        manager: deptManager ? {
          id: deptManager.id,
          firstName: deptManager.firstName,
          lastName: deptManager.lastName,
          name: `${deptManager.firstName} ${deptManager.lastName}`,
          employeeId: deptManager.employeeId,
          email: deptManager.email,
          photo: deptManager.photo,
          designation: deptManager.designation?.name || null
        } : null,
        designations: d.designations.map(des => ({
          id: des.id,
          name: des.name,
          code: des.code,
          level: des.level,
          description: des.description,
          status: des.status,
          employeeCount: des._count.employees
        }))
      };
    });

    const activeManagersCount = formattedDepartments.filter(d => d.manager !== null).length;

    return res.status(200).json(new ApiResponse(true, 'Organization overview fetched successfully', {
      summary: {
        departments: totalDepartments,
        designations: totalDesignations,
        employees: assignedEmployees,
        managers: activeManagersCount
      },
      departments: formattedDepartments
    }));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};


