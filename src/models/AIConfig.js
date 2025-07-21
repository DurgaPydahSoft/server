import mongoose from 'mongoose';

const aiConfigSchema = new mongoose.Schema({
  isEnabled: {
    type: Boolean,
    default: false
  },
  categories: {
    Canteen: { 
      aiEnabled: { type: Boolean, default: false },
      autoAssign: { type: Boolean, default: false }
    },
    Internet: { 
      aiEnabled: { type: Boolean, default: false },
      autoAssign: { type: Boolean, default: false }
    },
    Maintenance: { 
      aiEnabled: { type: Boolean, default: false },
      autoAssign: { type: Boolean, default: false }
    },
    Others: { 
      aiEnabled: { type: Boolean, default: false },
      autoAssign: { type: Boolean, default: false }
    }
  },
  memberEfficiencyThreshold: {
    type: Number,
    default: 70,
    min: 0,
    max: 100
  },
  autoStatusUpdate: {
    type: Boolean,
    default: true
  },
  maxWorkload: {
    type: Number,
    default: 5 // Maximum complaints a member can handle simultaneously
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

// Ensure only one AI config exists
aiConfigSchema.statics.getConfig = async function() {
  let config = await this.findOne();
  if (!config) {
    config = new this();
    await config.save();
  }
  return config;
};

const AIConfig = mongoose.model('AIConfig', aiConfigSchema);

export default AIConfig; 