import Leave from '../models/Leave.js';
import User from '../models/User.js';
import { createError } from '../utils/error.js';
import { sendSMS } from '../utils/smsService.js';

// Generate OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Create new leave request
export const createLeaveRequest = async (req, res, next) => {
  try {
    const { startDate, endDate, reason } = req.body;
    const studentId = req.user.id;

    // Get student details
    const student = await User.findById(studentId);
    if (!student) {
      throw createError(404, 'Student not found');
    }

    // Validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    const today = new Date();
    
    if (start < today) {
      throw createError(400, 'Start date cannot be in the past');
    }
    
    if (end <= start) {
      throw createError(400, 'End date must be after start date');
    }

    // Calculate number of days
    const timeDiff = end.getTime() - start.getTime();
    const numberOfDays = Math.ceil(timeDiff / (1000 * 3600 * 24));

    // Calculate QR availability time (2 minutes before start)
    const qrAvailableFrom = new Date(start.getTime() - (2 * 60 * 1000));

    // Generate OTP
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

    // Create leave request
    const leave = new Leave({
      student: studentId,
      startDate,
      endDate,
      numberOfDays,
      reason,
      otpCode: otp,
      otpExpiry,
      parentPhone: student.parentPhone,
      status: 'Pending OTP Verification',
      qrAvailableFrom
    });

    await leave.save();

    // Try to send OTP via SMS, but don't fail the request if SMS fails
    try {
      const message = `Join MBA,MCA @ Pydah College of Engg (Autonomous).Best Opportunity for Employees,Aspiring Students. ${otp} youtu.be/bnLOLQrSC5g?si=7TNjgpGQ3lTIe-sf -PYDAH`;
      await sendSMS(student.parentPhone, message, { otp });
    } catch (smsError) {
      console.error('SMS sending failed:', smsError);
      // Continue with the request even if SMS fails
    }

    res.json({
      success: true,
      data: {
        leave,
        message: 'Leave request created successfully. Please contact admin for OTP verification.'
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
      .populate('student', 'name rollNumber course branch year')
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
    const { status, page = 1, limit = 10 } = req.query;
    const query = {};

    if (status) {
      query.status = status;
    }

    console.log('MongoDB query:', query);

    const leaves = await Leave.find(query)
      .populate('student', 'name rollNumber course branch year')
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
      .populate('student', 'name parentPhone');
      
    if (!leave) {
      throw createError(404, 'Leave request not found');
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
      .populate('student', 'name parentPhone');
      
    if (!leave) {
      throw createError(404, 'Leave request not found');
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

// Student requests to view QR code (increments view count)
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
        message: 'QR code is only available for approved leaves',
        qrLocked: true 
      });
    }
    
    // Check if QR is locked
    if (leave.qrLocked) {
      return res.status(403).json({ 
        success: false, 
        message: 'QR code view limit reached',
        qrLocked: true 
      });
    }
    
    const now = new Date();
    
    // Check if QR is available based on timing
    if (now < leave.qrAvailableFrom) {
      const timeUntilAvailable = Math.ceil((leave.qrAvailableFrom - now) / (1000 * 60)); // minutes
      return res.status(403).json({ 
        success: false, 
        message: `QR code will be available in ${timeUntilAvailable} minutes`,
        qrLocked: false 
      });
    }
    
    if (now > leave.endDate) {
      return res.status(403).json({ 
        success: false, 
        message: 'Leave period has expired',
        qrLocked: true 
      });
    }
    
    // Check view count limit
    if (leave.qrViewCount >= 2) {
      leave.qrLocked = true;
      await leave.save();
      return res.status(403).json({ 
        success: false, 
        message: 'QR code view limit reached', 
        qrLocked: true 
      });
    }
    
    // Increment view count
    leave.qrViewCount += 1;
    if (leave.qrViewCount >= 2) {
      leave.qrLocked = true;
    }
    await leave.save();
    
    res.json({ 
      success: true, 
      qrLocked: leave.qrLocked, 
      qrViewCount: leave.qrViewCount 
    });
  } catch (error) {
    next(error);
  }
};

// Get leave by ID (for QR code details, no scan logic)
export const getLeaveById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const leave = await Leave.findById(id).populate('student', 'name rollNumber');
    if (!leave) {
      return res.status(404).json({ success: false, message: 'Leave not found' });
    }
    res.json({ success: true, data: leave });
  } catch (error) {
    next(error);
  }
};

// Get all approved leave requests for security guards
export const getApprovedLeaves = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    
    const leaves = await Leave.find({ status: 'Approved' })
      .populate('student', 'name rollNumber course branch year')
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
      .populate('student', 'name rollNumber');
      
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