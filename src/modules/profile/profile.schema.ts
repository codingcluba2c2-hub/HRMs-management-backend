import { z } from 'zod';

export const updatePersonalSchema = z.object({
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  gender: z.string().optional(),
  dob: z.string().optional().nullable(),
  bloodGroup: z.string().optional().nullable(),
  maritalStatus: z.string().optional().nullable(),
  nationality: z.string().optional().nullable(),
});

export const updateContactSchema = z.object({
  phone: z.string().optional().nullable(),
  alternatePhone: z.string().optional().nullable(),
  emergencyEmail: z.string().email().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  emergencyContactName: z.string().optional().nullable(),
  emergencyContactRelation: z.string().optional().nullable(),
  emergencyContactPhone: z.string().optional().nullable(),
  emergencyContactAddress: z.string().optional().nullable(),
});

export const updateBankSchema = z.object({
  bankName: z.string().optional().nullable(),
  accountNumber: z.string().optional().nullable(),
  ifsc: z.string().optional().nullable(),
  upiId: z.string().optional().nullable(),
});

export const updateSkillsSchema = z.object({
  skills: z.array(
    z.object({
      name: z.string(),
      level: z.string(),
      type: z.string()
    })
  ).optional(),
  certifications: z.array(
    z.object({
      name: z.string(),
      issuer: z.string(),
      issueDate: z.string(),
      url: z.string().optional().nullable()
    })
  ).optional(),
});

export const updatePreferencesSchema = z.object({
  preferences: z.record(z.any()),
});

export const updateSecuritySchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(6),
});
