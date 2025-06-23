import express from 'express';
import {
  getNotifications,
  getUnreadNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getAdminNotifications,
  getAdminUnreadNotifications,
  getAdminUnreadCount,
  sendTestNotification,
  getNotificationStatus
} from '../controllers/notificationController.js';
import { protect, adminAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// Test and status routes (no auth required)
router.post('/test', sendTestNotification);
router.get('/status', getNotificationStatus);

// Admin routes (adminAuth middleware)
router.get('/admin', adminAuth, getAdminNotifications);
router.get('/admin/unread', adminAuth, getAdminUnreadNotifications);
router.get('/admin/count', adminAuth, getAdminUnreadCount);
router.patch('/admin/read-all', adminAuth, markAllAsRead);
router.patch('/admin/:id/read', adminAuth, markAsRead);
router.delete('/admin/:id', adminAuth, deleteNotification);

// Student routes (protect middleware)
router.get('/', protect, getNotifications);
router.get('/unread', protect, getUnreadNotifications);
router.get('/count', protect, getUnreadCount);
router.patch('/read-all', protect, markAllAsRead);
router.patch('/:id/read', protect, markAsRead);
router.delete('/:id', protect, deleteNotification);

export default router;