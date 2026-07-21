/**
 * READ-ONLY: export the stale "Active" students from past academic years
 * (hostelStatus=Active but no current-year enrollment) for admin review
 * before normalizing their applicationStatus in the Phase 7 migration.
 *
 * Usage: node -r dotenv/config src/scripts/exportStaleActiveStudents.js [--current-ay=2026-2027]
 * Output: stale-active-students.csv in the server folder.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

import User from '../models/User.js';

const ayArg = process.argv.find((a) => a.startsWith('--current-ay='));
const CURRENT_AY = ayArg ? ayArg.split('=')[1] : '2026-2027';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const stale = await User.find({
    role: 'student',
    academicYear: { $ne: CURRENT_AY },
    hostelStatus: 'Active'
  })
    .select('name rollNumber admissionNumber hostelId academicYear course branch year category roomNumber studentPhone parentPhone hostelStatus applicationStatus graduationStatus createdAt')
    .sort({ academicYear: 1, rollNumber: 1 })
    .lean();

  console.log(`Stale Active students (AY != ${CURRENT_AY}): ${stale.length}\n`);

  const esc = (v) => `"${(v ?? '').toString().replace(/"/g, '""')}"`;
  const header = ['Name', 'RollNumber', 'AdmissionNumber', 'HostelID', 'AcademicYear', 'Course', 'Branch', 'Year', 'Category', 'Room', 'StudentPhone', 'ParentPhone', 'hostelStatus', 'applicationStatus', 'graduationStatus', 'RegisteredOn'];
  const rows = stale.map((u) => [
    u.name, u.rollNumber, u.admissionNumber, u.hostelId, u.academicYear,
    u.course, u.branch, u.year, u.category, u.roomNumber,
    u.studentPhone, u.parentPhone, u.hostelStatus, u.applicationStatus || '(none)',
    u.graduationStatus, u.createdAt?.toISOString?.()?.slice(0, 10)
  ].map(esc).join(','));

  fs.writeFileSync('stale-active-students.csv', [header.join(','), ...rows].join('\n'));
  console.log('Wrote stale-active-students.csv');

  stale.forEach((u) => console.log(`  ${u.rollNumber} | ${u.name} | AY=${u.academicYear} | room=${u.roomNumber} | as=${u.applicationStatus || '(none)'}`));

  await mongoose.disconnect();
}

main().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
