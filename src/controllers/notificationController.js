import Notification from '../models/Notification.js';
import User from '../models/User.js';
import Menu from '../models/Menu.js';
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
    const userId = req.admin ? req.admin._id : req.warden ? req.warden._id : req.principal ? req.principal._id : req.user._id;

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
    const userId = req.admin ? req.admin._id : req.warden ? req.warden._id : req.principal ? req.principal._id : req.user._id;

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
    const userId = req.admin ? req.admin._id : req.warden ? req.warden._id : req.principal ? req.principal._id : req.user._id;

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

// Get warden notifications (for warden dashboard)
export const getWardenNotifications = async (req, res) => {
  try {
    const wardenId = req.warden ? req.warden._id : req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    console.log('🔔 Fetching warden notifications for warden:', wardenId);

    const notifications = await Notification.find({ recipient: wardenId })
      .populate('recipient', 'name email studentId')
      .populate('sender', 'name email')
      .populate('relatedId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Notification.countDocuments({ recipient: wardenId });

    console.log('🔔 Found warden notifications:', notifications.length);

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
    console.error('🔔 Error fetching warden notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch warden notifications',
      error: error.message
    });
  }
};

// Get warden unread notifications
export const getWardenUnreadNotifications = async (req, res) => {
  try {
    const wardenId = req.warden ? req.warden._id : req.user._id;
    const limit = parseInt(req.query.limit) || 10;

    console.log('🔔 Fetching warden unread notifications for warden:', wardenId);

    const notifications = await Notification.find({ 
      recipient: wardenId,
      isRead: false 
    })
      .populate('recipient', 'name email studentId')
      .populate('sender', 'name email')
      .populate('relatedId')
      .sort({ createdAt: -1 })
      .limit(limit);

    console.log('🔔 Found warden unread notifications:', notifications.length);

    res.status(200).json({
      success: true,
      data: notifications
    });
  } catch (error) {
    console.error('🔔 Error fetching warden unread notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch warden unread notifications',
      error: error.message
    });
  }
};

