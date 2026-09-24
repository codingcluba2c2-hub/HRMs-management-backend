import { Router } from 'express';
import { getAll, create } from './shift.controller';
import { authenticate } from '../../middlewares/authMiddleware';

const router = Router();

router.use(authenticate);

router.route('/')
  .get(getAll)
  .post(create);

export default router;
