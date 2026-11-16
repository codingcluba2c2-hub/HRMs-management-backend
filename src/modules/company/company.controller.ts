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

    // Fetch primary office location for map coordinates & local application geofencing
    const companyId = user?.companyId || creator?.companyId || employee?.companyId;
    const office = await prisma.officeLocation.findFirst({
      where: {
        OR: [
          ...(companyId ? [{ companyId }] : []),
          ...(user?.id ? [{ createdById: user.id }] : []),
          ...(creator?.id ? [{ createdById: creator.id }] : []),
          { isActive: true }
        ]
      },
      orderBy: { updatedAt: 'desc' }
    });

    return res.status(200).json(new ApiResponse(true, "Company details retrieved", {
      companyName,
      companyWebsite,
      companyAddress: office?.address || companyAddress,
      companyPhone,
      latitude: office?.latitude ?? (companyAddress ? 28.5065 : 28.4983),
      longitude: office?.longitude ?? (companyAddress ? 77.0861 : 77.0898),
      radiusMeters: office?.radiusMeters ?? 150.0,
      officeId: office?.id ?? null
    }));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const updateCompanyDetails = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const userEmail = (req as any).user?.email;
    const { 
      companyName, 
      companyWebsite, 
      companyAddress, 
      companyPhone,
      latitude,
      longitude,
      radiusMeters
    } = req.body;

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

    // Resolve or sync Company model in PostgreSQL
    let companyId = user.companyId;
    if (!companyId && companyName) {
      let company = await prisma.company.findFirst({
        where: { name: { equals: companyName.trim(), mode: 'insensitive' } }
      });
      if (!company) {
        company = await prisma.company.create({
          data: {
            name: companyName.trim(),
            address: companyAddress,
            phone: companyPhone,
            website: companyWebsite
          }
        });
      }
      companyId = company.id;
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        companyName,
        companyWebsite,
        companyAddress,
        companyPhone,
        ...(companyId ? { companyId } : {})
      }
    });

    if (companyId) {
      await prisma.company.update({
        where: { id: companyId },
        data: {
          ...(companyName ? { name: companyName.trim() } : {}),
          ...(companyAddress ? { address: companyAddress.trim() } : {}),
          ...(companyPhone ? { phone: companyPhone.trim() } : {}),
          ...(companyWebsite ? { website: companyWebsite.trim() } : {})
        }
      }).catch(() => {});
    }

    // Sync / Upsert OfficeLocation purely inside this application's database
    const officeWhere = {
      OR: [
        ...(companyId ? [{ companyId }] : []),
        { createdById: user.id },
        { isActive: true }
      ]
    };

    let existingOffice = await prisma.officeLocation.findFirst({
      where: officeWhere,
      orderBy: { updatedAt: 'desc' }
    });

    const officeName = companyName ? `${companyName} Office` : 'Headquarters';
    const numLat = latitude !== undefined && latitude !== null && !isNaN(Number(latitude)) ? Number(latitude) : null;
    const numLng = longitude !== undefined && longitude !== null && !isNaN(Number(longitude)) ? Number(longitude) : null;
    const numRadius = radiusMeters !== undefined && radiusMeters !== null && !isNaN(Number(radiusMeters)) ? Number(radiusMeters) : 150.0;

    let savedOffice = null;
    if (existingOffice) {
      savedOffice = await prisma.officeLocation.update({
        where: { id: existingOffice.id },
        data: {
          name: officeName,
          ...(companyAddress ? { address: companyAddress.trim() } : {}),
          ...(numLat !== null ? { latitude: numLat } : {}),
          ...(numLng !== null ? { longitude: numLng } : {}),
          ...(numRadius ? { radiusMeters: numRadius } : {}),
          ...(companyId ? { companyId } : {}),
          isActive: true
        }
      });
      // Synchronize all other existing offices so the whole dashboard map reflects this location
      await prisma.officeLocation.updateMany({
        where: {
          id: { not: existingOffice.id }
        },
        data: {
          name: officeName,
          ...(companyAddress ? { address: companyAddress.trim() } : {}),
          ...(numLat !== null ? { latitude: numLat } : {}),
          ...(numLng !== null ? { longitude: numLng } : {}),
          ...(numRadius ? { radiusMeters: numRadius } : {}),
          ...(companyId ? { companyId } : {}),
          isActive: true
        }
      }).catch(() => {});
    } else if (companyAddress || numLat !== null) {
      savedOffice = await prisma.officeLocation.create({
        data: {
          companyId: companyId || null,
          name: officeName,
          address: companyAddress?.trim() || 'Company Headquarters',
          latitude: numLat !== null ? numLat : 28.5065,
          longitude: numLng !== null ? numLng : 77.0861,
          radiusMeters: numRadius || 150.0,
          isActive: true,
          createdById: user.id
        }
      });
    }

    // Cascade update company details to all employees created by this HR/Admin user
    const createdEmployees = await prisma.employee.findMany({
      where: { createdById: user.id, userId: { not: null } },
      select: { userId: true }
    });

    const createdUserIds = createdEmployees.map(e => e.userId!).filter(Boolean);
    if (createdUserIds.length > 0) {
      await prisma.user.updateMany({
        where: { id: { in: createdUserIds } },
        data: {
          companyName,
          companyWebsite,
          companyAddress,
          companyPhone,
          ...(companyId ? { companyId } : {})
        }
      });
    }

    return res.status(200).json(new ApiResponse(true, "Company and office details updated successfully in local application", {
      companyName: updatedUser.companyName,
      companyWebsite: updatedUser.companyWebsite,
      companyAddress: updatedUser.companyAddress,
      companyPhone: updatedUser.companyPhone,
      latitude: savedOffice?.latitude ?? numLat ?? 28.4983,
      longitude: savedOffice?.longitude ?? numLng ?? 77.0898,
      radiusMeters: savedOffice?.radiusMeters ?? numRadius ?? 150.0,
      officeId: savedOffice?.id ?? null
    }));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};
