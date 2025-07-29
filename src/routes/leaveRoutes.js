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
  requestIncomingQrView,
  recordVisit,
  recordIncomingVisit,
  getStayInHostelRequestsForWarden,
  getStayInHostelRequestsForPrincipal,
  wardenRecommendation,
  principalDecision,
  getWardenLeaveRequests,
  wardenVerifyOTP,
  wardenRejectLeave,
  getPrincipalLeaveRequests,
  principalApproveLeave,
  principalRejectLeave
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

// Warden routes for Leave Management
router.get('/warden/all', wardenAuth, getWardenLeaveRequests);
router.post('/warden/verify-otp', wardenAuth, wardenVerifyOTP);
router.post('/warden/reject', wardenAuth, wardenRejectLeave);

// Warden routes for Stay in Hostel requests
router.get('/warden/stay-in-hostel', wardenAuth, getStayInHostelRequestsForWarden);
router.post('/warden/recommendation', wardenAuth, wardenRecommendation);

// Principal routes for Leave Management
router.get('/principal/all', principalAuth, getPrincipalLeaveRequests);
router.post('/principal/approve', principalAuth, principalApproveLeave);
router.post('/principal/reject', principalAuth, principalRejectLeave);

// Principal routes for Stay in Hostel requests
router.get('/principal/stay-in-hostel', principalAuth, getStayInHostelRequestsForPrincipal);
router.post('/principal/decision', principalAuth, principalDecision);

// Security guard routes (public access)
router.get('/approved', getApprovedLeaves);
router.post('/verify', updateVerificationStatus);

// Student QR view limit route
router.post('/qr-view/:id', protect, authenticateStudent, requestQrView);

// Student incoming QR view route
router.post('/incoming-qr-view/:id', protect, authenticateStudent, requestIncomingQrView);

// QR scanning route that records visits (public access)
router.post('/qr/:id', recordVisit);

// Incoming QR scanning route that records incoming visits (public access)
router.post('/incoming-qr/:id', recordIncomingVisit);

// Visit recording route
router.post('/:id/record-visit', recordVisit);

// Incoming visit recording route
router.post('/:id/record-incoming-visit', recordIncomingVisit);

// Public route for QR scanning (must be last to avoid conflicts)
router.get('/:id', getLeaveById);

export default router; 