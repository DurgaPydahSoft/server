import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import TempStudent from '../models/TempStudent.js';
import { createError } from '../utils/error.js';

// Generate JWT token
const generateToken = (user) => {
  return jwt.sign(
    { _id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
};

// Student login
export const studentLogin = async (req, res, next) => {
  try {
    const { rollNumber, password } = req.body;

    // Find student
    const student = await User.findOne({ 
      rollNumber: rollNumber.toUpperCase(),
      role: 'student'
    });
    
    if (!student) {
      throw createError(401, 'Invalid roll number or password');
    }

    // Check hostel status - prevent inactive students from logging in
    if (student.hostelStatus === 'Inactive') {
      throw createError(403, 'Your hostel access has been deactivated. Please contact the administration for assistance.');
    }

    // Verify password
    const isMatch = await student.comparePassword(password);
    if (!isMatch) {
      throw createError(401, 'Invalid roll number or password');
    }

    // Generate token
    const token = generateToken(student);

    res.json({
      success: true,
      data: {
        token,
        student: {
          id: student._id,
          name: student.name,
          rollNumber: student.rollNumber,
          course: student.course,
          branch: student.branch,
          roomNumber: student.roomNumber,
          isPasswordChanged: student.isPasswordChanged,
          gender: student.gender,
          category: student.category,
          year: student.year,
          studentPhone: student.studentPhone,
          parentPhone: student.parentPhone,
          hostelStatus: student.hostelStatus
        },
        requiresPasswordChange: !student.isPasswordChanged
      }
    });
  } catch (error) {
    next(error);
  }
};

// Reset password
export const resetPassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    const student = await User.findById(req.user._id);
    
    if (!student) {
      throw createError(404, 'Student not found');
    }

    const isMatch = await student.comparePassword(currentPassword);
    if (!isMatch) {
      throw createError(401, 'Current password is incorrect');
    }

    student.password = newPassword;
    student.isPasswordChanged = true;
    
    await student.save();

    // Attempt to delete TempStudent record
    try {
      await TempStudent.deleteOne({ mainStudentId: student._id });
      // Log successful deletion or if no record was found (which is fine)
      console.log(`TempStudent record processed for student ID: ${student._id}`);
    } catch (tempStudentError) {
      // Log error but don't let it fail the whole password reset
      console.error(`Error deleting TempStudent for student ID ${student._id}:`, tempStudentError);
    }

    const token = generateToken(student);

    res.json({
      success: true,
      message: 'Password reset successfully',
      data: {
        token,
        student: {
          id: student._id,
          name: student.name,
          rollNumber: student.rollNumber,
          isPasswordChanged: true
        }
      }
    });
  } catch (error) {
    console.error('Password reset error:', error);
    next(error);
  }
};

// Verify student roll number
export const verifyRollNumber = async (req, res) => {
  try {
    const { rollNumber } = req.body;

    const student = await User.findOne({ rollNumber, role: 'student' });
    
    if (!student) {
      return res.status(404).json({ message: 'Roll number not found' });
    }

    // Check hostel status - prevent inactive students from registering
    if (student.hostelStatus === 'Inactive') {
      return res.status(403).json({ message: 'Your hostel access has been deactivated. Please contact the administration for assistance.' });
    }

    if (student.isRegistered) {
      return res.status(400).json({ message: 'Student already registered' });
    }

    res.json({
      name: student.name,
      degree: student.degree,
      branch: student.branch,
      year: student.year,
      roomNumber: student.roomNumber
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// Complete student registration
export const completeRegistration = async (req, res) => {
  try {
    const { rollNumber, password } = req.body;

    const student = await User.findOne({ rollNumber, role: 'student' });
    
    if (!student) {
      return res.status(404).json({ message: 'Roll number not found' });
    }

    // Check hostel status - prevent inactive students from registering
    if (student.hostelStatus === 'Inactive') {
      return res.status(403).json({ message: 'Your hostel access has been deactivated. Please contact the administration for assistance.' });
    }

    if (student.isRegistered) {
      return res.status(400).json({ message: 'Student already registered' });
    }

    student.password = password;
    student.isRegistered = true;
    await student.save();

    const token = generateToken(student);
    
    res.json({
      token,
      user: {
        id: student._id,
        name: student.name,
        rollNumber: student.rollNumber,
        role: student.role,
        degree: student.degree,
        branch: student.branch,
        year: student.year,
        roomNumber: student.roomNumber
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
}; 