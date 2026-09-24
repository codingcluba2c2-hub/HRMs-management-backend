import { z } from 'zod';

// Reusable regex patterns
const nameRegex = /^[a-zA-Z\s\'-]+$/;
const phoneRegex = /^(\+91|91)?[6789]\d{9}$/;
const aadhaarRegex = /^\d{12}$/;
const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const passportRegex = /^[A-PR-WYa-pr-wy][1-9]\d\s?\d{4}[1-9]$/;
const empIdRegex = /^EMP-\d+$/;
const otpRegex = /^\d{6}$/;

/**
 * Common Name Validation
 * - Trims whitespace
 * - 2-50 chars
 * - Only alphabets, spaces, apostrophes, hyphens
 * - Rejects multiple consecutive spaces internally
 */
export const nameValidation = z
  .string({ required_error: 'Name is required' })
  .trim()
  .min(2, 'Name must be at least 2 characters long')
  .max(50, 'Name cannot exceed 50 characters')
  .regex(nameRegex, 'Name can only contain alphabets, spaces, apostrophes, and hyphens')
  .refine((val) => !/\s{2,}/.test(val), { message: 'Name cannot contain consecutive spaces' });

/**
 * Employee Name Validation (No spaces allowed)
 */
export const employeeNameValidation = z
  .string({ required_error: 'Name is required' })
  .trim()
  .min(2, 'Name must be at least 2 characters long')
  .max(50, 'Name cannot exceed 50 characters')
  .regex(/^[a-zA-Z\'-]+$/, 'Name can only contain alphabets, apostrophes, and hyphens (no spaces allowed)');

/**
 * Common Email Validation
 * - RFC compliant, max length 254
 * - Trims and lowercases
 */
export const emailValidation = z
  .string({ required_error: 'Email is required' })
  .trim()
  .toLowerCase()
  .email('Invalid email format')
  .max(254, 'Email cannot exceed 254 characters');

/**
 * Indian Phone Number Validation
 */
export const phoneValidation = z
  .string({ required_error: 'Phone number is required' })
  .trim()
  .transform(val => val.replace(/[\s-]/g, '')) // Remove spaces/hyphens
  .refine((val) => phoneRegex.test(val), {
    message: 'Invalid Indian phone number. Must be 10 digits or start with +91',
  });

/**
 * Enterprise Password Validation
 * - 8-128 chars
 * - Requires uppercase, lowercase, number, special char
 */
export const passwordValidation = z
  .string({ required_error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters long')
  .max(128, 'Password cannot exceed 128 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[^a-zA-Z0-9]/, 'Password must contain at least one special character')
  .refine(
    (val) => !/^(Password123|12345678|abcdefgh|qwerty)$/i.test(val),
    'Password is too common'
  );

/**
 * Address Validation
 */
export const addressValidation = z
  .string()
  .trim()
  .min(5, 'Address must be at least 5 characters')
  .max(255, 'Address cannot exceed 255 characters')
  .regex(/^[^<>&]*$/, 'Address contains invalid characters (HTML tags not allowed)');

/**
 * OTP Validation
 */
export const otpValidation = z
  .string({ required_error: 'OTP is required' })
  .trim()
  .regex(otpRegex, 'OTP must be exactly 6 digits');

/**
 * Salary Validation
 */
export const salaryValidation = z
  .number({ required_error: 'Salary is required' })
  .positive('Salary must be a positive number')
  .max(99999999.99, 'Salary exceeds maximum allowed value')
  .refine((val) => Number.isInteger(val * 100), 'Salary can have up to 2 decimal places');

/**
 * Aadhaar Validation
 */
export const aadhaarValidation = z
  .string()
  .trim()
  .regex(aadhaarRegex, 'Aadhaar must be exactly 12 digits');

/**
 * PAN Validation
 */
export const panValidation = z
  .string()
  .trim()
  .toUpperCase()
  .regex(panRegex, 'Invalid PAN format (e.g. ABCDE1234F)');

/**
 * Passport Validation (Indian)
 */
export const passportValidation = z
  .string()
  .trim()
  .toUpperCase()
  .regex(passportRegex, 'Invalid Indian Passport format');

/**
 * Employee ID Validation
 */
export const empIdValidation = z
  .string()
  .trim()
  .regex(empIdRegex, 'Invalid Employee ID format (e.g. EMP-000123)');

/**
 * Pincode Validation
 */
export const pincodeValidation = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Pincode must be exactly 6 digits');

/**
 * Search Query Validation (Max 100 chars, no HTML)
 */
export const searchValidation = z
  .string()
  .trim()
  .max(100, 'Search query cannot exceed 100 characters')
  .regex(/^[^<>&]*$/, 'Search query contains invalid characters')
  .optional();

/**
 * Enterprise Date Validation
 * - Enforces YYYY-MM-DD format
 * - Ensures it's a valid calendar date
 */
export const dateValidation = z
  .string({ required_error: 'Date is required' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine((val) => !isNaN(Date.parse(val)), 'Invalid calendar date')
  .refine((val) => {
    const date = new Date(val);
    const minDate = new Date('1950-01-01');
    return date >= minDate;
  }, 'Date cannot be earlier than 1950')
  .refine((val) => {
    const date = new Date(val);
    const maxDate = new Date();
    maxDate.setFullYear(maxDate.getFullYear() + 5);
    return date <= maxDate;
  }, 'Date cannot be more than 5 years in the future');
