import mongoose from 'mongoose';

const categoryChangeRequestSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    studentMasterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StudentMaster',
      default: null
    },
    hostelRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HostelRequest',
      required: true,
      index: true
    },
    admissionNumber: { type: String, required: true, trim: true, index: true },
    studentName: { type: String, trim: true, default: '' },
    rollNumber: { type: String, trim: true, default: '' },
    academicYear: {
      type: String,
      required: true,
      index: true,
      validate: {
        validator(v) {
          if (!/^\d{4}-\d{4}$/.test(v)) return false;
          const [start, end] = v.split('-').map(Number);
          return end === start + 1;
        },
        message: 'Invalid academic year format (YYYY-YYYY)'
      }
    },

    fromHostel: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel', default: null },
    fromHostelCategory: { type: mongoose.Schema.Types.ObjectId, ref: 'HostelCategory', required: true },
    fromCategoryName: { type: String, trim: true, default: '' },
    fromRoom: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', default: null },
    fromRoomNumber: { type: String, trim: true, default: '' },
    fromBedNumber: { type: String, trim: true, default: '' },
    fromLockerNumber: { type: String, trim: true, default: '' },

    toHostelCategory: { type: mongoose.Schema.Types.ObjectId, ref: 'HostelCategory', required: true },
    toCategoryName: { type: String, trim: true, default: '' },
    toRoom: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', default: null },
    toRoomNumber: { type: String, trim: true, default: '' },
    toBedNumber: { type: String, trim: true, default: '' },
    toLockerNumber: { type: String, trim: true, default: '' },

    /** Fee snapshot at approval time */
    previousTotalFee: { type: Number, default: 0, min: 0 },
    newTotalFee: { type: Number, default: 0, min: 0 },

    effectiveDate: { type: Date, required: true, index: true },

    reason: {
      type: String,
      trim: true,
      default: '',
      maxLength: [500, 'Reason cannot exceed 500 characters']
    },

    status: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected'],
      default: 'Pending',
      index: true
    },

    raisedBy: {
      type: String,
      enum: ['admin', 'warden'],
      required: true
    },
    raisedByAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      required: true
    },
    /** Snapshot of who raised the request (audit trail) */
    raisedByName: { type: String, trim: true, default: '' },
    requestedAt: { type: Date, default: Date.now },

    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    approvedByName: { type: String, trim: true, default: '' },
    approvedAt: { type: Date, default: null },
    approvalRemarks: { type: String, trim: true, default: '', maxLength: 500 },

    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    rejectedByName: { type: String, trim: true, default: '' },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, default: '', maxLength: 500 }
  },
  { timestamps: true }
);

categoryChangeRequestSchema.index({ academicYear: 1, status: 1 });
categoryChangeRequestSchema.index({ student: 1, academicYear: 1 });
categoryChangeRequestSchema.index({ status: 1, requestedAt: -1 });

const CategoryChangeRequest = mongoose.model('CategoryChangeRequest', categoryChangeRequestSchema);
export default CategoryChangeRequest;
