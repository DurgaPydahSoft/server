# OneSignal Backend Integration Setup

## Environment Variables Required

Add these to your backend `.env` file:

```env
# OneSignal Configuration (Backend)
ONESIGNAL_APP_ID=your-onesignal-app-id-here
ONESIGNAL_REST_API_KEY=your-onesignal-rest-api-key-here

# Existing backend variables (keep these)
PORT=5000
MONGODB_URI=your-mongodb-connection-string
JWT_SECRET=your-jwt-secret
# ... other existing variables
```

## What's Been Updated

### 1. **New Services Created:**
- `src/utils/oneSignalService.js` - OneSignal API integration
- `src/utils/hybridNotificationService.js` - Hybrid notification system

### 2. **Updated Controllers:**
- `notificationController.js` - Now uses hybrid service
- `complaintController.js` - Enhanced notification handling
- `announcementController.js` - Enhanced notification handling

### 3. **New Routes:**
- `GET /api/notifications/test-service` - Test notification service status

## How It Works

### **Hybrid Notification Flow:**
1. **Event Triggered** (new complaint, announcement, etc.)
2. **OneSignal First** - Try to send via OneSignal API
3. **Legacy Fallback** - If OneSignal fails, use existing VAPID system
4. **Database Storage** - Store notification in database for in-app display
5. **Real-time Updates** - Socket.IO continues to work for instant updates

### **Notification Types Enhanced:**
- **Complaints**: New complaints, status updates, feedback
- **Announcements**: New announcements to all students
- **Polls**: New polls, ending reminders
- **Leave Requests**: Status updates
- **System**: General system notifications

## Testing the Integration

### 1. **Test Service Status:**
```bash
GET /api/notifications/test-service
```
Returns the status of OneSignal and legacy systems.

### 2. **Test Notifications:**
- Create a new complaint as a student
- Check if admins receive OneSignal notifications
- Update complaint status as admin
- Check if student receives status update notification

### 3. **Test Announcements:**
- Create a new announcement as admin
- Check if all students receive notifications

## Benefits of This Integration

### **For Users:**
- **Better Delivery**: OneSignal's reliable delivery system
- **Rich Notifications**: Images, action buttons, better formatting
- **Cross-platform**: Works on all devices and browsers
- **Offline Support**: Notifications delivered when user comes online

### **For System:**
- **Automatic Fallback**: If OneSignal fails, legacy system takes over
- **Better Analytics**: OneSignal provides detailed delivery analytics
- **Scalability**: OneSignal handles high-volume notification delivery
- **Reliability**: Professional notification infrastructure

## Troubleshooting

### **OneSignal Not Working:**
1. Check environment variables are set correctly
2. Verify OneSignal App ID and REST API Key
3. Check backend logs for OneSignal errors
4. Ensure HTTPS is enabled (required for push notifications)

### **Legacy System Not Working:**
1. Check VAPID keys are configured
2. Verify service worker registration
3. Check browser console for errors

### **Both Systems Not Working:**
1. Check notification permissions
2. Verify all environment variables
3. Check network connectivity
4. Review server logs for errors

## Migration Notes

### **What's Preserved:**
- All existing Socket.IO functionality
- Current notification UI and UX
- Existing API endpoints
- User authentication flow
- Database notification storage

### **What's Enhanced:**
- Push notification delivery reliability
- Rich notification content
- Better error handling
- Automatic fallback mechanisms
- Advanced analytics capabilities

## Next Steps

### **Phase 2 Enhancements (Optional):**
1. Implement OneSignal Journeys for automated workflows
2. Add rich media notifications with images
3. Enable advanced targeting and segmentation
4. Implement A/B testing for notifications

### **Phase 3 Full Migration (Optional):**
1. Replace legacy service worker with OneSignal
2. Migrate to OneSignal's real-time features
3. Implement comprehensive analytics
4. Add multi-channel support (email, SMS)

## Support

For OneSignal-specific issues:
- [OneSignal Documentation](https://documentation.onesignal.com/)
- [OneSignal Support](https://onesignal.com/support)

For application-specific issues:
- Check the server logs for error messages
- Review the notification service logs
- Verify all environment variables are correctly set 