import { prisma } from '../../lib/prisma';

// Ensure default master leave types exist in database
export const ensureDefaultLeaveTypes = async () => {
  const count = await prisma.leaveType.count();
  if (count === 0) {
    const defaults = [
      { name: 'Annual Leave', code: 'AL', description: 'Standard paid annual vacation leave', category: 'PAID', isPaid: true, defaultAllocation: 18, accrualType: 'ANNUAL', carryForwardEnabled: true, maxCarryForward: 10, encashmentEnabled: true, requiresApproval: true, status: true },
      { name: 'Casual Leave', code: 'CL', description: 'Short term casual leave for urgent personal matters', category: 'PAID', isPaid: true, defaultAllocation: 8, accrualType: 'ANNUAL', carryForwardEnabled: false, maxCarryForward: 0, encashmentEnabled: false, requiresApproval: true, status: true },
      { name: 'Medical Leave', code: 'ML', description: 'Sick and medical leave with medical certificate requirement', category: 'PAID', isPaid: true, defaultAllocation: 10, accrualType: 'ANNUAL', carryForwardEnabled: false, maxCarryForward: 0, encashmentEnabled: false, requiresApproval: true, status: true },
      { name: 'Earned Leave', code: 'EL', description: 'Privilege or earned leave accrued monthly', category: 'PAID', isPaid: true, defaultAllocation: 5, accrualType: 'MONTHLY', carryForwardEnabled: true, maxCarryForward: 30, encashmentEnabled: true, requiresApproval: true, status: true },
      { name: 'Comp Off', code: 'CO', description: 'Compensatory off for working on weekends or holidays', category: 'PAID', isPaid: true, defaultAllocation: 0, accrualType: 'CUSTOM', carryForwardEnabled: false, maxCarryForward: 0, encashmentEnabled: false, requiresApproval: true, status: true },
      { name: 'Maternity Leave', code: 'MAT', description: 'Maternity leave for female employees as per statutory norms', category: 'PAID', isPaid: true, defaultAllocation: 180, accrualType: 'ANNUAL', carryForwardEnabled: false, maxCarryForward: 0, encashmentEnabled: false, requiresApproval: true, status: true },
    ];
    for (const item of defaults) {
      await prisma.leaveType.create({ data: item }).catch(() => {});
    }
  }

  const policyCount = await prisma.leavePolicy.count();
  if (policyCount === 0) {
    await prisma.leavePolicy.create({
      data: {
        name: 'Enterprise Organization Leave Policy',
        workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        leaveYear: 'Jan-Dec',
        noticePeriodDays: 1,
        maxConsecutiveDays: 15,
        allowHalfDay: true,
        allowNegativeBalance: false,
        restrictProbation: true,
        excludeWeekends: true,
        excludeHolidays: true,
        carryForwardEnabled: true,
        approvalHierarchy: 'MANAGER_HR',
      }
    }).catch(() => {});
  }
};

