import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../src/models/User.js';
import { initializeSQLPool, closeSQLPool, fetchStudentByIdentifier } from '../src/utils/sqlService.js';

// Setup environment
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const checkDiplomaMapping = async () => {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    console.log('🔌 Connecting to SQL...');
    await initializeSQLPool();
    console.log('✅ Connected to SQL');

    // Find students whose course is 'diploma' or similar in MongoDB
    // We will do a case-insensitive regex search for "diploma"
    const students = await User.find({ 
      role: 'student',
      course: { $regex: /diploma/i } 
    }).select('name rollNumber course branch');

    console.log(`👥 Found ${students.length} diploma students in MongoDB`);

    const comparisonResults = [];
    let notFoundInSql = 0;

    for (const student of students) {
      if (!student.rollNumber) continue;

      const sqlResult = await fetchStudentByIdentifier(student.rollNumber.trim());
      
      if (sqlResult.success && sqlResult.data) {
        const sqlStudent = sqlResult.data;
        const needsUpdate = (student.course !== sqlStudent.course || student.branch !== sqlStudent.branch);
        
        if (needsUpdate) {
          comparisonResults.push({
            Name: student.name,
            RollNumber: student.rollNumber,
            MongoCourse: student.course || 'N/A',
            SqlCourse: sqlStudent.course || 'N/A',
            MongoBranch: student.branch || 'N/A',
            SqlBranch: sqlStudent.branch || 'N/A'
          });
        }
      } else {
        notFoundInSql++;
        // You could also log students not found in SQL if needed
      }
    }

    console.log('\n==========================================================================================');
    console.log('             DIPLOMA STUDENTS WITH MISMATCHED MAPPINGS (MONGO vs SQL)             ');
    console.log('==========================================================================================\n');
    
    if (comparisonResults.length > 0) {
      console.table(comparisonResults);
    } else {
      console.log('All diploma students found in SQL have matching course and branch mappings.');
    }

    console.log(`\nStats:`);
    console.log(`Total Diploma Students in Mongo: ${students.length}`);
    console.log(`Mismatched Students needing updates: ${comparisonResults.length}`);
    console.log(`Not found in SQL: ${notFoundInSql}`);

  } catch (error) {
    console.error('❌ Error reading mapping:', error);
  } finally {
    await mongoose.disconnect();
    await closeSQLPool();
    process.exit();
  }
};

checkDiplomaMapping();
