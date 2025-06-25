import mongoose from 'mongoose';

const securitySettingsSchema = new mongoose.Schema({
  viewProfilePictures: {
    type: Boolean,
    default: true
  },
  viewPhoneNumbers: {
    type: Boolean,
    default: true
  },
  viewGuardianImages: {
    type: Boolean,
    default: true
  },
  // Optionally, add updatedBy and updatedAt for audit
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: false
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

const SecuritySettings = mongoose.model('SecuritySettings', securitySettingsSchema);

export default SecuritySettings; 