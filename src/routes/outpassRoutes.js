import express from 'express';
import { 
  createOutpassRequest, 
  getStudentOutpassRequests, 
  getAllOutpassRequests, 
  verifyOTPAndApprove, 
  rejectOutpassRequest, 
  getOutpassById,
  getApprovedOutpasses,
  updateVerificationStatus,
  requestQrView
} from '../controllers/outpassController.js';
import { adminAuth, authenticateStudent, protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Student routes
router.post('/create', protect, authenticateStudent, createOutpassRequest);
router.get('/my-requests', protect, authenticateStudent, getStudentOutpassRequests);

// Admin routes - removed 'protect' middleware
router.get('/all', adminAuth, getAllOutpassRequests);
router.post('/verify-otp', adminAuth, verifyOTPAndApprove);
router.post('/reject', adminAuth, rejectOutpassRequest);

// Security guard routes (public access)
router.get('/approved', getApprovedOutpasses);
router.post('/verify', updateVerificationStatus);

// Student QR view limit route
router.post('/qr-view/:id', protect, authenticateStudent, requestQrView);

router.get('/:id', getOutpassById);

export default router; 