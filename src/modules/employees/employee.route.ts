import { Router } from 'express';
import { 
  createEmployee, getEmployees, updateEmployee, deleteEmployee,
  getDashboardSummary, getAnalytics, getEmployeeDetails, bulkOperations,
  updateEmployeeOrganization, bulkCreateEmployee
} from './employee.controller';
import { authenticate } from '../../middlewares/authMiddleware';
import { validateRequest } from '../../middlewares/validateRequest';
import { createEmployeeSchema, updateEmployeeSchema, bulkCreateEmployeeSchema } from './employee.schema';

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

router.route('/:id')
  .put(validateRequest({ body: updateEmployeeSchema }), updateEmployee)
  .delete(deleteEmployee);

router.get('/:id/details', getEmployeeDetails);

export default router;

