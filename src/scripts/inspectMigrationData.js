/**
 * READ-ONLY inspection of existing data ahead of the Phase 7 backfill.
 * Reports the data landscape (Users / RoomOccupancyHistory / Hostels / Courses /
 * NOCs / StudentMaster / HostelRequest) grouped by academic year and status.
 *
 * Usage: node -r dotenv/config src/scripts/inspectMigrationData.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import User from '../models/User.js';
import Hostel from '../models/Hostel.js';
import Course from '../models/Course.js';
import RoomOccupancyHistory from '../models/RoomOccupancyHistory.js';
import StudentMaster from '../models/StudentMaster.js';
import HostelRequest from '../models/HostelRequest.js';
import NOC from '../models/NOC.js';

const line = (t = '') => console.log(t);

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/hostel-management';
  await mongoose.connect(uri);
  line(`Connected (read-only inspection)\n`);

  // ---------- USERS ----------
  const totalStudents = await User.countDocuments({ role: 'student' });
  line(`=== USERS (role=student): ${totalStudents} ===`);

  const byAY = await User.aggregate([
    { $match: { role: 'student' } },
    { $group: { _id: '$academicYear', count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);
  line('\nBy academicYear:');
  byAY.forEach(r => line(`  ${r._id ?? '(none)'}: ${r.count}`));

  const statusCross = await User.aggregate([
    { $match: { role: 'student' } },
    { $group: { _id: { hs: '$hostelStatus', as: '$applicationStatus' }, count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);
  line('\nhostelStatus × applicationStatus:');
  statusCross.forEach(r => line(`  hostelStatus=${r._id.hs ?? '(none)'} | applicationStatus=${r._id.as ?? '(none)'}: ${r.count}`));

  const gradCross = await User.aggregate([
    { $match: { role: 'student' } },
    { $group: { _id: '$graduationStatus', count: { $sum: 1 } } }
  ]);
  line('\ngraduationStatus:');
  gradCross.forEach(r => line(`  ${r._id ?? '(none)'}: ${r.count}`));

  const noAdmission = await User.countDocuments({
    role: 'student',
    $or: [{ admissionNumber: { $exists: false } }, { admissionNumber: null }, { admissionNumber: '' }]
  });
  line(`\nMissing admissionNumber: ${noAdmission}`);

  // Duplicate admission numbers
  const dupAdmissions = await User.aggregate([
    { $match: { role: 'student', admissionNumber: { $nin: [null, ''] } } },
    { $group: { _id: { $toUpper: { $trim: { input: '$admissionNumber' } } }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }
  ]);
  line(`Duplicate admissionNumber values: ${dupAdmissions.length}`);
  dupAdmissions.slice(0, 10).forEach(r => line(`  ${r._id}: ${r.count} users`));

  const allocationStats = await User.aggregate([
    { $match: { role: 'student' } },
    {
      $group: {
        _id: null,
        withHostel: { $sum: { $cond: [{ $ifNull: ['$hostel', false] }, 1, 0] } },
        withCategory: { $sum: { $cond: [{ $ifNull: ['$hostelCategory', false] }, 1, 0] } },
        withRoomRef: { $sum: { $cond: [{ $ifNull: ['$room', false] }, 1, 0] } },
        withRoomNumber: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$roomNumber', ''] } }, 0] }, 1, 0] } },
        withBed: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$bedNumber', ''] } }, 0] }, 1, 0] } },
        withLocker: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$lockerNumber', ''] } }, 0] }, 1, 0] } },
        withHostelId: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$hostelId', ''] } }, 0] }, 1, 0] } },
        withNocDate: { $sum: { $cond: [{ $ifNull: ['$nocDate', false] }, 1, 0] } },
        withExpiryDate: { $sum: { $cond: [{ $ifNull: ['$applicationExpiryDate', false] }, 1, 0] } },
        withCollegeCode: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$college.code', ''] } }, 0] }, 1, 0] } }
      }
    }
  ]);
  line('\nUser allocation/meta field coverage:');
  if (allocationStats[0]) {
    const a = allocationStats[0];
    Object.entries(a).forEach(([k, v]) => { if (k !== '_id') line(`  ${k}: ${v}`); });
  }

  // Users with full allocation (all 4 required refs for HostelRequest)
  const fullyAllocatable = await User.countDocuments({
    role: 'student',
    hostel: { $ne: null },
    hostelCategory: { $ne: null },
    room: { $ne: null },
    roomNumber: { $nin: [null, ''] }
  });
  line(`\nUsers with FULL allocation on User doc (hostel+category+room+roomNumber): ${fullyAllocatable}`);

  // Expiry passed but still Active?
  const now = new Date();
  const expiredButActive = await User.countDocuments({
    role: 'student',
    hostelStatus: 'Active',
    applicationExpiryDate: { $lt: now }
  });
  line(`hostelStatus=Active but applicationExpiryDate already passed: ${expiredButActive}`);

  // ---------- ROOM OCCUPANCY HISTORY ----------
  const historyTotal = await RoomOccupancyHistory.countDocuments({});
  line(`\n=== ROOM OCCUPANCY HISTORY: ${historyTotal} rows ===`);

  const histByAYStatus = await RoomOccupancyHistory.aggregate([
    { $group: { _id: { ay: '$academicYear', status: '$status' }, count: { $sum: 1 } } },
    { $sort: { '_id.ay': 1, '_id.status': 1 } }
  ]);
  line('\nBy academicYear × status:');
  histByAYStatus.forEach(r => line(`  ${r._id.ay ?? '(none)'} | ${r._id.status ?? '(none)'}: ${r.count}`));

  const histByReason = await RoomOccupancyHistory.aggregate([
    { $group: { _id: '$expiryReason', count: { $sum: 1 } } }
  ]);
  line('\nBy expiryReason:');
  histByReason.forEach(r => line(`  ${r._id ?? '(none)'}: ${r.count}`));

  const histMissingAlloc = await RoomOccupancyHistory.countDocuments({
    $or: [{ hostel: null }, { hostelCategory: null }, { room: null }, { roomNumber: { $in: [null, ''] } }]
  });
  line(`\nHistory rows missing hostel/category/room/roomNumber: ${histMissingAlloc}`);

  const histLinked = await RoomOccupancyHistory.countDocuments({ hostelRequestId: { $ne: null } });
  line(`History rows already linked to a HostelRequest: ${histLinked}`);

  // Multiple history rows per student per AY (would violate unique admission+AY)
  const multiPerAY = await RoomOccupancyHistory.aggregate([
    { $group: { _id: { student: '$student', ay: '$academicYear' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $count: 'pairs' }
  ]);
  line(`Student+AY pairs with MULTIPLE history rows: ${multiPerAY[0]?.pairs || 0}`);

  // Distinct students covered by history vs users
  const distinctHistStudents = (await RoomOccupancyHistory.distinct('student')).length;
  line(`Distinct students in history: ${distinctHistStudents}`);

  // ---------- NOC ----------
  const nocApproved = await NOC.countDocuments({ status: 'Approved' });
  const nocTotal = await NOC.countDocuments({});
  line(`\n=== NOC: ${nocTotal} total, ${nocApproved} approved ===`);

  // ---------- HOSTELS ----------
  const hostels = await Hostel.find({}).select('name code active').lean();
  line(`\n=== HOSTELS: ${hostels.length} ===`);
  hostels.forEach(h => line(`  ${h.name}: code=${h.code || '(MISSING)'}`));

  // ---------- COURSES (Mongo legacy) ----------
  const courses = await Course.find({}).select('name code duration').lean();
  line(`\n=== COURSES (Mongo): ${courses.length} ===`);
  courses.forEach(c => line(`  ${c.name}: code=${c.code || '(MISSING)'}`));

  // Distinct course names on users (to check they map to Course docs)
  const userCourses = await User.aggregate([
    { $match: { role: 'student' } },
    { $group: { _id: '$course', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);
  line('\nDistinct User.course values:');
  userCourses.forEach(r => line(`  ${JSON.stringify(r._id)}: ${r.count}`));

  // ---------- EXISTING NEW-ARCH DATA ----------
  const masters = await StudentMaster.countDocuments({});
  const requests = await HostelRequest.countDocuments({});
  line(`\n=== NEW ARCHITECTURE (already created) ===`);
  line(`StudentMaster: ${masters}`);
  line(`HostelRequest: ${requests}`);
  const reqByAYStatus = await HostelRequest.aggregate([
    { $group: { _id: { ay: '$academicYear', status: '$status' }, count: { $sum: 1 } } },
    { $sort: { '_id.ay': 1 } }
  ]);
  reqByAYStatus.forEach(r => line(`  ${r._id.ay} | ${r._id.status}: ${r.count}`));

  // Sample of hostelId formats
  const sampleIds = await User.find({ role: 'student', hostelId: { $nin: [null, ''] } })
    .select('hostelId academicYear').limit(8).lean();
  line('\nSample legacy hostelId values:');
  sampleIds.forEach(s => line(`  ${s.hostelId} (AY ${s.academicYear})`));

  await mongoose.disconnect();
  line('\nDone (no data was modified).');
}

main().catch(async (err) => {
  console.error(err);
  try { await mongoose.disconnect(); } catch (_) { /* ignore */ }
  process.exit(1);
});
