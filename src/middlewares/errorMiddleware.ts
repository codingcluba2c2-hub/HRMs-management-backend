import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// Global error handler function that intercepts any crashed requests or thrown errors in the app
export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  // Log the exact error to our server logs so developers can debug it later
  logger.error(err.message, err);
  
  // Determine the HTTP status code (e.g. 400 for bad request, 404 for not found, default to 500 for server crash)
  const statusCode = err.statusCode || 500;
  
  // Send a clean, standardized JSON response back to the frontend instead of an ugly HTML crash page
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
};
