import express from 'express';
import Course from '../models/Course.js';
import Branch from '../models/Branch.js';
import AcademicCalendar from '../models/AcademicCalendar.js';
import { superAdminAuth, protect, adminAuth, checkPermission } from '../middleware/authMiddleware.js';
import { getCoursesFromSQL, getBranchesFromSQL, getBranchesByCourseFromSQL } from '../utils/courseBranchMapper.js';

const router = express.Router();

// Middleware for course management permission (allows super_admin or sub-admin with course_management permission)
const courseManagementAuth = [adminAuth, (req, res, next) => {
  // Super admin always has access
  if (req.admin?.role === 'super_admin') {
    return next();
  }
  
  // Check if user has course_management permission
  if (req.admin?.permissions?.includes('course_management')) {
    return next();
  }
  
  return res.status(403).json({
    success: false,
    message: 'Access denied. You need course_management permission.'
  });
}];

// Middleware that requires full access for write operations (POST, PUT, DELETE)
const courseManagementWriteAuth = [adminAuth, (req, res, next) => {
  // Super admin always has access
  if (req.admin?.role === 'super_admin') {
    return next();
  }
  
  // Check if user has course_management permission
  if (!req.admin?.permissions?.includes('course_management')) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. You need course_management permission.'
    });
  }
  
  // Check access level - need 'full' access for write operations
  const accessLevel = req.admin?.permissionAccessLevels?.get?.('course_management') 
    || req.admin?.permissionAccessLevels?.['course_management'] 
    || 'view';
  
  if (accessLevel !== 'full') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. You need full access to course_management to perform this action.'
    });
  }
  
  return next();
}];

// ==================== COURSE ROUTES ====================

// Get all colleges from SQL
router.get('/colleges', async (req, res) => {
  try {
    const { fetchCollegesFromSQL } = await import('../utils/sqlService.js');
    const result = await fetchCollegesFromSQL();
    
    if (result.success) {
      res.json({
        success: true,
        data: result.data
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch colleges',
        error: result.error
      });
    }
  } catch (error) {
    console.error('Error fetching colleges:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch colleges',
      error: error.message
    });
  }
});

// Get all courses (public access for dropdowns) - Now fetches from SQL
router.get('/courses', async (req, res) => {
  try {
    // Fetch from SQL database
    const courses = await getCoursesFromSQL();
    
    // Map to expected format (already done in mapper, but ensure compatibility)
    const formattedCourses = courses.map(course => ({
      _id: course._id,
      sqlId: course.sqlId,
      name: course.name,
      code: course.code,
      description: course.description || '',
      duration: course.duration,
      durationUnit: course.durationUnit || 'years',
      isActive: course.isActive,
      college: course.college,
      level: course.level
    }));
    
    res.json({
      success: true,
      data: formattedCourses
    });
  } catch (error) {
    console.error('Error fetching courses:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch courses',
      error: error.message
    });
  }
});

// Get all courses (admin view with inactive courses) - Now fetches from SQL
router.get('/courses/all', courseManagementAuth, async (req, res) => {
  try {
    // Fetch all courses from SQL (including inactive)
    const { fetchCoursesFromSQL } = await import('../utils/sqlService.js');
    const result = await fetchCoursesFromSQL();
    
    if (!result.success) {
      // Fallback to MongoDB
      const courses = await Course.find().populate('createdBy', 'username').sort({ createdAt: -1 });
      return res.json({
        success: true,
        data: courses,
        source: 'mongodb'
      });
    }
    
    // Map SQL courses to MongoDB format
    const { getCoursesFromSQL } = await import('../utils/courseBranchMapper.js');
    const courses = await getCoursesFromSQL();
    
    res.json({
      success: true,
      data: courses,
      source: 'sql'
    });
  } catch (error) {
    console.error('Error fetching all courses:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch courses',
      error: error.message
    });
  }
});

