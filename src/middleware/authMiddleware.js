import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import { createError } from '../utils/error.js';

// General authentication middleware for any logged-in user
export const protect = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return next(createError(401, 'Not authorized, no token'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // This now correctly looks for _id
    const user = await User.findById(decoded._id).select('-password');
    
    if (!user) {
      return next(createError(404, 'User not found'));
    }

    req.user = user;
    next();
  } catch (error) {
    return next(createError(401, 'Not authorized, token failed'));
  }
};

// Admin-only middleware (includes super_admin, sub_admin, and warden)
export const adminAuth = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return next(createError(401, 'Not authorized, no token'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // This is the critical fix: using decoded._id
    let admin = await Admin.findById(decoded._id).select('-password');
    
    // Populate course for principals
    if (admin && admin.role === 'principal' && admin.course) {
      admin = await Admin.findById(decoded._id).select('-password').populate('course', 'name code');
    }

    if (!admin || !admin.isActive) {
      return next(createError(401, 'Admin not found or is not active'));
    }
    
    req.admin = admin; // Attach the admin object to the request
    next();
  } catch (error) {
    return next(createError(401, 'Not authorized, token failed'));
  }
};

// Warden-only middleware
export const wardenAuth = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return next(createError(401, 'Not authorized, no token'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const admin = await Admin.findById(decoded._id).select('-password');

    if (!admin || !admin.isActive || admin.role !== 'warden') {
      return next(createError(401, 'Warden not found or is not active'));
    }
    
    req.warden = admin; // Attach the warden object to the request
    next();
  } catch (error) {
    return next(createError(401, 'Not authorized, token failed'));
  }
};

// Role-based access control middleware for admins
export const restrictTo = (...roles) => {
  return (req, res, next) => {
    // This middleware assumes adminAuth has already run and attached req.admin
    if (!roles.includes(req.admin?.role)) {
      return next(
        createError(403, 'You do not have permission to perform this action')
      );
    }
    next();
  };
};

// Middleware to check if admin is super admin
export const superAdminAuth = [adminAuth, restrictTo('super_admin')];

// Middleware to check if admin is super admin or sub admin (excludes warden)
export const adminOnlyAuth = [adminAuth, restrictTo('super_admin', 'sub_admin')];

// Middleware to check specific permissions
export const checkPermission = (permission) => {
  return (req, res, next) => {
    // This middleware assumes adminAuth has already run
    if (req.admin?.role === 'super_admin' || req.admin?.permissions?.includes(permission)) {
      next();
    } else {
      return next(createError(403, 'Access denied. You do not have the required permission.'));
    }
  };
};

// Middleware to check warden-specific permissions
export const checkWardenPermission = (permission) => {
  return (req, res, next) => {
    // This middleware assumes wardenAuth has already run
    if (req.warden?.permissions?.includes(permission)) {
      next();
    } else {
      return next(createError(403, 'Access denied. You do not have the required permission.'));
    }
  };
};

// Student-only middleware
export const authenticateStudent = [protect, (req, res, next) => {
  if (req.user?.role !== 'student') {
    return next(createError(403, 'Access denied. Students only.'));
  }
  next();
}];

// Principal-only middleware
export const principalAuth = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return next(createError(401, 'Not authorized, no token'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    let admin = await Admin.findById(decoded._id).select('-password');
    
    // Populate course for principals
    if (admin && admin.role === 'principal' && admin.course) {
      admin = await Admin.findById(decoded._id).select('-password').populate('course', 'name code');
    }

    if (!admin || !admin.isActive || admin.role !== 'principal') {
      return next(createError(401, 'Principal not found or is not active'));
    }
    
    req.principal = admin; // Attach the principal object to the request
    next();
  } catch (error) {
    return next(createError(401, 'Not authorized, token failed'));
  }
};