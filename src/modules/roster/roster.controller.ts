import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { ApiResponse } from '../../utils/ApiResponse';
import { AuthRequest } from '../../middlewares/authMiddleware';
import ExcelJS from 'exceljs';
import { emitRosterEvent } from '../../lib/socket';
import { invalidateCachePattern } from '../../lib/redis';
import { getTenantEmployeeFilter } from '../../utils/tenantFilter';
import { getOrCreateEmployeeForUser } from '../../utils/employeeUtils';

/**
 * Helper to normalize date to YYYY-MM-DD 00:00:00 UTC
 */
function normalizeDate(dateInput: string | Date): Date {
  if (typeof dateInput === 'string') {
    const cleanStr = dateInput.split('T')[0];
    const parts = cleanStr.split('-');
    if (parts.length === 3) {
      return new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, 0, 0));
    }
  }
  const d = new Date(dateInput);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
}

/**
 * Get Sunday and Saturday of given date strictly in UTC
 */
function getWeekRange(dateInput?: string): { weekStart: Date; weekEnd: Date; days: string[] } {
  let target: Date;
  if (dateInput) {
    const cleanStr = dateInput.split('T')[0];
    const parts = cleanStr.split('-');
    if (parts.length === 3) {
      target = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, 0, 0));
    } else {
      target = new Date(dateInput);
    }
  } else {
    const now = new Date();
    target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  }

  const dayOfWeek = target.getUTCDay(); // 0 is Sun, 1 is Mon, ..., 6 is Sat
  const distanceToSunday = -dayOfWeek;
  
  const sunday = new Date(target);
  sunday.setUTCDate(target.getUTCDate() + distanceToSunday);
  sunday.setUTCHours(0, 0, 0, 0);

  const saturday = new Date(sunday);
  saturday.setUTCDate(sunday.getUTCDate() + 6);
  saturday.setUTCHours(23, 59, 59, 999);

  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday);
    d.setUTCDate(sunday.getUTCDate() + i);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    days.push(`${yyyy}-${mm}-${dd}`);
  }

  return {
    weekStart: sunday,
    weekEnd: saturday,
    days
  };
}

/**
 * GET /api/roster
 * Fetch workforce roster for given department, designation, and week
 */
