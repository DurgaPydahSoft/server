import mongoose from 'mongoose';

const outpassSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  dateOfOutpass: {
    type: Date,
    required: true
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
  }
}, {
  timestamps: true
});

// Index for faster queries
outpassSchema.index({ student: 1, status: 1 });
outpassSchema.index({ status: 1, createdAt: -1 });

const Outpass = mongoose.model('Outpass', outpassSchema);

export default Outpass; 