// Create new course - DISABLED (courses now managed in SQL database)
router.post('/courses', courseManagementWriteAuth, async (req, res) => {
  return res.status(403).json({
    success: false,
    message: 'Course creation is disabled. Courses are now managed in the central SQL database. Please add courses through the SQL database.'
  });
  try {
    const { name, code, description, duration, durationUnit } = req.body;
    
    // Validate required fields
    if (!name || !code || !duration) {
      return res.status(400).json({
        success: false,
        message: 'Name, code, and duration are required'
      });
    }
    
    // Check if course code already exists
    const existingCourse = await Course.findOne({ code: code.toUpperCase() });
    if (existingCourse) {
      return res.status(400).json({
        success: false,
        message: 'Course code already exists'
      });
    }
    
    const course = new Course({
      name,
      code: code.toUpperCase(),
      description,
      duration,
      durationUnit: durationUnit || 'years',
      createdBy: req.user?.id || req.admin?._id
    });
    
    const savedCourse = await course.save();
    
    res.status(201).json({
      success: true,
      message: 'Course created successfully',
      data: savedCourse
    });
  } catch (error) {
    console.error('Error creating course:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create course'
    });
  }
});

// Update course - DISABLED (courses now managed in SQL database)
router.put('/courses/:id', courseManagementWriteAuth, async (req, res) => {
  return res.status(403).json({
    success: false,
    message: 'Course updates are disabled. Courses are now managed in the central SQL database. Please update courses through the SQL database.'
  });
  try {
    const { name, code, description, duration, durationUnit, isActive } = req.body;
    const courseId = req.params.id;
    
    // Check if course exists
    const existingCourse = await Course.findById(courseId);
    if (!existingCourse) {
      return res.status(404).json({
        success: false,
        message: 'Course not found'
      });
    }
    
    // Check if new code conflicts with existing course
    if (code && code !== existingCourse.code) {
      const codeConflict = await Course.findOne({ 
        code: code.toUpperCase(), 
        _id: { $ne: courseId } 
      });
      if (codeConflict) {
        return res.status(400).json({
          success: false,
          message: 'Course code already exists'
        });
      }
    }
    
    const updateData = {};
    if (name) updateData.name = name;
    if (code) updateData.code = code.toUpperCase();
    if (description !== undefined) updateData.description = description;
    if (duration) updateData.duration = duration;
    if (durationUnit) updateData.durationUnit = durationUnit;
    if (isActive !== undefined) updateData.isActive = isActive;
    
    const updatedCourse = await Course.findByIdAndUpdate(
      courseId,
      updateData,
      { new: true }
    );
    
    res.json({
      success: true,
      message: 'Course updated successfully',
      data: updatedCourse
    });
  } catch (error) {
    console.error('Error updating course:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update course'
    });
  }
});

