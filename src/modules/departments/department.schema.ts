import { z } from 'zod';
import { nameValidation } from '../../validations/common.schema';

export const createDepartmentSchema = z.object({
  name: nameValidation,
  code: z.string().min(2, 'Code must be at least 2 characters').max(20, 'Code max 20 chars'),
  description: z.string().optional().nullable(),
  status: z.boolean().optional(),
  managerId: z.string().optional().nullable().transform(val => val === "" ? null : val),
});

export const updateDepartmentSchema = createDepartmentSchema.partial();
