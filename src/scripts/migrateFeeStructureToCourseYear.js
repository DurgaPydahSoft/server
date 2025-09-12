import mongoose from 'mongoose';
import FeeStructure from '../models/FeeStructure.js';
import Course from '../models/Course.js';
import User from '../models/User.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const migrateFeeStructures = async (forceCreate = false) => {
  try {
    console.log('🚀 Starting fee structure migration to course + year + category system...');
    if (forceCreate) {
      console.log('🔧 Force mode enabled - will create fee structures even without students');
    }
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Get all existing fee structures (old format)
    const oldFeeStructures = await FeeStructure.find({ 
      course: { $exists: false } // Structures without course field
    });
    
    console.log(`📊 Found ${oldFeeStructures.length} old fee structures to migrate`);

    if (oldFeeStructures.length === 0) {
      console.log('✅ No old fee structures found. Migration not needed.');
      return;
    }

    // Get all courses to map students to
    const courses = await Course.find({ isActive: true });
    console.log(`📚 Found ${courses.length} active courses`);

    if (courses.length === 0) {
      console.log('❌ No courses found. Please create courses first before migrating.');
      return;
    }

    // Get all students to analyze their course distribution
    const students = await User.find({ role: 'student' }).populate('course');
    console.log(`👥 Found ${students.length} students`);

    // Check how many students have course and year data
    const studentsWithCourseYear = students.filter(student => student.course && student.year);
    console.log(`📊 Students with course and year data: ${studentsWithCourseYear.length}/${students.length}`);

    if (studentsWithCourseYear.length === 0) {
      console.log('❌ No students have course and year data. Please ensure students are properly registered with course and year information.');
      console.log('💡 You may need to update student records first or run a different migration script.');
      return;
    }

    // Analyze student distribution by course and year
    const studentDistribution = {};
    studentsWithCourseYear.forEach(student => {
      const courseId = student.course._id.toString();
      if (!studentDistribution[courseId]) {
        studentDistribution[courseId] = {};
      }
      if (!studentDistribution[courseId][student.year]) {
        studentDistribution[courseId][student.year] = 0;
      }
      studentDistribution[courseId][student.year]++;
    });

    console.log('📈 Student distribution by course and year:');
    Object.entries(studentDistribution).forEach(([courseId, years]) => {
      const course = courses.find(c => c._id.toString() === courseId);
      console.log(`  ${course?.name || 'Unknown Course'}:`);
      Object.entries(years).forEach(([year, count]) => {
        console.log(`    Year ${year}: ${count} students`);
      });
    });

    // Create new fee structures for each course, year, and category combination
    let migratedCount = 0;
    let skippedCount = 0;

    for (const oldStructure of oldFeeStructures) {
      console.log(`\n🔄 Migrating structure: ${oldStructure.academicYear} - ${oldStructure.category}`);
      
      // For each course
      for (const course of courses) {
        // For each year in the course duration
        for (let year = 1; year <= course.duration; year++) {
          // Check if students exist for this course and year
          const hasStudents = studentDistribution[course._id.toString()]?.[year] > 0;
          
          if (!hasStudents && !forceCreate) {
            console.log(`⏭️Skipping ${course.name} Year ${year} - no students (use --force to create anyway)`);
            skippedCount++;
            continue;
          }

          // Check if structure already exists
          const existingStructure = await FeeStructure.findOne({
            academicYear: oldStructure.academicYear,
            course: course._id,
            year: year,
            category: oldStructure.category
          });

          if (existingStructure) {
            console.log(`⏭️ Skipping ${course.name} Year ${year} ${oldStructure.category} - already exists`);
            skippedCount++;
            continue;
          }

          // Create new structure
          const newStructure = new FeeStructure({
            academicYear: oldStructure.academicYear,
            course: course._id,
            year: year,
            category: oldStructure.category,
            term1Fee: oldStructure.term1Fee,
            term2Fee: oldStructure.term2Fee,
            term3Fee: oldStructure.term3Fee,
            createdBy: oldStructure.createdBy,
            updatedBy: oldStructure.updatedBy,
            isActive: oldStructure.isActive
          });

          await newStructure.save();
          console.log(`  ✅ Created ${course.name} Year ${year} ${oldStructure.category} - ₹${newStructure.totalFee.toLocaleString()}`);
          migratedCount++;
        }
      }

      // Mark old structure as inactive
      oldStructure.isActive = false;
      await oldStructure.save();
      console.log(`  🗑️  Deactivated old structure: ${oldStructure.academicYear} - ${oldStructure.category}`);
    }

    console.log('\n📊 Migration Summary:');
    console.log(`  ✅ Migrated: ${migratedCount} fee structures`);
    console.log(`  ⏭️  Skipped: ${skippedCount} fee structures (no students or already exists)`);
    console.log(`  🗑️  Deactivated: ${oldFeeStructures.length} old fee structures`);

    // Verify migration
    const newStructures = await FeeStructure.find({ 
      course: { $exists: true },
      isActive: true 
    }).populate('course', 'name duration');
    
    console.log(`\n🔍 Verification: Found ${newStructures.length} new fee structures`);
    
    // Show sample of new structures
    console.log('\n📋 Sample of new fee structures:');
    newStructures.slice(0, 5).forEach(structure => {
      console.log(`  ${structure.academicYear} - ${structure.course.name} Year ${structure.year} ${structure.category} - ₹${structure.totalFee.toLocaleString()}`);
    });

    console.log('\n✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
};

// Main function to run the migration
const main = async () => {
  try {
    // Check for command line arguments
    const forceCreate = process.argv.includes('--force');
    
    await migrateFeeStructures(forceCreate);
    console.log('🎉 Migration script completed');
  } catch (error) {
    console.error('💥 Migration script failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
};

// Run the migration
main();
