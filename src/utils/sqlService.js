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
      connectionLimit: 10,
      queueLimit: 0,
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

/**
 * Fetch student by PIN number or Admission number
 */
export const fetchStudentByIdentifier = async (identifier) => {
  let connection = null;
  try {
    const pool = getSQLPool();
    
    // Get connection with timeout
    const connectionPromise = pool.getConnection();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Connection timeout after 30 seconds')), 30000)
    );
    
    connection = await Promise.race([connectionPromise, timeoutPromise]);
    
    // Try PIN number and admission numbers
    // Note: Removed custom_fields and student_data as they may not exist in all database versions
    const query = `
      SELECT 
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
        updated_at
      FROM students
      WHERE pin_no = ? OR admission_number = ? OR admission_no = ?
      LIMIT 1
    `;
    
    const [rows] = await connection.execute(query, [identifier, identifier, identifier]);
    
    // Release connection before returning
    connection.release();
    connection = null;
    
    if (rows.length === 0) {
      return { success: false, error: 'Student not found in central database' };
    }
    
    return { success: true, data: rows[0] };
  } catch (error) {
    // Release connection if it was acquired
    if (connection) {
      try {
        connection.release();
      } catch (releaseError) {
        console.error('Error releasing connection:', releaseError);
      }
    }
    
    console.error('❌ Error fetching student from SQL:', error);
    
    let errorMessage = error.message;
    if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
      errorMessage = 'Database connection timeout. Please check network connectivity and database server status.';
    } else if (error.code === 'ECONNREFUSED') {
      errorMessage = 'Database connection refused. Please check if the database server is running.';
    } else if (error.code === 'ENOTFOUND') {
      errorMessage = 'Database host not found. Please check the database host configuration.';
    }
    
    return { success: false, error: errorMessage, code: error.code };
  }
};

/**
 * Fetch all courses from SQL
 */
export const fetchCoursesFromSQL = async () => {
  try {
    const query = `
      SELECT 
        id,
        name,
        code,
        metadata,
        total_years,
        is_active,
        created_at,
        updated_at
      FROM courses
      ORDER BY name ASC
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
        id,
        name,
        code,
        metadata,
        total_years,
        is_active,
        created_at,
        updated_at
      FROM courses
      WHERE id = ?
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

