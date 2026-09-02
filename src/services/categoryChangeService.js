import CategoryChangeRequest from '../models/CategoryChangeRequest.js';
import HostelRequest from '../models/HostelRequest.js';
import HostelCategory from '../models/HostelCategory.js';
import Room from '../models/Room.js';
import User from '../models/User.js';
import RoomOccupancyHistory from '../models/RoomOccupancyHistory.js';
import FeeStructure from '../models/FeeStructure.js';
import { emitOccupancyHistoryForRequest } from './hostelRequestService.js';
import { normalizeEffectiveDate } from './roomChangeService.js';
import { enrichStudentAcademics } from '../utils/studentAcademicEnricher.js';
import { syncStudentHostelFeeSafely } from './feesSyncService.js';

const createError = (status, message) => {
  const err = new Error(message);
  err.status = status;
  err.statusCode = status;
  return err;
};

export const recalculateHostelFeesForCategory = async ({
  user,
  academicYear,
  categoryName,
  concession = 0
}) => {
  const plain = user?.toObject ? user.toObject() : { ...user };
  const enriched = await enrichStudentAcademics(plain);

  const feeStructure = await FeeStructure.getFeeStructure(
    academicYear,
    enriched.course,
    enriched.branch,
    enriched.year,
    categoryName
  );

  if (!feeStructure) {
    throw createError(
      400,
      `No hostel fee structure found for category "${categoryName}" (${enriched.course}, year ${enriched.year}, ${academicYear})`
    );
  }

  const concessionAmount = Number(concession) || 0;
  const calculatedTerm1Fee = Math.max(0, feeStructure.term1Fee - concessionAmount);
  let remainingConcession = Math.max(0, concessionAmount - feeStructure.term1Fee);
  const calculatedTerm2Fee = Math.max(0, feeStructure.term2Fee - remainingConcession);
  remainingConcession = Math.max(0, remainingConcession - feeStructure.term2Fee);
  const calculatedTerm3Fee = Math.max(0, feeStructure.term3Fee - remainingConcession);
  const totalCalculatedFee = calculatedTerm1Fee + calculatedTerm2Fee + calculatedTerm3Fee;

  return {
    calculatedTerm1Fee,
    calculatedTerm2Fee,
    calculatedTerm3Fee,
    totalCalculatedFee,
    feeStructure
  };
};

/**
 * Apply approved category change: update HostelRequest category (+ optional room),
 * recalculate User fees, sync Fee Management Mongo.
 */
