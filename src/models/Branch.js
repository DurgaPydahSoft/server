import mongoose from 'mongoose';

const branchSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  code: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true
  },
  description: {
    type: String,
    trim: true
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

// Compound index to ensure unique branch code per course
branchSchema.index({ course: 1, code: 1 }, { unique: true });
branchSchema.index({ isActive: 1 });
branchSchema.index({ course: 1, isActive: 1 });

const Branch = mongoose.model('Branch', branchSchema);

export default Branch; 