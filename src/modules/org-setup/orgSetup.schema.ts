import { z } from 'zod';

export const assignManagerSchema = z.object({
  departmentId: z.string().uuid("Invalid Department ID"),
  employeeId: z.string().uuid("Invalid Employee ID"),
});
