import { Router } from 'express';
import { getDashboardStats } from './dashboard.controller';
import {
  getAnnouncements,
  createAnnouncement,
  expireAnnouncement,
  updateAnnouncement,
  deleteAnnouncement
} from '../announcements/announcement.controller';
import { authenticate } from '../../middlewares/authMiddleware';

const router = Router();

router.use(authenticate);

router.get('/stats', getDashboardStats);

// Announcement routes
router.get('/announcements', getAnnouncements);
router.post('/announcements', createAnnouncement);
router.put('/announcements/:id', updateAnnouncement);
router.patch('/announcements/:id/expire', expireAnnouncement);
router.delete('/announcements/:id', deleteAnnouncement);

export default router;
