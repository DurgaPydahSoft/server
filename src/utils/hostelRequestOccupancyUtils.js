import HostelRequest from '../models/HostelRequest.js';

const ACTIVE_STATUSES = ['active'];

/**
 * Count active hostel requests allocated to a room for an academic year.
 * Primary occupancy source of truth for vacancy / bed assignment.
 */
export const countActiveRequestsInRoom = async (room, academicYear) => {
  if (!room?._id || !academicYear) return 0;

  return HostelRequest.countDocuments({
    roomId: room._id,
    academicYear,
    status: { $in: ACTIVE_STATUSES }
  });
};

/**
 * Live occupancy: active hostel requests in this room across ALL academic years.
 */
export const countLiveActiveRequestsInRoom = async (room) => {
  if (!room?._id) return 0;

  return HostelRequest.countDocuments({
    roomId: room._id,
    status: { $in: ACTIVE_STATUSES }
  });
};

/**
 * AY-wise display count: ALL statuses for that academic year (active + expired + cancelled).
 */
export const countAllRequestsInRoomForAcademicYear = async (room, academicYear) => {
  if (!room?._id || !academicYear) return 0;

  return HostelRequest.countDocuments({
    roomId: room._id,
    academicYear
  });
};

export const getActiveRequestsInRoom = async (room, academicYear) => {
  if (!room?._id || !academicYear) return [];

  return HostelRequest.find({
    roomId: room._id,
    academicYear,
    status: { $in: ACTIVE_STATUSES }
  })
    .populate('studentMasterId', 'admissionNumber name rollNumber studentPhone')
    .sort({ allocatedAt: 1 })
    .lean();
};

export const getLiveActiveRequestsInRoom = async (room) => {
  if (!room?._id) return [];

  return HostelRequest.find({
    roomId: room._id,
    status: { $in: ACTIVE_STATUSES }
  })
    .populate('studentMasterId', 'admissionNumber name rollNumber studentPhone')
    .sort({ allocatedAt: 1, academicYear: -1 })
    .lean();
};

export const getAllRequestsInRoomForAcademicYear = async (room, academicYear) => {
  if (!room?._id || !academicYear) return [];

  return HostelRequest.find({
    roomId: room._id,
    academicYear
  })
    .populate('studentMasterId', 'admissionNumber name rollNumber studentPhone')
    .sort({ allocatedAt: 1 })
    .lean();
};

export const getOccupiedBedsAndLockersFromRequests = async (room, academicYear) => {
  const requests = await getActiveRequestsInRoom(room, academicYear);
  const occupiedBeds = new Set();
  const occupiedLockers = new Set();

  requests.forEach((req) => {
    if (req.bedNumber) occupiedBeds.add(req.bedNumber);
    if (req.lockerNumber) occupiedLockers.add(req.lockerNumber);
  });

  return {
    occupiedBeds: [...occupiedBeds],
    occupiedLockers: [...occupiedLockers]
  };
};

export const isBedOccupiedByActiveRequest = async (
  room,
  bedNumber,
  academicYear,
  excludeRequestId = null
) => {
  if (!bedNumber) return false;

  const query = {
    roomId: room._id,
    academicYear,
    bedNumber,
    status: { $in: ACTIVE_STATUSES }
  };
  if (excludeRequestId) {
    query._id = { $ne: excludeRequestId };
  }

  const existing = await HostelRequest.exists(query);
  return Boolean(existing);
};

export const isLockerOccupiedByActiveRequest = async (
  room,
  lockerNumber,
  academicYear,
  excludeRequestId = null
) => {
  if (!lockerNumber) return false;

  const query = {
    roomId: room._id,
    academicYear,
    lockerNumber,
    status: { $in: ACTIVE_STATUSES }
  };
  if (excludeRequestId) {
    query._id = { $ne: excludeRequestId };
  }

  const existing = await HostelRequest.exists(query);
  return Boolean(existing);
};

/** Live: all active hostel requests (any AY). Used by dashboard Live room filled count. */
export const countAllLiveActiveHostelRequests = async () =>
  HostelRequest.countDocuments({ status: { $in: ACTIVE_STATUSES } });

/** AY: all statuses for the year (not only active). */
export const countAllHostelRequestsForYear = async (academicYear) => {
  if (!academicYear) return 0;
  return HostelRequest.countDocuments({ academicYear });
};
