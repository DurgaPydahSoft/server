import mongoose from 'mongoose';

const nocChecklistConfigSchema = new mongoose.Schema({
  // Checklist item details
  description: {
    type: String,
    required: true,
    trim: true,
    maxLength: [200, 'Description cannot exceed 200 characters']
  },
  // Display order
  order: {
    type: Number,
    required: true,
    default: 0
  },
  // Whether this item is active
  isActive: {
    type: Boolean,
    default: true
  },
  // Whether this item requires remarks
  requiresRemarks: {
    type: Boolean,
    default: false
  },
  // Whether this item requires signature
  requiresSignature: {
    type: Boolean,
    default: false
  },
  // Default value hint (e.g., "Clear", "—", "5000/-")
  defaultValue: {
    type: String,
    trim: true,
    maxLength: [100, 'Default value cannot exceed 100 characters']
  },
  // Created/Updated by
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (doc, ret) => {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  }
});

// Indexes
nocChecklistConfigSchema.index({ order: 1, isActive: 1 });
nocChecklistConfigSchema.index({ isActive: 1 });

const NOCChecklistConfig = mongoose.model('NOCChecklistConfig', nocChecklistConfigSchema);

export default NOCChecklistConfig;

