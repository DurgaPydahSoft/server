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
  syncFeeStatusWithPayments,
  cleanupOrphanedReminders,
  getAccurateFeeReminderStats
} from '../controllers/feeReminderController.js';
import { authenticateStudent, adminAuth, restrictTo } from '../middleware/authMiddleware.js';

const router = express.Router();

// Student route
router.get('/student/:studentId', authenticateStudent, getStudentFeeReminders);

// Admin/Warden routes - Specific routes first
router.get('/admin/all', adminAuth, restrictTo('super_admin', 'admin', 'sub_admin', 'warden'), getAllFeeReminders);
router.get('/admin/stats', adminAuth, restrictTo('super_admin', 'admin', 'sub_admin', 'warden'), getFeeReminderStats);
router.get('/admin/accurate-stats', adminAuth, restrictTo('super_admin', 'admin', 'sub_admin', 'warden'), getAccurateFeeReminderStats);
router.post('/admin/create', adminAuth, restrictTo('super_admin', 'admin', 'sub_admin'), createFeeReminder);
router.post('/admin/send-manual', adminAuth, restrictTo('super_admin', 'admin', 'sub_admin', 'warden'), sendManualReminder);
router.post('/admin/send-bulk', adminAuth, restrictTo('super_admin', 'admin', 'sub_admin', 'warden'), sendBulkReminders);
router.post('/admin/create-all', adminAuth, restrictTo('super_admin', 'admin', 'sub_admin', 'warden'), createAllFeeReminders);
router.post('/admin/sync-fee-status', adminAuth, restrictTo('super_admin', 'admin', 'sub_admin', 'warden'), syncFeeStatusWithPayments);
router.post('/admin/cleanup-orphaned', adminAuth, restrictTo('super_admin', 'admin', 'sub_admin'), cleanupOrphanedReminders);

// Parameterized routes last
router.put('/admin/:feeReminderId/status', adminAuth, restrictTo('super_admin', 'admin', 'sub_admin', 'warden'), updateFeePaymentStatus);

// Test email functionality
router.post('/test-email', adminAuth, restrictTo('super_admin', 'admin', 'sub_admin'), async (req, res) => {
  try {
    const { studentEmail, reminderNumber = 1 } = req.body;
    
    if (!studentEmail) {
      return res.status(400).json({
        success: false,
        message: 'Student email is required'
      });
    }
    
    // Test data
    const testData = {
      studentName: 'Test Student',
      rollNumber: 'TEST001',
      academicYear: '2024-2025',
      feeAmounts: {
        term1: 15000,
        term2: 15000,
        term3: 15000
      },
      dueDates: {
        term1: new Date(),
        term2: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        term3: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
      }
    };
    
    const { sendFeeReminderEmail } = await import('../utils/emailService.js');
    
    const result = await sendFeeReminderEmail(
      reminderNumber,
      studentEmail,
      testData.studentName,
      testData.rollNumber,
      testData.academicYear,
      testData.feeAmounts,
      testData.dueDates
    );
    
    res.json({
      success: true,
      message: `Test fee reminder ${reminderNumber} email sent successfully`,
      data: result
    });
    
  } catch (error) {
    console.error('Error sending test email:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send test email',
      error: error.message
    });
  }
});

// Automated processing (internal/cron)
router.post('/process', processAutomatedReminders);

// Update reminder visibility (internal)
router.put('/:feeReminderId/visibility', updateReminderVisibility);

export default router; 