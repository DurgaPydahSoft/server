import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  // Common fields for both electricity and hostel fee payments
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
  status: {
    type: String,
    enum: ['pending', 'success', 'failed', 'cancelled'],
    default: 'success', // Hostel fees are usually collected in cash/online immediately
    index: true
  },
  paymentMethod: {
    type: String,
    enum: ['Cash', 'Online', 'card', 'upi', 'netbanking', 'wallet', 'other'],
    required: true
  },
  paymentDate: {
    type: Date,
    default: Date.now
  },
  notes: {
    type: String,
    default: ''
  },
  collectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  collectedByName: {
    type: String,
    required: true
  },
  
  // Payment type to distinguish between electricity and hostel fees
  paymentType: {
    type: String,
    enum: ['electricity', 'hostel_fee'],
    required: true,
    index: true
  },
  
  // Fields for electricity payments (optional for hostel fees)
  billId: {
    type: mongoose.Schema.Types.ObjectId,
    required: function() { return this.paymentType === 'electricity'; },
    index: true
  },
  roomId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Room',
    required: function() { return this.paymentType === 'electricity'; },
    index: true
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
  receiptUrl: {
    type: String
  },
  failureReason: {
    type: String
  },
  billMonth: {
    type: String,
    required: function() { return this.paymentType === 'electricity'; },
    match: [/^\d{4}-\d{2}$/, 'Bill month must be in YYYY-MM format']
  },
  billDetails: {
    startUnits: Number,
    endUnits: Number,
    consumption: Number,
    rate: Number,
    total: Number
  },
  
  // Fields for hostel fee payments (optional for electricity)
  term: {
    type: String,
    required: function() { return this.paymentType === 'hostel_fee'; },
    enum: ['term1', 'term2', 'term3'],
    index: true
  },
  academicYear: {
    type: String,
    required: function() { return this.paymentType === 'hostel_fee'; },
    match: [/^\d{4}-\d{4}$/, 'Academic year must be in YYYY-YYYY format']
  },
  receiptNumber: {
    type: String,
    required: function() { return this.paymentType === 'hostel_fee'; },
    unique: true,
    sparse: true
  },
  transactionId: {
    type: String,
    required: function() { return this.paymentType === 'hostel_fee'; },
    unique: true,
    sparse: true
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
paymentSchema.index({ studentId: 1, paymentType: 1 }); // For hostel fee queries
paymentSchema.index({ roomId: 1, billMonth: 1 }); // For electricity queries
paymentSchema.index({ createdAt: -1 });
paymentSchema.index({ cashfreeOrderId: 1 });
paymentSchema.index({ cashfreePaymentId: 1 });
paymentSchema.index({ term: 1, academicYear: 1 }); // For hostel fee queries
paymentSchema.index({ receiptNumber: 1 }); // For hostel fee queries
paymentSchema.index({ transactionId: 1 }); // For hostel fee queries

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