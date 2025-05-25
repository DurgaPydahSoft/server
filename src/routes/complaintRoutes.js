import express from 'express';
import { authenticateStudent, adminAuth } from '../middleware/authMiddleware.js';
import {
  createComplaint,
  listMyComplaints,
  giveFeedback,
  getComplaintTimeline,
  listAllComplaints,
  updateComplaintStatus,
  adminGetTimeline,
  getComplaintDetails
} from '../controllers/complaintController.js';
import multer from 'multer';

const router = express.Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Not an image! Please upload only images.'), false);
    }
  },
});

// Student routes
router.post('/', authenticateStudent, upload.single('image'), createComplaint);
router.get('/my', authenticateStudent, listMyComplaints);
router.get('/:id', authenticateStudent, getComplaintDetails);
router.post('/:id/feedback', authenticateStudent, giveFeedback);
router.get('/:id/timeline', authenticateStudent, getComplaintTimeline);

// Admin routes
router.get('/admin/all', adminAuth, listAllComplaints);
router.get('/admin/:id', adminAuth, getComplaintDetails);
router.put('/admin/:id/status', adminAuth, updateComplaintStatus);
router.get('/admin/:id/timeline', adminAuth, adminGetTimeline);

export default router; 