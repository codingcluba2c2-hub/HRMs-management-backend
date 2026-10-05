import { prisma } from '../../lib/prisma';
import { Request, Response } from 'express';
import { ApiResponse } from '../../utils/ApiResponse';
import { invalidateCachePattern } from '../../lib/redis';
import { getTenantShiftFilter, getTenantEmployeeFilter } from '../../utils/tenantFilter';

export const getAll = async (req: Request, res: Response) => {
  try {
    const tenantShiftFilter = await getTenantShiftFilter((req as any).user);
    const tenantEmpFilter = getTenantEmployeeFilter((req as any).user);

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
    const tenantEmpFilter = getTenantEmployeeFilter((req as any).user);

    const where: any = { 
      ...tenantEmpFilter
    };

    if (departmentId && departmentId !== 'ALL') {
      where.departmentId = departmentId as string;
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

    const tenantEmpFilter = getTenantEmployeeFilter((req as any).user);

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
