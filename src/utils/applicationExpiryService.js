import ApplicationExpiryConfig from '../models/ApplicationExpiryConfig.js';
import RoomOccupancyHistory from '../models/RoomOccupancyHistory.js';
import HostelCategory from '../models/HostelCategory.js';
import User from '../models/User.js';
import FeeReminder from '../models/FeeReminder.js';
import NOC from '../models/NOC.js';
import {
  enrichStudentAcademics,
  enrichStudentsAcademics,
  matchesAcademicFilters,
  repairMissingRollNumber
} from './studentAcademicEnricher.js';
import {
  deleteStudentHostelFeesForAcademicYearSafely,
  resolveFeesStudentId
} from '../services/feesSyncService.js';
import { fetchSemesterEndDateFromSQL } from './sqlService.js';
import { getDefaultAcademicYear } from './roomOccupancyUtils.js';

export const getAcademicYearEndYear = (academicYear) => {
  if (!academicYear || !/^\d{4}-\d{4}$/.test(academicYear)) return null;
  return parseInt(academicYear.split('-')[1], 10);
};

const buildDateInYear = (year, month, day) => {
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
};

/**
 * Resolve expiry date from settings (ApplicationExpiryConfig).
 * Returns null if no active config exists — students are not expired without admin-configured dates.
 * manualExpiryDate is used only for super-admin per-student extensions.
 */
