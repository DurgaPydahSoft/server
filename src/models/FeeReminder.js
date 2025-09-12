import mongoose from 'mongoose';

const feeReminderSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  registrationDate: {
    type: Date,
    required: true
  },
  // Reminder schedule dates
  firstReminderDate: {
    type: Date,
    required: true
  },
  secondReminderDate: {
    type: Date,
    required: true
  },
  thirdReminderDate: {
    type: Date,
    required: true
  },
  // Current reminder status
  currentReminder: {
    type: Number,
    enum: [1, 2, 3, 0], // 0 means no active reminder
    default: 0
  },
  // Reminder visibility status (3 days from issue)
  firstReminderVisible: {
    type: Boolean,
    default: false
  },
  secondReminderVisible: {
    type: Boolean,
    default: false
  },
  thirdReminderVisible: {
    type: Boolean,
    default: false
  },
  // Reminder issue dates
  firstReminderIssuedAt: {
    type: Date,
    default: null
  },
  secondReminderIssuedAt: {
    type: Date,
    default: null
  },
  thirdReminderIssuedAt: {
    type: Date,
    default: null
  },
  // Fee payment status
  feeStatus: {
    term1: {
      type: String,
      enum: ['Paid', 'Unpaid'],
      default: 'Unpaid'
    },
    term2: {
      type: String,
      enum: ['Paid', 'Unpaid'],
      default: 'Unpaid'
    },
    term3: {
      type: String,
      enum: ['Paid', 'Unpaid'],
      default: 'Unpaid'
    }
  },
  // Fee amounts (cached from fee structure)
  feeAmounts: {
    term1: {
      type: Number,
      default: 15000
    },
    term2: {
      type: Number,
      default: 15000
    },
    term3: {
      type: Number,
      default: 15000
    }
  },
  // Payment update tracking
  lastUpdatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  lastUpdatedAt: {
    type: Date,
    default: null
  },
  // Academic year for this fee cycle
  academicYear: {
    type: String,
    required: true
  },
  // Status
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
feeReminderSchema.index({ student: 1 });
feeReminderSchema.index({ academicYear: 1 });
feeReminderSchema.index({ currentReminder: 1 });
feeReminderSchema.index({ 'feeStatus.term1': 1, 'feeStatus.term2': 1, 'feeStatus.term3': 1 });

// Method to calculate reminder dates
feeReminderSchema.methods.calculateReminderDates = function() {
  const registrationDate = new Date(this.registrationDate);
  
  this.firstReminderDate = new Date(registrationDate);
  this.firstReminderDate.setDate(registrationDate.getDate() + 5);
  
  this.secondReminderDate = new Date(registrationDate);
  this.secondReminderDate.setDate(registrationDate.getDate() + 90);
  
  this.thirdReminderDate = new Date(registrationDate);
  this.thirdReminderDate.setDate(registrationDate.getDate() + 210);
};

// Method to check if reminder should be visible
feeReminderSchema.methods.shouldShowReminder = function(reminderNumber) {
  const now = new Date();
  let issuedDate;
  
  switch(reminderNumber) {
    case 1:
      issuedDate = this.firstReminderIssuedAt;
      break;
    case 2:
      issuedDate = this.secondReminderIssuedAt;
      break;
    case 3:
      issuedDate = this.thirdReminderIssuedAt;
      break;
    default:
      return false;
  }
  
  if (!issuedDate) return false;
  
  const threeDaysLater = new Date(issuedDate);
  threeDaysLater.setDate(issuedDate.getDate() + 3);
  
  return now <= threeDaysLater;
};

// Method to check if all terms are paid
feeReminderSchema.methods.areAllTermsPaid = function() {
  return this.feeStatus.term1 === 'Paid' && 
         this.feeStatus.term2 === 'Paid' && 
         this.feeStatus.term3 === 'Paid';
};

// Method to calculate total fee
feeReminderSchema.methods.getTotalFee = function() {
  return this.feeAmounts.term1 + this.feeAmounts.term2 + this.feeAmounts.term3;
};

// Method to calculate paid amount
feeReminderSchema.methods.getPaidAmount = function() {
  let paidAmount = 0;
  if (this.feeStatus.term1 === 'Paid') paidAmount += this.feeAmounts.term1;
  if (this.feeStatus.term2 === 'Paid') paidAmount += this.feeAmounts.term2;
  if (this.feeStatus.term3 === 'Paid') paidAmount += this.feeAmounts.term3;
  return paidAmount;
};

// Method to calculate pending amount
feeReminderSchema.methods.getPendingAmount = function() {
  return this.getTotalFee() - this.getPaidAmount();
};

// Static method to create fee reminder for a student
feeReminderSchema.statics.createForStudent = async function(studentId, registrationDate, academicYear) {
  // Get student details to determine category
  const User = mongoose.model('User');
  const FeeStructure = mongoose.model('FeeStructure');
  
  const student = await User.findById(studentId);
  if (!student) {
    throw new Error('Student not found');
  }

  // Get fee structure for the student's category
  const feeStructure = await FeeStructure.getFeeStructure(academicYear, student.course, student.year, student.category);
  
  const feeReminder = new this({
    student: studentId,
    registrationDate: registrationDate,
    academicYear: academicYear,
    feeAmounts: {
      term1: feeStructure ? feeStructure.term1Fee : 15000,
      term2: feeStructure ? feeStructure.term2Fee : 15000,
      term3: feeStructure ? feeStructure.term3Fee : 15000
    }
  });
  
  feeReminder.calculateReminderDates();
  return await feeReminder.save();
};

const FeeReminder = mongoose.model('FeeReminder', feeReminderSchema);

export default FeeReminder; 