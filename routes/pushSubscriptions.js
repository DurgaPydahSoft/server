const express = require('express');
const router = express.Router();
const { subscribe, unsubscribe } = require('../controllers/pushSubscriptionController');
const { protect } = require('../middleware/authMiddleware');

// All routes are protected and require authentication
router.use(protect);

// Subscribe to push notifications
router.post('/subscribe', subscribe);

// Unsubscribe from push notifications
router.post('/unsubscribe', unsubscribe);

module.exports = router; 