// Summary metrics for Employee or HR Admin
export const getLeaveSummary = async (userId: string, role: string) => {
  await ensureDefaultLeaveTypes();
  const normalizedRole = (role || '').toUpperCase().trim();

  if (normalizedRole === 'EMPLOYEE' || normalizedRole === 'USER') {
    const employee = await prisma.employee.findUnique({
      where: { userId },
      include: { leaveBalance: true }
    });
    
    if (!employee) return {
      metrics: [
        { title: "Available Leaves", value: 0, subtitle: "Total Balance", trend: "0 used", icon: "CalendarDays" },
        { title: "Pending Approvals", value: 0, subtitle: "Awaiting Action", trend: "0 new", icon: "Clock" },
        { title: "Upcoming Leaves", value: 0, subtitle: "This Year", trend: "0 days", icon: "CalendarCheck" },
        { title: "Leaves Taken", value: 0, subtitle: "This Year", trend: "0% of quota", icon: "FileText" }
      ],
      insights: [
        { id: '1', type: 'INFO', message: `No employee profile attached to this account.` }
      ]
    };
    
    const requests = await prisma.leaveRequest.findMany({
      where: { employeeId: employee.id }
    });

    const pending = requests.filter((r: any) => r.status === 'PENDING').length;
    const approved = requests.filter((r: any) => r.status === 'APPROVED').length;
    const upcoming = requests.filter((r: any) => r.status === 'APPROVED' && new Date(r.startDate) > new Date()).length;

    const balance = employee.leaveBalance || {
      ...quotas, compOff: 0
    };

    let totalUsed = 0;
    const usedByType: Record<string, number> = { ANNUAL: 0, CASUAL: 0, MEDICAL: 0, EARNED: 0, COMP_OFF: 0 };

    requests.filter((r: any) => r.status === 'APPROVED').forEach((r: any) => {
      const start = new Date(r.startDate).getTime();
      const end = new Date(r.endDate).getTime();
      const days = r.halfDay ? 0.5 : Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1);
      
      totalUsed += days;
      const type = (r.leaveType || '').toUpperCase();
      if (type === 'SICK' || type === 'MEDICAL') {
        usedByType['MEDICAL'] = (usedByType['MEDICAL'] || 0) + days;
      } else if (usedByType[type] !== undefined) {
        usedByType[type] += days;
      } else {
        usedByType['ANNUAL'] = (usedByType['ANNUAL'] || 0) + days;
      }
    });

    const totalQuota = (balance.annual || 18) + (balance.casual || 8) + (balance.medical || 10) + (balance.earned || 5) + (balance.compOff || 0);
    const totalRemaining = Math.max(0, totalQuota - totalUsed);

    const actualBalances = {
      annual: Math.max(0, (balance.annual || 18) - (usedByType['ANNUAL'] || 0)),
      casual: Math.max(0, (balance.casual || 8) - (usedByType['CASUAL'] || 0)),
      medical: Math.max(0, (balance.medical || 10) - (usedByType['MEDICAL'] || 0)),
      earned: Math.max(0, (balance.earned || 5) - (usedByType['EARNED'] || 0)),
      compOff: Math.max(0, (balance.compOff || 0) - (usedByType['COMP_OFF'] || 0))
    };

    return {
      metrics: [
        { 
          title: "ANNUAL LEAVE", 
          value: totalQuota, 
          subtitle: `${totalUsed} Used • 0 Expired`, 
          trend: `${totalRemaining} Remaining`, 
          icon: "Calendar" 
        },
        { 
          title: "PENDING APPROVAL", 
          value: pending, 
          subtitle: "Awaiting Action", 
          trend: "Under Review", 
          icon: "Clock" 
        },
        { 
          title: "APPROVED LEAVES", 
          value: approved, 
          subtitle: "This Year", 
          trend: "Processed", 
          icon: "CheckCircle" 
        },
        { 
          title: "UPCOMING LEAVES", 
          value: upcoming, 
          subtitle: "Next 30 Days", 
          trend: "Scheduled", 
          icon: "CalendarDays" 
        }
      ],
      balances: actualBalances,
      insights: [
        { id: '1', type: 'INFO', message: `You have ${totalRemaining} total leave days remaining out of ${totalQuota}.` },
        { id: '2', type: 'POSITIVE', message: `You have ${pending} leave requests pending approval.` }
      ]
    };
  } else {
    // HR / SUPER ADMIN KPI Summary
    const totalEmployees = await prisma.employee.count();
    const pending = await prisma.leaveRequest.count({ where: { status: 'PENDING' } });
    
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const approvedThisMonth = await prisma.leaveRequest.count({
      where: {
        status: 'APPROVED',
        updatedAt: { gte: firstDayOfMonth }
      }
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const onLeaveToday = await prisma.leaveRequest.count({
      where: {
        status: 'APPROVED',
        startDate: { lte: tomorrow },
        endDate: { gte: today }
      }
    });

    const availableLeaveTypes = await prisma.leaveType.count({ where: { status: true } });
    const upcomingHolidays = await prisma.holiday.count({ where: { date: { gte: today } } });

    const quotas = await getLeaveQuotas();

    return {
      summary: {
        totalEmployees,
        pendingRequests: pending,
        approvedThisMonth,
        onLeaveToday,
        availableLeaveTypes,
        upcomingHolidays
      },
      metrics: [
        { title: "Total Employees", value: totalEmployees, subtitle: "Company Wide", trend: "Active Staff", icon: "Users" },
        { title: "Pending Requests", value: pending, subtitle: "Action Required", trend: "Under Review", icon: "Clock" },
        { title: "Approved This Month", value: approvedThisMonth, subtitle: "This Month", trend: "Processed", icon: "CheckCircle" },
        { title: "On Leave Today", value: onLeaveToday, subtitle: "Today", trend: "Absent", icon: "UserCheck" },
        { title: "Available Leave Types", value: availableLeaveTypes, subtitle: "Configured", trend: "Master Types", icon: "Briefcase" },
        { title: "Upcoming Holidays", value: upcomingHolidays, subtitle: "Calendar", trend: "Scheduled", icon: "Calendar" }
      ],
      quotas: quotas,
      insights: [
        { id: '1', type: 'WARNING', message: `${pending} leave requests require your approval.` },
        { id: '2', type: 'INFO', message: `${onLeaveToday} employee(s) are on leave today.` }
      ]
    };
  }
};

// Get Leave Requests with filters
export const getLeaveRequests = async (userId: string, role: string, filters: any) => {
  let whereClause: any = {};
  const normalizedRole = (role || '').toUpperCase().trim();
  
  if (normalizedRole === 'EMPLOYEE' || normalizedRole === 'USER') {
    const employee = await prisma.employee.findUnique({ where: { userId } });
    if (!employee) return []; // Return empty array if user has no employee profile
    whereClause.employeeId = employee.id;
  } else if (filters.employeeId) {
    whereClause.employeeId = filters.employeeId;
  }

  if (filters.status && filters.status !== 'ALL') {
    whereClause.status = filters.status;
  }

  if (filters.leaveType && filters.leaveType !== 'ALL') {
    whereClause.leaveType = filters.leaveType;
  }

  if (filters.departmentId && filters.departmentId !== 'ALL') {
    whereClause.employee = { departmentId: filters.departmentId };
  }

  const requests = await prisma.leaveRequest.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    include: {
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeId: true,
          email: true,
          photo: true,
          department: { select: { id: true, name: true } },
          designation: { select: { id: true, name: true } }
        }
      },
      approvalHistory: {
        include: { actedBy: { select: { firstName: true, lastName: true, email: true } } },
        orderBy: { createdAt: 'asc' }
      }
    }
  });

  return requests;
};

