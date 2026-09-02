import HostelRequest from '../models/HostelRequest.js';
import {
  createCategoryChangeRequest,
  listCategoryChangeRequests,
  listStudentsWithCategoryChangeHistory,
  approveCategoryChangeRequest,
  rejectCategoryChangeRequest,
  previewCategoryChangeFee
} from '../services/categoryChangeService.js';

const getActor = (req) => {
  const admin = req.admin || req.warden || req.user;
  const role = admin?.role === 'warden' ? 'warden' : 'admin';
  const actorName = admin?.name?.trim() || admin?.username?.trim() || '';
  return { adminId: admin?._id, raisedBy: role, actorName };
};

const getWardenHostelId = (req) => {
  const warden = req.warden;
  if (!warden || warden.role !== 'warden') return null;
  return warden.assignedHostelId?._id || warden.assignedHostelId || null;
};

export const createCategoryChange = async (req, res, next) => {
  try {
    const { adminId, raisedBy, actorName } = getActor(req);
    if (!adminId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const {
      admissionNumber,
      academicYear,
      toCategoryId,
      toRoomId,
      toBedNumber,
      toLockerNumber,
      effectiveDate,
      reason
    } = req.body;

    const doc = await createCategoryChangeRequest({
      admissionNumber,
      academicYear,
      toCategoryId,
      toRoomId: toRoomId || null,
      toBedNumber,
      toLockerNumber,
      effectiveDate,
      reason,
      raisedBy,
      raisedByAdmin: adminId,
      raisedByName: actorName,
      restrictHostelId: getWardenHostelId(req)
    });

    res.status(201).json({
      success: true,
      message: 'Category change request submitted for approval',
      data: doc
    });
  } catch (error) {
    if (error.status || error.statusCode) {
      return res.status(error.status || error.statusCode).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

export const listCategoryChanges = async (req, res, next) => {
  try {
    const { academicYear, status, admissionNumber, page, limit } = req.query;
    const data = await listCategoryChangeRequests({
      academicYear,
      status,
      admissionNumber,
      page,
      limit,
      hostelId: getWardenHostelId(req)
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const listHistoryStudents = async (req, res, next) => {
  try {
    const { academicYear, q, page, limit } = req.query;
    const data = await listStudentsWithCategoryChangeHistory({
      academicYear,
      q,
      page,
      limit,
      hostelId: getWardenHostelId(req)
    });
    res.json({ success: true, data });
  } catch (error) {
    if (error.status || error.statusCode) {
      return res.status(error.status || error.statusCode).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

export const listActiveStudentsForCategoryChange = async (req, res, next) => {
  try {
    const { academicYear, q } = req.query;
    if (!academicYear) {
      return res.status(400).json({ success: false, message: 'academicYear is required' });
    }

    const filter = { academicYear, status: 'active' };
    const wardenHostelId = getWardenHostelId(req);
    if (req.warden?.role === 'warden') {
      if (!wardenHostelId) {
        return res.status(400).json({
          success: false,
          message: 'No hostel linked to this warden account'
        });
      }
      filter.hostelId = wardenHostelId;
    }
    if (q && String(q).trim()) {
      const term = String(q).trim();
      const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ admissionNumber: rx }, { sdmsName: rx }, { sdmsRollNumber: rx }];
    }

    const items = await HostelRequest.find(filter)
      .select(
        'admissionNumber sdmsName sdmsRollNumber academicYear roomId roomNumber bedNumber lockerNumber hostelId hostelCategoryId'
      )
      .populate('hostelId', 'name code')
      .populate('hostelCategoryId', 'name')
      .populate('roomId', 'roomNumber bedCount category')
      .sort({ roomNumber: 1, admissionNumber: 1 })
      .limit(100)
      .lean();

    res.json({
      success: true,
      data: items.map((r) => ({
        admissionNumber: r.admissionNumber,
        name: r.sdmsName || '',
        rollNumber: r.sdmsRollNumber || '',
        academicYear: r.academicYear,
        hostelRequestId: r._id,
        currentRoomId: r.roomId?._id || r.roomId,
        currentRoomNumber: r.roomNumber || r.roomId?.roomNumber || '',
        currentBedNumber: r.bedNumber || '',
        currentLockerNumber: r.lockerNumber || '',
        hostel: r.hostelId,
        hostelId: r.hostelId?._id || r.hostelId,
        category: r.hostelCategoryId,
        currentCategoryId: r.hostelCategoryId?._id || r.hostelCategoryId,
        currentCategoryName: r.hostelCategoryId?.name || '',
        bedCount: r.roomId?.bedCount
      }))
    });
  } catch (error) {
    next(error);
  }
};

export const getFeePreview = async (req, res, next) => {
  try {
    const { admissionNumber, academicYear, toCategoryId } = req.query;
    const data = await previewCategoryChangeFee({ admissionNumber, academicYear, toCategoryId });
    res.json({ success: true, data });
  } catch (error) {
    if (error.status || error.statusCode) {
      return res.status(error.status || error.statusCode).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

export const approveCategoryChange = async (req, res, next) => {
  try {
    const { adminId, actorName } = getActor(req);
    if (!adminId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const doc = await approveCategoryChangeRequest(req.params.id, adminId, req.body?.remarks || '', actorName);
    res.json({
      success: true,
      message: 'Category change approved — fees updated in Fee Management',
      data: doc
    });
  } catch (error) {
    if (error.status || error.statusCode) {
      return res.status(error.status || error.statusCode).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

export const rejectCategoryChange = async (req, res, next) => {
  try {
    const { adminId, actorName } = getActor(req);
    if (!adminId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const doc = await rejectCategoryChangeRequest(
      req.params.id,
      adminId,
      req.body?.rejectionReason || req.body?.reason || '',
      actorName
    );
    res.json({
      success: true,
      message: 'Category change request rejected',
      data: doc
    });
  } catch (error) {
    if (error.status || error.statusCode) {
      return res.status(error.status || error.statusCode).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};
