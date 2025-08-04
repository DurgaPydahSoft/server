import express from 'express';
import { adminAuth, authenticateStudent } from '../middleware/authMiddleware.js';
import multer from 'multer';
import {
  createOrUpdateMenuForDate,
  getMenuForDate,
  getMenuForToday,
  getMenuForTodayWithRatings,
  submitMealRating,
  getUserMealRating,
  getRatingStats,
  addMenuItemForDate,
  deleteMenuItemForDate,
  cleanupOldMenuImages,
  deleteMenuImages
} from '../controllers/menuController.js';

const router = express.Router();



// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Admin: create or update menu for a date (with file upload support)
router.post('/date', adminAuth, upload.any(), createOrUpdateMenuForDate);
// Admin: get menu for a date
router.get('/date', adminAuth, getMenuForDate);
// Admin: add item to meal for a date
router.post('/item', adminAuth, addMenuItemForDate);
// Admin: delete item from meal for a date
router.delete('/item', adminAuth, deleteMenuItemForDate);

// Admin: get rating statistics for a date
router.get('/ratings/stats', adminAuth, getRatingStats);

// Admin: cleanup old menu images (run periodically)
router.post('/cleanup-images', adminAuth, cleanupOldMenuImages);

// Admin: delete multiple menu images from S3
router.post('/delete-images', adminAuth, deleteMenuImages);



// Student: get today's menu (no auth or use student auth if needed)
router.get('/today', getMenuForToday);

// Student: get today's menu with ratings (requires student auth)
router.get('/today/with-ratings', authenticateStudent, getMenuForTodayWithRatings);

// Student: submit rating for a meal
router.post('/rate', authenticateStudent, submitMealRating);

// Student: get user's rating for a specific meal
router.get('/rating', authenticateStudent, getUserMealRating);

export default router; 