import mongoose from 'mongoose';

const academicYearValidator = {
  validator(v) {
    if (!/^\d{4}-\d{4}$/.test(v)) return false;
    const [start, end] = v.split('-').map(Number);
    return end === start + 1;
  },
  message: 'Invalid academic year format (YYYY-YYYY)'
};

const applicationExpiryConfigSchema = new mongoose.Schema({
  academicYear: {
    type: String,
    required: true,
    trim: true,
    validate: academicYearValidator
  },
  courseName: {
    type: String,
    required: true,
    trim: true
  },
  yearOfStudy: {
    type: Number,
    required: true,
    min: 1,
    max: 10
  },
  expiryMonth: {
    type: Number,
    required: true,
    min: 1,
    max: 12
  },
  expiryDay: {
    type: Number,
    required: true,
    min: 1,
    max: 31
  },
  isActive: {
    type: Boolean,
    default: true
  },
  notes: {
    type: String,
    trim: true,
    default: ''
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  }
}, {
  timestamps: true
});

applicationExpiryConfigSchema.index(
  { academicYear: 1, courseName: 1, yearOfStudy: 1 },
  { unique: true }
);

const ApplicationExpiryConfig = mongoose.model(
  'ApplicationExpiryConfig',
  applicationExpiryConfigSchema
);

export default ApplicationExpiryConfig;
