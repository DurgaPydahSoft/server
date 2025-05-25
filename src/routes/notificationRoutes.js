import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount,
  getUnreadNotifications,
  getAdminNotifications
} from '../controllers/notificationController.js';
import { authenticateStudent, adminAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// All routes are protected
router.use(protect);

// Get user's notifications
router.get('/', getNotifications);

// Get unread count
router.get('/unread-count', getUnreadCount);

// Mark a notification as read
router.patch('/:id/read', markAsRead);

// Mark all notifications as read
router.patch('/read-all', markAllAsRead);

// Delete a notification
router.delete('/:id', deleteNotification);

// Routes for both admin and student
router.get('/unread', getUnreadNotifications);
router.get('/count', getUnreadCount);
router.delete('/:notificationId', markAsRead);

// Admin routes
router.get('/admin/all', adminAuth, getAdminNotifications);

export default router;