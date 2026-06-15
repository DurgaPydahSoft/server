import ApplicationExpiryConfig from '../models/ApplicationExpiryConfig.js';
import RoomOccupancyHistory from '../models/RoomOccupancyHistory.js';
import HostelCategory from '../models/HostelCategory.js';
import User from '../models/User.js';
import FeeReminder from '../models/FeeReminder.js';
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
  manualExpiryDate = null
}) => {
  if (manualExpiryDate) {
    const d = new Date(manualExpiryDate);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const endYear = getAcademicYearEndYear(academicYear);
  if (!endYear || !courseName || !yearOfStudy || !academicYear) return null;

  const config = await ApplicationExpiryConfig.findOne({
    academicYear,
    courseName: courseName.trim(),
    yearOfStudy: Number(yearOfStudy),
    isActive: true
  }).lean();

  if (!config) return null;

  return buildDateInYear(endYear, config.expiryMonth, config.expiryDay);
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

export const expireStudentApplication = async (student, reason = 'academic_year_end') => {
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

/**
 * Daily job: expire active students when settings-based (or extended) expiry date has passed.
 */
export const processDueApplicationExpiries = async () => {
  const today = new Date();
  today.setHours(23, 59, 59, 999);

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
      manualExpiryDate: useManual ? student.applicationExpiryDate : null
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

  return {
    processed: activeStudents.length,
    expired,
    skippedNoConfig
  };
};

/** Overlay a student's profile with room/category from a specific academic year enrollment. */
export const overlayStudentWithEnrollmentHistory = (student, history) => {
  if (!history) {
    return {
      ...student,
      currentAcademicYear: student.academicYear,
      isHistoricalView: false
    };
  }

  const wasActive = history.status === 'Active' && !history.allocatedTo;
  const hostelCategory =
    history.hostelCategory && typeof history.hostelCategory === 'object'
      ? history.hostelCategory
      : student.hostelCategory;

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
    hostelStatus: wasActive ? 'Active' : 'Inactive',
    applicationStatus: wasActive ? student.applicationStatus || 'Active' : 'Expired',
    enrollmentHistoryStatus: history.status,
    isHistoricalView: student.academicYear !== history.academicYear,
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
  academicFilters = {}
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

  if (hostelStatus === 'Active') {
    histories = histories.filter((h) => h.status === 'Active' && !h.allocatedTo);
  } else if (hostelStatus === 'Inactive') {
    histories = histories.filter((h) => h.status !== 'Active' || h.allocatedTo);
  }

  const studentIdSet = new Set(histories.map((h) => h.student.toString()));

  const liveQuery = { role: 'student', academicYear };
  if (gender) liveQuery.gender = gender;
  if (batch) liveQuery.batch = batch;
  if (roomNumber) liveQuery.roomNumber = roomNumber;
  if (hostel) liveQuery.hostel = hostel;
  if (category) liveQuery.category = category;
  if (hostelStatus === 'Active') liveQuery.hostelStatus = 'Active';
  if (hostelStatus === 'Inactive') liveQuery.hostelStatus = 'Inactive';
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
    return overlayStudentWithEnrollmentHistory(user, history);
  });

  students = await enrichStudentsAcademics(students);

  students = students.map((student) => {
    const history = historyByStudent.get(student._id.toString());
    if (!history) return student;
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

  if (hasAcademicFilter) {
    students = students.filter((s) => matchesAcademicFilters(s, academicFilters));
  }

  const count = students.length;
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  students = students.slice((pageNum - 1) * limitNum, pageNum * limitNum);

  return { students, count };
};

/** Attach resolved application expiry date for list/detail display. */
export const attachResolvedExpiryDates = async (students) => {
  if (!students?.length) return students;

  return Promise.all(
    students.map(async (student) => {
      const useManual =
        student.applicationStatus === 'Extended' && student.applicationExpiryDate;
      const resolvedExpiryDate = await resolveApplicationExpiryDate({
        academicYear: student.academicYear,
        courseName: student.course,
        yearOfStudy: student.year,
        manualExpiryDate: useManual ? student.applicationExpiryDate : null
      });
      return { ...student, resolvedExpiryDate };
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
