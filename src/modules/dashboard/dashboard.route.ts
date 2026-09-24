import { Router } from 'express';
import { getDashboardStats } from './dashboard.controller';
import { getAnnouncements, createAnnouncement, deleteAnnouncement } from '../announcements/announcement.controller';
import { authenticate } from '../../middlewares/authMiddleware';

const router = Router();

router.use(authenticate);

router.get('/stats', getDashboardStats);

// Announcement fallbacks
router.get('/announcements', getAnnouncements);
router.post('/announcements', createAnnouncement);
router.delete('/announcements/:id', deleteAnnouncement);

export default router;
