import { fetchCoursesFromSQL, fetchBranchesFromSQL, fetchBranchesByCourseFromSQL } from './sqlService.js';
import Course from '../models/Course.js';
import Branch from '../models/Branch.js';

// Cache for SQL courses and branches (refresh every 5 minutes)
let coursesCache = null;
let branchesCache = null;
let cacheTimestamp = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Normalize course/branch name for matching
 */
const normalizeName = (name) => {
  if (!name) return '';
  return name.trim().toUpperCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+/g, '');
};

/**
 * Refresh cache if expired
 */
const refreshCacheIfNeeded = async () => {
  const now = Date.now();
  if (!cacheTimestamp || (now - cacheTimestamp) > CACHE_DURATION) {
    console.log('🔄 Refreshing courses and branches cache from SQL...');
    const coursesResult = await fetchCoursesFromSQL();
    const branchesResult = await fetchBranchesFromSQL();
    
    if (coursesResult.success) {
      coursesCache = coursesResult.data;
    }
    if (branchesResult.success) {
      branchesCache = branchesResult.data;
    }
    cacheTimestamp = now;
    console.log(`✅ Cache refreshed: ${coursesCache?.length || 0} courses, ${branchesCache?.length || 0} branches`);
  }
};

/**
 * Map SQL course to MongoDB format (for backward compatibility)
 */
export const mapSQLCourseToMongoFormat = (sqlCourse) => {
  return {
    _id: `sql_${sqlCourse.id}`, // Use SQL ID with prefix for identification
    sqlId: sqlCourse.id, // Store actual SQL ID
    name: sqlCourse.name,
    code: sqlCourse.code || sqlCourse.name.substring(0, 10).toUpperCase(),
    description: sqlCourse.metadata ? JSON.stringify(sqlCourse.metadata) : '',
    duration: sqlCourse.total_years || 4,
    durationUnit: 'years',
    isActive: sqlCourse.is_active === 1,
    createdAt: sqlCourse.created_at,
    updatedAt: sqlCourse.updated_at
  };
};

/**
 * Map SQL branch to MongoDB format (for backward compatibility)
 */
export const mapSQLBranchToMongoFormat = (sqlBranch) => {
  return {
    _id: `sql_${sqlBranch.id}`, // Use SQL ID with prefix
    sqlId: sqlBranch.id, // Store actual SQL ID
    sqlCourseId: sqlBranch.course_id, // Store SQL course ID
    name: sqlBranch.name,
    code: sqlBranch.code || sqlBranch.name.substring(0, 10).toUpperCase(),
    description: sqlBranch.metadata ? JSON.stringify(sqlBranch.metadata) : '',
    course: `sql_${sqlBranch.course_id}`, // Reference to course with SQL prefix
    courseName: sqlBranch.course_name,
    courseCode: sqlBranch.course_code,
    isActive: sqlBranch.is_active === 1,
    createdAt: sqlBranch.created_at,
    updatedAt: sqlBranch.updated_at
  };
};

/**
 * Get all courses from SQL (mapped to MongoDB format)
 */
export const getCoursesFromSQL = async () => {
  try {
    await refreshCacheIfNeeded();
    
    if (!coursesCache) {
      const result = await fetchCoursesFromSQL();
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch courses from SQL');
      }
      coursesCache = result.data;
    }
    
    // Map SQL courses to MongoDB format
    return coursesCache.map(mapSQLCourseToMongoFormat);
  } catch (error) {
    console.error('❌ Error getting courses from SQL:', error);
    // Fallback to MongoDB if SQL fails
    try {
      const mongoCourses = await Course.find({ isActive: true }).sort({ name: 1 });
      console.log('⚠️ Falling back to MongoDB courses:', mongoCourses.length);
      return mongoCourses;
    } catch (mongoError) {
      console.error('❌ MongoDB fallback also failed:', mongoError);
      throw error;
    }
  }
};

/**
 * Get all branches from SQL (mapped to MongoDB format)
 */
export const getBranchesFromSQL = async () => {
  try {
    await refreshCacheIfNeeded();
    
    if (!branchesCache) {
      const result = await fetchBranchesFromSQL();
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch branches from SQL');
      }
      branchesCache = result.data;
    }
    
    // Map SQL branches to MongoDB format
    return branchesCache.map(mapSQLBranchToMongoFormat);
  } catch (error) {
    console.error('❌ Error getting branches from SQL:', error);
    // Fallback to MongoDB if SQL fails
    try {
      const mongoBranches = await Branch.find({ isActive: true })
        .populate('course', 'name code')
        .sort({ name: 1 });
      console.log('⚠️ Falling back to MongoDB branches:', mongoBranches.length);
      return mongoBranches;
    } catch (mongoError) {
      console.error('❌ MongoDB fallback also failed:', mongoError);
      throw error;
    }
  }
};

