import { Response, NextFunction } from 'express';
import { AuthRequest } from './authMiddleware';
import redis from '../lib/redis';
import { prisma } from '../lib/prisma';

// Role-Based Access Control (RBAC) middleware: Checks if a user has the right permission level to access a route
export const authorizeRoles = (...roles: string[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(403).json({ success: false, message: 'Forbidden: Insufficient role' });
    }

    let roleStr = typeof req.user.role === 'string' 
      ? req.user.role 
      : (req.user.role as any)?.name || '';

    if (!roleStr && req.user.id) {
      try {
        const dbUser = await prisma.user.findUnique({
          where: { id: req.user.id },
          include: { role: true }
        });
        roleStr = dbUser?.role?.name || '';
      } catch (err) {
        // Fallback gracefully
      }
    }

    if (!roleStr) {
      return res.status(403).json({ success: false, message: 'Forbidden: Insufficient role' });
    }

    const userRoleNormalized = roleStr.toUpperCase().replace(/[\s_]+/g, '');
    const allowedNormalized = roles.map(r => r.toUpperCase().replace(/[\s_]+/g, ''));

    const isAllowed = allowedNormalized.includes(userRoleNormalized)
      || (allowedNormalized.some(r => r.includes('HR') || r.includes('ADMIN')) && (userRoleNormalized.includes('HR') || userRoleNormalized.includes('ADMIN')));

    if (!isAllowed) {
      return res.status(403).json({ success: false, message: 'Forbidden: Insufficient role' });
    }

    next();
  };
};
