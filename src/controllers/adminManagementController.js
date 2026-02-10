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

    // NEW LOGIC: Inject assignedCourses AND CollegeDetails for Principals based on assignedCollegeIds
    if (admin.role === 'principal' && admin.assignedCollegeIds && admin.assignedCollegeIds.length > 0) {
      try {
        const { fetchCoursesFromSQL, fetchCollegesFromSQL } = await import('../utils/sqlService.js');
        
        // 1. Fetch and inject College Details
        const sqlCollegesResult = await fetchCollegesFromSQL();
        if (sqlCollegesResult.success) {
           const allColleges = sqlCollegesResult.data;
           const myColleges = allColleges.filter(col => admin.assignedCollegeIds.includes(col.id));
           
           // Inject detailed college info
           admin.assignedCollegeDetails = myColleges.map(col => ({
             id: col.id,
             name: col.name,
             code: col.code
           }));
           tokenData.assignedCollegeDetails = admin.assignedCollegeDetails;
           console.log(`🎓 [Login] Injected ${admin.assignedCollegeDetails.length} college details`);
        }

        // 2. Fetch and inject Assigned Courses (existing logic)
        const sqlCoursesResult = await fetchCoursesFromSQL();
        
        if (sqlCoursesResult.success) {
           const allCourses = sqlCoursesResult.data;
           
           // Filter courses that match College IDs AND Levels
           const matchingCourses = allCourses.filter(course => {
             const collegeMatch = course.college_id && admin.assignedCollegeIds.includes(course.college_id);
             const levelMatch = (!admin.assignedLevels || admin.assignedLevels.length === 0) || 
                               (course.level && admin.assignedLevels.map(l => l.toLowerCase()).includes(course.level.toLowerCase()));
             return collegeMatch && levelMatch;
           });
           
           const derivedCourses = matchingCourses.map(c => c.name);
           console.log(`🎓 [Login] Derived ${derivedCourses.length} courses from colleges for principal`);
           
           // Override/Inject assignedCourses in the token data and admin object for response
           // We do NOT save this to DB, just use it for the session
           admin.assignedCourses = derivedCourses; 
           tokenData.assignedCourses = derivedCourses;
           if (derivedCourses.length > 0) {
             tokenData.course = derivedCourses[0];
             admin.course = derivedCourses[0];
           }
        }
      } catch (err) {
        console.error('🎓 [Login] Error generating courses/colleges from SQL:', err);
      }
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
    const { username, password, assignedCollegeId, assignedCollegeIds, assignedLevels, email } = req.body;

    // Check if username already exists
    const existingAdmin = await Admin.findOne({ username });
    if (existingAdmin) {
      throw createError(400, 'Username already exists');
    }

    // Validate College & Levels
    // Support both single ID (legacy) and array of IDs (new)
    const hasCollege = (assignedCollegeIds && assignedCollegeIds.length > 0) || assignedCollegeId;
    if (!hasCollege) {
      throw createError(400, 'College selection is required');
    }

    if (!assignedLevels || !Array.isArray(assignedLevels) || assignedLevels.length === 0) {
      throw createError(400, 'At least one level (Diploma, UG, PG) must be selected');
    }

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
      'principal_course_management',
      'leave_management' // Explicitly add leave_management
    ];

    // Create new principal
    const principalData = {
      username,
      password,
      role: 'principal',
      assignedCollegeIds: assignedCollegeIds || (assignedCollegeId ? [assignedCollegeId] : []), // Normalize to array
      assignedCollegeId: assignedCollegeId, // Keep for backward compatibility if needed, or remove if schema handles it
      assignedLevels,
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
    
    // Enhance response with college info if needed (client fetches colleges separately so IDs are fine)

    res.json({
      success: true,
      data: principals
    });
  } catch (error) {
    next(error);
  }
};


export const updatePrincipal = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { username, password, assignedCollegeId, assignedCollegeIds, assignedLevels, isActive, email } = req.body;

    console.log('🎓 Updating principal:', id);
    console.log('🎓 Update data:', { username, assignedCollegeId, assignedCollegeIds, assignedLevels, isActive, email });

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
    
    if (assignedCollegeIds) {
      principal.assignedCollegeIds = assignedCollegeIds;
      // If we are setting array, we might want to clear or sync the legacy single ID field if it exists
      if (assignedCollegeIds.length > 0) {
         principal.assignedCollegeId = assignedCollegeIds[0];
      }
    } else if (assignedCollegeId) {
       // Fallback for legacy requests
       principal.assignedCollegeId = assignedCollegeId;
       principal.assignedCollegeIds = [assignedCollegeId];
    }
    
    if (assignedLevels) {
      principal.assignedLevels = assignedLevels;
    }
    
    if (typeof isActive === 'boolean') {
      principal.isActive = isActive;
    }
    
    if (email !== undefined) {
      principal.email = email;
    }

    console.log('🎓 Saving principal');
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