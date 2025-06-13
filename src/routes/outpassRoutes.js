import express from 'express';
import { 
  createOutpassRequest, 
  getStudentOutpassRequests, 
  getAllOutpassRequests, 
  verifyOTPAndApprove, 
  rejectOutpassRequest, 
  getOutpassById 
} from '../controllers/outpassController.js';
import { adminAuth, authenticateStudent, protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Student routes
router.post('/create', protect, authenticateStudent, createOutpassRequest);
router.get('/my-requests', protect, authenticateStudent, getStudentOutpassRequests);

// Admin routes
router.get('/all', protect, adminAuth, getAllOutpassRequests);
router.post('/verify-otp', protect, adminAuth, verifyOTPAndApprove);
router.post('/reject', protect, adminAuth, rejectOutpassRequest);

router.get('/:id', getOutpassById);

export default router; 