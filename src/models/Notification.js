import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['complaint', 'feedback', 'poll', 'announcement', 'poll_ending', 'menu', 'system', 'leave', 'fee_update', 'fee_reminder'],
    required: true
  },
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'recipientModel',
    required: true
  },
  recipientModel: {
    type: String,
    enum: ['User', 'Admin'],
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  mealType: {
    type: String,
    enum: ['breakfast', 'lunch', 'dinner'],
    required: function() {
      return this.type === 'menu';
    }
  },
  url: {
    type: String
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  relatedId: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'onModel'
  },
  onModel: {
    type: String,
    enum: ['Complaint', 'Feedback', 'Poll', 'Announcement', 'Attendance', 'Leave', 'System', 'Menu']
  },
  isRead: {
    type: Boolean,
    default: false
  },
}, {
  timestamps: true
});

// Index for efficient querying
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });

// TTL index: expire documents 15 days after createdAt (1296000 seconds)
// Created asynchronously so it does not block the main event loop
notificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 1296000 }
);

// Static method to create notification
notificationSchema.statics.createNotification = async function(data) {
  const notification = new this(data);
  await notification.save();
  return notification;
};

// Method to mark as read
notificationSchema.methods.markAsRead = async function() {
  this.isRead = true;
  return this.save();
};

const Notification = mongoose.model('Notification', notificationSchema);

// Create TTL index asynchronously when connected so it does not block the main event loop
mongoose.connection.once('connected', () => {
  setImmediate(() => {
    Notification.createIndexes().catch((err) => {
      console.error('Notification TTL index creation failed:', err.message);
    });
  });
});

export default Notification; 