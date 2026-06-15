import StudentPreRegistration from '../models/StudentPreRegistration.js';
import User from '../models/User.js';
import { uploadToS3 } from '../utils/s3Service.js';
import createError from 'http-errors';

// Submit student pre-registration
export const submitPreRegistration = async (req, res, next) => {
  try {
    const {
      name,
      rollNumber,
      gender,
      course,
      year,
      branch,
      batch,
      academicYear,
      studentPhone,
      parentPhone,
      motherName,
      motherPhone,
      localGuardianName,
      localGuardianPhone,
      email,
      mealType
    } = req.body;

    // Check if student already exists
    const existingStudent = await User.findOne({ rollNumber: rollNumber.toUpperCase() });
    if (existingStudent) {
      throw createError(400, 'Student with this roll number already exists');
    }

    // Check if pre-registration already exists
    const existingPreRegistration = await StudentPreRegistration.findOne({ 
      rollNumber: rollNumber.toUpperCase() 
    });
    if (existingPreRegistration) {
      if (existingPreRegistration.status === 'pending') {
        throw createError(400, 'Pre-registration already submitted and pending approval');
      } else if (existingPreRegistration.status === 'approved') {
        throw createError(400, 'Pre-registration already approved');
      }
    }

    // Handle photo uploads
    let studentPhotoUrl = null;
    let guardianPhoto1Url = null;
    let guardianPhoto2Url = null;

    if (req.files) {
      if (req.files.studentPhoto && req.files.studentPhoto[0]) {
        studentPhotoUrl = await uploadToS3(req.files.studentPhoto[0], 'student-photos');
      }
      if (req.files.guardianPhoto1 && req.files.guardianPhoto1[0]) {
        guardianPhoto1Url = await uploadToS3(req.files.guardianPhoto1[0], 'guardian-photos');
      }
      if (req.files.guardianPhoto2 && req.files.guardianPhoto2[0]) {
        guardianPhoto2Url = await uploadToS3(req.files.guardianPhoto2[0], 'guardian-photos');
      }
    }

    // Handle email properly - only set if provided and not empty
    const emailValue = email ? String(email).trim() : '';
    const finalEmail = emailValue === '' ? undefined : emailValue;

    // Create pre-registration record
    const preRegistration = new StudentPreRegistration({
      name,
      rollNumber: rollNumber.toUpperCase(),
      gender,
      course,
      year,
      branch,
      batch,
      academicYear,
      studentPhone,
      parentPhone,
      motherName,
      motherPhone,
      localGuardianName,
      localGuardianPhone,
      email: finalEmail,
      mealType: mealType || 'non-veg',
      parentPermissionForOuting: true, // Default to true since field is removed from form
      studentPhoto: studentPhotoUrl,
      guardianPhoto1: guardianPhoto1Url,
      guardianPhoto2: guardianPhoto2Url
    });

    const savedPreRegistration = await preRegistration.save();

    res.json({
      success: true,
      message: 'Pre-registration submitted successfully',
      data: {
        id: savedPreRegistration._id,
        rollNumber: savedPreRegistration.rollNumber,
        name: savedPreRegistration.name,
        status: savedPreRegistration.status,
        submittedAt: savedPreRegistration.submittedAt
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get all pre-registrations (admin)
export const getPreRegistrations = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 10, search } = req.query;
    
    const query = {};
    if (status) {
      query.status = status;
    }
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { rollNumber: { $regex: search, $options: 'i' } },
        { studentPhone: { $regex: search, $options: 'i' } }
      ];
    }

    const preRegistrations = await StudentPreRegistration.find(query)
      .populate('course', 'name code')
      .populate('branch', 'name code')
      .populate('processedBy', 'name')
      .sort({ submittedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await StudentPreRegistration.countDocuments(query);

    res.json({
      success: true,
      data: preRegistrations,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get single pre-registration (admin)
export const getPreRegistrationById = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const preRegistration = await StudentPreRegistration.findById(id)
      .populate('course', 'name code')
      .populate('branch', 'name code')
      .populate('processedBy', 'name');

    if (!preRegistration) {
      throw createError(404, 'Pre-registration not found');
    }

    res.json({
      success: true,
      data: preRegistration
    });
  } catch (error) {
    next(error);
  }
};

// Approve pre-registration — use Register from SQL (same validation as addStudent)
export const approvePreRegistration = async (req, res, next) => {
  try {
    return res.status(410).json({
      success: false,
      code: 'PREREG_SQL_REQUIRED',
      message: 'Direct pre-registration approval is disabled. Use Register from SQL with the same academic year and SQL validation.',
      redirectTo: '/admin/dashboard/students/register-from-sql'
    });
  } catch (error) {
    next(error);
  }
};

// Reject pre-registration
export const rejectPreRegistration = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;

    const preRegistration = await StudentPreRegistration.findById(id);
    if (!preRegistration) {
      throw createError(404, 'Pre-registration not found');
    }

    if (preRegistration.status !== 'pending') {
      throw createError(400, 'Pre-registration is not pending');
    }

    preRegistration.status = 'rejected';
    preRegistration.processedAt = new Date();
    preRegistration.processedBy = req.user.id;
    preRegistration.rejectionReason = rejectionReason;
    await preRegistration.save();

    res.json({
      success: true,
      message: 'Pre-registration rejected successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Delete pre-registration
export const deletePreRegistration = async (req, res, next) => {
  try {
    const { id } = req.params;

    const preRegistration = await StudentPreRegistration.findByIdAndDelete(id);
    if (!preRegistration) {
      throw createError(404, 'Pre-registration not found');
    }

    res.json({
      success: true,
      message: 'Pre-registration deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};