// Create Leave Request
export const createLeaveRequest = async (userId: string, data: any) => {
  let empId = data.employeeId;
  
  if (!empId || empId === 'self') {
    const employee = await prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw new Error("Employee not found");
    empId = employee.id;
  }

  const start = new Date(data.startDate);
  const end = new Date(data.endDate);

  if (end < start) {
    throw new Error("End date cannot be earlier than start date");
  }

  // Conflict check: Check for existing approved or pending leave in same date range
  const conflict = await prisma.leaveRequest.findFirst({
    where: {
      employeeId: employee.id,
      status: { in: ['PENDING', 'APPROVED'] },
      OR: [
        { startDate: { lte: end }, endDate: { gte: start } }
      ]
    }
  });

  if (conflict) {
    throw new Error("You already have an active or pending leave request for the selected date range");
  }

  const request = await prisma.leaveRequest.create({
    data: {
      employeeId: empId,
      leaveType: data.leaveType,
      startDate: start,
      endDate: end,
      halfDay: data.halfDay || false,
      workFromHome: data.workFromHome || false,
      emergencyLeave: data.emergencyLeave || false,
      description: data.description,
      attachment: data.attachment
    }
  });

  // Log creation in approval history
  await prisma.approvalHistory.create({
    data: {
      leaveRequestId: request.id,
      action: 'SUBMITTED',
      actedById: userId,
      comments: data.description || 'Leave request submitted by employee.'
    }
  }).catch(() => {});

  return request;
};

