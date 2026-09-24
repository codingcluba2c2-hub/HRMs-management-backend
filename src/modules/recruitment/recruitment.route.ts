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
import { validateRequest } from '../../middlewares/validateRequest';
import { createCandidateSchema, updateCandidateSchema, createJobRoleSchema } from './recruitment.schema';

const router = Router();

router.use(authenticate);

// Candidates
router.get('/candidates', getAllCandidates);
router.post('/candidates', upload.single('resumeFile'), validateRequest({ body: createCandidateSchema }), createCandidate);
router.put('/candidates/:id', validateRequest({ body: updateCandidateSchema }), updateCandidate);
router.delete('/candidates/:id', deleteCandidate);

// Job Roles
router.get('/job-roles', getAllJobRoles);
router.post('/job-roles', validateRequest({ body: createJobRoleSchema }), createJobRole);

export default router;
