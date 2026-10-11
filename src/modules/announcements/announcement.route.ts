import { Router } from 'express';
import { authenticate } from '../../middlewares/authMiddleware';
import {
  getAnnouncements,
  createAnnouncement,
  expireAnnouncement,
  updateAnnouncement,
  deleteAnnouncement
} from './announcement.controller';

const router = Router();

router.use(authenticate);

router.get('/', getAnnouncements);
router.post('/', createAnnouncement);
router.put('/:id', updateAnnouncement);
router.patch('/:id/expire', expireAnnouncement);
router.delete('/:id', deleteAnnouncement);

export default router;
