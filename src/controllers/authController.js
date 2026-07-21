import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import axios from 'axios';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import { createError } from '../utils/error.js';
import { fetchStudentCredentialsSQL } from '../utils/sqlService.js';
import { enrichStudentAcademics } from '../utils/studentAcademicEnricher.js';
import { overlayStudentDtoWithHostelRequest } from '../services/hostelRequestService.js';
import { isApplicationActive } from '../utils/studentStatusUtils.js';

const buildStudentAuthPayload = (enriched) => ({
  id: enriched._id,
  name: enriched.name,
  rollNumber: enriched.rollNumber,
  course: enriched.course,
  branch: enriched.branch,
  roomNumber: enriched.roomNumber,
  isPasswordChanged: enriched.isPasswordChanged,
  gender: enriched.gender,
  category: enriched.category,
  year: enriched.year,
  studentPhone: enriched.studentPhone,
  parentPhone: enriched.parentPhone,
  applicationStatus: enriched.applicationStatus,
  batch: enriched.batch,
  academicYear: enriched.academicYear,
  email: enriched.email,
  studentPhoto: enriched.studentPhoto,
  guardianPhoto1: enriched.guardianPhoto1,
  guardianPhoto2: enriched.guardianPhoto2
});

// Generate JWT token
const generateToken = (user) => {
  return jwt.sign(
    { _id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '50d' } // Increased session duration to 50 days
  );
};

