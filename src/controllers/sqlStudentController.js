import { fetchStudentByIdentifier, testSQLConnection } from '../utils/sqlService.js';
import { matchCourseAndBranch } from '../utils/courseBranchMatcher.js';
import { createError } from '../utils/error.js';

/**
 * Map SQL gender to MongoDB gender format
 */
const mapGender = (sqlGender) => {
  if (!sqlGender) return null;
  
  const genderMap = {
    'M': 'Male',
    'F': 'Female',
    'Male': 'Male',
    'Female': 'Female'
  };
  
  return genderMap[sqlGender.toUpperCase()] || null;
};

/**
 * Map SQL student data to MongoDB format
 */
const mapStudentData = (sqlData) => {
  // Handle student photo - could be base64 string or URL
  let studentPhoto = null;
  if (sqlData.student_photo) {
    // If it's already a data URL, use it directly
    if (sqlData.student_photo.startsWith('data:image')) {
      studentPhoto = sqlData.student_photo;
    } 
    // If it's base64 without data URL prefix, add it
    else if (sqlData.student_photo.length > 100) { // Likely base64 if long string
      studentPhoto = `data:image/jpeg;base64,${sqlData.student_photo}`;
    }
    // Otherwise treat as URL
    else {
      studentPhoto = sqlData.student_photo;
    }
  }

  return {
    // Basic info
    name: sqlData.student_name || '',
    rollNumber: sqlData.pin_no || sqlData.admission_number || sqlData.admission_no || '',
    admissionNumber: sqlData.admission_number || sqlData.admission_no || null,
    
    // Academic info
    course: sqlData.course || '',
    branch: sqlData.branch || '',
    year: sqlData.current_year || 1,
    batch: sqlData.batch || '',
    
    // Personal info
    gender: mapGender(sqlData.gender),
    studentPhone: sqlData.student_mobile || '',
    parentPhone: sqlData.parent_mobile1 || '',
    motherPhone: sqlData.parent_mobile2 || '',
    fatherName: sqlData.father_name || '',
    
    // Additional info
    email: null, // Email not in SQL schema, will be empty
    dob: sqlData.dob || null,
    adharNo: sqlData.adhar_no || null,
    address: sqlData.student_address || null,
    city: sqlData.city_village || null,
    district: sqlData.district || null,
    
    // Photo from SQL
    studentPhoto: studentPhoto,
    
    // Raw SQL data for reference
    rawSQLData: sqlData
  };
};

/**
 * Fetch student from SQL and map to MongoDB format
 */
export const fetchStudentFromSQL = async (req, res, next) => {
  try {
    const { identifier } = req.params;
    
    if (!identifier) {
      return res.status(400).json({
        success: false,
        message: 'Identifier (PIN number or Admission number) is required'
      });
    }
    
    // Test SQL connection first
    const connectionTest = await testSQLConnection();
    if (!connectionTest.success) {
      return res.status(503).json({
        success: false,
        message: 'SQL database connection failed',
        error: connectionTest.error
      });
    }
    
    // Fetch student from SQL
    const result = await fetchStudentByIdentifier(identifier);
    
    if (!result.success) {
      return res.status(404).json({
        success: false,
        message: result.error || 'Student not found in central database'
      });
    }
    
    const sqlData = result.data;
    
    // Map SQL data to MongoDB format
    const mappedData = mapStudentData(sqlData);
    
    // Match course and branch
    let courseMatch = null;
    let branchMatch = null;
    
    if (mappedData.course) {
      courseMatch = await matchCourseAndBranch(mappedData.course, mappedData.branch);
      
      if (courseMatch.success) {
        mappedData.courseId = courseMatch.courseId;
        mappedData.courseName = courseMatch.courseName;
        mappedData.branchId = courseMatch.branchId;
        mappedData.branchName = courseMatch.branchName;
        mappedData.courseMatchType = courseMatch.courseMatchType;
        mappedData.branchMatchType = courseMatch.branchMatchType;
      } else {
        // Course/branch matching failed, but still return the data
        mappedData.courseMatchError = courseMatch.error;
        mappedData.courseSuggestions = courseMatch.courseSuggestions;
        mappedData.branchSuggestions = courseMatch.branchSuggestions;
      }
    }
    
    res.json({
      success: true,
      data: mappedData,
      message: 'Student data fetched successfully from SQL database'
    });
  } catch (error) {
    console.error('❌ Error in fetchStudentFromSQL:', error);
    next(createError(500, 'Error fetching student from SQL database', error.message));
  }
};

/**
 * Test SQL connection
 */
export const testConnection = async (req, res, next) => {
  try {
    const result = await testSQLConnection();
    
    if (result.success) {
      res.json({
        success: true,
        message: 'SQL connection successful'
      });
    } else {
      res.status(503).json({
        success: false,
        message: 'SQL connection failed',
        error: result.error
      });
    }
  } catch (error) {
    console.error('❌ Error testing SQL connection:', error);
    next(createError(500, 'Error testing SQL connection', error.message));
  }
};

