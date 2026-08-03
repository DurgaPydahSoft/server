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
    /** Diesel quantity in litres */
    dieselLitres: {
      type: Number,
      min: 0,
      default: 0
    },
    /** Cost per litre */
    perLitreAmount: {
      type: Number,
      min: 0,
      default: 0
    },
    /**
     * Hostel generator TOTAL for the month (litres × perLitreAmount).
     * Split across eligible hostel students (not a flat per-student add-on).
     */
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
  try {
    // no-op probe
    await collection.indexExists('hostel_1_month_1');
  } catch (_) {
    /* ignore */
  }
  await GeneratorBill.syncIndexes();
  generatorBillIndexesReady = true;
};

export default GeneratorBill;
