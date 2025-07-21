import express from 'express';
import {
  getStudentFeeReminders,
  getAllFeeReminders,
  updateFeePaymentStatus,
  createFeeReminder,
  createFeeRemindersForAllStudents,
  getFeeReminderStats,
  processAutomatedReminders,
  updateReminderVisibility
} from '../controllers/feeReminderController.js';
import { authenticateStudent, adminAuth, restrictTo } from '../middleware/authMiddleware.js';

const router = express.Router();

// Student route
router.get('/student/:studentId', authenticateStudent, getStudentFeeReminders);

// Admin/Warden routes
router.get('/admin/all', adminAuth, restrictTo('super_admin', 'admin', 'sub_admin', 'warden'), getAllFeeReminders);
router.get('/admin/stats', adminAuth, restrictTo('super_admin', 'admin', 'sub_admin', 'warden'), getFeeReminderStats);
router.put('/admin/:feeReminderId/status', adminAuth, restrictTo('super_admin', 'admin', 'sub_admin', 'warden'), updateFeePaymentStatus);

// Admin only
router.post('/admin/create', adminAuth, restrictTo('super_admin', 'admin', 'sub_admin'), createFeeReminder);
router.post('/admin/create-all', adminAuth, restrictTo('super_admin', 'admin', 'sub_admin'), createFeeRemindersForAllStudents);

// Automated processing (internal/cron)
router.post('/process', processAutomatedReminders);

// Update reminder visibility (internal)
router.put('/:feeReminderId/visibility', updateReminderVisibility);

export default router; 