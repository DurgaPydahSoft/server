import mongoose from 'mongoose';

const memberSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters long'],
    maxlength: [50, 'Name cannot exceed 50 characters']
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true,
    match: [/^[0-9]{10}$/, 'Please enter a valid 10-digit phone number'],
    validate: {
      validator: function(v) {
        return /^[0-9]{10}$/.test(v);
      },
      message: props => `${props.value} is not a valid phone number! Must be 10 digits.`
    }
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    trim: true,
    enum: {
      values: ['Canteen', 'Internet', 'Housekeeping', 'Plumbing', 'Electricity', 'Others', 'Maintenance'],
      message: props => `${props.value} is not a valid category! Must be one of: Canteen, Internet, Housekeeping, Plumbing, Electricity, Others, Maintenance`
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // AI efficiency tracking fields
  efficiencyScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  resolvedComplaints: {
    type: Number,
    default: 0
  },
  averageResolutionTime: {
    type: Number,
    default: 0 // in hours
  },
  categoryExpertise: {
    Canteen: { type: Number, default: 0, min: 0, max: 100 },
    Internet: { type: Number, default: 0, min: 0, max: 100 },
    Housekeeping: { type: Number, default: 0, min: 0, max: 100 },
    Plumbing: { type: Number, default: 0, min: 0, max: 100 },
    Electricity: { type: Number, default: 0, min: 0, max: 100 },
    Others: { type: Number, default: 0, min: 0, max: 100 }
  },
  lastActive: {
    type: Date,
    default: Date.now
  },
  currentWorkload: {
    type: Number,
    default: 0 // active complaints count
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  // Add JSON transform options
  toJSON: {
    virtuals: true,
    transform: (doc, ret) => {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  },
  toObject: {
    virtuals: true,
    transform: (doc, ret) => {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  }
});

// Add index for faster queries
memberSchema.index({ category: 1, name: 1 });
memberSchema.index({ efficiencyScore: -1 }); // For AI selection
memberSchema.index({ currentWorkload: 1 }); // For workload consideration

// Ensure at least 2 members per category
memberSchema.pre('findOneAndDelete', async function(next) {
  const member = await this.model.findOne(this.getQuery());
  if (!member) return next();

  const categoryCount = await this.model.countDocuments({ 
    category: member.category,
    isActive: true
  });
  
  if (categoryCount <= 2) {
    next(new Error('Cannot delete member. Minimum 2 members required per category.'));
  } else {
    next();
  }
});

// Add pre-save middleware to validate phone number
memberSchema.pre('save', function(next) {
  if (this.isModified('phone')) {
    if (!/^[0-9]{10}$/.test(this.phone)) {
      next(new Error('Invalid phone number format. Must be 10 digits.'));
    }
  }
  next();
});

// Method to update efficiency metrics
memberSchema.methods.updateEfficiencyMetrics = async function() {
  const Complaint = mongoose.model('Complaint');
  
  // Get resolved complaints for this member
  const resolvedComplaints = await Complaint.find({
    assignedTo: this._id,
    currentStatus: 'Closed'
  }).sort({ createdAt: -1 }).limit(50); // Last 50 complaints
  
  if (resolvedComplaints.length === 0) {
    this.efficiencyScore = 0;
    this.resolvedComplaints = 0;
    this.averageResolutionTime = 0;
    return this.save();
  }
  
  // Calculate average resolution time
  let totalTime = 0;
  resolvedComplaints.forEach(complaint => {
    const createdAt = new Date(complaint.createdAt);
    const resolvedAt = new Date(complaint.updatedAt);
    const resolutionTime = (resolvedAt - createdAt) / (1000 * 60 * 60); // hours
    totalTime += resolutionTime;
  });
  
  this.averageResolutionTime = totalTime / resolvedComplaints.length;
  this.resolvedComplaints = resolvedComplaints.length;
  
  // Calculate efficiency score based on resolution time and success rate
  // Lower resolution time = higher score
  const timeScore = Math.max(0, 100 - (this.averageResolutionTime * 2)); // 50 hours = 0 score
  this.efficiencyScore = Math.min(100, timeScore);
  
  return this.save();
};

// Method to update current workload
memberSchema.methods.updateWorkload = async function() {
  const Complaint = mongoose.model('Complaint');
  
  const activeComplaints = await Complaint.countDocuments({
    assignedTo: this._id,
    currentStatus: { $in: ['Pending', 'In Progress'] }
  });
  
  this.currentWorkload = activeComplaints;
  this.lastActive = new Date();
  
  return this.save();
};

const Member = mongoose.model('Member', memberSchema);

export default Member;