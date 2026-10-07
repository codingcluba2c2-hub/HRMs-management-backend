import { z } from 'zod';

export const createLeaveRequestSchema = z.object({
  leaveType: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  halfDay: z.boolean().optional(),
  workFromHome: z.boolean().optional(),
  emergencyLeave: z.boolean().optional(),
  description: z.string().optional().nullable(),
  reason: z.string().optional().nullable(),
  attachment: z.string().optional().nullable(),
  documentUrl: z.string().optional().nullable(),
  employeeId: z.string().optional().nullable(),
});

export const updateLeaveStatusSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'CANCELLED', 'UNDER_REVIEW']),
  comments: z.string().optional().nullable(),
});
