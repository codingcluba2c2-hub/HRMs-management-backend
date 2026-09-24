import { Router } from 'express';
import { getAll, create, update, remove } from './holiday.controller';
import { authenticate } from '../../middlewares/authMiddleware';

const router = Router();

router.use(authenticate);

router.route('/')
  .get(getAll)
  .post(create);

router.route('/:id')
  .put(update)
  .delete(remove);

export default router;
