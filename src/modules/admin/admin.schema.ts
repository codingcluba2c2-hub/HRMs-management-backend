import { z } from 'zod';
import { emailValidation, nameValidation, phoneValidation } from '../../validations/common.schema';

// Validation rules for creating a new user (Super Admin creating a new HR Admin/Employee)
export const createUserSchema = z.object({
  firstName: nameValidation, // Ensure the first name meets our standard rules (e.g. min 2 chars)
  lastName: nameValidation,  // Ensure the last name meets our standard rules
  email: emailValidation,    // Ensure it looks like a real email address
  phone: phoneValidation.optional().nullable(), // Phone number is optional
  roleId: z.string().uuid("Invalid Role ID"), // Every user MUST be assigned a specific role
  
  // Optional company details if this user is a super admin for a specific company branch
  companyName: z.string().optional().nullable(),
  companyWebsite: z.string().optional().nullable(),
  companyAddress: z.string().optional().nullable(),
  companyPhone: z.string().optional().nullable(),
});

// Validation rules for updating a user (makes all fields from 'create' optional)
export const updateUserSchema = createUserSchema.partial();

// Validation rules for creating a new custom Role
export const createRoleSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(50), // Role name (e.g. "HR Manager")
  description: z.string().optional().nullable(), // Optional details about what this role does
});

// Validation rules for updating a Role
export const updateRoleSchema = createRoleSchema.partial();

// Validation rules for creating a new Permission (e.g. "VIEW", "USERS")
export const createPermissionSchema = z.object({
  action: z.string().min(2, "Action must be at least 2 characters"),     // What they can do (e.g., READ, WRITE, DELETE)
  resource: z.string().min(2, "Resource must be at least 2 characters"), // What they can do it to (e.g., USERS, PAYROLL)
  description: z.string().optional().nullable(),                         // Optional explanation
});

// Validation rules for updating a Permission
export const updatePermissionSchema = createPermissionSchema.partial();

// Validation rules for global system settings (e.g. "MAINTENANCE_MODE")
export const createSettingSchema = z.object({
  key: z.string().min(2, "Key must be at least 2 characters"),   // The setting name
  value: z.string().min(1, "Value is required"),                 // The setting value
  description: z.string().optional().nullable(),
  isPublic: z.boolean().default(false),                          // Can anyone see this setting, or just admins?
});

// Validation rules for updating system settings
export const updateSettingSchema = createSettingSchema.partial();