export const getRoster = async (req: AuthRequest, res: Response) => {
  try {
    const { departmentId, designationId, weekStart: weekStartParam } = req.query;

    const { weekStart, weekEnd, days } = getWeekRange(weekStartParam as string);

    // Fetch department details
    let department: any = null;
    if (departmentId && departmentId !== 'ALL') {
      department = await prisma.department.findUnique({
        where: { id: departmentId as string },
        select: { id: true, name: true, code: true }
      });
    }

    if (!department) {
      department = { id: 'ALL', name: 'All Departments', code: 'ALL' };
    }

    // Build designation filter
    let targetDesignationId: string | null = null;
    if (designationId && designationId !== 'ALL') {
      targetDesignationId = designationId as string;
    }

    // Fetch employees for this tenant
    const tenantFilter = getTenantEmployeeFilter(req.user);
    const employeeWhere: any = {
      status: 'ACTIVE',
      AND: [
        tenantFilter
      ]
    };

    if (departmentId && departmentId !== 'ALL') {
      employeeWhere.AND.push({
        OR: [
          { departmentId: departmentId as string },
          { departmentId: null }
        ]
      });
    }

    if (targetDesignationId) {
      employeeWhere.AND.push({ designationId: targetDesignationId });
    }

    const employees = await prisma.employee.findMany({
      where: employeeWhere,
      select: {
        id: true,
        employeeId: true,
        firstName: true,
        lastName: true,
        email: true,
        photo: true,
        shiftId: true,
        department: { select: { id: true, name: true } },
        designation: { select: { id: true, name: true } },
        shift: { select: { id: true, name: true, startTime: true, endTime: true, weeklyOff: true } }
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }]
    });

    // Fetch active shift templates
    const shifts = await prisma.shift.findMany({
      where: { status: true },
      orderBy: { name: 'asc' }
    });

    // Fetch holidays for the week
    const holidays = await prisma.holiday.findMany({
      where: {
        date: {
          gte: weekStart,
          lte: weekEnd
        }
      }
    });

    const holidayMap = new Map<string, any>();
    holidays.forEach(h => {
      const dateStr = h.date.toISOString().split('T')[0];
      holidayMap.set(dateStr, h);
    });

    // Fetch approved leave requests for employees in this week
    const employeeIds = employees.map(e => e.id);
    const leaveRequests = await prisma.leaveRequest.findMany({
      where: {
        employeeId: { in: employeeIds },
        status: 'APPROVED',
        startDate: { lte: weekEnd },
        endDate: { gte: weekStart }
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } }
      }
    });

    // Build leave lookup map: employeeId -> dateStr -> LeaveRequest
    const leaveMap = new Map<string, Map<string, any>>();
    leaveRequests.forEach(lr => {
      if (!leaveMap.has(lr.employeeId)) {
        leaveMap.set(lr.employeeId, new Map());
      }
      const empLeaves = leaveMap.get(lr.employeeId)!;

      const startStr = lr.startDate instanceof Date ? lr.startDate.toISOString().split('T')[0] : String(lr.startDate).split('T')[0];
      const endStr = lr.endDate instanceof Date ? lr.endDate.toISOString().split('T')[0] : String(lr.endDate).split('T')[0];

      const [sY, sM, sD] = startStr.split('-').map(Number);
      const [eY, eM, eD] = endStr.split('-').map(Number);

      let cur = new Date(Date.UTC(sY, sM - 1, sD));
      const end = new Date(Date.UTC(eY, eM - 1, eD));

      while (cur <= end) {
        const dateStr = cur.toISOString().split('T')[0];
        empLeaves.set(dateStr, lr);
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    });

    // Find existing WeeklyRoster
    const targetDepartmentId = (departmentId && departmentId !== 'ALL') ? (departmentId as string) : null;
    let roster = await prisma.weeklyRoster.findFirst({
      where: {
        departmentId: targetDepartmentId,
        designationId: targetDesignationId,
        weekStart: weekStart
      },
      include: {
        entries: {
          include: {
            shift: { select: { id: true, name: true, startTime: true, endTime: true } }
          }
        }
      }
    });

    // Map existing entries: employeeId -> dateStr -> entry
    const entryMap = new Map<string, Map<string, any>>();
    if (roster) {
      roster.entries.forEach(e => {
        if (!entryMap.has(e.employeeId)) {
          entryMap.set(e.employeeId, new Map());
        }
        const dateStr = e.date.toISOString().split('T')[0];
        entryMap.get(e.employeeId)!.set(dateStr, e);
      });
    }

    // Default general shift if available
    const defaultShift = shifts.find(s => s.name.toLowerCase().includes('general')) || shifts[0] || null;

    // Assemble grid data for each employee across 7 days
    const conflicts: Array<{
      employeeId: string;
      employeeName: string;
      date: string;
      type: string;
      message: string;
    }> = [];

    let scheduledCount = 0;
    let weekOffCount = 0;
    let leaveCount = 0;
    let unassignedCount = 0;

    const grid = employees.map(emp => {
      const empLeaves = leaveMap.get(emp.id);
      const empEntries = entryMap.get(emp.id);

      const daysData = days.map(dateStr => {
        const dayOfWeekName = new Date(dateStr + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
        const existingEntry = empEntries?.get(dateStr);
        const approvedLeave = empLeaves?.get(dateStr);
        const holiday = holidayMap.get(dateStr);

        let type = 'SHIFT';
        let shiftId = emp.shiftId || (defaultShift ? defaultShift.id : null);
        let shiftObj: any = emp.shift || defaultShift;
        let leaveType: string | null = null;
        let notes: string | null = null;
        let isOverridden = false;
        let overrideReason: string | null = null;

        if (approvedLeave && (!existingEntry || !existingEntry.isOverridden)) {
          type = 'LEAVE';
          leaveType = approvedLeave.leaveType || 'APPROVED_LEAVE';
          notes = approvedLeave.description || approvedLeave.reason || 'Approved Leave';
          shiftId = null;
          shiftObj = null;
          isOverridden = false;
        } else if (existingEntry) {
          type = existingEntry.type;
          shiftId = existingEntry.shiftId;
          shiftObj = existingEntry.shift || (shiftId ? shifts.find(s => s.id === shiftId) : null);
          leaveType = existingEntry.leaveType;
          notes = existingEntry.notes;
          isOverridden = existingEntry.isOverridden;
          overrideReason = existingEntry.overrideReason;
        } else if (holiday) {
          type = 'HOLIDAY';
          notes = holiday.name;
          shiftId = null;
          shiftObj = null;
        } else {
          // Check employee default weekly off
          const empWeeklyOffs = emp.shift?.weeklyOff || defaultShift?.weeklyOff || ['Saturday', 'Sunday'];
          if (empWeeklyOffs.includes(dayOfWeekName)) {
            type = 'WEEK_OFF';
            shiftId = null;
            shiftObj = null;
          }
        }

        // Detect Conflict: approved leave but assigned shift without override
        if (approvedLeave && type === 'SHIFT' && !isOverridden) {
          conflicts.push({
            employeeId: emp.id,
            employeeName: `${emp.firstName} ${emp.lastName}`,
            date: dateStr,
            type: 'LEAVE_CONFLICT',
            message: `Employee has approved ${approvedLeave.leaveType || 'LEAVE'} on ${dateStr}, but a shift is assigned.`
          });
        }

        // Detect Conflict: holiday but assigned shift without override
        if (holiday && type === 'SHIFT' && !isOverridden) {
          conflicts.push({
            employeeId: emp.id,
            employeeName: `${emp.firstName} ${emp.lastName}`,
            date: dateStr,
            type: 'HOLIDAY_CONFLICT',
            message: `Official holiday (${holiday.name}) on ${dateStr}, but a shift is assigned.`
          });
        }

        if (type === 'SHIFT' && shiftId) scheduledCount++;
        else if (type === 'WEEK_OFF') weekOffCount++;
        else if (type === 'LEAVE') leaveCount++;
        else if (type === 'SHIFT' && !shiftId) unassignedCount++;

        return {
          date: dateStr,
          dayName: dayOfWeekName,
          type,
          shiftId,
          shift: shiftObj,
          leaveType,
          holidayName: holiday?.name || null,
          notes,
          isOverridden,
          overrideReason,
          hasApprovedLeave: !!approvedLeave,
          approvedLeaveType: approvedLeave?.leaveType || null,
          isHoliday: !!holiday
        };
      });

      return {
        id: emp.id,
        employeeId: emp.employeeId,
        firstName: emp.firstName,
        lastName: emp.lastName,
        email: emp.email,
        photo: emp.photo,
        department: emp.department,
        designation: emp.designation,
        days: daysData
      };
    });

    const stats = {
      totalEmployees: employees.length,
      scheduled: scheduledCount,
      weekOff: weekOffCount,
      onLeave: leaveCount,
      unassigned: unassignedCount,
      conflicts: conflicts.length
    };

    return res.status(200).json(new ApiResponse(true, 'Roster fetched successfully', {
      roster: roster ? {
        id: roster.id,
        status: roster.status,
        version: roster.version,
        createdById: roster.createdById,
        publishedById: roster.publishedById,
        publishedAt: roster.publishedAt,
        updatedAt: roster.updatedAt
      } : {
        id: null,
        status: 'DRAFT',
        version: 1,
        publishedAt: null
      },
      department,
      weekStart: weekStart.toISOString().split('T')[0],
      weekEnd: weekEnd.toISOString().split('T')[0],
      days,
      grid,
      shifts,
      conflicts,
      stats
    }));

  } catch (error: any) {
    console.error('Error fetching roster:', error);
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

/**
 * POST /api/roster/save-draft
 * Save or update draft roster entries
 */
export const saveDraft = async (req: AuthRequest, res: Response) => {
  try {
    const { departmentId, designationId, weekStart: weekStartParam, entries } = req.body;

    if (!departmentId || !weekStartParam || !Array.isArray(entries)) {
      return res.status(400).json(new ApiResponse(false, 'departmentId, weekStart, and entries array are required'));
    }

    const { weekStart, weekEnd } = getWeekRange(weekStartParam);
    const targetDepartmentId = (departmentId && departmentId !== 'ALL') ? departmentId : null;
    const targetDesignationId = (designationId && designationId !== 'ALL') ? designationId : null;

    // Check if roster is LOCKED
    const existingRoster = await prisma.weeklyRoster.findFirst({
      where: {
        departmentId: targetDepartmentId,
        designationId: targetDesignationId,
        weekStart
      }
    });

    if (existingRoster?.status === 'LOCKED') {
      return res.status(403).json(new ApiResponse(false, 'This roster is LOCKED and cannot be edited. Ask an HR Admin to unlock.'));
    }

    // Upsert WeeklyRoster entity
    const roster = existingRoster ? await prisma.weeklyRoster.update({
      where: { id: existingRoster.id },
      data: {
        status: existingRoster.status === 'PUBLISHED' ? 'DRAFT' : existingRoster.status,
        updatedAt: new Date()
      }
    }) : await prisma.weeklyRoster.create({
      data: {
        departmentId: targetDepartmentId,
        designationId: targetDesignationId,
        weekStart,
        weekEnd,
        status: 'DRAFT',
        version: 1,
        createdById: req.user?.id
      }
    });

    // Pre-fetch existing entries for this roster in a single query
    const existingEntries = await prisma.rosterEntry.findMany({
      where: { rosterId: roster.id }
    });

    const existingMap = new Map<string, any>();
    existingEntries.forEach(e => {
      const key = `${e.employeeId}_${e.date.toISOString().split('T')[0]}`;
      existingMap.set(key, e);
    });

    const auditLogs: any[] = [];
    const upsertPromises: any[] = [];

    for (const entry of entries) {
      const entryDate = normalizeDate(entry.date);
      const dateStr = entryDate.toISOString().split('T')[0];
      const key = `${entry.employeeId}_${dateStr}`;
      const current = existingMap.get(key);

      if (current && (current.type !== entry.type || current.shiftId !== entry.shiftId)) {
        auditLogs.push({
          rosterId: roster.id,
          employeeId: entry.employeeId,
          date: entryDate,
          action: 'ENTRY_UPDATED',
          changedById: req.user?.id,
          oldValue: `${current.type}:${current.shiftId || 'none'}`,
          newValue: `${entry.type}:${entry.shiftId || 'none'}`
        });
      }

      upsertPromises.push(
        prisma.rosterEntry.upsert({
          where: {
            rosterId_employeeId_date: {
              rosterId: roster.id,
              employeeId: entry.employeeId,
              date: entryDate
            }
          },
          create: {
            rosterId: roster.id,
            employeeId: entry.employeeId,
            date: entryDate,
            type: entry.type || 'SHIFT',
            shiftId: entry.shiftId || null,
            leaveType: entry.leaveType || null,
            notes: entry.notes || null,
            isOverridden: !!entry.isOverridden,
            overrideReason: entry.overrideReason || null
          },
          update: {
            type: entry.type || 'SHIFT',
            shiftId: entry.shiftId || null,
            leaveType: entry.leaveType || null,
            notes: entry.notes || null,
            isOverridden: !!entry.isOverridden,
            overrideReason: entry.overrideReason || null,
            updatedAt: new Date()
          }
        })
      );
    }

    if (auditLogs.length > 0) {
      upsertPromises.push(prisma.rosterAuditLog.createMany({ data: auditLogs }));
    }

    if (upsertPromises.length > 0) {
      await prisma.$transaction(upsertPromises);
    }

    await invalidateCachePattern('dashboard:*');

    const uniqueEmpIds = Array.from(new Set(entries.map((e: any) => e.employeeId)));
    emitRosterEvent({
      eventType: 'ROSTER_UPDATED',
      departmentId,
      employeeIds: uniqueEmpIds as string[],
      rosterId: roster.id,
      weekStart: weekStart.toISOString().split('T')[0],
      title: 'Shift Schedule Updated',
      message: 'HR Manager updated your shift schedule draft in real time.',
      updatedBy: req.user?.id
    });

    return res.status(200).json(new ApiResponse(true, 'Roster draft saved successfully', { rosterId: roster.id }));
  } catch (error: any) {
    console.error('Error saving roster draft:', error);
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

/**
 * POST /api/roster/publish
 * Publish draft roster and increment version
 */
export const publishRoster = async (req: AuthRequest, res: Response) => {
  try {
    const { rosterId, departmentId, designationId, weekStart: weekStartParam } = req.body;

    let roster: any = null;
    if (rosterId) {
      roster = await prisma.weeklyRoster.findUnique({
        where: { id: rosterId },
        include: { entries: true, department: true }
      });
    } else if (departmentId && weekStartParam) {
      const { weekStart } = getWeekRange(weekStartParam);
      const targetDepartmentId = (departmentId && departmentId !== 'ALL') ? departmentId : null;
      const targetDesignationId = (designationId && designationId !== 'ALL') ? designationId : null;
      roster = await prisma.weeklyRoster.findFirst({
        where: {
          departmentId: targetDepartmentId,
          designationId: targetDesignationId,
          weekStart
        },
        include: { entries: true, department: true }
      });
    }

    if (!roster) {
      return res.status(404).json(new ApiResponse(false, 'No roster found to publish. Save draft first.'));
    }

    if (roster.status === 'LOCKED') {
      return res.status(403).json(new ApiResponse(false, 'Roster is LOCKED. Cannot publish.'));
    }

    const newVersion = roster.version + 1;
    const deptName = roster.department?.name || 'All Departments';

    // Transactional publish
    await prisma.$transaction(async (tx) => {
      // 1. Update roster status
      await tx.weeklyRoster.update({
        where: { id: roster.id },
        data: {
          status: 'PUBLISHED',
          version: newVersion,
          publishedById: req.user?.id,
          publishedAt: new Date()
        }
      });

      // 2. Create version snapshot
      await tx.rosterVersion.create({
        data: {
          rosterId: roster.id,
          version: newVersion,
          snapshot: roster.entries,
          publishedById: req.user?.id,
          changeSummary: `Published version v${newVersion} for ${deptName}`
        }
      });

      // 3. Create Audit Log
      await tx.rosterAuditLog.create({
        data: {
          rosterId: roster.id,
          action: 'ROSTER_PUBLISHED',
          changedById: req.user?.id,
          newValue: `Published Version v${newVersion}`
        }
      });

      // 4. Notify affected employees if notification queue system exists
      const affectedEmployeeIds = Array.from(new Set(roster.entries.map((e: any) => e.employeeId)));
      const usersToNotify = await tx.user.findMany({
        where: { employee: { id: { in: affectedEmployeeIds as string[] } } },
        select: { id: true }
      });

      if (usersToNotify.length > 0) {
        const notifications = usersToNotify.map(u => ({
          recipientId: u.id,
          title: 'Weekly Roster Published',
          message: `Your weekly shift roster for ${deptName} has been published. Check your schedule.`,
          type: 'IN_APP',
          referenceId: roster.id
        }));

        await tx.notificationQueue.createMany({ data: notifications }).catch(() => {});
      }
    }, { maxWait: 10000, timeout: 30000 });

    await invalidateCachePattern('dashboard:*');

    const affectedEmployeeIds = Array.from(new Set(roster.entries.map((e: any) => e.employeeId))) as string[];
    emitRosterEvent({
      eventType: 'ROSTER_PUBLISHED',
      departmentId: roster.departmentId,
      employeeIds: affectedEmployeeIds,
      rosterId: roster.id,
      weekStart: roster.weekStart.toISOString().split('T')[0],
      title: '⚡ Weekly Shift Roster Published!',
      message: `HR Manager published version v${newVersion} of your weekly roster for ${deptName}.`,
      updatedBy: req.user?.id,
      data: { version: newVersion }
    });

    return res.status(200).json(new ApiResponse(true, `Roster v${newVersion} published successfully! Notifications sent to team.`));
  } catch (error: any) {
    console.error('Error publishing roster:', error);
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

/**
 * POST /api/roster/copy-week
 * Copy previous week roster into current week as DRAFT
 */
export const copyWeek = async (req: AuthRequest, res: Response) => {
  try {
    const { departmentId, designationId, sourceWeekStart, targetWeekStart } = req.body;

    if (!departmentId || !sourceWeekStart || !targetWeekStart) {
      return res.status(400).json(new ApiResponse(false, 'departmentId, sourceWeekStart, and targetWeekStart are required'));
    }

    const sourceRange = getWeekRange(sourceWeekStart);
    const targetRange = getWeekRange(targetWeekStart);
    const targetDepartmentId = (departmentId && departmentId !== 'ALL') ? departmentId : null;
    const targetDesignationId = (designationId && designationId !== 'ALL') ? designationId : null;

    // Find source roster
    const sourceRoster = await prisma.weeklyRoster.findFirst({
      where: {
        departmentId: targetDepartmentId,
        designationId: targetDesignationId,
        weekStart: sourceRange.weekStart
      },
      include: { entries: true }
    });

    if (!sourceRoster || sourceRoster.entries.length === 0) {
      return res.status(404).json(new ApiResponse(false, 'No source roster found for the specified previous week.'));
    }

    // Upsert target WeeklyRoster
    let targetRoster = await prisma.weeklyRoster.findFirst({
      where: {
        departmentId: targetDepartmentId,
        designationId: targetDesignationId,
        weekStart: targetRange.weekStart
      }
    });

    if (targetRoster?.status === 'LOCKED') {
      return res.status(403).json(new ApiResponse(false, 'Target roster week is LOCKED and cannot be updated.'));
    }

    if (!targetRoster) {
      targetRoster = await prisma.weeklyRoster.create({
        data: {
          departmentId: targetDepartmentId,
          designationId: targetDesignationId,
          weekStart: targetRange.weekStart,
          weekEnd: targetRange.weekEnd,
          status: 'DRAFT',
          version: 1,
          createdById: req.user?.id
        }
      });
    }

    // Map source entries by day index (0=Sun, 1=Mon... 6=Sat)
    const copyPromises: any[] = [];

    for (const entry of sourceRoster.entries) {
      const sourceDate = new Date(entry.date);
      const dayOfWeek = sourceDate.getUTCDay(); // 0=Sun, 1=Mon... 6=Sat

      const targetDateStr = targetRange.days[dayOfWeek];
      if (!targetDateStr) continue;

      const targetDate = normalizeDate(targetDateStr);

      copyPromises.push(
        prisma.rosterEntry.upsert({
          where: {
            rosterId_employeeId_date: {
              rosterId: targetRoster.id,
              employeeId: entry.employeeId,
              date: targetDate
            }
          },
          create: {
            rosterId: targetRoster.id,
            employeeId: entry.employeeId,
            date: targetDate,
            type: entry.type,
            shiftId: entry.shiftId,
            leaveType: entry.leaveType,
            notes: entry.notes ? `[Copied] ${entry.notes}` : '[Copied from previous week]'
          },
          update: {
            type: entry.type,
            shiftId: entry.shiftId,
            leaveType: entry.leaveType,
            notes: entry.notes ? `[Copied] ${entry.notes}` : '[Copied from previous week]',
            updatedAt: new Date()
          }
        })
      );
    }

    copyPromises.push(
      prisma.rosterAuditLog.create({
        data: {
          rosterId: targetRoster.id,
          action: 'WEEK_COPIED',
          changedById: req.user?.id,
          oldValue: `Source week: ${sourceRange.weekStart.toISOString().split('T')[0]}`,
          newValue: `Target week: ${targetRange.weekStart.toISOString().split('T')[0]}`
        }
      })
    );

    if (copyPromises.length > 0) {
      await prisma.$transaction(copyPromises);
    }

    await invalidateCachePattern('dashboard:*');

    emitRosterEvent({
      eventType: 'ROSTER_COPIED',
      departmentId,
      title: 'Shift Schedule Copied',
      message: 'Previous week shift roster copied as draft by HR Manager.',
      updatedBy: req.user?.id
    });

    return res.status(200).json(new ApiResponse(true, 'Previous week schedule copied successfully as DRAFT'));
  } catch (error: any) {
    console.error('Error copying week roster:', error);
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

/**
 * GET /api/roster/history
 * Fetch list of saved/published roster history
 */
export const getRosterHistory = async (req: AuthRequest, res: Response) => {
  try {
    const { departmentId, designationId } = req.query;

    const where: any = {};
    if (departmentId && departmentId !== 'ALL') {
      where.departmentId = departmentId as string;
    }
    if (designationId && designationId !== 'ALL') {
      where.designationId = designationId as string;
    }

    const history = await prisma.weeklyRoster.findMany({
      where,
      include: {
        department: { select: { id: true, name: true, code: true } },
        designation: { select: { id: true, name: true } },
        _count: { select: { entries: true, historyVersions: true, auditLogs: true } }
      },
      orderBy: { weekStart: 'desc' },
      take: 50
    });

    return res.status(200).json(new ApiResponse(true, 'Roster history fetched successfully', history));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

/**
 * GET /api/roster/audit-logs/:rosterId
 * Fetch audit logs for a roster
 */
export const getAuditLogs = async (req: AuthRequest, res: Response) => {
  try {
    const { rosterId } = req.params;

    const logs = await prisma.rosterAuditLog.findMany({
      where: { rosterId },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeId: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    return res.status(200).json(new ApiResponse(true, 'Audit logs fetched successfully', logs));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

/**
 * POST /api/roster/export-xlsx
 * Generate and stream professional XLSX workbook for workforce roster
 */
export const exportXlsx = async (req: AuthRequest, res: Response) => {
  try {
    const { departmentId, designationId, weekStart: weekStartParam } = req.body;

    if (!departmentId || departmentId === 'ALL') {
      return res.status(400).json(new ApiResponse(false, 'Department selection is required for export'));
    }

    const { weekStart, weekEnd, days } = getWeekRange(weekStartParam);

    const department = await prisma.department.findUnique({
      where: { id: departmentId },
      select: { name: true, code: true }
    });

    let designationName = 'All Designations';
    if (designationId && designationId !== 'ALL') {
      const desig = await prisma.designation.findUnique({ where: { id: designationId } });
      if (desig) designationName = desig.name;
    }

    // Fetch employees & roster
    const tenantFilter = getTenantEmployeeFilter(req.user);
    const employeeWhere: any = {
      departmentId,
      status: 'ACTIVE',
      ...tenantFilter
    };
    if (designationId && designationId !== 'ALL') {
      employeeWhere.designationId = designationId;
    }

    const employees = await prisma.employee.findMany({
      where: employeeWhere,
      select: {
        id: true,
        employeeId: true,
        firstName: true,
        lastName: true,
        email: true,
        department: { select: { name: true } },
        designation: { select: { name: true } },
        shift: { select: { name: true, startTime: true, endTime: true, weeklyOff: true } }
      },
      orderBy: [{ firstName: 'asc' }]
    });

    const roster = await prisma.weeklyRoster.findFirst({
      where: {
        departmentId,
        designationId: (designationId && designationId !== 'ALL') ? designationId : null,
        weekStart
      },
      include: {
        entries: {
          include: { shift: { select: { name: true, startTime: true, endTime: true } } }
        }
      }
    });

    const entryMap = new Map<string, Map<string, any>>();
    if (roster) {
      roster.entries.forEach(e => {
        if (!entryMap.has(e.employeeId)) entryMap.set(e.employeeId, new Map());
        entryMap.get(e.employeeId)!.set(e.date.toISOString().split('T')[0], e);
      });
    }

    // Create Excel Workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'HRMS Enterprise Roster System';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Workforce Weekly Roster');

    // Title & Header Information
    sheet.mergeCells('A1:J1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'HRMS PRO — ENTERPRISE WORKFORCE WEEKLY ROSTER';
    titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

    sheet.mergeCells('A2:J2');
    const subTitleCell = sheet.getCell('A2');
    const startStr = weekStart.toISOString().split('T')[0];
    const endStr = weekEnd.toISOString().split('T')[0];
    subTitleCell.value = `Department: ${department?.name || 'All'} | Designation: ${designationName} | Week: ${startStr} to ${endStr} | Status: ${roster?.status || 'DRAFT'}`;
    subTitleCell.font = { name: 'Calibri', size: 11, italic: true, color: { argb: 'FF475569' } };
    subTitleCell.alignment = { horizontal: 'center', vertical: 'middle' };

    sheet.addRow([]); // Blank row

    // Table Headers
    const headers = [
      'Employee ID',
      'Employee Name',
      'Department',
      'Designation',
      ...days.map(d => {
        const dt = new Date(d + 'T00:00:00Z');
        const dayStr = dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }).toUpperCase();
        const dateStr = dt.toLocaleDateString('en-US', { day: '2-digit', month: 'short', timeZone: 'UTC' });
        return `${dayStr}\n${dateStr}`;
      })
    ];

    const headerRow = sheet.addRow(headers);
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'medium' },
        right: { style: 'thin' }
      };
    });

    // Populate Data Rows
    employees.forEach(emp => {
      const empEntries = entryMap.get(emp.id);

      const dayCells = days.map(dateStr => {
        const entry = empEntries?.get(dateStr);
        if (!entry) {
          const dt = new Date(dateStr + 'T00:00:00Z');
          const dayName = dt.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
          if (emp.shift?.weeklyOff?.includes(dayName)) {
            return 'OFF';
          }
          return emp.shift ? `${emp.shift.name}\n${emp.shift.startTime} - ${emp.shift.endTime}` : 'General Shift\n09:00 - 18:00';
        }

        if (entry.type === 'WEEK_OFF') return 'OFF';
        if (entry.type === 'LEAVE') return entry.leaveType || 'LEAVE';
        if (entry.type === 'HOLIDAY') return entry.notes ? `HOLIDAY\n${entry.notes}` : 'HOLIDAY';
        if (entry.type === 'WFH') return 'WORK FROM HOME';
        if (entry.type === 'HALF_DAY') return 'HALF DAY';

        if (entry.shift) {
          return `${entry.shift.name}\n${entry.shift.startTime} - ${entry.shift.endTime}`;
        }
        return 'General Shift\n09:00 - 18:00';
      });

      const row = sheet.addRow([
        emp.employeeId,
        `${emp.firstName} ${emp.lastName}`,
        emp.department?.name || '',
        emp.designation?.name || '',
        ...dayCells
      ]);

      row.height = 32;
      row.eachCell((cell, colIndex) => {
        cell.alignment = { vertical: 'middle', wrapText: true, horizontal: colIndex > 4 ? 'center' : 'left' };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };

        // Styling based on value
        const valStr = String(cell.value || '');
        if (valStr.includes('OFF')) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }; // Amber soft
          cell.font = { color: { argb: 'FFB45309' }, bold: true };
        } else if (valStr.includes('LEAVE')) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }; // Red soft
          cell.font = { color: { argb: 'FFB91C1C' }, bold: true };
        } else if (valStr.includes('HOLIDAY')) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } }; // Indigo soft
          cell.font = { color: { argb: 'FF4338CA' }, bold: true };
        } else if (valStr.includes('WORK FROM HOME')) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } }; // Emerald soft
          cell.font = { color: { argb: 'FF047857' }, bold: true };
        }
      });
    });

    // Auto-fit column widths
    sheet.columns.forEach((col, idx) => {
      if (idx === 0) col.width = 16; // Emp ID
      else if (idx === 1) col.width = 24; // Name
      else if (idx === 2) col.width = 20; // Dept
      else if (idx === 3) col.width = 20; // Designation
      else col.width = 18; // Days
    });

    const safeDept = (department?.name || 'Department').replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeDesig = designationName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `HRMS_Roster_${safeDept}_${safeDesig}_${startStr}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error: any) {
    console.error('Error exporting roster XLSX:', error);
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

/**
 * GET /api/roster/download-template
 * Download a blank Excel template for roster import
 */
export const downloadTemplate = async (req: AuthRequest, res: Response) => {
  try {
    const { departmentId, designationId } = req.query;

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Roster Import Template');

    sheet.mergeCells('A1:I1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'HRMS ROSTER IMPORT TEMPLATE — Fill Shift Name or OFF / LEAVE / WFH';
    titleCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };

    const headers = ['Employee ID', 'Employee Name', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const hRow = sheet.addRow(headers);
    hRow.eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
    });

    if (departmentId && departmentId !== 'ALL') {
      const tenantFilter = getTenantEmployeeFilter(req.user);
      const empWhere: any = { departmentId: departmentId as string, ...tenantFilter };
      if (designationId && designationId !== 'ALL') empWhere.designationId = designationId as string;

      const emps = await prisma.employee.findMany({
        where: empWhere,
        select: { employeeId: true, firstName: true, lastName: true },
        take: 50
      });

      emps.forEach(e => {
        sheet.addRow([e.employeeId, `${e.firstName} ${e.lastName}`, 'General Shift', 'General Shift', 'General Shift', 'General Shift', 'General Shift', 'OFF', 'OFF']);
      });
    } else {
      sheet.addRow(['EMP-7065', 'John Doe', 'General Shift', 'General Shift', 'General Shift', 'General Shift', 'Morning Shift', 'OFF', 'OFF']);
    }

    sheet.columns.forEach(c => c.width = 18);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="HRMS_Roster_Import_Template.xlsx"');

    await workbook.xlsx.write(res);
    res.end();
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

/**
 * POST /api/roster/import-xlsx
 * Import XLSX roster as DRAFT
 */
export const importXlsx = async (req: AuthRequest, res: Response) => {
  try {
    const { departmentId, designationId, weekStart: weekStartParam, fileData } = req.body;

    if (!departmentId || !weekStartParam || !fileData) {
      return res.status(400).json(new ApiResponse(false, 'departmentId, weekStart, and base64 fileData are required'));
    }

    const { weekStart, weekEnd, days } = getWeekRange(weekStartParam);
    const targetDepartmentId = (departmentId && departmentId !== 'ALL') ? departmentId : null;
    const targetDesignationId = (designationId && designationId !== 'ALL') ? designationId : null;

    // Read excel workbook from base64 buffer
    const buffer = Buffer.from(fileData.replace(/^data:.*?;base64,/, ''), 'base64');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const worksheet = workbook.getWorksheet(1);
    if (!worksheet) {
      return res.status(400).json(new ApiResponse(false, 'Worksheet is empty or invalid'));
    }

    // Find active shift templates for name matching
    const shifts = await prisma.shift.findMany({ where: { status: true } });
    const shiftMap = new Map<string, string>(); // name.toLowerCase() -> id
    shifts.forEach(s => shiftMap.set(s.name.toLowerCase().trim(), s.id));

    const defaultShift = shifts[0];

    // Read rows
    const importedEntries: any[] = [];
    const warnings: string[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber <= 3) return; // Skip title and header rows

      const empIdVal = String(row.getCell(1).value || '').trim();
      if (!empIdVal || empIdVal.toLowerCase().includes('employee')) return;

      for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
        const dateStr = days[dayIdx];
        const cellValue = String(row.getCell(dayIdx + 3).value || '').trim().toUpperCase();

        let type = 'SHIFT';
        let shiftId = defaultShift ? defaultShift.id : null;
        let leaveType: string | null = null;

        if (cellValue.includes('OFF')) {
          type = 'WEEK_OFF';
          shiftId = null;
        } else if (cellValue.includes('LEAVE') || cellValue.includes('SICK') || cellValue.includes('CASUAL')) {
          type = 'LEAVE';
          leaveType = cellValue;
          shiftId = null;
        } else if (cellValue.includes('WFH') || cellValue.includes('HOME')) {
          type = 'WFH';
        } else if (cellValue.includes('HALF')) {
          type = 'HALF_DAY';
        } else if (cellValue.includes('HOLIDAY')) {
          type = 'HOLIDAY';
        } else if (cellValue) {
          // Attempt matching shift name
          const matchedShiftId = shiftMap.get(cellValue.toLowerCase());
          if (matchedShiftId) {
            shiftId = matchedShiftId;
          } else {
            warnings.push(`Row ${rowNumber}: Unknown shift name "${cellValue}" for ${empIdVal}. Defaulted to General Shift.`);
          }
        }

        importedEntries.push({
          employeeIdCode: empIdVal,
          dateStr,
          type,
          shiftId,
          leaveType
        });
      }
    });

    // Map employeeIdCode to employee database record
    const empCodes = Array.from(new Set(importedEntries.map(e => e.employeeIdCode)));
    const dbEmployees = await prisma.employee.findMany({
      where: { employeeId: { in: empCodes } },
      select: { id: true, employeeId: true }
    });

    const empCodeToId = new Map<string, string>();
    dbEmployees.forEach(e => empCodeToId.set(e.employeeId, e.id));

    // Upsert WeeklyRoster as DRAFT
    let roster = await prisma.weeklyRoster.findFirst({
      where: {
        departmentId: targetDepartmentId,
        designationId: targetDesignationId,
        weekStart
      }
    });

    if (roster?.status === 'LOCKED') {
      return res.status(403).json(new ApiResponse(false, 'Target roster week is LOCKED. Cannot import.'));
    }

    if (!roster) {
      roster = await prisma.weeklyRoster.create({
        data: {
          departmentId: targetDepartmentId,
          designationId: targetDesignationId,
          weekStart,
          weekEnd,
          status: 'DRAFT',
          version: 1,
          createdById: req.user?.id
        }
      });
    }

    let successCount = 0;
    const importPromises: any[] = [];

    for (const ie of importedEntries) {
      const empDbId = empCodeToId.get(ie.employeeIdCode);
      if (!empDbId) continue;

      const entryDate = normalizeDate(ie.dateStr);

      importPromises.push(
        prisma.rosterEntry.upsert({
          where: {
            rosterId_employeeId_date: {
              rosterId: roster.id,
              employeeId: empDbId,
              date: entryDate
            }
          },
          create: {
            rosterId: roster.id,
            employeeId: empDbId,
            date: entryDate,
            type: ie.type,
            shiftId: ie.shiftId,
            leaveType: ie.leaveType,
            notes: '[Imported from Excel]'
          },
          update: {
            type: ie.type,
            shiftId: ie.shiftId,
            leaveType: ie.leaveType,
            notes: '[Imported from Excel]',
            updatedAt: new Date()
          }
        })
      );
      successCount++;
    }

    importPromises.push(
      prisma.rosterAuditLog.create({
        data: {
          rosterId: roster.id,
          action: 'ROSTER_IMPORTED',
          changedById: req.user?.id,
          newValue: `Imported ${successCount} entries from Excel file`
        }
      })
    );

    if (importPromises.length > 0) {
      await prisma.$transaction(importPromises);
    }

    return res.status(200).json(new ApiResponse(true, `Successfully imported ${successCount} roster entries as DRAFT.`, {
      importedCount: successCount,
      warnings
    }));
  } catch (error: any) {
    console.error('Error importing XLSX roster:', error);
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

/**
 * GET /api/roster/my-schedule
 * Get published shift schedule for logged-in employee (or query employeeId)
 */
export const getEmployeeSchedule = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { date: dateParam } = req.query;

    if (!userId) {
      return res.status(401).json(new ApiResponse(false, 'Unauthorized'));
    }
    const employee = await getOrCreateEmployeeForUser(userId);

    if (!employee) {
      return res.status(404).json(new ApiResponse(false, 'Employee profile not found for user'));
    }

    const targetDate = normalizeDate((dateParam as string) || new Date().toISOString().split('T')[0]);
    const dateStr = targetDate.toISOString().split('T')[0];

    // Check if a published roster entry exists for this employee and date
    const rosterEntry = await prisma.rosterEntry.findFirst({
      where: {
        employeeId: employee.id,
        date: targetDate,
        roster: {
          status: 'PUBLISHED'
        }
      },
      include: {
        shift: { select: { name: true, startTime: true, endTime: true, weeklyOff: true, graceTime: true, breakDuration: true } }
      }
    });

    if (rosterEntry) {
      return res.status(200).json(new ApiResponse(true, 'Employee schedule fetched', {
        date: dateStr,
        source: 'ROSTER',
        type: rosterEntry.type,
        shift: rosterEntry.shift || employee.shift,
        leaveType: rosterEntry.leaveType,
        notes: rosterEntry.notes
      }));
    }

    // Fallback to employee assigned shift profile
    const dayOfWeek = targetDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    const isWeekOff = employee.shift?.weeklyOff?.includes(dayOfWeek) || false;

    return res.status(200).json(new ApiResponse(true, 'Employee schedule fetched', {
      date: dateStr,
      source: 'DEFAULT_SHIFT',
      type: isWeekOff ? 'WEEK_OFF' : 'SHIFT',
      shift: employee.shift,
      leaveType: null,
      notes: null
    }));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};