export const resolveApplicationExpiryDate = async ({
  academicYear,
  courseName,
  yearOfStudy,
  manualExpiryDate = null,
  sqlCourseId = null
}) => {
  // ── Priority 1: Per-student manual extension (Extended status) ──────────────
  if (manualExpiryDate) {
    const d = new Date(manualExpiryDate);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const endYear = getAcademicYearEndYear(academicYear);
  if (!academicYear || !yearOfStudy) return null;

  // ── Priority 2: ApplicationExpiryConfig (admin manual override) ─────────────
  if (courseName) {
    const config = await ApplicationExpiryConfig.findOne({
      academicYear,
      courseName: courseName.trim(),
      yearOfStudy: Number(yearOfStudy),
      isActive: true
    }).lean();

    if (config && endYear) {
      return buildDateInYear(endYear, config.expiryMonth, config.expiryDay);
    }
  }

  // ── Priority 3: SQL semesters table — Semester 2 end_date ───────────────────
  if (sqlCourseId) {
    const sqlDate = await fetchSemesterEndDateFromSQL({
      sqlCourseId,
      yearOfStudy: Number(yearOfStudy),
      academicYear
    });
    if (sqlDate) return sqlDate;
  }

  // ── Priority 4: No config found — skip this student ─────────────────────────
  return null;
};

/** @deprecated use resolveApplicationExpiryDate — kept for API preview */
export const calculateApplicationExpiryDate = resolveApplicationExpiryDate;

export const createOccupancyHistory = async ({
  student,
  academicYear,
  courseName,
  branchName,
  yearOfStudy,
  adminId,
  expiryReason = 'registration'
}) => {
  if (!student?._id) return null;

  const existing = await RoomOccupancyHistory.findOne({
    student: student._id,
    academicYear,
    status: 'Active'
  });
  if (existing) return existing;

  return RoomOccupancyHistory.create({
    student: student._id,
    studentName: student.name,
    rollNumber: student.rollNumber,
    course: courseName || student.course,
    branch: branchName || student.branch,
    yearOfStudy: yearOfStudy || student.year,
    academicYear,
    hostel: student.hostel,
    hostelCategory: student.hostelCategory,
    room: student.room,
    roomNumber: student.roomNumber,
    bedNumber: student.bedNumber,
    lockerNumber: student.lockerNumber,
    allocatedFrom: new Date(),
    allocatedTo: null,
    status: 'Active',
    expiryReason,
    createdBy: adminId || null
  });
};

export const closeActiveOccupancyHistory = async ({
  studentId,
  academicYear,
  status = 'Expired',
  expiryReason = 'academic_year_end',
  allocatedTo = new Date()
}) => {
  const query = {
    student: studentId,
    status: 'Active',
    allocatedTo: null
  };
  if (academicYear) query.academicYear = academicYear;

  return RoomOccupancyHistory.updateMany(query, {
    $set: { status, expiryReason, allocatedTo }
  });
};

const applyHistorySnapshotToStudent = (student, history) => {
  const wasActive = history.status === 'Active' && !history.allocatedTo;

  student.academicYear = history.academicYear;
  student.hostel = history.hostel;
  student.hostelCategory = history.hostelCategory;
  student.room = history.room;
  student.roomNumber = history.roomNumber;
  student.hostelStatus = wasActive ? 'Active' : 'Inactive';
  student.applicationStatus = wasActive ? 'Active' : 'Expired';
  student.bedNumber = wasActive ? history.bedNumber : undefined;
  student.lockerNumber = wasActive ? history.lockerNumber : undefined;
  student.set('applicationExpiryDate', undefined);
  student.set('applicationExpiryExtendedAt', undefined);
  student.set('applicationExpiryExtendedBy', undefined);
};

/**
 * Remove a student's enrollment for one academic year only.
 * Keeps the User account when other year enrollments exist.
 */
export const removeStudentEnrollmentForAcademicYear = async ({
  studentId,
  academicYear
}) => {
  const student = await User.findOne({ _id: studentId, role: 'student' });
  if (!student) {
    return { ok: false, code: 'NOT_FOUND', message: 'Student not found' };
  }

  const hasHistory = await RoomOccupancyHistory.exists({ student: studentId, academicYear });
  const onCurrentProfile = student.academicYear === academicYear;

  if (!hasHistory && !onCurrentProfile) {
    return {
      ok: false,
      code: 'NO_ENROLLMENT',
      message: `No enrollment found for academic year ${academicYear}`
    };
  }

  if (student.academicYear && academicYear !== student.academicYear) {
    return {
      ok: false,
      code: 'NOT_CURRENT_YEAR',
      message: `Cannot remove enrollment for ${academicYear}. Only the student's current academic year (${student.academicYear}) can be removed.`
    };
  }

  await RoomOccupancyHistory.deleteMany({ student: studentId, academicYear });
  await FeeReminder.deleteMany({ student: studentId, academicYear });

  const enriched = await enrichStudentAcademics(student.toObject());
  const feesStudentId = resolveFeesStudentId(student, enriched);
  if (feesStudentId) {
    await deleteStudentHostelFeesForAcademicYearSafely(feesStudentId, academicYear);
  }

  const remainingCount = await RoomOccupancyHistory.countDocuments({ student: studentId });

  if (remainingCount === 0) {
    return { ok: true, action: 'full_delete', student };
  }

  if (onCurrentProfile) {
    const previousHistory = await RoomOccupancyHistory.findOne({ student: studentId })
      .sort({ academicYear: -1 });

    if (previousHistory) {
      applyHistorySnapshotToStudent(student, previousHistory);
      await repairMissingRollNumber(student);
      await student.save({ validateModifiedOnly: true });
    }
  }

  return {
    ok: true,
    action: 'year_removed',
    student,
    academicYear,
    remainingEnrollments: remainingCount
  };
};

export const expireStudentApplication = async (student, reason = 'academic_year_end', notes = null) => {
  if (!student || student.hostelStatus !== 'Active') return { changed: false };

  student.hostelStatus = 'Inactive';
  student.applicationStatus = 'Expired';
  student.bedNumber = undefined;
  student.lockerNumber = undefined;
  await repairMissingRollNumber(student);
  await student.save({ validateModifiedOnly: true });

  await closeActiveOccupancyHistory({
    studentId: student._id,
    academicYear: student.academicYear,
    status: 'Expired',
    expiryReason: reason
  });

  if (notes?.trim()) {
    await RoomOccupancyHistory.updateMany(
      {
        student: student._id,
        academicYear: student.academicYear,
        status: 'Expired',
        expiryReason: reason
      },
      { $set: { notes: notes.trim() } }
    );
  }

  try {
    await FeeReminder.updateMany(
      { student: student._id, academicYear: student.academicYear, isActive: true },
      { $set: { isActive: false } }
    );
  } catch (err) {
    console.error('Failed to deactivate fee reminders on expiry:', err);
  }

  return { changed: true };
};

export const reactivateStudentApplication = async (student, reason = 'academic_year_end_extended') => {
  if (!student || student.hostelStatus !== 'Inactive') return { changed: false };

  // Find their last closed RoomOccupancyHistory record for this academic year to restore their bed and locker
  const lastHistory = await RoomOccupancyHistory.findOne({
    student: student._id,
    academicYear: student.academicYear,
    status: 'Expired'
  }).sort({ allocatedTo: -1 });

  student.hostelStatus = 'Active';
  student.applicationStatus = 'Active';
  
  if (lastHistory) {
    student.bedNumber = lastHistory.bedNumber;
    student.lockerNumber = lastHistory.lockerNumber;
  }
  
  await repairMissingRollNumber(student);
  await student.save({ validateModifiedOnly: true });

  if (lastHistory) {
    lastHistory.status = 'Active';
    lastHistory.allocatedTo = null;
    await lastHistory.save();
  }

  try {
    await FeeReminder.updateMany(
      { student: student._id, academicYear: student.academicYear },
      { $set: { isActive: true } }
    );
  } catch (err) {
    console.error('Failed to reactivate fee reminders on reactivation:', err);
  }

  return { changed: true };
};

/**
 * Daily job: expire active students when settings-based (or extended) expiry date has passed.
 * Also reactivates expired students if the academic settings/semester dates are extended.
 */
export const processDueNOCDeactivations = async () => {
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  // Find approved NOC requests that have not deactivated the student profile, whose vacatingDate is today or in the past
  const dueNOCs = await NOC.find({
    status: 'Approved',
    studentDeactivated: false,
    vacatingDate: { $lte: today }
  });

  let deactivatedCount = 0;
  for (const noc of dueNOCs) {
    try {
      await noc.deactivateStudent();
      deactivatedCount++;
      console.log(`📅 Deactivated student ${noc.studentName} (${noc.rollNumber}) via approved NOC (vacatingDate: ${noc.vacatingDate})`);
    } catch (err) {
      console.error(`📅 Failed to deactivate student for NOC ${noc._id}:`, err);
    }
  }

  return deactivatedCount;
};

export const processDueApplicationExpiries = async () => {
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  // 1. Process Active -> Expired
  const activeStudents = await User.find({
    role: 'student',
    hostelStatus: 'Active',
    applicationStatus: { $in: ['Active', 'Extended'] }
  });

  let expired = 0;
  let skippedNoConfig = 0;

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

    if (!expiryDate) {
      skippedNoConfig += 1;
      continue;
    }

    if (expiryDate <= today) {
      const result = await expireStudentApplication(student, 'academic_year_end');
      if (result.changed) expired += 1;
    }
  }

  // 2. Process Expired -> Active (Reactivation check due to date extension - disabled)
  let reactivated = 0;
  /*
  const expiredStudents = await User.find({
    role: 'student',
    hostelStatus: 'Inactive',
    applicationStatus: 'Expired'
  });

  for (const student of expiredStudents) {
    const enriched = await enrichStudentAcademics(student.toObject());

    const expiryDate = await resolveApplicationExpiryDate({
      academicYear: student.academicYear,
      courseName: enriched.course,
      yearOfStudy: enriched.year,
      manualExpiryDate: null,
      sqlCourseId: enriched.sqlCourseId || null
    });

    // If new expiry date has been extended into the future
    if (expiryDate && expiryDate > today) {
      const result = await reactivateStudentApplication(student, 'academic_year_end_extended');
      if (result.changed) reactivated += 1;
    }
  }
  */

  // 3. Process NOC deactivations whose vacating date has arrived
  const nocDeactivated = await processDueNOCDeactivations();

  return {
    processed: activeStudents.length,
    expired,
    skippedNoConfig,
    reactivated,
    nocDeactivated
  };
};

