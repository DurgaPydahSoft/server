import HostelRequest from '../models/HostelRequest.js';
import Hostel from '../models/Hostel.js';
import HostelCategory from '../models/HostelCategory.js';
import Room from '../models/Room.js';
import RoomOccupancyHistory from '../models/RoomOccupancyHistory.js';
import StudentMaster from '../models/StudentMaster.js';
import { createError } from '../utils/error.js';
import { generateHostelSequenceId } from '../utils/hostelSequenceGenerator.js';
import {
  countActiveRequestsInRoom,
  isBedOccupiedByActiveRequest,
  isLockerOccupiedByActiveRequest
} from '../utils/hostelRequestOccupancyUtils.js';

const normalizeAdmission = (value) => (value || '').toString().trim().toUpperCase();

export const resolveCollegeCode = (sdms, bodyCollegeCode, studentCollege) => {
  if (bodyCollegeCode) return String(bodyCollegeCode).trim().toUpperCase();
  const college = sdms?.college || studentCollege;
  if (!college) return null;
  if (typeof college === 'string') return college.trim().toUpperCase();
  return (college.code || college.name || '').toString().trim().toUpperCase() || null;
};

// Course data lives in SDMS (SQL) — derive the sequence code from the SDMS course
// name directly instead of looking up the Mongo Course model.
export const resolveCourseCode = async (sdms, bodyCourseCode, courseName) => {
  if (bodyCourseCode) return String(bodyCourseCode).trim().toUpperCase();
  const name = sdms?.course || courseName;
  if (name) {
    return String(name).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8) || null;
  }
  return null;
};

const mapHistoryStatus = (requestStatus) => {
  if (requestStatus === 'active') return 'Active';
  if (requestStatus === 'expired') return 'Expired';
  if (requestStatus === 'cancelled') return 'Withdrawn';
  return 'Active';
};

export const emitOccupancyHistoryForRequest = async (
  hostelRequest,
  userId,
  adminId,
  expiryReason = 'registration'
) => {
  if (!userId) return null;

  return RoomOccupancyHistory.create({
    student: userId,
    studentName: hostelRequest.sdmsName,
    rollNumber: hostelRequest.sdmsRollNumber || hostelRequest.admissionNumber,
    course: hostelRequest.sdmsCourse,
    branch: hostelRequest.sdmsBranch,
    yearOfStudy: hostelRequest.sdmsYearOfStudy,
    academicYear: hostelRequest.academicYear,
    hostel: hostelRequest.hostelId,
    hostelCategory: hostelRequest.hostelCategoryId,
    room: hostelRequest.roomId,
    roomNumber: hostelRequest.roomNumber,
    bedNumber: hostelRequest.bedNumber,
    lockerNumber: hostelRequest.lockerNumber,
    allocatedFrom: hostelRequest.allocatedAt || new Date(),
    allocatedTo: null,
    status: mapHistoryStatus(hostelRequest.status),
    expiryReason,
    createdBy: adminId || null,
    hostelRequestId: hostelRequest._id
  });
};

/**
 * Upsert StudentMaster + create HostelRequest for one academic year.
 * Used by POST /api/hostel-requests and by addStudent dual-write (Phase 2).
 */