// Delete course - DISABLED (courses now managed in SQL database)
router.delete('/courses/:id', courseManagementWriteAuth, async (req, res) => {
  return res.status(403).json({
    success: false,
    message: 'Course deletion is disabled. Courses are now managed in the central SQL database. Please deactivate courses through the SQL database.'
  });
  try {
    const courseId = req.params.id;
    
    // Check if course has associated students
    const User = (await import('../models/User.js')).default;
    const studentCount = await User.countDocuments({ course: courseId });
    if (studentCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete course. It has ${studentCount} enrolled students.`
      });
    }

    // Delete all branches under this course
    const branchDeleteResult = await Branch.deleteMany({ course: courseId });

    // Delete the course itself
    const result = await Course.deleteOne({ _id: courseId });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Course not found'
      });
    }

    res.json({
      success: true,
      message: `Course and ${branchDeleteResult.deletedCount} associated branches deleted permanently`
    });
  } catch (error) {
    console.error('Error deleting course:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete course'
    });
  }
});

// ==================== BRANCH ROUTES ====================

// Get branches by course (public access for dropdowns) - Now fetches from SQL
router.get('/branches/:courseId', async (req, res) => {
  try {
    const { courseId } = req.params;
    
    // Fetch from SQL database
    const branches = await getBranchesByCourseFromSQL(courseId);
    
    // Map to expected format
    const formattedBranches = branches.map(branch => ({
      _id: branch._id,
      sqlId: branch.sqlId,
      name: branch.name,
      code: branch.code,
      description: branch.description || '',
      course: branch.course,
      isActive: branch.isActive
    }));
    
    res.json({
      success: true,
      data: formattedBranches
    });
  } catch (error) {
    console.error('Error fetching branches:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch branches',
      error: error.message
    });
  }
});

// Get all branches (public access for dropdowns) - Now fetches from SQL
router.get('/branches', async (req, res) => {
  try {
    // Fetch from SQL database
    const branches = await getBranchesFromSQL();
    
    // Map to expected format with course info
    const formattedBranches = branches.map(branch => ({
      _id: branch._id,
      sqlId: branch.sqlId,
      name: branch.name,
      code: branch.code,
      description: branch.description || '',
      course: branch.course ? {
        _id: branch.course,
        name: branch.courseName,
        code: branch.courseCode
      } : null,
      isActive: branch.isActive
    }));
    
    res.json({
      success: true,
      data: formattedBranches
    });
  } catch (error) {
    console.error('Error fetching branches:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch branches',
      error: error.message
    });
  }
});

// Get all branches (admin view with inactive branches) - Now fetches from SQL
router.get('/branches/all', courseManagementAuth, async (req, res) => {
  try {
    // Fetch all branches from SQL
    const branches = await getBranchesFromSQL();
    
    // Map to expected format
    const formattedBranches = branches.map(branch => ({
      _id: branch._id,
      sqlId: branch.sqlId,
      name: branch.name,
      code: branch.code,
      description: branch.description || '',
      course: branch.course ? {
        _id: branch.course,
        name: branch.courseName,
        code: branch.courseCode
      } : null,
      isActive: branch.isActive,
      createdAt: branch.createdAt,
      updatedAt: branch.updatedAt
    }));
    
    res.json({
      success: true,
      data: formattedBranches,
      source: 'sql'
    });
  } catch (error) {
    console.error('Error fetching all branches:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch branches',
      error: error.message
    });
  }
});

// Create new branch - DISABLED (branches now managed in SQL database)
router.post('/branches', courseManagementWriteAuth, async (req, res) => {
  return res.status(403).json({
    success: false,
    message: 'Branch creation is disabled. Branches are now managed in the central SQL database. Please add branches through the SQL database.'
  });
  try {
    const { name, code, courseId, description } = req.body;
    
    // Validate required fields
    if (!name || !code || !courseId) {
      return res.status(400).json({
        success: false,
        message: 'Name, code, and course are required'
      });
    }
    
    // Check if course exists and is active
    const course = await Course.findById(courseId);
    if (!course || !course.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or inactive course'
      });
    }
    
    // Check if branch code already exists for this course
    const existingBranch = await Branch.findOne({ 
      course: courseId, 
      code: code.toUpperCase() 
    });
    if (existingBranch) {
      return res.status(400).json({
        success: false,
        message: 'Branch code already exists for this course'
      });
    }
    
    const branch = new Branch({
      name,
      code: code.toUpperCase(),
      course: courseId,
      description,
      createdBy: req.user?.id || req.admin?._id
    });
    
    const savedBranch = await branch.save();
    
    // Populate course details for response
    await savedBranch.populate('course', 'name code');
    
    res.status(201).json({
      success: true,
      message: 'Branch created successfully',
      data: savedBranch
    });
  } catch (error) {
    console.error('Error creating branch:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create branch'
    });
  }
});

// Update branch - DISABLED (branches now managed in SQL database)
router.put('/branches/:id', courseManagementWriteAuth, async (req, res) => {
  return res.status(403).json({
    success: false,
    message: 'Branch updates are disabled. Branches are now managed in the central SQL database. Please update branches through the SQL database.'
  });
  try {
    const { name, code, description, isActive } = req.body;
    const branchId = req.params.id;
    
    // Check if branch exists
    const existingBranch = await Branch.findById(branchId);
    if (!existingBranch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found'
      });
    }
    
    // Check if new code conflicts with existing branch in same course
    if (code && code !== existingBranch.code) {
      const codeConflict = await Branch.findOne({ 
        course: existingBranch.course,
        code: code.toUpperCase(), 
        _id: { $ne: branchId } 
      });
      if (codeConflict) {
        return res.status(400).json({
          success: false,
          message: 'Branch code already exists for this course'
        });
      }
    }
    
    const updateData = {};
    if (name) updateData.name = name;
    if (code) updateData.code = code.toUpperCase();
    if (description !== undefined) updateData.description = description;
    if (isActive !== undefined) updateData.isActive = isActive;
    
    const updatedBranch = await Branch.findByIdAndUpdate(
      branchId,
      updateData,
      { new: true }
    ).populate('course', 'name code');
    
    res.json({
      success: true,
      message: 'Branch updated successfully',
      data: updatedBranch
    });
  } catch (error) {
    console.error('Error updating branch:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update branch'
    });
  }
});

// Delete branch - DISABLED (branches now managed in SQL database)
router.delete('/branches/:id', courseManagementWriteAuth, async (req, res) => {
  return res.status(403).json({
    success: false,
    message: 'Branch deletion is disabled. Branches are now managed in the central SQL database. Please deactivate branches through the SQL database.'
  });
  try {
    const branchId = req.params.id;
    
    // Check if branch has associated students
    const User = (await import('../models/User.js')).default;
    const studentCount = await User.countDocuments({ branch: branchId });
    if (studentCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete branch. It has ${studentCount} enrolled students.`
      });
    }
    
    const branch = await Branch.findByIdAndUpdate(
      branchId,
      { isActive: false },
      { new: true }
    );
    
    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Branch deactivated successfully'
    });
  } catch (error) {
    console.error('Error deleting branch:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete branch'
    });
  }
});

