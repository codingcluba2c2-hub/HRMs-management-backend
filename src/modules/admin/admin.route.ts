import { Router } from 'express';
import { 
  getAllUsers, createUser, updateUser, deleteUser,
  getAllRoles, createRole, updateRole, deleteRole,
  getAllPermissions, createPermission, updatePermission, deletePermission,
  getAllSettings, createSetting, updateSetting, deleteSetting
} from './admin.controller';
import { authenticate } from '../../middlewares/authMiddleware';
import { validateRequest } from '../../middlewares/validateRequest';
import { createUserSchema, updateUserSchema, createRoleSchema, updateRoleSchema, createPermissionSchema, updatePermissionSchema, createSettingSchema, updateSettingSchema } from './admin.schema';

const router = Router();

// SECURITY: Enforce authentication on EVERY route in this file. 
// No one can access these admin endpoints unless they have a valid login token.
router.use(authenticate);

// ==========================================
// User Management Routes (Super Admin Only)
// ==========================================
router.get('/users', getAllUsers); // Fetch all users in the system
router.post('/users', validateRequest({ body: createUserSchema }), createUser); // Create a new user (Validates data first)
router.put('/users/:id', validateRequest({ body: updateUserSchema }), updateUser); // Update an existing user
router.delete('/users/:id', deleteUser); // Delete a user by their ID

// ==========================================
// Roles Management Routes
// ==========================================
router.get('/roles', getAllRoles); // Fetch all custom roles
router.post('/roles', validateRequest({ body: createRoleSchema }), createRole); // Create a new role (e.g. "HR Manager")
router.put('/roles/:id', validateRequest({ body: updateRoleSchema }), updateRole); // Update a role's name/description
router.delete('/roles/:id', deleteRole); // Delete a role

// ==========================================
// Permissions Management Routes
// ==========================================
router.get('/permissions', getAllPermissions); // Fetch all granular permissions
router.post('/permissions', validateRequest({ body: createPermissionSchema }), createPermission); // Create a new permission
router.put('/permissions/:id', validateRequest({ body: updatePermissionSchema }), updatePermission); // Update a permission
router.delete('/permissions/:id', deletePermission); // Delete a permission

// ==========================================
// Global System Settings Routes
// ==========================================
router.get('/settings', getAllSettings); // Fetch all global settings (e.g. Maintenance mode, default timezone)
router.post('/settings', validateRequest({ body: createSettingSchema }), createSetting); // Create a new setting
router.put('/settings/:id', validateRequest({ body: updateSettingSchema }), updateSetting); // Update a setting
router.delete('/settings/:id', deleteSetting); // Delete a setting

// ==========================================
// Audit Logs Route
// ==========================================
import { getAllAuditLogs } from './admin.controller';
// Fetch a history of all sensitive actions taken in the system
router.get('/audit-logs', getAllAuditLogs);

export default router;
