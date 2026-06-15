/**
 * One-time migration: set all inactive hostel students to a target academic year.
 *
 * Usage:
 *   node -r dotenv/config src/scripts/migrateInactiveStudentsAcademicYear.js
 *   node -r dotenv/config src/scripts/migrateInactiveStudentsAcademicYear.js 2025-2026
 */



import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';
import FeeReminder from '../models/FeeReminder.js';
import RoomOccupancyHistory from '../models/RoomOccupancyHistory.js';

dotenv.config();

const TARGET_AY = process.argv[2] || '2025-2026';

const connectDB = async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hostel-management');
  console.log('Connected to MongoDB');
};

const validateAY = (ay) => {
  if (!/^\d{4}-\d{4}$/.test(ay)) return false;
  const [start, end] = ay.split('-').map(Number);
  return end === start + 1;
};

const run = async () => {
  if (!validateAY(TARGET_AY)) {
    console.error(`Invalid academic year: ${TARGET_AY}. Use YYYY-YYYY`);
    process.exit(1);
  }

  console.log(`Migrating inactive students to academic year: ${TARGET_AY}`);

  const inactiveStudents = await User.find({
    role: 'student',
    hostelStatus: 'Inactive'
  }).select('_id rollNumber name academicYear applicationStatus hostelStatus');

  console.log(`Found ${inactiveStudents.length} inactive students`);

  if (inactiveStudents.length === 0) {
    console.log('Nothing to update.');
    return;
  }

  const studentIds = inactiveStudents.map((s) => s._id);
  const alreadyCorrect = inactiveStudents.filter((s) => s.academicYear === TARGET_AY).length;

  const userResult = await User.updateMany(
    { _id: { $in: studentIds } },
    {
      $set: {
        academicYear: TARGET_AY,
        applicationStatus: 'Expired'
      }
    }
  );

  const feeResult = await FeeReminder.updateMany(
    { student: { $in: studentIds } },
    { $set: { academicYear: TARGET_AY } }
  );

  const historyResult = await RoomOccupancyHistory.updateMany(
    { student: { $in: studentIds } },
    { $set: { academicYear: TARGET_AY } }
  );

  console.log('--- Results ---');
  console.log(`Students updated (matched): ${userResult.matchedCount}, modified: ${userResult.modifiedCount}`);
  console.log(`  (already on ${TARGET_AY} before run: ${alreadyCorrect})`);
  console.log(`Fee reminders updated: ${feeResult.modifiedCount}`);
  console.log(`Occupancy history rows updated: ${historyResult.modifiedCount}`);
  console.log('Done.');
};

connectDB()
  .then(run)
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(() => mongoose.disconnect());
