import express from 'express';
import { 
  createLeaveRequest, 
  getStudentLeaveRequests, 
  getAllLeaveRequests, 
  verifyOTPAndApprove, 
  rejectLeaveRequest, 
  getLeaveById,
  getApprovedLeaves,
  updateVerificationStatus,
  requestQrView
} from '../controllers/leaveController.js';
import { adminAuth, authenticateStudent, protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Student routes
router.post('/create', protect, authenticateStudent, createLeaveRequest);
router.get('/my-requests', protect, authenticateStudent, getStudentLeaveRequests);

// Admin routes - removed 'protect' middleware
router.get('/all', adminAuth, getAllLeaveRequests);
router.post('/verify-otp', adminAuth, verifyOTPAndApprove);
router.post('/reject', adminAuth, rejectLeaveRequest);

// Security guard routes (public access)
router.get('/approved', getApprovedLeaves);
router.post('/verify', updateVerificationStatus);

// Student QR view limit route
router.post('/qr-view/:id', protect, authenticateStudent, requestQrView);

router.get('/:id', getLeaveById);

export default router; 