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

const updateDiplomaMapping = async () => {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    console.log('🔌 Connecting to SQL...');
    await initializeSQLPool();
    console.log('✅ Connected to SQL');

    // Find students whose course is 'diploma' or similar in MongoDB
    const students = await User.find({ 
      role: 'student',
      course: { $regex: /diploma/i } 
    });

    console.log(`👥 Found ${students.length} diploma students in MongoDB`);

    let updatedCount = 0;
    let notFoundInSql = 0;
    let upToDateCount = 0;

    for (const student of students) {
      if (!student.rollNumber) continue;

      const sqlResult = await fetchStudentByIdentifier(student.rollNumber.trim());
      
      if (sqlResult.success && sqlResult.data) {
        const sqlStudent = sqlResult.data;
        const needsUpdate = (student.course !== sqlStudent.course || student.branch !== sqlStudent.branch);
        
        if (needsUpdate) {
          console.log(`\n🔄 Updating Student: ${student.name} (${student.rollNumber})`);
          console.log(`   Course: "${student.course}" -> "${sqlStudent.course}"`);
          console.log(`   Branch: "${student.branch}" -> "${sqlStudent.branch}"`);
          
          student.course = sqlStudent.course;
          student.branch = sqlStudent.branch;
          await student.save();
          updatedCount++;
        } else {
          upToDateCount++;
        }
      } else {
        notFoundInSql++;
      }
    }

    console.log('\n========================================');
    console.log('       UPDATE MAPPING STATISTICS       ');
    console.log('========================================');
    console.log(`Total Students Processed: ${students.length}`);
    console.log(`✅ Successfully Updated : ${updatedCount}`);
    console.log(`⏭️  Already Up-to-date : ${upToDateCount}`);
    console.log(`❌ Not found in SQL    : ${notFoundInSql}`);
    console.log('========================================');

  } catch (error) {
    console.error('❌ Error updating mapping:', error);
  } finally {
    await mongoose.disconnect();
    await closeSQLPool();
    process.exit();
  }
};

updateDiplomaMapping();
