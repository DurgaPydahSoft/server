import mongoose from 'mongoose';

const roomChangeRequestSchema = new mongoose.Schema(
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
    fromHostelCategory: { type: mongoose.Schema.Types.ObjectId, ref: 'HostelCategory', default: null },
    fromRoom: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', default: null },
    fromRoomNumber: { type: String, trim: true, default: '' },
    fromBedNumber: { type: String, trim: true, default: '' },
    fromLockerNumber: { type: String, trim: true, default: '' },

    toHostel: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel', required: true },
    toHostelCategory: { type: mongoose.Schema.Types.ObjectId, ref: 'HostelCategory', default: null },
    toRoom: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
    toRoomNumber: { type: String, trim: true, required: true },
    toBedNumber: { type: String, trim: true, default: '' },
    toLockerNumber: { type: String, trim: true, default: '' },

    /** Transfer date used for occupancy history + electricity day split */
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
    requestedAt: { type: Date, default: Date.now },

    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    approvedAt: { type: Date, default: null },
    approvalRemarks: { type: String, trim: true, default: '', maxLength: 500 },

    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, default: '', maxLength: 500 }
  },
  { timestamps: true }
);

roomChangeRequestSchema.index({ academicYear: 1, status: 1 });
roomChangeRequestSchema.index({ student: 1, academicYear: 1 });
roomChangeRequestSchema.index({ status: 1, requestedAt: -1 });

const RoomChangeRequest = mongoose.model('RoomChangeRequest', roomChangeRequestSchema);
export default RoomChangeRequest;
