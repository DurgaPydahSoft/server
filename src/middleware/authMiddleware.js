import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import { createError } from '../utils/error.js';

// Role-based access control middleware
export const restrictTo = (...roles) => {
  return async (req, res, next) => {
    try {
      await protect(req, res, () => {
        if (!roles.includes(req.user.role)) {
          return res.status(403).json({
            success: false,
            message: `Access denied. ${roles.join(' or ')} only.`
          });
        }
        next();
      });
    } catch (error) {
      res.status(401).json({
        success: false,
        message: 'Please authenticate.'
      });
    }
  };
};

// General authentication middleware
export const protect = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route'
      });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded._id).select('-password');
      
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User not found'
        });
      }

      req.user = user;
      next();
    } catch (err) {
      console.error('Token verification error:', err);
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route'
      });
    }
  } catch (err) {
    console.error('Auth middleware error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error in auth middleware'
    });
  }
};

// Admin-only middleware
export const adminAuth = async (req, res, next) => {
  try {
    console.log('🔐 AdminAuth middleware called for URL:', req.originalUrl);
    console.log('🔐 AdminAuth middleware called for method:', req.method);
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      console.log('🔐 No token provided');
      throw createError(401, 'No token provided');
    }

    console.log('🔐 Token exists, verifying...');
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log('🔐 Token decoded:', decoded);
    } catch (err) {
      console.log('🔐 JWT verification failed:', err);
      throw createError(401, 'Invalid token');
    }
    
    console.log('🔐 Looking for admin with id:', decoded.id);
    const admin = await Admin.findById(decoded.id).select('-password');
    console.log('🔐 Admin found:', admin ? 'yes' : 'no');
    if (admin) {
      console.log('🔐 Admin details:', {
        id: admin._id,
        username: admin.username,
        role: admin.role,
        permissions: admin.permissions,
        isActive: admin.isActive
      });
    } else {
      console.log('🔐 No admin found for id:', decoded.id);
    }
    
    if (!admin || !admin.isActive) {
      console.log('🔐 Admin not found or inactive');
      throw createError(401, 'Invalid or inactive admin account');
    }

    console.log('🔐 Admin auth successful:', admin.username);
    req.admin = admin;
    next();
  } catch (error) {
    console.error('🔐 AdminAuth error:', error);
    if (error.name === 'JsonWebTokenError') {
      next(createError(401, 'Invalid token'));
    } else {
      next(error);
    }
  }
};

// Middleware to check if admin is super admin
export const superAdminAuth = async (req, res, next) => {
  try {
    await adminAuth(req, res, () => {
      if (req.admin.role !== 'super_admin') {
        throw createError(403, 'Access denied. Super admin privileges required.');
      }
      next();
    });
  } catch (error) {
    next(error);
  }
};

// Middleware to check specific permissions
export const checkPermission = (permission) => {
  return async (req, res, next) => {
    try {
      await adminAuth(req, res, () => {
        if (req.admin.role === 'super_admin' || req.admin.permissions.includes(permission)) {
          next();
        } else {
          throw createError(403, 'Access denied. Required permission not found.');
        }
      });
    } catch (error) {
      next(error);
    }
  };
};

// Student-only middleware (renamed to match the import in authRoutes.js)
export const authenticateStudent = async (req, res, next) => {
  try {
    await protect(req, res, () => {
      if (req.user.role !== 'student') {
        return res.status(403).json({ message: 'Access denied. Students only.' });
      }
      next();
    });
  } catch (error) {
    res.status(401).json({ message: 'Please authenticate.' });
  }
}; 