import mongoose from 'mongoose';

const foundLostSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Student reference is required'],
    index: true
  },
  type: {
    type: String,
    required: [true, 'Type is required'],
    enum: {
      values: ['found', 'lost'],
      message: props => `${props.value} is not a valid type. Must be 'found' or 'lost'`
    },
    index: true
  },
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    maxLength: [100, 'Title cannot exceed 100 characters'],
    minLength: [5, 'Title must be at least 5 characters long']
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    trim: true,
    maxLength: [1000, 'Description cannot exceed 1000 characters'],
    minLength: [10, 'Description must be at least 10 characters long']
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    enum: {
      values: ['Electronics', 'Books', 'Clothing', 'Accessories', 'Documents', 'Others'],
      message: props => `${props.value} is not a valid category`
    },
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'active', 'claimed', 'closed', 'rejected'],
    default: 'pending',
    index: true
  },
  claimedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  claimedAt: {
    type: Date,
    default: null
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  adminNotes: {
    type: String,
    trim: true,
    maxLength: [500, 'Admin notes cannot exceed 500 characters']
  }
}, {
  timestamps: true,
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

// Compound indexes for common query patterns
foundLostSchema.index({ type: 1, status: 1 });
foundLostSchema.index({ category: 1, status: 1 });
foundLostSchema.index({ createdAt: -1 }); // For sorting by newest first
foundLostSchema.index({ student: 1, createdAt: -1 }); // For user's posts

// Virtual for post age
foundLostSchema.virtual('age').get(function() {
  return Math.floor((Date.now() - this.createdAt) / (1000 * 60 * 60 * 24)); // Age in days
});

// Virtual for formatted date
foundLostSchema.virtual('formattedDate').get(function() {
  return this.createdAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
});

// Method to claim an item
foundLostSchema.methods.claim = async function(claimedByUserId) {
  this.status = 'claimed';
  this.claimedBy = claimedByUserId;
  this.claimedAt = new Date();
  return await this.save();
};

// Method to close a post
foundLostSchema.methods.close = async function() {
  this.status = 'closed';
  return await this.save();
};

// Static method to find active posts
foundLostSchema.statics.findActive = function() {
  return this.find({ status: 'active' });
};

// Static method to find posts by type
foundLostSchema.statics.findByType = function(type) {
  return this.find({ type, status: 'active' });
};

// Static method to search posts
foundLostSchema.statics.search = function(query) {
  return this.find({
    $and: [
      { status: 'active' },
      {
        $or: [
          { title: { $regex: query, $options: 'i' } },
          { description: { $regex: query, $options: 'i' } },
          { category: { $regex: query, $options: 'i' } }
        ]
      }
    ]
  });
};

const FoundLost = mongoose.model('FoundLost', foundLostSchema);

export default FoundLost; 