/** Overlay a student's profile with room/category from a specific academic year enrollment. */
export const overlayStudentWithEnrollmentHistory = (student, history, requestedYear) => {
  const isHistorical = requestedYear ? (student.academicYear !== requestedYear) : false;

  let resolvedStatus = student.hostelStatus || 'Active';
  let resolvedAppStatus = student.applicationStatus || 'Active';

  if (history) {
    if (history.status === 'Withdrawn') {
      resolvedStatus = 'Inactive';
      resolvedAppStatus = 'Withdrawn';
    } else if (history.status === 'Expired') {
      // Student completed this year successfully and was renewed
      resolvedStatus = 'Active';
      resolvedAppStatus = 'Expired';  // Show as Expired for historical years
    } else if (
      history.status === 'Active' ||
      history.status === 'Extended' ||
      history.status === 'Transferred'
    ) {
      resolvedStatus = 'Active';
      resolvedAppStatus = 'Active';
    }
  } else {
    // If they completed their stay successfully (Expired) but didn't renew yet, they were active in that year.
    if (student.hostelStatus === 'Inactive' && student.applicationStatus === 'Expired') {
      resolvedStatus = 'Active';
      resolvedAppStatus = 'Expired';
    }
  }

  if (!history) {
    return {
      ...student,
      currentAcademicYear: student.academicYear,
      academicYear: requestedYear || student.academicYear,
      isHistoricalView: isHistorical,
      hostelStatus: isHistorical ? 'Active' : resolvedStatus,
      applicationStatus: resolvedAppStatus
    };
  }

  const hostelCategory =
    history.hostelCategory && typeof history.hostelCategory === 'object'
      ? history.hostelCategory
      : student.hostelCategory;

  const isHistView = student.academicYear !== history.academicYear;

  return {
    ...student,
    currentAcademicYear: student.academicYear,
    academicYear: history.academicYear,
    roomNumber: history.roomNumber ?? student.roomNumber,
    bedNumber: history.bedNumber,
    lockerNumber: history.lockerNumber,
    room: history.room ?? student.room,
    hostel: history.hostel ?? student.hostel,
    hostelCategory,
    category:
      (typeof hostelCategory === 'object' && hostelCategory?.name) ||
      (typeof student.category === 'string' ? student.category : student.category?.name) ||
      '',
    course: history.course || student.course,
    branch: history.branch || student.branch,
    year: history.yearOfStudy ?? student.year,
    hostelStatus: resolvedStatus,
    applicationStatus: resolvedAppStatus,
    enrollmentHistoryStatus: history.status,
    isHistoricalView: isHistView,
    allocatedFrom: history.allocatedFrom,
    allocatedTo: history.allocatedTo
  };
};

