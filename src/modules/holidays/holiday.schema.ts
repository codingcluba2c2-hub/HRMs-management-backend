import { z } from 'zod';

export const createHolidaySchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  date: z.string(), // Consider custom date format validation if needed
  type: z.string().optional().nullable(),
});

export const updateHolidaySchema = createHolidaySchema.partial();
