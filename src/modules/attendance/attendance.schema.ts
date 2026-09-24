import { z } from 'zod';

// Validates requests from employees asking to fix their attendance (e.g. forgot to punch in)
export const createCorrectionSchema = z.object({
  date: z.string(),
  reason: z.string(),
  correctionType: z.string(),
  time: z.string().optional().nullable(),
});

// Validates HR/Admin action when approving or rejecting a correction
export const updateCorrectionStatusSchema = z.object({
  comments: z.string().optional().nullable(),
});

// Validates manual attendance entries made by admins
export const manualAttendanceSchema = z.object({
  employeeId: z.string(),
  date: z.string(),
  punchIn: z.string().optional().nullable().or(z.literal('')),
  punchOut: z.string().optional().nullable().or(z.literal('')),
  status: z.string().optional().nullable(),
  shiftId: z.string().optional().nullable().or(z.literal('')),
});
