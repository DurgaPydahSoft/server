import mongoose from 'mongoose';

/**
 * Singleton settings for electricity billing.
 * feeHeadId references Fees MongoDB `feeheads` (not a local ref).
 */
const electricitySettingsSchema = new mongoose.Schema(
  {
    defaultRate: {
      type: Number,
      required: true,
      min: 0,
      default: 5
    },
    feeHeadId: {
      type: String,
      trim: true,
      default: null
    },
    feeHeadCode: {
      type: String,
      trim: true,
      default: null
    },
    feeHeadName: {
      type: String,
      trim: true,
      default: null
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null
    }
  },
  {
    timestamps: true,
    collection: 'electricitysettings'
  }
);

electricitySettingsSchema.statics.getOrCreate = async function getOrCreate() {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({ defaultRate: 5 });
  }
  return settings;
};

export default mongoose.model('ElectricitySettings', electricitySettingsSchema);