const dedupeHistoryByStudent = (rows) => {
  const byStudent = new Map();
  for (const row of rows) {
    const sid = row.student?.toString();
    if (!sid) continue;
    const existing = byStudent.get(sid);
    if (!existing || new Date(row.allocatedFrom) > new Date(existing.allocatedFrom)) {
      byStudent.set(sid, row);
    }
  }
  return byStudent;
};

/**
 * List students enrolled in a given academic year (including renewed students via occupancy history).
 */
export const fetchStudentsForAcademicYear = async ({
  academicYear,
  filters = {},
  page = 1,
  limit = 10,
  academicFilters = {},
  skipFeesAndConcessions = false,
  skipEnrichment = false
}) => {
  const { gender, category, roomNumber, batch, search, hostelStatus, hostel } = filters;
  const hasAcademicFilter = !!(
    academicFilters.course ||
    academicFilters.branch ||
    academicFilters.year
  );

  const historyQuery = { academicYear };
  if (roomNumber) historyQuery.roomNumber = roomNumber;
  if (hostel) historyQuery.hostel = hostel;

  if (category) {
    const escaped = category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const categoryDocs = await HostelCategory.find({
      name: new RegExp(`^${escaped}$`, 'i')
    })
      .select('_id')
      .lean();
    if (categoryDocs.length === 0) {
      return { students: [], count: 0 };
    }
    historyQuery.hostelCategory = { $in: categoryDocs.map((c) => c._id) };
  }

  let histories = await RoomOccupancyHistory.find(historyQuery)
    .populate('hostel', '_id name')
    .populate('hostelCategory', '_id name')
    .sort({ allocatedFrom: -1 })
    .lean();

  const historyByStudent = dedupeHistoryByStudent(histories);
  histories = Array.from(historyByStudent.values());

  const studentIdSet = new Set(histories.map((h) => h.student.toString()));

  const endYear = getAcademicYearEndYear(academicYear);
  const cutoffDate = endYear ? new Date(`${endYear}-07-31T23:59:59.999Z`) : new Date();

  // Also include students whose current academicYear matches the requested year
  // (these are students who haven't been renewed yet and are still in this year)
  const liveQuery = {
    role: 'student',
    createdAt: { $lte: cutoffDate },
    academicYear: academicYear  // Only include students currently in this academic year
  };
  if (gender) liveQuery.gender = gender;
  if (batch) liveQuery.batch = batch;
  if (roomNumber) liveQuery.roomNumber = roomNumber;
  if (hostel) liveQuery.hostel = hostel;
  if (category) liveQuery.category = category;
  // Note: hostelStatus is not restricted in MongoDB queries here to allow mapping currently inactive students who were active back then.
  if (search) {
    const searchRegex = new RegExp(search, 'i');
    liveQuery.$or = [{ name: searchRegex }, { rollNumber: searchRegex }];
  }

  const liveStudents = await User.find(liveQuery).select('_id').lean();
  for (const row of liveStudents) {
    studentIdSet.add(row._id.toString());
  }

  if (studentIdSet.size === 0) {
    return { students: [], count: 0 };
  }

  const userQuery = {
    role: 'student',
    _id: { $in: [...studentIdSet] }
  };
  if (gender) userQuery.gender = gender;
  if (batch) userQuery.batch = batch;
  // Note: hostelStatus filter is applied in-memory after overlaying history to correctly support historically active students
  if (search) {
    const searchRegex = new RegExp(search, 'i');
    userQuery.$or = [{ name: searchRegex }, { rollNumber: searchRegex }];
  }

  const populateOpts = [
    { path: 'hostel', select: '_id name' },
    { path: 'hostelCategory', select: '_id name' }
  ];

  const users = await User.find(userQuery)
    .select('-password')
    .populate(populateOpts)
    .sort({ createdAt: -1 })
    .lean();

  let students = users.map((user) => {
    const history = historyByStudent.get(user._id.toString());
    return overlayStudentWithEnrollmentHistory(user, history, academicYear);
  }).filter((student) => {
    // CRITICAL FIX: Exclude students who have no history for this year AND joined AFTER this year
    // This prevents future year students from appearing in past year filters
    const history = historyByStudent.get(student._id.toString());
    if (!history) {
      // If no history record exists, only include if their current academicYear matches requested year
      // or if their current academicYear is BEFORE the requested year (they were enrolled but history wasn't created)
      const currentYear = parseInt(student.currentAcademicYear?.split('-')[0] || '0', 10);
      const requestedYearNum = parseInt(academicYear.split('-')[0], 10);
      
      // Only include if current year <= requested year (not future students)
      return currentYear <= requestedYearNum;
    }
    return true;
  });

  if (hostelStatus) {
    if (hostelStatus === 'Active') {
      console.log(`🔍 Filtering for Active status. Total students before filter: ${students.length}`);
      students = students.filter(
        (s) => {
          const isActive = s.applicationStatus === 'Active' &&
            s.applicationStatus !== 'Withdrawn' &&
            s.enrollmentHistoryStatus !== 'Withdrawn';
          
          if (s.name && s.name.includes('GANNAVARAPU')) {
            console.log(`🔍 GANNAVARAPU GEETHA - applicationStatus: ${s.applicationStatus}, hostelStatus: ${s.hostelStatus}, enrollmentHistoryStatus: ${s.enrollmentHistoryStatus}, isActive: ${isActive}`);
          }
          
          return isActive;
        }
      );
      console.log(`🔍 Students after Active filter: ${students.length}`);
    } else if (hostelStatus === 'Inactive') {
      students = students.filter(
        (s) =>
          s.hostelStatus === 'Inactive' ||
          s.applicationStatus === 'Expired' ||
          s.applicationStatus === 'Withdrawn'
      );
    } else {
      students = students.filter((s) => s.hostelStatus === hostelStatus);
    }
  }

  if (hasAcademicFilter) {
    if (!skipEnrichment) {
      students = await enrichStudentsAcademics(students, { skipFeesAndConcessions });
    }
    students = students.filter((s) => matchesAcademicFilters(s, academicFilters));
  }

  const count = students.length;
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  
  let paginatedStudents = students.slice((pageNum - 1) * limitNum, pageNum * limitNum);

  if (!hasAcademicFilter && !skipEnrichment) {
    paginatedStudents = await enrichStudentsAcademics(paginatedStudents, { skipFeesAndConcessions });
  }

  const getYearDifference = (ay1, ay2) => {
    if (!ay1 || !ay2) return 0;
    const y1 = parseInt(ay1.split('-')[0], 10);
    const y2 = parseInt(ay2.split('-')[0], 10);
    return y1 - y2;
  };

  paginatedStudents = paginatedStudents.map((student) => {
    const history = historyByStudent.get(student._id.toString());
    if (!history) {
      if (student.isHistoricalView) {
        const diff = getYearDifference(student.currentAcademicYear, student.academicYear);
        const historicalYear = diff > 0 ? Math.max(1, (student.year || 1) - diff) : (student.year || 1);
        return {
          ...student,
          year: historicalYear
        };
      }
      return student;
    }
    return {
      ...student,
      course: history.course || student.course,
      branch: history.branch || student.branch,
      year: history.yearOfStudy ?? student.year,
      category:
        (typeof history.hostelCategory === 'object' && history.hostelCategory?.name) ||
        (typeof student.category === 'string' ? student.category : student.category?.name) ||
        '',
      roomNumber: history.roomNumber ?? student.roomNumber,
      bedNumber: history.bedNumber,
      lockerNumber: history.lockerNumber,
      hostel: history.hostel ?? student.hostel,
      hostelCategory: history.hostelCategory ?? student.hostelCategory
    };
  });

  return { students: paginatedStudents, count };
};

