import Course from '../models/Course.js';
import Branch from '../models/Branch.js';
import { fetchCourseByIdFromSQL, fetchBranchByIdFromSQL } from './sqlService.js';
import { mapSQLCourseToMongoFormat, mapSQLBranchToMongoFormat } from './courseBranchMapper.js';

/**
 * Get course by ID (handles both SQL and MongoDB formats)
 */
export const getCourseById = async (courseId) => {
  try {
    // Check if it's a SQL ID format (sql_XXX)
    if (courseId && courseId.toString().startsWith('sql_')) {
      const sqlId = parseInt(courseId.toString().replace('sql_', ''));
      const result = await fetchCourseByIdFromSQL(sqlId);
      if (result.success) {
        return mapSQLCourseToMongoFormat(result.data);
      }
      return null;
    }
    
    // Check if it's a numeric ID (SQL ID without prefix)
    if (courseId && /^\d+$/.test(courseId.toString())) {
      const result = await fetchCourseByIdFromSQL(parseInt(courseId));
      if (result.success) {
        return mapSQLCourseToMongoFormat(result.data);
      }
      return null;
    }
    
    // Otherwise, try MongoDB
    return await Course.findById(courseId);
  } catch (error) {
    console.error('❌ Error getting course by ID:', error);
    return null;
  }
};

/**
 * Get branch by ID (handles both SQL and MongoDB formats)
 */
export const getBranchById = async (branchId) => {
  try {
    // Check if it's a SQL ID format (sql_XXX)
    if (branchId && branchId.toString().startsWith('sql_')) {
      const sqlId = parseInt(branchId.toString().replace('sql_', ''));
      const result = await fetchBranchByIdFromSQL(sqlId);
      if (result.success) {
        return mapSQLBranchToMongoFormat(result.data);
      }
      return null;
    }
    
    // Check if it's a numeric ID (SQL ID without prefix)
    if (branchId && /^\d+$/.test(branchId.toString())) {
      const result = await fetchBranchByIdFromSQL(parseInt(branchId));
      if (result.success) {
        return mapSQLBranchToMongoFormat(result.data);
      }
      return null;
    }
    
    // Otherwise, try MongoDB
    return await Branch.findById(branchId).populate('course', 'name code');
  } catch (error) {
    console.error('❌ Error getting branch by ID:', error);
    return null;
  }
};