// ==================== UTILITY ROUTES ====================

// Get courses with their branches - Now fetches from SQL
router.get('/courses-with-branches', protect, async (req, res) => {
  try {
    // Fetch courses and branches from SQL
    const courses = await getCoursesFromSQL();
    const allBranches = await getBranchesFromSQL();
    
    // Group branches by course
    const coursesWithBranches = courses.map(course => {
      const courseBranches = allBranches
        .filter(branch => branch.sqlCourseId === course.sqlId)
        .map(branch => ({
          _id: branch._id,
          name: branch.name,
          code: branch.code
        }));
      
      return {
        ...course,
        branches: courseBranches
      };
    });
    
    res.json({
      success: true,
      data: coursesWithBranches
    });
  } catch (error) {
    console.error('Error fetching courses with branches:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch courses with branches',
      error: error.message
    });
  }
});

// ==================== ACADEMIC CALENDAR ROUTES ====================

// Get all academic calendars (admin view)
router.get('/academic-calendars', async (req, res) => {
  try {
    const { courseId, academicYear, yearOfStudy } = req.query;
    
    let query = {};
    
    // Filter by course if specified
    if (courseId) {
      query.course = courseId;
    }
    
    // Filter by academic year if specified
    if (academicYear) {
      query.academicYear = academicYear;
    }
    
    // Filter by year of study if specified
    if (yearOfStudy) {
      query.yearOfStudy = parseInt(yearOfStudy);
    }
    
    const academicCalendars = await AcademicCalendar.find(query)
      .populate('course', 'name code')
      .populate('createdBy', 'username')
      .populate('updatedBy', 'username')
      .sort({ academicYear: -1, 'course.name': 1, yearOfStudy: 1, semester: 1 });
    
    res.json({
      success: true,
      data: academicCalendars
    });
  } catch (error) {
    console.error('Error fetching academic calendars:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch academic calendars'
    });
  }
});

// Get academic calendars for a specific course
router.get('/academic-calendars/course/:courseId', async (req, res) => {
  try {
    const { courseId } = req.params;
    const { academicYear } = req.query;
    
    // Check if course exists
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found'
      });
    }
    
    const academicCalendars = await AcademicCalendar.getActiveSemesters(courseId, academicYear);
    
    res.json({
      success: true,
      data: academicCalendars
    });
  } catch (error) {
    console.error('Error fetching course academic calendars:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch course academic calendars'
    });
  }
});

