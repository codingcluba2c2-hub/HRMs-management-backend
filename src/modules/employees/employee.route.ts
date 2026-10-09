import { Router } from 'express';
import { 
  createEmployee, getEmployees, updateEmployee, deleteEmployee,
  getDashboardSummary, getAnalytics, getEmployeeDetails, bulkOperations,
  updateEmployeeOrganization, bulkCreateEmployee,
  assignManagerRole, removeManagerRole, getManagerScope, updateManagerScope
} from './employee.controller';
import { authenticate } from '../../middlewares/authMiddleware';
import { validateRequest } from '../../middlewares/validateRequest';
import { createEmployeeSchema, updateEmployeeSchema, bulkCreateEmployeeSchema } from './employee.schema';
import { authorizeRoles } from '../../middlewares/rbacMiddleware';
import { CANONICAL_ROLES } from '../../utils/roleConstants';

const router = Router();

router.use(authenticate); // All routes require authentication

// Fixed routes first to avoid :id collisions
router.get('/dashboard', getDashboardSummary);
router.get('/analytics', getAnalytics);
router.post('/bulk', bulkOperations);
router.post('/bulk-create', validateRequest({ body: bulkCreateEmployeeSchema }), bulkCreateEmployee);

router.route('/')
  .post(validateRequest({ body: createEmployeeSchema }), createEmployee)
  .get(getEmployees);

router.patch('/:id/organization', updateEmployeeOrganization);

// Manager Role Assignment & Scope Routes (HR Admin & Super Admin)
router.post('/:id/assign-manager', authorizeRoles(CANONICAL_ROLES.SUPER_ADMIN, CANONICAL_ROLES.HR_ADMIN), assignManagerRole);
router.post('/:id/remove-manager', authorizeRoles(CANONICAL_ROLES.SUPER_ADMIN, CANONICAL_ROLES.HR_ADMIN), removeManagerRole);
router.get('/:id/manager-scope', authorizeRoles(CANONICAL_ROLES.SUPER_ADMIN, CANONICAL_ROLES.HR_ADMIN, CANONICAL_ROLES.MANAGER), getManagerScope);
router.put('/:id/manager-scope', authorizeRoles(CANONICAL_ROLES.SUPER_ADMIN, CANONICAL_ROLES.HR_ADMIN), updateManagerScope);

router.route('/:id')
  .put(validateRequest({ body: updateEmployeeSchema }), updateEmployee)
  .delete(deleteEmployee);

router.get('/:id/details', getEmployeeDetails);

export default router;

