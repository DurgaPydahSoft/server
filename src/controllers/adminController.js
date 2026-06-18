import User, { COURSES, BRANCHES, ROOM_MAPPINGS } from '../models/User.js';
import TempStudent from '../models/TempStudent.js';
import Complaint from '../models/Complaint.js';
import Leave from '../models/Leave.js';
import Room from '../models/Room.js';
import Hostel from '../models/Hostel.js';
import HostelCategory from '../models/HostelCategory.js';
import SecuritySettings from '../models/SecuritySettings.js';
import FeeReminder from '../models/FeeReminder.js';
import RoomOccupancyHistory from '../models/RoomOccupancyHistory.js';
import StudentPreRegistration from '../models/StudentPreRegistration.js';
import NOC from '../models/NOC.js';
import { createError } from '../utils/error.js';
import { uploadToS3, deleteFromS3 } from '../utils/s3Service.js';
import { sendStudentRegistrationEmail, sendPasswordResetEmail } from '../utils/emailService.js';
import { sendAdminCredentialsSMS } from '../utils/smsService.js';
import xlsx from 'xlsx';
import Branch from '../models/Branch.js';
import Course from '../models/Course.js';
import Counter from '../models/Counter.js';
import axios from 'axios';
import { fetchStudentByIdentifier, testSQLConnection } from '../utils/sqlService.js';
import { extractSQLIds, ensureMongoDBCourse, ensureMongoDBBranch } from '../utils/courseBranchResolver.js';
import { normalizeBatchToYear, getBatchEndYear, validateAcademicYearForBatch } from '../utils/batchUtils.js';
import {
  enrichStudentAcademics,
  enrichStudentsAcademics,
  parseSqlStudentRow,
  matchesAcademicFilters,
  repairMissingRollNumber
} from '../utils/studentAcademicEnricher.js';
import {
  createOccupancyHistory,
  closeActiveOccupancyHistory,
  removeStudentEnrollmentForAcademicYear,
  attachResolvedExpiryDates,
  fetchStudentsForAcademicYear
} from '../utils/applicationExpiryService.js';
import {
  getOccupiedBedsAndLockersForAcademicYear,
  countStudentsInRoomForAcademicYear,
  isBedOccupiedForAcademicYear,
  isLockerOccupiedForAcademicYear
} from '../utils/roomOccupancyUtils.js';
import { photoToBase64ForExport } from '../utils/studentPhotoService.js';
import {
  syncStudentHostelFeeSafely,
  deleteAllStudentHostelFeesSafely,
  resolveFeesStudentId
} from '../services/feesSyncService.js';

// Helper function to fetch image and convert to base64
const fetchImageAsBase64 = async (imageUrl) => {
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000
    });
    
    const buffer = Buffer.from(response.data, 'binary');
    const base64 = buffer.toString('base64');
    const mimeType = response.headers['content-type'] || 'image/jpeg';
    
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error('Error fetching image:', error);
    return null;
  }
};

// Function to generate hostel ID (imported from studentController)
const generateHostelId = async (gender) => {
  console.log('🔧 Generating hostel ID for gender:', gender);
  
  const currentYear = new Date().getFullYear().toString().slice(-2); // Get last 2 digits of year
  const prefix = gender === 'Male' ? 'BH' : 'GH';
  
  console.log('📅 Current year:', currentYear, 'Prefix:', prefix, 'Gender:', gender);
  
  // Use a counter collection to ensure atomic sequence generation
  const counterId = `hostel_${prefix}${currentYear}`;
  
  // Use findOneAndUpdate with upsert to atomically increment the counter
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
  const hostelId = `${prefix}${currentYear}${sequence.toString().padStart(3, '0')}`;
  console.log('Generated hostel ID:', hostelId);
  
  // Format: BH25001, GH25002, etc.
  return hostelId;
};

// Add a new student
export const addStudent = async (req, res, next) => {
  try {
    const {
      name,
      rollNumber,
      admissionNumber,
      gender,
      course,
      year,
      branch,
      category,
      hostel,
      hostelCategory,
      room,
      mealType,
      parentPermissionForOuting,
      roomNumber,
      bedNumber,
      lockerNumber,
      studentPhone,
      parentPhone,
      motherName,
      motherPhone,
      localGuardianName,
      localGuardianPhone,
      batch,
      academicYear,
      email,
      concession = 0,
      college
    } = req.body;

    const rollUpper = String(rollNumber || '').trim().toUpperCase();
    if (!rollUpper) {
      throw createError(400, 'Roll number is required');
    }

    const existingStudent = await User.findOne({ rollNumber: rollUpper, role: 'student' });
    const isRenewal = Boolean(existingStudent && existingStudent.hostelStatus === 'Inactive');

    if (existingStudent && existingStudent.hostelStatus === 'Active') {
      throw createError(
        400,
        `Student is already active for academic year ${existingStudent.academicYear}. Register again only after the application expires.`
      );
    }

    // Validate student exists in SQL and load academics (source of truth)
    let sqlAcademics = null;
    try {
      const connectionTest = await testSQLConnection();
      if (!connectionTest.success) {
        throw createError(503, 'SQL database connection failed. Cannot proceed with registration.', connectionTest.error);
      }

      let sqlResult = await fetchStudentByIdentifier(rollUpper);
      if (!sqlResult.success && admissionNumber && admissionNumber.toUpperCase() !== rollUpper) {
        sqlResult = await fetchStudentByIdentifier(admissionNumber);
      }
      if (!sqlResult.success) {
        throw createError(404, 'Student not found in central database. Please verify the PIN number or Admission number.');
      }

      sqlAcademics = await parseSqlStudentRow(sqlResult.data);
      console.log('✅ Student validated in SQL database');
    } catch (error) {
      // If it's already a createError, re-throw it
      if (error.statusCode) {
        throw error;
      }
      // Otherwise, wrap it
      console.error('❌ SQL validation error:', error);
      throw createError(500, 'Error validating student in SQL database', error.message);
    }

    const resolvedAdmissionNumber =
      admissionNumber?.toString().trim().toUpperCase() ||
      sqlAcademics?.admissionNumber?.toString().trim().toUpperCase() ||
      undefined;

    // Hostel / category (hostelCategory) validation under new hierarchy
    if (!hostel) {
      throw createError(400, 'Hostel is required');
    }
    if (!hostelCategory) {
      throw createError(400, 'Hostel category is required');
    }
    if (!academicYear || !validateAcademicYear(academicYear)) {
      throw createError(400, 'Valid academic year (YYYY-YYYY) is required');
    }

    const ayValidation = validateAcademicYearForBatch(
      sqlAcademics?.batch || batch,
      sqlAcademics?.year || year,
      academicYear
    );
    if (!ayValidation.valid) {
      throw createError(400, ayValidation.message);
    }

    const hostelExists = await Hostel.exists({ _id: hostel });
    if (!hostelExists) {
      throw createError(400, 'Invalid hostel.');
    }

    const hostelCategoryDoc = await HostelCategory.findOne({ _id: hostelCategory, hostel });
    if (!hostelCategoryDoc) {
      throw createError(400, 'Invalid category for the selected hostel.');
    }
    const finalCategoryName = category?.trim() || hostelCategoryDoc.name;

    // Validate room using hostel + hostelCategory + roomNumber
    const roomQuery = { hostel, category: hostelCategory, roomNumber };
    const roomDoc = await Room.findOne(roomQuery);
    if (!roomDoc) {
      throw createError(400, 'Invalid room number for the selected hostel/category.');
    }

    // Check bed count limit for the selected academic year
    const studentCount = await countStudentsInRoomForAcademicYear(roomDoc, academicYear);
    if (studentCount >= roomDoc.bedCount) {
      throw createError(400, 'Room is full for the selected academic year. Cannot register more students.');
    }

    const excludeStudentId = isRenewal ? existingStudent._id : null;

    // Validate bed and locker assignment if provided (scoped to academic year)
    if (bedNumber) {
      const bedOccupied = await isBedOccupiedForAcademicYear(
        roomDoc,
        bedNumber,
        academicYear,
        excludeStudentId
      );
      if (bedOccupied) {
        throw createError(400, 'Selected bed is already occupied for this academic year');
      }

      const expectedBedFormat = `${roomNumber} Bed `;
      if (!bedNumber.startsWith(expectedBedFormat)) {
        throw createError(400, 'Invalid bed number format for this room');
      }
    }

    if (lockerNumber) {
      const lockerOccupied = await isLockerOccupiedForAcademicYear(
        roomDoc,
        lockerNumber,
        academicYear,
        excludeStudentId
      );
      if (lockerOccupied) {
        throw createError(400, 'Selected locker is already occupied for this academic year');
      }

      const expectedLockerFormat = `${roomNumber} Locker `;
      if (!lockerNumber.startsWith(expectedLockerFormat)) {
        throw createError(400, 'Invalid locker number format for this room');
      }
    }

    // Calculate fees with concession
    let calculatedTerm1Fee = 0;
    let calculatedTerm2Fee = 0;
    let calculatedTerm3Fee = 0;
    let totalCalculatedFee = 0;

    try {
      const FeeStructure = (await import('../models/FeeStructure.js')).default;
      const feeCourse = sqlAcademics?.course || course;
      const feeBranch = sqlAcademics?.branch || branch;
      const feeYear = sqlAcademics?.year || year;
      const feeStructure = await FeeStructure.getFeeStructure(
        academicYear,
        feeCourse,
        feeBranch,
        feeYear,
        finalCategoryName
      );
      
      if (feeStructure) {
        console.log('📊 Fee structure found:', feeStructure);
        
        // Calculate fees with concession (applied to Term 1 only, excess to Term 2)
        const concessionAmount = Number(concession) || 0;
        const totalOriginalFee = feeStructure.totalFee;
        
        // Apply concession to Term 1 first
        calculatedTerm1Fee = Math.max(0, feeStructure.term1Fee - concessionAmount);
        
        // If concession exceeds Term 1 fee, apply excess to Term 2
        let remainingConcession = Math.max(0, concessionAmount - feeStructure.term1Fee);
        calculatedTerm2Fee = Math.max(0, feeStructure.term2Fee - remainingConcession);
        
        // If concession still exceeds Term 1 + Term 2, apply to Term 3
        remainingConcession = Math.max(0, remainingConcession - feeStructure.term2Fee);
        calculatedTerm3Fee = Math.max(0, feeStructure.term3Fee - remainingConcession);
        
        totalCalculatedFee = calculatedTerm1Fee + calculatedTerm2Fee + calculatedTerm3Fee;
        
        console.log('💰 Fee calculation:', {
          original: totalOriginalFee,
          concession: concessionAmount,
          term1: calculatedTerm1Fee,
          term2: calculatedTerm2Fee,
          term3: calculatedTerm3Fee,
          total: totalCalculatedFee,
          remainingConcession: remainingConcession
        });
      } else {
        console.log('⚠️ No fee structure found for category:', category, 'academic year:', academicYear);
      }
    } catch (feeError) {
      console.error('❌ Error calculating fees:', feeError);
      // Don't fail the registration if fee calculation fails
    }

    // Handle guardian photo uploads (student photo comes from SDMS at display time)
    let guardianPhoto1Url = null;
    let guardianPhoto2Url = null;

    if (req.files) {
      try {
        if (req.files.guardianPhoto1 && req.files.guardianPhoto1[0]) {
          console.log('📸 Uploading guardian 1 photo to S3...');
          guardianPhoto1Url = await uploadToS3(req.files.guardianPhoto1[0], 'guardian-photos');
          console.log('✅ Guardian 1 photo uploaded successfully:', guardianPhoto1Url);
        }
        if (req.files.guardianPhoto2 && req.files.guardianPhoto2[0]) {
          console.log('📸 Uploading guardian 2 photo to S3...');
          guardianPhoto2Url = await uploadToS3(req.files.guardianPhoto2[0], 'guardian-photos');
          console.log('✅ Guardian 2 photo uploaded successfully:', guardianPhoto2Url);
        }
      } catch (uploadError) {
        console.error('❌ Error uploading photos to S3:', uploadError);
        // Check if S3 credentials are configured
        if (!process.env.AWS_ACCESS_KEY || !process.env.AWS_SECRET_KEY || !process.env.AWS_S3_BUCKET || !process.env.AWS_REGION) {
          throw createError(500, 'S3 configuration is missing. Please configure AWS credentials and S3 bucket settings.');
        }
        throw createError(500, `Failed to upload photos to S3: ${uploadError.message}`);
      }
    }

    // Handle guardian photo URLs from preregistration (if no file uploads)
    if (!guardianPhoto1Url && req.body.guardianPhoto1Url) {
      guardianPhoto1Url = req.body.guardianPhoto1Url;
    }
    if (!guardianPhoto2Url && req.body.guardianPhoto2Url) {
      guardianPhoto2Url = req.body.guardianPhoto2Url;
    }

    // Handle email properly - only set if provided and not empty
    const emailValue = email ? String(email).trim() : '';
    const finalEmail = emailValue === '' ? undefined : emailValue;

    // Track concession request if concession is set
    const concessionAmount = Number(concession) || 0;
    const concessionData = {
      concession: concessionAmount,
      concessionApproved: false,
      concessionRequestedBy: null,
      concessionRequestedAt: null
    };
    
    const sqlCourseId = sqlAcademics?.sqlCourseId || null;
    const sqlBranchId = sqlAcademics?.sqlBranchId || null;

    // If concession is set, track who requested it
    if (concessionAmount > 0 && req.admin) {
      concessionData.concessionRequestedBy = req.admin._id;
      concessionData.concessionRequestedAt = new Date();
      concessionData.concessionHistory = [{
        action: 'requested',
        amount: concessionAmount,
        previousAmount: null,
        performedBy: req.admin._id,
        performedAt: new Date(),
        notes: ''
      }];
    }

    if (isRenewal) {
      const student = existingStudent;
      const previousAcademicYear = student.academicYear;

      await closeActiveOccupancyHistory({ studentId: student._id });

      if (previousAcademicYear && previousAcademicYear !== academicYear) {
        const hasPreviousHistory = await RoomOccupancyHistory.exists({
          student: student._id,
          academicYear: previousAcademicYear
        });
        if (!hasPreviousHistory) {
          await RoomOccupancyHistory.create({
            student: student._id,
            studentName: student.name,
            rollNumber: student.rollNumber,
            course: sqlAcademics?.course || student.course,
            branch: sqlAcademics?.branch || student.branch,
            yearOfStudy: sqlAcademics ? Math.max(1, sqlAcademics.year - 1) : (student.year || 1),
            academicYear: previousAcademicYear,
            hostel: student.hostel,
            hostelCategory: student.hostelCategory,
            room: student.room,
            roomNumber: student.roomNumber,
            bedNumber: student.bedNumber,
            lockerNumber: student.lockerNumber,
            allocatedFrom: student.createdAt || new Date(),
            allocatedTo: new Date(),
            status: 'Expired',
            expiryReason: 'academic_year_end',
            createdBy: req.admin?._id || null
          });
        }
      }

      student.name = name || student.name;
      if (resolvedAdmissionNumber) {
        student.admissionNumber = resolvedAdmissionNumber;
      }
      if (gender) student.gender = gender;
      if (sqlCourseId) student.sqlCourseId = sqlCourseId;
      if (sqlBranchId) student.sqlBranchId = sqlBranchId;
      if (college) {
        student.college = typeof college === 'string' ? JSON.parse(college) : college;
      }
      student.category = finalCategoryName;
      if (mealType) student.mealType = mealType;
      if (parentPermissionForOuting !== undefined) {
        student.parentPermissionForOuting = Boolean(parentPermissionForOuting);
      }
      student.roomNumber = roomNumber;
      student.room = roomDoc._id;
      student.bedNumber = bedNumber;
      student.lockerNumber = lockerNumber;
      if (studentPhone) student.studentPhone = studentPhone;
      if (parentPhone) student.parentPhone = parentPhone;
      if (motherName) student.motherName = motherName;
      if (motherPhone) student.motherPhone = motherPhone;
      if (localGuardianName) student.localGuardianName = localGuardianName;
      if (localGuardianPhone) student.localGuardianPhone = localGuardianPhone;
      student.batch = normalizeBatchToYear(sqlAcademics?.batch || batch || student.batch);
      student.academicYear = academicYear;
      student.hostelStatus = 'Active';
      student.applicationStatus = 'Active';
      student.set('applicationExpiryDate', undefined);
      student.set('applicationExpiryExtendedAt', undefined);
      student.set('applicationExpiryExtendedBy', undefined);
      if (finalEmail) student.email = finalEmail;
      student.hostel = hostel;
      student.hostelCategory = hostelCategory;
      if (guardianPhoto1Url) student.guardianPhoto1 = guardianPhoto1Url;
      if (guardianPhoto2Url) student.guardianPhoto2 = guardianPhoto2Url;
      student.concession = concessionData.concession;
      student.concessionApproved = concessionData.concessionApproved;
      student.concessionRequestedBy = concessionData.concessionRequestedBy;
      student.concessionRequestedAt = concessionData.concessionRequestedAt;
      if (concessionData.concessionHistory) {
        student.concessionHistory = concessionData.concessionHistory;
      }
      student.calculatedTerm1Fee = calculatedTerm1Fee;
      student.calculatedTerm2Fee = calculatedTerm2Fee;
      student.calculatedTerm3Fee = calculatedTerm3Fee;
      student.totalCalculatedFee = totalCalculatedFee;

      await repairMissingRollNumber(student, sqlAcademics);
      await student.save({ validateModifiedOnly: true });

      await createOccupancyHistory({
        student,
        academicYear,
        courseName: sqlAcademics?.course,
        branchName: sqlAcademics?.branch,
        yearOfStudy: sqlAcademics?.year,
        adminId: req.admin?._id,
        expiryReason: 'registration'
      });

      try {
        const preRegistration = await StudentPreRegistration.findOne({
          rollNumber: student.rollNumber,
          status: 'pending'
        });
        if (preRegistration) {
          await StudentPreRegistration.findByIdAndDelete(preRegistration._id);
        }
      } catch (preregError) {
        console.error('❌ Error deleting pre-registration record:', preregError);
      }

      try {
        await FeeReminder.updateMany(
          { student: student._id, isActive: true },
          { $set: { isActive: false } }
        );
        await FeeReminder.createForStudent(student._id, new Date(), academicYear);
      } catch (feeError) {
        console.error('❌ Error creating fee reminder on renewal:', student.rollNumber, feeError);
      }

      await syncStudentHostelFeeSafely(student, { academicYear });

      const enrichedStudent = await enrichStudentAcademics(student);
      console.log(
        `♻️ Renewed returning student ${student.rollNumber}: ${previousAcademicYear} → ${academicYear} (password unchanged)`
      );

      return res.json({
        success: true,
        data: {
          student: enrichedStudent,
          isRenewal: true,
          passwordReused: true,
          generatedPassword: null,
          emailSent: false,
          smsSent: false,
          message: `Returning student renewed for ${academicYear}. They can log in with their existing password.`
        }
      });
    }

    const generatedPassword = User.generateRandomPassword();
    const hostelId = await generateHostelId(gender || 'Male');
    console.log('Generated hostel ID:', hostelId);

    // Create new student (no expiry date at registration — configured in Application Expiry Settings)
    const student = new User({
      name,
      rollNumber: rollUpper,
      admissionNumber: resolvedAdmissionNumber,
      password: generatedPassword,
      role: 'student',
      gender,
      ...(sqlCourseId && { sqlCourseId }),
      ...(sqlBranchId && { sqlBranchId }),
      college: typeof college === 'string' ? JSON.parse(college) : college,
      category: finalCategoryName,
      mealType,
      parentPermissionForOuting: parentPermissionForOuting !== undefined ? parentPermissionForOuting : true,
      roomNumber,
      room: roomDoc._id,
      bedNumber,
      lockerNumber,
      studentPhone,
      parentPhone,
      motherName,
      motherPhone,
      localGuardianName,
      localGuardianPhone,
      batch: normalizeBatchToYear(sqlAcademics?.batch || batch),
      academicYear,
      applicationStatus: 'Active',
      email: finalEmail,
      hostelId,
      hostel,
      hostelCategory,
      isPasswordChanged: false,
      guardianPhoto1: guardianPhoto1Url,
      guardianPhoto2: guardianPhoto2Url,
      ...concessionData,
      calculatedTerm1Fee,
      calculatedTerm2Fee,
      calculatedTerm3Fee,
      totalCalculatedFee
    });

    const savedStudent = await student.save();

    await createOccupancyHistory({
      student: savedStudent,
      academicYear,
      courseName: sqlAcademics?.course,
      branchName: sqlAcademics?.branch,
      yearOfStudy: sqlAcademics?.year,
      adminId: req.admin?._id
    });

    // Check if this student was added from a pre-registration and delete the pre-registration record
    try {
      const preRegistration = await StudentPreRegistration.findOne({ 
        rollNumber: savedStudent.rollNumber,
        status: 'pending'
      });
      
      if (preRegistration) {
        console.log('🗑️ Deleting pre-registration record for approved student:', savedStudent.rollNumber);
        await StudentPreRegistration.findByIdAndDelete(preRegistration._id);
        console.log('✅ Pre-registration record deleted successfully');
      }
    } catch (preregError) {
      console.error('❌ Error deleting pre-registration record:', preregError);
      // Don't fail the student creation if pre-registration deletion fails
    }

    // Create TempStudent record for pending password reset
    const tempStudent = new TempStudent({
      name: savedStudent.name,
      rollNumber: savedStudent.rollNumber,
      studentPhone: savedStudent.studentPhone,
      email: savedStudent.email || '', // Handle undefined email
      generatedPassword: generatedPassword,
      isFirstLogin: true,
      mainStudentId: savedStudent._id,
    });
    await tempStudent.save();

    // Create fee reminder for the student
    try {
      const registrationDate = new Date();
      await FeeReminder.createForStudent(
        savedStudent._id,
        registrationDate,
        academicYear
      );
      console.log('✅ Fee reminder created for student:', savedStudent.rollNumber);
    } catch (feeError) {
      console.error('❌ Error creating fee reminder for student:', savedStudent.rollNumber, feeError);
      // Don't fail the registration if fee reminder creation fails
    }

    await syncStudentHostelFeeSafely(savedStudent, { academicYear });

    // Send email notification to student
    let emailSent = false;
    let emailError = null;
    
    if (finalEmail) {
      try {
        const loginUrl = `${req.protocol}://${req.get('host')}/login`;
        await sendStudentRegistrationEmail(
          finalEmail,
          name,
          rollNumber.toUpperCase(),
          generatedPassword,
          loginUrl
        );
        emailSent = true;
        console.log('📧 Registration email sent successfully to:', finalEmail);
      } catch (emailErr) {
        emailError = emailErr.message;
        console.error('📧 Failed to send registration email to:', finalEmail, emailErr);
        // Don't fail the registration if email fails
      }
    }

    // Send SMS notification to student
    let smsSent = false;
    let smsError = null;
    
    if (studentPhone && studentPhone.trim()) {
      try {
        console.log('📱 Sending student credentials via SMS to:', studentPhone);
        const smsResult = await sendAdminCredentialsSMS(
          studentPhone,
          rollNumber.toUpperCase(), // Using rollNumber as username
          generatedPassword
        );
        smsSent = true;
        console.log('📱 SMS sent successfully:', smsResult);
      } catch (smsErr) {
        smsError = smsErr.message;
        console.error('📱 Failed to send SMS to:', studentPhone, smsErr);
        // Don't fail the registration if SMS fails
      }
    } else {
      console.log('📱 No student phone number provided, skipping SMS');
    }

    const enrichedStudent = await enrichStudentAcademics(savedStudent);

    res.json({
      success: true,
      data: {
        student: enrichedStudent,
        isRenewal: false,
        passwordReused: false,
        generatedPassword,
        emailSent,
        emailError,
        smsSent,
        smsError
      }
    });
  } catch (error) {
    next(error);
  }
};



