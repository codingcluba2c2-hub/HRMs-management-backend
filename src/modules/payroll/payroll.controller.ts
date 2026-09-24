import { Response } from 'express';
import { AuthRequest } from '../../middlewares/authMiddleware';
import { ApiResponse } from '../../utils/ApiResponse';
import * as payrollService from './payroll.service';

export const getPayrollSummary = async (req: AuthRequest, res: Response) => {
  try {
    const rawRole = req.user?.role || '';
    const userRole = typeof rawRole === 'string' ? rawRole.toUpperCase().trim().replace(/\s+/g, '_') : '';
    
    const summary = await payrollService.getPayrollSummary(req.user?.id || '', userRole);
    return res.status(200).json(new ApiResponse(true, "Payroll summary fetched", summary));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message || "Failed to fetch summary"));
  }
};

export const getPayrollRecords = async (req: AuthRequest, res: Response) => {
  try {
    const rawRole = req.user?.role || '';
    const userRole = typeof rawRole === 'string' ? rawRole.toUpperCase().trim().replace(/\s+/g, '_') : '';
    
    const filters = req.query;
    const records = await payrollService.getPayrollRecords(req.user?.id || '', userRole, filters);
    
    return res.status(200).json(new ApiResponse(true, "Payroll records fetched", records));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message || "Failed to fetch records"));
  }
};

export const getPayrollAnalytics = async (req: AuthRequest, res: Response) => {
  try {
    const rawRole = req.user?.role || '';
    const userRole = typeof rawRole === 'string' ? rawRole.toUpperCase().trim().replace(/\s+/g, '_') : '';
    
    const analytics = await payrollService.getPayrollAnalytics(req.user?.id || '', userRole);
    return res.status(200).json(new ApiResponse(true, "Analytics fetched", analytics));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message || "Failed to fetch analytics"));
  }
};

export const getTimelineActivities = async (req: AuthRequest, res: Response) => {
  try {
    const rawRole = req.user?.role || '';
    const userRole = typeof rawRole === 'string' ? rawRole.toUpperCase().trim().replace(/\s+/g, '_') : '';

    const timeline = await payrollService.getTimelineActivities(req.user?.id || '', userRole);
    return res.status(200).json(new ApiResponse(true, "Timeline fetched", timeline));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message || "Failed to fetch timeline"));
  }
};

export const getPayslipById = async (req: AuthRequest, res: Response) => {
  try {
    const rawRole = req.user?.role || '';
    const userRole = typeof rawRole === 'string' ? rawRole.toUpperCase().trim().replace(/\s+/g, '_') : '';
    const payslipId = req.params.id;

    const payslip = await payrollService.getPayslipById(req.user?.id || '', userRole, payslipId);
    return res.status(200).json(new ApiResponse(true, "Payslip details fetched", payslip));
  } catch (error: any) {
    const status = error.statusCode || 500;
    return res.status(status).json(new ApiResponse(false, error.message || "Failed to fetch payslip details"));
  }
};

export const downloadPayslipPdf = async (req: AuthRequest, res: Response) => {
  try {
    const rawRole = req.user?.role || '';
    const userRole = typeof rawRole === 'string' ? rawRole.toUpperCase().trim().replace(/\s+/g, '_') : '';
    const payslipId = req.params.id;

    const { buffer, fileName } = await payrollService.generatePayslipPdfById(req.user?.id || '', userRole, payslipId);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    return res.status(200).send(buffer);
  } catch (error: any) {
    const status = error.statusCode || 500;
    return res.status(status).json(new ApiResponse(false, error.message || "Failed to generate PDF"));
  }
};

export const createPayrollQuery = async (req: AuthRequest, res: Response) => {
  try {
    const query = await payrollService.createPayrollQuery(req.user?.id || '', req.body);
    return res.status(201).json(new ApiResponse(true, "Query submitted successfully", query));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message || "Failed to create query"));
  }
};

export const createPayrollRecord = async (req: AuthRequest, res: Response) => {
  try {
    const record = await payrollService.createPayrollRecord(req.user?.id || '', req.body);
    return res.status(201).json(new ApiResponse(true, "Payroll record created successfully", record));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message || "Failed to create payroll record"));
  }
};

export const deletePayrollRecord = async (req: AuthRequest, res: Response) => {
  try {
    await payrollService.deletePayrollRecord(req.params.id);
    return res.status(200).json(new ApiResponse(true, "Payroll record deleted successfully"));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message || "Failed to delete payroll record"));
  }
};

