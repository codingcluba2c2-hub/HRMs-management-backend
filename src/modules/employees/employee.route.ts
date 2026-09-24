import { Router } from 'express';
import { 
  createEmployee, getEmployees, updateEmployee, deleteEmployee,
  getDashboardSummary, getAnalytics, getEmployeeDetails, bulkOperations,
  updateEmployeeOrganization
} from './employee.controller';
import { authenticate } from '../../middlewares/authMiddleware';

const router = Router();

router.use(authenticate); // All routes require authentication

// Fixed routes first to avoid :id collisions
router.get('/dashboard', getDashboardSummary);
router.get('/analytics', getAnalytics);
router.post('/bulk', bulkOperations);

router.route('/')
  .post(createEmployee)
  .get(getEmployees);

router.patch('/:id/organization', updateEmployeeOrganization);

router.route('/:id')
  .put(updateEmployee)
  .delete(deleteEmployee);

router.get('/:id/details', getEmployeeDetails);

export default router;

