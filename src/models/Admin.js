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
    enum: ['super_admin', 'sub_admin', 'warden', 'principal', 'custom'],
    default: 'sub_admin'
  },
  // Custom role fields
  customRole: {
    type: String,
    trim: true,
    required: function() {
      return this.role === 'custom';
    }
  },
  customRoleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomRole',
    required: function() {
      return this.role === 'custom';
    }
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
  leaveManagementCourses: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course'
  }],
  permissions: [{
    type: String,
    enum: [
      'dashboard_home',
      'room_management',
      'student_management',
      'maintenance_ticket_management',
      'leave_management',
      'announcement_management',
      'poll_management',
      'menu_management',
      'course_management',
      'attendance_management',
      'found_lost_management',
      'fee_management',
      'feature_controls',
      'security_management',
      'staff_guests_management',
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
  permissionAccessLevels: {
    type: Map,
    of: {
      type: String,
      enum: ['view', 'full'],
      default: 'view'
    },
    default: {}
  },
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
  timestamps: true,
  toJSON: { 
    transform: function(doc, ret) {
      // Convert Map to plain object for JSON serialization
      if (ret.permissionAccessLevels instanceof Map) {
        ret.permissionAccessLevels = Object.fromEntries(ret.permissionAccessLevels);
      }
      
      // Ensure custom role fields are included
      if (ret.customRoleId && typeof ret.customRoleId === 'object') {
        ret.customRole = ret.customRoleId.name;
      }
      
      return ret;
    }
  }
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

// Ensure super admins have all permissions and full access
adminSchema.pre('save', function(next) {
  if (this.role === 'super_admin') {
    // All available permissions for super admin
    const allPermissions = [
      'dashboard_home',
      'room_management',
      'student_management',
      'maintenance_ticket_management',
      'leave_management',
      'announcement_management',
      'poll_management',
      'menu_management',
      'course_management',
      'attendance_management',
      'found_lost_management',
      'fee_management',
      'feature_controls'
    ];
    
    // Set all permissions
    this.permissions = allPermissions;
    
    // Set full access for all permissions
    const fullAccessLevels = {};
    allPermissions.forEach(permission => {
      fullAccessLevels[permission] = 'full';
    });
    this.permissionAccessLevels = fullAccessLevels;
  }
  
  next();
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

// Static method to generate random password
adminSchema.statics.generateRandomPassword = function() {
  const length = 10;
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let password = "";
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
};

const Admin = mongoose.model('Admin', adminSchema);

export default Admin; 