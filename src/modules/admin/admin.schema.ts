import { z } from 'zod';
import { emailValidation, nameValidation, phoneValidation } from '../../validations/common.schema';

// Validation rules for creating a new user (Super Admin creating a new HR Admin/Employee)
export const createUserSchema = z.object({
  firstName: nameValidation,
  lastName: nameValidation,
  email: emailValidation,
  password: z.string().min(6, "Password must be at least 6 characters"),
  phone: phoneValidation.optional().nullable(),
  roleId: z.string().min(1, "Role is required"),
  companyName: z.string().optional().nullable(),
  companyWebsite: z.string().optional().nullable(),
  companyAddress: z.string().optional().nullable(),
  companyPhone: z.string().optional().nullable(),
});

// Validation rules for updating a user
export const updateUserSchema = z.object({
  firstName: nameValidation.optional(),
  lastName: nameValidation.optional(),
  email: emailValidation.optional(),
  password: z.string().min(6, "Password must be at least 6 characters").optional().nullable(),
  phone: phoneValidation.optional().nullable(),
  roleId: z.string().optional().nullable(),
  companyName: z.string().optional().nullable(),
  companyWebsite: z.string().optional().nullable(),
  companyAddress: z.string().optional().nullable(),
  companyPhone: z.string().optional().nullable(),
});

// Validation rules for creating a new custom Role
export const createRoleSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(50),
  description: z.string().optional().nullable(),
});

// Validation rules for updating a Role
export const updateRoleSchema = createRoleSchema.partial();

// Validation rules for creating a new Permission
export const createPermissionSchema = z.object({
  action: z.string().min(2, "Action must be at least 2 characters"),
  resource: z.string().min(2, "Resource must be at least 2 characters"),
  description: z.string().optional().nullable(),
});

// Validation rules for updating a Permission
export const updatePermissionSchema = createPermissionSchema.partial();

// Validation rules for global system settings
export const createSettingSchema = z.object({
  key: z.string().min(2, "Key must be at least 2 characters"),
  value: z.string().min(1, "Value is required"),
  description: z.string().optional().nullable(),
  isPublic: z.boolean().default(false),
});

// Validation rules for updating system settings
export const updateSettingSchema = createSettingSchema.partial();
