import { 
  sendOneSignalNotification, 
  sendOneSignalBulkNotification,
  sendOneSignalSegmentNotification,
  getNotificationPayload,
  isOneSignalConfigured 
} from './oneSignalService.js';
import { sendNotification as sendLegacyNotification } from '../controllers/pushSubscriptionController.js';

// Hybrid notification service
class HybridNotificationService {
  constructor() {
    this.isOneSignalAvailable = isOneSignalConfigured();
    console.log('🔔 HybridNotificationService initialized');
    console.log('🔔 OneSignal available:', this.isOneSignalAvailable);
  }

  // Send notification to a single user
  async sendToUser(userId, notificationData) {
    try {
      console.log('🔔 Sending notification to user:', userId);
      console.log('🔔 Notification data:', notificationData);

      let sent = false;

      // Try OneSignal first
      if (this.isOneSignalAvailable) {
        const payload = getNotificationPayload(notificationData.type, notificationData);
        sent = await sendOneSignalNotification(userId, payload);
        
        if (sent) {
          console.log('🔔 Notification sent via OneSignal');
        }
      }

      // Fallback to legacy system if OneSignal fails or is not available
      if (!sent) {
        console.log('🔔 Falling back to legacy notification system');
        await sendLegacyNotification(userId, notificationData);
        sent = true;
      }

      return sent;
    } catch (error) {
      console.error('🔔 Error sending notification to user:', error);
      return false;
    }
  }

  // Send notification to multiple users
  async sendToUsers(userIds, notificationData) {
    try {
      console.log('🔔 Sending notification to users:', userIds.length);
      console.log('🔔 Notification data:', notificationData);

      let sent = false;

      // Try OneSignal first
      if (this.isOneSignalAvailable && userIds.length > 0) {
        const payload = getNotificationPayload(notificationData.type, notificationData);
        sent = await sendOneSignalBulkNotification(userIds, payload);
        
        if (sent) {
          console.log('🔔 Bulk notification sent via OneSignal');
        }
      }

      // Fallback to legacy system if OneSignal fails or is not available
      if (!sent) {
        console.log('🔔 Falling back to legacy notification system for bulk send');
        const legacyPromises = userIds.map(userId => 
          sendLegacyNotification(userId, notificationData)
        );
        await Promise.allSettled(legacyPromises);
        sent = true;
      }

      return sent;
    } catch (error) {
      console.error('🔔 Error sending bulk notification:', error);
      return false;
    }
  }

  // Send notification to segment (OneSignal only)
  async sendToSegment(segment, notificationData) {
    try {
      if (!this.isOneSignalAvailable) {
        console.log('🔔 OneSignal not available for segment notifications');
        return false;
      }

      console.log('🔔 Sending segment notification to:', segment);
      console.log('🔔 Notification data:', notificationData);

      const payload = getNotificationPayload(notificationData.type, notificationData);
      const sent = await sendOneSignalSegmentNotification(segment, payload);
      
      if (sent) {
        console.log('🔔 Segment notification sent via OneSignal');
      }

      return sent;
    } catch (error) {
      console.error('🔔 Error sending segment notification:', error);
      return false;
    }
  }

  // Send complaint notification
  async sendComplaintNotification(recipientId, complaintData, senderName = 'System') {
    const notificationData = {
      type: 'complaint',
      title: 'New Complaint Filed',
      message: `New complaint received: ${complaintData.description}`,
      relatedId: complaintData._id || complaintData.id,
      data: {
        category: complaintData.category,
        subCategory: complaintData.subCategory,
        senderName
      }
    };

    return await this.sendToUser(recipientId, notificationData);
  }

  // Send complaint status update notification
  async sendComplaintStatusUpdate(recipientId, complaintData, newStatus, adminName = 'Admin') {
    const notificationData = {
      type: 'complaint',
      title: 'Complaint Status Updated',
      message: `Your complaint has been ${newStatus.toLowerCase()} by ${adminName}`,
      relatedId: complaintData._id || complaintData.id,
      data: {
        status: newStatus,
        adminName,
        category: complaintData.category
      }
    };

    return await this.sendToUser(recipientId, notificationData);
  }

  // Send announcement notification
  async sendAnnouncementNotification(recipientIds, announcementData, adminName = 'Admin') {
    const notificationData = {
      type: 'announcement',
      title: 'New Announcement',
      message: announcementData.title,
      relatedId: announcementData._id || announcementData.id,
      data: {
        adminName,
        description: announcementData.description
      }
    };

    return await this.sendToUsers(recipientIds, notificationData);
  }

  // Send poll notification
  async sendPollNotification(recipientIds, pollData, adminName = 'Admin') {
    const notificationData = {
      type: 'poll',
      title: 'New Poll Available',
      message: pollData.question,
      relatedId: pollData._id || pollData.id,
      data: {
        adminName,
        options: pollData.options
      }
    };

    return await this.sendToUsers(recipientIds, notificationData);
  }

  // Send poll ending notification
  async sendPollEndingNotification(recipientIds, pollData) {
    const notificationData = {
      type: 'poll_ending',
      title: 'Poll Ending Soon',
      message: `Poll "${pollData.question}" is ending soon. Vote now!`,
      relatedId: pollData._id || pollData.id,
      data: {
        question: pollData.question,
        endTime: pollData.endTime
      }
    };

    return await this.sendToUsers(recipientIds, notificationData);
  }

  // Send leave request notification
  async sendLeaveRequestNotification(recipientId, leaveData, studentName) {
    const notificationData = {
      type: 'leave',
      title: 'New Leave Request',
      message: `Leave request from ${studentName} for ${leaveData.reason}`,
      relatedId: leaveData._id || leaveData.id,
      data: {
        studentName,
        reason: leaveData.reason,
        startDate: leaveData.startDate,
        endDate: leaveData.endDate
      }
    };

    return await this.sendToUser(recipientId, notificationData);
  }

  // Send leave status update notification
  async sendLeaveStatusUpdate(recipientId, leaveData, newStatus, adminName = 'Admin') {
    const notificationData = {
      type: 'leave',
      title: 'Leave Request Update',
      message: `Your leave request has been ${newStatus.toLowerCase()} by ${adminName}`,
      relatedId: leaveData._id || leaveData.id,
      data: {
        status: newStatus,
        adminName,
        reason: leaveData.reason
      }
    };

    return await this.sendToUser(recipientId, notificationData);
  }

  // Send system notification
  async sendSystemNotification(recipientIds, systemData) {
    const notificationData = {
      type: 'system',
      title: systemData.title || 'System Notification',
      message: systemData.message,
      data: {
        ...systemData.data
      }
    };

    return await this.sendToUsers(recipientIds, notificationData);
  }

  // Get service status
  getStatus() {
    return {
      oneSignal: this.isOneSignalAvailable,
      legacy: true, // Legacy system is always available
      hybrid: true
    };
  }
}

// Create singleton instance
const hybridNotificationService = new HybridNotificationService();

export default hybridNotificationService; 