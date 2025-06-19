import mongoose from 'mongoose';

const outpassSchema = new mongoose.Schema({
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
  }
}, {
  timestamps: true
});

// Pre-save middleware to calculate numberOfDays
outpassSchema.pre('save', function(next) {
  if (this.startDate && this.endDate) {
    const start = new Date(this.startDate);
    const end = new Date(this.endDate);
    const timeDiff = end.getTime() - start.getTime();
    const dayDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));
    this.numberOfDays = dayDiff;
  }
  next();
});

// Index for faster queries
outpassSchema.index({ student: 1, status: 1 });
outpassSchema.index({ status: 1, createdAt: -1 });
outpassSchema.index({ status: 1, verificationStatus: 1 });

const Outpass = mongoose.model('Outpass', outpassSchema);

export default Outpass; 