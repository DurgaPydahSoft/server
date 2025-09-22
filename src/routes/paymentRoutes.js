import express from 'express';
import { authenticateStudent, adminAuth } from '../middleware/authMiddleware.js';
import {
  initiatePayment,
  processPayment,
  getPaymentStatus,
  getPaymentHistory,
  getPaymentStats,
  cancelPayment,
  verifyPayment,
  // Hostel fee payment functions
  initiateHostelFeePayment,
  recordHostelFeePayment,
  getHostelFeePayments,
  getHostelFeePaymentHistory,
  getHostelFeePaymentStats,
  // Electricity payment functions
  recordElectricityPayment,
  // All payments function
  getAllPayments
} from '../controllers/paymentController.js';

const router = express.Router();

// Student payment routes
router.post('/initiate', authenticateStudent, initiatePayment);
router.post('/hostel-fee/initiate', authenticateStudent, initiateHostelFeePayment);
router.get('/status/:billId', authenticateStudent, getPaymentStatus);
router.post('/verify/:paymentId', authenticateStudent, verifyPayment);
router.get('/history', authenticateStudent, getPaymentHistory);
router.delete('/cancel/:paymentId', authenticateStudent, cancelPayment);

// Admin payment routes
router.get('/stats', adminAuth, getPaymentStats);
router.get('/all', adminAuth, getAllPayments); // Get all payments (both hostel fee and electricity)

// Hostel fee payment routes
router.post('/hostel-fee', adminAuth, recordHostelFeePayment); // Admin records payment
router.get('/hostel-fee/:studentId', adminAuth, getHostelFeePayments); // Admin gets student payments
router.get('/hostel-fee/history/:studentId', authenticateStudent, getHostelFeePaymentHistory); // Student gets own history
router.get('/hostel-fee/stats', adminAuth, getHostelFeePaymentStats); // Admin gets hostel fee stats

// Electricity payment routes
router.post('/electricity', adminAuth, recordElectricityPayment); // Admin records electricity payment

// Webhook route (no authentication required)
router.post('/webhook', processPayment);

// Test webhook endpoint for debugging
router.post('/webhook-test', (req, res) => {
  console.log('🧪 Test webhook received:', req.body);
  console.log('📋 Headers:', req.headers);
  res.json({ success: true, message: 'Test webhook received' });
});

export default router; 