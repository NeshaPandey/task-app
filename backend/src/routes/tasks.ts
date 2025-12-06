// backend/src/routes/tasks.ts
import express, { Response } from 'express';
import { z } from 'zod';
import Task, { TaskStatus, TaskPriority } from '../models/Task';
import { protect, AuthRequest } from '../middleware/auth';
import { 
  asyncHandler, 
  NotFoundError, 
  BadRequestError,
  UnauthorizedError,
  successResponse 
} from '../middleware/errorHandler';

const router = express.Router();

// All routes in this file are protected (require authentication)
router.use(protect);

/**
 * Validation Schemas using Zod
 */

// Create Task Schema
const createTaskSchema = z.object({
  title: z.string()
    .min(3, 'Title must be at least 3 characters')
    .max(100, 'Title cannot exceed 100 characters')
    .trim(),
  description: z.string()
    .max(500, 'Description cannot exceed 500 characters')
    .trim()
    .optional()
    .default(''),
  status: z.enum(['pending', 'in-progress', 'completed'])
    .optional()
    .default('pending'),
  priority: z.enum(['low', 'medium', 'high'])
    .optional()
    .default('medium'),
  dueDate: z.string()
    .datetime()
    .optional()
    .transform(val => val ? new Date(val) : undefined),
  tags: z.array(z.string().trim())
    .optional()
    .default([])
});

// Update Task Schema (all fields optional)
const updateTaskSchema = createTaskSchema.partial();

// Query Parameters Schema
const querySchema = z.object({
  status: z.enum(['pending', 'in-progress', 'completed']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  search: z.string().optional(),
  sortBy: z.string().optional().default('createdAt'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.string().optional().transform(val => val ? parseInt(val) : 1),
  limit: z.string().optional().transform(val => val ? parseInt(val) : 10),
  tags: z.string().optional() // Comma-separated tags
});

/**
 * @route   GET /api/tasks
 * @desc    Get all tasks for the logged-in user with filters and pagination
 * @access  Private
 * @query   status, priority, search, sortBy, order, page, limit, tags
 */
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  // Validate and parse query parameters
  const query = querySchema.parse(req.query);

  // Build MongoDB query
  const filter: any = { userId: req.userId };

  // Filter by status
  if (query.status) {
    filter.status = query.status;
  }

  // Filter by priority
  if (query.priority) {
    filter.priority = query.priority;
  }

  // Search in title and description
  if (query.search) {
    filter.$or = [
      { title: { $regex: query.search, $options: 'i' } },
      { description: { $regex: query.search, $options: 'i' } }
    ];
  }

  // Filter by tags
  if (query.tags) {
    const tagArray = query.tags.split(',').map(tag => tag.trim().toLowerCase());
    filter.tags = { $in: tagArray };
  }

  // Calculate pagination
  const page = query.page || 1;
  const limit = query.limit || 10;
  const skip = (page - 1) * limit;

  // Build sort object
  const sortOrder = query.order === 'asc' ? 1 : -1;
  const sort: any = { [query.sortBy || 'createdAt']: sortOrder };

  // Execute query with pagination
  const [tasks, totalTasks] = await Promise.all([
    Task.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Task.countDocuments(filter)
  ]);

  // Calculate pagination info
  const totalPages = Math.ceil(totalTasks / limit);
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;

  res.json({
    success: true,
    count: tasks.length,
    total: totalTasks,
    page,
    totalPages,
    hasNextPage,
    hasPrevPage,
    tasks
  });
}));

/**
 * @route   GET /api/tasks/stats
 * @desc    Get task statistics for the logged-in user
 * @access  Private
 */
router.get('/stats', asyncHandler(async (req: AuthRequest, res: Response) => {
  const stats = await Task.aggregate([
    { 
      $match: { userId: req.userId } 
    },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        pending: {
          $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
        },
        inProgress: {
          $sum: { $cond: [{ $eq: ['$status', 'in-progress'] }, 1, 0] }
        },
        completed: {
          $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
        },
        highPriority: {
          $sum: { $cond: [{ $eq: ['$priority', 'high'] }, 1, 0] }
        },
        mediumPriority: {
          $sum: { $cond: [{ $eq: ['$priority', 'medium'] }, 1, 0] }
        },
        lowPriority: {
          $sum: { $cond: [{ $eq: ['$priority', 'low'] }, 1, 0] }
        }
      }
    }
  ]);

  const result = stats[0] || {
    total: 0,
    pending: 0,
    inProgress: 0,
    completed: 0,
    highPriority: 0,
    mediumPriority: 0,
    lowPriority: 0
  };

  // Remove the _id field
  delete result._id;

  res.json({
    success: true,
    stats: result
  });
}));

