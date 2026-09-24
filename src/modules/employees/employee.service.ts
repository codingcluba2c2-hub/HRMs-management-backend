import { prisma } from '../../lib/prisma';
import bcrypt from 'bcryptjs';
import { decrypt } from '../../utils/encryption';
import { withCache } from '../../lib/redis';

export class EmployeeService {
  static async createEmployee(data: any, hrAdminId: string | undefined) {
    const existing = await prisma.employee.findFirst({
      where: { OR: [{ email: data.email }, { employeeId: data.employeeId }] }
    });
    
    if (existing) {
      throw new Error('Employee with this email or ID already exists');
    }

    let userId = null;
    if (data.password) {
      const passwordHash = await bcrypt.hash(data.password, 10);
      
      let employeeRole = await prisma.role.findUnique({ where: { name: 'EMPLOYEE' } });
      if (!employeeRole) {
        employeeRole = await prisma.role.create({ data: { name: 'EMPLOYEE', description: 'Regular employee' } });
      }

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

    const employee = await prisma.employee.create({
      data: {
        userId,
        createdById: hrAdminId,
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
        managerId: data.managerId,
        status: data.status,
      }
    });
    
    // Invalidate caches
    const { default: redis } = await import('../../lib/redis');
    if (redis.status === 'ready') {
      const keys = await redis.keys('employees:*');
      if (keys.length > 0) await redis.del(keys);
    }
    return employee;
  }

  static async bulkCreateEmployee(employees: any[], hrAdminId: string | undefined) {
    let successCount = 0;
    const errors: any[] = [];

    let employeeRole = await prisma.role.findUnique({ where: { name: 'EMPLOYEE' } });
    if (!employeeRole) {
      employeeRole = await prisma.role.create({ data: { name: 'EMPLOYEE', description: 'Regular employee' } });
    }

    const hrAdmin = hrAdminId ? await prisma.user.findUnique({ where: { id: hrAdminId } }) : null;

    for (let i = 0; i < employees.length; i++) {
      const data = employees[i];
      try {
        if (!data.employeeId || !data.firstName || !data.lastName || !data.email || !data.joiningDate) {
          errors.push({ row: i + 1, identifier: data.employeeId || data.email || 'Unknown', error: "Missing required fields" });
          continue;
        }

        const existing = await prisma.employee.findFirst({
          where: { OR: [{ email: data.email }, { employeeId: data.employeeId }] }
        });
        
        if (existing) {
          errors.push({ row: i + 1, identifier: data.employeeId, error: "Employee with this email or ID already exists" });
          continue;
        }

        const joinDateObj = new Date(data.joiningDate);
        if (isNaN(joinDateObj.getTime())) {
          errors.push({ row: i + 1, identifier: data.employeeId, error: "Invalid joining date format" });
          continue;
        }

        let departmentId = null;
        if (data.departmentName) {
          let dept = await prisma.department.findFirst({ where: { name: { equals: data.departmentName, mode: 'insensitive' } } });
          if (!dept) {
            dept = await prisma.department.create({ data: { name: data.departmentName, code: `DEPT-${Math.floor(100+Math.random()*900)}` } });
          }
          departmentId = dept.id;
        }

        let designationId = null;
        if (data.designationName && departmentId) {
          let desig = await prisma.designation.findFirst({ where: { name: { equals: data.designationName, mode: 'insensitive' }, departmentId } });
          if (!desig) {
            desig = await prisma.designation.create({ data: { name: data.designationName, departmentId } });
          }
          designationId = desig.id;
        }

        let userId = null;
        if (data.password) {
          const passwordHash = await bcrypt.hash(data.password, 10);
          const newUser = await prisma.user.create({
            data: {
              firstName: data.firstName,
              lastName: data.lastName,
              email: data.email,
              phone: data.phone || null,
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

        let baseSalary = 0;
        if (data.baseSalary) {
          baseSalary = parseFloat(data.baseSalary.toString().replace(/[^0-9.]/g, '')) || 0;
        }

        await prisma.employee.create({
          data: {
            userId,
            createdById: hrAdminId,
            employeeId: data.employeeId,
            firstName: data.firstName,
            lastName: data.lastName,
            email: data.email,
            phone: data.phone || null,
            joiningDate: joinDateObj,
            employmentType: data.employmentType || "FULL_TIME",
            status: data.status || "ACTIVE",
            baseSalary,
            departmentId,
            designationId
          }
        });
        successCount++;
      } catch (err: any) {
        errors.push({ row: i + 1, identifier: data.employeeId, error: err.message || "Database error" });
      }
    }

    // Invalidate caches
    const { default: redis } = await import('../../lib/redis');
    if (redis.status === 'ready') {
      const keys = await redis.keys('employees:*');
      if (keys.length > 0) await redis.del(keys);
    }

    return { successCount, errors };
  }

  static async getEmployees(filter: any, page: number = 1, limit: number = 20) {
    // We stringify the filter, page, and limit to create a unique cache key
    const cacheKey = `employees:list:${Buffer.from(JSON.stringify({filter, page, limit})).toString('base64')}`;

    return await withCache(cacheKey, 60, async () => {
      const skip = (page - 1) * limit;

      const [total, employeesRaw] = await Promise.all([
        prisma.employee.count({ where: filter }),
        prisma.employee.findMany({
          where: filter,
          skip,
          take: limit,
          select: {
            id: true,
            employeeId: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            status: true,
            joiningDate: true,
            employmentType: true,
            accountNumber: true,
            department: { select: { id: true, name: true } },
            designation: { select: { id: true, name: true } },
            managerId: true,
            manager: { select: { id: true, firstName: true, lastName: true } },
            leaveBalance: true,
            user: { select: { profilePic: true } },
          },
          orderBy: { createdAt: 'desc' }
        })
      ]);

      const data = employeesRaw.map(emp => {
        if (emp.accountNumber) {
          try { emp.accountNumber = decrypt(emp.accountNumber); } catch (e) {}
        }
        return emp;
      });

      return {
        data,
        total,
        page,
        totalPages: Math.ceil(total / limit)
      };
    });
  }

  static async updateEmployee(id: string, data: any) {
    const updated = await prisma.employee.update({
      where: { id },
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        gender: data.gender,
        dob: data.dob ? new Date(data.dob) : null,
        departmentId: data.departmentId,
        designationId: data.designationId,
        joiningDate: data.joiningDate ? new Date(data.joiningDate) : undefined,
        employmentType: data.employmentType,
        managerId: data.managerId,
        status: data.status,
      }
    });
    
    // Invalidate caches
    const { default: redis } = await import('../../lib/redis');
    if (redis.status === 'ready') {
      const keys = await redis.keys('employees:*');
      if (keys.length > 0) await redis.del(keys);
    }
    return updated;
  }

  static async deleteEmployee(id: string) {
    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) throw new Error('Employee not found');

    // Use soft delete
    await prisma.employee.update({
      where: { id },
      data: { isDeleted: true, status: 'TERMINATED' }
    });

    if (employee.userId) {
      await prisma.user.update({
        where: { id: employee.userId },
        data: { isDeleted: true }
      });
    }

    // Invalidate caches
    const { default: redis } = await import('../../lib/redis');
    if (redis.status === 'ready') {
      const keys = await redis.keys('employees:*');
      if (keys.length > 0) await redis.del(keys);
    }

    return true;
  }

  static async getDashboardSummary(filter: any) {
    let total = 0, active = 0, inactive = 0, onLeave = 0, newJoiners = 0, onProbation = 0;

    try { total = await prisma.employee.count({ where: { ...filter, isDeleted: false } }); } catch (e) {}
    try { active = await prisma.employee.count({ where: { ...filter, status: 'ACTIVE', isDeleted: false } }); } catch (e) {}
    try { inactive = await prisma.employee.count({ where: { ...filter, status: 'INACTIVE', isDeleted: false } }); } catch (e) {}
    
    try {
      onLeave = await prisma.leaveRequest.count({ 
        where: { 
          status: 'APPROVED',
          startDate: { lte: new Date() },
          endDate: { gte: new Date() },
          employee: { ...filter, isDeleted: false }
        } 
      });
    } catch (e) {}

    try {
      const now = new Date();
      const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      newJoiners = await prisma.employee.count({ 
        where: { ...filter, joiningDate: { gte: firstDayOfMonth }, isDeleted: false } 
      });
    } catch (e) {}

    try {
      const now = new Date();
      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
      onProbation = await prisma.employee.count({
        where: { ...filter, joiningDate: { gte: sixMonthsAgo }, isDeleted: false }
      });
    } catch (e) {}

    return { total, active, inactive, onLeave, newJoiners, onProbation };
  }

  static async getAnalytics(filter: any) {
    const deptDist = await prisma.employee.groupBy({
      by: ['departmentId'],
      _count: { id: true },
      where: { ...filter, isDeleted: false }
    });

    const departments = await prisma.department.findMany({ select: { id: true, name: true } });
    const deptMap = departments.reduce((acc: any, d) => ({ ...acc, [d.id]: d.name }), {});

    const departmentDistribution = deptDist.map(d => ({
      name: d.departmentId ? deptMap[d.departmentId] : 'Unassigned',
      value: d._count.id
    }));

    const genderDist = await prisma.employee.groupBy({
      by: ['gender'],
      _count: { id: true },
      where: { ...filter, isDeleted: false }
    });

    const genderDistribution = genderDist.map(d => ({
      name: d.gender || 'Unknown',
      value: d._count.id
    }));

    const typeDist = await prisma.employee.groupBy({
      by: ['employmentType'],
      _count: { id: true },
      where: { ...filter, isDeleted: false }
    });

    const employmentTypeDistribution = typeDist.map(d => ({
      name: d.employmentType || 'Unknown',
      value: d._count.id
    }));

    return { departmentDistribution, genderDistribution, employmentTypeDistribution };
  }

  static async getEmployeeDetails(id: string) {
    const employee = await prisma.employee.findUnique({
      where: { id },
      include: {
        department: true,
        designation: true,
        manager: { select: { firstName: true, lastName: true } },
        leaveBalance: true,
        documents: true,
        attendanceRecords: { take: 10, orderBy: { date: 'desc' } }
      }
    });

    if (!employee || employee.isDeleted) throw new Error('Not found');
    
    if (employee.accountNumber) {
      try { employee.accountNumber = decrypt(employee.accountNumber); } catch (e) {}
    }

    return employee;
  }

  static async bulkOperations(action: string, employeeIds: string[], data: any) {
    switch (action) {
      case 'DELETE':
        await prisma.employee.updateMany({
          where: { id: { in: employeeIds } },
          data: { status: 'TERMINATED', isDeleted: true }
        });
        break;
      case 'ACTIVATE':
        await prisma.employee.updateMany({
          where: { id: { in: employeeIds } },
          data: { status: 'ACTIVE' }
        });
        break;
      case 'DEACTIVATE':
        await prisma.employee.updateMany({
          where: { id: { in: employeeIds } },
          data: { status: 'INACTIVE' }
        });
        break;
      case 'ASSIGN_DEPARTMENT':
        await prisma.employee.updateMany({
          where: { id: { in: employeeIds } },
          data: { departmentId: data.departmentId }
        });
        break;
      case 'ASSIGN_MANAGER':
        await prisma.employee.updateMany({
          where: { id: { in: employeeIds } },
          data: { managerId: data.managerId }
        });
        break;
      default:
        throw new Error('Invalid action');
    }
  }
}
