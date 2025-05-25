import mongoose from 'mongoose';

const memberSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters long'],
    maxlength: [50, 'Name cannot exceed 50 characters']
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true,
    match: [/^[0-9]{10}$/, 'Please enter a valid 10-digit phone number'],
    validate: {
      validator: function(v) {
        return /^[0-9]{10}$/.test(v);
      },
      message: props => `${props.value} is not a valid phone number! Must be 10 digits.`
    }
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    trim: true,
    enum: {
      values: ['Canteen', 'Internet', 'Housekeeping', 'Plumbing', 'Electricity', 'Others'],
      message: props => `${props.value} is not a valid category! Must be one of: Canteen, Internet, Housekeeping, Plumbing, Electricity, Others`
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  // Add JSON transform options
  toJSON: {
    virtuals: true,
    transform: (doc, ret) => {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  },
  toObject: {
    virtuals: true,
    transform: (doc, ret) => {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  }
});

// Add index for faster queries
memberSchema.index({ category: 1, name: 1 });

// Ensure at least 2 members per category
memberSchema.pre('findOneAndDelete', async function(next) {
  const member = await this.model.findOne(this.getQuery());
  if (!member) return next();

  const categoryCount = await this.model.countDocuments({ 
    category: member.category,
    isActive: true
  });
  
  if (categoryCount <= 2) {
    next(new Error('Cannot delete member. Minimum 2 members required per category.'));
  } else {
    next();
  }
});

// Add pre-save middleware to validate phone number
memberSchema.pre('save', function(next) {
  if (this.isModified('phone')) {
    if (!/^[0-9]{10}$/.test(this.phone)) {
      next(new Error('Invalid phone number format. Must be 10 digits.'));
    }
  }
  next();
});

const Member = mongoose.model('Member', memberSchema);

export default Member; 1