import RoomChangeRequest from '../models/RoomChangeRequest.js';
import HostelRequest from '../models/HostelRequest.js';
import Room from '../models/Room.js';
import User from '../models/User.js';
import RoomOccupancyHistory from '../models/RoomOccupancyHistory.js';
import { emitOccupancyHistoryForRequest } from './hostelRequestService.js';
import { getISTStartOfDay } from '../utils/dateUtils.js';

const createError = (status, message) => {
  const err = new Error(message);
  err.status = status;
  err.statusCode = status;
  return err;
};

const asDate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Normalize effective date to start-of-day (IST when helper available). */
export const normalizeEffectiveDate = (value) => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return getISTStartOfDay(value) || new Date(`${value}T00:00:00`);
  }
  const d = asDate(value);
  if (!d) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
};

/**
 * Apply approved room change: close old occupancy at effectiveDate (exclusive end),
 * update HostelRequest + User, open new occupancy from effectiveDate.
 * Bed/locker are optional — no occupancy validation.
 */
export const applyApprovedRoomChange = async (request, adminId) => {
  const effectiveDate = normalizeEffectiveDate(request.effectiveDate);
  if (!effectiveDate) throw createError(400, 'Invalid effective date');

  const hostelRequest = await HostelRequest.findById(request.hostelRequestId);
  if (!hostelRequest) throw createError(404, 'Hostel request not found');
  if (hostelRequest.status !== 'active') {
    throw createError(400, 'Hostel request is not active — cannot apply room change');
  }

  const toRoom = await Room.findById(request.toRoom);
  if (!toRoom) throw createError(400, 'Destination room not found');

  const userId = request.student;

  await RoomOccupancyHistory.updateMany(
    { hostelRequestId: hostelRequest._id, status: 'Active', allocatedTo: null },
    {
      $set: {
        status: 'Transferred',
        allocatedTo: effectiveDate,
        expiryReason: 'manual',
        notes: `Room change to ${request.toRoomNumber} (effective ${effectiveDate.toISOString().slice(0, 10)})`
      }
    }
  );

  hostelRequest.hostelId = request.toHostel || toRoom.hostel;
  hostelRequest.hostelCategoryId = request.toHostelCategory || toRoom.category;
  hostelRequest.roomId = toRoom._id;
  hostelRequest.roomNumber = request.toRoomNumber || toRoom.roomNumber;
  if (request.toBedNumber) hostelRequest.bedNumber = request.toBedNumber;
  else hostelRequest.bedNumber = undefined;
  if (request.toLockerNumber) hostelRequest.lockerNumber = request.toLockerNumber;
  else hostelRequest.lockerNumber = undefined;
  hostelRequest.updatedBy = adminId || hostelRequest.updatedBy;
  await hostelRequest.save({ validateModifiedOnly: true });

  try {
    await emitOccupancyHistoryForRequest(hostelRequest, userId, adminId, 'manual', {
      allocatedFrom: effectiveDate
    });
  } catch (histErr) {
    console.warn('Occupancy history emit failed (non-fatal):', histErr.message);
  }

  if (userId) {
    await User.findByIdAndUpdate(userId, {
      $set: {
        hostel: hostelRequest.hostelId,
        hostelCategory: hostelRequest.hostelCategoryId,
        room: hostelRequest.roomId,
        roomNumber: hostelRequest.roomNumber,
        ...(request.toBedNumber ? { bedNumber: request.toBedNumber } : {}),
        ...(request.toLockerNumber ? { lockerNumber: request.toLockerNumber } : {})
      }
    });
  }

  return hostelRequest;
};

