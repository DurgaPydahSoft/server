import Course from '../models/Course.js';
import Branch from '../models/Branch.js';
import { fetchCourseByIdFromSQL, fetchBranchByIdFromSQL } from './sqlService.js';
import { mapSQLCourseToMongoFormat, mapSQLBranchToMongoFormat } from './courseBranchMapper.js';

// In-memory caches to prevent redundant SQL network requests for static course/branch lookups
const courseCache = new Map();
const branchCache = new Map();

/**
 * Get course by ID (handles both SQL and MongoDB formats with caching)
 */
export const getCourseById = async (courseId) => {
  if (!courseId) return null;
  const cacheKey = courseId.toString();
  if (courseCache.has(cacheKey)) {
    return courseCache.get(cacheKey);
  }

  try {
    let result = null;
    // Check if it's a SQL ID format (sql_XXX)
    if (courseId.toString().startsWith('sql_')) {
      const sqlId = parseInt(courseId.toString().replace('sql_', ''));
      const res = await fetchCourseByIdFromSQL(sqlId);
      if (res.success) {
        result = mapSQLCourseToMongoFormat(res.data);
      }
    } else if (/^\d+$/.test(courseId.toString())) {
      const res = await fetchCourseByIdFromSQL(parseInt(courseId));
      if (res.success) {
        result = mapSQLCourseToMongoFormat(res.data);
      }
    } else {
      result = await Course.findById(courseId);
    }
    
    if (result) {
      courseCache.set(cacheKey, result);
    }
    return result;
  } catch (error) {
    console.error('❌ Error getting course by ID:', error);
    return null;
  }
};

/**
 * Get branch by ID (handles both SQL and MongoDB formats with caching)
 */
export const getBranchById = async (branchId) => {
  if (!branchId) return null;
  const cacheKey = branchId.toString();
  if (branchCache.has(cacheKey)) {
    return branchCache.get(cacheKey);
  }

  try {
    let result = null;
    // Check if it's a SQL ID format (sql_XXX)
    if (branchId.toString().startsWith('sql_')) {
      const sqlId = parseInt(branchId.toString().replace('sql_', ''));
      const res = await fetchBranchByIdFromSQL(sqlId);
      if (res.success) {
        result = mapSQLBranchToMongoFormat(res.data);
      }
    } else if (/^\d+$/.test(branchId.toString())) {
      const res = await fetchBranchByIdFromSQL(parseInt(branchId));
      if (res.success) {
        result = mapSQLBranchToMongoFormat(res.data);
      }
    } else {
      result = await Branch.findById(branchId).populate('course', 'name code');
    }
    
    if (result) {
      branchCache.set(cacheKey, result);
    }
    return result;
  } catch (error) {
    console.error('❌ Error getting branch by ID:', error);
    return null;
  }
};


