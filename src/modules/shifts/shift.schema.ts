import { z } from 'zod';

export const createShiftSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  startTime: z.string(),
  endTime: z.string(),
  graceTime: z.number().optional(),
  breakDuration: z.number().optional(),
  weeklyOff: z.array(z.string()).optional(),
  status: z.boolean().optional(),
});

export const updateShiftSchema = createShiftSchema.partial();

export const assignShiftSchema = z.object({
  employeeIds: z.array(z.string()).min(1, "Select at least one employee"),
  shiftId: z.string().nullable().optional(),
});

