import { Router } from 'express';
import { loginHandler, forgotPasswordHandler, registerHandler, verifyOtpHandler, resetPasswordHandler, refreshHandler, googleLoginHandler, sendLoginOtpHandler, verifyLoginOtpHandler } from './auth.controller';
import rateLimit from 'express-rate-limit';
import { validateRequest } from '../../middlewares/validateRequest';
import { loginSchema, forgotPasswordSchema, verifyOtpSchema, resetPasswordSchema, registerSchema } from './auth.schema';
const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 login requests per windowMs
  message: { success: false, message: 'Too many login attempts from this IP, please try again after 15 minutes' }
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many OTP requests from this IP, please try again after 15 minutes' }
});

/**
 * @swagger
 * tags:
 *   name: Authentication
 *   description: User login, registration, and password management
 */

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: User Login
 *     description: Authenticate user and return a JWT token.
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: john@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 example: "password123"
 *     responses:
 *       200:
 *         description: Successfully authenticated
 *       400:
 *         description: Bad request
 *       401:
 *         description: Invalid credentials
 */
router.post('/login', loginLimiter, validateRequest({ body: loginSchema }), loginHandler);

/**
 * @swagger
 * /api/auth/google-login:
 *   post:
 *     summary: Google Login
 *     description: Authenticate user using Google OAuth.
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 description: Google OAuth ID token
 *                 example: "eyJhbGciOiJSUzI1NiIs..."
 *     responses:
 *       200:
 *         description: Successfully authenticated via Google
 *       400:
 *         description: Bad request
 *       401:
 *         description: Invalid Google token
 */
router.post('/google-login', loginLimiter, googleLoginHandler);

/**
 * @swagger
 * /api/auth/send-login-otp:
 *   post:
 *     summary: Send Login OTP
 *     description: Send a login OTP to the user's email.
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: john@example.com
 *     responses:
 *       200:
 *         description: OTP sent successfully
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.post('/send-login-otp', otpLimiter, validateRequest({ body: forgotPasswordSchema }), sendLoginOtpHandler);

/**
 * @swagger
 * /api/auth/verify-login-otp:
 *   post:
 *     summary: Verify Login OTP
 *     description: Verify the login OTP and return a JWT token.
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - otp
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: john@example.com
 *               otp:
 *                 type: string
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: Successfully authenticated
 *       400:
 *         description: Bad request
 *       401:
 *         description: Invalid OTP
 */
router.post('/verify-login-otp', loginLimiter, validateRequest({ body: verifyOtpSchema }), verifyLoginOtpHandler);

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     summary: Forgot Password
 *     description: Send a password reset OTP to the user's email.
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: john@example.com
 *     responses:
 *       200:
 *         description: OTP sent successfully
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.post('/forgot-password', otpLimiter, validateRequest({ body: forgotPasswordSchema }), forgotPasswordHandler);

/**
 * @swagger
 * /api/auth/verify-otp:
 *   post:
 *     summary: Verify OTP
 *     description: Verify the OTP sent to the user's email.
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - otp
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: john@example.com
 *               otp:
 *                 type: string
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: OTP verified successfully
 *       400:
 *         description: Invalid or expired OTP
 */
router.post('/verify-otp', validateRequest({ body: verifyOtpSchema }), verifyOtpHandler);

/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     summary: Reset Password
 *     description: Reset the user's password using the verified OTP token.
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - newPassword
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: john@example.com
 *               newPassword:
 *                 type: string
 *                 format: password
 *                 example: "newpassword123"
 *     responses:
 *       200:
 *         description: Password reset successfully
 *       400:
 *         description: Bad request
 */
router.post('/reset-password', validateRequest({ body: resetPasswordSchema }), resetPasswordHandler);

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register User
 *     description: Register a new user account.
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *               - password
 *             properties:
 *               name:
 *                 type: string
 *                 example: "John Doe"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: john@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 example: "password123"
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Validation error or user already exists
 */
router.post('/register', validateRequest({ body: registerSchema }), registerHandler);

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Refresh Token
 *     description: Get a new access token using a refresh token.
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 example: "eyJhbGciOiJIUzI1NiIs..."
 *     responses:
 *       200:
 *         description: New access token generated
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post('/refresh', refreshHandler);

export default router;