export const createRoomChangeRequest = async ({
  admissionNumber,
  academicYear,
  toRoomId,
  toBedNumber = '',
  toLockerNumber = '',
  effectiveDate,
  reason = '',
  raisedBy,
  raisedByAdmin,
  restrictHostelId = null
}) => {
  const admission = String(admissionNumber || '').trim();
  if (!admission) throw createError(400, 'Admission number is required');
  if (!academicYear) throw createError(400, 'Academic year is required');
  if (!toRoomId) throw createError(400, 'Destination room is required');

  const effective = normalizeEffectiveDate(effectiveDate);
  if (!effective) throw createError(400, 'Effective date is required');

  const tomorrow = new Date();
  tomorrow.setHours(23, 59, 59, 999);
  // Allow past and today; block far-future (> 30 days) lightly
  const maxFuture = new Date();
  maxFuture.setDate(maxFuture.getDate() + 30);
  if (effective > maxFuture) {
    throw createError(400, 'Effective date cannot be more than 30 days in the future');
  }

  const hostelRequest = await HostelRequest.findOne({
    admissionNumber: admission,
    academicYear,
    status: 'active'
  }).lean();
  if (!hostelRequest) {
    throw createError(404, 'No active hostel request for this student in the selected academic year');
  }

  if (restrictHostelId) {
    const studentHostel = String(hostelRequest.hostelId || '');
    if (studentHostel !== String(restrictHostelId)) {
      throw createError(403, 'Student is not in your assigned hostel');
    }
  }

  const toRoom = await Room.findById(toRoomId).lean();
  if (!toRoom || toRoom.isActive === false) {
    throw createError(400, 'Destination room not found or inactive');
  }

  if (restrictHostelId && String(toRoom.hostel) !== String(restrictHostelId)) {
    throw createError(403, 'Destination room is not in your assigned hostel');
  }

  if (String(hostelRequest.roomId) === String(toRoom._id)) {
    throw createError(400, 'Destination room is the same as the current room');
  }

  const pending = await RoomChangeRequest.findOne({
    hostelRequestId: hostelRequest._id,
    status: 'Pending'
  }).lean();
  if (pending) {
    throw createError(400, 'A pending room change request already exists for this student');
  }

  let userId = null;
  let studentMasterId = hostelRequest.studentMasterId || null;
  if (studentMasterId) {
    const StudentMaster = (await import('../models/StudentMaster.js')).default;
    const master = await StudentMaster.findById(studentMasterId).select('userId name rollNumber').lean();
    userId = master?.userId || null;
  }
  if (!userId) {
    const user = await User.findOne({ admissionNumber: admission }).select('_id').lean();
    userId = user?._id || null;
  }
  if (!userId) throw createError(400, 'Student user account not linked — cannot raise room change');

  return RoomChangeRequest.create({
    student: userId,
    studentMasterId,
    hostelRequestId: hostelRequest._id,
    admissionNumber: admission,
    studentName: hostelRequest.sdmsName || '',
    rollNumber: hostelRequest.sdmsRollNumber || '',
    academicYear,
    fromHostel: hostelRequest.hostelId || null,
    fromHostelCategory: hostelRequest.hostelCategoryId || null,
    fromRoom: hostelRequest.roomId || null,
    fromRoomNumber: hostelRequest.roomNumber || '',
    fromBedNumber: hostelRequest.bedNumber || '',
    fromLockerNumber: hostelRequest.lockerNumber || '',
    toHostel: toRoom.hostel,
    toHostelCategory: toRoom.category || null,
    toRoom: toRoom._id,
    toRoomNumber: toRoom.roomNumber,
    toBedNumber: toBedNumber || '',
    toLockerNumber: toLockerNumber || '',
    effectiveDate: effective,
    reason: reason || '',
    status: 'Pending',
    raisedBy,
    raisedByAdmin,
    requestedAt: new Date()
  });
};

export const listRoomChangeRequests = async ({
  academicYear,
  status,
  admissionNumber,
  page = 1,
  limit = 50,
  hostelId = null
} = {}) => {
  const filter = {};
  if (academicYear) filter.academicYear = academicYear;
  if (status) filter.status = status;
  if (admissionNumber) {
    filter.admissionNumber = String(admissionNumber).trim();
  }
  if (hostelId) {
    filter.$or = [{ fromHostel: hostelId }, { toHostel: hostelId }];
  }

  const skip = (Math.max(1, Number(page)) - 1) * Math.max(1, Number(limit));
  const [items, total] = await Promise.all([
    RoomChangeRequest.find(filter)
      .populate('fromHostel', 'name code')
      .populate('toHostel', 'name code')
      .populate('fromRoom', 'roomNumber')
      .populate('toRoom', 'roomNumber bedCount')
      .populate('raisedByAdmin', 'name email role')
      .populate('approvedBy', 'name email role')
      .populate('rejectedBy', 'name email role')
      .sort({ requestedAt: -1 })
      .skip(skip)
      .limit(Math.max(1, Number(limit)))
      .lean(),
    RoomChangeRequest.countDocuments(filter)
  ]);

  return { items, total, page: Number(page), limit: Number(limit) };
};

