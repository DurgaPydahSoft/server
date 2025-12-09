import NOC from '../models/NOC.js';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import Room from '../models/Room.js';
import NOCChecklistConfig from '../models/NOCChecklistConfig.js';
import { createError } from '../utils/error.js';
import Notification from '../models/Notification.js';

// Student: Create NOC request
export const createNOCRequest = async (req, res, next) => {
  try {
    const { reason, vacatingDate } = req.body;
    const studentId = req.user.id;

    // Validate vacating date
    if (!vacatingDate) {
      return next(createError(400, 'Vacating date is required'));
    }

    const vacatingDateObj = new Date(vacatingDate);
    if (isNaN(vacatingDateObj.getTime())) {
      return next(createError(400, 'Invalid vacating date format'));
    }

    // Ensure vacating date is not in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (vacatingDateObj < today) {
      return next(createError(400, 'Vacating date cannot be in the past'));
    }

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
      reason: reason.trim(),
      vacatingDate: vacatingDateObj
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

    const nocRequests = await NOC.find({ student: studentId })
      .populate('course branch', 'name')
      .populate('verifiedBy approvedBy rejectedBy raisedByWarden', 'username role')
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
      .populate('verifiedBy approvedBy rejectedBy raisedByWarden', 'username role');

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

// Warden: Create NOC request on behalf of student
export const createNOCForStudent = async (req, res, next) => {
  try {
    const { studentId, reason, vacatingDate } = req.body;
    const wardenId = req.warden._id;

    console.log('📝 Warden creating NOC for student:', { studentId, reason, vacatingDate, wardenId });

    // Validate required fields
    if (!studentId || !reason) {
      return next(createError(400, 'Student ID and reason are required'));
    }

    // Validate vacating date
    if (!vacatingDate) {
      return next(createError(400, 'Vacating date is required'));
    }

    const vacatingDateObj = new Date(vacatingDate);
    if (isNaN(vacatingDateObj.getTime())) {
      return next(createError(400, 'Invalid vacating date format'));
    }

    // Ensure vacating date is not in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (vacatingDateObj < today) {
      return next(createError(400, 'Vacating date cannot be in the past'));
    }

    // Validate reason length
    if (reason.trim().length < 10) {
      return next(createError(400, 'Reason must be at least 10 characters long'));
    }

    if (reason.trim().length > 500) {
      return next(createError(400, 'Reason cannot exceed 500 characters'));
    }

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
      return next(createError(400, 'Student already has a pending NOC request'));
    }

    // Check if student is already deactivated
    if (student.hostelStatus === 'Inactive') {
      return next(createError(400, 'Student account is already deactivated'));
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
      reason: reason.trim(),
      vacatingDate: vacatingDateObj,
      raisedBy: 'warden',
      raisedByWarden: wardenId
    });

    await nocRequest.save();

    // Create notification for student about the NOC request
    await Notification.create({
      recipient: studentId,
      recipientModel: 'User',
      title: 'NOC Request Created',
      message: `A NOC request has been created on your behalf by the warden. Reason: ${reason.substring(0, 100)}${reason.length > 100 ? '...' : ''}`,
      type: 'system',
      priority: 'high'
    });

    // Populate the created NOC
    const populatedNOC = await NOC.findById(nocRequest._id)
      .populate('student', 'name rollNumber course branch year academicYear')
      .populate('course branch', 'name')
      .populate('raisedByWarden', 'username role');

    console.log('📝 NOC request created by warden successfully:', nocRequest._id);

    res.status(201).json({
      success: true,
      message: 'NOC request created successfully on behalf of student',
      data: populatedNOC
    });
  } catch (error) {
    console.error('❌ Error creating NOC for student:', error);
    next(error);
  }
};

