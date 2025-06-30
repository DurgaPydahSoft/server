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
  getWardenNotifications,
  getWardenUnreadNotifications,
  getWardenUnreadCount,
  sendTestNotification,
  getNotificationStatus,
  sendMenuNotification,
  sendMenuNotificationToAllStudents
} from '../controllers/notificationController.js';
import { protect, adminAuth, wardenAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// Test and status routes (no auth required)
router.post('/test', sendTestNotification);
router.get('/status', getNotificationStatus);

// Menu notification routes
router.post('/send-menu', protect, sendMenuNotification);
router.post('/send-menu-all', adminAuth, sendMenuNotificationToAllStudents);

// Admin routes (adminAuth middleware)
router.get('/admin', adminAuth, getAdminNotifications);
router.get('/admin/unread', adminAuth, getAdminUnreadNotifications);
router.get('/admin/count', adminAuth, getAdminUnreadCount);
router.patch('/admin/read-all', adminAuth, markAllAsRead);
router.patch('/admin/:id/read', adminAuth, markAsRead);
router.delete('/admin/:id', adminAuth, deleteNotification);

// Warden routes (wardenAuth middleware)
router.get('/warden', wardenAuth, getWardenNotifications);
router.get('/warden/unread', wardenAuth, getWardenUnreadNotifications);
router.get('/warden/count', wardenAuth, getWardenUnreadCount);
router.patch('/warden/read-all', wardenAuth, markAllAsRead);
router.patch('/warden/:id/read', wardenAuth, markAsRead);
router.delete('/warden/:id', wardenAuth, deleteNotification);

// Student routes (protect middleware)
router.get('/', protect, getNotifications);
router.get('/unread', protect, getUnreadNotifications);
router.get('/count', protect, getUnreadCount);
router.patch('/read-all', protect, markAllAsRead);
router.patch('/:id/read', protect, markAsRead);
router.delete('/:id', protect, deleteNotification);

export default router;