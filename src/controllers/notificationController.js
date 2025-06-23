import Notification from '../models/Notification.js';
import User from '../models/User.js';
import notificationService from '../utils/notificationService.js';

// Get all notifications for a user
export const getNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    console.log('🔔 Fetching notifications for user:', userId);

    const notifications = await Notification.find({ recipient: userId })
      .populate('sender', 'name email')
      .populate('relatedId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Notification.countDocuments({ recipient: userId });

    console.log('🔔 Found notifications:', notifications.length);

    res.status(200).json({
      success: true,
      data: notifications,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('🔔 Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications',
      error: error.message
    });
  }
};

// Get unread notifications for a user
export const getUnreadNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const limit = parseInt(req.query.limit) || 10;

    console.log('🔔 Fetching unread notifications for user:', userId);

    const notifications = await Notification.find({ 
      recipient: userId, 
      isRead: false 
    })
      .populate('sender', 'name email')
      .populate('relatedId')
      .sort({ createdAt: -1 })
      .limit(limit);

    console.log('🔔 Found unread notifications:', notifications.length);

    res.status(200).json({
      success: true,
      data: notifications
    });
  } catch (error) {
    console.error('🔔 Error fetching unread notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch unread notifications',
      error: error.message
    });
  }
};

// Get unread notification count
export const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user._id;

    console.log('🔔 Fetching unread count for user:', userId);

    const count = await Notification.countDocuments({ 
      recipient: userId, 
      isRead: false 
    });

    console.log('🔔 Unread count:', count);

    res.status(200).json({
      success: true,
      count
    });
  } catch (error) {
    console.error('🔔 Error fetching unread count:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch unread count',
      error: error.message
    });
  }
};

// Mark notification as read
export const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.admin ? req.admin._id : req.user._id;

    console.log('🔔 Marking notification as read:', id, 'for user:', userId);

    const notification = await Notification.findOneAndUpdate(
      { _id: id, recipient: userId },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    console.log('🔔 Notification marked as read successfully');

    res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      data: notification
    });
  } catch (error) {
    console.error('🔔 Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read',
      error: error.message
    });
  }
};

// Mark all notifications as read
export const markAllAsRead = async (req, res) => {
  try {
    const userId = req.admin ? req.admin._id : req.user._id;

    console.log('🔔 Marking all notifications as read for user:', userId);

    const result = await Notification.updateMany(
      { recipient: userId, isRead: false },
      { isRead: true }
    );

    console.log('🔔 Marked notifications as read:', result.modifiedCount);

    res.status(200).json({
      success: true,
      message: 'All notifications marked as read',
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    console.error('🔔 Error marking all notifications as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark all notifications as read',
      error: error.message
    });
  }
};

// Delete notification
export const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    console.log('🔔 Deleting notification:', id, 'for user:', userId);

    const notification = await Notification.findOneAndDelete({
      _id: id,
      recipient: userId
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    console.log('🔔 Notification deleted successfully');

    res.status(200).json({
      success: true,
      message: 'Notification deleted successfully'
    });
  } catch (error) {
    console.error('🔔 Error deleting notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete notification',
      error: error.message
    });
  }
};

// Get admin notifications (for admin dashboard)
export const getAdminNotifications = async (req, res) => {
  try {
    const adminId = req.admin ? req.admin._id : req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    console.log('🔔 Fetching admin notifications for admin:', adminId);

    const notifications = await Notification.find({ recipient: adminId })
      .populate('recipient', 'name email studentId')
      .populate('sender', 'name email')
      .populate('relatedId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Notification.countDocuments({ recipient: adminId });

    console.log('🔔 Found admin notifications:', notifications.length);

    res.status(200).json({
      success: true,
      data: notifications,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('🔔 Error fetching admin notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch admin notifications',
      error: error.message
    });
  }
};

// Get admin unread notifications
export const getAdminUnreadNotifications = async (req, res) => {
  try {
    const adminId = req.admin ? req.admin._id : req.user._id;
    const limit = parseInt(req.query.limit) || 10;

    console.log('🔔 Fetching admin unread notifications for admin:', adminId);

    const notifications = await Notification.find({ 
      recipient: adminId,
      isRead: false 
    })
      .populate('recipient', 'name email studentId')
      .populate('sender', 'name email')
      .populate('relatedId')
      .sort({ createdAt: -1 })
      .limit(limit);

    console.log('🔔 Found admin unread notifications:', notifications.length);

    res.status(200).json({
      success: true,
      data: notifications
    });
  } catch (error) {
    console.error('🔔 Error fetching admin unread notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch admin unread notifications',
      error: error.message
    });
  }
};

// Get admin unread count
export const getAdminUnreadCount = async (req, res) => {
  try {
    const adminId = req.admin ? req.admin._id : req.user._id;

    console.log('🔔 Fetching admin unread count for admin:', adminId);

    const count = await Notification.countDocuments({ 
      recipient: adminId,
      isRead: false 
    });

    console.log('🔔 Admin unread count:', count);

    res.status(200).json({
      success: true,
      count
    });
  } catch (error) {
    console.error('🔔 Error fetching admin unread count:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch admin unread count',
      error: error.message
    });
  }
};

// Send test notification
export const sendTestNotification = async (req, res) => {
  try {
    const userId = req.user._id;

    console.log('🔔 Sending test notification to user:', userId);

    const result = await notificationService.sendToUser(userId, {
      type: 'system',
      message: 'This is a test notification from the server',
      sender: null,
      onModel: 'System'
    });

    if (result) {
      console.log('🔔 Test notification sent successfully');
      res.status(200).json({
        success: true,
        message: 'Test notification sent successfully'
      });
    } else {
      console.log('🔔 Test notification failed');
      res.status(500).json({
        success: false,
        message: 'Failed to send test notification'
      });
    }
  } catch (error) {
    console.error('🔔 Error sending test notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send test notification',
      error: error.message
    });
  }
};

// Get notification service status
export const getNotificationStatus = async (req, res) => {
  try {
    const status = notificationService.getStatus();
    
    console.log('🔔 Notification service status:', status);

    res.status(200).json({
      success: true,
      status
    });
  } catch (error) {
    console.error('🔔 Error getting notification status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get notification status',
      error: error.message
    });
  }
};