import { prisma } from '../../lib/prisma';
import { Request, Response } from 'express';

import { ApiResponse } from '../../utils/ApiResponse';
import bcrypt from 'bcryptjs';



// =======================
// USERS CRUD
// =======================
export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
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

export const createUser = async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, email, password, roleId, companyName, companyWebsite, companyAddress, companyPhone } = req.body;
    
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json(new ApiResponse(false, "User already exists with this email."));
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        firstName,
        lastName,
        email,
        passwordHash,
        roleId,
        companyName,
        companyWebsite,
        companyAddress,
        companyPhone
      },
      include: { role: true }
    });

    const { passwordHash: _, ...sanitized } = user;
    return res.status(201).json(new ApiResponse(true, "User created", sanitized));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const updateUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, email, roleId, companyName, companyWebsite, companyAddress, companyPhone } = req.body;
    
    const user = await prisma.user.update({
      where: { id },
      data: { firstName, lastName, email, roleId, companyName, companyWebsite, companyAddress, companyPhone },
      include: { role: true }
    });

    const { passwordHash: _, ...sanitized } = user;
    return res.status(200).json(new ApiResponse(true, "User updated", sanitized));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
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
