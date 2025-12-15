import Course from '../models/Course.js';
import Branch from '../models/Branch.js';
import { getCourseById, getBranchById } from './courseBranchHelper.js';
import { getCoursesFromSQL, getBranchesByCourseFromSQL } from './courseBranchMapper.js';

/**
 * Resolve course ID - handles both SQL and MongoDB formats
 * Returns MongoDB ObjectId if possible, otherwise returns the SQL ID format
 */
export const resolveCourseId = async (courseId) => {
  if (!courseId) return null;
  
  // If it's already a MongoDB ObjectId format (24 hex chars), return as-is
  if (typeof courseId === 'string' && /^[0-9a-fA-F]{24}$/.test(courseId)) {
    // Verify it exists in MongoDB
    const course = await Course.findById(courseId);
    if (course) {
      return courseId;
    }
  }
  
  // If it's a SQL ID format (sql_XXX or numeric)
  if (typeof courseId === 'string' && courseId.startsWith('sql_')) {
    // Extract SQL ID and return the SQL format ID
    // For hybrid approach, we'll store both SQL ID and use SQL format
    return courseId;
  }
  
  // If it's numeric, treat as SQL ID
  if (typeof courseId === 'number' || /^\d+$/.test(courseId.toString())) {
    return `sql_${courseId}`;
  }
  
  // Try to get from SQL first
  const sqlCourse = await getCourseById(courseId);
  if (sqlCourse) {
    return sqlCourse._id; // Returns sql_XXX format
  }
  
  // Fallback to MongoDB
  const mongoCourse = await Course.findById(courseId);
  if (mongoCourse) {
    return mongoCourse._id.toString();
  }
  
  return null;
};

/**
 * Resolve branch ID - handles both SQL and MongoDB formats
 */
export const resolveBranchId = async (branchId, courseId = null) => {
  if (!branchId) return null;
  
  // If it's already a MongoDB ObjectId format, return as-is
  if (typeof branchId === 'string' && /^[0-9a-fA-F]{24}$/.test(branchId)) {
    const branch = await Branch.findById(branchId);
    if (branch) {
      return branchId;
    }
  }
  
  // If it's a SQL ID format
  if (typeof branchId === 'string' && branchId.startsWith('sql_')) {
    return branchId;
  }
  
  // If it's numeric, treat as SQL ID
  if (typeof branchId === 'number' || /^\d+$/.test(branchId.toString())) {
    return `sql_${branchId}`;
  }
  
  // Try to get from SQL first
  const sqlBranch = await getBranchById(branchId);
  if (sqlBranch) {
    return sqlBranch._id; // Returns sql_XXX format
  }
  
  // Fallback to MongoDB
  const mongoBranch = await Branch.findById(branchId);
  if (mongoBranch) {
    return mongoBranch._id.toString();
  }
  
  return null;
};

/**
 * Get SQL IDs from course/branch IDs
 */
export const extractSQLIds = (courseId, branchId) => {
  let sqlCourseId = null;
  let sqlBranchId = null;
  
  if (courseId && typeof courseId === 'string' && courseId.startsWith('sql_')) {
    sqlCourseId = parseInt(courseId.replace('sql_', ''));
  } else if (courseId && /^\d+$/.test(courseId.toString())) {
    sqlCourseId = parseInt(courseId);
  }
  
  if (branchId && typeof branchId === 'string' && branchId.startsWith('sql_')) {
    sqlBranchId = parseInt(branchId.replace('sql_', ''));
  } else if (branchId && /^\d+$/.test(branchId.toString())) {
    sqlBranchId = parseInt(branchId);
  }
  
  return { sqlCourseId, sqlBranchId };
};

/**
 * Create or get MongoDB course document for SQL course
 * This ensures backward compatibility
 */
