import StaffAttendance from '../models/StaffAttendance.js';
import StaffGuest from '../models/StaffGuest.js';
import { createError } from '../utils/error.js';
import notificationService from '../utils/notificationService.js';

// Helper to normalize date to start of day
function normalizeDate(date) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Get staff/guests for attendance taking
export const getStaffForAttendance = async (req, res, next) => {
  try {
    const { date, department, type, gender } = req.query;
    const normalizedDate = normalizeDate(date || new Date());

    console.log('🔍 getStaffForAttendance - Query params:', { date, department, type, gender });
    console.log('🔍 getStaffForAttendance - Normalized date:', normalizedDate);

    // Build query for active staff/guests
    const query = { 
      isActive: true 
    };

    // Add filters if provided (only if they have valid values)
    if (department && department.trim() !== '') query.department = department;
    if (type && type.trim() !== '') query.type = type;
    if (gender && gender.trim() !== '') query.gender = gender;

    console.log('🔍 getStaffForAttendance - Query:', query);
    
    const staff = await StaffGuest.find(query)
      .select('name type gender profession department phoneNumber email photo')
      .sort({ name: 1 })
      .lean(); // Use lean() for better performance

    console.log('🔍 getStaffForAttendance - Found staff:', staff.length);

    // Get existing attendance for the date
    const existingAttendance = await StaffAttendance.find({
      date: normalizedDate
    }).populate('staffId', '_id');

    console.log('🔍 getStaffForAttendance - Found attendance records:', existingAttendance.length);

    // Filter out attendance records with null/undefined staff references
    const validAttendance = existingAttendance.filter(att => {
      if (!att.staffId) {
        console.warn('🔍 getStaffForAttendance - Found attendance record with null staff:', att._id);
        return false;
      }
      return true;
    });

    const staffIdsWithAttendance = validAttendance
      .filter(att => att.staffId && att.staffId._id) // Additional safety check
      .map(att => att.staffId._id.toString());

    // Combine staff data with attendance status
    const staffWithAttendance = staff.map(staffMember => {
      const attendance = validAttendance.find(att => 
        att.staffId && att.staffId._id && att.staffId._id.toString() === staffMember._id.toString()
      );
      
      return {
        ...staffMember, // No need for .toObject() since we're using lean()
        attendance: attendance ? {
          morning: attendance.morning || false,
          evening: attendance.evening || false,
          night: attendance.night || false,
          status: attendance.status || 'Absent',
          percentage: attendance.percentage || 0
        } : {
          morning: false,
          evening: false,
          night: false,
          status: 'Absent',
          percentage: 0
        }
      };
    });

    console.log('🔍 getStaffForAttendance - Processing complete, returning data');
    
    res.json({
      success: true,
      data: {
        staff: staffWithAttendance,
        date: normalizedDate,
        totalStaff: staff.length,
        attendanceTaken: staffIdsWithAttendance.length
      }
    });
  } catch (error) {
    console.error('🔍 getStaffForAttendance - Error:', error);
    console.error('🔍 getStaffForAttendance - Error stack:', error.stack);
    next(error);
  }
};

