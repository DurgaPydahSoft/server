import mongoose from 'mongoose';

const tempStudentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  rollNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true
  },
  studentPhone: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        return /^[0-9]{10}$/.test(v);
      },
      message: props => `${props.value} is not a valid phone number!`
    }
  },
  generatedPassword: {
    type: String,
    required: true
  },
  isFirstLogin: {
    type: Boolean,
    default: true
  },
  mainStudentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  }
}, {
  timestamps: true
});

tempStudentSchema.index({ rollNumber: 1 });
tempStudentSchema.index({ mainStudentId: 1 });

const TempStudent = mongoose.model('TempStudent', tempStudentSchema);

export default TempStudent; 