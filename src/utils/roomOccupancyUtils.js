import RoomOccupancyHistory from '../models/RoomOccupancyHistory.js';
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

export const countStudentsInRoomForAcademicYear = async (room, academicYear) => {
  const roomMatch = buildRoomMatchQuery(room);
  
  // Find all active history stays (irrespective of academicYear)
  const activeHistory = await RoomOccupancyHistory.find({
    ...roomMatch,
    status: { $in: ['Active', 'Extended'] },
    allocatedTo: null
  })
    .select('student')
    .lean();

  const historyStudentIds = new Set(activeHistory.map(row => String(row.student)));

  // Find all active users (irrespective of academicYear)
  const activeUsers = await User.find({
    ...roomMatch,
    role: 'student',
    hostelStatus: 'Active'
  })
    .select('_id')
    .lean();

  const allActiveStudentIds = new Set(historyStudentIds);
  activeUsers.forEach(u => allActiveStudentIds.add(String(u._id)));

  return allActiveStudentIds.size;
};

export const getStudentsInRoomForAcademicYear = async (room, academicYear) => {
  const roomMatch = buildRoomMatchQuery(room);
  
  // Find all active history stays (irrespective of academicYear)
  const activeHistory = await RoomOccupancyHistory.find({
    ...roomMatch,
    status: { $in: ['Active', 'Extended'] },
    allocatedTo: null
  })
    .sort({ status: 1, studentName: 1 })
    .lean();

  const historyStudentIds = new Set();
  const historyMap = new Map();
  activeHistory.forEach((row) => {
    historyStudentIds.add(String(row.student));
    historyMap.set(String(row.student), row);
  });

  // Find all active users (irrespective of academicYear)
  const activeUsers = await User.find({
    ...roomMatch,
    role: 'student',
    hostelStatus: 'Active'
  })
    .select('name rollNumber studentPhone course branch year bedNumber lockerNumber academicYear')
    .lean();

  const resultStudents = [];

  activeUsers.forEach((u) => {
    const hist = historyMap.get(String(u._id));
    resultStudents.push({
      _id: u._id,
      name: u.name,
      rollNumber: u.rollNumber,
      course: hist?.course || u.course,
      branch: hist?.branch || u.branch,
      year: hist?.yearOfStudy || u.year,
      bedNumber: hist?.bedNumber || u.bedNumber,
      lockerNumber: hist?.lockerNumber || u.lockerNumber,
      enrollmentStatus: hist?.status || 'Active',
      academicYear: hist?.academicYear || u.academicYear
    });
  });

  // Include any student who has an active stay in history but is not active in User
  activeHistory.forEach((row) => {
    if (!activeUsers.some(u => String(u._id) === String(row.student))) {
      resultStudents.push({
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
      });
    }
  });

  return resultStudents;
};

/** Beds/lockers taken by active enrollments in a room. */
export const getOccupiedBedsAndLockersForAcademicYear = async (room, academicYear) => {
  const occupiedBeds = new Set();
  const occupiedLockers = new Set();

  const record = (bed, locker) => {
    if (bed) occupiedBeds.add(bed);
    if (locker) occupiedLockers.add(locker);
  };

  const roomMatch = buildRoomMatchQuery(room);
  
  // Find all active history stays (irrespective of academicYear)
  const activeHistory = await RoomOccupancyHistory.find({
    ...roomMatch,
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

  // Find all active users (irrespective of academicYear)
  const activeUsers = await User.find({
    ...roomMatch,
    role: 'student',
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
  
  // Find active student in User (irrespective of academicYear)
  const otherUser = await User.findOne({
    ...roomMatch,
    role: 'student',
    hostelStatus: 'Active',
    bedNumber,
    _id: { $ne: excludeStudentId }
  })
    .select('_id')
    .lean();
  if (otherUser) return otherUser;

  // Find active stay in history (irrespective of academicYear)
  return RoomOccupancyHistory.findOne({
    ...roomMatch,
    bedNumber,
    status: { $in: ['Active', 'Extended'] },
    allocatedTo: null,
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
  
  // Find active student in User (irrespective of academicYear)
  const otherUser = await User.findOne({
    ...roomMatch,
    role: 'student',
    hostelStatus: 'Active',
    lockerNumber,
    _id: { $ne: excludeStudentId }
  })
    .select('_id')
    .lean();
  if (otherUser) return otherUser;

  // Find active stay in history (irrespective of academicYear)
  return RoomOccupancyHistory.findOne({
    ...roomMatch,
    lockerNumber,
    status: { $in: ['Active', 'Extended'] },
    allocatedTo: null,
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
