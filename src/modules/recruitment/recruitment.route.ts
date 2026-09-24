import { Router } from 'express';
import { 
  getAllCandidates, 
  createCandidate, 
  updateCandidate,
  deleteCandidate,
  getAllJobRoles,
  createJobRole
} from './recruitment.controller';
import { authenticate } from '../../middlewares/authMiddleware';
import { upload } from '../../utils/upload';

const router = Router();

router.use(authenticate);

// Candidates
router.get('/candidates', getAllCandidates);
router.post('/candidates', upload.single('resumeFile'), createCandidate);
router.put('/candidates/:id', updateCandidate);
router.delete('/candidates/:id', deleteCandidate);

// Job Roles
router.get('/job-roles', getAllJobRoles);
router.post('/job-roles', createJobRole);

export default router;
