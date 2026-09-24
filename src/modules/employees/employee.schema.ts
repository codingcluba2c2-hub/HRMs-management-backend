import { z } from 'zod';
import { emailValidation, employeeNameValidation, phoneValidation, empIdValidation, dateValidation } from '../../validations/common.schema';

export const createEmployeeSchema = z.object({
  employeeId: empIdValidation,
  firstName: employeeNameValidation,
  lastName: employeeNameValidation,
  email: emailValidation,
  phone: phoneValidation.optional(),
  gender: z.string().optional(),
  dob: z.string().optional(),
  departmentId: z.string().uuid('Invalid Department ID').optional(),
  designationId: z.string().uuid('Invalid Designation ID').optional(),
  departmentName: z.string().optional(),
  designationName: z.string().optional(),
  baseSalary: z.union([z.string(), z.number()]).optional(),
  joiningDate: dateValidation,
  employmentType: z.string().optional(),
  managerId: z.string().uuid('Invalid Manager ID').optional(),
  status: z.string().optional(),
  password: z.string().min(8).optional(),
});

export const bulkCreateEmployeeSchema = z.object({
  employees: z.array(createEmployeeSchema),
});

export const updateEmployeeSchema = createEmployeeSchema.partial();