// Helper to get course duration based on course name
function getCourseDuration(courseName) {
  const courseNameUpper = courseName.toUpperCase();
  if (courseNameUpper.includes('B.TECH') || courseNameUpper.includes('PHARMACY')) {
    return 4;
  } else if (courseNameUpper.includes('DIPLOMA') || courseNameUpper.includes('DEGREE')) {
    return 3;
  }
  return 4; // Default to 4 years
}

// Helper to map short branch names to full names based on seeded data
function getBranchNameMapping(courseName, branchName) {
  // Normalize inputs for case-insensitive matching
  const courseNameUpper = courseName.toUpperCase();
  const branchNameUpper = branchName.toUpperCase();
  
  // B.Tech branches
  if (courseNameUpper.includes('B.TECH') || courseNameUpper.includes('BTECH')) {
    switch (branchNameUpper) {
      case 'CSE': return 'Computer Science Engineering';
      case 'ECE': return 'Electronics & Communication Engineering';
      case 'EEE': return 'Electrical & Electronics Engineering';
      case 'MECH': return 'Mechanical Engineering';
      case 'CIVIL': return 'Civil Engineering';
      case 'AI': return 'Artificial Intelligence';
      case 'AI & ML': return 'Artificial Intelligence & Machine Learning';
      case 'AI&ML': return 'Artificial Intelligence & Machine Learning';
      default: return branchName; // Return original if no mapping found
    }
  }
  
  // Diploma branches
  if (courseNameUpper.includes('DIPLOMA')) {
    switch (branchNameUpper) {
      case 'DCME': return 'Diploma in Computer Engineering';
      case 'DECE': return 'Diploma in Electronics';
      case 'DMECH': return 'Diploma in Mechanical Engineering';
      case 'DFISHERIES': return 'Diploma in Fisheries';
      case 'DAH': return 'Diploma in Animal Husbandry';
      case 'DAIML': return 'Diploma in AI & ML';
      case 'DAGRI': return 'Diploma in Agriculture';
      default: return branchName; // Return original if no mapping found
    }
  }
  
  // Pharmacy branches
  if (courseNameUpper.includes('PHARMACY')) {
    switch (branchNameUpper) {
      case 'B-PHARMACY': return 'B-Pharmacy';
      case 'BPHARM': return 'B-Pharmacy';
      case 'PHARM D': return 'Pharm D';
      case 'PHARMD': return 'Pharm D';
      case 'PHARM(PB) D': return 'Pharm(PB) D';
      case 'PHARMPBD': return 'Pharm(PB) D';
      case 'PHARMACEUTICAL ANALYSIS': return 'Pharmaceutical Analysis';
      case 'PHARMANALYSIS': return 'Pharmaceutical Analysis';
      case 'PHARMACEUTICS': return 'Pharmaceutics';
      case 'PHARMA QUALITY ASSURANCE': return 'Pharma Quality Assurance';
      case 'PHARMQA': return 'Pharma Quality Assurance';
      default: return branchName; // Return original if no mapping found
    }
  }
  
  // Degree branches
  if (courseNameUpper.includes('DEGREE')) {
    switch (branchNameUpper) {
      case 'AGRICULTURE': return 'Agriculture';
      case 'HORTICULTURE': return 'Horticulture';
      case 'FOOD TECHNOLOGY': return 'Food Technology';
      case 'FOODTECH': return 'Food Technology';
      case 'FISHERIES': return 'Fisheries';
      case 'FOOD SCIENCE & NUTRITION': return 'Food Science & Nutrition';
      case 'FOODSCIENCE': return 'Food Science & Nutrition';
      default: return branchName; // Return original if no mapping found
    }
  }
  
  return branchName; // Return original if no mapping found
}

// Helper to normalize gender with case-insensitive handling
function normalizeGender(gender) {
  if (!gender) return null;
  
  const genderUpper = gender.toUpperCase();
  
  // Handle various gender formats
  if (genderUpper === 'MALE' || genderUpper === 'M' || genderUpper === 'BOY') {
    return 'Male';
  }
  if (genderUpper === 'FEMALE' || genderUpper === 'F' || genderUpper === 'GIRL') {
    return 'Female';
  }
  
  return null; // Invalid gender
}

// Helper to normalize category with case-insensitive handling
function normalizeCategory(category) {
  if (!category) return null;
  
  const categoryUpper = category.toUpperCase();
  
  // Handle various category formats
  switch (categoryUpper) {
    case 'A+':
    case 'A PLUS':
    case 'A_PLUS':
      return 'A+';
    case 'A':
      return 'A';
    case 'B+':
    case 'B PLUS':
    case 'B_PLUS':
      return 'B+';
    case 'B':
      return 'B';
    case 'C':
      return 'C';
    default:
      return null; // Invalid category
  }
}

// Helper to normalize course names for database lookup
function normalizeCourseName(courseName) {
  if (!courseName) return courseName;
  
  const courseUpper = courseName.toUpperCase();
  
  // Map common variations to database names
  if (courseUpper === 'BTECH' || courseUpper === 'B.TECH' || courseUpper === 'B TECH') {
    return 'B.Tech';
  }
  if (courseUpper === 'DIPLOMA') {
    return 'Diploma';
  }
  if (courseUpper === 'PHARMACY') {
    return 'Pharmacy';
  }
  if (courseUpper === 'DEGREE') {
    return 'Degree';
  }
  
  return courseName; // Return original if no mapping found
}

// Helper to extract end year from batch or academic year
function getEndYear(str) {
  if (!str) return null;
  const parts = str.split('-');
  return parts.length === 2 ? parseInt(parts[1], 10) : null;
}

// Helper to calculate current year based on batch and current date
// Now integrates with academic calendar if available
async function calculateCurrentYear(batch, courseDuration = 4, courseId = null) {
  if (!batch) return 1;
  
  // Extract start year from batch (e.g., "2022-2026" -> 2022)
  const batchParts = batch.split('-');
  const startYear = parseInt(batchParts[0], 10);
  
  if (isNaN(startYear)) return 1;
  
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1; // January is 0
  
  // Try to use academic calendar if courseId is provided
  if (courseId) {
    try {
      const AcademicCalendar = (await import('../models/AcademicCalendar.js')).default;
      
      // Find the current academic year based on current date
      const currentAcademicYear = `${currentYear}-${currentYear + 1}`;
      
      // Look for academic calendar entries for this course and academic year
      const academicCalendar = await AcademicCalendar.findOne({
        course: courseId,
        academicYear: currentAcademicYear,
        isActive: true
      }).sort({ yearOfStudy: 1, semester: 1 });
      
      if (academicCalendar) {
        console.log(`📅 Found academic calendar for course ${courseId}, academic year ${currentAcademicYear}`);
        
        // Find the current semester based on current date
        const currentSemester = await AcademicCalendar.findOne({
          course: courseId,
          academicYear: currentAcademicYear,
          startDate: { $lte: currentDate },
          endDate: { $gte: currentDate },
          isActive: true
        });
        
        if (currentSemester) {
          console.log(`📅 Current semester found: Year ${currentSemester.yearOfStudy}, Semester ${currentSemester.semester}`);
          return currentSemester.yearOfStudy;
        } else {
          // If no current semester found, find the most recent past semester
          const pastSemester = await AcademicCalendar.findOne({
            course: courseId,
            academicYear: currentAcademicYear,
            endDate: { $lt: currentDate },
            isActive: true
          }).sort({ yearOfStudy: -1, semester: -1 });
          
          if (pastSemester) {
            console.log(`📅 Using most recent past semester: Year ${pastSemester.yearOfStudy}, Semester ${pastSemester.semester}`);
            return pastSemester.yearOfStudy;
          }
        }
      }
    } catch (error) {
      console.log(`⚠️ Error accessing academic calendar, falling back to old logic:`, error.message);
    }
  }
  
  // Fallback to old logic if no academic calendar data
  console.log(`📅 No academic calendar data found, using old logic for batch ${batch}`);
  
  // Calculate years since batch started
  let yearsSinceStart = currentYear - startYear;
  
  // If we're in the first half of the year (before July), 
  // students are still in the previous academic year
  if (currentMonth < 7) {
    yearsSinceStart = Math.max(0, yearsSinceStart - 1);
  }
  
  // Calculate current year (1-based, so add 1)
  const currentYearOfStudy = Math.min(yearsSinceStart + 1, courseDuration);
  const finalYear = Math.max(1, currentYearOfStudy);
  
  console.log(`Year calculation for batch ${batch} (old logic):`, {
    startYear,
    currentYear,
    currentMonth,
    yearsSinceStart,
    courseDuration,
    currentYearOfStudy,
    finalYear
  });
  
  return finalYear;
}

