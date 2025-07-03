import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const adminSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['super_admin', 'sub_admin', 'warden', 'principal'],
    default: 'sub_admin'
  },
  hostelType: {
    type: String,
    enum: ['boys', 'girls'],
    required: function() {
      return this.role === 'warden';
    }
  },
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: function() {
      return this.role === 'principal';
    }
  },
  permissions: [{
    type: String,
    enum: [
      'room_management',
      'student_management',
      'complaint_management',
      'leave_management',
      'announcement_management',
      'poll_management',
      'member_management',
      'menu_management',
      'course_management',
      'warden_student_oversight',
      'warden_complaint_oversight',
      'warden_leave_oversight',
      'warden_room_oversight',
      'warden_announcement_oversight',
      'warden_discipline_management',
      'warden_attendance_tracking',
      'principal_attendance_oversight',
      'principal_student_oversight',
      'principal_course_management'
    ]
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },
  lastLogin: {
    type: Date
  }
}, {
  timestamps: true
});

// Hash password before saving
adminSchema.pre('save', async function(next) {
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
adminSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw error;
  }
};

// Method to check if admin has specific permission
adminSchema.methods.hasPermission = function(permission) {
  if (this.role === 'super_admin') return true;
  return this.permissions.includes(permission);
};

// Method to check if user is a warden
adminSchema.methods.isWarden = function() {
  return this.role === 'warden';
};

// Method to check if user is a principal
adminSchema.methods.isPrincipal = function() {
  return this.role === 'principal';
};

// Method to check if user is an admin (super_admin or sub_admin)
adminSchema.methods.isAdmin = function() {
  return this.role === 'super_admin' || this.role === 'sub_admin';
};

const Admin = mongoose.model('Admin', adminSchema);

export default Admin; 