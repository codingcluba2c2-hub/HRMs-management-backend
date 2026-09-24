import { Router } from 'express';
import { 
  getAllUsers, createUser, updateUser, deleteUser,
  getAllRoles, createRole, updateRole, deleteRole,
  getAllPermissions, createPermission, updatePermission, deletePermission,
  getAllSettings, createSetting, updateSetting, deleteSetting
} from './admin.controller';
import { authenticate } from '../../middlewares/authMiddleware';

const router = Router();

router.use(authenticate);

// Users
router.get('/users', getAllUsers);
router.post('/users', createUser);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);

// Roles
router.get('/roles', getAllRoles);
router.post('/roles', createRole);
router.put('/roles/:id', updateRole);
router.delete('/roles/:id', deleteRole);

// Permissions
router.get('/permissions', getAllPermissions);
router.post('/permissions', createPermission);
router.put('/permissions/:id', updatePermission);
router.delete('/permissions/:id', deletePermission);

// Settings
router.get('/settings', getAllSettings);
router.post('/settings', createSetting);
router.put('/settings/:id', updateSetting);
router.delete('/settings/:id', deleteSetting);

// Audit Logs
import { getAllAuditLogs } from './admin.controller';
router.get('/audit-logs', getAllAuditLogs);

export default router;
