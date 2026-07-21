/**
 * Room occupancy reads — Phase 6: active HostelRequest only (AY-scoped).
 * Legacy User / RoomOccupancyHistory dual-read removed.
 * getDefaultAcademicYear kept here for shared import convenience.
 */
import {
  countActiveRequestsInRoom,
  getActiveRequestsInRoom,
  getOccupiedBedsAndLockersFromRequests,
  isBedOccupiedByActiveRequest,
  isLockerOccupiedByActiveRequest
} from './hostelRequestOccupancyUtils.js';
import HostelRequest from '../models/HostelRequest.js';
import StudentMaster from '../models/StudentMaster.js';
import User from '../models/User.js';

export const buildRoomMatchQuery = (room) => ({
  $or: [
    { room: room._id },
    { roomNumber: room.roomNumber, hostel: room.hostel }
  ]
});

export const getDefaultAcademicYear = () => {
  const year = new Date().getFullYear();
  return `${year}-${year + 1}`;
};

const normalizeAdmission = (value) => (value || '').toString().trim().toUpperCase();

/** Resolve HostelRequest id to exclude when checking beds/lockers for a User id. */
const resolveExcludeRequestId = async (excludeStudentId, academicYear) => {
  if (!excludeStudentId || !academicYear) return null;

  const user = await User.findById(excludeStudentId).select('admissionNumber').lean();
  const admission = normalizeAdmission(user?.admissionNumber);
  if (!admission) return null;

  const request = await HostelRequest.findOne({
    admissionNumber: admission,
    academicYear
  })
    .select('_id')
    .lean();

  return request?._id || null;
};

export const countStudentsInRoomForAcademicYear = async (room, academicYear) => {
  if (!room?._id) return 0;
  const ay = academicYear || getDefaultAcademicYear();
  return countActiveRequestsInRoom(room, ay);
};

export const getStudentsInRoomForAcademicYear = async (room, academicYear) => {
  if (!room?._id) return [];

  const ay = academicYear || getDefaultAcademicYear();
  const requests = await getActiveRequestsInRoom(room, ay);

  const masterIds = requests
    .map((r) => r.studentMasterId?._id || r.studentMasterId)
    .filter(Boolean);
  const masters = masterIds.length
    ? await StudentMaster.find({ _id: { $in: masterIds } })
        .select('admissionNumber name rollNumber studentPhone userId')
        .lean()
    : [];
  const masterById = new Map(masters.map((m) => [String(m._id), m]));

  return requests.map((req) => {
    const masterId = req.studentMasterId?._id || req.studentMasterId;
    const master =
      (req.studentMasterId && typeof req.studentMasterId === 'object' && req.studentMasterId.name
        ? req.studentMasterId
        : null) ||
      masterById.get(String(masterId)) ||
      {};

    return {
      _id: master.userId || req._id,
      name: master.name || req.sdmsName || '',
      rollNumber: master.rollNumber || req.sdmsRollNumber || '',
      admissionNumber: req.admissionNumber,
      course: req.sdmsCourse || '',
      branch: req.sdmsBranch || '',
      year: req.sdmsYearOfStudy || null,
      bedNumber: req.bedNumber,
      lockerNumber: req.lockerNumber,
      enrollmentStatus: 'Active',
      academicYear: req.academicYear,
      hostelRequestId: req._id,
      hostelRequestStatus: req.status,
      hostelSequenceId: req.hostelSequenceId,
      studentPhone: master.studentPhone || null
    };
  });
};

export const getOccupiedBedsAndLockersForAcademicYear = async (room, academicYear) => {
  const ay = academicYear || getDefaultAcademicYear();
  return getOccupiedBedsAndLockersFromRequests(room, ay);
};

export const isBedOccupiedForAcademicYear = async (
  room,
  bedNumber,
  academicYear,
  excludeStudentId = null
) => {
  if (!bedNumber || !room?._id) return false;
  const ay = academicYear || getDefaultAcademicYear();
  const excludeRequestId = await resolveExcludeRequestId(excludeStudentId, ay);
  return isBedOccupiedByActiveRequest(room, bedNumber, ay, excludeRequestId);
};

export const isLockerOccupiedForAcademicYear = async (
  room,
  lockerNumber,
  academicYear,
  excludeStudentId = null
) => {
  if (!lockerNumber || !room?._id) return false;
  const ay = academicYear || getDefaultAcademicYear();
  const excludeRequestId = await resolveExcludeRequestId(excludeStudentId, ay);
  return isLockerOccupiedByActiveRequest(room, lockerNumber, ay, excludeRequestId);
};

export const countActiveHostelRequestsForYear = async (academicYear) => {
  if (!academicYear) return 0;
  return HostelRequest.countDocuments({
    academicYear,
    status: 'active'
  });
};
