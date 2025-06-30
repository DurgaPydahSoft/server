import Attendance from '../models/Attendance.js';
import User from '../models/User.js';
import { createError } from '../utils/error.js';
import notificationService from '../utils/notificationService.js';

// Helper to normalize date to start of day
function normalizeDate(date) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Get students for attendance taking
export const getStudentsForAttendance = async (req, res, next) => {
  try {
    const { date, course, branch, gender, category, roomNumber } = req.query;
    const normalizedDate = normalizeDate(date || new Date());

    // Build query for active students
    const query = { 
      role: 'student', 
      hostelStatus: 'Active' 
    };

    // Add filters if provided
    if (course) query.course = course;
    if (branch) query.branch = branch;
    if (gender) query.gender = gender;
    if (category) query.category = category;
    if (roomNumber) query.roomNumber = roomNumber;

    const students = await User.find(query)
      .select('name rollNumber course branch year gender roomNumber')
      .sort({ name: 1 });

    // Get existing attendance for the date
    const existingAttendance = await Attendance.find({
      date: normalizedDate
    }).populate('student', '_id');

    const studentIdsWithAttendance = existingAttendance.map(att => att.student._id.toString());

    // Combine student data with attendance status
    const studentsWithAttendance = students.map(student => {
      const attendance = existingAttendance.find(att => 
        att.student._id.toString() === student._id.toString()
      );
      
      return {
        ...student.toObject(),
        attendance: attendance ? {
          morning: attendance.morning,
          evening: attendance.evening,
          status: attendance.status,
          percentage: attendance.percentage
        } : {
          morning: false,
          evening: false,
          status: 'Absent',
          percentage: 0
        }
      };
    });

    res.json({
      success: true,
      data: {
        students: studentsWithAttendance,
        date: normalizedDate,
        totalStudents: students.length,
        attendanceTaken: studentIdsWithAttendance.length
      }
    });
  } catch (error) {
    next(error);
  }
};

