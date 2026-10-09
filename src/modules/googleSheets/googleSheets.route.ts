import { Router } from 'express';
import { authenticate } from '../../middlewares/authMiddleware';
import { authorizeRoles } from '../../middlewares/rbacMiddleware';
import { GoogleSheetsController } from './googleSheets.controller';

const router = Router();

// Apply authentication to all Google Sheets integration endpoints
router.use(authenticate);

// Restricted to administrative roles SUPER_ADMIN and HR_ADMIN
router.use(authorizeRoles('SUPER_ADMIN', 'HR_ADMIN'));

router.get('/status', GoogleSheetsController.getStatus);
router.post('/config', GoogleSheetsController.updateConfig);
router.post('/test-connection', GoogleSheetsController.testConnection);
router.post('/initialize', GoogleSheetsController.initialize);
router.post('/sync-now', GoogleSheetsController.syncNow);
router.post('/retry-failed', GoogleSheetsController.retryFailed);

export default router;
