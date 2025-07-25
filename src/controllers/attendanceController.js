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
      .populate('course', 'name code')
      .populate('branch', 'name code')
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
        // Populate student details for personalized notifications
        const attendanceWithStudents = await Attendance.find({
          _id: { $in: results.map(att => att._id) }
        }).populate('student', 'name');

        // Send individual notifications with student names
        for (const att of attendanceWithStudents) {
          const student = att.student;
          const studentName = student?.name || 'Student';
        
          await notificationService.sendToUser(student._id, {
          type: 'system',
            message: `📊 your attendance has been marked for ${normalizedDate.toDateString()}`,
          sender: markedBy,
          onModel: 'Attendance'
        });
        }

        console.log(`🔔 Attendance notifications sent to ${attendanceWithStudents.length} students`);
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

    const attendance = await Attendance.find({ date: normalizedDate })
      .populate({
        path: 'student',
        select: 'name rollNumber course branch year gender roomNumber',
        populate: [
          { path: 'course', select: 'name code' },
          { path: 'branch', select: 'name code' }
        ]
      })
      .populate('markedBy', 'name');

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
      .populate({
        path: 'student',
        select: 'name rollNumber course branch year gender roomNumber',
        populate: [
          { path: 'course', select: 'name code' },
          { path: 'branch', select: 'name code' }
        ]
      })
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

// Principal-specific attendance functions

// Get attendance for principal's course for a specific date
export const getPrincipalAttendanceForDate = async (req, res, next) => {
  try {
    const { date, branch, gender, studentId } = req.query;
    const principal = req.principal;
    const normalizedDate = normalizeDate(date || new Date());

    console.log('🎓 Principal attendance request:', {
      date: normalizedDate,
      course: principal.course,
      branch,
      gender,
      studentId
    });

    // Build query for students in principal's course
    // Handle both populated course object and course ID
    const courseId = principal.course && typeof principal.course === 'object' 
      ? principal.course._id 
      : principal.course;

    const studentQuery = { 
      role: 'student', 
      hostelStatus: 'Active',
      course: courseId
    };

    // Add filters if provided
    if (branch) studentQuery.branch = branch;
    if (gender) studentQuery.gender = gender;
    if (studentId) studentQuery.rollNumber = { $regex: studentId, $options: 'i' };

    console.log('🎓 Student query:', studentQuery);

    // Get students in principal's course
    const students = await User.find(studentQuery)
      .select('_id name rollNumber course branch year gender roomNumber studentPhoto')
      .populate('course', 'name code')
      .populate('branch', 'name code')
      .sort({ name: 1 });

    console.log('🎓 Found students:', students.length);
    if (students.length > 0) {
      console.log('🎓 Sample student:', {
        name: students[0].name,
        course: students[0].course,
        branch: students[0].branch,
        hostelStatus: students[0].hostelStatus
      });
    }

    const studentIds = students.map(student => student._id);

    // Get attendance for these students on the specified date
    const attendanceQuery = {
      student: { $in: studentIds },
      date: normalizedDate
    };
    console.log('🎓 Attendance query:', attendanceQuery);
    
    const attendance = await Attendance.find(attendanceQuery)
      .populate('student', 'name rollNumber course branch year gender roomNumber');

    console.log('🎓 Found attendance records:', attendance.length);
    if (attendance.length > 0) {
      console.log('🎓 Sample attendance record:', {
        student: attendance[0].student?.name,
        date: attendance[0].date,
        morning: attendance[0].morning,
        evening: attendance[0].evening
      });
    }
    
    // Debug: Check all attendance records for this date
    const allAttendanceForDate = await Attendance.find({ date: normalizedDate });
    console.log('🎓 Total attendance records for date:', allAttendanceForDate.length);
    if (allAttendanceForDate.length > 0) {
      console.log('🎓 Sample of all attendance for date:', {
        studentId: allAttendanceForDate[0].student,
        date: allAttendanceForDate[0].date,
        morning: allAttendanceForDate[0].morning,
        evening: allAttendanceForDate[0].evening
      });
    }

    // Create a map of student attendance
    const attendanceMap = new Map();
    attendance.forEach(att => {
      attendanceMap.set(att.student._id.toString(), att);
    });

    // Combine student data with attendance status
    const studentsWithAttendance = students.map(student => {
      const studentAttendance = attendanceMap.get(student._id.toString());
      
      const result = {
        ...student.toObject(),
        morning: studentAttendance?.morning || false,
        evening: studentAttendance?.evening || false,
        status: studentAttendance ? 
          (studentAttendance.morning && studentAttendance.evening ? 'Present' : 
           studentAttendance.morning || studentAttendance.evening ? 'Partial' : 'Absent') : 'Absent',
        notes: studentAttendance?.notes || ''
      };
      
      console.log('🎓 Student attendance:', {
        name: result.name,
        status: result.status,
        morning: result.morning,
        evening: result.evening
      });
      
      return result;
    });

    console.log('🎓 Students with attendance:', studentsWithAttendance.length);

    // Calculate statistics
    const totalStudents = studentsWithAttendance.length;
    const presentToday = studentsWithAttendance.filter(s => s.status === 'Present').length;
    const absentToday = studentsWithAttendance.filter(s => s.status === 'Absent').length;
    const attendanceRate = totalStudents > 0 ? Math.round((presentToday / totalStudents) * 100) : 0;

    const response = {
      success: true,
      data: {
        attendance: studentsWithAttendance,
        statistics: {
          totalStudents,
          presentToday,
          absentToday,
          attendanceRate
        },
        date: normalizedDate,
        course: principal.course
      }
    };

    console.log('🎓 Sending response with', studentsWithAttendance.length, 'attendance records');
    res.json(response);
  } catch (error) {
    console.error('🎓 Error in getPrincipalAttendanceForDate:', error);
    next(error);
  }
};

