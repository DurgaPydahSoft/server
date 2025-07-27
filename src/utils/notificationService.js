import { 
  sendOneSignalNotification, 
  sendOneSignalBulkNotification,
  getNotificationPayload,
  isOneSignalConfigured 
} from './oneSignalService.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';

// Simplified notification service - OneSignal only
class NotificationService {
  constructor() {
    this.isOneSignalAvailable = isOneSignalConfigured();
  }

  // Send notification to a single user
  async sendToUser(userId, notificationData) {
    try {

      // Get user name for personalization
      const user = await User.findById(userId).select('name');
      const userName = user?.name || 'there';
      const personalizedMessage = notificationData.message.replace(/^/, `Hey ${userName}, `);

      // Create database notification first
      const dbNotification = await this.createDatabaseNotification({
        recipient: userId,
        recipientModel: 'Admin', // Since we're sending to admins
        type: notificationData.type,
        message: personalizedMessage,
        sender: notificationData.sender,
        relatedId: notificationData.relatedId,
        onModel: notificationData.onModel
      });

      // Send OneSignal notification
      if (this.isOneSignalAvailable) {
        const payload = getNotificationPayload(notificationData.type, {
          ...notificationData,
          id: dbNotification._id
        });
        
        const sent = await sendOneSignalNotification(userId, payload);
        if (sent) {
          // OneSignal notification sent successfully
        } else {
          // OneSignal notification failed, but database notification created
        }
      } else {
        // OneSignal not available, only database notification created
      }

      return dbNotification;
    } catch (error) {
      console.error('Error sending notification to user:', error);
      return null;
    }
  }

  // Send notification to multiple users
  async sendToUsers(userIds, notificationData) {
    try {

      const results = [];

      // Get all users for personalization
      const users = await User.find({ _id: { $in: userIds } }).select('name');
      const userMap = new Map(users.map(user => [user._id.toString(), user.name]));

      // Create database notifications for all users
      for (const userId of userIds) {
        const userName = userMap.get(userId.toString()) || 'there';
        const personalizedMessage = notificationData.message.replace(/^/, `Hey ${userName}, `);
        
        const dbNotification = await this.createDatabaseNotification({
          recipient: userId,
          recipientModel: 'User', // For students
          type: notificationData.type,
          title: notificationData.title,
          message: personalizedMessage,
          mealType: notificationData.mealType,
          url: notificationData.url,
          priority: notificationData.priority,
          sender: notificationData.sender,
          relatedId: notificationData.relatedId,
          onModel: notificationData.onModel
        });
        results.push(dbNotification);
      }

      // Send OneSignal bulk notification
      if (this.isOneSignalAvailable && userIds.length > 0) {
        const payload = getNotificationPayload(notificationData.type, {
          ...notificationData,
          id: results[0]?._id
        });
        
        const sent = await sendOneSignalBulkNotification(userIds, payload);
        if (sent) {
          console.log('🔔 OneSignal bulk notification sent successfully');
        } else {
          console.log('🔔 OneSignal bulk notification failed, but database notifications created');
        }
      } else {
        console.log('🔔 OneSignal not available, only database notifications created');
      }

      return results;
    } catch (error) {
      console.error('🔔 Error sending bulk notification:', error);
      return [];
    }
  }

  // Create database notification
  async createDatabaseNotification(data) {
    try {
      const notificationData = {
        recipient: data.recipient,
        recipientModel: data.recipientModel || 'User', // Default to User if not specified
        type: data.type,
        title: data.title || data.message, // Use message as title if title not provided
        message: data.message,
        url: data.url,
        priority: data.priority,
        sender: data.sender,
        relatedId: data.relatedId,
        onModel: data.onModel
      };

      // Only include mealType for menu notifications
      if (data.type === 'menu') {
        // If mealType is provided, use it; otherwise use a default
        notificationData.mealType = data.mealType || 'breakfast';
      }

      const notification = new Notification(notificationData);
      await notification.save();
      console.log('🔔 Database notification created:', notification._id);
      return notification;
    } catch (error) {
      console.error('🔔 Error creating database notification:', error);
      return null;
    }
  }

  // Send complaint notification
  async sendComplaintNotification(recipientId, complaintData, senderName = 'System', senderId = null) {
    const notificationData = {
      type: 'complaint',
      message: `new complaint alert! 📝 Someone needs your attention`,
      relatedId: complaintData._id || complaintData.id,
      sender: senderId,
      onModel: 'Complaint'
    };

    return await this.sendToUser(recipientId, notificationData);
  }

  // Send complaint status update notification
  async sendComplaintStatusUpdate(recipientId, complaintData, newStatus, adminName = 'Admin', adminId = null) {
    const notificationData = {
      type: 'complaint',
      message: `great news! Your complaint has been ${newStatus.toLowerCase()} ✅`,
      relatedId: complaintData._id || complaintData.id,
      sender: adminId,
      onModel: 'Complaint'
    };

    return await this.sendToUser(recipientId, notificationData);
  }

  // Send announcement notification
  async sendAnnouncementNotification(recipientIds, announcementData, adminName = 'Admin', adminId = null) {
    const notificationData = {
      type: 'announcement',
      message: `📢 new announcement: ${announcementData.title}`,
      relatedId: announcementData._id || announcementData.id,
      sender: adminId,
      onModel: 'Announcement'
    };

    return await this.sendToUsers(recipientIds, notificationData);
  }

