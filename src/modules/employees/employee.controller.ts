import { Request, Response } from 'express';
import { ApiResponse } from '../../utils/ApiResponse';
import { AuthRequest } from '../../middlewares/authMiddleware';
import { EmployeeService } from './employee.service';
import { prisma } from '../../lib/prisma';
import bcrypt from 'bcryptjs';
import { decrypt } from '../../utils/encryption';

export const createEmployee = async (req: AuthRequest, res: Response) => {
  try {
    const data = req.body;
    
    // Check if employeeId or email exists
    const existing = await prisma.employee.findFirst({
      where: { OR: [{ email: data.email }, { employeeId: data.employeeId }] }
    });
    
    if (existing) {
      return res.status(400).json(new ApiResponse(false, 'Employee with this email or ID already exists'));
    }

    // Hash password if provided
    let userId = null;
    if (data.password) {
      const passwordHash = await bcrypt.hash(data.password, 10);
      
      // Get the employee role
      let employeeRole = await prisma.role.findUnique({ where: { name: 'EMPLOYEE' } });
      if (!employeeRole) {
        employeeRole = await prisma.role.create({ data: { name: 'EMPLOYEE', description: 'Regular employee' } });
      }

      // Fetch HR Admin's company details to auto-fill
      const hrAdminId = req.user?.id;
      const hrAdmin = hrAdminId ? await prisma.user.findUnique({ where: { id: hrAdminId } }) : null;

      const newUser = await prisma.user.create({
        data: {
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          phone: data.phone,
          passwordHash,
          roleId: employeeRole.id,
          companyName: hrAdmin?.companyName || null,
          companyWebsite: hrAdmin?.companyWebsite || null,
          companyAddress: hrAdmin?.companyAddress || null,
          companyPhone: hrAdmin?.companyPhone || null,
        }
      });
      userId = newUser.id;
    }

    if (data.designationId && data.departmentId) {
      const desig = await prisma.designation.findUnique({ where: { id: data.designationId } });
      if (desig && desig.departmentId !== data.departmentId) {
        return res.status(400).json(new ApiResponse(false, 'Selected designation does not belong to the selected department'));
      }
    }

    // Resolve department manager if not explicitly set
    let finalManagerId = data.managerId || null;
    if (data.departmentId && !finalManagerId) {
      const dept = await prisma.department.findUnique({ where: { id: data.departmentId } });
      if (dept?.managerId) {
        finalManagerId = dept.managerId;
      }
    }

    const employee = await prisma.employee.create({
      data: {
        userId,
        createdById: req.user?.id, // Track HR Admin
        employeeId: data.employeeId,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        gender: data.gender,
        dob: data.dob ? new Date(data.dob) : null,
        departmentId: data.departmentId,
        designationId: data.designationId,
        joiningDate: new Date(data.joiningDate),
        employmentType: data.employmentType,
        managerId: finalManagerId,
        status: data.status,
      }
    });

    res.status(201).json(new ApiResponse(true, 'Employee created successfully', employee));
  } catch (error: any) {
    res.status(400).json(new ApiResponse(false, error.message));
  }
};

