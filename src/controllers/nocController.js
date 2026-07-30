import mongoose from 'mongoose';
import NOC, { NOCSettings } from '../models/NOC.js';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import Room from '../models/Room.js';
import NOCChecklistConfig from '../models/NOCChecklistConfig.js';
import { createError } from '../utils/error.js';
import Notification from '../models/Notification.js';
import { enrichStudentAcademics, enrichStudentsAcademics } from '../utils/studentAcademicEnricher.js';
import { getCourseById, getBranchById } from '../utils/courseBranchHelper.js';
import { connectFeesDatabase, getFeesConnection, isFeesDbConfigured } from '../config/feesDatabase.js';
import { getStudentFeeModel } from '../models/fees/StudentFee.js';
import { toFeesAcademicYear, resolveFeesStudentId } from '../services/feesSyncService.js';

// Helper to create a breakage fee demand in the student fees records
const createBreakageFeeDemand = async (student, amount, remarks, academicYear, feeHeadId, feeHeadName) => {
  try {
    const isConfigured = isFeesDbConfigured();
    if (!isConfigured) {
      console.warn('⚠️ Fees database is not configured. Skipping demand creation.');
      return;
    }

    if (!feeHeadId) {
      console.warn('⚠️ No breakage fee head configured. Skipping demand creation.');
      return;
    }

    // Connect to external DB
    await connectFeesDatabase();
    const conn = getFeesConnection();
    if (!conn) {
      console.warn('⚠️ Fees database connection not available. Skipping demand creation.');
      return;
    }

    const StudentFee = getStudentFeeModel();
    const enriched = await enrichStudentAcademics(student.toObject ? student.toObject() : student);
    const studentId = resolveFeesStudentId(student, enriched);
    const feesAcademicYear = toFeesAcademicYear(academicYear || student.academicYear);

    if (!studentId || !feesAcademicYear) {
      console.warn('⚠️ Missing student ID or academic year. Skipping demand creation.');
      return;
    }

    const payload = {
      academicYear: feesAcademicYear,
      feeHead: new mongoose.Types.ObjectId(feeHeadId),
      structureId: null,
      semester: null,
      termNumber: null,
      studentId: studentId,
      studentYear: Number(enriched.year || student.year || 1),
      amount: Number(amount),
      branch: String(enriched.branchId || enriched.branch || student.branch || '').trim(),
      college: student.college?.name || student.college || '',
      course: String(enriched.courseId || enriched.course || student.course || '').trim(),
      isActive: true,
      remarks: remarks || `NOC Breakage Fee (${feeHeadName || 'General'})`,
      studentName: student.name
    };

    // Use updateOne with upsert to avoid duplicate index errors
    await StudentFee.findOneAndUpdate(
      {
        studentId: studentId,
        feeHead: payload.feeHead,
        academicYear: feesAcademicYear
      },
      {
        $set: payload,
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true, new: true }
    );
    console.log(`✅ Breakage fee demand of ₹${amount} created successfully for student ${student.name} (${studentId})`);
  } catch (error) {
    console.error('❌ Error creating breakage fee demand:', error);
  }
};

// Helper to resolve Course and Branch string IDs for a student
const resolveStudentCourseAndBranch = async (student) => {
  const enriched = await enrichStudentAcademics(student);
  let courseId = enriched.courseId;
  let branchId = enriched.branchId;

  // Fallback to student's database string fields if not set on enriched
  if (!courseId && student.course) {
    courseId = student.course;
  }
  if (!branchId && student.branch) {
    branchId = student.branch;
  }

  return { courseId, branchId };
};

