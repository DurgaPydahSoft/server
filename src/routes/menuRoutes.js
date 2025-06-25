import express from 'express';
import { adminAuth } from '../middleware/authMiddleware.js';
import {
  createOrUpdateMenuForDate,
  getMenuForDate,
  getMenuForToday,
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

// Student: get today's menu (no auth or use student auth if needed)
router.get('/today', getMenuForToday);

export default router; 