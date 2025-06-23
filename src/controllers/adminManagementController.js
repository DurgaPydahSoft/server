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

// Get all sub-admins
export const getSubAdmins = async (req, res, next) => {
  try {
    const subAdmins = await Admin.find({ 
      role: 'sub_admin',
      createdBy: req.admin._id 
    })
    .select('-password')
    .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: subAdmins
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