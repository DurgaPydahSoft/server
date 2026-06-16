/**
 * backfillExpireStudentsByAcademicCalendar.js
 *
 * One-time backfill script to expire students whose academic-year end date
 * has already passed — using the new SQL semesters-based expiry resolution.
 *
 * Checks ALL students (active AND already-inactive) for a given academic year.
 * For inactive students, resolves their expiry date and flags those who were
 * expired without any configured date.
 *
 * KEY FIX: Before this implementation, student year fields were already
 * updated via annual renewal. So `enriched.year` reflects the student's
 * CURRENT year (e.g. Year 2 in 2026-2027), not the year they were in
 * during the target academic year.
 *
 * This script computes the CORRECT year of study for the TARGET academic
 * year using the student's batch:
 *
 *   yearOfStudy = startYear(academicYear) - batchStartYear + 1
 *
 *   Examples:
 *     batch = "2024", academicYear = "2024-2025" → Y1 (2024 - 2024 + 1)
 *     batch = "2024", academicYear = "2025-2026" → Y2 (2025 - 2024 + 1)
 *     batch = "2023", academicYear = "2025-2026" → Y3 (2025 - 2023 + 1)
 *
 * Priority chain used (same as production):
 *   1. Per-student manual extension (applicationStatus=Extended + applicationExpiryDate)
 *   2. ApplicationExpiryConfig manual override (admin config in MongoDB)
 *   3. SQL semesters → Semester 2 end_date for course + year_of_study + academic_year
 *   4. No config → skip (never force-expire without a known date)
 *
 * Usage:
 *   node -r dotenv/config src/scripts/backfillExpireStudentsByAcademicCalendar.js --dry-run
 *   node -r dotenv/config src/scripts/backfillExpireStudentsByAcademicCalendar.js --dry-run --verbose
 *   node -r dotenv/config src/scripts/backfillExpireStudentsByAcademicCalendar.js --academic-year=2024-2025 --dry-run
 *   node -r dotenv/config src/scripts/backfillExpireStudentsByAcademicCalendar.js
 *
 * Flags:
 *   --dry-run           Preview only — no DB writes. ALWAYS run this first.
 *   --verbose           Show all student buckets including inactive details.
 *   --academic-year=X   Restrict to a specific academic year (e.g. 2024-2025).
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';
import RoomOccupancyHistory from '../models/RoomOccupancyHistory.js';
import FeeReminder from '../models/FeeReminder.js';
import {
  resolveApplicationExpiryDate,
  expireStudentApplication
} from '../utils/applicationExpiryService.js';
import { enrichStudentsAcademics } from '../utils/studentAcademicEnricher.js';
import { getBatchStartYear } from '../utils/batchUtils.js';

dotenv.config();

// ─── CLI flags ───────────────────────────────────────────────────────────────
const dryRun   = process.argv.includes('--dry-run');
const verbose  = process.argv.includes('--verbose') || dryRun;
const ayFlag   = process.argv.find((a) => a.startsWith('--academic-year='));
const filterAY = ayFlag ? ayFlag.split('=')[1].trim() : null;

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (date) => (date ? new Date(date).toISOString().slice(0, 10) : 'n/a');

const connectDB = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/hostel-management';
  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');
};

/**
 * Derive what year of study a student was in during a specific academic year.
 * Uses batch (admission start year) + academicYear string.
 * Returns null if batch or academicYear are missing/invalid.
 */
const computeYearOfStudyForAY = (batch, academicYear) => {
  const batchStart = getBatchStartYear(batch);
  if (!batchStart || !academicYear) return null;

  const match = academicYear.match(/^(\d{4})-\d{4}$/);
  if (!match) return null;

  const ayStartYear = parseInt(match[1], 10);
  const yearOfStudy = ayStartYear - batchStart + 1;

  if (yearOfStudy < 1 || yearOfStudy > 10) return null;
  return yearOfStudy;
};

