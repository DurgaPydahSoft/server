import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';
import RoomOccupancyHistory from '../models/RoomOccupancyHistory.js';
import { enrichStudentAcademics } from '../utils/studentAcademicEnricher.js';

dotenv.config();

const connectDB = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/hostel-management';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');
};

const run = async () => {
  const students = await User.find({
    role: 'student',
    'renewalHistory.0': { $exists: true }
  }).lean();

  console.log(`🔍 Found ${students.length} students with renewal history. Checking for missing historical records...`);

  let created = 0;
  let skipped = 0;

  for (const doc of students) {
    const student = await User.findById(doc._id);
    if (!student) continue;

    // Load SQL academics to resolve course/branch
    const enriched = await enrichStudentAcademics(student.toObject());

    for (const renewal of doc.renewalHistory) {
      const targetYear = renewal.previousAcademicYear;
      if (!targetYear) continue;

      const existing = await RoomOccupancyHistory.findOne({
        student: student._id,
        academicYear: targetYear
      });

      if (existing) {
        skipped++;
        continue;
      }

      console.log(`➕ Creating retroactive history for ${student.rollNumber} / ${student.name} for year ${targetYear} (Year ${renewal.previousYear})`);

      await RoomOccupancyHistory.create({
        student: student._id,
        studentName: student.name,
        rollNumber: student.rollNumber,
        course: enriched.course || student.course,
        branch: enriched.branch || student.branch,
        yearOfStudy: renewal.previousYear || Math.max(1, (enriched.year || 2) - 1),
        academicYear: targetYear,
        hostel: student.hostel,
        hostelCategory: student.hostelCategory,
        room: student.room,
        roomNumber: student.roomNumber,
        bedNumber: student.bedNumber,
        lockerNumber: student.lockerNumber,
        allocatedFrom: student.createdAt || new Date(),
        allocatedTo: renewal.renewedAt || new Date(),
        status: 'Expired',
        expiryReason: 'academic_year_end',
        createdBy: renewal.renewedBy || null
      });

      created++;
    }
  }

  console.log('✅ Backfill complete!');
  console.log(`Created: ${created} historical records.`);
  console.log(`Skipped: ${skipped} existing records.`);
};

connectDB()
  .then(run)
  .catch((err) => {
    console.error('❌ Backfill failed:', err);
    process.exit(1);
  })
  .finally(() => mongoose.disconnect());
