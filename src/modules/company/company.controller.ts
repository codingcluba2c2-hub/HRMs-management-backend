import { prisma } from '../../lib/prisma';
import { Request, Response } from 'express';

import { ApiResponse } from '../../utils/ApiResponse';



export const getCompanyDetails = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const roleName = (req as any).user.role; // user.role is a string in this payload

    let companyName: string | null = null;
    let companyWebsite: string | null = null;
    let companyAddress: string | null = null;
    let companyPhone: string | null = null;

    const upperRoleName = typeof roleName === 'string' ? roleName.toUpperCase() : '';

    if (upperRoleName === 'HR_ADMIN' || upperRoleName === 'HR ADMIN' || upperRoleName === 'SUPER_ADMIN' || upperRoleName === 'SUPER ADMIN') {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      companyName = user?.companyName || null;
      companyWebsite = user?.companyWebsite || null;
      companyAddress = user?.companyAddress || null;
      companyPhone = user?.companyPhone || null;
    } else if (upperRoleName === 'EMPLOYEE') {
      const employee = await prisma.employee.findUnique({ where: { userId } });
      if (employee && employee.createdById) {
        const hrAdmin = await prisma.user.findUnique({ where: { id: employee.createdById } });
        companyName = hrAdmin?.companyName || null;
        companyWebsite = hrAdmin?.companyWebsite || null;
        companyAddress = hrAdmin?.companyAddress || null;
        companyPhone = hrAdmin?.companyPhone || null;
      }
    }

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