export const createYearlyHostelRequest = async ({
  admissionNumber,
  academicYear,
  hostelId,
  hostelCategoryId,
  roomId,
  roomNumber,
  bedNumber,
  lockerNumber,
  mealType = 'veg',
  parentPermissionForOuting = true,
  concession = 0,
  notes = '',
  collegeCode: bodyCollegeCode,
  courseCode: bodyCourseCode,
  sdms = null,
  userId = null,
  adminId = null,
  skipOccupancyChecks = false,
  emitHistory = true
}) => {
  const admission = normalizeAdmission(admissionNumber);
  if (!admission) throw createError(400, 'Admission number is required');
  if (!academicYear || !/^\d{4}-\d{4}$/.test(academicYear)) {
    throw createError(400, 'Valid academic year (YYYY-YYYY) is required');
  }

  const existingRequest = await HostelRequest.findOne({
    admissionNumber: admission,
    academicYear
  });
  if (existingRequest) {
    throw createError(
      400,
      `Hostel request already exists for admission ${admission} in academic year ${academicYear}`
    );
  }

  const hostel = await Hostel.findById(hostelId);
  if (!hostel) throw createError(400, 'Invalid hostel');
  if (!hostel.code) {
    throw createError(400, 'Hostel code is required. Set a code on the hostel before allocating.');
  }

  const category = await HostelCategory.findOne({ _id: hostelCategoryId, hostel: hostelId });
  if (!category) throw createError(400, 'Invalid category for the selected hostel');

  const room = await Room.findOne({ _id: roomId, hostel: hostelId, category: hostelCategoryId });
  if (!room) throw createError(400, 'Invalid room for the selected hostel/category');
  if (String(room.roomNumber) !== String(roomNumber)) {
    throw createError(400, 'Room number does not match the selected room');
  }

  if (!skipOccupancyChecks) {
    const activeCount = await countActiveRequestsInRoom(room, academicYear);
    if (activeCount >= room.bedCount) {
      throw createError(400, 'Room is full for this academic year');
    }
    if (bedNumber) {
      const bedTaken = await isBedOccupiedByActiveRequest(room, bedNumber, academicYear);
      if (bedTaken) throw createError(400, 'Selected bed is already occupied for this academic year');
    }
    if (lockerNumber) {
      const lockerTaken = await isLockerOccupiedByActiveRequest(room, lockerNumber, academicYear);
      if (lockerTaken) {
        throw createError(400, 'Selected locker is already occupied for this academic year');
      }
    }
  }

  const collegeCode = resolveCollegeCode(sdms, bodyCollegeCode);
  const courseCode = await resolveCourseCode(sdms, bodyCourseCode);
  if (!collegeCode) throw createError(400, 'College code is required (from SDMS or request body)');
  if (!courseCode) throw createError(400, 'Course code is required (from SDMS or request body)');

  const sequence = await generateHostelSequenceId({
    academicYear,
    collegeCode,
    courseCode,
    hostelCode: hostel.code
  });

  let master = await StudentMaster.findOne({ admissionNumber: admission });
  let createdMaster = false;
  if (!master) {
    master = await StudentMaster.create({
      admissionNumber: admission,
      userId: userId || undefined,
      name: sdms?.name,
      rollNumber: normalizeAdmission(sdms?.rollNumber),
      studentPhone: sdms?.studentPhone,
      parentPhone: sdms?.parentPhone,
      motherPhone: sdms?.motherPhone,
      studentPhoto: sdms?.studentPhoto,
      createdBy: adminId || undefined,
      lastSdmsSyncAt: sdms ? new Date() : undefined
    });
    createdMaster = true;
  } else {
    const updates = {};
    if (userId && !master.userId) updates.userId = userId;
    if (sdms?.name) updates.name = sdms.name;
    if (sdms?.rollNumber) updates.rollNumber = normalizeAdmission(sdms.rollNumber);
    if (sdms?.studentPhone) updates.studentPhone = sdms.studentPhone;
    if (sdms?.parentPhone) updates.parentPhone = sdms.parentPhone;
    if (sdms) updates.lastSdmsSyncAt = new Date();
    if (Object.keys(updates).length) {
      Object.assign(master, updates);
      await master.save();
    }
  }

  let hostelRequest;
  try {
    hostelRequest = await HostelRequest.create({
      studentMasterId: master._id,
      admissionNumber: admission,
      academicYear,
      status: 'active',
      hostelId,
      hostelCategoryId,
      roomId,
      roomNumber,
      bedNumber: bedNumber || undefined,
      lockerNumber: lockerNumber || undefined,
      collegeCode: sequence.collegeCode,
      courseCode: sequence.courseCode,
      hostelCode: sequence.hostelCode,
      yearlySequenceNumber: sequence.yearlySequenceNumber,
      hostelSequenceId: sequence.hostelSequenceId,
      sdmsRollNumber: sdms?.rollNumber ? normalizeAdmission(sdms.rollNumber) : undefined,
      sdmsName: sdms?.name,
      sdmsGender: sdms?.gender || undefined,
      sdmsCourse: sdms?.course,
      sdmsBranch: sdms?.branch,
      sdmsYearOfStudy: sdms?.year,
      sdmsBatch: sdms?.batch,
      sdmsCollegeName: sdms?.college?.name || (typeof sdms?.college === 'string' ? sdms.college : ''),
      sdmsSyncedAt: sdms ? new Date() : undefined,
      mealType: mealType || 'veg',
      parentPermissionForOuting: Boolean(parentPermissionForOuting),
      concession: Number(concession) || 0,
      allocatedAt: new Date(),
      createdBy: adminId || undefined,
      notes: notes || ''
    });
  } catch (error) {
    if (createdMaster) {
      await StudentMaster.deleteOne({ _id: master._id });
    }
    throw error;
  }

  if (emitHistory) {
    try {
      await emitOccupancyHistoryForRequest(hostelRequest, userId || master.userId, adminId);
    } catch (histErr) {
      console.warn('Occupancy history emit failed (non-fatal):', histErr.message);
    }
  }

  return { master, hostelRequest, sequence };
};