export const bulkCreateEmployee = async (req: AuthRequest, res: Response) => {
  try {
    const { employees } = req.body;
    if (!employees || !Array.isArray(employees)) {
      return res.status(400).json(new ApiResponse(false, "Invalid data format"));
    }

    const { successCount, errors } = await EmployeeService.bulkCreateEmployee(employees, req.user?.id);

    if (errors.length > 0) {
      return res.status(207).json(new ApiResponse(true, `Bulk import finished with errors. Success: ${successCount}, Failed: ${errors.length}`, { successCount, errors }));
    }

    return res.status(200).json(new ApiResponse(true, `Bulk import completed successfully. Success: ${successCount}`));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const getEmployees = async (req: AuthRequest, res: Response) => {
  try {
    const role = req.user?.role;
    const { search, department, designation, status, employmentType, manager, joiningDate, gender } = req.query;
    
    // Auto-sync employee reporting managers to match department managers
    const deptsWithManagers = await prisma.department.findMany({
      where: { managerId: { not: null } },
      select: { id: true, managerId: true }
    });

    for (const d of deptsWithManagers) {
      if (d.managerId) {
        // Department head reports to top management (null managerId)
        await prisma.employee.update({
          where: { id: d.managerId },
          data: { managerId: null }
        }).catch(() => {});

        // All other staff in this department report to Department Head
        await prisma.employee.updateMany({
          where: {
            departmentId: d.id,
            id: { not: d.managerId },
            OR: [
              { managerId: null },
              { managerId: { not: d.managerId } }
            ]
          },
          data: { managerId: d.managerId }
        }).catch(() => {});
      }
    }
    let filter: any = {};

    if (search) {
      filter.OR = [
        { firstName: { contains: search as string, mode: 'insensitive' } },
        { lastName: { contains: search as string, mode: 'insensitive' } },
        { employeeId: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } }
      ];
    }
    if (department && department !== 'ALL') filter.departmentId = department as string;
    if (designation && designation !== 'ALL') filter.designationId = designation as string;
    if (status && status !== 'ALL') filter.status = status as string;
    if (employmentType && employmentType !== 'ALL') filter.employmentType = employmentType as string;
    if (manager && manager !== 'ALL') filter.managerId = manager as string;
    if (gender && gender !== 'ALL') filter.gender = gender as string;

    const employees = await prisma.employee.findMany({
      where: filter,
      include: {
        department: { select: { id: true, name: true, managerId: true } },
        designation: { select: { id: true, name: true } },
        manager: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
        leaveBalance: true,
      },
      orderBy: { createdAt: 'desc' }
    });

    const decryptedEmployees = employees.map((emp: any) => {
      if (emp.accountNumber) {
        try { emp.accountNumber = decrypt(emp.accountNumber); } catch (e) {}
      }
      return emp;
    });

    res.status(200).json(new ApiResponse(true, 'Employees fetched successfully', decryptedEmployees));
  } catch (error: any) {
    res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const updateEmployee = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const existingEmp = await prisma.employee.findUnique({ where: { id } });
    if (!existingEmp) {
      return res.status(404).json(new ApiResponse(false, 'Employee not found'));
    }

    const targetDeptId = data.departmentId !== undefined ? data.departmentId : existingEmp.departmentId;
    let finalManagerId = data.managerId !== undefined ? data.managerId : existingEmp.managerId;

    const deptChanged = data.departmentId !== undefined && data.departmentId !== existingEmp.departmentId;

    if (targetDeptId) {
      const targetDept = await prisma.department.findUnique({ where: { id: targetDeptId } });
      if (targetDept) {
        if (targetDept.managerId === id) {
          finalManagerId = null;
        } else if (deptChanged) {
          // Department changed! Auto-assign target department's manager
          if (targetDept.managerId) {
            finalManagerId = targetDept.managerId;
          }
        } else if (!finalManagerId && targetDept.managerId) {
          finalManagerId = targetDept.managerId;
        }
      }
    }

    const employee = await prisma.employee.update({
      where: { id },
      data: {
        firstName: data.firstName !== undefined ? data.firstName : existingEmp.firstName,
        lastName: data.lastName !== undefined ? data.lastName : existingEmp.lastName,
        email: data.email !== undefined ? data.email : existingEmp.email,
        phone: data.phone !== undefined ? data.phone : existingEmp.phone,
        gender: data.gender !== undefined ? data.gender : existingEmp.gender,
        dob: data.dob !== undefined ? (data.dob ? new Date(data.dob) : null) : existingEmp.dob,
        departmentId: targetDeptId,
        designationId: data.designationId !== undefined ? data.designationId : existingEmp.designationId,
        joiningDate: data.joiningDate ? new Date(data.joiningDate) : existingEmp.joiningDate,
        employmentType: data.employmentType !== undefined ? data.employmentType : existingEmp.employmentType,
        managerId: finalManagerId,
        status: data.status !== undefined ? data.status : existingEmp.status,
      },
      include: {
        department: { select: { id: true, name: true } },
        designation: { select: { id: true, name: true } },
        manager: { select: { id: true, firstName: true, lastName: true, employeeId: true } }
      }
    });

    res.status(200).json(new ApiResponse(true, 'Employee updated successfully', employee));
  } catch (error: any) {
    res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const deleteEmployee = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await EmployeeService.deleteEmployee(id);
    res.status(200).json(new ApiResponse(true, 'Employee deleted successfully'));
  } catch (error: any) {
    res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const getDashboardSummary = async (req: AuthRequest, res: Response) => {
  try {
    const filter = {};

    let total = 0, active = 0, inactive = 0, onLeave = 0, newJoiners = 0, onProbation = 0;

    try { total = await prisma.employee.count({ where: filter }); } catch (e) { console.error("total count failed", e); }
    try { active = await prisma.employee.count({ where: { ...filter, status: 'ACTIVE' } }); } catch (e) { console.error("active count failed", e); }
    try { inactive = await prisma.employee.count({ where: { ...filter, status: 'INACTIVE' } }); } catch (e) { console.error("inactive count failed", e); }
    
    const summary = await EmployeeService.getDashboardSummary(filter);
    res.status(200).json(new ApiResponse(true, 'Dashboard summary fetched', summary));
  } catch (error: any) {
    res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const getAnalytics = async (req: AuthRequest, res: Response) => {
  try {
    const filter = {};

    const analytics = await EmployeeService.getAnalytics(filter);
    res.status(200).json(new ApiResponse(true, 'Analytics fetched', analytics));
  } catch (error: any) {
    res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const getEmployeeDetails = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const employee = await EmployeeService.getEmployeeDetails(id);
    res.status(200).json(new ApiResponse(true, 'Employee details fetched', employee));
  } catch (error: any) {
    res.status(404).json(new ApiResponse(false, error.message));
  }
};

export const bulkOperations = async (req: AuthRequest, res: Response) => {
  try {
    const { action, employeeIds, data } = req.body;
    
    if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json(new ApiResponse(false, 'No employees selected'));
    }

    await EmployeeService.bulkOperations(action, employeeIds, data);
    res.status(200).json(new ApiResponse(true, `Bulk ${action} completed successfully`));
  } catch (error: any) {
    res.status(400).json(new ApiResponse(false, error.message));
  }
};

export const updateEmployeeOrganization = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { departmentId, designationId, managerId } = req.body;

    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) {
      return res.status(404).json(new ApiResponse(false, 'Employee not found'));
    }

    const targetDeptId = departmentId !== undefined ? departmentId : employee.departmentId;
    
    if (designationId && targetDeptId) {
      const desig = await prisma.designation.findUnique({ where: { id: designationId } });
      if (desig && desig.departmentId !== targetDeptId) {
        return res.status(400).json(new ApiResponse(false, 'Selected designation does not belong to the selected department'));
      }
    }

    const updated = await prisma.employee.update({
      where: { id },
      data: {
        departmentId: departmentId || null,
        designationId: designationId || null,
        managerId: managerId || null
      },
      include: {
        department: { select: { id: true, name: true, code: true } },
        designation: { select: { id: true, name: true, code: true } },
        manager: { select: { id: true, firstName: true, lastName: true, employeeId: true } }
      }
    });

    return res.status(200).json(new ApiResponse(true, 'Employee organization assignment updated successfully', updated));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

