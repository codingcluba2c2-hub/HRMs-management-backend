import { z } from 'zod';
import { nameValidation } from '../../validations/common.schema';

export const createDesignationSchema = z.object({
  name: nameValidation,
  level: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  departmentId: z.string().uuid('Invalid Department ID'),
});

export const updateDesignationSchema = createDesignationSchema.partial();
