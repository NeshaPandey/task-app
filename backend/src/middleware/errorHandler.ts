// backend/src/middleware/errorHandler.ts
import { Request, Response, NextFunction } from 'express';

/**
 * Custom Error Interface
 */
interface ErrorResponse {
  success: false;
  message: string;
  errors?: any;
  stack?: string;
  statusCode?: number;
}

/**
 * Custom Error Class
 * Extends built-in Error class with statusCode
 */
export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Not Found Error Handler
 * Handles 404 errors for undefined routes
 * 
 * @example
 * // Add BEFORE error handler in server.ts
 * app.use(notFound);
 */
export const notFound = (req: Request, res: Response, next: NextFunction): void => {
  const error = new AppError(`Route not found - ${req.originalUrl}`, 404);
  next(error);
};

/**
 * Main Error Handler Middleware
 * Centralized error handling for the entire application
 * Handles different types of errors and formats responses
 * 
 * @example
 * // Add as LAST middleware in server.ts
 * app.use(errorHandler);
 */
export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Create a copy of error
  let error = { ...err };
  error.message = err.message;

  // Log error to console (in development)
  if (process.env.NODE_ENV === 'development') {
    console.error('❌ Error Details:', {
      name: err.name,
      message: err.message,
      stack: err.stack,
      errors: err.errors
    });
  } else {
    // Production: Log only essential info
    console.error('❌ Error:', err.message);
  }

  // Mongoose Bad ObjectId Error
  if (err.name === 'CastError') {
    const message = `Resource not found with id: ${err.value}`;
    error = new AppError(message, 404);
  }

  // Mongoose Duplicate Key Error (E11000)
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0];
    const value = err.keyValue ? err.keyValue[field] : 'unknown';
    const message = `Duplicate field value: ${field} = '${value}'. Please use another value.`;
    error = new AppError(message, 400);
  }

  // Mongoose Validation Error
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors || {}).map((e: any) => e.message);
    const message = `Invalid input data. ${errors.join('. ')}`;
    error = new AppError(message, 400);
  }

  // JWT Token Errors
  if (err.name === 'JsonWebTokenError') {
    const message = 'Invalid token. Please login again.';
    error = new AppError(message, 401);
  }

  if (err.name === 'TokenExpiredError') {
    const message = 'Your token has expired. Please login again.';
    error = new AppError(message, 401);
  }

  // Multer File Upload Errors (if you add file upload later)
  if (err.name === 'MulterError') {
    const message = `File upload error: ${err.message}`;
    error = new AppError(message, 400);
  }

  // Syntax Error (Malformed JSON)
  if (err instanceof SyntaxError && 'body' in err) {
    const message = 'Invalid JSON format in request body';
    error = new AppError(message, 400);
  }

  // Build error response
  const response: ErrorResponse = {
    success: false,
    message: error.message || 'Server Error'
  };

  // Add validation errors if they exist
  if (err.errors) {
    response.errors = err.errors;
  }

  // Include stack trace in development only
  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }

  // Send error response
  res.status(error.statusCode || 500).json(response);
};

/**
 * Async Error Handler Wrapper
 * Wraps async route handlers to catch errors automatically
 * Eliminates the need for try-catch in every route
 * 
 * @param fn - Async function to wrap
 * @returns Express middleware function
 * 
 * @example
 * // Instead of:
 * router.get('/tasks', async (req, res) => {
 *   try {
 *     const tasks = await Task.find();
 *     res.json(tasks);
 *   } catch (error) {
 *     next(error);
 *   }
 * });
 * 
 * // Use:
 * router.get('/tasks', asyncHandler(async (req, res) => {
 *   const tasks = await Task.find();
 *   res.json(tasks);
 * }));
 */
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Validation Error Handler
 * Formats validation errors from express-validator or Zod
 * 
 * @param errors - Array of validation errors
 * @returns Formatted error response
 */
export const handleValidationError = (errors: any[]): ErrorResponse => {
  const formattedErrors = errors.map(err => ({
    field: err.path || err.param,
    message: err.msg || err.message
  }));

  return {
    success: false,
    message: 'Validation failed',
    errors: formattedErrors
  };
};

/**
 * Database Connection Error Handler
 * Specific handler for MongoDB connection errors
 */
export const handleDBError = (err: any): void => {
  console.error('❌ Database Connection Error:');
  console.error('Message:', err.message);
  
  if (err.name === 'MongoNetworkError') {
    console.error('Cannot connect to MongoDB. Please check:');
    console.error('1. MongoDB is running');
    console.error('2. Connection string is correct');
    console.error('3. Network/firewall settings');
  }

  if (err.name === 'MongoServerError' && err.code === 8000) {
    console.error('Authentication failed. Check your MongoDB credentials.');
  }

  // Exit process with failure
  process.exit(1);
};

