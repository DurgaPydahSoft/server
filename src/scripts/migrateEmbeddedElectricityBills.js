/**
 * Migrate embedded Room.electricityBills into ElectricityBill collection.
 *
 * Usage:
 *   node src/scripts/migrateEmbeddedElectricityBills.js            # migrate
 *   node src/scripts/migrateEmbeddedElectricityBills.js --dry-run   # report only
 *   node src/scripts/migrateEmbeddedElectricityBills.js --purge-embed  # after verify: unset embeds
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import ElectricityBill from '../models/ElectricityBill.js';

const DRY_RUN = process.argv.includes('--dry-run');
const PURGE_EMBED = process.argv.includes('--purge-embed');

const copyStudentBills = (studentBills = []) =>
  studentBills.map((sb) => {
    const plain = sb.toObject ? sb.toObject() : { ...sb };
    return {
      studentId: plain.studentId,
      studentName: plain.studentName,
      studentRollNumber: plain.studentRollNumber,
      amount: plain.amount,
      nocAdjustment: plain.nocAdjustment || 0,
      paymentStatus: plain.paymentStatus || 'unpaid',
      paymentId: plain.paymentId || undefined,
      paidAt: plain.paidAt || undefined
    };
  });

async function migrate() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/hostel-management';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const roomsCollection = mongoose.connection.db.collection('rooms');

  if (PURGE_EMBED) {
    if (DRY_RUN) {
      const withEmbeds = await roomsCollection.countDocuments({
        'electricityBills.0': { $exists: true }
      });
      console.log(`[dry-run] Would unset electricityBills on ${withEmbeds} rooms`);
      await mongoose.disconnect();
      return;
    }
    const result = await roomsCollection.updateMany(
      { electricityBills: { $exists: true } },
      { $unset: { electricityBills: 1 } }
    );
    console.log(`Purged electricityBills from ${result.modifiedCount} rooms`);
    await mongoose.disconnect();
    return;
  }

  const rooms = await roomsCollection
    .find({ 'electricityBills.0': { $exists: true } })
    .toArray();
  console.log(`Found ${rooms.length} rooms with embedded electricity bills`);

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const room of rooms) {
    for (const bill of room.electricityBills || []) {
      const month = bill.month;
      if (!month) {
        skipped += 1;
        continue;
      }

      const existing = await ElectricityBill.findOne({ room: room._id, month }).lean();
      if (existing) {
        skipped += 1;
        continue;
      }

      const payload = {
        room: room._id,
        hostel: room.hostel,
        category: room.category,
        roomNumber: room.roomNumber,
        meterType: room.meterType || 'single',
        month,
        startUnits: bill.startUnits,
        endUnits: bill.endUnits,
        meter1StartUnits: bill.meter1StartUnits,
        meter1EndUnits: bill.meter1EndUnits,
        meter1Consumption: bill.meter1Consumption,
        meter2StartUnits: bill.meter2StartUnits,
        meter2EndUnits: bill.meter2EndUnits,
        meter2Consumption: bill.meter2Consumption,
        consumption:
          bill.consumption ??
          (bill.meter1Consumption != null && bill.meter2Consumption != null
            ? bill.meter1Consumption + bill.meter2Consumption
            : (bill.endUnits || 0) - (bill.startUnits || 0)),
        rate: bill.rate ?? 0,
        total: bill.total ?? 0,
        totalNOCAdjustment: bill.totalNOCAdjustment || 0,
        remainingAmount: bill.remainingAmount,
        paymentStatus: bill.paymentStatus || 'unpaid',
        paymentId: bill.paymentId || undefined,
        paidAt: bill.paidAt || undefined,
        cashfreeOrderId: bill.cashfreeOrderId || undefined,
        payingStudentId: bill.payingStudentId || undefined,
        studentBills: copyStudentBills(bill.studentBills),
        legacyEmbeddedId: bill._id,
        createdAt: bill.createdAt || new Date()
      };

      if (DRY_RUN) {
        console.log(
          `[dry-run] Would insert room=${room.roomNumber} month=${month} legacyId=${bill._id}`
        );
        inserted += 1;
        continue;
      }

      try {
        await ElectricityBill.create(payload);
        inserted += 1;
      } catch (err) {
        errors += 1;
        console.error(
          `Failed room=${room.roomNumber} month=${month}:`,
          err.message
        );
      }
    }
  }

  console.log(
    `${DRY_RUN ? '[dry-run] ' : ''}Done. inserted=${inserted} skipped=${skipped} errors=${errors}`
  );
  await mongoose.disconnect();
}

migrate().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
