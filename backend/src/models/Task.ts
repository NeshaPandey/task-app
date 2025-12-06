// backend/src/models/Task.ts
import mongoose, { Document, Schema } from 'mongoose';

/**
 * Task Status Enum
 */
export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in-progress',
  COMPLETED = 'completed'
}

/**
 * Task Priority Enum
 */
export enum TaskPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high'
}

/**
 * Task Interface
 * Defines the structure of a Task document in MongoDB
 */
export interface ITask extends Document {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  userId: mongoose.Types.ObjectId;
  dueDate?: Date;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Task Schema
 * Defines validation rules and structure for Task collection
 */
const TaskSchema = new Schema<ITask>({
  title: {
    type: String,
    required: [true, 'Task title is required'],
    trim: true,
    minlength: [3, 'Title must be at least 3 characters long'],
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters'],
    default: ''
  },
  status: {
    type: String,
    enum: {
      values: Object.values(TaskStatus),
      message: 'Status must be either pending, in-progress, or completed'
    },
    default: TaskStatus.PENDING
  },
  priority: {
    type: String,
    enum: {
      values: Object.values(TaskPriority),
      message: 'Priority must be either low, medium, or high'
    },
    default: TaskPriority.MEDIUM
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
    index: true // Index for faster queries
  },
  dueDate: {
    type: Date,
    validate: {
      validator: function(value: Date) {
        // Ensure due date is not in the past (only for new tasks)
        if (this.isNew && value) {
          return value >= new Date();
        }
        return true;
      },
      message: 'Due date cannot be in the past'
    }
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true,
    maxlength: [20, 'Each tag cannot exceed 20 characters']
  }]
}, {
  timestamps: true // Automatically adds createdAt and updatedAt fields
});

/**
 * Compound Indexes for Optimized Queries
 * These improve query performance for common operations
 */

// Index for finding user's tasks by status
TaskSchema.index({ userId: 1, status: 1 });

// Index for finding user's tasks sorted by creation date
TaskSchema.index({ userId: 1, createdAt: -1 });

// Index for finding user's tasks by priority
TaskSchema.index({ userId: 1, priority: 1 });

// Index for finding tasks by due date
TaskSchema.index({ userId: 1, dueDate: 1 });

// Text index for searching in title and description
TaskSchema.index({ title: 'text', description: 'text' });

/**
 * Virtual Property: isOverdue
 * Checks if task is overdue (has dueDate in past and not completed)
 */
TaskSchema.virtual('isOverdue').get(function() {
  if (!this.dueDate || this.status === TaskStatus.COMPLETED) {
    return false;
  }
  return this.dueDate < new Date();
});

/**
 * Instance Method: markAsCompleted
 * Convenience method to mark task as completed
 */
TaskSchema.methods.markAsCompleted = function() {
  this.status = TaskStatus.COMPLETED;
  return this.save();
};

/**
 * Instance Method: addTag
 * Adds a tag to the task if it doesn't already exist
 */
TaskSchema.methods.addTag = function(tag: string) {
  const normalizedTag = tag.toLowerCase().trim();
  if (!this.tags.includes(normalizedTag)) {
    this.tags.push(normalizedTag);
  }
  return this.save();
};

/**
 * Instance Method: removeTag
 * Removes a tag from the task
 */
TaskSchema.methods.removeTag = function(tag: string) {
  const normalizedTag = tag.toLowerCase().trim();
  this.tags = this.tags.filter(t => t !== normalizedTag);
  return this.save();
};

/**
 * Static Method: getTaskStats
 * Get statistics for a user's tasks
 */
TaskSchema.statics.getTaskStats = async function(userId: mongoose.Types.ObjectId) {
  const stats = await this.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);

  const result = {
    total: 0,
    pending: 0,
    inProgress: 0,
    completed: 0
  };

  stats.forEach(stat => {
    result.total += stat.count;
    switch (stat._id) {
      case TaskStatus.PENDING:
        result.pending = stat.count;
        break;
      case TaskStatus.IN_PROGRESS:
        result.inProgress = stat.count;
        break;
      case TaskStatus.COMPLETED:
        result.completed = stat.count;
        break;
    }
  });

  return result;
};

/**
 * Static Method: findByTag
 * Find all tasks with a specific tag for a user
 */
TaskSchema.statics.findByTag = function(userId: mongoose.Types.ObjectId, tag: string) {
  return this.find({
    userId,
    tags: tag.toLowerCase().trim()
  }).sort({ createdAt: -1 });
};

/**
 * Static Method: findOverdue
 * Find all overdue tasks for a user
 */
TaskSchema.statics.findOverdue = function(userId: mongoose.Types.ObjectId) {
  return this.find({
    userId,
    dueDate: { $lt: new Date() },
    status: { $ne: TaskStatus.COMPLETED }
  }).sort({ dueDate: 1 });
};

/**
 * Pre-save Middleware
 * Normalize tags before saving
 */
TaskSchema.pre('save', function(next) {
  // Remove duplicate tags and normalize
  if (this.tags && this.tags.length > 0) {
    this.tags = [...new Set(this.tags.map(tag => tag.toLowerCase().trim()))];
  }
  next();
});

/**
 * Pre-remove Middleware
 * Could be used for cleanup operations
 */
TaskSchema.pre('remove', function(next) {
  // Add any cleanup logic here (e.g., remove related data)
  console.log(`Task ${this._id} is being removed`);
  next();
});

/**
 * Configure virtuals to be included in JSON
 */
TaskSchema.set('toJSON', { virtuals: true });
TaskSchema.set('toObject', { virtuals: true });

/**
 * Export Task Model
 */
export default mongoose.model<ITask>('Task', TaskSchema);