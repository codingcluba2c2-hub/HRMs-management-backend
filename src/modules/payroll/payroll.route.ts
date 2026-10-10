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
  deletePayrollRecord,
  calculatePayrollPreview
} from './payroll.controller';
import { authenticate } from '../../middlewares/authMiddleware';
import { validateRequest } from '../../middlewares/validateRequest';
import { createPayrollQuerySchema, createPayrollSchema } from './payroll.schema';

const router = Router();

router.use(authenticate);

router.get('/summary', getPayrollSummary);
router.get('/analytics', getPayrollAnalytics);
router.get('/timeline', getTimelineActivities);
router.get('/preview-calculation', calculatePayrollPreview);

// Get payrolls (HR sees all, Employee sees own)
router.get('/', getPayrollRecords);
router.post('/', createPayrollRecord);
router.delete('/:id', deletePayrollRecord);

// Payslip details & PDF stream
router.get('/:id/pdf', downloadPayslipPdf);
router.get('/:id', getPayslipById);

// Submit queries
router.post('/query', validateRequest({ body: createPayrollQuerySchema }), createPayrollQuery);

export default router;

