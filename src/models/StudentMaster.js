import mongoose from 'mongoose';

/**
 * Minimal persistent student identity for the hostel system.
 * Academic data is sourced from SDMS at read/request time — not stored as canonical truth here.
 */
const studentMasterSchema = new mongoose.Schema({
  admissionNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
    index: true
  },
  /** Optional link to legacy User document used for student login */
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    sparse: true,
    index: true
  },
  name: {
    type: String,
    trim: true
  },
  rollNumber: {
    type: String,
    trim: true,
    uppercase: true,
    sparse: true,
    index: true
  },
  studentPhone: { type: String, trim: true },
  parentPhone: { type: String, trim: true },
  motherName: { type: String, trim: true },
  motherPhone: { type: String, trim: true },
  localGuardianName: { type: String, trim: true },
  localGuardianPhone: { type: String, trim: true },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  studentPhoto: { type: String },
  guardianPhoto1: { type: String },
  guardianPhoto2: { type: String },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },
  lastSdmsSyncAt: {
    type: Date
  }
}, {
  timestamps: true
});

studentMasterSchema.index({ admissionNumber: 1 }, { unique: true });

const StudentMaster = mongoose.model('StudentMaster', studentMasterSchema);

export default StudentMaster;
