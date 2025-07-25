import mongoose from 'mongoose';

const attendanceSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Student reference is required'],
    index: true
  },
  date: {
    type: Date,
    required: [true, 'Date is required'],
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
  markedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Marked by reference is required']
  },
  markedAt: {
    type: Date,
    default: Date.now
  },
  notes: {
    type: String,
    trim: true,
    maxLength: 500
  }
}, {
  timestamps: true
});

// Compound index for efficient queries
attendanceSchema.index({ student: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: 1, morning: 1 });
attendanceSchema.index({ date: 1, evening: 1 });
attendanceSchema.index({ date: 1, night: 1 });

// Virtual for attendance status
attendanceSchema.virtual('status').get(function() {
  if (this.morning && this.evening && this.night) return 'Present';
  if (this.morning || this.evening || this.night) return 'Partial';
  return 'Absent';
});

// Virtual for attendance percentage
attendanceSchema.virtual('percentage').get(function() {
  if (this.morning && this.evening && this.night) return 100;
  if (this.morning && this.evening) return 67;
  if (this.morning && this.night) return 67;
  if (this.evening && this.night) return 67;
  if (this.morning || this.evening || this.night) return 33;
  return 0;
});

// Static method to get attendance for a specific date
attendanceSchema.statics.getAttendanceForDate = function(date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  
  return this.find({
    date: { $gte: startOfDay, $lte: endOfDay }
  }).populate('student', 'name rollNumber course branch year gender roomNumber')
    .populate('markedBy', 'name')
    .sort({ 'student.name': 1 });
};

// Static method to get attendance for a student in date range
attendanceSchema.statics.getStudentAttendance = function(studentId, startDate, endDate) {
  return this.find({
    student: studentId,
    date: { $gte: startDate, $lte: endDate }
  }).sort({ date: -1 });
};

// Static method to get attendance statistics for a date
attendanceSchema.statics.getAttendanceStats = function(date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  
  return this.aggregate([
    {
      $match: {
        date: { $gte: startOfDay, $lte: endOfDay }
      }
    },
    {
      $group: {
        _id: null,
        totalStudents: { $sum: 1 },
        morningPresent: { $sum: { $cond: ['$morning', 1, 0] } },
        eveningPresent: { $sum: { $cond: ['$evening', 1, 0] } },
        nightPresent: { $sum: { $cond: ['$night', 1, 0] } },
        fullyPresent: { $sum: { $cond: [{ $and: ['$morning', '$evening', '$night'] }, 1, 0] } },
        partiallyPresent: { $sum: { $cond: [{ $or: ['$morning', '$evening', '$night'] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $and: [{ $not: '$morning' }, { $not: '$evening' }, { $not: '$night' }] }, 1, 0] } }
      }
    }
  ]);
};

// Ensure virtuals are included in JSON output
attendanceSchema.set('toJSON', { virtuals: true });
attendanceSchema.set('toObject', { virtuals: true });

const Attendance = mongoose.model('Attendance', attendanceSchema);

export default Attendance;