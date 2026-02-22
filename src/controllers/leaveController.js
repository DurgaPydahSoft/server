import Leave from '../models/Leave.js';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import Course from '../models/Course.js';
import { createError } from '../utils/error.js';
import { sendSMS } from '../utils/smsService.js';
import Notification from '../models/Notification.js';
import { sendOneSignalNotification, sendOneSignalBulkNotification } from '../utils/oneSignalService.js';
import { sendLeaveForwardedEmail } from '../utils/emailService.js';
import { 
  normalizeCourseName, 
  resolveCourseName, 
  resolveBranchName, 
  getAllowedCourseNames 
} from '../utils/adminUtils.js';

// Generate OTP (4 digits)
const generateOTP = () => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

// Validate time format (HH:MM)
const validateTimeFormat = (time) => {
  const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
  return timeRegex.test(time);
};

// Validate gate pass date and time
const validateGatePassDateTime = (gatePassDateTime, startDate) => {
  const gatePass = new Date(gatePassDateTime);
  const start = new Date(startDate);
  const today = new Date();
  
  // Set dates to start of day for comparison
  const startDateOnly = new Date(start);
  startDateOnly.setHours(0, 0, 0, 0);
  const todayOnly = new Date(today);
  todayOnly.setHours(0, 0, 0, 0);
  
  // Check if start date is today
  const isStartDateToday = startDateOnly.getTime() === todayOnly.getTime();
  
  if (isStartDateToday) {
    // For same day leave, any time is allowed (but not past time)
    const now = new Date();
    return gatePass >= now;
  } else {
    // For future dates, gate pass must be after 4:30 PM
    const fourThirtyPM = new Date(gatePass);
    fourThirtyPM.setHours(16, 30, 0, 0); // 4:30 PM
    
    return gatePass >= fourThirtyPM;
  }
};

// Helper function to get IST date range for daily limit
const getISTDateRange = () => {
  const now = new Date();
  
  // Create a Date object for the current time in IST
  // IST is UTC + 5:30
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  
  // Set to 12:00 AM IST
  const todayIST = new Date(istNow);
  todayIST.setUTCHours(0, 0, 0, 0);
  
  // Convert back to UTC to get the comparison time
  const today = new Date(todayIST.getTime() - istOffset);
  
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  
  return { today, tomorrow };
};

// Helper function to check if a date is before today (IST)
const isDateBeforeToday = (dateToCheck) => {
  const { today } = getISTDateRange();
  const checkDate = new Date(dateToCheck);
  
  // Set the check date to start of day IST for comparison
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istCheck = new Date(checkDate.getTime() + istOffset);
  istCheck.setUTCHours(0, 0, 0, 0);
  const normalizedCheckDate = new Date(istCheck.getTime() - istOffset);
  
  return normalizedCheckDate < today;
};

// Helper function to check if a leave request has expired
const isLeaveExpired = (leave) => {
  if (leave.applicationType === 'Leave') {
    // For Leave requests, expire only after the end date has passed
    return isDateBeforeToday(leave.endDate);
  } else if (leave.applicationType === 'Permission') {
    // For Permission requests, expire at end of day
    return isDateBeforeToday(leave.permissionDate);
  } else if (leave.applicationType === 'Stay in Hostel') {
    // For Stay in Hostel requests, expire at end of day
    return isDateBeforeToday(leave.stayDate);
  } else {
    return false; // Unknown application type
  }
};

// Function to automatically delete expired leave requests
const autoDeleteExpiredLeaves = async () => {
  try {
    // Get IST date range for proper date comparison
    const { today, tomorrow } = getISTDateRange();
    
    // Find expired requests that should be deleted
    // All requests now expire at end of day (IST):
    // - Leave requests: Delete if start date is before today
    // - Permission requests: Delete if permission date is before today
    // - Stay in Hostel requests: Delete if stay date is before today
    
    // Get all pending requests first
    const allPendingLeaves = await Leave.find({
      status: { $in: ['Pending', 'Pending OTP Verification', 'Warden Verified'] }
    }).populate('student');
    
    // Filter expired leaves using JavaScript logic for better date handling
    const expiredLeaves = allPendingLeaves.filter(leave => {
      if (leave.applicationType === 'Leave') {
        // For Leave requests, check if end date is before today
        return isDateBeforeToday(leave.endDate);
      } else if (leave.applicationType === 'Permission') {
        // For Permission requests, check if permission date is before today
        return isDateBeforeToday(leave.permissionDate);
      } else if (leave.applicationType === 'Stay in Hostel') {
        // For Stay in Hostel requests, check if stay date is before today
        return isDateBeforeToday(leave.stayDate);
      }
      return false;
    });
    
    // Only log if there are expired leaves to delete
    if (expiredLeaves.length > 0) {
      console.log(`🗑️ Auto-deleting ${expiredLeaves.length} expired leave requests`);
      
      for (const leave of expiredLeaves) {
        try {
          // Notify student about deletion
          if (leave.student) {
            const notificationTitle = 'Leave Request Auto-Deleted';
            let notificationMessage;
            
            if (leave.status === 'Warden Verified') {
              if (leave.applicationType === 'Leave') {
                notificationMessage = `Your ${leave.applicationType} request for ${new Date(leave.startDate).toLocaleDateString()} to ${new Date(leave.endDate).toLocaleDateString()} has been automatically deleted because the entire leave period has passed without principal approval.`;
              } else {
                notificationMessage = `Your ${leave.applicationType} request for ${new Date(leave.permissionDate || leave.stayDate).toLocaleDateString()} has been automatically deleted because the date has passed without principal approval.`;
              }
            } else {
              if (leave.applicationType === 'Leave') {
                notificationMessage = `Your ${leave.applicationType} request for ${new Date(leave.startDate).toLocaleDateString()} to ${new Date(leave.endDate).toLocaleDateString()} has been automatically deleted because the entire leave period has passed without OTP verification.`;
              } else {
                notificationMessage = `Your ${leave.applicationType} request for ${new Date(leave.permissionDate || leave.stayDate).toLocaleDateString()} has been automatically deleted because the date has passed without OTP verification.`;
              }
            }
            
            // Create notification for student
            await Notification.create({
              recipient: leave.student._id,
              recipientModel: 'User', // Add the required recipientModel field
              title: notificationTitle,
              message: notificationMessage,
              type: 'leave', // Use 'leave' instead of 'leave_deleted' as it's a valid enum value
              relatedId: leave._id
            });
            
            // Send OneSignal notification to student
            if (leave.student.oneSignalId) {
              await sendOneSignalNotification({
                playerIds: [leave.student.oneSignalId],
                title: notificationTitle,
                message: notificationMessage,
                data: { type: 'leave_deleted', leaveId: leave._id.toString() }
              });
            }
          }
          
          // Delete the leave request
          await Leave.findByIdAndDelete(leave._id);
          console.log(`🗑️ Deleted expired leave request: ${leave._id} for student: ${leave.student?.name || 'Unknown'}`);
          
        } catch (error) {
          console.error(`Error deleting expired leave ${leave._id}:`, error);
        }
      }
    }
    
    return expiredLeaves.length;
  } catch (error) {
    console.error('Error in autoDeleteExpiredLeaves:', error);
    return 0;
  }
};

// Cron job function for periodic cleanup (can be called by external scheduler)
export const cleanupExpiredLeaves = async (req, res, next) => {
  try {
    const deletedCount = await autoDeleteExpiredLeaves();
    
    res.json({
      success: true,
      message: `Cleanup completed. Deleted ${deletedCount} expired leave requests.`,
      deletedCount
    });
  } catch (error) {
    next(error);
  }
};