// Warden: Get students for NOC request creation
export const getStudentsForNOC = async (req, res, next) => {
  try {
    const { search, course, year } = req.query;
    const wardenHostelType = req.warden.hostelType;

    // Build query - only active students
    let query = { 
      hostelStatus: 'Active',
      role: 'student'
    };

    // Filter by hostel type (boys/girls)
    if (wardenHostelType) {
      query.gender = wardenHostelType === 'boys' ? 'Male' : 'Female';
    }

    // Add search filter
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { rollNumber: { $regex: search, $options: 'i' } }
      ];
    }

    // Add course filter
    if (course) {
      query.course = course;
    }

    // Add year filter
    if (year) {
      query.year = parseInt(year);
    }

    const students = await User.find(query)
      .select('name rollNumber course branch year academicYear gender roomNumber')
      .populate('course branch', 'name code')
      .sort({ name: 1 })
      .limit(50);

    // Filter out students who already have pending NOC requests
    const studentIds = students.map(s => s._id);
    const pendingNOCs = await NOC.find({
      student: { $in: studentIds },
      status: { $in: ['Pending', 'Warden Verified'] }
    }).select('student');

    const pendingStudentIds = new Set(pendingNOCs.map(n => n.student.toString()));

    const availableStudents = students.filter(s => !pendingStudentIds.has(s._id.toString()));

    res.json({
      success: true,
      data: availableStudents
    });
  } catch (error) {
    console.error('❌ Error fetching students for NOC:', error);
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
      .populate('verifiedBy approvedBy rejectedBy raisedByWarden sentForCorrectionBy', 'username role')
      .populate('checklistResponses.checklistItemId')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: nocRequests
    });
  } catch (error) {
    next(error);
  }
};

// Warden: Get active checklist items for NOC verification
export const getWardenChecklistItems = async (req, res, next) => {
  try {
    const checklistItems = await NOCChecklistConfig.find({ isActive: true })
      .sort({ order: 1, createdAt: 1 });

    res.json({
      success: true,
      data: checklistItems
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
    const { remarks, checklistResponses } = req.body;
    const wardenId = req.user.id;

    const nocRequest = await NOC.findById(id);
    if (!nocRequest) {
      return next(createError(404, 'NOC request not found'));
    }

    // Allow verification for both Pending and Sent for Correction status
    if (nocRequest.status !== 'Pending' && nocRequest.status !== 'Sent for Correction') {
      return next(createError(400, 'Only pending or sent for correction NOC requests can be verified'));
    }

    // Validate and save checklist responses if provided
    if (checklistResponses && Array.isArray(checklistResponses)) {
      // Get all active checklist items
      const activeChecklistItems = await NOCChecklistConfig.find({ isActive: true }).sort({ order: 1 });
      
      // Validate that all required checklist items are provided
      const providedItemIds = checklistResponses.map(r => r.checklistItemId?.toString());
      const requiredItemIds = activeChecklistItems.map(item => item._id.toString());
      
      // Check if all required items are provided
      const missingItems = requiredItemIds.filter(id => !providedItemIds.includes(id));
      if (missingItems.length > 0) {
        return next(createError(400, `Missing checklist responses for required items`));
      }

      // Validate each response
      for (const response of checklistResponses) {
        const checklistItem = activeChecklistItems.find(item => item._id.toString() === response.checklistItemId?.toString());
        if (!checklistItem) {
          return next(createError(400, `Invalid checklist item ID: ${response.checklistItemId}`));
        }

        // Validate required fields - amount is required
        if (!response.amount || !response.amount.trim()) {
          return next(createError(400, `Amount is required for: ${checklistItem.description}`));
        }
      }

      // Save checklist responses
      nocRequest.checklistResponses = checklistResponses.map(response => ({
        checklistItemId: response.checklistItemId,
        amount: response.amount.trim(),
        remarks: response.remarks ? response.remarks.trim() : ''
      }));
    } else {
      // If no checklist responses provided, check if there are active checklist items
      const activeChecklistItems = await NOCChecklistConfig.find({ isActive: true });
      if (activeChecklistItems.length > 0) {
        return next(createError(400, 'Checklist responses are required'));
      }
    }

    // Update status to Warden Verified
    await nocRequest.updateStatus('Warden Verified', wardenId, remarks || '');
    await nocRequest.save();

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
      .populate('verifiedBy approvedBy rejectedBy sentForCorrectionBy', 'username role')
      .populate('checklistResponses.checklistItemId');

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
      .populate('verifiedBy approvedBy rejectedBy raisedByWarden sentForCorrectionBy', 'username role')
      .populate('checklistResponses.checklistItemId')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: nocRequests
    });
  } catch (error) {
    next(error);
  }
};

