import mongoose from 'mongoose';
import FeeStructure from '../models/FeeStructure.js';
import Course from '../models/Course.js';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const generateAllFeeStructures = async (options = {}) => {
  try {
    console.log('🚀 Starting comprehensive fee structure generation...');
    console.log('🔧 Options:', options);
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Get all active courses
    const courses = await Course.find({ isActive: true });
    console.log(`📚 Found ${courses.length} active courses`);

    if (courses.length === 0) {
      console.log('❌ No courses found. Please create courses first.');
      return;
    }

    // Get all students to analyze their distribution
    const students = await User.find({ role: 'student' }).populate('course');
    console.log(`👥 Found ${students.length} students`);

    // Get an admin to use as creator (required field)
    const admin = await Admin.findOne({ role: { $in: ['super_admin', 'admin'] } });
    if (!admin) {
      console.log('❌ No admin found. Please create an admin first.');
      return;
    }
    console.log(`👤 Using admin as creator: ${admin.username} (${admin.role})`);

    // Get all possible categories
    const allCategories = ['A+', 'A', 'B+', 'B', 'C'];
    console.log(`🏷️  Using categories: ${allCategories.join(', ')}`);

    // Generate academic years (current year and next 2 years)
    const currentYear = new Date().getFullYear();
    const academicYears = [
      `${currentYear - 1}-${currentYear}`,
      `${currentYear}-${currentYear + 1}`,
      `${currentYear + 1}-${currentYear + 2}`,
      `${currentYear + 2}-${currentYear + 3}`
    ];
    console.log(`📅 Using academic years: ${academicYears.join(', ')}`);

    // Analyze student distribution
    const studentDistribution = {};
    students.forEach(student => {
      if (student.course && student.year) {
        const courseId = student.course._id.toString();
        if (!studentDistribution[courseId]) {
          studentDistribution[courseId] = {};
        }
        if (!studentDistribution[courseId][student.year]) {
          studentDistribution[courseId][student.year] = 0;
        }
        studentDistribution[courseId][student.year]++;
      }
    });

    console.log('\n📈 Student distribution by course and year:');
    Object.entries(studentDistribution).forEach(([courseId, years]) => {
      const course = courses.find(c => c._id.toString() === courseId);
      console.log(`  ${course?.name || 'Unknown Course'}:`);
      Object.entries(years).forEach(([year, count]) => {
        console.log(`    Year ${year}: ${count} students`);
      });
    });

    // Default fee amounts by category (can be customized)
    const defaultFees = {
      'A+': 150000,
      'A': 120000,
      'B+': 100000,
      'B': 80000,
      'C': 60000
    };

    console.log('\n💰 Default fee amounts by category:');
    Object.entries(defaultFees).forEach(([category, amount]) => {
      console.log(`  ${category}: ₹${amount.toLocaleString()}`);
    });

    let createdCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // Generate fee structures for all combinations
    for (const course of courses) {
      console.log(`\n🔄 Processing course: ${course.name} (${course.duration} years)`);
      
      for (const academicYear of academicYears) {
        for (let year = 1; year <= course.duration; year++) {
          for (const category of allCategories) {
            try {
              // Check if structure already exists
              const existingStructure = await FeeStructure.findOne({
                academicYear,
                course: course._id,
                year,
                category
              });

              if (existingStructure) {
                console.log(`  ⏭️  Skipping ${course.name} Year ${year} ${category} (${academicYear}) - already exists`);
                skippedCount++;
                continue;
              }

              // Check if we should skip based on student distribution (unless force mode)
              const hasStudents = studentDistribution[course._id.toString()]?.[year] > 0;
              if (!hasStudents && !options.force) {
                console.log(`  ⏭️  Skipping ${course.name} Year ${year} ${category} (${academicYear}) - no students`);
                skippedCount++;
                continue;
              }

              // Calculate fees
              const totalFee = defaultFees[category];
              const term1Fee = Math.round(totalFee * 0.4); // 40%
              const term2Fee = Math.round(totalFee * 0.3); // 30%
              const term3Fee = Math.round(totalFee * 0.3); // 30%

              // Create new fee structure
              const newStructure = new FeeStructure({
                academicYear,
                course: course._id,
                year,
                category,
                term1Fee,
                term2Fee,
                term3Fee,
                isActive: true,
                createdBy: admin._id,
                updatedBy: admin._id
              });

              await newStructure.save();
              console.log(`  ✅ Created ${course.name} Year ${year} ${category} (${academicYear}) - ₹${totalFee.toLocaleString()}`);
              createdCount++;

            } catch (error) {
              console.error(`  ❌ Error creating ${course.name} Year ${year} ${category} (${academicYear}):`, error.message);
              errorCount++;
            }
          }
        }
      }
    }

    // Summary
    console.log('\n📊 Generation Summary:');
    console.log(`  ✅ Created: ${createdCount} fee structures`);
    console.log(`  ⏭️  Skipped: ${skippedCount} fee structures (already exist or no students)`);
    console.log(`  ❌ Errors: ${errorCount} fee structures`);
    console.log(`  📚 Courses processed: ${courses.length}`);
    console.log(`  📅 Academic years: ${academicYears.length}`);
    console.log(`  🏷️  Categories: ${allCategories.length}`);

    // Verification
    const totalStructures = await FeeStructure.countDocuments({ isActive: true });
    console.log(`\n🔍 Total active fee structures in database: ${totalStructures}`);

    // Show sample of created structures
    const sampleStructures = await FeeStructure.find({ isActive: true })
      .populate('course', 'name duration')
      .sort({ academicYear: -1, 'course.name': 1, year: 1, category: 1 })
      .limit(10);

    console.log('\n📋 Sample of fee structures:');
    sampleStructures.forEach(structure => {
      console.log(`  ${structure.academicYear} - ${structure.course.name} Year ${structure.year} ${structure.category} - ₹${structure.totalFee.toLocaleString()}`);
    });

    console.log('\n✅ Fee structure generation completed successfully!');
    
  } catch (error) {
    console.error('❌ Generation failed:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
};

// Main function to run the generation
const main = async () => {
  try {
    // Check for command line arguments
    const forceMode = process.argv.includes('--force');
    const dryRun = process.argv.includes('--dry-run');
    
    if (dryRun) {
      console.log('🔍 DRY RUN MODE - No changes will be made');
    }
    
    const options = {
      force: forceMode,
      dryRun: dryRun
    };
    
    if (dryRun) {
      console.log('🔍 This would generate fee structures for all course/year/category combinations');
      console.log('🔍 Use --force to create structures even without students');
      console.log('🔍 Remove --dry-run to actually create the structures');
      return;
    }
    
    await generateAllFeeStructures(options);
    console.log('🎉 Generation script completed');
  } catch (error) {
    console.error('💥 Generation script failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
};

// Run the generation
main();

export default generateAllFeeStructures;
