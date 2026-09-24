import { Response } from 'express';
import { AuthRequest } from '../../middlewares/authMiddleware';
import { ApiResponse } from '../../utils/ApiResponse';
import * as leaveService from './leave.service';

export const getLeaveSummary = async (req: AuthRequest, res: Response) => {
  try {
    const rawRole = req.user?.role || '';
    const userRole = typeof rawRole === 'string' ? rawRole.toUpperCase().trim().replace(/\s+/g, '_') : '';
    
    const summary = await leaveService.getLeaveSummary(req.user?.id || '', userRole);
    return res.status(200).json(new ApiResponse(true, "Leave summary fetched", summary));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message || "Failed to fetch summary"));
  }
};

export const getLeaveRequests = async (req: AuthRequest, res: Response) => {
  try {
    const rawRole = req.user?.role || '';
    const userRole = typeof rawRole === 'string' ? rawRole.toUpperCase().trim().replace(/\s+/g, '_') : '';
    
    const filters = req.query;
    const requests = await leaveService.getLeaveRequests(req.user?.id || '', userRole, filters);
    
    return res.status(200).json(new ApiResponse(true, "Leave requests fetched", requests));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message || "Failed to fetch requests"));
  }
};

export const getMyLeaves = async (req: AuthRequest, res: Response) => {
  try {
    const filters = req.query;
    const requests = await leaveService.getLeaveRequests(req.user?.id || '', 'EMPLOYEE', filters);
    return res.status(200).json(new ApiResponse(true, "My leaves fetched", requests));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message || "Failed to fetch my leaves"));
  }
};

export const createLeaveRequest = async (req: AuthRequest, res: Response) => {
  try {
    const request = await leaveService.createLeaveRequest(req.user?.id || '', req.body);
    return res.status(201).json(new ApiResponse(true, "Leave request created successfully", request));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message || "Failed to create request"));
  }
};

export const updateLeaveStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status, comments } = req.body;
    
    const request = await leaveService.processLeaveApproval(req.user?.id || '', id, status, comments);
    return res.status(200).json(new ApiResponse(true, `Leave request ${status.toLowerCase()}`, request));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message || "Failed to update status"));
  }
};

// MASTER LEAVE TYPES
export const getLeaveTypes = async (req: AuthRequest, res: Response) => {
  try {
    const types = await leaveService.getLeaveTypes();
    return res.status(200).json(new ApiResponse(true, "Leave types fetched", types));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const createLeaveType = async (req: AuthRequest, res: Response) => {
  try {
    const leaveType = await leaveService.createLeaveType(req.user?.id || '', req.body);
    return res.status(201).json(new ApiResponse(true, "Leave type created successfully", leaveType));
  } catch (error: any) {
    return res.status(400).json(new ApiResponse(false, error.message));
  }
};

export const updateLeaveType = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const leaveType = await leaveService.updateLeaveType(req.user?.id || '', id, req.body);
    return res.status(200).json(new ApiResponse(true, "Leave type updated successfully", leaveType));
  } catch (error: any) {
    return res.status(400).json(new ApiResponse(false, error.message));
  }
};

export const deleteLeaveType = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const deactivated = await leaveService.deleteLeaveType(req.user?.id || '', id);
    return res.status(200).json(new ApiResponse(true, "Leave type deactivated successfully", deactivated));
  } catch (error: any) {
    return res.status(400).json(new ApiResponse(false, error.message));
  }
};

// LEAVE POLICIES
export const getLeavePolicies = async (req: AuthRequest, res: Response) => {
  try {
    const policies = await leaveService.getLeavePolicies();
    return res.status(200).json(new ApiResponse(true, "Leave policies fetched", policies));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const updateLeavePolicy = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const policy = await leaveService.updateLeavePolicy(req.user?.id || '', id, req.body);
    return res.status(200).json(new ApiResponse(true, "Leave policy updated successfully", policy));
  } catch (error: any) {
    return res.status(400).json(new ApiResponse(false, error.message));
  }
};

// LEAVE BALANCES FOR HR ADMIN
export const getAllEmployeeBalances = async (req: AuthRequest, res: Response) => {
  try {
    const filters = req.query;
    const balances = await leaveService.getAllEmployeeBalances(filters);
    return res.status(200).json(new ApiResponse(true, "Employee leave balances fetched", balances));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const updateEmployeeBalance = async (req: AuthRequest, res: Response) => {
  try {
    const { employeeId } = req.params;
    const updated = await leaveService.updateEmployeeBalance(req.user?.id || '', employeeId, req.body);
    return res.status(200).json(new ApiResponse(true, "Employee leave balance updated successfully", updated));
  } catch (error: any) {
    return res.status(400).json(new ApiResponse(false, error.message));
  }
};

// LEDGER / AUDIT LOGS
export const getLeaveLedgerLogs = async (req: AuthRequest, res: Response) => {
  try {
    const filters = req.query;
    const logs = await leaveService.getLeaveLedgerLogs(filters);
    return res.status(200).json(new ApiResponse(true, "Leave ledger logs fetched", logs));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const getLeaveAnalytics = async (req: AuthRequest, res: Response) => {
  try {
    const analytics = await leaveService.getLeaveAnalytics();
    return res.status(200).json(new ApiResponse(true, "Analytics fetched", analytics));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message || "Failed to fetch analytics"));
  }
};

export const getLeaveCalendar = async (req: AuthRequest, res: Response) => {
  try {
    const calendar = await leaveService.getLeaveCalendar();
    return res.status(200).json(new ApiResponse(true, "Calendar fetched", calendar));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message || "Failed to fetch calendar"));
  }
};

export const getLeaveQuotas = async (req: AuthRequest, res: Response) => {
  try {
    const quotas = await leaveService.getLeaveQuotas();
    return res.status(200).json(new ApiResponse(true, "Quotas fetched", quotas));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message || "Failed to fetch quotas"));
  }
};

export const updateLeaveQuotas = async (req: AuthRequest, res: Response) => {
  try {
    const quotas = await leaveService.updateLeaveQuotas(req.body);
    return res.status(200).json(new ApiResponse(true, "Quotas updated", quotas));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message || "Failed to update quotas"));
  }
};
