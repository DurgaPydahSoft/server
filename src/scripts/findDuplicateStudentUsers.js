/**
 * Find (and optionally fix) duplicate hostel User records that share an admission number.
 *
 * Usage:
 *   npm run find-duplicate-students                              # report all duplicates
 *   npm run find-duplicate-students -- --course=B.Sc             # filter by Mongo/SQL course name
 *   npm run find-duplicate-students -- --fix                     # withdraw stale duplicates
 *   npm run find-duplicate-students -- --course=B.Sc --fix       # fix B.Sc duplicates only
 *
 * Canonical user selection (kept):
 *   - Linked on StudentMaster.userId
 *   - Highest academicYear / currentAcademicYear
 *   - Active HostelRequest for latest year
 *
 * Stale duplicates (--fix):
 *   - applicationStatus → Withdrawn
 *   - hostelStatus → Inactive (legacy field)
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

import User from '../models/User.js';
import StudentMaster from '../models/StudentMaster.js';
import HostelRequest from '../models/HostelRequest.js';
import { normalizeAdmissionNumber } from '../utils/hostelRequestListDto.js';
import { pickCanonicalUser } from '../utils/studentListDedupe.js';
import { enrichStudentsAcademics } from '../utils/studentAcademicEnricher.js';

const args = process.argv.slice(2);
const shouldFix = args.includes('--fix');
const courseArg = args.find((a) => a.startsWith('--course='));
const courseFilter = courseArg ? courseArg.split('=').slice(1).join('=').trim() : '';

const norm = (value) => (value || '').toString().trim().toUpperCase();

const connect = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGODB_URI (or MONGO_URI) is not set in .env');
  }
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');
};

const loadDuplicateGroups = async () => {
  const students = await User.find({ role: 'student', admissionNumber: { $exists: true, $ne: '' } })
    .select(
      'name rollNumber admissionNumber course branch year academicYear applicationStatus hostelStatus createdAt'
    )
    .lean();

  const byAdmission = new Map();
  for (const student of students) {
    const key = normalizeAdmissionNumber(student.admissionNumber);
    if (!key) continue;
    if (!byAdmission.has(key)) byAdmission.set(key, []);
    byAdmission.get(key).push(student);
  }

  return [...byAdmission.entries()].filter(([, users]) => users.length > 1);
};

const filterByCourse = async (groups) => {
  if (!courseFilter) return groups;

  const filtered = [];
  for (const [admission, users] of groups) {
    const enriched = await enrichStudentsAcademics(users, undefined, {
      skipFeesAndConcessions: true
    });
    const matches = enriched.some((u) => norm(u.course) === norm(courseFilter));
    if (matches) {
      filtered.push([admission, enriched]);
    }
  }
  return filtered;
};

const summarizeUser = (user) => ({
  _id: user._id.toString(),
  name: user.name,
  rollNumber: user.rollNumber,
  course: user.course,
  academicYear: user.academicYear,
  applicationStatus: user.applicationStatus,
  createdAt: user.createdAt
});

const run = async () => {
  await connect();

  const duplicateGroups = await filterByCourse(await loadDuplicateGroups());
  if (duplicateGroups.length === 0) {
    console.log(
      courseFilter
        ? `No duplicate admission numbers found for course "${courseFilter}".`
        : 'No duplicate admission numbers found.'
    );
    await mongoose.disconnect();
    return;
  }

  console.log(`\nFound ${duplicateGroups.length} admission number(s) with multiple User records:\n`);

  let staleCount = 0;
  let fixedCount = 0;

  for (const [admission, users] of duplicateGroups) {
    const master = await StudentMaster.findOne({ admissionNumber: admission })
      .select('userId')
      .lean();
    const linkedUserId = master?.userId?.toString() || null;

    const canonical = pickCanonicalUser(users, { linkedUserId });
    const staleUsers = users.filter((u) => String(u._id) !== String(canonical._id));

    const activeRequests = await HostelRequest.find({
      admissionNumber: admission,
      status: 'active'
    })
      .select('academicYear hostelSequenceId status')
      .lean();

    console.log('─'.repeat(72));
    console.log(`Admission: ${admission}`);
    console.log(`StudentMaster.userId: ${linkedUserId || '—'}`);
    console.log(`Active HostelRequests: ${
      activeRequests.length
        ? activeRequests.map((r) => `${r.academicYear} (${r.hostelSequenceId})`).join(', ')
        : '—'
    }`);
    console.log(`KEEP (canonical):`, summarizeUser(canonical));

    for (const stale of staleUsers) {
      staleCount += 1;
      console.log(`STALE:`, summarizeUser(stale));

      if (shouldFix) {
        await User.updateOne(
          { _id: stale._id },
          {
            $set: {
              applicationStatus: 'Withdrawn',
              hostelStatus: 'Inactive'
            }
          }
        );
        fixedCount += 1;
        console.log(`  → marked Withdrawn / Inactive`);
      }
    }

    if (shouldFix && master && linkedUserId && String(canonical._id) !== linkedUserId) {
      await StudentMaster.updateOne(
        { admissionNumber: admission },
        { $set: { userId: canonical._id, rollNumber: canonical.rollNumber } }
      );
      console.log(`  → StudentMaster.userId relinked to canonical ${canonical._id}`);
    }
  }

  console.log('\n' + '─'.repeat(72));
  console.log(`Duplicate groups: ${duplicateGroups.length}`);
  console.log(`Stale user records: ${staleCount}`);
  if (shouldFix) {
    console.log(`Fixed (withdrawn): ${fixedCount}`);
  } else if (staleCount > 0) {
    console.log('Re-run with --fix to withdraw stale duplicate User records.');
  }

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error('Script failed:', err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
