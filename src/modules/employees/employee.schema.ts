import { z } from 'zod';
import { emailValidation, employeeNameValidation, phoneValidation, empIdValidation, dateValidation } from '../../validations/common.schema';

const emptyStringToUndefined = (val: any) => (val === '' || val === null ? undefined : val);

export const createEmployeeSchema = z.object({
  employeeId: empIdValidation,
  firstName: employeeNameValidation,
  lastName: employeeNameValidation,
  email: emailValidation,
  phone: z.preprocess(emptyStringToUndefined, phoneValidation.optional()),
  gender: z.preprocess(emptyStringToUndefined, z.string().optional()),
  dob: z.preprocess(emptyStringToUndefined, z.string().optional()),
  departmentId: z.preprocess(emptyStringToUndefined, z.string().uuid('Invalid Department ID').optional()),
  designationId: z.preprocess(emptyStringToUndefined, z.string().uuid('Invalid Designation ID').optional()),
  departmentName: z.string().optional(),
  designationName: z.string().optional(),
  baseSalary: z.preprocess(emptyStringToUndefined, z.union([z.string(), z.number()]).optional()),
  joiningDate: dateValidation,
  employmentType: z.string().optional(),
  managerId: z.preprocess(emptyStringToUndefined, z.string().uuid('Invalid Manager ID').optional()),
  status: z.string().optional(),
  password: z.preprocess(emptyStringToUndefined, z.string().min(8).optional()),
});

export const bulkCreateEmployeeSchema = z.object({
  employees: z.array(createEmployeeSchema),
});

export const updateEmployeeSchema = createEmployeeSchema.partial();
