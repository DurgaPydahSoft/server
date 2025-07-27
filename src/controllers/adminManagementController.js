import Admin from '../models/Admin.js';
import jwt from 'jsonwebtoken';
import { createError } from '../utils/error.js';
import { sendSubAdminRegistrationEmail } from '../utils/emailService.js';

// Create a new sub-admin
export const createSubAdmin = async (req, res, next) => {
  try {
    const { 
      username, 
      password, 
      permissions, 
      leaveManagementCourses, 
      permissionAccessLevels,
      passwordDeliveryMethod,
      email
    } = req.body;

    console.log('🔧 Creating sub-admin with delivery method:', passwordDeliveryMethod);

    // Check if username already exists
    const existingAdmin = await Admin.findOne({ username });
    if (existingAdmin) {
      throw createError(400, 'Username already exists');
    }

    // Validate leave management courses if leave_management permission is selected
    if (permissions && permissions.includes('leave_management')) {
      if (!leaveManagementCourses || leaveManagementCourses.length === 0) {
        throw createError(400, 'At least one course must be selected for leave management permission');
      }
    }

    // Validate password delivery method (optional)
    if (passwordDeliveryMethod && passwordDeliveryMethod !== '' && !['email', 'mobile'].includes(passwordDeliveryMethod)) {
      throw createError(400, 'Password delivery method must be either "email" or "mobile"');
    }

    // Validate email if email delivery is selected
    if (passwordDeliveryMethod === 'email') {
      if (!email || !email.trim()) {
        throw createError(400, 'Email address is required for email delivery');
      }
      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        throw createError(400, 'Invalid email address format');
      }
    }

    // Create new sub-admin
    const subAdmin = new Admin({
      username,
      password,
      role: 'sub_admin',
      permissions,
      permissionAccessLevels: permissionAccessLevels || {},
      leaveManagementCourses: leaveManagementCourses || [],
      createdBy: req.admin._id
    });

    const savedAdmin = await subAdmin.save();
    
    // Send credentials via selected method (if any)
    let deliveryResult = null;
    
    if (passwordDeliveryMethod === 'email') {
      try {
        console.log('📧 Sending sub-admin credentials via email to:', email);
        deliveryResult = await sendSubAdminRegistrationEmail(
          email,
          username, // Using username as admin name for now
          username,
          password
        );
        console.log('📧 Email sent successfully:', deliveryResult);
      } catch (emailError) {
        console.error('📧 Error sending email:', emailError);
        // Don't fail the creation if email fails, but log it
        deliveryResult = { error: emailError.message };
      }
    } else if (passwordDeliveryMethod === 'mobile') {
      // Mobile delivery placeholder for future implementation
      console.log('📱 Mobile delivery requested but not implemented yet');
      deliveryResult = { message: 'Mobile delivery not implemented yet' };
    } else if (!passwordDeliveryMethod) {
      // No delivery method selected
      deliveryResult = { message: 'No credentials sent - admin can provide credentials manually' };
    }
    
    // Remove password from response
    const adminResponse = savedAdmin.toObject();
    delete adminResponse.password;

    res.status(201).json({
      success: true,
      data: adminResponse,
      deliveryResult
    });
  } catch (error) {
    next(error);
  }
};

// Create a new warden
export const createWarden = async (req, res, next) => {
  try {
    const { username, password, hostelType } = req.body;

    // Check if username already exists
    const existingAdmin = await Admin.findOne({ username });
    if (existingAdmin) {
      throw createError(400, 'Username already exists');
    }

    // Validate hostel type
    if (!hostelType || !['boys', 'girls'].includes(hostelType)) {
      throw createError(400, 'Hostel type is required and must be either "boys" or "girls"');
    }

    // Default warden permissions
    const wardenPermissions = [
      'warden_student_oversight',
      'warden_complaint_oversight',
      'warden_leave_oversight',
      'warden_room_oversight',
      'warden_announcement_oversight',
      'warden_discipline_management',
      'warden_attendance_tracking'
    ];

    // Create new warden
    const warden = new Admin({
      username,
      password,
      role: 'warden',
      hostelType,
      permissions: wardenPermissions,
      createdBy: req.admin._id
    });

    const savedWarden = await warden.save();
    
    // Remove password from response
    const wardenResponse = savedWarden.toObject();
    delete wardenResponse.password;

    res.status(201).json({
      success: true,
      data: wardenResponse
    });
  } catch (error) {
    next(error);
  }
};

