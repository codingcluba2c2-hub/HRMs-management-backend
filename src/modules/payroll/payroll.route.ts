import { Router } from 'express';
import { 
  getPayrollSummary, 
  getPayrollRecords, 
  getPayrollAnalytics, 
  getTimelineActivities, 
  createPayrollQuery,
  getPayslipById,
  downloadPayslipPdf,
  createPayrollRecord,
  deletePayrollRecord
} from './payroll.controller';
import { authenticate } from '../../middlewares/authMiddleware';

const router = Router();

router.use(authenticate);

router.get('/summary', getPayrollSummary);
router.get('/analytics', getPayrollAnalytics);
router.get('/timeline', getTimelineActivities);

// Get payrolls (HR sees all, Employee sees own)
router.get('/', getPayrollRecords);
router.post('/', createPayrollRecord);
router.delete('/:id', deletePayrollRecord);

// Payslip details & PDF stream
router.get('/:id/pdf', downloadPayslipPdf);
router.get('/:id', getPayslipById);

// Submit queries
router.post('/query', createPayrollQuery);

export default router;

