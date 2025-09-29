import NOC from '../models/NOC.js';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import { createError } from '../utils/error.js';
import Notification from '../models/Notification.js';

// Student: Create NOC request
export const createNOCRequest = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const studentId = req.user.id;

    // Get student details
    const student = await User.findById(studentId).populate('course branch');
    if (!student) {
      return next(createError(404, 'Student not found'));
    }

    // Check if student already has a pending NOC request
    const existingNOC = await NOC.findOne({
      student: studentId,
      status: { $in: ['Pending', 'Warden Verified'] }
    });

    if (existingNOC) {
      return next(createError(400, 'You already have a pending NOC request'));
    }

    // Check if student is already deactivated
    if (student.hostelStatus === 'Inactive') {
      return next(createError(400, 'Your account is already deactivated'));
    }

    // Create NOC request
    const nocRequest = new NOC({
      student: studentId,
      studentName: student.name,
      rollNumber: student.rollNumber,
      course: student.course._id,
      branch: student.branch._id,
      year: student.year,
      academicYear: student.academicYear,
      reason: reason.trim()
    });

    await nocRequest.save();

    // Populate the created NOC
    const populatedNOC = await NOC.findById(nocRequest._id)
      .populate('student', 'name rollNumber course branch year academicYear')
      .populate('course branch', 'name');

    res.status(201).json({
      success: true,
      message: 'NOC request submitted successfully',
      data: populatedNOC
    });
  } catch (error) {
    next(error);
  }
};

// Student: Get their NOC requests
export const getStudentNOCRequests = async (req, res, next) => {
  try {
    const studentId = req.user.id;

    const nocRequests = await NOC.findByStudent(studentId)
      .populate('course branch', 'name')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: nocRequests
    });
  } catch (error) {
    next(error);
  }
};

// Student: Get specific NOC request
export const getNOCRequestById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const studentId = req.user.id;

    const nocRequest = await NOC.findOne({ _id: id, student: studentId })
      .populate('student', 'name rollNumber course branch year academicYear')
      .populate('course branch', 'name')
      .populate('verifiedBy approvedBy rejectedBy', 'username role');

    if (!nocRequest) {
      return next(createError(404, 'NOC request not found'));
    }

    res.json({
      success: true,
      data: nocRequest
    });
  } catch (error) {
    next(error);
  }
};

// Student: Delete NOC request (only if pending)
export const deleteNOCRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const studentId = req.user.id;

    const nocRequest = await NOC.findOne({ _id: id, student: studentId });

    if (!nocRequest) {
      return next(createError(404, 'NOC request not found'));
    }

    if (nocRequest.status !== 'Pending') {
      return next(createError(400, 'Only pending NOC requests can be deleted'));
    }

    await NOC.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'NOC request deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Warden: Get all NOC requests for verification
export const getWardenNOCRequests = async (req, res, next) => {
  try {
    const { status } = req.query;
    
    let query = {};
    if (status) {
      query.status = status;
    }

    const nocRequests = await NOC.find(query)
      .populate('student', 'name rollNumber course branch year academicYear')
      .populate('course branch', 'name')
      .populate('verifiedBy approvedBy rejectedBy', 'username role')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: nocRequests
    });
  } catch (error) {
    next(error);
  }
};

// Warden: Verify NOC request
export const wardenVerifyNOC = async (req, res, next) => {
  try {
    console.log('🔍 wardenVerifyNOC called with:', { params: req.params, body: req.body, user: req.user });
    const { id } = req.params;
    const { remarks } = req.body;
    const wardenId = req.user.id;

    const nocRequest = await NOC.findById(id);
    if (!nocRequest) {
      return next(createError(404, 'NOC request not found'));
    }

    if (nocRequest.status !== 'Pending') {
      return next(createError(400, 'Only pending NOC requests can be verified'));
    }

    // Update status to Warden Verified
    await nocRequest.updateStatus('Warden Verified', wardenId, remarks);

    // Create notification for super admin
    // Find a super admin to send notification to
    const superAdmin = await Admin.findOne({ role: 'super_admin' });
    if (superAdmin) {
      await Notification.create({
        recipient: superAdmin._id,
        recipientModel: 'Admin',
        title: 'NOC Request Needs Approval',
        message: `NOC request from ${nocRequest.studentName} (${nocRequest.rollNumber}) has been verified by warden and needs final approval`,
        type: 'system',
        priority: 'medium'
      });
    }

    // Populate the updated NOC
    const updatedNOC = await NOC.findById(id)
      .populate('student', 'name rollNumber course branch year academicYear')
      .populate('course branch', 'name')
      .populate('verifiedBy approvedBy rejectedBy', 'username role');

    res.json({
      success: true,
      message: 'NOC request verified successfully',
      data: updatedNOC
    });
  } catch (error) {
    console.error('❌ Error in wardenVerifyNOC:', error);
    next(error);
  }
};