export const applyApprovedCategoryChange = async (request, adminId) => {
  const effectiveDate = normalizeEffectiveDate(request.effectiveDate);
  if (!effectiveDate) throw createError(400, 'Invalid effective date');

  const hostelRequest = await HostelRequest.findById(request.hostelRequestId);
  if (!hostelRequest) throw createError(404, 'Hostel request not found');
  if (hostelRequest.status !== 'active') {
    throw createError(400, 'Hostel request is not active — cannot apply category change');
  }

  const toCategory = await HostelCategory.findById(request.toHostelCategory).lean();
  if (!toCategory) throw createError(400, 'Destination category not found');

  const categoryName = toCategory.name || request.toCategoryName || '';
  if (!categoryName) throw createError(400, 'Destination category name is missing');

  const userId = request.student;
  let user = userId ? await User.findById(userId) : null;
  if (!user) {
    user = await User.findOne({ admissionNumber: request.admissionNumber });
  }
  if (!user) throw createError(400, 'Student user account not found');

  const previousTotalFee = Number(user.totalCalculatedFee || 0);
  const feeCalc = await recalculateHostelFeesForCategory({
    user,
    academicYear: request.academicYear,
    categoryName,
    concession: user.concession
  });

  const hadRoom = Boolean(hostelRequest.roomId);
  const categoryChanging =
    String(hostelRequest.hostelCategoryId) !== String(request.toHostelCategory);
  const roomChanging =
    request.toRoom && String(hostelRequest.roomId || '') !== String(request.toRoom);

  if (roomChanging) {
    await RoomOccupancyHistory.updateMany(
      { hostelRequestId: hostelRequest._id, status: 'Active', allocatedTo: null },
      {
        $set: {
          status: 'Transferred',
          allocatedTo: effectiveDate,
          expiryReason: 'manual',
          notes: `Category change to ${categoryName}, room ${request.toRoomNumber || ''} (effective ${effectiveDate.toISOString().slice(0, 10)})`
        }
      }
    );
  } else if (hadRoom && categoryChanging && !request.toRoom) {
    await RoomOccupancyHistory.updateMany(
      { hostelRequestId: hostelRequest._id, status: 'Active', allocatedTo: null },
      {
        $set: {
          status: 'Transferred',
          allocatedTo: effectiveDate,
          expiryReason: 'manual',
          notes: `Category change to ${categoryName} — room cleared (effective ${effectiveDate.toISOString().slice(0, 10)})`
        }
      }
    );
  }

  hostelRequest.hostelCategoryId = request.toHostelCategory;

  if (request.toRoom) {
    const toRoom = await Room.findById(request.toRoom);
    if (!toRoom) throw createError(400, 'Destination room not found');
    if (String(toRoom.category) !== String(request.toHostelCategory)) {
      throw createError(400, 'Destination room does not belong to the selected category');
    }
    hostelRequest.hostelId = toRoom.hostel;
    hostelRequest.roomId = toRoom._id;
    hostelRequest.roomNumber = request.toRoomNumber || toRoom.roomNumber;
    hostelRequest.bedNumber = request.toBedNumber || undefined;
    hostelRequest.lockerNumber = request.toLockerNumber || undefined;
  } else if (categoryChanging && hadRoom) {
    hostelRequest.roomId = undefined;
    hostelRequest.roomNumber = undefined;
    hostelRequest.bedNumber = undefined;
    hostelRequest.lockerNumber = undefined;
  }

  hostelRequest.updatedBy = adminId || hostelRequest.updatedBy;
  await hostelRequest.save({ validateModifiedOnly: true });

  if (request.toRoom && roomChanging) {
    try {
      await emitOccupancyHistoryForRequest(hostelRequest, user._id, adminId, 'manual', {
        allocatedFrom: effectiveDate
      });
    } catch (histErr) {
      console.warn('Occupancy history emit failed (non-fatal):', histErr.message);
    }
  }

  user.category = categoryName;
  user.hostelCategory = request.toHostelCategory;
  user.hostel = hostelRequest.hostelId;
  user.calculatedTerm1Fee = feeCalc.calculatedTerm1Fee;
  user.calculatedTerm2Fee = feeCalc.calculatedTerm2Fee;
  user.calculatedTerm3Fee = feeCalc.calculatedTerm3Fee;
  user.totalCalculatedFee = feeCalc.totalCalculatedFee;

  if (request.toRoom) {
    user.room = hostelRequest.roomId;
    user.roomNumber = hostelRequest.roomNumber;
    if (request.toBedNumber) user.bedNumber = request.toBedNumber;
    else user.bedNumber = undefined;
    if (request.toLockerNumber) user.lockerNumber = request.toLockerNumber;
    else user.lockerNumber = undefined;
  } else if (categoryChanging && hadRoom) {
    user.room = undefined;
    user.roomNumber = undefined;
    user.bedNumber = undefined;
    user.lockerNumber = undefined;
  }

  await user.save({ validateModifiedOnly: true });

  await syncStudentHostelFeeSafely(user, { academicYear: request.academicYear });

  request.previousTotalFee = previousTotalFee;
  request.newTotalFee = feeCalc.totalCalculatedFee;

  return { hostelRequest, user, feeCalc };
};

