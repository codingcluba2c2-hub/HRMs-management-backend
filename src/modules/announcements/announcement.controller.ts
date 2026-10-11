import { Response } from 'express';
import { AuthRequest } from '../../middlewares/authMiddleware';
import { ApiResponse } from '../../utils/ApiResponse';
import { prisma } from '../../lib/prisma';
import { normalizeRole, CANONICAL_ROLES } from '../../utils/roleConstants';
import { memoryCacheMap } from '../../lib/redis';

export const invalidateAnnouncementCache = () => {
  try {
    if (memoryCacheMap) {
      for (const key of memoryCacheMap.keys()) {
        if (key.startsWith('dashboard:')) {
          memoryCacheMap.delete(key);
        }
      }
    }
  } catch (e) {}
};

// Helper to resolve company tenant context securely
export const resolveUserCompanyContext = async (user: any) => {
  const userId = user?.id || (user as any)?.userId;
  const rawRole = typeof user?.role === 'string' ? user.role : (user?.role as any)?.name || '';
  const userRole = normalizeRole(rawRole);

  let hrAdminId = userId;
  let companyId = user?.companyId;
  let companyName = user?.companyName;

  // If not Super Admin, find employee record and assigned company/creator
  if (userRole !== CANONICAL_ROLES.SUPER_ADMIN && (userId || user?.email)) {
    const emp = await prisma.employee.findFirst({
      where: {
        OR: [
          ...(userId ? [{ userId }] : []),
          ...(user?.email ? [{ email: { equals: user.email, mode: 'insensitive' as const } }] : [])
        ]
      },
      include: {
        user: { select: { companyId: true, companyName: true } },
        company: { select: { id: true, name: true } }
      }
    });

    if (emp) {
      if (emp.companyId) companyId = emp.companyId;
      if (emp.company?.name && !companyName) companyName = emp.company.name;
      if (emp.user?.companyId && !companyId) companyId = emp.user.companyId;
      if (emp.user?.companyName && !companyName) companyName = emp.user.companyName;
      if (emp.createdById) hrAdminId = emp.createdById;
    }
  }

  // Inspect User record for company details
  if (userId) {
    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true, companyName: true }
    });
    if (dbUser) {
      if (dbUser.companyId && !companyId) companyId = dbUser.companyId;
      if (dbUser.companyName && !companyName) companyName = dbUser.companyName;
    }
  }

  // If creator HR Admin ID is known and we still don't have company details, inspect the creator user record
  if (hrAdminId && hrAdminId !== userId && (!companyId || !companyName)) {
    const hrUser = await prisma.user.findUnique({
      where: { id: hrAdminId },
      select: { companyId: true, companyName: true }
    });
    if (hrUser) {
      if (hrUser.companyId && !companyId) companyId = hrUser.companyId;
      if (hrUser.companyName && !companyName) companyName = hrUser.companyName;
    }
  }

  // Ensure Company record is linked if companyName is present
  if (!companyId && companyName && companyName.trim()) {
    try {
      let company = await prisma.company.findFirst({
        where: { name: { equals: companyName.trim(), mode: 'insensitive' as const } }
      });
      if (!company) {
        company = await prisma.company.create({
          data: { name: companyName.trim() }
        });
      }
      companyId = company.id;

      // Persist companyId to User if missing
      if (userId) {
        await prisma.user.update({
          where: { id: userId },
          data: { companyId }
        }).catch(() => {});
      }
    } catch (e) {
      // Ignore unique constraint race conditions
    }
  }

  return { userId, userRole, hrAdminId, companyId, companyName };
};