/**
 * @route   GET /api/tasks/overdue
 * @desc    Get all overdue tasks for the logged-in user
 * @access  Private
 */
router.get('/overdue', asyncHandler(async (req: AuthRequest, res: Response) => {
  const overdueTasks = await Task.find({
    userId: req.userId,
    dueDate: { $lt: new Date() },
    status: { $ne: 'completed' }
  })
    .sort({ dueDate: 1 })
    .lean();

  res.json({
    success: true,
    count: overdueTasks.length,
    tasks: overdueTasks
  });
}));

/**
 * @route   GET /api/tasks/upcoming
 * @desc    Get upcoming tasks (due in next 7 days)
 * @access  Private
 */
router.get('/upcoming', asyncHandler(async (req: AuthRequest, res: Response) => {
  const today = new Date();
  const nextWeek = new Date();
  nextWeek.setDate(today.getDate() + 7);

  const upcomingTasks = await Task.find({
    userId: req.userId,
    dueDate: { 
      $gte: today,
      $lte: nextWeek 
    },
    status: { $ne: 'completed' }
  })
    .sort({ dueDate: 1 })
    .lean();

  res.json({
    success: true,
    count: upcomingTasks.length,
    tasks: upcomingTasks
  });
}));

/**
 * @route   GET /api/tasks/tags
 * @desc    Get all unique tags used by the user
 * @access  Private
 */
router.get('/tags', asyncHandler(async (req: AuthRequest, res: Response) => {
  const tags = await Task.distinct('tags', { userId: req.userId });

  res.json({
    success: true,
    count: tags.length,
    tags: tags.sort()
  });
}));

/**
 * @route   GET /api/tasks/:id
 * @desc    Get a single task by ID
 * @access  Private
 */
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const task = await Task.findOne({
    _id: req.params.id,
    userId: req.userId
  });

  if (!task) {
    throw new NotFoundError('Task not found');
  }

  res.json({
    success: true,
    task
  });
}));

/**
 * @route   POST /api/tasks
 * @desc    Create a new task
 * @access  Private
 */
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  // Validate input data
  const validatedData = createTaskSchema.parse(req.body);

  // Create task with user ID
  const task = await Task.create({
    ...validatedData,
    userId: req.userId
  });

  res.status(201).json({
    success: true,
    message: 'Task created successfully',
    task
  });
}));

/**
 * @route   PUT /api/tasks/:id
 * @desc    Update a task
 * @access  Private
 */
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  // Find task first to check ownership
  let task = await Task.findOne({
    _id: req.params.id,
    userId: req.userId
  });

  if (!task) {
    throw new NotFoundError('Task not found');
  }

  // Validate update data
  const validatedData = updateTaskSchema.parse(req.body);

  // Update task
  task = await Task.findByIdAndUpdate(
    req.params.id,
    validatedData,
    { 
      new: true, // Return updated document
      runValidators: true // Run schema validators
    }
  );

  res.json({
    success: true,
    message: 'Task updated successfully',
    task
  });
}));

/**
 * @route   PATCH /api/tasks/:id/status
 * @desc    Update only the status of a task
 * @access  Private
 */
router.patch('/:id/status', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { status } = req.body;

  // Validate status
  if (!status || !['pending', 'in-progress', 'completed'].includes(status)) {
    throw new BadRequestError('Invalid status. Must be: pending, in-progress, or completed');
  }

  // Find and update task
  const task = await Task.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    { status },
    { new: true, runValidators: true }
  );

  if (!task) {
    throw new NotFoundError('Task not found');
  }

  res.json({
    success: true,
    message: 'Task status updated successfully',
    task
  });
}));

