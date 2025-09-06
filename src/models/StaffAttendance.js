import mongoose from 'mongoose';

const staffAttendanceSchema = new mongoose.Schema({
  staffId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StaffGuest',
    required: true
  },
  date: {
    type: Date,
    required: true,
    index: true
  },
  morning: {
    type: Boolean,
    default: false
  },
  evening: {
    type: Boolean,
    default: false
  },
  night: {
    type: Boolean,
    default: false
  },
  notes: {
    type: String,
    default: ''
  },
  takenBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  },
  isOnLeave: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Compound index for efficient queries
staffAttendanceSchema.index({ staffId: 1, date: 1 }, { unique: true });
staffAttendanceSchema.index({ date: 1 });
staffAttendanceSchema.index({ takenBy: 1 });

// Virtual for overall attendance status
staffAttendanceSchema.virtual('status').get(function() {
  if (this.isOnLeave) return 'On Leave';
  if (this.morning && this.evening && this.night) return 'Present';
  if (this.morning || this.evening || this.night) return 'Partial';
  return 'Absent';
});

// Ensure virtual fields are serialized
staffAttendanceSchema.set('toJSON', { virtuals: true });
staffAttendanceSchema.set('toObject', { virtuals: true });

const StaffAttendance = mongoose.model('StaffAttendance', staffAttendanceSchema);

export default StaffAttendance;
