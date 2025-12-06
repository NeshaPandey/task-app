// backend/src/routes/auth.ts
import express, { Response } from 'express';
import { z } from 'zod';
import User from '../models/User';
import { 
  protect, 
  sendTokenResponse, 
  AuthRequest 
} from '../middleware/auth';
import { 
  asyncHandler, 
  BadRequestError, 
  UnauthorizedError,
  successResponse 
} from '../middleware/errorHandler';

const router = express.Router();

/**
 * Validation Schemas using Zod
 */

// Register Schema
const registerSchema = z.object({
  name: z.string()
    .min(2, 'Name must be at least 2 characters')
    .max(50, 'Name cannot exceed 50 characters')
    .trim(),
  email: z.string()
    .email('Invalid email address')
    .toLowerCase()
    .trim(),
  password: z.string()
    .min(6, 'Password must be at least 6 characters')
    .max(100, 'Password cannot exceed 100 characters')
});

// Login Schema
const loginSchema = z.object({
  email: z.string()
    .email('Invalid email address')
    .toLowerCase()
    .trim(),
  password: z.string()
    .min(1, 'Password is required')
});

// Update Password Schema
const updatePasswordSchema = z.object({
  currentPassword: z.string()
    .min(1, 'Current password is required'),
  newPassword: z.string()
    .min(6, 'New password must be at least 6 characters')
    .max(100, 'Password cannot exceed 100 characters')
});

// Forgot Password Schema
const forgotPasswordSchema = z.object({
  email: z.string()
    .email('Invalid email address')
    .toLowerCase()
    .trim()
});

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post('/register', asyncHandler(async (req, res) => {
  // Validate input data
  const validatedData = registerSchema.parse(req.body);

  // Check if user already exists
  const existingUser = await User.findOne({ email: validatedData.email });
  
  if (existingUser) {
    throw new BadRequestError('User already exists with this email');
  }

  // Create new user
  const user = await User.create({
    name: validatedData.name,
    email: validatedData.email,
    password: validatedData.password
  });

  // Send token response
  sendTokenResponse(user, 201, res);
}));

/**
 * @route   POST /api/auth/login
 * @desc    Login user / Get token
 * @access  Public
 */
router.post('/login', asyncHandler(async (req, res) => {
  // Validate input data
  const validatedData = loginSchema.parse(req.body);

  // Check if user exists (include password field)
  const user = await User.findOne({ email: validatedData.email }).select('+password');

  if (!user) {
    throw new UnauthorizedError('Invalid email or password');
  }

  // Check if password matches
  const isPasswordMatch = await user.comparePassword(validatedData.password);

  if (!isPasswordMatch) {
    throw new UnauthorizedError('Invalid email or password');
  }

  // Send token response
  sendTokenResponse(user, 200, res);
}));

/**
 * @route   GET /api/auth/me
 * @desc    Get current logged in user
 * @access  Private
 */
router.get('/me', protect, asyncHandler(async (req: AuthRequest, res) => {
  // User is already attached to req by protect middleware
  const user = await User.findById(req.userId);

  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  res.json({
    success: true,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      createdAt: user.createdAt
    }
  });
}));

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user / Clear cookie
 * @access  Private
 */
router.post('/logout', protect, asyncHandler(async (req, res) => {
  // Clear the token cookie
  res.cookie('token', '', {
    expires: new Date(0),
    httpOnly: true
  });

  return successResponse(res, 200, 'Logged out successfully');
}));

/**
 * @route   PUT /api/auth/updatepassword
 * @desc    Update user password
 * @access  Private
 */
router.put('/updatepassword', protect, asyncHandler(async (req: AuthRequest, res) => {
  // Validate input
  const validatedData = updatePasswordSchema.parse(req.body);

  // Get user with password
  const user = await User.findById(req.userId).select('+password');

  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  // Check current password
  const isPasswordMatch = await user.comparePassword(validatedData.currentPassword);

  if (!isPasswordMatch) {
    throw new UnauthorizedError('Current password is incorrect');
  }

  // Update password
  user.password = validatedData.newPassword;
  await user.save();

  // Send new token
  sendTokenResponse(user, 200, res);
}));

/**
 * @route   POST /api/auth/forgotpassword
 * @desc    Send password reset email (placeholder)
 * @access  Public
 * @note    In production, implement actual email sending
 */
router.post('/forgotpassword', asyncHandler(async (req, res) => {
  // Validate input
  const validatedData = forgotPasswordSchema.parse(req.body);

  // Find user
  const user = await User.findOne({ email: validatedData.email });

  if (!user) {
    // For security, don't reveal if email exists
    return successResponse(
      res, 
      200, 
      'If an account exists with this email, a password reset link has been sent'
    );
  }

  // TODO: Generate reset token and send email
  // In production:
  // 1. Generate crypto token
  // 2. Save token hash to user document with expiry
  // 3. Send email with reset link
  // 4. Implement reset password route

  console.log(`Password reset requested for: ${user.email}`);

  return successResponse(
    res, 
    200, 
    'If an account exists with this email, a password reset link has been sent'
  );
}));

/**
 * @route   GET /api/auth/verify
 * @desc    Verify if token is valid (useful for frontend)
 * @access  Private
 */
router.get('/verify', protect, asyncHandler(async (req: AuthRequest, res) => {
  res.json({
    success: true,
    message: 'Token is valid',
    userId: req.userId
  });
}));

/**
 * @route   DELETE /api/auth/deleteaccount
 * @desc    Delete user account (with confirmation)
 * @access  Private
 */
router.delete('/deleteaccount', protect, asyncHandler(async (req: AuthRequest, res) => {
  const { password } = req.body;

  if (!password) {
    throw new BadRequestError('Please provide your password to confirm deletion');
  }

  // Get user with password
  const user = await User.findById(req.userId).select('+password');

  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  // Verify password
  const isPasswordMatch = await user.comparePassword(password);

  if (!isPasswordMatch) {
    throw new UnauthorizedError('Incorrect password');
  }

  // Delete user's tasks first (optional, depends on your data structure)
  // await Task.deleteMany({ userId: user._id });

  // Delete user
  await User.findByIdAndDelete(user._id);

  // Clear cookie
  res.cookie('token', '', {
    expires: new Date(0),
    httpOnly: true
  });

  return successResponse(res, 200, 'Account deleted successfully');
}));

/**
 * @route   POST /api/auth/refresh
 * @desc    Refresh access token (advanced feature)
 * @access  Public (with refresh token)
 * @note    Requires implementing refresh token system
 */
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    throw new BadRequestError('Refresh token is required');
  }

  // TODO: Implement refresh token validation
  // 1. Verify refresh token
  // 2. Check if token is in database/redis
  // 3. Generate new access token
  // 4. Return new access token

  throw new BadRequestError('Refresh token feature not yet implemented');
}));

/**
 * @route   GET /api/auth/sessions
 * @desc    Get all active sessions for user (advanced feature)
 * @access  Private
 * @note    Requires implementing session tracking
 */
router.get('/sessions', protect, asyncHandler(async (req: AuthRequest, res) => {
  // TODO: Implement session tracking
  // Store active sessions in Redis or database
  // Return list of active devices/sessions

  res.json({
    success: true,
    message: 'Session tracking not yet implemented',
    sessions: []
  });
}));

/**
 * Error handling for Zod validation
 */
router.use((error: any, req: express.Request, res: Response, next: express.NextFunction) => {
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message
      }))
    });
  }
  next(error);
});

export default router;