// GET /api/announcements - Get Announcements with strict company isolation & expiration handling
export const getAnnouncements = async (req: AuthRequest, res: Response) => {
  try {
    const { userId, userRole, hrAdminId, companyId, companyName } = await resolveUserCompanyContext(req.user);
    const isHRAdmin = userRole === CANONICAL_ROLES.HR_ADMIN || userRole === CANONICAL_ROLES.SUPER_ADMIN;
    const isManager = userRole === CANONICAL_ROLES.MANAGER;
    const statusQuery = (req.query.status as string)?.toLowerCase();

    // Build strict multi-tenant company conditions
    const companyConditions: any[] = [];
    if (companyId) {
      companyConditions.push({ companyId });
    }
    if (hrAdminId) {
      companyConditions.push({ authorId: hrAdminId });
    }
    if (companyName && companyName.trim()) {
      companyConditions.push({
        author: {
          companyName: { equals: companyName.trim(), mode: 'insensitive' as const }
        }
      });
    }

    // Fallback condition if none resolved (never match other tenants)
    const tenantFilter: any = userRole === CANONICAL_ROLES.SUPER_ADMIN
      ? {}
      : companyConditions.length > 0
        ? { OR: companyConditions }
        : { authorId: userId || 'NO_USER' };

    const now = new Date();

    if (isHRAdmin) {
      // HR Admin view: Can filter active, expired, or see all
      const where: any = {
        AND: [
          tenantFilter
        ]
      };

      if (statusQuery === 'active') {
        where.AND.push({
          isActive: true,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } }
          ]
        });
      } else if (statusQuery === 'expired') {
        where.AND.push({
          OR: [
            { isActive: false },
            { expiresAt: { lte: now } }
          ]
        });
      }

      const announcements = await prisma.announcement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          author: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              companyName: true
            }
          }
        }
      });

      return res.status(200).json(new ApiResponse(true, 'Announcements fetched successfully', announcements));
    }

    // Employee / Manager / Regular Staff view:
    // MUST be strictly within their company, MUST be active, MUST NOT be expired, and matching target audience
    const allowedTargets = isManager
      ? ['ALL', 'ALL_STAFF', 'MANAGER', 'MANAGERS', 'EMPLOYEE', 'EMPLOYEES', 'STAFF']
      : ['ALL', 'ALL_STAFF', 'EMPLOYEE', 'EMPLOYEES', 'STAFF'];

    const where: any = {
      AND: [
        tenantFilter,
        { isActive: true },
        { target: { in: allowedTargets } },
        {
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } }
          ]
        }
      ]
    };

    const announcements = await prisma.announcement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        author: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            companyName: true
          }
        }
      }
    });

    return res.status(200).json(new ApiResponse(true, 'Announcements fetched successfully', announcements));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message || 'Failed to fetch announcements'));
  }
};

// POST /api/announcements - Create Announcement (HR Admin / Super Admin ONLY)
export const createAnnouncement = async (req: AuthRequest, res: Response) => {
  try {
    const { userId, userRole, companyId, companyName } = await resolveUserCompanyContext(req.user);

    if (!userId) {
      return res.status(401).json(new ApiResponse(false, 'Unauthorized user session'));
    }

    const isHRAdmin = userRole === CANONICAL_ROLES.HR_ADMIN || userRole === CANONICAL_ROLES.SUPER_ADMIN;
    if (!isHRAdmin) {
      return res.status(403).json(new ApiResponse(false, 'Only HR Admins can post company announcements'));
    }

    const { title, content, type, target, expiresAt } = req.body;

    if (!title || !title.trim() || !content || !content.trim()) {
      return res.status(400).json(new ApiResponse(false, 'Title and content are required'));
    }

    let parsedExpiresAt: Date | null = null;
    if (expiresAt) {
      const exp = new Date(expiresAt);
      if (!isNaN(exp.getTime())) {
        parsedExpiresAt = exp;
      }
    }

    const announcement = await prisma.announcement.create({
      data: {
        title: title.trim(),
        content: content.trim(),
        type: type || 'INFO',
        target: target || 'ALL',
        authorId: userId,
        companyId: companyId || null,
        isActive: true,
        expiresAt: parsedExpiresAt
      },
      include: {
        author: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            companyName: true
          }
        }
      }
    });

    invalidateAnnouncementCache();

    return res.status(201).json(new ApiResponse(true, 'Announcement published successfully', announcement));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message || 'Failed to create announcement'));
  }
};

// PATCH /api/announcements/:id/expire - Manually expire or toggle announcement (HR Admin ONLY)
export const expireAnnouncement = async (req: AuthRequest, res: Response) => {
  try {
    const { userId, userRole, companyId, companyName } = await resolveUserCompanyContext(req.user);
    const isHRAdmin = userRole === CANONICAL_ROLES.HR_ADMIN || userRole === CANONICAL_ROLES.SUPER_ADMIN;
    if (!isHRAdmin) {
      return res.status(403).json(new ApiResponse(false, 'Only HR Admins can expire announcements'));
    }

    const { id } = req.params;
    const { action } = req.body; // 'expire' or 'reactivate' or undefined (defaults to expire)

    const existing = await prisma.announcement.findUnique({
      where: { id },
      include: { author: true }
    });

    if (!existing) {
      return res.status(404).json(new ApiResponse(false, 'Announcement not found'));
    }

    // Verify company isolation ownership
    if (userRole !== 'SUPER_ADMIN') {
      const isOwner =
        existing.authorId === userId ||
        (companyId && existing.companyId === companyId) ||
        (companyName && existing.author.companyName?.toLowerCase() === companyName.toLowerCase());

      if (!isOwner) {
        return res.status(403).json(new ApiResponse(false, 'Unauthorized: Cannot expire announcement of another company'));
      }
    }

    const shouldReactivate = action === 'reactivate';

    const updated = await prisma.announcement.update({
      where: { id },
      data: {
        isActive: shouldReactivate ? true : false,
        expiresAt: shouldReactivate ? null : (existing.expiresAt || new Date())
      },
      include: {
        author: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            companyName: true
          }
        }
      }
    });

    invalidateAnnouncementCache();

    return res.status(200).json(new ApiResponse(
      true, 
      shouldReactivate ? 'Announcement reactivated successfully' : 'Announcement marked as expired',
      updated
    ));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message || 'Failed to update announcement expiry'));
  }
};

