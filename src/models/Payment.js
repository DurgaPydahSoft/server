import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  billId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },
  roomId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Room',
    required: true,
    index: true
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'INR',
    enum: ['INR']
  },
  cashfreeOrderId: {
    type: String,
    unique: true,
    sparse: true
  },
  cashfreePaymentId: {
    type: String,
    unique: true,
    sparse: true
  },
  status: {
    type: String,
    enum: ['pending', 'success', 'failed', 'cancelled'],
    default: 'pending',
    index: true
  },
  paymentMethod: {
    type: String,
    enum: ['card', 'upi', 'netbanking', 'wallet', 'other']
  },
  paymentDate: {
    type: Date
  },
  receiptUrl: {
    type: String
  },
  failureReason: {
    type: String
  },
  billMonth: {
    type: String,
    required: true,
    match: [/^\d{4}-\d{2}$/, 'Bill month must be in YYYY-MM format']
  },
  billDetails: {
    startUnits: Number,
    endUnits: Number,
    consumption: Number,
    rate: Number,
    total: Number
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

// Indexes for efficient querying
paymentSchema.index({ studentId: 1, status: 1 });
paymentSchema.index({ roomId: 1, billMonth: 1 });
paymentSchema.index({ createdAt: -1 });
paymentSchema.index({ cashfreeOrderId: 1 });
paymentSchema.index({ cashfreePaymentId: 1 });

// Virtual for payment age
paymentSchema.virtual('age').get(function() {
  return Math.floor((Date.now() - this.createdAt) / (1000 * 60 * 60 * 24)); // Age in days
});

// Method to check if payment is expired (24 hours)
paymentSchema.methods.isExpired = function() {
  const expiryTime = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  return this.status === 'pending' && (Date.now() - this.createdAt) > expiryTime;
};

// Static method to find pending payments
paymentSchema.statics.findPending = function() {
  return this.find({ status: 'pending' });
};

// Static method to find successful payments by month
paymentSchema.statics.findSuccessfulByMonth = function(month) {
  return this.find({
    status: 'success',
    billMonth: month
  });
};

const Payment = mongoose.model('Payment', paymentSchema);

export default Payment; 