// Create new leave or permission request
export const createLeaveRequest = async (req, res, next) => {
  try {
    const { 
      applicationType, 
      startDate, 
      endDate, 
      permissionDate,
      stayDate,
      outTime,
      inTime,
      gatePassDateTime,
      reason 
    } = req.body;
    const studentId = req.user.id;

    // Get student details
    const student = await User.findById(studentId);
    if (!student) {
      throw createError(404, 'Student not found');
    }
    
    console.log('Student details:', {
      name: student.name,
      gender: student.gender,
      parentPhone: student.parentPhone
    });

    // Validate application type
    if (!['Leave', 'Permission', 'Stay in Hostel'].includes(applicationType)) {
      throw createError(400, 'Invalid application type. Must be "Leave", "Permission", or "Stay in Hostel"');
    }

    // Check daily limit for this application type
    const { today, tomorrow } = getISTDateRange();
    
    console.log(`🔍 Daily limit check for student ${studentId}, application type: ${applicationType}`);
    console.log(`🔍 IST Date range: ${today.toISOString()} to ${tomorrow.toISOString()}`);
    
    // Check if student already has a request of this type for today
    const existingRequest = await Leave.findOne({
      student: studentId,
      applicationType: applicationType,
      createdAt: {
        $gte: today,
        $lt: tomorrow
      }
    });
    
    if (existingRequest) {
      console.log(`❌ Daily limit exceeded for student ${studentId}, application type: ${applicationType}`);
      throw createError(400, `You have only one ${applicationType} request per day`);
    }
    
    console.log(`✅ Daily limit check passed for student ${studentId}, application type: ${applicationType}`);

    let leaveData = {
      student: studentId,
      applicationType,
      reason
    };

    if (applicationType === 'Leave') {
      // Validate leave-specific fields
      if (!startDate || !endDate || !gatePassDateTime) {
        throw createError(400, 'Start date, end date, and gate pass date/time are required for leave applications');
      }

      const start = new Date(startDate);
      const end = new Date(endDate);
      const gatePass = new Date(gatePassDateTime);
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Set to start of today
      const startDateOnly = new Date(start);
      startDateOnly.setHours(0, 0, 0, 0); // Set to start of start date
      
      if (startDateOnly < today) {
        throw createError(400, 'Start date cannot be in the past');
      }
      
      if (end <= start) {
        throw createError(400, 'End date must be after start date');
      }

      // Validate gate pass date and time
      if (!validateGatePassDateTime(gatePassDateTime, startDate)) {
        const start = new Date(startDate);
        const today = new Date();
        const startDateOnly = new Date(start);
        startDateOnly.setHours(0, 0, 0, 0);
        const todayOnly = new Date(today);
        todayOnly.setHours(0, 0, 0, 0);
        
        if (startDateOnly.getTime() === todayOnly.getTime()) {
          throw createError(400, 'Gate pass time cannot be in the past for same day leave');
        } else {
          throw createError(400, 'Gate pass must be after 4:30 PM for future dates');
        }
      }

      leaveData = {
        ...leaveData,
        startDate,
        endDate,
        gatePassDateTime,
        parentPhone: student.parentPhone
      };

      // Generate OTP for Leave applications
      const otp = generateOTP();
      leaveData.otpCode = otp;
      leaveData.status = 'Pending OTP Verification';

    } else if (applicationType === 'Permission') {
      // Validate permission-specific fields
      if (!permissionDate || !outTime || !inTime) {
        throw createError(400, 'Permission date, out time, and in time are required for permission applications');
      }

      const permission = new Date(permissionDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Set to start of today
      const permissionDateOnly = new Date(permission);
      permissionDateOnly.setHours(0, 0, 0, 0); // Set to start of permission date
      
      if (permissionDateOnly < today) {
        throw createError(400, 'Permission date cannot be in the past');
      }

      // Validate time format
      if (!validateTimeFormat(outTime) || !validateTimeFormat(inTime)) {
        throw createError(400, 'Time must be in HH:MM format (24-hour)');
      }

      // Validate that out time is before in time
      if (outTime >= inTime) {
        throw createError(400, 'Out time must be before in time');
      }

      leaveData = {
        ...leaveData,
        permissionDate,
        outTime,
        inTime,
        parentPhone: student.parentPhone
      };

      // Check if parent permission is enabled for this student
      if (student.parentPermissionForOuting) {
        // Generate OTP for Permission applications with parent permission enabled
        const otp = generateOTP();
        leaveData.otpCode = otp;
        leaveData.status = 'Pending OTP Verification';
      } else {
        // Skip OTP and send directly to principal for approval
        leaveData.status = 'Pending Principal Approval';
        console.log(`🚀 Permission request for student ${student.name} (${student.rollNumber}) - Parent permission disabled, sending directly to principal`);
      }

    } else if (applicationType === 'Stay in Hostel') {
      // Validate stay in hostel-specific fields
      if (!stayDate) {
        throw createError(400, 'Stay date is required for stay in hostel applications');
      }

      const stay = new Date(stayDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);

      if (stay < today || stay > tomorrow) {
        throw createError(400, 'Stay date must be today or tomorrow only');
      }

      leaveData = {
        ...leaveData,
        stayDate,
        status: 'Pending' // No OTP needed for Stay in Hostel
      };
    }

    // Create leave/permission/stay request
    const leave = new Leave(leaveData);
    await leave.save();

    // Send SMS only for Leave and Permission applications with parent permission enabled
    if (applicationType !== 'Stay in Hostel' && student.parentPermissionForOuting) {
      try {
        // Get gender in Telugu
        const genderInTelugu = student.gender === 'Male' ? 'కొడుకు' : 'కూతురు';
        
        console.log('Sending SMS with params:', {
          phone: student.parentPhone,
          otp: leaveData.otpCode,
          gender: genderInTelugu,
          name: student.name
        });
        
        const smsResult = await sendSMS(student.parentPhone, '', { 
          otp: leaveData.otpCode,
          gender: genderInTelugu,
          name: student.name
        });
        
        if (smsResult.success) {
          console.log('SMS Results:', smsResult.results);
          if (smsResult.teluguSuccess) {
            console.log('✅ Telugu SMS sent successfully');
          }
          if (smsResult.englishSuccess) {
            console.log('✅ English SMS sent successfully');
          }
          
          // Log which approaches worked
          smsResult.results.forEach(result => {
            console.log(`✅ ${result.language} SMS sent using: ${result.approach} (MessageId: ${result.messageId})`);
          });
        } else {
          console.log('SMS sending failed');
        }
      } catch (smsError) {
        console.error('SMS sending failed:', smsError);
        // Continue with the request even if SMS fails
      }
    }

    // Notify all wardens and principal
    const wardens = await User.find({ role: 'warden' });
    const principals = await User.find({ role: 'principal' });
    const recipients = [...wardens, ...principals];
    const notificationTitle = 'New Stay in Hostel Request';
    const notificationMessage = `${student.name} submitted a Stay in Hostel request for ${stayDate} (Reason: ${reason})`;
    for (const recipient of recipients) {
      await Notification.createNotification({
        type: 'leave',
        recipient: recipient._id,
        sender: student._id,
        title: notificationTitle,
        message: notificationMessage,
        relatedId: leave._id,
        priority: 'high'
      });
      await sendOneSignalNotification(recipient._id, {
        title: notificationTitle,
        message: notificationMessage,
        type: 'leave',
        relatedId: leave._id,
        priority: 10
      });
    }

    let message = '';
    if (applicationType === 'Stay in Hostel') {
      message = 'Stay in Hostel request submitted successfully. It will be reviewed by the warden and principal.';
    } else {
      message = `${applicationType} request created successfully. Please contact admin for OTP verification.`;
    }

    res.json({
      success: true,
      data: {
        leave,
        message
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get student's leave requests
export const getStudentLeaveRequests = async (req, res, next) => {
  try {
    const studentId = req.user.id;
    
    // Auto-delete expired leaves before fetching
    await autoDeleteExpiredLeaves();
    
    const leaves = await Leave.find({ student: studentId })
      .populate({
        path: 'student',
        select: 'name rollNumber course branch year gender studentPhone parentPhone email hostelId category batch academicYear hostelStatus graduationStatus studentPhoto',
        populate: [
          { path: 'course', select: 'name code' },
          { path: 'branch', select: 'name code' }
        ]
      })
      .populate('approvedBy', 'name')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: leaves
    });
  } catch (error) {
    next(error);
  }
};

// Get all leave requests (admin)
export const getAllLeaveRequests = async (req, res, next) => {
  try {
    console.log('Getting all leave requests with query:', req.query);
    
    // Auto-delete expired leaves before fetching
    await autoDeleteExpiredLeaves();
    
    const { status, applicationType, page = 1, limit = 10 } = req.query;
    const query = {};

    if (status) {
      query.status = status;
    }

    if (applicationType) {
      query.applicationType = applicationType;
    }

    // Exclude bulk outing leave records (identified by reason starting with "Bulk outing:")
    query.reason = { $not: /^Bulk outing:/ };

    // Exclude 'Pending Principal Approval' status (these go directly to principal)
    if (!status) {
      query.status = { $ne: 'Pending Principal Approval' };
    }

    // Filter by admin's course permissions if they have leave_management permission
    if (req.admin.role === 'sub_admin' && req.admin.permissions && req.admin.permissions.includes('leave_management')) {
      const { assignedCourses, assignedCollegeId, assignedLevels } = req.admin;
      const orConditions = [];

      // 1. Legacy/Direct Course Assignment
      if (assignedCourses && assignedCourses.length > 0) {
        orConditions.push({
          course: { $in: assignedCourses }
        });
        console.log('Filtering by assigned courses:', assignedCourses);
      }

      // 2. College & Level Based Assignment
      const colleges = assignedCollegeIds && assignedCollegeIds.length > 0 ? assignedCollegeIds : (assignedCollegeId ? [assignedCollegeId] : []);
      
      if (colleges.length > 0 && assignedLevels && assignedLevels.length > 0) {
        // Find all courses that match this College AND one of the Levels
        // utilizing the cached SQL courses in courseBranchMapper
        try {
          const { getCoursesFromSQL } = await import('../utils/courseBranchMapper.js');
          const allSQLCourses = await getCoursesFromSQL();
          
          const validCourses = allSQLCourses.filter(c => 
            c.college && colleges.includes(Number(c.college.id)) && 
            c.level && assignedLevels.map(l => l.toLowerCase().trim()).includes(c.level.toLowerCase().trim())
          );
          
          const validCourseNames = validCourses.map(c => normalizeCourseName(c.name.trim()));
          
          if (validCourseNames.length > 0) {
            orConditions.push({
              course: { $in: validCourseNames }
            });
            console.log(`Filtering by College IDs [${colleges}] and Levels [${assignedLevels}]. Matched Courses:`, validCourseNames);
          } else {
             console.log(`No courses found for College IDs [${colleges}] and Levels [${assignedLevels}]`);
          }
        } catch (err) {
          console.error("Error resolving courses for college/level:", err);
        }
      }

      if (orConditions.length > 0) {
         query.$or = orConditions;
      } else {
         // Admin has leave_management but NO assignments (neither legacy nor new)
         console.log('Admin has leave_management permission but no courses/levels assigned');
         return res.json({
          success: true,
          data: {
            leaves: [],
            totalPages: 0,
            currentPage: page,
            totalRequests: 0
          }
        });
      }
    }

    console.log('MongoDB query:', query);

    const leaves = await Leave.find(query)
      .populate({
        path: 'student',
        select: 'name rollNumber course branch year gender studentPhone parentPhone email hostelId category batch academicYear hostelStatus graduationStatus studentPhoto',
        populate: [
          { path: 'course', select: 'name code' },
          { path: 'branch', select: 'name code' }
        ]
      })
      .populate('approvedBy', 'name')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    console.log('Found leaves:', leaves);

    const count = await Leave.countDocuments(query);
    console.log('Total count:', count);

    res.json({
      success: true,
      data: {
        leaves,
        totalPages: Math.ceil(count / limit),
        currentPage: page,
        totalRequests: count
      }
    });
  } catch (error) {
    console.error('Error in getAllLeaveRequests:', error);
    next(error);
  }
};

// Verify OTP and approve leave
export const verifyOTPAndApprove = async (req, res, next) => {
  try {
    const { leaveId, otp } = req.body;
    const adminId = req.admin._id;

    const leave = await Leave.findById(leaveId)
      .populate({
        path: 'student',
        select: 'name parentPhone gender course',
        populate: [
          { path: 'course', select: 'name code' },
          { path: 'branch', select: 'name code' }
        ]
      });
      
    if (!leave) {
      throw createError(404, 'Leave request not found');
    }

    // Check course permissions for sub-admin
    if (req.admin.role === 'sub_admin' && req.admin.permissions && req.admin.permissions.includes('leave_management')) {
      const studentCourse = leave.student.course.name || leave.student.course; // Handle populated or string
      const { assignedCourses, assignedCollegeId, assignedLevels } = req.admin;
      let hasPermission = false;

      // 1. Check Legacy/Direct Assignment
      if (assignedCourses && assignedCourses.includes(studentCourse)) {
        hasPermission = true;
      }

      // 2. Check College & Level Assignment
      if (!hasPermission && assignedCollegeId && assignedLevels) {
        try {
           const { getCoursesFromSQL } = await import('../utils/courseBranchMapper.js');
           const allSQLCourses = await getCoursesFromSQL();
           
           // Find the details of the student's course
           const studentCourseDetails = allSQLCourses.find(c => c.name === studentCourse);
           
           if (studentCourseDetails) {
             const isCollegeMatch = studentCourseDetails.college && studentCourseDetails.college.id === assignedCollegeId;
             const isLevelMatch = studentCourseDetails.level && assignedLevels.map(l => l.toLowerCase()).includes(studentCourseDetails.level.toLowerCase());
             
             if (isCollegeMatch && isLevelMatch) {
               hasPermission = true;
             }
           }
        } catch (err) {
          console.error("Error validating permission for college/level:", err);
        }
      }

      if (!hasPermission) {
        throw createError(403, 'You do not have permission to approve leave requests for this student\'s course');
      }
    }

    if (leave.status !== 'Pending OTP Verification') {
      throw createError(400, 'Invalid leave status for OTP verification');
    }

    if (leave.otpCode !== otp) {
      throw createError(400, 'Invalid OTP');
    }

    // For Leave and Permission requests, follow the warden-principal workflow
    if (leave.applicationType === 'Leave' || leave.applicationType === 'Permission') {
      // Set status to Warden Verified and forward to principal
      leave.status = 'Warden Verified';
      leave.verifiedBy = adminId;
      leave.verifiedAt = new Date();
      await leave.save();

      // Notify principals assigned to the student's course
      const studentCourseId = leave.student.course._id || leave.student.course;
      const principals = await Admin.find({ 
        role: 'principal',
        course: studentCourseId,
        isActive: true
      });
      
      const admin = await Admin.findById(adminId);
      const notificationTitle = 'Leave Request Ready for Approval';
      const notificationMessage = `${leave.student?.name || 'A student'}'s ${leave.applicationType} request has been verified by admin and is ready for your approval`;
      
      console.log(`🔔 Notifying ${principals.length} principals for course: ${studentCourseId}`);
      
      for (const principal of principals) {
        // Send in-app notification
        await Notification.createNotification({
          type: 'leave',
          recipient: principal._id,
          recipientModel: 'Admin',
          sender: admin._id,
          title: notificationTitle,
          message: notificationMessage,
          relatedId: leave._id,
          onModel: 'Leave',
          priority: 'high'
        });
        
        // Send push notification
        await sendOneSignalNotification(principal._id, {
          title: notificationTitle,
          message: notificationMessage,
          type: 'leave',
          relatedId: leave._id,
          priority: 10
        });
        
        // Send email notification if principal has email configured
        if (principal.email && principal.email.trim()) {
          try {
            console.log(`📧 Sending leave forwarded email to principal: ${principal.email}`);
            const emailResult = await sendLeaveForwardedEmail(
              principal.email,
              principal.username || 'Principal',
              leave.student?.name || 'Unknown Student',
              leave.student?.rollNumber || 'N/A',
              leave.applicationType || 'Leave',
              {
                startDate: leave.startDate,
                endDate: leave.endDate,
                gatePassDateTime: leave.gatePassDateTime,
                permissionDate: leave.permissionDate,
                outTime: leave.outTime,
                inTime: leave.inTime,
                reason: leave.reason || 'Not specified'
              }
            );
            if (emailResult && emailResult.success) {
              console.log(`✅ Email sent successfully to principal: ${principal.email}`);
            } else if (emailResult && emailResult.skipped) {
              console.log(`⏭️ Email skipped for principal: ${emailResult.message}`);
            }
          } catch (emailError) {
            console.error(`❌ Failed to send email to principal ${principal.email}:`, emailError.message || emailError);
            // Continue with other principals even if email fails for one
          }
        } else {
          console.log(`⚠️ Principal ${principal.username || principal._id} has no email configured, skipping email notification`);
        }
      }

      res.json({
        success: true,
        data: {
          leave,
          message: 'OTP verified successfully. Request forwarded to principal for approval.'
        }
      });
    } else {
      // For Stay in Hostel requests, admin can approve directly
      leave.status = 'Approved';
      leave.approvedBy = adminId;
      leave.approvedAt = new Date();
      await leave.save();

      res.json({
        success: true,
        data: {
          leave,
          message: 'Leave request approved successfully'
        }
      });
    }
  } catch (error) {
    next(error);
  }
};

// Resend OTP for leave request
export const resendOTP = async (req, res, next) => {
  try {
    const { leaveId } = req.body;
    const studentId = req.user.id;

    const leave = await Leave.findById(leaveId)
      .populate({
        path: 'student',
        select: 'name parentPhone gender course',
        populate: [
          { path: 'course', select: 'name code' },
          { path: 'branch', select: 'name code' }
        ]
      });
      
    if (!leave) {
      throw createError(404, 'Leave request not found');
    }

    // Verify the student owns this request
    if (leave.student._id.toString() !== studentId) {
      throw createError(403, 'You can only resend OTP for your own requests');
    }

    if (leave.status !== 'Pending OTP Verification') {
      throw createError(400, 'Invalid leave status for OTP resend');
    }

    // Check if enough time has passed since last OTP generation (5 minutes)
    const timeSinceCreation = new Date() - new Date(leave.createdAt);
    const fiveMinutesInMs = 5 * 60 * 1000;
    
    if (timeSinceCreation < fiveMinutesInMs) {
      const remainingTime = Math.ceil((fiveMinutesInMs - timeSinceCreation) / (60 * 1000));
      throw createError(400, `Please wait ${remainingTime} more minutes before resending OTP`);
    }

    // Use the same OTP (don't generate new one)
    const sameOtp = leave.otpCode;

    // Update leave request with resend tracking (no new OTP or expiry)
    leave.otpResendCount = (leave.otpResendCount || 0) + 1;
    leave.lastOtpResendAt = new Date();
    await leave.save();

    // Send same OTP via SMS
    try {
      // Get gender in Telugu
      const genderInTelugu = leave.student.gender === 'Male' ? 'కొడుకు' : 'కూతురు';
      
      console.log('Resending SMS with params:', {
        phone: leave.student.parentPhone,
        otp: sameOtp,
        gender: genderInTelugu,
        name: leave.student.name
      });
      
      const smsResult = await sendSMS(leave.student.parentPhone, '', { 
        otp: sameOtp,
        gender: genderInTelugu,
        name: leave.student.name
      });
      
      if (smsResult.success) {
        console.log('Resend SMS Results:', smsResult.results);
        if (smsResult.teluguSuccess) {
          console.log('✅ Telugu SMS resent successfully');
        }
        if (smsResult.englishSuccess) {
          console.log('✅ English SMS resent successfully');
        }
        
        // Log which approaches worked
        smsResult.results.forEach(result => {
          console.log(`✅ ${result.language} SMS resent using: ${result.approach} (MessageId: ${result.messageId})`);
        });
      } else {
        console.log('Resend SMS sending failed');
      }
    } catch (smsError) {
      console.error('Resend SMS sending failed:', smsError);
      // Don't throw error here, just log it and continue
      // The OTP resend count has already been updated
      console.log('⚠️ SMS failed but continuing with resend operation');
    }

    res.json({
      success: true,
      data: {
        message: 'OTP resend request processed. Same OTP (4 digits) has been sent to your parent\'s phone in both Telugu and English.',
        resendCount: leave.otpResendCount
      }
    });
  } catch (error) {
    next(error);
  }
};

// Reject leave request
export const rejectLeaveRequest = async (req, res, next) => {
  try {
    const { leaveId, rejectionReason } = req.body;
    const adminId = req.admin._id;

    const leave = await Leave.findById(leaveId)
      .populate({
        path: 'student',
        select: 'name parentPhone gender course',
        populate: [
          { path: 'course', select: 'name code' },
          { path: 'branch', select: 'name code' }
        ]
      });
      
    if (!leave) {
      throw createError(404, 'Leave request not found');
    }

    // Check course permissions for sub-admin
    if (req.admin.role === 'sub_admin' && req.admin.permissions && req.admin.permissions.includes('leave_management')) {
      if (!req.admin.leaveManagementCourses || !req.admin.leaveManagementCourses.includes(leave.student.course.toString())) {
        throw createError(403, 'You do not have permission to reject leave requests for this student\'s course');
      }
    }

    if (leave.status === 'Approved' || leave.status === 'Rejected') {
      throw createError(400, 'Leave request is already processed');
    }

    // For Leave and Permission requests, admin can reject directly (no need for principal)
    if (leave.applicationType === 'Leave' || leave.applicationType === 'Permission') {
      leave.status = 'Rejected';
      leave.rejectionReason = `Admin: ${rejectionReason}`;
      leave.approvedBy = adminId;
      leave.approvedAt = new Date();
      await leave.save();

      // Notify student
      await Notification.createNotification({
        type: 'leave',
        recipient: leave.student._id,
        recipientModel: 'User',
        sender: adminId,
        title: 'Leave Request Rejected',
        message: `Your ${leave.applicationType} request has been rejected by the admin`,
        relatedId: leave._id,
        onModel: 'Leave',
        priority: 'high'
      });

      await sendOneSignalNotification(leave.student._id, {
        title: 'Leave Request Rejected',
        message: `Your ${leave.applicationType} request has been rejected by the admin`,
        type: 'leave',
        relatedId: leave._id,
        priority: 10
      });

      res.json({
        success: true,
        data: {
          leave,
          message: 'Leave request rejected'
        }
      });
    } else {
      // For Stay in Hostel requests, admin can reject directly
      leave.status = 'Rejected';
      leave.rejectionReason = `Admin: ${rejectionReason}`;
      leave.approvedBy = adminId;
      leave.approvedAt = new Date();
      await leave.save();

      res.json({
        success: true,
        data: {
          leave,
          message: 'Leave request rejected'
        }
      });
    }
  } catch (error) {
    next(error);
  }
};

// Student requests to view QR code (no longer increments count)
export const requestQrView = async (req, res, next) => {
  try {
    const { id } = req.params;
    const studentId = req.user._id;
    const leave = await Leave.findById(id);
    
    if (!leave) {
      return res.status(404).json({ success: false, message: 'Leave not found' });
    }
    
    if (String(leave.student) !== String(studentId)) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    
    // Check if leave is approved
    if (leave.status !== 'Approved') {
      return res.status(403).json({ 
        success: false, 
        message: 'QR code is only available for approved leaves'
      });
    }
    
    // Check if visits are locked (max visits reached)
    if (leave.visitLocked) {
      return res.status(403).json({ 
        success: false, 
        message: 'Maximum visits reached for this leave',
        visitLocked: true 
      });
    }
    
    const now = new Date();
    
    // Check if QR is available based on timing
    if (now < leave.qrAvailableFrom) {
      const timeUntilAvailable = Math.ceil((leave.qrAvailableFrom - now) / (1000 * 60));
      return res.status(403).json({ 
        success: false, 
        message: `QR code will be available in ${timeUntilAvailable} minutes`,
        visitCount: leave.visitCount,
        maxVisits: leave.maxVisits,
        remainingVisits: leave.maxVisits - leave.visitCount
      });
    }
    
    if (now > leave.endDate) {
      return res.status(403).json({ 
        success: false, 
        message: 'Leave period has expired',
        visitCount: leave.visitCount,
        maxVisits: leave.maxVisits,
        remainingVisits: leave.maxVisits - leave.visitCount
      });
    }
    
    // Return success - QR can be viewed (no count increment)
    res.json({ 
      success: true, 
      visitCount: leave.visitCount,
      maxVisits: leave.maxVisits,
      remainingVisits: leave.maxVisits - leave.visitCount
    });
  } catch (error) {
    next(error);
  }
};

// Request incoming QR view (for students to view incoming QR)
export const requestIncomingQrView = async (req, res, next) => {
  try {
    const { id } = req.params;
    const studentId = req.user._id;
    const leave = await Leave.findById(id);
    
    if (!leave) {
      return res.status(404).json({ success: false, message: 'Leave not found' });
    }
    
    if (String(leave.student) !== String(studentId)) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    
    // Check if leave is approved
    if (leave.status !== 'Approved') {
      return res.status(403).json({ 
        success: false, 
        message: 'Incoming QR code is only available for approved leaves'
      });
    }
    
    // Check if incoming QR is generated
    if (!leave.incomingQrGenerated) {
      return res.status(403).json({ 
        success: false, 
        message: 'Incoming QR not yet generated. Please scan outgoing QR first.',
        outgoingVisitCount: leave.outgoingVisitCount,
        incomingVisitCount: leave.incomingVisitCount
      });
    }
    
    // Check if incoming QR has expired
    const now = new Date();
    if (now > leave.incomingQrExpiresAt) {
      return res.status(403).json({ 
        success: false, 
        message: 'Incoming QR has expired',
        outgoingVisitCount: leave.outgoingVisitCount,
        incomingVisitCount: leave.incomingVisitCount,
        expiredAt: leave.incomingQrExpiresAt
      });
    }
    
    // Return success - Incoming QR can be viewed
    res.json({ 
      success: true, 
      outgoingVisitCount: leave.outgoingVisitCount,
      incomingVisitCount: leave.incomingVisitCount,
      incomingQrGenerated: leave.incomingQrGenerated,
      incomingQrExpiresAt: leave.incomingQrExpiresAt
    });
  } catch (error) {
    next(error);
  }
};

// Record a visit when QR is scanned by security
export const recordVisit = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { scannedBy, location = 'Main Gate' } = req.body;
    
    const leave = await Leave.findById(id);
    if (!leave) {
      return res.status(404).json({ success: false, message: 'Leave not found' });
    }
    
    // Check if leave is approved
    if (leave.status !== 'Approved') {
      return res.status(403).json({ 
        success: false, 
        message: 'Only approved leaves can be scanned',
        visitCount: leave.visitCount,
        maxVisits: leave.maxVisits,
        remainingVisits: leave.maxVisits - leave.visitCount
      });
    }
    
    // Check if visits are locked
    if (leave.visitLocked) {
      return res.status(403).json({ 
        success: false, 
        message: 'Maximum visits reached for this leave',
        visitLocked: true,
        visitCount: leave.visitCount,
        maxVisits: leave.maxVisits,
        remainingVisits: 0,
        scannedAt: leave.visits[leave.visits.length - 1]?.scannedAt
      });
    }
    
    const now = new Date();
    
    // Check if QR is available based on timing
    if (now < leave.qrAvailableFrom) {
      const timeUntilAvailable = Math.ceil((leave.qrAvailableFrom - now) / (1000 * 60));
      return res.status(403).json({ 
        success: false, 
        message: `QR code will be available in ${timeUntilAvailable} minutes`,
        visitCount: leave.visitCount,
        maxVisits: leave.maxVisits,
        remainingVisits: leave.maxVisits - leave.visitCount
      });
    }
    
    if (now > leave.endDate) {
      return res.status(403).json({ 
        success: false, 
        message: 'Leave period has expired',
        visitCount: leave.visitCount,
        maxVisits: leave.maxVisits,
        remainingVisits: leave.maxVisits - leave.visitCount
      });
    }
    
    // Check for duplicate scan within 30 seconds (prevent accidental double scans)
    const thirtySecondsAgo = new Date(now.getTime() - 30 * 1000);
    const recentScan = leave.visits.find(visit => 
      visit.scannedAt > thirtySecondsAgo && 
      visit.scannedBy === scannedBy
    );
    
    if (recentScan) {
      return res.status(409).json({ 
        success: false, 
        message: 'Visit already recorded recently (within 30 seconds)',
        scannedAt: recentScan.scannedAt,
        visitCount: leave.visitCount,
        maxVisits: leave.maxVisits,
        remainingVisits: leave.maxVisits - leave.visitCount
      });
    }
    
    // Record the visit
    leave.visits.push({
      scannedAt: now,
      scannedBy,
      location,
      visitType: 'outgoing' // Default to outgoing for existing functionality
    });
    
    // Ensure visit count doesn't exceed max visits
    leave.visitCount = Math.min(leave.visits.length, leave.maxVisits);
    
    // Update outgoing visit count
    leave.outgoingVisitCount = leave.visits.filter(v => v.visitType === 'outgoing').length;
    
    // Check if max visits reached
    if (leave.visitCount >= leave.maxVisits) {
      leave.visitLocked = true;
    }
    
    // Generate incoming QR if this is the first outgoing visit
    if (leave.outgoingVisitCount === 1 && !leave.incomingQrGenerated) {
      leave.incomingQrGenerated = true;
      leave.incomingQrGeneratedAt = now;
      
      // Set incoming QR expiry to 24 hours from now or end of leave period, whichever is earlier
      const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const leaveEndDate = leave.applicationType === 'Leave' ? new Date(leave.endDate) : new Date(leave.permissionDate);
      leave.incomingQrExpiresAt = new Date(Math.min(twentyFourHoursFromNow.getTime(), leaveEndDate.getTime()));
    }
    
    console.log(`🔍 Recording visit for leave ${id}:`);
    console.log(`  - Previous visit count: ${leave.visits.length - 1}`);
    console.log(`  - New visit count: ${leave.visitCount}`);
    console.log(`  - Outgoing visits: ${leave.outgoingVisitCount}`);
    console.log(`  - Incoming visits: ${leave.incomingVisitCount}`);
    console.log(`  - Max visits: ${leave.maxVisits}`);
    console.log(`  - Visit locked: ${leave.visitLocked}`);
    console.log(`  - Incoming QR generated: ${leave.incomingQrGenerated}`);
    
    await leave.save();
    
    res.json({ 
      success: true, 
      message: 'Visit recorded successfully',
      visitCount: leave.visitCount,
      maxVisits: leave.maxVisits,
      visitLocked: leave.visitLocked,
      remainingVisits: leave.maxVisits - leave.visitCount,
      outgoingVisitCount: leave.outgoingVisitCount,
      incomingVisitCount: leave.incomingVisitCount,
      incomingQrGenerated: leave.incomingQrGenerated,
      incomingQrExpiresAt: leave.incomingQrExpiresAt
    });
  } catch (error) {
    next(error);
  }
};

// Record an incoming visit when incoming QR is scanned by security
export const recordIncomingVisit = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { scannedBy, location = 'Main Gate' } = req.body;
    
    const leave = await Leave.findById(id);
    if (!leave) {
      return res.status(404).json({ success: false, message: 'Leave not found' });
    }
    
    // Check if leave is approved
    if (leave.status !== 'Approved') {
      return res.status(403).json({ 
        success: false, 
        message: 'Only approved leaves can be scanned',
        outgoingVisitCount: leave.outgoingVisitCount,
        incomingVisitCount: leave.incomingVisitCount
      });
    }
    
    // Check if incoming QR is generated
    if (!leave.incomingQrGenerated) {
      return res.status(403).json({ 
        success: false, 
        message: 'Incoming QR not yet generated. Please scan outgoing QR first.',
        outgoingVisitCount: leave.outgoingVisitCount,
        incomingVisitCount: leave.incomingVisitCount
      });
    }
    
    // Check if incoming QR has expired
    const now = new Date();
    if (now > leave.incomingQrExpiresAt) {
      return res.status(403).json({ 
        success: false, 
        message: 'Incoming QR has expired',
        outgoingVisitCount: leave.outgoingVisitCount,
        incomingVisitCount: leave.incomingVisitCount,
        expiredAt: leave.incomingQrExpiresAt
      });
    }
    
    // Check for duplicate incoming scan within 30 seconds
    const thirtySecondsAgo = new Date(now.getTime() - 30 * 1000);
    const recentIncomingScan = leave.visits.find(visit => 
      visit.scannedAt > thirtySecondsAgo && 
      visit.scannedBy === scannedBy &&
      visit.visitType === 'incoming'
    );
    
    if (recentIncomingScan) {
      return res.status(409).json({ 
        success: false, 
        message: 'Incoming visit already recorded recently (within 30 seconds)',
        scannedAt: recentIncomingScan.scannedAt,
        outgoingVisitCount: leave.outgoingVisitCount,
        incomingVisitCount: leave.incomingVisitCount
      });
    }
    
    // Record the incoming visit
    leave.visits.push({
      scannedAt: now,
      scannedBy,
      location,
      visitType: 'incoming'
    });
    
    // Update incoming visit count
    leave.incomingVisitCount = leave.visits.filter(v => v.visitType === 'incoming').length;
    
    // Mark leave as completed when incoming QR is scanned
    // This removes the student from "On Leave" status even if they return before end date
    leave.verificationStatus = 'Completed';
    leave.completedAt = now;
    
    console.log(`🔍 Recording incoming visit for leave ${id}:`);
    console.log(`  - Outgoing visits: ${leave.outgoingVisitCount}`);
    console.log(`  - New incoming visit count: ${leave.incomingVisitCount}`);
    console.log(`  - Incoming QR generated: ${leave.incomingQrGenerated}`);
    console.log(`  - Incoming QR expires at: ${leave.incomingQrExpiresAt}`);
    console.log(`  - Leave status marked as completed`);
    
    await leave.save();
    
    res.json({ 
      success: true, 
      message: 'Incoming visit recorded successfully - Leave completed',
      outgoingVisitCount: leave.outgoingVisitCount,
      incomingVisitCount: leave.incomingVisitCount,
      incomingQrGenerated: leave.incomingQrGenerated,
      incomingQrExpiresAt: leave.incomingQrExpiresAt,
      verificationStatus: 'Completed',
      completedAt: leave.completedAt
    });
  } catch (error) {
    next(error);
  }
};

