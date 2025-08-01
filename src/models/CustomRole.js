import mongoose from 'mongoose';

const customRoleSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  description: {
    type: String,
    trim: true,
    default: ''
  },
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
      'security_management'
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
  // Course assignment settings
  courseAssignment: {
    type: String,
    enum: ['all', 'selected'],
    default: 'all'
  },
  assignedCourses: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course'
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  }
}, {
  timestamps: true,
  toJSON: { 
    transform: function(doc, ret) {
      // Convert Map to plain object for JSON serialization
      if (ret.permissionAccessLevels instanceof Map) {
        ret.permissionAccessLevels = Object.fromEntries(ret.permissionAccessLevels);
      }
      return ret;
    }
  }
});

// Method to check if role has specific permission
customRoleSchema.methods.hasPermission = function(permission) {
  return this.permissions.includes(permission);
};

// Method to get access level for a permission
customRoleSchema.methods.getAccessLevel = function(permission) {
  return this.permissionAccessLevels.get(permission) || 'view';
};

// Method to check if role can access specific course
customRoleSchema.methods.canAccessCourse = function(courseId) {
  if (this.courseAssignment === 'all') {
    return true;
  }
  return this.assignedCourses.includes(courseId);
};

const CustomRole = mongoose.model('CustomRole', customRoleSchema);

export default CustomRole; 