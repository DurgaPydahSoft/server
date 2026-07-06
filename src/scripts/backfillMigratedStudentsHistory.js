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
  const students = await User.find({ role: 'student' }).lean();
  console.log(`Checking ${students.length} students...`);

  const cutoffDate = new Date('2026-07-31T23:59:59.999Z');
  let created = 0;

  for (const doc of students) {
    const createdDate = new Date(doc.createdAt);
    
    // Only check students registered during or before 2025-2026
    if (createdDate > cutoffDate) continue;

    // Check if they are currently in 2026-2027 but missing 2025-2026 history
    if (doc.academicYear === '2026-2027') {
      const history2526 = await RoomOccupancyHistory.findOne({
        student: doc._id,
        academicYear: '2025-2026'
      });

      if (!history2526) {
        console.log(`➕ Creating missing 2025-2026 history for: ${doc.name} (${doc.rollNumber})`);

        // Find their 2026-2027 history to copy room/bed details if it exists
        const history2627 = await RoomOccupancyHistory.findOne({
          student: doc._id,
          academicYear: '2026-2027'
        }).lean();

        const student = await User.findById(doc._id);
        const enriched = await enrichStudentAcademics(student.toObject());

        const prevYearOfStudy = Math.max(1, (history2627?.yearOfStudy || enriched.year || 2) - 1);

        await RoomOccupancyHistory.create({
          student: doc._id,
          studentName: doc.name,
          rollNumber: doc.rollNumber,
          course: history2627?.course || enriched.course || doc.course,
          branch: history2627?.branch || enriched.branch || doc.branch,
          yearOfStudy: prevYearOfStudy,
          academicYear: '2025-2026',
          hostel: history2627?.hostel || doc.hostel,
          hostelCategory: history2627?.hostelCategory || doc.hostelCategory,
          room: history2627?.room || doc.room,
          roomNumber: history2627?.roomNumber || doc.roomNumber,
          bedNumber: history2627?.bedNumber || doc.bedNumber,
          lockerNumber: history2627?.lockerNumber || doc.lockerNumber,
          allocatedFrom: doc.createdAt || new Date('2025-08-01T00:00:00.000Z'),
          allocatedTo: new Date('2026-06-30T23:59:59.000Z'),
          status: 'Expired',
          expiryReason: 'academic_year_end'
        });

        created++;
      }
    }
  }

  console.log(`✅ Backfill complete! Created ${created} history records.`);
};

connectDB()
  .then(run)
  .catch((err) => {
    console.error('❌ Backfill failed:', err);
    process.exit(1);
  })
  .finally(() => mongoose.disconnect());
