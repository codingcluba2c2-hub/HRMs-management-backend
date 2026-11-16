import { Router } from 'express';
import { authenticate } from '../../middlewares/authMiddleware';
import { authorizeRoles } from '../../middlewares/rbacMiddleware';
import {
  getWorkforceMap,
  getOffices,
  createOffice,
  updateOffice,
  deleteOffice,
  getEmployeeDetails,
  getEmployeeHistory,
  updateConsent,
  ingestLiveLocation,
  purgeHistory
} from './workforce.controller';

const router = Router();

// All workforce routes require authentication
router.use(authenticate);

// Workforce Map & Real-time Tracking (HR_ADMIN, MANAGER, SUPER_ADMIN)
router.get('/map', authorizeRoles('SUPER_ADMIN', 'HR_ADMIN', 'MANAGER'), getWorkforceMap);

// Office Locations Management
router.get('/offices', authorizeRoles('SUPER_ADMIN', 'HR_ADMIN', 'MANAGER'), getOffices);
router.post('/offices', authorizeRoles('SUPER_ADMIN', 'HR_ADMIN'), createOffice);
router.put('/offices/:id', authorizeRoles('SUPER_ADMIN', 'HR_ADMIN'), updateOffice);
router.delete('/offices/:id', authorizeRoles('SUPER_ADMIN', 'HR_ADMIN'), deleteOffice);

// Employee Location & Timeline
router.get('/employee/:id/details', getEmployeeDetails);
router.get('/employee/:id/history', getEmployeeHistory);

// Employee-side Consent & Live GPS updates
router.post('/consent', updateConsent);
router.post('/live-location', ingestLiveLocation);

// Retention & Purge
router.post('/history/purge', authorizeRoles('SUPER_ADMIN', 'HR_ADMIN'), purgeHistory);

export default router;
