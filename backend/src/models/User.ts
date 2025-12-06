// backend/src/models/User.ts
import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

/**
 * User Interface
 * Defines the structure of a User document in MongoDB
 */
export interface IUser extends Document {
  email: string;
  password: string;
  name: string;
  avatar?: string;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

/**
 * User Schema
 * Defines validation rules and structure for User collection
 */
const UserSchema = new Schema<IUser>({
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters long'],
    select: false // Don't return password by default in queries
  },
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters long'],
    maxlength: [50, 'Name cannot exceed 50 characters']
  },
  avatar: {
    type: String,
    default: ''
  }
}, {
  timestamps: true // Automatically adds createdAt and updatedAt fields
});

/**
 * Pre-save Middleware
 * Hashes the password before saving to database
 * Only runs if password is modified
 */
UserSchema.pre('save', async function(next) {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password')) {
    return next();
  }
  
  try {
    // Generate salt and hash password
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error: any) {
    next(error);
  }
});

/**
 * Instance Method: comparePassword
 * Compares a plain text password with the hashed password
 * @param candidatePassword - The plain text password to compare
 * @returns Promise<boolean> - True if passwords match, false otherwise
 */
UserSchema.methods.comparePassword = async function(
  candidatePassword: string
): Promise<boolean> {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw new Error('Password comparison failed');
  }
};

/**
 * Index for faster email lookups
 */
UserSchema.index({ email: 1 });

/**
 * Export User Model
 */
export default mongoose.model<IUser>('User', UserSchema);