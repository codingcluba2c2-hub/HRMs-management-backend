import { Router } from 'express';
import { authenticate } from '../../middlewares/authMiddleware';
import { validateRequest } from '../../middlewares/validateRequest';
import { createDepartmentSchema, updateDepartmentSchema } from '../departments/department.schema';
import { createDesignationSchema, updateDesignationSchema } from '../designations/designation.schema';
import { assignManagerSchema } from './orgSetup.schema';
import {
  getDashboardSummary,
  getDepartments,
  getDesignations,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  createDesignation,
  updateDesignation,
  deleteDesignation,
  assignDepartmentManager,
  getOrganizationChart
} from './orgSetup.controller';

const router = Router();

router.use(authenticate);

router.get('/dashboard', getDashboardSummary);

router.get('/departments', getDepartments);
router.post('/departments', validateRequest({ body: createDepartmentSchema }), createDepartment);
router.put('/departments/:id', validateRequest({ body: updateDepartmentSchema }), updateDepartment);
router.delete('/departments/:id', deleteDepartment);

router.get('/designations', getDesignations);
router.post('/designations', validateRequest({ body: createDesignationSchema }), createDesignation);
router.put('/designations/:id', validateRequest({ body: updateDesignationSchema }), updateDesignation);
router.delete('/designations/:id', deleteDesignation);

router.post('/assign-manager', validateRequest({ body: assignManagerSchema }), assignDepartmentManager);

router.get('/org-chart', getOrganizationChart);

export default router;
