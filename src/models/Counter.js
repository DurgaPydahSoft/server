import mongoose from 'mongoose';

const counterSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true
  },
  sequence: {
    type: Number,
    default: 1
  }
}, {
  timestamps: true
});

// No need to create index on _id as MongoDB creates it automatically

const Counter = mongoose.model('Counter', counterSchema);

export default Counter; 