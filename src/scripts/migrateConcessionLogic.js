import mongoose from 'mongoose';
import User from '../models/User.js';
import FeeStructure from '../models/FeeStructure.js';
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

// Migration function to update concession logic for existing students
const migrateConcessionLogic = async () => {
  try {
    console.log('🔄 Starting concession logic migration...');
    
    // Get all students with concessions
    const studentsWithConcessions = await User.find({
      role: 'student',
      concession: { $gt: 0 }
    }).select('_id name rollNumber concession category academicYear calculatedTerm1Fee calculatedTerm2Fee calculatedTerm3Fee totalCalculatedFee');
    
    console.log(`📊 Found ${studentsWithConcessions.length} students with concessions`);
    
    let updatedCount = 0;
    let errorCount = 0;
    const errors = [];
    
    for (const student of studentsWithConcessions) {
      try {
        console.log(`🔍 Processing student: ${student.name} (${student.rollNumber})`);
        console.log(`   Current concession: ₹${student.concession}`);
        console.log(`   Current calculated fees: T1: ₹${student.calculatedTerm1Fee}, T2: ₹${student.calculatedTerm2Fee}, T3: ₹${student.calculatedTerm3Fee}`);
        
        // Get fee structure for the student
        const feeStructure = await FeeStructure.getFeeStructure(student.academicYear, student.course, student.branch, student.year, student.category);
        
        if (!feeStructure) {
          console.log(`   ⚠️ No fee structure found for category: ${student.category}, academic year: ${student.academicYear}`);
          errors.push({
            studentId: student._id,
            rollNumber: student.rollNumber,
            error: 'No fee structure found'
          });
          errorCount++;
          continue;
        }
        
        // Calculate new fees with updated concession logic
        const concessionAmount = student.concession;
        
        // Apply concession to Term 1 first
        const newCalculatedTerm1Fee = Math.max(0, feeStructure.term1Fee - concessionAmount);
        
        // If concession exceeds Term 1 fee, apply excess to Term 2
        let remainingConcession = Math.max(0, concessionAmount - feeStructure.term1Fee);
        const newCalculatedTerm2Fee = Math.max(0, feeStructure.term2Fee - remainingConcession);
        
        // If concession still exceeds Term 1 + Term 2, apply to Term 3
        remainingConcession = Math.max(0, remainingConcession - feeStructure.term2Fee);
        const newCalculatedTerm3Fee = Math.max(0, feeStructure.term3Fee - remainingConcession);
        
        const newTotalCalculatedFee = newCalculatedTerm1Fee + newCalculatedTerm2Fee + newCalculatedTerm3Fee;
        
        console.log(`   📊 Fee structure: T1: ₹${feeStructure.term1Fee}, T2: ₹${feeStructure.term2Fee}, T3: ₹${feeStructure.term3Fee}`);
        console.log(`   💰 New calculated fees: T1: ₹${newCalculatedTerm1Fee}, T2: ₹${newCalculatedTerm2Fee}, T3: ₹${newCalculatedTerm3Fee}`);
        console.log(`   📈 Total: ₹${newTotalCalculatedFee} (was ₹${student.totalCalculatedFee})`);
        
        // Update student with new calculated fees
        await User.findByIdAndUpdate(student._id, {
          calculatedTerm1Fee: newCalculatedTerm1Fee,
          calculatedTerm2Fee: newCalculatedTerm2Fee,
          calculatedTerm3Fee: newCalculatedTerm3Fee,
          totalCalculatedFee: newTotalCalculatedFee
        });
        
        console.log(`   ✅ Updated successfully`);
        updatedCount++;
        
      } catch (error) {
        console.error(`   ❌ Error processing student ${student.rollNumber}:`, error.message);
        errors.push({
          studentId: student._id,
          rollNumber: student.rollNumber,
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
        console.log(`   - ${error.rollNumber}: ${error.error}`);
      });
    }
    
    console.log('\n🎉 Concession logic migration completed!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
  }
};

// Main execution
const main = async () => {
  try {
    await connectDB();
    await migrateConcessionLogic();
  } catch (error) {
    console.error('❌ Script execution failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
};

// Run the migration
main();
