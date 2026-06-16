/**
 * Manually run the application expiry job once (same logic as the daily ~02:00 IST cron).
 *
 * Expires active students whose configured expiry date (Application Expiry Settings)
 * or manual extension date has passed.
 *
 * Usage:
 *   npm run run-application-expiry
 *   npm run run-application-expiry -- --dry-run
 *   npm run run-application-expiry -- --verbose
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';
import ApplicationExpiryConfig from '../models/ApplicationExpiryConfig.js';
import {
  processDueApplicationExpiries,
  resolveApplicationExpiryDate
} from '../utils/applicationExpiryService.js';
import { enrichStudentAcademics } from '../utils/studentAcademicEnricher.js';

dotenv.config();

const dryRun = process.argv.includes('--dry-run');
const verbose = process.argv.includes('--verbose') || dryRun;

const connectDB = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/hostel-management';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');
};

const formatDate = (date) => {
  if (!date) return 'n/a';
  return date.toISOString().slice(0, 10);
};

const previewDueExpiries = async () => {
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  const configCount = await ApplicationExpiryConfig.countDocuments({ isActive: true });
  console.log(`Active expiry configs in DB: ${configCount}`);

  const activeStudents = await User.find({
    role: 'student',
    hostelStatus: 'Active',
    applicationStatus: { $in: ['Active', 'Extended'] }
  }).select('rollNumber name academicYear applicationStatus applicationExpiryDate');

  console.log(`Active students to check: ${activeStudents.length}\n`);

  const due = [];
  const notDue = [];
  const skippedNoConfig = [];

  for (const student of activeStudents) {
    const enriched = await enrichStudentAcademics(student.toObject());
    const useManual = student.applicationStatus === 'Extended' && student.applicationExpiryDate;
    const expiryDate = await resolveApplicationExpiryDate({
      academicYear: student.academicYear,
      courseName: enriched.course,
      yearOfStudy: enriched.year,
      manualExpiryDate: useManual ? student.applicationExpiryDate : null,
      sqlCourseId: enriched.sqlCourseId || null
    });

    const row = {
      rollNumber: student.rollNumber,
      name: student.name,
      academicYear: student.academicYear,
      course: enriched.course || '—',
      year: enriched.year ?? '—',
      expiryDate: expiryDate ? formatDate(expiryDate) : null,
      status: student.applicationStatus
    };

    if (!expiryDate) {
      skippedNoConfig.push(row);
      continue;
    }

    if (expiryDate <= today) {
      due.push(row);
    } else {
      notDue.push(row);
    }
  }

  if (due.length > 0) {
    console.log(`--- Will expire (${due.length}) ---`);
    due.forEach((s) => {
      console.log(
        `  ${s.rollNumber} | ${s.name} | AY ${s.academicYear} | ${s.course} Y${s.year} | expiry ${s.expiryDate}`
      );
    });
    console.log('');
  } else {
    console.log('No students are due for expiry today.\n');
  }

  if (verbose && notDue.length > 0) {
    console.log(`--- Not yet due (${notDue.length}) ---`);
    notDue.forEach((s) => {
      console.log(
        `  ${s.rollNumber} | ${s.name} | expiry ${s.expiryDate}`
      );
    });
    console.log('');
  }

  if (verbose && skippedNoConfig.length > 0) {
    console.log(`--- Skipped — no expiry config (${skippedNoConfig.length}) ---`);
    skippedNoConfig.forEach((s) => {
      console.log(
        `  ${s.rollNumber} | ${s.name} | AY ${s.academicYear} | ${s.course} Y${s.year}`
      );
    });
    console.log('');
  }

  return {
    processed: activeStudents.length,
    dueCount: due.length,
    skippedNoConfig: skippedNoConfig.length,
    notDue: notDue.length
  };
};

const run = async () => {
  console.log('=== Application Expiry Job (manual run) ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE'}\n`);

  if (dryRun) {
    const preview = await previewDueExpiries();
    console.log('--- Summary ---');
    console.log(`Checked: ${preview.processed}`);
    console.log(`Would expire: ${preview.dueCount}`);
    console.log(`Skipped (no config): ${preview.skippedNoConfig}`);
    console.log(`Not yet due: ${preview.notDue}`);
    console.log('\nDry run complete. Re-run without --dry-run to apply.');
    return;
  }

  const preview = await previewDueExpiries();
  if (preview.dueCount === 0) {
    console.log('Nothing to expire. Exiting.');
    return;
  }

  console.log(`Expiring ${preview.dueCount} student(s)...\n`);
  const result = await processDueApplicationExpiries();

  console.log('\n--- Results ---');
  console.log(`Processed: ${result.processed}`);
  console.log(`Expired: ${result.expired}`);
  console.log(`Skipped (no config): ${result.skippedNoConfig}`);
  console.log('Done.');
};

connectDB()
  .then(run)
  .catch((err) => {
    console.error('Application expiry job failed:', err);
    process.exit(1);
  })
  .finally(() => mongoose.disconnect());