// Helper to manually populate SQL course and branch details for response JSON
const populateSQLAcademics = async (nocRequests) => {
  if (!nocRequests) return nocRequests;
  const isArray = Array.isArray(nocRequests);
  const list = isArray ? nocRequests : [nocRequests];

  const populated = await Promise.all(list.map(async (r) => {
    const doc = typeof r.toObject === 'function' ? r.toObject() : r;
    if (doc.course) {
      const courseData = await getCourseById(doc.course);
      doc.course = courseData ? { _id: doc.course, name: courseData.name } : { _id: doc.course, name: doc.course };
    }
    if (doc.branch) {
      const branchData = await getBranchById(doc.branch);
      doc.branch = branchData ? { _id: doc.branch, name: branchData.name } : { _id: doc.branch, name: doc.branch };
    }
    if (doc.student) {
      if (doc.student.course && typeof doc.student.course === 'string') {
        const studentCourseData = await getCourseById(doc.student.course);
        doc.student.course = studentCourseData ? { _id: doc.student.course, name: studentCourseData.name } : { _id: doc.student.course, name: doc.student.course };
      }
      if (doc.student.branch && typeof doc.student.branch === 'string') {
        const studentBranchData = await getBranchById(doc.student.branch);
        doc.student.branch = studentBranchData ? { _id: doc.student.branch, name: studentBranchData.name } : { _id: doc.student.branch, name: doc.student.branch };
      }
    }
    return doc;
  }));

  return isArray ? populated : populated[0];
};

// Student: Create NOC request (Disabled - Wardens only)
export const createNOCRequest = async (req, res, next) => {
  return next(createError(400, 'Students are not allowed to submit NOC requests directly. Please contact the warden.'));
};

