import express from 'express';
import { authenticateStudent, adminAuth, wardenAuth, principalAuth } from '../middleware/authMiddleware.js';
import {
  createComplaint,
  listMyComplaints,
  giveFeedback,
  getComplaintTimeline,
  listAllComplaints,
  updateComplaintStatus,
  adminGetTimeline,
  getComplaintDetails,
  processComplaintWithAI,
  getAIConfig,
  updateAIConfig,
  getAIStats,
  updateMemberEfficiency,
  quickAISetup,
  toggleAI,
  createWardenComplaint,
  listWardenComplaints,
  wardenGetTimeline,
  listPrincipalComplaints,
  principalGetTimeline,
  principalGetComplaintDetails,
  deleteComplaint
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

// Principal routes (must come before parameterized routes)
router.get('/principal', principalAuth, listPrincipalComplaints);
router.get('/principal/:id/timeline', principalAuth, principalGetTimeline);
router.get('/principal/:id/details', principalAuth, principalGetComplaintDetails);

// Warden routes (must come before parameterized routes)
router.post('/warden', wardenAuth, upload.single('image'), createWardenComplaint);
router.get('/warden', wardenAuth, listWardenComplaints);
router.get('/warden/:id/timeline', wardenAuth, wardenGetTimeline);
router.get('/warden/:id/details', wardenAuth, getComplaintDetails);

// Student routes
router.post('/', authenticateStudent, upload.single('image'), createComplaint);
router.get('/my', authenticateStudent, listMyComplaints);

// AI processing routes
router.post('/:id/ai-process', authenticateStudent, processComplaintWithAI);
router.post('/admin/:id/ai-process', adminAuth, processComplaintWithAI);

// Admin routes
router.get('/admin/all', adminAuth, listAllComplaints);
router.get('/admin/ai/config', adminAuth, getAIConfig);
router.put('/admin/ai/config', adminAuth, updateAIConfig);
router.get('/admin/ai/stats', adminAuth, getAIStats);
router.put('/admin/members/:memberId/efficiency', adminAuth, updateMemberEfficiency);
router.post('/admin/ai/quick-setup', adminAuth, quickAISetup);
router.post('/admin/ai/toggle', adminAuth, toggleAI);
router.delete('/admin/:id', adminAuth, deleteComplaint);

// Parameterized routes (must come last)
router.get('/:id', authenticateStudent, getComplaintDetails);
router.post('/:id/feedback', authenticateStudent, giveFeedback);
router.get('/:id/timeline', authenticateStudent, getComplaintTimeline);
router.get('/admin/:id', adminAuth, getComplaintDetails);
router.put('/admin/:id/status', adminAuth, updateComplaintStatus);
router.get('/admin/:id/timeline', adminAuth, adminGetTimeline);


export default router; 