export const createCategoryChangeRequest = async ({
  admissionNumber,
  academicYear,
  toCategoryId,
  toRoomId = null,
  toBedNumber = '',
  toLockerNumber = '',
  effectiveDate,
  reason = '',
  raisedBy,
  raisedByAdmin,
  raisedByName = '',
  restrictHostelId = null
}) => {
  const admission = String(admissionNumber || '').trim();
  if (!admission) throw createError(400, 'Admission number is required');
  if (!academicYear) throw createError(400, 'Academic year is required');
  if (!toCategoryId) throw createError(400, 'Destination category is required');

  const effective = normalizeEffectiveDate(effectiveDate);
  if (!effective) throw createError(400, 'Effective date is required');

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

  const toCategory = await HostelCategory.findById(toCategoryId).lean();
  if (!toCategory) throw createError(400, 'Destination category not found');

  if (restrictHostelId && String(toCategory.hostel) !== String(restrictHostelId)) {
    throw createError(403, 'Destination category is not in your assigned hostel');
  }

  if (String(hostelRequest.hostelCategoryId) === String(toCategoryId)) {
    throw createError(400, 'Destination category is the same as the current category');
  }

  let toRoom = null;
  if (toRoomId) {
    toRoom = await Room.findById(toRoomId).lean();
    if (!toRoom || toRoom.isActive === false) {
      throw createError(400, 'Destination room not found or inactive');
    }
    if (String(toRoom.category) !== String(toCategoryId)) {
      throw createError(400, 'Destination room does not belong to the selected category');
    }
    if (restrictHostelId && String(toRoom.hostel) !== String(restrictHostelId)) {
      throw createError(403, 'Destination room is not in your assigned hostel');
    }
  }

  const fromCategory = await HostelCategory.findById(hostelRequest.hostelCategoryId)
    .select('name')
    .lean();

  const pending = await CategoryChangeRequest.findOne({
    hostelRequestId: hostelRequest._id,
    status: 'Pending'
  }).lean();
  if (pending) {
    throw createError(400, 'A pending category change request already exists for this student');
  }

  let userId = null;
  let studentMasterId = hostelRequest.studentMasterId || null;
  if (studentMasterId) {
    const StudentMaster = (await import('../models/StudentMaster.js')).default;
    const master = await StudentMaster.findById(studentMasterId).select('userId').lean();
    userId = master?.userId || null;
  }
  if (!userId) {
    const user = await User.findOne({ admissionNumber: admission }).select('_id').lean();
    userId = user?._id || null;
  }
  if (!userId) throw createError(400, 'Student user account not linked — cannot raise category change');

  return CategoryChangeRequest.create({
    student: userId,
    studentMasterId,
    hostelRequestId: hostelRequest._id,
    admissionNumber: admission,
    studentName: hostelRequest.sdmsName || '',
    rollNumber: hostelRequest.sdmsRollNumber || '',
    academicYear,
    fromHostel: hostelRequest.hostelId || null,
    fromHostelCategory: hostelRequest.hostelCategoryId,
    fromCategoryName: fromCategory?.name || '',
    fromRoom: hostelRequest.roomId || null,
    fromRoomNumber: hostelRequest.roomNumber || '',
    fromBedNumber: hostelRequest.bedNumber || '',
    fromLockerNumber: hostelRequest.lockerNumber || '',
    toHostelCategory: toCategory._id,
    toCategoryName: toCategory.name || '',
    toRoom: toRoom?._id || null,
    toRoomNumber: toRoom?.roomNumber || '',
    toBedNumber: toBedNumber || '',
    toLockerNumber: toLockerNumber || '',
    effectiveDate: effective,
    reason: reason || '',
    status: 'Pending',
    raisedBy,
    raisedByAdmin,
    raisedByName: raisedByName || '',
    requestedAt: new Date()
  });
};

