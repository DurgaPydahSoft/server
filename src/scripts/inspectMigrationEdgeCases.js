/** READ-ONLY: drill into edge cases found by inspectMigrationData.js */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import User from '../models/User.js';
import RoomOccupancyHistory from '../models/RoomOccupancyHistory.js';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  // 1. The user with applicationStatus 'Inactive' (invalid per enum)
  const invalidStatus = await User.find({ role: 'student', applicationStatus: { $nin: ['Active', 'Expired', 'Extended', 'Withdrawn', null] } })
    .select('name rollNumber admissionNumber academicYear hostelStatus applicationStatus').lean();
  console.log('Users with non-enum applicationStatus:', JSON.stringify(invalidStatus, null, 2));

  // 2. Users missing admissionNumber — who are they?
  const noAdm = await User.find({
    role: 'student',
    $or: [{ admissionNumber: { $exists: false } }, { admissionNumber: null }, { admissionNumber: '' }]
  }).select('name rollNumber academicYear hostelStatus applicationStatus graduationStatus createdAt').lean();
  console.log(`\nUsers missing admissionNumber (${noAdm.length}):`);
  noAdm.forEach(u => console.log(`  ${u.rollNumber} | ${u.name} | AY=${u.academicYear} | hs=${u.hostelStatus} | as=${u.applicationStatus} | grad=${u.graduationStatus}`));

  // 3. The student+AY pair with multiple history rows
  const multi = await RoomOccupancyHistory.aggregate([
    { $group: { _id: { student: '$student', ay: '$academicYear' }, count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } }
  ]);
  for (const m of multi) {
    const user = await User.findById(m._id.student).select('name rollNumber admissionNumber').lean();
    const rows = await RoomOccupancyHistory.find({ _id: { $in: m.ids } })
      .select('academicYear status expiryReason roomNumber bedNumber allocatedFrom allocatedTo').lean();
    console.log(`\nMultiple history rows: ${user?.rollNumber} (${user?.name}) AY=${m._id.ay}`);
    rows.forEach(r => console.log(`  status=${r.status} reason=${r.expiryReason} room=${r.roomNumber} bed=${r.bedNumber} from=${r.allocatedFrom?.toISOString?.()} to=${r.allocatedTo?.toISOString?.() || '-'}`));
  }

  // 4. Users whose roomNumber is missing (3 users)
  const noRoom = await User.find({ role: 'student', $or: [{ roomNumber: null }, { roomNumber: '' }] })
    .select('name rollNumber admissionNumber academicYear hostelStatus applicationStatus').lean();
  console.log(`\nUsers missing roomNumber (${noRoom.length}):`);
  noRoom.forEach(u => console.log(`  ${u.rollNumber} | ${u.name} | AY=${u.academicYear} | hs=${u.hostelStatus} | as=${u.applicationStatus}`));

  // 5. Cross-check: 2026-2027 users vs history — how many current-AY users have a history row?
  const usersAY = await User.find({ role: 'student', academicYear: '2026-2027' }).select('_id').lean();
  const ids = usersAY.map(u => u._id);
  const withHist = (await RoomOccupancyHistory.distinct('student', { student: { $in: ids }, academicYear: '2026-2027' })).length;
  console.log(`\n2026-2027 users: ${ids.length}, of which have a 2026-2027 history row: ${withHist}`);

  // 6. Users AY=2025-2026 but hostelStatus Active (stale active from old year?)
  const staleActive = await User.countDocuments({ role: 'student', academicYear: '2025-2026', hostelStatus: 'Active' });
  console.log(`Users with academicYear=2025-2026 AND hostelStatus=Active: ${staleActive}`);

  // 7. applicationStatus missing entirely
  const noAppStatus = await User.aggregate([
    { $match: { role: 'student', applicationStatus: { $in: [null, undefined] } } },
    { $group: { _id: { ay: '$academicYear', hs: '$hostelStatus' }, count: { $sum: 1 } } }
  ]);
  console.log('\nUsers with NO applicationStatus by AY × hostelStatus:');
  noAppStatus.forEach(r => console.log(`  AY=${r._id.ay} hs=${r._id.hs}: ${r.count}`));

  // 8. NOC users — do their User docs reflect it?
  const nocUsers = await User.find({ role: 'student', nocDate: { $ne: null } })
    .select('name rollNumber academicYear hostelStatus applicationStatus nocDate').lean();
  console.log(`\nUsers with nocDate (${nocUsers.length}):`);
  nocUsers.forEach(u => console.log(`  ${u.rollNumber} | AY=${u.academicYear} | hs=${u.hostelStatus} | as=${u.applicationStatus} | noc=${u.nocDate?.toISOString?.()}`));

  await mongoose.disconnect();
  console.log('\nDone (read-only).');
}

main().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
