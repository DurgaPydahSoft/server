import { 
  sendOneSignalNotification, 
  sendOneSignalBulkNotification,
  getNotificationPayload,
  isOneSignalConfigured 
} from './oneSignalService.js';
import Notification from '../models/Notification.js';

// Simplified notification service - OneSignal only
class NotificationService {
  constructor() {
    this.isOneSignalAvailable = isOneSignalConfigured();
    console.log('🔔 NotificationService initialized');
    console.log('🔔 OneSignal available:', this.isOneSignalAvailable);
  }

  // Send notification to a single user
  async sendToUser(userId, notificationData) {
    try {
      console.log('🔔 Sending notification to user:', userId);
      console.log('🔔 Notification data:', notificationData);

      // Create database notification first
      const dbNotification = await this.createDatabaseNotification({
        recipient: userId,
        type: notificationData.type,
        message: notificationData.message,
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
          console.log('🔔 OneSignal notification sent successfully');
        } else {
          console.log('🔔 OneSignal notification failed, but database notification created');
        }
      } else {
        console.log('🔔 OneSignal not available, only database notification created');
      }

      return dbNotification;
    } catch (error) {
      console.error('🔔 Error sending notification to user:', error);
      return null;
    }
  }

  // Send notification to multiple users
  async sendToUsers(userIds, notificationData) {
    try {
      console.log('🔔 Sending notification to users:', userIds.length);
      console.log('🔔 Notification data:', notificationData);

      const results = [];

      // Create database notifications for all users
      for (const userId of userIds) {
        const dbNotification = await this.createDatabaseNotification({
          recipient: userId,
          type: notificationData.type,
          message: notificationData.message,
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
      const notification = new Notification(data);
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
      message: `New complaint received: ${complaintData.description}`,
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
      message: `Your complaint has been ${newStatus.toLowerCase()} by ${adminName}`,
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
      message: announcementData.title,
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
      message: pollData.question,
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
      message: `Poll "${pollData.question}" is ending soon. Vote now!`,
      relatedId: pollData._id || pollData.id,
      onModel: 'Poll'
    };

    return await this.sendToUsers(recipientIds, notificationData);
  }

  // Send leave request notification
  async sendLeaveRequestNotification(recipientId, leaveData, studentName, studentId = null) {
    const notificationData = {
      type: 'leave',
      message: `Leave request from ${studentName} for ${leaveData.reason}`,
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
      message: `Your leave request has been ${newStatus.toLowerCase()} by ${adminName}`,
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
      message: systemData.message,
      sender: senderId,
      onModel: 'System'
    };

    return await this.sendToUsers(recipientIds, notificationData);
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