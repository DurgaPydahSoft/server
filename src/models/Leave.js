import mongoose from 'mongoose';

const leaveSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  numberOfDays: {
    type: Number,
    required: true,
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
  qrViewCount: {
    type: Number,
    default: 0
  },
  qrLocked: {
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
  if (this.startDate && this.endDate) {
    const start = new Date(this.startDate);
    const end = new Date(this.endDate);
    const timeDiff = end.getTime() - start.getTime();
    const dayDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));
    this.numberOfDays = dayDiff;
    
    // Set QR availability to 2 minutes before start date
    const qrAvailableTime = new Date(start.getTime() - (2 * 60 * 1000)); // 2 minutes before
    this.qrAvailableFrom = qrAvailableTime;
  }
  next();
});

// Virtual method to check if QR is currently available
leaveSchema.virtual('isQrAvailable').get(function() {
  if (this.status !== 'Approved' || this.qrLocked) {
    return false;
  }
  const now = new Date();
  return now >= this.qrAvailableFrom && now <= this.endDate;
});

// Ensure virtuals are included in JSON output
leaveSchema.set('toJSON', { virtuals: true });

// Index for faster queries
leaveSchema.index({ student: 1, status: 1 });
leaveSchema.index({ status: 1, createdAt: -1 });
leaveSchema.index({ status: 1, verificationStatus: 1 });
leaveSchema.index({ qrAvailableFrom: 1, status: 1 });

const Leave = mongoose.model('Leave', leaveSchema);

export default Leave; 