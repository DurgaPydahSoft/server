import express from 'express';
import {
  studentLogin,
  verifyRollNumber,
  completeRegistration,
  resetPassword,
  validate
} from '../controllers/authController.js';
import { authenticateStudent, protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Test endpoint
router.get('/test', (req, res) => {
  res.json({ message: 'Auth routes are working', timestamp: new Date().toISOString() });
});

// Token validation endpoint
router.get('/validate', protect, validate);

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