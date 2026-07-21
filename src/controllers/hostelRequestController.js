import HostelRequest, { HOSTEL_REQUEST_STATUSES } from '../models/HostelRequest.js';
import Hostel from '../models/Hostel.js';
import HostelCategory from '../models/HostelCategory.js';
import Room from '../models/Room.js';
import RoomOccupancyHistory from '../models/RoomOccupancyHistory.js';
import { createError } from '../utils/error.js';
import {
  createYearlyHostelRequest,
  emitOccupancyHistoryForRequest,
  closeActiveHostelRequest,
  reopenHostelRequestForYear
} from '../services/hostelRequestService.js';
import {
  isBedOccupiedByActiveRequest,
  isLockerOccupiedByActiveRequest
} from '../utils/hostelRequestOccupancyUtils.js';
import { upsertStudentMaster } from './studentMasterController.js';
import { validateAcademicYearForBatch } from '../utils/batchUtils.js';
import { fetchStudentByIdentifier, testSQLConnection } from '../utils/sqlService.js';
import { parseSqlStudentRow } from '../utils/studentAcademicEnricher.js';

const normalizeAdmission = (value) => (value || '').toString().trim().toUpperCase();

const validateAcademicYear = (academicYear) => {
  if (!academicYear || !/^\d{4}-\d{4}$/.test(academicYear)) return false;
  const [start, end] = academicYear.split('-').map(Number);
  return end === start + 1;
};

/**
 * Create a yearly hostel request — primary write path for Students module redesign.
 * Each (admissionNumber, academicYear) is independent (no renewal).
 */
export const createHostelRequest = async (req, res, next) => {
  try {
    const {
      admissionNumber,
      rollNumber,
      academicYear,
      hostelId,
      hostelCategoryId,
      roomId,
      roomNumber,
      bedNumber,
      lockerNumber,
      collegeCode: bodyCollegeCode,
      courseCode: bodyCourseCode,
      mealType,
      parentPermissionForOuting,
      concession,
      notes
    } = req.body;

    const admission = normalizeAdmission(admissionNumber);
    if (!admission) throw createError(400, 'Admission number is required');
    if (!validateAcademicYear(academicYear)) {
      throw createError(400, 'Valid academic year (YYYY-YYYY) is required');
    }
    if (!hostelId || !hostelCategoryId || !roomId || !roomNumber) {
      throw createError(400, 'Hostel, category, room, and room number are required');
    }

    const connectionTest = await testSQLConnection();
    if (!connectionTest.success) {
      throw createError(503, 'SDMS connection failed. Cannot create hostel request.');
    }

    let sqlResult = await fetchStudentByIdentifier(admission);
    if (!sqlResult.success && rollNumber) {
      sqlResult = await fetchStudentByIdentifier(rollNumber);
    }
    if (!sqlResult.success) {
      throw createError(404, 'Student not found in SDMS. Verify admission / PIN number.');
    }

    const sdms = await parseSqlStudentRow(sqlResult.data);
    const ayValidation = validateAcademicYearForBatch(sdms?.batch, sdms?.year, academicYear);
    if (!ayValidation.valid) {
      throw createError(400, ayValidation.message);
    }

    // Ensure master exists with contacts before yearly request
    await upsertStudentMaster({
      admissionNumber: admission,
      rollNumber: sdms.rollNumber || rollNumber,
      name: sdms.name,
      studentPhone: sdms.studentPhone,
      parentPhone: sdms.parentPhone,
      motherPhone: sdms.motherPhone,
      studentPhoto: sdms.studentPhoto,
      createdBy: req.admin?._id,
      syncFromSdms: false
    });

    const { hostelRequest } = await createYearlyHostelRequest({
      admissionNumber: admission,
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
      collegeCode: bodyCollegeCode,
      courseCode: bodyCourseCode,
      sdms,
      adminId: req.admin?._id,
      emitHistory: true
    });

    const populated = await HostelRequest.findById(hostelRequest._id)
      .populate('studentMasterId')
      .populate('hostelId', 'name code')
      .populate('hostelCategoryId', 'name')
      .populate('roomId', 'roomNumber bedCount')
      .lean();

    res.status(201).json({
      success: true,
      message: 'Hostel request created',
      data: populated
    });
  } catch (error) {
    next(error);
  }
};

