import { Router } from 'express';
import { getCompanyDetails, updateCompanyDetails } from './company.controller';
import { authenticate } from '../../middlewares/authMiddleware';
import { authorizeRoles } from '../../middlewares/rbacMiddleware';

const router = Router();

router.use(authenticate);

router.get('/', getCompanyDetails);
router.put('/', authorizeRoles('Super Admin', 'HR Admin'), updateCompanyDetails);

export default router;
