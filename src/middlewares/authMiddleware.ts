import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import redis from '../lib/redis';

// Extend the default Express Request to include our custom user data
export interface AuthRequest extends Request {
  user?: { id: string; role: string; email: string };
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
    let decoded;
    
    // Check if valid token is in cache
    const cacheKey = `session:${token}`;
    if (redis.status === 'ready') {
      const cachedSession = await redis.get(cacheKey);
      if (cachedSession) {
        req.user = JSON.parse(cachedSession);
        return next();
      }
    }

    // Verify the token using our secret key
    decoded = jwt.verify(token, process.env.JWT_SECRET as string) as any;
    
    // Cache the decoded session for 15 minutes to save CPU cycles
    if (redis.status === 'ready') {
      redis.setex(cacheKey, 900, JSON.stringify(decoded)).catch(() => {});
    }

    // Attach the decoded user information to the request
    req.user = decoded;
    
    // Move on to the next function/route handler
    next();
  } catch (error) {
    // If the token is expired or invalid, block the request
    return res.status(401).json({ success: false, message: 'Unauthorized: Invalid token' });
  }
};
