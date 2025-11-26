import mongoose from 'mongoose';
import dotenv from 'dotenv';
import readline from 'readline';

// Load environment variables
dotenv.config();

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (prompt) => {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
};

const reactivateStudents = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel_complaint_db');
    console.log('✅ Connected to MongoDB\n');

    // Import models after connection (Course and Branch must be imported for populate to work)
    const User = (await import('../models/User.js')).default;
    await import('../models/Course.js');
    await import('../models/Branch.js');

    // Get all inactive students
    const inactiveStudents = await User.find({ 
      role: 'student', 
      hostelStatus: 'Inactive' 
    })
    .populate('course', 'name')
    .populate('branch', 'name')
    .sort({ academicYear: -1, name: 1 });

    if (inactiveStudents.length === 0) {
      console.log('ℹ️  No inactive students found.');
      rl.close();
      process.exit(0);
    }

    console.log(`📋 Found ${inactiveStudents.length} inactive student(s):\n`);
    console.log('─'.repeat(100));
    console.log(
      'No.'.padEnd(5) +
      'Name'.padEnd(25) +
      'Roll Number'.padEnd(15) +
      'Course'.padEnd(15) +
      'Year'.padEnd(6) +
      'Academic Year'.padEnd(15) +
      'Batch'
    );
    console.log('─'.repeat(100));

    inactiveStudents.forEach((student, index) => {
      console.log(
        `${index + 1}`.padEnd(5) +
        (student.name || 'N/A').substring(0, 23).padEnd(25) +
        (student.rollNumber || 'N/A').padEnd(15) +
        (student.course?.name || 'N/A').substring(0, 13).padEnd(15) +
        `${student.year || 'N/A'}`.padEnd(6) +
        (student.academicYear || 'N/A').padEnd(15) +
        (student.batch || 'N/A')
      );
    });
    console.log('─'.repeat(100));

    // Group by academic year for summary
    const byAcademicYear = {};
    inactiveStudents.forEach(s => {
      const year = s.academicYear || 'Unknown';
      byAcademicYear[year] = (byAcademicYear[year] || 0) + 1;
    });

    console.log('\n📊 Summary by Academic Year:');
    Object.entries(byAcademicYear).sort().forEach(([year, count]) => {
      console.log(`   ${year}: ${count} student(s)`);
    });

    console.log('\n📌 Options:');
    console.log('   [A] Reactivate ALL inactive students');
    console.log('   [Y] Reactivate by Academic Year');
    console.log('   [S] Reactivate specific students (by number)');
    console.log('   [Q] Quit without changes\n');

    const choice = await question('Enter your choice (A/Y/S/Q): ');

    let studentsToReactivate = [];

    switch (choice.toUpperCase()) {
      case 'A':
        // Reactivate all
        studentsToReactivate = inactiveStudents;
        break;

      case 'Y':
        // Reactivate by academic year
        const academicYears = [...new Set(inactiveStudents.map(s => s.academicYear))].filter(Boolean).sort();
        console.log('\nAvailable Academic Years:');
        academicYears.forEach((year, i) => {
          const count = inactiveStudents.filter(s => s.academicYear === year).length;
          console.log(`   ${i + 1}. ${year} (${count} students)`);
        });
        
        const yearChoice = await question('\nEnter academic year (e.g., 2023-2024): ');
        studentsToReactivate = inactiveStudents.filter(s => s.academicYear === yearChoice.trim());
        
        if (studentsToReactivate.length === 0) {
          console.log('❌ No students found for that academic year.');
          rl.close();
          process.exit(0);
        }
        break;

      case 'S':
        // Reactivate specific students
        const numbers = await question('Enter student numbers (comma-separated, e.g., 1,3,5): ');
        const indices = numbers.split(',').map(n => parseInt(n.trim()) - 1);
        studentsToReactivate = indices
          .filter(i => i >= 0 && i < inactiveStudents.length)
          .map(i => inactiveStudents[i]);
        
        if (studentsToReactivate.length === 0) {
          console.log('❌ No valid student numbers provided.');
          rl.close();
          process.exit(0);
        }
        break;

      case 'Q':
        console.log('👋 Exiting without changes.');
        rl.close();
        process.exit(0);
        break;

      default:
        console.log('❌ Invalid choice.');
        rl.close();
        process.exit(1);
    }

    // Confirm reactivation
    console.log(`\n⚠️  You are about to reactivate ${studentsToReactivate.length} student(s):`);
    studentsToReactivate.forEach(s => {
      console.log(`   - ${s.name} (${s.rollNumber})`);
    });

    const confirm = await question('\nProceed with reactivation? (yes/no): ');
    
    if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
      console.log('❌ Reactivation cancelled.');
      rl.close();
      process.exit(0);
    }

    // Perform reactivation
    console.log('\n🔄 Reactivating students...');
    
    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const student of studentsToReactivate) {
      try {
        student.hostelStatus = 'Active';
        await student.save();
        successCount++;
        console.log(`   ✅ ${student.name} (${student.rollNumber}) - Reactivated`);
      } catch (error) {
        errorCount++;
        errors.push({ student: student.rollNumber, error: error.message });
        console.log(`   ❌ ${student.name} (${student.rollNumber}) - Failed: ${error.message}`);
      }
    }

    console.log('\n' + '═'.repeat(50));
    console.log('📊 REACTIVATION SUMMARY');
    console.log('═'.repeat(50));
    console.log(`   ✅ Successfully reactivated: ${successCount}`);
    console.log(`   ❌ Failed: ${errorCount}`);
    console.log('═'.repeat(50));

    if (errors.length > 0) {
      console.log('\n❌ Errors:');
      errors.forEach(e => console.log(`   ${e.student}: ${e.error}`));
    }

    rl.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    rl.close();
    process.exit(1);
  }
};

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Exiting...');
  rl.close();
  process.exit(0);
});

reactivateStudents();