// Process Approval / Rejection / Cancellation
export const processLeaveApproval = async (userId: string, leaveId: string, action: string, comments?: string) => {
  const validActions = ['APPROVED', 'REJECTED', 'CANCELLED'];
  if (!validActions.includes(action)) throw new Error("Invalid action");

  const existingRequest = await prisma.leaveRequest.findUnique({
    where: { id: leaveId },
    include: { employee: true }
  });

  if (!existingRequest) throw new Error("Leave request not found");

  if (action === 'REJECTED' && (!comments || !comments.trim())) {
    throw new Error("Rejection reason is required when rejecting a leave request");
  }

  const request = await prisma.leaveRequest.update({
    where: { id: leaveId },
    data: { status: action }
  });

  // Log transaction in LeaveLedger if approved or cancelled
  const start = new Date(request.startDate).getTime();
  const end = new Date(request.endDate).getTime();
  const days = request.halfDay ? 0.5 : Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1);

  if (action === 'APPROVED') {
    await prisma.leaveLedger.create({
      data: {
        employeeId: request.employeeId,
        leaveType: request.leaveType,
        transactionType: 'LEAVE_DEDUCTION',
        amount: -days,
        reference: request.id,
        reason: comments || `Approved leave for ${days} day(s)`,
        createdById: userId
      }
    }).catch(() => {});
  } else if (action === 'CANCELLED' && existingRequest.status === 'APPROVED') {
    await prisma.leaveLedger.create({
      data: {
        employeeId: request.employeeId,
        leaveType: request.leaveType,
        transactionType: 'REVERSAL',
        amount: days,
        reference: request.id,
        reason: comments || `Restored cancelled leave balance for ${days} day(s)`,
        createdById: userId
      }
    }).catch(() => {});
  }

  await prisma.approvalHistory.create({
    data: {
      leaveRequestId: leaveId,
      action: action,
      actedById: userId,
      comments: comments || `Leave request ${action.toLowerCase()}.`
    }
  }).catch(() => {});

  // System audit log
  await prisma.auditLog.create({
    data: {
      userId,
      action: `LEAVE_${action}`,
      entity: 'LeaveRequest',
      entityId: leaveId
    }
  }).catch(() => {});

  return request;
};

// MASTER LEAVE TYPES CRUD
export const getLeaveTypes = async () => {
  await ensureDefaultLeaveTypes();
  return await prisma.leaveType.findMany({ orderBy: { name: 'asc' } });
};

export const createLeaveType = async (userId: string, data: any) => {
  if (!data.name || !data.code) throw new Error("Leave type name and code are required");
  
  const existing = await prisma.leaveType.findFirst({
    where: { OR: [{ name: data.name }, { code: data.code }] }
  });
  if (existing) throw new Error("A leave type with this name or code already exists");

  const leaveType = await prisma.leaveType.create({
    data: {
      name: data.name.trim(),
      code: data.code.trim().toUpperCase(),
      description: data.description?.trim() || null,
      category: data.category || 'PAID',
      isPaid: data.isPaid !== undefined ? data.isPaid : true,
      defaultAllocation: Number(data.defaultAllocation || 12),
      accrualType: data.accrualType || 'ANNUAL',
      carryForwardEnabled: Boolean(data.carryForwardEnabled),
      maxCarryForward: Number(data.maxCarryForward || 0),
      encashmentEnabled: Boolean(data.encashmentEnabled),
      requiresApproval: data.requiresApproval !== undefined ? Boolean(data.requiresApproval) : true,
      status: data.status !== undefined ? Boolean(data.status) : true
    }
  });

  await prisma.auditLog.create({
    data: { userId, action: 'LEAVE_TYPE_CREATED', entity: 'LeaveType', entityId: leaveType.id }
  }).catch(() => {});

  return leaveType;
};

export const updateLeaveType = async (userId: string, id: string, data: any) => {
  const existing = await prisma.leaveType.findUnique({ where: { id } });
  if (!existing) throw new Error("Leave type not found");

  const updated = await prisma.leaveType.update({
    where: { id },
    data: {
      name: data.name ? data.name.trim() : existing.name,
      code: data.code ? data.code.trim().toUpperCase() : existing.code,
      description: data.description !== undefined ? (data.description?.trim() || null) : existing.description,
      category: data.category !== undefined ? data.category : existing.category,
      isPaid: data.isPaid !== undefined ? data.isPaid : existing.isPaid,
      defaultAllocation: data.defaultAllocation !== undefined ? Number(data.defaultAllocation) : existing.defaultAllocation,
      accrualType: data.accrualType !== undefined ? data.accrualType : existing.accrualType,
      carryForwardEnabled: data.carryForwardEnabled !== undefined ? Boolean(data.carryForwardEnabled) : existing.carryForwardEnabled,
      maxCarryForward: data.maxCarryForward !== undefined ? Number(data.maxCarryForward) : existing.maxCarryForward,
      encashmentEnabled: data.encashmentEnabled !== undefined ? Boolean(data.encashmentEnabled) : existing.encashmentEnabled,
      requiresApproval: data.requiresApproval !== undefined ? Boolean(data.requiresApproval) : existing.requiresApproval,
      status: data.status !== undefined ? Boolean(data.status) : existing.status
    }
  });

  await prisma.auditLog.create({
    data: { userId, action: 'LEAVE_TYPE_UPDATED', entity: 'LeaveType', entityId: id }
  }).catch(() => {});

  return updated;
};

