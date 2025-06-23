import mongoose from 'mongoose';

const leaveSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Application type: 'Leave' or 'Permission'
  applicationType: {
    type: String,
    enum: ['Leave', 'Permission'],
    required: true
  },
  // For Leave applications
  startDate: {
    type: Date,
    required: function() { return this.applicationType === 'Leave'; }
  },
  endDate: {
    type: Date,
    required: function() { return this.applicationType === 'Leave'; }
  },
  // For Permission applications
  permissionDate: {
    type: Date,
    required: function() { return this.applicationType === 'Permission'; }
  },
  outTime: {
    type: String, // Format: "HH:MM"
    required: function() { return this.applicationType === 'Permission'; }
  },
  inTime: {
    type: String, // Format: "HH:MM"
    required: function() { return this.applicationType === 'Permission'; }
  },
  // Gate pass date and time (for Leave applications only)
  gatePassDateTime: {
    type: Date,
    required: function() { return this.applicationType === 'Leave'; }
  },
  numberOfDays: {
    type: Number,
    required: function() { return this.applicationType === 'Leave'; },
    min: 1
  },
  reason: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['Pending', 'Pending OTP Verification', 'Approved', 'Rejected'],
    default: 'Pending'
  },
  otpCode: {
    type: String,
    required: true
  },
  otpExpiry: {
    type: Date,
    required: true
  },
  parentPhone: {
    type: String,
    required: true
  },
  rejectionReason: {
    type: String,
    trim: true
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: {
    type: Date
  },
  verificationStatus: {
    type: String,
    enum: ['Not Verified', 'Verified', 'Expired'],
    default: 'Not Verified'
  },
  verifiedBy: {
    type: String,
    trim: true
  },
  verifiedAt: {
    type: Date
  },
  // Visit tracking fields
  visitCount: {
    type: Number,
    default: 0
  },
  maxVisits: {
    type: Number,
    default: 2
  },
  visits: [{
    scannedAt: {
      type: Date,
      required: true
    },
    scannedBy: {
      type: String, // Security guard identifier
      required: true
    },
    location: {
      type: String, // Optional: scan location
      default: 'Main Gate'
    }
  }],
  visitLocked: {
    type: Boolean,
    default: false
  },
  // New field to track QR availability window
  qrAvailableFrom: {
    type: Date
  }
}, {
  timestamps: true
});

// Pre-save middleware to calculate numberOfDays and set QR availability
leaveSchema.pre('save', function(next) {
  if (this.applicationType === 'Leave' && this.startDate && this.endDate) {
    const start = new Date(this.startDate);
    const end = new Date(this.endDate);
    const timeDiff = end.getTime() - start.getTime();
    const dayDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));
    this.numberOfDays = dayDiff;
    
    // Set QR availability to 2 minutes before start date
    const qrAvailableTime = new Date(start.getTime() - (2 * 60 * 1000)); // 2 minutes before
    this.qrAvailableFrom = qrAvailableTime;
  } else if (this.applicationType === 'Permission' && this.permissionDate) {
    // For permissions, QR is available from the permission date
    this.qrAvailableFrom = new Date(this.permissionDate);
    this.numberOfDays = 1; // Permissions are always for 1 day
  }
  next();
});

// Virtual method to check if QR is currently available
leaveSchema.virtual('isQrAvailable').get(function() {
  if (this.status !== 'Approved' || this.visitLocked) {
    return false;
  }
  const now = new Date();
  
  if (this.applicationType === 'Leave') {
    return now >= this.qrAvailableFrom && now <= this.endDate;
  } else if (this.applicationType === 'Permission') {
    const permissionDate = new Date(this.permissionDate);
    const startOfDay = new Date(permissionDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(permissionDate.setHours(23, 59, 59, 999));
    return now >= startOfDay && now <= endOfDay;
  }
  
  return false;
});

// Virtual method to get display date
leaveSchema.virtual('displayDate').get(function() {
  if (this.applicationType === 'Leave') {
    return this.startDate;
  } else if (this.applicationType === 'Permission') {
    return this.permissionDate;
  }
  return null;
});

// Virtual method to get display end date
leaveSchema.virtual('displayEndDate').get(function() {
  if (this.applicationType === 'Leave') {
    return this.endDate;
  } else if (this.applicationType === 'Permission') {
    return this.permissionDate;
  }
  return null;
});

// Ensure virtuals are included in JSON output
leaveSchema.set('toJSON', { virtuals: true });

// Index for faster queries
leaveSchema.index({ student: 1, status: 1 });
leaveSchema.index({ status: 1, createdAt: -1 });
leaveSchema.index({ status: 1, verificationStatus: 1 });
leaveSchema.index({ qrAvailableFrom: 1, status: 1 });
leaveSchema.index({ applicationType: 1, status: 1 });

const Leave = mongoose.model('Leave', leaveSchema);

export default Leave; 