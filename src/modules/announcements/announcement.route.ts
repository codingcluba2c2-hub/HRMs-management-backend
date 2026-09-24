import { Router } from 'express';
import { authenticate } from '../../middlewares/authMiddleware';
import {
  getAnnouncements,
  createAnnouncement,
  deleteAnnouncement
} from './announcement.controller';

const router = Router();

router.use(authenticate);

router.get('/', getAnnouncements);
router.post('/', createAnnouncement);
router.delete('/:id', deleteAnnouncement);

export default router;
