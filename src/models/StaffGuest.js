import mongoose from 'mongoose';

const staffGuestSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['staff', 'guest'],
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

// Ensure virtual fields are serialized
staffGuestSchema.set('toJSON', { virtuals: true });
staffGuestSchema.set('toObject', { virtuals: true });

const StaffGuest = mongoose.model('StaffGuest', staffGuestSchema);

export default StaffGuest;
