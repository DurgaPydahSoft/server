import mongoose from 'mongoose';

const courseSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true
  },
  description: {
    type: String,
    trim: true
  },
  duration: {
    type: Number,
    required: true,
    min: 1,
    max: 10
  },
  durationUnit: {
    type: String,
    enum: ['years', 'semesters'],
    default: 'years'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  }
}, {
  timestamps: true
});

// Index for better query performance
courseSchema.index({ code: 1 });
courseSchema.index({ isActive: 1 });

// Virtual for branches
courseSchema.virtual('branches', {
  ref: 'Branch',
  localField: '_id',
  foreignField: 'course'
});

// Ensure virtuals are included when converting to JSON
courseSchema.set('toJSON', { virtuals: true });
courseSchema.set('toObject', { virtuals: true });

const Course = mongoose.model('Course', courseSchema);

export default Course; 