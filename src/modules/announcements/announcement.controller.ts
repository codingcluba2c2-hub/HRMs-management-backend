import { Response } from 'express';
import { AuthRequest } from '../../middlewares/authMiddleware';
import { ApiResponse } from '../../utils/ApiResponse';
import { prisma } from '../../lib/prisma';

// Get Announcements (Filtered by Company Tenant)
export const getAnnouncements = async (req: AuthRequest, res: Response) => {
  try {
    const rawRole = req.user?.role || '';
    const userRole = typeof rawRole === 'string' ? rawRole.toUpperCase().trim().replace(/\s+/g, '_') : '';
    const userId = req.user?.id;

    let hrAdminId = userId;

    // If Employee, find their HR Admin (createdById)
    if (userRole === 'EMPLOYEE' && userId) {
      const emp = await prisma.employee.findFirst({
        where: { userId },
        select: { createdById: true }
      });
      if (emp?.createdById) {
        hrAdminId = emp.createdById;
      }
    }

    // Fetch active announcements
    const announcements = await prisma.announcement.findMany({
      where: {
        isActive: true,
        ...(hrAdminId ? {
          OR: [
            { authorId: hrAdminId },
            ...(userId ? [{ authorId: userId }] : [])
          ]
        } : {})
      },
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

    return res.status(200).json(new ApiResponse(true, 'Announcements fetched', announcements));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message || 'Failed to fetch announcements'));
  }
};

// Create Announcement (HR Admin / Super Admin ONLY)
export const createAnnouncement = async (req: AuthRequest, res: Response) => {
  try {
    const rawRole = req.user?.role || '';
    const userRole = typeof rawRole === 'string' ? rawRole.toUpperCase().trim().replace(/\s+/g, '_') : '';
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json(new ApiResponse(false, 'Unauthorized user session'));
    }

    const isHRAdmin = ['HR_ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'].includes(userRole);
    if (!isHRAdmin) {
      return res.status(403).json(new ApiResponse(false, 'Only HR Admins can post company announcements'));
    }

    const { title, content, type, target } = req.body;

    if (!title || !content) {
      return res.status(400).json(new ApiResponse(false, 'Title and content are required'));
    }

    const announcement = await prisma.announcement.create({
      data: {
        title,
        content,
        type: type || 'INFO',
        target: target || 'ALL',
        authorId: userId,
        isActive: true
      },
      include: {
        author: {
          select: {
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    return res.status(201).json(new ApiResponse(true, 'Announcement published successfully', announcement));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message || 'Failed to create announcement'));
  }
};

// Delete Announcement (HR Admin / Super Admin ONLY)
export const deleteAnnouncement = async (req: AuthRequest, res: Response) => {
  try {
    const rawRole = req.user?.role || '';
    const userRole = typeof rawRole === 'string' ? rawRole.toUpperCase().trim().replace(/\s+/g, '_') : '';

    const isHRAdmin = ['HR_ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'].includes(userRole);
    if (!isHRAdmin) {
      return res.status(403).json(new ApiResponse(false, 'Only HR Admins can delete announcements'));
    }

    const { id } = req.params;

    await prisma.announcement.delete({
      where: { id }
    });

    return res.status(200).json(new ApiResponse(true, 'Announcement deleted successfully'));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message || 'Failed to delete announcement'));
  }
};
