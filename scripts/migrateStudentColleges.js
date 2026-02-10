import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../src/models/User.js';
import { initializeSQLPool, closeSQLPool, fetchCoursesFromSQL, fetchStudentByIdentifier, fetchStudentByName } from '../src/utils/sqlService.js';

// Setup environment
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const migrateStudentColleges = async () => {
  try {
    // 1. Connect to MongoDB
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // 2. Initialize SQL
    console.log('🔌 Connecting to SQL...');
    await initializeSQLPool();
    
    // 3. Fetch all courses from SQL (with College info)
    console.log('📥 Fetching Courses from SQL...');
    const result = await fetchCoursesFromSQL();
    if (!result.success) {
      throw new Error(`Failed to fetch courses: ${result.error}`);
    }
    const sqlCourses = result.data;
    console.log(`✅ Loaded ${sqlCourses.length} courses from SQL`);

    // Create lookup maps
    const courseCollegeMap = {}; // Name -> Data
    const courseIdMap = {};      // ID -> Data

    sqlCourses.forEach(c => {
      if (c.college_id) {
        const data = {
          id: c.college_id,
          name: c.college_name,
          code: c.college_code
        };
        
        // Map by Name (Normal case)
        if (c.name) {
          courseCollegeMap[c.name.trim().toUpperCase()] = data;
        }
        
        // Map by SQL ID (e.g., for "sql_4")
        if (c.id) {
          courseIdMap[c.id] = data;
        }
      }
    });

    // 4. Fetch all Students
    const students = await User.find({ role: 'student' });
    console.log(`👥 Found ${students.length} students to check`);

    const stats = {
      processed: 0,
      updatedCollege: 0,
      updatedBatch: 0,
      updatedRollNumber: 0,
      fixedBySqlLookup: 0,
      fixedByNameLookup: 0,
      skipped: 0,
      failed: 0
    };
    
    const failedStudents = [];

    for (const student of students) {
      stats.processed++;
      let needsSave = false;
      let sqlStudentData = null;
      let lookupMethod = '';

      // A. Try to find student in SQL Source of Truth
      // 1. Try Roll Number / Admission Number
      const identifier = student.rollNumber || student.admissionNumber;
      if (identifier) {
        const idResult = await fetchStudentByIdentifier(identifier.trim());
        if (idResult.success && idResult.data) {
          sqlStudentData = idResult.data;
          lookupMethod = 'ID';
        }
      }

      // 2. Fallback: Try Name Search
      if (!sqlStudentData && student.name) {
        const nameResult = await fetchStudentByName(student.name);
        if (nameResult.success && nameResult.data) {
          sqlStudentData = nameResult.data;
          lookupMethod = 'NAME';
        }
      }

      // B. Sync Data if Found in SQL
      if (sqlStudentData) {
        // Sync Batch
        if (sqlStudentData.batch && student.batch !== sqlStudentData.batch) {
          student.batch = sqlStudentData.batch;
          needsSave = true;
          stats.updatedBatch++;
        }

        // Sync Roll Number (if found by Name and different)
        // User said: "if the roll number or pin number not found then by name it is found then update the rollnumber... with the pin number"
        if (lookupMethod === 'NAME') {
           const sqlPin = sqlStudentData.pin_no || sqlStudentData.admission_no;
           if (sqlPin && student.rollNumber !== sqlPin) {
             console.log(`\n🔄 Updating RollNumber for ${student.name}: ${student.rollNumber} -> ${sqlPin}`);
             student.rollNumber = sqlPin;
             needsSave = true;
             stats.updatedRollNumber++;
             stats.fixedByNameLookup++;
           }
        }

        // Sync Course & Branch
        if (sqlStudentData.course) {
           // Only update if currently missing or is a raw SQL ID or we want to enforce consistency
           // The user implied "update the... form the sql for all the students" so we should probably sync course/branch too
           // But let's be careful not to overwrite custom things unless they are definitely mapped.
           // Actually, let's prioritize the College mapping logic which relies on Course.
           
           // For migration, let's sync Course if it's different (or if it's a mongo ID and we want the sql name)
           // But existing mongo uses "B.Tech" string. SQL uses "B.Tech".
           // Let's rely on the text match to map to College.
           
           // If the student had "sql_ID", replace with real name from SQL student data
           if (student.course && student.course.toString().startsWith('sql_')) {
              student.course = sqlStudentData.course;
              student.branch = sqlStudentData.branch;
              needsSave = true;
              stats.fixedBySqlLookup++;
           }
           
           // If we found them by name, we definitely want to take their course/branch from SQL
           if (lookupMethod === 'NAME') {
              student.course = sqlStudentData.course;
              student.branch = sqlStudentData.branch;
              needsSave = true;
           }
        }
      }

      // C. Resolve College (based on (potentially updated) Course)
      let collegeData = null;
      let courseKey = student.course ? student.course.trim().toUpperCase() : null;

      // 1. Direct key match (Name match)
      if (courseKey && courseCollegeMap[courseKey]) {
        collegeData = courseCollegeMap[courseKey];
      }
      
      // 2. If valid SQL Student Data was found, we should use THAT course to find college
      if (!collegeData && sqlStudentData && sqlStudentData.course) {
         const sqlCourseKey = sqlStudentData.course.trim().toUpperCase();
         if (courseCollegeMap[sqlCourseKey]) {
           collegeData = courseCollegeMap[sqlCourseKey];
           // Also make sure we update the student's course string in Mongo to match this valid key
           if (student.course !== sqlStudentData.course) {
              student.course = sqlStudentData.course;
              student.branch = sqlStudentData.branch; // also sync branch
              needsSave = true;
           }
         }
      }

      // 3. Fallback: Check for ID-based course (sql_4)
      if (!collegeData && courseKey && courseKey.startsWith('SQL_')) {
        const idPart = parseInt(courseKey.replace('SQL_', ''));
         if (courseIdMap[idPart]) {
            collegeData = courseIdMap[idPart];
         }
      }

      // D. Apply College Update
      if (collegeData) {
        if (!student.college || student.college.id !== collegeData.id) {
          student.college = collegeData;
          needsSave = true;
          stats.updatedCollege++;
        }
      } else {
        // Failed to resolve college
        failedStudents.push({
          name: student.name,
          rollNumber: student.rollNumber,
          course: student.course || 'N/A',
          foundInSql: !!sqlStudentData,
          sqlCourse: sqlStudentData ? sqlStudentData.course : 'N/A'
        });
        stats.failed++;
        process.stdout.write('x');
      }

      if (needsSave) {
        await student.save();
        process.stdout.write('.');
      } else {
        process.stdout.write('-');
        stats.skipped++;
      }
    }

    console.log('\n\n========================================');
    console.log('       MIGRATION STATISTICS       ');
    console.log('========================================');
    console.log(`Total Students Processed: ${stats.processed}`);
    console.log(`✅ Updated College Info : ${stats.updatedCollege}`);
    console.log(`✅ Updated Batch Info   : ${stats.updatedBatch}`);
    console.log(`✅ Fixed RollNumbers    : ${stats.updatedRollNumber} (via Name lookup)`);
    console.log(`🔧 Fixed via SQL Lookup : ${stats.fixedBySqlLookup}`);
    console.log(`⏭️  No Changes Needed   : ${stats.skipped}`);
    console.log(`❌ Failed Resolutions   : ${stats.failed}`);
    console.log('========================================');

    if (failedStudents.length > 0) {
      console.log('\n❌ FAILED RESOLUTIONS DETAILS:');
      console.table(failedStudents);
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await mongoose.disconnect();
    await closeSQLPool();
    process.exit();
  }
};

migrateStudentColleges();


