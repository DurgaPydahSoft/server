/**
 * Create RoomOccupancyHistory rows for students with room allocation but no history record.
 *
 * Usage: node -r dotenv/config src/scripts/backfillRoomOccupancyHistory.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';
import Room from '../models/Room.js';
import RoomOccupancyHistory from '../models/RoomOccupancyHistory.js';
import { enrichStudentAcademics } from '../utils/studentAcademicEnricher.js';

dotenv.config();

const connectDB = async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hostel-management');
  console.log('Connected to MongoDB');
};

const resolveRoomForStudent = async (student) => {
  if (student.room) return student.room;
  if (!student.roomNumber) return null;

  const query = { roomNumber: student.roomNumber };
  if (student.hostel) query.hostel = student.hostel;
  if (student.hostelCategory) query.category = student.hostelCategory;

  const roomDoc = await Room.findOne(query).select('_id').lean();
  return roomDoc?._id || null;
};

const run = async () => {
  const students = await User.find({
    role: 'student',
    roomNumber: { $exists: true, $nin: [null, ''] }
  }).lean();

  console.log(`Checking ${students.length} students with room assignments...`);

  let created = 0;
  let skipped = 0;
  let noRoom = 0;

  for (const doc of students) {
    const existing = await RoomOccupancyHistory.findOne({
      student: doc._id,
      academicYear: doc.academicYear,
      status: { $in: ['Active', 'Extended'] }
    });

    if (existing) {
      skipped += 1;
      continue;
    }

    const roomId = await resolveRoomForStudent(doc);
    if (!roomId) {
      noRoom += 1;
      continue;
    }

    const student = await User.findById(doc._id);
    if (!student) continue;

    if (!student.room) {
      student.room = roomId;
      await student.save();
    }

    const enriched = await enrichStudentAcademics(student.toObject());
    const status = student.hostelStatus === 'Active' ? 'Active' : 'Expired';

    await RoomOccupancyHistory.create({
      student: student._id,
      studentName: student.name,
      rollNumber: student.rollNumber,
      course: enriched.course,
      branch: enriched.branch,
      yearOfStudy: enriched.year,
      academicYear: student.academicYear,
      hostel: student.hostel,
      hostelCategory: student.hostelCategory,
      room: roomId,
      roomNumber: student.roomNumber,
      bedNumber: student.bedNumber,
      lockerNumber: student.lockerNumber,
      allocatedFrom: student.createdAt || new Date(),
      allocatedTo: student.hostelStatus === 'Active' ? null : student.updatedAt,
      status,
      expiryReason: 'registration'
    });

    created += 1;
  }

  console.log('--- Backfill complete ---');
  console.log(`Created: ${created}`);
  console.log(`Skipped (already had history): ${skipped}`);
  console.log(`Skipped (room not resolved): ${noRoom}`);
};

connectDB()
  .then(run)
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  })
  .finally(() => mongoose.disconnect());
