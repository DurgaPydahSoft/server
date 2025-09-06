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

// Approve pre-registration and create student record
export const approvePreRegistration = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { 
      category, 
      roomNumber, 
      bedNumber, 
      lockerNumber, 
      concession = 0 
    } = req.body;

    const preRegistration = await StudentPreRegistration.findById(id);
    if (!preRegistration) {
      throw createError(404, 'Pre-registration not found');
    }

    if (preRegistration.status !== 'pending') {
      throw createError(400, 'Pre-registration is not pending');
    }

    // Check if student already exists
    const existingStudent = await User.findOne({ rollNumber: preRegistration.rollNumber });
    if (existingStudent) {
      throw createError(400, 'Student with this roll number already exists');
    }

    // Validate room number based on gender and category
    const ROOM_MAPPINGS = {
      Male: {
        'A+': ['302', '309', '310', '311', '312'],
        'A': ['303', '304', '305', '306', '308', '320', '324', '325'],
        'B+': ['321'],
        'B': ['314', '315', '316', '317', '322', '323']
      },
      Female: {
        'A+': ['209', '211', '212', '213', '214', '215'],
        'A': ['103', '115', '201', '202', '203', '204', '205', '206', '207', '208', '216', '217'],
        'B': ['101', '102', '104', '105', '106', '108', '109', '111', '112', '114'],
        'C': ['117']
      }
    };

    const validRooms = ROOM_MAPPINGS[preRegistration.gender]?.[category] || [];
    if (!validRooms.includes(roomNumber)) {
      throw createError(400, 'Invalid room number for the selected gender and category');
    }

    // Check bed count limit
    const RoomModel = (await import('../models/Room.js')).default;
    const roomDoc = await RoomModel.findOne({ 
      roomNumber, 
      gender: preRegistration.gender, 
      category 
    });
    if (!roomDoc) {
      throw createError(400, 'Room not found');
    }
    
    const studentCount = await User.countDocuments({ 
      roomNumber, 
      gender: preRegistration.gender, 
      category, 
      role: 'student' 
    });
    if (studentCount >= roomDoc.bedCount) {
      throw createError(400, 'Room is full. Cannot register more students.');
    }

    // Generate hostel ID
    const generateHostelId = async (gender) => {
      const Counter = (await import('../models/Counter.js')).default;
      const currentYear = new Date().getFullYear().toString().slice(-2);
      const prefix = gender === 'Male' ? 'BH' : 'GH';
      const counterId = `hostel_${prefix}${currentYear}`;
      
      const counter = await Counter.findOneAndUpdate(
        { _id: counterId },
        { $inc: { sequence: 1 } },
        { 
          new: true, 
          upsert: true,
          setDefaultsOnInsert: true 
        }
      );
      
      const sequence = counter.sequence;
      return `${prefix}${currentYear}${sequence.toString().padStart(3, '0')}`;
    };

    const hostelId = await generateHostelId(preRegistration.gender);

    // Calculate fees with concession
    let calculatedTerm1Fee = 0;
    let calculatedTerm2Fee = 0;
    let calculatedTerm3Fee = 0;
    let totalCalculatedFee = 0;

    try {
      const FeeStructure = (await import('../models/FeeStructure.js')).default;
      const feeStructure = await FeeStructure.getFeeStructure(preRegistration.academicYear, category);
      
      if (feeStructure) {
        const concessionAmount = Number(concession) || 0;
        
        calculatedTerm1Fee = Math.max(0, feeStructure.term1Fee - concessionAmount);
        let remainingConcession = Math.max(0, concessionAmount - feeStructure.term1Fee);
        calculatedTerm2Fee = Math.max(0, feeStructure.term2Fee - remainingConcession);
        remainingConcession = Math.max(0, remainingConcession - feeStructure.term2Fee);
        calculatedTerm3Fee = Math.max(0, feeStructure.term3Fee - remainingConcession);
        
        totalCalculatedFee = calculatedTerm1Fee + calculatedTerm2Fee + calculatedTerm3Fee;
      }
    } catch (feeError) {
      console.error('Error calculating fees:', feeError);
    }

    // Generate random password
    const generatedPassword = User.generateRandomPassword();

    // Create student record
    const student = new User({
      name: preRegistration.name,
      rollNumber: preRegistration.rollNumber,
      password: generatedPassword,
      role: 'student',
      gender: preRegistration.gender,
      course: preRegistration.course,
      year: preRegistration.year,
      branch: preRegistration.branch,
      category,
      mealType: preRegistration.mealType,
      parentPermissionForOuting: preRegistration.parentPermissionForOuting,
      roomNumber,
      bedNumber,
      lockerNumber,
      studentPhone: preRegistration.studentPhone,
      parentPhone: preRegistration.parentPhone,
      motherName: preRegistration.motherName,
      motherPhone: preRegistration.motherPhone,
      localGuardianName: preRegistration.localGuardianName,
      localGuardianPhone: preRegistration.localGuardianPhone,
      batch: preRegistration.batch,
      academicYear: preRegistration.academicYear,
      email: preRegistration.email,
      hostelId,
      isPasswordChanged: false,
      studentPhoto: preRegistration.studentPhoto,
      guardianPhoto1: preRegistration.guardianPhoto1,
      guardianPhoto2: preRegistration.guardianPhoto2,
      concession: Number(concession) || 0,
      calculatedTerm1Fee,
      calculatedTerm2Fee,
      calculatedTerm3Fee,
      totalCalculatedFee
    });

    const savedStudent = await student.save();

    // Update pre-registration status and then delete the record
    preRegistration.status = 'approved';
    preRegistration.processedAt = new Date();
    preRegistration.processedBy = req.user.id;
    preRegistration.mainStudentId = savedStudent._id;
    await preRegistration.save();

    // Delete the pre-registration record since student has been created
    console.log('🗑️ Deleting approved pre-registration record for student:', savedStudent.rollNumber);
    await StudentPreRegistration.findByIdAndDelete(preRegistration._id);
    console.log('✅ Pre-registration record deleted successfully');

    // Create TempStudent record for pending password reset
    const TempStudent = (await import('../models/TempStudent.js')).default;
    const tempStudent = new TempStudent({
      name: savedStudent.name,
      rollNumber: savedStudent.rollNumber,
      studentPhone: savedStudent.studentPhone,
      email: savedStudent.email || '',
      generatedPassword: generatedPassword,
      isFirstLogin: true,
      mainStudentId: savedStudent._id,
    });
    await tempStudent.save();

    // Create fee reminder
    try {
      const FeeReminder = (await import('../models/FeeReminder.js')).default;
      const registrationDate = new Date();
      await FeeReminder.createForStudent(
        savedStudent._id,
        registrationDate,
        preRegistration.academicYear
      );
    } catch (feeError) {
      console.error('Error creating fee reminder:', feeError);
    }

    res.json({
      success: true,
      message: 'Pre-registration approved and student created successfully',
      data: {
        student: savedStudent,
        generatedPassword
      }
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