/** Attach resolved application expiry date for list/detail display. */
export const attachResolvedExpiryDates = async (students) => {
  if (!students?.length) return students;

  // Dynamically import to avoid circular dependency
  const RoomOccupancyHistory = (await import('../models/RoomOccupancyHistory.js')).default;

  return Promise.all(
    students.map(async (student) => {
      const useManual =
        student.applicationStatus === 'Extended' && student.applicationExpiryDate;
      const resolvedExpiryDate = await resolveApplicationExpiryDate({
        academicYear: student.academicYear,
        courseName: student.course,
        yearOfStudy: student.year,
        manualExpiryDate: useManual ? student.applicationExpiryDate : null,
        sqlCourseId: student.sqlCourseId || null
      });

      let roomNumber = student.roomNumber;
      let bedNumber = student.bedNumber;
      let lockerNumber = student.lockerNumber;
      let actualExpiredAt = student.allocatedTo || null;

      const isExpiredProfile =
        student.hostelStatus === 'Inactive' || student.applicationStatus === 'Expired';

      if (isExpiredProfile || !roomNumber) {
        const history = await RoomOccupancyHistory.findOne({
          student: student._id || student.id,
          academicYear: student.academicYear,
          ...(isExpiredProfile ? { status: 'Expired' } : {})
        }).sort({ allocatedFrom: -1, allocatedTo: -1 });

        if (history) {
          if (!roomNumber) {
            roomNumber = history.roomNumber;
            bedNumber = history.bedNumber;
            lockerNumber = history.lockerNumber;
          }
          if (isExpiredProfile && history.allocatedTo) {
            actualExpiredAt = history.allocatedTo;
          }
        } else if (!roomNumber && student.room) {
          const Room = (await import('../models/Room.js')).default;
          const roomDoc = await Room.findById(student.room).lean();
          if (roomDoc) {
            roomNumber = roomDoc.roomNumber;
          }
        }
      }

      return {
        ...student,
        resolvedExpiryDate,
        actualExpiredAt,
        roomNumber,
        bedNumber,
        lockerNumber
      };
    })
  );
};

export const extendStudentApplicationExpiry = async ({
  studentId,
  newExpiryDate,
  reactivate = false,
  adminId,
  reason = ''
}) => {
  const student = await User.findOne({ _id: studentId, role: 'student' });
  if (!student) throw new Error('Student not found');

  const expiry = new Date(newExpiryDate);
  if (Number.isNaN(expiry.getTime())) throw new Error('Invalid expiry date');

  student.applicationExpiryDate = expiry;
  student.applicationStatus = 'Extended';
  student.applicationExpiryExtendedBy = adminId;
  student.applicationExpiryExtendedAt = new Date();

  if (reactivate && student.hostelStatus === 'Inactive') {
    student.hostelStatus = 'Active';
    await createOccupancyHistory({
      student,
      academicYear: student.academicYear,
      courseName: student.course,
      branchName: student.branch,
      yearOfStudy: student.year,
      adminId,
      expiryReason: 'manual'
    });
  }

  if (reason) {
    await RoomOccupancyHistory.updateOne(
      { student: student._id, academicYear: student.academicYear, status: { $in: ['Active', 'Extended'] } },
      { $set: { notes: reason } }
    );
  }

  await repairMissingRollNumber(student);
  await student.save({ validateModifiedOnly: true });
  return student;
};