// Validate academic year
const validateAcademicYear = (year) => {
  if (!/^\d{4}-\d{4}$/.test(year)) return false;
  const [start, end] = year.split('-').map(Number);
  return end === start + 1;
};

// Preview bulk student upload
export const previewBulkUpload = async (req, res, next) => {
  if (!req.file) {
    return next(createError(400, 'No Excel file uploaded.'));
  }

  const results = {
    validStudents: [],
    invalidStudents: [],
    rawData: [], // Add raw data for debugging
  };

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = xlsx.utils.sheet_to_json(worksheet);

    if (!jsonData || jsonData.length === 0) {
      return next(createError(400, 'Excel file is empty or data could not be read.'));
    }

    // Debug: Log the first row to see actual column names
    console.log('First row from Excel:', jsonData[0]);
    console.log('Available columns:', Object.keys(jsonData[0]));
    console.log('Total rows:', jsonData.length);

    // Import models for validation
    const CourseModel = (await import('../models/Course.js')).default;
    const BranchModel = (await import('../models/Branch.js')).default;

    for (let i = 0; i < jsonData.length; i++) {
      const row = jsonData[i];
      const rowIndex = i + 2;
      
      // Store raw data for debugging
      results.rawData.push({
        row: rowIndex,
        data: row,
        columnNames: Object.keys(row)
      });

      // Flexible column mapping - handle different possible column names
      const Name = row.Name || row.name || row['Student Name'] || row['STUDENT NAME'] || row['Full Name'] || row['FULL NAME'];
      const RollNumber = row.RollNumber || row.rollNumber || row['Roll Number'] || row['ROLL NUMBER'] || row['Roll No'] || row['ROLL NO'];
      const Gender = row.Gender || row.gender || row['Student Gender'] || row['STUDENT GENDER'];
      const Course = row.Course || row.course || row['Program'] || row['PROGRAM'] || row['Degree'] || row['DEGREE'];
      const Branch = row.Branch || row.branch || row['Specialization'] || row['SPECIALIZATION'] || row['Department'] || row['DEPARTMENT'];
      const Year = row.Year || row.year || row['Year of Study'] || row['YEAR OF STUDY'] || row['Current Year'] || row['CURRENT YEAR'];
      const Category = row.Category || row.category || row['Student Category'] || row['STUDENT CATEGORY'] || row['Fee Category'] || row['FEE CATEGORY'];
      const RoomNumber = row.RoomNumber || row.roomNumber || row['Room Number'] || row['ROOM NUMBER'] || row['Room No'] || row['ROOM NO'];
      const StudentPhone = row.StudentPhone || row.studentPhone || row['Student Phone'] || row['STUDENT PHONE'] || row['Phone'] || row['PHONE'];
      const ParentPhone = row.ParentPhone || row.parentPhone || row['Parent Phone'] || row['PARENT PHONE'] || row['Guardian Phone'] || row['GUARDIAN PHONE'];
      const Batch = row.Batch || row.batch || row['Batch Year'] || row['BATCH YEAR'] || row['Admission Batch'] || row['ADMISSION BATCH'];
      const AcademicYear = row.AcademicYear || row.academicYear || row['Academic Year'] || row['ACADEMIC YEAR'] || row['Current Academic Year'] || row['CURRENT ACADEMIC YEAR'];
      const Email = row.Email || row.email || row['Email'] || row['EMAIL'];

      const errors = {};

      // Validate required fields
      if (!Name) errors.Name = 'Name is required.';
      if (!RollNumber) errors.RollNumber = 'Roll number is required.';
      if (!ParentPhone) errors.ParentPhone = 'Parent phone is required.';
      if (!RoomNumber) errors.RoomNumber = 'Room number is required.';
      if (!Batch) errors.Batch = 'Batch is required.';
      if (!AcademicYear) errors.AcademicYear = 'Academic year is required.';

      // Validate gender with case-insensitive handling
      if (!Gender) {
        errors.Gender = 'Gender is required.';
      } else {
        const normalizedGender = normalizeGender(String(Gender).trim());
        if (!normalizedGender) {
          errors.Gender = `Invalid gender "${String(Gender).trim()}". Must be Male/Female/M/F/Boy/Girl.`;
        }
      }

      // Validate course with case-insensitive handling
      if (!Course) {
        errors.Course = 'Course is required.';
      } else {
        const normalizedCourseName = normalizeCourseName(String(Course).trim());
        const courseDoc = await CourseModel.findOne({ 
          name: { $regex: new RegExp(`^${normalizedCourseName}$`, 'i') },
          isActive: true 
        });
        
        if (!courseDoc) {
          errors.Course = `Course "${String(Course).trim()}" (normalized to "${normalizedCourseName}") not found in the database.`;
        }
      }

      // Validate branch with case-insensitive handling
      if (!Branch) {
        errors.Branch = 'Branch is required.';
      } else if (Course) {
        const normalizedCourseName = normalizeCourseName(String(Course).trim());
        const branchNameMapping = getBranchNameMapping(String(Course).trim(), String(Branch).trim());
        
        const courseDoc = await CourseModel.findOne({ 
          name: { $regex: new RegExp(`^${normalizedCourseName}$`, 'i') },
          isActive: true 
        });
        
        if (courseDoc) {
          const branchDoc = await BranchModel.findOne({ 
            name: { $regex: new RegExp(`^${branchNameMapping}$`, 'i') },
            course: courseDoc._id,
            isActive: true 
          });
          
          if (!branchDoc) {
            // Try alternative branch name formats
            const alternativeBranchNames = [
              branchNameMapping.toUpperCase(),
              branchNameMapping.toLowerCase(),
              branchNameMapping.charAt(0).toUpperCase() + branchNameMapping.slice(1).toLowerCase()
            ];
            
            let foundBranch = false;
            for (const altBranchName of alternativeBranchNames) {
              const altBranchDoc = await BranchModel.findOne({ 
                name: { $regex: new RegExp(`^${altBranchName}$`, 'i') },
                course: courseDoc._id,
                isActive: true 
              });
              if (altBranchDoc) {
                foundBranch = true;
                break;
              }
            }
            
            if (!foundBranch) {
              errors.Branch = `Branch "${String(Branch).trim()}" (mapped to "${branchNameMapping}") not found for course "${normalizedCourseName}".`;
            }
          }
        }
      }

      // Validate category with case-insensitive handling
      if (!Category) {
        errors.Category = 'Category is required.';
      } else {
        const normalizedCategory = normalizeCategory(String(Category).trim());
        if (!normalizedCategory) {
          errors.Category = `Invalid category "${String(Category).trim()}". Must be A+, A, B+, B for Male or A+, A, B, C for Female.`;
        }
      }

      // Validate year (optional but must be valid if provided)
      if (Year) {
        const yearValue = parseInt(Year, 10);
        if (isNaN(yearValue) || yearValue < 1 || yearValue > 10) {
          errors.Year = `Invalid year "${Year}". Must be a number between 1 and 10.`;
        }
      } else {
        // Calculate and add the year based on batch for preview
        if (Batch && Course) {
          const normalizedCourseName = normalizeCourseName(String(Course).trim());
          const courseDoc = await CourseModel.findOne({ 
            name: { $regex: new RegExp(`^${normalizedCourseName}$`, 'i') },
            isActive: true 
          });
          
          if (courseDoc) {
            const courseDuration = courseDoc.duration || 4;
            const calculatedYear = await calculateCurrentYear(Batch, courseDuration, courseDoc._id);
            row.Year = calculatedYear;
            console.log(`Preview: Calculated year for batch ${Batch}: ${calculatedYear} (course: ${normalizedCourseName}, duration: ${courseDuration})`);
          }
        }
      }

      // Validate student phone (optional but must be valid if provided)
      if (StudentPhone && !/^[0-9]{10}$/.test(String(StudentPhone))) {
        errors.StudentPhone = 'Must be 10 digits.';
      }

      // Validate parent phone
      if (ParentPhone && !/^[0-9]{10}$/.test(String(ParentPhone))) {
        errors.ParentPhone = 'Must be 10 digits.';
      }

      // Validate email (optional but must be valid if provided)
      if (Email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(Email))) {
        errors.Email = 'Invalid email format.';
      }

      // Validate batch format
      if (Batch) {
        if (/^\d{4}$/.test(String(Batch))) {
          // Single year provided - validate it's a reasonable year
          const startYear = parseInt(Batch, 10);
          if (startYear < 2000 || startYear > 2100) {
            errors.Batch = 'Starting year must be between 2000-2100.';
          }
        } else if (!/^\d{4}-\d{4}$/.test(String(Batch))) {
          errors.Batch = 'Format must be YYYY-YYYY or just YYYY.';
        }
      }

      // Validate academic year format
      if (AcademicYear && !/^\d{4}-\d{4}$/.test(String(AcademicYear))) {
        errors.AcademicYear = 'Format must be YYYY-YYYY.';
      } else if (AcademicYear) {
        const [start, end] = String(AcademicYear).split('-').map(Number);
        if (end !== start + 1) {
          errors.AcademicYear = 'Years must be consecutive.';
        }
      }

      // Check if there are any errors
      if (Object.keys(errors).length > 0) {
        results.invalidStudents.push({
          row: rowIndex,
          data: row,
          errors: errors
        });
      } else {
      results.validStudents.push(row);
      }
    }

    res.json({ 
      success: true, 
      data: results,
      debug: {
        totalRows: jsonData.length,
        firstRowColumns: Object.keys(jsonData[0]),
        firstRowData: jsonData[0]
      }
    });

  } catch (error) {
    next(error);
  }
};

