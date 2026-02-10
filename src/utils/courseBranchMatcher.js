import Course from '../models/Course.js';
import Branch from '../models/Branch.js';
import { getCoursesFromSQL, getBranchesFromSQL, getBranchesByCourseFromSQL } from './courseBranchMapper.js';

/**
 * Normalize course name for matching
 */
const normalizeCourseName = (name) => {
  if (!name) return '';
  return name.trim().toUpperCase()
    .replace(/\./g, '') // Remove dots
    .replace(/\s+/g, ' ') // Normalize spaces
    .replace(/\s+/g, ''); // Remove all spaces
};

/**
 * Normalize branch name for matching
 */
const normalizeBranchName = (name) => {
  if (!name) return '';
  return name.trim().toUpperCase()
    .replace(/\./g, '') // Remove dots
    .replace(/\s+/g, ' ') // Normalize spaces
    .replace(/&/g, 'AND') // Replace & with AND
    .replace(/\s+/g, ''); // Remove all spaces
};

/**
 * Calculate similarity between two strings (Levenshtein distance based)
 */
const calculateSimilarity = (str1, str2) => {
  const s1 = normalizeCourseName(str1);
  const s2 = normalizeCourseName(str2);
  
  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0.0;
  
  // Simple substring matching
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;
  
  // Character overlap
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  const overlap = [...shorter].filter(char => longer.includes(char)).length;
  return overlap / longer.length;
};

/**
 * Match SQL course name to Course (from SQL database)
 */
export const matchCourse = async (sqlCourseName) => {
  try {
    if (!sqlCourseName) {
      return { success: false, error: 'Course name is required' };
    }

    // Fetch all courses from SQL database
    const courses = await getCoursesFromSQL();
    
    if (courses.length === 0) {
      return { success: false, error: 'No courses found in database' };
    }

    const normalizedSQL = normalizeCourseName(sqlCourseName);
    
    // Try exact match first
    let bestMatch = null;
    let bestScore = 0;
    
    for (const course of courses) {
      const normalizedMongo = normalizeCourseName(course.name);
      
      // Exact match
      if (normalizedSQL === normalizedMongo) {
        return {
          success: true,
          courseId: course._id, // This will be sql_XXX format
          sqlId: course.sqlId, // Actual SQL ID
          courseName: course.name,
          college: course.college,
          matchType: 'exact'
        };
      }
      
      // Calculate similarity
      const score = calculateSimilarity(sqlCourseName, course.name);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = course;
      }
    }
    
    // If similarity is high enough (>= 0.7), return the match
    if (bestScore >= 0.7 && bestMatch) {
      return {
        success: true,
        courseId: bestMatch._id,
        sqlId: bestMatch.sqlId,
        courseName: bestMatch.name,
        college: bestMatch.college,
        matchType: 'fuzzy',
        confidence: bestScore
      };
    }
    
    // No match found
    return {
      success: false,
      error: `Course "${sqlCourseName}" not found in system`,
      suggestions: courses.map(c => c.name).slice(0, 5)
    };
  } catch (error) {
    console.error('❌ Error matching course:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Match SQL branch name to Branch (from SQL database)
 * IMPORTANT: This ensures the branch belongs to the specified course
 */
export const matchBranch = async (sqlBranchName, courseId) => {
  try {
    if (!sqlBranchName) {
      return { success: false, error: 'Branch name is required' };
    }

    // Fetch branches for the course from SQL
    // This ensures we only get branches that belong to this course
    const branches = await getBranchesByCourseFromSQL(courseId);
    
    if (branches.length === 0) {
      return { success: false, error: 'No branches found for the selected course' };
    }

    const normalizedSQL = normalizeBranchName(sqlBranchName);
    
    // Try exact match first
    let bestMatch = null;
    let bestScore = 0;
    
    for (const branch of branches) {
      // Verify branch belongs to the course (double-check)
      if (branch.sqlCourseId) {
        // Extract course SQL ID from courseId if it's in sql_XXX format
        let branchCourseSqlId = null;
        if (branch.course && branch.course.toString().startsWith('sql_')) {
          branchCourseSqlId = parseInt(branch.course.toString().replace('sql_', ''));
        }
        
        // Get course SQL ID from courseId parameter
        let courseSqlId = null;
        if (courseId && courseId.toString().startsWith('sql_')) {
          courseSqlId = parseInt(courseId.toString().replace('sql_', ''));
        }
        
        // If we have SQL IDs, verify they match
        if (branchCourseSqlId && courseSqlId && branchCourseSqlId !== courseSqlId) {
          // Branch doesn't belong to this course, skip it
          continue;
        }
      }
      
      const normalizedMongo = normalizeBranchName(branch.name);
      
      // Exact match
      if (normalizedSQL === normalizedMongo) {
        return {
          success: true,
          branchId: branch._id, // This will be sql_XXX format
          sqlId: branch.sqlId, // Actual SQL ID
          branchName: branch.name,
          matchType: 'exact',
          courseId: branch.course // Return course reference for validation
        };
      }
      
      // Calculate similarity
      const score = calculateSimilarity(sqlBranchName, branch.name);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = branch;
      }
    }
    
    // If similarity is high enough (>= 0.7), return the match
    if (bestScore >= 0.7 && bestMatch) {
      return {
        success: true,
        branchId: bestMatch._id,
        sqlId: bestMatch.sqlId,
        branchName: bestMatch.name,
        matchType: 'fuzzy',
        confidence: bestScore,
        courseId: bestMatch.course // Return course reference for validation
      };
    }
    
    // No match found
    return {
      success: false,
      error: `Branch "${sqlBranchName}" not found for the selected course`,
      suggestions: branches.map(b => b.name).slice(0, 5)
    };
  } catch (error) {
    console.error('❌ Error matching branch:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Match both course and branch
 */
export const matchCourseAndBranch = async (sqlCourseName, sqlBranchName) => {
  try {
    // First match course
    const courseMatch = await matchCourse(sqlCourseName);
    
    if (!courseMatch.success) {
      return {
        success: false,
        error: courseMatch.error,
        courseSuggestions: courseMatch.suggestions
      };
    }
    
    // Then match branch
    const branchMatch = await matchBranch(sqlBranchName, courseMatch.courseId);
    
    if (!branchMatch.success) {
      return {
        success: false,
        error: branchMatch.error,
        branchSuggestions: branchMatch.suggestions,
        courseId: courseMatch.courseId,
        courseName: courseMatch.courseName
      };
    }
    
    return {
      success: true,
      courseId: courseMatch.courseId,
      courseName: courseMatch.courseName,
      branchId: branchMatch.branchId,
      branchName: branchMatch.branchName,
      college: courseMatch.college, // Propagate college data
      courseMatchType: courseMatch.matchType,
      branchMatchType: branchMatch.matchType
    };
  } catch (error) {
    console.error('❌ Error matching course and branch:', error);
    return { success: false, error: error.message };
  }
};