// PUT /api/announcements/:id - Edit announcement details or expiry date (HR Admin ONLY)
export const updateAnnouncement = async (req: AuthRequest, res: Response) => {
  try {
    const { userId, userRole, companyId, companyName } = await resolveUserCompanyContext(req.user);
    const isHRAdmin = userRole === CANONICAL_ROLES.HR_ADMIN || userRole === CANONICAL_ROLES.SUPER_ADMIN;
    if (!isHRAdmin) {
      return res.status(403).json(new ApiResponse(false, 'Only HR Admins can edit announcements'));
    }

    const { id } = req.params;
    const { title, content, type, target, expiresAt, isActive } = req.body;

    const existing = await prisma.announcement.findUnique({
      where: { id },
      include: { author: true }
    });

    if (!existing) {
      return res.status(404).json(new ApiResponse(false, 'Announcement not found'));
    }

    if (userRole !== CANONICAL_ROLES.SUPER_ADMIN) {
      const isOwner =
        existing.authorId === userId ||
        (companyId && existing.companyId === companyId) ||
        (companyName && existing.author.companyName?.toLowerCase() === companyName.toLowerCase());

      if (!isOwner) {
        return res.status(403).json(new ApiResponse(false, 'Unauthorized: Cannot edit announcement of another company'));
      }
    }

    let parsedExpiresAt = existing.expiresAt;
    if (expiresAt !== undefined) {
      if (expiresAt === null || expiresAt === '') {
        parsedExpiresAt = null;
      } else {
        const exp = new Date(expiresAt);
        if (!isNaN(exp.getTime())) {
          parsedExpiresAt = exp;
        }
      }
    }

    const updated = await prisma.announcement.update({
      where: { id },
      data: {
        ...(title !== undefined ? { title: title.trim() } : {}),
        ...(content !== undefined ? { content: content.trim() } : {}),
        ...(type !== undefined ? { type } : {}),
        ...(target !== undefined ? { target } : {}),
        ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
        expiresAt: parsedExpiresAt
      },
      include: {
        author: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            companyName: true
          }
        }
      }
    });

    invalidateAnnouncementCache();

    return res.status(200).json(new ApiResponse(true, 'Announcement updated successfully', updated));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message || 'Failed to update announcement'));
  }
};

// DELETE /api/announcements/:id - Delete Announcement (HR Admin / Super Admin ONLY)
export const deleteAnnouncement = async (req: AuthRequest, res: Response) => {
  try {
    const { userId, userRole, companyId, companyName } = await resolveUserCompanyContext(req.user);
    const isHRAdmin = userRole === CANONICAL_ROLES.HR_ADMIN || userRole === CANONICAL_ROLES.SUPER_ADMIN;
    if (!isHRAdmin) {
      return res.status(403).json(new ApiResponse(false, 'Only HR Admins can delete announcements'));
    }

    const { id } = req.params;

    const existing = await prisma.announcement.findUnique({
      where: { id },
      include: { author: true }
    });

    if (!existing) {
      return res.status(404).json(new ApiResponse(false, 'Announcement not found'));
    }

    if (userRole !== CANONICAL_ROLES.SUPER_ADMIN) {
      const isOwner =
        existing.authorId === userId ||
        (companyId && existing.companyId === companyId) ||
        (companyName && existing.author.companyName?.toLowerCase() === companyName.toLowerCase());

      if (!isOwner) {
        return res.status(403).json(new ApiResponse(false, 'Unauthorized: Cannot delete announcement of another company'));
      }
    }

    await prisma.announcement.delete({
      where: { id }
    });

    invalidateAnnouncementCache();

    return res.status(200).json(new ApiResponse(true, 'Announcement deleted successfully'));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message || 'Failed to delete announcement'));
  }
};