// Super Admin: Approve NOC request (now sets status to "Admin Approved - Pending Meter Reading")
export const approveNOCRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { adminRemarks } = req.body;
    const superAdminId = req.user.id;

    const nocRequest = await NOC.findById(id);
    if (!nocRequest) {
      return next(createError(404, 'NOC request not found'));
    }

    if (nocRequest.status !== 'Warden Verified') {
      return next(createError(400, 'Only warden verified NOC requests can be approved'));
    }

    // Update status to "Admin Approved - Pending Meter Reading" (not final approval yet)
    await nocRequest.updateStatus('Admin Approved - Pending Meter Reading', superAdminId, adminRemarks || '');

    // Create notification for warden to enter meter readings
    const warden = await Admin.findOne({ role: 'warden', hostelType: nocRequest.student?.gender === 'Male' ? 'boys' : 'girls' });
    if (warden) {
      await Notification.create({
        recipient: warden._id,
        recipientModel: 'Admin',
        title: 'Meter Reading Required for NOC',
        message: `NOC request for ${nocRequest.studentName} (${nocRequest.rollNumber}) has been approved. Please enter meter readings.`,
        type: 'system',
        priority: 'high'
      });
    }

    // Create notification for student
    await Notification.create({
      recipient: nocRequest.student,
      recipientModel: 'User',
      title: 'NOC Request Approved - Pending Meter Reading',
      message: 'Your NOC request has been approved by admin. Warden will enter meter readings and finalize the process.',
      type: 'system',
      priority: 'high'
    });

    // Populate the updated NOC
    const updatedNOC = await NOC.findById(id)
      .populate('student', 'name rollNumber course branch year academicYear')
      .populate('course branch', 'name')
      .populate('verifiedBy approvedBy rejectedBy sentForCorrectionBy', 'username role')
      .populate('checklistResponses.checklistItemId');

    res.json({
      success: true,
      message: 'NOC request approved. Warden needs to enter meter readings.',
      data: updatedNOC
    });
  } catch (error) {
    next(error);
  }
};

