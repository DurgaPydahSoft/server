import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

// Create MySQL connection pool
let pool = null;

/**
 * Initialize MySQL connection pool
 */
export const initializeSQLPool = () => {
  try {
    if (pool) {
      return pool;
    }

    const config = {
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: parseInt(process.env.SQL_POOL_SIZE, 10) || 10,
      queueLimit: 50,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      // Connection timeout settings
      connectTimeout: 30000, // 30 seconds
      acquireTimeout: 30000, // 30 seconds
      timeout: 30000, // 30 seconds
      // Additional connection options
      multipleStatements: false,
      dateStrings: false
    };

    // Add SSL configuration if DB_SSL is true
    if (process.env.DB_SSL === 'true') {
      config.ssl = {
        rejectUnauthorized: false // For RDS, we can set this to false
      };
    }

    pool = mysql.createPool(config);
    console.log('✅ MySQL connection pool initialized');
    return pool;
  } catch (error) {
    console.error('❌ Error initializing MySQL pool:', error);
    throw error;
  }
};

/**
 * Get MySQL connection pool
 */
export const getSQLPool = () => {
  if (!pool) {
    return initializeSQLPool();
  }
  return pool;
};

/**
 * Test SQL connection
 */
export const testSQLConnection = async () => {
  try {
    const pool = getSQLPool();
    // Use Promise.race to add a timeout wrapper
    const connectionPromise = pool.getConnection();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Connection timeout after 30 seconds')), 30000)
    );
    
    const connection = await Promise.race([connectionPromise, timeoutPromise]);
    
    try {
      await connection.ping();
      connection.release();
      return { success: true, message: 'SQL connection successful' };
    } catch (pingError) {
      connection.release();
      throw pingError;
    }
  } catch (error) {
    console.error('❌ SQL connection test failed:', error);
    let errorMessage = error.message;
    
    // Provide more helpful error messages
    if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
      errorMessage = 'Connection timeout. Please check:\n1. Database host is accessible\n2. Network connectivity\n3. Firewall settings\n4. Database credentials are correct';
    } else if (error.code === 'ECONNREFUSED') {
      errorMessage = 'Connection refused. Please check if the database server is running and the port is correct.';
    } else if (error.code === 'ENOTFOUND') {
      errorMessage = 'Database host not found. Please check the DB_HOST environment variable.';
    } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      errorMessage = 'Access denied. Please check database username and password.';
    }
    
    return { success: false, error: errorMessage, code: error.code };
  }
};

/**
 * Execute SQL query
 */
export const executeQuery = async (query, params = []) => {
  try {
    const pool = getSQLPool();
    const [rows] = await pool.execute(query, params);
    return { success: true, data: rows };
  } catch (error) {
    console.error('❌ SQL query error:', error);
    return { success: false, error: error.message };
  }
};

const STUDENT_SELECT_COLUMNS = `
        id,
        admission_number,
        admission_no,
        pin_no,
        current_year,
        current_semester,
        batch,
        course,
        branch,
        stud_type,
        student_name,
        student_status,
        scholar_status,
        student_mobile,
        parent_mobile1,
        parent_mobile2,
        caste,
        gender,
        father_name,
        dob,
        adhar_no,
        admission_date,
        student_address,
        city_village,
        mandal_name,
        district,
        previous_college,
        certificates_status,
        student_photo,
        remarks,
        created_at,
        updated_at`;

let lastSqlStudentFetchErrorLog = 0;

const logSqlStudentFetchError = (error, context = 'student') => {
  const now = Date.now();
  if (now - lastSqlStudentFetchErrorLog > 30000) {
    console.error(`❌ Error fetching ${context} from SQL:`, error?.message || error);
    lastSqlStudentFetchErrorLog = now;
  }
};

