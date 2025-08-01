import User from '../models/User.js';
import Counter from '../models/Counter.js';
import { uploadToS3, deleteFromS3 } from '../utils/s3Service.js';
import { sendAdminCredentialsSMS } from '../utils/smsService.js';
import XLSX from 'xlsx';
import fs from 'fs';

// Function to generate hostel ID
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

// Upload students via Excel
export const uploadStudents = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);
    let added = 0, skipped = 0;
    
    for (const row of data) {
      const {
        Name, RollNumber, Degree, Branch, Year, RoomNumber, StudentPhone, ParentPhone, Gender
      } = row;
      
      if (!Name || !RollNumber) { skipped++; continue; }
      
      const exists = await User.findOne({ rollNumber: RollNumber });
      if (exists) { skipped++; continue; }
      
      // Look up course and branch ObjectIds
      const CourseModel = (await import('../models/Course.js')).default;
      const BranchModel = (await import('../models/Branch.js')).default;
      const courseDoc = await CourseModel.findOne({ name: Degree });
      const branchDoc = await BranchModel.findOne({ name: Branch });
      
      // Generate hostel ID
      const hostelId = await generateHostelId(Gender || 'Male'); // Default to Male if gender not specified
      
      // Handle email properly - only set if provided and not empty
      const emailValue = row.Email || row.email || '';
      const finalEmail = emailValue === '' ? undefined : emailValue;

      await User.create({
        name: Name,
        rollNumber: RollNumber,
        hostelId: hostelId,
        course: courseDoc ? courseDoc._id : undefined,
        branch: branchDoc ? branchDoc._id : undefined,
        year: Year,
        gender: Gender || 'Male',
        roomNumber: RoomNumber,
        studentPhone: StudentPhone,
        parentPhone: ParentPhone,
        email: finalEmail,
        password: 'changeme',
        role: 'student',
        isRegistered: false
      });
      added++;
    }
    fs.unlinkSync(req.file.path);
    res.json({ message: `Added: ${added}, Skipped: ${skipped}` });
  } catch (error) {
    res.status(500).json({ message: 'Error uploading students', error });
  }
};

// Manual add student
export const addStudent = async (req, res) => {
  try {
    console.log('Received request body:', req.body);
    
    const { 
      name, 
      rollNumber, 
      course, 
      branch, 
      year, 
      roomNumber, 
      studentPhone, 
      parentPhone, 
      gender,
      category,
      batch,
      academicYear,
      email
    } = req.body;
    
    console.log('Extracted fields:', { name, rollNumber, course, branch, year, gender });
    
    if (await User.findOne({ rollNumber })) {
      return res.status(400).json({ message: 'Student already exists' });
    }
    
    // Generate hostel ID
    const hostelId = await generateHostelId(gender || 'Male');
    
    // Handle email properly - only set if provided and not empty
    const emailValue = email ? String(email).trim() : '';
    const finalEmail = emailValue === '' ? undefined : emailValue;

    const studentData = {
      name, 
      rollNumber, 
      course, 
      branch, 
      year, 
      roomNumber, 
      studentPhone, 
      parentPhone,
      gender: gender || 'Male',
      category: category || 'A',
      batch: batch || '',
      academicYear: academicYear || '',
      email: finalEmail,
      hostelId,
      password: 'changeme', 
      role: 'student', 
      isRegistered: false,
      hostelStatus: 'Active',
      graduationStatus: 'Enrolled'
    };
    
    console.log('Creating student with data:', studentData);
    
    const student = await User.create(studentData);
    
    console.log('Created student:', student);
    
    // Send credentials via SMS if student phone is provided
    let deliveryResult = null;
    
    if (studentPhone && studentPhone.trim()) {
      try {
        console.log('📱 Sending student credentials via SMS to:', studentPhone);
        deliveryResult = await sendAdminCredentialsSMS(
          studentPhone,
          rollNumber, // Using rollNumber as username
          'changeme' // Default password
        );
        console.log('📱 SMS sent successfully:', deliveryResult);
      } catch (smsError) {
        console.error('📱 Error sending SMS:', smsError);
        // Don't fail the creation if SMS fails, but log it
        deliveryResult = { error: smsError.message };
      }
    } else {
      console.log('📱 No student phone number provided, skipping SMS');
      deliveryResult = { message: 'No SMS sent - no phone number provided' };
    }
    
    // Remove password from response
    const studentResponse = student.toObject();
    delete studentResponse.password;
    
    res.json({
      success: true,
      data: studentResponse,
      deliveryResult
    });
  } catch (error) {
    console.error('Error adding student:', error);
    res.status(500).json({ message: 'Error adding student', error: error.message });
  }
};

// List all students
export const listStudents = async (req, res) => {
  try {
    const students = await User.find({ role: 'student' }).select('-password');
    res.json(students);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching students', error });
  }
};

// Edit student
export const editStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const update = req.body;
    console.log('Update payload:', update); // Debug log
    delete update.password;
    delete update.hostelId; // Prevent hostel ID from being modified
    // Validate hostelStatus if present
    if (update.hostelStatus && !['Active', 'Inactive'].includes(update.hostelStatus)) {
      return res.status(400).json({ message: 'Invalid hostel status' });
    }
    const student = await User.findByIdAndUpdate(id, update, { new: true }).select('-password');
    if (!student) return res.status(404).json({ message: 'Student not found' });
    res.json(student);
  } catch (error) {
    res.status(500).json({ message: 'Error editing student', error });
  }
};

// Delete student
export const deleteStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const student = await User.findByIdAndDelete(id);
    if (!student) return res.status(404).json({ message: 'Student not found' });
    res.json({ message: 'Student deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting student', error });
  }
}; 

export const updateProfile = async (req, res) => {
  try {
    const { year } = req.body;
    const studentId = req.user.id;

    if (!year) {
      return res.status(400).json({
        success: false,
        message: 'Year is required'
      });
    }

    const student = await User.findById(studentId);
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    // Validate year based on course
    const maxYear = student.degree === 'B.Tech' || student.degree === 'Pharmacy' ? 4 : 3;
    if (year < 1 || year > maxYear) {
      return res.status(400).json({
        success: false,
        message: `Invalid year. Must be between 1 and ${maxYear} for ${student.degree}`
      });
    }

    student.year = year;
    await student.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: student
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating profile'
    });
  }
};

// Get student profile
export const getProfile = async (req, res) => {
  try {
    const studentId = req.user.id;
    const student = await User.findById(studentId)
      .select('-password')
      .populate('course', 'name code')
      .populate('branch', 'name code');
    
    console.log('Student profile response:', student);
    
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    res.json({
      success: true,
      data: student
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching profile'
    });
  }
};

// Update student profile photos
export const updateProfilePhotos = async (req, res) => {
  try {
    const studentId = req.user.id;
    const student = await User.findById(studentId);
    
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
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

    await student.save();

    res.json({
      success: true,
      message: 'Profile photos updated successfully',
      data: {
        studentPhoto: student.studentPhoto,
        guardianPhoto1: student.guardianPhoto1,
        guardianPhoto2: student.guardianPhoto2
      }
    });
  } catch (error) {
    console.error('Error updating profile photos:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating profile photos'
    });
  }
}; 