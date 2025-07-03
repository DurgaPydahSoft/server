import express from 'express';
import Course from '../models/Course.js';
import Branch from '../models/Branch.js';
import { superAdminAuth, protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// ==================== COURSE ROUTES ====================

// Get all courses (public access for dropdowns)
router.get('/courses', async (req, res) => {
  try {
    const courses = await Course.find({ isActive: true })
      .select('name code description duration durationUnit')
      .sort({ name: 1 });
    
    res.json({
      success: true,
      data: courses
    });
  } catch (error) {
    console.error('Error fetching courses:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch courses'
    });
  }
});

// Get all courses (admin view with inactive courses)
router.get('/courses/all', superAdminAuth, async (req, res) => {
  try {
    const courses = await Course.find()
      .populate('createdBy', 'username')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: courses
    });
  } catch (error) {
    console.error('Error fetching all courses:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch courses'
    });
  }
});

// Create new course
router.post('/courses', superAdminAuth, async (req, res) => {
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

// Update course
router.put('/courses/:id', superAdminAuth, async (req, res) => {
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

// Delete course (hard delete)
router.delete('/courses/:id', superAdminAuth, async (req, res) => {
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

// Get branches by course (public access for dropdowns)
router.get('/branches/:courseId', async (req, res) => {
  try {
    const { courseId } = req.params;
    const branches = await Branch.find({ 
      course: courseId, 
      isActive: true 
    })
    .select('name code description isActive')
    .sort({ name: 1 });
    res.json({
      success: true,
      data: branches
    });
  } catch (error) {
    console.error('Error fetching branches:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch branches'
    });
  }
});

// Get all branches (public access for dropdowns)
router.get('/branches', async (req, res) => {
  try {
    const branches = await Branch.find({ isActive: true })
      .populate('course', 'name code')
      .select('name code description course isActive')
      .sort({ name: 1 });
    res.json({
      success: true,
      data: branches
    });
  } catch (error) {
    console.error('Error fetching branches:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch branches'
    });
  }
});

// Get all branches (admin view with inactive branches)
router.get('/branches/all', superAdminAuth, async (req, res) => {
  try {
    const branches = await Branch.find()
      .populate('course', 'name code')
      .populate('createdBy', 'username')
      .select('name code description course isActive createdBy')
      .sort({ createdAt: -1 });
    res.json({
      success: true,
      data: branches
    });
  } catch (error) {
    console.error('Error fetching all branches:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch branches'
    });
  }
});

// Create new branch
router.post('/branches', superAdminAuth, async (req, res) => {
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

// Update branch
router.put('/branches/:id', superAdminAuth, async (req, res) => {
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

// Delete branch (soft delete)
router.delete('/branches/:id', superAdminAuth, async (req, res) => {
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

// Get courses with their branches
router.get('/courses-with-branches', protect, async (req, res) => {
  try {
    const courses = await Course.find({ isActive: true })
      .populate({
        path: 'branches',
        match: { isActive: true },
        select: 'name code'
      })
      .select('name code description duration durationUnit')
      .sort({ name: 1 });
    
    res.json({
      success: true,
      data: courses
    });
  } catch (error) {
    console.error('Error fetching courses with branches:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch courses with branches'
    });
  }
});

export default router; 