// Bulk add new students (now for committing)
export const bulkAddStudents = async (req, res, next) => {
  const { students } = req.body;
  if (!students || !Array.isArray(students)) {
    return next(createError(400, 'A list of students is required.'));
  }

  const results = {
    successCount: 0,
    failureCount: 0,
    addedStudents: [],
    errors: [],
    emailResults: {
      sent: 0,
      failed: 0,
      errors: []
    }
  };

  for (const studentData of students) {
    // Flexible column mapping - handle different possible column names
    const Name = studentData.Name || studentData.name || studentData['Student Name'] || studentData['STUDENT NAME'] || studentData['Full Name'] || studentData['FULL NAME'];
    const RollNumber = studentData.RollNumber || studentData.rollNumber || studentData['Roll Number'] || studentData['ROLL NUMBER'] || studentData['Roll No'] || studentData['ROLL NO'];
    const Gender = studentData.Gender || studentData.gender || studentData['Student Gender'] || studentData['STUDENT GENDER'];
    const Course = studentData.Course || studentData.course || studentData['Program'] || studentData['PROGRAM'] || studentData['Degree'] || studentData['DEGREE'];
    const Branch = studentData.Branch || studentData.branch || studentData['Specialization'] || studentData['SPECIALIZATION'] || studentData['Department'] || studentData['DEPARTMENT'];
    const Year = studentData.Year || studentData.year || studentData['Year of Study'] || studentData['YEAR OF STUDY'] || studentData['Current Year'] || studentData['CURRENT YEAR'];
    const Category = studentData.Category || studentData.category || studentData['Student Category'] || studentData['STUDENT CATEGORY'] || studentData['Fee Category'] || studentData['FEE CATEGORY'];
    const RoomNumber = studentData.RoomNumber || studentData.roomNumber || studentData['Room Number'] || studentData['ROOM NUMBER'] || studentData['Room No'] || studentData['ROOM NO'];
    const StudentPhone = studentData.StudentPhone || studentData.studentPhone || studentData['Student Phone'] || studentData['STUDENT PHONE'] || studentData['Phone'] || studentData['PHONE'];
    const ParentPhone = studentData.ParentPhone || studentData.parentPhone || studentData['Parent Phone'] || studentData['PARENT PHONE'] || studentData['Guardian Phone'] || studentData['GUARDIAN PHONE'];
    const Batch = studentData.Batch || studentData.batch || studentData['Batch Year'] || studentData['BATCH YEAR'] || studentData['Admission Batch'] || studentData['ADMISSION BATCH'];
    const AcademicYear = studentData.AcademicYear || studentData.academicYear || studentData['Academic Year'] || studentData['ACADEMIC YEAR'] || studentData['Current Academic Year'] || studentData['CURRENT ACADEMIC YEAR'];
    const Email = studentData.Email || studentData.email || studentData['Email'] || studentData['EMAIL'];

    try {
      const rollNumberUpper = String(RollNumber).trim().toUpperCase();
      
      // Check for duplicates in both User and TempStudent collections
      const [existingStudent, existingTempStudent] = await Promise.all([
        User.findOne({ rollNumber: rollNumberUpper }),
        TempStudent.findOne({ rollNumber: rollNumberUpper })
      ]);

      if (existingStudent) {
        results.failureCount++;
        results.errors.push({ error: `Student with roll number ${rollNumberUpper} already exists in the main database.`, details: studentData });
        continue;
      }

      if (existingTempStudent) {
        results.failureCount++;
        results.errors.push({ error: `Student with roll number ${rollNumberUpper} already exists in temporary records. Please clear temp students first or use a different roll number.`, details: studentData });
        continue;
      }

      const generatedPassword = User.generateRandomPassword();

      // Find course and branch ObjectIds by name with robust case handling
      const CourseModel = (await import('../models/Course.js')).default;
      const BranchModel = (await import('../models/Branch.js')).default;
      
      // Normalize course name for case-insensitive matching
      const normalizedCourseName = normalizeCourseName(String(Course).trim());
      console.log(`Looking for course: "${String(Course).trim()}" (normalized to "${normalizedCourseName}")`);
      
      let courseDoc = await CourseModel.findOne({ 
        name: { $regex: new RegExp(`^${normalizedCourseName}$`, 'i') },
        isActive: true 
      });
      
      if (!courseDoc) {
        results.failureCount++;
        results.errors.push({ 
          error: `Course "${normalizedCourseName}" not found in the database.`, 
          details: studentData 
        });
        continue;
      }

      // Map short branch names to full names based on the seeded data
      const branchNameMapping = getBranchNameMapping(String(Course).trim(), String(Branch).trim());
      console.log(`Mapping branch: "${String(Branch).trim()}" to "${branchNameMapping}" for course "${String(Course).trim()}" (normalized to "${normalizedCourseName}")`);
      
      let branchDoc = await BranchModel.findOne({ 
        name: { $regex: new RegExp(`^${branchNameMapping}$`, 'i') },
        course: courseDoc._id,
        isActive: true 
      });

      // Try alternative branch name formats if not found
      if (!branchDoc) {
        const alternativeBranchNames = [
          branchNameMapping.toUpperCase(),
          branchNameMapping.toLowerCase(),
          branchNameMapping.charAt(0).toUpperCase() + branchNameMapping.slice(1).toLowerCase()
        ];
        
        for (const altBranchName of alternativeBranchNames) {
          branchDoc = await BranchModel.findOne({ 
            name: { $regex: new RegExp(`^${altBranchName}$`, 'i') },
            course: courseDoc._id,
            isActive: true 
          });
          if (branchDoc) {
            console.log(`Found branch with alternative name: "${altBranchName}"`);
            break;
          }
        }
      }

      if (!branchDoc) {
        results.failureCount++;
        results.errors.push({ 
          error: `Branch "${String(Branch).trim()}" (mapped to "${branchNameMapping}") not found for course "${normalizedCourseName}".`, 
          details: studentData 
        });
        continue;
      }

      // Handle email properly - only set if provided and not empty
      const emailValue = Email ? String(Email).trim() : '';
      const finalEmail = emailValue === '' ? undefined : emailValue;

      // Normalize gender with case-insensitive handling
      const normalizedGender = normalizeGender(String(Gender).trim());
      if (!normalizedGender) {
        results.failureCount++;
        results.errors.push({ 
          error: `Invalid gender "${String(Gender).trim()}". Must be "Male" or "Female".`, 
          details: studentData 
        });
        continue;
      }

      // Generate hostel ID for bulk students (after gender normalization)
      const hostelId = await generateHostelId(normalizedGender);
      console.log('Generated hostel ID for bulk student:', hostelId, 'for gender:', normalizedGender);

      // Normalize category with case-insensitive handling
      const normalizedCategory = normalizeCategory(String(Category).trim());
      if (!normalizedCategory) {
        results.failureCount++;
        results.errors.push({ 
          error: `Invalid category "${String(Category).trim()}". Must be A+, A, B+, B for Male or A+, A, B, C for Female.`, 
          details: studentData 
        });
        continue;
      }

      // Store batch as admission start year (YYYY), matching SQL
      const finalBatch = normalizeBatchToYear(Batch);
      if (!finalBatch || !/^\d{4}$/.test(finalBatch)) {
        results.failureCount++;
        results.errors.push({
          error: `Invalid batch "${Batch}". Use YYYY (e.g., 2024).`,
          details: studentData
        });
        continue;
      }
      const batchStartYear = parseInt(finalBatch, 10);
      if (batchStartYear < 2000 || batchStartYear > 2100) {
        results.failureCount++;
        results.errors.push({
          error: `Invalid batch year "${finalBatch}". Must be between 2000-2100.`,
          details: studentData
        });
        continue;
      }

      // Calculate year based on batch and current date, or use provided year if available
      let yearValue;
      if (Year) {
        yearValue = parseInt(Year, 10);
        if (isNaN(yearValue) || yearValue < 1 || yearValue > 10) {
          results.failureCount++;
          results.errors.push({
            error: `Invalid year "${Year}". Must be a number between 1 and 10.`,
            details: studentData
          });
          continue;
        }
      } else {
        const courseDuration = courseDoc.duration || 4;
        yearValue = await calculateCurrentYear(finalBatch, courseDuration, courseDoc._id);
        console.log(`Calculated year for batch ${finalBatch}: ${yearValue} (course duration: ${courseDuration})`);
      }

      const newStudent = new User({
        name: String(Name).trim(),
        rollNumber: rollNumberUpper,
        password: generatedPassword,
        role: 'student',
        gender: normalizedGender,
        course: courseDoc._id, // Use ObjectId
        year: yearValue,
        branch: branchDoc._id, // Use ObjectId
        category: normalizedCategory,
        mealType: 'non-veg', // Default to non-veg for bulk upload
        parentPermissionForOuting: true, // Default to true for bulk upload
        roomNumber: String(RoomNumber).trim(),
        studentPhone: StudentPhone ? String(StudentPhone).trim() : '',
        parentPhone: String(ParentPhone).trim(),
        batch: finalBatch,
        academicYear: String(AcademicYear).trim(),
        email: finalEmail, // Use properly handled email
        hostelId,
        isPasswordChanged: false,
      });

      const savedStudent = await newStudent.save();

      const tempStudent = new TempStudent({
        name: savedStudent.name,
        rollNumber: savedStudent.rollNumber,
        studentPhone: savedStudent.studentPhone,
        email: savedStudent.email || '', // Handle undefined email
        generatedPassword: generatedPassword,
        isFirstLogin: true,
        mainStudentId: savedStudent._id,
      });
      await tempStudent.save();

      // Create fee reminder for the student
      try {
        const registrationDate = new Date();
        await FeeReminder.createForStudent(
          savedStudent._id,
          registrationDate,
          String(AcademicYear).trim()
        );
        console.log('✅ Fee reminder created for bulk student:', savedStudent.rollNumber);
      } catch (feeError) {
        console.error('❌ Error creating fee reminder for bulk student:', savedStudent.rollNumber, feeError);
        // Don't fail the registration if fee reminder creation fails
      }

      await syncStudentHostelFeeSafely(savedStudent, {
        academicYear: String(AcademicYear).trim()
      });

      // Send email notification to student
      let emailSent = false;
      let emailError = null;
      
      if (finalEmail) {
        try {
          const loginUrl = `${req.protocol}://${req.get('host')}/login`;
          await sendStudentRegistrationEmail(
            finalEmail,
            String(Name).trim(),
            rollNumberUpper,
            generatedPassword,
            loginUrl
          );
          emailSent = true;
          results.emailResults.sent++;
          console.log('📧 Bulk registration email sent successfully to:', finalEmail);
        } catch (emailErr) {
          emailError = emailErr.message;
          results.emailResults.failed++;
          results.emailResults.errors.push({
            email: finalEmail,
            student: String(Name).trim(),
            rollNumber: rollNumberUpper,
            error: emailErr.message
          });
          console.error('📧 Failed to send bulk registration email to:', finalEmail, emailErr);
          // Don't fail the registration if email fails
        }
      }

      results.successCount++;
      results.addedStudents.push({
        name: savedStudent.name,
        rollNumber: savedStudent.rollNumber,
        generatedPassword: generatedPassword,
        emailSent,
        emailError
      });

    } catch (error) {
      results.failureCount++;
      results.errors.push({ error: error.message, details: studentData });
    }
  }

  res.json({
    success: true,
    message: 'Bulk upload process completed.',
    data: results
  });
};