export const listCategoryChangeRequests = async ({
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
  if (admissionNumber) filter.admissionNumber = String(admissionNumber).trim();
  if (hostelId) {
    filter.$or = [{ fromHostel: hostelId }];
  }

  const skip = (Math.max(1, Number(page)) - 1) * Math.max(1, Number(limit));
  const [items, total] = await Promise.all([
    CategoryChangeRequest.find(filter)
      .populate('fromHostelCategory', 'name')
      .populate('toHostelCategory', 'name')
      .populate('fromRoom', 'roomNumber')
      .populate('toRoom', 'roomNumber')
      .populate('raisedByAdmin', 'name email role')
      .populate('approvedBy', 'name email role')
      .populate('rejectedBy', 'name email role')
      .sort({ requestedAt: -1 })
      .skip(skip)
      .limit(Math.max(1, Number(limit)))
      .lean(),
    CategoryChangeRequest.countDocuments(filter)
  ]);

  return { items, total, page: Number(page), limit: Number(limit) };
};

export const listStudentsWithCategoryChangeHistory = async ({
  academicYear,
  q,
  page = 1,
  limit = 100,
  hostelId = null
} = {}) => {
  if (!academicYear) throw createError(400, 'academicYear is required');

  const filter = { academicYear, status: 'Approved' };
  if (hostelId) filter.fromHostel = hostelId;
  if (q && String(q).trim()) {
    const term = String(q).trim();
    const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ studentName: rx }, { rollNumber: rx }, { admissionNumber: rx }];
  }

  const approved = await CategoryChangeRequest.find(filter)
    .populate('raisedByAdmin', 'name username role')
    .populate('approvedBy', 'name username role')
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
        currentCategoryName: req.toCategoryName || '',
        transferCount: 0,
        changes: []
      });
    }
    const row = byStudent.get(key);
    row.transferCount += 1;
    row.changes.push({
      _id: req._id,
      fromCategoryName: req.fromCategoryName || '',
      toCategoryName: req.toCategoryName || '',
      fromRoomNumber: req.fromRoomNumber || '',
      toRoomNumber: req.toRoomNumber || '',
      previousTotalFee: req.previousTotalFee,
      newTotalFee: req.newTotalFee,
      effectiveDate: req.effectiveDate,
      approvedAt: req.approvedAt,
      raisedBy: req.raisedBy,
      raisedByName:
        req.raisedByName ||
        req.raisedByAdmin?.name ||
        req.raisedByAdmin?.username ||
        '',
      approvedByName:
        req.approvedByName ||
        req.approvedBy?.name ||
        req.approvedBy?.username ||
        '',
      reason: req.reason || ''
    });
    if (!row._currentSet) {
      row.currentCategoryName = req.toCategoryName || row.currentCategoryName;
      row._currentSet = true;
    }
  }

  const items = [...byStudent.values()].map(({ _currentSet, ...rest }) => ({
    ...rest,
    segmentCount: rest.changes.length,
    segments: rest.changes
  }));

  items.sort((a, b) => String(a.studentName || '').localeCompare(String(b.studentName || '')));

  const skip = (Math.max(1, Number(page)) - 1) * Math.max(1, Number(limit));
  const lim = Math.max(1, Number(limit));
  return { items: items.slice(skip, skip + lim), total: items.length, page: Number(page), limit: lim };
};

export const approveCategoryChangeRequest = async (requestId, adminId, remarks = '', approvedByName = '') => {
  const request = await CategoryChangeRequest.findById(requestId);
  if (!request) throw createError(404, 'Category change request not found');
  if (request.status !== 'Pending') {
    throw createError(400, `Request is already ${request.status}`);
  }

  await applyApprovedCategoryChange(request, adminId);

  request.status = 'Approved';
  request.approvedBy = adminId;
  request.approvedByName = approvedByName || '';
  request.approvedAt = new Date();
  request.approvalRemarks = remarks || '';
  await request.save();

  return request;
};

export const rejectCategoryChangeRequest = async (requestId, adminId, rejectionReason = '', rejectedByName = '') => {
  const request = await CategoryChangeRequest.findById(requestId);
  if (!request) throw createError(404, 'Category change request not found');
  if (request.status !== 'Pending') {
    throw createError(400, `Request is already ${request.status}`);
  }

  request.status = 'Rejected';
  request.rejectedBy = adminId;
  request.rejectedByName = rejectedByName || '';
  request.rejectedAt = new Date();
  request.rejectionReason = rejectionReason || 'Rejected';
  await request.save();
  return request;
};

export const previewCategoryChangeFee = async ({ admissionNumber, academicYear, toCategoryId }) => {
  const admission = String(admissionNumber || '').trim();
  if (!admission || !academicYear || !toCategoryId) {
    throw createError(400, 'admissionNumber, academicYear, and toCategoryId are required');
  }

  const toCategory = await HostelCategory.findById(toCategoryId).select('name').lean();
  if (!toCategory?.name) throw createError(400, 'Category not found');

  const user = await User.findOne({ admissionNumber: admission });
  if (!user) throw createError(404, 'Student not found');

  const feeCalc = await recalculateHostelFeesForCategory({
    user,
    academicYear,
    categoryName: toCategory.name,
    concession: user.concession
  });

  return {
    categoryName: toCategory.name,
    previousTotalFee: Number(user.totalCalculatedFee || 0),
    newTotalFee: feeCalc.totalCalculatedFee,
    term1Fee: feeCalc.calculatedTerm1Fee,
    term2Fee: feeCalc.calculatedTerm2Fee,
    term3Fee: feeCalc.calculatedTerm3Fee
  };
};
