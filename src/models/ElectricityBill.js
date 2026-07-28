import mongoose from 'mongoose';

const studentBillSchema = new mongoose.Schema(
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
    electricityAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    generatorAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    nocAdjustment: {
      type: Number,
      min: 0,
      default: 0
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
  },
  { _id: false }
);

const electricityBillSchema = new mongoose.Schema(
  {
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Room',
      required: true,
      index: true
    },
    hostel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hostel',
      index: true
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HostelCategory',
      index: true
    },
    roomNumber: {
      type: String,
      trim: true,
      index: true
    },
    meterType: {
      type: String,
      enum: ['single', 'dual'],
      default: 'single'
    },
    month: {
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format'],
      index: true
    },
    // Single meter
    startUnits: { type: Number, min: 0 },
    endUnits: { type: Number, min: 0 },
    // Dual meter
    meter1StartUnits: { type: Number, min: 0 },
    meter1EndUnits: { type: Number, min: 0 },
    meter1Consumption: { type: Number, min: 0 },
    meter2StartUnits: { type: Number, min: 0 },
    meter2EndUnits: { type: Number, min: 0 },
    meter2Consumption: { type: Number, min: 0 },

    consumption: { type: Number, required: true, min: 0 },
    rate: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },

    totalNOCAdjustment: { type: Number, min: 0, default: 0 },
    remainingAmount: { type: Number, min: 0 },

    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid', 'pending'],
      default: 'unpaid',
      index: true
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment'
    },
    paidAt: { type: Date },
    cashfreeOrderId: {
      type: String,
      default: undefined
    },
    payingStudentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: undefined
    },
    studentBills: [studentBillSchema],

    /** Preserves old Room.electricityBills subdoc _id for Payment.billId continuity */
    legacyEmbeddedId: {
      type: mongoose.Schema.Types.ObjectId,
      default: undefined
    }
  },
  {
    timestamps: true,
    collection: 'electricitybills'
  }
);

electricityBillSchema.index({ room: 1, month: 1 }, { unique: true });
electricityBillSchema.index({ month: 1, paymentStatus: 1 });
electricityBillSchema.index({ hostel: 1, category: 1, month: 1 });
electricityBillSchema.index(
  { cashfreeOrderId: 1 },
  {
    unique: true,
    partialFilterExpression: { cashfreeOrderId: { $type: 'string' } }
  }
);
electricityBillSchema.index(
  { legacyEmbeddedId: 1 },
  {
    unique: true,
    partialFilterExpression: { legacyEmbeddedId: { $exists: true } }
  }
);
electricityBillSchema.index({ 'studentBills.studentId': 1, month: 1 });

/**
 * Resolve a bill by new _id or legacy embedded subdoc id (Payment.billId).
 */
electricityBillSchema.statics.findByBillId = async function findByBillId(billId) {
  if (!billId || !mongoose.Types.ObjectId.isValid(billId)) return null;
  const id = new mongoose.Types.ObjectId(billId);
  return this.findOne({
    $or: [{ _id: id }, { legacyEmbeddedId: id }]
  });
};

/**
 * Latest bill for a room (by month descending).
 */
electricityBillSchema.statics.findLatestForRoom = async function findLatestForRoom(roomId) {
  if (!roomId) return null;
  return this.findOne({ room: roomId }).sort({ month: -1 }).lean();
};

/**
 * Attach lastBill (+ optional electricityBills list) onto room plain objects.
 */
electricityBillSchema.statics.attachBillsToRooms = async function attachBillsToRooms(
  rooms,
  { includeLastBill = false, includeAllBills = false, month = null } = {}
) {
  if (!rooms?.length) return rooms;
  if (!includeLastBill && !includeAllBills && !month) return rooms;

  const roomIds = rooms.map((r) => r._id).filter(Boolean);
  const query = { room: { $in: roomIds } };
  if (month) query.month = month;

  const bills = await this.find(query).sort({ month: -1 }).lean();
  const byRoom = new Map();
  for (const bill of bills) {
    const key = String(bill.room);
    if (!byRoom.has(key)) byRoom.set(key, []);
    byRoom.get(key).push(bill);
  }

  return rooms.map((room) => {
    const list = byRoom.get(String(room._id)) || [];
    const next = { ...room };
    if (includeAllBills || month) {
      next.electricityBills = list;
    }
    if (includeLastBill) {
      next.lastBill = list[0] || null;
    }
    return next;
  });
};

export default mongoose.model('ElectricityBill', electricityBillSchema);
