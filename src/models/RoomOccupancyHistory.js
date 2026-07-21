import mongoose from 'mongoose';

const roomOccupancyHistorySchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  studentName: { type: String, trim: true },
  rollNumber: { type: String, trim: true, uppercase: true },
  course: { type: String, trim: true },
  branch: { type: String, trim: true },
  yearOfStudy: { type: Number, min: 1, max: 10 },
  academicYear: {
    type: String,
    required: true,
    index: true,  // Add index for faster academic year queries
    validate: {
      validator(v) {
        if (!/^\d{4}-\d{4}$/.test(v)) return false;
        const [start, end] = v.split('-').map(Number);
        return end === start + 1;
      },
      message: 'Invalid academic year format (YYYY-YYYY)'
    }
  },
  hostel: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel' },
  hostelCategory: { type: mongoose.Schema.Types.ObjectId, ref: 'HostelCategory' },
  room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', index: true },
  roomNumber: { type: String, trim: true },
  bedNumber: { type: String, trim: true },
  lockerNumber: { type: String, trim: true },
  allocatedFrom: { type: Date, required: true, default: Date.now },
  allocatedTo: { type: Date, default: null },
  status: {
    type: String,
    enum: ['Active', 'Expired', 'Withdrawn', 'Extended', 'Transferred'],
    default: 'Active',
    index: true
  },
  expiryReason: {
    type: String,
    enum: ['academic_year_end', 'manual', 'noc', 'admin_inactive', 'registration', 'admin_deleted'],
    default: 'registration'
  },
  notes: { type: String, trim: true, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  /** Link to the yearly HostelRequest that owns allocation (preferred SOT) */
  hostelRequestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'HostelRequest',
    required: false,
    index: true
  }
}, {
  timestamps: true
});

// Compound indexes for optimized queries
roomOccupancyHistorySchema.index({ room: 1, academicYear: 1 });
roomOccupancyHistorySchema.index({ student: 1, academicYear: 1 });
roomOccupancyHistorySchema.index({ academicYear: 1, status: 1 }); // For filtering by year and status
roomOccupancyHistorySchema.index({ academicYear: 1, hostel: 1 }); // For filtering by year and hostel
roomOccupancyHistorySchema.index({ academicYear: 1, roomNumber: 1 }); // For filtering by year and room
roomOccupancyHistorySchema.index({ student: 1, academicYear: 1, status: 1 }); // For student history queries
roomOccupancyHistorySchema.index({ hostelRequestId: 1 });

const RoomOccupancyHistory = mongoose.model(
  'RoomOccupancyHistory',
  roomOccupancyHistorySchema
);

export default RoomOccupancyHistory;
