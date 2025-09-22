const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { authenticateToken } = require('../middleware/auth');

// Student payment routes
router.post('/initiate', authenticateToken, paymentController.initiatePayment);
router.get('/status/:paymentId', authenticateToken, paymentController.checkPaymentStatus);
router.get('/history', authenticateToken, paymentController.getPaymentHistory);
router.delete('/cancel/:paymentId', authenticateToken, paymentController.cancelPayment);

// Webhook route (no authentication required)
router.post('/webhook', paymentController.processWebhook);

// Admin routes for statistics
router.get('/statistics', authenticateToken, paymentController.getPaymentStatistics);

// Cleanup route for expired payments
router.post('/cleanup-expired', authenticateToken, paymentController.cleanupExpiredPayments);

module.exports = router; 