import { Router } from 'express';
import { 
  punchIn, 
  punchOut, 
  startBreak, 
  endBreak, 
  getStatus, 
  getAllRecords, 
  createManual, 
  updateManual, 
  deleteManual, 
  getMyAttendance, 
  getMySummary, 
  getMyCharts,
  getAdminSummary,
  getAdminRecords,
  hrPunchIn,
  hrPunchOut,
  hrResumeWork,
  hrCorrectAttendance,
  exportAdminExcel
} from './attendance.controller';
import { createCorrection, getMyCorrections, getPendingCorrections, approveCorrection, rejectCorrection } from './attendanceCorrection.controller';
import { authenticate } from '../../middlewares/authMiddleware';

const router = Router();

router.use(authenticate);

// Admin Console routes
router.get('/admin/summary', getAdminSummary);
router.get('/admin/records', getAdminRecords);
router.get('/admin/export', exportAdminExcel);
router.post('/admin/punch-in', hrPunchIn);
router.post('/admin/punch-out', hrPunchOut);
router.post('/admin/resume', hrResumeWork);
router.post('/admin/correct', hrCorrectAttendance);

// Correction routes
router.post('/corrections', createCorrection);
router.get('/corrections/my', getMyCorrections);
router.get('/corrections/pending', getPendingCorrections);
router.put('/corrections/:id/approve', approveCorrection);
router.put('/corrections/:id/reject', rejectCorrection);

router.get('/status', getStatus);
router.post('/punch-in', punchIn);
router.post('/punch-out', punchOut);
router.post('/break-start', startBreak);
router.post('/break-end', endBreak);
router.get('/my/summary', getMySummary);
router.get('/my/charts', getMyCharts);
router.get('/my', getMyAttendance);
router.post('/manual', createManual);
router.put('/:id', updateManual);
router.delete('/:id', deleteManual);
router.get('/', getAllRecords);

export default router;

