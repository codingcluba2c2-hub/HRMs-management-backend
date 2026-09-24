import { Request, Response, NextFunction } from 'express';
import { ZodTypeAny, ZodError } from 'zod';
import { ApiResponse } from '../utils/ApiResponse';

/**
 * Enterprise standard validation middleware.
 * Validates request body, query, and params against provided Zod schemas.
 */
export const validateRequest = (schemas: {
  body?: ZodTypeAny; // Schema for validating data sent in the request body (e.g., JSON form data)
  query?: ZodTypeAny; // Schema for validating data sent in the URL query string (e.g., ?page=1)
  params?: ZodTypeAny; // Schema for validating data in the URL path parameters (e.g., /users/:id)
}) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // If a body schema was provided, check if the incoming body matches the rules
      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }
      
      // If a query schema was provided, check if the URL query matches the rules
      if (schemas.query) {
        req.query = await schemas.query.parseAsync(req.query) as any;
      }
      
      // If a params schema was provided, check if the URL parameters match the rules
      if (schemas.params) {
        req.params = await schemas.params.parseAsync(req.params) as any;
      }
      
      // If all checks pass without errors, move on to the actual route handler
      next();
    } catch (error) {
      // If Zod (the validation library) catches an error (e.g., missing email, password too short)
      if (error instanceof ZodError) {
        // Format the ugly Zod error into a clean list of exactly which fields failed and why
        const formattedErrors = error.errors.map((err) => ({
          field: err.path.join('.'), // E.g., 'user.email'
          message: err.message, // E.g., 'Invalid email address'
        }));

        // Send a 400 Bad Request response back to the client immediately, blocking the request
        return res.status(400).json(
          new ApiResponse(false, 'Validation failed', formattedErrors)
        );
      }
      
      // If the error was something else (like a server crash), pass it to the global error handler
      next(error);
    }
  };
};