// Super Admin: Send NOC request for correction
export const sendForCorrection = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { adminRemarks } = req.body;
    const superAdminId = req.user.id;

    if (!adminRemarks || !adminRemarks.trim()) {
      return next(createError(400, 'Admin remarks are required when sending for correction'));
    }

    const nocRequest = await NOC.findById(id);
    if (!nocRequest) {
      return next(createError(404, 'NOC request not found'));
    }

    if (nocRequest.status !== 'Warden Verified') {
      return next(createError(400, 'Only warden verified NOC requests can be sent for correction'));
    }

    // Update status to Sent for Correction
    await nocRequest.updateStatus('Sent for Correction', superAdminId, adminRemarks.trim());

    // Create notification for warden
    const warden = await Admin.findById(nocRequest.verifiedBy);
    if (warden) {
      await Notification.create({
        recipient: warden._id,
        recipientModel: 'Admin',
        title: 'NOC Request Sent for Correction',
        message: `NOC request from ${nocRequest.studentName} (${nocRequest.rollNumber}) has been sent back for corrections. Please review the admin remarks.`,
        type: 'system',
        priority: 'high'
      });
    }

    // Create notification for student
    await Notification.create({
      recipient: nocRequest.student,
      recipientModel: 'User',
      title: 'NOC Request Requires Corrections',
      message: `Your NOC request has been sent back for corrections. Please contact the warden for details.`,
      type: 'system',
      priority: 'high'
    });

    // Populate the updated NOC
    const updatedNOC = await NOC.findById(id)
      .populate('student', 'name rollNumber course branch year academicYear')
      .populate('course branch', 'name')
      .populate('verifiedBy approvedBy rejectedBy sentForCorrectionBy', 'username role')
      .populate('checklistResponses.checklistItemId');

    res.json({
      success: true,
      message: 'NOC request sent for correction successfully',
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

    if (nocRequest.status !== 'Warden Verified' && nocRequest.status !== 'Sent for Correction') {
      return next(createError(400, 'Only warden verified or sent for correction NOC requests can be rejected'));
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
      .populate('verifiedBy approvedBy rejectedBy sentForCorrectionBy', 'username role')
      .populate('checklistResponses.checklistItemId');

    res.json({
      success: true,
      message: 'NOC request rejected successfully',
      data: updatedNOC
    });
  } catch (error) {
    next(error);
  }
};

// Warden: Enter meter readings and calculate electricity bill
export const enterMeterReadings = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { 
      meterType, 
      startUnits, 
      endUnits, 
      meter1StartUnits, 
      meter1EndUnits, 
      meter2StartUnits, 
      meter2EndUnits,
      rate 
    } = req.body;
    const wardenId = req.user.id;

    const nocRequest = await NOC.findById(id)
      .populate('student', 'name rollNumber course branch year academicYear roomNumber');
    
    if (!nocRequest) {
      return next(createError(404, 'NOC request not found'));
    }

    if (nocRequest.status !== 'Admin Approved - Pending Meter Reading') {
      return next(createError(400, 'Meter readings can only be entered for admin-approved NOC requests'));
    }

    // Get student's room
    const student = await User.findById(nocRequest.student._id || nocRequest.student);
    if (!student || !student.roomNumber) {
      return next(createError(400, 'Student does not have a room assigned'));
    }

    const room = await Room.findOne({ roomNumber: student.roomNumber, gender: student.gender });
    if (!room) {
      return next(createError(404, 'Room not found'));
    }

    // Validate meter readings based on meter type
    if (meterType === 'dual') {
      if (!meter1StartUnits || !meter1EndUnits || !meter2StartUnits || !meter2EndUnits) {
        return next(createError(400, 'All dual meter readings are required'));
      }
      if (meter1EndUnits < meter1StartUnits || meter2EndUnits < meter2StartUnits) {
        return next(createError(400, 'End units must be greater than or equal to start units'));
      }
    } else {
      if (!startUnits || !endUnits) {
        return next(createError(400, 'Start and end units are required'));
      }
      if (endUnits < startUnits) {
        return next(createError(400, 'End units must be greater than or equal to start units'));
      }
    }

    // Get default rate if not provided
    let electricityRate = rate;
    if (!electricityRate) {
      try {
        const defaultRateResponse = await Room.findOne().select('defaultElectricityRate');
        electricityRate = defaultRateResponse?.defaultElectricityRate || 5; // Default to 5 if not set
      } catch (err) {
        electricityRate = 5; // Fallback default
      }
    }

    // Calculate consumption
    let consumption = 0;
    if (meterType === 'dual') {
      const meter1Consumption = meter1EndUnits - meter1StartUnits;
      const meter2Consumption = meter2EndUnits - meter2StartUnits;
      consumption = meter1Consumption + meter2Consumption;
    } else {
      consumption = endUnits - startUnits;
    }

    // Get last bill to determine bill period start
    let billPeriodStart = new Date();
    if (room.electricityBills && room.electricityBills.length > 0) {
      const sortedBills = [...room.electricityBills].sort((a, b) => b.month.localeCompare(a.month));
      const lastBill = sortedBills[0];
      // Bill period starts from the month after last bill
      const lastBillDate = new Date(lastBill.month + '-01');
      lastBillDate.setMonth(lastBillDate.getMonth() + 1);
      billPeriodStart = lastBillDate;
    } else {
      // If no previous bill, start from beginning of current month
      billPeriodStart = new Date();
      billPeriodStart.setDate(1);
      billPeriodStart.setHours(0, 0, 0, 0);
    }

    // Bill period ends at vacating date
    const billPeriodEnd = new Date(nocRequest.vacatingDate);
    billPeriodEnd.setHours(23, 59, 59, 999);

    // Calculate number of days in the period
    const daysInPeriod = Math.ceil((billPeriodEnd - billPeriodStart) / (1000 * 60 * 60 * 24));
    const daysInMonth = new Date(billPeriodEnd.getFullYear(), billPeriodEnd.getMonth() + 1, 0).getDate();
    
    // Calculate proportional consumption (only for the days until vacating date)
    // Assuming consumption is for full month, calculate proportional amount
    const proportionalConsumption = Math.round((consumption * daysInPeriod) / daysInMonth);
    const total = proportionalConsumption * electricityRate;

    // Update NOC with meter readings and calculated bill
    nocRequest.meterReadings = {
      meterType,
      startUnits: meterType === 'single' ? startUnits : null,
      endUnits: meterType === 'single' ? endUnits : null,
      meter1StartUnits: meterType === 'dual' ? meter1StartUnits : null,
      meter1EndUnits: meterType === 'dual' ? meter1EndUnits : null,
      meter2StartUnits: meterType === 'dual' ? meter2StartUnits : null,
      meter2EndUnits: meterType === 'dual' ? meter2EndUnits : null,
      readingDate: new Date(),
      enteredBy: wardenId,
      enteredAt: new Date()
    };

    nocRequest.calculatedElectricityBill = {
      consumption: proportionalConsumption,
      rate: electricityRate,
      total: total,
      calculatedAt: new Date(),
      billPeriodStart: billPeriodStart,
      billPeriodEnd: billPeriodEnd
    };

    // Update status to "Ready for Deactivation"
    await nocRequest.updateStatus('Ready for Deactivation', wardenId, '');

    await nocRequest.save();

    // Create notification for admin
    await Notification.create({
      recipient: nocRequest.approvedBy,
      recipientModel: 'Admin',
      title: 'NOC Ready for Final Approval',
      message: `Meter readings entered for ${nocRequest.studentName} (${nocRequest.rollNumber}). NOC is ready for final approval and student deactivation.`,
      type: 'system',
      priority: 'high'
    });

    // Create notification for student
    await Notification.create({
      recipient: nocRequest.student._id || nocRequest.student,
      recipientModel: 'User',
      title: 'Meter Readings Entered',
      message: `Meter readings have been entered. Your electricity bill until vacating date has been calculated. Final approval pending.`,
      type: 'system',
      priority: 'high'
    });

    // Populate the updated NOC
    const updatedNOC = await NOC.findById(id)
      .populate('student', 'name rollNumber course branch year academicYear roomNumber')
      .populate('course branch', 'name')
      .populate('verifiedBy approvedBy rejectedBy sentForCorrectionBy enteredBy', 'username role')
      .populate('checklistResponses.checklistItemId');

    res.json({
      success: true,
      message: 'Meter readings entered and electricity bill calculated successfully',
      data: updatedNOC
    });
  } catch (error) {
    console.error('❌ Error entering meter readings:', error);
    next(error);
  }
};

