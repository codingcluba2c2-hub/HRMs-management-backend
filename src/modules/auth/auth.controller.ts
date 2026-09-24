import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma';
import { loginSchema, forgotPasswordSchema, registerSchema, verifyOtpSchema, resetPasswordSchema } from './auth.schema';
import * as authService from './auth.service';
import { ApiResponse } from '../../utils/ApiResponse';

export const loginHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = loginSchema.parse(req.body);
    const result = await authService.login(data.email, data.password);
    await prisma.auditLog.create({
      data: {
        userId: result.user.id,
        action: 'USER_LOGIN',
        entity: 'Auth',
        ip: req.ip || req.socket.remoteAddress,
        browser: req.headers['user-agent']
      }
    });
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    res.status(200).json(new ApiResponse(true, 'Login successful', { user: result.user, token: result.token }));
  } catch (error: any) {
    if (error.name === 'ZodError') {
      res.status(400).json(new ApiResponse(false, 'Validation Error', error.errors));
    } else if (error.message === 'Invalid credentials') {
      res.status(401).json(new ApiResponse(false, error.message));
    } else {
      next(error);
    }
  }
};

export const googleLoginHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json(new ApiResponse(false, 'Google token is required'));
    }
    const result = await authService.googleLogin(token);
    await prisma.auditLog.create({
      data: {
        userId: result.user.id,
        action: 'USER_LOGIN',
        entity: 'Auth',
        ip: req.ip || req.socket.remoteAddress,
        browser: req.headers['user-agent']
      }
    });
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    res.status(200).json(new ApiResponse(true, 'Login successful', { user: result.user, token: result.token }));
  } catch (error: any) {
    if (error.message.includes('Account not found')) {
      res.status(403).json(new ApiResponse(false, error.message));
    } else {
      res.status(401).json(new ApiResponse(false, error.message));
    }
  }
};

export const sendLoginOtpHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = forgotPasswordSchema.parse(req.body);
    await authService.requestLoginOtp(data.email);
    res.status(200).json(new ApiResponse(true, 'Login OTP sent to your email'));
  } catch (error: any) {
    if (error.message === 'Account not found') {
      res.status(404).json(new ApiResponse(false, error.message));
    } else {
      next(error);
    }
  }
};

export const verifyLoginOtpHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = verifyOtpSchema.parse(req.body);
    const result = await authService.verifyLoginOtp(data.email, data.otp);
    await prisma.auditLog.create({
      data: {
        userId: result.user.id,
        action: 'USER_LOGIN',
        entity: 'Auth',
        ip: req.ip || req.socket.remoteAddress,
        browser: req.headers['user-agent']
      }
    });
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    res.status(200).json(new ApiResponse(true, 'Login successful', { user: result.user, token: result.token }));
  } catch (error: any) {
    if (error.name === 'ZodError') {
      res.status(400).json(new ApiResponse(false, 'Validation Error', error.errors));
    } else if (error.message.includes('Invalid') || error.message.includes('expired') || error.message.includes('not found')) {
      res.status(401).json(new ApiResponse(false, error.message));
    } else {
      next(error);
    }
  }
};

export const forgotPasswordHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = forgotPasswordSchema.parse(req.body);
    await authService.requestPasswordReset(data.email);
    res.status(200).json(new ApiResponse(true, 'If an account exists, a reset link has been sent'));
  } catch (error: any) {
    next(error);
  }
};

export const verifyOtpHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = verifyOtpSchema.parse(req.body);
    await authService.verifyOTP(data.email, data.otp);
    res.status(200).json(new ApiResponse(true, 'OTP verified successfully'));
  } catch (error: any) {
    if (error.name === 'ZodError') {
      res.status(400).json(new ApiResponse(false, 'Validation Error', error.errors));
    } else {
      res.status(400).json(new ApiResponse(false, error.message));
    }
  }
};

export const resetPasswordHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = resetPasswordSchema.parse(req.body);
    await authService.resetPassword(data.email, data.password);
    res.status(200).json(new ApiResponse(true, 'Password reset successful'));
  } catch (error: any) {
    if (error.name === 'ZodError') {
      res.status(400).json(new ApiResponse(false, 'Validation Error', error.errors));
    } else {
      res.status(400).json(new ApiResponse(false, error.message));
    }
  }
};

export const registerHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = registerSchema.parse(req.body);
    const result = await authService.register(data);
    res.status(201).json(new ApiResponse(true, 'Registration successful', result));
  } catch (error: any) {
    if (error.name === 'ZodError') {
      res.status(400).json(new ApiResponse(false, 'Validation Error', error.errors));
    } else if (error.message === 'Email already registered') {
      res.status(409).json(new ApiResponse(false, error.message));
    } else {
      next(error);
    }
  }
};

import jwt from 'jsonwebtoken';

export const refreshHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) throw new Error('Token missing');
    
    // Decodes without verifying expiration for seamless sliding session
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string, { ignoreExpiration: true }) as any;
    
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: { role: true }
    });

    if (!user) throw new Error('User not found');

    const roleName = user.role ? user.role.name : 'EMPLOYEE';
    
    const newToken = jwt.sign(
      { id: user.id, email: user.email, role: roleName },
      process.env.JWT_SECRET as string,
      { expiresIn: '15m' }
    );
    
    res.status(200).json(new ApiResponse(true, 'Token refreshed', { token: newToken }));
  } catch (error: any) {
    res.status(401).json(new ApiResponse(false, 'Invalid refresh token'));
  }
};
