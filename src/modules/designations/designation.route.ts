import { Router } from 'express';
import { createDesignation, getDesignations, updateDesignation, deleteDesignation } from './designation.controller';
import { authenticate } from '../../middlewares/authMiddleware';
import { validateRequest } from '../../middlewares/validateRequest';
import { createDesignationSchema, updateDesignationSchema } from './designation.schema';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Designations
 *   description: Designation management
 */

router.use(authenticate); // All routes require authentication

/**
 * @swagger
 * /api/designations:
 *   post:
 *     summary: Create Designation
 *     description: Create a new designation.
 *     tags: [Designations]
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
 *                 example: "Software Engineer"
 *               description:
 *                 type: string
 *                 example: "Develops software"
 *     responses:
 *       201:
 *         description: Designation created
 *       400:
 *         description: Bad request
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *   get:
 *     summary: Get All Designations
 *     description: Retrieve all designations.
 *     tags: [Designations]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: A list of designations
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.route('/')
  .post(validateRequest({ body: createDesignationSchema }), createDesignation)
  .get(getDesignations);

/**
 * @swagger
 * /api/designations/{id}:
 *   put:
 *     summary: Update Designation
 *     description: Update an existing designation.
 *     tags: [Designations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The designation ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Senior Software Engineer"
 *               description:
 *                 type: string
 *                 example: "Leads software development"
 *     responses:
 *       200:
 *         description: Designation updated
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *   delete:
 *     summary: Delete Designation
 *     description: Delete a designation by ID.
 *     tags: [Designations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The designation ID
 *     responses:
 *       200:
 *         description: Designation deleted
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.route('/:id')
  .put(validateRequest({ body: updateDesignationSchema }), updateDesignation)
  .delete(deleteDesignation);

export default router;
