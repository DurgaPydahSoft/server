import RoomOccupancyHistory from '../models/RoomOccupancyHistory.js';
import User from '../models/User.js';

export const buildRoomMatchQuery = (room) => ({
  $or: [
    { room: room._id },
    { roomNumber: room.roomNumber, hostel: room.hostel }
  ]
});

export const countStudentsInRoomForAcademicYear = async (room, academicYear) => {
  if (!academicYear) {
    return User.countDocuments({
      roomNumber: room.roomNumber,
      role: 'student',
      hostelStatus: 'Active'
    });
  }

  const roomMatch = buildRoomMatchQuery(room);
  const historyCount = await RoomOccupancyHistory.countDocuments({
    ...roomMatch,
    academicYear,
    status: { $nin: ['Withdrawn'] }
  });

  if (historyCount > 0) return historyCount;

  return User.countDocuments({
    ...roomMatch,
    role: 'student',
    academicYear,
    hostelStatus: 'Active'
  });
};

export const getStudentsInRoomForAcademicYear = async (room, academicYear) => {
  if (!academicYear) {
    return User.find({
      roomNumber: room.roomNumber,
      role: 'student',
      hostelStatus: 'Active'
    })
      .select('name rollNumber studentPhone course branch year bedNumber lockerNumber academicYear')
      .lean();
  }

  const roomMatch = buildRoomMatchQuery(room);
  const historyRows = await RoomOccupancyHistory.find({
    ...roomMatch,
    academicYear,
    status: { $nin: ['Withdrawn'] }
  })
    .sort({ status: 1, studentName: 1 })
    .lean();

  if (historyRows.length > 0) {
    return historyRows.map((row) => ({
      _id: row.student,
      name: row.studentName,
      rollNumber: row.rollNumber,
      course: row.course,
      branch: row.branch,
      year: row.yearOfStudy,
      bedNumber: row.bedNumber,
      lockerNumber: row.lockerNumber,
      enrollmentStatus: row.status,
      academicYear: row.academicYear
    }));
  }

  return User.find({
    ...roomMatch,
    role: 'student',
    academicYear,
    hostelStatus: 'Active'
  })
    .select('name rollNumber studentPhone course branch year bedNumber lockerNumber academicYear')
    .lean();
};

/** Beds/lockers taken by active enrollments in a room for an academic year. */
export const getOccupiedBedsAndLockersForAcademicYear = async (room, academicYear) => {
  const occupiedBeds = new Set();
  const occupiedLockers = new Set();

  const record = (bed, locker) => {
    if (bed) occupiedBeds.add(bed);
    if (locker) occupiedLockers.add(locker);
  };

  if (!academicYear) {
    const users = await User.find({
      roomNumber: room.roomNumber,
      role: 'student',
      hostelStatus: 'Active'
    })
      .select('bedNumber lockerNumber')
      .lean();
    users.forEach((u) => record(u.bedNumber, u.lockerNumber));
    return {
      occupiedBeds: [...occupiedBeds],
      occupiedLockers: [...occupiedLockers]
    };
  }

  const roomMatch = buildRoomMatchQuery(room);
  const activeHistory = await RoomOccupancyHistory.find({
    ...roomMatch,
    academicYear,
    status: { $in: ['Active', 'Extended'] },
    allocatedTo: null
  })
    .select('bedNumber lockerNumber student')
    .lean();

  const historyStudentIds = new Set();
  activeHistory.forEach((row) => {
    record(row.bedNumber, row.lockerNumber);
    if (row.student) historyStudentIds.add(String(row.student));
  });

  const activeUsers = await User.find({
    ...roomMatch,
    role: 'student',
    academicYear,
    hostelStatus: 'Active'
  })
    .select('_id bedNumber lockerNumber')
    .lean();

  activeUsers.forEach((u) => {
    if (!historyStudentIds.has(String(u._id))) {
      record(u.bedNumber, u.lockerNumber);
    }
  });

  return {
    occupiedBeds: [...occupiedBeds],
    occupiedLockers: [...occupiedLockers]
  };
};

const findOtherBedHolderForAcademicYear = async (
  room,
  bedNumber,
  academicYear,
  excludeStudentId
) => {
  const roomMatch = buildRoomMatchQuery(room);
  const otherUser = await User.findOne({
    ...roomMatch,
    role: 'student',
    hostelStatus: 'Active',
    academicYear,
    bedNumber,
    _id: { $ne: excludeStudentId }
  })
    .select('_id')
    .lean();
  if (otherUser) return otherUser;

  return RoomOccupancyHistory.findOne({
    ...roomMatch,
    academicYear,
    bedNumber,
    status: { $in: ['Active', 'Extended'] },
    student: { $ne: excludeStudentId }
  })
    .select('_id')
    .lean();
};

const findOtherLockerHolderForAcademicYear = async (
  room,
  lockerNumber,
  academicYear,
  excludeStudentId
) => {
  const roomMatch = buildRoomMatchQuery(room);
  const otherUser = await User.findOne({
    ...roomMatch,
    role: 'student',
    hostelStatus: 'Active',
    academicYear,
    lockerNumber,
    _id: { $ne: excludeStudentId }
  })
    .select('_id')
    .lean();
  if (otherUser) return otherUser;

  return RoomOccupancyHistory.findOne({
    ...roomMatch,
    academicYear,
    lockerNumber,
    status: { $in: ['Active', 'Extended'] },
    student: { $ne: excludeStudentId }
  })
    .select('_id')
    .lean();
};

export const isBedOccupiedForAcademicYear = async (
  room,
  bedNumber,
  academicYear,
  excludeStudentId = null
) => {
  const { occupiedBeds } = await getOccupiedBedsAndLockersForAcademicYear(room, academicYear);
  if (!occupiedBeds.includes(bedNumber)) return false;
  if (!excludeStudentId) return true;
  const other = await findOtherBedHolderForAcademicYear(
    room,
    bedNumber,
    academicYear,
    excludeStudentId
  );
  return Boolean(other);
};

export const isLockerOccupiedForAcademicYear = async (
  room,
  lockerNumber,
  academicYear,
  excludeStudentId = null
) => {
  const { occupiedLockers } = await getOccupiedBedsAndLockersForAcademicYear(room, academicYear);
  if (!occupiedLockers.includes(lockerNumber)) return false;
  if (!excludeStudentId) return true;
  const other = await findOtherLockerHolderForAcademicYear(
    room,
    lockerNumber,
    academicYear,
    excludeStudentId
  );
  return Boolean(other);
};
