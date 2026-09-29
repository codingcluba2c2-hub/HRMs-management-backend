import { prisma } from '../../lib/prisma';
import { Request, Response } from 'express';

import { ApiResponse } from '../../utils/ApiResponse';



export const getCompanyDetails = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json(new ApiResponse(false, "Unauthorized"));
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const employee = await prisma.employee.findFirst({
      where: { OR: [{ userId }, { email: { equals: user?.email, mode: 'insensitive' } }] }
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
    const userId = (req as any).user.id;
    const { companyName, companyWebsite, companyAddress, companyPhone } = req.body;

    const user = await prisma.user.update({
      where: { id: userId },
      data: { companyName, companyWebsite, companyAddress, companyPhone }
    });

    // Cascade update company details to all employees created by this HR/Admin user
    const createdEmployees = await prisma.employee.findMany({
      where: { createdById: userId, userId: { not: null } },
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
      companyName: user.companyName,
      companyWebsite: user.companyWebsite,
      companyAddress: user.companyAddress,
      companyPhone: user.companyPhone
    }));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};
