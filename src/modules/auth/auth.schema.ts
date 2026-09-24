import { z } from 'zod';
import { emailValidation, passwordValidation, otpValidation, nameValidation } from '../../validations/common.schema';

// Standard Email/Password login validation
export const loginSchema = z.object({
  email: emailValidation,
  password: z.string().min(1, 'Password is required'), // Don't use strict password validation for login
});

// Initiating password reset via email
export const forgotPasswordSchema = z.object({
  email: emailValidation,
});

// Verifying the 6-digit code sent to email
export const verifyOtpSchema = z.object({
  email: emailValidation,
  otp: otpValidation,
});

// Submitting a new password after successful OTP verification
export const resetPasswordSchema = z.object({
  email: emailValidation,
  password: passwordValidation,
});

// Validates a brand new user signing up
export const registerSchema = z.object({
  firstName: nameValidation,
  lastName: nameValidation,
  email: emailValidation,
  password: passwordValidation,
  confirmPassword: z.string().min(1, 'Confirm password is required'),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});
