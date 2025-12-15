import Attendance from '../models/Attendance.js';
import User from '../models/User.js';
import Leave from '../models/Leave.js';
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

    console.log('🔍 getStudentsForAttendance - Query params:', { date, course, branch, gender, category, roomNumber });
    console.log('🔍 getStudentsForAttendance - Normalized date:', normalizedDate);

    // Build query for active students
    const query = { 
      role: 'student', 
      hostelStatus: 'Active' 
    };

    // Add filters if provided (only if they have valid values)
    if (course && course.trim() !== '') query.course = course;
    if (branch && branch.trim() !== '') query.branch = branch;
    if (gender && gender.trim() !== '') query.gender = gender;
    if (category && category.trim() !== '') query.category = category;
    if (roomNumber && roomNumber.trim() !== '') query.roomNumber = roomNumber;

    console.log('🔍 getStudentsForAttendance - Query:', query);
    
    const students = await User.find(query)
      .select('name rollNumber course branch year gender roomNumber')
      .sort({ name: 1 })
      .lean(); // Use lean() for better performance and to avoid mongoose document issues

    console.log('🔍 getStudentsForAttendance - Found students:', students.length);

    // Get existing attendance for the date
    const existingAttendance = await Attendance.find({
      date: normalizedDate
    }).populate('student', '_id');

    console.log('🔍 getStudentsForAttendance - Found attendance records:', existingAttendance.length);
    console.log('🔍 getStudentsForAttendance - Sample attendance record:', existingAttendance[0]);

    // Filter out attendance records with null/undefined student references
    const validAttendance = existingAttendance.filter(att => {
      if (!att.student) {
        console.warn('🔍 getStudentsForAttendance - Found attendance record with null student:', att._id);
        return false;
      }
      return true;
    });

    const studentIdsWithAttendance = validAttendance
      .filter(att => att.student && att.student._id) // Additional safety check
      .map(att => att.student._id.toString());

    // Get approved leaves for the date
    const startOfDay = new Date(normalizedDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(normalizedDate);
    endOfDay.setHours(23, 59, 59, 999);

    const approvedLeaves = await Leave.find({
      status: 'Approved',
      verificationStatus: { $ne: 'Completed' }, // Exclude completed leaves
      $or: [
        {
          applicationType: 'Leave',
          startDate: { $lte: endOfDay },
          endDate: { $gte: startOfDay }
        },
        {
          applicationType: 'Permission',
          permissionDate: { $gte: startOfDay, $lte: endOfDay }
        }
      ]
    }).populate('student', '_id name');

    console.log('🔍 getStudentsForAttendance - Found approved leaves:', approvedLeaves.length);

    // Create a set of student IDs who are on approved leave
    const studentsOnLeave = new Set(approvedLeaves.map(leave => leave.student._id.toString()));

    // Combine student data with attendance status
    const studentsWithAttendance = students.map(student => {
      const attendance = validAttendance.find(att => 
        att.student && att.student._id && att.student._id.toString() === student._id.toString()
      );
      
      // Check if student is on approved leave
      const isOnLeave = studentsOnLeave.has(student._id.toString());
      
      return {
        ...student, // No need for .toObject() since we're using lean()
        attendance: attendance ? {
          morning: attendance.morning || false,
          evening: attendance.evening || false,
          night: attendance.night || false,
          status: isOnLeave ? 'On Leave' : (attendance.status || 'Absent'),
          percentage: isOnLeave ? 100 : (attendance.percentage || 0)
        } : {
          morning: false,
          evening: false,
          night: false,
          status: isOnLeave ? 'On Leave' : 'Absent',
          percentage: isOnLeave ? 100 : 0
        },
        isOnLeave: isOnLeave
      };
    });

    console.log('🔍 getStudentsForAttendance - Processing complete, returning data');
    
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
    console.error('🔍 getStudentsForAttendance - Error:', error);
    console.error('🔍 getStudentsForAttendance - Error stack:', error.stack);
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

    // Extract all student IDs for batch validation
    const studentIds = attendanceData
      .filter(record => record.studentId)
      .map(record => record.studentId);

    // Batch validate all students at once
    const validStudents = await User.find({ 
      _id: { $in: studentIds }, 
      role: 'student', 
      hostelStatus: 'Active' 
    }).select('_id name');

    const validStudentIds = new Set(validStudents.map(student => student._id.toString()));
    const studentMap = new Map(validStudents.map(student => [student._id.toString(), student]));

    // Prepare bulk operations for attendance
    const bulkOps = [];
    const validRecords = [];

    for (const record of attendanceData) {
      const { studentId, morning, evening, night, notes } = record;
      
      if (!studentId) {
        errors.push({ studentId, error: 'Student ID is required' });
        continue;
      }

      if (!validStudentIds.has(studentId)) {
        errors.push({ studentId, error: 'Student not found or inactive' });
        continue;
      }

      // Prepare upsert operation
      bulkOps.push({
        updateOne: {
          filter: { student: studentId, date: normalizedDate },
          update: {
            $set: {
              morning: morning || false,
              evening: evening || false,
              night: night || false,
              markedBy,
              markedAt: new Date(),
              notes: notes || ''
            }
          },
          upsert: true
        }
      });

      validRecords.push({ studentId, student: studentMap.get(studentId) });
    }

    // Execute bulk operations
    if (bulkOps.length > 0) {
      const bulkResult = await Attendance.bulkWrite(bulkOps);
      console.log(`📊 Bulk attendance operation completed: ${bulkResult.upsertedCount} inserted, ${bulkResult.modifiedCount} updated`);
      
      // Fetch the created/updated attendance records
      const attendanceIds = [];
      for (const record of validRecords) {
        const attendance = await Attendance.findOne({ 
          student: record.studentId, 
          date: normalizedDate 
        });
        if (attendance) {
          results.push(attendance);
          attendanceIds.push(attendance._id);
        }
      }
    }

    // Send notifications to students about attendance being taken (batch processing)
    if (validRecords.length > 0) {
      try {
        // Send notifications in batches to avoid overwhelming the system
        const batchSize = 10;
        for (let i = 0; i < validRecords.length; i += batchSize) {
          const batch = validRecords.slice(i, i + batchSize);
          
          // Process batch in parallel
          const notificationPromises = batch.map(async (record) => {
            const student = record.student;
            const studentName = student?.name || 'Student';
            
            try {
              await notificationService.sendToUser(student._id, {
                type: 'system',
                message: `📊 your attendance has been marked for ${normalizedDate.toDateString()}`,
                sender: markedBy,
                onModel: 'Attendance'
              });
            } catch (error) {
              console.error(`Failed to send notification to student ${student._id}:`, error);
            }
          });
          
          await Promise.all(notificationPromises);
        }

        // Attendance notifications sent to students in batches
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
    const { date, course, branch, gender, studentId, status } = req.query;
    const normalizedDate = normalizeDate(date || new Date());

    // Build base query for attendance
    let attendanceQuery = { date: normalizedDate };

    // Get all attendance records for the date first
    let attendance = await Attendance.find(attendanceQuery)
      .populate({
        path: 'student',
        select: 'name rollNumber course branch year gender roomNumber',
        populate: [
          { path: 'course', select: 'name code' },
          { path: 'branch', select: 'name code' }
        ]
      })
      .populate('markedBy', 'username role');

    // Get approved leaves for the date
    const startOfDay = new Date(normalizedDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(normalizedDate);
    endOfDay.setHours(23, 59, 59, 999);

    const approvedLeaves = await Leave.find({
      status: 'Approved',
      $or: [
        // For Leave applications - check if the date falls within the leave period
        {
          applicationType: 'Leave',
          startDate: { $lte: endOfDay },
          endDate: { $gte: startOfDay }
        },
        // For Permission applications - check if the date matches the permission date
        {
          applicationType: 'Permission',
          permissionDate: { $gte: startOfDay, $lte: endOfDay }
        }
      ]
    }).populate('student', '_id name');

    // Create a set of student IDs who are on approved leave
    const studentsOnLeave = new Set(approvedLeaves
      .filter(leave => leave.student) // Filter out leaves with null student
      .map(leave => leave.student._id.toString())
    );

    // Add isOnLeave flag to attendance records
    attendance = attendance.map(att => {
      // Skip records with null student
      if (!att.student) {
        return {
          ...att.toObject(),
          student: null,
          isOnLeave: false
        };
      }
      
      const isOnLeave = studentsOnLeave.has(att.student._id.toString());
      return {
        ...att.toObject(),
        student: {
          ...att.student.toObject(),
          isOnLeave: isOnLeave
        }
      };
    });



    // Apply filters to the populated attendance records
    if (course) {
      attendance = attendance.filter(att => 
        att.student?.course?._id?.toString() === course || 
        att.student?.course?.toString() === course
      );
    }

    if (branch) {
      attendance = attendance.filter(att => 
        att.student?.branch?._id?.toString() === branch || 
        att.student?.branch?.toString() === branch
      );
    }

    if (gender) {
      attendance = attendance.filter(att => 
        att.student?.gender === gender
      );
    }

    if (studentId) {
      attendance = attendance.filter(att => 
        att.student?.rollNumber?.toLowerCase().includes(studentId.toLowerCase())
      );
    }

    if (status) {
      attendance = attendance.filter(att => {
        const isPresent = att.morning && att.evening && att.night;
        const isPartial = (att.morning || att.evening || att.night) && !isPresent;
        const isAbsent = !att.morning && !att.evening && !att.night;
        
        if (status === 'Present') return isPresent;
        if (status === 'Partial') return isPartial;
        if (status === 'Absent') return isAbsent;
        return true;
      });
    }

    // Calculate statistics from filtered attendance
    const totalStudents = attendance.length;
    const morningPresent = attendance.filter(att => att.morning).length;
    const eveningPresent = attendance.filter(att => att.evening).length;
    const nightPresent = attendance.filter(att => att.night).length;
    const fullyPresent = attendance.filter(att => att.morning && att.evening && att.night).length;
    const partiallyPresent = attendance.filter(att => 
      (att.morning || att.evening || att.night) && !(att.morning && att.evening && att.night)
    ).length;
    const absent = attendance.filter(att => !att.morning && !att.evening && !att.night).length;

    const statistics = {
      totalStudents,
      morningPresent,
      eveningPresent,
      nightPresent,
      fullyPresent,
      partiallyPresent,
      absent
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
    const { startDate, endDate, course, branch, gender, studentId, status } = req.query;
    
    if (!startDate || !endDate) {
      throw createError(400, 'Start date and end date are required');
    }

    const start = normalizeDate(new Date(startDate));
    const end = normalizeDate(new Date(endDate));

    if (start > end) {
      throw createError(400, 'Start date cannot be after end date');
    }

    // Build base query for attendance
    let query = {
      date: { $gte: start, $lte: end }
    };

    // If studentId is provided, filter by student
    if (studentId) {
      query.student = studentId;
    }

    // Get all attendance records for the date range first
    let attendance = await Attendance.find(query)
      .populate({
        path: 'student',
        select: 'name rollNumber course branch year gender roomNumber',
        populate: [
          { path: 'course', select: 'name code' },
          { path: 'branch', select: 'name code' }
        ]
      })
      .populate('markedBy', 'username role')
      .sort({ date: -1, 'student.name': 1 });

    // Get approved leaves for the date range
    const approvedLeaves = await Leave.find({
      status: 'Approved',
      $or: [
        // For Leave applications - check if any date in the range falls within the leave period
        {
          applicationType: 'Leave',
          startDate: { $lte: end },
          endDate: { $gte: start }
        },
        // For Permission applications - check if the permission date falls within the range
        {
          applicationType: 'Permission',
          permissionDate: { $gte: start, $lte: end }
        }
      ]
    }).populate('student', '_id name');

    // Create a map of student IDs to their leave dates
    const studentLeaveDates = new Map();
    approvedLeaves.forEach(leave => {
      // Skip leaves with null student
      if (!leave.student) {
        return;
      }
      
      const studentId = leave.student._id.toString();
      if (!studentLeaveDates.has(studentId)) {
        studentLeaveDates.set(studentId, new Set());
      }
      
      if (leave.applicationType === 'Leave') {
        // Add all dates in the leave period
        const currentDate = new Date(leave.startDate);
        const endDate = new Date(leave.endDate);
        while (currentDate <= endDate) {
          const dateStr = currentDate.toISOString().split('T')[0];
          studentLeaveDates.get(studentId).add(dateStr);
          currentDate.setDate(currentDate.getDate() + 1);
        }
      } else if (leave.applicationType === 'Permission') {
        // Add the permission date
        const dateStr = new Date(leave.permissionDate).toISOString().split('T')[0];
        studentLeaveDates.get(studentId).add(dateStr);
      }
    });

    // Add isOnLeave flag to attendance records
    attendance = attendance.map(att => {
      // Skip records with null student
      if (!att.student) {
        return {
          ...att.toObject(),
          student: null,
          isOnLeave: false
        };
      }
      
      const studentId = att.student._id.toString();
      const leaveDates = studentLeaveDates.get(studentId);
      const dateStr = new Date(att.date).toISOString().split('T')[0];
      const isOnLeave = leaveDates && leaveDates.has(dateStr);
      
      return {
        ...att.toObject(),
        student: {
          ...att.student.toObject(),
          isOnLeave: isOnLeave
        }
      };
    });





    // Apply additional filters to the populated attendance records
    if (course) {
      attendance = attendance.filter(att => 
        att.student?.course?._id?.toString() === course || 
        att.student?.course?.toString() === course
      );
    }

    if (branch) {
      attendance = attendance.filter(att => 
        att.student?.branch?._id?.toString() === branch || 
        att.student?.branch?.toString() === branch
      );
    }

    if (gender) {
      attendance = attendance.filter(att => 
        att.student?.gender === gender
      );
    }

    if (status) {
      attendance = attendance.filter(att => {
        const isPresent = att.morning && att.evening && att.night;
        const isPartial = (att.morning || att.evening || att.night) && !isPresent;
        const isAbsent = !att.morning && !att.evening && !att.night;
        
        if (status === 'Present') return isPresent;
        if (status === 'Partial') return isPartial;
        if (status === 'Absent') return isAbsent;
        return true;
      });
    }

    // Calculate statistics from filtered attendance
    const totalStudents = attendance.length;
    const morningPresent = attendance.filter(att => att.morning).length;
    const eveningPresent = attendance.filter(att => att.evening).length;
    const nightPresent = attendance.filter(att => att.night).length;
    const fullyPresent = attendance.filter(att => att.morning && att.evening && att.night).length;
    const partiallyPresent = attendance.filter(att => 
      (att.morning || att.evening || att.night) && !(att.morning && att.evening && att.night)
    ).length;
    const absent = attendance.filter(att => !att.morning && !att.evening && !att.night).length;

    const statistics = {
      totalStudents,
      morningPresent,
      eveningPresent,
      nightPresent,
      fullyPresent,
      partiallyPresent,
      absent
    };

    res.json({
      success: true,
      data: {
        attendance,
        startDate: start,
        endDate: end,
        totalRecords: attendance.length,
        statistics
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

    // Get approved leaves for the student in the date range
    const approvedLeaves = await Leave.find({
      student: studentId,
      status: 'Approved',
      $or: [
        // For Leave applications - check if any date in the range falls within the leave period
        {
          applicationType: 'Leave',
          startDate: { $lte: end },
          endDate: { $gte: start }
        },
        // For Permission applications - check if the permission date falls within the range
        {
          applicationType: 'Permission',
          permissionDate: { $gte: start, $lte: end }
        }
      ]
    });

    // Create a set of dates when the student was on leave
    const leaveDates = new Set();
    approvedLeaves.forEach(leave => {
      if (leave.applicationType === 'Leave') {
        // Add all dates in the leave period
        const currentDate = new Date(leave.startDate);
        const endDate = new Date(leave.endDate);
        while (currentDate <= endDate) {
          const dateStr = currentDate.toISOString().split('T')[0];
          leaveDates.add(dateStr);
          currentDate.setDate(currentDate.getDate() + 1);
        }
      } else if (leave.applicationType === 'Permission') {
        // Add the permission date
        const dateStr = new Date(leave.permissionDate).toISOString().split('T')[0];
        leaveDates.add(dateStr);
      }
    });

    // Add isOnLeave flag to attendance records
    const attendanceWithLeaveStatus = attendance.map(att => {
      const dateStr = new Date(att.date).toISOString().split('T')[0];
      const isOnLeave = leaveDates.has(dateStr);
      return {
        ...att.toObject(),
        isOnLeave: isOnLeave
      };
    });

    // Calculate attendance statistics
    const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    const presentDays = attendanceWithLeaveStatus.filter(att => (att.morning || att.evening) && !att.isOnLeave).length;
    const fullyPresentDays = attendanceWithLeaveStatus.filter(att => att.morning && att.evening && !att.isOnLeave).length;
    const partiallyPresentDays = attendanceWithLeaveStatus.filter(att => (att.morning || att.evening) && !(att.morning && att.evening) && !att.isOnLeave).length;
    const onLeaveDays = attendanceWithLeaveStatus.filter(att => att.isOnLeave).length;
    const absentDays = totalDays - presentDays - onLeaveDays;

    const statistics = {
      totalDays,
      presentDays,
      fullyPresentDays,
      partiallyPresentDays,
      absentDays,
      onLeaveDays,
      attendancePercentage: totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0
    };

    res.json({
      success: true,
      data: {
        attendance: attendanceWithLeaveStatus,
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
      nightPresent: 0,
      fullyPresent: 0,
      partiallyPresent: 0,
      absent: 0
    };

    // Calculate percentages
    const totalStudents = statistics.totalStudents;
    const percentages = {
      morningPercentage: totalStudents > 0 ? Math.round((statistics.morningPresent / totalStudents) * 100) : 0,
      eveningPercentage: totalStudents > 0 ? Math.round((statistics.eveningPresent / totalStudents) * 100) : 0,
      nightPercentage: totalStudents > 0 ? Math.round((statistics.nightPresent / totalStudents) * 100) : 0,
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
    const { studentId, date, morning, evening, night, notes } = req.body;
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
    attendance.night = night !== undefined ? night : attendance.night;
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
    const { date, branch, gender, studentId, status } = req.query;
    const principal = req.principal;
    const normalizedDate = normalizeDate(date || new Date());

    console.log('🎓 Principal attendance request:', {
      date: normalizedDate,
      course: principal.course,
      branch: principal.branch || branch,
      gender,
      studentId,
      status
    });

    // Build query for students in principal's course (now uses string comparison)
    const studentQuery = { 
      role: 'student', 
      hostelStatus: 'Active',
      course: principal.course // Direct string comparison (course name)
    };

    // Add branch filter - use principal's branch if set, otherwise use query param
    if (principal.branch) {
      studentQuery.branch = principal.branch;
    } else if (branch) {
      studentQuery.branch = branch;
    }
    if (gender) studentQuery.gender = gender;
    if (studentId) studentQuery.rollNumber = { $regex: studentId, $options: 'i' };

    console.log('🎓 Student query:', studentQuery);

    // Get students in principal's course
    const students = await User.find(studentQuery)
      .select('_id name rollNumber course branch year gender roomNumber studentPhoto')
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
      .populate({
        path: 'student',
        select: 'name rollNumber course branch year gender roomNumber',
        populate: [
          { path: 'course', select: 'name code' },
          { path: 'branch', select: 'name code' }
        ]
      });

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

    // Get approved leaves for the date
    const startOfDay = new Date(normalizedDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(normalizedDate);
    endOfDay.setHours(23, 59, 59, 999);

    const approvedLeaves = await Leave.find({
      status: 'Approved',
      verificationStatus: { $ne: 'Completed' }, // Exclude completed leaves
      $or: [
        {
          applicationType: 'Leave',
          startDate: { $lte: endOfDay },
          endDate: { $gte: startOfDay }
        },
        {
          applicationType: 'Permission',
          permissionDate: { $gte: startOfDay, $lte: endOfDay }
        }
      ]
    }).populate('student', '_id name');

    // Create a set of student IDs who are on approved leave
    const studentsOnLeave = new Set(approvedLeaves
      .filter(leave => leave.student) // Filter out leaves with null student
      .map(leave => leave.student._id.toString())
    );

    // Create a map of student attendance
    const attendanceMap = new Map();
    attendance.forEach(att => {
      // Skip records with null student
      if (att.student) {
        attendanceMap.set(att.student._id.toString(), att);
      }
    });

    // Combine student data with attendance status
    const studentsWithAttendance = students.map(student => {
      const studentAttendance = attendanceMap.get(student._id.toString());
      const isOnLeave = studentsOnLeave.has(student._id.toString());
      
      let status;
      if (isOnLeave) {
        status = 'On Leave';
      } else if (studentAttendance) {
        status = (studentAttendance.morning && studentAttendance.evening && studentAttendance.night) ? 'Present' : 
                 (studentAttendance.morning || studentAttendance.evening || studentAttendance.night) ? 'Partial' : 'Absent';
      } else {
        status = 'Absent';
      }
      
      const result = {
        ...student.toObject(),
        morning: studentAttendance?.morning || false,
        evening: studentAttendance?.evening || false,
        night: studentAttendance?.night || false,
        status: status,
        notes: studentAttendance?.notes || '',
        isOnLeave: isOnLeave
      };
      
      console.log('🎓 Student attendance:', {
        name: result.name,
        status: result.status,
        morning: result.morning,
        evening: result.evening,
        night: result.night,
        isOnLeave: result.isOnLeave
      });
      
      return result;
    });

    // Apply status filter if provided
    let filteredAttendance = studentsWithAttendance;
    if (status) {
      filteredAttendance = studentsWithAttendance.filter(student => {
        if (status === 'Present') return student.status === 'Present';
        if (status === 'Partial') return student.status === 'Partial';
        if (status === 'Absent') return student.status === 'Absent';
        if (status === 'On Leave') return student.status === 'On Leave';
        return true;
      });
    }

    console.log('🎓 Students with attendance after filtering:', filteredAttendance.length);

    // Calculate statistics
    const totalStudents = filteredAttendance.length;
    const morningPresent = filteredAttendance.filter(s => s.morning).length;
    const eveningPresent = filteredAttendance.filter(s => s.evening).length;
    const nightPresent = filteredAttendance.filter(s => s.night).length;
    const fullyPresent = filteredAttendance.filter(s => s.status === 'Present').length;
    const partiallyPresent = filteredAttendance.filter(s => s.status === 'Partial').length;
    const absent = filteredAttendance.filter(s => s.status === 'Absent').length;
    const onLeave = filteredAttendance.filter(s => s.status === 'On Leave').length;

    const statistics = {
      totalStudents,
      morningPresent,
      eveningPresent,
      nightPresent,
      fullyPresent,
      partiallyPresent,
      absent,
      onLeave
    };

    const response = {
      success: true,
      data: {
        attendance: filteredAttendance,
        statistics,
        date: normalizedDate,
        course: principal.course
      }
    };

    console.log('🎓 Sending response with', filteredAttendance.length, 'attendance records');
    res.json(response);
  } catch (error) {
    console.error('🎓 Error in getPrincipalAttendanceForDate:', error);
    next(error);
  }
};

// Get attendance for principal's course for a date range
export const getPrincipalAttendanceForRange = async (req, res, next) => {
  try {
    const { startDate, endDate, branch, gender, studentId, status } = req.query;
    const principal = req.principal;
    
    if (!startDate || !endDate) {
      throw createError(400, 'Start date and end date are required');
    }

    const start = normalizeDate(new Date(startDate));
    const end = normalizeDate(new Date(endDate));

    if (start > end) {
      throw createError(400, 'Start date cannot be after end date');
    }

    // Build query for students in principal's course (now uses string comparison)
    const studentQuery = { 
      role: 'student', 
      hostelStatus: 'Active',
      course: principal.course // Direct string comparison (course name)
    };

    // Add branch filter - use principal's branch if set, otherwise use query param
    if (principal.branch) {
      studentQuery.branch = principal.branch;
    } else if (branch) {
      studentQuery.branch = branch;
    }
    if (gender) studentQuery.gender = gender;
    if (studentId) studentQuery.rollNumber = { $regex: studentId, $options: 'i' };

    // Get students in principal's course
    const students = await User.find(studentQuery)
      .select('_id name rollNumber course branch year gender roomNumber studentPhoto')
      .sort({ name: 1 });

    const studentIds = students.map(student => student._id);

    // Get attendance for these students in the date range
    const attendance = await Attendance.find({
      student: { $in: studentIds },
      date: { $gte: start, $lte: end }
    }).populate({
      path: 'student',
      select: 'name rollNumber course branch year gender roomNumber'
    }).sort({ date: -1, 'student.name': 1 });

    // Get approved leaves for the date range
    const approvedLeaves = await Leave.find({
      status: 'Approved',
      verificationStatus: { $ne: 'Completed' }, // Exclude completed leaves
      $or: [
        // For Leave applications - check if any date in the range falls within the leave period
        {
          applicationType: 'Leave',
          startDate: { $lte: end },
          endDate: { $gte: start }
        },
        // For Permission applications - check if the permission date falls within the range
        {
          applicationType: 'Permission',
          permissionDate: { $gte: start, $lte: end }
        }
      ]
    }).populate('student', '_id name');

    // Create a map of student IDs to their leave dates
    const studentLeaveDates = new Map();
    approvedLeaves.forEach(leave => {
      // Skip leaves with null student
      if (!leave.student) {
        return;
      }
      
      const studentId = leave.student._id.toString();
      if (!studentLeaveDates.has(studentId)) {
        studentLeaveDates.set(studentId, new Set());
      }
      
      if (leave.applicationType === 'Leave') {
        // Add all dates in the leave period
        const currentDate = new Date(leave.startDate);
        const endDate = new Date(leave.endDate);
        while (currentDate <= endDate) {
          const dateStr = currentDate.toISOString().split('T')[0];
          studentLeaveDates.get(studentId).add(dateStr);
          currentDate.setDate(currentDate.getDate() + 1);
        }
      } else if (leave.applicationType === 'Permission') {
        // Add the permission date
        const dateStr = new Date(leave.permissionDate).toISOString().split('T')[0];
        studentLeaveDates.get(studentId).add(dateStr);
      }
    });

    // Add isOnLeave flag to attendance records
    const attendanceWithLeaveStatus = attendance.map(att => {
      // Skip records with null student
      if (!att.student) {
        return {
          ...att.toObject(),
          student: null,
          isOnLeave: false,
          status: 'Absent'
        };
      }
      
      const studentId = att.student._id.toString();
      const leaveDates = studentLeaveDates.get(studentId);
      const dateStr = new Date(att.date).toISOString().split('T')[0];
      const isOnLeave = leaveDates && leaveDates.has(dateStr);
      
      let status;
      if (isOnLeave) {
        status = 'On Leave';
      } else {
        status = (att.morning && att.evening && att.night) ? 'Present' : 
                 (att.morning || att.evening || att.night) ? 'Partial' : 'Absent';
      }
      
      return {
        ...att.toObject(),
        student: {
          ...att.student.toObject(),
          isOnLeave: isOnLeave
        },
        status: status
      };
    });

    // Apply status filter if provided
    let filteredAttendance = attendanceWithLeaveStatus;
    if (status) {
      filteredAttendance = attendanceWithLeaveStatus.filter(att => {
        if (status === 'Present') return att.status === 'Present';
        if (status === 'Partial') return att.status === 'Partial';
        if (status === 'Absent') return att.status === 'Absent';
        if (status === 'On Leave') return att.status === 'On Leave';
        return true;
      });
    }

    // Calculate statistics
    const totalStudents = students.length;
    const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    const totalPossibleAttendance = totalStudents * totalDays;
    
    const presentRecords = filteredAttendance.filter(att => att.status === 'Present').length;
    const partialRecords = filteredAttendance.filter(att => att.status === 'Partial').length;
    const absentRecords = filteredAttendance.filter(att => att.status === 'Absent').length;
    const onLeaveRecords = filteredAttendance.filter(att => att.status === 'On Leave').length;
    
    const overallAttendanceRate = totalPossibleAttendance > 0 ? 
      Math.round(((presentRecords + partialRecords) / totalPossibleAttendance) * 100) : 0;

    const statistics = {
          totalStudents,
          totalDays,
          presentRecords,
          partialRecords,
          absentRecords,
      onLeaveRecords,
          overallAttendanceRate
    };

    res.json({
      success: true,
      data: {
        attendance: filteredAttendance,
        statistics,
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
      principalBranch: principal.branch
    });

    // Build query for students in principal's course (now uses string comparison)
    const query = {
      role: 'student',
      hostelStatus: 'Active',
      course: principal.course // Direct string comparison (course name)
    };
    
    // Add branch filter if principal has a specific branch assigned
    if (principal.branch) {
      query.branch = principal.branch;
    }

    console.log('🎓 Student count query:', query);

    const totalStudents = await User.countDocuments(query);

    console.log('🎓 Total students found:', totalStudents);

    // Debug: Let's also check what students exist
    const sampleStudents = await User.find({ role: 'student', hostelStatus: 'Active' })
      .select('name rollNumber course')
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

    // Get students in principal's course (now uses string comparison)
    const studentQuery = {
      role: 'student',
      hostelStatus: 'Active',
      course: principal.course // Direct string comparison (course name)
    };
    
    // Add branch filter if principal has a specific branch assigned
    if (principal.branch) {
      studentQuery.branch = principal.branch;
    }

    console.log('🎓 Student query for attendance stats:', studentQuery);

    const students = await User.find(studentQuery)
      .select('_id name rollNumber course branch year gender roomNumber');

    console.log('🎓 Students found for attendance stats:', students.length);

    const studentIds = students.map(student => student._id);

    // Get attendance for these students on the specified date
    const attendance = await Attendance.find({
      student: { $in: studentIds },
      date: normalizedDate
    }).populate('student', 'name rollNumber course branch year gender roomNumber');

    // Calculate statistics in the format expected by frontend
    const totalStudents = students.length;
    const presentToday = attendance.filter(att => att.morning && att.evening && att.night).length;
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
        night: att.night,
        status: att.morning && att.evening && att.night ? 'Present' : 
                att.morning || att.evening || att.night ? 'Partial' : 'Absent',
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

// Get students by attendance status for principal's course
export const getPrincipalStudentsByStatus = async (req, res, next) => {
  try {
    const { date, status } = req.query;
    const principal = req.principal;
    const normalizedDate = normalizeDate(date || new Date());

    console.log('🎓 Principal students by status request:', {
      date: normalizedDate,
      status,
      course: principal.course
    });

    // Build query for students in principal's course (now uses string comparison)
    const studentQuery = { 
      role: 'student', 
      hostelStatus: 'Active',
      course: principal.course // Direct string comparison (course name)
    };
    
    // Add branch filter if principal has a specific branch assigned
    if (principal.branch) {
      studentQuery.branch = principal.branch;
    }

    console.log('🎓 Student query:', studentQuery);

    // Get students in principal's course
    const students = await User.find(studentQuery)
      .select('_id name rollNumber course branch year gender roomNumber studentPhoto')
      .sort({ name: 1 });

    console.log('🎓 Found students:', students.length);

    const studentIds = students.map(student => student._id);

    // Get attendance for these students on the specified date
    const attendanceQuery = {
      student: { $in: studentIds },
      date: normalizedDate
    };
    
    const attendance = await Attendance.find(attendanceQuery)
      .populate({
        path: 'student',
        select: 'name rollNumber course branch year gender roomNumber studentPhoto',
        populate: [
          { path: 'course', select: 'name code' },
          { path: 'branch', select: 'name code' }
        ]
      });

    // Get approved leaves for the date
    const startOfDay = new Date(normalizedDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(normalizedDate);
    endOfDay.setHours(23, 59, 59, 999);

    const approvedLeaves = await Leave.find({
      status: 'Approved',
      verificationStatus: { $ne: 'Completed' },
      $or: [
        {
          applicationType: 'Leave',
          startDate: { $lte: endOfDay },
          endDate: { $gte: startOfDay }
        },
        {
          applicationType: 'Permission',
          permissionDate: { $gte: startOfDay, $lte: endOfDay }
        }
      ]
    }).populate('student', '_id name');

    // Create a set of student IDs who are on approved leave
    const studentsOnLeave = new Set(approvedLeaves
      .filter(leave => leave.student)
      .map(leave => leave.student._id.toString())
    );

    // Create a map of student attendance
    const attendanceMap = new Map();
    attendance.forEach(att => {
      if (att.student) {
        attendanceMap.set(att.student._id.toString(), att);
      }
    });

    // Combine student data with attendance status
    const studentsWithAttendance = students.map(student => {
      const studentAttendance = attendanceMap.get(student._id.toString());
      const isOnLeave = studentsOnLeave.has(student._id.toString());
      
      let status;
      if (isOnLeave) {
        status = 'On Leave';
      } else if (studentAttendance) {
        status = (studentAttendance.morning && studentAttendance.evening && studentAttendance.night) ? 'Present' : 
                 (studentAttendance.morning || studentAttendance.evening || studentAttendance.night) ? 'Partial' : 'Absent';
      } else {
        status = 'Absent';
      }
      
      return {
        ...student.toObject(),
        morning: studentAttendance?.morning || false,
        evening: studentAttendance?.evening || false,
        night: studentAttendance?.night || false,
        status: status,
        notes: studentAttendance?.notes || '',
        isOnLeave: isOnLeave
      };
    });

    // Filter by status if provided
    let filteredStudents = studentsWithAttendance;
    if (status) {
      filteredStudents = studentsWithAttendance.filter(student => {
        if (status === 'Present') return student.status === 'Present';
        if (status === 'Partial') return student.status === 'Partial';
        if (status === 'Absent') return student.status === 'Absent';
        if (status === 'On Leave') return student.status === 'On Leave';
        // Handle session-specific statuses
        if (status === 'Morning') return student.morning === true;
        if (status === 'Evening') return student.evening === true;
        if (status === 'Night') return student.night === true;
        return true;
      });
    }

    console.log('🎓 Students filtered by status:', filteredStudents.length);

    res.json({
      success: true,
      data: {
        students: filteredStudents,
        status: status || 'All',
        date: normalizedDate,
        count: filteredStudents.length
      }
    });
  } catch (error) {
    console.error('🎓 Error in getPrincipalStudentsByStatus:', error);
    next(error);
  }
};

// Generate comprehensive attendance report for PDF
export const generateAttendanceReport = async (req, res, next) => {
  try {
    const { startDate, endDate, course, branch, gender, studentId, status, reportType } = req.query;
    const userRole = req.admin?.role || req.user?.role;
    const principal = req.principal; // Get principal from request
    
    let attendanceData = [];
    let statistics = {};
    let reportInfo = {};

    // Determine date range
    const start = startDate ? normalizeDate(new Date(startDate)) : normalizeDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    const end = endDate ? normalizeDate(new Date(endDate)) : normalizeDate(new Date());

    if (start > end) {
      throw createError(400, 'Start date cannot be after end date');
    }

    // Build query based on user role
    let query = {
      date: { $gte: start, $lte: end }
    };

    // If studentId is provided, filter by student
    if (studentId) {
      query.student = studentId;
    }

    // Get attendance data
    let attendance = await Attendance.find(query)
      .populate({
        path: 'student',
        select: 'name rollNumber course branch year gender roomNumber',
        populate: [
          { path: 'course', select: 'name code' },
          { path: 'branch', select: 'name code' }
        ]
      })
      .populate('markedBy', 'username role')
      .sort({ date: -1, 'student.name': 1 });

    // Filter by principal's course if user is a principal (now uses string comparison)
    if (principal && principal.role === 'principal' && principal.course) {
      attendance = attendance.filter(att => {
        if (!att.student || !att.student.course) return false;
        // Direct string comparison - both are course names now
        const studentCourse = typeof att.student.course === 'object' ? att.student.course.name : att.student.course;
        return studentCourse === principal.course;
      });
      
      // Also filter by branch if principal has a specific branch assigned
      if (principal.branch) {
        attendance = attendance.filter(att => {
          if (!att.student || !att.student.branch) return false;
          const studentBranch = typeof att.student.branch === 'object' ? att.student.branch.name : att.student.branch;
          return studentBranch === principal.branch;
        });
      }
    }

    // Get approved leaves for the date range
    const approvedLeaves = await Leave.find({
      status: 'Approved',
      $or: [
        {
          applicationType: 'Leave',
          startDate: { $lte: end },
          endDate: { $gte: start }
        },
        {
          applicationType: 'Permission',
          permissionDate: { $gte: start, $lte: end }
        }
      ]
    }).populate('student', '_id name');

    // Create a map of student IDs to their leave dates
    const studentLeaveDates = new Map();
    approvedLeaves.forEach(leave => {
      if (!leave.student) return;
      
      const studentId = leave.student._id.toString();
      if (!studentLeaveDates.has(studentId)) {
        studentLeaveDates.set(studentId, new Set());
      }
      
      if (leave.applicationType === 'Leave') {
        const currentDate = new Date(leave.startDate);
        const endDate = new Date(leave.endDate);
        while (currentDate <= endDate) {
          const dateStr = currentDate.toISOString().split('T')[0];
          studentLeaveDates.get(studentId).add(dateStr);
          currentDate.setDate(currentDate.getDate() + 1);
        }
      } else if (leave.applicationType === 'Permission') {
        const dateStr = new Date(leave.permissionDate).toISOString().split('T')[0];
        studentLeaveDates.get(studentId).add(dateStr);
      }
    });

    // Add isOnLeave flag to attendance records
    attendance = attendance.map(att => {
      if (!att.student) {
        return {
          ...att.toObject(),
          student: null,
          isOnLeave: false
        };
      }
      
      const studentId = att.student._id.toString();
      const leaveDates = studentLeaveDates.get(studentId);
      const dateStr = new Date(att.date).toISOString().split('T')[0];
      const isOnLeave = leaveDates && leaveDates.has(dateStr);
      
      return {
        ...att.toObject(),
        student: {
          ...att.student.toObject(),
          isOnLeave: isOnLeave
        }
      };
    });

    // Apply additional filters (only if not a principal, as principal is already filtered by course)
    if (!principal || principal.role !== 'principal') {
      if (course) {
        attendance = attendance.filter(att => 
          att.student?.course?._id?.toString() === course || 
          att.student?.course?.toString() === course
        );
      }
    }

    if (branch) {
      attendance = attendance.filter(att => 
        att.student?.branch?._id?.toString() === branch || 
        att.student?.branch?.toString() === branch
      );
    }

    if (gender) {
      attendance = attendance.filter(att => 
        att.student?.gender === gender
      );
    }

    if (status) {
      attendance = attendance.filter(att => {
        const isPresent = att.morning && att.evening && att.night;
        const isPartial = (att.morning || att.evening || att.night) && !isPresent;
        const isAbsent = !att.morning && !att.evening && !att.night;
        
        if (status === 'Present') return isPresent;
        if (status === 'Partial') return isPartial;
        if (status === 'Absent') return isAbsent;
        return true;
      });
    }

    // Calculate comprehensive statistics
    const totalRecords = attendance.length;
    const totalStudents = new Set(attendance.map(att => att.student?._id)).size;
    const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    
    const morningPresent = attendance.filter(att => att.morning).length;
    const eveningPresent = attendance.filter(att => att.evening).length;
    const nightPresent = attendance.filter(att => att.night).length;
    const fullyPresent = attendance.filter(att => att.morning && att.evening && att.night).length;
    const partiallyPresent = attendance.filter(att => 
      (att.morning || att.evening || att.night) && !(att.morning && att.evening && att.night)
    ).length;
    const absent = attendance.filter(att => !att.morning && !att.evening && !att.night).length;
    const onLeave = attendance.filter(att => att.student?.isOnLeave).length;

    // Calculate attendance percentages
    const totalPossibleAttendance = totalStudents * totalDays;
    const overallAttendanceRate = totalPossibleAttendance > 0 ? 
      Math.round(((fullyPresent + partiallyPresent) / totalPossibleAttendance) * 100) : 0;

    // Generate analytics by course, branch, and gender
    const courseAnalytics = {};
    const branchAnalytics = {};
    const genderAnalytics = {};

    attendance.forEach(att => {
      if (!att.student) return;

      const courseName = att.student.course?.name || 'Unknown';
      const branchName = att.student.branch?.name || 'Unknown';
      const gender = att.student.gender || 'Unknown';

      // Course analytics
      if (!courseAnalytics[courseName]) {
        courseAnalytics[courseName] = { total: 0, present: 0, partial: 0, absent: 0 };
      }
      courseAnalytics[courseName].total++;
      if (att.morning && att.evening && att.night) courseAnalytics[courseName].present++;
      else if (att.morning || att.evening || att.night) courseAnalytics[courseName].partial++;
      else courseAnalytics[courseName].absent++;

      // Branch analytics
      if (!branchAnalytics[branchName]) {
        branchAnalytics[branchName] = { total: 0, present: 0, partial: 0, absent: 0 };
      }
      branchAnalytics[branchName].total++;
      if (att.morning && att.evening && att.night) branchAnalytics[branchName].present++;
      else if (att.morning || att.evening || att.night) branchAnalytics[branchName].partial++;
      else branchAnalytics[branchName].absent++;

      // Gender analytics
      if (!genderAnalytics[gender]) {
        genderAnalytics[gender] = { total: 0, present: 0, partial: 0, absent: 0 };
      }
      genderAnalytics[gender].total++;
      if (att.morning && att.evening && att.night) genderAnalytics[gender].present++;
      else if (att.morning || att.evening || att.night) genderAnalytics[gender].partial++;
      else genderAnalytics[gender].absent++;
    });

    // Calculate percentages for analytics
    Object.keys(courseAnalytics).forEach(course => {
      const analytics = courseAnalytics[course];
      analytics.presentPercentage = analytics.total > 0 ? Math.round((analytics.present / analytics.total) * 100) : 0;
      analytics.partialPercentage = analytics.total > 0 ? Math.round((analytics.partial / analytics.total) * 100) : 0;
      analytics.absentPercentage = analytics.total > 0 ? Math.round((analytics.absent / analytics.total) * 100) : 0;
    });

    Object.keys(branchAnalytics).forEach(branch => {
      const analytics = branchAnalytics[branch];
      analytics.presentPercentage = analytics.total > 0 ? Math.round((analytics.present / analytics.total) * 100) : 0;
      analytics.partialPercentage = analytics.total > 0 ? Math.round((analytics.partial / analytics.total) * 100) : 0;
      analytics.absentPercentage = analytics.total > 0 ? Math.round((analytics.absent / analytics.total) * 100) : 0;
    });

    Object.keys(genderAnalytics).forEach(gender => {
      const analytics = genderAnalytics[gender];
      analytics.presentPercentage = analytics.total > 0 ? Math.round((analytics.present / analytics.total) * 100) : 0;
      analytics.partialPercentage = analytics.total > 0 ? Math.round((analytics.partial / analytics.total) * 100) : 0;
      analytics.absentPercentage = analytics.total > 0 ? Math.round((analytics.absent / analytics.total) * 100) : 0;
    });

    statistics = {
      totalRecords,
      totalStudents,
      totalDays,
      morningPresent,
      eveningPresent,
      nightPresent,
      fullyPresent,
      partiallyPresent,
      absent,
      onLeave,
      overallAttendanceRate,
      courseAnalytics,
      branchAnalytics,
      genderAnalytics
    };

    reportInfo = {
      startDate: start,
      endDate: end,
      filters: { course, branch, gender, studentId, status },
      userRole,
      generatedAt: new Date(),
      reportType: reportType || 'comprehensive'
    };

    res.json({
      success: true,
      data: {
        attendance: attendance,
        statistics,
        reportInfo
      }
    });
  } catch (error) {
    console.error('Error generating attendance report:', error);
    next(error);
  }
};