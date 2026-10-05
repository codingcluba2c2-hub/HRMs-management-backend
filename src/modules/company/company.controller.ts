import { prisma } from '../../lib/prisma';
import { Request, Response } from 'express';

import { ApiResponse } from '../../utils/ApiResponse';



export const getCompanyDetails = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const userEmail = (req as any).user?.email;
    if (!userId && !userEmail) {
      return res.status(401).json(new ApiResponse(false, "Unauthorized"));
    }

    let user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
    if (!user && userEmail) {
      user = await prisma.user.findFirst({
        where: { email: { equals: userEmail, mode: 'insensitive' } }
      });
    }

    const employee = await prisma.employee.findFirst({
      where: { OR: [{ userId: user?.id || userId }, { email: { equals: user?.email || userEmail, mode: 'insensitive' } }] }
    });

    let creator: any = null;
    if (employee && employee.createdById) {
      creator = await prisma.user.findUnique({ where: { id: employee.createdById } });
    }

    const companyName = creator?.companyName || user?.companyName || null;
    const companyWebsite = creator?.companyWebsite || user?.companyWebsite || null;
    const companyAddress = creator?.companyAddress || user?.companyAddress || null;
    const companyPhone = creator?.companyPhone || user?.companyPhone || null;

    return res.status(200).json(new ApiResponse(true, "Company details retrieved", {
      companyName,
      companyWebsite,
      companyAddress,
      companyPhone
    }));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const updateCompanyDetails = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const userEmail = (req as any).user?.email;
    const { companyName, companyWebsite, companyAddress, companyPhone } = req.body;

    let user = null;
    if (userId) {
      user = await prisma.user.findUnique({ where: { id: userId } });
    }
    if (!user && userEmail) {
      user = await prisma.user.findFirst({
        where: { email: { equals: userEmail, mode: 'insensitive' } }
      });
    }

    if (!user) {
      const emp = await prisma.employee.findFirst({
        where: { OR: [{ userId }, { email: { equals: userEmail, mode: 'insensitive' } }] }
      });
      if (emp?.createdById) {
        user = await prisma.user.findUnique({ where: { id: emp.createdById } });
      }
    }

    if (!user) {
      return res.status(404).json(new ApiResponse(false, "User record not found to update company details"));
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { companyName, companyWebsite, companyAddress, companyPhone }
    });

    // Cascade update company details to all employees created by this HR/Admin user
    const createdEmployees = await prisma.employee.findMany({
      where: { createdById: user.id, userId: { not: null } },
      select: { userId: true }
    });

    const createdUserIds = createdEmployees.map(e => e.userId!).filter(Boolean);
    if (createdUserIds.length > 0) {
      await prisma.user.updateMany({
        where: { id: { in: createdUserIds } },
        data: { companyName, companyWebsite, companyAddress, companyPhone }
      });
    }

    return res.status(200).json(new ApiResponse(true, "Company details updated", {
      companyName: updatedUser.companyName,
      companyWebsite: updatedUser.companyWebsite,
      companyAddress: updatedUser.companyAddress,
      companyPhone: updatedUser.companyPhone
    }));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};
