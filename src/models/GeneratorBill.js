import mongoose from 'mongoose';

const generatorBillSchema = new mongoose.Schema(
  {
    hostel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hostel',
      required: true,
      index: true
    },
    month: {
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format'],
      index: true
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
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
    collection: 'generatorbills'
  }
);

generatorBillSchema.index({ hostel: 1, month: 1 }, { unique: true });

const GeneratorBill = mongoose.model('GeneratorBill', generatorBillSchema);

let generatorBillIndexesReady = false;

export const ensureGeneratorBillIndexes = async () => {
  if (generatorBillIndexesReady) return;
  await GeneratorBill.createCollection().catch(() => {});
  const collection = GeneratorBill.collection;
  const indexes = await collection.indexes();
  const hasLegacyMonthIndex = indexes.some((idx) => idx.name === 'month_1');
  if (hasLegacyMonthIndex) {
    await collection.dropIndex('month_1');
  }
  await GeneratorBill.syncIndexes();
  generatorBillIndexesReady = true;
};

export default GeneratorBill;
