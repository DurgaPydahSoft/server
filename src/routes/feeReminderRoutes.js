import express from 'express';
import {
  getStudentFeeReminders,
  getAllFeeReminders,
  updateFeePaymentStatus,
  createFeeReminder,
  createFeeRemindersForAllStudents,
  getFeeReminderStats,
  processAutomatedReminders,
  updateReminderVisibility,
  sendManualReminder,
  sendBulkReminders,
  createAllFeeReminders,
  syncFeeStatusWithPayments
} from '../controllers/feeReminderController.js';
import { authenticateStudent, adminAuth, restrictTo } from '../middleware/authMiddleware.js';

const router = express.Router();

// Student route
router.get('/student/:studentId', authenticateStudent, getStudentFeeReminders);

// Admin/Warden routes - Specific routes first
router.get('/admin/all', adminAuth, restrictTo('super_admin', 'admin', 'sub_admin', 'warden'), getAllFeeReminders);
router.get('/admin/stats', adminAuth, restrictTo('super_admin', 'admin', 'sub_admin', 'warden'), getFeeReminderStats);
router.post('/admin/create', adminAuth, restrictTo('super_admin', 'admin', 'sub_admin'), createFeeReminder);
router.post('/admin/send-manual', adminAuth, restrictTo('super_admin', 'admin', 'sub_admin', 'warden'), sendManualReminder);
router.post('/admin/send-bulk', adminAuth, restrictTo('super_admin', 'admin', 'sub_admin', 'warden'), sendBulkReminders);
router.post('/admin/create-all', adminAuth, restrictTo('super_admin', 'admin', 'sub_admin', 'warden'), createAllFeeReminders);
router.post('/admin/sync-fee-status', adminAuth, restrictTo('super_admin', 'admin', 'sub_admin', 'warden'), syncFeeStatusWithPayments);

// Parameterized routes last
router.put('/admin/:feeReminderId/status', adminAuth, restrictTo('super_admin', 'admin', 'sub_admin', 'warden'), updateFeePaymentStatus);

// Automated processing (internal/cron)
router.post('/process', processAutomatedReminders);

// Update reminder visibility (internal)
router.put('/:feeReminderId/visibility', updateReminderVisibility);

export default router; 