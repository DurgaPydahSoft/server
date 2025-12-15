import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Room from '../models/Room.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel';

const toNum = (val) => {
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
};

const backfillBills = (room) => {
  let touchedBills = 0;

  room.electricityBills = room.electricityBills.map((bill) => {
    let dirty = false;
    const updated = { ...bill.toObject?.() ? bill.toObject() : bill };

    // Meter 1 consumption
    const m1Start = toNum(updated.meter1StartUnits);
    const m1End = toNum(updated.meter1EndUnits);
    if (updated.meter1Consumption == null && m1Start != null && m1End != null) {
      updated.meter1Consumption = m1End - m1Start;
      dirty = true;
    }

    // Meter 2 consumption
    const m2Start = toNum(updated.meter2StartUnits);
    const m2End = toNum(updated.meter2EndUnits);
    if (updated.meter2Consumption == null && m2Start != null && m2End != null) {
      updated.meter2Consumption = m2End - m2Start;
      dirty = true;
    }

    // Single meter consumption fallback
    const start = toNum(updated.startUnits);
    const end = toNum(updated.endUnits);

    if (updated.consumption == null) {
      if (updated.meter1Consumption != null && updated.meter2Consumption != null) {
        updated.consumption = updated.meter1Consumption + updated.meter2Consumption;
        dirty = true;
      } else if (start != null && end != null) {
        updated.consumption = end - start;
        dirty = true;
      }
    }

    // Backfill total if missing and we have rate + consumption
    const rate = toNum(updated.rate);
    if (updated.total == null && rate != null && updated.consumption != null) {
      updated.total = updated.consumption * rate;
      dirty = true;
    }

    if (dirty) {
      touchedBills += 1;
    }
    return updated;
  });

  return touchedBills;
};

async function run() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log(`Connected to MongoDB at ${MONGO_URI}`);

    const rooms = await Room.find({});
    let updatedRooms = 0;
    let updatedBills = 0;

    for (const room of rooms) {
      const touched = backfillBills(room);
      if (touched > 0) {
        await room.save();
        updatedRooms += 1;
        updatedBills += touched;
        console.log(`Updated room ${room._id} (${room.roomNumber}) with ${touched} bill(s)`);
      }
    }

    console.log(`Backfill complete. Rooms updated: ${updatedRooms}, Bills updated: ${updatedBills}`);
  } catch (err) {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

run();

