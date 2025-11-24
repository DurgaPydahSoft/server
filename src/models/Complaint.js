import mongoose from 'mongoose';

// Using modern schema definition with type inference
const statusSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['Received', 'In Progress', 'Resolved', 'Closed'],
    default: 'Received',
    required: true
  },
  timestamp: {
    type: Date,
    default: () => new Date(), // Using arrow function for default
    required: true
  },
  note: {
    type: String,
    trim: true,
    maxLength: 500 // Adding reasonable limit
  }
}, { _id: false }); // Disable _id for subdocuments

const feedbackSchema = new mongoose.Schema({
  isSatisfied: {
    type: Boolean,
    required: [true, 'Feedback satisfaction status is required']
  },
  comment: {
    type: String,
    trim: true,
    maxLength: 500 // Adding reasonable limit
  },
  timestamp: {
    type: Date,
    default: () => new Date(),
    required: true
  }
}, { _id: false }); // Disable _id for subdocuments

const complaintSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false, // Make it optional, we'll handle validation in the controller
    index: true
  },
  // Warden fields
  warden: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null,
    index: true
  },
  complaintType: {
    type: String,
    enum: ['student', 'facility'],
    default: 'student'
  },
  raisedBy: {
    type: String,
    enum: ['student', 'warden'],
    default: 'student'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    enum: {
      values: ['Canteen', 'Internet', 'Maintenance', 'Common Facilities', 'Others'],
      message: props => `${props.value} is not a valid category`
    },
    index: true
  },
  imageUrl: {
    type: String,
    trim: true
  },
  subCategory: {
    type: String,
    validate: {
      validator: function(v) {
        // If category is not Maintenance or Common Facilities, subCategory should be null/undefined
        if (this.category !== 'Maintenance' && this.category !== 'Common Facilities') {
          return !v; // Must be null/undefined for other categories
        }
        // For Maintenance category, require a valid sub-category
        if (this.category === 'Maintenance') {
          return ['Housekeeping', 'Plumbing', 'Electricity'].includes(v);
        }
        // For Common Facilities category, require a valid sub-category
        if (this.category === 'Common Facilities') {
          return ['Laundry', 'Recreation', 'Study Room', 'Dining Hall', 'Security'].includes(v);
        }
        return true;
      },
      message: function(props) {
        if (this.category !== 'Maintenance' && this.category !== 'Common Facilities') {
          return 'Sub-category should not be provided for this category';
        }
        if (this.category === 'Maintenance') {
          return 'Sub-category must be one of: Housekeeping, Plumbing, Electricity for Maintenance complaints';
        }
        if (this.category === 'Common Facilities') {
          return 'Sub-category must be one of: Laundry, Recreation, Study Room, Dining Hall, Security for Common Facilities complaints';
        }
        return 'Invalid sub-category';
      }
    }
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    trim: true,
    maxLength: [1000, 'Description cannot exceed 1000 characters'],
    minLength: [10, 'Description must be at least 10 characters long']
  },
  currentStatus: {
    type: String,
    enum: ['Received', 'In Progress', 'Resolved', 'Closed'],
    default: 'Received',
    index: true
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Member',
    default: null,
    index: true
  },
  statusHistory: {
    type: [statusSchema],
    default: () => [{ status: 'Received', timestamp: new Date() }]
  },
  feedback: {
    type: feedbackSchema,
    default: null
  },
  isReopened: {
    type: Boolean,
    default: false
  },
  isLockedForUpdates: {
    type: Boolean,
    default: false
  },
  // AI processing fields
  aiProcessed: {
    type: Boolean,
    default: false
  },
  aiProcessingTime: {
    type: Number,
    default: null // in milliseconds
  },
  aiAssignedMember: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Member',
    default: null
  }
}, {
  timestamps: true,
  // Enable optimistic concurrency control
  optimisticConcurrency: true,
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

// Compound indexes for common query patterns
complaintSchema.index({ student: 1, currentStatus: 1 });
complaintSchema.index({ category: 1, currentStatus: 1 });
complaintSchema.index({ createdAt: -1 }); // For sorting by newest first

// Virtual for complaint age
complaintSchema.virtual('age').get(function() {
  return Math.floor((Date.now() - this.createdAt) / (1000 * 60 * 60 * 24)); // Age in days
});

// Method to calculate time spent in each active status
complaintSchema.methods.getActiveStatusDuration = function() {
  const activeStatuses = ['Received', 'In Progress'];
  const now = new Date();
  let totalDuration = 0;
  
  // Sort status history by timestamp
  const sortedHistory = [...this.statusHistory].sort((a, b) => 
    new Date(a.timestamp) - new Date(b.timestamp)
  );
  
  // Add current status if not in history
  if (sortedHistory.length === 0 || sortedHistory[sortedHistory.length - 1].status !== this.currentStatus) {
    sortedHistory.push({
      status: this.currentStatus,
      timestamp: now
    });
  }
  
  // Calculate duration for each status period
  for (let i = 0; i < sortedHistory.length; i++) {
    const current = sortedHistory[i];
    const next = sortedHistory[i + 1];
    
    if (activeStatuses.includes(current.status)) {
      const startTime = new Date(current.timestamp);
      const endTime = next ? new Date(next.timestamp) : now;
      totalDuration += (endTime - startTime) / (1000 * 60 * 60 * 24); // Convert to days
    }
  }
  
  return Math.floor(totalDuration);
};

// Static method to find active complaints
complaintSchema.statics.findActive = function() {
  return this.find({
    currentStatus: { $in: ['Received', 'In Progress'] }
  });
};

// Static method to find complaints by student with status
complaintSchema.statics.findByStudent = function(studentId, status = null) {
  const query = { student: studentId };
  if (status) query.currentStatus = status;
  return this.find(query).sort({ createdAt: -1 });
};

// Instance method to update status with validation
complaintSchema.methods.updateStatus = async function(newStatus, note = '') {
  if (this.currentStatus === 'Closed' && newStatus !== 'Closed') { // Allow setting to Closed if it is already closed (idempotent)
    throw new Error('Complaint is already Closed and its status cannot be changed.');
  }
  if (!['Received', 'In Progress', 'Resolved', 'Closed'].includes(newStatus)) {
    throw new Error('Invalid status');
  }

  this.currentStatus = newStatus;
  this.statusHistory.push({
    status: newStatus,
    note: note?.trim(),
    timestamp: new Date()
  });
  
  if (newStatus === 'Resolved') {
    this.isReopened = false;
    this.feedback = null; // Clear previous feedback so student can give new feedback
  } else if (newStatus === 'Closed') {
    this.isReopened = false; // Ensure this is false when closed
    // Feedback would have just been set by addFeedback method before calling updateStatus('Closed',...)
  }
  
  return this.save();
};

// Instance method to add feedback with validation
complaintSchema.methods.addFeedback = async function(isSatisfied, comment = '') {
  console.log(`Status of complaint ${this._id} INSIDE addFeedback (at the start): ${this.currentStatus}`);

  if (this.currentStatus === 'Closed') {
    throw new Error('Feedback cannot be added to a Closed complaint.');
  }
  if (this.currentStatus !== 'Resolved') {
    throw new Error('Feedback can only be added to resolved complaints.');
  }

  this.feedback = {
    isSatisfied,
    comment: comment?.trim(),
    timestamp: new Date()
  };
  
  if (!isSatisfied) {
    this.isReopened = true;
    // updateStatus will save the document. We don't need to save again in this block.
    return this.updateStatus('Received', comment ? `Reopened due to feedback: ${comment}` : 'Complaint reopened due to unsatisfactory feedback');
  } else {
    // If satisfied, lock the complaint.
    this.isReopened = false;
    this.isLockedForUpdates = true; 
    return this.save();
  }
};

// Pre-save middleware for member assignment validation
complaintSchema.pre('save', async function(next) {
  if (this.isModified('assignedTo') && this.assignedTo) {
    try {
      const Member = mongoose.model('Member');
      const member = await Member.findById(this.assignedTo);
      
      if (!member) {
        throw new Error('Assigned member not found');
      }

      // Removed category validation to allow any member to be assigned to any complaint
      // This provides more flexibility in resource allocation
    } catch (error) {
      next(error);
      return;
    }
  }
  next();
});

const Complaint = mongoose.model('Complaint', complaintSchema);

export default Complaint; 