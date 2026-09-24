import { Response, NextFunction } from 'express';
import { AuthRequest } from './authMiddleware';
import redis from '../lib/redis';

// Role-Based Access Control (RBAC) middleware: Checks if a user has the right permission level to access a route
export const authorizeRoles = (...roles: string[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    // Check cache
    const cacheKey = `rbac:${req.user?.id}:${roles.join(',')}`;
    if (redis.status === 'ready') {
      const isAuthorized = await redis.get(cacheKey);
      if (isAuthorized === 'true') {
        return next();
      }
    }

    // If there is no user attached to the request (not logged in), or the user's role isn't in the allowed list:
    if (!req.user || !roles.includes(req.user.role)) {
      // Block them and send a 403 Forbidden error
      return res.status(403).json({ success: false, message: 'Forbidden: Insufficient role' });
    }
    
    // Cache the authorization for 15 minutes
    if (redis.status === 'ready') {
      redis.setex(cacheKey, 900, 'true').catch(() => {});
    }

    // If they have the correct role, let them pass through to the actual route
    next();
  };
};