const formatSqlFetchError = (error) => {
  let errorMessage = error.message;
  if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
    errorMessage = 'Database connection timeout. Please check network connectivity and database server status.';
  } else if (error.code === 'ECONNREFUSED') {
    errorMessage = 'Database connection refused. Please check if the database server is running.';
  } else if (error.code === 'ENOTFOUND') {
    errorMessage = 'Database host not found. Please check the database host configuration.';
  }
  return { errorMessage, code: error.code };
};

/**
 * Fetch student by PIN number or Admission number
 */
export const fetchStudentByIdentifier = async (identifier) => {
  try {
    const pool = getSQLPool();
    const query = `
      SELECT ${STUDENT_SELECT_COLUMNS}
      FROM students
      WHERE pin_no = ? OR admission_number = ? OR admission_no = ?
      LIMIT 1
    `;

    const [rows] = await pool.execute(query, [identifier, identifier, identifier]);

    if (rows.length === 0) {
      return { success: false, error: 'Student not found in central database' };
    }

    return { success: true, data: rows[0] };
  } catch (error) {
    logSqlStudentFetchError(error);
    const { errorMessage, code } = formatSqlFetchError(error);
    return { success: false, error: errorMessage, code };
  }
};

/**
 * Batch-fetch students by PIN / admission numbers (single query per chunk).
 */
export const fetchStudentsByIdentifiers = async (identifiers = []) => {
  const unique = [...new Set(
    identifiers
      .map((id) => (id || '').toString().trim().toUpperCase())
      .filter(Boolean)
  )];

  if (unique.length === 0) {
    return { success: true, data: [] };
  }

  try {
    const pool = getSQLPool();
    const placeholders = unique.map(() => '?').join(', ');
    const query = `
      SELECT ${STUDENT_SELECT_COLUMNS}
      FROM students
      WHERE pin_no IN (${placeholders})
         OR admission_number IN (${placeholders})
         OR admission_no IN (${placeholders})
    `;
    const params = [...unique, ...unique, ...unique];
    const [rows] = await pool.execute(query, params);
    return { success: true, data: rows };
  } catch (error) {
    logSqlStudentFetchError(error, 'students (batch)');
    const { errorMessage, code } = formatSqlFetchError(error);
    return { success: false, error: errorMessage, code };
  }
};

/**
 * Fetch all colleges from SQL
 */