/**
 * Get branches for a specific course from SQL
 */
export const getBranchesByCourseFromSQL = async (courseId) => {
  try {
    // Extract SQL ID from courseId (could be MongoDB ObjectId or SQL ID with prefix)
    let sqlCourseId = courseId;
    
    // If it's a MongoDB ObjectId format, try to find matching SQL course
    if (courseId.toString().startsWith('sql_')) {
      sqlCourseId = parseInt(courseId.toString().replace('sql_', ''));
    } else if (!courseId.toString().match(/^[0-9]+$/)) {
      // It's a MongoDB ObjectId, need to find matching SQL course
      const mongoCourse = await Course.findById(courseId);
      if (mongoCourse && mongoCourse.sqlId) {
        sqlCourseId = mongoCourse.sqlId;
      } else {
        // Try to match by name
        const allCourses = await getCoursesFromSQL();
        const matchedCourse = allCourses.find(c => c._id.toString() === courseId.toString());
        if (matchedCourse && matchedCourse.sqlId) {
          sqlCourseId = matchedCourse.sqlId;
        } else {
          throw new Error('Course not found');
        }
      }
    }
    
    const result = await fetchBranchesByCourseFromSQL(sqlCourseId);
    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch branches from SQL');
    }
    
    // Map SQL branches to MongoDB format
    return result.data.map(mapSQLBranchToMongoFormat);
  } catch (error) {
    console.error('❌ Error getting branches by course from SQL:', error);
    // Fallback to MongoDB if SQL fails
    try {
      const mongoBranches = await Branch.find({ 
        course: courseId, 
        isActive: true 
      }).sort({ name: 1 });
      console.log('⚠️ Falling back to MongoDB branches:', mongoBranches.length);
      return mongoBranches;
    } catch (mongoError) {
      console.error('❌ MongoDB fallback also failed:', mongoError);
      throw error;
    }
  }
};

/**
 * Find course by name or code (searches both SQL and MongoDB)
 */
export const findCourseByNameOrCode = async (nameOrCode) => {
  try {
    // First try SQL
    const sqlCourses = await getCoursesFromSQL();
    const normalized = normalizeName(nameOrCode);
    
    const sqlMatch = sqlCourses.find(c => 
      normalizeName(c.name) === normalized || 
      normalizeName(c.code) === normalized
    );
    
    if (sqlMatch) {
      return sqlMatch;
    }
    
    // Fallback to MongoDB
    const mongoCourse = await Course.findOne({
      $or: [
        { name: { $regex: new RegExp(nameOrCode, 'i') } },
        { code: { $regex: new RegExp(nameOrCode, 'i') } }
      ],
      isActive: true
    });
    
    return mongoCourse;
  } catch (error) {
    console.error('❌ Error finding course:', error);
    return null;
  }
};

/**
 * Find branch by name or code for a specific course
 */
export const findBranchByNameOrCode = async (courseId, nameOrCode) => {
  try {
    // First try SQL
    const sqlBranches = await getBranchesByCourseFromSQL(courseId);
    const normalized = normalizeName(nameOrCode);
    
    const sqlMatch = sqlBranches.find(b => 
      normalizeName(b.name) === normalized || 
      normalizeName(b.code) === normalized
    );
    
    if (sqlMatch) {
      return sqlMatch;
    }
    
    // Fallback to MongoDB
    const mongoBranch = await Branch.findOne({
      course: courseId,
      $or: [
        { name: { $regex: new RegExp(nameOrCode, 'i') } },
        { code: { $regex: new RegExp(nameOrCode, 'i') } }
      ],
      isActive: true
    });
    
    return mongoBranch;
  } catch (error) {
    console.error('❌ Error finding branch:', error);
    return null;
  }
};

/**
 * Clear cache (useful for testing or forced refresh)
 */
export const clearCache = () => {
  coursesCache = null;
  branchesCache = null;
  cacheTimestamp = null;
  console.log('🗑️ Courses and branches cache cleared');
};