// Take staff attendance for a specific date
export const takeStaffAttendance = async (req, res, next) => {
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

    // Extract all staff IDs for batch validation
    const staffIds = attendanceData
      .filter(record => record.staffId)
      .map(record => record.staffId);

    // Batch validate all staff at once
    const validStaff = await StaffGuest.find({ 
      _id: { $in: staffIds }, 
      isActive: true 
    }).select('_id name');

    const validStaffIds = new Set(validStaff.map(staff => staff._id.toString()));
    const staffMap = new Map(validStaff.map(staff => [staff._id.toString(), staff]));

    // Prepare bulk operations for attendance
    const bulkOps = [];
    const validRecords = [];

    for (const record of attendanceData) {
      const { staffId, morning, evening, night, notes } = record;
      
      if (!staffId) {
        errors.push({ staffId, error: 'Staff ID is required' });
        continue;
      }

      if (!validStaffIds.has(staffId)) {
        errors.push({ staffId, error: 'Staff not found or inactive' });
        continue;
      }

      // Prepare upsert operation
      bulkOps.push({
        updateOne: {
          filter: { staffId: staffId, date: normalizedDate },
          update: {
            $set: {
              morning: morning || false,
              evening: evening || false,
              night: night || false,
              takenBy: markedBy,
              notes: notes || ''
            }
          },
          upsert: true
        }
      });

      validRecords.push({ staffId, staff: staffMap.get(staffId) });
    }

    // Execute bulk operations
    if (bulkOps.length > 0) {
      const bulkResult = await StaffAttendance.bulkWrite(bulkOps);
      console.log(`📊 Bulk staff attendance operation completed: ${bulkResult.upsertedCount} inserted, ${bulkResult.modifiedCount} updated`);
      
      // Fetch the created/updated attendance records
      for (const record of validRecords) {
        const attendance = await StaffAttendance.findOne({ 
          staffId: record.staffId, 
          date: normalizedDate 
        });
        if (attendance) {
          results.push(attendance);
        }
      }
    }

    // Send notifications to staff about attendance being taken (batch processing)
    if (validRecords.length > 0) {
      try {
        // Send notifications in batches to avoid overwhelming the system
        const batchSize = 10;
        for (let i = 0; i < validRecords.length; i += batchSize) {
          const batch = validRecords.slice(i, i + batchSize);
          
          // Process batch in parallel
          const notificationPromises = batch.map(async (record) => {
            const staff = record.staff;
            const staffName = staff?.name || 'Staff Member';
            
            try {
              // Note: Staff don't have user accounts, so we'll skip notifications for now
              // In the future, if staff have user accounts, we can send notifications
              console.log(`📊 Staff attendance marked for ${staffName} on ${normalizedDate.toDateString()}`);
            } catch (error) {
              console.error(`Failed to process notification for staff ${staff._id}:`, error);
            }
          });
          
          await Promise.all(notificationPromises);
        }

        // Staff attendance notifications processed
      } catch (notificationError) {
        console.error('Error processing staff attendance notification:', notificationError);
      }
    }

    res.json({
      success: true,
      message: `Staff attendance taken for ${results.length} staff members`,
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

// Get staff attendance for a specific date
export const getStaffAttendanceForDate = async (req, res, next) => {
  try {
    const { date, department, type, gender, staffId, status } = req.query;
    const normalizedDate = normalizeDate(date || new Date());

    // Build base query for attendance
    let attendanceQuery = { date: normalizedDate };

    // Get all attendance records for the date first
    let attendance = await StaffAttendance.find(attendanceQuery)
      .populate({
        path: 'staffId',
        select: 'name type gender profession department phoneNumber email photo'
      })
      .populate('takenBy', 'username role');

    // Apply filters to the populated attendance records
    if (department) {
      attendance = attendance.filter(att => 
        att.staffId?.department === department
      );
    }

    if (type) {
      attendance = attendance.filter(att => 
        att.staffId?.type === type
      );
    }

    if (gender) {
      attendance = attendance.filter(att => 
        att.staffId?.gender === gender
      );
    }

    if (staffId) {
      attendance = attendance.filter(att => 
        att.staffId?.name?.toLowerCase().includes(staffId.toLowerCase())
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
    const totalStaff = attendance.length;
    const morningPresent = attendance.filter(att => att.morning).length;
    const eveningPresent = attendance.filter(att => att.evening).length;
    const nightPresent = attendance.filter(att => att.night).length;
    const fullyPresent = attendance.filter(att => att.morning && att.evening && att.night).length;
    const partiallyPresent = attendance.filter(att => 
      (att.morning || att.evening || att.night) && !(att.morning && att.evening && att.night)
    ).length;
    const absent = attendance.filter(att => !att.morning && !att.evening && !att.night).length;

    const statistics = {
      totalStaff,
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

// Get staff attendance for a date range
export const getStaffAttendanceForDateRange = async (req, res, next) => {
  try {
    const { startDate, endDate, department, type, gender, staffId, status } = req.query;
    
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

    // If staffId is provided, filter by staff
    if (staffId) {
      query.staffId = staffId;
    }

    // Get all attendance records for the date range first
    let attendance = await StaffAttendance.find(query)
      .populate({
        path: 'staffId',
        select: 'name type gender profession department phoneNumber email photo'
      })
      .populate('takenBy', 'username role')
      .sort({ date: -1, 'staffId.name': 1 });

    // Apply additional filters to the populated attendance records
    if (department) {
      attendance = attendance.filter(att => 
        att.staffId?.department === department
      );
    }

    if (type) {
      attendance = attendance.filter(att => 
        att.staffId?.type === type
      );
    }

    if (gender) {
      attendance = attendance.filter(att => 
        att.staffId?.gender === gender
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
    const totalStaff = attendance.length;
    const morningPresent = attendance.filter(att => att.morning).length;
    const eveningPresent = attendance.filter(att => att.evening).length;
    const nightPresent = attendance.filter(att => att.night).length;
    const fullyPresent = attendance.filter(att => att.morning && att.evening && att.night).length;
    const partiallyPresent = attendance.filter(att => 
      (att.morning || att.evening || att.night) && !(att.morning && att.evening && att.night)
    ).length;
    const absent = attendance.filter(att => !att.morning && !att.evening && !att.night).length;

    const statistics = {
      totalStaff,
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

// Get staff attendance statistics for dashboard
export const getStaffAttendanceStats = async (req, res, next) => {
  try {
    const { date } = req.query;
    const normalizedDate = normalizeDate(date || new Date());

    // Get all active staff
    const totalStaff = await StaffGuest.countDocuments({ isActive: true });

    // Get attendance for the date
    const attendance = await StaffAttendance.find({ date: normalizedDate });

    // Calculate statistics
    const morningPresent = attendance.filter(att => att.morning).length;
    const eveningPresent = attendance.filter(att => att.evening).length;
    const nightPresent = attendance.filter(att => att.night).length;
    const fullyPresent = attendance.filter(att => att.morning && att.evening && att.night).length;
    const partiallyPresent = attendance.filter(att => 
      (att.morning || att.evening || att.night) && !(att.morning && att.evening && att.night)
    ).length;
    const absent = totalStaff - fullyPresent - partiallyPresent;

    const statistics = {
      totalStaff,
      morningPresent,
      eveningPresent,
      nightPresent,
      fullyPresent,
      partiallyPresent,
      absent
    };

    // Calculate percentages
    const percentages = {
      morningPercentage: totalStaff > 0 ? Math.round((statistics.morningPresent / totalStaff) * 100) : 0,
      eveningPercentage: totalStaff > 0 ? Math.round((statistics.eveningPresent / totalStaff) * 100) : 0,
      nightPercentage: totalStaff > 0 ? Math.round((statistics.nightPresent / totalStaff) * 100) : 0,
      fullyPresentPercentage: totalStaff > 0 ? Math.round((statistics.fullyPresent / totalStaff) * 100) : 0,
      partiallyPresentPercentage: totalStaff > 0 ? Math.round((statistics.partiallyPresent / totalStaff) * 100) : 0,
      absentPercentage: totalStaff > 0 ? Math.round((statistics.absent / totalStaff) * 100) : 0
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

// Update staff attendance for a specific staff member and date
export const updateStaffAttendance = async (req, res, next) => {
  try {
    const { staffId, date, morning, evening, night, notes } = req.body;
    const takenBy = req.admin ? req.admin._id : req.user._id;

    if (!staffId || !date) {
      throw createError(400, 'Staff ID and date are required');
    }

    const normalizedDate = normalizeDate(date);

    // Check if attendance record exists
    let attendance = await StaffAttendance.findOne({
      staffId: staffId,
      date: normalizedDate
    });

    if (!attendance) {
      throw createError(404, 'Staff attendance record not found');
    }

    // Update attendance
    attendance.morning = morning !== undefined ? morning : attendance.morning;
    attendance.evening = evening !== undefined ? evening : attendance.evening;
    attendance.night = night !== undefined ? night : attendance.night;
    attendance.notes = notes || attendance.notes;
    attendance.takenBy = takenBy;

    await attendance.save();

    res.json({
      success: true,
      message: 'Staff attendance updated successfully',
      data: attendance
    });
  } catch (error) {
    next(error);
  }
};

// Delete staff attendance for a specific staff member and date
export const deleteStaffAttendance = async (req, res, next) => {
  try {
    const { staffId, date } = req.params;

    if (!staffId || !date) {
      throw createError(400, 'Staff ID and date are required');
    }

    const normalizedDate = normalizeDate(new Date(date));

    const attendance = await StaffAttendance.findOneAndDelete({
      staffId: staffId,
      date: normalizedDate
    });

    if (!attendance) {
      throw createError(404, 'Staff attendance record not found');
    }

    res.json({
      success: true,
      message: 'Staff attendance record deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Get staff count for warden (filtered by gender)
export const getStaffCount = async (req, res, next) => {
  try {
    const { gender } = req.query;
    const warden = req.admin || req.user;

    console.log('🔍 getStaffCount - Warden data:', {
      wardenId: warden._id,
      wardenHostelType: warden.hostelType,
      requestedGender: gender
    });

    // Build query based on warden's hostel type and requested gender
    const query = { isActive: true };
    
    // If gender is specified, use it; otherwise use warden's hostel type
    if (gender) {
      query.gender = gender;
    } else if (warden.hostelType) {
      // Map hostel type to gender
      if (warden.hostelType.toLowerCase() === 'boys') {
        query.gender = 'Male';
      } else if (warden.hostelType.toLowerCase() === 'girls') {
        query.gender = 'Female';
      }
    }

    console.log('🔍 getStaffCount - Query:', query);

    const totalStaff = await StaffGuest.countDocuments(query);

    console.log('🔍 getStaffCount - Total staff found:', totalStaff);

    res.json({
      success: true,
      data: {
        count: totalStaff
      }
    });
  } catch (error) {
    console.error('🔍 getStaffCount - Error:', error);
    next(error);
  }
};
