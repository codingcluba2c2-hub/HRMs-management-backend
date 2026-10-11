import { Router } from 'express';
import { 
  getAll, 
  create, 
  update, 
  remove, 
  getRoster, 
  assignShift,
  getBulkAssignShiftTemplate,
  bulkAssignShiftSheet
} from './shift.controller';
import { authenticate } from '../../middlewares/authMiddleware';
import { validateRequest } from '../../middlewares/validateRequest';
import { createShiftSchema, updateShiftSchema, assignShiftSchema } from './shift.schema';

const router = Router();

router.use(authenticate);

router.get('/roster', getRoster);
router.post('/assign', validateRequest({ body: assignShiftSchema }), assignShift);
router.get('/bulk-assign-template', getBulkAssignShiftTemplate);
router.post('/bulk-assign-sheet', bulkAssignShiftSheet);

router.route('/')
  .get(getAll)
  .post(validateRequest({ body: createShiftSchema }), create);

router.route('/:id')
  .put(validateRequest({ body: updateShiftSchema }), update)
  .delete(remove);

export default router;

