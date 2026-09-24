import { Response } from 'express';
import { ApiResponse } from '../../utils/ApiResponse';
import { AuthRequest } from '../../middlewares/authMiddleware';
import { getSuperAdminStats, getHRManagerStats, getEmployeeStats } from './dashboard.service';

export const getDashboardStats = async (req: AuthRequest, res: Response) => {
  try {
    const rawRole = req.user?.role || '';
    const userRole = typeof rawRole === 'string' ? rawRole.toUpperCase().trim().replace(/\s+/g, '_') : '';
    console.log('[DASHBOARD DEBUG] Raw Role:', rawRole, '=> Parsed Role:', userRole);
    
    let data = {};

    const trend = (req.query.trend as string) || '30d';

    if (userRole === 'SUPER_ADMIN') {
      data = await getSuperAdminStats();
    } else if (userRole === 'HR_MANAGER' || userRole === 'HR_ADMIN') {
      data = await getHRManagerStats(trend);
    } else {
      data = await getEmployeeStats(req.user?.id || '');
    }

    return res.status(200).json(new ApiResponse(true, "Dashboard stats fetched", data));
  } catch (error: any) {
    console.error("Dashboard Stats Error:", error);
    return res.status(500).json(new ApiResponse(false, error.message || "Failed to fetch dashboard stats"));
  }
};