// ─── Core logic ───────────────────────────────────────────────────────────────
const run = async () => {
  console.log('='.repeat(64));
  console.log('  Backfill: Expire Students by Academic Calendar (SQL)');
  console.log('='.repeat(64));
  console.log(`Mode         : ${dryRun ? '🔍 DRY RUN — no writes' : '🚨 LIVE — will write to DB'}`);
  console.log(`Academic Year: ${filterAY || 'ALL'}`);
  console.log(`Verbose      : ${verbose}`);
  console.log('');

  if (!dryRun) {
    console.log('⚠️  LIVE mode. Starting in 3 seconds... Ctrl+C to abort.');
    await new Promise((r) => setTimeout(r, 3000));
  }

  // ── 1. Fetch ALL students (active AND inactive) ─────────────────────────────
  const query = { role: 'student' };
  if (filterAY) query.academicYear = filterAY;

  const allStudents = await User.find(query)
    .select('rollNumber admissionNumber name academicYear batch hostelStatus applicationStatus applicationExpiryDate')
    .lean();

  console.log(`Total students to check: ${allStudents.length}\n`);
  if (allStudents.length === 0) {
    console.log('Nothing to process. Exiting.');
    return;
  }

  // ── 2. Batch-enrich from SQL (gets course, sqlCourseId, batch etc.) ─────────
  console.log('🔄 Enriching students from SQL (batch)...');
  const enriched = await enrichStudentsAcademics(allStudents);
  console.log('✅ Enrichment complete.\n');

  // ── 3. Categorise each student ──────────────────────────────────────────────
  const today = new Date();
  today.setUTCHours(23, 59, 59, 999);

  const due             = [];  // Active  + expiryDate <= today → will be expired
  const notYetDue       = [];  // Active  + expiryDate > today  → still valid
  const noConfig        = [];  // Active  + no expiry date resolved → skip
  const badBatch        = [];  // Active  + batch missing/invalid → skip
  const inactiveWithDate= [];  // Inactive + has a resolved expiry date that is already passed (correctly expired)
  const inactiveNoDate  = [];  // Inactive + NO expiry date → were expired without config ⚠️
  const inactiveToReactivate = []; // Inactive + expiryDate > today → prematurely expired, needs reactivation ⚠️
  const inactiveStatusToFix = []; // Inactive + applicationStatus !== 'Expired' (and not being reactivated)

  for (let i = 0; i < enriched.length; i++) {
    const student = allStudents[i];   // original doc fields
    const enc     = enriched[i];      // SQL-enriched fields

    const targetAY = student.academicYear;
    const batch    = enc.batch || student.batch;

    // ── Compute batch-derived year for the target academic year ─────────────
    const computedYear = computeYearOfStudyForAY(batch, targetAY);

    // ── INACTIVE students — resolve expiry date and report only ─────────────
    if (student.hostelStatus === 'Inactive') {
      const useManual = student.applicationStatus === 'Extended' && student.applicationExpiryDate;

      let inactiveExpiry = null;
      if (computedYear) {
        try {
          inactiveExpiry = await resolveApplicationExpiryDate({
            academicYear    : targetAY,
            courseName      : enc.course,
            yearOfStudy     : computedYear,
            manualExpiryDate: useManual ? student.applicationExpiryDate : null,
            sqlCourseId     : enc.sqlCourseId || null
          });
        } catch (_) { /* treat as no date */ }
      }

      const inactiveRow = {
        _id         : student._id,
        rollNumber  : student.rollNumber || enc.rollNumber || '—',
        name        : student.name,
        academicYear: targetAY,
        course      : enc.course    || '—',
        batch       : batch         || '—',
        computedYear: computedYear  ?? '—',
        expiryDate  : inactiveExpiry ? fmt(inactiveExpiry) : null,
        appStatus   : student.applicationStatus || 'null',
        source      : useManual       ? 'manual_extension'
                    : enc.sqlCourseId ? 'sql_calendar'
                    : 'manual_config'
      };

      if (inactiveExpiry) {
        if (inactiveExpiry > today) {
          inactiveToReactivate.push(inactiveRow);
        } else {
          inactiveWithDate.push(inactiveRow);
          if (student.applicationStatus !== 'Expired') {
            inactiveStatusToFix.push(inactiveRow);
          }
        }
      } else {
        inactiveNoDate.push(inactiveRow);
        if (student.applicationStatus !== 'Expired') {
          inactiveStatusToFix.push(inactiveRow);
        }
      }
      continue;
    }

    // ── ACTIVE students — categorise for expiry ─────────────────────────────
    if (!computedYear) {
      badBatch.push({
        rollNumber  : student.rollNumber || enc.rollNumber || '—',
        name        : student.name,
        academicYear: targetAY,
        batch       : batch    || 'MISSING',
        course      : enc.course || '—',
        currentYear : enc.year ?? '—'
      });
      continue;
    }

    const useManual = student.applicationStatus === 'Extended' && student.applicationExpiryDate;

    let expiryDate;
    try {
      expiryDate = await resolveApplicationExpiryDate({
        academicYear    : targetAY,
        courseName      : enc.course,
        yearOfStudy     : computedYear,
        manualExpiryDate: useManual ? student.applicationExpiryDate : null,
        sqlCourseId     : enc.sqlCourseId || null
      });
    } catch (err) {
      console.error(`  ⚠️  Error resolving expiry for ${student.rollNumber}:`, err.message);
      noConfig.push({
        rollNumber  : student.rollNumber || enc.rollNumber || '—',
        name        : student.name,
        academicYear: targetAY,
        course      : enc.course || '—',
        year        : computedYear,
        sqlCourseId : enc.sqlCourseId ?? null
      });
      continue;
    }

    const source = useManual       ? 'manual_extension'
                 : enc.sqlCourseId ? 'sql_calendar'
                 : 'manual_config';

    const row = {
      _id         : student._id,
      rollNumber  : student.rollNumber || enc.rollNumber || '—',
      name        : student.name,
      academicYear: targetAY,
      course      : enc.course    || '—',
      batch       : batch         || '—',
      currentYear : enc.year      ?? '—',  // year after renewal (info only)
      computedYear,                         // year during targetAY (used for SQL)
      sqlCourseId : enc.sqlCourseId ?? null,
      expiryDate  : expiryDate ? fmt(expiryDate) : null,
      status      : student.applicationStatus,
      source
    };

    if (!expiryDate) {
      noConfig.push(row);
    } else if (expiryDate <= today) {
      due.push({ ...row, expiryDateObj: expiryDate });
    } else {
      notYetDue.push(row);
    }
  }

  // ── 4. Print preview ────────────────────────────────────────────────────────
  console.log('─'.repeat(64));
  console.log('📋 SUMMARY');
  console.log('─'.repeat(64));
  console.log(`  [ACTIVE]  Will expire              : ${due.length}`);
  console.log(`  [ACTIVE]  Not yet due              : ${notYetDue.length}`);
  console.log(`  [ACTIVE]  No config / skip         : ${noConfig.length}`);
  console.log(`  [ACTIVE]  Bad batch / skip         : ${badBatch.length}`);
  console.log(`  [INACTIVE] With resolved expiry    : ${inactiveWithDate.length}`);
  console.log(`  [INACTIVE] NO expiry date ⚠️        : ${inactiveNoDate.length}`);
  console.log(`  [INACTIVE] Prematurely expired ⚠️  : ${inactiveToReactivate.length}  ← will be REACTIVATED`);
  console.log(`  [INACTIVE] Incorrect appStatus ⚠️  : ${inactiveStatusToFix.length}  ← will be updated to 'Expired'`);
  console.log(`  Total checked                      : ${allStudents.length}`);
  console.log('');

  // ── Active: due for expiry ──────────────────────────────────────────────────
  if (due.length > 0) {
    console.log(`─── 🚨 [ACTIVE] DUE FOR EXPIRY (${due.length}) ───`);
    due.forEach((s) => {
      console.log(
        `  ${String(s.rollNumber).padEnd(15)} | ${String(s.name).padEnd(30)}` +
        ` | AY ${s.academicYear} | batch ${s.batch} → Y${s.computedYear} (now Y${s.currentYear})` +
        ` | ${s.course} | expiry ${s.expiryDate} | src:${s.source}`
      );
    });
    console.log('');
  } else {
    console.log('No active students are due for expiry.\n');
  }

  // ── Active: not yet due ─────────────────────────────────────────────────────
  if (verbose && notYetDue.length > 0) {
    console.log(`─── ✅ [ACTIVE] NOT YET DUE (${notYetDue.length}) ───`);
    notYetDue.forEach((s) => {
      console.log(
        `  ${String(s.rollNumber).padEnd(15)} | ${String(s.name).padEnd(30)}` +
        ` | batch ${s.batch} → Y${s.computedYear} | expiry ${s.expiryDate} | src:${s.source}`
      );
    });
    console.log('');
  }

  // ── Active: no config ───────────────────────────────────────────────────────
  if (verbose && noConfig.length > 0) {
    console.log(`─── ⏭️  [ACTIVE] SKIPPED — NO EXPIRY CONFIG (${noConfig.length}) ───`);
    noConfig.forEach((s) => {
      console.log(
        `  ${String(s.rollNumber).padEnd(15)} | ${String(s.name).padEnd(30)}` +
        ` | AY ${s.academicYear} | ${s.course} Y${s.computedYear ?? '?'} | sqlCourseId:${s.sqlCourseId ?? 'none'}`
      );
    });
    console.log('');
  }

  // ── Active: bad batch ───────────────────────────────────────────────────────
  if (verbose && badBatch.length > 0) {
    console.log(`─── ⚠️  [ACTIVE] SKIPPED — MISSING/INVALID BATCH (${badBatch.length}) ───`);
    badBatch.forEach((s) => {
      console.log(
        `  ${String(s.rollNumber).padEnd(15)} | ${String(s.name).padEnd(30)}` +
        ` | AY ${s.academicYear} | batch:"${s.batch}" | ${s.course}`
      );
    });
    console.log('');
  }

  // ── Inactive: has resolved expiry date ──────────────────────────────────────
  if (verbose && inactiveWithDate.length > 0) {
    console.log(`─── 💤 [INACTIVE] HAS EXPIRY DATE (${inactiveWithDate.length}) ───`);
    inactiveWithDate.forEach((s) => {
      console.log(
        `  ${String(s.rollNumber).padEnd(15)} | ${String(s.name).padEnd(30)}` +
        ` | AY ${s.academicYear} | batch ${s.batch} → Y${s.computedYear} | ${s.course}` +
        ` | expiry ${s.expiryDate} | src:${s.source}`
      );
    });
    console.log('');
  }

  // ── Inactive: NO expiry date (always shown, not just verbose) ───────────────
  if (inactiveNoDate.length > 0) {
    console.log(`─── ⚠️  [INACTIVE] NO EXPIRY DATE FOUND (${inactiveNoDate.length}) — were expired without a config ───`);
    inactiveNoDate.forEach((s) => {
      console.log(
        `  ${String(s.rollNumber).padEnd(15)} | ${String(s.name).padEnd(30)}` +
        ` | AY ${s.academicYear} | batch ${s.batch} → Y${s.computedYear} | ${s.course}` +
        ` | appStatus:${s.appStatus}`
      );
    });
    console.log('');
  }

  // ── Inactive: Prematurely expired (always shown, not just verbose) ───────────
  if (inactiveToReactivate.length > 0) {
    console.log(`─── ⚠️  [INACTIVE] PREMATURELY EXPIRED — FUTURE EXPIRY DATE (${inactiveToReactivate.length}) ───`);
    inactiveToReactivate.forEach((s) => {
      console.log(
        `  ${String(s.rollNumber).padEnd(15)} | ${String(s.name).padEnd(30)}` +
        ` | AY ${s.academicYear} | batch ${s.batch} → Y${s.computedYear} | ${s.course}` +
        ` | expiry is in future: ${s.expiryDate} | appStatus:${s.appStatus}`
      );
    });
    console.log('');
  }

  // ── Inactive: Incorrect applicationStatus (always shown, not just verbose) ────
  if (inactiveStatusToFix.length > 0) {
    console.log(`─── ⚠️  [INACTIVE] INCORRECT APPLICATION STATUS (${inactiveStatusToFix.length}) ───`);
    inactiveStatusToFix.forEach((s) => {
      console.log(
        `  ${String(s.rollNumber).padEnd(15)} | ${String(s.name).padEnd(30)}` +
        ` | AY ${s.academicYear} | batch ${s.batch} | appStatus is currently: "${s.appStatus}" (needs to be 'Expired')`
      );
    });
    console.log('');
  }

  // ── 5. Dry run exit ─────────────────────────────────────────────────────────
  if (dryRun) {
    console.log('✅ Dry run complete. Re-run without --dry-run to apply changes.');
    return;
  }

  // ── 6. Apply expiries, fix statuses, and reactivate students (live mode) ───
  let expiredCount = 0;
  let errorCount   = 0;
  let fixedStatusCount = 0;
  let reactivatedCount = 0;

  if (due.length > 0) {
    console.log(`\n🚨 Expiring ${due.length} student(s)...\n`);
    for (const row of due) {
      try {
        const studentDoc = await User.findById(row._id);
        if (!studentDoc || studentDoc.hostelStatus !== 'Active') {
          console.log(`  ⏭️  Skip (already inactive): ${row.rollNumber}`);
          continue;
        }

        const result = await expireStudentApplication(studentDoc, 'academic_year_end');
        if (result.changed) {
          expiredCount++;
          console.log(
            `  ✅ Expired: ${row.rollNumber} | ${row.name}` +
            ` | batch ${row.batch} → Y${row.computedYear} | expiry was ${row.expiryDate}`
          );
        } else {
          console.log(`  ⏭️  No change: ${row.rollNumber} (already inactive?)`);
        }
      } catch (err) {
        errorCount++;
        console.error(`  ❌ Error expiring ${row.rollNumber}:`, err.message);
      }
    }
  }

  if (inactiveStatusToFix.length > 0) {
    console.log(`\n🚨 Fixing ${inactiveStatusToFix.length} inactive student applicationStatus value(s) to 'Expired'...\n`);
    for (const row of inactiveStatusToFix) {
      try {
        const studentDoc = await User.findById(row._id);
        if (studentDoc && studentDoc.hostelStatus === 'Inactive') {
          studentDoc.applicationStatus = 'Expired';
          await studentDoc.save({ validateModifiedOnly: true });
          fixedStatusCount++;
          console.log(`  ✅ Fixed applicationStatus to 'Expired': ${row.rollNumber} | ${row.name}`);
        }
      } catch (err) {
        console.error(`  ❌ Error fixing status for ${row.rollNumber}:`, err.message);
      }
    }
  }

  if (inactiveToReactivate.length > 0) {
    console.log(`\n🚨 Reactivating ${inactiveToReactivate.length} prematurely expired student(s)...\n`);
    for (const row of inactiveToReactivate) {
      try {
        const studentDoc = await User.findById(row._id);
        if (!studentDoc || studentDoc.hostelStatus !== 'Inactive') {
          console.log(`  ⏭️  Skip (already active): ${row.rollNumber}`);
          continue;
        }

        const history = await RoomOccupancyHistory.findOne({
          student: studentDoc._id,
          academicYear: row.academicYear,
          status: 'Expired'
        }).sort({ allocatedFrom: -1 });

        studentDoc.hostelStatus = 'Active';
        studentDoc.applicationStatus = row.source === 'manual_extension' ? 'Extended' : 'Active';

        if (history) {
          studentDoc.bedNumber = history.bedNumber;
          studentDoc.lockerNumber = history.lockerNumber;

          history.status = 'Active';
          history.allocatedTo = null;
          await history.save();
        }

        await studentDoc.save({ validateModifiedOnly: true });
        reactivatedCount++;

        try {
          await FeeReminder.updateMany(
            { student: studentDoc._id, academicYear: row.academicYear },
            { $set: { isActive: true } }
          );
        } catch (fErr) {
          console.error(`    ⚠️  Failed to reactivate fee reminders for ${row.rollNumber}:`, fErr.message);
        }

        console.log(
          `  ✅ Reactivated: ${row.rollNumber} | ${row.name}` +
          ` | batch ${row.batch} → Y${row.computedYear} | expiry is in future: ${row.expiryDate}`
        );
      } catch (err) {
        errorCount++;
        console.error(`  ❌ Error reactivating ${row.rollNumber}:`, err.message);
      }
    }
  }

  // ── 7. Final report ─────────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(64)}`);
  console.log('  DONE');
  console.log('='.repeat(64));
  console.log(`  Expired successfully       : ${expiredCount}`);
  console.log(`  Fixed applicationStatus   : ${fixedStatusCount}`);
  console.log(`  Reactivated               : ${reactivatedCount}`);
  console.log(`  Errors                    : ${errorCount}`);
  console.log(`  Inactive (with expiry)    : ${inactiveWithDate.length}`);
  console.log(`  Inactive (no expiry) ⚠️    : ${inactiveNoDate.length}`);
  console.log(`  Skipped (no config)       : ${noConfig.length}`);
  console.log(`  Skipped (bad batch)       : ${badBatch.length}`);
  console.log(`  Not yet due               : ${notYetDue.length}`);
};

// ─── Entry point ──────────────────────────────────────────────────────────────
connectDB()
  .then(run)
  .catch((err) => {
    console.error('\n❌ Script failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await new Promise((r) => setTimeout(r, 500));
    await mongoose.disconnect();
    console.log('\n✅ Disconnected. Bye.');
    process.exit(0);
  });