/** Academic-year room occupancy timeline for a student (history segments). */
export const getStudentRoomHistory = async ({ admissionNumber, academicYear, studentId } = {}) => {
  const filter = {};
  if (academicYear) filter.academicYear = academicYear;

  if (studentId) {
    filter.student = studentId;
  } else if (admissionNumber) {
    const user = await User.findOne({ admissionNumber: String(admissionNumber).trim() })
      .select('_id')
      .lean();
    if (!user) return [];
    filter.student = user._id;
  } else {
    throw createError(400, 'admissionNumber or studentId is required');
  }

  return RoomOccupancyHistory.find(filter)
    .populate('hostel', 'name code')
    .populate('hostelCategory', 'name')
    .populate('room', 'roomNumber')
    .sort({ allocatedFrom: -1, createdAt: -1 })
    .lean();
};

/**
 * Students with room-change history from the RoomChangeRequest feature only
 * (Approved requests). Ignores legacy RoomOccupancyHistory / bed-locker edits.
 */
export const listStudentsWithRoomChangeHistory = async ({
  academicYear,
  q,
  page = 1,
  limit = 100,
  hostelId = null
} = {}) => {
  if (!academicYear) throw createError(400, 'academicYear is required');

  const filter = { academicYear, status: 'Approved' };
  if (hostelId) {
    filter.$or = [{ fromHostel: hostelId }, { toHostel: hostelId }];
  }
  if (q && String(q).trim()) {
    const term = String(q).trim();
    const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const textOr = [
      { studentName: rx },
      { rollNumber: rx },
      { admissionNumber: rx }
    ];
    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, { $or: textOr }];
      delete filter.$or;
    } else {
      filter.$or = textOr;
    }
  }

  const approved = await RoomChangeRequest.find(filter)
    .sort({ effectiveDate: -1, approvedAt: -1 })
    .lean();

  const byStudent = new Map();
  for (const req of approved) {
    const key = String(req.student || req.admissionNumber);
    if (!byStudent.has(key)) {
      byStudent.set(key, {
        studentId: req.student,
        admissionNumber: req.admissionNumber || '',
        studentName: req.studentName || '',
        rollNumber: req.rollNumber || '',
        academicYear: req.academicYear,
        currentRoomNumber: req.toRoomNumber || '',
        transferCount: 0,
        changes: []
      });
    }
    const row = byStudent.get(key);
    row.transferCount += 1;
    row.changes.push({
      _id: req._id,
      fromRoomNumber: req.fromRoomNumber || '',
      toRoomNumber: req.toRoomNumber || '',
      effectiveDate: req.effectiveDate,
      approvedAt: req.approvedAt,
      raisedBy: req.raisedBy,
      reason: req.reason || ''
    });
    // Latest approved change wins as "current" (list is sorted newest first)
    if (!row._currentSet) {
      row.currentRoomNumber = req.toRoomNumber || row.currentRoomNumber;
      row._currentSet = true;
    }
  }

  const items = [...byStudent.values()].map(({ _currentSet, ...rest }) => ({
    ...rest,
    segmentCount: rest.changes.length,
    // newest first already
    segments: rest.changes
  }));

  items.sort((a, b) =>
    String(a.studentName || '').localeCompare(String(b.studentName || ''))
  );

  const skip = (Math.max(1, Number(page)) - 1) * Math.max(1, Number(limit));
  const lim = Math.max(1, Number(limit));
  return {
    items: items.slice(skip, skip + lim),
    total: items.length,
    page: Number(page),
    limit: lim
  };
};

export const approveRoomChangeRequest = async (requestId, adminId, remarks = '') => {
  const request = await RoomChangeRequest.findById(requestId);
  if (!request) throw createError(404, 'Room change request not found');
  if (request.status !== 'Pending') {
    throw createError(400, `Request is already ${request.status}`);
  }

  await applyApprovedRoomChange(request, adminId);

  request.status = 'Approved';
  request.approvedBy = adminId;
  request.approvedAt = new Date();
  request.approvalRemarks = remarks || '';
  await request.save();
  return request;
};

export const rejectRoomChangeRequest = async (requestId, adminId, rejectionReason = '') => {
  const request = await RoomChangeRequest.findById(requestId);
  if (!request) throw createError(404, 'Room change request not found');
  if (request.status !== 'Pending') {
    throw createError(400, `Request is already ${request.status}`);
  }

  request.status = 'Rejected';
  request.rejectedBy = adminId;
  request.rejectedAt = new Date();
  request.rejectionReason = rejectionReason || 'Rejected';
  await request.save();
  return request;
};
