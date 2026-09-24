import { Router } from 'express';
import { getAll, create, update, remove } from './holiday.controller';
import { authenticate } from '../../middlewares/authMiddleware';
import { validateRequest } from '../../middlewares/validateRequest';
import { createHolidaySchema, updateHolidaySchema } from './holiday.schema';

const router = Router();

router.use(authenticate);

router.route('/')
  .get(getAll)
  .post(validateRequest({ body: createHolidaySchema }), create);

router.route('/:id')
  .put(validateRequest({ body: updateHolidaySchema }), update)
  .delete(remove);

router.route('/:id')
  .put(update)
  .delete(remove);

export default router;