// Super Admin: Final approve and deactivate student (after meter readings)
export const finalApproveNOC = async (req, res, next) => {
  try {
    const { id } = req.params;
    const superAdminId = req.user.id;

    const nocRequest = await NOC.findById(id);
    if (!nocRequest) {
      return next(createError(404, 'NOC request not found'));
    }

    if (nocRequest.status !== 'Ready for Deactivation') {
      return next(createError(400, 'NOC must be ready for deactivation (meter readings entered) before final approval'));
    }

    // Update status to Approved
    await nocRequest.updateStatus('Approved', superAdminId, '');

    // Deactivate student and vacate room allocation
    console.log(`🏠 Deactivating student ${nocRequest.studentName} (${nocRequest.rollNumber}) and vacating room allocation...`);
    await nocRequest.deactivateStudent();
    console.log(`✅ Student deactivated and room vacated successfully`);

    // Create notification for student
    await Notification.create({
      recipient: nocRequest.student,
      recipientModel: 'User',
      title: 'NOC Request Finalized',
      message: 'Your NOC request has been finalized. Your account has been deactivated.',
      type: 'system',
      priority: 'high'
    });

    // Populate the updated NOC
    const updatedNOC = await NOC.findById(id)
      .populate('student', 'name rollNumber course branch year academicYear')
      .populate('course branch', 'name')
      .populate('verifiedBy approvedBy rejectedBy sentForCorrectionBy', 'username role')
      .populate('checklistResponses.checklistItemId');

    res.json({
      success: true,
      message: 'NOC request finalized and student deactivated successfully',
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