// Warden: Reject NOC request
export const wardenRejectNOC = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;
    const wardenId = req.user.id;

    const nocRequest = await NOC.findById(id);
    if (!nocRequest) {
      return next(createError(404, 'NOC request not found'));
    }

    if (nocRequest.status !== 'Pending') {
      return next(createError(400, 'Only pending NOC requests can be rejected'));
    }

    // Update status to Rejected
    await nocRequest.updateStatus('Rejected', wardenId, rejectionReason);

    // Create notification for student
    await Notification.create({
      recipient: nocRequest.student,
      recipientModel: 'User',
      title: 'NOC Request Rejected',
      message: `Your NOC request has been rejected by warden. Reason: ${rejectionReason}`,
      type: 'system',
      priority: 'high'
    });

    // Populate the updated NOC
    const updatedNOC = await NOC.findById(id)
      .populate('student', 'name rollNumber course branch year academicYear')
      .populate('course branch', 'name')
      .populate('verifiedBy approvedBy rejectedBy', 'username role');

    res.json({
      success: true,
      message: 'NOC request rejected successfully',
      data: updatedNOC
    });
  } catch (error) {
    next(error);
  }
};

// Super Admin: Get all NOC requests
export const getAllNOCRequests = async (req, res, next) => {
  try {
    const { status } = req.query;
    
    let query = {};
    if (status) {
      query.status = status;
    }

    const nocRequests = await NOC.find(query)
      .populate('student', 'name rollNumber course branch year academicYear')
      .populate('course branch', 'name')
      .populate('verifiedBy approvedBy rejectedBy', 'username role')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: nocRequests
    });
  } catch (error) {
    next(error);
  }
};

// Super Admin: Approve NOC request
export const approveNOCRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const superAdminId = req.user.id;

    const nocRequest = await NOC.findById(id);
    if (!nocRequest) {
      return next(createError(404, 'NOC request not found'));
    }

    if (nocRequest.status !== 'Warden Verified') {
      return next(createError(400, 'Only warden verified NOC requests can be approved'));
    }

    // Update status to Approved
    await nocRequest.updateStatus('Approved', superAdminId);

    // Deactivate student and vacate room allocation
    console.log(`🏠 Deactivating student ${nocRequest.studentName} (${nocRequest.rollNumber}) and vacating room allocation...`);
    await nocRequest.deactivateStudent();
    console.log(`✅ Student deactivated and room vacated successfully`);

    // Create notification for student
    await Notification.create({
      recipient: nocRequest.student,
      recipientModel: 'User',
      title: 'NOC Request Approved',
      message: 'Your NOC request has been approved. Your account has been deactivated.',
      type: 'system',
      priority: 'high'
    });

    // Populate the updated NOC
    const updatedNOC = await NOC.findById(id)
      .populate('student', 'name rollNumber course branch year academicYear')
      .populate('course branch', 'name')
      .populate('verifiedBy approvedBy rejectedBy', 'username role');

    res.json({
      success: true,
      message: 'NOC request approved and student deactivated successfully',
      data: updatedNOC
    });
  } catch (error) {
    next(error);
  }
};

// Super Admin: Reject NOC request
export const rejectNOCRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;
    const superAdminId = req.user.id;

    const nocRequest = await NOC.findById(id);
    if (!nocRequest) {
      return next(createError(404, 'NOC request not found'));
    }

    if (nocRequest.status !== 'Warden Verified') {
      return next(createError(400, 'Only warden verified NOC requests can be rejected'));
    }

    // Update status to Rejected
    await nocRequest.updateStatus('Rejected', superAdminId, rejectionReason);

    // Create notification for student
    await Notification.create({
      recipient: nocRequest.student,
      recipientModel: 'User',
      title: 'NOC Request Rejected',
      message: `Your NOC request has been rejected by super admin. Reason: ${rejectionReason}`,
      type: 'system',
      priority: 'high'
    });

    // Populate the updated NOC
    const updatedNOC = await NOC.findById(id)
      .populate('student', 'name rollNumber course branch year academicYear')
      .populate('course branch', 'name')
      .populate('verifiedBy approvedBy rejectedBy', 'username role');

    res.json({
      success: true,
      message: 'NOC request rejected successfully',
      data: updatedNOC
    });
  } catch (error) {
    next(error);
  }
};

// Get NOC statistics
export const getNOCStats = async (req, res, next) => {
  try {
    const stats = await NOC.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const totalNOCs = await NOC.countDocuments();
    const deactivatedStudents = await NOC.countDocuments({ studentDeactivated: true });

    const formattedStats = {
      total: totalNOCs,
      deactivatedStudents,
      byStatus: stats.reduce((acc, stat) => {
        acc[stat._id] = stat.count;
        return acc;
      }, {})
    };

    res.json({
      success: true,
      data: formattedStats
    });
  } catch (error) {
    next(error);
  }
};
