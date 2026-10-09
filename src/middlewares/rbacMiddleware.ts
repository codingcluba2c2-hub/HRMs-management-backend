import { Response, NextFunction } from 'express';
import { AuthRequest } from './authMiddleware';
import { prisma } from '../lib/prisma';
import { normalizeRole, CANONICAL_ROLES } from '../utils/roleConstants';

/**
 * Role-Based Access Control (RBAC) middleware: Checks if a user has one of the allowed canonical roles
 */
export const authorizeRoles = (...allowedRoles: string[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(403).json({ success: false, message: 'Forbidden: Unauthenticated user' });
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

    const currentNormalized = normalizeRole(roleStr);
    const targetAllowed = allowedRoles.map(r => normalizeRole(r));

    // SUPER_ADMIN has access to administrative routes
    const isAllowed = currentNormalized === CANONICAL_ROLES.SUPER_ADMIN || targetAllowed.includes(currentNormalized);

    if (!isAllowed) {
      return res.status(403).json({ success: false, message: 'Forbidden: Insufficient role privileges' });
    }

    next();
  };
};
