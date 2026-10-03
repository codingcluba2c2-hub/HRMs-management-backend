import { Router } from 'express';
import {
  getRoster,
  saveDraft,
  publishRoster,
  copyWeek,
  getRosterHistory,
  getAuditLogs,
  exportXlsx,
  downloadTemplate,
  importXlsx,
  getEmployeeSchedule
} from './roster.controller';
import { authenticate } from '../../middlewares/authMiddleware';

const router = Router();

router.use(authenticate);

router.get('/my-schedule', getEmployeeSchedule);
router.get('/history', getRosterHistory);
router.get('/audit-logs/:rosterId', getAuditLogs);
router.get('/download-template', downloadTemplate);

router.get('/', getRoster);
router.post('/save-draft', saveDraft);
router.post('/publish', publishRoster);
router.post('/copy-week', copyWeek);
router.post('/export-xlsx', exportXlsx);
router.post('/import-xlsx', importXlsx);

export default router;