// Get attendance for principal's course for a date range
export const getPrincipalAttendanceForRange = async (req, res, next) => {
  try {
    const { startDate, endDate, branch, gender, studentId } = req.query;
    const principal = req.principal;
    
    if (!startDate || !endDate) {
      throw createError(400, 'Start date and end date are required');
    }

    const start = normalizeDate(new Date(startDate));
    const end = normalizeDate(new Date(endDate));

    if (start > end) {
      throw createError(400, 'Start date cannot be after end date');
    }

    // Build query for students in principal's course
    // Handle both populated course object and course ID
    const courseId = principal.course && typeof principal.course === 'object' 
      ? principal.course._id 
      : principal.course;

    const studentQuery = { 
      role: 'student', 
      hostelStatus: 'Active',
      course: courseId
    };

    // Add filters if provided
    if (branch) studentQuery.branch = branch;
    if (gender) studentQuery.gender = gender;
    if (studentId) studentQuery.rollNumber = { $regex: studentId, $options: 'i' };

    // Get students in principal's course
    const students = await User.find(studentQuery)
      .select('_id name rollNumber course branch year gender roomNumber studentPhoto')
      .populate('course', 'name code')
      .populate('branch', 'name code')
      .sort({ name: 1 });

    const studentIds = students.map(student => student._id);

    // Get attendance for these students in the date range
    const attendance = await Attendance.find({
      student: { $in: studentIds },
      date: { $gte: start, $lte: end }
    }).populate('student', 'name rollNumber course branch year gender roomNumber')
      .sort({ date: -1, 'student.name': 1 });

    // Calculate statistics
    const totalStudents = students.length;
    const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    const totalPossibleAttendance = totalStudents * totalDays;
    
    const presentRecords = attendance.filter(att => att.morning && att.evening).length;
    const partialRecords = attendance.filter(att => (att.morning || att.evening) && !(att.morning && att.evening)).length;
    const absentRecords = totalPossibleAttendance - presentRecords - partialRecords;
    
    const overallAttendanceRate = totalPossibleAttendance > 0 ? 
      Math.round(((presentRecords + partialRecords) / totalPossibleAttendance) * 100) : 0;

    res.json({
      success: true,
      data: {
        attendance,
        statistics: {
          totalStudents,
          totalDays,
          presentRecords,
          partialRecords,
          absentRecords,
          overallAttendanceRate
        },
        startDate: start,
        endDate: end,
        course: principal.course
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get student count for principal's course
export const getPrincipalStudentCount = async (req, res, next) => {
  try {
    const principal = req.principal;

    console.log('🎓 Principal student count - Principal data:', {
      principalId: principal._id,
      principalCourse: principal.course,
      courseType: typeof principal.course,
      courseIsObject: principal.course && typeof principal.course === 'object'
    });

    // Handle both populated course object and course ID
    const courseId = principal.course && typeof principal.course === 'object' 
      ? principal.course._id 
      : principal.course;

    console.log('🎓 Extracted courseId:', courseId);

    // Get count of students in principal's course

    const query = {
      role: 'student',
      hostelStatus: 'Active',
      course: courseId
    };

    console.log('🎓 Student count query:', query);

    const totalStudents = await User.countDocuments(query);

    console.log('🎓 Total students found:', totalStudents);

    // Debug: Let's also check what students exist
    const sampleStudents = await User.find({ role: 'student', hostelStatus: 'Active' })
      .select('name rollNumber course')
      .populate('course', 'name code')
      .limit(5);

    console.log('🎓 Sample students in system:', sampleStudents.map(s => ({
      name: s.name,
      rollNumber: s.rollNumber,
      course: s.course
    })));

    res.json({
      success: true,
      data: {
        total: totalStudents
      }
    });
  } catch (error) {
    console.error('🎓 Error in getPrincipalStudentCount:', error);
    next(error);
  }
};

// Get attendance statistics for principal's course
export const getPrincipalAttendanceStats = async (req, res, next) => {
  try {
    const { date } = req.query;
    const principal = req.principal;
    const normalizedDate = normalizeDate(date || new Date());

    console.log('🎓 Principal attendance stats - Principal data:', {
      principalId: principal._id,
      principalCourse: principal.course,
      courseType: typeof principal.course,
      courseIsObject: principal.course && typeof principal.course === 'object'
    });

    // Get students in principal's course
    // Handle both populated course object and course ID
    const courseId = principal.course && typeof principal.course === 'object' 
      ? principal.course._id 
      : principal.course;

    console.log('🎓 Extracted courseId for attendance stats:', courseId);

    const studentQuery = {
      role: 'student',
      hostelStatus: 'Active',
      course: courseId
    };

    console.log('🎓 Student query for attendance stats:', studentQuery);

    const students = await User.find(studentQuery)
      .select('_id name rollNumber course branch year gender roomNumber')
      .populate('course', 'name code')
      .populate('branch', 'name code');

    console.log('🎓 Students found for attendance stats:', students.length);

    const studentIds = students.map(student => student._id);

    // Get attendance for these students on the specified date
    const attendance = await Attendance.find({
      student: { $in: studentIds },
      date: normalizedDate
    }).populate('student', 'name rollNumber course branch year gender roomNumber');

    // Calculate statistics in the format expected by frontend
    const totalStudents = students.length;
    const presentToday = attendance.filter(att => att.morning && att.evening).length;
    const absentToday = totalStudents - presentToday;
    const attendanceRate = totalStudents > 0 ? Math.round((presentToday / totalStudents) * 100) : 0;

    // Get recent attendance records for display
    const recentAttendance = attendance
      .sort((a, b) => new Date(b.markedAt || b.createdAt) - new Date(a.markedAt || a.createdAt))
      .slice(0, 10)
      .map(att => ({
        student: att.student,
        morning: att.morning,
        evening: att.evening,
        status: att.morning && att.evening ? 'Present' : 
                att.morning || att.evening ? 'Partial' : 'Absent',
        markedAt: att.markedAt || att.createdAt
      }));

    res.json({
      success: true,
      data: {
        date: normalizedDate,
        course: principal.course,
        presentToday,
        absentToday,
        attendanceRate,
        courseStudents: totalStudents,
        recentAttendance,
        totalStudents
      }
    });
  } catch (error) {
    next(error);
  }
};