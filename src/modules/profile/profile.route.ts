import { Router } from 'express';
import { 
  getProfile, updateProfile, updateProfilePicture,
  getFullProfile, updatePersonal, updateContact,
  updateBank, updateSkills, updatePreferences, updateSecurity 
} from './profile.controller';
import { authenticate } from '../../middlewares/authMiddleware';
import { upload } from '../../utils/upload';

const router = Router();

router.use(authenticate);

router.get('/', getProfile);
router.put('/', updateProfile);
router.post('/picture', upload.single('file'), updateProfilePicture);

// New Modular Profile Routes
router.get('/full', getFullProfile);
router.put('/personal', updatePersonal);
router.put('/contact', updateContact);
router.put('/bank', updateBank);
router.put('/skills', updateSkills);
router.put('/preferences', updatePreferences);
router.put('/security', updateSecurity);

export default router;
