import mongoose from 'mongoose';

const studentPreRegistrationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  rollNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
    validate: {
      validator: function(v) {
        return /^[A-Z0-9]+$/.test(v);
      },
      message: props => `${props.value} is not a valid roll number! Must be uppercase alphanumeric.`
    }
  },
  gender: {
    type: String,
    enum: ['Male', 'Female'],
    required: true
  },
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true
  },
  year: {
    type: Number,
    required: true,
    min: 1,
    max: 10
  },
  branch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch',
    required: true
  },
  batch: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        return /^\d{4}-\d{4}$/.test(v);
      },
      message: props => `${props.value} is not a valid batch format! Use format YYYY-YYYY (e.g., 2022-2026)`
    }
  },
  academicYear: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        if (!/^\d{4}-\d{4}$/.test(v)) return false;
        const [start, end] = v.split('-').map(Number);
        return end === start + 1;
      },
      message: props => `${props.value} is not a valid academic year format! Use format YYYY-YYYY with a 1-year difference (e.g., 2022-2023)`
    }
  },
  studentPhone: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        return /^[0-9]{10}$/.test(v);
      },
      message: props => `${props.value} is not a valid phone number!`
    }
  },
  parentPhone: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        return /^[0-9]{10}$/.test(v);
      },
      message: props => `${props.value} is not a valid phone number!`
    }
  },
  motherName: {
    type: String,
    trim: true
  },
  motherPhone: {
    type: String,
    validate: {
      validator: function(v) {
        if (!v) return true;
        return /^[0-9]{10}$/.test(v);
      },
      message: props => `${props.value} is not a valid phone number!`
    }
  },
  localGuardianName: {
    type: String,
    trim: true
  },
  localGuardianPhone: {
    type: String,
    validate: {
      validator: function(v) {
        if (!v) return true;
        return /^[0-9]{10}$/.test(v);
      },
      message: props => `${props.value} is not a valid phone number!`
    }
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    validate: {
      validator: function(v) {
        if (!v) return true;
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: props => `${props.value} is not a valid email address!`
    }
  },
  mealType: {
    type: String,
    enum: ['veg', 'non-veg'],
    default: 'non-veg'
  },
  parentPermissionForOuting: {
    type: Boolean,
    default: true
  },
  // Photo URLs
  studentPhoto: {
    type: String
  },
  guardianPhoto1: {
    type: String
  },
  guardianPhoto2: {
    type: String
  },
  // Status tracking
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  submittedAt: {
    type: Date,
    default: Date.now
  },
  processedAt: {
    type: Date
  },
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  rejectionReason: {
    type: String
  },
  // Link to main student record if approved
  mainStudentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Indexes for better query performance
studentPreRegistrationSchema.index({ rollNumber: 1 });
studentPreRegistrationSchema.index({ status: 1 });
studentPreRegistrationSchema.index({ submittedAt: -1 });
studentPreRegistrationSchema.index({ course: 1, branch: 1 });

const StudentPreRegistration = mongoose.model('StudentPreRegistration', studentPreRegistrationSchema);

export default StudentPreRegistration;
