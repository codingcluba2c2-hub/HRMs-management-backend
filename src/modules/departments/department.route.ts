import { Router } from 'express';
import { 
  createDepartment, 
  getDepartments, 
  updateDepartment, 
  deleteDepartment,
  getDepartmentSummary,
  assignDepartmentManager,
  getOrganizationOverview
} from './department.controller';
import { authenticate } from '../../middlewares/authMiddleware';
import { validateRequest } from '../../middlewares/validateRequest';
import { createDepartmentSchema, updateDepartmentSchema } from './department.schema';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Departments
 *   description: Department management
 */

router.use(authenticate); // All routes require authentication

router.get('/overview', getOrganizationOverview);
router.get('/summary', getDepartmentSummary);

/**
 * @swagger
 * /api/departments:
 *   post:
 *     summary: Create Department
 *     description: Create a new department.
 *     tags: [Departments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 example: "IT Department"
 *               description:
 *                 type: string
 *                 example: "Information Technology"
 *     responses:
 *       201:
 *         description: Department created
 *       400:
 *         description: Bad request
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *   get:
 *     summary: Get All Departments
 *     description: Retrieve all departments.
 *     tags: [Departments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: A list of departments
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.route('/')
  .post(validateRequest({ body: createDepartmentSchema }), createDepartment)
  .get(getDepartments);

router.post('/:id/manager', assignDepartmentManager);

/**
 * @swagger
 * /api/departments/{id}:
 *   put:
 *     summary: Update Department
 *     description: Update an existing department.
 *     tags: [Departments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The department ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: "HR Department"
 *               description:
 *                 type: string
 *                 example: "Human Resources"
 *     responses:
 *       200:
 *         description: Department updated
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *   delete:
 *     summary: Delete Department
 *     description: Delete a department by ID.
 *     tags: [Departments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The department ID
 *     responses:
 *       200:
 *         description: Department deleted
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.route('/:id')
  .put(validateRequest({ body: updateDepartmentSchema }), updateDepartment)
  .delete(deleteDepartment);

export default router;

