import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import redis from '../lib/redis';
import { prisma } from '../lib/prisma';

// Extend the default Express Request to include our custom user data
export interface AuthRequest extends Request {
  user?: { id: string; role: string; email: string; companyName?: string };
}

// Middleware function to check if the user is logged in
export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  // Extract the token from the "Authorization: Bearer <token>" header
  const token = req.headers.authorization?.split(' ')[1];
  
  // If there is no token, block the request and return an error
  if (!token) {
    return res.status(401).json({ success: false, message: 'Unauthorized: No token provided' });
  }

  try {
    let decoded: any;
    
    // Check if valid token is in cache
    const cacheKey = `session:${token}`;
    if (redis.status === 'ready') {
      const cachedSession = await redis.get(cacheKey);
      if (cachedSession) {
        decoded = JSON.parse(cachedSession);
      }
    }

    if (!decoded) {
      // Verify the token using our secret key
      decoded = jwt.verify(token, process.env.JWT_SECRET as string) as any;
      if (redis.status === 'ready') {
        redis.setex(cacheKey, 900, JSON.stringify(decoded)).catch(() => {});
      }
    }

    // Attach the decoded user information to the request
    req.user = decoded;

    // Ensure companyName is populated on req.user for multi-tenant isolation
    if (req.user && (!req.user.companyName || req.user.companyName === '')) {
      try {
        const u = await prisma.user.findUnique({
          where: { id: req.user.id },
          select: { companyName: true }
        });
        if (u?.companyName) {
          req.user.companyName = u.companyName;
        }
      } catch (e) {}
    }
    
    // Move on to the next function/route handler
    next();
  } catch (error) {
    // If the token is expired or invalid, block the request
    return res.status(401).json({ success: false, message: 'Unauthorized: Invalid token' });
  }
};
