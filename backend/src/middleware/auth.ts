// backend/src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User';

/**
 * Extended Request Interface
 * Adds userId and user properties to Express Request
 */
export interface AuthRequest extends Request {
  userId?: string;
  user?: any;
}

/**
 * JWT Payload Interface
 */
interface JWTPayload {
  id: string;
  iat?: number;
  exp?: number;
}

/**
 * Protect Middleware
 * Validates JWT token and attaches user to request
 * Usage: Add this middleware to any route that requires authentication
 * 
 * @example
 * router.get('/profile', protect, getProfile);
 */
export const protect = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    let token: string | undefined;

    // Check for token in Authorization header (Bearer token)
    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    // Alternative: Check for token in cookies (useful for SSR)
    else if (req.cookies?.token) {
      token = req.cookies.token;
    }

    // If no token found
    if (!token) {
      res.status(401).json({
        success: false,
        message: 'Not authorized to access this route. Please login.'
      });
      return;
    }

    try {
      // Verify token
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET!
      ) as JWTPayload;

      // Get user from token (exclude password)
      const user = await User.findById(decoded.id).select('-password');

      // Check if user still exists
      if (!user) {
        res.status(401).json({
          success: false,
          message: 'User no longer exists. Please login again.'
        });
        return;
      }

      // Attach user info to request object
      req.userId = decoded.id;
      req.user = user;

      next();
    } catch (error: any) {
      // Handle specific JWT errors
      if (error.name === 'TokenExpiredError') {
        res.status(401).json({
          success: false,
          message: 'Token has expired. Please login again.'
        });
        return;
      }

      if (error.name === 'JsonWebTokenError') {
        res.status(401).json({
          success: false,
          message: 'Invalid token. Please login again.'
        });
        return;
      }

      res.status(401).json({
        success: false,
        message: 'Token verification failed. Please login again.'
      });
      return;
    }
  } catch (error) {
    console.error('Auth Middleware Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error in authentication'
    });
    return;
  }
};

/**
 * Generate JWT Token
 * Creates a signed JWT token with user ID
 * 
 * @param userId - MongoDB user ID
 * @returns JWT token string
 */
export const generateToken = (userId: string): string => {
  return jwt.sign(
    { id: userId },
    process.env.JWT_SECRET!,
    {
      expiresIn: process.env.JWT_EXPIRE || '7d'
    }
  );
};

/**
 * Send Token Response
 * Generates token and sends response with cookie
 * 
 * @param user - User object from database
 * @param statusCode - HTTP status code
 * @param res - Express response object
 */
export const sendTokenResponse = (
  user: any,
  statusCode: number,
  res: Response
): void => {
  // Generate JWT token
  const token = generateToken(user._id);

  // Cookie options
  const options = {
    expires: new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
    ),
    httpOnly: true, // Prevents XSS attacks
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    sameSite: 'strict' as const // CSRF protection
  };

  // Send response with cookie
  res
    .status(statusCode)
    .cookie('token', token, options)
    .json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        avatar: user.avatar
      }
    });
};

/**
 * Optional Auth Middleware
 * Attaches user to request if token exists, but doesn't require it
 * Useful for routes that work with or without authentication
 * 
 * @example
 * router.get('/tasks', optionalAuth, getTasks);
 */
export const optionalAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    let token: string | undefined;

    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.token) {
      token = req.cookies.token;
    }

    if (token) {
      try {
        const decoded = jwt.verify(
          token,
          process.env.JWT_SECRET!
        ) as JWTPayload;

        const user = await User.findById(decoded.id).select('-password');

        if (user) {
          req.userId = decoded.id;
          req.user = user;
        }
      } catch (error) {
        // Token invalid, but continue anyway (optional auth)
        console.log('Optional auth: Invalid token, continuing without auth');
      }
    }

    next();
  } catch (error) {
    next();
  }
};

/**
 * Authorize Roles Middleware
 * Restricts access based on user roles
 * Note: You'll need to add 'role' field to User model to use this
 * 
 * @param roles - Array of allowed roles
 * @returns Middleware function
 * 
 * @example
 * router.delete('/tasks/:id', protect, authorize('admin'), deleteTask);
 */
export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Not authorized to access this route'
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        message: `User role '${req.user.role}' is not authorized to access this route`
      });
      return;
    }

    next();
  };
};

/**
 * Rate Limiting Helper
 * Tracks request counts per user (you can use with express-rate-limit)
 */
const requestCounts = new Map<string, { count: number; resetTime: number }>();

export const userRateLimit = (
  maxRequests: number = 100,
  windowMs: number = 15 * 60 * 1000 // 15 minutes
) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.userId) {
      next();
      return;
    }

    const now = Date.now();
    const userKey = req.userId;
    const userLimit = requestCounts.get(userKey);

    if (!userLimit || now > userLimit.resetTime) {
      // First request or window expired
      requestCounts.set(userKey, {
        count: 1,
        resetTime: now + windowMs
      });
      next();
      return;
    }

    if (userLimit.count >= maxRequests) {
      res.status(429).json({
        success: false,
        message: 'Too many requests. Please try again later.',
        retryAfter: Math.ceil((userLimit.resetTime - now) / 1000)
      });
      return;
    }

    userLimit.count++;
    next();
  };
};

/**
 * Verify Token Utility
 * Standalone function to verify a token
 * Useful for testing or manual token verification
 * 
 * @param token - JWT token string
 * @returns Decoded token payload or null
 */
export const verifyToken = (token: string): JWTPayload | null => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload;
  } catch (error) {
    return null;
  }
};

/**
 * Refresh Token (Advanced Feature)
 * Generate a refresh token with longer expiry
 * Note: You'll need a separate refresh token storage system
 * 
 * @param userId - MongoDB user ID
 * @returns Refresh token string
 */
export const generateRefreshToken = (userId: string): string => {
  return jwt.sign(
    { id: userId, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET!,
    {
      expiresIn: '30d'
    }
  );
};

/**
 * Check Token Expiry
 * Returns how many seconds until token expires
 * 
 * @param token - JWT token string
 * @returns Seconds until expiry, or null if invalid
 */
export const getTokenExpiry = (token: string): number | null => {
  try {
    const decoded = jwt.decode(token) as JWTPayload;
    if (!decoded || !decoded.exp) return null;
    
    const now = Math.floor(Date.now() / 1000);
    return decoded.exp - now;
  } catch (error) {
    return null;
  }
};