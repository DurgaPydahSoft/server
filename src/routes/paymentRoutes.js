import express from 'express';
import { authenticateStudent, adminAuth } from '../middleware/authMiddleware.js';
import {
  initiatePayment,
  processPayment,
  getPaymentStatus,
  getPaymentHistory,
  getPaymentStats,
  cancelPayment,
  verifyPayment
} from '../controllers/paymentController.js';

const router = express.Router();

// Student payment routes
router.post('/initiate', authenticateStudent, initiatePayment);
router.get('/status/:paymentId', authenticateStudent, getPaymentStatus);
router.post('/verify/:paymentId', authenticateStudent, verifyPayment);
router.get('/history', authenticateStudent, getPaymentHistory);
router.delete('/cancel/:paymentId', authenticateStudent, cancelPayment);

// Admin payment routes
router.get('/stats', adminAuth, getPaymentStats);

// Webhook route (no authentication required)
router.post('/webhook', processPayment);

// Test webhook endpoint for debugging
router.post('/webhook-test', (req, res) => {
  console.log('🧪 Test webhook received:', req.body);
  console.log('📋 Headers:', req.headers);
  res.json({ success: true, message: 'Test webhook received' });
});

export default router; 