// Get all sub-admins
export const getSubAdmins = async (req, res, next) => {
  try {
    let query = { role: 'sub_admin' };
    
    // If the current user is not a super admin, only show sub-admins they created
    if (req.admin.role !== 'super_admin') {
      query.createdBy = req.admin._id;
    }

    const subAdmins = await Admin.find(query)
      .select('-password')
      .populate('leaveManagementCourses', 'name code')
      .sort({ createdAt: -1 });

    console.log('📝 Found sub-admins:', subAdmins.length);
    console.log('📝 Query used:', query);

    res.json({
      success: true,
      data: subAdmins
    });
  } catch (error) {
    next(error);
  }
};

// Get all wardens
export const getWardens = async (req, res, next) => {
  try {
    let query = { role: 'warden' };
    
    // If the current user is not a super admin, only show wardens they created
    if (req.admin.role !== 'super_admin') {
      query.createdBy = req.admin._id;
    }

    const wardens = await Admin.find(query)
      .select('-password')
      .sort({ createdAt: -1 });

    console.log('🏠 Found wardens:', wardens.length);
    console.log('🏠 Query used:', query);

    res.json({
      success: true,
      data: wardens
    });
  } catch (error) {
    next(error);
  }
};

// Update sub-admin
export const updateSubAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { username, password, permissions, isActive, leaveManagementCourses, permissionAccessLevels } = req.body;

    console.log('📝 Updating sub-admin:', id);
    console.log('📝 Update data:', { username, permissions, isActive, leaveManagementCourses });

    // Build query based on admin role
    let query = {
      _id: id,
      role: 'sub_admin'
    };

    // If current admin is not super_admin, they can only update sub-admins they created
    if (req.admin.role !== 'super_admin') {
      query.createdBy = req.admin._id;
    }

    const subAdmin = await Admin.findOne(query);

    if (!subAdmin) {
      throw createError(404, 'Sub-admin not found');
    }

    console.log('📝 Current sub-admin permissions:', subAdmin.permissions);

    // Validate leave management courses if leave_management permission is selected
    if (permissions && permissions.includes('leave_management')) {
      if (!leaveManagementCourses || leaveManagementCourses.length === 0) {
        throw createError(400, 'At least one course must be selected for leave management permission');
      }
    }

    // Update fields
    if (username && username !== subAdmin.username) {
      const existingAdmin = await Admin.findOne({ username });
      if (existingAdmin) {
        throw createError(400, 'Username already exists');
      }
      subAdmin.username = username;
    }
    if (password) {
      subAdmin.password = password;
    }
    if (permissions !== undefined) {
      console.log('📝 Updating permissions from:', subAdmin.permissions, 'to:', permissions);
      subAdmin.permissions = permissions;
    }
    if (leaveManagementCourses !== undefined) {
      console.log('📝 Updating leave management courses from:', subAdmin.leaveManagementCourses, 'to:', leaveManagementCourses);
      subAdmin.leaveManagementCourses = leaveManagementCourses;
    }
    if (permissionAccessLevels !== undefined) {
      console.log('📝 Updating permission access levels from:', subAdmin.permissionAccessLevels, 'to:', permissionAccessLevels);
      subAdmin.permissionAccessLevels = permissionAccessLevels;
    }
    if (typeof isActive === 'boolean') {
      subAdmin.isActive = isActive;
    }

    console.log('📝 Saving sub-admin with permissions:', subAdmin.permissions);
    const updatedAdmin = await subAdmin.save();
    
    // Remove password from response
    const adminResponse = updatedAdmin.toObject();
    delete adminResponse.password;

    console.log('📝 Sub-admin updated successfully');

    res.json({
      success: true,
      data: adminResponse
    });
  } catch (error) {
    console.error('📝 Error updating sub-admin:', error);
    next(error);
  }
};

