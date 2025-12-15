import mongoose from 'mongoose';

const hostelCategorySchema = new mongoose.Schema({
  hostel: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hostel',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

hostelCategorySchema.index({ hostel: 1, name: 1 }, { unique: true });

const HostelCategory = mongoose.model('HostelCategory', hostelCategorySchema);

export default HostelCategory;

