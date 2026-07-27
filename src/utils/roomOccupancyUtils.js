/**
 * Room occupancy reads — Phase 6: HostelRequest based.
 * Vacancy / bed checks stay active-only + AY-scoped.
 * Room Management Live = active across all AYs; AY Wise = all statuses for that year.
 */
import {
  countActiveRequestsInRoom,
  countLiveActiveRequestsInRoom,
  countAllRequestsInRoomForAcademicYear,
  getActiveRequestsInRoom,
  getLiveActiveRequestsInRoom,
  getAllRequestsInRoomForAcademicYear,
  getOccupiedBedsAndLockersFromRequests,
  isBedOccupiedByActiveRequest,
  isLockerOccupiedByActiveRequest,
  countAllLiveActiveHostelRequests,
  countAllHostelRequestsForYear
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

/**
 * Vacancy / capacity check: ACTIVE requests only for an academic year.
 * Defaults to current AY when omitted (legacy callers).
 */
export const countStudentsInRoomForAcademicYear = async (room, academicYear) => {
  if (!room?._id) return 0;
  const ay = academicYear || getDefaultAcademicYear();
  return countActiveRequestsInRoom(room, ay);
};

/**
 * Room Management display count.
 * - academicYear set: ALL statuses for that AY
 * - academicYear omitted (Live): active requests across all AYs
 */
export const countRoomOccupancyForDisplay = async (room, academicYear) => {
  if (!room?._id) return 0;
  if (academicYear) {
    return countAllRequestsInRoomForAcademicYear(room, academicYear);
  }
  return countLiveActiveRequestsInRoom(room);
};

/** Active-only occupancy used for available-beds math when AY is selected. */
export const countActiveStudentsInRoomForAcademicYear = async (room, academicYear) => {
  if (!room?._id || !academicYear) return 0;
  return countActiveRequestsInRoom(room, academicYear);
};

const mapRequestsToStudentDtos = async (requests) => {
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

    const statusLabel =
      req.status === 'active'
        ? 'Active'
        : req.status === 'expired'
          ? 'Expired'
          : req.status === 'cancelled'
            ? 'Cancelled'
            : req.status || 'Unknown';

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
      enrollmentStatus: statusLabel,
      academicYear: req.academicYear,
      hostelRequestId: req._id,
      hostelRequestStatus: req.status,
      hostelSequenceId: req.hostelSequenceId,
      studentPhone: master.studentPhone || null
    };
  });
};

/**
 * Students list for room detail.
 * - With AY: all statuses for that year
 * - Live (no AY): active across all years
 */
export const getStudentsInRoomForAcademicYear = async (room, academicYear) => {
  if (!room?._id) return [];

  const requests = academicYear
    ? await getAllRequestsInRoomForAcademicYear(room, academicYear)
    : await getLiveActiveRequestsInRoom(room);

  return mapRequestsToStudentDtos(requests);
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

export {
  countLiveActiveRequestsInRoom,
  countAllRequestsInRoomForAcademicYear,
  countAllLiveActiveHostelRequests,
  countAllHostelRequestsForYear,
  getActiveRequestsInRoom
};
