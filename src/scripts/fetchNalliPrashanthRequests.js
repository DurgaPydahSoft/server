/**
 * Fetch HostelRequest rows for a student (admit / joining / left dates + hostel/category).
 *
 * Run from server/:
 *   node src/scripts/fetchNalliPrashanthRequests.js --admission-number=20261563
 *   node src/scripts/fetchNalliPrashanthRequests.js --name="Nalli Prashanth"
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import '../models/Hostel.js';
import '../models/HostelCategory.js';
import HostelRequest from '../models/HostelRequest.js';
import StudentMaster from '../models/StudentMaster.js';
import User from '../models/User.js';

dotenv.config();

const nameArg = process.argv.find((a) => a.startsWith('--name='))?.split('=').slice(1).join('=').trim();
const admissionArg = process.argv
  .find((a) => a.startsWith('--admission-number='))
  ?.split('=')[1]
  ?.trim()
  ?.toUpperCase();

const TARGET_NAME = nameArg || '';
const TARGET_ADMISSION = admissionArg || '';

const fmt = (value) => {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString().slice(0, 10);
};

const run = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI missing in .env');
    process.exit(1);
  }

  if (!TARGET_NAME && !TARGET_ADMISSION) {
    console.error('Pass --admission-number=XXXXXXXX or --name="Student Name"');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Connected.\n');
  console.log(
    `Searching HostelRequests for: ${TARGET_ADMISSION ? `admission ${TARGET_ADMISSION}` : `name "${TARGET_NAME}"`}\n`
  );

  const nameRegex = TARGET_NAME ? new RegExp(TARGET_NAME.replace(/\s+/g, '\\s+'), 'i') : null;

  const masterQuery = TARGET_ADMISSION
    ? { admissionNumber: TARGET_ADMISSION }
    : { name: nameRegex };
  const userQuery = TARGET_ADMISSION
    ? { role: 'student', admissionNumber: TARGET_ADMISSION }
    : { role: 'student', name: nameRegex };

  const [masters, users] = await Promise.all([
    StudentMaster.find(masterQuery).select('_id admissionNumber name rollNumber userId').lean(),
    User.find(userQuery).select('_id admissionNumber name rollNumber hostel category roomNumber bedNumber academicYear').lean()
  ]);

  const masterIds = masters.map((m) => m._id);
  const admissions = [
    ...new Set(
      [...masters, ...users]
        .map((r) => (r.admissionNumber || '').toString().trim().toUpperCase())
        .filter(Boolean)
    )
  ];

  console.log(`StudentMaster matches: ${masters.length}`);
  masters.forEach((m) => {
    console.log(`  - ${m.name} | adm ${m.admissionNumber || '—'} | roll ${m.rollNumber || '—'} | _id ${m._id}`);
  });
  console.log(`User matches: ${users.length}`);
  users.forEach((u) => {
    console.log(`  - ${u.name} | adm ${u.admissionNumber || '—'} | roll ${u.rollNumber || '—'} | _id ${u._id}`);
  });
  console.log('');

  const or = [];
  if (TARGET_ADMISSION) or.push({ admissionNumber: TARGET_ADMISSION });
  if (nameRegex) or.push({ sdmsName: nameRegex });
  if (masterIds.length) or.push({ studentMasterId: { $in: masterIds } });
  if (admissions.length) or.push({ admissionNumber: { $in: admissions } });

  const requests = await HostelRequest.find({ $or: or })
    .populate('hostelId', 'name code')
    .populate('hostelCategoryId', 'name')
    .populate('studentMasterId', 'name admissionNumber rollNumber')
    .sort({ academicYear: 1, createdAt: 1 })
    .lean();

  console.log(`Total HostelRequest rows: ${requests.length}\n`);

  if (!requests.length) {
    console.log('No hostel requests found.');
    await mongoose.disconnect();
    return;
  }

  requests.forEach((r, idx) => {
    const masterName = r.studentMasterId?.name || r.sdmsName || '—';
    const adm = r.admissionNumber || r.studentMasterId?.admissionNumber || '—';
    const hostel = r.hostelId?.name || r.hostelId || '—';
    const category = r.hostelCategoryId?.name || r.hostelCategoryId || '—';

    console.log(`── Request #${idx + 1} ──`);
    console.log(`  _id:              ${r._id}`);
    console.log(`  Name:             ${masterName}`);
    console.log(`  Admission:        ${adm}`);
    console.log(`  Academic Year:    ${r.academicYear}`);
    console.log(`  Request Status:   ${r.status}`);
    console.log(`  Status Reason:    ${r.statusReason || '—'}`);
    console.log(`  Admit Date:       ${fmt(r.admitDate)}`);
    console.log(`  Joining Date:     ${fmt(r.joiningDate)}`);
    console.log(`  Left Date:        ${fmt(r.leftDate)}`);
    console.log(`  Expired At:       ${fmt(r.expiredAt)}`);
    console.log(`  Cancelled At:     ${fmt(r.cancelledAt)}`);
    console.log(`  Hostel / Cat:     ${hostel} / ${category}`);
    console.log(`  Room:             ${r.roomNumber || '—'}`);
    console.log(`  Hostel Seq ID:    ${r.hostelSequenceId || '—'}`);
    console.log('');
  });

  // Compact table summary
  console.log('Summary:');
  console.log(
    'AY'.padEnd(12),
    'Status'.padEnd(12),
    'Admit'.padEnd(12),
    'Joining'.padEnd(12),
    'Left'.padEnd(12),
    'ExpiredAt'.padEnd(12),
    'Adm'
  );
  requests.forEach((r) => {
    console.log(
      String(r.academicYear || '').padEnd(12),
      String(r.status || '').padEnd(12),
      fmt(r.admitDate).padEnd(12),
      fmt(r.joiningDate).padEnd(12),
      fmt(r.leftDate).padEnd(12),
      fmt(r.expiredAt).padEnd(12),
      r.admissionNumber || '—'
    );
  });

  await mongoose.disconnect();
  console.log('\nDone.');
};

run().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
