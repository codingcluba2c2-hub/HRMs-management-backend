import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { ApiResponse } from '../../utils/ApiResponse';

export const getDashboardSummary = async (req: Request, res: Response) => {
  try {
    const totalDepartments = await prisma.department.count();
    const totalDesignations = await prisma.designation.count();
    const totalJobRoles = await prisma.jobRole.count();
    const activeEmployees = await prisma.employee.count({ where: { status: 'ACTIVE' } });
    const distinctManagersData = await prisma.employee.findMany({ select: { managerId: true }, where: { status: 'ACTIVE', managerId: { not: null } } });
    const uniqueManagers = new Set(distinctManagersData.map(e => e.managerId));
    const managers = uniqueManagers.size;
    const officeLocations = 0; // Location tracking temporarily disabled or moved
    const openPositions = 12; // Static for now, can be computed from requisition system if available

    const avgEmployeesPerDept = totalDepartments > 0 ? (activeEmployees / totalDepartments).toFixed(1) : 0;

    return res.status(200).json(new ApiResponse(true, 'Organization Summary', {
      totalDepartments,
      totalDesignations,
      totalJobRoles,
      activeEmployees,
      managers,
      officeLocations,
      openPositions,
      avgEmployeesPerDept
    }));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

// Department CRUD
export const getDepartments = async (req: Request, res: Response) => {
  try {
    const departments = await prisma.department.findMany({
      include: {
        _count: { select: { employees: true } },
        manager: {
          select: { id: true, firstName: true, lastName: true, employeeId: true }
        }
      }
    });

    return res.status(200).json(new ApiResponse(true, 'Departments fetched', departments));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const createDepartment = async (req: Request, res: Response) => {
  try {
    const { name, code, description, managerId } = req.body;
    
    // Check if code or name already exists
    const existing = await prisma.department.findFirst({
      where: { OR: [{ name }, { code }] }
    });
    if (existing) {
      return res.status(400).json(new ApiResponse(false, 'Department name or code already exists'));
    }

    const dept = await prisma.department.create({
      data: { name, code, description, managerId }
    });

    return res.status(201).json(new ApiResponse(true, 'Department created successfully', dept));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const updateDepartment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, code, description, status, managerId } = req.body;
    
    const existing = await prisma.department.findFirst({
      where: { OR: [{ name }, { code }], NOT: { id } }
    });
    if (existing) {
      return res.status(400).json(new ApiResponse(false, 'Department name or code already exists in another department'));
    }

    const dept = await prisma.department.update({
      where: { id },
      data: { name, code, description, status, managerId }
    });

    if (managerId) {
      await prisma.employee.updateMany({
        where: { 
          departmentId: id,
          id: { not: managerId } // Don't make the manager report to themselves
        },
        data: { managerId: managerId }
      });
      const { default: redis } = await import('../../lib/redis');
      if (redis.status === 'ready') {
        const keys = await redis.keys('employees:*');
        if (keys.length > 0) await redis.del(keys);
      }
    }

    return res.status(200).json(new ApiResponse(true, 'Department updated successfully', dept));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const deleteDepartment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // Check if any employees exist
    const employeesCount = await prisma.employee.count({ where: { departmentId: id } });
    if (employeesCount > 0) {
      return res.status(400).json(new ApiResponse(false, 'Cannot delete department with active employees. Please reassign them first.'));
    }

    await prisma.department.delete({ where: { id } });
    return res.status(200).json(new ApiResponse(true, 'Department deleted successfully'));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

// Designations CRUD
export const getDesignations = async (req: Request, res: Response) => {
  try {
    const designations = await prisma.designation.findMany({
      include: {
        department: true,
        _count: { select: { employees: true } }
      }
    });
    return res.status(200).json(new ApiResponse(true, 'Designations fetched', designations));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const createDesignation = async (req: Request, res: Response) => {
  try {
    const { name, level, departmentId, description } = req.body;
    
    const existing = await prisma.designation.findFirst({
      where: { name, departmentId }
    });
    if (existing) {
      return res.status(400).json(new ApiResponse(false, 'Designation already exists in this department'));
    }

    const desig = await prisma.designation.create({
      data: { name, level: Number(level) || 1, departmentId, description }
    });

    return res.status(201).json(new ApiResponse(true, 'Designation created successfully', desig));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const updateDesignation = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, level, departmentId, description } = req.body;
    
    const existing = await prisma.designation.findFirst({
      where: { name, departmentId, NOT: { id } }
    });
    if (existing) {
      return res.status(400).json(new ApiResponse(false, 'Designation already exists in this department'));
    }

    const desig = await prisma.designation.update({
      where: { id },
      data: { name, level: Number(level) || 1, departmentId, description }
    });

    return res.status(200).json(new ApiResponse(true, 'Designation updated successfully', desig));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const deleteDesignation = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const employeesCount = await prisma.employee.count({ where: { designationId: id } });
    if (employeesCount > 0) {
      return res.status(400).json(new ApiResponse(false, 'Cannot delete designation with active employees. Please reassign them first.'));
    }

    await prisma.designation.delete({ where: { id } });
    return res.status(200).json(new ApiResponse(true, 'Designation deleted successfully'));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};



// Organization Chart
export const getOrganizationChart = async (req: Request, res: Response) => {
  try {
    // For large scale, normally recursive CTEs are used. For now, fetch all active employees and construct tree.
    const allEmployees = await prisma.employee.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        employeeId: true,
        firstName: true,
        lastName: true,
        managerId: true,
        photo: true,
        designation: { select: { name: true } },
        department: { select: { name: true } }
      }
    });

    const employeeMap = new Map();
    allEmployees.forEach((emp: any) => {
      employeeMap.set(emp.id, { ...emp, children: [] });
    });

    const rawRootNodes: any[] = [];
    employeeMap.forEach((emp: any) => {
      if (emp.managerId && employeeMap.has(emp.managerId)) {
        employeeMap.get(emp.managerId).children.push(emp);
      } else {
        rawRootNodes.push(emp); // Nodes with no manager are root (like CEO)
      }
    });

    // Filter to only show root nodes that have subordinates, to avoid cluttering 
    // the org chart with thousands of unassigned employees.
    const rootNodes = rawRootNodes.filter(node => 
      node.children.length > 0 || 
      (node.designation?.name && node.designation.name.toLowerCase().includes('ceo')) ||
      (node.designation?.name && node.designation.name.toLowerCase().includes('founder'))
    );

    return res.status(200).json(new ApiResponse(true, 'Organization Chart fetched', rootNodes));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const assignDepartmentManager = async (req: Request, res: Response) => {
  try {
    const { departmentId, employeeId } = req.body;
    
    if (!departmentId || !employeeId) {
      return res.status(400).json(new ApiResponse(false, 'Department ID and Employee ID are required'));
    }

    // 1. Update the department's manager
    await prisma.department.update({
      where: { id: departmentId },
      data: { managerId: employeeId }
    });

    // 2. Set all other employees in this department to report to this new manager
    await prisma.employee.updateMany({
      where: { 
        departmentId: departmentId,
        id: { not: employeeId } // Don't make the manager report to themselves
      },
      data: { managerId: employeeId }
    });

    const { default: redis } = await import('../../lib/redis');
    if (redis.status === 'ready') {
      const keys = await redis.keys('employees:*');
      if (keys.length > 0) await redis.del(keys);
    }

    return res.status(200).json(new ApiResponse(true, 'Manager assigned successfully'));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};
