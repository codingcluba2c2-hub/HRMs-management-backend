import { z } from 'zod';
import { emailValidation, nameValidation } from '../../validations/common.schema';

export const createCandidateSchema = z.object({
  firstName: nameValidation,
  lastName: nameValidation,
  email: emailValidation,
  jobRoleId: z.string().uuid("Invalid Job Role ID"),
  resumeLink: z.string().optional().nullable(),
});

export const updateCandidateSchema = z.object({
  interviewStatus: z.string().optional(),
  status: z.string().optional(),
  jobRoleId: z.string().uuid("Invalid Job Role ID").optional(),
});

export const createJobRoleSchema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters").max(100),
  description: z.string().optional().nullable(),
});
