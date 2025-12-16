import FeeStructure from '../models/FeeStructure.js';
import Course from '../models/Course.js';
import { createError } from '../utils/error.js';
import Hostel from '../models/Hostel.js';
import HostelCategory from '../models/HostelCategory.js';

// Test endpoint to verify fee structure routes are working
export const testFeeStructure = async (req, res) => {
  try {
    console.log('🔍 Backend: testFeeStructure endpoint called');
    
    // Check if any fee structures exist
    const count = await FeeStructure.countDocuments({ isActive: true });
    
    res.json({
      success: true,
      message: 'Fee structure routes are working',
      timestamp: new Date().toISOString(),
      existingStructures: count
    });
  } catch (error) {
    console.error('Error in test endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Create sample fee structures for testing
export const createSampleFeeStructures = async (req, res) => {
  try {
    console.log('🔍 Backend: Creating sample fee structures...');
    
    const sampleStructures = [
      {
        academicYear: '2024-2025',
        course: 'B.Tech',
        branch: 'CSE',
        category: 'A+',
        term1Fee: 18000,
        term2Fee: 18000,
        term3Fee: 18000,
        totalFee: 54000,
        isActive: true,
        createdBy: req.admin?._id || req.user?._id,
        updatedBy: req.admin?._id || req.user?._id
      },
      {
        academicYear: '2024-2025',
        course: 'B.Tech',
        branch: 'CSE',
        category: 'A',
        term1Fee: 15000,
        term2Fee: 15000,
        term3Fee: 15000,
        totalFee: 45000,
        isActive: true,
        createdBy: req.admin?._id || req.user?._id,
        updatedBy: req.admin?._id || req.user?._id
      },
      {
        academicYear: '2024-2025',
        course: 'B.Tech',
        branch: 'CSE',
        category: 'B+',
        term1Fee: 12000,
        term2Fee: 12000,
        term3Fee: 12000,
        totalFee: 36000,
        isActive: true,
        createdBy: req.admin?._id || req.user?._id,
        updatedBy: req.admin?._id || req.user?._id
      },
      {
        academicYear: '2024-2025',
        course: 'B.Tech',
        branch: 'CSE',
        category: 'B',
        term1Fee: 10000,
        term2Fee: 10000,
        term3Fee: 10000,
        totalFee: 30000,
        isActive: true,
        createdBy: req.admin?._id || req.user?._id,
        updatedBy: req.admin?._id || req.user?._id
      },
      {
        academicYear: '2024-2025',
        course: 'B.Tech',
        branch: 'CSE',
        category: 'C',
        term1Fee: 8000,
        term2Fee: 8000,
        term3Fee: 8000,
        totalFee: 24000,
        isActive: true,
        createdBy: req.admin?._id || req.user?._id,
        updatedBy: req.admin?._id || req.user?._id
      }
    ];
    
    // Check if structures already exist
    const existing = await FeeStructure.find({ 
      academicYear: '2024-2025', 
      isActive: true 
    });
    
    if (existing.length > 0) {
      return res.json({
        success: true,
        message: 'Sample fee structures already exist',
        count: existing.length
      });
    }
    
    // Create sample structures
    const created = await FeeStructure.insertMany(sampleStructures);
    
    console.log('🔍 Backend: Created sample structures:', created.length);
    
    res.json({
      success: true,
      message: 'Sample fee structures created successfully',
      count: created.length
    });
  } catch (error) {
    console.error('Error creating sample fee structures:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// =============== NEW ADMIN FEE RULE ENDPOINTS (SQL-aligned, hostel/category-aware) ===============

// GET /api/admin/fee-structures
export const listAdminFeeStructures = async (req, res) => {
  try {
    const {
      academicYear,
      course,
      branch,
      year,
      hostelId,
      categoryId,
      feeType,
      isActive,
    } = req.query;

    const query = {};
    if (academicYear) query.academicYear = academicYear;
    if (course) query.course = course;
    if (branch) query.branch = branch;
    if (year) query.year = parseInt(year, 10);
    if (hostelId) query.hostelId = hostelId;
    if (categoryId) query.categoryId = categoryId;
    if (feeType) query.feeType = feeType;
    if (isActive !== undefined) query.isActive = isActive === 'true';

    const data = await FeeStructure.find(query)
      .populate('hostelId', 'name')
      .populate('categoryId', 'name hostel')
      .sort({ academicYear: -1, course: 1, branch: 1, year: 1, feeType: 1 });

    res.json({ success: true, data });
  } catch (error) {
    console.error('Error listing fee structures:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch fee structures', error: error.message });
  }
};

// POST /api/admin/fee-structures
export const createAdminFeeStructure = async (req, res, next) => {
  try {
    const {
      academicYear,
      course,
      branch,
      year,
      hostelId,
      categoryId,
      feeType,
      amount,
    } = req.body;

    if (!academicYear || !course || !year || !feeType || amount === undefined) {
      throw createError(400, 'academicYear, course, year, feeType, and amount are required');
    }

    // Validate hostel/category if provided
    let hostelDoc = null;
    let categoryDoc = null;
    if (hostelId) {
      hostelDoc = await Hostel.findById(hostelId);
      if (!hostelDoc) throw createError(400, 'Invalid hostel');
    }
    if (categoryId) {
      categoryDoc = await HostelCategory.findById(categoryId);
      if (!categoryDoc) throw createError(400, 'Invalid hostel category');
      if (hostelDoc && categoryDoc.hostel.toString() !== hostelDoc._id.toString()) {
        throw createError(400, 'Category does not belong to selected hostel');
      }
    }

    // Duplicate guard
    const existing = await FeeStructure.findOne({
      academicYear,
      course,
      branch: branch || null,
      year,
      hostelId: hostelId || null,
      categoryId: categoryId || null,
      feeType,
    });
    if (existing) {
      throw createError(409, 'Fee rule already exists for the same scope');
    }

    // Calculate term fees from total amount (40%, 30%, 30% split)
    // This ensures the virtual totalFee works correctly
    const term1Fee = Math.round(amount * 0.4);
    const term2Fee = Math.round(amount * 0.3);
    const term3Fee = Math.round(amount * 0.3);
    
    // Get category name from categoryId if provided (for legacy category field compatibility)
    let categoryName = null;
    if (categoryId && categoryDoc) {
      categoryName = categoryDoc.name;
    }

    const doc = await FeeStructure.create({
      academicYear,
      course,
      branch,
      year,
      hostelId: hostelId || null,
      categoryId: categoryId || null,
      category: categoryName, // Store category name for backward compatibility
      feeType,
      amount,
      term1Fee, // Calculate and store term fees
      term2Fee,
      term3Fee,
      createdBy: req.admin?._id || req.user?._id,
      updatedBy: req.admin?._id || req.user?._id,
      isActive: true,
    });

    res.status(201).json({ success: true, data: doc });
  } catch (error) {
    next(error);
  }
};

// PUT /api/admin/fee-structures/:id
export const updateAdminFeeStructure = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      academicYear,
      course,
      branch,
      year,
      hostelId,
      categoryId,
      feeType,
      amount,
      isActive,
    } = req.body;

    const fee = await FeeStructure.findById(id);
    if (!fee) {
      throw createError(404, 'Fee rule not found');
    }

    // Validate hostel/category if provided
    let hostelDoc = null;
    let categoryDoc = null;
    if (hostelId) {
      hostelDoc = await Hostel.findById(hostelId);
      if (!hostelDoc) throw createError(400, 'Invalid hostel');
    }
    if (categoryId) {
      categoryDoc = await HostelCategory.findById(categoryId);
      if (!categoryDoc) throw createError(400, 'Invalid hostel category');
      if (hostelDoc && categoryDoc.hostel.toString() !== hostelDoc._id.toString()) {
        throw createError(400, 'Category does not belong to selected hostel');
      }
    }

    // Duplicate guard for new scope
    const duplicate = await FeeStructure.findOne({
      _id: { $ne: id },
      academicYear: academicYear || fee.academicYear,
      course: course || fee.course,
      branch: branch ?? fee.branch,
      year: year || fee.year,
      hostelId: hostelId ?? fee.hostelId,
      categoryId: categoryId ?? fee.categoryId,
      feeType: feeType || fee.feeType,
    });
    if (duplicate) {
      throw createError(409, 'Another fee rule exists with the same scope');
    }

    fee.academicYear = academicYear || fee.academicYear;
    fee.course = course || fee.course;
    fee.branch = branch ?? fee.branch;
    fee.year = year || fee.year;
    fee.hostelId = hostelId ?? fee.hostelId;
    fee.categoryId = categoryId ?? fee.categoryId;
    fee.feeType = feeType || fee.feeType;
    
    // Update category name for backward compatibility
    if (categoryId !== undefined) {
      if (categoryId && categoryDoc) {
        fee.category = categoryDoc.name;
      } else {
        fee.category = null; // Clear if categoryId is removed
      }
    }
    
    // Calculate and update term fees if amount is changed
    if (amount !== undefined) {
      fee.amount = amount;
      fee.term1Fee = Math.round(amount * 0.4);
      fee.term2Fee = Math.round(amount * 0.3);
      fee.term3Fee = Math.round(amount * 0.3);
    }
    
    if (isActive !== undefined) fee.isActive = isActive;
    fee.updatedBy = req.admin?._id || req.user?._id;

    await fee.save();
    res.json({ success: true, data: fee });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/admin/fee-structures/:id
export const deleteAdminFeeStructure = async (req, res, next) => {
  try {
    const { id } = req.params;
    const fee = await FeeStructure.findById(id);
    if (!fee) {
      throw createError(404, 'Fee rule not found');
    }
    await FeeStructure.findByIdAndDelete(id);
    res.json({ success: true, message: 'Fee rule deleted' });
  } catch (error) {
    next(error);
  }
};

// Get all fee structures for an academic year
// Helper function to normalize course name (imported from adminController pattern)
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

export const getFeeStructures = async (req, res) => {
  try {
    console.log('🔍 Backend: getFeeStructures called');
    console.log('🔍 Backend: Query params:', req.query);
    
    const { academicYear, course, branch, year } = req.query;
    
    if (!academicYear) {
      console.log('🔍 Backend: No academic year provided');
      return res.status(400).json({
        success: false,
        message: 'Academic year is required'
      });
    }

    console.log('🔍 Backend: Searching for academic year:', academicYear);
    
    // Build query based on provided filters
    // Normalize course name for consistent matching
    const query = { academicYear, isActive: true };
    if (course) {
      const normalizedCourse = normalizeCourseName(course.trim());
      // Use case-insensitive regex for matching to handle variations
      query.course = { $regex: new RegExp(`^${normalizedCourse.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') };
    }
    if (branch) query.branch = branch;
    if (year) query.year = parseInt(year);
    
    const feeStructures = await FeeStructure.find(query)
      .populate('categoryId', 'name') // Populate category name for matching
      .populate('hostelId', 'name') // Also populate hostel for completeness
      .sort({ course: 1, branch: 1, year: 1, category: 1 });

    console.log('🔍 Backend: Found fee structures:', feeStructures.length);
    console.log('🔍 Backend: Fee structures:', feeStructures);

    // Get additional fees for this academic year (common for all students)
    const additionalFees = await FeeStructure.getAdditionalFees(academicYear);

    res.json({
      success: true,
      data: feeStructures,
      additionalFees: additionalFees
    });
  } catch (error) {
    console.error('Error fetching fee structures:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get fee structure for specific academic year, course, year, and category
export const getFeeStructure = async (req, res) => {
  try {
    const { academicYear, course, branch, year, category } = req.params;
    
    const feeStructure = await FeeStructure.findOne({ 
      academicYear, 
      course, 
      branch: branch || undefined,
      year: parseInt(year), 
      category, 
      isActive: true 
    });

    if (!feeStructure) {
      return res.status(404).json({
        success: false,
        message: 'Fee structure not found'
      });
    }

    res.json({
      success: true,
      data: feeStructure
    });
  } catch (error) {
    console.error('Error fetching fee structure:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Handle bulk fee structure creation
const handleBulkFeeStructureCreation = async (req, res, academicYear, course, branch, year, categories, adminId) => {
  try {
    console.log('🔍 Backend: Bulk creation for:', { academicYear, course, branch, year, categories });

    // Validate required fields
    if (!academicYear || !course || !branch || !year) {
      return res.status(400).json({
        success: false,
        message: 'Academic year, course, branch, and year are required for bulk creation'
      });
    }

    // Basic year validation (1-10 to stay safe)
    if (year < 1 || year > 10) {
      return res.status(400).json({
        success: false,
        message: 'Year must be between 1 and 10'
      });
    }

    // Validate categories array
    if (!Array.isArray(categories) || categories.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Categories array is required and must not be empty'
      });
    }

    // Validate all categories have required fields
    const validCategories = ['A+', 'A', 'B+', 'B', 'C'];
    for (const categoryData of categories) {
      if (!categoryData.category || !validCategories.includes(categoryData.category)) {
        return res.status(400).json({
          success: false,
          message: `Invalid category: ${categoryData.category}. Must be one of: ${validCategories.join(', ')}`
        });
      }
      if (!categoryData.totalFee || categoryData.totalFee <= 0) {
        return res.status(400).json({
          success: false,
          message: `Total fee for category ${categoryData.category} must be greater than 0`
        });
      }
    }

    // Check if all required categories are present
    const providedCategories = categories.map(c => c.category).sort();
    const requiredCategories = validCategories.sort();
    if (JSON.stringify(providedCategories) !== JSON.stringify(requiredCategories)) {
      return res.status(400).json({
        success: false,
        message: `All categories must be provided: ${requiredCategories.join(', ')}`
      });
    }

    // Process each category
    const results = [];
    const errors = [];

    for (const categoryData of categories) {
      try {
        const { category, totalFee } = categoryData;
        
        // Calculate term fees (40%, 30%, 30%)
        const calculatedTerm1Fee = Math.round(totalFee * 0.4);
        const calculatedTerm2Fee = Math.round(totalFee * 0.3);
        const calculatedTerm3Fee = Math.round(totalFee * 0.3);

        const feeStructure = await FeeStructure.createOrUpdateFeeStructure({
          academicYear,
          course,
          branch,
          year: parseInt(year),
          category,
          term1Fee: calculatedTerm1Fee,
          term2Fee: calculatedTerm2Fee,
          term3Fee: calculatedTerm3Fee,
          createdBy: adminId,
          updatedBy: adminId
        });

        results.push(feeStructure);
        console.log(`✅ Created/updated fee structure for ${category}: ₹${totalFee}`);
      } catch (error) {
        console.error(`❌ Error creating fee structure for ${categoryData.category}:`, error);
        errors.push({
          category: categoryData.category,
          error: error.message
        });
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Some fee structures could not be created',
        errors: errors,
        created: results
      });
    }

    console.log(`✅ Bulk creation completed: ${results.length} fee structures created/updated`);

    res.json({
      success: true,
      message: `Successfully created/updated ${results.length} fee structures`,
      data: results
    });

  } catch (error) {
    console.error('Error in bulk fee structure creation:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during bulk creation'
    });
  }
};

// Create or update fee structure
export const createOrUpdateFeeStructure = async (req, res) => {
  try {
    console.log('🔍 Backend: createOrUpdateFeeStructure called with body:', req.body);
    
    const { academicYear, course, branch, year, category, totalFee, term1Fee, term2Fee, term3Fee, categories } = req.body;
    const adminId = req.admin?._id || req.user?._id;

    // Check if this is a bulk creation request
    if (categories && Array.isArray(categories)) {
      return await handleBulkFeeStructureCreation(req, res, academicYear, course, branch, year, categories, adminId);
    }

    // Validate required fields for single creation
    if (!academicYear || !course || !branch || !year || !category) {
      return res.status(400).json({
        success: false,
        message: 'Academic year, course, branch, year, and category are required'
      });
    }

    // Basic year validation (1-10 to stay safe)
    if (year < 1 || year > 10) {
      return res.status(400).json({
        success: false,
        message: 'Year must be between 1 and 10'
      });
    }

    let calculatedTerm1Fee, calculatedTerm2Fee, calculatedTerm3Fee;

    // If totalFee is provided, calculate term fees (40%, 30%, 30%)
    if (totalFee !== undefined && totalFee > 0) {
      calculatedTerm1Fee = Math.round(totalFee * 0.4); // 40%
      calculatedTerm2Fee = Math.round(totalFee * 0.3); // 30%
      calculatedTerm3Fee = Math.round(totalFee * 0.3); // 30%
      
      console.log('🔍 Backend: Calculated term fees from total:', {
        totalFee,
        term1Fee: calculatedTerm1Fee,
        term2Fee: calculatedTerm2Fee,
        term3Fee: calculatedTerm3Fee
      });
    } 
    // If individual term fees are provided, use them
    else if (term1Fee !== undefined && term2Fee !== undefined && term3Fee !== undefined) {
      calculatedTerm1Fee = term1Fee;
      calculatedTerm2Fee = term2Fee;
      calculatedTerm3Fee = term3Fee;
      
      console.log('🔍 Backend: Using provided term fees:', {
        term1Fee: calculatedTerm1Fee,
        term2Fee: calculatedTerm2Fee,
        term3Fee: calculatedTerm3Fee
      });
    } 
    // If neither is provided, return error
    else {
      return res.status(400).json({
        success: false,
        message: 'Either totalFee or all term fees (term1Fee, term2Fee, term3Fee) must be provided'
      });
    }

    // Validate fees are positive numbers
    if (calculatedTerm1Fee < 0 || calculatedTerm2Fee < 0 || calculatedTerm3Fee < 0) {
      return res.status(400).json({
        success: false,
        message: 'All fees must be positive numbers'
      });
    }

    const feeStructure = await FeeStructure.createOrUpdateFeeStructure({
      academicYear,
      course,
      branch,
      year: parseInt(year),
      category,
      term1Fee: calculatedTerm1Fee,
      term2Fee: calculatedTerm2Fee,
      term3Fee: calculatedTerm3Fee,
      createdBy: adminId,
      updatedBy: adminId
    });

    console.log('🔍 Backend: Fee structure saved successfully:', feeStructure);

    res.json({
      success: true,
      message: 'Fee structure saved successfully',
      data: feeStructure
    });
  } catch (error) {
    console.error('Error creating/updating fee structure:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Fee structure for this academic year, course, year, and category already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Delete fee structure
export const deleteFeeStructure = async (req, res) => {
  try {
    const { academicYear, course, branch, year, category } = req.params;
    
    const feeStructure = await FeeStructure.findOne({ 
      academicYear, 
      course, 
      branch: branch || undefined,
      year: parseInt(year), 
      category, 
      isActive: true 
    });

    if (!feeStructure) {
      return res.status(404).json({
        success: false,
        message: 'Fee structure not found'
      });
    }

    feeStructure.isActive = false;
    await feeStructure.save();

    res.json({
      success: true,
      message: 'Fee structure deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting fee structure:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get all available academic years
export const getAcademicYears = async (req, res) => {
  try {
    const academicYears = await FeeStructure.distinct('academicYear', { isActive: true });
    
    res.json({
      success: true,
      data: academicYears.sort().reverse() // Sort in descending order
    });
  } catch (error) {
    console.error('Error fetching academic years:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get fee structure statistics
export const getFeeStructureStats = async (req, res) => {
  try {
    const { academicYear } = req.query;
    
    if (!academicYear) {
      return res.status(400).json({
        success: false,
        message: 'Academic year is required'
      });
    }

    const feeStructures = await FeeStructure.find({ 
      academicYear, 
      isActive: true 
    });

    const stats = {
      totalCategories: feeStructures.length,
      totalRevenue: feeStructures.reduce((sum, fs) => sum + fs.totalFee, 0),
      averageFee: feeStructures.length > 0 ? 
        feeStructures.reduce((sum, fs) => sum + fs.totalFee, 0) / feeStructures.length : 0,
      categoryBreakdown: feeStructures.map(fs => ({
        category: fs.category,
        totalFee: fs.totalFee,
        term1Fee: fs.term1Fee,
        term2Fee: fs.term2Fee,
        term3Fee: fs.term3Fee
      }))
    };

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching fee structure stats:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Utility endpoint to fix inactive fee structures
export const fixInactiveFeeStructures = async (req, res) => {
  try {
    console.log('🔍 Backend: Fixing inactive fee structures...');
    
    const { academicYear } = req.query;
    
    const query = academicYear ? { academicYear } : {};
    
    // Find all fee structures that are inactive
    const inactiveStructures = await FeeStructure.find({ 
      ...query,
      isActive: false 
    });
    
    console.log('🔍 Backend: Found inactive structures:', inactiveStructures.length);
    
    if (inactiveStructures.length === 0) {
      return res.json({
        success: true,
        message: 'No inactive fee structures found',
        fixed: 0
      });
    }
    
    // Activate all inactive structures
    const updateResult = await FeeStructure.updateMany(
      { 
        ...query,
        isActive: false 
      },
      { 
        isActive: true,
        updatedBy: req.admin?._id || req.user?._id
      }
    );
    
    console.log('🔍 Backend: Fixed structures:', updateResult.modifiedCount);
    
    res.json({
      success: true,
      message: `Fixed ${updateResult.modifiedCount} inactive fee structures`,
      fixed: updateResult.modifiedCount
    });
  } catch (error) {
    console.error('Error fixing inactive fee structures:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get all available courses
export const getCourses = async (req, res) => {
  try {
    const courses = await Course.find({ isActive: true })
      .select('name code duration durationUnit')
      .sort({ name: 1 });

    res.json({
      success: true,
      data: courses
    });
  } catch (error) {
    console.error('Error fetching courses:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get years for a specific course
export const getCourseYears = async (req, res) => {
  try {
    const { courseId } = req.params;
    
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found'
      });
    }

    const years = Array.from({ length: course.duration }, (_, i) => i + 1);

    res.json({
      success: true,
      data: {
        course: {
          _id: course._id,
          name: course.name,
          duration: course.duration
        },
        years
      }
    });
  } catch (error) {
    console.error('Error fetching course years:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get additional fees for an academic year
export const getAdditionalFees = async (req, res) => {
  try {
    const { academicYear } = req.params;
    const { category } = req.query; // Optional category filter
    
    if (!academicYear) {
      return res.status(400).json({
        success: false,
        message: 'Academic year is required'
      });
    }

    const additionalFees = await FeeStructure.getAdditionalFees(academicYear, category || null);

    res.json({
      success: true,
      data: additionalFees
    });
  } catch (error) {
    console.error('Error fetching additional fees:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Set additional fees for an academic year
export const setAdditionalFees = async (req, res) => {
  try {
    const { academicYear, additionalFees } = req.body;
    const adminId = req.admin?._id || req.user?._id;

    if (!academicYear) {
      return res.status(400).json({
        success: false,
        message: 'Academic year is required'
      });
    }

    if (!additionalFees || typeof additionalFees !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Additional fees object is required'
      });
    }

    // Validate additional fees structure - support dynamic fee types
    const validAdditionalFees = {};
    
    // Validate each fee type
    Object.keys(additionalFees).forEach(key => {
      const feeData = additionalFees[key];
      
      // Validate fee key (alphanumeric with underscores, max 50 chars)
      if (!/^[a-zA-Z0-9_]+$/.test(key) || key.length > 50) {
        throw new Error(`Invalid fee type name: ${key}. Must be alphanumeric with underscores, max 50 characters.`);
      }
      
      // Handle both object format {amount, description, isActive, categories} and number format (backward compatibility)
      if (typeof feeData === 'object' && feeData !== null) {
        if (typeof feeData.amount !== 'number' || feeData.amount < 0) {
          throw new Error(`Invalid amount for ${key}. Must be a non-negative number.`);
        }
        
        // Validate categories if provided (include C for Female categories)
        const validCategories = ['A+', 'A', 'B+', 'B', 'C'];
        let categories = feeData.categories;
        if (Array.isArray(categories) && categories.length > 0) {
          // Validate each category
          const invalidCategories = categories.filter(cat => !validCategories.includes(cat));
          if (invalidCategories.length > 0) {
            throw new Error(`Invalid categories for ${key}: ${invalidCategories.join(', ')}. Valid categories are: ${validCategories.join(', ')}`);
          }
        } else {
          // Default to all categories if not specified or empty
          categories = validCategories;
        }
        
        // Handle categoryAmounts if provided
        let categoryAmounts = {};
        if (feeData.categoryAmounts && typeof feeData.categoryAmounts === 'object') {
          // Validate category amounts
          Object.entries(feeData.categoryAmounts).forEach(([cat, amount]) => {
            if (validCategories.includes(cat)) {
              const numAmount = Number(amount);
              if (isNaN(numAmount) || numAmount < 0) {
                throw new Error(`Invalid amount for category ${cat} in ${key}. Must be a non-negative number.`);
              }
              categoryAmounts[cat] = numAmount;
            }
          });
        }
        
        // Calculate amount from categoryAmounts if not provided directly
        let calculatedAmount = feeData.amount || 0;
        if (Object.keys(categoryAmounts).length > 0 && !feeData.amount) {
          // Use average from categoryAmounts as fallback
          const amounts = Object.values(categoryAmounts);
          calculatedAmount = amounts.reduce((sum, amt) => sum + amt, 0) / amounts.length;
        }
        
        validAdditionalFees[key] = {
          amount: calculatedAmount, // Keep for backward compatibility
          description: feeData.description || '',
          isActive: feeData.isActive !== undefined ? feeData.isActive : true,
          categories: categories,
          categoryAmounts: Object.keys(categoryAmounts).length > 0 ? categoryAmounts : undefined
        };
      } else if (typeof feeData === 'number') {
        // Backward compatibility: if it's just a number
        if (feeData < 0) {
          throw new Error(`Invalid amount for ${key}. Must be a non-negative number.`);
        }
        validAdditionalFees[key] = {
          amount: feeData,
          description: '',
          isActive: true,
          categories: ['A+', 'A', 'B+', 'B'] // Default to all categories
        };
      } else {
        throw new Error(`Invalid format for ${key}. Must be a number or object with amount, description, isActive, and categories.`);
      }
    });

    await FeeStructure.setAdditionalFees(academicYear, validAdditionalFees, adminId);

    res.json({
      success: true,
      message: 'Additional fees updated successfully',
      data: validAdditionalFees
    });
  } catch (error) {
    console.error('Error setting additional fees:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
};

// Get fee structure for admit card generation (updated for new schema)
export const getFeeStructureForAdmitCard = async (req, res) => {
  try {
    console.log('🔍 Backend: getFeeStructureForAdmitCard called');
    console.log('🔍 Backend: Params:', req.params);
    
    const { academicYear, course, branch, year, category } = req.params;
    
    if (!academicYear || !course || !branch || !year || !category) {
      return res.status(400).json({
        success: false,
        message: 'Academic year, course, branch, year, and category are required'
      });
    }

    console.log('🔍 Backend: Searching for fee structure:', { academicYear, course, branch, year, category });
    
    const baseQuery = {
      academicYear,
      course,
      year: parseInt(year),
      category,
      isActive: true,
    };

    /**
     * We originally stored hostel fee rules without a branch (null/undefined) in the new
     * hostel/category-aligned schema. The StudentRegistrationSQL page now sends a branch
     * name (resolved from SQL), which caused lookups to miss the stored documents and
     * return zero. To be backwards compatible, try an exact branch match first, then
     * gracefully fall back to records where branch is null/undefined.
     */
    const feeStructure =
      await FeeStructure.findOne({ ...baseQuery, branch }) ||
      await FeeStructure.findOne({ ...baseQuery, branch: null }) ||
      await FeeStructure.findOne({ ...baseQuery, branch: undefined });

    console.log('🔍 Backend: Found fee structure:', feeStructure);

    if (!feeStructure) {
      return res.json({
        success: true,
        data: {
          academicYear,
          course,
        branch,
          year: parseInt(year),
          category,
          term1Fee: 0,
          term2Fee: 0,
          term3Fee: 0,
          totalFee: 0,
          found: false
        }
      });
    }

    res.json({
      success: true,
      data: {
        academicYear: feeStructure.academicYear,
        course: feeStructure.course,
        branch: feeStructure.branch,
        year: feeStructure.year,
        category: feeStructure.category,
        term1Fee: feeStructure.term1Fee,
        term2Fee: feeStructure.term2Fee,
        term3Fee: feeStructure.term3Fee,
        totalFee: feeStructure.totalFee,
        found: true
      }
    });
  } catch (error) {
    console.error('Error fetching fee structure for admit card:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
}; 