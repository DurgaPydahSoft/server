import mongoose from 'mongoose';

const hostelSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
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

hostelSchema.index({ name: 1 }, { unique: true });

const Hostel = mongoose.model('Hostel', hostelSchema);

export default Hostel;

