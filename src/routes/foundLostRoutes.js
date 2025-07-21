import express from 'express';
import { authenticateStudent, adminAuth } from '../middleware/authMiddleware.js';
import {
  createFoundLost,
  listAllPosts,
  listMyPosts,
  getPostDetails,
  claimItem,
  updatePost,
  closePost,
  adminListAllPosts,
  adminUpdatePostStatus,
  getFoundLostAnalytics
} from '../controllers/foundLostController.js';
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
router.post('/', authenticateStudent, upload.single('image'), createFoundLost);
router.get('/all', listAllPosts); // Public route for browsing
router.get('/my', authenticateStudent, listMyPosts);
router.get('/:id', getPostDetails); // Public route for viewing details
router.post('/:id/claim', authenticateStudent, claimItem);
router.put('/:id', authenticateStudent, upload.single('image'), updatePost);
router.delete('/:id', authenticateStudent, closePost);

// Admin routes
router.get('/admin/all', adminAuth, adminListAllPosts);
router.put('/admin/:id/status', adminAuth, adminUpdatePostStatus);
router.get('/admin/analytics', adminAuth, getFoundLostAnalytics);

export default router; 