// Get leave by ID (for QR code details, includes visit info)
export const getLeaveById = async (req, res, next) => {
  try {
    const { id } = req.params;
    // Removed excessive logging to prevent console spam
    
    const leave = await Leave.findById(id).populate({
      path: 'student',
      select: 'name rollNumber course branch year gender studentPhone parentPhone email hostelId category batch academicYear hostelStatus graduationStatus studentPhoto',
      populate: [
        { path: 'course', select: 'name code' },
        { path: 'branch', select: 'name code' }
      ]
    });
    console.log('🔍 Leave found:', leave ? 'Yes' : 'No');
    
    if (!leave) {
      return res.status(404).json({ success: false, message: 'Leave not found' });
    }
    
    // Add visit information to response
    const response = {
      success: true,
      data: {
        ...leave.toObject(),
        visitCount: leave.visits.length,
        outgoingVisitCount: leave.visits.filter(v => v.visitType === 'outgoing').length,
        incomingVisitCount: leave.visits.filter(v => v.visitType === 'incoming').length,
        maxVisits: leave.maxVisits || 2,
        visitLocked: leave.visitLocked,
        isQrAvailable: leave.isQrAvailable,
        displayDate: leave.displayDate,
        displayEndDate: leave.displayEndDate
      }
    };
    
    res.json(response);
  } catch (error) {
    console.error('❌ Error in getLeaveById:', error);
    next(error);
  }
};

