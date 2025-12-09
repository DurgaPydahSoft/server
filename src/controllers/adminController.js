import User, { COURSES, BRANCHES, ROOM_MAPPINGS } from '../models/User.js';
import TempStudent from '../models/TempStudent.js';
import Complaint from '../models/Complaint.js';
import Leave from '../models/Leave.js';
import Room from '../models/Room.js';
import SecuritySettings from '../models/SecuritySettings.js';
import FeeReminder from '../models/FeeReminder.js';
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
      gender,
      course,
      year,
      branch,
      category,
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
      concession = 0
    } = req.body;

    // Check if student already exists
    const existingStudent = await User.findOne({ rollNumber });
    if (existingStudent) {
      throw createError(400, 'Student with this roll number already exists');
    }

    // Validate room number based on gender and category - check against actual Room model
    const roomDoc = await Room.findOne({ roomNumber, gender, category });
    if (!roomDoc) {
      throw createError(400, 'Invalid room number for the selected gender and category');
    }

    // Check bed count limit
    const studentCount = await User.countDocuments({ roomNumber, gender, category, role: 'student' });
    if (studentCount >= roomDoc.bedCount) {
      throw createError(400, 'Room is full. Cannot register more students.');
    }

    // Validate bed and locker assignment if provided
    if (bedNumber) {
      // Check if bed is already occupied
      const bedOccupied = await User.findOne({ 
        bedNumber, 
        role: 'student',
        hostelStatus: 'Active'
      });
      if (bedOccupied) {
        throw createError(400, 'Selected bed is already occupied');
      }
      
      // Validate bed format matches room
      const expectedBedFormat = `${roomNumber} Bed `;
      if (!bedNumber.startsWith(expectedBedFormat)) {
        throw createError(400, 'Invalid bed number format for this room');
      }
    }

    if (lockerNumber) {
      // Check if locker is already occupied
      const lockerOccupied = await User.findOne({ 
        lockerNumber, 
        role: 'student',
        hostelStatus: 'Active'
      });
      if (lockerOccupied) {
        throw createError(400, 'Selected locker is already occupied');
      }
      
      // Validate locker format matches room
      const expectedLockerFormat = `${roomNumber} Locker `;
      if (!lockerNumber.startsWith(expectedLockerFormat)) {
        throw createError(400, 'Invalid locker number format for this room');
      }
    }

    // Generate hostel ID
    const hostelId = await generateHostelId(gender || 'Male');
    console.log('Generated hostel ID:', hostelId);

    // Calculate fees with concession
    let calculatedTerm1Fee = 0;
    let calculatedTerm2Fee = 0;
    let calculatedTerm3Fee = 0;
    let totalCalculatedFee = 0;

    try {
      // Fetch fee structure for the category and academic year
      const FeeStructure = (await import('../models/FeeStructure.js')).default;
      const feeStructure = await FeeStructure.getFeeStructure(academicYear, course, year, category);
      
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

    // Generate random password
    const generatedPassword = User.generateRandomPassword();

    // Handle photo uploads
    let studentPhotoUrl = null;
    let guardianPhoto1Url = null;
    let guardianPhoto2Url = null;

    if (req.files) {
      try {
        if (req.files.studentPhoto && req.files.studentPhoto[0]) {
          console.log('📸 Uploading student photo to S3...');
          studentPhotoUrl = await uploadToS3(req.files.studentPhoto[0], 'student-photos');
          console.log('✅ Student photo uploaded successfully:', studentPhotoUrl);
        }
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

    // Handle photo URLs from preregistration (if no file uploads)
    if (!studentPhotoUrl && req.body.studentPhotoUrl) {
      studentPhotoUrl = req.body.studentPhotoUrl;
    }
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

    // Create new student
    const student = new User({
      name,
      rollNumber: rollNumber.toUpperCase(),
      password: generatedPassword,
      role: 'student',
      gender,
      course,
      year,
      branch,
      category,
      mealType,
      parentPermissionForOuting: parentPermissionForOuting !== undefined ? parentPermissionForOuting : true,
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
      email: finalEmail,
      hostelId,
      isPasswordChanged: false,
      studentPhoto: studentPhotoUrl,
      guardianPhoto1: guardianPhoto1Url,
      guardianPhoto2: guardianPhoto2Url,
      ...concessionData,
      calculatedTerm1Fee,
      calculatedTerm2Fee,
      calculatedTerm3Fee,
      totalCalculatedFee
    });

    const savedStudent = await student.save();

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

    res.json({
      success: true,
      data: {
        student: savedStudent,
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

// Add batch validation function
const validateBatch = async (batch, courseId) => {
  // Check if batch matches the format YYYY-YYYY
  if (!/^\d{4}-\d{4}$/.test(batch)) {
    return false;
  }

  const [startYear, endYear] = batch.split('-').map(Number);
  const duration = endYear - startYear;
  
  // If courseId is provided, fetch the course to get its duration
  if (courseId) {
    try {
      const course = await Course.findById(courseId);
      if (course && course.duration) {
        return duration === course.duration;
      }
    } catch (error) {
      console.error('Error fetching course for batch validation:', error);
    }
  }
  
  // Fallback to old validation for backward compatibility
  if (typeof courseId === 'string' && !courseId.includes('-')) {
    // This might be a course name (old format)
    if (courseId === 'B.Tech' || courseId === 'Pharmacy') {
      return duration === 4;
    } else if (courseId === 'Diploma' || courseId === 'Degree') {
      return duration === 3;
    }
  }
  
  // If we can't determine the expected duration, allow common durations (3-4 years)
  return duration >= 3 && duration <= 4;
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
          // Calculate year based on batch and current date
          const courseDuration = courseDoc.duration || 4;
          yearValue = await calculateCurrentYear(finalBatch, courseDuration, courseDoc._id);
          console.log(`Calculated year for batch ${finalBatch}: ${yearValue} (course duration: ${courseDuration})`);
        }

      // Handle batch - if only starting year is provided, calculate end year based on course duration
      let finalBatch = String(Batch).trim();
      if (finalBatch && !finalBatch.includes('-')) {
        // Only starting year provided, calculate end year
        const startYear = parseInt(finalBatch, 10);
        if (isNaN(startYear) || startYear < 2000 || startYear > 2100) {
          results.failureCount++;
          results.errors.push({ 
            error: `Invalid batch starting year "${finalBatch}". Must be a valid year between 2000-2100.`, 
            details: studentData 
          });
          continue;
        }
        
        const courseDuration = courseDoc.duration || 4; // Default to 4 years
        const endYear = startYear + courseDuration;
        finalBatch = `${startYear}-${endYear}`;
        console.log(`Auto-generated batch: ${startYear} → ${finalBatch} (${courseDuration} years)`);
      } else if (finalBatch && !/^\d{4}-\d{4}$/.test(finalBatch)) {
        results.failureCount++;
        results.errors.push({ 
          error: `Invalid batch format "${finalBatch}". Use YYYY-YYYY or just YYYY.`, 
          details: studentData 
        });
        continue;
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
    const { page = 1, limit = 10, course, branch, gender, category, roomNumber, batch, academicYear, year, search, hostelStatus } = req.query;
    const query = { role: 'student' };

    // Add filters if provided
    if (course) query.course = course;
    if (branch) query.branch = branch;
    if (gender) query.gender = gender;
    if (category) query.category = category;
    if (roomNumber) query.roomNumber = roomNumber;
    if (batch) query.batch = batch;
    if (academicYear) query.academicYear = academicYear;
    if (year) query.year = parseInt(year); // Convert to number for proper filtering
    if (hostelStatus) query.hostelStatus = hostelStatus;

    // Add search functionality if search term is provided
    if (search) {
      const searchRegex = new RegExp(search, 'i'); // 'i' for case-insensitive
      query.$or = [
        { name: searchRegex },
        { rollNumber: searchRegex }
      ];
    }

    console.log('Query:', query); // Debug log

    const students = await User.find(query)
      .select('-password')
      .populate('course', 'name code')
      .populate('branch', 'name code')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await User.countDocuments(query);

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
      .populate('course', 'name code')
      .populate('branch', 'name code');
    
    if (!student) {
      throw createError(404, 'Student not found');
    }

    res.json({
      success: true,
      data: student
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
      course, 
      year,
      branch, 
      gender,
      category,
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

    // Validate gender if provided
    if (gender && !['Male', 'Female'].includes(gender)) {
      throw createError(400, 'Invalid gender. Must be Male or Female.');
    }

    // Validate category based on gender
    if (category) {
      const validCategories = (gender || student.gender) === 'Male' 
        ? ['A+', 'A', 'B+', 'B'] 
        : ['A+', 'A', 'B', 'C'];
      if (!validCategories.includes(category)) {
        throw createError(400, 'Invalid category for the selected gender.');
      }
    }

    // Validate room number based on gender and category - check against actual Room model
    if (roomNumber) {
      const roomGender = gender || student.gender;
      const roomCategory = category || student.category;
      
      // Check if room exists in database with matching gender and category
      const roomDoc = await Room.findOne({ 
        roomNumber, 
        gender: roomGender, 
        category: roomCategory 
      });
      
      if (!roomDoc) {
        throw createError(400, 'Invalid room number for the selected gender and category.');
      }
    }

    // Validate batch format and duration based on course
    if (batch) {
      const isValidBatch = await validateBatch(batch, course || student.course);
      if (!isValidBatch) {
        // Try to get course details for better error message
        let expectedDuration = '3-4';
        try {
          const courseDoc = await Course.findById(course || student.course);
          if (courseDoc && courseDoc.duration) {
            expectedDuration = courseDoc.duration.toString();
          }
        } catch (error) {
          console.error('Error fetching course for error message:', error);
        }
        throw createError(400, `Invalid batch format. Must be YYYY-YYYY with correct duration (${expectedDuration} years).`);
      }
    }

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

    // Validate bed and locker assignment if provided
    if (bedNumber) {
      // Check if bed is already occupied by another student
      const bedOccupied = await User.findOne({ 
        bedNumber, 
        role: 'student',
        hostelStatus: 'Active',
        _id: { $ne: student._id } // Exclude current student
      });
      if (bedOccupied) {
        throw createError(400, 'Selected bed is already occupied by another student');
      }
      
      // Validate bed format matches room
      const roomToCheck = roomNumber || student.roomNumber;
      const expectedBedFormat = `${roomToCheck} Bed `;
      if (!bedNumber.startsWith(expectedBedFormat)) {
        throw createError(400, 'Invalid bed number format for this room');
      }
    }

    if (lockerNumber) {
      // Check if locker is already occupied by another student
      const lockerOccupied = await User.findOne({ 
        lockerNumber, 
        role: 'student',
        hostelStatus: 'Active',
        _id: { $ne: student._id } // Exclude current student
      });
      if (lockerOccupied) {
        throw createError(400, 'Selected locker is already occupied by another student');
      }
      
      // Validate locker format matches room
      const roomToCheck = roomNumber || student.roomNumber;
      const expectedLockerFormat = `${roomToCheck} Locker `;
      if (!lockerNumber.startsWith(expectedLockerFormat)) {
        throw createError(400, 'Invalid locker number format for this room');
      }
    }

    // Handle photo uploads
    if (req.files) {
      if (req.files.studentPhoto && req.files.studentPhoto[0]) {
        // Delete old photo if exists
        if (student.studentPhoto) {
          try {
            await deleteFromS3(student.studentPhoto);
          } catch (error) {
            console.error('Error deleting old student photo:', error);
          }
        }
        // Upload new photo
        student.studentPhoto = await uploadToS3(req.files.studentPhoto[0], 'student-photos');
      }
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
    if (rollNumber) student.rollNumber = rollNumber;
    if (course) student.course = course;
    if (year) student.year = year;
    if (branch) student.branch = branch;
    if (gender) student.gender = gender;
    if (category) student.category = category;
    if (mealType) student.mealType = mealType;
    if (parentPermissionForOuting !== undefined) {
      console.log('🔧 Updating parentPermissionForOuting:', parentPermissionForOuting, 'type:', typeof parentPermissionForOuting);
      student.parentPermissionForOuting = Boolean(parentPermissionForOuting);
      console.log('🔧 Updated student.parentPermissionForOuting to:', student.parentPermissionForOuting);
    }
    if (roomNumber) student.roomNumber = roomNumber;
    if (bedNumber !== undefined) student.bedNumber = bedNumber;
    if (lockerNumber !== undefined) student.lockerNumber = lockerNumber;
    if (studentPhone !== undefined) student.studentPhone = studentPhone;
    if (parentPhone) student.parentPhone = parentPhone;
    if (batch) student.batch = batch;
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
              student.course,
              student.year,
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
              student.course,
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
        }
      }
    }

    // Graduation status auto-update on manual edit
    let maxYear = 3; // Default
    try {
      const courseDoc = await Course.findById(course || student.course);
      if (courseDoc && courseDoc.duration) {
        maxYear = courseDoc.duration;
      }
    } catch (error) {
      console.error('Error fetching course for graduation status:', error);
      // Fallback to old logic
      const courseKey = Object.keys(COURSES).find(key => COURSES[key] === (course || student.course));
      maxYear = (courseKey === 'BTECH' || courseKey === 'PHARMACY') ? 4 : 3;
    }
    
    const batchEndYear = getEndYear(student.batch);
    const academicEndYear = getEndYear(student.academicYear);
    if (
      student.year >= maxYear &&
      batchEndYear &&
      academicEndYear &&
      batchEndYear === academicEndYear
    ) {
      student.graduationStatus = 'Graduated';
    } else {
      student.graduationStatus = 'Enrolled';
    }

    await student.save();

    res.json({
      success: true,
      data: {
        student: {
          id: student._id,
          name: student.name,
          rollNumber: student.rollNumber,
          gender: student.gender,
          course: student.course,
          year: student.year,
          branch: student.branch,
          category: student.category,
          mealType: student.mealType,
          parentPermissionForOuting: student.parentPermissionForOuting,
          roomNumber: student.roomNumber,
          bedNumber: student.bedNumber,
          lockerNumber: student.lockerNumber,
          studentPhone: student.studentPhone,
          parentPhone: student.parentPhone,
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

// Delete student
export const deleteStudent = async (req, res, next) => {
  try {
    const student = await User.findOne({ _id: req.params.id, role: 'student' });
    
    if (!student) {
      throw createError(404, 'Student not found');
    }

    // Delete photos from S3
    const photosToDelete = [student.studentPhoto, student.guardianPhoto1, student.guardianPhoto2].filter(Boolean);
    
    for (const photoUrl of photosToDelete) {
      try {
        await deleteFromS3(photoUrl);
      } catch (error) {
        console.error('Error deleting photo from S3:', error);
      }
    }

    // Delete related records first
    // Delete complaints
    await Complaint.deleteMany({ student: student._id });
    
    // Delete leave requests
    await Leave.deleteMany({ student: student._id });

    // Delete the student
    const deleteResult = await User.findByIdAndDelete(req.params.id);

    if (!deleteResult) {
      throw createError(500, 'Failed to delete student from database');
    }

    // Also delete the corresponding TempStudent record
    await TempStudent.deleteOne({ mainStudentId: student._id });

    res.json({
      success: true,
      message: 'Student deleted successfully'
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

// Get course counts for admin dashboard
export const getCourseCounts = async (req, res, next) => {
  try {
    const { course, branch, gender, category, roomNumber, batch, academicYear, hostelStatus } = req.query;
    
    // Build query for students
    const query = { 
      role: 'student'
    };

    // Add filters if provided
    if (course) query.course = course;
    if (branch) query.branch = branch;
    if (gender) query.gender = gender;
    if (category) query.category = category;
    if (roomNumber) query.roomNumber = roomNumber;
    if (batch) query.batch = batch;
    if (academicYear) query.academicYear = academicYear;
    if (hostelStatus) query.hostelStatus = hostelStatus;

    // Aggregate to get counts by course
    const courseCounts = await User.aggregate([
      { $match: query },
      {
        $lookup: {
          from: 'courses',
          localField: 'course',
          foreignField: '_id',
          as: 'courseData'
        }
      },
      {
        $group: {
          _id: '$course',
          count: { $sum: 1 },
          courseName: { $first: { $arrayElemAt: ['$courseData.name', 0] } }
        }
      },
      {
        $project: {
          courseName: 1,
          count: 1
        }
      }
    ]);

    // Convert to object format
    const countsObject = {};
    courseCounts.forEach(item => {
      const courseName = item.courseName || 'Unknown Course';
      countsObject[courseName] = item.count;
    });

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

// Batch Renewal
export const renewBatches = async (req, res, next) => {
  try {
    const { fromAcademicYear, toAcademicYear, studentIds, displayedStudentIds } = req.body;
    const adminId = req.admin?._id || null;

    if (!fromAcademicYear || !toAcademicYear || !studentIds) {
      throw createError(400, 'Academic years and a list of student IDs are required.');
    }
    if (!Array.isArray(studentIds)) {
      throw createError(400, 'studentIds must be an array.');
    }

    if (!validateAcademicYear(fromAcademicYear) || !validateAcademicYear(toAcademicYear)) {
      throw createError(400, 'Invalid academic year format.');
    }

    const [fromStart] = fromAcademicYear.split('-').map(Number);
    const [toStart] = toAcademicYear.split('-').map(Number);

    if (toStart <= fromStart) {
      throw createError(400, '"To" academic year must be after "From" academic year.');
    }

    // Import FeeStructure model
    const FeeStructure = (await import('../models/FeeStructure.js')).default;

    // Determine if we should deactivate unchecked students
    // Only deactivate if displayedStudentIds is explicitly provided (course filter was applied)
    let uncheckedStudentIds = [];
    
    if (displayedStudentIds && Array.isArray(displayedStudentIds) && displayedStudentIds.length > 0) {
      // Course filter was applied - deactivate unchecked students from that course only
      uncheckedStudentIds = displayedStudentIds.filter(id => !studentIds.includes(id));
      console.log(`🔍 Renewal with course filter: ${displayedStudentIds.length} displayed, ${studentIds.length} selected, ${uncheckedStudentIds.length} to deactivate`);
    } else {
      // No course filter - only renew selected students, DON'T deactivate anyone
      console.log(`🔍 Renewal without course filter: ${studentIds.length} students to renew, NO deactivations`);
    }

    let renewedCount = 0;
    let graduatedCount = 0;
    let deactivatedCount = 0;
    const errors = [];
    const graduationDetails = [];
    const renewalDetails = [];

    // Renew selected students
    for (const studentId of studentIds) {
      try {
        const student = await User.findById(studentId);
        if (!student) {
          errors.push({ id: studentId, error: 'Student not found.' });
          continue;
        }

        let maxYear = 3; // Default
        try {
          const courseDoc = await Course.findById(student.course);
          if (courseDoc && courseDoc.duration) {
            maxYear = courseDoc.duration;
          }
        } catch (error) {
          console.error('Error fetching course for batch renewal:', error);
          // Fallback to old logic
          const courseKey = Object.keys(COURSES).find(key => COURSES[key] === student.course);
          maxYear = (courseKey === 'BTECH' || courseKey === 'PHARMACY') ? 4 : 3;
        }

        // Graduation logic: only if final year AND batch end year matches new academic year end year
        const batchEndYear = getEndYear(student.batch);
        const toAcademicEndYear = getEndYear(toAcademicYear);

        if (
          student.year >= maxYear &&
          batchEndYear &&
          toAcademicEndYear &&
          batchEndYear === toAcademicEndYear
        ) {
          graduatedCount++;
          // Mark as graduated but KEEP hostel access active
          student.graduationStatus = 'Graduated';
          student.academicYear = toAcademicYear; // Update to new academic year for graduation records
          // Keep hostelStatus as 'Active' - they're still in hostel until they physically leave
          await student.save();

          graduationDetails.push({
            studentId: student._id,
            name: student.name,
            rollNumber: student.rollNumber,
            course: student.course,
            year: student.year,
            status: 'Graduated (Hostel Access Active)',
            note: 'Student has graduated (batch end year matches academic year) but retains hostel access until physical departure'
          });
          continue;
        }

        // Store previous fee information for renewal history
        const previousFees = {
          term1Fee: student.calculatedTerm1Fee || 0,
          term2Fee: student.calculatedTerm2Fee || 0,
          term3Fee: student.calculatedTerm3Fee || 0,
          totalFee: student.totalCalculatedFee || 0,
          term1LateFee: student.term1LateFee || 0,
          term2LateFee: student.term2LateFee || 0,
          term3LateFee: student.term3LateFee || 0
        };
        const previousYear = student.year;
        const previousAcademicYear = student.academicYear;

        // Calculate new year
        const newYear = student.year + 1;

        // Fetch new fee structure for the new academic year
        let newFees = {
          term1Fee: 0,
          term2Fee: 0,
          term3Fee: 0,
          totalFee: 0
        };
        let feeStructureId = null;

        try {
          const feeStructure = await FeeStructure.getFeeStructure(
            toAcademicYear,
            student.course,
            newYear,
            student.category
          );

          if (feeStructure) {
            feeStructureId = feeStructure._id;
            
            // For NEW academic year, calculate fees WITHOUT concession
            // Concession must be re-requested and re-approved for the new year
            newFees = {
              term1Fee: feeStructure.term1Fee,
              term2Fee: feeStructure.term2Fee,
              term3Fee: feeStructure.term3Fee,
              totalFee: feeStructure.totalFee
            };

            // Update student's calculated fees (without concession for new year)
            student.calculatedTerm1Fee = feeStructure.term1Fee;
            student.calculatedTerm2Fee = feeStructure.term2Fee;
            student.calculatedTerm3Fee = feeStructure.term3Fee;
            student.totalCalculatedFee = feeStructure.totalFee;

            console.log(`💰 Fee update for ${student.rollNumber}:`, {
              previous: previousFees,
              new: newFees,
              note: 'New year - no concession applied. Concession must be re-requested.'
            });
          } else {
            console.log(`⚠️ No fee structure found for ${student.rollNumber} - ${toAcademicYear}, Year ${newYear}, Category ${student.category}`);
          }
        } catch (feeError) {
          console.error(`Error fetching fee structure for ${student.rollNumber}:`, feeError);
        }

        // Store previous year's concession in academicYearConcessions (if any)
        const previousConcession = student.concession || 0;
        const hadApprovedConcession = previousConcession > 0 && student.concessionApproved;
        
        if (previousConcession > 0) {
          if (!student.academicYearConcessions) {
            student.academicYearConcessions = [];
          }
          
          // Check if entry already exists for previous year
          const existingEntry = student.academicYearConcessions.find(
            c => c.academicYear === previousAcademicYear
          );
          
          if (!existingEntry) {
            student.academicYearConcessions.push({
              academicYear: previousAcademicYear,
              amount: previousConcession,
              status: student.concessionApproved ? 'approved' : 'pending',
              requestedBy: student.concessionRequestedBy,
              requestedAt: student.concessionRequestedAt,
              approvedBy: student.concessionApprovedBy,
              approvedAt: student.concessionApprovedAt,
              notes: `Archived during renewal to ${toAcademicYear}`
            });
          }
          
          // Add to concession history
          if (!student.concessionHistory) {
            student.concessionHistory = [];
          }
          student.concessionHistory.push({
            action: 'renewed',
            amount: previousConcession, // Keep same amount for new request
            previousAmount: previousConcession,
            academicYear: toAcademicYear,
            performedBy: adminId,
            performedAt: new Date(),
            notes: `Auto-requested concession of ₹${previousConcession} for ${toAcademicYear} based on previous year's approved concession.`
          });
        }

        // Handle concession for new academic year
        if (hadApprovedConcession) {
          // If student had an APPROVED concession, auto-create a new request for the same amount
          // This request will go to the approval queue for Super Admin to approve
          student.concession = previousConcession; // Request same amount
          student.concessionApproved = false; // Needs approval
          student.concessionApprovedBy = null;
          student.concessionApprovedAt = null;
          student.concessionRequestedBy = adminId; // System/admin who did renewal
          student.concessionRequestedAt = new Date();
          
          // Add new year entry to academicYearConcessions as pending
          student.academicYearConcessions.push({
            academicYear: toAcademicYear,
            amount: previousConcession,
            status: 'pending',
            requestedBy: adminId,
            requestedAt: new Date(),
            notes: `Auto-requested based on ${previousAcademicYear} approved concession of ₹${previousConcession}`
          });
          
          console.log(`📋 Auto-created concession request for ${student.rollNumber}: ₹${previousConcession} (pending approval)`);
        } else {
          // No approved concession - reset to 0
          student.concession = 0;
          student.concessionApproved = false;
          student.concessionApprovedBy = null;
          student.concessionApprovedAt = null;
          student.concessionRequestedBy = null;
          student.concessionRequestedAt = null;
        }

        // Reset late fees for the new academic year
        student.term1LateFee = 0;
        student.term2LateFee = 0;
        student.term3LateFee = 0;
        student.lateFeeApplied = {
          term1: false,
          term2: false,
          term3: false
        };

        // Create renewal history entry
        const renewalEntry = {
          previousAcademicYear,
          previousYear,
          previousFees,
          newAcademicYear: toAcademicYear,
          newYear,
          newFees,
          feeStructureId,
          previousConcession: previousConcession,
          newConcession: 0, // Reset - must be re-requested
          renewedAt: new Date(),
          renewedBy: adminId,
          notes: `Renewed from ${previousAcademicYear} (Year ${previousYear}) to ${toAcademicYear} (Year ${newYear}). Concession reset to ₹0.`
        };

        // Add to renewal history
        if (!student.renewalHistory) {
          student.renewalHistory = [];
        }
        student.renewalHistory.push(renewalEntry);
        student.totalRenewals = (student.totalRenewals || 0) + 1;

        // Update student's year and academic year
        student.year = newYear;
        student.academicYear = toAcademicYear;
        student.hostelStatus = 'Active'; // Ensure they remain active
        student.graduationStatus = 'Enrolled'; // Ensure they remain enrolled

        await student.save();
        renewedCount++;

        // Add to renewal details for response
        renewalDetails.push({
          studentId: student._id,
          name: student.name,
          rollNumber: student.rollNumber,
          previousYear,
          newYear,
          previousFees,
          newFees,
          previousConcession: previousConcession,
          newConcession: hadApprovedConcession ? previousConcession : 0,
          concessionAutoRequested: hadApprovedConcession, // Auto-created request for approval
          concessionPendingApproval: hadApprovedConcession, // Needs Super Admin approval
          totalRenewals: student.totalRenewals
        });

      } catch (error) {
        errors.push({ id: studentId, error: error.message });
      }
    }

    // Deactivate unselected students
    for (const studentId of uncheckedStudentIds) {
      try {
        const student = await User.findById(studentId);
        if (student) {
          student.hostelStatus = 'Inactive';
          // Don't change graduation status for unselected students
          await student.save();
          deactivatedCount++;
        }
      } catch (error) {
        errors.push({ id: studentId, error: `Failed to deactivate: ${error.message}` });
      }
    }

    res.json({
      success: true,
      message: 'Batch renewal process completed.',
      data: {
        renewedCount,
        graduatedCount,
        deactivatedCount,
        errors,
        graduationDetails,
        renewalDetails
      },
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

    const student = await User.findOne({ rollNumber: new RegExp(`^${rollNumber}$`, 'i'), role: 'student' })
      .select('-password')
      .populate('course', 'name code')
      .populate('branch', 'name code');

    if (!student) {
      return next(createError(404, 'Student with this roll number not found.'));
    }

    // Fetch security settings
    let settings = await SecuritySettings.findOne();
    if (!settings) {
      settings = await SecuritySettings.create({});
    }

    // Prepare student data based on settings
    const studentObj = student.toObject();
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
    
    await student.save();

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
export const getStudentsByPrincipalCourse = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, search, gender, category, roomNumber, batch, academicYear, hostelStatus } = req.query;
    const principal = req.principal; // From principalAuth middleware

    console.log('🎓 Principal students request:', {
      principalId: principal._id,
      principalCourse: principal.course,
      filters: req.query
    });

    // Build query based on principal's assigned course
    const query = {
      course: principal.course,
      role: 'student'
    };

    // Add search filter
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { rollNumber: { $regex: search, $options: 'i' } },
        { hostelId: { $regex: search, $options: 'i' } }
      ];
    }

    // Add other filters
    if (gender) query.gender = gender;
    if (category) query.category = category;
    if (roomNumber) query.roomNumber = roomNumber;
    if (batch) query.batch = batch;
    if (academicYear) query.academicYear = academicYear;
    if (hostelStatus) query.hostelStatus = hostelStatus;

    console.log('🎓 Final query:', JSON.stringify(query, null, 2));

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const totalStudents = await User.countDocuments(query);
    const totalPages = Math.ceil(totalStudents / parseInt(limit));

    // Fetch students with pagination and population
    const students = await User.find(query)
      .populate('course', 'name code')
      .populate('branch', 'name code')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('-password');

    console.log('🎓 Found students:', students.length);

    res.json({
      success: true,
      data: {
        students,
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
    
    // Transform students to include courseId
    const transformedStudents = students.map(student => ({
      ...student.toObject(),
      courseId: student.course._id,
      course: student.course.name
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
    
    // Check if student has photo
    if (!student.studentPhoto) {
      throw createError(400, 'Student photo is required for admit card generation');
    }
    
    // Check if concession is pending approval
    if (student.concession > 0 && !student.concessionApproved) {
      throw createError(400, 'Cannot generate admit card. Concession is pending approval. Please approve the concession first.');
    }
    
    // Fetch the image and convert to base64
    let photoBase64 = null;
    if (student.studentPhoto) {
      photoBase64 = await fetchImageAsBase64(student.studentPhoto);
      if (!photoBase64) {
        throw createError(400, 'Failed to fetch student photo');
      }
    }
    
    res.json({
      success: true,
      data: {
        student: {
          id: student._id,
          name: student.name,
          rollNumber: student.rollNumber,
          course: student.course?.name || student.course,
          courseId: student.course?._id || student.course,
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
          studentPhoto: photoBase64, // Return base64 image instead of URL
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
    
    // Check if all students have photos
    const studentsWithoutPhotos = students.filter(s => !s.studentPhoto);
    if (studentsWithoutPhotos.length > 0) {
      const names = studentsWithoutPhotos.map(s => s.name).join(', ');
      throw createError(400, `Students without photos: ${names}. All students must have photos for admit card generation.`);
    }
    
    // Check if any students have pending concession approvals
    const studentsWithPendingConcession = students.filter(s => s.concession > 0 && !s.concessionApproved);
    if (studentsWithPendingConcession.length > 0) {
      const names = studentsWithPendingConcession.map(s => s.name).join(', ');
      throw createError(400, `Cannot generate admit cards for students with pending concession approvals: ${names}. Please approve their concessions first.`);
    }
    
    // Fetch images for all students
    const studentsWithPhotos = [];
    for (const student of students) {
      try {
        const photoBase64 = await fetchImageAsBase64(student.studentPhoto);
        if (!photoBase64) {
          throw createError(400, `Failed to fetch photo for student: ${student.name}`);
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
          studentPhoto: photoBase64, // Return base64 image instead of URL
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
    
    if (!roomNumber) {
      throw createError(400, 'Room number is required');
    }

    // Find the room
    const room = await Room.findOne({ roomNumber });
    if (!room) {
      throw createError(404, 'Room not found');
    }

    // Get all students currently in this room
    const studentsInRoom = await User.find({ 
      roomNumber: roomNumber, 
      role: 'student',
      hostelStatus: 'Active'
    }).select('bedNumber lockerNumber');

    // Get occupied beds and lockers
    const occupiedBeds = studentsInRoom
      .filter(student => student.bedNumber)
      .map(student => student.bedNumber);
    
    const occupiedLockers = studentsInRoom
      .filter(student => student.lockerNumber)
      .map(student => student.lockerNumber);

    // Generate all possible beds and lockers based on room's bed count
    const allBeds = [];
    const allLockers = [];
    
    for (let i = 1; i <= room.bedCount; i++) {
      const bedNumber = `${roomNumber} Bed ${i}`;
      const lockerNumber = `${roomNumber} Locker ${i}`;
      
      allBeds.push({
        value: bedNumber,
        label: bedNumber,
        occupied: occupiedBeds.includes(bedNumber)
      });
      
      allLockers.push({
        value: lockerNumber,
        label: lockerNumber,
        occupied: occupiedLockers.includes(lockerNumber)
      });
    }

    // Filter out occupied beds and lockers for available options
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
        occupiedBeds,
        occupiedLockers,
        currentOccupancy: studentsInRoom.length
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
    let students;
    try {
      students = await User.find(query)
        .populate('course', 'name')
        .populate('branch', 'name')
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
      const courseId = student.course?._id || student.course || null;
      const courseName = student.course?.name || 'N/A';
      
      try {
        if (student.academicYear && courseId && student.year && student.category) {
          const feeStructure = await FeeStructure.getFeeStructure(
            student.academicYear,
            courseId,
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
        courseId: courseId,
        course: courseName,
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
    let students;
    try {
      students = await User.find(query)
        .populate('course', 'name')
        .populate('branch', 'name')
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
      const courseId = student.course?._id || student.course || null;
      const courseName = student.course?.name || 'N/A';
      
      try {
        if (student.academicYear && courseId && student.year && student.category) {
          const feeStructure = await FeeStructure.getFeeStructure(
            student.academicYear,
            courseId,
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
        courseId: courseId,
        course: courseName,
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
    
    await student.save();
    
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
    
    await student.save();
    
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