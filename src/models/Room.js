import mongoose from 'mongoose';

const roomSchema = new mongoose.Schema({
  hostel: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hostel',
    required: [true, 'Hostel is required'],
    index: true
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'HostelCategory',
    required: [true, 'Category is required'],
    index: true
  },
  roomNumber: {
    type: String,
    required: [true, 'Room number is required'],
    trim: true,
    validate: {
      validator: function(v) {
        return /^\d{3}$/.test(v);
      },
      message: props => `${props.value} is not a valid room number! Must be 3 digits.`
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  bedCount: {
    type: Number,
    default: 1,
    min: 1
  },
  meterType: {
    type: String,
    enum: ['single', 'dual'],
    default: 'single'
  }
  // Electricity bills live in ElectricityBill collection (room + month)
}, {
  timestamps: true
});

// Unique per hostel + category + room number
roomSchema.index({ hostel: 1, category: 1, roomNumber: 1 }, { unique: true });
roomSchema.index({ roomNumber: 1 });

// Add virtual for current occupancy
roomSchema.virtual('currentOccupancy').get(function() {
  return this.students ? this.students.length : 0;
});

// Add virtual for available beds
roomSchema.virtual('availableBeds').get(function() {
  return this.bedCount - (this.students ? this.students.length : 0);
});

const Room = mongoose.model('Room', roomSchema);

// Static property for default electricity rate (persisted in ElectricitySettings)
Room.defaultElectricityRate = 5;

Room.setDefaultElectricityRate = function(newRate) {
  Room.defaultElectricityRate = newRate;
};

export default Room;
