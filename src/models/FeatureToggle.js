import mongoose from 'mongoose';

const featureToggleSchema = new mongoose.Schema({
  // Overview/Dashboard
  overview: {
    type: Boolean,
    default: true
  },
  // Complaint System
  raiseComplaint: {
    type: Boolean,
    default: true
  },
  myComplaints: {
    type: Boolean,
    default: true
  },
  // Attendance
  attendance: {
    type: Boolean,
    default: true
  },
  // Leave Management
  leave: {
    type: Boolean,
    default: true
  },
  // Found & Lost
  foundLost: {
    type: Boolean,
    default: true
  },
  // Fee Management
  hostelFee: {
    type: Boolean,
    default: true
  },
  // Payment History
  paymentHistory: {
    type: Boolean,
    default: true
  },
  // NOC Requests
  nocRequests: {
    type: Boolean,
    default: true
  },
  // Announcements
  announcements: {
    type: Boolean,
    default: true
  },
  // Polls
  polls: {
    type: Boolean,
    default: true
  },
  // Profile Management
  profile: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Create a single document for feature toggles
featureToggleSchema.statics.getFeatureToggles = async function() {
  let toggles = await this.findOne();
  if (!toggles) {
    // Create default toggles if none exist
    toggles = await this.create({});
  }
  return toggles;
};

// Update feature toggles
featureToggleSchema.statics.updateFeatureToggles = async function(updates) {
  let toggles = await this.findOne();
  if (!toggles) {
    toggles = new this();
  }
  
  Object.assign(toggles, updates);
  await toggles.save();
  return toggles;
};

const FeatureToggle = mongoose.model('FeatureToggle', featureToggleSchema);

export default FeatureToggle; 