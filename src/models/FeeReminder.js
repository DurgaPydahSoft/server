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

// Method to calculate reminder dates based on academic calendar
feeReminderSchema.methods.calculateReminderDates = async function() {
  try {
    // Try to get academic calendar for semester-1 start date
    const AcademicCalendar = mongoose.model('AcademicCalendar');
    const User = mongoose.model('User');
    
    // Get student details to find course
    const student = await User.findById(this.student).populate('course');
    if (!student || !student.course) {
      console.log('⚠️ Student or course not found, using registration date fallback');
      this.calculateReminderDatesFallback();
      return;
    }
    
    // Find academic calendar for current academic year and semester-1
    const currentAcademicYear = this.academicYear;
    const academicCalendar = await AcademicCalendar.findOne({
      course: student.course._id,
      academicYear: currentAcademicYear,
      semester: 'Semester 1',
      isActive: true
    });
    
    if (academicCalendar && academicCalendar.startDate) {
      console.log('📅 Using academic calendar for reminder dates');
      const semesterStartDate = new Date(academicCalendar.startDate);
      
      // Calculate reminder dates based on semester-1 start date
      this.firstReminderDate = new Date(semesterStartDate);
      this.firstReminderDate.setDate(semesterStartDate.getDate() + 5);
      
      this.secondReminderDate = new Date(semesterStartDate);
      this.secondReminderDate.setDate(semesterStartDate.getDate() + 90);
      
      this.thirdReminderDate = new Date(semesterStartDate);
      this.thirdReminderDate.setDate(semesterStartDate.getDate() + 210);
      
      console.log('📅 Reminder dates calculated from academic calendar:', {
        semesterStart: semesterStartDate,
        firstReminder: this.firstReminderDate,
        secondReminder: this.secondReminderDate,
        thirdReminder: this.thirdReminderDate
      });
    } else {
      console.log('⚠️ Academic calendar not found, using registration date fallback');
      this.calculateReminderDatesFallback();
    }
  } catch (error) {
    console.error('Error calculating reminder dates from academic calendar:', error);
    this.calculateReminderDatesFallback();
  }
};

// Fallback method using registration date
feeReminderSchema.methods.calculateReminderDatesFallback = function() {
  const registrationDate = new Date(this.registrationDate);
  
  this.firstReminderDate = new Date(registrationDate);
  this.firstReminderDate.setDate(registrationDate.getDate() + 5);
  
  this.secondReminderDate = new Date(registrationDate);
  this.secondReminderDate.setDate(registrationDate.getDate() + 90);
  
  this.thirdReminderDate = new Date(registrationDate);
  this.thirdReminderDate.setDate(registrationDate.getDate() + 210);
  
  console.log('📅 Reminder dates calculated from registration date:', {
    registrationDate: registrationDate,
    firstReminder: this.firstReminderDate,
    secondReminder: this.secondReminderDate,
    thirdReminder: this.thirdReminderDate
  });
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

// Method to sync fee status with actual payment data
feeReminderSchema.methods.syncFeeStatusWithPayments = async function() {
  try {
    const Payment = mongoose.model('Payment');
    
    // Get all successful hostel fee payments for this student and academic year
    const payments = await Payment.find({
      studentId: this.student,
      paymentType: 'hostel_fee',
      academicYear: this.academicYear,
      status: 'success'
    });
    
    // Reset all terms to unpaid
    this.feeStatus.term1 = 'Unpaid';
    this.feeStatus.term2 = 'Unpaid';
    this.feeStatus.term3 = 'Unpaid';
    
    // Update status based on actual payments
    payments.forEach(payment => {
      if (payment.term === 'term1') {
        this.feeStatus.term1 = 'Paid';
      } else if (payment.term === 'term2') {
        this.feeStatus.term2 = 'Paid';
      } else if (payment.term === 'term3') {
        this.feeStatus.term3 = 'Paid';
      }
    });
    
    // Save the updated status
    await this.save();
    
    console.log(`✅ Synced fee status for student ${this.student}:`, this.feeStatus);
    return this.feeStatus;
  } catch (error) {
    console.error('Error syncing fee status with payments:', error);
    throw error;
  }
};

// Static method to sync fee status for all students
feeReminderSchema.statics.syncAllFeeStatusWithPayments = async function() {
  try {
    const feeReminders = await this.find({ isActive: true });
    let syncedCount = 0;
    
    for (const reminder of feeReminders) {
      await reminder.syncFeeStatusWithPayments();
      syncedCount++;
    }
    
    console.log(`✅ Synced fee status for ${syncedCount} students`);
    return { syncedCount, total: feeReminders.length };
  } catch (error) {
    console.error('Error syncing all fee status with payments:', error);
    throw error;
  }
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
  
  // Calculate reminder dates based on academic calendar
  await feeReminder.calculateReminderDates();
  return await feeReminder.save();
};

const FeeReminder = mongoose.model('FeeReminder', feeReminderSchema);

export default FeeReminder; 