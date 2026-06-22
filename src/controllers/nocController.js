import NOC from '../models/NOC.js';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import Room from '../models/Room.js';
import NOCChecklistConfig from '../models/NOCChecklistConfig.js';
import { createError } from '../utils/error.js';
import Notification from '../models/Notification.js';
import { enrichStudentAcademics, enrichStudentsAcademics } from '../utils/studentAcademicEnricher.js';
import { getCourseById, getBranchById } from '../utils/courseBranchHelper.js';

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
      return next(createError(400, 'You already have a pending NOC request'));
    }

    // Check if student is already deactivated
    if (student.hostelStatus === 'Inactive') {
      return next(createError(400, 'Your account is already deactivated'));
    }

    // Resolve course & branch string IDs
    const { courseId, branchId } = await resolveStudentCourseAndBranch(student);
    if (!courseId || !branchId) {
      return next(createError(400, 'Student course and branch details could not be resolved'));
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
      vacatingDate: vacatingDateObj
    });

    await nocRequest.save();

    // Populate the created NOC
    const tempNOC = await NOC.findById(nocRequest._id)
      .populate('student', 'name rollNumber course branch year academicYear');
    const populatedNOC = await populateSQLAcademics(tempNOC);

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
    if (student.hostelStatus === 'Inactive') {
      return next(createError(400, 'Student account is already deactivated'));
    }

    // Resolve course & branch string IDs
    const { courseId, branchId } = await resolveStudentCourseAndBranch(student);
    if (!courseId || !branchId) {
      return next(createError(400, 'Student course and branch details could not be resolved'));
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
    const tempNOC = await NOC.findById(nocRequest._id)
      .populate('student', 'name rollNumber course branch year academicYear')
      .populate('raisedByWarden', 'username role');
    const populatedNOC = await populateSQLAcademics(tempNOC);

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

// Admin: Create NOC request on behalf of student for their academic year
export const createNOCByAdmin = async (req, res, next) => {
  try {
    const { studentId, reason, vacatingDate } = req.body;
    const adminId = req.user.id;

    console.log('📝 Admin creating NOC for student:', { studentId, reason, vacatingDate, adminId });

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

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (vacatingDateObj < today) {
      return next(createError(400, 'Vacating date cannot be in the past'));
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
    if (student.hostelStatus === 'Inactive') {
      return next(createError(400, 'Student account is already deactivated'));
    }

    // Resolve course & branch string IDs
    const { courseId, branchId } = await resolveStudentCourseAndBranch(student);
    if (!courseId || !branchId) {
      return next(createError(400, 'Student course and branch details could not be resolved'));
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
      approvedBy: null
    });

    await nocRequest.save();

    // Create notification for student about the NOC request
    await Notification.create({
      recipient: studentId,
      recipientModel: 'User',
      title: 'NOC Request Created by Admin',
      message: `A NOC request has been created on your behalf by the admin for academic year ${student.academicYear}. Reason: ${reason.substring(0, 100)}${reason.length > 100 ? '...' : ''}`,
      type: 'system',
      priority: 'high'
    });

    // Populate the created NOC
    const tempNOC = await NOC.findById(nocRequest._id)
      .populate('student', 'name rollNumber course branch year academicYear');
    const populatedNOC = await populateSQLAcademics(tempNOC);

    console.log('📝 NOC request created by admin successfully:', nocRequest._id);

    res.status(201).json({
      success: true,
      message: 'NOC request created successfully by admin',
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
    const { search, course, year } = req.query;
    const wardenHostelType = req.warden ? req.warden.hostelType : null;

    // Build query - only active students
    let query = { 
      hostelStatus: 'Active',
      role: 'student'
    };

    // Filter by hostel type (boys/girls) if warden is logged in
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
      .sort({ name: 1 })
      .limit(50);

    // Enrich with SQL academic details
    const enrichedStudents = await enrichStudentsAcademics(students.map(s => s.toObject()));
    const availableStudentsFormatted = enrichedStudents.map(student => ({
      ...student,
      course: { _id: student.courseId || student.course, name: student.course || '' },
      branch: { _id: student.branchId || student.branch, name: student.branch || '' }
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
      .populate('student', 'name rollNumber course branch year academicYear')
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
    const { remarks } = req.body;
    const wardenId = req.user.id;

    const nocRequest = await NOC.findById(id);
    if (!nocRequest) {
      return next(createError(404, 'NOC request not found'));
    }

    if (nocRequest.status !== 'Pending') {
      return next(createError(400, 'Only pending NOC requests can be approved'));
    }

    // Update status to Approved directly
    await nocRequest.updateStatus('Approved', wardenId, remarks || '');
    await nocRequest.deactivateStudent();

    // Create notification for student
    await Notification.create({
      recipient: nocRequest.student,
      recipientModel: 'User',
      title: 'NOC Request Approved',
      message: 'Your NOC request has been approved by the warden and your hostel profile has been deactivated for this academic year.',
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
      message: 'NOC request approved and student deactivated successfully',
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
      .populate('student', 'name rollNumber course branch year academicYear')
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
    const { adminRemarks } = req.body;
    const superAdminId = req.user.id;

    const nocRequest = await NOC.findById(id);
    if (!nocRequest) {
      return next(createError(404, 'NOC request not found'));
    }

    if (nocRequest.status !== 'Pending') {
      return next(createError(400, 'Only pending NOC requests can be approved'));
    }

    // Update status to Approved directly
    await nocRequest.updateStatus('Approved', superAdminId, adminRemarks || '');
    await nocRequest.deactivateStudent();

    // Create notification for student
    await Notification.create({
      recipient: nocRequest.student,
      recipientModel: 'User',
      title: 'NOC Request Approved',
      message: 'Your NOC request has been approved by admin and your hostel profile has been deactivated for this academic year.',
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
      message: 'NOC request approved directly and student deactivated successfully',
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
