import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import {
  getPublicJobs,
  getPublicJobBySlug,
  getPublicDepartments,
  submitPublicApplication
} from './careers.controller';

const router = Router();

// Memory storage for file inspection
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 6 * 1024 * 1024 // 6MB hard limit at multer level
  }
});

// Rate limiting for public application submissions: max 10 applications per 15 minutes per IP
const applicationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: 'Too many applications submitted from this network. Please wait a few minutes before trying again.'
  }
});

// Public Careers Routes (No HR Authentication Required)
router.get('/jobs', getPublicJobs);
router.get('/jobs/:slug', getPublicJobBySlug);
router.get('/departments', getPublicDepartments);
router.post('/jobs/:slug/apply', applicationLimiter, upload.single('resume'), submitPublicApplication);

export default router;