// Update warden
export const updateWarden = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { username, password, isActive, hostelType } = req.body;

    console.log('🏠 Updating warden:', id);
    console.log('🏠 Update data:', { username, isActive, hostelType });

    // Build query based on admin role
    let query = {
      _id: id,
      role: 'warden'
    };

    // If current admin is not super_admin, they can only update wardens they created
    if (req.admin.role !== 'super_admin') {
      query.createdBy = req.admin._id;
    }

    const warden = await Admin.findOne(query);

    if (!warden) {
      throw createError(404, 'Warden not found');
    }

    // Update fields
    if (username && username !== warden.username) {
      const existingAdmin = await Admin.findOne({ username });
      if (existingAdmin) {
        throw createError(400, 'Username already exists');
      }
      warden.username = username;
    }
    if (password) {
      warden.password = password;
    }
    if (typeof isActive === 'boolean') {
      warden.isActive = isActive;
    }
    if (hostelType && ['boys', 'girls'].includes(hostelType)) {
      warden.hostelType = hostelType;
    }

    console.log('🏠 Saving warden');
    const updatedWarden = await warden.save();
    
    // Remove password from response
    const wardenResponse = updatedWarden.toObject();
    delete wardenResponse.password;

    console.log('🏠 Warden updated successfully');

    res.json({
      success: true,
      data: wardenResponse
    });
  } catch (error) {
    console.error('🏠 Error updating warden:', error);
    next(error);
  }
};

// Delete sub-admin
export const deleteSubAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Build query based on admin role
    let query = {
      _id: id,
      role: 'sub_admin'
    };

    // If current admin is not super_admin, they can only delete sub-admins they created
    if (req.admin.role !== 'super_admin') {
      query.createdBy = req.admin._id;
    }

    const subAdmin = await Admin.findOneAndDelete(query);

    if (!subAdmin) {
      throw createError(404, 'Sub-admin not found');
    }

    res.json({
      success: true,
      message: 'Sub-admin deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Delete warden
export const deleteWarden = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Build query based on admin role
    let query = {
      _id: id,
      role: 'warden'
    };

    // If current admin is not super_admin, they can only delete wardens they created
    if (req.admin.role !== 'super_admin') {
      query.createdBy = req.admin._id;
    }

    const warden = await Admin.findOneAndDelete(query);

    if (!warden) {
      throw createError(404, 'Warden not found');
    }

    res.json({
      success: true,
      message: 'Warden deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Admin login
export const adminLogin = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    // Find admin
    const admin = await Admin.findOne({ username, isActive: true })
      .populate('course', 'name code');
    if (!admin) {
      throw createError(401, 'Invalid credentials');
    }

    // Check password
    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      throw createError(401, 'Invalid credentials');
    }

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();

    // Generate token
    const tokenData = { 
      _id: admin._id,
      role: admin.role,
      permissions: admin.permissions,
      permissionAccessLevels: admin.permissionAccessLevels
    };

    // Include course for principals in the token
    if (admin.role === 'principal' && admin.course) {
      tokenData.course = admin.course._id || admin.course;
    }

    // Include hostelType for wardens in the token
    if (admin.role === 'warden' && admin.hostelType) {
      tokenData.hostelType = admin.hostelType;
    }

    const token = jwt.sign(tokenData, process.env.JWT_SECRET, { expiresIn: '24h' });

    // Prepare admin response data
    const adminResponse = {
      id: admin._id,
      username: admin.username,
      role: admin.role,
      permissions: admin.permissions,
      permissionAccessLevels: admin.permissionAccessLevels
    };

    // Include hostelType for wardens
    if (admin.role === 'warden' && admin.hostelType) {
      adminResponse.hostelType = admin.hostelType;
    }

    // Include course for principals
    if (admin.role === 'principal' && admin.course) {
      adminResponse.course = admin.course;
    }

    res.json({
      success: true,
      data: {
        token,
        admin: adminResponse
      }
    });
  } catch (error) {
    next(error);
  }
};

// Create a new principal
export const createPrincipal = async (req, res, next) => {
  try {
    const { username, password, course } = req.body;

    // Check if username already exists
    const existingAdmin = await Admin.findOne({ username });
    if (existingAdmin) {
      throw createError(400, 'Username already exists');
    }

    // Validate course
    if (!course) {
      throw createError(400, 'Course is required');
    }

    // Validate that the course exists in the database
    const Course = (await import('../models/Course.js')).default;
    const courseExists = await Course.findById(course);
    if (!courseExists) {
      throw createError(400, 'Invalid course selected');
    }

    // Default principal permissions
    const principalPermissions = [
      'principal_attendance_oversight',
      'principal_student_oversight',
      'principal_course_management'
    ];

    // Create new principal
    const principal = new Admin({
      username,
      password,
      role: 'principal',
      course,
      permissions: principalPermissions,
      createdBy: req.admin._id
    });

    const savedPrincipal = await principal.save();
    
    // Remove password from response
    const principalResponse = savedPrincipal.toObject();
    delete principalResponse.password;

    res.status(201).json({
      success: true,
      data: principalResponse
    });
  } catch (error) {
    next(error);
  }
};

// Get all principals
export const getPrincipals = async (req, res, next) => {
  try {
    let query = { role: 'principal' };
    
    // If the current user is not a super admin, only show principals they created
    if (req.admin.role !== 'super_admin') {
      query.createdBy = req.admin._id;
    }

    const principals = await Admin.find(query)
      .select('-password')
      .populate('course', 'name code')
      .sort({ createdAt: -1 });

    console.log('🎓 Found principals:', principals.length);
    console.log('🎓 Query used:', query);

    res.json({
      success: true,
      data: principals
    });
  } catch (error) {
    next(error);
  }
};

// Update principal
export const updatePrincipal = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { username, password, course, isActive } = req.body;

    console.log('🎓 Updating principal:', id);
    console.log('🎓 Update data:', { username, course, isActive });

    // Build query based on admin role
    let query = {
      _id: id,
      role: 'principal'
    };

    // If current admin is not super_admin, they can only update principals they created
    if (req.admin.role !== 'super_admin') {
      query.createdBy = req.admin._id;
    }

    const principal = await Admin.findOne(query);

    if (!principal) {
      throw createError(404, 'Principal not found');
    }

    // Update fields
    if (username && username !== principal.username) {
      const existingAdmin = await Admin.findOne({ username });
      if (existingAdmin) {
        throw createError(400, 'Username already exists');
      }
      principal.username = username;
    }
    if (password) {
      principal.password = password;
    }
    if (course) {
      // Validate that the course exists in the database
      const Course = (await import('../models/Course.js')).default;
      const courseExists = await Course.findById(course);
      if (!courseExists) {
        throw createError(400, 'Invalid course selected');
      }
      principal.course = course;
    }
    if (typeof isActive === 'boolean') {
      principal.isActive = isActive;
    }

    const updatedPrincipal = await principal.save();
    
    // Remove password from response
    const principalResponse = updatedPrincipal.toObject();
    delete principalResponse.password;

    console.log('🎓 Principal updated successfully');

    res.json({
      success: true,
      data: principalResponse
    });
  } catch (error) {
    console.error('🎓 Error updating principal:', error);
    next(error);
  }
};