// Get all approved leave requests for security guards (including warden verified)
export const getApprovedLeaves = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, selectedDate } = req.query;
    
    // Build query
    const query = { 
      status: { $in: ['Approved', 'Warden Verified', 'Principal Approved'] } 
    };

    // Add date filtering if selectedDate is provided
    if (selectedDate) {
      const date = new Date(selectedDate);
      const istOffset = 5.5 * 60 * 60 * 1000;
      
      // Start of day in IST converted to UTC
      const startOfDayIST = new Date(date);
      startOfDayIST.setUTCHours(0, 0, 0, 0);
      const startOfDay = new Date(startOfDayIST.getTime() - istOffset);
      
      // End of day in IST converted to UTC
      const endOfDayIST = new Date(date);
      endOfDayIST.setUTCHours(23, 59, 59, 999);
      const endOfDay = new Date(endOfDayIST.getTime() - istOffset);

      query.$or = [
        {
          applicationType: 'Leave',
          startDate: { $lte: endOfDay },
          endDate: { $gte: startOfDay }
        },
        {
          applicationType: 'Permission',
          permissionDate: { $gte: startOfDay, $lte: endOfDay }
        },
        {
          applicationType: 'Stay in Hostel',
          stayDate: { $gte: startOfDay, $lte: endOfDay }
        }
      ];
    }

    // Include both 'Approved' and 'Warden Verified' statuses
    // Note: course and branch are now stored as strings, not ObjectId references
    const leaves = await Leave.find(query)
      .populate({
        path: 'student',
        select: 'name rollNumber course branch year gender studentPhone parentPhone email hostelId category batch academicYear hostelStatus graduationStatus studentPhoto'
        // Removed populate for course and branch - they are now strings
      })
      .populate('approvedBy', 'name')
      .populate('verifiedBy', 'name') // Populate warden who verified
      .sort({ verifiedAt: -1, approvedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await Leave.countDocuments(query);

    res.json({
      success: true,
      data: {
        leaves,
        totalPages: Math.ceil(count / limit),
        currentPage: page,
        totalRequests: count
      }
    });
  } catch (error) {
    console.error('Error in getApprovedLeaves:', error);
    next(error);
  }
};

