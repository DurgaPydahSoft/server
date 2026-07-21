import mongoose from 'mongoose';

const hostelSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  /**
   * Short code used in academic-year sequence generation
   * (College Code + Course Code + Hostel Code + sequence).
   */
  code: {
    type: String,
    required: false,
    trim: true,
    uppercase: true,
    sparse: true,
    validate: {
      validator(v) {
        if (!v) return true;
        return /^[A-Z0-9]+$/.test(v);
      },
      message: 'Hostel code must contain only letters and numbers'
    }
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
hostelSchema.index({ code: 1 }, { unique: true, sparse: true });

const Hostel = mongoose.model('Hostel', hostelSchema);

export default Hostel;

