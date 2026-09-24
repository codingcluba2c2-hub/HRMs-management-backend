import { Router } from 'express';
import { 
  getProfile, updateProfile, updateProfilePicture,
  getFullProfile, updatePersonal, updateContact,
  updateBank, updateSkills, updatePreferences, updateSecurity 
} from './profile.controller';
import { authenticate } from '../../middlewares/authMiddleware';
import { upload } from '../../utils/upload';
import { validateRequest } from '../../middlewares/validateRequest';
import { updatePersonalSchema, updateContactSchema, updateBankSchema, updateSkillsSchema, updatePreferencesSchema, updateSecuritySchema } from './profile.schema';

const router = Router();

router.use(authenticate);

router.get('/', getProfile);
router.put('/', updateProfile);
router.post('/picture', upload.single('file'), updateProfilePicture);

// New Modular Profile Routes
router.get('/full', getFullProfile);
router.put('/personal', validateRequest({ body: updatePersonalSchema }), updatePersonal);
router.put('/contact', validateRequest({ body: updateContactSchema }), updateContact);
router.put('/bank', validateRequest({ body: updateBankSchema }), updateBank);
router.put('/skills', validateRequest({ body: updateSkillsSchema }), updateSkills);
router.put('/preferences', validateRequest({ body: updatePreferencesSchema }), updatePreferences);
router.put('/security', validateRequest({ body: updateSecuritySchema }), updateSecurity);

export default router;