export const ensureMongoDBCourse = async (sqlCourseId) => {
  try {
    // First, check if a MongoDB document already exists for this SQL course by sqlId
    let existing = await Course.findOne({ sqlId: sqlCourseId });
    if (existing) {
      return existing._id;
    }
    
    // Fetch course from SQL
    const { fetchCourseByIdFromSQL } = await import('./sqlService.js');
    const result = await fetchCourseByIdFromSQL(sqlCourseId);
    
    if (!result.success) {
      return null;
    }
    
    const sqlCourse = result.data;
    
    // Check if a course with the same name already exists (even without sqlId)
    existing = await Course.findOne({ name: sqlCourse.name });
    if (existing) {
      // Update existing course with sqlId if it doesn't have one
      if (!existing.sqlId) {
        existing.sqlId = sqlCourseId;
        await existing.save();
      }
      return existing._id;
    }
    
    // Create a new MongoDB document for reference
    try {
      const mongoCourse = new Course({
        name: sqlCourse.name,
        code: sqlCourse.code || sqlCourse.name.substring(0, 10).toUpperCase(),
        description: sqlCourse.metadata ? JSON.stringify(sqlCourse.metadata) : '',
        duration: sqlCourse.total_years || 4,
        durationUnit: 'years',
        isActive: sqlCourse.is_active === 1,
        sqlId: sqlCourseId // Store SQL ID for reference
      });
      
      await mongoCourse.save();
      return mongoCourse._id;
    } catch (saveError) {
      // If save fails due to duplicate (race condition), try to find again
      if (saveError.code === 11000) {
        existing = await Course.findOne({ name: sqlCourse.name });
        if (existing) {
          // Update with sqlId if needed
          if (!existing.sqlId) {
            existing.sqlId = sqlCourseId;
            await existing.save();
          }
          return existing._id;
        }
      }
      throw saveError;
    }
  } catch (error) {
    console.error('❌ Error ensuring MongoDB course:', error);
    return null;
  }
};

/**
 * Create or get MongoDB branch document for SQL branch
 */
export const ensureMongoDBBranch = async (sqlBranchId, sqlCourseId) => {
  try {
    // First, check if a MongoDB document already exists for this SQL branch by sqlId
    let existing = await Branch.findOne({ sqlId: sqlBranchId });
    if (existing) {
      return existing._id;
    }
    
    // Fetch branch from SQL
    const { fetchBranchByIdFromSQL } = await import('./sqlService.js');
    const result = await fetchBranchByIdFromSQL(sqlBranchId);
    
    if (!result.success) {
      return null;
    }
    
    const sqlBranch = result.data;
    
    // Get or create MongoDB course reference
    const courseMongoId = await ensureMongoDBCourse(sqlCourseId || sqlBranch.course_id);
    if (!courseMongoId) {
      return null;
    }
    
    // Check if a branch with the same name and course already exists (even without sqlId)
    // Also check by code in case name differs slightly
    existing = await Branch.findOne({ 
      $or: [
        { name: sqlBranch.name, course: courseMongoId },
        { code: sqlBranch.code, course: courseMongoId }
      ]
    });
    
    if (existing) {
      // Update existing branch with sqlId if it doesn't have one
      if (!existing.sqlId) {
        existing.sqlId = sqlBranchId;
        await existing.save();
      }
      return existing._id;
    }
    
    // Create a new MongoDB document for reference
    try {
      const mongoBranch = new Branch({
        name: sqlBranch.name,
        code: sqlBranch.code || sqlBranch.name.substring(0, 10).toUpperCase(),
        description: sqlBranch.metadata ? JSON.stringify(sqlBranch.metadata) : '',
        course: courseMongoId,
        isActive: sqlBranch.is_active === 1,
        sqlId: sqlBranchId // Store SQL ID for reference
      });
      
      await mongoBranch.save();
      return mongoBranch._id;
    } catch (saveError) {
      // Handle duplicate key (course + code) by returning the existing branch
      if (saveError.code === 11000) {
        // First try exact code + course
        existing = await Branch.findOne({ code: sqlBranch.code, course: courseMongoId });
        if (existing) {
          if (!existing.sqlId) {
            existing.sqlId = sqlBranchId;
            await existing.save();
          }
          return existing._id;
        }
        // Then try name + course
        existing = await Branch.findOne({ name: sqlBranch.name, course: courseMongoId });
        if (existing) {
          if (!existing.sqlId) {
            existing.sqlId = sqlBranchId;
            await existing.save();
          }
          return existing._id;
        }
      }
      // Re-throw if not handled
      throw saveError;
    }
  } catch (error) {
    console.error('❌ Error ensuring MongoDB branch:', error);
    return null;
  }
};

