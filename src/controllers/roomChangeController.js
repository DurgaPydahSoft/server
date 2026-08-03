import {
  createRoomChangeRequest,
  listRoomChangeRequests,
  getStudentRoomHistory,
  listStudentsWithRoomChangeHistory,
  approveRoomChangeRequest,
  rejectRoomChangeRequest
} from '../services/roomChangeService.js';
import HostelRequest from '../models/HostelRequest.js';

const getActor = (req) => {
  const admin = req.admin || req.warden || req.user;
  const role = admin?.role === 'warden' ? 'warden' : 'admin';
  return { adminId: admin?._id, raisedBy: role };
};

/** Warden's linked hostel — null for admin (no hostel restriction). */
const getWardenHostelId = (req) => {
  const warden = req.warden;
  if (!warden || warden.role !== 'warden') return null;
  return warden.assignedHostelId?._id || warden.assignedHostelId || null;
};

export const createRoomChange = async (req, res, next) => {
  try {
    const { adminId, raisedBy } = getActor(req);
    if (!adminId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const {
      admissionNumber,
      academicYear,
      toRoomId,
      toBedNumber,
      toLockerNumber,
      effectiveDate,
      reason
    } = req.body;

    const doc = await createRoomChangeRequest({
      admissionNumber,
      academicYear,
      toRoomId,
      toBedNumber,
      toLockerNumber,
      effectiveDate,
      reason,
      raisedBy,
      raisedByAdmin: adminId,
      restrictHostelId: getWardenHostelId(req)
    });

    res.status(201).json({
      success: true,
      message: 'Room change request submitted for approval',
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

export const listRoomChanges = async (req, res, next) => {
  try {
    const { academicYear, status, admissionNumber, page, limit } = req.query;
    const data = await listRoomChangeRequests({
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

export const getRoomHistory = async (req, res, next) => {
  try {
    const { admissionNumber, academicYear, studentId } = req.query;
    const items = await getStudentRoomHistory({
      admissionNumber,
      academicYear,
      studentId
    });
    res.json({ success: true, data: items });
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

/** Students who already have room-change / multi-room history for an AY */
export const listHistoryStudents = async (req, res, next) => {
  try {
    const { academicYear, q, page, limit } = req.query;
    const data = await listStudentsWithRoomChangeHistory({
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

/** Active students for AY picker — lightweight list with current room */
export const listActiveStudentsForRoomChange = async (req, res, next) => {
  try {
    const { academicYear, q } = req.query;
    if (!academicYear) {
      return res.status(400).json({ success: false, message: 'academicYear is required' });
    }

    const filter = { academicYear, status: 'active', roomId: { $ne: null } };
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
      filter.$or = [
        { admissionNumber: rx },
        { sdmsName: rx },
        { sdmsRollNumber: rx }
      ];
    }

    const items = await HostelRequest.find(filter)
      .select(
        'admissionNumber sdmsName sdmsRollNumber academicYear roomId roomNumber bedNumber lockerNumber hostelId hostelCategoryId'
      )
      .populate('hostelId', 'name code')
      .populate('hostelCategoryId', 'name')
      .populate('roomId', 'roomNumber bedCount')
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
        category: r.hostelCategoryId,
        bedCount: r.roomId?.bedCount
      }))
    });
  } catch (error) {
    next(error);
  }
};

export const approveRoomChange = async (req, res, next) => {
  try {
    const { adminId } = getActor(req);
    if (!adminId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const doc = await approveRoomChangeRequest(req.params.id, adminId, req.body?.remarks || '');
    res.json({
      success: true,
      message: 'Room change approved and applied',
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

export const rejectRoomChange = async (req, res, next) => {
  try {
    const { adminId } = getActor(req);
    if (!adminId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const doc = await rejectRoomChangeRequest(
      req.params.id,
      adminId,
      req.body?.rejectionReason || req.body?.reason || ''
    );
    res.json({
      success: true,
      message: 'Room change request rejected',
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
