/**
 * Backfill missing consumption/total on ElectricityBill documents.
 * (Previously operated on Room.electricityBills embeds.)
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import ElectricityBill from '../models/ElectricityBill.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel';

const toNum = (val) => {
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
};

const backfillBill = (bill) => {
  let dirty = false;

  const m1Start = toNum(bill.meter1StartUnits);
  const m1End = toNum(bill.meter1EndUnits);
  if (bill.meter1Consumption == null && m1Start != null && m1End != null) {
    bill.meter1Consumption = m1End - m1Start;
    dirty = true;
  }

  const m2Start = toNum(bill.meter2StartUnits);
  const m2End = toNum(bill.meter2EndUnits);
  if (bill.meter2Consumption == null && m2Start != null && m2End != null) {
    bill.meter2Consumption = m2End - m2Start;
    dirty = true;
  }

  const start = toNum(bill.startUnits);
  const end = toNum(bill.endUnits);

  if (bill.consumption == null) {
    if (bill.meter1Consumption != null && bill.meter2Consumption != null) {
      bill.consumption = bill.meter1Consumption + bill.meter2Consumption;
      dirty = true;
    } else if (start != null && end != null) {
      bill.consumption = end - start;
      dirty = true;
    }
  }

  const rate = toNum(bill.rate);
  if ((bill.total == null || bill.total === 0) && bill.consumption != null && rate != null) {
    bill.total = bill.consumption * rate;
    dirty = true;
  }

  return dirty;
};

const run = async () => {
  await mongoose.connect(MONGO_URI);
  console.log('Connected');

  const bills = await ElectricityBill.find({});
  let touched = 0;

  for (const bill of bills) {
    if (backfillBill(bill)) {
      await bill.save();
      touched += 1;
    }
  }

  console.log(`Updated ${touched} / ${bills.length} electricity bills`);
  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
