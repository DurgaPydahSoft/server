import jwt from 'jsonwebtoken';
import User from '../models/User.js';

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
    await protect(req, res, () => {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Access denied. Admin only.' });
      }
      next();
    });
  } catch (error) {
    res.status(401).json({ message: 'Please authenticate.' });
  }
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