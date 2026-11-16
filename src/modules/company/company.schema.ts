import { z } from 'zod';

export const updateCompanySchema = z.object({
  companyName: z
    .string()
    .trim()
    .min(2, 'Company name must be at least 2 characters')
    .max(120, 'Company name cannot exceed 120 characters')
    .optional()
    .nullable()
    .or(z.literal('')),
  companyWebsite: z
    .string()
    .trim()
    .max(250, 'Website URL cannot exceed 250 characters')
    .optional()
    .nullable()
    .or(z.literal('')),
  companyAddress: z
    .string()
    .trim()
    .max(500, 'Address cannot exceed 500 characters')
    .optional()
    .nullable()
    .or(z.literal('')),
  companyPhone: z
    .string()
    .trim()
    .max(50, 'Phone number cannot exceed 50 characters')
    .optional()
    .nullable()
    .or(z.literal('')),
  latitude: z.union([z.number(), z.string().transform(v => Number(v))]).optional().nullable(),
  longitude: z.union([z.number(), z.string().transform(v => Number(v))]).optional().nullable(),
  radiusMeters: z.union([z.number(), z.string().transform(v => Number(v))]).optional().nullable(),
});