// Get warden unread count
export const getWardenUnreadCount = async (req, res) => {
  try {
    const wardenId = req.warden ? req.warden._id : req.user._id;

    console.log('🔔 Fetching warden unread count for warden:', wardenId);

    const count = await Notification.countDocuments({ 
      recipient: wardenId,
      isRead: false 
    });

    console.log('🔔 Warden unread count:', count);

    res.status(200).json({
      success: true,
      count
    });
  } catch (error) {
    console.error('🔔 Error fetching warden unread count:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch warden unread count',
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
    console.log('🔔 Getting notification system status...');
    
    const status = notificationService.getStatus();
    
    res.status(200).json({
      success: true,
      status,
      timestamp: new Date().toISOString()
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

// Send menu notification for a specific meal
export const sendMenuNotification = async (req, res) => {
  try {
    const { mealType, title, message, url, priority } = req.body;
    const userId = req.user._id;

    console.log(`🔔 Sending menu notification for ${mealType} to user:`, userId);

    if (!mealType || !['breakfast', 'lunch', 'dinner'].includes(mealType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid meal type. Must be breakfast, lunch, or dinner.'
      });
    }

    // Fetch today's menu
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const menuDoc = await Menu.findOne({ date: today });
    let itemsList = '';
    if (menuDoc && menuDoc.meals && Array.isArray(menuDoc.meals[mealType])) {
      // Format as a bulleted list with line breaks
      itemsList = menuDoc.meals[mealType].map(item => `• ${item}`).join('\n');
    }
    const itemsText = itemsList ? `\nMenu:\n${itemsList}` : '';

    // Create notification data
    const notificationData = {
      title: title || `${mealType.charAt(0).toUpperCase() + mealType.slice(1)} is Ready!`,
      message: (message || `Check today's ${mealType} menu and rate your meal.`) + itemsText,
      type: 'menu',
      mealType: mealType,
      url: url || '/student',
      priority: priority || 'high',
      recipient: userId,
      sender: null, // System notification
      relatedId: null,
      menuItems: itemsList
    };

    // Create notification in database
    const notification = new Notification(notificationData);
    await notification.save();

    console.log(`🔔 Menu notification created for ${mealType}:`, notification._id);

    // Send via OneSignal if configured
    try {
      const { sendOneSignalNotification } = await import('../utils/oneSignalService.js');
      await sendOneSignalNotification({
        ...notificationData,
        userId: userId.toString()
      });
      console.log(`🔔 Menu notification sent via OneSignal for ${mealType}`);
    } catch (oneSignalError) {
      console.warn(`🔔 OneSignal menu notification failed for ${mealType}:`, oneSignalError);
      // Continue with database notification only
    }

    res.status(200).json({
      success: true,
      message: `${mealType} notification sent successfully`,
      data: notification
    });
  } catch (error) {
    console.error('🔔 Error sending menu notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send menu notification',
      error: error.message
    });
  }
};

// Send menu notification to all students
export const sendMenuNotificationToAllStudents = async (req, res) => {
  try {
    const { mealType, title, message, url, priority } = req.body;

    console.log(`🔔 Sending menu notification for ${mealType} to all students`);

    if (!mealType || !['breakfast', 'lunch', 'dinner'].includes(mealType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid meal type. Must be breakfast, lunch, or dinner.'
      });
    }

    // Fetch today's menu
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const menuDoc = await Menu.findOne({ date: today });
    let itemsList = '';
    if (menuDoc && menuDoc.meals && Array.isArray(menuDoc.meals[mealType])) {
      // Format as a bulleted list with line breaks
      itemsList = menuDoc.meals[mealType].map(item => `• ${item}`).join('\n');
    }
    const itemsText = itemsList ? `\nMenu:\n${itemsList}` : '';

    // Get all students
    const students = await User.find({ role: 'student' });
    console.log(`🔔 Found ${students.length} students to notify`);

    const notificationData = {
      title: title || `${mealType.charAt(0).toUpperCase() + mealType.slice(1)} is Ready!`,
      message: (message || `Check today's ${mealType} menu and rate your meal.`) + itemsText,
      type: 'menu',
      mealType: mealType,
      url: url || '/student',
      priority: priority || 'high',
      menuItems: itemsList
    };

    // Create notifications for all students
    const notifications = [];
    for (const student of students) {
      const notification = new Notification({
        ...notificationData,
        recipient: student._id,
        sender: null
      });
      notifications.push(notification);
    }

    await Notification.insertMany(notifications);
    console.log(`🔔 Created ${notifications.length} menu notifications for ${mealType}`);

    // Send via OneSignal if configured
    try {
      const { sendOneSignalNotification } = await import('../utils/oneSignalService.js');
      const oneSignalPromises = students.map(student => 
        sendOneSignalNotification({
          ...notificationData,
          userId: student._id.toString()
        })
      );
      await Promise.allSettled(oneSignalPromises);
      console.log(`🔔 Menu notifications sent via OneSignal for ${mealType}`);
    } catch (oneSignalError) {
      console.warn(`🔔 OneSignal menu notifications failed for ${mealType}:`, oneSignalError);
      // Continue with database notifications only
    }

    res.status(200).json({
      success: true,
      message: `${mealType} notifications sent to ${students.length} students`,
      count: students.length
    });
  } catch (error) {
    console.error('🔔 Error sending menu notifications to all students:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send menu notifications',
      error: error.message
    });
  }
};

// Get all notifications for a principal
export const getPrincipalNotifications = async (req, res) => {
  try {
    const principalId = req.principal._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    console.log('🔔 Fetching notifications for principal:', principalId);

    const notifications = await Notification.find({ recipient: principalId })
      .populate('sender', 'name email')
      .populate('relatedId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Notification.countDocuments({ recipient: principalId });

    console.log('🔔 Found principal notifications:', notifications.length);

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
    console.error('🔔 Error fetching principal notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch principal notifications',
      error: error.message
    });
  }
};

// Get unread notifications for a principal
export const getPrincipalUnreadNotifications = async (req, res) => {
  try {
    const principalId = req.principal._id;
    const limit = parseInt(req.query.limit) || 10;

    console.log('🔔 Fetching unread notifications for principal:', principalId);

    const notifications = await Notification.find({ 
      recipient: principalId, 
      isRead: false 
    })
      .populate('sender', 'name email')
      .populate('relatedId')
      .sort({ createdAt: -1 })
      .limit(limit);

    console.log('🔔 Found principal unread notifications:', notifications.length);

    res.status(200).json({
      success: true,
      data: notifications
    });
  } catch (error) {
    console.error('🔔 Error fetching principal unread notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch principal unread notifications',
      error: error.message
    });
  }
};

// Get principal unread notification count
export const getPrincipalUnreadCount = async (req, res) => {
  try {
    const principalId = req.principal._id;

    console.log('🔔 Fetching principal unread count for principal:', principalId);

    const count = await Notification.countDocuments({ 
      recipient: principalId, 
      isRead: false 
    });

    console.log('🔔 Principal unread count:', count);

    res.status(200).json({
      success: true,
      count
    });
  } catch (error) {
    console.error('🔔 Error fetching principal unread count:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch principal unread count',
      error: error.message
    });
  }
};