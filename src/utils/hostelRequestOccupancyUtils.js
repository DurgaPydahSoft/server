import HostelRequest from '../models/HostelRequest.js';

const ACTIVE_STATUSES = ['active'];

/**
 * Count active hostel requests allocated to a room for an academic year.
 * Primary occupancy source of truth (replaces User + RoomOccupancyHistory dual-read).
 */
export const countActiveRequestsInRoom = async (room, academicYear) => {
  if (!room?._id || !academicYear) return 0;

  return HostelRequest.countDocuments({
    roomId: room._id,
    academicYear,
    status: { $in: ACTIVE_STATUSES }
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
