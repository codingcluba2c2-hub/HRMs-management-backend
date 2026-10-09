import { Request, Response } from 'express';
import { ApiResponse } from '../../utils/ApiResponse';
import { AuthRequest } from '../../middlewares/authMiddleware';
import { EmployeeService } from './employee.service';
import { prisma } from '../../lib/prisma';
import bcrypt from 'bcryptjs';
import { decrypt } from '../../utils/encryption';
import { getTenantEmployeeFilter } from '../../utils/tenantFilter';
import { getManagerScopedEmployeeFilter } from '../../utils/managerScope';
import { getOrCreateEmployeeForUser } from '../../utils/employeeUtils';
import { handleEmployeeDepartmentTransfer } from '../../services/departmentManager.service';

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

    // Resolve department manager automatically from department
    let finalManagerId: string | null = null;
    if (data.departmentId) {
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
        departmentId: data.departmentId || null,
        designationId: data.designationId || null,
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

    if (req.user?.id) {
      await getOrCreateEmployeeForUser(req.user.id);
    }

    const tenantFilter = await getManagerScopedEmployeeFilter(req.user);
    let filter: any = { ...tenantFilter };

    if (search) {
      const searchConditions = [
        { firstName: { contains: search as string, mode: 'insensitive' } },
        { lastName: { contains: search as string, mode: 'insensitive' } },
        { employeeId: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } }
      ];
      if (filter.OR) {
        filter.AND = [
          { OR: filter.OR },
          { OR: searchConditions }
        ];
        delete filter.OR;
      } else {
        filter.OR = searchConditions;
      }
    }
    if (department && department !== 'ALL') filter.departmentId = department as string;
    if (designation && designation !== 'ALL') filter.designationId = designation as string;
    if (status && status !== 'ALL') filter.status = status as string;
    if (manager && manager !== 'ALL') filter.managerId = manager as string;
    if (gender && gender !== 'ALL') filter.gender = gender as string;

    const employees = await prisma.employee.findMany({
      where: filter,
      include: {
        department: { select: { id: true, name: true, managerId: true, manager: { select: { id: true, firstName: true, lastName: true } } } },
        designation: { select: { id: true, name: true } },
        manager: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
        leaveBalance: true,
        user: { select: { profilePic: true, companyName: true } },
      },
      orderBy: { createdAt: 'desc' }
    });

    // Resolve company name directly from User table records (userId, email, or creator)
    const allUsers = await prisma.user.findMany({
      select: { id: true, email: true, companyName: true }
    });

    const userByEmailMap = new Map();
    const userByIdMap = new Map();

    allUsers.forEach(u => {
      if (u.id) userByIdMap.set(u.id, u.companyName);
      if (u.email) userByEmailMap.set(u.email.trim().toLowerCase(), u.companyName);
    });

    const decryptedEmployees = employees.map((emp: any) => {
      let accountNumber = emp.accountNumber;
      if (accountNumber) {
        try { accountNumber = decrypt(accountNumber); } catch (e) {}
      }

      const empEmail = emp.email ? emp.email.trim().toLowerCase() : '';

      const userByUserId = emp.userId ? userByIdMap.get(emp.userId) : null;
      const userByEmail = empEmail ? userByEmailMap.get(empEmail) : null;
      const userByCreator = emp.createdById ? userByIdMap.get(emp.createdById) : null;

      const resolvedCompany = userByUserId || userByEmail || userByCreator || emp.user?.companyName || null;

      return {
        ...emp,
        accountNumber,
        companyName: resolvedCompany
      };
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
    const actorUserId = (req as any).user?.id;

    const existingEmp = await prisma.employee.findUnique({ where: { id } });
    if (!existingEmp) {
      return res.status(404).json(new ApiResponse(false, 'Employee not found'));
    }

    // First update basic fields
    await prisma.employee.update({
      where: { id },
      data: {
        firstName: data.firstName !== undefined ? data.firstName : existingEmp.firstName,
        lastName: data.lastName !== undefined ? data.lastName : existingEmp.lastName,
        email: data.email !== undefined ? data.email : existingEmp.email,
        phone: data.phone !== undefined ? data.phone : existingEmp.phone,
        gender: data.gender !== undefined ? data.gender : existingEmp.gender,
        dob: data.dob !== undefined ? (data.dob ? new Date(data.dob) : null) : existingEmp.dob,
        joiningDate: data.joiningDate ? new Date(data.joiningDate) : existingEmp.joiningDate,
        employmentType: data.employmentType !== undefined ? data.employmentType : existingEmp.employmentType,
        status: data.status !== undefined ? data.status : existingEmp.status,
        baseSalary: data.baseSalary !== undefined ? (parseFloat(data.baseSalary) || 0) : existingEmp.baseSalary,
      }
    });

    // If department or designation was passed, execute centralized transfer logic
    const updatedEmployee = await handleEmployeeDepartmentTransfer(
      id,
      data.departmentId !== undefined ? data.departmentId : existingEmp.departmentId,
      data.designationId !== undefined ? data.designationId : existingEmp.designationId,
      actorUserId
    );

    res.status(200).json(new ApiResponse(true, 'Employee updated successfully', updatedEmployee));
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
    const filter = getTenantEmployeeFilter(req.user);
    const summary = await EmployeeService.getDashboardSummary(filter);
    res.status(200).json(new ApiResponse(true, 'Dashboard summary fetched', summary));
  } catch (error: any) {
    res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const getAnalytics = async (req: AuthRequest, res: Response) => {
  try {
    const filter = getTenantEmployeeFilter(req.user);
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
    const { departmentId, designationId } = req.body;
    const actorUserId = (req as any).user?.id;

    const updated = await handleEmployeeDepartmentTransfer(id, departmentId, designationId, actorUserId);

    return res.status(200).json(new ApiResponse(true, 'Employee organization assignment updated successfully', updated));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const assignManagerRole = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { departmentIds } = req.body;
    const result = await EmployeeService.assignManagerRole(id, departmentIds || [], req.user?.id);
    return res.status(200).json(new ApiResponse(true, result.message, result));
  } catch (error: any) {
    return res.status(400).json(new ApiResponse(false, error.message));
  }
};

export const removeManagerRole = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reassignToManagerId } = req.body;
    const result = await EmployeeService.removeManagerRole(id, reassignToManagerId, req.user?.id);
    return res.status(200).json(new ApiResponse(true, result.message, result));
  } catch (error: any) {
    return res.status(400).json(new ApiResponse(false, error.message));
  }
};

export const getManagerScope = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const scope = await EmployeeService.getManagerScope(id);
    return res.status(200).json(new ApiResponse(true, 'Manager scope retrieved', scope));
  } catch (error: any) {
    return res.status(400).json(new ApiResponse(false, error.message));
  }
};

export const updateManagerScope = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { departmentIds, designationIds } = req.body;
    const result = await EmployeeService.updateManagerScope(id, departmentIds || [], designationIds || []);
    return res.status(200).json(new ApiResponse(true, result.message, result));
  } catch (error: any) {
    return res.status(400).json(new ApiResponse(false, error.message));
  }
};


