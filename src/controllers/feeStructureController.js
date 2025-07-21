import FeeStructure from '../models/FeeStructure.js';
import { createError } from '../utils/error.js';

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

// Get all fee structures for an academic year
export const getFeeStructures = async (req, res) => {
  try {
    console.log('🔍 Backend: getFeeStructures called');
    console.log('🔍 Backend: Query params:', req.query);
    console.log('🔍 Backend: Headers:', req.headers);
    
    const { academicYear } = req.query;
    
    if (!academicYear) {
      console.log('🔍 Backend: No academic year provided');
      return res.status(400).json({
        success: false,
        message: 'Academic year is required'
      });
    }

    console.log('🔍 Backend: Searching for academic year:', academicYear);
    
    // First, let's check what exists in the database without the isActive filter
    const allStructures = await FeeStructure.find({ academicYear });
    console.log('🔍 Backend: All structures for academic year (without isActive filter):', allStructures.length);
    console.log('🔍 Backend: All structures details:', allStructures.map(s => ({ 
      id: s._id, 
      category: s.category, 
      isActive: s.isActive,
      term1Fee: s.term1Fee,
      term2Fee: s.term2Fee,
      term3Fee: s.term3Fee
    })));
    
    const feeStructures = await FeeStructure.find({ 
      academicYear, 
      isActive: true 
    }).sort({ category: 1 });

    console.log('🔍 Backend: Found fee structures (with isActive filter):', feeStructures.length);
    console.log('🔍 Backend: Fee structures:', feeStructures);

    res.json({
      success: true,
      data: feeStructures
    });
  } catch (error) {
    console.error('Error fetching fee structures:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get fee structure for specific academic year and category
export const getFeeStructure = async (req, res) => {
  try {
    const { academicYear, category } = req.params;
    
    const feeStructure = await FeeStructure.findOne({ 
      academicYear, 
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

// Create or update fee structure
export const createOrUpdateFeeStructure = async (req, res) => {
  try {
    console.log('🔍 Backend: createOrUpdateFeeStructure called with body:', req.body);
    
    const { academicYear, category, totalFee, term1Fee, term2Fee, term3Fee } = req.body;
    const adminId = req.admin?._id || req.user?._id;

    // Validate required fields
    if (!academicYear || !category) {
      return res.status(400).json({
        success: false,
        message: 'Academic year and category are required'
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
        message: 'Fee structure for this academic year and category already exists'
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
    const { academicYear, category } = req.params;
    
    const feeStructure = await FeeStructure.findOne({ 
      academicYear, 
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