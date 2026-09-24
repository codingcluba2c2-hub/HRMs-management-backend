import { z } from 'zod';

export const createLeaveRequestSchema = z.object({
  leaveType: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  reason: z.string(),
  documentUrl: z.string().optional().nullable(),
});

export const updateLeaveStatusSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  comments: z.string().optional().nullable(),
});
