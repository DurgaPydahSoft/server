import express from 'express';
import {
  adminLogin,
  studentLogin,
  verifyRollNumber,
  completeRegistration,
  resetPassword
} from '../controllers/authController.js';
import { authenticateStudent, protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Test endpoint
router.get('/test', (req, res) => {
  res.json({ message: 'Auth routes are working', timestamp: new Date().toISOString() });
});

// Token validation endpoint
router.get('/validate', protect, (req, res) => {
  res.json({
    success: true,
    data: {
      user: {
        id: req.user._id,
        name: req.user.name,
        role: req.user.role,
        ...(req.user.role === 'student' && {
          rollNumber: req.user.rollNumber,
          course: req.user.course,
          branch: req.user.branch,
          roomNumber: req.user.roomNumber,
          isPasswordChanged: req.user.isPasswordChanged,
          gender: req.user.gender,
          category: req.user.category,
          year: req.user.year,
          studentPhone: req.user.studentPhone,
          parentPhone: req.user.parentPhone,
          batch: req.user.batch,
          academicYear: req.user.academicYear,
          studentPhoto: req.user.studentPhoto,
          guardianPhoto1: req.user.guardianPhoto1,
          guardianPhoto2: req.user.guardianPhoto2
        })
      }
    }
  });
});

// Admin login - DISABLED: Using new admin management system
// router.post('/admin/login', adminLogin);
// Student login
router.post('/student/login', studentLogin);
// Student registration step 1: verify roll number
router.post('/student/verify', verifyRollNumber);
// Student registration step 2: set password
router.post('/student/register', completeRegistration);
// Student reset password
router.post('/student/reset-password', authenticateStudent, resetPassword);

export default router; 