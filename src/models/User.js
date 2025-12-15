import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// Define course and branch mappings
export const COURSES = {
  BTECH: 'B.Tech',
  DIPLOMA: 'Diploma',
  PHARMACY: 'Pharmacy',
  DEGREE: 'Degree'
};

export const BRANCHES = {
  BTECH: ['CSE', 'ECE', 'EEE', 'MECH', 'CIVIL', 'AI', 'AI & ML'],
  DIPLOMA: ['DAIML', 'DCSE', 'DECE', 'DME', 'DAP', 'D Fisheries', 'D Animal Husbandry'],
  PHARMACY: ['B-Pharmacy', 'Pharm D', 'Pharm(PB) D', 'Pharmaceutical Analysis', 'Pharmaceutics', 'Pharma Quality Assurance'],
  DEGREE: ['Agriculture', 'Horticulture', 'Food Technology', 'Fisheries', 'Food Science & Nutrition']
};

// Map course label (e.g., 'B.Tech') to its key (e.g., 'BTECH')
const COURSE_LABEL_TO_KEY = {
  'B.Tech': 'BTECH',
  'Diploma': 'DIPLOMA',
  'Pharmacy': 'PHARMACY',
  'Degree': 'DEGREE'
};

// Define room mappings based on gender and category
export const ROOM_MAPPINGS = {
  Male: {
    'A+': ['302', '309', '310', '311', '312'],
    'A': ['303', '304', '305', '306', '308', '320', '324', '325'],
    'B+': ['321'],
    'B': ['314', '315', '316', '317', '322', '323']
  },
  Female: {
    'A+': ['209', '211', '212', '213', '214', '215'],
    'A': ['103', '115', '201', '202', '203', '204', '205', '206', '207', '208', '216', '217'],
    'B': ['101', '102', '104', '105', '106', '108', '109', '111', '112', '114'],
    'C': ['117']
  }
};

