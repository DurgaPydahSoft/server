import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import { createError } from '../utils/error.js';

// General authentication middleware for any logged-in user
export const protect = async (req, res, next) => {
  try {
    console.log('🔐 Protect middleware called for:', req.method, req.path);
    
    let token;
    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      console.log('🔐 No token found in protect middleware');
      return next(createError(401, 'Not authorized, no token'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('🔐 Token decoded in protect middleware:', { _id: decoded._id, role: decoded.role });
    
    // This now correctly looks for _id
    const user = await User.findById(decoded._id).select('-password');
    
    if (!user) {
      console.log('🔐 User not found in protect middleware for _id:', decoded._id);
      return next(createError(404, 'User not found'));
    }

    console.log('🔐 User found in protect middleware:', { _id: user._id, role: user.role });
    req.user = user;
    next();
  } catch (error) {
    console.log('🔐 Token verification failed in protect middleware:', error.message);
    return next(createError(401, 'Not authorized, token failed'));
  }
};

// Admin-only middleware
export const adminAuth = async (req, res, next) => {
  try {
    console.log('🔐 AdminAuth middleware called for:', req.method, req.path);
    
    let token;
    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      console.log('🔐 No token found in adminAuth middleware');
      return next(createError(401, 'Not authorized, no token'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('🔐 Token decoded in adminAuth middleware:', { _id: decoded._id, role: decoded.role });

    // This is the critical fix: using decoded._id
    const admin = await Admin.findById(decoded._id).select('-password');

    if (!admin || !admin.isActive) {
      console.log('🔐 Admin not found or inactive in adminAuth middleware:', { 
        found: !!admin, 
        isActive: admin?.isActive, 
        _id: decoded._id 
      });
      return next(createError(401, 'Admin not found or is not active'));
    }
    
    console.log('🔐 Admin found in adminAuth middleware:', { _id: admin._id, role: admin.role, isActive: admin.isActive });
    req.admin = admin; // Attach the admin object to the request
    next();
  } catch (error) {
    console.log('🔐 Token verification failed in adminAuth middleware:', error.message);
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

// Student-only middleware
export const authenticateStudent = [protect, (req, res, next) => {
  if (req.user?.role !== 'student') {
    return next(createError(403, 'Access denied. Students only.'));
  }
  next();
}];