export const listHostelRequests = async (req, res, next) => {
  try {
    const {
      academicYear,
      status,
      hostelId,
      hostelCategoryId,
      roomId,
      roomNumber,
      search,
      admissionNumber,
      page = 1,
      limit = 20
    } = req.query;

    const query = {};
    if (academicYear) query.academicYear = academicYear;
    if (status) {
      if (!HOSTEL_REQUEST_STATUSES.includes(status)) {
        throw createError(400, `Status must be one of: ${HOSTEL_REQUEST_STATUSES.join(', ')}`);
      }
      query.status = status;
    }
    if (hostelId) query.hostelId = hostelId;
    if (hostelCategoryId) query.hostelCategoryId = hostelCategoryId;
    if (roomId) query.roomId = roomId;
    if (roomNumber) query.roomNumber = roomNumber;
    if (admissionNumber) query.admissionNumber = normalizeAdmission(admissionNumber);

    if (search) {
      const term = search.trim();
      query.$or = [
        { admissionNumber: { $regex: term, $options: 'i' } },
        { sdmsRollNumber: { $regex: term, $options: 'i' } },
        { sdmsName: { $regex: term, $options: 'i' } },
        { hostelSequenceId: { $regex: term, $options: 'i' } }
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      HostelRequest.find(query)
        .populate('studentMasterId', 'admissionNumber name rollNumber studentPhone')
        .populate('hostelId', 'name code')
        .populate('hostelCategoryId', 'name')
        .populate('roomId', 'roomNumber bedCount')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      HostelRequest.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: items,
      pagination: {
        current: pageNum,
        pages: Math.ceil(total / limitNum),
        total
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getHostelRequestById = async (req, res, next) => {
  try {
    const item = await HostelRequest.findById(req.params.id)
      .populate('studentMasterId')
      .populate('hostelId', 'name code')
      .populate('hostelCategoryId', 'name')
      .populate('roomId', 'roomNumber bedCount')
      .lean();

    if (!item) throw createError(404, 'Hostel request not found');
    res.json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
};

export const updateHostelRequestStatus = async (req, res, next) => {
  try {
    const { status, statusReason } = req.body;
    if (!HOSTEL_REQUEST_STATUSES.includes(status)) {
      throw createError(400, `Status must be one of: ${HOSTEL_REQUEST_STATUSES.join(', ')}`);
    }

    const item = await HostelRequest.findById(req.params.id);
    if (!item) throw createError(404, 'Hostel request not found');

    if (status === 'expired' || status === 'cancelled') {
      if (item.status !== 'active') {
        throw createError(400, `Cannot set ${status}: request is already ${item.status}`);
      }
      const closed = await closeActiveHostelRequest({
        admissionNumber: item.admissionNumber,
        academicYear: item.academicYear,
        status,
        statusReason: statusReason || status,
        adminId: req.admin?._id
      });
      return res.json({ success: true, data: closed || item });
    }

    // Reactivate
    if (status === 'active' && item.status !== 'active') {
      const reopened = await reopenHostelRequestForYear({
        admissionNumber: item.admissionNumber,
        academicYear: item.academicYear,
        statusReason: statusReason || 'manual_reactivate',
        adminId: req.admin?._id
      });
      return res.json({ success: true, data: reopened || item });
    }

    item.status = status;
    item.statusReason = statusReason || '';
    item.updatedBy = req.admin?._id;
    await item.save();

    res.json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
};

export const updateHostelRequestAllocation = async (req, res, next) => {
  try {
    const {
      hostelId,
      hostelCategoryId,
      roomId,
      roomNumber,
      bedNumber,
      lockerNumber,
      mealType,
      parentPermissionForOuting,
      concession,
      notes
    } = req.body;

    const item = await HostelRequest.findById(req.params.id);
    if (!item) throw createError(404, 'Hostel request not found');
    if (item.status !== 'active') {
      throw createError(400, 'Only active hostel requests can be reallocated');
    }

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
      const bedTaken = await isBedOccupiedByActiveRequest(
        room,
        bedNumber,
        item.academicYear,
        item._id
      );
      if (bedTaken) throw createError(400, 'Selected bed is already occupied for this academic year');
    }
    if (lockerNumber) {
      const lockerTaken = await isLockerOccupiedByActiveRequest(
        room,
        lockerNumber,
        item.academicYear,
        item._id
      );
      if (lockerTaken) {
        throw createError(400, 'Selected locker is already occupied for this academic year');
      }
    }

    await RoomOccupancyHistory.updateMany(
      { hostelRequestId: item._id, status: 'Active', allocatedTo: null },
      { $set: { status: 'Transferred', allocatedTo: new Date(), expiryReason: 'manual' } }
    );

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
    item.updatedBy = req.admin?._id;
    await item.save();

    const StudentMaster = (await import('../models/StudentMaster.js')).default;
    const master = await StudentMaster.findById(item.studentMasterId).select('userId').lean();
    try {
      await emitOccupancyHistoryForRequest(item, master?.userId, req.admin?._id);
    } catch (histErr) {
      console.warn('Occupancy history emit failed (non-fatal):', histErr.message);
    }

    const populated = await HostelRequest.findById(item._id)
      .populate('studentMasterId')
      .populate('hostelId', 'name code')
      .populate('hostelCategoryId', 'name')
      .populate('roomId', 'roomNumber bedCount')
      .lean();

    res.json({ success: true, data: populated });
  } catch (error) {
    next(error);
  }
};
