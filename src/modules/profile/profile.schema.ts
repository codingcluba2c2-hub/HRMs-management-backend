import { z } from 'zod';
import { emailValidation, nameValidation, phoneValidation, passwordValidation, addressValidation, pincodeValidation } from '../../validations/common.schema';

export const updatePersonalSchema = z.object({
  firstName: nameValidation,
  lastName: nameValidation,
  gender: z.string().optional(),
  dob: z.string().optional().nullable(),
  bloodGroup: z.string().optional().nullable(),
  maritalStatus: z.string().optional().nullable(),
  nationality: z.string().optional().nullable(),
});

export const updateContactSchema = z.object({
  phone: phoneValidation.optional().nullable(),
  alternatePhone: phoneValidation.optional().nullable(),
  emergencyEmail: emailValidation.optional().nullable(),
  address: addressValidation.optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  postalCode: pincodeValidation.optional().nullable(),
  emergencyContactName: nameValidation.optional().nullable(),
  emergencyContactRelation: z.string().optional().nullable(),
  emergencyContactPhone: phoneValidation.optional().nullable(),
  emergencyContactAddress: addressValidation.optional().nullable(),
});

export const updateBankSchema = z.object({
  bankName: z.string().optional().nullable(),
  accountNumber: z.string().regex(/^\d{9,18}$/, 'Invalid Account Number').optional().nullable(),
  ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC Code').optional().nullable(),
  upiId: z.string().regex(/^[\w.-]+@[\w.-]+$/, 'Invalid UPI ID').optional().nullable(),
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
  newPassword: passwordValidation,
});