/**
 * Close an active HostelRequest (expired | cancelled).
 * Also closes linked occupancy-history rows and deactivates fee reminders.
 * Phase 4 lifecycle helper used by expiry job, NOC, and admin inactive.
 */
export const closeActiveHostelRequest = async ({
  admissionNumber,
  academicYear,
  userId = null,
  status = 'expired',
  statusReason = '',
  adminId = null
}) => {
  if (!['expired', 'cancelled'].includes(status)) {
    throw createError(400, 'closeActiveHostelRequest status must be expired or cancelled');
  }

  const admission = normalizeAdmission(admissionNumber);
  if (!admission || !academicYear) return null;

  const item = await HostelRequest.findOne({
    admissionNumber: admission,
    academicYear,
    status: 'active'
  });
  if (!item) return null;

  item.status = status;
  item.statusReason = statusReason || status;
  item.updatedBy = adminId || item.updatedBy;
  if (status === 'expired') {
    item.expiredAt = new Date();
  } else {
    item.cancelledAt = new Date();
  }
  await item.save();

  const historyStatus = status === 'cancelled' ? 'Withdrawn' : 'Expired';
  await RoomOccupancyHistory.updateMany(
    { hostelRequestId: item._id, status: { $in: ['Active', 'Extended'] }, allocatedTo: null },
    {
      $set: {
        status: historyStatus,
        allocatedTo: new Date(),
        expiryReason: statusReason || status
      }
    }
  );

  try {
    const FeeReminder = (await import('../models/FeeReminder.js')).default;
    const feeQuery = {
      isActive: true,
      $or: [{ hostelRequestId: item._id }]
    };
    if (userId) {
      feeQuery.$or.push({ student: userId, academicYear });
    }
    feeQuery.$or.push({ admissionNumber: admission, academicYear });

    await FeeReminder.updateMany(feeQuery, { $set: { isActive: false } });
  } catch (err) {
    console.error('Failed to deactivate fee reminders for hostel request close:', err.message);
  }

  return item;
};

/** Resolve admission from a User doc and close their active request for the year. */
export const closeActiveHostelRequestForUser = async (user, options = {}) => {
  if (!user) return null;
  const academicYear = options.academicYear || user.academicYear;
  const admission = normalizeAdmission(user.admissionNumber);
  if (!admission || !academicYear) return null;

  return closeActiveHostelRequest({
    admissionNumber: admission,
    academicYear,
    userId: user._id,
    status: options.status || 'expired',
    statusReason: options.statusReason || options.reason || '',
    adminId: options.adminId || null
  });
};

/**
 * Re-open a HostelRequest closed by NOC (or similar) when NOC is deleted/reverted.
 */
export const reopenHostelRequestForYear = async ({
  admissionNumber,
  academicYear,
  userId = null,
  statusReason = 'noc_reverted',
  adminId = null
}) => {
  const admission = normalizeAdmission(admissionNumber);
  if (!admission || !academicYear) return null;

  const item = await HostelRequest.findOne({
    admissionNumber: admission,
    academicYear,
    status: { $in: ['cancelled', 'expired'] }
  }).sort({ updatedAt: -1 });

  if (!item) return null;

  item.status = 'active';
  item.statusReason = statusReason;
  item.expiredAt = undefined;
  item.cancelledAt = undefined;
  item.updatedBy = adminId || item.updatedBy;
  await item.save();

  await RoomOccupancyHistory.updateMany(
    {
      hostelRequestId: item._id,
      status: { $in: ['Withdrawn', 'Expired'] },
      expiryReason: { $in: ['noc', 'admin_inactive', 'cancelled', 'expired'] }
    },
    {
      $set: { status: 'Active' },
      $unset: { allocatedTo: 1, expiryReason: 1 }
    }
  );

  try {
    const FeeReminder = (await import('../models/FeeReminder.js')).default;
    const feeQuery = {
      $or: [{ hostelRequestId: item._id }, { admissionNumber: admission, academicYear }]
    };
    if (userId) feeQuery.$or.push({ student: userId, academicYear });
    await FeeReminder.updateMany(feeQuery, { $set: { isActive: true } });
  } catch (err) {
    console.error('Failed to reactivate fee reminders for hostel request reopen:', err.message);
  }

  return item;
};

