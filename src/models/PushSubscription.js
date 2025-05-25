import mongoose from 'mongoose';

const pushSubscriptionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  endpoint: {
    type: String,
    required: true,
    unique: true
  },
  keys: {
    p256dh: String,
    auth: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Create compound index for faster queries
pushSubscriptionSchema.index({ userId: 1, endpoint: 1 });

const PushSubscription = mongoose.model('PushSubscription', pushSubscriptionSchema);

export default PushSubscription;
