import CustomRole from '../models/CustomRole.js';
import Admin from '../models/Admin.js';
import { createError } from '../utils/error.js';

// Create a new custom role
export const createCustomRole = async (req, res, next) => {
  try {
    const { 
      name, 
      description, 
      permissions, 
      permissionAccessLevels,
      courseAssignment,
      assignedCourses
    } = req.body;

    console.log('🔧 Creating custom role:', name);

    // Check if role name already exists
    const existingRole = await CustomRole.findOne({ name });
    if (existingRole) {
      throw createError(400, 'Role name already exists');
    }

    // Validate permissions
    if (!permissions || permissions.length === 0) {
      throw createError(400, 'At least one permission must be selected');
    }

    // Validate course assignment
    if (courseAssignment === 'selected' && (!assignedCourses || assignedCourses.length === 0)) {
      throw createError(400, 'At least one course must be selected when using selected course assignment');
    }

    // Validate that all assigned courses exist in SQL database and convert to course names
    let validatedCourses = assignedCourses || [];
    if (courseAssignment === 'selected' && assignedCourses && assignedCourses.length > 0) {
      const { getCoursesFromSQL } = await import('../utils/courseBranchMapper.js');
      const sqlCourses = await getCoursesFromSQL();
      validatedCourses = assignedCourses.map(courseIdOrName => {
        const course = sqlCourses.find(c => c.name === courseIdOrName || c._id === courseIdOrName);
        if (!course) {
          throw createError(400, `Invalid course selected: ${courseIdOrName}. Course must exist in SQL database.`);
        }
        return course.name; // Store course name as string
      });
    }

    // Create new custom role
    const customRole = new CustomRole({
      name,
      description,
      permissions,
      permissionAccessLevels: permissionAccessLevels || {},
      courseAssignment: courseAssignment || 'all',
      assignedCourses: validatedCourses,
      createdBy: req.admin._id
    });

    const savedRole = await customRole.save();

    console.log('🔧 Custom role created successfully:', savedRole.name);

    res.status(201).json({
      success: true,
      data: savedRole
    });
  } catch (error) {
    next(error);
  }
};

// Get all custom roles
export const getCustomRoles = async (req, res, next) => {
  try {
    let query = {};
    
    // If the current user is not a super admin, only show roles they created
    if (req.admin.role !== 'super_admin') {
      query.createdBy = req.admin._id;
    }

    const customRoles = await CustomRole.find(query)
      .sort({ createdAt: -1 });

    console.log('🔧 Found custom roles:', customRoles.length);

    res.json({
      success: true,
      data: customRoles
    });
  } catch (error) {
    next(error);
  }
};

// Get a single custom role
export const getCustomRole = async (req, res, next) => {
  try {
    const { id } = req.params;

    let query = { _id: id };
    
    // If the current user is not a super admin, only show roles they created
    if (req.admin.role !== 'super_admin') {
      query.createdBy = req.admin._id;
    }

    const customRole = await CustomRole.findOne(query);

    if (!customRole) {
      throw createError(404, 'Custom role not found');
    }

    res.json({
      success: true,
      data: customRole
    });
  } catch (error) {
    next(error);
  }
};

// Update custom role
export const updateCustomRole = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { 
      name, 
      description, 
      permissions, 
      permissionAccessLevels,
      courseAssignment,
      assignedCourses,
      isActive
    } = req.body;

    console.log('🔧 Updating custom role:', id);

    let query = { _id: id };
    
    // If the current user is not a super admin, only update roles they created
    if (req.admin.role !== 'super_admin') {
      query.createdBy = req.admin._id;
    }

    const customRole = await CustomRole.findOne(query);

    if (!customRole) {
      throw createError(404, 'Custom role not found');
    }

    // Check if name is being changed and if it already exists
    if (name && name !== customRole.name) {
      const existingRole = await CustomRole.findOne({ name });
      if (existingRole) {
        throw createError(400, 'Role name already exists');
      }
      customRole.name = name;
    }

    // Update fields
    if (description !== undefined) {
      customRole.description = description;
    }
    if (permissions !== undefined) {
      if (permissions.length === 0) {
        throw createError(400, 'At least one permission must be selected');
      }
      customRole.permissions = permissions;
    }
    if (permissionAccessLevels !== undefined) {
      customRole.permissionAccessLevels = permissionAccessLevels;
    }
    if (courseAssignment !== undefined) {
      customRole.courseAssignment = courseAssignment;
    }
    if (assignedCourses !== undefined) {
      if (courseAssignment === 'selected' && (!assignedCourses || assignedCourses.length === 0)) {
        throw createError(400, 'At least one course must be selected when using selected course assignment');
      }
      
      // Validate that all assigned courses exist in SQL database and convert to course names
      let validatedCourses = assignedCourses;
      if (courseAssignment === 'selected' && assignedCourses && assignedCourses.length > 0) {
        const { getCoursesFromSQL } = await import('../utils/courseBranchMapper.js');
        const sqlCourses = await getCoursesFromSQL();
        validatedCourses = assignedCourses.map(courseIdOrName => {
          const course = sqlCourses.find(c => c.name === courseIdOrName || c._id === courseIdOrName);
          if (!course) {
            throw createError(400, `Invalid course selected: ${courseIdOrName}. Course must exist in SQL database.`);
          }
          return course.name; // Store course name as string
        });
      }
      customRole.assignedCourses = validatedCourses;
    }
    if (typeof isActive === 'boolean') {
      customRole.isActive = isActive;
    }

    const updatedRole = await customRole.save();

    console.log('🔧 Custom role updated successfully');

    res.json({
      success: true,
      data: updatedRole
    });
  } catch (error) {
    console.error('🔧 Error updating custom role:', error);
    next(error);
  }
};

// Delete custom role
export const deleteCustomRole = async (req, res, next) => {
  try {
    const { id } = req.params;

    console.log('🔧 Deleting custom role:', id);

    let query = { _id: id };
    
    // If the current user is not a super admin, only delete roles they created
    if (req.admin.role !== 'super_admin') {
      query.createdBy = req.admin._id;
    }

    // Check if any admins are using this role
    const adminsUsingRole = await Admin.find({ customRoleId: id });
    if (adminsUsingRole.length > 0) {
      throw createError(400, `Cannot delete role. ${adminsUsingRole.length} admin(s) are currently using this role.`);
    }

    const customRole = await CustomRole.findOneAndDelete(query);

    if (!customRole) {
      throw createError(404, 'Custom role not found');
    }

    console.log('🔧 Custom role deleted successfully');

    res.json({
      success: true,
      message: 'Custom role deleted successfully'
    });
  } catch (error) {
    console.error('🔧 Error deleting custom role:', error);
    next(error);
  }
};

// Get custom roles for dropdown (active only)
export const getActiveCustomRoles = async (req, res, next) => {
  try {
    let query = { isActive: true };
    
    // If the current user is not a super admin, only show roles they created
    if (req.admin.role !== 'super_admin') {
      query.createdBy = req.admin._id;
    }

    const customRoles = await CustomRole.find(query)
      .select('name description')
      .sort({ name: 1 });

    res.json({
      success: true,
      data: customRoles
    });
  } catch (error) {
    next(error);
  }
}; 