import { Router } from 'express';
import { getLoginContentHandler } from './public.controller';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Public
 *   description: Public endpoints (no authentication required)
 */

/**
 * @swagger
 * /api/public/login-content:
 *   get:
 *     summary: Get Dynamic Login Content
 *     description: Fetch the dynamic content for the login page, such as carousel items, announcements, and statistics.
 *     tags: [Public]
 *     responses:
 *       200:
 *         description: Successfully fetched login content
 */
router.get('/login-content', getLoginContentHandler);

export default router;