// Student: Get their NOC requests
export const getStudentNOCRequests = async (req, res, next) => {
  try {
    const studentId = req.user.id;

    const tempRequests = await NOC.find({ student: studentId })
      .populate('verifiedBy approvedBy rejectedBy raisedByWarden', 'username role')
      .sort({ createdAt: -1 });
    const nocRequests = await populateSQLAcademics(tempRequests);

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

    const tempRequest = await NOC.findOne({ _id: id, student: studentId })
      .populate('student', 'name rollNumber course branch year academicYear')
      .populate('verifiedBy approvedBy rejectedBy raisedByWarden', 'username role');

    if (!tempRequest) {
      return next(createError(404, 'NOC request not found'));
    }

    const nocRequest = await populateSQLAcademics(tempRequest);

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

// Admin: Delete NOC request (and automatically revert deactivation if approved via schema pre hook)
export const deleteNOCByAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const nocRequest = await NOC.findById(id);

    if (!nocRequest) {
      return next(createError(404, 'NOC request not found'));
    }

    await NOC.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'NOC request deleted and student reactivation completed successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Warden: Create NOC request on behalf of student
export const createNOCForStudent = async (req, res, next) => {
  try {
    const { studentId, reason, vacatingDate, breakageFee, breakageRemarks, meterReadings } = req.body;
    const wardenId = req.warden._id;

    console.log('📝 Warden creating NOC for student:', { studentId, reason, vacatingDate, wardenId, breakageFee });

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

    // Validate reason length
    if (reason.trim().length < 10) {
      return next(createError(400, 'Reason must be at least 10 characters long'));
    }

    if (reason.trim().length > 500) {
      return next(createError(400, 'Reason cannot exceed 500 characters'));
    }

    // Get student details
    const student = await User.findById(studentId);
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
    if (student.applicationStatus === 'Expired') {
      return next(createError(400, 'Student account is already deactivated'));
    }

    // Resolve course & branch string IDs
    const { courseId, branchId } = await resolveStudentCourseAndBranch(student);
    if (!courseId || !branchId) {
      return next(createError(400, 'Student course and branch details could not be resolved'));
    }

    // Fetch configured breakage fee head
    let breakageFeeHeadId = null;
    let breakageFeeHeadName = null;
    try {
      const settings = await NOCSettings.findOne();
      if (settings) {
        breakageFeeHeadId = settings.breakageFeeHeadId;
        breakageFeeHeadName = settings.breakageFeeHeadName;
      }
    } catch (settingsErr) {
      console.error('Failed to fetch NOC settings:', settingsErr);
    }

    // Create NOC request
    const nocRequest = new NOC({
      student: studentId,
      studentName: student.name,
      rollNumber: student.rollNumber,
      course: courseId,
      branch: branchId,
      year: student.year,
      academicYear: student.academicYear,
      reason: reason.trim(),
      vacatingDate: vacatingDateObj,
      raisedBy: 'warden',
      raisedByWarden: wardenId,
      status: 'Approved', // Warden creation is final
      verifiedBy: wardenId,
      verifiedAt: new Date(),
      approvedBy: wardenId,
      approvedAt: new Date(),
      breakageFee: Number(breakageFee) || 0,
      breakageRemarks: breakageRemarks || '',
      breakageFeeHeadId,
      breakageFeeHeadName,
      meterReadings: meterReadings || { meterType: 'single' }
    });

    await nocRequest.save();

    // Create notification for student about the NOC request
    await Notification.create({
      recipient: studentId,
      recipientModel: 'User',
      title: 'NOC Request Approved',
      message: `Your NOC request has been approved by the warden. Your hostel profile will be deactivated on your vacating date (${new Date(nocRequest.vacatingDate).toLocaleDateString('en-IN')}) for this academic year.`,
      type: 'system',
      priority: 'high'
    });

    // Generate fee demand if breakage fee is set
    if (Number(breakageFee) > 0) {
      await createBreakageFeeDemand(
        student,
        breakageFee,
        breakageRemarks,
        student.academicYear,
        breakageFeeHeadId,
        breakageFeeHeadName
      );
    }

    // Populate the created NOC
    const tempNOC = await NOC.findById(nocRequest._id)
      .populate('student', 'name rollNumber course branch year academicYear')
      .populate('raisedByWarden', 'username role');
    const populatedNOC = await populateSQLAcademics(tempNOC);

    console.log('📝 NOC request created by warden successfully:', nocRequest._id);

    res.status(201).json({
      success: true,
      message: 'NOC request created and approved successfully on behalf of student',
      data: populatedNOC
    });
  } catch (error) {
    console.error('❌ Error creating NOC for student:', error);
    next(error);
  }
};

// Admin: Create NOC request on behalf of student for their academic year
export const createNOCByAdmin = async (req, res, next) => {
  try {
    const { studentId, reason, vacatingDate, breakageFee, breakageRemarks, meterReadings } = req.body;
    const adminId = req.user.id;

    console.log('📝 Admin creating NOC for student:', { studentId, reason, vacatingDate, adminId, breakageFee });

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

    if (reason.trim().length < 10) {
      return next(createError(400, 'Reason must be at least 10 characters long'));
    }

    if (reason.trim().length > 500) {
      return next(createError(400, 'Reason cannot exceed 500 characters'));
    }

    // Get student details
    const student = await User.findById(studentId);
    if (!student) {
      return next(createError(404, 'Student not found'));
    }

    // Check if student already has a pending NOC request
    const existingNOC = await NOC.findOne({
      student: studentId,
      status: 'Pending'
    });

    if (existingNOC) {
      return next(createError(400, 'Student already has a pending NOC request'));
    }

    // Check if student is already deactivated
    if (student.applicationStatus === 'Expired') {
      return next(createError(400, 'Student account is already deactivated'));
    }

    // Resolve course & branch string IDs
    const { courseId, branchId } = await resolveStudentCourseAndBranch(student);
    if (!courseId || !branchId) {
      return next(createError(400, 'Student course and branch details could not be resolved'));
    }

    // Fetch configured breakage fee head
    let breakageFeeHeadId = null;
    let breakageFeeHeadName = null;
    try {
      const settings = await NOCSettings.findOne();
      if (settings) {
        breakageFeeHeadId = settings.breakageFeeHeadId;
        breakageFeeHeadName = settings.breakageFeeHeadName;
      }
    } catch (settingsErr) {
      console.error('Failed to fetch NOC settings:', settingsErr);
    }

    // Create NOC request for that student's academic year only
    const nocRequest = new NOC({
      student: studentId,
      studentName: student.name,
      rollNumber: student.rollNumber,
      course: courseId,
      branch: branchId,
      year: student.year,
      academicYear: student.academicYear, // Current active academic year only
      reason: reason.trim(),
      vacatingDate: vacatingDateObj,
      raisedBy: 'admin',
      status: 'Approved', // Admin creation is final
      approvedBy: adminId,
      approvedAt: new Date(),
      breakageFee: Number(breakageFee) || 0,
      breakageRemarks: breakageRemarks || '',
      breakageFeeHeadId,
      breakageFeeHeadName,
      meterReadings: meterReadings || { meterType: 'single' }
    });

    await nocRequest.save();

    // Create notification for student about the NOC request
    await Notification.create({
      recipient: studentId,
      recipientModel: 'User',
      title: 'NOC Request Created by Admin',
      message: `A NOC request has been created and approved on your behalf by the admin for academic year ${student.academicYear}. Reason: ${reason.substring(0, 100)}${reason.length > 100 ? '...' : ''}`,
      type: 'system',
      priority: 'high'
    });

    // Generate fee demand if breakage fee is set
    if (Number(breakageFee) > 0) {
      await createBreakageFeeDemand(
        student,
        breakageFee,
        breakageRemarks,
        student.academicYear,
        breakageFeeHeadId,
        breakageFeeHeadName
      );
    }

    // Populate the created NOC
    const tempNOC = await NOC.findById(nocRequest._id)
      .populate('student', 'name rollNumber course branch year academicYear');
    const populatedNOC = await populateSQLAcademics(tempNOC);

    console.log('📝 NOC request created by admin successfully:', nocRequest._id);

    res.status(201).json({
      success: true,
      message: 'NOC request created and approved successfully by admin',
      data: populatedNOC
    });
  } catch (error) {
    console.error('❌ Error creating NOC by admin:', error);
    next(error);
  }
};

// Warden & Admin: Get students for NOC request creation
export const getStudentsForNOC = async (req, res, next) => {
  try {
    const { search, course, year, academicYear } = req.query;
    const wardenHostelType = req.warden ? req.warden.hostelType : null;

    // Build query - only active students
    let query = { 
      applicationStatus: { $in: ['Active', 'Extended'] },
      role: 'student'
    };

    // Filter by hostel type (boys/girls) if warden is logged in
    if (wardenHostelType) {
      query.gender = wardenHostelType === 'boys' ? 'Male' : 'Female';
    }

    // Add academic year filter
    if (academicYear) {
      query.academicYear = academicYear;
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
      .select('name rollNumber course branch year academicYear gender room roomNumber')
      .populate('room', 'meterType')
      .populate('course', 'name')
      .populate('branch', 'name')
      .sort({ name: 1 })
      .limit(50);

    // Skip heavy external SQL database calls during creation searches
    const enrichedStudents = await enrichStudentsAcademics(
      students.map(s => s.toObject()),
      { skipFeesAndConcessions: true, skipEnrichment: true }
    );
    const availableStudentsFormatted = enrichedStudents.map(student => ({
      ...student,
      course: { 
        _id: student.course?._id || student.courseId || student.course || '', 
        name: student.course?.name || student.course || '' 
      },
      branch: { 
        _id: student.branch?._id || student.branchId || student.branch || '', 
        name: student.branch?.name || student.branch || '' 
      }
    }));

    // Filter out students who already have pending NOC requests
    const studentIds = availableStudentsFormatted.map(s => s._id);
    const pendingNOCs = await NOC.find({
      student: { $in: studentIds },
      status: 'Pending'
    }).select('student');

    const pendingStudentIds = new Set(pendingNOCs.map(n => n.student.toString()));

    const availableStudents = availableStudentsFormatted.filter(s => !pendingStudentIds.has(s._id.toString()));

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

    const tempRequests = await NOC.find(query)
      .populate({
        path: 'student',
        select: 'name rollNumber course branch year academicYear room',
        populate: { path: 'room', select: 'meterType' }
      })
      .populate('verifiedBy approvedBy rejectedBy raisedByWarden', 'username role')
      .sort({ createdAt: -1 });
    const nocRequests = await populateSQLAcademics(tempRequests);

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

// Warden: Verify and directly approve NOC request
export const wardenVerifyNOC = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { remarks, breakageFee, breakageRemarks, meterReadings } = req.body;
    const wardenId = req.user.id;

    const nocRequest = await NOC.findById(id);
    if (!nocRequest) {
      return next(createError(404, 'NOC request not found'));
    }

    if (nocRequest.status !== 'Pending') {
      return next(createError(400, 'Only pending NOC requests can be approved'));
    }

    // Fetch configured breakage fee head
    let breakageFeeHeadId = null;
    let breakageFeeHeadName = null;
    try {
      const settings = await NOCSettings.findOne();
      if (settings) {
        breakageFeeHeadId = settings.breakageFeeHeadId;
        breakageFeeHeadName = settings.breakageFeeHeadName;
      }
    } catch (settingsErr) {
      console.error('Failed to fetch NOC settings:', settingsErr);
    }

    nocRequest.status = 'Approved';
    nocRequest.verifiedBy = wardenId;
    nocRequest.verifiedAt = new Date();
    nocRequest.approvedBy = wardenId;
    nocRequest.approvedAt = new Date();
    nocRequest.wardenRemarks = remarks || '';
    nocRequest.breakageFee = Number(breakageFee) || 0;
    nocRequest.breakageRemarks = breakageRemarks || '';
    nocRequest.breakageFeeHeadId = breakageFeeHeadId;
    nocRequest.breakageFeeHeadName = breakageFeeHeadName;
    if (meterReadings) {
      nocRequest.meterReadings = meterReadings;
    }

    await nocRequest.save();

    // Create notification for student
    await Notification.create({
      recipient: nocRequest.student,
      recipientModel: 'User',
      title: 'NOC Request Approved',
      message: `Your NOC request has been approved by the warden. Your hostel profile will be deactivated on your vacating date (${new Date(nocRequest.vacatingDate).toLocaleDateString('en-IN')}) for this academic year.`,
      type: 'system',
      priority: 'high'
    });

    // Generate fee demand if breakage fee is set
    if (Number(breakageFee) > 0) {
      const student = await User.findById(nocRequest.student);
      if (student) {
        await createBreakageFeeDemand(
          student,
          breakageFee,
          breakageRemarks,
          student.academicYear,
          breakageFeeHeadId,
          breakageFeeHeadName
        );
      }
    }

    // Populate the updated NOC
    const tempNOC = await NOC.findById(id)
      .populate('student', 'name rollNumber course branch year academicYear')
      .populate('verifiedBy approvedBy rejectedBy', 'username role');
    const populatedNOC = await populateSQLAcademics(tempNOC);

    res.json({
      success: true,
      message: 'NOC request approved successfully (deactivation scheduled on vacating date)',
      data: populatedNOC
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
    await nocRequest.updateStatus('Rejected', wardenId, rejectionReason || '');

    // Create notification for student
    await Notification.create({
      recipient: nocRequest.student,
      recipientModel: 'User',
      title: 'NOC Request Rejected',
      message: `Your NOC request has been rejected by warden. Reason: ${rejectionReason}`,
      type: 'system',
      priority: 'high'
    });

    const tempNOC = await NOC.findById(id)
      .populate('student', 'name rollNumber course branch year academicYear')
      .populate('verifiedBy approvedBy rejectedBy', 'username role');
    const populatedNOC = await populateSQLAcademics(tempNOC);

    res.json({
      success: true,
      message: 'NOC request rejected successfully',
      data: populatedNOC
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

    const tempRequests = await NOC.find(query)
      .populate({
        path: 'student',
        select: 'name rollNumber course branch year academicYear room',
        populate: { path: 'room', select: 'meterType' }
      })
      .populate('verifiedBy approvedBy rejectedBy raisedByWarden', 'username role')
      .sort({ createdAt: -1 });
    const nocRequests = await populateSQLAcademics(tempRequests);

    res.json({
      success: true,
      data: nocRequests
    });
  } catch (error) {
    next(error);
  }
};

// Super Admin: Approve NOC request directly
export const approveNOCRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { adminRemarks, breakageFee, breakageRemarks, meterReadings } = req.body;
    const superAdminId = req.user.id;

    const nocRequest = await NOC.findById(id);
    if (!nocRequest) {
      return next(createError(404, 'NOC request not found'));
    }

    if (nocRequest.status !== 'Pending') {
      return next(createError(400, 'Only pending NOC requests can be approved'));
    }

    // Fetch configured breakage fee head
    let breakageFeeHeadId = null;
    let breakageFeeHeadName = null;
    try {
      const settings = await NOCSettings.findOne();
      if (settings) {
        breakageFeeHeadId = settings.breakageFeeHeadId;
        breakageFeeHeadName = settings.breakageFeeHeadName;
      }
    } catch (settingsErr) {
      console.error('Failed to fetch NOC settings:', settingsErr);
    }

    nocRequest.status = 'Approved';
    nocRequest.approvedBy = superAdminId;
    nocRequest.approvedAt = new Date();
    nocRequest.adminRemarks = adminRemarks || '';
    nocRequest.breakageFee = Number(breakageFee) || 0;
    nocRequest.breakageRemarks = breakageRemarks || '';
    nocRequest.breakageFeeHeadId = breakageFeeHeadId;
    nocRequest.breakageFeeHeadName = breakageFeeHeadName;
    if (meterReadings) {
      nocRequest.meterReadings = meterReadings;
    }

    await nocRequest.save();

    // Create notification for student
    await Notification.create({
      recipient: nocRequest.student,
      recipientModel: 'User',
      title: 'NOC Request Approved',
      message: `Your NOC request has been approved by admin. Your hostel profile will be deactivated on your vacating date (${new Date(nocRequest.vacatingDate).toLocaleDateString('en-IN')}) for this academic year.`,
      type: 'system',
      priority: 'high'
    });

    // Generate fee demand if breakage fee is set
    if (Number(breakageFee) > 0) {
      const student = await User.findById(nocRequest.student);
      if (student) {
        await createBreakageFeeDemand(
          student,
          breakageFee,
          breakageRemarks,
          student.academicYear,
          breakageFeeHeadId,
          breakageFeeHeadName
        );
      }
    }

    // Populate the updated NOC
    const tempNOC = await NOC.findById(id)
      .populate('student', 'name rollNumber course branch year academicYear')
      .populate('verifiedBy approvedBy rejectedBy', 'username role');
    const populatedNOC = await populateSQLAcademics(tempNOC);

    res.json({
      success: true,
      message: 'NOC request approved successfully by admin (deactivation scheduled on vacating date)',
      data: populatedNOC
    });
  } catch (error) {
    console.error('❌ Error in approveNOCRequest:', error);
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

    if (nocRequest.status !== 'Pending') {
      return next(createError(400, 'Only pending NOC requests can be rejected'));
    }

    // Update status to Rejected
    await nocRequest.updateStatus('Rejected', superAdminId, rejectionReason || '');

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
    const tempNOC = await NOC.findById(id)
      .populate('student', 'name rollNumber course branch year academicYear')
      .populate('verifiedBy approvedBy rejectedBy', 'username role');
    const populatedNOC = await populateSQLAcademics(tempNOC);

    res.json({
      success: true,
      message: 'NOC request rejected successfully',
      data: populatedNOC
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

// Admin: Get list of fee heads from the external database
export const getNOCFeeHeads = async (req, res, next) => {
  try {
    const isConfigured = isFeesDbConfigured();
    if (!isConfigured) {
      return res.json({
        success: true,
        data: []
      });
    }

    await connectFeesDatabase();
    const conn = getFeesConnection();
    if (!conn) {
      return next(createError(500, 'External Fees database connection failed'));
    }

    const db = conn.db;
    const feeHeads = await db.collection('feeheads').find({}).toArray();

    // Map _id to id for consistency
    const formattedFeeHeads = feeHeads.map(fh => ({
      id: fh._id.toString(),
      _id: fh._id.toString(),
      name: fh.name,
      code: fh.code
    }));

    res.json({
      success: true,
      data: formattedFeeHeads
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Get NOC settings (the breakage fee head configured)
export const getNOCSettings = async (req, res, next) => {
  try {
    let settings = await NOCSettings.findOne();
    if (!settings) {
      settings = await NOCSettings.create({
        breakageFeeHeadId: '',
        breakageFeeHeadName: ''
      });
    }

    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Save/Update NOC settings
export const updateNOCSettings = async (req, res, next) => {
  try {
    const { breakageFeeHeadId, breakageFeeHeadName } = req.body;

    let settings = await NOCSettings.findOne();
    if (!settings) {
      settings = new NOCSettings({
        breakageFeeHeadId: breakageFeeHeadId || '',
        breakageFeeHeadName: breakageFeeHeadName || ''
      });
    } else {
      settings.breakageFeeHeadId = breakageFeeHeadId || '';
      settings.breakageFeeHeadName = breakageFeeHeadName || '';
    }

    await settings.save();

    res.json({
      success: true,
      message: 'NOC settings updated successfully',
      data: settings
    });
  } catch (error) {
    next(error);
  }
};
