import { Router } from 'express';
import { 
  getLeaveSummary, 
  getLeaveRequests, 
  getMyLeaves, 
  createLeaveRequest, 
  updateLeaveStatus, 
  getLeaveAnalytics, 
  getLeaveCalendar,
  getLeaveTypes,
  createLeaveType,
  updateLeaveType,
  deleteLeaveType,
  getLeavePolicies,
  updateLeavePolicy,
  getAllEmployeeBalances,
  updateEmployeeBalance,
  getLeaveLedgerLogs
} from './leave.controller';
import { authenticate } from '../../middlewares/authMiddleware';

const router = Router();

router.use(authenticate);

// General & Summary
router.get('/summary', getLeaveSummary);
router.get('/calendar', getLeaveCalendar);
router.get('/analytics', getLeaveAnalytics);
router.get('/ledger', getLeaveLedgerLogs);

// Master Leave Types
router.get('/types', getLeaveTypes);
router.post('/types', createLeaveType);
router.put('/types/:id', updateLeaveType);
router.delete('/types/:id', deleteLeaveType);

// Master Policies
router.get('/policies', getLeavePolicies);
router.put('/policies/:id', updateLeavePolicy);

// Employee Balances for HR
router.get('/balances', getAllEmployeeBalances);
router.put('/balances/:employeeId', updateEmployeeBalance);

// Employee Self-Service
router.get('/my', getMyLeaves);
router.post('/my', createLeaveRequest);

// Requests & Approval
router.get('/', getLeaveRequests);
router.post('/', createLeaveRequest);
router.put('/:id/status', updateLeaveStatus);
router.put('/:id/approval', updateLeaveStatus);

export default router;