/**
 * Unhandled Promise Rejection Handler
 * Catches unhandled promise rejections globally
 * Call this in server.ts
 * 
 * @example
 * process.on('unhandledRejection', handleUnhandledRejection);
 */
export const handleUnhandledRejection = (err: Error, promise: Promise<any>): void => {
  console.error('❌ UNHANDLED PROMISE REJECTION! Shutting down...');
  console.error('Error:', err.name, err.message);
  console.error('Stack:', err.stack);
  
  // Close server gracefully
  process.exit(1);
};

/**
 * Uncaught Exception Handler
 * Catches uncaught exceptions globally
 * Call this in server.ts
 * 
 * @example
 * process.on('uncaughtException', handleUncaughtException);
 */
export const handleUncaughtException = (err: Error): void => {
  console.error('❌ UNCAUGHT EXCEPTION! Shutting down...');
  console.error('Error:', err.name, err.message);
  console.error('Stack:', err.stack);
  
  // Exit immediately
  process.exit(1);
};

/**
 * Success Response Helper
 * Standardized success response format
 * 
 * @example
 * return successResponse(res, 200, 'Task created', { task });
 */
export const successResponse = (
  res: Response,
  statusCode: number,
  message: string,
  data?: any
): Response => {
  const response: any = {
    success: true,
    message
  };

  if (data) {
    response.data = data;
  }

  return res.status(statusCode).json(response);
};

/**
 * Error Response Helper
 * Standardized error response format
 * 
 * @example
 * return errorResponse(res, 400, 'Invalid input');
 */
export const errorResponse = (
  res: Response,
  statusCode: number,
  message: string,
  errors?: any
): Response => {
  const response: ErrorResponse = {
    success: false,
    message
  };

  if (errors) {
    response.errors = errors;
  }

  return res.status(statusCode).json(response);
};

/**
 * Rate Limit Error Handler
 * Custom message for rate limit errors
 */
export const handleRateLimitError = (req: Request, res: Response): void => {
  res.status(429).json({
    success: false,
    message: 'Too many requests from this IP. Please try again later.',
    retryAfter: '15 minutes'
  });
};

/**
 * CORS Error Handler
 * Custom message for CORS errors
 */
export const handleCORSError = (err: any, req: Request, res: Response, next: NextFunction): void => {
  if (err.message && err.message.includes('CORS')) {
    res.status(403).json({
      success: false,
      message: 'CORS policy: Access denied from this origin'
    });
    return;
  }
  next(err);
};

/**
 * File Size Error Handler
 * For file upload size limits
 */
export const handleFileSizeError = (err: any, req: Request, res: Response, next: NextFunction): void => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({
      success: false,
      message: 'File size too large. Maximum size is 5MB.'
    });
    return;
  }
  next(err);
};

/**
 * Custom Error Creators
 * Quick error creation helpers
 */
export class BadRequestError extends AppError {
  constructor(message: string = 'Bad Request') {
    super(message, 400);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found') {
    super(message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Conflict') {
    super(message, 409);
  }
}

export class InternalServerError extends AppError {
  constructor(message: string = 'Internal Server Error') {
    super(message, 500);
  }
}

/**
 * Error Logger Middleware
 * Logs errors to external service (optional)
 * Add before errorHandler in server.ts
 */
export const errorLogger = (err: any, req: Request, res: Response, next: NextFunction): void => {
  // Log to external service (e.g., Sentry, LogRocket)
  // if (process.env.NODE_ENV === 'production') {
  //   logToExternalService(err, req);
  // }
  
  next(err);
};

/**
 * Development Error Response
 * Detailed error info for development
 */
const sendDevError = (err: any, res: Response): void => {
  res.status(err.statusCode || 500).json({
    success: false,
    error: err,
    message: err.message,
    stack: err.stack,
    errors: err.errors
  });
};

/**
 * Production Error Response
 * Clean error info for production
 */
const sendProdError = (err: any, res: Response): void => {
  // Operational, trusted error: send message to client
  if (err.isOperational) {
    res.status(err.statusCode || 500).json({
      success: false,
      message: err.message
    });
  } 
  // Programming or unknown error: don't leak details
  else {
    console.error('ERROR 💥', err);
    res.status(500).json({
      success: false,
      message: 'Something went wrong. Please try again later.'
    });
  }
};