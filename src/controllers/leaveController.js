import Leave from '../models/Leave.js';
import User from '../models/User.js';
import { createError } from '../utils/error.js';
import { sendSMS } from '../utils/smsService.js';
import Notification from '../models/Notification.js';
import { sendOneSignalNotification, sendOneSignalBulkNotification } from '../utils/oneSignalService.js';

// Generate OTP (4 digits)
const generateOTP = () => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

// Validate time format (HH:MM)
const validateTimeFormat = (time) => {
  const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
  return timeRegex.test(time);
};

// Validate gate pass date and time (must be after 4:30 PM and before start date)
const validateGatePassDateTime = (gatePassDateTime, startDate) => {
  const gatePass = new Date(gatePassDateTime);
  const start = new Date(startDate);
  const fourThirtyPM = new Date(gatePass);
  fourThirtyPM.setHours(16, 30, 0, 0); // 4:30 PM
  
  return gatePass >= fourThirtyPM && gatePass < start;
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
      
      if (start < today) {
        throw createError(400, 'Start date cannot be in the past');
      }
      
      if (end <= start) {
        throw createError(400, 'End date must be after start date');
      }

      // Validate gate pass date and time
      if (!validateGatePassDateTime(gatePassDateTime, startDate)) {
        throw createError(400, 'Gate pass must be after 4:30 PM and before the start date');
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
      const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry
      leaveData.otpCode = otp;
      leaveData.otpExpiry = otpExpiry;
      leaveData.status = 'Pending OTP Verification';

    } else if (applicationType === 'Permission') {
      // Validate permission-specific fields
      if (!permissionDate || !outTime || !inTime) {
        throw createError(400, 'Permission date, out time, and in time are required for permission applications');
      }

      const permission = new Date(permissionDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (permission < today) {
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

      // Generate OTP for Permission applications
      const otp = generateOTP();
      const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry
      leaveData.otpCode = otp;
      leaveData.otpExpiry = otpExpiry;
      leaveData.status = 'Pending OTP Verification';

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

    // Send SMS only for Leave and Permission applications
    if (applicationType !== 'Stay in Hostel') {
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

    // Filter by admin's course permissions if they have leave_management permission
    if (req.admin.role === 'sub_admin' && req.admin.permissions && req.admin.permissions.includes('leave_management')) {
      if (req.admin.leaveManagementCourses && req.admin.leaveManagementCourses.length > 0) {
        // Filter students by the courses the admin has access to
        query['student'] = {
          $in: await User.distinct('_id', {
            course: { $in: req.admin.leaveManagementCourses }
          })
        };
        console.log('Filtering by admin course permissions:', req.admin.leaveManagementCourses);
      } else {
        // If admin has leave_management permission but no courses assigned, return empty
        console.log('Admin has leave_management permission but no courses assigned');
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
      if (!req.admin.leaveManagementCourses || !req.admin.leaveManagementCourses.includes(leave.student.course.toString())) {
        throw createError(403, 'You do not have permission to approve leave requests for this student\'s course');
      }
    }

    if (leave.status !== 'Pending OTP Verification') {
      throw createError(400, 'Invalid leave status for OTP verification');
    }

    if (leave.otpCode !== otp) {
      throw createError(400, 'Invalid OTP');
    }

    leave.status = 'Approved';
    leave.approvedBy = adminId;
    leave.approvedAt = new Date();
    await leave.save();

    // Removed SMS sending logic here

    res.json({
      success: true,
      data: {
        leave,
        message: 'Leave request approved successfully'
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

    leave.status = 'Rejected';
    leave.rejectionReason = rejectionReason;
    leave.approvedBy = adminId;
    leave.approvedAt = new Date();
    await leave.save();

    // No SMS sent on rejection

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
      location
    });
    
    // Ensure visit count doesn't exceed max visits
    leave.visitCount = Math.min(leave.visits.length, leave.maxVisits);
    
    // Check if max visits reached
    if (leave.visitCount >= leave.maxVisits) {
      leave.visitLocked = true;
    }
    
    console.log(`🔍 Recording visit for leave ${id}:`);
    console.log(`  - Previous visit count: ${leave.visits.length - 1}`);
    console.log(`  - New visit count: ${leave.visitCount}`);
    console.log(`  - Max visits: ${leave.maxVisits}`);
    console.log(`  - Visit locked: ${leave.visitLocked}`);
    
    await leave.save();
    
    res.json({ 
      success: true, 
      message: 'Visit recorded successfully',
      visitCount: leave.visitCount,
      maxVisits: leave.maxVisits,
      visitLocked: leave.visitLocked,
      remainingVisits: leave.maxVisits - leave.visitCount
    });
  } catch (error) {
    next(error);
  }
};

// Get leave by ID (for QR code details, includes visit info)
export const getLeaveById = async (req, res, next) => {
  try {
    const { id } = req.params;
    console.log('🔍 getLeaveById called with ID:', id);
    console.log('🔍 Request headers:', req.headers);
    
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
      console.log('❌ Leave not found for ID:', id);
      return res.status(404).json({ success: false, message: 'Leave not found' });
    }
    
    console.log('✅ Leave found:', {
      id: leave._id,
      student: leave.student?.name,
      status: leave.status,
      visitCount: leave.visitCount
    });
    
    // Add visit information to response
    const response = {
      success: true,
      data: {
        ...leave.toObject(),
        visitCount: leave.visitCount,
        maxVisits: leave.maxVisits,
        remainingVisits: leave.maxVisits - leave.visitCount,
        visitLocked: leave.visitLocked
      }
    };
    
    console.log('✅ Sending response:', response);
    res.json(response);
  } catch (error) {
    console.error('❌ Error in getLeaveById:', error);
    next(error);
  }
};

// Get all approved leave requests for security guards
export const getApprovedLeaves = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    
    const leaves = await Leave.find({ status: 'Approved' })
      .populate({
        path: 'student',
        select: 'name rollNumber course branch year gender studentPhone parentPhone email hostelId category batch academicYear hostelStatus graduationStatus studentPhoto',
        populate: [
          { path: 'course', select: 'name code' },
          { path: 'branch', select: 'name code' }
        ]
      })
      .populate('approvedBy', 'name')
      .sort({ approvedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await Leave.countDocuments({ status: 'Approved' });

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
    const { status, principalDecision, wardenRecommendation, page = 1, limit = 10, fromDate, toDate } = req.query;
    const query = { applicationType: 'Stay in Hostel' };

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

// Principal decision for Stay in Hostel request
export const principalDecision = async (req, res, next) => {
  try {
    const { leaveId, decision, comment } = req.body;
    const principalId = req.principal._id;

    const leave = await Leave.findById(leaveId)
      .populate('student', 'name rollNumber');
      
    if (!leave) {
      throw createError(404, 'Stay in Hostel request not found');
    }

    if (leave.applicationType !== 'Stay in Hostel') {
      throw createError(400, 'This request is not a Stay in Hostel request');
    }

    if (!['Approved', 'Rejected'].includes(decision)) {
      throw createError(400, 'Invalid decision. Must be "Approved" or "Rejected"');
    }

    leave.principalDecision = decision;
    leave.principalComment = comment;
    leave.decidedBy = principalId;
    leave.decidedAt = new Date();

    // Update status based on decision
    if (decision === 'Approved') {
      leave.status = 'Principal Approved';
    } else {
      leave.status = 'Principal Rejected';
      leave.rejectionReason = `Principal: ${comment || 'Rejected'}`;
    }

    await leave.save();

    // Notify all wardens
    const wardenUsers = await User.find({ role: 'warden' });
    const principal = await User.findById(req.principal._id);
    const principalNotifTitle = 'Principal Decision for Stay in Hostel';
    const principalNotifMsg = `${leave.student?.name || 'A student'}'s Stay in Hostel request: Principal ${decision} (${comment || ''})`;
    for (const warden of wardenUsers) {
      await Notification.createNotification({
        type: 'leave',
        recipient: warden._id,
        sender: principal._id,
        title: principalNotifTitle,
        message: principalNotifMsg,
        relatedId: leave._id,
        priority: 'high'
      });
      await sendOneSignalNotification(warden._id, {
        title: principalNotifTitle,
        message: principalNotifMsg,
        type: 'leave',
        relatedId: leave._id,
        priority: 10
      });
    }

    res.json({
      success: true,
      data: {
        leave,
        message: `Stay in Hostel request ${decision.toLowerCase()} by principal`
      }
    });
  } catch (error) {
    next(error);
  }
}; 