export const fetchCollegesFromSQL = async () => {
  try {
    const query = `
      SELECT 
        id,
        name,
        code,
        is_active,
        created_at,
        updated_at
      FROM colleges
      ORDER BY name ASC
    `;
    const result = await executeQuery(query);
    return result;
  } catch (error) {
    console.error('❌ Error fetching colleges from SQL:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Fetch all courses from SQL
 */
export const fetchCoursesFromSQL = async () => {
  try {
    const query = `
      SELECT 
        c.id,
        c.name,
        c.code,
        c.metadata,
        c.total_years,
        c.level,
        c.college_id,
        c.is_active,
        c.created_at,
        c.updated_at,
        col.name AS college_name,
        col.code AS college_code
      FROM courses c
      LEFT JOIN colleges col ON c.college_id = col.id
      ORDER BY c.name ASC
    `;
    const result = await executeQuery(query);
    return result;
  } catch (error) {
    console.error('❌ Error fetching courses from SQL:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Fetch a single course by ID from SQL
 */
export const fetchCourseByIdFromSQL = async (courseId) => {
  try {
    const query = `
      SELECT 
        c.id,
        c.name,
        c.code,
        c.metadata,
        c.total_years,
        c.level,
        c.college_id,
        c.is_active,
        c.created_at,
        c.updated_at,
        col.name AS college_name,
        col.code AS college_code
      FROM courses c
      LEFT JOIN colleges col ON c.college_id = col.id
      WHERE c.id = ?
      LIMIT 1
    `;
    const result = await executeQuery(query, [courseId]);
    if (result.success && result.data.length > 0) {
      return { success: true, data: result.data[0] };
    }
    return { success: false, error: 'Course not found' };
  } catch (error) {
    console.error('❌ Error fetching course by ID from SQL:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Fetch student by Name from SQL (Approximate/Normalized search)
 */
export const fetchStudentByName = async (name) => {
  try {
    // Basic normalization: Remove dots, extra spaces
    // We will use LIKE in SQL for broader matching or strict name matching
    // For now, let's try strict name, and then a LIKE query if needed.
    // Given the user wants "approximate", we'll try a flexible LIKE first.
    
    const cleanName = name.replace(/\./g, '').replace(/\s+/g, '%').trim();
    // 'B . JAYA' -> 'B % JAYA'
    
    const query = `
      SELECT 
        id,
        admission_number,
        admission_no,
        pin_no,
        student_name,
        current_year,
        batch,
        course,
        branch
      FROM students
      WHERE REPLACE(student_name, '.', '') LIKE ? 
         OR student_name LIKE ?
      LIMIT 1
    `;
    
    // Attempt 1: Try to match ignoring dots
    const searchPattern = `%${cleanName}%`; 
    
    const result = await executeQuery(query, [searchPattern, `%${name}%`]);
    
    if (result.success && result.data.length > 0) {
      return { success: true, data: result.data[0] };
    }
    return { success: false, error: 'Student not found by name' };
  } catch (error) {
    console.error('❌ Error fetching student by name:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Fetch all branches from SQL
 */
export const fetchBranchesFromSQL = async () => {
  try {
    const query = `
      SELECT 
        b.id,
        b.course_id,
        b.name,
        b.code,
        b.metadata,
        b.is_active,
        b.created_at,
        b.updated_at,
        c.name AS course_name,
        c.code AS course_code
      FROM course_branches b
      LEFT JOIN courses c ON c.id = b.course_id
      ORDER BY b.name ASC
    `;
    const result = await executeQuery(query);
    return result;
  } catch (error) {
    console.error('❌ Error fetching branches from SQL:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Fetch branches by course ID from SQL
 */
export const fetchBranchesByCourseFromSQL = async (courseId) => {
  try {
    const query = `
      SELECT 
        b.id,
        b.course_id,
        b.name,
        b.code,
        b.metadata,
        b.is_active,
        b.created_at,
        b.updated_at,
        c.name AS course_name,
        c.code AS course_code
      FROM course_branches b
      LEFT JOIN courses c ON c.id = b.course_id
      WHERE b.course_id = ?
      ORDER BY b.name ASC
    `;
    const result = await executeQuery(query, [courseId]);
    return result;
  } catch (error) {
    console.error('❌ Error fetching branches by course from SQL:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Fetch a single branch by ID from SQL
 */
export const fetchBranchByIdFromSQL = async (branchId) => {
  try {
    const query = `
      SELECT 
        b.id,
        b.course_id,
        b.name,
        b.code,
        b.metadata,
        b.is_active,
        b.created_at,
        b.updated_at,
        c.name AS course_name,
        c.code AS course_code
      FROM course_branches b
      LEFT JOIN courses c ON c.id = b.course_id
      WHERE b.id = ?
      LIMIT 1
    `;
    const result = await executeQuery(query, [branchId]);
    if (result.success && result.data.length > 0) {
      return { success: true, data: result.data[0] };
    }
    return { success: false, error: 'Branch not found' };
  } catch (error) {
    console.error('❌ Error fetching branch by ID from SQL:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Fetch student credentials (password hash) by username (roll number) or admission number
 */
export const fetchStudentCredentialsSQL = async (identifier) => {
  try {
    const query = `
      SELECT 
        id,
        student_id,
        admission_number,
        username,
        password_hash
      FROM student_credentials
      WHERE username = ? OR admission_number = ?
      LIMIT 1
    `;
    const result = await executeQuery(query, [identifier, identifier]);
    if (result.success && result.data.length > 0) {
      return { success: true, data: result.data[0] };
    }
    return { success: false, error: 'Credentials not found in SQL' };
  } catch (error) {
    console.error('❌ Error fetching student credentials from SQL:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Fetch Semester 2 end_date from SQL semesters table.
 * Used to dynamically resolve application expiry dates from the academic calendar.
 *
 * @param {number} sqlCourseId  - The numeric course_id in SQL (e.g., resolved via sqlCourseId from enriched student)
 * @param {number} yearOfStudy  - The student's year of study (e.g., 1, 2, 3)
 * @param {string} academicYear - Academic year label, e.g., "2025-2026" (matched against academic_years.year_label)
 * @returns {Date|null}         - Semester 2 end_date set to 23:59:59 UTC, or null if not found / on error
 */
export const fetchSemesterEndDateFromSQL = async ({ sqlCourseId, yearOfStudy, academicYear }) => {
  if (!sqlCourseId || !yearOfStudy || !academicYear) return null;

  try {
    const pool = getSQLPool();
    const query = `
      SELECT s.end_date
      FROM semesters s
      JOIN academic_years ay ON s.academic_year_id = ay.id
      WHERE s.course_id = ?
        AND s.year_of_study = ?
        AND s.semester_number = 2
        AND ay.year_label = ?
      LIMIT 1
    `;
    const [rows] = await pool.execute(query, [
      Number(sqlCourseId),
      Number(yearOfStudy),
      academicYear
    ]);

    if (!rows || rows.length === 0) return null;

    const rawDate = rows[0].end_date;
    if (!rawDate) return null;

    // MySQL dateStrings=false returns JS Date objects; guard for both cases
    const d = rawDate instanceof Date ? new Date(rawDate) : new Date(rawDate);
    if (Number.isNaN(d.getTime())) return null;

    // Normalise to end-of-day UTC so comparison with today works consistently
    d.setUTCHours(23, 59, 59, 999);
    return d;
  } catch (error) {
    // Non-fatal — fall through to other expiry sources
    console.error('❌ fetchSemesterEndDateFromSQL error:', error?.message || error);
    return null;
  }
};

/**
 * Fetch overall concessions for a student by PIN number or Admission number
 */
export const fetchConcessionsForStudent = async (identifier) => {
  try {
    const pool = getSQLPool();
    const query = `
      SELECT id, admission_number, pin_no, student_name, revised_fees
      FROM overall_concessions
      WHERE pin_no = ? OR admission_number = ?
      LIMIT 1
    `;
    const [rows] = await pool.execute(query, [identifier, identifier]);
    if (rows.length === 0) {
      return { success: false, data: null };
    }
    return { success: true, data: rows[0] };
  } catch (error) {
    console.error('❌ Error fetching overall concessions from SQL:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Fetch overall concessions for multiple students by PIN number or Admission number
 */
export const fetchConcessionsForStudents = async (identifiers = []) => {
  const unique = [...new Set(
    identifiers
      .map((id) => (id || '').toString().trim().toUpperCase())
      .filter(Boolean)
  )];

  if (unique.length === 0) {
    return { success: true, data: [] };
  }

  try {
    const pool = getSQLPool();
    const placeholders = unique.map(() => '?').join(', ');
    const query = `
      SELECT id, admission_number, pin_no, student_name, revised_fees
      FROM overall_concessions
      WHERE pin_no IN (${placeholders}) OR admission_number IN (${placeholders})
    `;
    const params = [...unique, ...unique];
    const [rows] = await pool.execute(query, params);
    return { success: true, data: rows };
  } catch (error) {
    console.error('❌ Error fetching overall concessions from SQL (batch):', error);
    return { success: false, error: error.message };
  }
};

/**
 * Close SQL connection pool
 */
export const closeSQLPool = async () => {
  try {
    if (pool) {
      await pool.end();
      pool = null;
      console.log('✅ MySQL connection pool closed');
    }
  } catch (error) {
    console.error('❌ Error closing MySQL pool:', error);
  }
};

// Initialize pool on module load
initializeSQLPool();