/**
 * @route   PATCH /api/tasks/:id/priority
 * @desc    Update only the priority of a task
 * @access  Private
 */
router.patch('/:id/priority', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { priority } = req.body;

  // Validate priority
  if (!priority || !['low', 'medium', 'high'].includes(priority)) {
    throw new BadRequestError('Invalid priority. Must be: low, medium, or high');
  }

  // Find and update task
  const task = await Task.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    { priority },
    { new: true, runValidators: true }
  );

  if (!task) {
    throw new NotFoundError('Task not found');
  }

  res.json({
    success: true,
    message: 'Task priority updated successfully',
    task
  });
}));

/**
 * @route   POST /api/tasks/:id/tags
 * @desc    Add a tag to a task
 * @access  Private
 */
router.post('/:id/tags', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { tag } = req.body;

  if (!tag || typeof tag !== 'string') {
    throw new BadRequestError('Tag is required and must be a string');
  }

  const task = await Task.findOne({
    _id: req.params.id,
    userId: req.userId
  });

  if (!task) {
    throw new NotFoundError('Task not found');
  }

  // Add tag using the model method
  await task.addTag(tag);

  res.json({
    success: true,
    message: 'Tag added successfully',
    task
  });
}));

/**
 * @route   DELETE /api/tasks/:id/tags/:tag
 * @desc    Remove a tag from a task
 * @access  Private
 */
router.delete('/:id/tags/:tag', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { tag } = req.params;

  const task = await Task.findOne({
    _id: req.params.id,
    userId: req.userId
  });

  if (!task) {
    throw new NotFoundError('Task not found');
  }

  // Remove tag using the model method
  await task.removeTag(tag);

  res.json({
    success: true,
    message: 'Tag removed successfully',
    task
  });
}));

/**
 * @route   DELETE /api/tasks/:id
 * @desc    Delete a task
 * @access  Private
 */
router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const task = await Task.findOneAndDelete({
    _id: req.params.id,
    userId: req.userId
  });

  if (!task) {
    throw new NotFoundError('Task not found');
  }

  res.json({
    success: true,
    message: 'Task deleted successfully'
  });
}));

/**
 * @route   DELETE /api/tasks
 * @desc    Delete multiple tasks
 * @access  Private
 */
router.delete('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { taskIds } = req.body;

  if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
    throw new BadRequestError('Task IDs array is required');
  }

  // Delete multiple tasks
  const result = await Task.deleteMany({
    _id: { $in: taskIds },
    userId: req.userId
  });

  res.json({
    success: true,
    message: `${result.deletedCount} task(s) deleted successfully`,
    deletedCount: result.deletedCount
  });
}));

/**
 * @route   POST /api/tasks/:id/duplicate
 * @desc    Duplicate a task
 * @access  Private
 */
router.post('/:id/duplicate', asyncHandler(async (req: AuthRequest, res: Response) => {
  const originalTask = await Task.findOne({
    _id: req.params.id,
    userId: req.userId
  });

  if (!originalTask) {
    throw new NotFoundError('Task not found');
  }

  // Create duplicate task
  const duplicateTask = await Task.create({
    title: `${originalTask.title} (Copy)`,
    description: originalTask.description,
    status: 'pending', // Reset status
    priority: originalTask.priority,
    userId: req.userId,
    tags: [...originalTask.tags]
  });

  res.status(201).json({
    success: true,
    message: 'Task duplicated successfully',
    task: duplicateTask
  });
}));

/**
 * @route   POST /api/tasks/bulk-update
 * @desc    Bulk update multiple tasks
 * @access  Private
 */
router.post('/bulk-update', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { taskIds, updates } = req.body;

  if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
    throw new BadRequestError('Task IDs array is required');
  }

  if (!updates || typeof updates !== 'object') {
    throw new BadRequestError('Updates object is required');
  }

  // Validate updates using partial schema
  const validatedUpdates = updateTaskSchema.parse(updates);

  // Update multiple tasks
  const result = await Task.updateMany(
    { 
      _id: { $in: taskIds },
      userId: req.userId 
    },
    validatedUpdates
  );

  res.json({
    success: true,
    message: `${result.modifiedCount} task(s) updated successfully`,
    modifiedCount: result.modifiedCount
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