import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  saveSubscription,
  removeSubscription
} from '../controllers/pushSubscriptionController.js';

const router = express.Router();

// All routes are protected
router.use(protect);

// Save push subscription
router.post('/subscribe', saveSubscription);

// Remove push subscription
router.post('/unsubscribe', removeSubscription);

export default router; 