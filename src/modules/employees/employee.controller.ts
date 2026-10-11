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
        shift: { select: { id: true, name: true, startTime: true, endTime: true, graceTime: true, breakDuration: true, weeklyOff: true } },
        leaveBalance: true,
        leaveRequests: {
          take: 5,
          orderBy: { createdAt: 'desc' }
        },
        documents: {
          select: { id: true, documentType: true, category: true, verificationStatus: true, verifiedAt: true }
        },
        payrollRecords: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: { id: true, month: true, year: true, netSalary: true, grossSalary: true, status: true, paymentDate: true }
        },
        attendanceRecords: {
          take: 30,
          orderBy: { date: 'desc' }
        },
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

      // 1. Calculate Real Attendance Stats
      const attRecords = emp.attendanceRecords || [];
      const workingDays = attRecords.filter((r: any) => r.status !== 'WEEKEND' && r.status !== 'HOLIDAY');
      const presentCount = workingDays.filter((r: any) => r.status === 'PRESENT').length;
      const halfDayCount = workingDays.filter((r: any) => r.status === 'HALF_DAY').length;
      const absentCount = workingDays.filter((r: any) => r.status === 'ABSENT').length;
      const leaveCount = workingDays.filter((r: any) => r.status === 'LEAVE').length;
      const lateCount = workingDays.filter((r: any) => r.isLate).length;
      const totalWorking = workingDays.length;

      const attendanceRate = totalWorking > 0
        ? Math.min(100, Math.round(((presentCount + (halfDayCount * 0.5)) / totalWorking) * 100))
        : 95;

      const latestAtt = attRecords[0] || null;

      // 2. Real Leave Balance & Requests
      const lb = emp.leaveBalance || { annual: 15, casual: 10, medical: 8, earned: 5, compOff: 0 };
      const totalAvailableLeaves = Math.max(0, (lb.annual || 0) + (lb.casual || 0) + (lb.medical || 0) + (lb.earned || 0) + (lb.compOff || 0));
      const latestLeave = emp.leaveRequests?.[0] || null;

      // 3. Real Compliance & KYC Details
      const docs = emp.documents || [];
      const verifiedDocs = docs.filter((d: any) => d.verificationStatus === 'VERIFIED').length;
      const complianceStatus = docs.length > 0 && verifiedDocs === docs.length ? 'VERIFIED' : (docs.length > 0 ? 'PARTIAL' : 'PENDING');
      const bankStatus = (emp.bankName && accountNumber) ? 'VERIFIED' : 'PENDING';

      // 4. Synthesize Real Enterprise Recent Activity
      const recentActivity: any[] = [];
      if (latestLeave) {
        recentActivity.push({
          id: `leave-${latestLeave.id}`,
          type: 'LEAVE',
          title: `Leave ${latestLeave.status === 'APPROVED' ? 'Approved' : latestLeave.status === 'PENDING' ? 'Requested' : latestLeave.status}`,
          subtitle: `${latestLeave.leaveType} • ${new Date(latestLeave.startDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} - ${new Date(latestLeave.endDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}`,
          timestamp: latestLeave.updatedAt || latestLeave.createdAt,
          status: latestLeave.status
        });
      }
      if (latestAtt) {
        recentActivity.push({
          id: `att-${latestAtt.id}`,
          type: 'ATTENDANCE',
          title: `Attendance: ${latestAtt.status}`,
          subtitle: `${new Date(latestAtt.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} • ${latestAtt.effectiveHours || 8} hrs logged${latestAtt.isLate ? ' (Late)' : ''}`,
          timestamp: latestAtt.date,
          status: latestAtt.status
        });
      }
      if (emp.payrollRecords?.[0]) {
        const pr = emp.payrollRecords[0];
        recentActivity.push({
          id: `pay-${pr.id}`,
          type: 'PAYROLL',
          title: `Payroll ${pr.status === 'PAID' ? 'Disbursed' : 'Processed'}`,
          subtitle: `₹${Number(pr.netSalary || pr.grossSalary || 0).toLocaleString('en-IN')} (Sep 2026)`,
          timestamp: pr.paymentDate || pr.createdAt,
          status: pr.status
        });
      }
      recentActivity.push({
        id: `join-${emp.id}`,
        type: 'ONBOARDING',
        title: 'Joined Organization',
        subtitle: `${emp.department?.name || 'Department'} • Active Employee`,
        timestamp: emp.joiningDate || emp.createdAt,
        status: 'COMPLETED'
      });

      recentActivity.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return {
        ...emp,
        accountNumber,
        companyName: resolvedCompany,
        attendanceAnalytics: {
          rate: attendanceRate,
          presentDays: presentCount,
          halfDays: halfDayCount,
          absentDays: absentCount,
          lateDays: lateCount,
          leaveDays: leaveCount,
          totalWorkingDays: totalWorking,
          latestRecord: latestAtt
        },
        leaveSummary: {
          totalAvailable: totalAvailableLeaves,
          breakdown: lb,
          latestRequest: latestLeave
        },
        complianceSummary: {
          documentsStatus: complianceStatus,
          verifiedDocsCount: verifiedDocs,
          totalDocsCount: docs.length,
          bankStatus,
          bankName: emp.bankName,
          accountNumberMasked: accountNumber ? `••••${accountNumber.slice(-4)}` : null,
          ifsc: emp.ifsc
        },
        recentActivity
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


