import { prisma } from '../../lib/prisma';
import { Request, Response } from 'express';

import { ApiResponse } from '../../utils/ApiResponse';
import bcrypt from 'bcryptjs';



// =======================
// USERS CRUD
// =======================
export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const { includeEmployees, roleId } = req.query;

    const filter: any = {};
    if (includeEmployees !== 'true') {
      // Exclude regular employee accounts from administrative Users directory
      filter.role = {
        name: { notIn: ['EMPLOYEE'] }
      };
    }

    if (roleId && roleId !== 'ALL') {
      filter.roleId = roleId;
    }

    const users = await prisma.user.findMany({
      where: filter,
      include: { role: true },
      orderBy: { createdAt: 'desc' }
    });
    // Remove password hashes
    const sanitized = users.map(({ passwordHash, ...rest }) => rest);
    return res.status(200).json(new ApiResponse(true, "Success", sanitized));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const getTenantEmployees = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    const rawRole = currentUser?.role?.name || currentUser?.role || '';
    const normalizedRole = typeof rawRole === 'string' ? rawRole.toUpperCase().trim().replace(/[\s\_]+/g, '_') : '';

    if (normalizedRole !== 'SUPER_ADMIN' && normalizedRole !== 'SUPER_ADMINISTRATOR') {
      return res.status(403).json(new ApiResponse(false, "Access Denied: Only Super Admin can access tenant workforce directory."));
    }

    const { tenant, search, department, status } = req.query;

    // Fetch all employees with full relations
    const employees = await prisma.employee.findMany({
      where: { isDeleted: false },
      include: {
        department: { select: { id: true, name: true } },
        designation: { select: { id: true, name: true } },
        manager: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
        user: { select: { profilePic: true, companyName: true, role: { select: { name: true } } } }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Fetch all HR Admin / Creator users to map tenant company details & roles
    const hrUsers = await prisma.user.findMany({
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        companyName: true,
        companyWebsite: true,
        companyAddress: true,
        companyPhone: true,
        role: { select: { name: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    const hrUserMap = new Map();
    hrUsers.forEach(u => hrUserMap.set(u.id, u));

    // Build lookup of companyName -> Primary HR Admin User for that company
    const companyAdminMap = new Map<string, any>();
    const usersByCompany = new Map<string, any[]>();
    
    hrUsers.forEach(u => {
      const comp = u.companyName || "Radical Minds Technologies Pvt. Ltd.";
      if (!usersByCompany.has(comp)) {
        usersByCompany.set(comp, []);
      }
      usersByCompany.get(comp)!.push(u);
    });

    for (const [compName, compUsers] of usersByCompany.entries()) {
      // Find Primary HR Admin/Manager User for this company
      let primaryAdmin = compUsers.find(u => {
        const rName = (u.role?.name || '').toUpperCase();
        return rName === 'HR_MANAGER' || rName === 'HR_ADMIN' || rName === 'TENANT_ADMIN' || rName === 'ADMIN' || rName.includes('HR');
      });

      if (!primaryAdmin) {
        primaryAdmin = compUsers.find(u => (u.role?.name || '').toUpperCase() !== 'EMPLOYEE');
      }

      if (!primaryAdmin) {
        primaryAdmin = compUsers[0];
      }

      if (primaryAdmin) {
        companyAdminMap.set(compName, primaryAdmin);
      }
    }

    // Map each employee with tenant company info & creator HR head
    const enrichedEmployees = employees.map(emp => {
      const creator = emp.createdById ? hrUserMap.get(emp.createdById) : null;
      const userRec = emp.userId ? hrUserMap.get(emp.userId) : null;

      const tenantCompany = creator?.companyName || userRec?.companyName || emp.user?.companyName || "Radical Minds Technologies Pvt. Ltd.";
      const tenantAdmin = companyAdminMap.get(tenantCompany) || (creator?.role?.name !== 'EMPLOYEE' ? creator : null) || (userRec?.role?.name !== 'EMPLOYEE' ? userRec : null);
      
      const tenantHead = tenantAdmin ? `${tenantAdmin.firstName} ${tenantAdmin.lastName}` : (creator ? `${creator.firstName} ${creator.lastName}` : "System Admin");
      const creatorRole = tenantAdmin?.role?.name || creator?.role?.name || "HR_MANAGER";

      return {
        ...emp,
        tenantCompany,
        tenantHead,
        creatorId: tenantAdmin?.id || creator?.id || null,
        creatorRole,
        creatorEmail: tenantAdmin?.email || creator?.email || null,
        creatorWebsite: tenantAdmin?.companyWebsite || creator?.companyWebsite || null,
        creatorAddress: tenantAdmin?.companyAddress || creator?.companyAddress || null,
        creatorPhone: tenantAdmin?.companyPhone || creator?.companyPhone || null
      };
    });

    // Apply filtering if provided
    let filtered = enrichedEmployees;
    if (tenant && tenant !== 'ALL') {
      filtered = filtered.filter(e => e.tenantCompany === tenant);
    }
    if (search) {
      const searchLower = (search as string).toLowerCase();
      filtered = filtered.filter(e =>
        `${e.firstName} ${e.lastName}`.toLowerCase().includes(searchLower) ||
        e.employeeId.toLowerCase().includes(searchLower) ||
        e.email.toLowerCase().includes(searchLower) ||
        e.tenantCompany.toLowerCase().includes(searchLower)
      );
    }
    if (department && department !== 'ALL') {
      filtered = filtered.filter(e => e.departmentId === department);
    }
    if (status && status !== 'ALL') {
      filtered = filtered.filter(e => e.status === status);
    }

    // Grouping by Tenant Company into Tree Hierarchy Structure
    const tenantTreeMap = new Map<string, {
      companyName: string;
      headName: string;
      headEmail: string;
      headRole: string;
      headId: string | null;
      count: number;
      activeCount: number;
      employees: typeof filtered;
    }>();

    enrichedEmployees.forEach(emp => {
      const comp = emp.tenantCompany;
      const tenantAdmin = companyAdminMap.get(comp);

      if (!tenantTreeMap.has(comp)) {
        tenantTreeMap.set(comp, {
          companyName: comp,
          headName: tenantAdmin ? `${tenantAdmin.firstName} ${tenantAdmin.lastName}` : emp.tenantHead,
          headEmail: tenantAdmin?.email || emp.creatorEmail || '',
          headRole: tenantAdmin?.role?.name || emp.creatorRole || 'HR Manager',
          headId: tenantAdmin?.id || emp.creatorId || null,
          count: 0,
          activeCount: 0,
          employees: []
        });
      }
      const group = tenantTreeMap.get(comp)!;
      group.count += 1;
      if (emp.status === 'ACTIVE') {
        group.activeCount += 1;
      }
    });

    // Populate filtered employees into their respective tree nodes
    filtered.forEach(emp => {
      const comp = emp.tenantCompany;
      if (tenantTreeMap.has(comp)) {
        tenantTreeMap.get(comp)!.employees.push(emp);
      }
    });

    const treeStructure = Array.from(tenantTreeMap.values());
    const tenantList = treeStructure.map(({ employees, ...summary }) => summary);

    return res.status(200).json(new ApiResponse(true, "Tenant workforce retrieved", {
      summary: {
        totalTenants: tenantList.length,
        totalEmployees: enrichedEmployees.length,
        activeEmployees: enrichedEmployees.filter(e => e.status === 'ACTIVE').length,
        avgPerTenant: tenantList.length > 0 ? Math.round(enrichedEmployees.length / tenantList.length) : 0
      },
      tenants: tenantList,
      tree: treeStructure,
      employees: filtered
    }));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const createUser = async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, email, password, roleId, companyName, companyWebsite, companyAddress, companyPhone } = req.body;
    
    if (!email || typeof email !== 'string') {
      return res.status(400).json(new ApiResponse(false, "Valid email is required."));
    }
    
    if (!password || typeof password !== 'string') {
      return res.status(400).json(new ApiResponse(false, "Password is required."));
    }

    if (!firstName || typeof firstName !== 'string') {
      return res.status(400).json(new ApiResponse(false, "First name is required."));
    }

    if (!lastName || typeof lastName !== 'string') {
      return res.status(400).json(new ApiResponse(false, "Last name is required."));
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json(new ApiResponse(false, "User already exists with this email."));
    }

    // Resolve target role ID (supports both Role UUID and Role Name)
    let targetRoleId: string | undefined = undefined;
    if (roleId && typeof roleId === 'string' && roleId.trim().length > 0) {
      let roleRecord = await prisma.role.findUnique({ where: { id: roleId } });
      if (!roleRecord) {
        roleRecord = await prisma.role.findUnique({ where: { name: roleId } });
      }
      if (!roleRecord) {
        roleRecord = await prisma.role.create({
          data: { name: roleId, description: `${roleId} Role` }
        });
      }
      targetRoleId = roleRecord.id;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        firstName,
        lastName,
        email,
        passwordHash,
        roleId: targetRoleId,
        companyName: companyName || undefined,
        companyWebsite: companyWebsite || undefined,
        companyAddress: companyAddress || undefined,
        companyPhone: companyPhone || undefined,
      },
      include: { role: true }
    });

    const { passwordHash: _, ...sanitized } = user;
    return res.status(201).json(new ApiResponse(true, "User created", sanitized));
  } catch (error: any) {
    console.error("Error creating user:", error);
    return res.status(500).json(new ApiResponse(false, error.message || "Internal server error"));
  }
};

export const updateUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, email, password, roleId, companyName, companyWebsite, companyAddress, companyPhone } = req.body;
    
    let targetRoleId: string | undefined = undefined;
    if (roleId && typeof roleId === 'string' && roleId.trim().length > 0) {
      let roleRecord = await prisma.role.findUnique({ where: { id: roleId } });
      if (!roleRecord) {
        roleRecord = await prisma.role.findUnique({ where: { name: roleId } });
      }
      if (!roleRecord) {
        roleRecord = await prisma.role.create({
          data: { name: roleId, description: `${roleId} Role` }
        });
      }
      targetRoleId = roleRecord.id;
    }

    const updateData: any = {
      firstName,
      lastName,
      email,
      roleId: targetRoleId,
      companyName,
      companyWebsite,
      companyAddress,
      companyPhone
    };

    if (password && typeof password === 'string' && password.trim().length > 0) {
      updateData.passwordHash = await bcrypt.hash(password, 10);
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      include: { role: true }
    });

    // Also sync to linked Employee record if present
    await prisma.employee.updateMany({
      where: { OR: [{ userId: id }, { email: user.email }] },
      data: {
        ...(firstName ? { firstName } : {}),
        ...(lastName ? { lastName } : {}),
        ...(email ? { email } : {}),
      }
    }).catch(() => {});

    const { passwordHash: _, ...sanitized } = user;
    return res.status(200).json(new ApiResponse(true, "User updated", sanitized));
  } catch (error: any) {
    console.error("Error updating user:", error);
    return res.status(500).json(new ApiResponse(false, error.message || "Internal server error"));
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.user.delete({ where: { id } });
    return res.status(200).json(new ApiResponse(true, "User deleted"));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

// =======================
// ROLES CRUD
// =======================
export const getAllRoles = async (req: Request, res: Response) => {
  try {
    const roles = await prisma.role.findMany({
      include: { permissions: { include: { permission: true } } },
      orderBy: { name: 'asc' }
    });
    return res.status(200).json(new ApiResponse(true, "Success", roles));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const createRole = async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;
    const role = await prisma.role.create({
      data: { name, description }
    });
    return res.status(201).json(new ApiResponse(true, "Role created", role));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const updateRole = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    const role = await prisma.role.update({
      where: { id },
      data: { name, description }
    });
    return res.status(200).json(new ApiResponse(true, "Role updated", role));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const deleteRole = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.role.delete({ where: { id } });
    return res.status(200).json(new ApiResponse(true, "Role deleted"));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

// =======================
// PERMISSIONS CRUD
// =======================
export const getAllPermissions = async (req: Request, res: Response) => {
  try {
    const permissions = await prisma.permission.findMany({
      orderBy: { module: 'asc' }
    });
    return res.status(200).json(new ApiResponse(true, "Success", permissions));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const createPermission = async (req: Request, res: Response) => {
  try {
    const { name, module, action } = req.body;
    const permission = await prisma.permission.create({
      data: { name, module, action }
    });
    return res.status(201).json(new ApiResponse(true, "Permission created", permission));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const updatePermission = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, module, action } = req.body;
    const permission = await prisma.permission.update({
      where: { id },
      data: { name, module, action }
    });
    return res.status(200).json(new ApiResponse(true, "Permission updated", permission));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const deletePermission = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.permission.delete({ where: { id } });
    return res.status(200).json(new ApiResponse(true, "Permission deleted"));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

// =======================
// SETTINGS CRUD
// =======================
export const getAllSettings = async (req: Request, res: Response) => {
  try {
    const settings = await prisma.systemSetting.findMany({
      orderBy: { group: 'asc' }
    });
    return res.status(200).json(new ApiResponse(true, "Success", settings));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const createSetting = async (req: Request, res: Response) => {
  try {
    const { key, value, group } = req.body;
    const setting = await prisma.systemSetting.create({
      data: { key, value, group }
    });
    return res.status(201).json(new ApiResponse(true, "Setting created", setting));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const updateSetting = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { value } = req.body;
    const setting = await prisma.systemSetting.update({
      where: { id },
      data: { value }
    });
    return res.status(200).json(new ApiResponse(true, "Setting updated", setting));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const deleteSetting = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.systemSetting.delete({ where: { id } });
    return res.status(200).json(new ApiResponse(true, "Setting deleted"));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

// =======================
// AUDIT LOGS
// =======================
export const getAllAuditLogs = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit
      }),
      prisma.auditLog.count()
    ]);

    const totalPages = Math.ceil(total / limit);

    const userIds = Array.from(new Set(logs.map(l => l.userId).filter(Boolean) as string[]));
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true, email: true }
    });
    
    const userMap: Record<string, any> = {};
    users.forEach(u => userMap[u.id] = u);

    const enrichedLogs = logs.map(l => ({
      ...l,
      user: l.userId ? userMap[l.userId] : null
    }));

    return res.status(200).json(new ApiResponse(true, "Success", {
      logs: enrichedLogs,
      pagination: { total, page, limit, totalPages }
    }));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

// =======================
// ROLE PAGE PERMISSIONS (REAL-TIME DB SYNC)
// =======================
export const getRolePagePermissionsApi = async (req: Request, res: Response) => {
  try {
    const settings = await prisma.systemSetting.findMany({
      where: { key: { startsWith: 'page_permissions_' } }
    });

    const permissionsMap: Record<string, string[]> = {};
    settings.forEach(s => {
      try {
        const roleKey = s.key.replace('page_permissions_', '');
        permissionsMap[roleKey] = JSON.parse(s.value);
      } catch (e) {}
    });

    return res.status(200).json(new ApiResponse(true, "Role page permissions fetched", permissionsMap));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const saveRolePagePermissionsApi = async (req: Request, res: Response) => {
  try {
    const { roleName, allowedHrefs } = req.body;
    if (!roleName || !Array.isArray(allowedHrefs)) {
      return res.status(400).json(new ApiResponse(false, "roleName and allowedHrefs array are required."));
    }

    const normalizedRole = roleName.toUpperCase().trim().replace(/[\s\_]+/g, '_');
    const key = `page_permissions_${normalizedRole}`;
    const value = JSON.stringify(allowedHrefs);

    await prisma.systemSetting.upsert({
      where: { key },
      update: { value, group: 'Permissions' },
      create: { key, value, group: 'Permissions' }
    });

    return res.status(200).json(new ApiResponse(true, `Permissions saved for ${normalizedRole}`, { key, allowedHrefs }));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};
