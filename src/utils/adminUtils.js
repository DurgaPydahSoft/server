import { getCoursesFromSQL } from './courseBranchMapper.js';
import { fetchCourseByIdFromSQL, fetchBranchByIdFromSQL } from './sqlService.js';

/**
 * Normalize course name for robust comparison
 * Removes dots, spaces and converts to uppercase
 */
export const normalizeCourseName = (name) => {
  if (!name) return '';
  return name.trim().toUpperCase()
    .replace(/\./g, '')
    .replace(/\s+/g, '');
};

/**
 * Resolve SQL course ID or legacy string to a consistent course name
 */
export const resolveCourseName = async (courseValue) => {
  if (!courseValue) return null;
  
  // If it's a SQL ID format (sql_1, sql_2, etc.) or just numeric
  let sqlId = null;
  if (typeof courseValue === 'string' && courseValue.startsWith('sql_')) {
    sqlId = parseInt(courseValue.replace('sql_', ''));
  } else if (/^\d+$/.test(courseValue.toString())) {
    sqlId = parseInt(courseValue);
  }

  if (sqlId !== null) {
    try {
      const result = await fetchCourseByIdFromSQL(sqlId);
      if (result.success && result.data) {
        return result.data.name || courseValue;
      }
    } catch (error) {
      console.error('Error resolving SQL course ID:', error);
    }
  }
  
  return courseValue;
};

/**
 * Resolve SQL branch ID or legacy string to a consistent branch name
 */
export const resolveBranchName = async (branchValue) => {
  if (!branchValue) return null;
  
  if (typeof branchValue === 'string' && branchValue.startsWith('sql_')) {
    try {
      const sqlBranchId = parseInt(branchValue.replace('sql_', ''));
      const result = await fetchBranchByIdFromSQL(sqlBranchId);
      if (result.success && result.data) {
        return result.data.name;
      }
    } catch (error) {
      console.error(`Error resolving branch ID ${branchValue}:`, error);
    }
  }
  
  return branchValue;
};

/**
 * Get allowed course names for an admin based on their assignments
 */
export const getAllowedCourseNames = async (admin) => {
  const { assignedCourses, assignedCollegeIds, assignedCollegeId, assignedLevels, course } = admin;
  const allowedCourseNames = new Set();

  // 1. Legacy/Direct singular course (for principals)
  if (course) {
    allowedCourseNames.add(course.trim());
  }

  // 2. Legacy/Direct Course Assignment (for sub_admins)
  if (assignedCourses && assignedCourses.length > 0) {
    assignedCourses.forEach(c => {
      if (c) allowedCourseNames.add(c.trim());
    });
  }

  // 3. College & Level Based Assignment
  const colleges = (assignedCollegeIds && assignedCollegeIds.length > 0) 
    ? assignedCollegeIds 
    : (assignedCollegeId ? [assignedCollegeId] : []);
  
  if (colleges.length > 0 && assignedLevels && assignedLevels.length > 0) {
    try {
      const allSQLCourses = await getCoursesFromSQL();
      
      // Normalize levels for comparison
      const normalizedLevels = assignedLevels.map(l => l.toLowerCase().trim());
      
      const matchedCourses = allSQLCourses.filter(c => 
        c.college && colleges.includes(Number(c.college.id)) && 
        c.level && normalizedLevels.includes(c.level.toLowerCase().trim())
      );
      
      matchedCourses.forEach(c => {
        if (c.name) allowedCourseNames.add(c.name.trim());
      });
      
    //   console.log(`🔍 [adminUtils] Resolved ${matchedCourses.length} courses for Colleges [${colleges}] and Levels [${assignedLevels}]`);
    } catch (err) {
      console.error("Error resolving courses for college/level:", err);
    }
  }

  return Array.from(allowedCourseNames);
};
