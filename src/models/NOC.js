import mongoose from 'mongoose';

const nocSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // Student details (prefilled from user profile)
  studentName: {
    type: String,
    required: true,
    trim: true
  },
  rollNumber: {
    type: String,
    required: true,
    trim: true
  },
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true
  },
  branch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch',
    required: true
  },
  year: {
    type: Number,
    required: true
  },
  academicYear: {
    type: String,
    required: true
  },
  // NOC specific fields
  reason: {
    type: String,
    required: true,
    trim: true,
    maxLength: [500, 'Reason cannot exceed 500 characters'],
    minLength: [10, 'Reason must be at least 10 characters long']
  },
  vacatingDate: {
    type: Date,
    required: true
  },
  applicationDate: {
    type: Date,
    default: Date.now,
    required: true
  },
  // Track who raised the NOC
  raisedBy: {
    type: String,
    enum: ['student', 'warden'],
    default: 'student'
  },
  raisedByWarden: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  // Status flow: Pending → Warden Verified → Admin Approved - Pending Meter Reading → Ready for Deactivation → Approved
  status: {
    type: String,
    enum: ['Pending', 'Warden Verified', 'Sent for Correction', 'Admin Approved - Pending Meter Reading', 'Ready for Deactivation', 'Approved', 'Rejected'],
    default: 'Pending',
    index: true
  },
  // Warden verification fields
  wardenRemarks: {
    type: String,
    trim: true,
    maxLength: [500, 'Warden remarks cannot exceed 500 characters']
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  verifiedAt: {
    type: Date,
    default: null
  },
  // Super admin approval fields
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  approvedAt: {
    type: Date,
    default: null
  },
  // Rejection fields
  rejectionReason: {
    type: String,
    trim: true,
    maxLength: [500, 'Rejection reason cannot exceed 500 characters']
  },
  rejectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  rejectedAt: {
    type: Date,
    default: null
  },
  // Student deactivation tracking
  studentDeactivated: {
    type: Boolean,
    default: false
  },
  deactivatedAt: {
    type: Date,
    default: null
  },
  // Checklist responses from warden
  checklistResponses: [{
    checklistItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NOCChecklistConfig',
      required: true
    },
    amount: {
      type: String,
      trim: true,
      maxLength: [100, 'Amount value cannot exceed 100 characters']
    },
    remarks: {
      type: String,
      trim: true,
      maxLength: [500, 'Remarks cannot exceed 500 characters']
    },
    signature: {
      type: String,
      trim: true
    }
  }],
  // Admin remarks for corrections
  adminRemarks: {
    type: String,
    trim: true,
    maxLength: [1000, 'Admin remarks cannot exceed 1000 characters']
  },
  // Track if sent for correction
  sentForCorrectionBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  sentForCorrectionAt: {
    type: Date,
    default: null
  },
  // Track correction resubmission
  resubmittedAt: {
    type: Date,
    default: null
  },
  // Electricity meter readings (entered by warden after admin approval)
  meterReadings: {
    meterType: {
      type: String,
      enum: ['single', 'dual'],
      default: null
    },
    // Single meter readings
    startUnits: {
      type: Number,
      min: 0,
      default: null
    },
    endUnits: {
      type: Number,
      min: 0,
      default: null
    },
    // Dual meter readings
    meter1StartUnits: {
      type: Number,
      min: 0,
      default: null
    },
    meter1EndUnits: {
      type: Number,
      min: 0,
      default: null
    },
    meter2StartUnits: {
      type: Number,
      min: 0,
      default: null
    },
    meter2EndUnits: {
      type: Number,
      min: 0,
      default: null
    },
    // Reading date
    readingDate: {
      type: Date,
      default: null
    },
    enteredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null
    },
    enteredAt: {
      type: Date,
      default: null
    }
  },
  // Calculated electricity bill until vacating date
  calculatedElectricityBill: {
    consumption: {
      type: Number,
      min: 0,
      default: null
    },
    rate: {
      type: Number,
      min: 0,
      default: null
    },
    total: {
      type: Number,
      min: 0,
      default: null
    },
    calculatedAt: {
      type: Date,
      default: null
    },
    // Bill period (from last bill to vacating date)
    billPeriodStart: {
      type: Date,
      default: null
    },
    billPeriodEnd: {
      type: Date,
      default: null
    }
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
nocSchema.index({ student: 1, status: 1 });
nocSchema.index({ status: 1, createdAt: -1 });
nocSchema.index({ verifiedBy: 1 });
nocSchema.index({ approvedBy: 1 });
nocSchema.index({ createdAt: -1 });

// Virtual for NOC age
nocSchema.virtual('age').get(function() {
  return Math.floor((Date.now() - this.createdAt) / (1000 * 60 * 60 * 24)); // Age in days
});

// Static method to find NOCs by status
nocSchema.statics.findByStatus = function(status) {
  return this.find({ status }).populate('student', 'name rollNumber course branch year academicYear').populate('verifiedBy approvedBy rejectedBy', 'username role');
};

// Static method to find NOCs by student
nocSchema.statics.findByStudent = function(studentId) {
  return this.find({ student: studentId }).populate('verifiedBy approvedBy rejectedBy', 'username role');
};

// Instance method to update status with validation
nocSchema.methods.updateStatus = async function(newStatus, updatedBy, remarks = '') {
  const validTransitions = {
    'Pending': ['Warden Verified', 'Rejected'],
    'Warden Verified': ['Sent for Correction', 'Admin Approved - Pending Meter Reading', 'Rejected'],
    'Sent for Correction': ['Warden Verified', 'Rejected'], // Can be resubmitted or rejected
    'Admin Approved - Pending Meter Reading': ['Ready for Deactivation', 'Rejected'],
    'Ready for Deactivation': ['Approved'], // After meter readings entered
    'Approved': [], // Final state
    'Rejected': [] // Final state
  };

  const oldStatus = this.status;

  if (!validTransitions[oldStatus]?.includes(newStatus)) {
    throw new Error(`Invalid status transition from ${oldStatus} to ${newStatus}`);
  }

  this.status = newStatus;
  
  if (newStatus === 'Warden Verified') {
    this.verifiedBy = updatedBy;
    this.verifiedAt = new Date();
    this.wardenRemarks = remarks;
    // If resubmitted after correction, update resubmittedAt
    if (oldStatus === 'Sent for Correction') {
      this.resubmittedAt = new Date();
    }
  } else if (newStatus === 'Sent for Correction') {
    this.sentForCorrectionBy = updatedBy;
    this.sentForCorrectionAt = new Date();
    this.adminRemarks = remarks;
  } else if (newStatus === 'Admin Approved - Pending Meter Reading') {
    this.approvedBy = updatedBy;
    this.approvedAt = new Date();
    if (remarks) {
      this.adminRemarks = remarks;
    }
  } else if (newStatus === 'Ready for Deactivation') {
    // Status set when meter readings are entered
  } else if (newStatus === 'Approved') {
    // Final approval after meter readings and bill calculation
  } else if (newStatus === 'Rejected') {
    this.rejectedBy = updatedBy;
    this.rejectedAt = new Date();
    this.rejectionReason = remarks;
  }

  return this.save();
};

// Instance method to deactivate student
nocSchema.methods.deactivateStudent = async function() {
  if (this.status !== 'Ready for Deactivation' && this.status !== 'Approved') {
    throw new Error('Student can only be deactivated when NOC is ready for deactivation or approved');
  }

  this.studentDeactivated = true;
  this.deactivatedAt = new Date();
  
  // Update student status in User model and vacate room allocation
  const User = mongoose.model('User');
  const student = await User.findById(this.student);
  if (student) {
    console.log(`🏠 Vacating room allocation for student ${student.name} (${student.rollNumber}):`);
    console.log(`   - Room: ${student.roomNumber || 'None'}`);
    console.log(`   - Bed: ${student.bedNumber || 'None'}`);
    console.log(`   - Locker: ${student.lockerNumber || 'None'}`);
  }
  
  await User.findByIdAndUpdate(this.student, { 
    hostelStatus: 'Inactive',
    graduationStatus: 'Dropped',
    roomNumber: null,      // Vacate room
    bedNumber: null,       // Vacate bed
    lockerNumber: null     // Vacate locker
  });

  return this.save();
};

const NOC = mongoose.model('NOC', nocSchema);

export default NOC;
