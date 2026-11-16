import { z } from 'zod';
import { emailValidation, nameValidation, phoneValidation, passwordValidation, addressValidation, pincodeValidation } from '../../validations/common.schema';

// Helper to preprocess empty strings or whitespace to null
const emptyToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((val) => {
    if (typeof val === 'string' && val.trim() === '') return null;
    return val;
  }, schema.optional().nullable());

export const updatePersonalSchema = z.object({
  firstName: nameValidation,
  lastName: z.preprocess(
    (val) => (typeof val === 'string' ? val.trim() : val),
    z.string().min(1, 'Last name must be at least 1 character').max(50).regex(/^[a-zA-Z\s\'-.]+$/, 'Invalid last name format').optional().nullable().or(z.literal(''))
  ),
  gender: z.string().optional(),
  dob: z.preprocess((val) => (typeof val === 'string' && val.trim() === '' ? null : val), z.string().optional().nullable()),
  bloodGroup: z.string().optional().nullable(),
  maritalStatus: z.string().optional().nullable(),
  nationality: z.string().optional().nullable(),
});

export const updateContactSchema = z.object({
  phone: emptyToNull(phoneValidation),
  alternatePhone: emptyToNull(phoneValidation),
  emergencyEmail: emptyToNull(emailValidation),
  address: emptyToNull(addressValidation),
  city: z.preprocess((val) => (typeof val === 'string' && val.trim() === '' ? null : val), z.string().optional().nullable()),
  state: z.preprocess((val) => (typeof val === 'string' && val.trim() === '' ? null : val), z.string().optional().nullable()),
  country: z.preprocess((val) => (typeof val === 'string' && val.trim() === '' ? null : val), z.string().optional().nullable()),
  postalCode: emptyToNull(pincodeValidation),
  emergencyContactName: emptyToNull(nameValidation),
  emergencyContactRelation: z.preprocess((val) => (typeof val === 'string' && val.trim() === '' ? null : val), z.string().optional().nullable()),
  emergencyContactPhone: emptyToNull(phoneValidation),
  emergencyContactAddress: emptyToNull(addressValidation),
});

export const updateBankSchema = z.object({
  bankName: z.preprocess((val) => (typeof val === 'string' && val.trim() === '' ? null : val), z.string().optional().nullable()),
  accountNumber: emptyToNull(z.string().regex(/^\d{9,18}$/, 'Invalid Account Number')),
  ifsc: emptyToNull(z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC Code')),
  upiId: emptyToNull(z.string().regex(/^[\w.-]+@[\w.-]+$/, 'Invalid UPI ID')),
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
