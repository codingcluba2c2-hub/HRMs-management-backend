import { z } from 'zod';

export const createShiftSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  startTime: z.string(),
  endTime: z.string(),
});

export const updateShiftSchema = createShiftSchema.partial();
