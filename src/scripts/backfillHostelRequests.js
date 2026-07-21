/**
 * Phase 7 backfill: StudentMaster + HostelRequest from existing User + RoomOccupancyHistory.
 *
 * Usage:
 *   npm run backfill-hostel-requests:dry                          (dry run, no writes)
 *   npm run backfill-hostel-requests                              (real run)
 *   npm run backfill-hostel-requests -- --fix-users               (also normalize User.applicationStatus)
 *   npm run backfill-hostel-requests -- --current-ay=2026-2027    (override current academic year)
 *
 * Rules (see docs/HOSTEL_REQUEST_ARCHITECTURE_REWRITE.md §5a):
 * - Hostel codes MUST be set first (run assignHostelCodes.js) — aborts otherwise.
 * - Real sequence IDs via generateHostelSequenceId (Counter-seeded, so future
 *   registrations continue the numbering). No BACKFILL prefix.
 * - Preserve existing lifecycle status regardless of academic year:
 *   Active/Extended → active, Withdrawn/Transferred/NOC → cancelled, otherwise expired.
 * - History rows are deduped per student+AY (prefer Active, else latest); all rows get linked.
 * - Enrollments = union of history AYs + the user's own AY when allocation exists on the User doc.
 * - Users without admissionNumber: looked up in SDMS by roll number (pin_no) and the
 *   admission number is synced back onto the User doc. Only skipped if SDMS has no match.
 * - expiredAt/cancelledAt use real dates (history allocatedTo / nocDate / AY end), not "now".
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
import { generateHostelSequenceId } from '../utils/hostelSequenceGenerator.js';
import { fetchStudentByIdentifier, closeSQLPool } from '../utils/sqlService.js';

const dryRun = process.argv.includes('--dry-run');
const fixUsers = process.argv.includes('--fix-users');

const ayArg = process.argv.find((a) => a.startsWith('--current-ay='));
const deriveCurrentAY = () => {
  const now = new Date();
  const startYear = now.getMonth() + 1 >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${startYear}-${startYear + 1}`;
};
const CURRENT_AY = ayArg ? ayArg.split('=')[1] : deriveCurrentAY();

const sanitizeCode = (v) => (v || '').toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const normalizeAdmission = (v) => (v || '').toString().trim().toUpperCase();

/**
 * Resolve a missing admission number from SDMS by roll number (pin_no).
 * Returns the normalized admission number, or null when SDMS has no match.
 */
