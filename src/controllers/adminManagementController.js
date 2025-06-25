import Admin from '../models/Admin.js';
import jwt from 'jsonwebtoken';
import { createError } from '../utils/error.js';

// Create a new sub-admin
export const createSubAdmin = async (req, res, next) => {
  try {
    const { username, password, permissions } = req.body;

    // Check if username already exists
    const existingAdmin = await Admin.findOne({ username });
    if (existingAdmin) {
      throw createError(400, 'Username already exists');
    }

    // Create new sub-admin
    const subAdmin = new Admin({
      username,
      password,
      role: 'sub_admin',
      permissions,
      createdBy: req.admin._id
    });

    const savedAdmin = await subAdmin.save();
    
    // Remove password from response
    const adminResponse = savedAdmin.toObject();
    delete adminResponse.password;

    res.status(201).json({
      success: true,
      data: adminResponse
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
    const { username, password, permissions, isActive } = req.body;

    console.log('📝 Updating sub-admin:', id);
    console.log('📝 Update data:', { username, permissions, isActive });

    const subAdmin = await Admin.findOne({ 
      _id: id,
      role: 'sub_admin',
      createdBy: req.admin._id
    });

    if (!subAdmin) {
      throw createError(404, 'Sub-admin not found');
    }

    console.log('📝 Current sub-admin permissions:', subAdmin.permissions);

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

    const warden = await Admin.findOne({ 
      _id: id,
      role: 'warden',
      createdBy: req.admin._id
    });

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

    const subAdmin = await Admin.findOneAndDelete({
      _id: id,
      role: 'sub_admin',
      createdBy: req.admin._id
    });

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

    const warden = await Admin.findOneAndDelete({
      _id: id,
      role: 'warden',
      createdBy: req.admin._id
    });

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
    const admin = await Admin.findOne({ username, isActive: true });
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
    const token = jwt.sign(
      { 
        _id: admin._id,
        role: admin.role,
        permissions: admin.permissions
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      data: {
        token,
        admin: {
          id: admin._id,
          username: admin.username,
          role: admin.role,
          permissions: admin.permissions
        }
      }
    });
  } catch (error) {
    next(error);
  }
}; 