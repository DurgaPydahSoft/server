import BulkOuting from '../models/BulkOuting.js';
import Leave from '../models/Leave.js';
import User from '../models/User.js';
import { createError } from '../utils/error.js';
import { normalizeToISTStartOfDay } from '../utils/dateUtils.js';

// Create bulk outing request (Warden)
export const createBulkOuting = async (req, res, next) => {
  try {
    const { outingDate, reason, selectedStudentIds, filters } = req.body;
    const wardenId = req.warden._id;

    // Validate required fields
    if (!outingDate || !reason || !selectedStudentIds || selectedStudentIds.length === 0) {
      throw createError(400, 'Outing date, reason, and selected students are required');
    }

    // Validate outing date (must be in the future)
    const normalizedOutingDate = normalizeToISTStartOfDay(outingDate);
    const today = normalizeToISTStartOfDay(new Date());
    
    if (normalizedOutingDate < today) {
      throw createError(400, 'Outing date cannot be in the past');
    }

    // Verify all selected students exist and are active
    const students = await User.find({
      _id: { $in: selectedStudentIds },
      role: 'student',
      hostelStatus: 'Active'
    });

    if (students.length !== selectedStudentIds.length) {
      throw createError(400, 'Some selected students are not found or inactive');
    }

    // Check if warden has permission for the students' hostel type
    const warden = req.warden;
    const studentsWithDifferentHostel = students.filter(student => {
      const studentGender = student.gender;
      const wardenHostelType = warden.hostelType;
      
      if (wardenHostelType === 'boys' && studentGender !== 'Male') {
        return true;
      }
      if (wardenHostelType === 'girls' && studentGender !== 'Female') {
        return true;
      }
      return false;
    });

    if (studentsWithDifferentHostel.length > 0) {
      throw createError(400, 'You can only create outings for students in your hostel type');
    }

    // Create bulk outing request
    const bulkOuting = new BulkOuting({
      createdBy: wardenId,
      outingDate: normalizedOutingDate,
      reason,
      selectedStudents: selectedStudentIds.map(studentId => ({
        student: studentId
      })),
      filters: filters || {},
      studentCount: selectedStudentIds.length
    });

    await bulkOuting.save();

    res.status(201).json({
      success: true,
      message: 'Bulk outing request created successfully',
      data: {
        bulkOuting,
        studentCount: selectedStudentIds.length
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get bulk outing requests (Warden - their own requests)
export const getWardenBulkOutings = async (req, res, next) => {
  try {
    const wardenId = req.warden._id;
    const { status, page = 1, limit = 10 } = req.query;
    
    const query = { createdBy: wardenId };
    if (status) {
      query.status = status;
    }

    const bulkOutings = await BulkOuting.find(query)
      .populate('selectedStudents.student', 'name rollNumber course branch year gender')
      .populate('approvedBy', 'name')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await BulkOuting.countDocuments(query);

    res.json({
      success: true,
      data: {
        bulkOutings,
        totalPages: Math.ceil(count / limit),
        currentPage: page,
        totalCount: count
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get all bulk outing requests (Admin)
export const getAllBulkOutings = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    
    const query = {};
    if (status) {
      query.status = status;
    }

    const bulkOutings = await BulkOuting.find(query)
      .populate('createdBy', 'username hostelType')
      .populate('selectedStudents.student', 'name rollNumber course branch year gender')
      .populate('approvedBy', 'name')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await BulkOuting.countDocuments(query);

    res.json({
      success: true,
      data: {
        bulkOutings,
        totalPages: Math.ceil(count / limit),
        currentPage: page,
        totalCount: count
      }
    });
  } catch (error) {
    next(error);
  }
};

// Approve bulk outing request (Admin)
export const approveBulkOuting = async (req, res, next) => {
  try {
    const { bulkOutingId } = req.params;
    const adminId = req.admin._id;

    const bulkOuting = await BulkOuting.findById(bulkOutingId)
      .populate('selectedStudents.student');

    if (!bulkOuting) {
      throw createError(404, 'Bulk outing request not found');
    }

    if (bulkOuting.status !== 'Pending') {
      throw createError(400, 'Bulk outing request is not pending');
    }

    // Create individual leave records for each student
    const leavePromises = bulkOuting.selectedStudents.map(async (studentData) => {
      const student = studentData.student;
      
      // Create a permission-type leave record
      const leave = new Leave({
        student: student._id,
        applicationType: 'Permission',
        permissionDate: bulkOuting.outingDate,
        outTime: '09:00', // Default out time
        inTime: '18:00',  // Default in time
        reason: `Bulk outing: ${bulkOuting.reason}`,
        status: 'Approved', // Directly approved
        otpCode: '000000', // No OTP needed for bulk outings
        otpExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        parentPhone: student.parentPhone,
        approvedBy: adminId,
        approvedAt: new Date(),
        verificationStatus: 'Not Verified'
      });

      const savedLeave = await leave.save();
      
      // Update the bulk outing with the leave record reference
      studentData.leaveRecord = savedLeave._id;
      
      return savedLeave;
    });

    await Promise.all(leavePromises);

    // Update bulk outing status
    bulkOuting.status = 'Approved';
    bulkOuting.approvedBy = adminId;
    bulkOuting.approvedAt = new Date();
    await bulkOuting.save();

    res.json({
      success: true,
      message: 'Bulk outing request approved successfully',
      data: {
        bulkOuting,
        createdLeaves: leavePromises.length
      }
    });
  } catch (error) {
    next(error);
  }
};

// Reject bulk outing request (Admin)
export const rejectBulkOuting = async (req, res, next) => {
  try {
    const { bulkOutingId } = req.params;
    const { rejectionReason } = req.body;
    const adminId = req.admin._id;

    const bulkOuting = await BulkOuting.findById(bulkOutingId);

    if (!bulkOuting) {
      throw createError(404, 'Bulk outing request not found');
    }

    if (bulkOuting.status !== 'Pending') {
      throw createError(400, 'Bulk outing request is not pending');
    }

    // Update bulk outing status
    bulkOuting.status = 'Rejected';
    bulkOuting.approvedBy = adminId;
    bulkOuting.approvedAt = new Date();
    bulkOuting.rejectionReason = rejectionReason;
    await bulkOuting.save();

    res.json({
      success: true,
      message: 'Bulk outing request rejected successfully',
      data: bulkOuting
    });
  } catch (error) {
    next(error);
  }
};

// Get students for bulk outing selection (Warden)
export const getStudentsForBulkOuting = async (req, res, next) => {
  try {
    const { course, branch, gender, category, roomNumber, batch, academicYear, hostelStatus = 'Active' } = req.query;
    const warden = req.warden;

    // Build query based on warden's hostel type
    const query = { 
      role: 'student',
      hostelStatus: hostelStatus
    };

    // Filter by warden's hostel type
    if (warden.hostelType === 'boys') {
      query.gender = 'Male';
    } else if (warden.hostelType === 'girls') {
      query.gender = 'Female';
    }

    // Add other filters
    if (course) query.course = course;
    if (branch) query.branch = branch;
    if (gender) query.gender = gender;
    if (category) query.category = category;
    if (roomNumber) query.roomNumber = roomNumber;
    if (batch) query.batch = batch;
    if (academicYear) query.academicYear = academicYear;

    const students = await User.find(query)
      .select('name rollNumber course branch year gender category roomNumber studentPhone parentPhone')
      .populate('course', 'name code')
      .populate('branch', 'name code')
      .sort({ name: 1 });

    res.json({
      success: true,
      data: students
    });
  } catch (error) {
    next(error);
  }
};

// Get students for a specific bulk outing (Admin)
export const getBulkOutingStudents = async (req, res, next) => {
  try {
    const { bulkOutingId } = req.params;

    const bulkOuting = await BulkOuting.findById(bulkOutingId)
      .populate({
        path: 'selectedStudents.student',
        select: 'name rollNumber course branch year gender category roomNumber studentPhone parentPhone studentPhoto',
        populate: [
          { path: 'course', select: 'name code' },
          { path: 'branch', select: 'name code' }
        ]
      });

    if (!bulkOuting) {
      throw createError(404, 'Bulk outing request not found');
    }

    // Extract student data from the populated bulk outing
    const students = bulkOuting.selectedStudents.map(item => item.student);

    res.json({
      success: true,
      data: {
        students,
        bulkOuting: {
          _id: bulkOuting._id,
          outingDate: bulkOuting.outingDate,
          reason: bulkOuting.reason,
          status: bulkOuting.status,
          studentCount: bulkOuting.studentCount
        }
      }
    });
  } catch (error) {
    next(error);
  }
}; 