// Get all students with pagination and filters
export const getStudents = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, course, branch, gender, category, roomNumber, batch, academicYear, year, search, hostelStatus, hostel } = req.query;
    const academicFilters = { course, branch, year: year ? parseInt(year, 10) : undefined };
    const hasAcademicFilter = !!(course || branch || year);

    let students;
    let count;

    if (academicYear) {
      const result = await fetchStudentsForAcademicYear({
        academicYear,
        filters: { gender, category, roomNumber, batch, search, hostelStatus, hostel },
        page,
        limit,
        academicFilters
      });
      students = result.students;
      count = result.count;
    } else {
      const query = { role: 'student' };

      if (gender) query.gender = gender;
      if (category) query.category = category;
      if (roomNumber) query.roomNumber = roomNumber;
      if (batch) query.batch = batch;
      if (hostelStatus) query.hostelStatus = hostelStatus;
      if (hostel) query.hostel = hostel;

      if (search) {
        const searchRegex = new RegExp(search, 'i');
        query.$or = [
          { name: searchRegex },
          { rollNumber: searchRegex }
        ];
      }

      const populateOpts = [
        { path: 'hostel', select: '_id name' },
        { path: 'hostelCategory', select: '_id name' }
      ];

      if (hasAcademicFilter) {
        const allDocs = await User.find(query)
          .select('-password')
          .populate(populateOpts)
          .sort({ createdAt: -1 })
          .lean();
        let enriched = await enrichStudentsAcademics(allDocs);
        enriched = enriched.filter(s => matchesAcademicFilters(s, academicFilters));
        count = enriched.length;
        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        students = enriched.slice((pageNum - 1) * limitNum, pageNum * limitNum);
      } else {
        students = await User.find(query)
          .select('-password')
          .populate(populateOpts)
          .sort({ createdAt: -1 })
          .limit(limit * 1)
          .skip((page - 1) * limit)
          .lean();
        students = await enrichStudentsAcademics(students);
        count = await User.countDocuments(query);
      }
    }

    students = await attachResolvedExpiryDates(students);

    res.json({
      success: true,
      data: {
        students,
        totalPages: Math.ceil(count / limit),
        currentPage: page,
        totalStudents: count
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get student by ID
export const getStudentById = async (req, res, next) => {
  try {
    const student = await User.findOne({ _id: req.params.id, role: 'student' })
      .select('-password')
      .populate('hostel', '_id name')
      .populate('hostelCategory', '_id name')
      .lean();
    
    if (!student) {
      throw createError(404, 'Student not found');
    }

    const enriched = await enrichStudentAcademics(student);

    res.json({
      success: true,
      data: enriched
    });
  } catch (error) {
    next(error);
  }
};

// Update student
export const updateStudent = async (req, res, next) => {
  try {
  const { 
      name, 
      rollNumber,
      admissionNumber,
      course, 
      year,
      branch, 
      gender,
      category,
      hostel,
      hostelCategory,
      room,
      mealType,
      parentPermissionForOuting,
      roomNumber, 
      bedNumber,
      lockerNumber,
      studentPhone, 
      parentPhone,
      batch,
      academicYear,
      hostelStatus,
      email,
      concession
    } = req.body;
    
    console.log('Update payload (adminController):', req.body); // Debug log
    const student = await User.findOne({ _id: req.params.id, role: 'student' });
    if (!student) {
      throw createError(404, 'Student not found');
    }

    const previousHostelStatus = student.hostelStatus;
    const academicSnapshot = await enrichStudentAcademics(student);

    // Resolve hostel/category for room validation under new hierarchy
    const targetHostelId = hostel || student.hostel;
    let targetCategoryId = hostelCategory;
    let targetCategoryName = category;

    // If category name is provided in payload, resolve its ID to ensure consistency
    if (category) {
      if (!targetHostelId) {
        throw createError(400, 'Hostel is required to resolve category.');
      }
      const categoryDoc = await HostelCategory.findOne({ hostel: targetHostelId, name: category.trim() });
      if (!categoryDoc) {
        throw createError(400, `Category "${category}" not found for the selected hostel.`);
      }
      targetCategoryId = categoryDoc._id;
      targetCategoryName = categoryDoc.name;
    } 
    // If category name wasn't provided but hostelCategory ID was, use it
    else if (hostelCategory) {
      targetCategoryId = hostelCategory;
    }

    // Fallback to existing student values if not provided in request
    if (!targetCategoryId) targetCategoryId = student.hostelCategory;
    if (!targetCategoryName) targetCategoryName = student.category;

    // Validate hostel exists if provided
    if (targetHostelId) {
      const hostelExists = await Hostel.exists({ _id: targetHostelId });
      if (!hostelExists) {
        throw createError(400, 'Invalid hostel.');
      }
    }

    // Validate category exists within hostel if provided
    if (targetCategoryId) {
      const categoryExists = await HostelCategory.exists({ _id: targetCategoryId, hostel: targetHostelId });
      if (!categoryExists) {
        throw createError(400, 'Invalid category for the selected hostel.');
      }
    }

    // Validate room number against Room model using hostel+category hierarchy
    let roomDoc = null;
    if (roomNumber) {
      const roomQuery = { roomNumber };
      if (targetHostelId) roomQuery.hostel = targetHostelId;
      if (targetCategoryId) roomQuery.category = targetCategoryId;

      roomDoc = await Room.findOne(roomQuery);
      if (!roomDoc) {
        throw createError(400, 'Invalid room number for the selected hostel/category.');
      }
    }

    // Update student fields

    // Validate academic year
    if (academicYear && !validateAcademicYear(academicYear)) {
      throw createError(400, 'Invalid Academic Year format. Must be YYYY-YYYY with a 1-year difference.');
    }

    // Validate phone numbers
    if (studentPhone && studentPhone.trim() && !/^[0-9]{10}$/.test(studentPhone)) {
      throw createError(400, 'Student phone number must be 10 digits.');
    }
    if (parentPhone && !/^[0-9]{10}$/.test(parentPhone)) {
      throw createError(400, 'Parent phone number must be 10 digits.');
    }

    // Validate email if provided
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw createError(400, 'Invalid email address format.');
    }

    // Validate hostelStatus if present
    if (hostelStatus && !['Active', 'Inactive'].includes(hostelStatus)) {
      throw createError(400, 'Invalid hostel status');
    }

    // Validate bed and locker assignment if provided (scoped to academic year)
    const targetAcademicYear = academicYear || student.academicYear;
    let occupancyRoomDoc = roomDoc;
    if (!occupancyRoomDoc && (bedNumber || lockerNumber)) {
      occupancyRoomDoc = await Room.findById(student.room);
    }

    if (bedNumber && occupancyRoomDoc) {
      const bedOccupied = await isBedOccupiedForAcademicYear(
        occupancyRoomDoc,
        bedNumber,
        targetAcademicYear,
        student._id
      );
      if (bedOccupied) {
        throw createError(400, 'Selected bed is already occupied for this academic year');
      }

      const roomToCheck = roomNumber || student.roomNumber;
      const expectedBedFormat = `${roomToCheck} Bed `;
      if (!bedNumber.startsWith(expectedBedFormat)) {
        throw createError(400, 'Invalid bed number format for this room');
      }
    }

    if (lockerNumber && occupancyRoomDoc) {
      const lockerOccupied = await isLockerOccupiedForAcademicYear(
        occupancyRoomDoc,
        lockerNumber,
        targetAcademicYear,
        student._id
      );
      if (lockerOccupied) {
        throw createError(400, 'Selected locker is already occupied for this academic year');
      }

      const roomToCheck = roomNumber || student.roomNumber;
      const expectedLockerFormat = `${roomToCheck} Locker `;
      if (!lockerNumber.startsWith(expectedLockerFormat)) {
        throw createError(400, 'Invalid locker number format for this room');
      }
    }

    // Handle guardian photo uploads (student photo comes from SDMS)
    if (req.files) {
      if (req.files.guardianPhoto1 && req.files.guardianPhoto1[0]) {
        // Delete old photo if exists
        if (student.guardianPhoto1) {
          try {
            await deleteFromS3(student.guardianPhoto1);
          } catch (error) {
            console.error('Error deleting old guardian photo 1:', error);
          }
        }
        // Upload new photo
        student.guardianPhoto1 = await uploadToS3(req.files.guardianPhoto1[0], 'guardian-photos');
      }
      if (req.files.guardianPhoto2 && req.files.guardianPhoto2[0]) {
        // Delete old photo if exists
        if (student.guardianPhoto2) {
          try {
            await deleteFromS3(student.guardianPhoto2);
          } catch (error) {
            console.error('Error deleting old guardian photo 2:', error);
          }
        }
        // Upload new photo
        student.guardianPhoto2 = await uploadToS3(req.files.guardianPhoto2[0], 'guardian-photos');
      }
    }

    // Update fields
    if (name) student.name = name;
    if (rollNumber?.trim()) student.rollNumber = rollNumber.trim().toUpperCase();
    if (admissionNumber !== undefined) student.admissionNumber = admissionNumber ? admissionNumber.toUpperCase() : undefined;
    // course, branch, year are managed in SQL — not updated in MongoDB
    if (gender) student.gender = gender;
    // Set category string from provided value or derived hostelCategory name
    if (category || targetCategoryName) student.category = category || targetCategoryName;
    if (mealType) student.mealType = mealType;
    if (parentPermissionForOuting !== undefined) {
      console.log('🔧 Updating parentPermissionForOuting:', parentPermissionForOuting, 'type:', typeof parentPermissionForOuting);
      student.parentPermissionForOuting = Boolean(parentPermissionForOuting);
      console.log('🔧 Updated student.parentPermissionForOuting to:', student.parentPermissionForOuting);
    }
    if (roomNumber) {
      student.roomNumber = roomNumber;
      if (roomDoc?._id) {
        student.room = roomDoc._id;
      }
    }
    if (targetHostelId) student.hostel = targetHostelId;
    if (targetCategoryId) student.hostelCategory = targetCategoryId;
    if (bedNumber !== undefined) student.bedNumber = bedNumber;
    if (lockerNumber !== undefined) student.lockerNumber = lockerNumber;
    // studentPhone / parentPhone — read from SQL at display time (not updated in MongoDB)
    if (batch) student.batch = normalizeBatchToYear(batch);
    if (academicYear) student.academicYear = academicYear;
    if (hostelStatus) student.hostelStatus = hostelStatus;
    if (email) student.email = email;

    // Handle concession update - if concession is changed, reset approval status and track who requested
    if (concession !== undefined) {
      const newConcessionAmount = Number(concession) || 0;
      const oldConcessionAmount = student.concession || 0;
      
      // If concession amount changed, reset approval status
      if (newConcessionAmount !== oldConcessionAmount) {
        student.concession = newConcessionAmount;
        
        if (newConcessionAmount > 0) {
          // New concession set - requires approval
          student.concessionApproved = false;
          student.concessionApprovedBy = null;
          student.concessionApprovedAt = null;
          if (req.admin) {
            student.concessionRequestedBy = req.admin._id;
            student.concessionRequestedAt = new Date();
            
            // Add to history
            if (!student.concessionHistory) {
              student.concessionHistory = [];
            }
            student.concessionHistory.push({
              action: 'requested',
              amount: newConcessionAmount,
              previousAmount: oldConcessionAmount,
              performedBy: req.admin._id,
              performedAt: new Date(),
              notes: ''
            });
          }
          
          // Recalculate fees with new concession
          try {
            const FeeStructure = (await import('../models/FeeStructure.js')).default;
            const feeStructure = await FeeStructure.getFeeStructure(
              student.academicYear,
              academicSnapshot.course,
              academicSnapshot.branch,
              academicSnapshot.year,
              student.category
            );
            if (feeStructure) {
              const concessionAmount = newConcessionAmount;
              student.calculatedTerm1Fee = Math.max(0, feeStructure.term1Fee - concessionAmount);
              let remainingConcession = Math.max(0, concessionAmount - feeStructure.term1Fee);
              student.calculatedTerm2Fee = Math.max(0, feeStructure.term2Fee - remainingConcession);
              remainingConcession = Math.max(0, remainingConcession - feeStructure.term2Fee);
              student.calculatedTerm3Fee = Math.max(0, feeStructure.term3Fee - remainingConcession);
              student.totalCalculatedFee = student.calculatedTerm1Fee + student.calculatedTerm2Fee + student.calculatedTerm3Fee;
            }
          } catch (error) {
            console.error('Error recalculating fees:', error);
          }
        } else {
          // Concession removed - reset all concession-related fields
          student.concession = 0;
          student.concessionApproved = false;
          student.concessionApprovedBy = null;
          student.concessionApprovedAt = null;
          student.concessionRequestedBy = null;
          student.concessionRequestedAt = null;
          
          // Reset calculated fees to original
          try {
            const FeeStructure = (await import('../models/FeeStructure.js')).default;
            const feeStructure = await FeeStructure.getFeeStructure(
              student.academicYear,
              academicSnapshot.course,
              academicSnapshot.branch,
              academicSnapshot.year,
              student.category
            );
            if (feeStructure) {
              student.calculatedTerm1Fee = feeStructure.term1Fee;
              student.calculatedTerm2Fee = feeStructure.term2Fee;
              student.calculatedTerm3Fee = feeStructure.term3Fee;
              student.totalCalculatedFee = feeStructure.totalFee;
            }
          } catch (error) {
            console.error('Error recalculating fees:', error);
          }
        }
      }
    }

    // Graduation status auto-update on manual edit (year/course from SQL)
    let maxYear = 3;
    try {
      const courseName = academicSnapshot.course;
      maxYear = getCourseDuration(String(courseName));
    } catch (error) {
      console.error('Error fetching course for graduation status:', error);
      const courseKey = Object.keys(COURSES).find(key => COURSES[key] === academicSnapshot.course);
      maxYear = (courseKey === 'BTECH' || courseKey === 'PHARMACY') ? 4 : 3;
    }

    const batchEndYear = getBatchEndYear(student.batch, maxYear);
    const academicEndYear = getEndYear(student.academicYear);
    const effectiveYear = academicSnapshot.year || student.year;
    if (
      effectiveYear >= maxYear &&
      batchEndYear &&
      academicEndYear &&
      batchEndYear === academicEndYear
    ) {
      student.graduationStatus = 'Graduated';
    } else {
      student.graduationStatus = 'Enrolled';
    }

    if (hostelStatus === 'Inactive' && previousHostelStatus === 'Active') {
      student.bedNumber = undefined;
      student.lockerNumber = undefined;
      if (['Active', 'Extended'].includes(student.applicationStatus)) {
        student.applicationStatus = 'Expired';
      }
      await closeActiveOccupancyHistory({
        studentId: student._id,
        academicYear: student.academicYear,
        status: 'Withdrawn',
        expiryReason: 'admin_inactive'
      });
    }

    await repairMissingRollNumber(student, academicSnapshot);
    await student.save({ validateModifiedOnly: true });

    await syncStudentHostelFeeSafely(student);

    const enrichedStudent = await enrichStudentAcademics(student.toObject());

    res.json({
      success: true,
      data: {
        student: {
          id: student._id,
          name: student.name,
          rollNumber: student.rollNumber,
          gender: student.gender,
          course: enrichedStudent.course ?? academicSnapshot.course,
          year: enrichedStudent.year ?? academicSnapshot.year,
          branch: enrichedStudent.branch ?? academicSnapshot.branch,
          category: student.category,
          mealType: student.mealType,
          parentPermissionForOuting: student.parentPermissionForOuting,
          roomNumber: student.roomNumber,
          bedNumber: student.bedNumber,
          lockerNumber: student.lockerNumber,
          studentPhone: enrichedStudent.studentPhone,
          parentPhone: enrichedStudent.parentPhone,
          email: student.email,
          batch: student.batch,
          academicYear: student.academicYear,
          hostelStatus: student.hostelStatus,
          studentPhoto: student.studentPhoto,
          guardianPhoto1: student.guardianPhoto1,
          guardianPhoto2: student.guardianPhoto2
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// Delete student (per academic year, or full account if last enrollment)
export const deleteStudent = async (req, res, next) => {
  try {
    const student = await User.findOne({ _id: req.params.id, role: 'student' });

    if (!student) {
      throw createError(404, 'Student not found');
    }

    const academicYear = req.query.academicYear || student.academicYear;
    if (!academicYear || !validateAcademicYear(academicYear)) {
      throw createError(400, 'Valid academicYear is required (YYYY-YYYY)');
    }

    const removal = await removeStudentEnrollmentForAcademicYear({
      studentId: student._id,
      academicYear
    });

    if (!removal.ok) {
      const status = removal.code === 'NOT_CURRENT_YEAR' ? 400 : 404;
      throw createError(status, removal.message);
    }

    if (removal.action === 'year_removed') {
      return res.json({
        success: true,
        message: `Removed enrollment for ${academicYear}. Student account kept for other academic years.`,
        data: {
          deletedCompletely: false,
          academicYear,
          remainingEnrollments: removal.remainingEnrollments,
          studentId: student._id
        }
      });
    }

    const studentToRemove = removal.student;

    const enrichedRemoved = await enrichStudentAcademics(studentToRemove.toObject());
    const feesStudentId = resolveFeesStudentId(studentToRemove, enrichedRemoved);
    if (feesStudentId) {
      await deleteAllStudentHostelFeesSafely(feesStudentId);
    }

    const photosToDelete = [
      studentToRemove.studentPhoto,
      studentToRemove.guardianPhoto1,
      studentToRemove.guardianPhoto2
    ].filter(Boolean);

    for (const photoUrl of photosToDelete) {
      try {
        await deleteFromS3(photoUrl);
      } catch (error) {
        console.error('Error deleting photo from S3:', error);
      }
    }

    await Complaint.deleteMany({ student: studentToRemove._id });
    await Leave.deleteMany({ student: studentToRemove._id });
    await RoomOccupancyHistory.deleteMany({ student: studentToRemove._id });
    await FeeReminder.deleteMany({ student: studentToRemove._id });

    const deleteResult = await User.findByIdAndDelete(studentToRemove._id);
    if (!deleteResult) {
      throw createError(500, 'Failed to delete student from database');
    }

    await TempStudent.deleteOne({ mainStudentId: studentToRemove._id });

    res.json({
      success: true,
      message: `Student removed completely (no remaining enrollments for ${academicYear}).`,
      data: {
        deletedCompletely: true,
        academicYear
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get all branches (optionally filter by course)
export const getAllBranches = async (req, res, next) => {
  try {
    const { course } = req.query;
    const query = course ? { course } : {};
    const branches = await Branch.find(query).populate('course');
    res.json({ success: true, data: branches });
  } catch (error) {
    next(error);
  }
};

// (Optional) Get branches by courseId as a param (if you want to keep this route)
export const getBranchesByCourse = async (req, res, next) => {
  try {
    const { courseId } = req.params;
    if (!courseId) {
      return res.status(400).json({ success: false, message: 'Course ID is required' });
    }
    const branches = await Branch.find({ course: courseId }).populate('course');
    res.json({ success: true, data: branches });
  } catch (error) {
    next(error);
  }
};

// Get temporary students summary for admin dashboard
export const getTempStudentsSummary = async (req, res, next) => {
  try {
    // Get all students who haven't changed their password with their hostel IDs and gender
    const studentsWithTempRecords = await User.find({ 
      role: 'student',
      isPasswordChanged: false 
    }).select('_id hostelId gender');

    // Get temp student records only for students who haven't changed their password
    const tempStudents = await TempStudent.find({
      mainStudentId: { $in: studentsWithTempRecords.map(s => s._id) }
    })
    .select('name rollNumber studentPhone generatedPassword createdAt mainStudentId')
    .sort({ createdAt: -1 });

    // Combine temp student data with hostel IDs and gender from main student records
    const tempStudentsWithHostelId = tempStudents.map(tempStudent => {
      const mainStudent = studentsWithTempRecords.find(s => s._id.toString() === tempStudent.mainStudentId.toString());
      return {
        ...tempStudent.toObject(),
        hostelId: mainStudent ? mainStudent.hostelId : null,
        gender: mainStudent ? mainStudent.gender : null
      };
    });

    res.status(200).json({
      success: true,
      data: tempStudentsWithHostelId,
    });
  } catch (error) {
    console.error('Error fetching temporary students summary:', error);
    next(createError(500, 'Failed to fetch temporary student summary.'));
  }
};

// Get total student count for admin dashboard
export const getStudentsCount = async (req, res, next) => {
  try {
    const { course, branch, gender } = req.query;
    
    // Build query for active students
    const query = { 
      role: 'student', 
      hostelStatus: 'Active' 
    };

    // Add filters if provided
    if (course) query.course = course;
    if (branch) query.branch = branch;
    if (gender) query.gender = gender;

    const totalStudents = await User.countDocuments(query);
    
    res.status(200).json({
      success: true,
      data: {
        total: totalStudents,
        count: totalStudents, // Keep for backward compatibility
      },
    });
  } catch (error) {
    console.error('Error fetching total student count:', error);
    next(createError(500, 'Failed to fetch total student count.'));
  }
};

// Get course counts for admin dashboard (resolves sql_* and course name strings)
export const getCourseCounts = async (req, res, next) => {
  try {
    const { course, branch, category, roomNumber, academicYear, hostelStatus, hostel } = req.query;

    let enriched = [];

    if (academicYear) {
      const result = await fetchStudentsForAcademicYear({
        academicYear,
        filters: { category, roomNumber, hostelStatus, hostel },
        page: 1,
        limit: 100000,
        academicFilters: { course, branch }
      });
      enriched = result.students;
    } else {
      const query = { role: 'student' };

      if (course) query.course = course;
      if (branch) query.branch = branch;
      if (category) query.category = category;
      if (roomNumber) query.roomNumber = roomNumber;
      if (hostelStatus) query.hostelStatus = hostelStatus;
      if (hostel) query.hostel = hostel;

      const students = await User.find(query).select('rollNumber admissionNumber').lean();
      enriched = await enrichStudentsAcademics(students);
    }

    const countsObject = {};

    for (const student of enriched) {
      const courseName = student.course || 'Unknown';
      countsObject[courseName] = (countsObject[courseName] || 0) + 1;
    }

    res.status(200).json({
      success: true,
      data: countsObject,
    });
  } catch (error) {
    console.error('Error fetching course counts:', error);
    next(createError(500, 'Failed to fetch course counts.'));
  }
};

// Add electricity bill for a room
export const addElectricityBill = async (req, res, next) => {
  try {
    const { roomId } = req.params;
    const { month, startUnits, endUnits, rate } = req.body;

    // Validate input
    if (!month || !startUnits || !endUnits) {
      throw createError(400, 'Month, startUnits, and endUnits are required');
    }

    if (endUnits < startUnits) {
      throw createError(400, 'End units cannot be less than start units');
    }

    // Parse rate as number if provided
    let billRate = Room.defaultElectricityRate;
    if (rate !== undefined && rate !== null && rate !== '') {
      const parsedRate = Number(rate);
      if (!isNaN(parsedRate)) {
        billRate = parsedRate;
        if (parsedRate !== Room.defaultElectricityRate) {
          Room.setDefaultElectricityRate(parsedRate);
        }
      }
    }

    const consumption = endUnits - startUnits;
    const total = consumption * billRate;

    const room = await Room.findById(roomId);
    if (!room) {
      throw createError(404, 'Room not found');
    }

    // Check if bill for this month already exists
    const existingBill = room.electricityBills.find(bill => bill.month === month);
    if (existingBill) {
      throw createError(400, 'Bill for this month already exists');
    }

    // Find all students in this room
    const studentsInRoom = await User.find({ 
      roomNumber: room.roomNumber, 
      role: 'student',
      hostelStatus: 'Active'
    });

    if (studentsInRoom.length === 0) {
      throw createError(400, 'No active students found in this room');
    }

    // Check for approved NOCs that overlap with this billing period
    // Parse the month to get the bill period
    const billMonth = new Date(month + '-01');
    const billMonthEnd = new Date(billMonth.getFullYear(), billMonth.getMonth() + 1, 0);
    billMonthEnd.setHours(23, 59, 59, 999);

    // Find all approved NOCs for students in this room that overlap with this billing period
    const studentIds = studentsInRoom.map(s => s._id);
    const approvedNOCs = await NOC.find({
      student: { $in: studentIds },
      status: 'Approved',
      'calculatedElectricityBill.total': { $exists: true, $ne: null }
    }).populate('student', 'name rollNumber');

    // Calculate total NOC amount to subtract from the room bill
    let totalNOCAmount = 0;
    const nocStudents = new Set(); // Track which students have NOCs

    for (const noc of approvedNOCs) {
      if (noc.calculatedElectricityBill) {
        const nocBillStart = new Date(noc.calculatedElectricityBill.billPeriodStart);
        const nocBillEnd = new Date(noc.calculatedElectricityBill.billPeriodEnd);
        
        // Check if NOC bill period overlaps with this monthly bill period
        if (billMonth <= nocBillEnd && billMonthEnd >= nocBillStart) {
          // Use studentShare if available (new format), otherwise fall back to total
          const nocAmount = noc.calculatedElectricityBill.studentShare || noc.calculatedElectricityBill.total || 0;
          totalNOCAmount += nocAmount;
          nocStudents.add(noc.student._id.toString());
          console.log(`📊 NOC Adjustment: Student ${noc.student.name} (${noc.student.rollNumber}) has NOC share of ₹${nocAmount} for this billing period`);
        }
      }
    }

    // Calculate remaining bill amount after subtracting NOC amounts
    const remainingBillAmount = Math.max(0, total - totalNOCAmount);
    
    // Filter out students who have NOCs (they've already been charged)
    const studentsWithoutNOC = studentsInRoom.filter(
      student => !nocStudents.has(student._id.toString())
    );

    if (studentsWithoutNOC.length === 0) {
      // All students have NOCs, but we still need to create bills with 0 amount
      const studentBills = studentsInRoom.map(student => {
        // Find the NOC for this student to get the adjustment amount
        let nocAdjustment = 0;
        const studentNOC = approvedNOCs.find(noc => 
          noc.student._id.toString() === student._id.toString() &&
          billMonth <= new Date(noc.calculatedElectricityBill.billPeriodEnd) &&
          billMonthEnd >= new Date(noc.calculatedElectricityBill.billPeriodStart)
        );
        if (studentNOC && studentNOC.calculatedElectricityBill) {
          nocAdjustment = studentNOC.calculatedElectricityBill.studentShare || studentNOC.calculatedElectricityBill.total || 0;
        }

        return {
          studentId: student._id,
          studentName: student.name,
          studentRollNumber: student.rollNumber,
          amount: 0,
          paymentStatus: 'unpaid',
          nocAdjustment: nocAdjustment
        };
      });

      room.electricityBills.push({
        month,
        startUnits,
        endUnits,
        consumption,
        rate: billRate,
        total,
        totalNOCAdjustment: totalNOCAmount,
        remainingAmount: remainingBillAmount,
        studentBills
      });

      await room.save();
      return res.json({
        success: true,
        data: room.electricityBills[room.electricityBills.length - 1],
        message: `All students have NOC adjustments. Total NOC amount: ₹${totalNOCAmount}`
      });
    }

    // Calculate individual student amount (divide remaining amount equally among students without NOC)
    const individualAmount = Math.round(remainingBillAmount / studentsWithoutNOC.length);

    // Create student bills array
    const studentBills = studentsInRoom.map(student => {
      const hasNOC = nocStudents.has(student._id.toString());
      
      // Find the NOC for this student to get the adjustment amount
      let nocAdjustment = 0;
      if (hasNOC) {
        const studentNOC = approvedNOCs.find(noc => 
          noc.student._id.toString() === student._id.toString() &&
          billMonth <= new Date(noc.calculatedElectricityBill.billPeriodEnd) &&
          billMonthEnd >= new Date(noc.calculatedElectricityBill.billPeriodStart)
        );
        if (studentNOC && studentNOC.calculatedElectricityBill) {
          nocAdjustment = studentNOC.calculatedElectricityBill.studentShare || studentNOC.calculatedElectricityBill.total || 0;
        }
      }

      return {
        studentId: student._id,
        studentName: student.name,
        studentRollNumber: student.rollNumber,
        amount: hasNOC ? 0 : individualAmount, // Students with NOC pay 0 (already charged), others pay their share
        paymentStatus: 'unpaid',
        nocAdjustment: hasNOC ? nocAdjustment : 0
      };
    });

    // Add new bill with student breakdown
    room.electricityBills.push({
      month,
      startUnits,
      endUnits,
      consumption,
      rate: billRate,
      total,
      totalNOCAdjustment: totalNOCAmount, // Total amount already charged via NOC
      remainingAmount: remainingBillAmount, // Amount to be shared among remaining students
      studentBills
    });

    console.log(`📊 Bill Calculation Summary for ${month}:`);
    console.log(`   Total Room Bill: ₹${total}`);
    console.log(`   NOC Adjustments: ₹${totalNOCAmount} (${nocStudents.size} students)`);
    console.log(`   Remaining Amount: ₹${remainingBillAmount}`);
    console.log(`   Students without NOC: ${studentsWithoutNOC.length}`);
    console.log(`   Amount per remaining student: ₹${individualAmount}`);

    await room.save();

    res.json({
      success: true,
      data: room.electricityBills[room.electricityBills.length - 1]
    });
  } catch (error) {
    next(error);
  }
};

// Get electricity bills for a room
export const getElectricityBills = async (req, res, next) => {
  try {
    const { roomId } = req.params;

    const room = await Room.findById(roomId);
    if (!room) {
      throw createError(404, 'Room not found');
    }

    // Sort bills by month in descending order
    const sortedBills = room.electricityBills.sort((a, b) => b.month.localeCompare(a.month));

    res.json({
      success: true,
      data: sortedBills
    });
  } catch (error) {
    next(error);
  }
};

// Batch Renewal — disabled (use academic-year registration + automatic expiry)
export const renewBatches = async (req, res, next) => {
  try {
    return res.status(410).json({
      success: false,
      message: 'Batch renewal has been removed. Register students for each new academic year via Register from SQL. Applications expire automatically at the configured expiry date.',
      code: 'RENEWAL_DISABLED'
    });
  } catch (error) {
    next(error);
  }
};

// Clear all temporary students
export const clearTempStudents = async (req, res, next) => {
  try {
    const result = await TempStudent.deleteMany({});
    
    res.json({
      success: true,
      message: `Cleared ${result.deletedCount} temporary student records.`,
      data: { deletedCount: result.deletedCount }
    });
  } catch (error) {
    next(error);
  }
};

// Search student by Roll Number for Security
export const searchStudentByRollNumber = async (req, res, next) => {
  try {
    const { rollNumber } = req.params;
    if (!rollNumber) {
      return next(createError(400, 'Roll number is required.'));
    }

    // Note: course and branch are now stored as strings, not ObjectId references
    const student = await User.findOne({ rollNumber: new RegExp(`^${rollNumber}$`, 'i'), role: 'student' })
      .select('-password');
      // Removed populate for course and branch - they are now strings

    if (!student) {
      return next(createError(404, 'Student with this roll number not found.'));
    }

    // Fetch security settings
    let settings = await SecuritySettings.findOne();
    if (!settings) {
      settings = await SecuritySettings.create({});
    }

    // Prepare student data based on settings
    let studentObj = await enrichStudentAcademics(student);
    if (!settings.viewProfilePictures) {
      studentObj.studentPhoto = undefined;
    }
    if (!settings.viewPhoneNumbers) {
      studentObj.studentPhone = undefined;
      studentObj.parentPhone = undefined;
    }
    if (!settings.viewGuardianImages) {
      studentObj.guardianPhoto1 = undefined;
      studentObj.guardianPhoto2 = undefined;
    }

    res.status(200).json({
      success: true,
      data: studentObj
    });
  } catch (error) {
    next(error);
  }
};

// Admin password reset for students
export const resetStudentPassword = async (req, res, next) => {
  try {
    const { newPassword } = req.body;
    const studentId = req.params.id;

    // Validate password length
    if (!newPassword || newPassword.length < 6) {
      throw createError(400, 'Password must be at least 6 characters long');
    }

    // Find student
    const student = await User.findOne({ _id: studentId, role: 'student' });
    if (!student) {
      throw createError(404, 'Student not found');
    }

    // Update password
    student.password = newPassword;
    student.isPasswordChanged = true;

    await repairMissingRollNumber(student);
    await student.save({ validateModifiedOnly: true });

    // Attempt to delete TempStudent record if exists
    try {
      await TempStudent.deleteOne({ mainStudentId: student._id });
      console.log(`TempStudent record processed for student ID: ${student._id}`);
    } catch (tempStudentError) {
      console.error(`Error deleting TempStudent for student ID ${student._id}:`, tempStudentError);
    }

    // Send email notification to student
    let emailSent = false;
    let emailError = null;
    
    if (student.email) {
      try {
        const loginUrl = `${req.protocol}://${req.get('host')}/login`;
        await sendPasswordResetEmail(
          student.email,
          student.name,
          student.rollNumber,
          newPassword,
          loginUrl
        );
        emailSent = true;
        console.log('📧 Password reset email sent successfully to:', student.email);
      } catch (emailErr) {
        emailError = emailErr.message;
        console.error('📧 Failed to send password reset email to:', student.email, emailErr);
        // Don't fail the password reset if email fails
      }
    }

    res.json({
      success: true,
      message: 'Student password reset successfully',
      data: {
        student: {
          id: student._id,
          name: student.name,
          rollNumber: student.rollNumber,
          isPasswordChanged: true
        },
        emailSent,
        emailError
      }
    });
  } catch (error) {
    console.error('Admin password reset error:', error);
    next(error);
  }
};

// Get students by principal's assigned course
// Helper function to resolve SQL course ID to course name
const resolveCourseName = async (courseValue) => {
  if (!courseValue) return null;
  
  // If it's already a course name (not a SQL ID), return it
  if (typeof courseValue === 'string' && !courseValue.startsWith('sql_') && !/^\d+$/.test(courseValue)) {
    return courseValue;
  }
  
  // If it's a SQL ID format (sql_1, sql_2, etc.)
  if (typeof courseValue === 'string' && courseValue.startsWith('sql_')) {
    try {
      const { fetchCourseByIdFromSQL } = await import('../utils/sqlService.js');
      const sqlId = parseInt(courseValue.replace('sql_', ''));
      const result = await fetchCourseByIdFromSQL(sqlId);
      if (result.success && result.data) {
        return result.data.name || courseValue;
      }
    } catch (error) {
      console.error('Error resolving SQL course ID:', error);
    }
  }
  
  // If it's numeric, treat as SQL ID
  if (/^\d+$/.test(courseValue.toString())) {
    try {
      const { fetchCourseByIdFromSQL } = await import('../utils/sqlService.js');
      const result = await fetchCourseByIdFromSQL(parseInt(courseValue));
      if (result.success && result.data) {
        return result.data.name || courseValue;
      }
    } catch (error) {
      console.error('Error resolving SQL course ID:', error);
    }
  }
  
  return courseValue;
};

export const getStudentsByPrincipalCourse = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, search, gender, category, roomNumber, batch, academicYear, hostelStatus, course } = req.query;
    const principal = req.principal; // From principalAuth middleware

    // Determine allowed courses for the principal
    let allowedCourses = [];
    
    // New Logic: Filter by Assigned Colleges & Levels
    if (principal.assignedCollegeIds && principal.assignedCollegeIds.length > 0) {
      try {
        const { fetchCoursesFromSQL } = await import('../utils/sqlService.js');
        const sqlCoursesResult = await fetchCoursesFromSQL();
        
        if (sqlCoursesResult.success) {
           const allCourses = sqlCoursesResult.data;
           
           // Filter courses that match College IDs AND Levels
           const matchingCourses = allCourses.filter(course => {
             const collegeMatch = course.college_id && principal.assignedCollegeIds.includes(course.college_id);
             const levelMatch = (!principal.assignedLevels || principal.assignedLevels.length === 0) || 
                               (course.level && principal.assignedLevels.map(l => l.toLowerCase()).includes(course.level.toLowerCase()));
             return collegeMatch && levelMatch;
           });
           
           allowedCourses = matchingCourses.map(c => normalizeCourseName(c.name));
        }
      } catch (err) {
        console.error('🎓 Error fetching SQL courses for principal filter:', err);
      }
    }
    
    // Fallback/Legacy Logic
    if (allowedCourses.length === 0) {
      if (principal.assignedCourses && principal.assignedCourses.length > 0) {
        allowedCourses = principal.assignedCourses.map(c => normalizeCourseName(c.trim()));
      } else if (principal.course) {
        allowedCourses = [normalizeCourseName(principal.course.trim())];
      }
    }

    if (allowedCourses.length === 0) {
      throw createError(400, 'Principal has no assigned courses');
    }

    // Determine target course(s) for filtering
    let targetCourses = allowedCourses;
    if (course) {
      const requestedCourse = normalizeCourseName(course.trim());
      if (!allowedCourses.includes(requestedCourse)) {
        throw createError(403, 'Access to this course is not authorized');
      }
      targetCourses = [requestedCourse];
    }
    
    // Build base query - fetch all students that might match (including SQL IDs)
    // We'll filter by course in memory after resolving SQL IDs
    const baseQuery = {
      role: 'student'
    };
    
    // Add other filters first
    if (gender) baseQuery.gender = gender;
    if (category) baseQuery.category = category;
    if (roomNumber) baseQuery.roomNumber = roomNumber;
    if (batch) baseQuery.batch = batch;
    if (academicYear) baseQuery.academicYear = academicYear;
    if (hostelStatus) baseQuery.hostelStatus = hostelStatus;

    // Add search filter if provided
    if (search) {
      baseQuery.$or = baseQuery.$or || [];
      baseQuery.$or.push(
        { name: { $regex: search, $options: 'i' } },
        { rollNumber: { $regex: search, $options: 'i' } },
        { hostelId: { $regex: search, $options: 'i' } }
      );
    }

    const allStudents = await User.find(baseQuery)
      .sort({ createdAt: -1 })
      .select('-password')
      .lean();

    let enrichedStudents = await enrichStudentsAcademics(allStudents);

    const filteredStudents = enrichedStudents.filter((student) => {
      const normalizedStudentCourse = student.course
        ? normalizeCourseName(student.course.trim())
        : null;
      if (!targetCourses.includes(normalizedStudentCourse)) return false;

      if (principal.assignedCourses && principal.assignedCourses.length > 1) {
        return true;
      }
      if (principal.branch) {
        const principalBranch = principal.branch.trim();
        const studentBranch = (student.branch || '').trim();
        return studentBranch.toLowerCase() === principalBranch.toLowerCase();
      }
      return true;
    });

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const totalStudents = filteredStudents.length;
    const totalPages = Math.ceil(totalStudents / parseInt(limit, 10));
    const transformedStudents = filteredStudents.slice(skip, skip + parseInt(limit, 10));

    res.json({
      success: true,
      data: {
        students: transformedStudents,
        totalStudents,
        totalPages,
        currentPage: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('🎓 Error fetching students by principal course:', error);
    next(error);
  }
}; 

// Update student years based on academic calendar (if available) or batch
export const updateStudentYearsFromAcademicCalendar = async (req, res, next) => {
  try {
    console.log('📅 Starting student year update based on academic calendar...');
    
    // Get all active students
    const students = await User.find({ 
      role: 'student',
      hostelStatus: 'Active'
    }).populate('course', 'name duration');
    
    console.log(`📊 Processing ${students.length} active students...`);
    
    let updatedCount = 0;
    let errors = [];
    let skippedCount = 0;
    let academicCalendarUsed = 0;
    let fallbackUsed = 0;

    for (const student of students) {
      try {
        console.log(`🔍 Processing student: ${student.rollNumber}, current year: ${student.year}, batch: ${student.batch}`);
        
        if (student.batch && student.course) {
          // Get course duration
          const courseDuration = student.course.duration || 4;
          
          // Calculate correct year using academic calendar integration
          const correctYear = await calculateCurrentYear(student.batch, courseDuration, student.course._id);
          
          console.log(`🧮 Calculated year for ${student.rollNumber}: ${correctYear} (current: ${student.year})`);
          
          // Update if year is different
          if (student.year !== correctYear) {
            const updateResult = await User.findByIdAndUpdate(
              student._id, 
              { year: correctYear },
              { new: true }
            );
            
            if (updateResult) {
              updatedCount++;
              console.log(`✅ Updated student ${student.rollNumber}: year ${student.year} → ${correctYear} (batch: ${student.batch})`);
            } else {
              console.log(`❌ Failed to update student ${student.rollNumber}`);
              errors.push(`Failed to update student ${student.rollNumber}: Database update failed`);
            }
          } else {
            console.log(`⏭️ Skipped student ${student.rollNumber}: year already correct (${student.year})`);
            skippedCount++;
          }
        } else {
          console.log(`⚠️ Skipped student ${student.rollNumber}: no batch or course information`);
          skippedCount++;
        }
      } catch (error) {
        console.error(`❌ Error updating student ${student.rollNumber}:`, error);
        errors.push(`Error updating student ${student.rollNumber}: ${error.message}`);
      }
    }

    console.log(`📊 Academic calendar update process completed:`);
    console.log(`✅ Updated: ${updatedCount} students`);
    console.log(`⏭️ Skipped: ${skippedCount} students`);
    console.log(`❌ Errors: ${errors.length} errors`);

    res.json({ 
      success: true, 
      message: `Updated ${updatedCount} students' years based on academic calendar and batch information.`,
      data: { 
        updatedCount, 
        skippedCount,
        totalStudents: students.length,
        errors 
      }
    });
  } catch (error) {
    console.error('❌ Error in updateStudentYearsFromAcademicCalendar:', error);
    next(error);
  }
};

// Update existing students' years based on their batch (legacy method)
export const updateStudentYears = async (req, res, next) => {
  try {
    console.log('🔄 Starting student year update process...');
    
    // First, let's check if we can find any students at all
    const totalStudents = await User.countDocuments({ role: 'student' });
    console.log(`📊 Total students found: ${totalStudents}`);
    
    // Check students with isActive field
    const activeStudents = await User.countDocuments({ role: 'student', isActive: true });
    console.log(`📊 Active students found: ${activeStudents}`);
    
    // Check students without isActive field (might be undefined)
    const studentsWithoutActive = await User.countDocuments({ 
      role: 'student', 
      $or: [{ isActive: { $exists: false } }, { isActive: null }]
    });
    console.log(`📊 Students without isActive field: ${studentsWithoutActive}`);
    
    // Get all students regardless of isActive status
    const students = await User.find({ role: 'student' });
    console.log(`📊 Processing ${students.length} students...`);
    
    let updatedCount = 0;
    let errors = [];
    let skippedCount = 0;

    for (const student of students) {
      try {
        console.log(`🔍 Processing student: ${student.rollNumber}, current year: ${student.year}, batch: ${student.batch}`);
        
        if (student.batch) {
          // Get course duration
          const CourseModel = (await import('../models/Course.js')).default;
          const courseDoc = await CourseModel.findById(student.course);
          const courseDuration = courseDoc ? courseDoc.duration : 4;
          
          console.log(`📚 Course duration for ${student.rollNumber}: ${courseDuration}`);
          
          // Calculate correct year
          const correctYear = await calculateCurrentYear(student.batch, courseDuration, student.course);
          
          console.log(`🧮 Calculated year for ${student.rollNumber}: ${correctYear} (current: ${student.year})`);
          
          // Update if year is different
          if (student.year !== correctYear) {
            const updateResult = await User.findByIdAndUpdate(
              student._id, 
              { year: correctYear },
              { new: true }
            );
            
            if (updateResult) {
              updatedCount++;
              console.log(`✅ Updated student ${student.rollNumber}: year ${student.year} → ${correctYear} (batch: ${student.batch})`);
            } else {
              console.log(`❌ Failed to update student ${student.rollNumber}`);
              errors.push(`Failed to update student ${student.rollNumber}: Database update failed`);
            }
          } else {
            console.log(`⏭️ Skipped student ${student.rollNumber}: year already correct (${student.year})`);
            skippedCount++;
          }
        } else {
          console.log(`⚠️ Skipped student ${student.rollNumber}: no batch information`);
          skippedCount++;
        }
      } catch (error) {
        console.error(`❌ Error updating student ${student.rollNumber}:`, error);
        errors.push(`Error updating student ${student.rollNumber}: ${error.message}`);
      }
    }

    console.log(`📊 Update process completed:`);
    console.log(`✅ Updated: ${updatedCount} students`);
    console.log(`⏭️ Skipped: ${skippedCount} students`);
    console.log(`❌ Errors: ${errors.length} errors`);

    res.json({ 
      success: true, 
      message: `Updated ${updatedCount} students' years based on their batch and current date.`,
      data: { 
        updatedCount, 
        skippedCount,
        totalStudents: students.length,
        errors 
      }
    });
  } catch (error) {
    console.error('❌ Error in updateStudentYears:', error);
    next(error);
  }
}; 

// Get students for admit card generation
export const getStudentsForAdmitCards = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search = '', course = '', year = '', category = '' } = req.query;
    
    const query = { role: 'student' };
    
    // Add search filter
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { rollNumber: { $regex: search, $options: 'i' } },
        { hostelId: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Add filters
    if (course) {
      // Handle course filtering - course can be either ObjectId or string
      if (course.match(/^[0-9a-fA-F]{24}$/)) {
        // If it's a valid ObjectId, use it directly
        query.course = course;
      } else {
        // If it's a string (course name), we need to find the course first
        try {
          const Course = (await import('../models/Course.js')).default;
          const courseDoc = await Course.findOne({ name: { $regex: course, $options: 'i' } });
          if (courseDoc) {
            query.course = courseDoc._id;
          } else {
            // If course not found, return empty result
            return res.json({
              success: true,
              data: {
                students: [],
                pagination: {
                  current: parseInt(page),
                  total: 0,
                  totalStudents: 0
                }
              }
            });
          }
        } catch (error) {
          console.error('Error finding course:', error);
          // Fallback to string matching if course lookup fails
          query.course = { $regex: course, $options: 'i' };
        }
      }
    }
    if (year) query.year = year;
    if (category) query.category = category;
    
    const skip = (page - 1) * limit;
    
    console.log('Admit cards query:', JSON.stringify(query, null, 2));
    
    const students = await User.find(query)
      .populate('course', 'name')
      .populate('branch', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('name rollNumber course year branch gender category roomNumber studentPhone parentPhone email batch academicYear hostelId hostelStatus studentPhoto address concession concessionApproved calculatedTerm1Fee calculatedTerm2Fee calculatedTerm3Fee totalCalculatedFee');

    const enrichedStudents = await enrichStudentsAcademics(students.map((s) => s.toObject()));

    const transformedStudents = enrichedStudents.map((student) => ({
      ...student,
      courseId: student.course?._id || student.courseId,
      course: student.course?.name || student.course
    }));
    
    const total = await User.countDocuments(query);
    
    console.log('Admit cards results:', students.length, 'students found');
    
    res.json({
      success: true,
      data: {
        students: transformedStudents,
        pagination: {
          current: parseInt(page),
          total: Math.ceil(total / limit),
          totalStudents: total
        }
      }
    });
  } catch (error) {
    console.error('Error in getStudentsForAdmitCards:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch students for admit cards',
      error: error.message
    });
  }
};

// Generate individual admit card
export const generateAdmitCard = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const student = await User.findById(id)
      .populate('course', 'name')
      .populate('branch', 'name');
    
    if (!student || student.role !== 'student') {
      throw createError(404, 'Student not found');
    }

    const enriched = await enrichStudentAcademics(student.toObject());

    if (!enriched.studentPhoto) {
      throw createError(400, 'Student photo is required for admit card generation. No photo found in SDMS for this student.');
    }

    // Check if concession is pending approval
    if (student.concession > 0 && !student.concessionApproved) {
      throw createError(400, 'Cannot generate admit card. Concession is pending approval. Please approve the concession first.');
    }

    const photoBase64 = await photoToBase64ForExport(enriched.studentPhoto, fetchImageAsBase64);
    if (!photoBase64) {
      throw createError(400, 'Failed to load student photo from SDMS');
    }

    res.json({
      success: true,
      data: {
        student: {
          id: student._id,
          name: enriched.name || student.name,
          rollNumber: enriched.rollNumber || student.rollNumber,
          course: enriched.course?.name || enriched.course || student.course?.name || student.course,
          courseId: student.course?._id || student.course,
          year: enriched.year ?? student.year,
          branch: enriched.branch?.name || enriched.branch || student.branch?.name || student.branch,
          gender: student.gender,
          category: student.category,
          roomNumber: student.roomNumber,
          studentPhone: enriched.studentPhone || student.studentPhone,
          parentPhone: enriched.parentPhone || student.parentPhone,
          email: student.email,
          batch: enriched.batch || student.batch,
          academicYear: student.academicYear,
          hostelId: student.hostelId,
          hostelStatus: student.hostelStatus,
          studentPhoto: photoBase64,
          address: student.address,
          concession: student.concession || 0,
          calculatedTerm1Fee: student.calculatedTerm1Fee || 0,
          calculatedTerm2Fee: student.calculatedTerm2Fee || 0,
          calculatedTerm3Fee: student.calculatedTerm3Fee || 0,
          totalCalculatedFee: student.totalCalculatedFee || 0
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// Generate bulk admit cards
export const generateBulkAdmitCards = async (req, res, next) => {
  try {
    const { studentIds } = req.body;
    
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      throw createError(400, 'Student IDs array is required');
    }
    
    const students = await User.find({ 
      _id: { $in: studentIds }, 
      role: 'student' 
    })
    .populate('course', 'name')
    .populate('branch', 'name')
      .select('name rollNumber course year branch gender category roomNumber studentPhone parentPhone email batch academicYear hostelId hostelStatus studentPhoto address concession concessionApproved');

    const enrichedStudents = await enrichStudentsAcademics(students.map((s) => s.toObject()));

    const studentsWithoutPhotos = enrichedStudents.filter((s) => !s.studentPhoto);
    if (studentsWithoutPhotos.length > 0) {
      const names = studentsWithoutPhotos.map(s => s.name).join(', ');
      throw createError(400, `Students without photos in SDMS: ${names}. All students must have photos for admit card generation.`);
    }

    const studentsWithPendingConcession = enrichedStudents.filter(
      (s) => (s.concession > 0 && !s.concessionApproved)
    );
    if (studentsWithPendingConcession.length > 0) {
      const names = studentsWithPendingConcession.map(s => s.name).join(', ');
      throw createError(400, `Cannot generate admit cards for students with pending concession approvals: ${names}. Please approve their concessions first.`);
    }

    const studentsWithPhotos = [];
    for (const student of enrichedStudents) {
      try {
        const photoBase64 = await photoToBase64ForExport(student.studentPhoto, fetchImageAsBase64);
        if (!photoBase64) {
          throw createError(400, `Failed to load photo for student: ${student.name}`);
        }

        studentsWithPhotos.push({
          id: student._id,
          name: student.name,
          rollNumber: student.rollNumber,
          course: student.course?.name || student.course,
          year: student.year,
          branch: student.branch?.name || student.branch,
          gender: student.gender,
          category: student.category,
          roomNumber: student.roomNumber,
          studentPhone: student.studentPhone,
          parentPhone: student.parentPhone,
          email: student.email,
          batch: student.batch,
          academicYear: student.academicYear,
          hostelId: student.hostelId,
          hostelStatus: student.hostelStatus,
          studentPhoto: photoBase64,
          address: student.address
        });
      } catch (error) {
        console.error(`Error fetching photo for student ${student.name}:`, error);
        throw createError(400, `Failed to fetch photo for student: ${student.name}`);
      }
    }
    
    res.json({
      success: true,
      data: {
        students: studentsWithPhotos
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get available beds and lockers for a room
export const getRoomBedLockerAvailability = async (req, res, next) => {
  try {
    const { roomNumber } = req.params;
    const { academicYear, hostel, category } = req.query;
    
    if (!roomNumber) {
      throw createError(400, 'Room number is required');
    }

    const roomQuery = { roomNumber };
    if (hostel) roomQuery.hostel = hostel;
    if (category) roomQuery.category = category;

    const room = await Room.findOne(roomQuery);
    if (!room) {
      throw createError(404, 'Room not found');
    }

    const { occupiedBeds: studentBeds, occupiedLockers: studentLockers } =
      await getOccupiedBedsAndLockersForAcademicYear(room, academicYear);

    const occupiedBedsList = [...studentBeds];
    const occupiedLockersList = [...studentLockers];

    const StaffGuest = (await import('../models/StaffGuest.js')).default;
    const staffInRoom = await StaffGuest.find({
      type: 'staff',
      roomNumber: room.roomNumber,
      isActive: true
    }).select('bedNumber');

    staffInRoom.forEach((staff) => {
      if (staff.bedNumber && !occupiedBedsList.includes(staff.bedNumber)) {
        occupiedBedsList.push(staff.bedNumber);
      }
    });

    const occupiedBedSet = new Set(occupiedBedsList);
    const occupiedLockerSet = new Set(occupiedLockersList);

    const allBeds = [];
    const allLockers = [];
    
    for (let i = 1; i <= room.bedCount; i++) {
      const bedNumber = `${roomNumber} Bed ${i}`;
      const lockerNumber = `${roomNumber} Locker ${i}`;
      
      allBeds.push({
        value: bedNumber,
        label: bedNumber,
        occupied: occupiedBedSet.has(bedNumber)
      });
      
      allLockers.push({
        value: lockerNumber,
        label: lockerNumber,
        occupied: occupiedLockerSet.has(lockerNumber)
      });
    }

    const availableBeds = allBeds.filter(bed => !bed.occupied);
    const availableLockers = allLockers.filter(locker => !locker.occupied);

    res.json({
      success: true,
      data: {
        room: {
          roomNumber: room.roomNumber,
          bedCount: room.bedCount,
          gender: room.gender,
          category: room.category
        },
        allBeds,
        allLockers,
        availableBeds,
        availableLockers,
        occupiedBeds: [...occupiedBedSet],
        occupiedLockers: [...occupiedLockerSet],
        currentOccupancy: occupiedBedSet.size,
        academicYear: academicYear || null
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get student password for admit card generation
export const getStudentTempPassword = async (req, res) => {
  try {
    const { id } = req.params;
    console.log('🔍 Backend: Fetching password for student ID:', id);
    
    // Only fetch from TempStudent collection (stores plain text passwords)
    const tempStudent = await TempStudent.findOne({ mainStudentId: id });
    console.log('🔍 Backend: TempStudent found:', tempStudent ? 'Yes' : 'No');
    
    if (tempStudent) {
      console.log('🔍 Backend: Generated password:', tempStudent.generatedPassword);
    }
    
    if (tempStudent && tempStudent.generatedPassword) {
      return res.json({
        success: true,
        data: {
          password: tempStudent.generatedPassword
        }
      });
    }
    
    // If no password found in TempStudent collection
    console.log('❌ Backend: No TempStudent record found for student ID:', id);
    return res.status(404).json({
      success: false,
      message: 'Student password not found'
    });
  } catch (error) {
    console.error('❌ Backend: Error fetching student temp password:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch student password',
      error: error.message
    });
  }
};

// Share student credentials via SMS
export const shareStudentCredentials = async (req, res) => {
  try {
    const { studentId, studentPhone, customMessage } = req.body;

    if (!studentId || !studentPhone) {
      return res.status(400).json({
        success: false,
        message: 'Student ID and phone number are required'
      });
    }

    // Find the student
    const student = await User.findById(studentId);
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    // Verify the phone number matches the student's phone
    if (student.studentPhone !== studentPhone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number does not match student record'
      });
    }

    // Get the student's credentials
    const username = student.rollNumber || student.hostelId;

    if (!username) {
      return res.status(400).json({
        success: false,
        message: 'Student username not found'
      });
    }

    // Get the original password from TempStudent collection (stored in plain text)
    const TempStudent = (await import('../models/TempStudent.js')).default;
    const tempStudent = await TempStudent.findOne({ mainStudentId: studentId });
    
    let password = 'changeme'; // Default fallback
    if (tempStudent && tempStudent.generatedPassword) {
      password = tempStudent.generatedPassword;
      console.log('📱 Using original password from TempStudent:', password);
    } else {
      console.log('📱 No TempStudent record found for student:', student.name, 'using default password');
      // For students without TempStudent records, we can't retrieve the original password
      // The default 'changeme' will be sent, and they'll need to reset their password
    }

    console.log('📱 Sharing credentials for student:', {
      name: student.name,
      rollNumber: student.rollNumber,
      hostelId: student.hostelId,
      studentPhone: student.studentPhone,
      username: username,
      password: password
    });

    // Send SMS using the existing template
    const smsResult = await sendAdminCredentialsSMS(
      studentPhone,
      username,
      password
    );

    console.log('📱 Credentials shared successfully:', smsResult);

    res.json({
      success: true,
      message: 'Credentials sent successfully via SMS',
      data: {
        smsResult,
        student: {
          name: student.name,
          rollNumber: student.rollNumber,
          hostelId: student.hostelId,
          studentPhone: student.studentPhone
        }
      }
    });

  } catch (error) {
    console.error('❌ Error sharing student credentials:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to share credentials',
      error: error.message
    });
  }
};

// Get students with pending concession approvals
// Get approved concessions (students with concession > 0 and concessionApprovedBy set)
export const getApprovedConcessions = async (req, res, next) => {
  try {
    // Build query for students with concession > 0 and approved (concessionApprovedBy exists)
    const query = {
      role: 'student',
      concession: { $gt: 0 },
      concessionApprovedBy: { $exists: true, $ne: null }
    };
    
    // Get all students with approved concessions
    // Note: After SQL migration, course and branch are stored as strings, not ObjectId references
    let students;
    try {
      students = await User.find(query)
        .populate('concessionApprovedBy', 'username name')
        .populate('concessionRequestedBy', 'username name')
        .populate('concessionHistory.performedBy', 'username name')
        .sort({ concessionApprovedAt: -1, createdAt: -1 })
        .select('name rollNumber course year branch gender category roomNumber studentPhone parentPhone email batch academicYear hostelId hostelStatus address concession concessionApproved concessionApprovedBy concessionApprovedAt concessionRequestedBy concessionRequestedAt concessionHistory calculatedTerm1Fee calculatedTerm2Fee calculatedTerm3Fee totalCalculatedFee')
        .lean();
    } catch (dbError) {
      console.error('Database error fetching approved concessions:', dbError);
      return next(createError(500, `Database error: ${dbError.message}`));
    }
    
    // Fetch fee structures for each student to show original vs after concession
    const FeeStructure = (await import('../models/FeeStructure.js')).default;
    const studentsWithFeeInfo = await Promise.allSettled(students.map(async (student) => {
      let originalTotalFee = 0;
      // After SQL migration: course is stored as string (course name), not ObjectId
      const courseName = typeof student.course === 'string' ? student.course : (student.course?.name || student.course || 'N/A');
      
      try {
        // After SQL migration: courseName is the course name (string)
        // FeeStructure.getFeeStructure expects: academicYear, course (name), branch, year, category
        const branchName = typeof student.branch === 'string' ? student.branch : (student.branch?.name || student.branch || null);
        if (student.academicYear && courseName && courseName !== 'N/A' && student.year && student.category) {
          const feeStructure = await FeeStructure.getFeeStructure(
            student.academicYear,
            courseName, // Course name (string)
            branchName, // Branch name (string) or null
            student.year,
            student.category
          );
          if (feeStructure) {
            originalTotalFee = feeStructure.totalFee || 0;
          }
        }
      } catch (error) {
        console.error(`Error fetching fee structure for student ${student.rollNumber || student._id}:`, error);
      }
      
      return {
        ...student,
        course: courseName, // Return course as string (course name)
        originalTotalFee,
        afterConcessionFee: student.totalCalculatedFee || (originalTotalFee > 0 ? originalTotalFee - (student.concession || 0) : 0)
      };
    }));
    
    // Extract successful results from Promise.allSettled
    const successfulStudents = studentsWithFeeInfo
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value);
    
    const failedStudents = studentsWithFeeInfo
      .filter(result => result.status === 'rejected')
      .map(result => result.reason);
    
    if (failedStudents.length > 0) {
      console.warn(`Failed to process ${failedStudents.length} students:`, failedStudents);
    }
    
    res.json({
      success: true,
      data: {
        students: successfulStudents
      }
    });
  } catch (error) {
    console.error('Error fetching approved concessions:', error);
    next(error);
  }
};

export const getConcessionApprovals = async (req, res, next) => {
  try {
    // Build query for students with concession > 0 and not approved
    const query = {
      role: 'student',
      concession: { $gt: 0 },
      concessionApproved: false
    };
    
    // Get all students with pending concessions (no pagination for now, can add later if needed)
    // Note: After SQL migration, course and branch are stored as strings, not ObjectId references
    let students;
    try {
      students = await User.find(query)
        .populate('concessionRequestedBy', 'username name')
        .populate('concessionHistory.performedBy', 'username name')
        .sort({ concessionRequestedAt: -1, createdAt: -1 })
        .select('name rollNumber course year branch gender category roomNumber studentPhone parentPhone email batch academicYear hostelId hostelStatus address concession concessionRequestedBy concessionRequestedAt concessionHistory calculatedTerm1Fee calculatedTerm2Fee calculatedTerm3Fee totalCalculatedFee')
        .lean();
    } catch (dbError) {
      console.error('Database error fetching concession approvals:', dbError);
      console.error('Error message:', dbError.message);
      console.error('Error stack:', dbError.stack);
      return next(createError(500, `Database error: ${dbError.message}`));
    }
    
    // Fetch fee structures for each student to show original vs after concession
    const FeeStructure = (await import('../models/FeeStructure.js')).default;
    const studentsWithFeeInfo = await Promise.allSettled(students.map(async (student) => {
      let originalTotalFee = 0;
      // After SQL migration: course is stored as string (course name), not ObjectId
      const courseName = typeof student.course === 'string' ? student.course : (student.course?.name || student.course || 'N/A');
      
      try {
        // After SQL migration: courseName is the course name (string)
        // FeeStructure.getFeeStructure expects: academicYear, course (name), branch, year, category
        const branchName = typeof student.branch === 'string' ? student.branch : (student.branch?.name || student.branch || null);
        if (student.academicYear && courseName && courseName !== 'N/A' && student.year && student.category) {
          const feeStructure = await FeeStructure.getFeeStructure(
            student.academicYear,
            courseName, // Course name (string)
            branchName, // Branch name (string) or null
            student.year,
            student.category
          );
          if (feeStructure) {
            originalTotalFee = feeStructure.totalFee || 0;
          }
        }
      } catch (error) {
        console.error(`Error fetching fee structure for student ${student.rollNumber || student._id}:`, error);
      }
      
      return {
        ...student,
        course: courseName, // Return course as string (course name)
        originalTotalFee,
        afterConcessionFee: student.totalCalculatedFee || (originalTotalFee > 0 ? originalTotalFee - (student.concession || 0) : 0)
      };
    }));
    
    // Extract successful results from Promise.allSettled
    const successfulStudents = studentsWithFeeInfo
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value);
    
    const failedStudents = studentsWithFeeInfo
      .filter(result => result.status === 'rejected')
      .map(result => result.reason);
    
    if (failedStudents.length > 0) {
      console.warn(`Failed to process ${failedStudents.length} students:`, failedStudents);
    }
    
    res.json({
      success: true,
      data: {
        students: successfulStudents
      }
    });
  } catch (error) {
    console.error('Error fetching concession approvals:', error);
    console.error('Error stack:', error.stack);
    console.error('Error details:', {
      message: error.message,
      name: error.name,
      code: error.code
    });
    next(error);
  }
};

// Approve concession
export const approveConcession = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { newConcessionAmount, notes } = req.body;
    
    if (req.admin.role !== 'super_admin') {
      throw createError(403, 'Only super admin can approve concessions');
    }
    
    const student = await User.findById(id);
    if (!student || student.role !== 'student') {
      throw createError(404, 'Student not found');
    }
    
    if (student.concession <= 0) {
      throw createError(400, 'Student does not have a concession');
    }
    
    if (student.concessionApproved) {
      throw createError(400, 'Concession is already approved');
    }
    
    const previousAmount = student.concession;
    let finalAmount = previousAmount;
    
    // If newConcessionAmount is provided, update the concession amount
    if (newConcessionAmount !== undefined && newConcessionAmount !== null) {
      const newAmount = Number(newConcessionAmount);
      
      if (newAmount < 0) {
        throw createError(400, 'Concession amount cannot be negative');
      }
      
      if (newAmount === 0) {
        throw createError(400, 'Cannot approve with zero amount. Use reject instead.');
      }
      
      finalAmount = newAmount;
      student.concession = newAmount;
      
      // Recalculate fees with new concession
      const FeeStructure = (await import('../models/FeeStructure.js')).default;
      try {
        const feeStructure = await FeeStructure.getFeeStructure(
          student.academicYear,
          student.course,
          student.branch,
          student.year,
          student.category
        );
        if (feeStructure) {
          const concessionAmount = newAmount;
          student.calculatedTerm1Fee = Math.max(0, feeStructure.term1Fee - concessionAmount);
          let remainingConcession = Math.max(0, concessionAmount - feeStructure.term1Fee);
          student.calculatedTerm2Fee = Math.max(0, feeStructure.term2Fee - remainingConcession);
          remainingConcession = Math.max(0, remainingConcession - feeStructure.term2Fee);
          student.calculatedTerm3Fee = Math.max(0, feeStructure.term3Fee - remainingConcession);
          student.totalCalculatedFee = student.calculatedTerm1Fee + student.calculatedTerm2Fee + student.calculatedTerm3Fee;
        }
      } catch (error) {
        console.error('Error recalculating fees:', error);
      }
    }
    
    // Add to history
    if (!student.concessionHistory) {
      student.concessionHistory = [];
    }
    student.concessionHistory.push({
      action: previousAmount !== finalAmount ? 'updated' : 'approved',
      amount: finalAmount,
      previousAmount: previousAmount !== finalAmount ? previousAmount : null,
      performedBy: req.admin._id,
      performedAt: new Date(),
      notes: notes || ''
    });
    
    student.concessionApproved = true;
    student.concessionApprovedBy = req.admin._id;
    student.concessionApprovedAt = new Date();
    
    await repairMissingRollNumber(student);
    await student.save({ validateModifiedOnly: true });

    await syncStudentHostelFeeSafely(student);

    res.json({
      success: true,
      message: previousAmount !== finalAmount 
        ? 'Concession approved and amount updated successfully'
        : 'Concession approved successfully',
      data: {
        student: {
          id: student._id,
          name: student.name,
          rollNumber: student.rollNumber,
          concession: student.concession,
          concessionApproved: student.concessionApproved,
          concessionApprovedBy: student.concessionApprovedBy,
          concessionApprovedAt: student.concessionApprovedAt
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// Reject concession (can also update amount)
export const rejectConcession = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { newConcessionAmount, reason } = req.body;
    
    if (req.admin.role !== 'super_admin') {
      throw createError(403, 'Only super admin can reject concessions');
    }
    
    const student = await User.findById(id);
    if (!student || student.role !== 'student') {
      throw createError(404, 'Student not found');
    }
    
    if (student.concession <= 0) {
      throw createError(400, 'Student does not have a concession');
    }
    
    const previousAmount = student.concession;
    
    // If newConcessionAmount is provided and different, update it
    if (newConcessionAmount !== undefined && newConcessionAmount !== null) {
      const newAmount = Number(newConcessionAmount) || 0;
      
      if (newAmount < 0) {
        throw createError(400, 'Concession amount cannot be negative');
      }
      
      // If new amount is 0, remove concession
      if (newAmount === 0) {
        student.concession = 0;
        student.concessionApproved = false;
        student.concessionApprovedBy = null;
        student.concessionApprovedAt = null;
        student.concessionRequestedBy = null;
        student.concessionRequestedAt = null;
        // Reset calculated fees to original
        const FeeStructure = (await import('../models/FeeStructure.js')).default;
        try {
          const feeStructure = await FeeStructure.getFeeStructure(
            student.academicYear,
            student.course,
            student.branch,
            student.year,
            student.category
          );
          if (feeStructure) {
            student.calculatedTerm1Fee = feeStructure.term1Fee;
            student.calculatedTerm2Fee = feeStructure.term2Fee;
            student.calculatedTerm3Fee = feeStructure.term3Fee;
            student.totalCalculatedFee = feeStructure.totalFee;
          }
        } catch (error) {
          console.error('Error recalculating fees:', error);
        }
        
        // Add to history
        if (!student.concessionHistory) {
          student.concessionHistory = [];
        }
        student.concessionHistory.push({
          action: 'rejected',
          amount: 0,
          previousAmount: previousAmount,
          performedBy: req.admin._id,
          performedAt: new Date(),
          notes: reason || ''
        });
      } else {
        // Update concession amount and recalculate fees
        student.concession = newAmount;
        student.concessionApproved = false;
        student.concessionRequestedBy = req.admin._id;
        student.concessionRequestedAt = new Date();
        
        // Recalculate fees with new concession
        const FeeStructure = (await import('../models/FeeStructure.js')).default;
        try {
          const feeStructure = await FeeStructure.getFeeStructure(
            student.academicYear,
            student.course,
            student.branch,
            student.year,
            student.category
          );
          if (feeStructure) {
            const concessionAmount = newAmount;
            student.calculatedTerm1Fee = Math.max(0, feeStructure.term1Fee - concessionAmount);
            let remainingConcession = Math.max(0, concessionAmount - feeStructure.term1Fee);
            student.calculatedTerm2Fee = Math.max(0, feeStructure.term2Fee - remainingConcession);
            remainingConcession = Math.max(0, remainingConcession - feeStructure.term2Fee);
            student.calculatedTerm3Fee = Math.max(0, feeStructure.term3Fee - remainingConcession);
            student.totalCalculatedFee = student.calculatedTerm1Fee + student.calculatedTerm2Fee + student.calculatedTerm3Fee;
          }
        } catch (error) {
          console.error('Error recalculating fees:', error);
        }
        
        // Add to history
        if (!student.concessionHistory) {
          student.concessionHistory = [];
        }
        student.concessionHistory.push({
          action: 'updated',
          amount: newAmount,
          previousAmount: previousAmount,
          performedBy: req.admin._id,
          performedAt: new Date(),
          notes: reason || ''
        });
      }
    } else {
      // Just reject (remove concession)
      student.concession = 0;
      student.concessionApproved = false;
      student.concessionApprovedBy = null;
      student.concessionApprovedAt = null;
      student.concessionRequestedBy = null;
      student.concessionRequestedAt = null;
      // Reset calculated fees to original
      const FeeStructure = (await import('../models/FeeStructure.js')).default;
      try {
        const feeStructure = await FeeStructure.getFeeStructure(
          student.academicYear,
          student.course,
          student.branch,
          student.year,
          student.category
        );
        if (feeStructure) {
          student.calculatedTerm1Fee = feeStructure.term1Fee;
          student.calculatedTerm2Fee = feeStructure.term2Fee;
          student.calculatedTerm3Fee = feeStructure.term3Fee;
          student.totalCalculatedFee = feeStructure.totalFee;
        }
      } catch (error) {
        console.error('Error recalculating fees:', error);
      }
      
      // Add to history
      if (!student.concessionHistory) {
        student.concessionHistory = [];
      }
      student.concessionHistory.push({
        action: 'rejected',
        amount: 0,
        previousAmount: previousAmount,
        performedBy: req.admin._id,
        performedAt: new Date(),
        notes: reason || ''
      });
    }
    
    await repairMissingRollNumber(student);
    await student.save({ validateModifiedOnly: true });

    await syncStudentHostelFeeSafely(student);

    res.json({
      success: true,
      message: newConcessionAmount !== undefined && newConcessionAmount !== null && newConcessionAmount !== 0
        ? 'Concession amount updated successfully'
        : 'Concession rejected and removed successfully',
      data: {
        student: {
          id: student._id,
          name: student.name,
          rollNumber: student.rollNumber,
          concession: student.concession,
          concessionApproved: student.concessionApproved
        }
      }
    });
  } catch (error) {
    next(error);
  }
};