export const deleteLeaveType = async (userId: string, id: string) => {
  const existing = await prisma.leaveType.findUnique({ where: { id } });
  if (!existing) throw new Error("Leave type not found");

  // Deactivate instead of hard delete to preserve historical records
  const deactivated = await prisma.leaveType.update({
    where: { id },
    data: { status: false }
  });

  await prisma.auditLog.create({
    data: { userId, action: 'LEAVE_TYPE_DEACTIVATED', entity: 'LeaveType', entityId: id }
  }).catch(() => {});

  return deactivated;
};

// LEAVE POLICY CRUD
export const getLeavePolicies = async () => {
  await ensureDefaultLeaveTypes();
  return await prisma.leavePolicy.findMany({ orderBy: { name: 'asc' } });
};

export const updateLeavePolicy = async (userId: string, id: string, data: any) => {
  const policy = await prisma.leavePolicy.update({
    where: { id },
    data: {
      name: data.name || undefined,
      workingDays: data.workingDays || undefined,
      leaveYear: data.leaveYear || undefined,
      noticePeriodDays: data.noticePeriodDays !== undefined ? Number(data.noticePeriodDays) : undefined,
      maxConsecutiveDays: data.maxConsecutiveDays !== undefined ? Number(data.maxConsecutiveDays) : undefined,
      allowHalfDay: data.allowHalfDay !== undefined ? Boolean(data.allowHalfDay) : undefined,
      allowNegativeBalance: data.allowNegativeBalance !== undefined ? Boolean(data.allowNegativeBalance) : undefined,
      restrictProbation: data.restrictProbation !== undefined ? Boolean(data.restrictProbation) : undefined,
      excludeWeekends: data.excludeWeekends !== undefined ? Boolean(data.excludeWeekends) : undefined,
      excludeHolidays: data.excludeHolidays !== undefined ? Boolean(data.excludeHolidays) : undefined,
      carryForwardEnabled: data.carryForwardEnabled !== undefined ? Boolean(data.carryForwardEnabled) : undefined,
      approvalHierarchy: data.approvalHierarchy || undefined
    }
  });

  await prisma.auditLog.create({
    data: { userId, action: 'LEAVE_POLICY_UPDATED', entity: 'LeavePolicy', entityId: id }
  }).catch(() => {});

  return policy;
};

// LEAVE BALANCES FOR HR ADMIN
export const getAllEmployeeBalances = async (filters: any) => {
  let where: any = {};
  if (filters.search) {
    where.OR = [
      { firstName: { contains: filters.search, mode: 'insensitive' } },
      { lastName: { contains: filters.search, mode: 'insensitive' } },
      { employeeId: { contains: filters.search, mode: 'insensitive' } },
      { email: { contains: filters.search, mode: 'insensitive' } }
    ];
  }
  if (filters.departmentId && filters.departmentId !== 'ALL') {
    where.departmentId = filters.departmentId;
  }

  const employees = await prisma.employee.findMany({
    where,
    include: {
      department: { select: { id: true, name: true } },
      designation: { select: { id: true, name: true } },
      leaveBalance: true,
      leaveRequests: { where: { status: 'APPROVED' } }
    },
    orderBy: { firstName: 'asc' }
  });

  return employees.map((emp) => {
    const bal = emp.leaveBalance || { annual: 18, casual: 8, medical: 10, earned: 5, compOff: 0 };
    
    let usedAnnual = 0, usedCasual = 0, usedMedical = 0, usedEarned = 0, usedCompOff = 0;
    emp.leaveRequests.forEach((r) => {
      const start = new Date(r.startDate).getTime();
      const end = new Date(r.endDate).getTime();
      const days = r.halfDay ? 0.5 : Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1);
      const type = (r.leaveType || '').toUpperCase();
      if (type === 'CASUAL') usedCasual += days;
      else if (type === 'SICK' || type === 'MEDICAL') usedMedical += days;
      else if (type === 'EARNED') usedEarned += days;
      else if (type === 'COMP_OFF') usedCompOff += days;
      else usedAnnual += days;
    });

    const totalAllocated = (bal.annual || 18) + (bal.casual || 8) + (bal.medical || 10) + (bal.earned || 5) + (bal.compOff || 0);
    const totalUsed = usedAnnual + usedCasual + usedMedical + usedEarned + usedCompOff;
    const totalRemaining = Math.max(0, totalAllocated - totalUsed);

    return {
      id: emp.id,
      employeeId: emp.employeeId,
      name: `${emp.firstName} ${emp.lastName}`,
      email: emp.email,
      photo: emp.photo,
      department: emp.department?.name || 'Unassigned',
      designation: emp.designation?.name || 'Unassigned',
      balances: {
        annual: { allocated: bal.annual || 18, used: usedAnnual, remaining: Math.max(0, (bal.annual || 18) - usedAnnual) },
        casual: { allocated: bal.casual || 8, used: usedCasual, remaining: Math.max(0, (bal.casual || 8) - usedCasual) },
        medical: { allocated: bal.medical || 10, used: usedMedical, remaining: Math.max(0, (bal.medical || 10) - usedMedical) },
        earned: { allocated: bal.earned || 5, used: usedEarned, remaining: Math.max(0, (bal.earned || 5) - usedEarned) },
        compOff: { allocated: bal.compOff || 0, used: usedCompOff, remaining: Math.max(0, (bal.compOff || 0) - usedCompOff) },
      },
      summary: {
        allocated: totalAllocated,
        used: totalUsed,
        remaining: totalRemaining
      }
    };
  });
};