  // Send poll notification
  async sendPollNotification(recipientIds, pollData, adminName = 'Admin', adminId = null) {
    const notificationData = {
      type: 'poll',
      message: `🗳️ quick poll: ${pollData.question}`,
      relatedId: pollData._id || pollData.id,
      sender: adminId,
      onModel: 'Poll'
    };

    return await this.sendToUsers(recipientIds, notificationData);
  }

  // Send poll ending notification
  async sendPollEndingNotification(recipientIds, pollData) {
    const notificationData = {
      type: 'poll_ending',
      message: `⏰ poll ending soon! "${pollData.question}" - Vote now! 🗳️`,
      relatedId: pollData._id || pollData.id,
      onModel: 'Poll'
    };

    return await this.sendToUsers(recipientIds, notificationData);
  }

  // Send leave request notification
  async sendLeaveRequestNotification(recipientId, leaveData, studentName, studentId = null) {
    const notificationData = {
      type: 'leave',
      message: `leave request from ${studentName} - ${leaveData.reason}`,
      relatedId: leaveData._id || leaveData.id,
      sender: studentId,
      onModel: 'Leave'
    };

    return await this.sendToUser(recipientId, notificationData);
  }

  // Send leave status update notification
  async sendLeaveStatusUpdate(recipientId, leaveData, newStatus, adminName = 'Admin', adminId = null) {
    const notificationData = {
      type: 'leave',
      message: `✅ your leave request has been ${newStatus.toLowerCase()}!`,
      relatedId: leaveData._id || leaveData.id,
      sender: adminId,
      onModel: 'Leave'
    };

    return await this.sendToUser(recipientId, notificationData);
  }

  // Send system notification
  async sendSystemNotification(recipientIds, systemData, senderId = null) {
    const notificationData = {
      type: 'system',
      message: `🔔 ${systemData.message}`,
      relatedId: systemData.relatedId,
      sender: senderId,
      onModel: 'System'
    };

    return await this.sendToUsers(recipientIds, notificationData);
  }

  // Send menu notification
  async sendMenuNotification(recipientIds, menuData, adminName = 'Admin', adminId = null) {
    const notificationData = {
      type: 'menu',
      title: menuData.title || 'Menu Update',
      message: menuData.message || '🍽️ check out today\'s menu! Tap to see what\'s cooking.',
      mealType: menuData.mealType,
      url: menuData.url,
      priority: menuData.priority,
      menuItems: menuData.menuItems,
      relatedId: menuData.relatedId,
      sender: adminId,
      onModel: 'Menu'
    };

    return await this.sendToUsers(recipientIds, notificationData);
  }

  // Send Found & Lost notification to admins when a new post is created
  async sendFoundLostNotification(recipientId, foundLostData, studentName, studentId = null) {
    try {
      console.log('🔔 Sending Found & Lost notification to admin:', recipientId);
      
      const notificationData = {
        title: 'New Found & Lost Post',
        message: `${studentName} has posted a ${foundLostData.type} item: "${foundLostData.title}"`,
        type: 'foundlost',
        url: '/admin/dashboard/foundlost',
        priority: 'normal',
        sender: studentId,
        relatedId: foundLostData._id,
        onModel: 'FoundLost'
      };

      return await this.sendToUser(recipientId, notificationData);
    } catch (error) {
      console.error('🔔 Error sending Found & Lost notification:', error);
      return null;
    }
  }

  // Send Found & Lost status update notification to student
  async sendFoundLostStatusUpdate(recipientId, foundLostData, newStatus, adminName = 'Admin', adminId = null) {
    try {
      console.log('🔔 Sending Found & Lost status update to student:', recipientId);
      
      const statusMessages = {
        'pending': 'Your found/lost post is pending admin approval.',
        'active': 'Your found/lost post has been approved and is now visible to all students!',
        'claimed': 'Your found/lost item has been claimed!',
        'closed': 'Your found/lost post has been closed by admin.',
        'rejected': 'Your found/lost post has been rejected by admin.'
      };

      const notificationData = {
        title: 'Found & Lost Update',
        message: statusMessages[newStatus] || `Your post status has been updated to: ${newStatus}`,
        type: 'foundlost',
        url: '/student/foundlost',
        priority: 'normal',
        sender: adminId,
        relatedId: foundLostData._id,
        onModel: 'FoundLost'
      };

      return await this.sendToUser(recipientId, notificationData);
    } catch (error) {
      console.error('🔔 Error sending Found & Lost status update notification:', error);
      return null;
    }
  }

  // Send Found & Lost claim notification to original poster
  async sendFoundLostClaimNotification(recipientId, foundLostData, claimerName, claimerId = null) {
    try {
      console.log('🔔 Sending Found & Lost claim notification to original poster:', recipientId);
      
      const notificationData = {
        title: 'Item Claimed!',
        message: `Your ${foundLostData.type === 'found' ? 'found' : 'lost'} item "${foundLostData.title}" has been claimed by ${claimerName}`,
        type: 'foundlost',
        url: '/student/foundlost',
        priority: 'normal',
        sender: claimerId,
        relatedId: foundLostData._id,
        onModel: 'FoundLost'
      };

      return await this.sendToUser(recipientId, notificationData);
    } catch (error) {
      console.error('🔔 Error sending Found & Lost claim notification:', error);
      return null;
    }
  }

  // Get service status
  getStatus() {
    return {
      oneSignal: this.isOneSignalAvailable,
      database: true,
      socket: true
    };
  }
}

// Create singleton instance
const notificationService = new NotificationService();

export default notificationService; 