// Update verification status by security guard
export const updateVerificationStatus = async (req, res, next) => {
  try {
    const { leaveId, verificationStatus } = req.body;

    const leave = await Leave.findById(leaveId)
      .populate({
        path: 'student',
        select: 'name rollNumber gender course branch',
        populate: [
          { path: 'course', select: 'name code' },
          { path: 'branch', select: 'name code' }
        ]
      });
      
    if (!leave) {
      throw createError(404, 'Leave request not found');
    }

    if (leave.status !== 'Approved') {
      throw createError(400, 'Only approved leaves can be verified');
    }

    leave.verificationStatus = verificationStatus;
    leave.verifiedAt = new Date();
    
    await leave.save();

    res.json({
      success: true,
      data: {
        leave,
        message: `Leave verification status updated to ${verificationStatus}`
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get Stay in Hostel requests for Warden
export const getStayInHostelRequestsForWarden = async (req, res, next) => {
  try {
    // Auto-delete expired leaves before fetching
    await autoDeleteExpiredLeaves();
    
    const { status, wardenRecommendation, page = 1, limit = 10, fromDate, toDate } = req.query;
    const query = { applicationType: 'Stay in Hostel' };

    if (status) {
      query.status = status;
    }

    if (wardenRecommendation) {
      query.wardenRecommendation = wardenRecommendation;
    }

    if (fromDate || toDate) {
      query.stayDate = {};
      if (fromDate) query.stayDate.$gte = new Date(fromDate);
      if (toDate) query.stayDate.$lte = new Date(toDate);
    }

    const leaves = await Leave.find(query)
      .populate({
        path: 'student',
        select: 'name rollNumber course branch year gender studentPhone parentPhone email hostelId category batch academicYear hostelStatus graduationStatus studentPhoto',
        populate: [
          { path: 'course', select: 'name code' },
          { path: 'branch', select: 'name code' }
        ]
      })
      .populate('recommendedBy', 'name')
      .populate('decidedBy', 'name')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await Leave.countDocuments(query);

    res.json({
      success: true,
      data: {
        leaves,
        totalPages: Math.ceil(count / limit),
        currentPage: page,
        totalRequests: count
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get Stay in Hostel requests for Principal
export const getStayInHostelRequestsForPrincipal = async (req, res, next) => {
  try {
    // Auto-delete expired leaves before fetching
    await autoDeleteExpiredLeaves();
    
    const { status, principalDecision, wardenRecommendation, page = 1, limit = 10, fromDate, toDate } = req.query;
    
    // Get principal details
    const principal = await Admin.findById(req.principal._id).select('course branch assignedCollegeIds assignedCollegeId assignedLevels');
    
    if (!principal) {
      throw createError(404, 'Principal not found');
    }

    console.log('🎓 Principal Stay in Hostel requests:', {
      principalId: principal._id,
      assignedColleges: principal.assignedCollegeIds,
      assignedLevels: principal.assignedLevels,
      legacyCourse: principal.course
    });

    // 1. Get all allowed courses for this principal
    const allowedCourseNames = await getAllowedCourseNames(principal);

    if (allowedCourseNames.length === 0) {
      return res.json({
        success: true,
        data: {
          leaves: [],
          totalPages: 0,
          currentPage: page,
          totalRequests: 0
        }
      });
    }

    // 2. Get students who belong to these courses
    const studentQuery = { 
      course: { $in: allowedCourseNames },
      role: 'student'
    };

    // Add branch filter if principal has a specific branch assigned
    if (principal.branch) {
      studentQuery.branch = principal.branch;
    }
    const studentsInCourse = await User.find(studentQuery).select('_id');

    const studentIds = studentsInCourse.map(s => s._id);
    console.log(`🎓 Found ${studentIds.length} students in principal's assigned courses`);

    // Build query to filter by students
    const query = { 
      applicationType: 'Stay in Hostel',
      student: { $in: studentIds }
    };

    if (status) {
      query.status = status;
    }

    if (principalDecision) {
      query.principalDecision = principalDecision;
    }

    if (wardenRecommendation) {
      query.wardenRecommendation = wardenRecommendation;
    }

    if (fromDate || toDate) {
      query.stayDate = {};
      if (fromDate) query.stayDate.$gte = new Date(fromDate);
      if (toDate) query.stayDate.$lte = new Date(toDate);
    }

    const leaves = await Leave.find(query)
      .populate({
        path: 'student',
        select: 'name rollNumber course branch year gender studentPhone parentPhone email hostelId category batch academicYear hostelStatus graduationStatus studentPhoto',
        populate: [
          { path: 'course', select: 'name code' },
          { path: 'branch', select: 'name code' }
        ]
      })
      .populate('recommendedBy', 'name')
      .populate('decidedBy', 'name')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await Leave.countDocuments(query);

    console.log(`🎓 Found ${leaves.length} stay in hostel requests for principal's course`);

    res.json({
      success: true,
      data: {
        leaves,
        totalPages: Math.ceil(count / limit),
        currentPage: page,
        totalRequests: count
      }
    });
  } catch (error) {
    console.error('🎓 Error in getStayInHostelRequestsForPrincipal:', error);
    next(error);
  }
};

// Warden recommendation for Stay in Hostel request
export const wardenRecommendation = async (req, res, next) => {
  try {
    const { leaveId, recommendation, comment } = req.body;
    const wardenId = req.warden._id;

    const leave = await Leave.findById(leaveId)
      .populate('student', 'name rollNumber gender');
      
    if (!leave) {
      throw createError(404, 'Stay in Hostel request not found');
    }

    if (leave.applicationType !== 'Stay in Hostel') {
      throw createError(400, 'This request is not a Stay in Hostel request');
    }

    if (leave.status !== 'Pending') {
      throw createError(400, 'Request is not in pending status');
    }

    if (!['Recommended', 'Not Recommended'].includes(recommendation)) {
      throw createError(400, 'Invalid recommendation. Must be "Recommended" or "Not Recommended"');
    }

    leave.wardenRecommendation = recommendation;
    leave.wardenComment = comment;
    leave.recommendedBy = wardenId;
    leave.recommendedAt = new Date();

    // Update status based on recommendation
    if (recommendation === 'Recommended') {
      leave.status = 'Warden Recommended';
    } else {
      leave.status = 'Rejected';
      leave.rejectionReason = `Warden: ${comment || 'Not recommended'}`;
    }

    await leave.save();

    // Notify all principals
    const principalUsers = await User.find({ role: 'principal' });
    const warden = await User.findById(req.warden._id);
    const wardenNotifTitle = 'Warden Recommendation for Stay in Hostel';
    const wardenNotifMsg = `${leave.student?.name || 'A student'}'s Stay in Hostel request: Warden ${recommendation} (${comment || ''})`;
    for (const principal of principalUsers) {
      await Notification.createNotification({
        type: 'leave',
        recipient: principal._id,
        sender: warden._id,
        title: wardenNotifTitle,
        message: wardenNotifMsg,
        relatedId: leave._id,
        priority: 'high'
      });
      await sendOneSignalNotification(principal._id, {
        title: wardenNotifTitle,
        message: wardenNotifMsg,
        type: 'leave',
        relatedId: leave._id,
        priority: 10
      });
    }

    res.json({
      success: true,
      data: {
        leave,
        message: `Stay in Hostel request ${recommendation.toLowerCase()} by warden`
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get leave requests for warden (all types except Stay in Hostel)
export const getWardenLeaveRequests = async (req, res, next) => {
  try {
    console.log('Getting warden leave requests with query:', req.query);
    
    // Auto-delete expired leaves before fetching
    await autoDeleteExpiredLeaves();
    
    const { status, applicationType, page = 1, limit = 10 } = req.query;
    const query = {};

    if (status) {
      query.status = status;
    }

    if (applicationType) {
      query.applicationType = applicationType;
    }

    // Exclude Stay in Hostel requests (they have their own workflow)
    query.applicationType = { $ne: 'Stay in Hostel' };

    // Exclude bulk outing leave records
    query.reason = { $not: /^Bulk outing:/ };

    // Exclude 'Pending Principal Approval' status (these go directly to principal)
    if (!status) {
      query.status = { $ne: 'Pending Principal Approval' };
    }

    console.log('MongoDB query:', query);

    const leaves = await Leave.find(query)
      .populate({
        path: 'student',
        select: 'name rollNumber course branch year gender studentPhone parentPhone email hostelId category batch academicYear hostelStatus graduationStatus studentPhoto',
        populate: [
          { path: 'course', select: 'name code' },
          { path: 'branch', select: 'name code' }
        ]
      })
      .populate('approvedBy', 'name')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    console.log('Found leaves:', leaves);

    const count = await Leave.countDocuments(query);
    console.log('Total count:', count);

    res.json({
      success: true,
      data: {
        leaves,
        totalPages: Math.ceil(count / limit),
        currentPage: page,
        totalRequests: count
      }
    });
  } catch (error) {
    console.error('Error in getWardenLeaveRequests:', error);
    next(error);
  }
};

// Warden verify OTP and forward to principal
export const wardenVerifyOTP = async (req, res, next) => {
  try {
    const { leaveId, otp } = req.body;
    const wardenId = req.warden._id;

    const leave = await Leave.findById(leaveId)
      .populate({
        path: 'student',
        select: 'name parentPhone gender course',
        populate: [
          { path: 'course', select: 'name code' },
          { path: 'branch', select: 'name code' }
        ]
      });
      
    if (!leave) {
      throw createError(404, 'Leave request not found');
    }

    if (leave.applicationType === 'Stay in Hostel') {
      throw createError(400, 'Stay in Hostel requests have a different workflow');
    }

    if (leave.status !== 'Pending OTP Verification') {
      throw createError(400, 'Invalid leave status for OTP verification');
    }

    if (leave.otpCode !== otp) {
      throw createError(400, 'Invalid OTP');
    }

    // Update status to Warden Verified and forward to principal
    leave.status = 'Warden Verified';
    leave.verifiedBy = wardenId;
    leave.verifiedAt = new Date();
    await leave.save();
    
    console.log('Warden verified OTP. Updated leave status to:', leave.status);
    console.log('Leave ID:', leave._id);

    // Notify principals assigned to the student's course
    // After SQL migration: course is stored as string (course name), not ObjectId
    const studentCourseName = leave.student.course?.name || leave.student.course;
    const principals = await Admin.find({ 
      role: 'principal',
      course: studentCourseName, // Now using course name (string) instead of ObjectId
      isActive: true
    });
    
    const warden = await Admin.findById(wardenId);
    const notificationTitle = 'Leave Request Ready for Approval';
    const notificationMessage = `${leave.student?.name || 'A student'}'s ${leave.applicationType} request has been verified by warden and is ready for your approval`;
    
    console.log(`🔔 Notifying ${principals.length} principals for course: ${studentCourseName}`);
    
    for (const principal of principals) {
      // Send in-app notification
      await Notification.createNotification({
        type: 'leave',
        recipient: principal._id,
        recipientModel: 'Admin',
        sender: warden._id,
        title: notificationTitle,
        message: notificationMessage,
        relatedId: leave._id,
        onModel: 'Leave',
        priority: 'high'
      });
      
      // Send push notification
      await sendOneSignalNotification(principal._id, {
        title: notificationTitle,
        message: notificationMessage,
        type: 'leave',
        relatedId: leave._id,
        priority: 10
      });
      
      // Send email notification if principal has email configured
      if (principal.email && principal.email.trim()) {
        try {
          console.log(`📧 Sending leave forwarded email to principal: ${principal.email}`);
          const emailResult = await sendLeaveForwardedEmail(
            principal.email,
            principal.username || 'Principal',
            leave.student?.name || 'Unknown Student',
            leave.student?.rollNumber || 'N/A',
            leave.applicationType || 'Leave',
            {
              startDate: leave.startDate,
              endDate: leave.endDate,
              gatePassDateTime: leave.gatePassDateTime,
              permissionDate: leave.permissionDate,
              outTime: leave.outTime,
              inTime: leave.inTime,
              reason: leave.reason || 'Not specified'
            }
          );
          if (emailResult && emailResult.success) {
            console.log(`✅ Email sent successfully to principal: ${principal.email}`);
          } else if (emailResult && emailResult.skipped) {
            console.log(`⏭️ Email skipped for principal: ${emailResult.message}`);
          }
        } catch (emailError) {
          console.error(`❌ Failed to send email to principal ${principal.email}:`, emailError.message || emailError);
          // Continue with other principals even if email fails for one
        }
      } else {
        console.log(`⚠️ Principal ${principal.username || principal._id} has no email configured, skipping email notification`);
      }
    }

    res.json({
      success: true,
      data: {
        leave,
        message: 'OTP verified successfully. Request forwarded to principal for approval.'
      }
    });
  } catch (error) {
    next(error);
  }
};

// Warden reject leave request
export const wardenRejectLeave = async (req, res, next) => {
  try {
    const { leaveId, rejectionReason } = req.body;
    const wardenId = req.warden._id;

    const leave = await Leave.findById(leaveId)
      .populate({
        path: 'student',
        select: 'name parentPhone gender course',
        populate: [
          { path: 'course', select: 'name code' },
          { path: 'branch', select: 'name code' }
        ]
      });
      
    if (!leave) {
      throw createError(404, 'Leave request not found');
    }

    if (leave.applicationType === 'Stay in Hostel') {
      throw createError(400, 'Stay in Hostel requests have a different workflow');
    }

    if (leave.status === 'Approved' || leave.status === 'Rejected') {
      throw createError(400, 'Leave request is already processed');
    }

    leave.status = 'Rejected';
    leave.rejectionReason = `Warden: ${rejectionReason}`;
    leave.approvedBy = wardenId;
    leave.approvedAt = new Date();
    await leave.save();

    res.json({
      success: true,
      data: {
        leave,
        message: 'Leave request rejected by warden'
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get leave requests for principal (all types except Stay in Hostel)
export const getPrincipalLeaveRequests = async (req, res, next) => {
  try {
    // Auto-delete expired leaves before fetching
    await autoDeleteExpiredLeaves();
    
    const { status, applicationType, page = 1, limit = 10 } = req.query;
    const principalId = req.principal._id;
    
    // Get principal's assigned details
    const principal = await Admin.findById(principalId).select('course branch assignedCollegeIds assignedCollegeId assignedLevels assignedCourses');
    
    if (!principal) {
      throw createError(400, 'Principal not found');
    }
    
    // Get allowed course names
    const allowedCourseNames = await getAllowedCourseNames(principal);
    const normalizedAllowedCourses = allowedCourseNames.map(c => normalizeCourseName(c));

    if (normalizedAllowedCourses.length === 0) {
      return res.json({
        success: true,
        data: {
          leaves: [],
          totalPages: 0,
          currentPage: page,
          totalRequests: 0
        }
      });
    }
    
    const query = {};

    // Build applicationType filter
    if (applicationType) {
      query.applicationType = applicationType;
    } else {
      query.applicationType = { $ne: 'Stay in Hostel' };
    }

    // Exclude bulk outing leave records
    query.reason = { $not: /^Bulk outing:/ };

    // Status filter
    if (status) {
      query.status = status;
    } else {
      query.status = { $in: ['Warden Verified', 'Pending Principal Approval'] };
    }

    // Fetch leaves matching the query
    const allLeaves = await Leave.find(query)
      .populate({
        path: 'student',
        select: 'name rollNumber course branch year gender studentPhone parentPhone email hostelId category batch academicYear hostelStatus graduationStatus studentPhoto sqlCourseId sqlBranchId'
      })
      .populate('approvedBy', 'name')
      .populate('verifiedBy', 'name')
      .sort({ createdAt: -1 });

    // Filter leaves in memory (necessary because course is stored as mixed types/SQL IDs)
    const filteredLeaves = [];
    for (const leave of allLeaves) {
      // Resolve student course
      let studentCourse = leave.student?.course;
      if (studentCourse) {
        studentCourse = await resolveCourseName(studentCourse);
      }
      
      const normalizedStudentCourse = studentCourse ? normalizeCourseName(studentCourse.trim()) : null;
      const matches = normalizedStudentCourse && normalizedAllowedCourses.includes(normalizedStudentCourse);
      
      if (matches) {
        // Also check branch if principal has a specific branch assigned
        if (principal.branch) {
          let studentBranch = leave.student?.branch;
          if (studentBranch) {
            studentBranch = await resolveBranchName(studentBranch);
          }
          
          const normalizedStudentBranch = studentBranch ? studentBranch.trim() : null;
          const normalizedPrincipalBranch = principal.branch?.trim();
          
          if (normalizedStudentBranch === normalizedPrincipalBranch) {
            filteredLeaves.push(leave);
          }
        } else {
          filteredLeaves.push(leave);
        }
      }
    }

    // Apply pagination to filtered results
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedLeaves = filteredLeaves.slice(startIndex, endIndex);

    res.json({
      success: true,
      data: {
        leaves: paginatedLeaves,
        totalPages: Math.ceil(filteredLeaves.length / limit),
        currentPage: page,
        totalRequests: filteredLeaves.length
      }
    });
  } catch (error) {
    console.error('Error in getPrincipalLeaveRequests:', error);
    next(error);
  }
};

// Principal approve leave request
export const principalApproveLeave = async (req, res, next) => {
  try {
    const { leaveId, comment } = req.body;
    const principalId = req.principal._id;

    console.log('Principal trying to approve leave:', leaveId);
    console.log('Request body:', req.body);

    // Get principal's assigned details
    const principal = await Admin.findById(principalId).select('course branch assignedCourses assignedCollegeIds assignedCollegeId assignedLevels');
    if (!principal) {
      throw createError(404, 'Principal not found');
    }

    const leave = await Leave.findById(leaveId)
      .populate({
        path: 'student',
        select: 'name parentPhone gender course branch'
      });
      
    if (!leave) {
      throw createError(404, 'Leave request not found');
    }

    console.log('Found leave request:', {
      id: leave._id,
      status: leave.status,
      applicationType: leave.applicationType,
      studentName: leave.student?.name,
      studentCourse: leave.student?.course,
      principalCourse: principal.course
    });

    // Check if principal is assigned to the student's course
    const allowedCourseNames = await getAllowedCourseNames(principal);
    const normalizedAllowedCourses = allowedCourseNames.map(c => normalizeCourseName(c));

    const rawStudentCourse = typeof leave.student.course === 'object' ? leave.student.course.name : leave.student.course;
    const studentCourseName = await resolveCourseName(rawStudentCourse);
    const normalizedStudentCourse = studentCourseName ? normalizeCourseName(studentCourseName.trim()) : null;
    
    console.log('🔍 Course comparison:', {
      studentCourseName,
      normalizedStudentCourse,
      allowedCourses: normalizedAllowedCourses,
      matches: normalizedStudentCourse && normalizedAllowedCourses.includes(normalizedStudentCourse)
    });
    
    if (!normalizedStudentCourse || !normalizedAllowedCourses.includes(normalizedStudentCourse)) {
      throw createError(403, 'You are not authorized to approve leave requests for this student\'s course');
    }
    
    // Also check branch if principal has a specific branch assigned
    if (principal.branch) {
      const studentBranch = typeof leave.student.branch === 'object' ? leave.student.branch.name : leave.student.branch;
      if (studentBranch !== principal.branch) {
        throw createError(403, 'You are not authorized to approve leave requests for this student\'s branch');
      }
    }

    if (leave.applicationType === 'Stay in Hostel') {
      throw createError(400, 'Stay in Hostel requests have a different workflow');
    }

    if (leave.status === 'Approved') {
      throw createError(400, 'Leave request is already approved');
    }

    if (leave.status === 'Rejected') {
      throw createError(400, 'Leave request is already rejected');
    }

    if (leave.status !== 'Warden Verified' && leave.status !== 'Pending Principal Approval') {
      console.log('Status mismatch. Expected: Warden Verified or Pending Principal Approval, Actual:', leave.status);
      throw createError(400, `Leave request must be verified by warden/admin or pending principal approval. Current status: ${leave.status}`);
    }

    leave.status = 'Approved';
    leave.approvedBy = principalId;
    leave.approvedAt = new Date();
    if (comment) {
      leave.principalComment = comment;
    }
    await leave.save();

    // Notify student
    await Notification.createNotification({
      type: 'leave',
      recipient: leave.student._id,
      recipientModel: 'User',
      sender: principalId,
      title: 'Leave Request Approved',
      message: `Your ${leave.applicationType} request has been approved by the principal`,
      relatedId: leave._id,
      onModel: 'Leave',
      priority: 'high'
    });

    await sendOneSignalNotification(leave.student._id, {
      title: 'Leave Request Approved',
      message: `Your ${leave.applicationType} request has been approved by the principal`,
      type: 'leave',
      relatedId: leave._id,
      priority: 10
    });

    res.json({
      success: true,
      data: {
        leave,
        message: 'Leave request approved successfully'
      }
    });
  } catch (error) {
    console.error('Error in principalApproveLeave:', error);
    next(error);
  }
};

// Principal reject leave request
export const principalRejectLeave = async (req, res, next) => {
  try {
    const { leaveId, rejectionReason } = req.body;
    const principalId = req.principal._id;

    // Get principal's assigned details
    const principal = await Admin.findById(principalId).select('course branch assignedCourses assignedCollegeIds assignedCollegeId assignedLevels');
    if (!principal) {
      throw createError(404, 'Principal not found');
    }

    const leave = await Leave.findById(leaveId)
      .populate({
        path: 'student',
        select: 'name parentPhone gender course branch'
      });
      
    if (!leave) {
      throw createError(404, 'Leave request not found');
    }

    // Check if principal is assigned to the student's course
    const allowedCourseNames = await getAllowedCourseNames(principal);
    const normalizedAllowedCourses = allowedCourseNames.map(c => normalizeCourseName(c));

    const rawStudentCourse = typeof leave.student.course === 'object' ? leave.student.course.name : leave.student.course;
    const studentCourseName = await resolveCourseName(rawStudentCourse);
    const normalizedStudentCourse = studentCourseName ? normalizeCourseName(studentCourseName.trim()) : null;
    
    console.log('🔍 Course comparison in reject:', {
      studentCourseName,
      normalizedStudentCourse,
      allowedCourses: normalizedAllowedCourses,
      matches: normalizedStudentCourse && normalizedAllowedCourses.includes(normalizedStudentCourse)
    });
    
    if (!normalizedStudentCourse || !normalizedAllowedCourses.includes(normalizedStudentCourse)) {
      throw createError(403, 'You are not authorized to reject leave requests for this student\'s course');
    }
    
    // Also check branch if principal has a specific branch assigned
    if (principal.branch) {
      const studentBranch = typeof leave.student.branch === 'object' ? leave.student.branch.name : leave.student.branch;
      const normalizedStudentBranch = studentBranch ? studentBranch.trim() : null;
      const normalizedPrincipalBranch = principal.branch?.trim();
      
      if (normalizedStudentBranch !== normalizedPrincipalBranch) {
        throw createError(403, 'You are not authorized to reject leave requests for this student\'s branch');
      }
    }

    if (leave.applicationType === 'Stay in Hostel') {
      throw createError(400, 'Stay in Hostel requests have a different workflow');
    }

    if (leave.status === 'Approved') {
      throw createError(400, 'Leave request is already approved');
    }

    if (leave.status === 'Rejected') {
      throw createError(400, 'Leave request is already rejected');
    }

    if (leave.status !== 'Warden Verified' && leave.status !== 'Pending Principal Approval') {
      console.log('Status mismatch in reject. Expected: Warden Verified or Pending Principal Approval, Actual:', leave.status);
      throw createError(400, `Leave request must be verified by warden/admin or pending principal approval. Current status: ${leave.status}`);
    }

    leave.status = 'Rejected';
    leave.rejectionReason = `Principal: ${rejectionReason}`;
    leave.approvedBy = principalId;
    leave.approvedAt = new Date();
    await leave.save();

    // Notify student
    await Notification.createNotification({
      type: 'leave',
      recipient: leave.student._id,
      recipientModel: 'User',
      sender: principalId,
      title: 'Leave Request Rejected',
      message: `Your ${leave.applicationType} request has been rejected by the principal`,
      relatedId: leave._id,
      onModel: 'Leave',
      priority: 'high'
    });

    await sendOneSignalNotification(leave.student._id, {
      title: 'Leave Request Rejected',
      message: `Your ${leave.applicationType} request has been rejected by the principal`,
      type: 'leave',
      relatedId: leave._id,
      priority: 10
    });

    res.json({
      success: true,
      data: {
        leave,
        message: 'Leave request rejected'
      }
    });
  } catch (error) {
    next(error);
  }
};

// Principal decision for Stay in Hostel request
export const principalDecision = async (req, res, next) => {
  try {
    // Accept both 'leaveId' (from frontend) and 'requestId' (legacy) for backwards compatibility
    const { leaveId, requestId, decision, comment } = req.body;
    const actualLeaveId = leaveId || requestId;
    const principalId = req.principal._id || req.user.id;

    // Get principal details
    const principal = await Admin.findById(principalId).select('course branch assignedCourses assignedCollegeIds assignedCollegeId assignedLevels');
    if (!principal) {
      throw createError(404, 'Principal not found');
    }

    // Find the stay in hostel request
    const request = await Leave.findById(actualLeaveId).populate({
      path: 'student',
      select: 'name rollNumber course branch'
    });
    
    if (!request) {
      throw createError(404, 'Stay in hostel request not found');
    }

    // Verify it's a stay in hostel request
    if (request.applicationType !== 'Stay in Hostel') {
      throw createError(400, 'Invalid request type');
    }

    // Verify the student belongs to the principal's course
    const allowedCourseNames = await getAllowedCourseNames(principal);
    const normalizedAllowedCourses = allowedCourseNames.map(c => normalizeCourseName(c));

    const rawStudentCourse = typeof request.student?.course === 'object' ? request.student.course.name : request.student?.course;
    const studentCourseName = await resolveCourseName(rawStudentCourse);
    const normalizedStudentCourse = studentCourseName ? normalizeCourseName(studentCourseName.trim()) : null;
    
    console.log('🔍 Course comparison in principalDecision:', {
      studentCourseName,
      normalizedStudentCourse,
      allowedCourses: normalizedAllowedCourses,
      matches: normalizedStudentCourse && normalizedAllowedCourses.includes(normalizedStudentCourse)
    });
    
    if (!normalizedStudentCourse || !normalizedAllowedCourses.includes(normalizedStudentCourse)) {
      throw createError(403, 'You can only make decisions for students in your assigned course(s)');
    }
    
    // Also check branch if principal has a specific branch assigned
    if (principal.branch) {
      const studentBranch = typeof request.student?.branch === 'object' ? request.student.branch.name : request.student?.branch;
      const normalizedStudentBranch = studentBranch ? studentBranch.trim() : null;
      const normalizedPrincipalBranch = principal.branch?.trim();
      
      if (normalizedStudentBranch !== normalizedPrincipalBranch) {
        throw createError(403, 'You can only make decisions for students in your assigned branch');
      }
    }

    // Verify the request is in a status that allows principal decision
    // Accept: Pending, Warden Recommended, Rejected (for re-review)
    const allowedStatuses = ['Pending', 'Warden Recommended', 'Rejected', 'Pending Principal Decision'];
    if (!allowedStatuses.includes(request.status)) {
      throw createError(400, `Request cannot be processed. Current status: ${request.status}`);
    }

    // Normalize decision value (handle both 'approve'/'reject' and 'Approved'/'Rejected')
    const isApproved = decision === 'approve' || decision === 'Approved';
    const normalizedDecision = isApproved ? 'Approved' : 'Rejected';
    
    // Update the request status
    request.status = isApproved ? 'Principal Approved' : 'Principal Rejected';
    request.principalDecision = normalizedDecision;
    request.principalComment = comment || '';
    request.decidedBy = principalId;
    request.decidedAt = new Date();

    await request.save();

    // Get student details for notification (already populated above)
    const student = request.student;
    if (student) {
      // Create notification for student
      const notification = new Notification({
        recipient: student._id,
        recipientModel: 'User',
        type: 'stay_in_hostel_decision',
        title: `Stay in Hostel Request ${normalizedDecision}`,
        message: `Your stay in hostel request for ${new Date(request.stayDate).toLocaleDateString()} has been ${normalizedDecision.toLowerCase()} by the principal.${comment ? ` Comment: ${comment}` : ''}`,
        priority: 'high'
      });
      await notification.save();
    }

    res.status(200).json({
      success: true,
      message: `Stay in hostel request ${normalizedDecision.toLowerCase()} successfully`,
      data: {
        request: {
          _id: request._id,
          status: request.status,
          principalDecision: request.principalDecision,
          principalComment: request.principalComment
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get student leave history for principal
export const getStudentLeaveHistory = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const principalId = req.user.id;

    // Get principal details
    const principal = await Admin.findById(principalId).select('course branch assignedCourses assignedCollegeIds assignedCollegeId assignedLevels');
    if (!principal) {
      throw createError(404, 'Principal not found');
    }

    // Verify the student exists
    const student = await User.findById(studentId);
    if (!student) {
      throw createError(404, 'Student not found');
    }

    // NEW: Verify the principal has permission for this student
    const allowedCourseNames = await getAllowedCourseNames(principal);
    const normalizedAllowedCourses = allowedCourseNames.map(c => normalizeCourseName(c));
    
    const studentCourseName = await resolveCourseName(student.course);
    const normalizedStudentCourse = studentCourseName ? normalizeCourseName(studentCourseName.trim()) : null;
    
    if (!normalizedStudentCourse || !normalizedAllowedCourses.includes(normalizedStudentCourse)) {
      throw createError(403, 'You do not have permission to view leave history for this student\'s course');
    }

    // Get all leave requests for the student (excluding current pending ones)
    const leaves = await Leave.find({
      student: studentId,
      status: { $nin: ['Pending', 'Pending OTP Verification', 'Warden Verified'] }
    })
    .sort({ createdAt: -1 })
    .limit(20); // Limit to last 20 records for performance

    res.status(200).json({
      success: true,
      message: 'Student leave history retrieved successfully',
      data: {
        leaves,
        totalCount: leaves.length
      }
    });
  } catch (error) {
    next(error);
  }
};

// Delete leave request (student can delete their own requests)
export const deleteLeaveRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const studentId = req.user.id;
    
    // Find the leave request
    const leave = await Leave.findById(id);
    if (!leave) {
      throw createError(404, 'Leave request not found');
    }
    
    // Check if the student owns this request
    if (leave.student.toString() !== studentId) {
      throw createError(403, 'You can only delete your own leave requests');
    }
    
    // Check if the request can be deleted based on status
    const deletableStatuses = ['Pending', 'Pending OTP Verification', 'Warden Verified', 'Warden Recommended'];
    if (!deletableStatuses.includes(leave.status)) {
      throw createError(400, 'Cannot delete this request. It has already been approved or rejected.');
    }
    
    // Delete the request
    await Leave.findByIdAndDelete(id);
    
    console.log(`🗑️ Leave request ${id} deleted by student ${studentId}`);
    
    res.json({
      success: true,
      message: 'Leave request deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};


// Get OTP from the Leave request (for testing purposes)
export const getOTP = async (req, res, next) => {
  try {
    const { leaveId } = req.body;
    const leave = await Leave.findById(leaveId);
    if (!leave) {
      throw createError(404, 'Leave request not found');
    }
    res.status(200).json({
      success: true,
      message: 'OTP retrieved successfully',
      data: {
        otp: leave.otpCode
      }
    });
  } catch (error) {
    next(error);
  }
};