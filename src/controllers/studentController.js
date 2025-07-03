import User from '../models/User.js';
import { uploadToS3, deleteFromS3 } from '../utils/s3Service.js';
import XLSX from 'xlsx';
import fs from 'fs';

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
        Name, RollNumber, Degree, Branch, Year, RoomNumber, StudentPhone, ParentPhone
      } = row;
      if (!Name || !RollNumber) { skipped++; continue; }
      const exists = await User.findOne({ rollNumber: RollNumber });
      if (exists) { skipped++; continue; }
      // Look up course and branch ObjectIds
      const CourseModel = (await import('../models/Course.js')).default;
      const BranchModel = (await import('../models/Branch.js')).default;
      const courseDoc = await CourseModel.findOne({ name: Degree });
      const branchDoc = await BranchModel.findOne({ name: Branch });
      await User.create({
        name: Name,
        rollNumber: RollNumber,
        course: courseDoc ? courseDoc._id : undefined,
        branch: branchDoc ? branchDoc._id : undefined,
        year: Year,
        roomNumber: RoomNumber,
        studentPhone: StudentPhone,
        parentPhone: ParentPhone,
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
    const { name, rollNumber, degree, branch, year, roomNumber, studentPhone, parentPhone } = req.body;
    if (await User.findOne({ rollNumber })) {
      return res.status(400).json({ message: 'Student already exists' });
    }
    const student = await User.create({
      name, rollNumber, degree, branch, year, roomNumber, studentPhone, parentPhone,
      password: 'changeme', role: 'student', isRegistered: false
    });
    res.json(student);
  } catch (error) {
    res.status(500).json({ message: 'Error adding student', error });
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