// Student login
export const studentLogin = async (req, res, next) => {
  try {
    const { rollNumber, password } = req.body;
    const identifier = rollNumber ? rollNumber.trim().toUpperCase() : '';

    console.log(`Student login attempt - Identifier: ${identifier}`);

    // Find all student records matching this identifier, sorted by latest first
    let students = await User.find({ 
      $or: [
        { rollNumber: identifier },
        { admissionNumber: identifier }
      ],
      role: 'student'
    }).sort({ createdAt: -1 });
    
    // Expand search to catch matching records across different identifiers (e.g. rollNumber vs admissionNumber)
    if (students && students.length > 0) {
      const rollNumbers = students.map(s => s.rollNumber).filter(Boolean);
      const admissionNumbers = students.map(s => s.admissionNumber).filter(Boolean);
      students = await User.find({
        $or: [
          { rollNumber: { $in: [...rollNumbers, ...admissionNumbers] } },
          { admissionNumber: { $in: [...rollNumbers, ...admissionNumbers] } }
        ],
        role: 'student'
      }).sort({ createdAt: -1 });
      console.log(`Student records found: ${students.length} record(s). Latest: ${students[0].rollNumber} (Admission: ${students[0].admissionNumber})`);
    } else {
      console.log('Student not found with identifier:', identifier);
    }
    
    if (!students || students.length === 0) {
      throw createError(401, 'Invalid roll number or password');
    }

    const student = students[0];

    // Proactively sync password from older custom password record if latest record has default password
    if (student && !student.isPasswordChanged && students.length > 1) {
      const olderWithCustomPassword = students.slice(1).find(s => s.isPasswordChanged && s.password);
      if (olderWithCustomPassword) {
        console.log(`🔄 Proactively syncing custom password from older record ${olderWithCustomPassword._id} to latest record ${student._id}`);
        try {
          await User.updateOne(
            { _id: student._id },
            { 
              $set: { 
                password: olderWithCustomPassword.password,
                isPasswordChanged: true
              } 
            }
          );
          student.password = olderWithCustomPassword.password;
          student.isPasswordChanged = true;
        } catch (syncError) {
          console.error('Error in proactive password sync:', syncError);
        }
      }
    }

    // Block expired applications from logging in (applicationStatus is the account lifecycle)
    if (student.applicationStatus === 'Expired' || student.applicationStatus === 'Withdrawn') {
      throw createError(403, 'Your hostel access has been deactivated. Please contact the administration for assistance.');
    }

    // Verify password with MongoDB first (skip if no hostel password stored)
    let isMatch = false;
    let passwordMatchedFromOlder = false;
    let matchedOlderPasswordHash = '';
    let matchedOlderIsPasswordChanged = false;

    if (student.password) {
      isMatch = await student.comparePassword(password);
      if (isMatch) {
        console.log('✅ Password verified against latest MongoDB record');
      }
    }

    // If password doesn't match the latest record, check older records
    if (!isMatch && students.length > 1) {
      console.log('Checking password against older MongoDB records...');
      for (let i = 1; i < students.length; i++) {
        const olderStudent = students[i];
        if (olderStudent.password) {
          const matchOlder = await olderStudent.comparePassword(password);
          if (matchOlder) {
            isMatch = true;
            passwordMatchedFromOlder = true;
            matchedOlderPasswordHash = olderStudent.password;
            matchedOlderIsPasswordChanged = olderStudent.isPasswordChanged;
            console.log(`✅ Password verified against older MongoDB record (index ${i})`);
            break;
          }
        }
      }

      // If matched from older record, copy it to the latest record for subsequent logins
      if (passwordMatchedFromOlder) {
        try {
          await User.updateOne(
            { _id: student._id },
            { 
              $set: { 
                password: matchedOlderPasswordHash,
                isPasswordChanged: matchedOlderIsPasswordChanged
              } 
            }
          );
          // Update the in-memory object properties so they are correct in the response
          student.password = matchedOlderPasswordHash;
          student.isPasswordChanged = matchedOlderIsPasswordChanged;
          console.log(`✅ Synced password from older record to latest record (${student._id})`);
        } catch (syncError) {
          console.error('Error syncing password to latest record:', syncError);
        }
      }
    }
    
    // If MongoDB password doesn't match or isn't set, check against SQL database
    if (!isMatch) {
      if (!student.password) {
        console.log('No MongoDB password stored. Checking SQL database...');
      } else {
        console.log('MongoDB password verification failed. Checking SQL database...');
      }
      try {
        const sqlCredentials = await fetchStudentCredentialsSQL(identifier);
        
        if (sqlCredentials.success) {
          const { password_hash } = sqlCredentials.data;
          
          if (password_hash) {
            // Check usage of $2y$ prefix (common in PHP/Laravel bcrypt) and replace with $2a$ if needed for node.js bcrypt compatibility if failure occurs, 
            // but standard bcryptjs usually handles it.
            // Using standard comparison:
            isMatch = await bcrypt.compare(password, password_hash);
            
            if (isMatch) {
              console.log('✅ Password verified against SQL database');
            } else {
              console.log('❌ Password verification failed against SQL database');
            }
          }
        } else {
          console.log('No credentials found in SQL database for identifier:', identifier);
        }
      } catch (sqlError) {
        console.error('Error verifying SQL password:', sqlError);
        // Don't throw here, let the final check handle the failure
      }
    }

    if (!isMatch) {
      throw createError(401, 'Invalid roll number or password');
    }

    const token = generateToken(student);
    let enriched = await enrichStudentAcademics(student);
    enriched = await overlayStudentDtoWithHostelRequest(enriched);

    res.json({
      success: true,
      data: {
        token,
        student: buildStudentAuthPayload(enriched),
        requiresPasswordChange: false
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
    const identifier = rollNumber ? rollNumber.trim().toUpperCase() : '';

    const student = await User.findOne({
      $or: [
        { rollNumber: identifier },
        { admissionNumber: identifier }
      ],
      role: 'student'
    }).sort({ createdAt: -1 });
    
    if (!student) {
      return res.status(404).json({ message: 'Roll number not found' });
    }

    if (student.applicationStatus === 'Expired' || student.applicationStatus === 'Withdrawn') {
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
    const identifier = rollNumber ? rollNumber.trim().toUpperCase() : '';

    const student = await User.findOne({
      $or: [
        { rollNumber: identifier },
        { admissionNumber: identifier }
      ],
      role: 'student'
    }).sort({ createdAt: -1 });
    
    if (!student) {
      return res.status(404).json({ message: 'Roll number not found' });
    }

    if (student.applicationStatus === 'Expired' || student.applicationStatus === 'Withdrawn') {
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

// Validate token and return user (with populated course/branch for students)
export const validate = async (req, res, next) => {
  try {
    if (req.user.role === 'student') {
      const student = await User.findById(req.user._id).select('-password').lean();
      let enriched = await enrichStudentAcademics(student);
      enriched = await overlayStudentDtoWithHostelRequest(enriched);
      return res.json({ success: true, data: { user: enriched } });
    }
    // For admins and others, just return req.user
    const userResponse = req.user.toObject ? req.user.toObject() : { ...req.user };
    
    // NEW LOGIC: Inject assignedCourses AND CollegeDetails for Principals based on assignedCollegeIds (for page refreshes)
    if (req.user.role === 'principal' && req.user.assignedCollegeIds && req.user.assignedCollegeIds.length > 0) {
      try {
        const { fetchCoursesFromSQL, fetchCollegesFromSQL } = await import('../utils/sqlService.js');
        
        // 1. Fetch and inject College Details
        const sqlCollegesResult = await fetchCollegesFromSQL();
        if (sqlCollegesResult.success) {
           const allColleges = sqlCollegesResult.data;
           const myColleges = allColleges.filter(col => req.user.assignedCollegeIds.includes(col.id));
           
           // Inject detailed college info
           userResponse.assignedCollegeDetails = myColleges.map(col => ({
             id: col.id,
             name: col.name,
             code: col.code
           }));
           console.log(`🎓 [Validate] Injected ${userResponse.assignedCollegeDetails.length} college details`);
        }

        // 2. Fetch and inject Assigned Courses (existing logic)
        const sqlCoursesResult = await fetchCoursesFromSQL();
        
        if (sqlCoursesResult.success) {
           const allCourses = sqlCoursesResult.data;
           
           // Filter courses that match College IDs AND Levels
           const matchingCourses = allCourses.filter(course => {
             const collegeMatch = course.college_id && req.user.assignedCollegeIds.includes(course.college_id);
             const levelMatch = (!req.user.assignedLevels || req.user.assignedLevels.length === 0) || 
                               (course.level && req.user.assignedLevels.map(l => l.toLowerCase()).includes(course.level.toLowerCase()));
             return collegeMatch && levelMatch;
           });
           
           const derivedCourses = matchingCourses.map(c => c.name);
           console.log(`🎓 [Validate] Derived ${derivedCourses.length} courses from colleges for principal`);
           
           userResponse.assignedCourses = derivedCourses;
           if (derivedCourses.length > 0) {
             userResponse.course = derivedCourses[0];
           }
        }
      } catch (err) {
         console.error('🎓 [Validate] Error generating courses/colleges from colleges:', err);
      }
    }

    return res.json({ success: true, data: { user: userResponse } });
  } catch (error) {
    next(error);
  }
};

/**
 * SSO: Verify external token via the other backend only (no local JWT verification).
 * Expects body: { encryptedToken }.
 * Requires SSO_VERIFY_URL. Calls {SSO_VERIFY_URL}/auth/verify-token and uses the response
 * to look up user and issue our JWT. Returns same response shape as student/admin login.
 */
export const verifySSOToken = async (req, res, next) => {
  try {
    const { encryptedToken } = req.body;
    if (!encryptedToken) {
      throw createError(400, 'Token is required');
    }

    const ssoVerifyBaseUrl = process.env.SSO_VERIFY_URL && process.env.SSO_VERIFY_URL.trim();
    if (!ssoVerifyBaseUrl) {
      throw createError(500, 'SSO verification not configured: set SSO_VERIFY_URL');
    }

    const verifyEndpoint = `${ssoVerifyBaseUrl.replace(/\/$/, '')}/auth/verify-token`;
    let verifyResponse;
    try {
      verifyResponse = await axios.post(verifyEndpoint, { encryptedToken }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'SSO verification service unavailable';
      throw createError(err.response?.status === 401 ? 401 : 502, msg);
    }
    const result = verifyResponse.data;
    if (!result || !result.success || !result.valid || !result.data) {
      throw createError(401, result?.message || 'Invalid or expired token');
    }
    const userId = result.data.userId || result.data._id;
    const role = result.data.role;
    if (result.data.expiresAt && new Date(result.data.expiresAt).getTime() < Date.now()) {
      throw createError(401, 'Token has expired');
    }

    if (!userId || !role) {
      throw createError(401, 'Invalid token: missing userId or role');
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw createError(401, 'Invalid token: invalid userId');
    }

    const isStudent = role === 'student';
    if (isStudent) {
      const student = await User.findById(userId).select('-password');
      if (!student) {
        throw createError(401, 'User not found');
      }
      if (student.role !== 'student') {
        throw createError(401, 'Invalid token: user is not a student');
      }
      if (student.applicationStatus === 'Expired' || student.applicationStatus === 'Withdrawn') {
        throw createError(403, 'Your hostel access has been deactivated. Please contact the administration.');
      }

      const token = generateToken(student);
      let enriched = await enrichStudentAcademics(student);
      enriched = await overlayStudentDtoWithHostelRequest(enriched);
      return res.json({
        success: true,
        data: {
          token,
          student: buildStudentAuthPayload(enriched),
          requiresPasswordChange: false
        }
      });
    }

    // Admin/staff: resolve from Admin model
    let admin = await Admin.findById(userId).select('-password')
      .populate('customRoleId', 'name description permissions permissionAccessLevels courseAssignment assignedCourses');
    if (!admin || !admin.isActive) {
      throw createError(401, 'Admin not found or is not active');
    }

    const token = generateToken(admin);
    const adminResponse = {
      id: admin._id,
      username: admin.username,
      role: admin.role,
      permissions: admin.permissions,
      permissionAccessLevels: admin.permissionAccessLevels
    };
    if (admin.role === 'warden' && admin.hostelType) {
      adminResponse.hostelType = admin.hostelType;
    }
    if (admin.role === 'principal') {
      if (admin.assignedCourses?.length) {
        adminResponse.assignedCourses = admin.assignedCourses;
        adminResponse.course = admin.assignedCourses[0];
      } else if (admin.course) {
        adminResponse.course = admin.course;
        adminResponse.assignedCourses = [admin.course];
      }
      if (admin.branch) adminResponse.branch = admin.branch;
    }
    if (admin.role === 'custom' && admin.customRoleId) {
      adminResponse.customRoleId = admin.customRoleId;
      adminResponse.customRole = admin.customRole;
    }

    return res.json({
      success: true,
      data: {
        token,
        admin: adminResponse
      }
    });
  } catch (error) {
    next(error);
  }
}; 