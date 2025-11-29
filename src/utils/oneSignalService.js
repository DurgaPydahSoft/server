import axios from 'axios';

// OneSignal configuration
const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;

// console.log('DEBUG ONESIGNAL_APP_ID:', process.env.ONESIGNAL_APP_ID);
// console.log('DEBUG ONESIGNAL_REST_API_KEY:', process.env.ONESIGNAL_REST_API_KEY);

// Check if OneSignal is configured
export const isOneSignalConfigured = () => {
  return !!(ONESIGNAL_APP_ID && ONESIGNAL_REST_API_KEY);
};

// Send notification to specific user via OneSignal
export const sendOneSignalNotification = async (userId, notificationData) => {
  try {
    if (!isOneSignalConfigured()) {
      return false;
    }

    // Build the notification payload according to OneSignal documentation
    const payload = {
      app_id: ONESIGNAL_APP_ID,
      include_external_user_ids: [userId.toString()],
      headings: { en: notificationData.title || 'New Notification' },
      contents: { en: notificationData.message },
      url: notificationData.url || '/',
      data: {
        type: notificationData.type,
        id: notificationData.id,
        relatedId: notificationData.relatedId,
        ...notificationData.data
      },
      // Web push specific parameters
      chrome_web_image: notificationData.image,
      chrome_web_icon: notificationData.icon || 'https://hms.pydahsoft.in/PYDAH_LOGO_PHOTO.jpg',
      // Priority and TTL
      priority: notificationData.priority || 10,
      ttl: notificationData.ttl || 86400, // 24 hours
      // Collapse and topic
      collapse_id: notificationData.collapseId,
      web_push_topic: notificationData.topic,
      // Platform targeting - ensure web push is enabled
      isAnyWeb: true,
      // Additional required parameters
      channel_for_external_user_ids: "push",
      // Enable frequency capping
      enable_frequency_cap: true
    };



    const response = await axios.post(
      'https://api.onesignal.com/notifications',
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`
        }
      }
    );

    return true;
  } catch (error) {
    console.error('Error sending OneSignal notification:', error.response?.data || error.message);
    return false;
  }
};

// Send notification to multiple users via OneSignal
export const sendOneSignalBulkNotification = async (userIds, notificationData) => {
  try {
    if (!isOneSignalConfigured()) {
      return false;
    }

    if (!userIds || userIds.length === 0) {
      return false;
    }

    const payload = {
      app_id: ONESIGNAL_APP_ID,
      include_external_user_ids: userIds.map(id => id.toString()),
      headings: { en: notificationData.title || 'New Notification' },
      contents: { en: notificationData.message },
      url: notificationData.url || '/',
      data: {
        type: notificationData.type,
        id: notificationData.id,
        relatedId: notificationData.relatedId,
        ...notificationData.data
      },
      // Web push specific parameters
      chrome_web_image: notificationData.image,
      chrome_web_icon: notificationData.icon || '/icon-192x192.png',
      // Priority and TTL
      priority: notificationData.priority || 10,
      ttl: notificationData.ttl || 86400,
      // Collapse and topic
      collapse_id: notificationData.collapseId,
      web_push_topic: notificationData.topic,
      // Platform targeting - ensure web push is enabled
      isAnyWeb: true,
      // Additional required parameters
      channel_for_external_user_ids: "push",
      // Enable frequency capping
      enable_frequency_cap: true
    };

    console.log('🔔 OneSignal bulk payload:', JSON.stringify(payload, null, 2));

    const response = await axios.post(
      'https://api.onesignal.com/notifications',
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`
        }
      }
    );

    console.log('🔔 OneSignal bulk notification sent successfully:', response.data);
    return true;
  } catch (error) {
    console.error('🔔 Error sending OneSignal bulk notification:', error.response?.data || error.message);
    if (error.response) {
      console.error('🔔 OneSignal API Error Details:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
    }
    return false;
  }
};