const resolveAdmissionFromSDMS = async (student, report) => {
  const roll = (student.rollNumber || '').toString().trim();
  if (!roll) return null;
  try {
    const result = await fetchStudentByIdentifier(roll);
    if (!result.success || !result.data) return null;
    const admission = normalizeAdmission(result.data.admission_number || result.data.admission_no);
    if (!admission) return null;

    // Safety: another User must not already own this admission number.
    const conflict = await User.findOne({
      _id: { $ne: student._id },
      admissionNumber: { $regex: `^${admission.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
    }).select('rollNumber').lean();
    if (conflict) {
      report.admissionConflicts.push(`${roll} → ${admission} already used by ${conflict.rollNumber}`);
      return null;
    }
    return admission;
  } catch (err) {
    console.error(`  SDMS lookup failed for ${roll}: ${err.message}`);
    return null;
  }
};

/** Courses present on Users but missing/ambiguous in the Mongo Course collection. */
const COURSE_CODE_OVERRIDES = {
  'B.SC': 'BSC',
  'PHARM D': 'PHARMD',
  'DAP-PTV': 'DAPPTV',
  'DIPLOMA IN ANIMAL HUSBANDRY': 'DAH',
  'DIPLOMA IN FISHERIES POLYTECHNIC': 'DFP'
};

const courseCodeCache = new Map();
const resolveCourseCode = async (courseName) => {
  const key = (courseName || '').toString().trim().toUpperCase();
  if (!key) return 'UNK';
  if (courseCodeCache.has(key)) return courseCodeCache.get(key);

  let code = COURSE_CODE_OVERRIDES[key];
  if (!code) {
    const course = await Course.findOne({
      name: { $regex: `^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
    }).select('code').lean();
    if (course?.code) code = sanitizeCode(course.code); // e.g. 'B.PHARM' -> 'BPHARM'
  }
  if (!code) code = sanitizeCode(key).slice(0, 8) || 'UNK';

  courseCodeCache.set(key, code);
  return code;
};

/** AY end date fallback (e.g. 2025-2026 -> 2026-06-30) for expiredAt when no real date exists. */
const ayEndDate = (academicYear) => {
  const end = Number((academicYear || '').split('-')[1]);
  return Number.isFinite(end) ? new Date(`${end}-06-30T00:00:00.000Z`) : new Date();
};

/** Map the existing enrollment status without changing it based on academic year. */
const mapStatus = ({ user, historyRow, academicYear }) => {
  const nocCancelled =
    historyRow?.status === 'Withdrawn' ||
    historyRow?.expiryReason === 'noc' ||
    (user.nocDate && user.academicYear === academicYear);

  if (nocCancelled) return 'cancelled';

  if (historyRow) {
    if (historyRow.status === 'Active' || historyRow.status === 'Extended') return 'active';
    if (historyRow.status === 'Transferred') return 'cancelled';
    return 'expired';
  }
  return user.hostelStatus === 'Active' && user.applicationStatus !== 'Expired'
    ? 'active'
    : 'expired';
};

/** Dry-run sequence simulation so counters are not consumed. */
const dryCounters = new Map();
const nextSequence = async ({ academicYear, collegeCode, courseCode, hostelCode }) => {
  if (!dryRun) {
    return generateHostelSequenceId({ academicYear, collegeCode, courseCode, hostelCode });
  }
  const key = `${academicYear}:${collegeCode}:${courseCode}:${hostelCode}`;
  const seq = (dryCounters.get(key) || 0) + 1;
  dryCounters.set(key, seq);
  return {
    collegeCode,
    courseCode,
    hostelCode,
    yearlySequenceNumber: seq,
    hostelSequenceId: `${collegeCode}${courseCode}${hostelCode}${String(seq).padStart(3, '0')}`
  };
};

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/hostel-management';
  await mongoose.connect(uri);
  console.log(`Connected. dryRun=${dryRun} fixUsers=${fixUsers} currentAY=${CURRENT_AY}`);

  // --- Preflight: all hostels must have real codes ---
  const hostels = await Hostel.find({}).lean();
  const missingCodes = hostels.filter((h) => !sanitizeCode(h.code));
  if (missingCodes.length > 0) {
    console.error('ABORT: hostels without a code. Run assignHostelCodes.js first:');
    missingCodes.forEach((h) => console.error(`  - ${h.name}`));
    await mongoose.disconnect();
    process.exit(1);
  }
  const hostelById = new Map(hostels.map((h) => [String(h._id), h]));

  // Deterministic sequence order: original registration order.
  const students = await User.find({ role: 'student' }).sort({ createdAt: 1 }).lean();
  console.log(`Found ${students.length} student users`);

  const report = {
    mastersCreated: 0,
    requestsCreated: 0,
    historyRowsLinked: 0,
    skippedExisting: 0,
    skippedNoAllocation: [],
    skippedNoAdmission: [],
    admissionsSyncedFromSDMS: [],
    admissionConflicts: [],
    statusRepaired: [],
    usersFixed: 0,
    perYearStatus: {}
  };

  for (const student of students) {
    let admission = normalizeAdmission(student.admissionNumber);

    // Missing in Mongo → sync from SDMS by roll number instead of skipping.
    if (!admission) {
      admission = await resolveAdmissionFromSDMS(student, report);
      if (admission) {
        report.admissionsSyncedFromSDMS.push(`${student.rollNumber} (${student.name}) → ${admission}`);
        if (!dryRun) {
          await User.updateOne({ _id: student._id }, { $set: { admissionNumber: admission } });
        }
        student.admissionNumber = admission;
      }
    }

    if (!admission) {
      report.skippedNoAdmission.push(`${student.rollNumber} (${student.name}) — not found in SDMS either`);
      continue;
    }

    // --- StudentMaster ---
    let master = await StudentMaster.findOne({ admissionNumber: admission });
    if (!master) {
      if (!dryRun) {
        master = await StudentMaster.create({
          admissionNumber: admission,
          userId: student._id,
          name: student.name,
          rollNumber: (student.rollNumber || '').toString().trim().toUpperCase(),
          studentPhone: student.studentPhone,
          parentPhone: student.parentPhone,
          motherName: student.motherName,
          motherPhone: student.motherPhone,
          localGuardianName: student.localGuardianName,
          localGuardianPhone: student.localGuardianPhone,
          email: student.email,
          studentPhoto: student.studentPhoto,
          guardianPhoto1: student.guardianPhoto1,
          guardianPhoto2: student.guardianPhoto2
        });
      }
      report.mastersCreated += 1;
    } else if (!master.userId && !dryRun) {
      master.userId = student._id;
      await master.save();
    }

    // --- Build enrollments: dedupe history per AY, union with the user doc's own AY ---
    const historyRows = await RoomOccupancyHistory.find({ student: student._id })
      .sort({ allocatedFrom: 1 })
      .lean();

    const byYear = new Map(); // ay -> { row: bestHistoryRow|null, allRows: [] }
    for (const row of historyRows) {
      if (!row.academicYear) continue;
      const entry = byYear.get(row.academicYear) || { row: null, allRows: [] };
      entry.allRows.push(row);
      // Prefer Active/Extended row; otherwise keep the latest by allocatedFrom.
      const isBetter =
        !entry.row ||
        (['Active', 'Extended'].includes(row.status) && !['Active', 'Extended'].includes(entry.row.status)) ||
        (['Active', 'Extended'].includes(row.status) === ['Active', 'Extended'].includes(entry.row.status) &&
          new Date(row.allocatedFrom) > new Date(entry.row.allocatedFrom));
      if (isBetter) entry.row = row;
      byYear.set(row.academicYear, entry);
    }

    // User-doc allocation covers its own AY when history doesn't.
    if (
      student.academicYear &&
      !byYear.has(student.academicYear) &&
      student.hostel && student.hostelCategory && student.room && student.roomNumber
    ) {
      byYear.set(student.academicYear, { row: null, allRows: [] });
    }

    if (byYear.size === 0) {
      report.skippedNoAllocation.push(`${student.rollNumber} (${student.name}) — no history and incomplete User allocation`);
      continue;
    }

    for (const [academicYear, entry] of byYear) {
      const historyRow = entry.row;

      const existing = await HostelRequest.findOne({ admissionNumber: admission, academicYear });
      if (existing) {
        report.skippedExisting += 1;

        // Repair status of requests created by earlier runs so it matches the
        // source User/history status (statuses are preserved, not AY-based).
        const correctStatus = mapStatus({ user: student, historyRow, academicYear });
        if (existing.status !== correctStatus) {
          report.statusRepaired.push(
            `${admission} / ${academicYear}: ${existing.status} → ${correctStatus}`
          );
          if (!dryRun) {
            const update = { status: correctStatus };
            if (correctStatus === 'active') {
              update.expiredAt = null;
              update.cancelledAt = null;
              update.statusReason = '';
            } else if (correctStatus === 'expired') {
              update.expiredAt = existing.expiredAt || historyRow?.allocatedTo || ayEndDate(academicYear);
              update.cancelledAt = null;
              update.statusReason = 'Backfill: expired per legacy status';
            } else if (correctStatus === 'cancelled') {
              update.cancelledAt = existing.cancelledAt || student.nocDate || historyRow?.allocatedTo || ayEndDate(academicYear);
              update.expiredAt = null;
              update.statusReason = 'Backfill: NOC / withdrawn';
            }
            await HostelRequest.updateOne({ _id: existing._id }, { $set: update });
          }
        }

        if (!dryRun) {
          for (const row of entry.allRows) {
            if (!row.hostelRequestId) {
              await RoomOccupancyHistory.updateOne({ _id: row._id }, { $set: { hostelRequestId: existing._id } });
              report.historyRowsLinked += 1;
            }
          }
        }
        continue;
      }

      const hostelId = historyRow?.hostel || student.hostel;
      const hostelCategoryId = historyRow?.hostelCategory || student.hostelCategory;
      const roomId = historyRow?.room || student.room;
      const roomNumber = historyRow?.roomNumber || student.roomNumber;

      if (!hostelId || !hostelCategoryId || !roomId || !roomNumber) {
        report.skippedNoAllocation.push(`${student.rollNumber} (${student.name}) AY=${academicYear} — missing hostel/category/room`);
        continue;
      }

      const hostelDoc = hostelById.get(String(hostelId));
      if (!hostelDoc) {
        report.skippedNoAllocation.push(`${student.rollNumber} (${student.name}) AY=${academicYear} — hostel ${hostelId} not found`);
        continue;
      }

      const hostelCode = sanitizeCode(hostelDoc.code);
      const courseName = historyRow?.course || student.course;
      const courseCode = await resolveCourseCode(courseName);
      const collegeCode = sanitizeCode(student.college?.code || student.college?.name) || 'COL';

      const status = mapStatus({ user: student, historyRow, academicYear });

      // Real dates instead of "now".
      const allocatedAt = historyRow?.allocatedFrom || student.createdAt || new Date();
      const closedAt =
        historyRow?.allocatedTo ||
        student.applicationExpiryDate ||
        (academicYear !== CURRENT_AY ? ayEndDate(academicYear) : new Date());
      const cancelledAt = status === 'cancelled' ? (student.nocDate || closedAt) : undefined;
      const expiredAt = status === 'expired' ? closedAt : undefined;

      const seq = await nextSequence({ academicYear, collegeCode, courseCode, hostelCode });

      report.perYearStatus[academicYear] = report.perYearStatus[academicYear] || {};
      report.perYearStatus[academicYear][status] = (report.perYearStatus[academicYear][status] || 0) + 1;

      if (dryRun) {
        console.log(`[dry-run] ${admission} / ${academicYear} status=${status} seq=${seq.hostelSequenceId}`);
        report.requestsCreated += 1;
        continue;
      }

      const masterId = master?._id || (await StudentMaster.findOne({ admissionNumber: admission }))?._id;
      if (!masterId) continue;

      const created = await HostelRequest.create({
        studentMasterId: masterId,
        admissionNumber: admission,
        academicYear,
        status,
        hostelId,
        hostelCategoryId,
        roomId,
        roomNumber,
        bedNumber: historyRow?.bedNumber || student.bedNumber,
        lockerNumber: historyRow?.lockerNumber || student.lockerNumber,
        collegeCode: seq.collegeCode,
        courseCode: seq.courseCode,
        hostelCode: seq.hostelCode,
        yearlySequenceNumber: seq.yearlySequenceNumber,
        hostelSequenceId: seq.hostelSequenceId,
        sdmsRollNumber: (student.rollNumber || '').toString().trim().toUpperCase(),
        sdmsName: student.name,
        sdmsGender: student.gender,
        sdmsCourse: courseName,
        sdmsBranch: historyRow?.branch || student.branch,
        sdmsYearOfStudy: historyRow?.yearOfStudy || student.year,
        sdmsBatch: student.batch,
        sdmsCollegeName: student.college?.name,
        mealType: student.mealType || 'veg',
        parentPermissionForOuting: student.parentPermissionForOuting !== false,
        concession: student.concession || 0,
        allocatedAt,
        expiredAt,
        cancelledAt,
        statusReason: status === 'cancelled' ? 'Backfill: NOC / withdrawn' : status === 'expired' ? 'Backfill: academic year closed' : '',
        notes: 'backfill from User/RoomOccupancyHistory'
      });

      for (const row of entry.allRows) {
        await RoomOccupancyHistory.updateOne({ _id: row._id }, { $set: { hostelRequestId: created._id } });
        report.historyRowsLinked += 1;
      }

      report.requestsCreated += 1;
    }

    // --- Optional: normalize User.applicationStatus per §5a mapping ---
    if (fixUsers && !dryRun) {
      let nextStatus = null;

      if (student.nocDate) {
        nextStatus = 'Withdrawn';
      } else if (!['Active', 'Extended', 'Expired', 'Withdrawn'].includes(student.applicationStatus)) {
        // Preserve the legacy state when applicationStatus is missing/invalid.
        nextStatus = student.hostelStatus === 'Active' ? 'Active' : 'Expired';
      }

      if (nextStatus && nextStatus !== student.applicationStatus) {
        await User.updateOne(
          { _id: student._id },
          {
            $set: {
              applicationStatus: nextStatus,
              hostelStatus: ['Active', 'Extended'].includes(nextStatus) ? 'Active' : 'Inactive'
            }
          }
        );
        report.usersFixed += 1;
      }
    }
  }

  console.log('\n--- Backfill summary ---');
  console.log({
    dryRun,
    fixUsers,
    currentAY: CURRENT_AY,
    mastersCreated: report.mastersCreated,
    requestsCreated: report.requestsCreated,
    statusRepaired: report.statusRepaired.length,
    historyRowsLinked: report.historyRowsLinked,
    skippedExisting: report.skippedExisting,
    usersFixed: report.usersFixed
  });

  if (Object.keys(report.perYearStatus).length > 0) {
    console.log('\nNewly created requests this run (AY × status):');
    Object.entries(report.perYearStatus).forEach(([ay, statuses]) =>
      console.log(`  ${ay}: ${JSON.stringify(statuses)}`)
    );
  }

  if (report.statusRepaired.length > 0) {
    console.log(`\nStatus repaired on existing requests (${report.statusRepaired.length})${dryRun ? ' [dry-run: not written]' : ''}:`);
    report.statusRepaired.forEach((s) => console.log(`  ${s}`));
  }

  // Full picture from the database — every academic year, all statuses.
  const dbStats = await HostelRequest.aggregate([
    { $group: { _id: { ay: '$academicYear', status: '$status' }, count: { $sum: 1 } } },
    { $sort: { '_id.ay': 1, '_id.status': 1 } }
  ]);
  const perAY = {};
  dbStats.forEach(({ _id, count }) => {
    perAY[_id.ay] = perAY[_id.ay] || { total: 0 };
    perAY[_id.ay][_id.status] = count;
    perAY[_id.ay].total += count;
  });
  console.log('\n=== HostelRequest totals in DB (all academic years) ===');
  if (Object.keys(perAY).length === 0) {
    console.log('  (no requests in DB yet)');
  } else {
    Object.entries(perAY).forEach(([ay, s]) => {
      console.log(`  ${ay}: total=${s.total} | active=${s.active || 0} | expired=${s.expired || 0} | cancelled=${s.cancelled || 0}`);
    });
  }
  if (report.admissionsSyncedFromSDMS.length) {
    console.log(`\nAdmission numbers synced from SDMS (${report.admissionsSyncedFromSDMS.length}):`);
    report.admissionsSyncedFromSDMS.forEach((s) => console.log(`  ${s}`));
  }
  if (report.admissionConflicts.length) {
    console.log(`\nAdmission conflicts — NOT synced (${report.admissionConflicts.length}):`);
    report.admissionConflicts.forEach((s) => console.log(`  ${s}`));
  }
  if (report.skippedNoAdmission.length) {
    console.log(`\nSkipped — no admissionNumber in Mongo or SDMS (${report.skippedNoAdmission.length}):`);
    report.skippedNoAdmission.forEach((s) => console.log(`  ${s}`));
  }
  if (report.skippedNoAllocation.length) {
    console.log(`\nSkipped — incomplete allocation (${report.skippedNoAllocation.length}):`);
    report.skippedNoAllocation.forEach((s) => console.log(`  ${s}`));
  }

  await mongoose.disconnect();
  try {
    await closeSQLPool();
  } catch (_) {
    /* ignore */
  }
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
