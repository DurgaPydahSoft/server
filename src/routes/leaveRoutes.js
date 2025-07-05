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
  recordVisit,
  getStayInHostelRequestsForWarden,
  getStayInHostelRequestsForPrincipal,
  wardenRecommendation,
  principalDecision
} from '../controllers/leaveController.js';
import { adminAuth, authenticateStudent, protect, wardenAuth, principalAuth } from '../middleware/authMiddleware.js';

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

// Warden routes for Stay in Hostel requests
router.get('/warden/stay-in-hostel', wardenAuth, getStayInHostelRequestsForWarden);
router.post('/warden/recommendation', wardenAuth, wardenRecommendation);

// Principal routes for Stay in Hostel requests
router.get('/principal/stay-in-hostel', principalAuth, getStayInHostelRequestsForPrincipal);
router.post('/principal/decision', principalAuth, principalDecision);

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