// Create new academic calendar entry
router.post('/academic-calendars', courseManagementWriteAuth, async (req, res) => {
  try {
    const { courseId, academicYear, yearOfStudy, semester, startDate, endDate } = req.body;
    
    // Validate required fields
    if (!courseId || !academicYear || !yearOfStudy || !semester || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required including year of study'
      });
    }
    
    // Check if course exists and is active
    const course = await Course.findById(courseId);
    if (!course || !course.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or inactive course'
      });
    }
    
    // Validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (end <= start) {
      return res.status(400).json({
        success: false,
        message: 'End date must be after start date'
      });
    }
    
    // Check for overlapping semesters
    const overlap = await AcademicCalendar.checkOverlap(courseId, academicYear, yearOfStudy, semester, start, end);
    if (overlap) {
      return res.status(400).json({
        success: false,
        message: `Overlapping semester found. ${semester} ${academicYear} for Year ${yearOfStudy} already exists for this course with overlapping dates.`
      });
    }
    
    const academicCalendar = new AcademicCalendar({
      course: courseId,
      academicYear,
      yearOfStudy: parseInt(yearOfStudy),
      semester,
      startDate: start,
      endDate: end,
      createdBy: req.user?.id || req.admin?._id || null
    });
    
    const savedCalendar = await academicCalendar.save();
    await savedCalendar.populate('course', 'name code');
    await savedCalendar.populate('createdBy', 'username');
    
    res.status(201).json({
      success: true,
      message: 'Academic calendar entry created successfully',
      data: savedCalendar
    });
  } catch (error) {
    console.error('Error creating academic calendar:', error);
    
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Academic calendar entry already exists for this course, academic year, and semester'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to create academic calendar entry'
    });
  }
});

// Update academic calendar entry
router.put('/academic-calendars/:id', courseManagementWriteAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { academicYear, yearOfStudy, semester, startDate, endDate, isActive } = req.body;
    
    // Check if academic calendar entry exists
    const existingEntry = await AcademicCalendar.findById(id);
    if (!existingEntry) {
      return res.status(404).json({
        success: false,
        message: 'Academic calendar entry not found'
      });
    }
    
    // Validate dates if provided
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      if (end <= start) {
        return res.status(400).json({
          success: false,
          message: 'End date must be after start date'
        });
      }
      
      // Check for overlapping semesters (excluding current entry)
      const overlap = await AcademicCalendar.checkOverlap(
        existingEntry.course,
        academicYear || existingEntry.academicYear,
        yearOfStudy || existingEntry.yearOfStudy,
        semester || existingEntry.semester,
        start,
        end,
        id
      );
      
      if (overlap) {
        return res.status(400).json({
          success: false,
          message: `Overlapping semester found. ${semester || existingEntry.semester} ${academicYear || existingEntry.academicYear} for Year ${yearOfStudy || existingEntry.yearOfStudy} already exists for this course with overlapping dates.`
        });
      }
    }
    
    const updateData = {
      updatedBy: req.user?.id || req.admin?._id || null
    };
    
    if (academicYear) updateData.academicYear = academicYear;
    if (yearOfStudy) updateData.yearOfStudy = parseInt(yearOfStudy);
    if (semester) updateData.semester = semester;
    if (startDate) updateData.startDate = new Date(startDate);
    if (endDate) updateData.endDate = new Date(endDate);
    if (isActive !== undefined) updateData.isActive = isActive;
    
    const updatedEntry = await AcademicCalendar.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    ).populate('course', 'name code')
     .populate('createdBy', 'username')
     .populate('updatedBy', 'username');
    
    res.json({
      success: true,
      message: 'Academic calendar entry updated successfully',
      data: updatedEntry
    });
  } catch (error) {
    console.error('Error updating academic calendar:', error);
    
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Academic calendar entry already exists for this course, academic year, and semester'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to update academic calendar entry'
    });
  }
});

// Delete academic calendar entry (hard delete)
router.delete('/academic-calendars/:id', courseManagementWriteAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if academic calendar entry exists
    const academicCalendar = await AcademicCalendar.findById(id);
    if (!academicCalendar) {
      return res.status(404).json({
        success: false,
        message: 'Academic calendar entry not found'
      });
    }
    
    // Permanently delete the entry from database
    await AcademicCalendar.findByIdAndDelete(id);
    
    res.json({
      success: true,
      message: 'Academic calendar entry deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting academic calendar:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete academic calendar entry'
    });
  }
});

export default router; 