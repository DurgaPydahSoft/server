import mongoose from 'mongoose';
import { getFeesConnection } from '../../config/feesDatabase.js';

const studentFeeSchema = new mongoose.Schema(
  {
    academicYear: { type: String, required: true },
    feeHead: { type: mongoose.Schema.Types.ObjectId, required: true },
    structureId: { type: mongoose.Schema.Types.ObjectId, default: null },
    semester: { type: mongoose.Schema.Types.Mixed, default: null },
    termNumber: { type: Number, default: null },
    studentId: { type: String, required: true, index: true },
    studentYear: { type: Number, required: true },
    amount: { type: Number, required: true, default: 0 },
    branch: { type: String, default: '' },
    college: { type: String, default: '' },
    course: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    remarks: { type: String, default: '' },
    isScholarshipApplicable: { type: Boolean, default: false },
    isTermsDivided: { type: Boolean, default: true },
    stud_type: { type: String, default: 'CONV' },
    studentName: { type: String, default: '' }
  },
  {
    collection: 'studentfees',
    timestamps: true
  }
);

studentFeeSchema.index({ studentId: 1, feeHead: 1, academicYear: 1 }, { unique: true });

let StudentFeeModel = null;

export const getStudentFeeModel = () => {
  const conn = getFeesConnection();
  if (!conn) {
    throw new Error('Fees database is not connected');
  }
  if (!StudentFeeModel) {
    StudentFeeModel = conn.model('StudentFee', studentFeeSchema);
  }
  return StudentFeeModel;
};
