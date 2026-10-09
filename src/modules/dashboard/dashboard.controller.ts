import { Response } from 'express';
import { ApiResponse } from '../../utils/ApiResponse';
import { AuthRequest } from '../../middlewares/authMiddleware';
import { getSuperAdminStats, getHRManagerStats, getEmployeeStats, getManagerStats } from './dashboard.service';
import { normalizeRole, CANONICAL_ROLES } from '../../utils/roleConstants';

export const getDashboardStats = async (req: AuthRequest, res: Response) => {
  try {
    const rawRole = req.user?.role || '';
    const role = normalizeRole(rawRole);
    
    let data = {};
    const trend = (req.query.trend as string) || '30d';

    if (role === CANONICAL_ROLES.SUPER_ADMIN) {
      data = await getSuperAdminStats();
    } else if (role === CANONICAL_ROLES.HR_ADMIN) {
      data = await getHRManagerStats(trend, req.user);
    } else if (role === CANONICAL_ROLES.MANAGER) {
      data = await getManagerStats(req.user);
    } else {
      data = await getEmployeeStats(req.user?.id || '');
    }

    return res.status(200).json(new ApiResponse(true, "Dashboard stats fetched", data));
  } catch (error: any) {
    console.error("Dashboard Stats Error:", error);
    return res.status(500).json(new ApiResponse(false, error.message || "Failed to fetch dashboard stats"));
  }
};
