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
  requestQrView,
  recordVisit
} from '../controllers/leaveController.js';
import { adminAuth, authenticateStudent, protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Debug middleware to log all requests
router.use((req, res, next) => {
  console.log(`🔍 Leave route accessed: ${req.method} ${req.path}`);
  console.log(`🔍 Request headers:`, req.headers);
  console.log(`🔍 Request body:`, req.body);
  next();
});

// Test route to verify server is working
router.get('/test', (req, res) => {
  console.log('✅ Test route accessed');
  res.json({ 
    message: 'Leave routes are working', 
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path
  });
});

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

// QR scanning route that records visits (public access)
router.post('/qr/:id', recordVisit);

// Visit recording route
router.post('/:id/record-visit', recordVisit);

// Public route for QR scanning (must be last to avoid conflicts)
router.get('/:id', getLeaveById);

export default router; 