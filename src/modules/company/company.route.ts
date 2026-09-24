import { Router } from 'express';
import { getCompanyDetails, updateCompanyDetails } from './company.controller';
import { authenticate } from '../../middlewares/authMiddleware';
import { authorizeRoles } from '../../middlewares/rbacMiddleware';
import { validateRequest } from '../../middlewares/validateRequest';
import { updateCompanySchema } from './company.schema';

const router = Router();

router.use(authenticate);

router.get('/', getCompanyDetails);
router.put('/', authorizeRoles('Super Admin', 'HR Admin'), validateRequest({ body: updateCompanySchema }), updateCompanyDetails);

export default router;