// Send notification to segment via OneSignal
export const sendOneSignalSegmentNotification = async (segment, notificationData) => {
  try {
    if (!isOneSignalConfigured()) {
      console.log('🔔 OneSignal not configured, skipping segment notification');
      return false;
    }

    console.log('🔔 Sending OneSignal segment notification to:', segment);
    console.log('🔔 Notification data:', notificationData);

    const payload = {
      app_id: ONESIGNAL_APP_ID,
      included_segments: [segment],
      headings: { en: notificationData.title || 'New Notification' },
      contents: { en: notificationData.message },
      url: notificationData.url || '/',
      data: {
        type: notificationData.type,
        id: notificationData.id,
        relatedId: notificationData.relatedId,
        ...notificationData.data
      },
      // Web push specific parameters
      chrome_web_image: notificationData.image,
      chrome_web_icon: notificationData.icon || '/icon-192x192.png',
      // Priority and TTL
      priority: notificationData.priority || 10,
      ttl: notificationData.ttl || 86400,
      // Collapse and topic
      collapse_id: notificationData.collapseId,
      web_push_topic: notificationData.topic,
      // Platform targeting - ensure web push is enabled
      isAnyWeb: true,
      // Enable frequency capping
      enable_frequency_cap: true
    };

    console.log('🔔 OneSignal segment payload:', JSON.stringify(payload, null, 2));

    const response = await axios.post(
      'https://api.onesignal.com/notifications',
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`
        }
      }
    );

    console.log('🔔 OneSignal segment notification sent successfully:', response.data);
    return true;
  } catch (error) {
    console.error('🔔 Error sending OneSignal segment notification:', error.response?.data || error.message);
    if (error.response) {
      console.error('🔔 OneSignal API Error Details:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
    }
    return false;
  }
};

// Get notification payload based on type and recipient role
export const getNotificationPayload = (type, data, recipientRole = null) => {
  const basePayload = {
    title: data.title || 'New Notification',
    message: data.message,
    type: type,
    id: data.id,
    relatedId: data.relatedId
  };

  // If URL is explicitly provided, use it
  if (data.url) {
    return {
      ...basePayload,
      url: data.url,
      collapseId: data.collapseId || `${type}-${data.relatedId}`,
      priority: data.priority || 8
    };
  }

  // Determine URL based on type and recipient role
  switch (type) {
    case 'complaint':
      // If recipient is admin/warden/principal, go to their complaints page
      if (recipientRole === 'admin' || recipientRole === 'super_admin' || recipientRole === 'sub_admin') {
        return {
          ...basePayload,
          title: data.title || 'Complaint Update',
          url: `/admin/dashboard/complaints`,
          collapseId: `complaint-${data.relatedId}`,
          priority: 10
        };
      } else if (recipientRole === 'warden') {
        return {
          ...basePayload,
          title: data.title || 'Complaint Update',
          url: `/warden/dashboard/complaints/view`,
          collapseId: `complaint-${data.relatedId}`,
          priority: 10
        };
      } else if (recipientRole === 'principal') {
        return {
          ...basePayload,
          title: data.title || 'Complaint Update',
          url: `/principal/dashboard/complaints`,
          collapseId: `complaint-${data.relatedId}`,
          priority: 10
        };
      }
      // Default to student route
      return {
        ...basePayload,
        title: data.title || 'Complaint Update',
        url: `/student/my-complaints`,
        collapseId: `complaint-${data.relatedId}`,
        priority: 10
      };
    
    case 'announcement':
      return {
        ...basePayload,
        title: data.title || 'New Announcement',
        url: `/student/announcements`,
        collapseId: `announcement-${data.relatedId}`,
        priority: 8
      };
    
    case 'poll':
      return {
        ...basePayload,
        title: data.title || 'New Poll',
        url: `/student/polls`,
        collapseId: `poll-${data.relatedId}`,
        priority: 9
      };
    
    case 'poll_ending':
      return {
        ...basePayload,
        title: data.title || 'Poll Ending Soon',
        url: `/student/polls`,
        collapseId: `poll-ending-${data.relatedId}`,
        priority: 10
      };
    
    case 'leave':
      // If recipient is admin/warden/principal, go to their leave management page
      if (recipientRole === 'admin' || recipientRole === 'super_admin' || recipientRole === 'sub_admin') {
        return {
          ...basePayload,
          title: data.title || 'Leave Request Update',
          url: `/admin/dashboard/leave`,
          collapseId: `leave-${data.relatedId}`,
          priority: 9
        };
      } else if (recipientRole === 'warden') {
        return {
          ...basePayload,
          title: data.title || 'Leave Request Update',
          url: `/warden/dashboard/leave-management`,
          collapseId: `leave-${data.relatedId}`,
          priority: 9
        };
      } else if (recipientRole === 'principal') {
        return {
          ...basePayload,
          title: data.title || 'Leave Request Update',
          url: `/principal/dashboard/leave-management`,
          collapseId: `leave-${data.relatedId}`,
          priority: 9
        };
      }
      // Default to student route
      return {
        ...basePayload,
        title: data.title || 'Leave Request Update',
        url: `/student/leave`,
        collapseId: `leave-${data.relatedId}`,
        priority: 9
      };
    
    case 'system':
      return {
        ...basePayload,
        title: data.title || 'System Notification',
        url: data.url || '/student',
        priority: 7
      };
    
    case 'menu':
      return {
        ...basePayload,
        title: data.title || 'Menu Updated',
        url: `/student`,
        collapseId: `menu-${data.relatedId}`,
        priority: 8
      };
    
    case 'foundlost':
      // If recipient is admin, go to admin foundlost page
      if (recipientRole === 'admin' || recipientRole === 'super_admin' || recipientRole === 'sub_admin') {
        return {
          ...basePayload,
          title: data.title || 'Found & Lost Update',
          url: `/admin/dashboard/foundlost`,
          collapseId: `foundlost-${data.relatedId}`,
          priority: 8
        };
      }
      // Default to student route
      return {
        ...basePayload,
        title: data.title || 'Found & Lost Update',
        url: `/student/foundlost`,
        collapseId: `foundlost-${data.relatedId}`,
        priority: 8
      };
    
    default:
      return {
        ...basePayload,
        url: data.url || '/student',
        priority: 8
      };
  }
};

// Test OneSignal connection
export const testOneSignalConnection = async () => {
  try {
    if (!isOneSignalConfigured()) {
      return { success: false, message: 'OneSignal not configured' };
    }

    const response = await axios.get(
      `https://api.onesignal.com/apps/${ONESIGNAL_APP_ID}`,
      {
        headers: {
          'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`
        }
      }
    );

    return { 
      success: true, 
      message: 'OneSignal connection successful',
      app: response.data
    };
  } catch (error) {
    return { 
      success: false, 
      message: 'OneSignal connection failed',
      error: error.response?.data || error.message
    };
  }
}; 