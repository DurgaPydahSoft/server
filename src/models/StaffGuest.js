import mongoose from 'mongoose';

const staffGuestSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['staff', 'guest', 'student'],
    required: true
  },
  gender: {
    type: String,
    enum: ['Male', 'Female', 'Other'],
    required: true
  },
  profession: {
    type: String,
    required: true,
    trim: true
  },
  phoneNumber: {
    type: String,
    required: true,
    trim: true,
    validate: {
      validator: function(v) {
        // Basic phone number validation (10 digits)
        return /^[0-9]{10}$/.test(v);
      },
      message: props => `${props.value} is not a valid phone number! Must be 10 digits.`
    }
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    validate: {
      validator: function(v) {
        if (!v) return true; // Email is optional
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: props => `${props.value} is not a valid email address!`
    }
  },
  department: {
    type: String,
    trim: true
  },
  purpose: {
    type: String,
    trim: true,
    default: ''
  },
  checkinDate: {
    type: Date,
    default: null
  },
  checkoutDate: {
    type: Date,
    default: null
  },
  dailyRate: {
    type: Number,
    default: null // null means use default from settings
  },
  calculatedCharges: {
    type: Number,
    default: 0
  },
  photo: {
    type: String, // URL to the uploaded photo
    default: null
  },
  checkInTime: {
    type: Date,
    default: Date.now
  },
  checkOutTime: {
    type: Date,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  },
  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  }
}, {
  timestamps: true
});

// Index for better query performance
staffGuestSchema.index({ name: 1 });
staffGuestSchema.index({ type: 1 });
staffGuestSchema.index({ phoneNumber: 1 });
staffGuestSchema.index({ isActive: 1 });
staffGuestSchema.index({ createdAt: -1 });

// Virtual for full name with type
staffGuestSchema.virtual('displayName').get(function() {
  return `${this.name} (${this.type.charAt(0).toUpperCase() + this.type.slice(1)})`;
});

// Method to check if currently checked in
staffGuestSchema.methods.isCheckedIn = function() {
  return this.checkInTime && !this.checkOutTime;
};

// Method to get duration of stay
staffGuestSchema.methods.getStayDuration = function() {
  if (!this.checkInTime) return null;
  
  const endTime = this.checkOutTime || new Date();
  const duration = endTime - this.checkInTime;
  
  const hours = Math.floor(duration / (1000 * 60 * 60));
  const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
  
  return `${hours}h ${minutes}m`;
};

// Method to calculate day count between checkin and checkout dates
staffGuestSchema.methods.getDayCount = function() {
  if (!this.checkinDate) return 0;
  
  const startDate = new Date(this.checkinDate);
  const endDate = this.checkoutDate ? new Date(this.checkoutDate) : new Date();
  
  // Set time to start of day for accurate day calculation
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(0, 0, 0, 0);
  
  const timeDiff = endDate.getTime() - startDate.getTime();
  const dayCount = Math.ceil(timeDiff / (1000 * 3600 * 24));
  
  return Math.max(0, dayCount);
};

// Method to calculate charges (for staff and students only)
staffGuestSchema.methods.calculateCharges = function(defaultDailyRate = 0) {
  if (!['staff', 'student'].includes(this.type) || !this.checkinDate) return 0;
  
  const dayCount = this.getDayCount();
  const rateToUse = this.dailyRate !== null ? this.dailyRate : defaultDailyRate;
  return dayCount * rateToUse;
};

// Ensure virtual fields are serialized
staffGuestSchema.set('toJSON', { virtuals: true });
staffGuestSchema.set('toObject', { virtuals: true });

const StaffGuest = mongoose.model('StaffGuest', staffGuestSchema);

export default StaffGuest;
