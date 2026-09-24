import { Router } from 'express';
import { getAll, create } from './attendance_request.controller';
import { authenticate } from '../../middlewares/authMiddleware';

const router = Router();

// Protect routes: user must be logged in
router.use(authenticate);

// Standard CRUD endpoints for Attendance Requests
router.route('/')
  .get(getAll)   // Fetch a list of attendance requests
  .post(create); // Submit a new attendance request

export default router;