// Take attendance for a specific date
export const takeAttendance = async (req, res, next) => {
  try {
    const { date, attendanceData } = req.body;
    const markedBy = req.admin ? req.admin._id : req.user._id;
    
    if (!date || !attendanceData || !Array.isArray(attendanceData)) {
      throw createError(400, 'Date and attendance data are required');
    }

    const normalizedDate = normalizeDate(date);
    const today = normalizeDate(new Date());
    
    // Only allow taking attendance for today or past dates
    if (normalizedDate > today) {
      throw createError(400, 'Cannot take attendance for future dates');
    }

    const results = [];
    const errors = [];

    // Process each attendance record
    for (const record of attendanceData) {
      try {
        const { studentId, morning, evening, notes } = record;
        
        if (!studentId) {
          errors.push({ studentId, error: 'Student ID is required' });
          continue;
        }

        // Validate student exists and is active
        const student = await User.findOne({ 
          _id: studentId, 
          role: 'student', 
          hostelStatus: 'Active' 
        });

        if (!student) {
          errors.push({ studentId, error: 'Student not found or inactive' });
          continue;
        }

        // Use upsert to create or update attendance
        const attendance = await Attendance.findOneAndUpdate(
          { student: studentId, date: normalizedDate },
          {
            morning: morning || false,
            evening: evening || false,
            markedBy,
            markedAt: new Date(),
            notes: notes || ''
          },
          { 
            upsert: true, 
            new: true,
            runValidators: true
          }
        );

        results.push(attendance);
      } catch (error) {
        errors.push({ 
          studentId: record.studentId, 
          error: error.message 
        });
      }
    }

    // Send notification to students about attendance being taken
    if (results.length > 0) {
      try {
        const studentIds = results.map(att => att.student);
        const adminName = req.admin ? req.admin.name : req.user.name;
        
        await notificationService.sendToUsers(studentIds, {
          type: 'system',
          message: `📊 Your attendance has been marked for ${normalizedDate.toDateString()}`,
          sender: markedBy,
          onModel: 'Attendance'
        });
      } catch (notificationError) {
        console.error('Error sending attendance notification:', notificationError);
      }
    }

    res.json({
      success: true,
      message: `Attendance taken for ${results.length} students`,
      data: {
        successful: results.length,
        errors: errors.length,
        errorDetails: errors
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get attendance for a specific date
export const getAttendanceForDate = async (req, res, next) => {
  try {
    const { date } = req.query;
    const normalizedDate = normalizeDate(date || new Date());

    const attendance = await Attendance.getAttendanceForDate(normalizedDate);

    // Get attendance statistics
    const stats = await Attendance.getAttendanceStats(normalizedDate);
    const statistics = stats[0] || {
      totalStudents: 0,
      morningPresent: 0,
      eveningPresent: 0,
      fullyPresent: 0,
      partiallyPresent: 0,
      absent: 0
    };

    res.json({
      success: true,
      data: {
        attendance,
        date: normalizedDate,
        statistics
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get attendance for a date range
export const getAttendanceForDateRange = async (req, res, next) => {
  try {
    const { startDate, endDate, studentId } = req.query;
    
    if (!startDate || !endDate) {
      throw createError(400, 'Start date and end date are required');
    }

    const start = normalizeDate(new Date(startDate));
    const end = normalizeDate(new Date(endDate));

    if (start > end) {
      throw createError(400, 'Start date cannot be after end date');
    }

    let query = {
      date: { $gte: start, $lte: end }
    };

    // If studentId is provided, filter by student
    if (studentId) {
      query.student = studentId;
    }

    const attendance = await Attendance.find(query)
      .populate('student', 'name rollNumber course branch year gender roomNumber')
      .populate('markedBy', 'name')
      .sort({ date: -1, 'student.name': 1 });

    res.json({
      success: true,
      data: {
        attendance,
        startDate: start,
        endDate: end,
        totalRecords: attendance.length
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get student's own attendance
export const getMyAttendance = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const studentId = req.user._id;

    const start = startDate ? normalizeDate(new Date(startDate)) : normalizeDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)); // Default to last 30 days
    const end = endDate ? normalizeDate(new Date(endDate)) : normalizeDate(new Date());

    const attendance = await Attendance.getStudentAttendance(studentId, start, end);

    // Calculate attendance statistics
    const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    const presentDays = attendance.filter(att => att.morning || att.evening).length;
    const fullyPresentDays = attendance.filter(att => att.morning && att.evening).length;
    const partiallyPresentDays = attendance.filter(att => (att.morning || att.evening) && !(att.morning && att.evening)).length;
    const absentDays = totalDays - presentDays;

    const statistics = {
      totalDays,
      presentDays,
      fullyPresentDays,
      partiallyPresentDays,
      absentDays,
      attendancePercentage: totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0
    };

    res.json({
      success: true,
      data: {
        attendance,
        statistics,
        startDate: start,
        endDate: end
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get attendance statistics for dashboard
export const getAttendanceStats = async (req, res, next) => {
  try {
    const { date } = req.query;
    const normalizedDate = normalizeDate(date || new Date());

    const stats = await Attendance.getAttendanceStats(normalizedDate);
    const statistics = stats[0] || {
      totalStudents: 0,
      morningPresent: 0,
      eveningPresent: 0,
      fullyPresent: 0,
      partiallyPresent: 0,
      absent: 0
    };

    // Calculate percentages
    const totalStudents = statistics.totalStudents;
    const percentages = {
      morningPercentage: totalStudents > 0 ? Math.round((statistics.morningPresent / totalStudents) * 100) : 0,
      eveningPercentage: totalStudents > 0 ? Math.round((statistics.eveningPresent / totalStudents) * 100) : 0,
      fullyPresentPercentage: totalStudents > 0 ? Math.round((statistics.fullyPresent / totalStudents) * 100) : 0,
      partiallyPresentPercentage: totalStudents > 0 ? Math.round((statistics.partiallyPresent / totalStudents) * 100) : 0,
      absentPercentage: totalStudents > 0 ? Math.round((statistics.absent / totalStudents) * 100) : 0
    };

    res.json({
      success: true,
      data: {
        date: normalizedDate,
        statistics: {
          ...statistics,
          percentages
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// Update attendance for a specific student and date
export const updateAttendance = async (req, res, next) => {
  try {
    const { studentId, date, morning, evening, notes } = req.body;
    const markedBy = req.admin ? req.admin._id : req.user._id;

    if (!studentId || !date) {
      throw createError(400, 'Student ID and date are required');
    }

    const normalizedDate = normalizeDate(date);

    // Check if attendance record exists
    let attendance = await Attendance.findOne({
      student: studentId,
      date: normalizedDate
    });

    if (!attendance) {
      throw createError(404, 'Attendance record not found');
    }

    // Update attendance
    attendance.morning = morning !== undefined ? morning : attendance.morning;
    attendance.evening = evening !== undefined ? evening : attendance.evening;
    attendance.notes = notes || attendance.notes;
    attendance.markedBy = markedBy;
    attendance.markedAt = new Date();

    await attendance.save();

    res.json({
      success: true,
      message: 'Attendance updated successfully',
      data: attendance
    });
  } catch (error) {
    next(error);
  }
};

// Delete attendance for a specific student and date
export const deleteAttendance = async (req, res, next) => {
  try {
    const { studentId, date } = req.params;

    if (!studentId || !date) {
      throw createError(400, 'Student ID and date are required');
    }

    const normalizedDate = normalizeDate(new Date(date));

    const attendance = await Attendance.findOneAndDelete({
      student: studentId,
      date: normalizedDate
    });

    if (!attendance) {
      throw createError(404, 'Attendance record not found');
    }

    res.json({
      success: true,
      message: 'Attendance record deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};