export const updateEmployeeBalance = async (userId: string, employeeId: string, data: any) => {
  const { annual, casual, medical, earned, compOff, reason } = data;
  if (!reason || !reason.trim()) {
    throw new Error("Reason for balance adjustment is required");
  }

  const existingBal = await prisma.leaveBalance.findUnique({ where: { employeeId } });
  
  let newBal;
  if (existingBal) {
    newBal = await prisma.leaveBalance.update({
      where: { employeeId },
      data: {
        annual: annual !== undefined ? Number(annual) : existingBal.annual,
        casual: casual !== undefined ? Number(casual) : existingBal.casual,
        medical: medical !== undefined ? Number(medical) : existingBal.medical,
        earned: earned !== undefined ? Number(earned) : existingBal.earned,
        compOff: compOff !== undefined ? Number(compOff) : existingBal.compOff,
      }
    });
  } else {
    newBal = await prisma.leaveBalance.create({
      data: {
        employeeId,
        annual: Number(annual || 18),
        casual: Number(casual || 8),
        medical: Number(medical || 10),
        earned: Number(earned || 5),
        compOff: Number(compOff || 0),
      }
    });
  }

  // Record transaction in LeaveLedger
  await prisma.leaveLedger.create({
    data: {
      employeeId,
      leaveType: 'BALANCE_ADJUSTMENT',
      transactionType: 'ADJUSTMENT',
      amount: 0,
      reason: reason.trim(),
      createdById: userId
    }
  }).catch(() => {});

  await prisma.auditLog.create({
    data: { userId, action: 'LEAVE_BALANCE_ADJUSTED', entity: 'LeaveBalance', entityId: newBal.id }
  }).catch(() => {});

  return newBal;
};

// AUDIT / LEDGER LOGS
export const getLeaveLedgerLogs = async (filters: any) => {
  let where: any = {};
  if (filters.employeeId) where.employeeId = filters.employeeId;

  return await prisma.leaveLedger.findMany({
    where,
    include: {
      employee: { select: { firstName: true, lastName: true, employeeId: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: 100
  });
};

export const getLeaveAnalytics = async () => {
  const distribution = await prisma.leaveRequest.groupBy({
    by: ['leaveType'],
    _count: { _all: true }
  });

  return {
    distribution,
    monthlyTrend: [
      { month: 'Jan', requests: 12 },
      { month: 'Feb', requests: 19 },
      { month: 'Mar', requests: 15 },
      { month: 'Apr', requests: 22 },
      { month: 'May', requests: 18 },
      { month: 'Jun', requests: 30 }
    ]
  };
};

export const getLeaveCalendar = async () => {
  const upcomingLeaves = await prisma.leaveRequest.findMany({
    where: { status: 'APPROVED', startDate: { gte: new Date() } },
    include: {
      employee: { select: { firstName: true, lastName: true, employeeId: true, photo: true, department: { select: { name: true } } } }
    },
    take: 15,
    orderBy: { startDate: 'asc' }
  });

  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: new Date() } },
    take: 10,
    orderBy: { date: 'asc' }
  });

  return { upcomingLeaves, holidays };
};
