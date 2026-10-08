import { prisma } from '../../lib/prisma';
import { Request, Response } from 'express';
import { ApiResponse } from '../../utils/ApiResponse';
import { getTenantDesignationFilter, getTenantDepartmentFilter, getTenantEmployeeFilter } from '../../utils/tenantFilter';

export const createDesignation = async (req: Request, res: Response) => {
  try {
    const { name, code, level = 1, description, departmentId, status = true } = req.body;
    const userId = (req as any).user?.id;
    const tenantDeptFilter = await getTenantDepartmentFilter((req as any).user);

    if (!name || !name.trim()) {
      return res.status(400).json(new ApiResponse(false, 'Designation name is required'));
    }

    if (!departmentId) {
      return res.status(400).json(new ApiResponse(false, 'Department selection is required for a designation'));
    }

    // Check if department exists and belongs to current tenant
    const department = await prisma.department.findFirst({ where: { id: departmentId, ...tenantDeptFilter } });
    if (!department) {
      return res.status(404).json(new ApiResponse(false, 'Selected department does not exist or access denied'));
    }

    const formattedName = name.trim();
    const formattedCode = code ? code.trim().toUpperCase() : `${department.code || 'DES'}-${formattedName.slice(0, 3).toUpperCase()}`;

    // Check duplicate name within department or code within tenant
    const existing = await prisma.designation.findFirst({
      where: {
        createdById: userId,
        OR: [
          { departmentId, name: { equals: formattedName, mode: 'insensitive' } },
          { code: formattedCode }
        ]
      }
    });

    if (existing) {
      return res.status(400).json(new ApiResponse(false, 'Designation name within this department or code already exists'));
    }

    const designation = await prisma.designation.create({
      data: {
        name: formattedName,
        code: formattedCode,
        level: level ? String(level) : "1",
        description: description?.trim() || null,
        departmentId,
        status: status ?? true,
        createdById: userId || null
      },
      include: {
        department: {
          select: { id: true, name: true, code: true }
        },
        _count: {
          select: { employees: true }
        }
      }
    });

    // Audit Log
    await prisma.auditLog.create({
      data: {
        userId: userId || null,
        action: 'DESIGNATION_CREATED',
        entity: 'Designation',
        entityId: designation.id
      }
    }).catch(() => {});

    return res.status(201).json(new ApiResponse(true, 'Designation created successfully', designation));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const getDesignations = async (req: Request, res: Response) => {
  try {
    const { departmentId, status } = req.query;
    const tenantDesigFilter = await getTenantDesignationFilter((req as any).user);

    const whereClause: any = {
      AND: [
        tenantDesigFilter
      ]
    };

    if (departmentId && typeof departmentId === 'string' && departmentId !== 'ALL' && departmentId !== 'all') {
      whereClause.AND.push({
        OR: [
          { departmentId: departmentId },
          { department: { id: departmentId } },
          { department: { name: { equals: departmentId, mode: 'insensitive' } } }
        ]
      });
    }

    if (status !== undefined) {
      whereClause.status = status === 'true';
    }

    let designations = await prisma.designation.findMany({
      where: whereClause,
      include: {
        department: {
          select: { id: true, name: true, code: true }
        },
        _count: {
          select: { employees: true }
        }
      },
      orderBy: [{ level: 'asc' }, { name: 'asc' }]
    });

    // Fallback: If filtering by department returned no designations, fetch all active designations for the tenant
    if (designations.length === 0 && departmentId && departmentId !== 'ALL' && departmentId !== 'all') {
      const fallbackWhere: any = { AND: [tenantDesigFilter] };
      if (status !== undefined) fallbackWhere.status = status === 'true';
      designations = await prisma.designation.findMany({
        where: fallbackWhere,
        include: {
          department: {
            select: { id: true, name: true, code: true }
          },
          _count: {
            select: { employees: true }
          }
        },
        orderBy: [{ level: 'asc' }, { name: 'asc' }]
      });
    }

    return res.status(200).json(new ApiResponse(true, 'Designations fetched successfully', designations));
  } catch (error: any) {
    console.error('Error fetching designations:', error);
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const updateDesignation = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, code, level, description, departmentId, status } = req.body;
    const userId = (req as any).user?.id;
    const tenantDesigFilter = await getTenantDesignationFilter((req as any).user);

    const existingDesig = await prisma.designation.findFirst({ where: { id, ...tenantDesigFilter } });
    if (!existingDesig) {
      return res.status(404).json(new ApiResponse(false, 'Designation not found'));
    }

    const targetDeptId = departmentId || existingDesig.departmentId;
    if (departmentId) {
      const tenantDeptFilter = await getTenantDepartmentFilter((req as any).user);
      const dept = await prisma.department.findFirst({ where: { id: departmentId, ...tenantDeptFilter } });
      if (!dept) {
        return res.status(404).json(new ApiResponse(false, 'Selected department does not exist'));
      }
    }

    const formattedName = name ? name.trim() : existingDesig.name;
    const formattedCode = code ? code.trim().toUpperCase() : existingDesig.code;

    if (name || code || departmentId) {
      const conflict = await prisma.designation.findFirst({
        where: {
          id: { not: id },
          createdById: existingDesig.createdById || userId,
          OR: [
            { departmentId: targetDeptId, name: { equals: formattedName, mode: 'insensitive' } },
            ...(formattedCode ? [{ code: formattedCode }] : [])
          ]
        }
      });
      if (conflict) {
        return res.status(400).json(new ApiResponse(false, 'Another designation with this name in the department or code already exists'));
      }
    }

    const designation = await prisma.designation.update({
      where: { id },
      data: {
        name: formattedName,
        code: formattedCode,
        level: level !== undefined ? String(level) : existingDesig.level,
        description: description !== undefined ? (description?.trim() || null) : existingDesig.description,
        departmentId: targetDeptId,
        status: status !== undefined ? status : existingDesig.status
      },
      include: {
        department: {
          select: { id: true, name: true, code: true }
        },
        _count: {
          select: { employees: true }
        }
      }
    });

    // Audit Log
    await prisma.auditLog.create({
      data: {
        userId: userId || null,
        action: 'DESIGNATION_UPDATED',
        entity: 'Designation',
        entityId: id
      }
    }).catch(() => {});

    return res.status(200).json(new ApiResponse(true, 'Designation updated successfully', designation));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const deleteDesignation = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const force = req.query.force === 'true';
    const action = req.query.action as string;
    const tenantDesigFilter = await getTenantDesignationFilter((req as any).user);

    const desig = await prisma.designation.findFirst({ where: { id, ...tenantDesigFilter } });
    if (!desig) return res.status(404).json(new ApiResponse(false, 'Designation not found'));

    if (action === 'deactivate') {
      await prisma.designation.update({
        where: { id },
        data: { status: false }
      });
      return res.status(200).json(new ApiResponse(true, `Designation "${desig.name}" deactivated successfully`));
    }

    if (force || action === 'force_delete') {
      await prisma.employee.updateMany({
        where: { designationId: id },
        data: { designationId: null }
      });
      await prisma.designation.delete({ where: { id } });

      await prisma.auditLog.create({
        data: {
          userId: (req as any).user?.id || null,
          action: 'DESIGNATION_DELETED',
          entity: 'Designation',
          entityId: id
        }
      }).catch(() => {});

      return res.status(200).json(new ApiResponse(true, `Designation "${desig.name}" deleted successfully`));
    }

    const employees = await prisma.employee.count({ where: { designationId: id } });
    if (employees > 0) {
      return res.status(400).json(new ApiResponse(
        false, 
        `Cannot delete designation as it is currently assigned to ${employees} employee(s). Please reassign them first or deactivate this designation.`
      ));
    }

    await prisma.designation.delete({ where: { id } });

    // Audit Log
    await prisma.auditLog.create({
      data: {
        userId: (req as any).user?.id || null,
        action: 'DESIGNATION_DELETED',
        entity: 'Designation',
        entityId: id
      }
    }).catch(() => {});

    return res.status(200).json(new ApiResponse(true, 'Designation deleted successfully'));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};
