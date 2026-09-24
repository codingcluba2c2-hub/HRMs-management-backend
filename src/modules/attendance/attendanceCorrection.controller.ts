import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { ApiResponse } from '../../utils/ApiResponse';

// Create a new correction request
export const createCorrection = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { date, requestedCheckIn, requestedCheckOut, correctionType, reason, attachmentUrl } = req.body;

    const employee = await prisma.employee.findUnique({ where: { userId } });
    if (!employee) return res.status(404).json(new ApiResponse(false, "Employee profile not found"));

    // Check if an attendance record exists for this date
    const recordDate = new Date(date);
    recordDate.setHours(0, 0, 0, 0);

    const record = await prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: recordDate } },
      include: { logs: true }
    });

    let currentCheckIn = null;
    let currentCheckOut = null;

    if (record && record.logs.length > 0) {
      currentCheckIn = record.logs[0].punchIn;
      currentCheckOut = record.logs[record.logs.length - 1].punchOut;
    }

    const correction = await prisma.attendanceCorrection.create({
      data: {
        employeeId: employee.id,
        attendanceRecordId: record?.id,
        date: recordDate,
        currentCheckIn,
        currentCheckOut,
        requestedCheckIn: requestedCheckIn ? new Date(requestedCheckIn) : null,
        requestedCheckOut: requestedCheckOut ? new Date(requestedCheckOut) : null,
        correctionType,
        reason,
        attachmentUrl,
        managerId: employee.managerId,
        status: "PENDING"
      }
    });

    // Create approval history entry
    await prisma.approvalHistory.create({
      data: {
        correctionId: correction.id,
        action: "SUBMITTED",
        actedById: userId
      }
    });

    // Optionally create notification for manager here

    return res.status(201).json(new ApiResponse(true, "Correction request submitted", correction));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

// Get my correction requests
export const getMyCorrections = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const employee = await prisma.employee.findUnique({ where: { userId } });
    if (!employee) return res.status(404).json(new ApiResponse(false, "Employee profile not found"));

    const corrections = await prisma.attendanceCorrection.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: 'desc' }
    });

    return res.status(200).json(new ApiResponse(true, "Fetched my corrections", corrections));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

// Get pending requests for manager or HR Admin
export const getPendingCorrections = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true }
    });

    if (!user) return res.status(404).json(new ApiResponse(false, "User not found"));

    const roleName = user.role?.name || "";
    const isHrOrAdmin = roleName === "HR_ADMIN" || roleName === "ADMIN" || roleName === "HR Admin";

    const whereClause: any = { status: "PENDING" };
    
    if (!isHrOrAdmin) {
      const employee = await prisma.employee.findUnique({ where: { userId } });
      if (!employee) return res.status(403).json(new ApiResponse(false, "Not authorized as a manager"));
      whereClause.managerId = employee.id;
    }

    const corrections = await prisma.attendanceCorrection.findMany({
      where: whereClause,
      include: { employee: { include: { user: { select: { profilePic: true } } } } },
      orderBy: { createdAt: 'desc' }
    });

    return res.status(200).json(new ApiResponse(true, "Fetched pending corrections", corrections));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

// Approve correction
export const approveCorrection = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { comments } = req.body;
    const userId = (req as any).user.id;

    const correction = await prisma.attendanceCorrection.findUnique({
      where: { id },
      include: { employee: true }
    });

    if (!correction) return res.status(404).json(new ApiResponse(false, "Correction request not found"));
    
    // In strict RBAC, verify managerId matches the user. 
    // Allowing HR admin to bypass this would be implemented here.

    await prisma.attendanceCorrection.update({
      where: { id },
      data: { status: "APPROVED", resolvedAt: new Date() }
    });

    await prisma.approvalHistory.create({
      data: {
        correctionId: id,
        action: "APPROVED",
        actedById: userId,
        comments
      }
    });

    // Update the actual Attendance Record & Logs
    let finalRecordId = correction.attendanceRecordId;
    if (correction.requestedCheckIn || correction.requestedCheckOut) {
      if (correction.attendanceRecordId) {
        // If record exists, update the first log
        const firstLog = await prisma.attendanceLog.findFirst({
          where: { attendanceId: correction.attendanceRecordId },
          orderBy: { punchIn: 'asc' }
        });

        if (firstLog) {
          await prisma.attendanceLog.update({
            where: { id: firstLog.id },
            data: {
              punchIn: correction.requestedCheckIn || firstLog.punchIn,
              punchOut: correction.requestedCheckOut || firstLog.punchOut
            }
          });
        }
      } else {
        // If no record exists (missing completely), create it
        const newRecord = await prisma.attendanceRecord.create({
          data: {
            employeeId: correction.employeeId,
            date: correction.date,
            status: "PRESENT",
          }
        });
        
        finalRecordId = newRecord.id;

        if (correction.requestedCheckIn) {
          await prisma.attendanceLog.create({
            data: {
              attendanceId: newRecord.id,
              punchIn: correction.requestedCheckIn,
              punchOut: correction.requestedCheckOut || null,
            }
          });
        }
      }

      if (finalRecordId) {
        // Recalculate hours
        const allLogs = await prisma.attendanceLog.findMany({ where: { attendanceId: finalRecordId } });
        const allBreaks = await prisma.breakSession.findMany({ where: { attendanceId: finalRecordId } });

        let grossMs = 0;
        allLogs.forEach(l => {
          if (l.punchOut) grossMs += (l.punchOut.getTime() - l.punchIn.getTime());
        });

        let breakMs = 0;
        allBreaks.forEach(b => {
          if (b.breakEnd) breakMs += (b.breakEnd.getTime() - b.breakStart.getTime());
        });

        const grossHours = grossMs / (1000 * 60 * 60);
        const effectiveHours = (grossMs - breakMs) / (1000 * 60 * 60);

        await prisma.attendanceRecord.update({
          where: { id: finalRecordId },
          data: { grossHours, effectiveHours }
        });
      }
    }

    return res.status(200).json(new ApiResponse(true, "Correction approved successfully"));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

// Reject correction
export const rejectCorrection = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { comments } = req.body;
    const userId = (req as any).user.id;

    if (!comments) return res.status(400).json(new ApiResponse(false, "Rejection comments are required"));

    const correction = await prisma.attendanceCorrection.update({
      where: { id },
      data: { status: "REJECTED", resolvedAt: new Date() }
    });

    await prisma.approvalHistory.create({
      data: {
        correctionId: id,
        action: "REJECTED",
        actedById: userId,
        comments
      }
    });

    return res.status(200).json(new ApiResponse(true, "Correction rejected", correction));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};
