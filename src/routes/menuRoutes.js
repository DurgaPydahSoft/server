import express from 'express';
import { adminAuth, authenticateStudent } from '../middleware/authMiddleware.js';
import {
  createOrUpdateMenuForDate,
  getMenuForDate,
  getMenuForToday,
  getMenuForTodayWithRatings,
  submitMealRating,
  getUserMealRating,
  getRatingStats,
  addMenuItemForDate,
  deleteMenuItemForDate
} from '../controllers/menuController.js';

const router = express.Router();

// Admin: create or update menu for a date
router.post('/date', adminAuth, createOrUpdateMenuForDate);
// Admin: get menu for a date
router.get('/date', adminAuth, getMenuForDate);
// Admin: add item to meal for a date
router.post('/item', adminAuth, addMenuItemForDate);
// Admin: delete item from meal for a date
router.delete('/item', adminAuth, deleteMenuItemForDate);

// Admin: get rating statistics for a date
router.get('/ratings/stats', adminAuth, getRatingStats);

// Student: get today's menu (no auth or use student auth if needed)
router.get('/today', getMenuForToday);

// Student: get today's menu with ratings (requires student auth)
router.get('/today/with-ratings', authenticateStudent, getMenuForTodayWithRatings);

// Student: submit rating for a meal
router.post('/rate', authenticateStudent, submitMealRating);

// Student: get user's rating for a specific meal
router.get('/rating', authenticateStudent, getUserMealRating);

export default router; 