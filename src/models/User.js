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
        // Alphanumeric validation for roll number
        return /^[A-Z0-9]+$/.test(v);
      },
      message: props => `${props.value} is not a valid roll number! Must be uppercase alphanumeric.`
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
  course: {
    type: String,
    enum: Object.values(COURSES),
    required: function() { return this.role === 'student'; }
  },
  year: {
    type: Number,
    required: function() { return this.role === 'student'; },
    validate: {
      validator: function(v) {
        if (this.role !== 'student') return true;
        // Validate year based on course
        const courseKey = COURSE_LABEL_TO_KEY[this.course];
        switch(courseKey) {
          case 'BTECH':
            return v >= 1 && v <= 4;
          case 'DIPLOMA':
            return v >= 1 && v <= 3;
          case 'PHARMACY':
            return v >= 1 && v <= 4;
          case 'DEGREE':
            return v >= 1 && v <= 3;
          default:
            return false;
        }
      },
      message: props => `${props.value} is not a valid year for the selected course!`
    }
  },
  branch: {
    type: String,
    required: function() { return this.role === 'student'; },
    validate: {
      validator: function(v) {
        if (this.role !== 'student') return true;
        // Convert course label (e.g., 'B.Tech') to key (e.g., 'BTECH') using COURSE_LABEL_TO_KEY
        const courseKey = COURSE_LABEL_TO_KEY[this.course];
        const validBranches = BRANCHES[courseKey] || [];
        return validBranches.includes(v);
      },
      message: props => `${props.value} is not a valid branch for the selected course!`
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
  roomNumber: {
    type: String,
    required: function() { return this.role === 'student'; },
    validate: {
      validator: function(v) {
        if (this.role !== 'student') return true;
        const validRooms = ROOM_MAPPINGS[this.gender]?.[this.category] || [];
        return validRooms.includes(v);
      },
      message: props => `${props.value} is not a valid room number for the selected gender and category!`
    }
  },
  studentPhone: {
    type: String,
    required: function() { return this.role === 'student'; },
    validate: {
      validator: function(v) {
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
  isPasswordChanged: {
    type: Boolean,
    default: false
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
  const length = 10;
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
userSchema.index({ role: 1 });
userSchema.index({ course: 1, branch: 1 });

const User = mongoose.model('User', userSchema);

export default User; 