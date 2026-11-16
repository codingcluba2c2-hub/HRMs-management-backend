import { Response } from 'express';
import { AuthRequest } from '../../middlewares/authMiddleware';
import { ApiResponse } from '../../utils/ApiResponse';
import { WorkforceService } from './workforce.service';

export const getWorkforceMap = async (req: AuthRequest, res: Response) => {
  try {
    const data = await WorkforceService.getLiveWorkforce(req.user, {
      departmentId: req.query.departmentId as string,
      designationId: req.query.designationId as string,
      shiftId: req.query.shiftId as string,
      attendanceStatus: req.query.attendanceStatus as string,
      geofenceStatus: req.query.geofenceStatus as string,
      liveTrackingStatus: req.query.liveTrackingStatus as string,
      search: req.query.search as string
    });
    return res.status(200).json(new ApiResponse(true, 'Live workforce retrieved successfully', data));
  } catch (error: any) {
    const status = error.message?.includes('Forbidden') ? 403 : 500;
    return res.status(status).json(new ApiResponse(false, error.message));
  }
};

export const getOffices = async (req: AuthRequest, res: Response) => {
  try {
    const offices = await WorkforceService.getOffices(req.user);
    return res.status(200).json(new ApiResponse(true, 'Offices retrieved successfully', offices));
  } catch (error: any) {
    const status = error.message?.includes('Forbidden') ? 403 : 500;
    return res.status(status).json(new ApiResponse(false, error.message));
  }
};

export const createOffice = async (req: AuthRequest, res: Response) => {
  try {
    const office = await WorkforceService.createOffice(req.user, req.body);
    return res.status(201).json(new ApiResponse(true, 'Office created successfully', office));
  } catch (error: any) {
    const status = error.message?.includes('Forbidden') ? 403 : 400;
    return res.status(status).json(new ApiResponse(false, error.message));
  }
};

export const updateOffice = async (req: AuthRequest, res: Response) => {
  try {
    const office = await WorkforceService.updateOffice(req.user, req.params.id, req.body);
    return res.status(200).json(new ApiResponse(true, 'Office updated successfully', office));
  } catch (error: any) {
    const status = error.message?.includes('Forbidden') ? 403 : 400;
    return res.status(status).json(new ApiResponse(false, error.message));
  }
};

export const deleteOffice = async (req: AuthRequest, res: Response) => {
  try {
    const result = await WorkforceService.deleteOffice(req.user, req.params.id);
    return res.status(200).json(new ApiResponse(true, 'Office deleted successfully', result));
  } catch (error: any) {
    const status = error.message?.includes('Forbidden') ? 403 : 400;
    return res.status(status).json(new ApiResponse(false, error.message));
  }
};

export const getEmployeeDetails = async (req: AuthRequest, res: Response) => {
  try {
    const details = await WorkforceService.getEmployeeLocationDetails(req.user, req.params.id);
    return res.status(200).json(new ApiResponse(true, 'Employee details retrieved successfully', details));
  } catch (error: any) {
    const status = error.message?.includes('Forbidden') ? 403 : 404;
    return res.status(status).json(new ApiResponse(false, error.message));
  }
};

export const getEmployeeHistory = async (req: AuthRequest, res: Response) => {
  try {
    const history = await WorkforceService.getEmployeeLocationHistory(req.user, req.params.id, {
      date: req.query.date as string,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined
    });
    return res.status(200).json(new ApiResponse(true, 'Location history retrieved successfully', history));
  } catch (error: any) {
    const status = error.message?.includes('Forbidden') ? 403 : 404;
    return res.status(status).json(new ApiResponse(false, error.message));
  }
};

export const updateConsent = async (req: AuthRequest, res: Response) => {
  try {
    const result = await WorkforceService.updateConsent(req.user, req.body);
    return res.status(200).json(new ApiResponse(true, 'Tracking consent updated successfully', result));
  } catch (error: any) {
    return res.status(400).json(new ApiResponse(false, error.message));
  }
};

export const ingestLiveLocation = async (req: AuthRequest, res: Response) => {
  try {
    const result = await WorkforceService.ingestLiveLocation(req.user, req.body);
    return res.status(200).json(new ApiResponse(true, 'Live location ingested successfully', result));
  } catch (error: any) {
    return res.status(400).json(new ApiResponse(false, error.message));
  }
};

export const purgeHistory = async (req: AuthRequest, res: Response) => {
  try {
    const result = await WorkforceService.purgeOldLocationHistory(req.user, req.body);
    return res.status(200).json(new ApiResponse(true, 'Old location history purged successfully', result));
  } catch (error: any) {
    const status = error.message?.includes('Forbidden') ? 403 : 400;
    return res.status(status).json(new ApiResponse(false, error.message));
  }
};
