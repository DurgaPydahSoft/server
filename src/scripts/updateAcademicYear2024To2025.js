import mongoose from 'mongoose';
import User from '../models/User.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hostel-management');
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Migration function to update academic year from 2024-2025 to 2025-2026
const updateAcademicYear = async () => {
  try {
    console.log('🔄 Starting migration: Academic Year 2024-2025 → 2025-2026...');
    
    // Find all students with academicYear = "2024-2025"
    const studentsToUpdate = await User.find({
      role: 'student',
      academicYear: '2024-2025'
    }).select('_id name rollNumber academicYear course branch year');
    
    console.log(`📊 Found ${studentsToUpdate.length} students with academic year "2024-2025"`);
    
    if (studentsToUpdate.length === 0) {
      console.log('✅ No students with academic year "2024-2025" found. Migration not needed.');
      return;
    }
    
    // Show preview of students to be updated
    console.log('\n📋 Preview of students to be updated (first 10):');
    console.log('─'.repeat(100));
    console.log(
      'No.'.padEnd(5) +
      'Name'.padEnd(25) +
      'Roll Number'.padEnd(15) +
      'Current Academic Year'.padEnd(22) +
      'New Academic Year'
    );
    console.log('─'.repeat(100));
    
    studentsToUpdate.slice(0, 10).forEach((student, index) => {
      console.log(
        `${index + 1}`.padEnd(5) +
        (student.name || 'N/A').substring(0, 23).padEnd(25) +
        (student.rollNumber || 'N/A').padEnd(15) +
        (student.academicYear || 'N/A').padEnd(22) +
        '2025-2026'
      );
    });
    
    if (studentsToUpdate.length > 10) {
      console.log(`   ... and ${studentsToUpdate.length - 10} more students`);
    }
    console.log('─'.repeat(100));
    
    let updatedCount = 0;
    let errorCount = 0;
    const errors = [];
    
    // Update each student
    console.log('\n🔄 Updating students...');
    
    for (const student of studentsToUpdate) {
      try {
        // Update academic year
        student.academicYear = '2025-2026';
        await student.save();
        
        updatedCount++;
        if (updatedCount % 50 === 0) {
          console.log(`   ✅ Updated ${updatedCount}/${studentsToUpdate.length} students...`);
        }
        
      } catch (error) {
        console.error(`   ❌ Error updating student ${student.rollNumber}:`, error.message);
        errors.push({
          studentId: student._id,
          rollNumber: student.rollNumber,
          name: student.name,
          error: error.message
        });
        errorCount++;
      }
    }
    
    console.log('\n📊 Migration Summary:');
    console.log(`✅ Successfully updated: ${updatedCount} students`);
    console.log(`❌ Errors: ${errorCount} students`);
    
    if (errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      errors.forEach(error => {
        console.log(`   - ${error.name} (${error.rollNumber}): ${error.error}`);
      });
    }
    
    // Verify migration
    const remaining2024 = await User.countDocuments({ 
      role: 'student',
      academicYear: '2024-2025' 
    });
    const updated2025 = await User.countDocuments({ 
      role: 'student',
      academicYear: '2025-2026' 
    });
    
    console.log('\n🔍 Verification:');
    console.log(`   Students with academicYear = "2024-2025": ${remaining2024}`);
    console.log(`   Students with academicYear = "2025-2026": ${updated2025}`);
    
    if (remaining2024 === 0) {
      console.log('\n🎉 Migration completed successfully! All students with academic year "2024-2025" have been updated to "2025-2026".');
    } else {
      console.log(`\n⚠️  ${remaining2024} student(s) still have academic year "2024-2025". Please review.`);
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
};

// Main execution
const main = async () => {
  try {
    await connectDB();
    await updateAcademicYear();
  } catch (error) {
    console.error('❌ Script execution failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
};

// Run the migration
main();
