import { z } from 'zod';
import { nameValidation, addressValidation, phoneValidation } from '../../validations/common.schema';

export const updateCompanySchema = z.object({
  companyName: nameValidation.optional().nullable(),
  companyWebsite: z.string().url('Invalid website URL').optional().nullable(),
  companyAddress: addressValidation.optional().nullable(),
  companyPhone: phoneValidation.optional().nullable(),
});
