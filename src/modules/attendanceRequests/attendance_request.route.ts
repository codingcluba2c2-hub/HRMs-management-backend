import { Router } from 'express';
import { getAll, create } from './attendance_request.controller';
import { authenticate } from '../../middlewares/authMiddleware';

const router = Router();

router.use(authenticate);

router.route('/')
  .get(getAll)
  .post(create);

export default router;
