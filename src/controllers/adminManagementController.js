import Admin from '../models/Admin.js';
import jwt from 'jsonwebtoken';
import { createError } from '../utils/error.js';
import { sendSubAdminRegistrationEmail } from '../utils/emailService.js';
import { sendAdminCredentialsSMS } from '../utils/smsService.js';

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
      email,
      phoneNumber,
      customRoleId // New field for custom role assignment
    } = req.body;

    console.log('🔧 Creating sub-admin with delivery method:', passwordDeliveryMethod);

    // Check if username already exists
    const existingAdmin = await Admin.findOne({ username });
    if (existingAdmin) {
      throw createError(400, 'Username already exists');
    }

    // If custom role is assigned, validate it exists and get its permissions
    let rolePermissions = permissions;
    let roleAccessLevels = permissionAccessLevels;
    let roleLeaveManagementCourses = leaveManagementCourses;
    let adminRole = 'sub_admin';
    let customRoleName = null;

    if (customRoleId) {
      const CustomRole = (await import('../models/CustomRole.js')).default;
      const customRole = await CustomRole.findById(customRoleId);
      
      if (!customRole) {
        throw createError(400, 'Custom role not found');
      }

      if (!customRole.isActive) {
        throw createError(400, 'Selected custom role is not active');
      }

      // Use custom role permissions and access levels
      rolePermissions = customRole.permissions;
      roleAccessLevels = customRole.permissionAccessLevels;
      adminRole = 'custom';
      customRoleName = customRole.name;

      // Handle course assignment based on custom role
      if (customRole.courseAssignment === 'selected') {
        roleLeaveManagementCourses = customRole.assignedCourses;
      }
      // If courseAssignment is 'all', leaveManagementCourses will be handled dynamically
    }

    // Validate leave management courses if leave_management permission is selected
    if (rolePermissions && rolePermissions.includes('leave_management')) {
      if (!roleLeaveManagementCourses || roleLeaveManagementCourses.length === 0) {
        throw createError(400, 'At least one course must be selected for leave management permission');
      }
      
      // Validate that all courses exist in SQL database and convert to course names
      const { getCoursesFromSQL } = await import('../utils/courseBranchMapper.js');
      const sqlCourses = await getCoursesFromSQL();
      const validatedCourses = roleLeaveManagementCourses.map(courseIdOrName => {
        const course = sqlCourses.find(c => c.name === courseIdOrName || c._id === courseIdOrName);
        if (!course) {
          throw createError(400, `Invalid course selected: ${courseIdOrName}. Course must exist in SQL database.`);
        }
        return course.name; // Store course name as string
      });
      roleLeaveManagementCourses = validatedCourses;
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

    // Validate phone number if mobile delivery is selected
    if (passwordDeliveryMethod === 'mobile') {
      if (!phoneNumber || !phoneNumber.trim()) {
        throw createError(400, 'Phone number is required for mobile delivery');
      }
      // Basic phone number validation (at least 10 digits)
      const phoneRegex = /^\d{10,}$/;
      if (!phoneRegex.test(phoneNumber.replace(/\D/g, ''))) {
        throw createError(400, 'Invalid phone number format');
      }
    }

    // Create new admin
    const adminData = {
      username,
      password,
      role: adminRole,
      permissions: rolePermissions,
      permissionAccessLevels: roleAccessLevels || {},
      leaveManagementCourses: roleLeaveManagementCourses || [],
      createdBy: req.admin._id
    };

    // Add custom role fields if applicable
    if (customRoleId) {
      adminData.customRoleId = customRoleId;
      adminData.customRole = customRoleName;
    }

    const newAdmin = new Admin(adminData);
    const savedAdmin = await newAdmin.save();
    
    // Send credentials via selected method (if any)
    let deliveryResult = null;
    
    if (passwordDeliveryMethod === 'email') {
      try {
        console.log('📧 Sending admin credentials via email to:', email);
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
      try {
        console.log('📱 Sending admin credentials via SMS to:', phoneNumber);
        deliveryResult = await sendAdminCredentialsSMS(
          phoneNumber,
          username,
          password
        );
        console.log('📱 SMS sent successfully:', deliveryResult);
      } catch (smsError) {
        console.error('📱 Error sending SMS:', smsError);
        // Don't fail the creation if SMS fails, but log it
        deliveryResult = { error: smsError.message };
      }
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

// Get all sub-admins and custom role admins
export const getSubAdmins = async (req, res, next) => {
  try {
    let query = { 
      $or: [
        { role: 'sub_admin' },
        { role: 'custom' }
      ]
    };
    
    // If the current user is not a super admin, only show admins they created
    if (req.admin.role !== 'super_admin') {
      query.createdBy = req.admin._id;
    }

    const admins = await Admin.find(query)
      .select('-password')
      .populate('customRoleId', 'name description')
      .sort({ createdAt: -1 });

    console.log('📝 Found admins:', admins.length);
    console.log('📝 Query used:', query);

    res.json({
      success: true,
      data: admins
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

// Update sub-admin or custom role admin
export const updateSubAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { username, password, permissions, isActive, leaveManagementCourses, permissionAccessLevels, customRoleId } = req.body;

    console.log('📝 Updating admin:', id);
    console.log('📝 Update data:', { username, permissions, isActive, leaveManagementCourses, customRoleId });

    // Build query based on admin role
    let query = {
      _id: id,
      $or: [{ role: 'sub_admin' }, { role: 'custom' }]
    };

    // If current admin is not super_admin, they can only update admins they created
    if (req.admin.role !== 'super_admin') {
      query.createdBy = req.admin._id;
    }

    const admin = await Admin.findOne(query);

    if (!admin) {
      throw createError(404, 'Admin not found');
    }

    console.log('📝 Current admin permissions:', admin.permissions);

    // Handle custom role assignment
    if (customRoleId !== undefined) {
      if (customRoleId) {
        // Assigning to custom role
        const CustomRole = (await import('../models/CustomRole.js')).default;
        const customRole = await CustomRole.findById(customRoleId);
        
        if (!customRole) {
          throw createError(400, 'Custom role not found');
        }

        if (!customRole.isActive) {
          throw createError(400, 'Selected custom role is not active');
        }

        admin.role = 'custom';
        admin.customRoleId = customRoleId;
        admin.customRole = customRole.name;
        admin.permissions = customRole.permissions;
        admin.permissionAccessLevels = customRole.permissionAccessLevels;
        
        // Handle course assignment based on custom role
        if (customRole.courseAssignment === 'selected') {
          admin.leaveManagementCourses = customRole.assignedCourses;
        } else {
          admin.leaveManagementCourses = [];
        }
      } else {
        // Reverting to sub-admin
        admin.role = 'sub_admin';
        admin.customRoleId = undefined;
        admin.customRole = undefined;
      }
    }

    // Validate leave management courses if leave_management permission is selected
    if (permissions && permissions.includes('leave_management')) {
      if (!leaveManagementCourses || leaveManagementCourses.length === 0) {
        throw createError(400, 'At least one course must be selected for leave management permission');
      }
      
      // Validate that all courses exist in SQL database and convert to course names
      const { getCoursesFromSQL } = await import('../utils/courseBranchMapper.js');
      const sqlCourses = await getCoursesFromSQL();
      const validatedCourses = leaveManagementCourses.map(courseIdOrName => {
        const course = sqlCourses.find(c => c.name === courseIdOrName || c._id === courseIdOrName);
        if (!course) {
          throw createError(400, `Invalid course selected: ${courseIdOrName}. Course must exist in SQL database.`);
        }
        return course.name; // Store course name as string
      });
      leaveManagementCourses = validatedCourses;
    }

    // Update fields
    if (username && username !== admin.username) {
      const existingAdmin = await Admin.findOne({ username });
      if (existingAdmin) {
        throw createError(400, 'Username already exists');
      }
      admin.username = username;
    }
    if (password) {
      admin.password = password;
    }
    if (permissions !== undefined && !customRoleId) {
      console.log('📝 Updating permissions from:', admin.permissions, 'to:', permissions);
      admin.permissions = permissions;
    }
    if (leaveManagementCourses !== undefined && !customRoleId) {
      console.log('📝 Updating leave management courses from:', admin.leaveManagementCourses, 'to:', leaveManagementCourses);
      admin.leaveManagementCourses = leaveManagementCourses;
    }
    if (permissionAccessLevels !== undefined && !customRoleId) {
      console.log('📝 Updating permission access levels from:', admin.permissionAccessLevels, 'to:', permissionAccessLevels);
      admin.permissionAccessLevels = permissionAccessLevels;
    }
    if (typeof isActive === 'boolean') {
      admin.isActive = isActive;
    }

    console.log('📝 Saving admin with permissions:', admin.permissions);
    const updatedAdmin = await admin.save();
    
    // Remove password from response
    const adminResponse = updatedAdmin.toObject();
    delete adminResponse.password;

    console.log('📝 Admin updated successfully');

    res.json({
      success: true,
      data: adminResponse
    });
  } catch (error) {
    console.error('📝 Error updating admin:', error);
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

// Delete sub-admin or custom role admin
export const deleteSubAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Build query based on admin role
    let query = {
      _id: id,
      $or: [{ role: 'sub_admin' }, { role: 'custom' }]
    };

    // If current admin is not super_admin, they can only delete admins they created
    if (req.admin.role !== 'super_admin') {
      query.createdBy = req.admin._id;
    }

    const admin = await Admin.findOneAndDelete(query);

    if (!admin) {
      throw createError(404, 'Admin not found');
    }

    res.json({
      success: true,
      message: 'Admin deleted successfully'
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
    let admin = await Admin.findOne({ username, isActive: true })
      .populate('customRoleId', 'name description permissions permissionAccessLevels courseAssignment assignedCourses');
    
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

    // Include course and branch for principals in the token
    if (admin.role === 'principal') {
      if (admin.assignedCourses && admin.assignedCourses.length > 0) {
        tokenData.assignedCourses = admin.assignedCourses;
        tokenData.course = admin.assignedCourses[0]; // Backward compatibility
      } else if (admin.course) {
        tokenData.course = admin.course;
        tokenData.assignedCourses = [admin.course];
      }
      
      if (admin.branch) {
        tokenData.branch = admin.branch;
      }
    }

    // Include hostelType for wardens in the token
    if (admin.role === 'warden' && admin.hostelType) {
      tokenData.hostelType = admin.hostelType;
    }

    // Include custom role info for custom role admins
    if (admin.role === 'custom' && admin.customRoleId) {
      tokenData.customRoleId = admin.customRoleId._id || admin.customRoleId;
      tokenData.customRole = admin.customRole;
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

    // Include course and branch for principals
    if (admin.role === 'principal') {
      if (admin.assignedCourses && admin.assignedCourses.length > 0) {
        adminResponse.assignedCourses = admin.assignedCourses;
        adminResponse.course = admin.assignedCourses[0]; // Backward compatibility
      } else if (admin.course) {
        adminResponse.course = admin.course;
        adminResponse.assignedCourses = [admin.course];
      }

      if (admin.branch) {
        adminResponse.branch = admin.branch;
      }
    }

    // Include custom role info for custom role admins
    if (admin.role === 'custom' && admin.customRoleId) {
      adminResponse.customRoleId = admin.customRoleId;
      adminResponse.customRole = admin.customRole;
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
    const { username, password, course, courses, branch, email } = req.body;

    // Check if username already exists
    const existingAdmin = await Admin.findOne({ username });
    if (existingAdmin) {
      throw createError(400, 'Username already exists');
    }

    // Validate courses
    let finalAssignedCourses = [];
    
    // Import mapper
    const { getCoursesFromSQL } = await import('../utils/courseBranchMapper.js');
    const sqlCourses = await getCoursesFromSQL();

    if (courses && Array.isArray(courses) && courses.length > 0) {
      // Validate multiple courses
      for (const courseItem of courses) {
        const courseExists = sqlCourses.find(c => c.name === courseItem || c._id === courseItem);
        if (!courseExists) {
          throw createError(400, `Invalid course selected: ${courseItem}. Course must exist in SQL database.`);
        }
        if (!finalAssignedCourses.includes(courseExists.name)) {
            finalAssignedCourses.push(courseExists.name);
        }
      }
    } else if (course) {
      // Validate single course (legacy/fallback)
      const courseExists = sqlCourses.find(c => c.name === course || c._id === course);
      if (!courseExists) {
        throw createError(400, 'Invalid course selected. Course must exist in SQL database.');
      }
      finalAssignedCourses.push(courseExists.name);
    } else {
      throw createError(400, 'At least one course is required');
    }
    
    const courseName = finalAssignedCourses[0]; // Primary/Legacy field

    // Validate email format if provided
    if (email && email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        throw createError(400, 'Invalid email address format');
      }
    }

    // Default principal permissions
    const principalPermissions = [
      'principal_attendance_oversight',
      'principal_student_oversight',
      'principal_course_management'
    ];

    // Validate branch if provided (ONLY if single course)
    let branchName = null;
    if (finalAssignedCourses.length === 1 && branch && branch.trim()) {
      // Validate branch exists in SQL database for the selected course
      const { getBranchesByCourseFromSQL } = await import('../utils/courseBranchMapper.js');
      // We need the ID of the single course
      const singleCourseObj = sqlCourses.find(c => c.name === courseName);
      
      if (singleCourseObj) {
        const branches = await getBranchesByCourseFromSQL(singleCourseObj._id);
        const branchExists = branches.find(b => b.name === branch || b._id === branch);
        if (!branchExists) {
          throw createError(400, 'Invalid branch selected. Branch must exist in SQL database for this course.');
        }
        branchName = branchExists.name; // Store branch name as string
      }
    }

    // Create new principal
    const principalData = {
      username,
      password,
      role: 'principal',
      assignedCourses: finalAssignedCourses,
      course: courseName, // Legacy support
      branch: branchName, // Store branch name as string (optional, usually null for multi-course)
      permissions: principalPermissions,
      createdBy: req.admin._id
    };

    // Add email if provided
    if (email && email.trim()) {
      principalData.email = email.trim().toLowerCase();
    }

    const principal = new Admin(principalData);
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
    const { username, password, course, courses, branch, isActive, email } = req.body;

    console.log('🎓 Updating principal:', id);
    console.log('🎓 Update data:', { username, course, isActive, email });

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
    // Update courses
    if (courses !== undefined || course !== undefined) {
      // Import mapper
      const { getCoursesFromSQL } = await import('../utils/courseBranchMapper.js');
      const sqlCourses = await getCoursesFromSQL();
      let newAssignedCourses = [];

      if (courses && Array.isArray(courses) && courses.length > 0) {
        // Validate multiple courses
        for (const courseItem of courses) {
          const courseExists = sqlCourses.find(c => c.name === courseItem || c._id === courseItem);
          if (!courseExists) {
             throw createError(400, `Invalid course selected: ${courseItem}. Course must exist in SQL database.`);
          }
          if (!newAssignedCourses.includes(courseExists.name)) {
              newAssignedCourses.push(courseExists.name);
          }
        }
      } else if (course) {
         // Validate single course
         const courseExists = sqlCourses.find(c => c.name === course || c._id === course);
         if (!courseExists) {
             throw createError(400, 'Invalid course selected. Course must exist in SQL database.');
         }
         newAssignedCourses.push(courseExists.name);
      }
      
      if (newAssignedCourses.length > 0) {
          principal.assignedCourses = newAssignedCourses;
          principal.course = newAssignedCourses[0];
          
          // Clear branch if multiple courses
          if (newAssignedCourses.length > 1) {
            principal.branch = undefined;
          }
      }
    }
    
    // Handle branch update if provided
    if (req.body.branch !== undefined) {
      const currentAssigned = principal.assignedCourses || (principal.course ? [principal.course] : []);
      
      if (currentAssigned.length > 1) {
         principal.branch = undefined;
      } else if (currentAssigned.length === 1) {
         const branch = req.body.branch;
         if (branch && branch.trim()) {
            const { getBranchesByCourseFromSQL } = await import('../utils/courseBranchMapper.js');
            const { getCoursesFromSQL } = await import('../utils/courseBranchMapper.js');
            const sqlCourses = await getCoursesFromSQL();
            // We need the ID of the single course
            const courseName = currentAssigned[0];
            const singleCourseObj = sqlCourses.find(c => c.name === courseName);
            
            if (singleCourseObj) {
              const branches = await getBranchesByCourseFromSQL(singleCourseObj._id);
              const branchExists = branches.find(b => b.name === branch || b._id === branch);
              if (!branchExists) {
                throw createError(400, 'Invalid branch selected. Branch must exist in SQL database for this course.');
              }
              principal.branch = branchExists.name;
            }
         } else {
            principal.branch = undefined;
         }
      } else {
        principal.branch = undefined;
      }
    }
    if (typeof isActive === 'boolean') {
      principal.isActive = isActive;
    }
    
    // Update email - allow setting to empty string to clear it
    if (email !== undefined) {
      if (email && email.trim()) {
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          throw createError(400, 'Invalid email address format');
        }
        principal.email = email.trim().toLowerCase();
      } else {
        // Clear email if empty string is passed
        principal.email = undefined;
      }
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