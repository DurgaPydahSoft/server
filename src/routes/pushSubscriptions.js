import express from 'express';
import { subscribe, unsubscribe } from '../controllers/pushSubscriptionController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Subscribe to push notifications
router.post('/subscribe', protect, subscribe);

// Unsubscribe from push notifications
router.post('/unsubscribe', protect, unsubscribe);

export default router; 