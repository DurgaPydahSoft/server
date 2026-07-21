import mongoose from 'mongoose';

/** Single lifecycle status per academic-year hostel request */
export const HOSTEL_REQUEST_STATUSES = ['active', 'expired', 'cancelled'];

const hostelRequestSchema = new mongoose.Schema({
  studentMasterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StudentMaster',
    required: true,
    index: true
  },
  admissionNumber: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    index: true
  },
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
  /** Canonical yearly lifecycle status */
  status: {
    type: String,
    enum: HOSTEL_REQUEST_STATUSES,
    default: 'active',
    index: true
  },
  hostelId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hostel',
    required: true,
    index: true
  },
  hostelCategoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'HostelCategory',
    required: true,
    index: true
  },
  roomId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Room',
    required: true,
    index: true
  },
  roomNumber: { type: String, required: true, trim: true },
  bedNumber: { type: String, trim: true },
  lockerNumber: { type: String, trim: true },
  /** Codes used for academic-year sequence generation */
  collegeCode: { type: String, required: true, trim: true, uppercase: true },
  courseCode: { type: String, required: true, trim: true, uppercase: true },
  hostelCode: { type: String, required: true, trim: true, uppercase: true },
  yearlySequenceNumber: { type: Number, required: true, min: 1 },
  hostelSequenceId: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    index: true
  },
  /** SDMS reference / cache — not canonical academic truth */
  sdmsRollNumber: { type: String, trim: true, uppercase: true },
  sdmsName: { type: String, trim: true },
  sdmsGender: {
    type: String,
    enum: ['Male', 'Female'],
    required: false
  },
  sdmsCourse: { type: String, trim: true },
  sdmsBranch: { type: String, trim: true },
  sdmsYearOfStudy: { type: Number, min: 1, max: 10 },
  sdmsBatch: { type: String, trim: true },
  sdmsCollegeName: { type: String, trim: true },
  sdmsSyncedAt: { type: Date },
  mealType: {
    type: String,
    enum: ['veg', 'non-veg'],
    default: 'veg'
  },
  parentPermissionForOuting: {
    type: Boolean,
    default: true
  },
  concession: { type: Number, default: 0, min: 0 },
  allocatedAt: { type: Date, default: Date.now },
  expiredAt: { type: Date },
  cancelledAt: { type: Date },
  statusReason: { type: String, trim: true, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  notes: { type: String, trim: true, default: '' }
}, {
  timestamps: true
});

hostelRequestSchema.index(
  { admissionNumber: 1, academicYear: 1 },
  { unique: true }
);
hostelRequestSchema.index({ academicYear: 1, status: 1 });
hostelRequestSchema.index({ roomId: 1, academicYear: 1, status: 1 });
hostelRequestSchema.index(
  { academicYear: 1, collegeCode: 1, courseCode: 1, hostelCode: 1, yearlySequenceNumber: 1 },
  { unique: true }
);

const HostelRequest = mongoose.model('HostelRequest', hostelRequestSchema);

export default HostelRequest;