// Delete principal
export const deletePrincipal = async (req, res, next) => {
  try {
    const { id } = req.params;

    console.log('🎓 Deleting principal:', id);

    // Build query based on admin role
    let query = {
      _id: id,
      role: 'principal'
    };

    // If current admin is not super_admin, they can only delete principals they created
    if (req.admin.role !== 'super_admin') {
      query.createdBy = req.admin._id;
    }

    const principal = await Admin.findOneAndDelete(query);

    if (!principal) {
      throw createError(404, 'Principal not found');
    }

    console.log('🎓 Principal deleted successfully');

    res.json({
      success: true,
      message: 'Principal deleted successfully'
    });
  } catch (error) {
    console.error('🎓 Error deleting principal:', error);
    next(error);
  }
};

// Reset admin password (for sub-admins and principals)
export const resetAdminPassword = async (req, res, next) => {
  try {
    const { newPassword } = req.body;
    
    console.log('🔐 Admin password reset request for:', req.admin.username);
    
    // Find the admin
    const admin = await Admin.findById(req.admin._id);
    
    if (!admin) {
      throw createError(404, 'Admin not found');
    }

    // Update password
    admin.password = newPassword;
    await admin.save();

    // Generate new token
    const token = jwt.sign(
      { _id: admin._id, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: '50d' }
    );

    console.log('🔐 Admin password reset successful for:', admin.username);

    res.json({
      success: true,
      data: {
        token,
        admin: {
          id: admin._id,
          username: admin.username,
          role: admin.role,
          permissions: admin.permissions,
          permissionAccessLevels: admin.permissionAccessLevels,
          isActive: admin.isActive,
          hostelType: admin.hostelType,
          course: admin.course,
          leaveManagementCourses: admin.leaveManagementCourses
        }
      },
      message: 'Password reset successfully'
    });
  } catch (error) {
    console.error('🔐 Error resetting admin password:', error);
    next(error);
  }
}; 