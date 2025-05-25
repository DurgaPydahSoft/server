const PushSubscription = require('../models/PushSubscription');
const webpush = require('web-push');
const { getVapidKeys } = require('../config/vapidKeys');

// Initialize web-push with VAPID keys
const vapidKeys = getVapidKeys();
webpush.setVapidDetails(
  'mailto:your-email@example.com', // Replace with your email
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// Subscribe to push notifications
exports.subscribe = async (req, res) => {
  try {
    const { endpoint, keys } = req.body;
    const userId = req.user._id;

    // Check if subscription already exists
    let subscription = await PushSubscription.findOne({ endpoint });

    if (subscription) {
      // Update existing subscription
      subscription.userId = userId;
      subscription.keys = keys;
      await subscription.save();
    } else {
      // Create new subscription
      subscription = await PushSubscription.create({
        userId,
        endpoint,
        keys
      });
    }

    res.status(200).json({
      success: true,
      message: 'Push subscription saved successfully',
      data: subscription
    });
  } catch (error) {
    console.error('Error saving push subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save push subscription',
      error: error.message
    });
  }
};

// Unsubscribe from push notifications
exports.unsubscribe = async (req, res) => {
  try {
    const { endpoint } = req.body;
    const userId = req.user._id;

    const subscription = await PushSubscription.findOneAndDelete({
      userId,
      endpoint
    });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Push subscription not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Push subscription removed successfully'
    });
  } catch (error) {
    console.error('Error removing push subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove push subscription',
      error: error.message
    });
  }
};

// Helper function to get notification payload based on type
const getNotificationPayload = (type, data) => {
  const basePayload = {
    title: data.title || 'New Notification',
    body: data.message,
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    type: type,
    id: data.id
  };

  switch (type) {
    case 'complaint':
      return {
        ...basePayload,
        url: `/complaints/${data.relatedId}`,
        title: 'Complaint Update',
        body: data.message
      };
    case 'poll':
      return {
        ...basePayload,
        url: `/polls/${data.relatedId}`,
        title: 'New Poll',
        body: data.message
      };
    case 'announcement':
      return {
        ...basePayload,
        url: `/announcements/${data.relatedId}`,
        title: 'New Announcement',
        body: data.message
      };
    case 'poll_ending':
      return {
        ...basePayload,
        url: `/polls/${data.relatedId}`,
        title: 'Poll Ending Soon',
        body: data.message
      };
    case 'feedback':
      return {
        ...basePayload,
        url: `/feedback/${data.relatedId}`,
        title: 'New Feedback',
        body: data.message
      };
    default:
      return basePayload;
  }
};

// Send push notification to a specific user
exports.sendNotification = async (userId, notification) => {
  try {
    const subscriptions = await PushSubscription.find({ userId });
    
    if (!subscriptions.length) {
      console.log(`No push subscriptions found for user ${userId}`);
      return;
    }

    const payload = getNotificationPayload(notification.type, notification);
    console.log('Sending push notification with payload:', payload);

    const notifications = subscriptions.map(subscription => {
      return webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: subscription.keys
        },
        JSON.stringify(payload)
      ).catch(error => {
        if (error.statusCode === 410) {
          // Subscription has expired or is no longer valid
          return PushSubscription.findByIdAndDelete(subscription._id);
        }
        throw error;
      });
    });

    await Promise.all(notifications);
    console.log('Push notifications sent successfully');
  } catch (error) {
    console.error('Error sending push notification:', error);
    throw error;
  }
}; 