const userSchema = new mongoose.Schema({
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
        // Allow letters, numbers, hyphens and slashes (e.g., 23320-AIM-050)
        return /^[A-Z0-9\-\/]+$/.test(v);
      },
      message: props => `${props.value} is not a valid roll number! Use letters/numbers with optional - or /.`
    }
  },
  // Admission number sourced from SQL (stored as-is, may contain hyphens/slashes)
  admissionNumber: {
    type: String,
    required: false,
    trim: true,
    uppercase: true
  },
  hostelId: {
    type: String,
    unique: true,
    sparse: true, // Allow null/undefined values for non-students
    validate: {
      validator: function(v) {
        if (this.role !== 'student') return true;
        if (!v) return false;
        // Validate hostel ID format: BH/GH + YY + 3 digits (e.g., BH25001, GH25002)
        return /^(BH|GH)\d{5}$/.test(v);
      },
      message: props => `${props.value} is not a valid hostel ID format! Must be BH/GH + YY + 3 digits (e.g., BH25001)`
    }
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['admin', 'student'],
    default: 'student'
  },
  /**
   * Course/Branch stored as strings sourced from SQL (single source of truth).
   * Old ObjectId refs are removed; these fields now hold exact names/codes
   * coming from SQL (e.g., "B.Tech", "CSE", "Diploma", "DCME").
   */
  course: {
    type: String,
    required: function() { return this.role === 'student'; },
    trim: true
  },
  branch: {
    type: String,
    required: function() { return this.role === 'student'; },
    trim: true
  },
  // Hostel hierarchy references
  hostel: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hostel',
    required: false,
    index: true
  },
  hostelCategory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'HostelCategory',
    required: false,
    index: true
  },
  room: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Room',
    required: false,
    index: true
  },
  // SQL database references (optional metadata)
  sqlCourseId: {
    type: Number,
    required: false
  },
  sqlBranchId: {
    type: Number,
    required: false
  },
  // Migration metadata
  courseMatchType: {
    type: String,
    enum: ['exact', 'fuzzy'],
    required: false
  },
  branchMatchType: {
    type: String,
    enum: ['exact', 'fuzzy'],
    required: false
  },
  courseMatchScore: {
    type: Number,
    required: false
  },
  branchMatchScore: {
    type: Number,
    required: false
  },
  migratedAt: {
    type: Date,
    required: false
  },
  syncedAt: {
    type: Date,
    required: false
  },
  year: {
    type: Number,
    required: function() { return this.role === 'student'; },
    validate: {
      validator: async function(v) {
        if (this.role !== 'student') return true;
        
        // For dynamic validation, we'll handle this in the controller
        // This is a basic validation that can be enhanced
        return v >= 1 && v <= 10; // Allow 1-10 years as a reasonable range
      },
      message: props => `${props.value} is not a valid year!`
    }
  },
  gender: {
    type: String,
    enum: ['Male', 'Female'],
    required: function() { return this.role === 'student'; }
  },
  category: {
    type: String,
    required: function() { return this.role === 'student'; },
    validate: {
      validator: function(v) {
        if (this.role !== 'student') return true;
        const validCategories = this.gender === 'Male' 
          ? ['A+', 'A', 'B+', 'B']
          : ['A+', 'A', 'B', 'C'];
        return validCategories.includes(v);
      },
      message: props => `${props.value} is not a valid category for the selected gender!`
    }
  },
  mealType: {
    type: String,
    enum: ['veg', 'non-veg'],
    required: false,
    default: 'veg'
  },
  parentPermissionForOuting: {
    type: Boolean,
    default: true,
    required: function() { return this.role === 'student'; }
  },
  roomNumber: {
    type: String,
    required: function() { return this.role === 'student'; },
    // Note: Room validation is handled in the controller to check against actual Room model
    // Schema-level validation removed to allow dynamic room management
    // The controller validates room existence and gender/category matching
  },
  bedNumber: {
    type: String,
    required: false, // Optional field
    validate: {
      validator: function(v) {
        if (this.role !== 'student' || !v) return true; // Allow empty for non-students or optional
        // Format validation: "320 Bed 1", "320 Bed 2", etc.
        return /^\d{3} Bed \d+$/.test(v);
      },
      message: props => `${props.value} is not a valid bed number format! Must be "RoomNumber Bed Number" (e.g., "320 Bed 1")`
    }
  },
  lockerNumber: {
    type: String,
    required: false, // Optional field
    validate: {
      validator: function(v) {
        if (this.role !== 'student' || !v) return true; // Allow empty for non-students or optional
        // Format validation: "320 Locker 1", "320 Locker 2", etc.
        return /^\d{3} Locker \d+$/.test(v);
      },
      message: props => `${props.value} is not a valid locker number format! Must be "RoomNumber Locker Number" (e.g., "320 Locker 1")`
    }
  },
  studentPhone: {
    type: String,
    required: false, // Make student phone optional
    validate: {
      validator: function(v) {
        if (!v) return true; // Allow empty/null values
        return /^[0-9]{10}$/.test(v);
      },
      message: props => `${props.value} is not a valid phone number!`
    }
  },
  parentPhone: {
    type: String,
    required: function() { return this.role === 'student'; },
    validate: {
      validator: function(v) {
        return /^[0-9]{10}$/.test(v);
      },
      message: props => `${props.value} is not a valid phone number!`
    }
  },
  motherName: {
    type: String,
    required: false, // Make optional
    trim: true
  },
  motherPhone: {
    type: String,
    required: false, // Make optional
    validate: {
      validator: function(v) {
        if (!v) return true; // Allow empty/null values since it's optional
        return /^[0-9]{10}$/.test(v);
      },
      message: props => `${props.value} is not a valid phone number!`
    }
  },
  localGuardianName: {
    type: String,
    required: false, // Optional field
    trim: true
  },
  localGuardianPhone: {
    type: String,
    required: false, // Optional field
    validate: {
      validator: function(v) {
        if (!v) return true; // Allow empty/null values since it's optional
        return /^[0-9]{10}$/.test(v);
      },
      message: props => `${props.value} is not a valid phone number!`
    }
  },
  email: {
    type: String,
    required: false, // Make email optional
    trim: true,
    lowercase: true,
    validate: {
      validator: function(v) {
        if (this.role !== 'student') return true;
        if (!v) return true; // Allow empty/null values
        // Basic email validation regex
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: props => `${props.value} is not a valid email address!`
    }
  },
  batch: {
    type: String,
    required: function() { return this.role === 'student'; },
    validate: {
      validator: function(v) {
        if (this.role !== 'student') return true;
        // Validate batch format (e.g., 2022-2026)
        return /^\d{4}-\d{4}$/.test(v);
      },
      message: props => `${props.value} is not a valid batch format! Use format YYYY-YYYY (e.g., 2022-2026)`
    }
  },
  academicYear: {
    type: String,
    required: function() { return this.role === 'student'; },
    validate: {
      validator: function(v) {
        if (this.role !== 'student') return true;
        // Validate academic year format (e.g., 2022-2023)
        if (!/^\d{4}-\d{4}$/.test(v)) return false;
        const [start, end] = v.split('-').map(Number);
        return end === start + 1;
      },
      message: props => `${props.value} is not a valid academic year format! Use format YYYY-YYYY with a 1-year difference (e.g., 2022-2023)`
    }
  },
  hostelStatus: {
    type: String,
    enum: ['Active', 'Inactive'],
    default: 'Active'
  },
  graduationStatus: {
    type: String,
    enum: ['Enrolled', 'Graduated', 'Dropped'],
    default: 'Enrolled'
  },
  isPasswordChanged: {
    type: Boolean,
    default: false
  },
  // Photo fields for students
  studentPhoto: {
    type: String,
    required: false
  },
  guardianPhoto1: {
    type: String,
    required: false
  },
  guardianPhoto2: {
    type: String,
    required: false
  },
  // Fee concession and calculated amounts
  // Legacy field - kept for backward compatibility, represents CURRENT year's active concession
  concession: {
    type: Number,
    default: 0,
    min: 0,
    validate: {
      validator: function(v) {
        return v >= 0;
      },
      message: 'Concession must be a positive number'
    }
  },
  // Concession approval fields (for current academic year)
  concessionApproved: {
    type: Boolean,
    default: false
  },
  concessionApprovedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  concessionApprovedAt: {
    type: Date,
    default: null
  },
  concessionRequestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  concessionRequestedAt: {
    type: Date,
    default: null
  },
  concessionHistory: [{
    action: {
      type: String,
      enum: ['requested', 'approved', 'rejected', 'updated', 'renewed', 'reset'],
      required: true
    },
    amount: {
      type: Number,
      default: 0
    },
    previousAmount: {
      type: Number,
      default: null
    },
    academicYear: {
      type: String,
      default: null
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      required: true
    },
    performedAt: {
      type: Date,
      default: Date.now
    },
    notes: {
      type: String,
      default: ''
    }
  }],
  // Academic Year specific concessions - tracks concession per year
  academicYearConcessions: [{
    academicYear: {
      type: String,
      required: true
    },
    amount: {
      type: Number,
      default: 0,
      min: 0
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null
    },
    requestedAt: {
      type: Date,
      default: null
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null
    },
    approvedAt: {
      type: Date,
      default: null
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
    rejectionReason: {
      type: String,
      default: ''
    },
    notes: {
      type: String,
      default: ''
    }
  }],
  calculatedTerm1Fee: {
    type: Number,
    default: 0,
    min: 0
  },
  calculatedTerm2Fee: {
    type: Number,
    default: 0,
    min: 0
  },
  calculatedTerm3Fee: {
    type: Number,
    default: 0,
    min: 0
  },
  totalCalculatedFee: {
    type: Number,
    default: 0,
    min: 0
  },
  // Late fee per term (applied once after due date passes)
  term1LateFee: {
    type: Number,
    default: 0,
    min: 0
  },
  term2LateFee: {
    type: Number,
    default: 0,
    min: 0
  },
  term3LateFee: {
    type: Number,
    default: 0,
    min: 0
  },
  // Track when late fees were applied to avoid duplicate application
  lateFeeApplied: {
    term1: { type: Boolean, default: false },
    term2: { type: Boolean, default: false },
    term3: { type: Boolean, default: false }
  },
  // Temporary field for pending hostel fee payments (not stored in database permanently)
  pendingHostelPayment: {
    cashfreeOrderId: String,
    amount: Number,
    academicYear: String,
    paymentType: String,
    status: String,
    initiatedAt: Date
  },
  // Renewal history to track year-wise fee changes
  renewalHistory: [{
    // Previous academic year details
    previousAcademicYear: {
      type: String,
      required: true
    },
    previousYear: {
      type: Number,
      required: true
    },
    previousFees: {
      term1Fee: { type: Number, default: 0 },
      term2Fee: { type: Number, default: 0 },
      term3Fee: { type: Number, default: 0 },
      totalFee: { type: Number, default: 0 },
      term1LateFee: { type: Number, default: 0 },
      term2LateFee: { type: Number, default: 0 },
      term3LateFee: { type: Number, default: 0 }
    },
    // New academic year details
    newAcademicYear: {
      type: String,
      required: true
    },
    newYear: {
      type: Number,
      required: true
    },
    newFees: {
      term1Fee: { type: Number, default: 0 },
      term2Fee: { type: Number, default: 0 },
      term3Fee: { type: Number, default: 0 },
      totalFee: { type: Number, default: 0 }
    },
    // Fee structure reference (optional)
    feeStructureId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FeeStructure',
      default: null
    },
    // Concession at time of renewal
    concessionApplied: {
      type: Number,
      default: 0
    },
    // Renewal metadata
    renewedAt: {
      type: Date,
      default: Date.now
    },
    renewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null
    },
    notes: {
      type: String,
      default: ''
    }
  }],
  // Total renewals count
  totalRenewals: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Method to generate random password using crypto
userSchema.statics.generateRandomPassword = function() {
  const length = 6;
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let password = "";
  const randomBytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    password += charset.charAt(randomBytes[i] % charset.length);
  }
  return password;
};

// Create indexes
userSchema.index({ rollNumber: 1 });
userSchema.index({ hostelId: 1 }); // Add index for hostelId
userSchema.index({ role: 1 });
userSchema.index({ course: 1, branch: 1 });

const User = mongoose.model('User', userSchema);

export default User; 