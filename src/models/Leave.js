import mongoose from 'mongoose';

const leaveSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Application type: 'Leave', 'Permission', or 'Stay in Hostel'
  applicationType: {
    type: String,
    enum: ['Leave', 'Permission', 'Stay in Hostel'],
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
  // For Stay in Hostel applications
  stayDate: {
    type: Date,
    required: function() { return this.applicationType === 'Stay in Hostel'; }
  },
  // Gate pass date and time (for Leave applications only)
  gatePassDateTime: {
    type: Date,
    required: function() { return this.applicationType === 'Leave'; }
  },
  numberOfDays: {
    type: Number,
    min: 1,
    default: 1 // Default to 1 day for permissions
  },
  reason: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['Pending', 'Pending OTP Verification', 'Warden Verified', 'Approved', 'Rejected', 'Warden Recommended', 'Principal Approved', 'Principal Rejected'],
    default: 'Pending'
  },
  otpCode: {
    type: String,
    required: function() { return this.applicationType !== 'Stay in Hostel'; }
  },
  parentPhone: {
    type: String,
    required: function() { return this.applicationType !== 'Stay in Hostel'; }
  },
  // OTP resend tracking fields
  otpResendCount: {
    type: Number,
    default: 0
  },
  lastOtpResendAt: {
    type: Date
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
  // Warden verification fields
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  verifiedAt: {
    type: Date
  },
  // New fields for Stay in Hostel workflow
  wardenRecommendation: {
    type: String,
    enum: ['Pending', 'Recommended', 'Not Recommended'],
    default: 'Pending'
  },
  wardenComment: {
    type: String,
    trim: true
  },
  recommendedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  recommendedAt: {
    type: Date
  },
  principalDecision: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending'
  },
  principalComment: {
    type: String,
    trim: true
  },
  decidedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  decidedAt: {
    type: Date
  },
  verificationStatus: {
    type: String,
    enum: ['Not Verified', 'Verified', 'Expired', 'Completed'],
    default: 'Not Verified'
  },
  verifiedBy: {
    type: String,
    trim: true
  },
  verifiedAt: {
    type: Date
  },
  completedAt: {
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
    },
    visitType: {
      type: String,
      enum: ['outgoing', 'incoming'],
      default: 'outgoing'
    }
  }],
  visitLocked: {
    type: Boolean,
    default: false
  },
  // New fields for incoming QR functionality
  outgoingVisitCount: {
    type: Number,
    default: 0
  },
  incomingVisitCount: {
    type: Number,
    default: 0
  },
  incomingQrGenerated: {
    type: Boolean,
    default: false
  },
  incomingQrGeneratedAt: {
    type: Date
  },
  incomingQrExpiresAt: {
    type: Date
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
  try {
    console.log('🔧 Leave pre-save middleware - Application type:', this.applicationType);
    console.log('🔧 Leave pre-save middleware - Start date:', this.startDate);
    console.log('🔧 Leave pre-save middleware - End date:', this.endDate);
    console.log('🔧 Leave pre-save middleware - Permission date:', this.permissionDate);
    console.log('🔧 Leave pre-save middleware - Stay date:', this.stayDate);
    
    if (this.applicationType === 'Leave' && this.startDate && this.endDate) {
      const start = new Date(this.startDate);
      const end = new Date(this.endDate);
      const timeDiff = end.getTime() - start.getTime();
      const dayDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));
      this.numberOfDays = Math.max(1, dayDiff); // Ensure at least 1 day
      
      // Set QR availability to 2 minutes before start date
      const qrAvailableTime = new Date(start.getTime() - (2 * 60 * 1000)); // 2 minutes before
      this.qrAvailableFrom = qrAvailableTime;
      
      console.log('🔧 Leave pre-save middleware - Calculated numberOfDays:', this.numberOfDays);
      console.log('🔧 Leave pre-save middleware - Set qrAvailableFrom:', this.qrAvailableFrom);
    } else if (this.applicationType === 'Permission' && this.permissionDate) {
      // For permissions, QR is available from the permission date
      this.qrAvailableFrom = new Date(this.permissionDate);
      this.numberOfDays = 1; // Permissions are always for 1 day
      
      console.log('🔧 Permission pre-save middleware - Set numberOfDays to 1');
      console.log('🔧 Permission pre-save middleware - Set qrAvailableFrom:', this.qrAvailableFrom);
    } else if (this.applicationType === 'Stay in Hostel' && this.stayDate) {
      // For stay in hostel, set numberOfDays to 1 and no QR needed
      this.numberOfDays = 1;
      this.qrAvailableFrom = null; // No QR needed for stay in hostel
      
      console.log('🔧 Stay in Hostel pre-save middleware - Set numberOfDays to 1');
      console.log('🔧 Stay in Hostel pre-save middleware - No QR needed');
    } else {
      // Fallback: set default values
      this.numberOfDays = this.numberOfDays || 1;
      console.log('🔧 Fallback pre-save middleware - Set numberOfDays to:', this.numberOfDays);
    }
    next();
  } catch (error) {
    console.error('❌ Error in leave pre-save middleware:', error);
    next(error);
  }
});

// Virtual method to check if QR is currently available
leaveSchema.virtual('isQrAvailable').get(function() {
  if (this.status !== 'Approved' || this.visitLocked || this.applicationType === 'Stay in Hostel') {
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
  } else if (this.applicationType === 'Stay in Hostel') {
    return this.stayDate;
  }
  return null;
});

// Virtual method to get display end date
leaveSchema.virtual('displayEndDate').get(function() {
  if (this.applicationType === 'Leave') {
    return this.endDate;
  } else if (this.applicationType === 'Permission') {
    return this.permissionDate;
  } else if (this.applicationType === 'Stay in Hostel') {
    return this.stayDate;
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
leaveSchema.index({ applicationType: 1, wardenRecommendation: 1 });
leaveSchema.index({ applicationType: 1, principalDecision: 1 });

const Leave = mongoose.model('Leave', leaveSchema);

export default Leave; 