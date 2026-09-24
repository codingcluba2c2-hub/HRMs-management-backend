import { Router } from 'express';
import { getAll, create, update } from './shift.controller';
import { authenticate } from '../../middlewares/authMiddleware';
import { validateRequest } from '../../middlewares/validateRequest';
import { createShiftSchema, updateShiftSchema } from './shift.schema';

const router = Router();

router.use(authenticate);

router.route('/')
  .get(getAll)
  .post(validateRequest({ body: createShiftSchema }), create);

router.route('/:id')
  .put(validateRequest({ body: updateShiftSchema }), update);

export default router;
