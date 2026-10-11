import { prisma } from '../../lib/prisma';
import { Request, Response } from 'express';
import { ApiResponse } from '../../utils/ApiResponse';
import { invalidateCachePattern } from '../../lib/redis';
import { getTenantShiftFilter, getTenantEmployeeFilter } from '../../utils/tenantFilter';
import { getManagerScopedEmployeeFilter, resolveUserManagerScope } from '../../utils/managerScope';
import ExcelJS from 'exceljs';

export const getAll = async (req: Request, res: Response) => {
  try {
    const tenantShiftFilter = await getTenantShiftFilter((req as any).user);
    const tenantEmpFilter = await getManagerScopedEmployeeFilter((req as any).user);

    let shifts = await prisma.shift.findMany({
      where: tenantShiftFilter,
      include: {
        _count: {
          select: { employees: { where: tenantEmpFilter } }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    // Auto-seed default shifts if database has 0 shifts globally
    const globalCount = await prisma.shift.count();
    if (globalCount === 0) {
      const defaultShifts = [
        {
          name: "General Day Shift",
          startTime: "09:00",
          endTime: "18:00",
          graceTime: 15,
          breakDuration: 60,
          weeklyOff: ["Saturday", "Sunday"],
          status: true,
          createdById: null
        },
        {
          name: "Morning Roster",
          startTime: "06:00",
          endTime: "14:30",
          graceTime: 10,
          breakDuration: 45,
          weeklyOff: ["Sunday"],
          status: true,
          createdById: null
        },
        {
          name: "Night Roster",
          startTime: "22:00",
          endTime: "06:30",
          graceTime: 15,
          breakDuration: 60,
          weeklyOff: ["Sunday"],
          status: true,
          createdById: null
        },
        {
          name: "Flexible Shift",
          startTime: "10:00",
          endTime: "19:00",
          graceTime: 30,
          breakDuration: 60,
          weeklyOff: ["Saturday", "Sunday"],
          status: true,
          createdById: null
        }
      ];

      for (const ds of defaultShifts) {
        await prisma.shift.create({ data: ds }).catch(() => {});
      }

      shifts = await prisma.shift.findMany({
        where: tenantShiftFilter,
        include: {
          _count: {
            select: { employees: { where: tenantEmpFilter } }
          }
        },
        orderBy: { createdAt: 'asc' }
      });
    }

    return res.status(200).json(new ApiResponse(true, "Shifts fetched successfully", shifts));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const create = async (req: Request, res: Response) => {
  try {
    const scope = await resolveUserManagerScope((req as any).user);
    if (scope.isManager) {
      return res.status(403).json(new ApiResponse(false, "Forbidden: Only HR Admin or Super Admin can create shift templates"));
    }

    const userId = (req as any).user?.id;
    const shiftData = {
      ...req.body,
      createdById: userId || null
    };

    const data = await prisma.shift.create({ data: shiftData });
    await invalidateCachePattern(`dashboard:*`);
    return res.status(201).json(new ApiResponse(true, "Shift created successfully", data));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const update = async (req: Request, res: Response) => {
  try {
    const scope = await resolveUserManagerScope((req as any).user);
    if (scope.isManager) {
      return res.status(403).json(new ApiResponse(false, "Forbidden: Only HR Admin or Super Admin can update shift templates"));
    }

    const { id } = req.params;
    const tenantShiftFilter = await getTenantShiftFilter((req as any).user);

    const existing = await prisma.shift.findFirst({ where: { id, ...tenantShiftFilter } });
    if (!existing) return res.status(404).json(new ApiResponse(false, "Shift not found or access denied"));

    const data = await prisma.shift.update({
      where: { id },
      data: req.body
    });
    await invalidateCachePattern(`dashboard:*`);
    return res.status(200).json(new ApiResponse(true, "Shift updated successfully", data));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const remove = async (req: Request, res: Response) => {
  try {
    const scope = await resolveUserManagerScope((req as any).user);
    if (scope.isManager) {
      return res.status(403).json(new ApiResponse(false, "Forbidden: Only HR Admin or Super Admin can delete shift templates"));
    }

    const { id } = req.params;
    const tenantShiftFilter = await getTenantShiftFilter((req as any).user);

    const existing = await prisma.shift.findFirst({ where: { id, ...tenantShiftFilter } });
    if (!existing) return res.status(404).json(new ApiResponse(false, "Shift not found or access denied"));

    // Unlink employees before deleting shift
    await prisma.employee.updateMany({
      where: { shiftId: id },
      data: { shiftId: null }
    });
    await prisma.shift.delete({ where: { id } });
    await invalidateCachePattern(`dashboard:*`);
    return res.status(200).json(new ApiResponse(true, "Shift deleted successfully"));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const getRoster = async (req: Request, res: Response) => {
  try {
    const { departmentId, search, shiftId } = req.query;

    const scope = await resolveUserManagerScope((req as any).user);
    if (scope.isManager) {
      if (scope.departmentIds.length === 0) {
        return res.status(200).json(new ApiResponse(true, "Employee roster fetched successfully", []));
      }
      if (departmentId && departmentId !== 'ALL' && !scope.departmentIds.includes(departmentId as string)) {
        return res.status(403).json(new ApiResponse(false, "Forbidden: Department out of authorized scope"));
      }
    }

    const tenantEmpFilter = await getManagerScopedEmployeeFilter((req as any).user);

    const where: any = { 
      ...tenantEmpFilter
    };

    if (departmentId && departmentId !== 'ALL') {
      where.departmentId = departmentId as string;
    } else if (scope.isManager && scope.departmentIds.length > 0) {
      where.departmentId = { in: scope.departmentIds };
    }

    if (shiftId && shiftId !== 'ALL') {
      if (shiftId === 'UNASSIGNED') {
        where.shiftId = null;
      } else {
        where.shiftId = shiftId as string;
      }
    }

    if (search) {
      where.AND = [
        {
          OR: [
            { firstName: { contains: search as string, mode: 'insensitive' } },
            { lastName: { contains: search as string, mode: 'insensitive' } },
            { employeeId: { contains: search as string, mode: 'insensitive' } },
            { email: { contains: search as string, mode: 'insensitive' } }
          ]
        }
      ];
    }

    const employees = await prisma.employee.findMany({
      where,
      select: {
        id: true,
        employeeId: true,
        firstName: true,
        lastName: true,
        email: true,
        photo: true,
        shiftId: true,
        status: true,
        department: { select: { id: true, name: true } },
        designation: { select: { id: true, name: true } },
        shift: { select: { id: true, name: true, startTime: true, endTime: true, weeklyOff: true } }
      },
      orderBy: { firstName: 'asc' }
    });

    return res.status(200).json(new ApiResponse(true, "Employee roster fetched successfully", employees));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const assignShift = async (req: Request, res: Response) => {
  try {
    const { employeeIds, shiftId } = req.body;
    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json(new ApiResponse(false, "employeeIds array is required"));
    }

    const scope = await resolveUserManagerScope((req as any).user);
    if (scope.isManager) {
      const unauthorizedCount = await prisma.employee.count({
        where: {
          id: { in: employeeIds },
          OR: [
            { departmentId: { notIn: scope.departmentIds } },
            { departmentId: null }
          ]
        }
      });
      if (unauthorizedCount > 0) {
        return res.status(403).json(new ApiResponse(false, "Forbidden: Target employee out of authorized department scope"));
      }
    }

    const tenantEmpFilter = await getManagerScopedEmployeeFilter((req as any).user);

    await prisma.employee.updateMany({
      where: {
        id: { in: employeeIds },
        ...tenantEmpFilter
      },
      data: { shiftId: shiftId || null }
    });

    await invalidateCachePattern(`dashboard:*`);
    return res.status(200).json(new ApiResponse(true, "Employee shift updated successfully"));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const getBulkAssignShiftTemplate = async (req: Request, res: Response) => {
  try {
    const tenantEmpFilter = await getManagerScopedEmployeeFilter((req as any).user);
    const tenantShiftFilter = await getTenantShiftFilter((req as any).user);

    // Fetch active employees
    const employees = await prisma.employee.findMany({
      where: { ...tenantEmpFilter, isDeleted: false },
      select: {
        employeeId: true,
        firstName: true,
        lastName: true,
        email: true,
        department: { select: { name: true } },
        designation: { select: { name: true } },
        shift: { select: { name: true } }
      },
      orderBy: { employeeId: 'asc' }
    });

    // Fetch available active shifts
    const shifts = await prisma.shift.findMany({
      where: { ...tenantShiftFilter, status: true },
      select: {
        name: true,
        startTime: true,
        endTime: true,
        graceTime: true,
        breakDuration: true,
        weeklyOff: true
      },
      orderBy: { name: 'asc' }
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Enterprise HRMS Pro';
    workbook.created = new Date();

    // 1. Shift Assignment Sheet
    const sheet = workbook.addWorksheet('Shift_Assignment', {
      views: [{ showGridLines: true }]
    });

    sheet.columns = [
      { header: 'Employee ID', key: 'employeeId', width: 18 },
      { header: 'Full Name', key: 'name', width: 22 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Department', key: 'department', width: 22 },
      { header: 'Designation', key: 'designation', width: 22 },
      { header: 'Current Shift', key: 'currentShift', width: 22 },
      { header: 'New Shift Name (Required)', key: 'newShift', width: 28 },
    ];

    // Style header row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E40AF' }
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 28;

    // Populate employees
    employees.forEach((emp, i) => {
      const row = sheet.addRow({
        employeeId: emp.employeeId,
        name: `${emp.firstName} ${emp.lastName}`,
        email: emp.email,
        department: emp.department?.name || '—',
        designation: emp.designation?.name || '—',
        currentShift: emp.shift?.name || 'Unassigned',
        newShift: emp.shift?.name || ''
      });
      row.height = 20;
      row.alignment = { vertical: 'middle' };
      if (i % 2 === 0) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8FAFC' }
        };
      }
    });

    // 2. Reference Sheet for Shifts
    const refSheet = workbook.addWorksheet('Available_Shifts_Reference', {
      views: [{ showGridLines: true }]
    });

    refSheet.columns = [
      { header: 'Valid Shift Name', key: 'name', width: 25 },
      { header: 'Working Hours', key: 'hours', width: 20 },
      { header: 'Grace Time (mins)', key: 'grace', width: 18 },
      { header: 'Break (mins)', key: 'break', width: 15 },
      { header: 'Configured Weekly Off', key: 'weeklyOff', width: 25 }
    ];

    const refHeader = refSheet.getRow(1);
    refHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    refHeader.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F766E' }
    };
    refHeader.alignment = { vertical: 'middle', horizontal: 'center' };
    refHeader.height = 28;

    shifts.forEach((s, idx) => {
      const r = refSheet.addRow({
        name: s.name,
        hours: `${s.startTime} - ${s.endTime}`,
        grace: s.graceTime,
        break: s.breakDuration,
        weeklyOff: (s.weeklyOff || []).join(', ') || 'Sunday'
      });
      r.height = 20;
      r.alignment = { vertical: 'middle' };
      if (idx % 2 === 0) {
        r.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF0FDFA' }
        };
      }
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Bulk_Shift_Assignment_Template.xlsx"');

    await workbook.xlsx.write(res);
    res.end();
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const bulkAssignShiftSheet = async (req: Request, res: Response) => {
  try {
    const { assignments } = req.body;
    if (!Array.isArray(assignments) || assignments.length === 0) {
      return res.status(400).json(new ApiResponse(false, "No shift assignment rows provided"));
    }

    const tenantEmpFilter = await getManagerScopedEmployeeFilter((req as any).user);
    const tenantShiftFilter = await getTenantShiftFilter((req as any).user);

    // Fetch all shifts
    const allShifts = await prisma.shift.findMany({
      where: { ...tenantShiftFilter, status: true },
      select: { id: true, name: true }
    });

    const shiftMap = new Map<string, string>(); // lowercase name -> id
    allShifts.forEach(s => {
      shiftMap.set(s.name.trim().toLowerCase(), s.id);
      shiftMap.set(s.id.toLowerCase(), s.id);
    });

    // Fetch all relevant employees
    const allEmployees = await prisma.employee.findMany({
      where: { ...tenantEmpFilter, isDeleted: false },
      select: { id: true, employeeId: true, email: true, firstName: true, lastName: true }
    });

    const empByCode = new Map<string, any>();
    const empByEmail = new Map<string, any>();
    allEmployees.forEach(e => {
      if (e.employeeId) empByCode.set(e.employeeId.trim().toLowerCase(), e);
      if (e.email) empByEmail.set(e.email.trim().toLowerCase(), e);
    });

    let successCount = 0;
    const errors: any[] = [];
    const updatesByShift = new Map<string | null, string[]>(); // targetShiftId -> [empId, ...]

    for (let i = 0; i < assignments.length; i++) {
      const row = assignments[i];
      const identifier = String(row.employeeId || row.email || row.identifier || '').trim().toLowerCase();
      const rawShiftName = String(row.newShiftName || row.shiftName || row.targetShift || '').trim();

      if (!identifier) {
        errors.push({ row: i + 1, identifier: 'N/A', error: 'Missing employee ID or email' });
        continue;
      }

      const emp = empByCode.get(identifier) || empByEmail.get(identifier);
      if (!emp) {
        errors.push({ row: i + 1, identifier, error: `Employee not found or outside authorized scope` });
        continue;
      }

      if (!rawShiftName || rawShiftName.toUpperCase() === 'UNASSIGN' || rawShiftName.toUpperCase() === 'NONE' || rawShiftName.toUpperCase() === 'UNASSIGNED') {
        const list = updatesByShift.get(null) || [];
        list.push(emp.id);
        updatesByShift.set(null, list);
        successCount++;
        continue;
      }

      const resolvedShiftId = shiftMap.get(rawShiftName.toLowerCase());
      if (!resolvedShiftId) {
        errors.push({ row: i + 1, identifier: emp.employeeId, error: `Shift '${rawShiftName}' does not exist` });
        continue;
      }

      const list = updatesByShift.get(resolvedShiftId) || [];
      list.push(emp.id);
      updatesByShift.set(resolvedShiftId, list);
      successCount++;
    }

    // Execute bulk updates in database
    for (const [targetShiftId, empIds] of updatesByShift.entries()) {
      if (empIds.length > 0) {
        await prisma.employee.updateMany({
          where: { id: { in: empIds } },
          data: { shiftId: targetShiftId }
        });
      }
    }

    await invalidateCachePattern(`dashboard:*`);

    return res.status(200).json(new ApiResponse(true, `Successfully updated shifts for ${successCount} employees`, {
      successCount,
      failedCount: errors.length,
      errors,
      totalRows: assignments.length
    }));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};