/**
 * Overlay the student's HostelRequest onto a User DTO for login/profile.
 * Allocation SOT is HostelRequest — User yearly room fields are no longer written (Phase 6).
 */
export const overlayStudentDtoWithHostelRequest = async (student, academicYear = null) => {
  if (!student) return student;
  const admission = normalizeAdmission(student.admissionNumber);
  const ay = academicYear || student.academicYear;
  if (!admission || !ay) return student;

  const request = await HostelRequest.findOne({
    admissionNumber: admission,
    academicYear: ay
  })
    .populate('hostelId', '_id name code')
    .populate('hostelCategoryId', '_id name')
    .lean();

  if (!request) return student;

  const { overlayStudentWithHostelRequest } = await import('../utils/hostelRequestListDto.js');
  return overlayStudentWithHostelRequest(student, request, ay);
};

/**
 * Update active HostelRequest allocation for admission + academic year.
 * Phase 6: allocation edits write here — not onto User yearly fields.
 */
export const updateActiveRequestAllocationForAdmission = async ({
  admissionNumber,
  academicYear,
  hostelId,
  hostelCategoryId,
  roomId,
  roomNumber,
  bedNumber,
  lockerNumber,
  mealType,
  parentPermissionForOuting,
  concession,
  notes,
  adminId = null,
  userId = null
}) => {
  const admission = normalizeAdmission(admissionNumber);
  if (!admission || !academicYear) return null;

  const item = await HostelRequest.findOne({
    admissionNumber: admission,
    academicYear,
    status: 'active'
  });
  if (!item) return null;

  const nextHostelId = hostelId || item.hostelId;
  const nextCategoryId = hostelCategoryId || item.hostelCategoryId;
  const nextRoomId = roomId || item.roomId;
  const nextRoomNumber = roomNumber || item.roomNumber;

  const hostel = await Hostel.findById(nextHostelId);
  if (!hostel) throw createError(400, 'Invalid hostel');

  const category = await HostelCategory.findOne({ _id: nextCategoryId, hostel: nextHostelId });
  if (!category) throw createError(400, 'Invalid category for the selected hostel');

  const room = await Room.findOne({ _id: nextRoomId, hostel: nextHostelId, category: nextCategoryId });
  if (!room) throw createError(400, 'Invalid room for the selected hostel/category');

  if (bedNumber) {
    const bedTaken = await isBedOccupiedByActiveRequest(room, bedNumber, academicYear, item._id);
    if (bedTaken) throw createError(400, 'Selected bed is already occupied for this academic year');
  }
  if (lockerNumber) {
    const lockerTaken = await isLockerOccupiedByActiveRequest(
      room,
      lockerNumber,
      academicYear,
      item._id
    );
    if (lockerTaken) throw createError(400, 'Selected locker is already occupied for this academic year');
  }

  const allocationChanged =
    String(item.hostelId) !== String(nextHostelId) ||
    String(item.hostelCategoryId) !== String(nextCategoryId) ||
    String(item.roomId) !== String(nextRoomId) ||
    String(item.roomNumber) !== String(nextRoomNumber) ||
    (bedNumber !== undefined && String(item.bedNumber || '') !== String(bedNumber || '')) ||
    (lockerNumber !== undefined && String(item.lockerNumber || '') !== String(lockerNumber || ''));

  if (allocationChanged) {
    await RoomOccupancyHistory.updateMany(
      { hostelRequestId: item._id, status: 'Active', allocatedTo: null },
      { $set: { status: 'Transferred', allocatedTo: new Date(), expiryReason: 'manual' } }
    );
  }

  item.hostelId = nextHostelId;
  item.hostelCategoryId = nextCategoryId;
  item.roomId = nextRoomId;
  item.roomNumber = nextRoomNumber;
  if (bedNumber !== undefined) item.bedNumber = bedNumber || undefined;
  if (lockerNumber !== undefined) item.lockerNumber = lockerNumber || undefined;
  if (mealType) item.mealType = mealType;
  if (parentPermissionForOuting !== undefined) {
    item.parentPermissionForOuting = Boolean(parentPermissionForOuting);
  }
  if (concession !== undefined) item.concession = Number(concession) || 0;
  if (notes !== undefined) item.notes = notes;
  item.updatedBy = adminId || item.updatedBy;
  await item.save();

  if (allocationChanged) {
    try {
      await emitOccupancyHistoryForRequest(item, userId, adminId);
    } catch (histErr) {
      console.warn('Occupancy history emit failed (non-fatal):', histErr.message);
    }
  }

  return item;
};
