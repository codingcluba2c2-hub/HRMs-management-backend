import { Router } from 'express';
import { 
  getDocuments,
  getDocumentById,
  uploadDocument,
  approveDocument,
  rejectDocument,
  deleteDocument,
  generateDownloadUrl,
  previewDocument,
  getDocumentTypes,
  createDocumentType,
  getDocumentSummary
} from './document.controller';
import { authenticate } from '../../middlewares/authMiddleware';
import { authorizeRoles } from '../../middlewares/rbacMiddleware';
import { upload } from '../../utils/upload';

const router = Router();

// Publicly accessible signed URL endpoint (JWT verified inside controller)
router.get('/preview/:token', previewDocument);

router.use(authenticate);

router.get('/types', getDocumentTypes);
router.post('/types', authorizeRoles('Super Admin', 'HR Admin'), createDocumentType);

router.get('/summary', getDocumentSummary);
router.post('/upload', upload.single('file'), uploadDocument);
router.get('/', getDocuments);
router.get('/:id', getDocumentById);
router.delete('/:id', deleteDocument);

// Only Admins can approve/reject
router.post('/:id/approve', authorizeRoles('Super Admin', 'HR Admin'), approveDocument);
router.post('/:id/reject', authorizeRoles('Super Admin', 'HR Admin'), rejectDocument);

// Get a short-lived signed URL for download/preview
router.get('/:id/download', generateDownloadUrl);

export default router;
