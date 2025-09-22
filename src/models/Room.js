import mongoose from 'mongoose';

const roomSchema = new mongoose.Schema({
  gender: {
    type: String,
    enum: ['Male', 'Female'],
    required: [true, 'Gender is required'],
    index: true
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    validate: {
      validator: function(v) {
        const validCategories = this.gender === 'Male' 
          ? ['A+', 'A', 'B+', 'B']
          : ['A+', 'A', 'B', 'C'];
        return validCategories.includes(v);
      },
      message: props => `${props.value} is not a valid category for ${this.gender}`
    },
    index: true
  },
  roomNumber: {
    type: String,
    required: [true, 'Room number is required'],
    unique: true,
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
  electricityBills: [
    {
      month: {
        type: String,
        required: true,
        match: [/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format']
      },
      startUnits: {
        type: Number,
        required: true,
        min: 0
      },
      endUnits: {
        type: Number,
        required: true,
        min: 0
      },
      consumption: {
        type: Number,
        required: true,
        min: 0
      },
      rate: {
        type: Number,
        required: true,
        min: 0
      },
      total: {
        type: Number,
        required: true,
        min: 0
      },
      paymentStatus: {
        type: String,
        enum: ['unpaid', 'paid', 'pending'],
        default: 'unpaid'
      },
      paymentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Payment'
      },
      paidAt: {
        type: Date
      },
      cashfreeOrderId: {
        type: String,
        default: null
      },
      // Student-specific bill breakdown
      studentBills: [
        {
          studentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
          },
          studentName: {
            type: String,
            required: true
          },
          studentRollNumber: {
            type: String,
            required: true
          },
          amount: {
            type: Number,
            required: true,
            min: 0
          },
          paymentStatus: {
            type: String,
            enum: ['unpaid', 'paid', 'pending'],
            default: 'unpaid'
          },
          paymentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Payment'
          },
          paidAt: {
            type: Date
          }
        }
      ],
      createdAt: {
        type: Date,
        default: Date.now
      }
    }
  ]
}, {
  timestamps: true
});

// Add compound index for gender and category
roomSchema.index({ gender: 1, category: 1 });

// Add index for room number
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

// Static property for default electricity rate
Room.defaultElectricityRate = 5;

// Static method to update the default rate
Room.setDefaultElectricityRate = function(newRate) {
  Room.defaultElectricityRate = newRate;
};

export default Room; 