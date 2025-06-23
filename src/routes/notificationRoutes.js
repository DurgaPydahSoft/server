import express from 'express';
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount,
  getUnreadNotifications,
  getAdminNotifications,
  getAdminUnreadNotifications,
  getAdminUnreadCount,
  testNotificationService
} from '../controllers/notificationController.js';
import { authenticateStudent, adminAuth, protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Student routes - use protect middleware
router.get('/', protect, getNotifications);
router.get('/unread-count', protect, getUnreadCount);
router.patch('/:id/read', protect, markAsRead);
router.patch('/read-all', protect, markAllAsRead);
router.delete('/:id', protect, deleteNotification);
router.get('/unread', protect, getUnreadNotifications);
router.get('/count', protect, getUnreadCount);
router.delete('/:notificationId', protect, markAsRead);

// Admin routes - use adminAuth middleware
router.get('/admin/all', adminAuth, getAdminNotifications);
router.get('/admin/unread-count', adminAuth, getAdminUnreadCount);
router.get('/admin/unread', adminAuth, getAdminUnreadNotifications);

// Test notification service (admin only)
router.get('/test-service', adminAuth, testNotificationService);

export default router;