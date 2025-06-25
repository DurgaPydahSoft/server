import mongoose from 'mongoose';

const bulkOutingSchema = new mongoose.Schema({
  // Warden who created the request
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  },
  // Outing details
  outingDate: {
    type: Date,
    required: true
  },
  reason: {
    type: String,
    required: true,
    trim: true
  },
  // Selected students for this outing
  selectedStudents: [{
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    // Individual leave record created for this student
    leaveRecord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Leave'
    }
  }],
  // Filters used to select students
  filters: {
    course: String,
    branch: String,
    gender: String,
    category: String,
    roomNumber: String,
    batch: String,
    academicYear: String,
    hostelStatus: {
      type: String,
      default: 'Active'
    }
  },
  // Status of the bulk request
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending'
  },
  // Admin who approved/rejected
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },
  approvedAt: {
    type: Date
  },
  rejectionReason: {
    type: String,
    trim: true
  },
  // Number of students in this outing
  studentCount: {
    type: Number,
    required: true,
    min: 1
  }
}, {
  timestamps: true
});

// Index for faster queries
bulkOutingSchema.index({ createdBy: 1, status: 1 });
bulkOutingSchema.index({ status: 1, createdAt: -1 });
bulkOutingSchema.index({ outingDate: 1, status: 1 });

const BulkOuting = mongoose.model('BulkOuting', bulkOutingSchema);

export default BulkOuting; 