import Outpass from '../models/Outpass.js';
import User from '../models/User.js';
import { createError } from '../utils/error.js';
import { sendSMS } from '../utils/smsService.js';

// Generate OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Create new outpass request
export const createOutpassRequest = async (req, res, next) => {
  try {
    const { dateOfOutpass, reason } = req.body;
    const studentId = req.user.id;

    // Get student details
    const student = await User.findById(studentId);
    if (!student) {
      throw createError(404, 'Student not found');
    }

    // Validate date
    const outpassDate = new Date(dateOfOutpass);
    const today = new Date();
    if (outpassDate < today) {
      throw createError(400, 'Outpass date cannot be in the past');
    }

    // Generate OTP
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

    // Create outpass request
    const outpass = new Outpass({
      student: studentId,
      dateOfOutpass,
      reason,
      otpCode: otp,
      otpExpiry,
      parentPhone: student.parentPhone,
      status: 'Pending OTP Verification'
    });

    await outpass.save();

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
        outpass,
        message: 'Outpass request created successfully. Please contact admin for OTP verification.'
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get student's outpass requests
export const getStudentOutpassRequests = async (req, res, next) => {
  try {
    const studentId = req.user.id;
    const outpasses = await Outpass.find({ student: studentId })
      .populate('student', 'name rollNumber course branch year')
      .populate('approvedBy', 'name')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: outpasses
    });
  } catch (error) {
    next(error);
  }
};

// Get all outpass requests (admin)
export const getAllOutpassRequests = async (req, res, next) => {
  try {
    console.log('Getting all outpass requests with query:', req.query);
    const { status, page = 1, limit = 10 } = req.query;
    const query = {};

    if (status) {
      query.status = status;
    }

    console.log('MongoDB query:', query);

    const outpasses = await Outpass.find(query)
      .populate('student', 'name rollNumber course branch year')
      .populate('approvedBy', 'name')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    console.log('Found outpasses:', outpasses);

    const count = await Outpass.countDocuments(query);
    console.log('Total count:', count);

    res.json({
      success: true,
      data: {
        outpasses,
        totalPages: Math.ceil(count / limit),
        currentPage: page,
        totalRequests: count
      }
    });
  } catch (error) {
    console.error('Error in getAllOutpassRequests:', error);
    next(error);
  }
};

// Verify OTP and approve outpass
export const verifyOTPAndApprove = async (req, res, next) => {
  try {
    const { outpassId, otp } = req.body;
    const adminId = req.user.id;

    const outpass = await Outpass.findById(outpassId)
      .populate('student', 'name parentPhone');
      
    if (!outpass) {
      throw createError(404, 'Outpass request not found');
    }

    if (outpass.status !== 'Pending OTP Verification') {
      throw createError(400, 'Invalid outpass status for OTP verification');
    }

    if (outpass.otpCode !== otp) {
      throw createError(400, 'Invalid OTP');
    }

    outpass.status = 'Approved';
    outpass.approvedBy = adminId;
    outpass.approvedAt = new Date();
    await outpass.save();

    // Removed SMS sending logic here

    res.json({
      success: true,
      data: {
        outpass,
        message: 'Outpass request approved successfully'
      }
    });
  } catch (error) {
    next(error);
  }
};

// Reject outpass request
export const rejectOutpassRequest = async (req, res, next) => {
  try {
    const { outpassId, rejectionReason } = req.body;
    const adminId = req.user.id;

    const outpass = await Outpass.findById(outpassId)
      .populate('student', 'name parentPhone');
      
    if (!outpass) {
      throw createError(404, 'Outpass request not found');
    }

    if (outpass.status === 'Approved' || outpass.status === 'Rejected') {
      throw createError(400, 'Outpass request is already processed');
    }

    outpass.status = 'Rejected';
    outpass.rejectionReason = rejectionReason;
    outpass.approvedBy = adminId;
    outpass.approvedAt = new Date();
    await outpass.save();

    // No SMS sent on rejection

    res.json({
      success: true,
      data: {
        outpass,
        message: 'Outpass request rejected'
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get outpass by ID (for QR code details)
export const getOutpassById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const outpass = await Outpass.findById(id).populate('student', 'name rollNumber');
    if (!outpass) {
      return res.status(404).json({ success: false, message: 'Outpass not found' });
    }
    res.json({ success: true, data: outpass });
  } catch (error) {
    next(error);
  }
}; 