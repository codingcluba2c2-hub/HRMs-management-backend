import { z } from 'zod';
import { emailValidation, nameValidation } from '../../validations/common.schema';

export const createCandidateSchema = z.object({
  firstName: nameValidation,
  lastName: nameValidation,
  email: emailValidation,
  jobRoleId: z.string().uuid("Invalid Job Role ID"),
  resumeLink: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  currentLocation: z.string().optional().nullable(),
  experienceYears: z.union([z.number(), z.string()]).optional().nullable(),
  currentCompany: z.string().optional().nullable(),
  currentCtc: z.string().optional().nullable(),
  expectedCtc: z.string().optional().nullable(),
  noticePeriod: z.string().optional().nullable(),
  skills: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
});

export const updateCandidateSchema = z.object({
  interviewStatus: z.string().optional(),
  status: z.string().optional(),
  jobRoleId: z.string().uuid("Invalid Job Role ID").optional(),
  screeningNotes: z.string().optional().nullable(),
  reason: z.string().optional().nullable(),
});

export const createJobRoleSchema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters").max(150),
  description: z.string().optional().nullable(),
  slug: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
  responsibilities: z.string().optional().nullable(),
  qualifications: z.string().optional().nullable(),
  skills: z.string().optional().nullable(),
  minExperience: z.union([z.number(), z.string()]).optional().nullable(),
  maxExperience: z.union([z.number(), z.string()]).optional().nullable(),
  workLocation: z.string().optional().nullable(),
  workMode: z.string().optional().nullable(),
  employmentType: z.string().optional().nullable(),
  minSalary: z.union([z.number(), z.string()]).optional().nullable(),
  maxSalary: z.union([z.number(), z.string()]).optional().nullable(),
  currency: z.string().optional().nullable(),
  showSalary: z.union([z.boolean(), z.string()]).optional().nullable(),
  openings: z.union([z.number(), z.string()]).optional().nullable(),
  benefits: z.string().optional().nullable(),
  deadline: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
});

export const updateJobRoleSchema = createJobRoleSchema.partial();
