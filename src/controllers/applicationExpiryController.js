import ApplicationExpiryConfig from '../models/ApplicationExpiryConfig.js';
import RoomOccupancyHistory from '../models/RoomOccupancyHistory.js';
import Room from '../models/Room.js';
import User from '../models/User.js';
import { createError } from '../utils/error.js';
import {
  resolveApplicationExpiryDate,
  extendStudentApplicationExpiry,
  getAcademicYearEndYear
} from '../utils/applicationExpiryService.js';
import { enrichStudentAcademics, enrichStudentsAcademics } from '../utils/studentAcademicEnricher.js';

export const calculateExpiryPreview = async (req, res, next) => {
  try {
    const { academicYear, courseName, yearOfStudy, sqlCourseId } = req.body;
    if (!academicYear || !courseName || !yearOfStudy) {
      return next(createError(400, 'academicYear, courseName, and yearOfStudy are required'));
    }

    const applicationExpiryDate = await resolveApplicationExpiryDate({
      academicYear,
      courseName,
      yearOfStudy: Number(yearOfStudy),
      sqlCourseId: sqlCourseId || null
    });

    res.json({
      success: true,
      data: {
        applicationExpiryDate,
        configured: applicationExpiryDate !== null
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getStudentApplicationExpiry = async (req, res, next) => {
  try {
    const student = await User.findOne({ _id: req.params.id, role: 'student' })
      .select('applicationExpiryDate applicationStatus applicationExpiryExtendedAt academicYear hostelStatus rollNumber admissionNumber')
      .lean();

    if (!student) {
      return next(createError(404, 'Student not found'));
    }

    const enriched = await enrichStudentAcademics(student);
    const useManual = student.applicationStatus === 'Extended' && student.applicationExpiryDate;
    const configuredExpiry = await resolveApplicationExpiryDate({
      academicYear: student.academicYear,
      courseName: enriched.course,
      yearOfStudy: enriched.year,
      manualExpiryDate: useManual ? student.applicationExpiryDate : null,
      sqlCourseId: enriched.sqlCourseId || null
    });

    res.json({
      success: true,
      data: {
        applicationExpiryDate: useManual ? student.applicationExpiryDate : null,
        applicationStatus: student.applicationStatus,
        applicationExpiryExtendedAt: student.applicationExpiryExtendedAt,
        configuredExpiryDate: configuredExpiry,
        academicYear: student.academicYear,
        course: enriched.course,
        yearOfStudy: enriched.year,
        hostelStatus: student.hostelStatus,
        expirySource: enriched.sqlCourseId ? 'sql_calendar' : 'manual_config'
      }
    });
  } catch (error) {
    next(error);
  }
};

export const extendApplication = async (req, res, next) => {
  try {
    const { newExpiryDate, reason, reactivate = false } = req.body;
    if (!newExpiryDate) {
      return next(createError(400, 'newExpiryDate is required'));
    }

    const student = await extendStudentApplicationExpiry({
      studentId: req.params.id,
      newExpiryDate,
      reactivate: Boolean(reactivate),
      adminId: req.admin._id,
      reason: reason || ''
    });

    res.json({
      success: true,
      message: 'Application expiry extended successfully',
      data: {
        id: student._id,
        applicationExpiryDate: student.applicationExpiryDate,
        applicationStatus: student.applicationStatus,
        hostelStatus: student.hostelStatus
      }
    });
  } catch (error) {
    if (error.message === 'Student not found') {
      return next(createError(404, error.message));
    }
    if (error.message === 'Invalid expiry date') {
      return next(createError(400, error.message));
    }
    next(error);
  }
};

const buildRoomStudentMatch = (roomId, room) => ({
  $or: [
    { room: roomId },
    { roomNumber: room.roomNumber, hostel: room.hostel },
    { roomNumber: room.roomNumber, hostelCategory: room.category, hostel: room.hostel }
  ]
});

export const getRoomOccupancyHistory = async (req, res, next) => {
  try {
    const { roomId } = req.params;
    const { academicYear } = req.query;

    const room = await Room.findById(roomId).lean();
    if (!room) {
      return next(createError(404, 'Room not found'));
    }

    const roomMatch = buildRoomStudentMatch(roomId, room);
    const historyQuery = { ...roomMatch };
    if (academicYear) historyQuery.academicYear = academicYear;

    const historyRows = await RoomOccupancyHistory.find(historyQuery)
      .sort({ academicYear: -1, allocatedFrom: -1 })
      .lean();

    const historyKeys = new Set(
      historyRows.map((r) => `${r.student}-${r.academicYear}`)
    );

    const studentQuery = {
      role: 'student',
      ...roomMatch
    };
    if (academicYear) studentQuery.academicYear = academicYear;

    const students = await User.find(studentQuery)
      .select(
        'name rollNumber academicYear hostel hostelCategory room roomNumber bedNumber lockerNumber hostelStatus createdAt updatedAt applicationStatus'
      )
      .lean();

    const enrichedStudents = await enrichStudentsAcademics(students);

    const syntheticRows = [];
    for (const student of enrichedStudents) {
      const key = `${student._id}-${student.academicYear}`;
      if (historyKeys.has(key)) continue;

      syntheticRows.push({
        _id: `live-${student._id}-${student.academicYear}`,
        student: student._id,
        studentName: student.name,
        rollNumber: student.rollNumber,
        course: student.course,
        branch: student.branch,
        yearOfStudy: student.year,
        academicYear: student.academicYear,
        hostel: student.hostel,
        hostelCategory: student.hostelCategory,
        room: student.room || roomId,
        roomNumber: student.roomNumber || room.roomNumber,
        bedNumber: student.bedNumber,
        lockerNumber: student.lockerNumber,
        allocatedFrom: student.createdAt,
        allocatedTo: student.hostelStatus === 'Active' ? null : student.updatedAt,
        status: student.hostelStatus === 'Active' ? 'Active' : 'Expired',
        expiryReason: 'registration',
        isLiveSnapshot: true
      });
    }

    const combined = [...historyRows, ...syntheticRows].sort((a, b) => {
      const ayCmp = (b.academicYear || '').localeCompare(a.academicYear || '');
      if (ayCmp !== 0) return ayCmp;
      return new Date(b.allocatedFrom || 0) - new Date(a.allocatedFrom || 0);
    });

    const academicYears = [...new Set(combined.map((r) => r.academicYear).filter(Boolean))]
      .sort((a, b) => b.localeCompare(a));

    const byAcademicYear = {};
    for (const row of combined) {
      const ay = row.academicYear || 'Unknown';
      if (!byAcademicYear[ay]) byAcademicYear[ay] = [];
      byAcademicYear[ay].push(row);
    }

    res.json({
      success: true,
      data: combined,
      meta: {
        academicYears,
        byAcademicYear,
        roomNumber: room.roomNumber
      }
    });
  } catch (error) {
    next(error);
  }
};

export const listApplicationExpiryConfig = async (req, res, next) => {
  try {
    const { academicYear, courseName } = req.query;
    const query = {};
    if (academicYear) query.academicYear = academicYear;
    if (courseName) query.courseName = courseName;

    const configs = await ApplicationExpiryConfig.find(query)
      .sort({ academicYear: -1, courseName: 1, yearOfStudy: 1 })
      .lean();

    const data = configs.map((row) => {
      const endYear = getAcademicYearEndYear(row.academicYear);
      const resolved = endYear
        ? new Date(Date.UTC(endYear, row.expiryMonth - 1, row.expiryDay, 23, 59, 59, 999))
        : null;
      return { ...row, resolvedExpiryDate: resolved };
    });

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const upsertApplicationExpiryConfig = async (req, res, next) => {
  try {
    const {
      academicYear,
      courseName,
      yearOfStudy,
      expiryMonth,
      expiryDay,
      isActive = true,
      notes = ''
    } = req.body;

    if (!academicYear || !courseName || !yearOfStudy || !expiryMonth || !expiryDay) {
      return next(createError(400, 'academicYear, courseName, yearOfStudy, expiryMonth, and expiryDay are required'));
    }

    if (!/^\d{4}-\d{4}$/.test(academicYear)) {
      return next(createError(400, 'academicYear must be YYYY-YYYY'));
    }

    const config = await ApplicationExpiryConfig.findOneAndUpdate(
      {
        academicYear: academicYear.trim(),
        courseName: courseName.trim(),
        yearOfStudy: Number(yearOfStudy)
      },
      {
        academicYear: academicYear.trim(),
        courseName: courseName.trim(),
        yearOfStudy: Number(yearOfStudy),
        expiryMonth: Number(expiryMonth),
        expiryDay: Number(expiryDay),
        isActive: Boolean(isActive),
        notes,
        updatedBy: req.admin._id
      },
      { upsert: true, new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Application expiry config saved',
      data: config
    });
  } catch (error) {
    next(error);
  }
};

export const deleteApplicationExpiryConfig = async (req, res, next) => {
  try {
    const config = await ApplicationExpiryConfig.findByIdAndDelete(req.params.id);
    if (!config) {
      return next(createError(404, 'Config not found'));
    }
    res.json({ success: true, message: 'Application expiry config deleted' });
  } catch (error) {
    next(error);
  }
};
