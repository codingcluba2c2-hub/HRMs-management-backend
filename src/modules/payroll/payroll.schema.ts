import { z } from 'zod';

export const createPayrollQuerySchema = z.object({
  subject: z.string().min(5, "Subject must be at least 5 characters").max(100),
  message: z.string().min(10, "Message must be at least 10 characters"),
  payrollId: z.string().uuid("Invalid Payroll ID").optional().nullable(),
});

export const createPayrollSchema = z.object({
  employeeId: z.string().uuid("Invalid Employee ID"),
  month: z.number().min(1).max(12),
  year: z.number().min(2000),
  basicSalary: z.number().min(0, "Basic Salary must be positive"),
  bonus: z.number().min(0).optional().default(0),
  deductions: z.number().min(0).optional().default(0),
  workingDays: z.number().min(0).max(31),
  paymentDate: z.string(), // ISO string date
  transactionId: z.string().optional(),
  status: z.enum(["PAID", "PENDING", "FAILED"]).default("PAID"),
  bankName: z.string().optional(),
  accountNumber: z.string().optional()
});
